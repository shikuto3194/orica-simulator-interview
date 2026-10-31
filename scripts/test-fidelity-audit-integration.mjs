#!/usr/bin/env node
/** Exercise the real audit CLI and snapshot consumer without catalog builds/writes. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const effect = (action) => ({
  timing: { kind: "on_summon" },
  textRef: [0],
  steps: [{ action }],
});
const card = (cardNo, action, text = "■相手のスピリットを破壊する。") => ({
  cardNo,
  textLines: [text],
  effects: [effect(action)],
});
const validAction = {
  kind: "destroy",
  target: {
    kind: "filter",
    owner: "opponent",
    zone: "field",
    filter: { minCost: 2, maxCost: 5 },
  },
};
const invalidAction = {
  ...validAction,
  target: { ...validAction.target, filter: { minCost: 8, maxCost: 5 } },
};
let passed = 0;
function test(name, run) {
  run();
  console.log(`ok ${++passed} - ${name}`);
}
function cli(cards, args = ["--json", "--gate"]) {
  const result = spawnSync(
    process.execPath,
    ["scripts/cards-fidelity-audit.mjs", ...args],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        ORICA_CARDS_FIDELITY_AUDIT_FIXTURE_JSON: JSON.stringify(cards),
        ORICA_CARDS_FIDELITY_AUDIT_NO_WRITE: "1",
      },
    }
  );
  assert.equal(result.error, undefined);
  assert.equal(result.stderr, "");
  return result;
}

test("normal oracle missing/empty/unprinted events fail the real fidelity CLI gate", () => {
  const source = {
    cardNo: "AUDIT01-X01",
    effects: [],
    textLines: [
      "【導託：〔想獣〕】",
      "◆対象の自分のスピリットを召喚/煌臨したとき、ボイドからコア1個をこのネクサスに置ける。",
    ],
    grandwalkerData: {
      kind: "guided",
      oracleConditions: [{ tribes: ["想獣"], categories: ["spirit"] }],
    },
  };
  for (const value of [undefined, [], ["summon", "advent", "use_accel"]]) {
    const result = cli([
      {
        ...source,
        grandwalkerData: {
          ...source.grandwalkerData,
          oracleTriggerKinds: value,
        },
      },
    ]);
    assert.equal(result.status, 1);
    const issue = JSON.parse(result.stdout).violations.find((v) =>
      v.kind.startsWith("oracle_trigger_kinds_")
    );
    assert.equal(issue.cardNo, source.cardNo);
    assert.deepEqual(issue.textRef, [0, 1]);
    assert.equal(issue.effectPath, "grandwalkerData.oracleTriggerKinds");
  }
  const result = cli([
    {
      ...source,
      grandwalkerData: {
        ...source.grandwalkerData,
        oracleTriggerKinds: ["summon", "advent"],
      },
    },
  ]);
  assert.equal(result.status, 0);
});

test("a new constraint violation reaches the strict gate with exact source provenance", () => {
  const result = cli([card("AUDIT01-C01", invalidAction)]);
  assert.equal(result.status, 1);
  assert.ok([...result.stdout].every((char) => char.charCodeAt(0) <= 0x7f));
  const report = JSON.parse(result.stdout);
  const issue = report.violations.find(
    (v) => v.kind === "constraint_empty_range"
  );
  assert.equal(issue.cardNo, "AUDIT01-C01");
  assert.equal(issue.path, "effects[0].steps[0].action.target.filter");
  assert.equal(issue.effectPath, "effects[0]");
  assert.deepEqual(issue.textRef, [0]);
  assert.match(issue.evidence, /8/);
  assert.equal(report.totals.semanticConstraints, 1);
  assert.equal(report.clean, false);
  assert.equal(report.sets[0].semantic, 1);
});

test("valid bounds do not fail and fixing only the violated bound clears the finding", () => {
  const result = cli([card("AUDIT01-C01", validAction)]);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).violations.length, 0);
});

test("別 textRef の自己効果コスト条件変更を先行 target + delta で認識する", () => {
  const makeCard = (addLimitAmount) => ({
    cardNo: "AUDIT01-COST-MOD",
    textLines: [
      "本来のコスト7以下の相手のスピリット2体を指定する。",
      "自分のカウント3以上のとき、このブレイヴの効果の条件を「本来のコスト9以下」に変更する。",
    ],
    effects: [
      {
        ...effect({
          kind: "prevent_battle",
          target: {
            kind: "filter",
            player: "opponent",
            filter: {
              category: ["spirit"],
              maxCost: 7,
              costBasis: "printed",
            },
            count: 2,
          },
          restriction: ["block"],
          duration: { scope: "turn" },
        }),
        textRef: [0],
      },
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "count_value", player: "self", min: 3 }],
        textRef: [1],
        steps: [
          {
            action: {
              kind: "effect_param_modify",
              effectClass: "cost_prevent_battle",
              scope: "self",
              addLimitAmount,
              duration: { scope: "while_on_field" },
            },
          },
        ],
      },
    ],
  });

  const correct = JSON.parse(cli([makeCard(2)]).stdout);
  assert.equal(
    correct.semanticReviews.some(
      (finding) => finding.kind === "target_cost_scope_review"
    ),
    false
  );

  const broken = JSON.parse(cli([makeCard(1)]).stdout);
  assert.ok(
    broken.semanticReviews.some(
      (finding) => finding.kind === "target_cost_scope_review"
    )
  );
});

test("同一原文行に分離した自己耐性と無償通常配置を一つの支払いcarrierとして認識する", () => {
  const text =
    "手札/手元/トラッシュにあるこのカードは、このカード以外の自分の効果を受けず、自分のメインステップにコア8個以上の自分の導界者ネクサスの「キーア」1つを破壊することで、コストを支払わずに配置できる。";
  const normalPlacement = (costModifier) => ({
    timing: { kind: "continuous" },
    timingScope: { player: "self", period: "main" },
    applicability: { zone: ["hand", "set_aside", "trash"] },
    textRef: [0],
    steps: [
      {
        action: {
          kind: "summon",
          normalActionPermission: true,
          target: { kind: "self", zone: ["hand", "set_aside", "trash"] },
          ...(costModifier === undefined ? {} : { costModifier }),
          normalActionDeclarationSteps: [
            {
              id: "destroy-keya",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: { category: ["nexus"], minCores: 8 },
                  count: 1,
                },
              },
            },
          ],
        },
      },
    ],
  });
  const immunity = {
    timing: { kind: "continuous" },
    applicability: { zone: ["hand", "set_aside", "trash"] },
    textRef: [0],
    steps: [
      {
        action: {
          kind: "effect_immunity",
          target: { kind: "self" },
          duration: { scope: "permanent" },
        },
      },
    ],
  };
  const makeCard = (costModifier) => ({
    cardNo: "AUDIT01-X02",
    textLines: [text],
    effects: [immunity, normalPlacement(costModifier)],
  });

  const correct = JSON.parse(cli([makeCard("free")]).stdout);
  assert.equal(
    correct.semanticReviews.some(
      (finding) => finding.kind === "payment_scope_review"
    ),
    false
  );

  const brokenResult = cli([makeCard(undefined)]);
  assert.equal(brokenResult.status, 0);
  const broken = JSON.parse(brokenResult.stdout);
  assert.ok(
    broken.semanticReviews.some((finding) =>
      ["payment_scope_review", "payment_constraint_mismatch"].includes(
        finding.kind
      )
    )
  );
});

test("同一原文行の継続マジック無料化 cost_modify を支払い carrier として認識する", () => {
  const text =
    "Lv1-Lv2-Lv3 回復状態のこのスピリットは、相手の効果を受けない。自分は、系統：「紅魔」/「導魔」を持つマジックカードをコストを支払わずに使用できる。";
  const makeCard = (modifier) => ({
    cardNo: "AUDIT01-M01",
    textLines: [text],
    effects: [
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "self_state", state: "recovered" }],
        textRef: [0],
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "permanent" },
            },
          },
        ],
      },
      {
        timing: { kind: "continuous" },
        textRef: [0],
        steps: [
          {
            action: {
              kind: "cost_modify",
              player: "self",
              cardFilter: {
                category: ["magic"],
                tribes: ["紅魔", "導魔"],
              },
              ...(modifier === undefined ? {} : { modifier }),
              duration: { scope: "permanent" },
            },
          },
        ],
      },
    ],
  });

  const correct = JSON.parse(cli([makeCard("free")]).stdout);
  assert.equal(
    correct.semanticReviews.some(
      (finding) =>
        finding.cardNo === "AUDIT01-M01" &&
        ["payment_scope_review", "payment_constraint_mismatch"].includes(
          finding.kind
        )
    ),
    false
  );

  const broken = JSON.parse(cli([makeCard(undefined)]).stdout);
  assert.ok(
    broken.semanticReviews.some(
      (finding) =>
        finding.cardNo === "AUDIT01-M01" &&
        ["payment_scope_review", "payment_constraint_mismatch"].includes(
          finding.kind
        )
    )
  );

  const restrictedCases = [
    [
      "target が player 経路を遮る",
      (card) => {
        card.effects[1].steps[0].action.target = { kind: "self" };
      },
    ],
    [
      "effect の条件",
      (card) => {
        card.effects[1].condition = [
          { kind: "count_value", player: "self", min: 3 },
        ];
      },
    ],
    [
      "発揮時期",
      (card) => {
        card.effects[1].timingScope = { player: "self", period: "attack" };
      },
    ],
    [
      "発揮元ゾーン",
      (card) => {
        card.effects[1].applicability = { zone: "hand" };
      },
    ],
    [
      "step の条件",
      (card) => {
        card.effects[1].steps[0].condition = [
          { kind: "count_value", player: "self", min: 3 },
        ];
      },
    ],
    [
      "選択枝の無料化",
      (card) => {
        const action = card.effects[1].steps[0].action;
        card.effects[1].steps[0] = {
          action: { kind: "draw", player: "self", count: 1 },
          choice: [{ label: "無料化", action }],
        };
      },
    ],
    [
      "遅延する step",
      (card) => {
        card.effects[1].steps[0].deferTo = "battle_end";
      },
    ],
    [
      "対象色による過剰な絞り込み",
      (card) => {
        card.effects[1].steps[0].action.cardFilter.colors = ["red"];
      },
    ],
    [
      "filterOr による対象拡大",
      (card) => {
        card.effects[1].steps[0].action.cardFilter.filterOr = [{}];
      },
    ],
    [
      "系統不一致",
      (card) => {
        card.effects[1].steps[0].action.cardFilter.tribes = ["紅魔"];
      },
    ],
    [
      "有効期間",
      (card) => {
        card.effects[1].steps[0].action.duration = { scope: "turn" };
      },
    ],
    [
      "本文の色指定",
      (card) => {
        card.textLines[0] = text.replace(
          "マジックカード",
          "赤のマジックカード"
        );
      },
    ],
    [
      "本文の主体",
      (card) => {
        card.textLines[0] = text.replace("自分は、", "相手は、");
      },
    ],
    [
      "本文の条件節",
      (card) => {
        card.textLines[0] = text.replace(
          "自分は、",
          "自分のカウントが3以上のとき、自分は、"
        );
      },
    ],
    [
      "別の textRef",
      (card) => {
        card.textLines.push("別の効果。");
        card.effects[1].textRef = [1];
      },
    ],
    [
      "複数の sibling 候補",
      (card) => {
        card.effects.push(makeCard("free").effects[1]);
      },
    ],
  ];
  for (const [label, mutate] of restrictedCases) {
    const restricted = makeCard("free");
    mutate(restricted);
    const result = cli([restricted]);
    assert.equal(result.status, 0, label);
    const audit = JSON.parse(result.stdout);
    assert.ok(
      audit.semanticReviews.some(
        (finding) =>
          finding.cardNo === "AUDIT01-M01" &&
          ["payment_scope_review", "payment_constraint_mismatch"].includes(
            finding.kind
          )
      ),
      label
    );
  }
});

test("back faces and mechanic containers retain their own paths and card numbers", () => {
  const front = card("AUDIT01-C02", validAction);
  front.backFace = card("AUDIT01-C02(B)", invalidAction);
  front.mirageData = { effects: [effect(invalidAction)] };
  front.grandwalkerData = {
    divineSkills: [{ effects: [effect(invalidAction)] }],
  };
  const report = JSON.parse(cli([front]).stdout);
  const issues = report.violations.filter(
    (v) => v.kind === "constraint_empty_range"
  );
  assert.equal(issues.length, 3);
  assert.ok(
    issues.some(
      (v) => v.cardNo === "AUDIT01-C02(B)" && v.effectPath === "effects[0]"
    )
  );
  assert.ok(issues.some((v) => v.effectPath === "mirageData.effects[0]"));
  assert.ok(
    issues.some(
      (v) => v.effectPath === "grandwalkerData.divineSkills[0].effects[0]"
    )
  );
});

test("DivineSkillEntry.turnLimit is the shared carrier for its nested effect's once-per-name text", () => {
  const divineSkillCard = (
    turnLimit,
    withChoice = false,
    costInsideLimitBracket = false
  ) => ({
    cardNo: "AUDIT01-X01",
    textLines: [
      "【導技：2】フラッシュ『お互いのアタックステップ』",
      costInsideLimitBracket
        ? "〔ターンに1回：同名、このネクサスのコア2個をボイドに置く〕1枚ドローする。"
        : "〔ターンに1回：同名〕1枚ドローする。",
    ],
    effects: [],
    grandwalkerData: {
      divineSkills: [
        {
          label: "guided_skill",
          coreCost: 2,
          timing: { step: "attack", whose: "both" },
          turnLimit,
          effects: [
            {
              ...effect({ kind: "draw", count: 1 }),
              ...(withChoice
                ? {
                    steps: [
                      {
                        action: { kind: "draw", count: 1 },
                        choice: [
                          {
                            action: {
                              kind: "core_move",
                              from: { kind: "void", player: "self" },
                              to: { kind: "reserve", player: "self" },
                              amount: 1,
                            },
                          },
                        ],
                      },
                    ],
                  }
                : {}),
              textRef: [1],
            },
          ],
        },
      ],
    },
  });

  const correct = JSON.parse(cli([divineSkillCard("once_per_name")]).stdout);
  assert.equal(correct.semanticReviewCount, 0, "correct carrier review count");
  assert.equal(correct.violations.length, 0);

  const correctWithChoice = JSON.parse(
    cli([divineSkillCard("once_per_name", true)]).stdout
  );
  assert.equal(
    correctWithChoice.semanticReviewCount,
    0,
    "choice branch remains inside the shared DivineSkillEntry.turnLimit scope"
  );
  assert.equal(correctWithChoice.violations.length, 0);

  const correctWithChoiceAndCost = JSON.parse(
    cli([divineSkillCard("once", true, true)]).stdout
  );
  assert.equal(
    correctWithChoiceAndCost.semanticReviews.filter((finding) =>
      finding.kind.startsWith("usage_")
    ).length,
    0,
    "a declaration-cost bracket before the once-per-instance clause does not obscure the shared carrier"
  );
  assert.equal(correctWithChoiceAndCost.violations.length, 0);

  const broken = cli([divineSkillCard("once")]);
  assert.equal(broken.status, 1);
  const issue = JSON.parse(broken.stdout).violations.find(
    (finding) => finding.kind === "usage_constraint_mismatch"
  );
  assert.equal(issue.effectPath, "grandwalkerData.divineSkills[0].effects[0]");
  assert.match(issue.evidence, /per_instance/);
});

test("divine skill usageLimit owns step restrictions without borrowing other skills", () => {
  const face = {
    cardNo: "AUDIT01-X01",
    textLines: ["〔ステップに1回〕1枚ドローする。"],
    effects: [],
    grandwalkerData: {
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 3,
          timing: "flash",
          usageLimit: { kind: "per_instance", duration: "step" },
          effects: [effect({ kind: "draw", count: 1 })],
        },
      ],
    },
  };
  const findings = (card) => {
    const result = JSON.parse(cli([card]).stdout);
    return [...result.violations, ...result.semanticReviews].filter((finding) =>
      finding.kind.startsWith("usage_")
    );
  };
  assert.deepEqual(findings(face), []);
  for (const usageLimit of [
    undefined,
    { kind: "per_card_name", duration: "step" },
    { kind: "per_instance", duration: "turn" },
    { kind: "per_instance", duration: "step", maxCount: 2 },
  ]) {
    const broken = JSON.parse(JSON.stringify(face));
    broken.grandwalkerData.divineSkills[0].usageLimit = usageLimit;
    assert.ok(
      findings(broken).some(
        (finding) => finding.kind === "usage_constraint_mismatch"
      )
    );
  }
  const otherSkill = JSON.parse(JSON.stringify(face));
  delete otherSkill.grandwalkerData.divineSkills[0].usageLimit;
  otherSkill.grandwalkerData.divineSkills.push({
    ...face.grandwalkerData.divineSkills[0],
    effects: [],
  });
  assert.ok(
    findings(otherSkill).some(
      (finding) => finding.kind === "usage_constraint_mismatch"
    )
  );

  for (const extra of [
    {
      usageLimit: [
        { kind: "per_instance", duration: "step" },
        { kind: "per_instance", duration: "game" },
      ],
    },
    {
      usageLimit: [
        { kind: "per_instance", duration: "step" },
        { kind: "per_card_name", duration: "game" },
      ],
    },
    { turnLimit: "once" },
    { turnLimit: "once_per_name" },
  ]) {
    const broken = JSON.parse(JSON.stringify(face));
    Object.assign(broken.grandwalkerData.divineSkills[0], extra);
    assert.ok(
      findings(broken).some(
        (finding) => finding.kind === "usage_extra_constraint_review"
      )
    );
    broken.textLines = ["1枚ドローする。"];
    assert.ok(
      findings(broken).some(
        (finding) => finding.kind === "usage_extra_constraint_review"
      )
    );
  }

  const combined = JSON.parse(JSON.stringify(face));
  combined.textLines = ["〔ターンに1回:同名〕〔ステップに1回〕1枚ドローする。"];
  combined.grandwalkerData.divineSkills[0].turnLimit = "once_per_name";
  assert.deepEqual(findings(combined), []);
  delete combined.grandwalkerData.divineSkills[0].usageLimit;
  assert.ok(
    findings(combined).some(
      (finding) => finding.kind === "usage_constraint_mismatch"
    )
  );
});

test("nested effects retain their own textRef and owning effect path", () => {
  const text = "相手の手札を3枚破棄するか、3枚になるように破棄する。";
  const nested = {
    ...effect({ kind: "discard", targetHandSize: 3, capCount: 3 }),
    textRef: [1],
  };
  const face = card(
    "AUDIT01-C04",
    { kind: "grant_effect", grantedEffect: nested },
    "■このスピリットに効果を与える。"
  );
  face.textLines.push(text);
  const report = JSON.parse(cli([face]).stdout);
  const issue = report.violations.find(
    (v) => v.kind === "flow_discard_alternative_collapsed"
  );
  assert.equal(issue.effectPath, "effects[0].steps[0].action.grantedEffect");
  assert.equal(
    issue.path,
    "effects[0].steps[0].action.grantedEffect.steps[0].action"
  );
  assert.deepEqual(issue.textRef, [1]);
  assert.match(issue.evidence, /3枚破棄するか/);
});

test("a collapsed discard alternative is a flow violation, a partial expression is review only", () => {
  const text = "■相手の手札を3枚破棄するか、3枚になるように破棄する。";
  const clipped = cli([
    card(
      "AUDIT01-C03",
      { kind: "discard", targetHandSize: 3, capCount: 3 },
      text
    ),
  ]);
  assert.equal(clipped.status, 1);
  assert.equal(JSON.parse(clipped.stdout).totals.semanticFlow, 1);
  const partial = cli([
    card("AUDIT01-C03", { kind: "discard", targetHandSize: 3 }, text),
  ]);
  assert.equal(partial.status, 0);
  const report = JSON.parse(partial.stdout);
  assert.equal(report.clean, true);
  assert.equal(report.reviewRequired, true);
  assert.equal(report.semanticReviewCount, 1);
  assert.equal(
    report.semanticReviews[0].kind,
    "flow_discard_alternative_collapsed"
  );
  assert.match(report.semanticReviews[0].evidence, /3枚破棄するか/);
});

test("set-scoped gate ignores other sets in text and machine output", () => {
  const cards = [
    card("AUDIT01-C01", invalidAction),
    card("AUDIT02-C01", validAction),
  ];
  for (const format of [[], ["--json"]]) {
    assert.equal(
      cli(cards, [...format, "--gate", "--set", "AUDIT02"]).status,
      0
    );
    assert.equal(
      cli(cards, [...format, "--gate", "--set", "AUDIT01"]).status,
      1
    );
  }
  // --json remains the full report; --set scopes only the gate exit code.
  const scoped = JSON.parse(
    cli(cards, ["--json", "--gate", "--set", "AUDIT02"]).stdout
  );
  assert.equal(scoped.clean, false);
  assert.equal(scoped.violations[0].cardNo, "AUDIT01-C01");
});

test("snapshot counts all violation kinds rather than four legacy counters and fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "orica-fidelity-snapshot-"));
  try {
    mkdirSync(join(dir, "scripts"));
    copyFileSync(
      join(root, "scripts/update-snapshot.mjs"),
      join(dir, "scripts/update-snapshot.mjs")
    );
    const report = JSON.parse(cli([card("AUDIT01-C01", invalidAction)]).stdout);
    writeFileSync(join(dir, "fidelity-audit.json"), JSON.stringify(report));
    const baseline = JSON.stringify({
      current: { total: 0 },
      low: { total: 0, date: "2026-09-12" },
      history: [],
    });
    writeFileSync(join(dir, "fidelity-baseline.json"), baseline);
    const run = () =>
      spawnSync(
        process.execPath,
        ["scripts/update-snapshot.mjs", "--check", "--date", "2026-09-13"],
        { cwd: dir, encoding: "utf8" }
      );
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /total 1/);
    assert.equal(
      readFileSync(join(dir, "fidelity-baseline.json"), "utf8"),
      baseline
    );
    delete report.violations;
    writeFileSync(join(dir, "fidelity-audit.json"), JSON.stringify(report));
    const malformed = run();
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.stderr, /violations/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("snapshot rewrites the legacy inline scan probe form instead of failing closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "orica-fidelity-snapshot-inline-"));
  try {
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "manual/ai-reference/30_plan"), { recursive: true });
    copyFileSync(
      join(root, "scripts/update-snapshot.mjs"),
      join(dir, "scripts/update-snapshot.mjs")
    );
    const report = JSON.parse(cli([card("AUDIT01-C01", validAction)]).stdout);
    writeFileSync(join(dir, "fidelity-audit.json"), JSON.stringify(report));
    writeFileSync(
      join(dir, "card-coverage.json"),
      JSON.stringify({
        totals: { todo: 0 },
        auditViolationCount: 0,
        auditReviewCount: 7,
      })
    );
    writeFileSync(
      join(dir, "fidelity-baseline.json"),
      JSON.stringify({
        current: { total: 0 },
        low: { total: 0, date: "2026-09-12" },
        history: [],
      })
    );
    writeFileSync(
      join(dir, "manual/ai-reference/30_plan/02_detailed-todo.md"),
      "## Current Snapshot\n\n- engine-drain 直近着地 (2026-09-23, main統合済): new landing / previous landing. fresh audit: coverage todo 9 / violation 7 / review 8、fidelity violation 6 / review 5（active review 13）。context stale records need revalidation\n\n- 残量 (2026-09-23): coverage todo 0 / fidelity stub 0 / needs-dsl open 0 / needs-ruling open 0 / `scan:ssot-candidates --gate` 0 probe (green)。legacy note\n"
    );
    const result = spawnSync(
      process.execPath,
      [
        "scripts/update-snapshot.mjs",
        "--date",
        "2026-09-24",
        "--landing",
        "new landing",
      ],
      { cwd: dir, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      readFileSync(
        join(dir, "manual/ai-reference/30_plan/02_detailed-todo.md"),
        "utf8"
      ),
      /- 残量 \(2026-09-24\): coverage todo 0 \/ fidelity stub 0 \/ needs-dsl open 0 \/ needs-ruling open 0 \/\n {2}`scan:ssot-candidates --gate` 0 probe \(green\)。legacy note/
    );
    const todo = readFileSync(
      join(dir, "manual/ai-reference/30_plan/02_detailed-todo.md"),
      "utf8"
    );
    assert.match(
      todo,
      /engine-drain 直近着地候補 \(2026-09-24, 検証・main統合待ち\): new landing。fresh audit: coverage todo 0 \/ violation 0 \/ review 7、fidelity violation 0 \/ review 0（active review 7）。 \/ previous landing\. context stale records need revalidation/
    );
    assert.doesNotMatch(todo, /main統合済/);
    assert.doesNotMatch(todo, /coverage todo 9 \/ violation 7 \/ review 8/);
    assert.doesNotMatch(todo, /review 8、fidelity violation 6/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("snapshot preserves historical measurements when an unchanged total is remeasured", () => {
  const dir = mkdtempSync(join(tmpdir(), "orica-fidelity-snapshot-history-"));
  try {
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "manual/ai-reference/30_plan"), { recursive: true });
    copyFileSync(
      join(root, "scripts/update-snapshot.mjs"),
      join(dir, "scripts/update-snapshot.mjs")
    );
    const report = JSON.parse(cli([card("AUDIT01-C01", validAction)]).stdout);
    writeFileSync(join(dir, "fidelity-audit.json"), JSON.stringify(report));
    writeFileSync(
      join(dir, "card-coverage.json"),
      JSON.stringify({
        totals: { todo: 0 },
        auditViolationCount: 0,
        auditReviewCount: 0,
      })
    );
    const first = {
      date: "2026-08-01",
      total: 18,
      stub: 18,
      uncovered: 0,
      delta: -1,
    };
    const history = [
      first,
      ...Array.from({ length: 79 }, (_, index) => ({
        date: `2026-08-${String(index + 2).padStart(2, "0")}`,
        total: 0,
        stub: 0,
        uncovered: 0,
        delta: 0,
      })),
    ];
    writeFileSync(
      join(dir, "fidelity-baseline.json"),
      JSON.stringify({
        current: { total: 0 },
        low: { total: 0, date: "2026-09-24" },
        history,
      })
    );
    writeFileSync(
      join(dir, "manual/ai-reference/30_plan/02_detailed-todo.md"),
      "## Current Snapshot\n\n- 残量 (2026-09-24): coverage todo 0 / fidelity stub 0 / needs-dsl open 0 / needs-ruling open 0 / `scan:ssot-candidates --gate` 0 probe (green)\n"
    );
    const result = spawnSync(
      process.execPath,
      ["scripts/update-snapshot.mjs", "--date", "2026-09-25"],
      { cwd: dir, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    const updated = JSON.parse(
      readFileSync(join(dir, "fidelity-baseline.json"), "utf8")
    );
    assert.equal(updated.history.length, 80);
    assert.deepEqual(updated.history[0], first);
    assert.equal(
      updated.history.some((entry) => entry.date === "2026-09-25"),
      false
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
console.log(`[test-fidelity-audit-integration] ${passed} passed`);
