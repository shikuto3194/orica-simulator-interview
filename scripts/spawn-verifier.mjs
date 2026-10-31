#!/usr/bin/env node
/**
 * 敵対的 verifier 用の read-only prompt と検証対象tree contextを生成する。
 * 対象は base...HEAD のcommit済み差分に staged / unstaged / untracked を重ねた
 * 一時treeであり、実indexやworktreeは変更しない。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildVerificationTree,
  changedFilesBetweenTrees,
  diffBetweenTrees,
} from "./verifier-tree.mjs";
import {
  changedCardNosFromDiff,
  parseCardEntries,
} from "./verifier-card-context.mjs";
import { selectCandidateFuzzEvidence } from "./harness/fuzz-candidate-evidence.mjs";
import verificationState from "./harness/verification-state.cjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");
const args = process.argv.slice(2);

function option(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function candidateFuzzSummary(root, tree) {
  const latestPath = join(root, "logs", "harness", "latest.json");
  if (!existsSync(latestPath)) return "";
  let latest;
  try {
    latest = JSON.parse(readFileSync(latestPath, "utf8"));
  } catch {
    return "";
  }
  if (
    latest.profile !== "merge" ||
    latest.status !== "passed" ||
    latest.sourceTree !== tree.headTree ||
    latest.fuzzRequired !== true
  )
    return "";

  const head = verificationState.git(root, ["rev-parse", "HEAD"]).trim();
  const committedTree = verificationState
    .git(root, ["rev-parse", "HEAD^{tree}"])
    .trim();
  const sourceFingerprint = verificationState.sourceFingerprintDetails(root, {
    includeEnvironment: false,
  }).fingerprint;
  const evidence = selectCandidateFuzzEvidence({
    root,
    head,
    tree: committedTree,
    sourceFingerprint,
    games: 200,
  });
  if (!evidence)
    return [
      "",
      "--- required candidate fuzz evidence ---",
      `Gate report requires fuzz for HEAD ${head}, tree ${committedTree}, but no passed 200-game receipt matches the current source fingerprint ${sourceFingerprint}. Treat fuzz verification as unverified; do not infer success from a fixture or another candidate.`,
    ].join("\n");

  return [
    "",
    "--- required candidate fuzz evidence ---",
    `Read ${evidence.file} and verify its SHA-256 ${evidence.sha256}. It is a passed 200-game receipt bound to HEAD ${head}, tree ${committedTree}, and source fingerprint ${sourceFingerprint}; verify these fields and the queue receipt. This is the candidate-specific fuzz evidence required by the matching merge gate report.`,
  ].join("\n");
}

const JSON_ONLY = args.includes("--json");
const ALLOW_EMPTY = args.includes("--allow-empty");
const BASE = option("--base", "main");
const OUT = option("--out");
const CONTEXT_OUT = option("--context-out", ".verifier-context.json");
const EVIDENCE_OUT = option("--evidence-out", ".verifier-result.json");
const MAX_DIFF_LINES = Number.parseInt(option("--max-diff-lines", "300"), 10);
const MAX_TEXTLINES = 30;
const CARD_DATA_DIR = join(ROOT, "packages", "card-data", "src", "cards");
const PROMPT_DOC = join(
  ROOT,
  "manual",
  "ai-reference",
  "30_plan",
  "adversarial-verifier-prompt.md"
);

function fail(message) {
  console.error(`[spawn-verifier] ${message}`);
  process.exit(2);
}

function rootPath(value) {
  return isAbsolute(value) ? value : resolve(ROOT, value);
}

function extractPromptBody(source) {
  const match = source.match(
    /##\s+検証エージェント宛のプロンプト本体[\s\S]*?\n````[a-z]*\n([\s\S]*?)\n````/
  );
  if (!match) fail(`${PROMPT_DOC} から4-backtick promptを抽出できない`);
  return match[1];
}

function buildImpactedCards(files, changedCardNos) {
  const cardFiles = files.filter((file) =>
    /packages\/card-data\/src\/cards\/.+\.ts$/.test(file)
  );
  const catalog = existsSync(CARD_DATA_DIR)
    ? readdirSync(CARD_DATA_DIR)
        .filter((file) => file.endsWith(".ts"))
        .flatMap((file) => parseCardEntries(join(CARD_DATA_DIR, file)))
    : [];
  const changedSource = files
    .filter((file) => !cardFiles.includes(file))
    .filter((file) => existsSync(join(ROOT, file)))
    .map((file) => readFileSync(join(ROOT, file), "utf8"))
    .join("\n");
  const referencedCards = catalog.filter((card) =>
    changedSource.includes(card.cardNo)
  );
  const cardsByNo = new Map();
  for (const card of [
    ...cardFiles
      .flatMap((file) => parseCardEntries(join(ROOT, file)))
      .filter((card) => changedCardNos.includes(card.cardNo)),
    ...referencedCards,
  ]) {
    cardsByNo.set(card.cardNo, card);
  }
  return {
    editedFiles: cardFiles.length,
    referencedCards: referencedCards.length,
    cards: [...cardsByNo.values()],
  };
}

function buildPrimitivesTouched(files, tree) {
  const rulesFiles = files.filter((file) =>
    /^packages\/rules-core\/src\//.test(file)
  );
  const result = {
    modelTsKindsAdded: [],
    dslTypesTouched: false,
    interpreterFilesTouched: [],
    registrationFilesTouched: [],
    otherRulesCoreFiles: [],
  };
  for (const file of rulesFiles) {
    if (/model\.ts$/.test(file)) {
      const diff = diffBetweenTrees(ROOT, tree.baseTree, tree.headTree, [
        "--",
        file,
      ]);
      for (const match of diff.matchAll(
        /^\+\s*kind:\s*"([a-z][a-z0-9_-]*)"/gm
      )) {
        result.modelTsKindsAdded.push(match[1]);
      }
    } else if (/dsl-types\.ts$/.test(file)) result.dslTypesTouched = true;
    else if (
      /interpreter|trigger-system|advent-system|effect-interpreter/.test(file)
    ) {
      result.interpreterFilesTouched.push(file);
    } else if (/registration|structured-effect-registrations/.test(file)) {
      result.registrationFilesTouched.push(file);
    } else result.otherRulesCoreFiles.push(file);
  }
  return result;
}

function renderCards({ editedFiles, referencedCards, cards }) {
  if (cards.length === 0) {
    return "(影響カードを特定できず — 変更ファイル全文にも既知cardNoなし)";
  }
  const blocks = cards.map((card) => {
    const lines = card.textLines
      .slice(0, MAX_TEXTLINES)
      .map((line, index) => `    [${index}] ${line}`)
      .join("\n");
    return `- ${card.cardNo} ${card.name} (set=${card.set})\n  textLines:\n${lines}`;
  });
  return [
    `card-data編集ファイル数: ${editedFiles}`,
    `変更ファイル全文から参照された既知カード数: ${referencedCards}`,
    `影響カード 計${cards.length}枚:`,
    blocks.join("\n\n"),
  ].join("\n");
}

function splitDiffFiles(diffLines) {
  const blocks = [];
  let current = [];
  for (const line of diffLines) {
    if (line.startsWith("diff --git ") && current.length > 0) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current);
  return blocks.filter((block) => block.some((line) => line.trim() !== ""));
}

function splitFileHunks(block) {
  const firstHunk = block.findIndex((line) => line.startsWith("@@ "));
  if (firstHunk < 0) return { header: block, hunks: [] };
  const header = block.slice(0, firstHunk);
  const hunks = [];
  let current = [];
  for (const line of block.slice(firstHunk)) {
    if (line.startsWith("@@ ") && current.length > 0) {
      hunks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) hunks.push(current);
  return { header, hunks };
}

function compactFileHeader(header) {
  return [
    header[0],
    header.find((line) => line.startsWith("--- ")),
    header.find((line) => line.startsWith("+++ ")),
  ].filter((line, index, lines) => line && lines.indexOf(line) === index);
}

function renderHunk(hunk, quota) {
  if (hunk.length <= quota) return hunk;
  if (quota <= 1) return [hunk[0]];
  const additions = hunk.slice(1).filter((line) => line.startsWith("+"));
  const changes =
    additions.length > 0
      ? additions
      : hunk.slice(1).filter((line) => line.startsWith("-"));
  const candidates = changes.length > 0 ? changes : hunk.slice(1);
  if (quota === 2) {
    const first = candidates[0] ?? hunk[1];
    const last = candidates.at(-1) ?? first;
    // The prompt summary has room for only one body line, but must still expose
    // both ends of a changed hunk. This is intentionally a summary line, not
    // an applyable patch; the separately written fullDiffPath is applyable.
    return first === last
      ? [hunk[0], first]
      : [hunk[0], `${first} ... [hunk末尾の変更] ... ${last}`];
  }
  const selectedCount = quota - 2;
  const headCount = Math.floor(selectedCount / 2);
  const tailCount = Math.ceil(selectedCount / 2);
  const selected = [
    ...candidates.slice(0, headCount),
    ...candidates.slice(-tailCount),
  ].filter((line, index, lines) => lines.indexOf(line) === index);
  const omitted = hunk.length - 1 - selected.length;
  return [
    hunk[0],
    ...selected.slice(0, headCount),
    `... [hunk中間 ${omitted} 行省略] ...`,
    ...selected.slice(headCount),
  ];
}

function renderFileDiff(block, quota) {
  if (block.length <= quota) return block;
  const { header, hunks } = splitFileHunks(block);
  if (hunks.length === 0) {
    const headCount = Math.max(1, Math.ceil((quota - 1) / 2));
    const tailCount = Math.max(0, quota - headCount - 1);
    return [
      ...block.slice(0, headCount),
      `... [file中間 ${block.length - headCount - tailCount} 行省略] ...`,
      ...(tailCount > 0 ? block.slice(-tailCount) : []),
    ];
  }

  const renderedHeader = compactFileHeader(header);
  const minimumHunkQuota = 2;
  const hunkQuotas = hunks.map(() => minimumHunkQuota);
  let remaining = Math.max(
    0,
    quota - renderedHeader.length - minimumHunkQuota * hunks.length
  );
  while (remaining > 0) {
    let progressed = false;
    for (let index = 0; index < hunks.length && remaining > 0; index += 1) {
      if (hunkQuotas[index] >= hunks[index].length) continue;
      hunkQuotas[index] += 1;
      remaining -= 1;
      progressed = true;
    }
    if (!progressed) break;
  }
  return [
    ...renderedHeader,
    ...hunks.flatMap((hunk, index) => renderHunk(hunk, hunkQuotas[index])),
  ];
}

function renderBoundedDiff(diffLines, maxLines) {
  if (diffLines.length <= maxLines) {
    return {
      label: `全体 ${diffLines.length}行`,
      body: diffLines.join("\n"),
    };
  }

  const blocks = splitDiffFiles(diffLines);
  const minimumQuotas = blocks.map((block) => {
    const { header, hunks } = splitFileHunks(block);
    if (hunks.length === 0) return Math.min(block.length, 3);
    return Math.min(
      block.length,
      compactFileHeader(header).length + hunks.length * 2
    );
  });
  const quotas = [...minimumQuotas];
  let remaining = Math.max(
    0,
    maxLines - quotas.reduce((sum, quota) => sum + quota, 0)
  );
  while (remaining > 0) {
    let progressed = false;
    for (let index = 0; index < blocks.length && remaining > 0; index += 1) {
      if (quotas[index] >= blocks[index].length) continue;
      quotas[index] += 1;
      remaining -= 1;
      progressed = true;
    }
    if (!progressed) break;
  }

  const renderedLines = blocks.flatMap((block, index) =>
    renderFileDiff(block, quotas[index])
  );
  return {
    label:
      `変更file ${blocks.length}件・各file/hunk先頭末尾 / 全${diffLines.length}行` +
      `（表示${renderedLines.length}行、基準上限${maxLines}行）`,
    body: renderedLines.join("\n"),
  };
}

function renderPrimitives(value) {
  const lines = [];
  if (value.modelTsKindsAdded.length)
    lines.push(`- model.ts追加kind: ${value.modelTsKindsAdded.join(", ")}`);
  if (value.dslTypesTouched) lines.push("- dsl-types.ts編集あり");
  if (value.interpreterFilesTouched.length)
    lines.push(
      `- interpreter系:\n  ${value.interpreterFilesTouched.join("\n  ")}`
    );
  if (value.registrationFilesTouched.length)
    lines.push(
      `- registrations:\n  ${value.registrationFilesTouched.join("\n  ")}`
    );
  if (value.otherRulesCoreFiles.length)
    lines.push(
      `- その他rules-core:\n  ${value.otherRulesCoreFiles.join("\n  ")}`
    );
  return lines.join("\n") || "(rules-core未編集)";
}

function firstHeading(source) {
  return /^#\s+(.+)$/m.exec(source)?.[1]?.trim() ?? "(title unknown)";
}

function extractSectionParagraph(source, headingPattern) {
  const match = headingPattern.exec(source);
  if (!match) return null;
  const start = match.index + match[0].length;
  const rest = source.slice(start);
  const end = rest.search(/\n##\s+/);
  return (end >= 0 ? rest.slice(0, end) : rest).trim().replace(/\s+/g, " ");
}

function issueSummary(file) {
  const path = join(ROOT, file);
  if (!existsSync(path)) return null;
  const source = readFileSync(path, "utf8");
  const p3105 =
    extractSectionParagraph(source, /^##\s+P3-105後判定[^\n]*$/m) ||
    extractSectionParagraph(source, /^##\s+進捗[^\n]*$/m) ||
    extractSectionParagraph(
      source,
      /^##\s+Target と Affect の切り分け[^\n]*$/m
    );
  return {
    file,
    title: firstHeading(source),
    note: p3105 ? p3105.slice(0, 700) : "(P3-105後判定なし)",
  };
}

function renderRelatedIssues(files, primitives) {
  const touchesRulesCore =
    primitives.dslTypesTouched ||
    primitives.modelTsKindsAdded.length > 0 ||
    primitives.interpreterFilesTouched.length > 0 ||
    primitives.registrationFilesTouched.length > 0 ||
    primitives.otherRulesCoreFiles.length > 0;
  const text = files.join("\n");
  const likelyTargetAffect =
    touchesRulesCore &&
    /target|affect|resistance|legal-actions|interpreter|trigger|pending|leave|core|negate|suppress|redirect/i.test(
      text
    );
  if (!touchesRulesCore && !likelyTargetAffect) {
    return "(rules-core未編集のため関連 issue 自動注入なし)";
  }

  const issueFiles = [
    "issues/P3-105_effect-target-affect-gate.md",
    "issues/archive/P3-76/index.md",
    "issues/P3-97_after-triggers-stay-flush-gap.md",
    "issues/P3-75_generic-negate-primitive.md",
    "issues/P3-100_star-garment-undercard-subsystem.md",
    "issues/P3-103_flash-timing-vs-flash-effect-category.md",
    "issues/archive/P3-104/index.md",
  ];
  const summaries = issueFiles.map(issueSummary).filter(Boolean);
  return summaries
    .map((issue) => `- ${issue.file}: ${issue.title}\n  note: ${issue.note}`)
    .join("\n");
}

async function main() {
  // Attempt both independent invalidations, even when one I/O operation fails.
  // A pending context rejects an old result; result removal plus retained local
  // artifacts rejects commit-audit fallback. If both writes are denied, callers
  // must stop on this nonzero exit; no persistent write can be guaranteed.
  const contextPath = rootPath(CONTEXT_OUT);
  const evidencePath = rootPath(EVIDENCE_OUT);
  const invalidationErrors = [];
  try {
    writeFileSync(
      contextPath,
      `${JSON.stringify({ schemaVersion: 1, pending: true, generatedAt: new Date().toISOString() })}\n`,
      "utf8"
    );
  } catch (error) {
    invalidationErrors.push(error);
  }
  try {
    rmSync(evidencePath, { force: true });
  } catch (error) {
    invalidationErrors.push(error);
  }
  if (invalidationErrors.length)
    throw new AggregateError(
      invalidationErrors,
      "Verifier start failed; do not integrate: " +
        invalidationErrors.map((error) => error.message).join("; ")
    );
  if (!existsSync(PROMPT_DOC)) fail(`prompt docが見つからない: ${PROMPT_DOC}`);
  if (!Number.isFinite(MAX_DIFF_LINES) || MAX_DIFF_LINES < 1)
    fail("--max-diff-lines は1以上の整数必須");
  if (OUT) {
    const promptPath = rootPath(OUT);
    if (existsSync(promptPath)) rmSync(promptPath, { force: true });
  }

  const tree = buildVerificationTree(ROOT, BASE);
  if (
    process.env.ORICA_WORK_RECOVERY_CONTEXT &&
    JSON.parse(process.env.ORICA_WORK_RECOVERY_CONTEXT).workdir ===
      resolve(ROOT)
  ) {
    const { checkpointWorkerBoundary } =
      await import("./supervisor-work-recovery.mjs");
    checkpointWorkerBoundary(ROOT, "candidate-frozen", tree.headTree);
  }
  const files = changedFilesBetweenTrees(ROOT, tree.baseTree, tree.headTree);
  // Keep every change and binary payload in an applyable patch. Trailing bytes
  // are preserved by diffBetweenTrees; whole-file context is not needed for
  // completeness and can swamp the review with unchanged registry/source rows.
  // Pin both context options so local Git config cannot expand the artifact.
  const fullDiff = diffBetweenTrees(ROOT, tree.baseTree, tree.headTree, [
    "--binary",
    "--unified=3",
    "--inter-hunk-context=0",
  ]);
  const stat = diffBetweenTrees(ROOT, tree.baseTree, tree.headTree, ["--stat"]);
  const diffLines = fullDiff.split(/\r?\n/);

  if (tree.baseTree === tree.headTree && !ALLOW_EMPTY) {
    console.error(
      `[spawn-verifier] 差分なし (base=${BASE})。証跡は生成しない。`
    );
    if (JSON_ONLY)
      process.stdout.write(
        `${JSON.stringify({ empty: true, ...tree }, null, 2)}\n`
      );
    return;
  }

  const fullDiffPath = join(
    ROOT,
    "logs",
    "verifier-input",
    `${tree.headTree}.patch`
  );
  mkdirSync(dirname(fullDiffPath), { recursive: true });
  writeFileSync(fullDiffPath, fullDiff, "utf8");
  const changedCardNos = changedCardNosFromDiff({
    root: ROOT,
    files,
    fullDiff: diffBetweenTrees(ROOT, tree.baseTree, tree.headTree, [
      "--unified=0",
    ]),
  });
  const context = {
    schemaVersion: 1,
    base: BASE,
    baseCommit: tree.baseCommit,
    mergeBase: tree.mergeBase,
    baseTree: tree.baseTree,
    headTree: tree.headTree,
    generatedAt: new Date().toISOString(),
    changedFiles: files,
    changedCardNos,
    fullDiffPath,
  };
  writeFileSync(contextPath, `${JSON.stringify(context, null, 2)}\n`, "utf8");

  const changedCards = buildImpactedCards(files, changedCardNos);
  const primitives = buildPrimitivesTouched(files, tree);
  const boundedDiff = renderBoundedDiff(diffLines, MAX_DIFF_LINES);
  const fuzzEvidence = candidateFuzzSummary(ROOT, tree);
  const diffSummary = [
    `検証対象tree: ${tree.headTree}`,
    `必読の完全差分: ${fullDiffPath}。要約に省略があれば完全差分を読み、coverage.fullDiffReadで確認する。`,
    `全変更hunk・metadata・binaryを含む周辺3行の差分。関連実装・caller・原文は固定tree ${tree.headTree} / ${tree.baseTree} から追加確認し、未確認はunverifiedに残す。`,
    `追加読取りのGit root: ${ROOT}。git show <上記tree>:<変更fileまたは関連path> で固定入力を確認する。`,
    `coverage.files に記録する全変更ファイル: ${JSON.stringify(files)}`,
    fuzzEvidence,
    `--- synthetic diff --stat ${BASE}...HEAD + staged + unstaged + untracked ---`,
    stat ||
      "(no changes; review the history-only integration, ancestry and gate evidence)",
    "",
    `--- synthetic diff (${boundedDiff.label}) ---`,
    boundedDiff.body,
  ].join("\n");
  const template = extractPromptBody(readFileSync(PROMPT_DOC, "utf8"));
  const sections = {
    "<DIFF_SUMMARY>": diffSummary,
    "<CHANGED_CARDS>": renderCards(changedCards),
    "<PRIMITIVES_TOUCHED>": renderPrimitives(primitives),
    "<RELATED_ISSUES>": renderRelatedIssues(files, primitives),
  };
  // One callback pass preserves dollar sequences and template-looking source.
  const prompt = template.replace(
    /<DIFF_SUMMARY>|<CHANGED_CARDS>|<PRIMITIVES_TOUCHED>|<RELATED_ISSUES>/g,
    (placeholder) => sections[placeholder]
  );

  if (JSON_ONLY) {
    process.stdout.write(
      `${JSON.stringify({ ...context, promptDoc: relative(ROOT, PROMPT_DOC).replaceAll("\\", "/"), changedFiles: files, prompt }, null, 2)}\n`
    );
  } else if (OUT) {
    writeFileSync(rootPath(OUT), `${prompt}\n`, "utf8");
    console.error(
      `[spawn-verifier] prompt=${OUT}, context=${CONTEXT_OUT}, headTree=${tree.headTree}`
    );
  } else process.stdout.write(`${prompt}\n`);
}

try {
  const { runVerifierWriter } = await import("./verifier-write-lock.mjs");
  process.exitCode = await runVerifierWriter(import.meta.url, main);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
