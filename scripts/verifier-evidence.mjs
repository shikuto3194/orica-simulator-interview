#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildVerificationTree,
  committedTree,
  changedFilesBetweenTrees,
  diffBetweenTrees,
} from "./verifier-tree.mjs";
import { extractQuantifiedEffectRepeats } from "./quantified-effect-repeat.mjs";
import {
  changedCardNosFromDiff,
  parseCardEntries,
} from "./verifier-card-context.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const command = args[0];

function option(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function fail(message) {
  console.error(`[verifier-evidence] ${message}`);
  process.exit(2);
}

function pathFromRoot(value) {
  return isAbsolute(value) ? value : resolve(ROOT, value);
}

function readJson(path, label) {
  if (!existsSync(path)) fail(`${label} が存在しない: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label} の JSON parse 失敗: ${error.message}`);
  }
}

function assertHash(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40,64}$/.test(value)) {
    fail(`${label} が不正`);
  }
}

function changedQuantifiedEffectClauses(expectedFiles, changedCardNos) {
  if (!Array.isArray(expectedFiles)) return [];
  if (!Array.isArray(changedCardNos)) return [];
  return expectedFiles.flatMap((file) => {
    if (!/^packages\/card-data\/src\/cards\/[^/]+\.ts$/.test(file)) return [];
    const path = resolve(ROOT, file);
    if (!existsSync(path)) return [];
    return parseCardEntries(path)
      .filter(({ cardNo }) => changedCardNos.includes(cardNo))
      .flatMap(({ cardNo, textLines }) =>
        textLines.flatMap((text) =>
          extractQuantifiedEffectRepeats(text).map((match) => ({
            cardNo,
            text: match.text,
            mode: match.additional ? "additional" : "per_count",
          }))
        )
      );
  });
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim())
    fail(`${label} は非空文字列必須`);
}

function validateQuantifiedEffectReview(review, expectedFiles, changedCardNos) {
  const expectedClauses = changedQuantifiedEffectClauses(
    expectedFiles,
    changedCardNos
  );
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    fail("quantifiedEffectReview の構造化記録が必要");
  }
  if (
    review.applicability !== "applicable" &&
    review.applicability !== "not_applicable"
  ) {
    fail(
      "quantifiedEffectReview.applicability は applicable/not_applicable 必須"
    );
  }
  if (!Array.isArray(review.mappings)) {
    fail("quantifiedEffectReview.mappings は配列必須");
  }
  if (expectedClauses.length === 0) {
    if (review.applicability !== "not_applicable") {
      fail(
        "量化反復本文が変更カードに無い場合は quantifiedEffectReview=not_applicable 必須"
      );
    }
    requireNonEmptyString(
      review.reason,
      "quantifiedEffectReview.not_applicable.reason"
    );
    if (review.mappings.length !== 0) {
      fail("not_applicable の quantifiedEffectReview.mappings は空配列必須");
    }
    return;
  }
  if (review.applicability !== "applicable") {
    fail(
      `量化反復本文を含む変更カード(${[...new Set(expectedClauses.map(({ cardNo }) => cardNo))].join(",")})には quantifiedEffectReview.applicable 必須`
    );
  }
  if (review.reason !== undefined && typeof review.reason !== "string") {
    fail("quantifiedEffectReview.reason は文字列のみ");
  }
  if (review.mappings.length === 0) {
    fail("量化反復本文には本文句→意味→carrier→反証ケースの対応表が必要");
  }
  const reportedClauses = [];
  for (const [mappingIndex, mapping] of review.mappings.entries()) {
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      fail(`quantifiedEffectReview.mappings[${mappingIndex}] が不正`);
    }
    requireNonEmptyString(
      mapping.cardNo,
      `quantifiedEffectReview.mappings[${mappingIndex}].cardNo`
    );
    if (!Array.isArray(mapping.clauses) || mapping.clauses.length === 0) {
      fail(
        `quantifiedEffectReview.mappings[${mappingIndex}].clauses は非空配列必須`
      );
    }
    for (const [clauseIndex, clause] of mapping.clauses.entries()) {
      if (!clause || typeof clause !== "object" || Array.isArray(clause)) {
        fail(
          `quantifiedEffectReview.mappings[${mappingIndex}].clauses[${clauseIndex}] が不正`
        );
      }
      for (const field of ["text", "meaning", "carrier"]) {
        requireNonEmptyString(
          clause[field],
          `quantifiedEffectReview.mappings[${mappingIndex}].clauses[${clauseIndex}].${field}`
        );
      }
      if (clause.mode !== "additional" && clause.mode !== "per_count") {
        fail(
          `quantifiedEffectReview.mappings[${mappingIndex}].clauses[${clauseIndex}].mode は additional/per_count 必須`
        );
      }
      reportedClauses.push({
        cardNo: mapping.cardNo,
        text: clause.text,
        mode: clause.mode,
      });
      if (!Array.isArray(clause.counterexamples)) {
        fail(
          `quantifiedEffectReview.mappings[${mappingIndex}].clauses[${clauseIndex}].counterexamples は配列必須`
        );
      }
      const cases = [...clause.counterexamples].sort(
        (left, right) => left?.n - right?.n
      );
      if (
        JSON.stringify(cases.map((entry) => entry?.n)) !==
        JSON.stringify([0, 1, 2])
      ) {
        fail(
          `quantifiedEffectReview.mappings[${mappingIndex}].clauses[${clauseIndex}] は N=0/1/2 の完走反証ケース必須`
        );
      }
      for (const entry of cases) {
        for (const field of ["scenario", "expected", "evidence"]) {
          requireNonEmptyString(
            entry?.[field],
            `quantifiedEffectReview.mappings[${mappingIndex}].clauses[${clauseIndex}].counterexamples[N=${entry?.n}].${field}`
          );
        }
        if (!/\S+:\d+/.test(entry.evidence)) {
          fail("量化反復の反証ケース evidence は path:line 必須");
        }
        const expectedExecutions =
          clause.mode === "additional" ? entry.n + 1 : entry.n;
        if (entry.executions !== expectedExecutions) {
          fail(
            `量化反復の反証ケース N=${entry.n} は mode=${clause.mode} の ${expectedExecutions} 巡を executions に記録する必要がある`
          );
        }
      }
    }
  }
  const clauseKey = ({ cardNo, text, mode }) =>
    `${cardNo}\u0000${text}\u0000${mode}`;
  const expectedKeys = expectedClauses.map(clauseKey).sort();
  const reportedKeys = reportedClauses.map(clauseKey).sort();
  if (JSON.stringify(reportedKeys) !== JSON.stringify(expectedKeys)) {
    fail(
      `quantifiedEffectReview は変更カードの各量化本文句を一意に対応付ける必要がある（期待=${JSON.stringify(expectedClauses)}; 実値=${JSON.stringify(reportedClauses)}）`
    );
  }
}

function validateReport(report, expectedFiles = null, changedCardNos = null) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    fail("verifier report は JSON object 必須");
  }
  if (
    typeof report.summary !== "string" ||
    report.summary.trim() === "" ||
    !Array.isArray(report.items)
  ) {
    fail("verifier report は summary:string と items:array 必須");
  }
  for (const [index, item] of report.items.entries()) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.refuted !== "boolean"
    ) {
      fail(`verifier report items[${index}].refuted は boolean 必須`);
    }
    for (const field of ["cardNo", "lens", "claim", "evidence", "expected"]) {
      if (typeof item[field] !== "string" || item[field].trim() === "") {
        fail(`verifier report items[${index}].${field} は非空文字列必須`);
      }
    }
  }
  // Historical reports remain readable. Every newly recorded report must
  // account for the actual changed files and all six review lenses.
  if (expectedFiles !== null || report.coverage !== undefined) {
    const coverage = report.coverage;
    if (
      !coverage ||
      coverage.fullDiffRead !== true ||
      !Array.isArray(coverage.files) ||
      !Array.isArray(coverage.lenses) ||
      !Array.isArray(coverage.unverified) ||
      coverage.unverified.length !== 0
    ) {
      fail(
        "verifier coverage: fullDiffRead/files/lenses/unverified の確認記録が必要"
      );
    }
    if (
      coverage.files.some((file) => typeof file !== "string" || !file.trim()) ||
      new Set(coverage.files).size !== coverage.files.length
    )
      fail("verifier coverage.files が不正");
    if (
      expectedFiles !== null &&
      JSON.stringify([...coverage.files].sort()) !==
        JSON.stringify([...expectedFiles].sort())
    )
      fail("verifier coverage.files が実際の変更範囲と一致しない");
    const lenses = coverage.lenses.map((item) => item?.lens);
    if (
      JSON.stringify([...lenses].sort()) !==
      JSON.stringify(["1", "2", "3", "4", "5", "6"])
    )
      fail("verifier coverage は6つのlensを各1回記録すること");
    for (const item of coverage.lenses) {
      if (item.status === "checked") {
        if (
          !Array.isArray(item.evidence) ||
          !item.evidence.length ||
          item.evidence.some(
            (value) => typeof value !== "string" || !/\S+:\d+/.test(value)
          )
        )
          fail("checked lens はpath:line根拠必須");
      } else if (item.status === "not_applicable") {
        if (typeof item.reason !== "string" || !item.reason.trim())
          fail("not_applicable lens は理由必須");
      } else fail("verifier coverage lens status が不正");
    }
    if (expectedFiles !== null) {
      validateQuantifiedEffectReview(
        report.quantifiedEffectReview,
        expectedFiles,
        changedCardNos
      );
    }
  }
  return report.items.filter((item) => item.refuted).length;
}

function validateEvidence(evidence, expectedBase) {
  if (evidence.schemaVersion !== 3 || evidence.base !== expectedBase) {
    fail(
      `verifier evidence の schema/base が不正 (expected base=${expectedBase})`
    );
  }
  assertHash(evidence.headTree, "verifier evidence headTree");
  if (evidence.refuted !== 0) fail("verifier evidence に未解消 refute がある");
  if (typeof evidence.summary !== "string" || evidence.summary.trim() === "") {
    fail("verifier evidence summary が不正");
  }
  if (
    typeof evidence.reportSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(evidence.reportSha256)
  ) {
    fail("verifier evidence reportSha256 が不正");
  }
  if (
    typeof evidence.verifiedAt !== "string" ||
    Number.isNaN(Date.parse(evidence.verifiedAt))
  ) {
    fail("verifier evidence verifiedAt が不正");
  }
  if (
    !evidence.report ||
    typeof evidence.report !== "object" ||
    validateReport(evidence.report) !== 0
  ) {
    fail("verifier evidence 内の完全 report が不正");
  }
  if (
    typeof evidence.reportBase64 !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(evidence.reportBase64)
  ) {
    fail("verifier evidence reportBase64 が不正");
  }
  const embeddedReportText = Buffer.from(
    evidence.reportBase64,
    "base64"
  ).toString("utf8");
  if (
    Buffer.from(embeddedReportText, "utf8").toString("base64") !==
    evidence.reportBase64
  ) {
    fail("verifier evidence reportBase64 がcanonicalではない");
  }
  if (
    createHash("sha256").update(embeddedReportText).digest("hex") !==
    evidence.reportSha256
  ) {
    fail("verifier evidence 埋め込みreportのSHA-256が不一致");
  }
  if (
    JSON.stringify(JSON.parse(embeddedReportText)) !==
    JSON.stringify(evidence.report)
  ) {
    fail("verifier evidence 埋め込みreportとreport objectが不一致");
  }
  if (
    typeof evidence.archiveRelativePath !== "string" ||
    evidence.archiveRelativePath.trim() === ""
  ) {
    fail("verifier evidence archiveRelativePath が不正");
  }
  const archivedReportPath = resolve(
    ROOT,
    evidence.archiveRelativePath,
    "report.json"
  );
  if (!existsSync(archivedReportPath)) {
    fail(`verifier report archive が存在しない: ${archivedReportPath}`);
  }
  const archivedReportText = readFileSync(archivedReportPath, "utf8");
  const archivedReportSha256 = createHash("sha256")
    .update(archivedReportText)
    .digest("hex");
  if (archivedReportSha256 !== evidence.reportSha256) {
    fail("verifier report archive の SHA-256 が証跡と一致しない");
  }
  validateReport(JSON.parse(archivedReportText));
  return evidence;
}

function gitText(args) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
  });
  if ((result.status ?? 1) !== 0) {
    process.stderr.write(result.stderr || result.stdout || "");
    fail(`git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function commitAuditField(message, name) {
  const match = new RegExp(`^${name}: (.+)$`, "m").exec(message);
  if (!match) fail(`commit audit field が存在しない: ${name}`);
  return match[1].trim();
}

function validateCommitAudit(commitRef) {
  const message = gitText(["show", "-s", "--format=%B", commitRef]);
  const commitTree = gitText(["rev-parse", `${commitRef}^{tree}`]);
  const schemaVersion = Number.parseInt(
    commitAuditField(message, "Verifier-Evidence-Schema"),
    10
  );
  if (schemaVersion !== 3) fail("commit audit schema が不正");
  const headTree = commitAuditField(message, "Verifier-Head-Tree");
  const reportSha256 = commitAuditField(message, "Verifier-Report-SHA256");
  const reportBase64 = commitAuditField(message, "Verifier-Report-Base64");
  assertHash(headTree, "commit audit headTree");
  assertHash(reportSha256, "commit audit reportSha256");
  if (headTree !== commitTree) {
    fail(
      `commit treeとVerifier-Head-Treeが不一致 (commit=${commitTree}, verified=${headTree})`
    );
  }
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(reportBase64) ||
    Buffer.from(reportBase64, "base64").toString("base64") !== reportBase64
  ) {
    fail("commit audit reportBase64 が不正");
  }
  const reportText = Buffer.from(reportBase64, "base64").toString("utf8");
  if (createHash("sha256").update(reportText).digest("hex") !== reportSha256) {
    fail("commit audit report SHA-256 が不一致");
  }
  const report = JSON.parse(reportText);
  if (validateReport(report) !== 0) {
    fail("commit audit report に未解消refuteがある");
  }
  return { headTree, reportSha256, reportBase64, report };
}

function readEvidence(expectedBase) {
  const evidencePath = pathFromRoot(
    option("--evidence", ".verifier-result.json")
  );
  return validateEvidence(
    readJson(evidencePath, "verifier evidence"),
    expectedBase
  );
}

function record() {
  const contextPath = pathFromRoot(
    option("--context", ".verifier-context.json")
  );
  const reportPath = pathFromRoot(option("--report", ".verifier-report.json"));
  const outPath = pathFromRoot(option("--out", ".verifier-result.json"));
  // parse/refute/生成失敗時に旧証跡を残さない。
  if (existsSync(outPath)) rmSync(outPath, { force: true });
  const context = readJson(contextPath, "verifier context");
  const reportText = readFileSync(reportPath, "utf8");
  const report = readJson(reportPath, "verifier report");

  if (context.schemaVersion !== 1 || typeof context.base !== "string") {
    fail("verifier context の schemaVersion/base が不正");
  }
  assertHash(context.headTree, "verifier context headTree");
  if (
    !Array.isArray(context.changedCardNos) ||
    context.changedCardNos.some(
      (cardNo) => typeof cardNo !== "string" || !cardNo
    )
  ) {
    fail("verifier context の changedCardNos が不正");
  }
  if (new Set(context.changedCardNos).size !== context.changedCardNos.length) {
    fail("verifier context の changedCardNos は重複不可");
  }

  const current = buildVerificationTree(ROOT, context.base);
  const expectedFiles = changedFilesBetweenTrees(
    ROOT,
    current.baseTree,
    current.headTree
  );
  const actualChangedCardNos = changedCardNosFromDiff({
    root: ROOT,
    files: expectedFiles,
    fullDiff: diffBetweenTrees(ROOT, current.baseTree, current.headTree, [
      "--unified=0",
    ]),
  });
  if (
    JSON.stringify([...context.changedCardNos].sort()) !==
    JSON.stringify(actualChangedCardNos)
  ) {
    fail(
      `verifier context の changedCardNos が現在treeの差分と一致しない (expected=${JSON.stringify(actualChangedCardNos)}, actual=${JSON.stringify(context.changedCardNos)})`
    );
  }
  const refuted = validateReport(report, expectedFiles, actualChangedCardNos);
  if (refuted !== 0) {
    fail(`refute が ${refuted} 件残っているため証跡を生成しない`);
  }

  if (current.headTree !== context.headTree) {
    fail(
      `verifier 実行後にtreeが変化した (expected=${context.headTree}, actual=${current.headTree})`
    );
  }

  const evidence = {
    schemaVersion: 3,
    base: context.base,
    headTree: context.headTree,
    verifiedAt: new Date().toISOString(),
    summary: report.summary,
    refuted: 0,
    reportSha256: createHash("sha256").update(reportText).digest("hex"),
    reportBase64: Buffer.from(reportText, "utf8").toString("base64"),
    report,
  };
  const archiveRoot = pathFromRoot(
    option("--archive-dir", "logs/verifier-history")
  );
  const archiveRunName = evidence.verifiedAt.replaceAll(":", "-");
  const archivePath = join(archiveRoot, context.headTree, archiveRunName);
  mkdirSync(archivePath, { recursive: true });
  evidence.archiveRelativePath = relative(ROOT, archivePath).replaceAll(
    "\\",
    "/"
  );
  writeFileSync(
    join(archivePath, "context.json"),
    `${JSON.stringify(context, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(join(archivePath, "report.json"), reportText, "utf8");
  writeFileSync(
    join(archivePath, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.error(
    `[verifier-evidence] 全 vouch: ${outPath} (headTree=${evidence.headTree}, archive=${evidence.archiveRelativePath})`
  );
}

function check() {
  const expectedBase = option("--base", "main");
  const evidence = readEvidence(expectedBase);

  const actualTree = committedTree(ROOT);
  if (evidence.headTree !== actualTree) {
    fail(
      `検証済みtreeと現在のbranch treeが不一致 (verified=${evidence.headTree}, actual=${actualTree})`
    );
  }
  const audit = validateCommitAudit("HEAD");
  if (
    audit.headTree !== evidence.headTree ||
    audit.reportSha256 !== evidence.reportSha256 ||
    audit.reportBase64 !== evidence.reportBase64
  ) {
    fail("commit埋め込みauditとlocal verifier evidenceが不一致");
  }
  console.error(
    `[verifier-evidence] OK: refuted=0, headTree=${evidence.headTree}`
  );
}

function checkCommit() {
  const commitRef = option("--commit", "HEAD");
  const audit = validateCommitAudit(commitRef);
  // An explicitly selected retained archive must agree with this commit, even
  // when HEAD or the latest local cache has moved on. Preserve the commit-only
  // default used by remote publication checks.
  if (args.includes("--evidence")) {
    const evidence = readEvidence(option("--base", "main"));
    if (
      audit.headTree !== evidence.headTree ||
      audit.reportSha256 !== evidence.reportSha256 ||
      audit.reportBase64 !== evidence.reportBase64
    )
      fail("commit埋め込みauditと指定verifier evidenceが不一致");
  }
  console.error(
    `[verifier-evidence] OK(commit): refuted=0, headTree=${audit.headTree}, reportSha256=${audit.reportSha256}`
  );
}

function checkWorktree() {
  const expectedBase = option("--base", "main");
  const evidence = readEvidence(expectedBase);
  const actualTree = buildVerificationTree(ROOT, expectedBase).headTree;
  if (evidence.headTree !== actualTree) {
    fail(
      `検証済みtreeと現在のworktree treeが不一致 (verified=${evidence.headTree}, actual=${actualTree})`
    );
  }
  console.error(
    `[verifier-evidence] OK(worktree): refuted=0, headTree=${evidence.headTree}`
  );
}

if (command === "record") {
  try {
    const { runVerifierWriter } = await import("./verifier-write-lock.mjs");
    process.exitCode = await runVerifierWriter(import.meta.url, record);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else if (command === "check") check();
else if (command === "check-commit") checkCommit();
else if (command === "check-worktree") checkWorktree();
else
  fail(
    "usage: verifier-evidence.mjs <record|check|check-commit|check-worktree> [options]"
  );
