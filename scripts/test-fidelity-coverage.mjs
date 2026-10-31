#!/usr/bin/env node
/** Coverage gate contracts: legacy conversion counts + source-traceable audit findings. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCoverageReport,
  collectCoverageFindings,
} from "./cards-coverage.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const effect = (overrides = {}) => ({
  timing: { kind: "on_summon" },
  textRef: [0],
  steps: [{ action: { kind: "draw", count: 1 } }],
  ...overrides,
});
const card = (overrides = {}) => ({
  cardNo: "TEST01-C01",
  textLines: ["■自分はデッキから1枚ドローする。"],
  effects: [effect()],
  ...overrides,
});
let passed = 0;
function test(name, run) {
  run();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}
const kinds = (cards) =>
  collectCoverageFindings(cards).map((issue) => issue.kind);

test("normal oracle metadata is nonempty and exactly its printed events, independent of other effects", () => {
  const source = card({
    textLines: [
      "【導託：〔想獣＆コスト3以上〕】",
      "◆対象の自分のスピリットを召喚/煌臨したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、デッキの上から3枚をトラッシュに置ける。",
      "【導技：3】アクセルを持つカードを手札に戻す。",
    ],
    effects: [],
    grandwalkerData: {
      kind: "guided",
      oracleConditions: [
        { tribes: ["想獣"], categories: ["spirit"], minCost: 3 },
      ],
      oracleTriggerKinds: ["summon", "advent"],
    },
  });
  const oracleIssues = (value) =>
    collectCoverageFindings([value]).filter((issue) =>
      issue.kind.startsWith("oracle_trigger_")
    );
  assert.deepEqual(oracleIssues(source), []);
  for (const value of [undefined, null, [], "summon"])
    assert.equal(
      oracleIssues({
        ...source,
        grandwalkerData: {
          ...source.grandwalkerData,
          oracleTriggerKinds: value,
        },
      })[0].kind,
      "oracle_trigger_kinds_missing"
    );
  for (const value of [
    ["summon"],
    ["summon", "advent", "place"],
    ["summon", "advent", "use_accel"],
    ["summon", "advent", "summon"],
    ["summon", "invented"],
  ]) {
    const issue = oracleIssues({
      ...source,
      grandwalkerData: { ...source.grandwalkerData, oracleTriggerKinds: value },
    })[0];
    assert.equal(issue.kind, "oracle_trigger_kinds_mismatch");
    assert.deepEqual(issue.textRef, [0, 1]);
    assert.equal(issue.effectPath, "grandwalkerData.oracleTriggerKinds");
    assert.equal(issue.severity, "violation");
  }
  const explicit = {
    ...source,
    textLines: [
      "【神託：〔ブレイヴ＆【アクセル】を持つ〕】",
      "◆対象の自分のスピリット/ブレイヴの召喚/煌臨/【アクセル】の使用をしたとき、ボイドからコア1個をこのネクサスに置ける。",
    ],
    grandwalkerData: {
      ...source.grandwalkerData,
      oracleTriggerKinds: ["summon", "advent", "use_accel"],
    },
  };
  assert.deepEqual(oracleIssues(explicit), []);
  assert.deepEqual(
    oracleIssues({
      ...source,
      grandwalkerData: {
        ...source.grandwalkerData,
        oracleTriggerKinds: ["advent", "summon"],
      },
    }),
    []
  );
  const back = {
    ...source,
    cardNo: "TEST01-C01(B)",
    grandwalkerData: { ...source.grandwalkerData, oracleTriggerKinds: [] },
  };
  assert.equal(oracleIssues(card({ backFace: back }))[0].cardNo, back.cardNo);
});
function cli(cards, args = []) {
  const result = spawnSync(
    process.execPath,
    ["scripts/cards-coverage.mjs", ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        ORICA_CARDS_COVERAGE_FIXTURE_JSON: JSON.stringify(cards),
        ORICA_CARDS_COVERAGE_NO_WRITE: "1",
      },
      encoding: "utf8",
    }
  );
  assert.equal(result.error, undefined);
  assert.equal(result.stderr, "");
  return result;
}

test("valid implementation remains done and complete", () => {
  const report = buildCoverageReport([card()]);
  assert.deepEqual(report.totals, {
    done: 1,
    todo: 0,
    vanilla: 0,
    total: 1,
    convertible: 1,
    donePct: 100,
  });
  assert.deepEqual(report.auditIssues, []);
  assert.equal(report.complete, true);
});

test("legacy conversion counts include both faces and mechanic effects", () => {
  const report = buildCoverageReport([
    card({
      effects: [],
      mirageData: { effects: [effect()] },
      backFace: card({ cardNo: "TEST01-C01(B)", effects: [] }),
    }),
    card({ cardNo: "TEST01-C02", textLines: ["バニラ"], effects: [] }),
    card({
      cardNo: "TEST01-C03",
      effects: [],
      grandwalkerData: { divineSkills: [{ effects: [effect()] }] },
    }),
  ]);
  assert.equal(report.totals.done, 2);
  assert.equal(report.totals.todo, 1);
  assert.equal(report.totals.vanilla, 1);
  assert.equal(report.totals.total, 4);
  assert.deepEqual(report.todoCards, ["TEST01-C01(B)"]);
});

test("explicit stub cannot make complete true even when legacy classification is done", () => {
  const report = buildCoverageReport([
    card({ effects: [effect({ stub: "本文未実装" })] }),
  ]);
  assert.equal(report.totals.done, 1);
  assert.equal(report.totals.todo, 0);
  assert.equal(report.auditViolationCount, 1);
  assert.equal(report.complete, false);
  assert.equal(report.auditIssues[0].evidence.stub, "本文未実装");
});

test("partial textRef does not hide the unreferenced full source line", () => {
  const issues = collectCoverageFindings([
    card({
      textLines: [
        "■『このスピリットの召喚時』",
        "自分はデッキから1枚ドローする。",
      ],
    }),
  ]);
  const issue = issues.find((item) => item.kind === "unaccounted_text_line");
  assert.equal(issue.cardNo, "TEST01-C01");
  assert.deepEqual(issue.textRef, [1]);
  assert.equal(issue.effectPath, "textLines[1]");
  assert.equal(issue.severity, "review");
  assert.equal(
    issue.evidence.sourceLines[0].text,
    "自分はデッキから1枚ドローする。"
  );
  assert.equal(issue.evidence.executionLike, true);
  assert.equal(issue.evidence.ledgerId, "TEST01-C01:textLines[1]");
});

test("unmarked continuation and vanilla text remain visible for review", () => {
  const report = buildCoverageReport([
    card({ textLines: ["このカードのコストは3としても扱う。"], effects: [] }),
  ]);
  assert.equal(report.totals.vanilla, 1);
  assert.equal(report.auditReviewCount, 1);
  assert.equal(report.complete, true);
});

test("empty steps used for top-level declaration bookkeeping stay review-only", () => {
  const report = buildCoverageReport([
    card({ maxCombinedBraves: 2, effects: [effect({ steps: [] })] }),
  ]);
  assert.equal(report.totals.done, 1);
  assert.equal(report.auditViolationCount, 0);
  assert.equal(report.complete, true);
  assert.ok(
    report.auditIssues.some((issue) => issue.kind === "empty_effect_steps")
  );
});

test("named maxCombinedBraves accounts for a declaration-only combine permission", () => {
  const definition = {
    textLines: [
      "Lv1-Lv2",
      "このスピリットは「テストA」2つまでと「テストB」1つと合体できる。",
    ],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 3000 },
      { level: 2, requiredCores: 3, bp: 5000 },
    ],
    maxCombinedBraves: {
      count: 3,
      effectIndex: 0,
      condition: { cardNameContains: ["テストA", "テストB"] },
      nameLimits: [
        { cardNameContains: "テストA", maxCount: 2 },
        { cardNameContains: "テストB", maxCount: 1 },
      ],
    },
    effects: [
      effect({
        timing: { kind: "continuous" },
        textRef: [0, 1],
        steps: [],
        applicability: { level: { min: 1, max: 2 } },
      }),
    ],
  };
  assert.deepEqual(collectCoverageFindings([card(definition)]), []);

  for (const maxCombinedBraves of [
    { ...definition.maxCombinedBraves, effectIndex: undefined },
    { ...definition.maxCombinedBraves, effectIndex: 1 },
    { ...definition.maxCombinedBraves, count: 2 },
    {
      ...definition.maxCombinedBraves,
      condition: { cardNameContains: ["テストA", "別名"] },
    },
    {
      ...definition.maxCombinedBraves,
      nameLimits: [{ cardNameContains: "テストA", maxCount: 2 }],
    },
  ]) {
    assert.ok(
      collectCoverageFindings([
        card({ ...definition, maxCombinedBraves }),
      ]).some((issue) => issue.kind === "empty_effect_steps"),
      "a wrong total, permitted name, or per-name limit must remain reviewable"
    );
  }
});

test("declaration-only carriers require the complete generic DSL contract", () => {
  const definitions = [
    {
      label: "soul-state contract combine",
      definition: {
        textLines: [
          "魂状態のこのカードには【契約合体】できる。このとき、このカードに自分のフィールド/リザーブのコアを好きなだけ置いてスピリット状態にする。",
        ],
        keywordTags: ["contract"],
        effects: [effect({ textRef: [0], steps: [] })],
      },
      broken: (definition) => ({ ...definition, keywordTags: [] }),
    },
    {
      label: "link aid",
      definition: {
        textLines: [
          "【リンクエイド】フラッシュ『お互いのアタックステップ』",
          "魂状態のこのカードは、系統：「GE」を持つ自分のスピリットから1コスト支払うことで、リザーブのコアを好きなだけ置いてスピリット状態にする。",
        ],
        linkAidData: {
          costSourceTribes: ["GE"],
          timingScope: { player: "both", period: "attack" },
        },
        effects: [effect({ textRef: [0, 1], steps: [] })],
      },
      broken: (definition) => ({
        ...definition,
        linkAidData: {
          ...definition.linkAidData,
          timingScope: { player: "self", period: "attack" },
        },
      }),
    },
    {
      label: "soul-state-only field",
      definition: {
        textLines: [
          "このカードはデッキに1枚しか入れられず、魂状態以外でフィールドに存在できない。",
          "手札/手元にあるこのカードは、自分のメインステップに魂状態にできる。",
        ],
        maxDeckCount: 1,
        effects: [
          effect({ textRef: [0], steps: [] }),
          effect({
            timing: { kind: "activated", mode: "main" },
            applicability: { zone: ["hand", "set_aside"] },
            executionMode: "optional",
            textRef: [1],
            steps: [
              {
                action: { kind: "enter_soul_state", target: { kind: "self" } },
              },
            ],
          }),
        ],
      },
      broken: (definition) => ({
        ...definition,
        effects: [
          definition.effects[0],
          {
            ...definition.effects[1],
            applicability: { zone: ["hand"] },
          },
        ],
      }),
    },
    {
      label: "guided brave-limit exemption",
      definition: {
        textLines: [
          "このカード/ブレイヴは、系統：「導魔」を持つ自分のスピリット/導界者ネクサスの合体可能体数に数えない。",
        ],
        braveLimitExemption: {
          hostCondition: {
            categories: ["spirit"],
            tribes: ["導魔"],
            alternatives: [
              {
                categories: ["nexus"],
                tribes: ["導魔", "導界者"],
                tribesLogic: "and",
                targetsGrandwalker: "only",
                grandwalkerKind: "guided",
              },
            ],
          },
        },
        effects: [effect({ textRef: [0], steps: [] })],
      },
      broken: (definition) => ({
        ...definition,
        braveLimitExemption: {
          hostCondition: {
            ...definition.braveLimitExemption.hostCondition,
            alternatives: [
              {
                ...definition.braveLimitExemption.hostCondition.alternatives[0],
                grandwalkerKind: "normal",
              },
            ],
          },
        },
      }),
    },
    {
      label: "tribal multi-brave capacity",
      definition: {
        textLines: [
          "Lv1-Lv2-Lv3",
          "このスピリットは系統：「導魔」を持つブレイヴ3つまで合体できる。",
        ],
        levelDefs: [
          { level: 1, requiredCores: 1, bp: 3000 },
          { level: 2, requiredCores: 2, bp: 4000 },
          { level: 3, requiredCores: 3, bp: 5000 },
        ],
        maxCombinedBraves: {
          count: 3,
          effectIndex: 0,
          condition: { tribes: ["導魔"] },
        },
        effects: [
          effect({
            timing: { kind: "continuous" },
            textRef: [0, 1],
            steps: [],
            applicability: { level: { min: 1, max: 3 } },
          }),
        ],
      },
      broken: (definition) => ({
        ...definition,
        maxCombinedBraves: { count: 2, condition: { tribes: ["導魔"] } },
      }),
    },
  ];

  for (const { label, definition, relatedCards = [], broken } of definitions) {
    assert.deepEqual(
      collectCoverageFindings([card(definition), ...relatedCards]),
      [],
      `${label}: complete carrier must account for the declaration`
    );
    assert.ok(
      collectCoverageFindings([card(broken(definition)), ...relatedCards]).some(
        (issue) => issue.kind === "empty_effect_steps"
      ),
      `${label}: damaged carrier must remain reviewable`
    );
  }
});

test("tribal multi-brave wording variants require the same exact carrier", () => {
  for (const particle of ["", "と"]) {
    const definition = {
      textLines: [
        "Lv1-Lv2-Lv3",
        `このスピリットは系統：「導魔」を持つブレイヴ3つまで${particle}合体できる。`,
      ],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 3000 },
        { level: 2, requiredCores: 2, bp: 4000 },
        { level: 3, requiredCores: 3, bp: 5000 },
      ],
      maxCombinedBraves: {
        count: 3,
        effectIndex: 0,
        condition: { tribes: ["導魔"] },
      },
      effects: [
        effect({
          timing: { kind: "continuous" },
          textRef: [0, 1],
          steps: [],
          applicability: { level: { min: 1, max: 3 } },
        }),
      ],
    };
    assert.deepEqual(collectCoverageFindings([card(definition)]), []);
    for (const maxCombinedBraves of [
      { ...definition.maxCombinedBraves, effectIndex: undefined },
      { ...definition.maxCombinedBraves, effectIndex: 1 },
      undefined,
      { count: 2, condition: { tribes: ["導魔"] } },
      { count: 3, condition: { tribes: ["幻想"] } },
      { count: 3, condition: { tribes: ["導魔"], minCost: 5 } },
      { ...definition.maxCombinedBraves, ignoreIncomingBraveCondition: true },
      {
        ...definition.maxCombinedBraves,
        nameLimits: [{ cardNameContains: "未印字の名前", maxCount: 1 }],
      },
      {
        ...definition.maxCombinedBraves,
        selfReferenceRewrite: {
          fromText: "this_spirit",
          toHostCategory: "ultimate",
          executionMode: "optional",
        },
      },
    ]) {
      assert.ok(
        collectCoverageFindings([
          card({ ...definition, maxCombinedBraves }),
        ]).some((issue) => issue.kind === "empty_effect_steps"),
        `wording '${particle}': absent, mismatched or overbroad carrier must stay reviewable`
      );
    }
    const levelLimited = {
      ...definition,
      textLines: ["Lv2-Lv3", definition.textLines[1]],
    };
    assert.ok(
      collectCoverageFindings([card(levelLimited)]).some(
        (issue) => issue.kind === "empty_effect_steps"
      ),
      "a permission applying at every level cannot satisfy a restricted header"
    );
  }
});

test("compound ultimate brave permission remains reviewable without continuous rewrite choice coverage", () => {
  const findings = collectCoverageFindings([
    card({
      printedCategory: "ultimate",
      textLines: [
        "Lv3-Lv4-Lv5",
        "このアルティメットは、系統：「導魔」を持つブレイヴ3つまでと合体条件を無視して合体でき、それらの効果の「このスピリット」すべては、「このアルティメット」に変更できる。",
      ],
      levelDefs: [
        { level: 3, requiredCores: 1, bp: 10000 },
        { level: 4, requiredCores: 3, bp: 12000 },
        { level: 5, requiredCores: 4, bp: 15000 },
      ],
      maxCombinedBraves: {
        count: 3,
        condition: { tribes: ["導魔"] },
        ignoreIncomingBraveCondition: true,
        selfReferenceRewrite: {
          fromText: "this_spirit",
          toHostCategory: "ultimate",
          executionMode: "optional",
        },
        effectIndex: 0,
      },
      effects: [
        effect({
          timing: { kind: "continuous" },
          applicability: { level: { min: 3, max: 5 } },
          textRef: [0, 1],
          steps: [],
        }),
      ],
    }),
  ]);
  assert.ok(
    findings.some((finding) => finding.kind === "empty_effect_steps"),
    "capacity and triggered/immediate rewrite coverage must not hide an unsupported continuous optional rewrite"
  );
});

test("revealed burst-set carrier requires the exact printed cause, origin, empty-slot gate and optional disposition", () => {
  const definition = {
    textLines: [
      "系統：「勇傑」/「妖戒」を持つ効果でデッキからオープンされたこのカードは、自分のバーストがセットされていなければ、セットできる。",
    ],
    effects: [
      effect({
        timing: { kind: "card_event", event: "revealed" },
        executionMode: "optional",
        cardEventDisposition: { kind: "set_as_burst" },
        condition: [
          { kind: "trigger_tribes", tribes: ["勇傑", "妖戒"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
          { kind: "burst_set_count", player: "self", max: 0 },
        ],
        steps: [],
        textRef: [0],
      }),
    ],
  };
  assert.deepEqual(collectCoverageFindings([card(definition)]), []);
  const original = definition.effects[0];
  for (const damaged of [
    { ...original, cardEventDisposition: undefined },
    { ...original, cardEventDisposition: { kind: "swap" } },
    { ...original, executionMode: "mandatory" },
    { ...original, stub: true },
    { ...original, timing: { kind: "card_event", event: "moved_to_trash" } },
    {
      ...original,
      timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
    },
    { ...original, condition: original.condition.slice(1) },
    { ...original, condition: [original.condition[0], original.condition[1]] },
    {
      ...original,
      condition: [
        { kind: "trigger_tribes", tribes: ["勇傑"] },
        ...original.condition.slice(1),
      ],
    },
    {
      ...original,
      condition: [
        original.condition[0],
        { kind: "trigger_from_zone", zones: ["deck", "trash"] },
        original.condition[2],
      ],
    },
    {
      ...original,
      condition: [
        original.condition[0],
        original.condition[1],
        { kind: "burst_set_count", player: "opponent", max: 0 },
      ],
    },
    {
      ...original,
      condition: [
        original.condition[0],
        original.condition[1],
        { kind: "burst_set_count", player: "self", max: 1 },
      ],
    },
    {
      ...original,
      condition: [...original.condition, { kind: "min_level", value: 2 }],
    },
    { ...original, usageLimit: { kind: "per_instance", duration: "turn" } },
    { ...original, applicability: { level: { min: 2 } } },
    { ...original, textRef: [] },
  ]) {
    assert.ok(
      collectCoverageFindings([card({ ...definition, effects: [damaged] })])
        .length > 0,
      "damaged carrier must not make the source declaration disappear"
    );
  }
  assert.deepEqual(
    collectCoverageFindings([
      card({
        ...definition,
        cardNo: "OTHER99-C01",
        textLines: [
          definition.textLines[0]
            .replace("勇傑", "想獣")
            .replace("妖戒", "導魔"),
        ],
        effects: [
          {
            ...original,
            condition: [
              { kind: "trigger_tribes", tribes: ["想獣", "導魔"] },
              ...original.condition.slice(1),
            ],
          },
        ],
      }),
    ]),
    []
  );
});

test("token-pool pre-cost effects cannot be hidden behind empty steps", () => {
  const token = card({
    cardNo: "TEST01-T01",
    maxTokenDeckCount: 9,
    textLines: [
      "〔重複不可〕トークンデッキにあるこのカードは、自分が系統：「８６」を持つブレイヴを召喚するとき、召喚コスト支払い前に出し、対象はこのスピリットに直接合体しなければならない。このとき、このスピリットのコアは、トラッシュからも《ソウルコア》以外のコアを1個まで置ける。",
    ],
    effects: [effect({ textRef: [0], steps: [] })],
  });
  assert.ok(
    collectCoverageFindings([token]).some(
      (issue) => issue.kind === "empty_effect_steps"
    )
  );
});

test("tribal multi-brave carrier requires the printed level range at its active effect", () => {
  const definition = {
    textLines: [
      "Lv2-Lv3",
      "このスピリットは系統：「導魔」を持つブレイヴ3つまで合体できる。",
    ],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 3000 },
      { level: 2, requiredCores: 2, bp: 4000 },
      { level: 3, requiredCores: 3, bp: 5000 },
    ],
    maxCombinedBraves: {
      count: 3,
      condition: { tribes: ["導魔"] },
      effectIndex: 0,
    },
    effects: [
      effect({
        timing: { kind: "continuous" },
        applicability: { level: { min: 2, max: 3 } },
        textRef: [0, 1],
        steps: [],
      }),
    ],
  };
  assert.deepEqual(collectCoverageFindings([card(definition)]), []);

  for (const maxCombinedBraves of [
    { ...definition.maxCombinedBraves, effectIndex: undefined },
    { ...definition.maxCombinedBraves, effectIndex: 1 },
  ]) {
    assert.ok(
      collectCoverageFindings([
        card({ ...definition, maxCombinedBraves }),
      ]).some((issue) => issue.kind === "empty_effect_steps"),
      "a level-limited capacity without its matching continuous effect must remain reviewable"
    );
  }
});

test("complete structured carriers resolve declaration-only empty steps", () => {
  const textLines = [
    "〔重複不可〕このカード/ブレイヴは、「テスト名」が合体している自分のスピリットに追加で合体できる。",
    "【合体条件：条件を満たす】",
  ];
  const definition = {
    textLines,
    braveCondition: { categories: ["spirit"] },
    additionalBraveSlot: {
      hostCondition: { categories: ["spirit"] },
      requiredAttachedBraveNameContains: ["テスト名"],
      maxPerHost: 1,
    },
    effects: [effect({ textRef: [0, 1], steps: [] })],
  };
  assert.deepEqual(collectCoverageFindings([card(definition)]), []);

  const broken = collectCoverageFindings([
    card({
      ...definition,
      additionalBraveSlot: undefined,
    }),
  ]);
  const issue = broken.find((item) => item.kind === "empty_effect_steps");
  assert.ok(issue, "a missing carrier must remain reviewable");
  assert.deepEqual(issue.evidence.carriers, [
    { index: 1, carrierPath: "braveCondition" },
  ]);

  for (const maxPerHost of [0, 2]) {
    const invalid = collectCoverageFindings([
      card({
        ...definition,
        additionalBraveSlot: {
          ...definition.additionalBraveSlot,
          maxPerHost,
        },
      }),
    ]);
    assert.ok(
      invalid.some((item) => item.kind === "empty_effect_steps"),
      `maxPerHost:${maxPerHost} must remain reviewable for 〔重複不可〕`
    );
  }
});

test("card-event disposition is a carrier only when it belongs to the same textRef", () => {
  const definition = {
    textLines: [
      "■系統：「地球人」を持つ効果でデッキからオープンされたこのカードは、手札1枚と入れ替えられる。",
    ],
    effects: [
      effect({
        timing: { kind: "card_event", event: "revealed" },
        cardEventDisposition: { kind: "swap" },
        executionMode: "optional",
        steps: [],
      }),
    ],
  };
  assert.deepEqual(collectCoverageFindings([card(definition)]), []);

  const blockedDefinition = {
    textLines: [
      "デッキからオープンされた/トラッシュにあるこのカードは手札に加えられず、入れ替えられない。",
    ],
    effects: [
      effect({
        timing: { kind: "card_event", event: "revealed" },
        cardEventDisposition: { kind: "blocked" },
        executionMode: "mandatory",
        steps: [],
      }),
      effect({
        timing: { kind: "card_event", event: "moved_to_trash" },
        cardEventDisposition: { kind: "blocked" },
        executionMode: "mandatory",
        steps: [],
      }),
    ],
  };
  assert.deepEqual(
    collectCoverageFindings([card(blockedDefinition)]),
    [],
    "a proven blocked disposition accounts for both the revealed and trash hand-entry restrictions"
  );

  const mirageSetDefinition = {
    textLines: [
      "自分の効果でデッキからオープンされた/トラッシュに置かれたこのカードはセットできる。",
    ],
    mirageData: { cost: 1, reduction: [] },
    effects: [
      effect({
        timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
        cardEventDisposition: { kind: "set_as_mirage" },
        condition: [
          { kind: "trigger_source_player", player: "self" },
          { kind: "trigger_from_zone", zones: ["deck"] },
        ],
        executionMode: "optional",
        steps: [],
      }),
    ],
  };
  assert.deepEqual(
    collectCoverageFindings([card(mirageSetDefinition)]),
    [],
    "a proven set_as_mirage disposition accounts for both deck-origin events"
  );

  const missingMiragePaymentDefinition = collectCoverageFindings([
    card({ ...mirageSetDefinition, mirageData: undefined }),
  ]);
  assert.ok(
    missingMiragePaymentDefinition.some(
      (item) => item.kind === "empty_effect_steps"
    ),
    "a set_as_mirage disposition without a usable mirage payment definition must remain reviewable"
  );

  for (const [label, mirageData] of [
    ["negative cost", { cost: -1, reduction: [] }],
    ["fractional cost", { cost: 1.5, reduction: [] }],
    ["invalid reduction symbol", { cost: 1, reduction: ["not_a_symbol"] }],
  ]) {
    const invalidMiragePaymentDefinition = collectCoverageFindings([
      card({ ...mirageSetDefinition, mirageData }),
    ]);
    assert.ok(
      invalidMiragePaymentDefinition.some(
        (item) => item.kind === "empty_effect_steps"
      ),
      `a set_as_mirage disposition with ${label} must remain reviewable`
    );
  }

  const mandatoryMirageSet = collectCoverageFindings([
    card({
      ...mirageSetDefinition,
      effects: [
        effect({
          ...mirageSetDefinition.effects[0],
          executionMode: "mandatory",
        }),
      ],
    }),
  ]);
  assert.ok(
    mandatoryMirageSet.some((item) => item.kind === "empty_effect_steps"),
    "a mandatory set_as_mirage disposition must remain reviewable"
  );

  const incompleteMirageSetEvents = collectCoverageFindings([
    card({
      ...mirageSetDefinition,
      effects: [
        effect({
          timing: { kind: "card_event", event: "revealed" },
          cardEventDisposition: { kind: "set_as_mirage" },
          condition: mirageSetDefinition.effects[0].condition,
          executionMode: "optional",
          steps: [],
        }),
      ],
    }),
  ]);
  assert.ok(
    incompleteMirageSetEvents.some(
      (item) => item.kind === "empty_effect_steps"
    ),
    "a two-origin mirage set must remain reviewable when its trash event is absent"
  );

  const incorrectMirageSetEvent = collectCoverageFindings([
    card({
      ...mirageSetDefinition,
      effects: [
        effect({
          timing: { kind: "card_event", event: ["revealed", "attack"] },
          cardEventDisposition: { kind: "set_as_mirage" },
          condition: mirageSetDefinition.effects[0].condition,
          executionMode: "optional",
          steps: [],
        }),
      ],
    }),
  ]);
  assert.ok(
    incorrectMirageSetEvent.some((item) => item.kind === "empty_effect_steps"),
    "a mirage disposition with an unrelated event must remain reviewable"
  );

  const extraMirageSetEvent = collectCoverageFindings([
    card({
      ...mirageSetDefinition,
      effects: [
        effect({
          ...mirageSetDefinition.effects[0],
          timing: {
            kind: "card_event",
            event: ["revealed", "moved_to_trash", "attack"],
          },
        }),
      ],
    }),
  ]);
  assert.ok(
    extraMirageSetEvent.some((item) => item.kind === "empty_effect_steps"),
    "a mirage disposition with an extra unrelated event must remain reviewable"
  );

  for (const [label, condition] of [
    [
      "missing own-effect condition",
      [{ kind: "trigger_from_zone", zones: ["deck"] }],
    ],
    [
      "opponent-effect condition",
      [
        { kind: "trigger_source_player", player: "opponent" },
        { kind: "trigger_from_zone", zones: ["deck"] },
      ],
    ],
    [
      "non-deck origin",
      [
        { kind: "trigger_source_player", player: "self" },
        { kind: "trigger_from_zone", zones: ["hand"] },
      ],
    ],
    [
      "mixed deck and hand origins",
      [
        { kind: "trigger_source_player", player: "self" },
        { kind: "trigger_from_zone", zones: ["deck", "hand"] },
      ],
    ],
    [
      "mixed deck and trash origins",
      [
        { kind: "trigger_source_player", player: "self" },
        { kind: "trigger_from_zone", zones: ["deck", "trash"] },
      ],
    ],
    [
      "competing source-player conditions",
      [
        { kind: "trigger_source_player", player: "self" },
        { kind: "trigger_source_player", player: "opponent" },
        { kind: "trigger_from_zone", zones: ["deck"] },
      ],
    ],
  ]) {
    const incompleteMirageSetCondition = collectCoverageFindings([
      card({
        ...mirageSetDefinition,
        effects: [
          effect({
            timing: {
              kind: "card_event",
              event: ["revealed", "moved_to_trash"],
            },
            cardEventDisposition: { kind: "set_as_mirage" },
            condition,
            executionMode: "optional",
            steps: [],
          }),
        ],
      }),
    ]);
    assert.ok(
      incompleteMirageSetCondition.some(
        (item) => item.kind === "empty_effect_steps"
      ),
      `a mirage disposition with ${label} must remain reviewable`
    );
  }

  const incompleteBlockedEvents = collectCoverageFindings([
    card({
      ...blockedDefinition,
      effects: [blockedDefinition.effects[0]],
    }),
  ]);
  assert.ok(
    incompleteBlockedEvents.some((item) => item.kind === "empty_effect_steps"),
    "a two-origin restriction must remain reviewable when only its revealed event is blocked"
  );

  const incompleteBlockedOrigin = collectCoverageFindings([
    card({
      ...blockedDefinition,
      textLines: [
        "デッキからオープンされたこのカードは手札に加えられず、入れ替えられない。",
      ],
    }),
  ]);
  assert.ok(
    incompleteBlockedOrigin.some((item) => item.kind === "empty_effect_steps"),
    "a two-event carrier must not account for a source line that omits its trash origin"
  );

  const incompleteBlockedText = collectCoverageFindings([
    card({
      ...blockedDefinition,
      textLines: ["デッキからオープンされたこのカードは手札に加えられない。"],
    }),
  ]);
  assert.ok(
    incompleteBlockedText.some((item) => item.kind === "empty_effect_steps"),
    "a blocked disposition must not cover text that does not also prohibit swapping"
  );

  const broken = collectCoverageFindings([
    card({
      ...definition,
      effects: [
        effect({
          timing: { kind: "card_event", event: "revealed" },
          executionMode: "optional",
          steps: [],
        }),
      ],
    }),
  ]);
  const issue = broken.find((item) => item.kind === "empty_effect_steps");
  assert.ok(issue, "a missing cardEventDisposition must remain reviewable");
  assert.deepEqual(issue.evidence.carriers, []);

  const unsupportedEvent = collectCoverageFindings([
    card({
      ...definition,
      effects: [
        effect({
          timing: { kind: "card_event", event: "attack" },
          cardEventDisposition: { kind: "swap" },
          executionMode: "optional",
          steps: [],
        }),
      ],
    }),
  ]);
  assert.ok(
    unsupportedEvent.some((item) => item.kind === "empty_effect_steps"),
    "a disposition without a revealed/trash consumer must remain reviewable"
  );

  const unsupportedDisposition = collectCoverageFindings([
    card({
      ...definition,
      effects: [
        effect({
          timing: { kind: "card_event", event: "revealed" },
          cardEventDisposition: { kind: "summon" },
          executionMode: "optional",
          steps: [],
        }),
      ],
    }),
  ]);
  assert.ok(
    unsupportedDisposition.some((item) => item.kind === "empty_effect_steps"),
    "a disposition without a proven final-board carrier must remain reviewable"
  );

  const repeatedLine = definition.textLines[0];
  const duplicateSourceLines = collectCoverageFindings([
    card({
      textLines: [repeatedLine, repeatedLine],
      effects: [
        effect({
          timing: { kind: "card_event", event: "revealed" },
          cardEventDisposition: { kind: "swap" },
          executionMode: "optional",
          steps: [],
          textRef: [0],
        }),
        effect({
          timing: { kind: "card_event", event: "revealed" },
          executionMode: "optional",
          steps: [],
          textRef: [1],
        }),
      ],
    }),
  ]);
  assert.ok(
    duplicateSourceLines.some(
      (item) =>
        item.kind === "empty_effect_steps" && item.effectPath === "effects[1]"
    ),
    "a carrier on one duplicate source line must not cover another line's empty effect"
  );
});

test("empty mechanic container remains review, with stable mechanic path", () => {
  const report = buildCoverageReport([card({ accelData: { effects: [] } })]);
  const issue = report.auditIssues.find(
    (item) => item.kind === "empty_effect_container"
  );
  assert.equal(issue.effectPath, "accelData.effects");
  assert.equal(issue.evidence.knownContainer, true);
  assert.equal(report.auditViolationCount, 0);
});

test("noop-only may be a selector or bookkeeping and never becomes a violation", () => {
  const report = buildCoverageReport([
    card({ effects: [effect({ steps: [{ action: { kind: "noop" } }] })] }),
  ]);
  assert.equal(report.auditReviewCount, 1);
  assert.equal(report.auditViolationCount, 0);
  assert.equal(report.complete, true);
});

test("choice payload prevents a noop wrapper from appearing empty", () => {
  const findings = kinds([
    card({
      effects: [
        effect({
          steps: [
            {
              action: { kind: "noop" },
              choice: [{ action: { kind: "draw", count: 1 } }],
            },
          ],
        }),
      ],
    }),
  ]);
  assert.deepEqual(findings, []);
});

test("nested granted effect is inspected with inherited source evidence", () => {
  const report = buildCoverageReport([
    card({
      effects: [
        effect({
          steps: [
            {
              action: {
                kind: "grant_effect",
                grantedEffect: { timing: { kind: "on_summon" }, steps: [null] },
              },
            },
          ],
        }),
      ],
    }),
  ]);
  const issue = report.auditIssues.find(
    (item) => item.kind === "invalid_effect_step"
  );
  assert.equal(
    issue.effectPath,
    "effects[0].steps[0].action.grantedEffect.steps[0]"
  );
  assert.deepEqual(issue.textRef, [0]);
  assert.equal(issue.evidence.sourceLines.length, 1);
  assert.equal(report.auditViolationCount, 1);
});

test("nested empty grant stays review and inherits textRef", () => {
  const report = buildCoverageReport([
    card({
      effects: [
        effect({
          steps: [
            {
              action: {
                kind: "grant_effect",
                grantedEffect: { timing: { kind: "on_summon" }, steps: [] },
              },
            },
          ],
        }),
      ],
    }),
  ]);
  assert.equal(report.auditViolationCount, 0);
  assert.equal(report.auditIssues[0].kind, "empty_effect_steps");
  assert.deepEqual(report.auditIssues[0].textRef, [0]);
});

test("nested grant's explicit textRef accounts for its own source line", () => {
  const report = buildCoverageReport([
    card({
      textLines: ["■次の効果を付与する。", "■自分はデッキから1枚ドローする。"],
      effects: [
        effect({
          steps: [
            {
              action: {
                kind: "grant_effect",
                grantedEffect: effect({ textRef: [1] }),
              },
            },
          ],
        }),
      ],
    }),
  ]);
  assert.deepEqual(report.auditIssues, []);
});

test("divine-skill invalid action is not hidden by a valid root effect", () => {
  const issues = collectCoverageFindings([
    card({
      grandwalkerData: {
        divineSkills: [{ effects: [effect({ steps: [{ action: {} }] })] }],
      },
    }),
  ]);
  assert.ok(
    issues.some(
      (issue) =>
        issue.kind === "invalid_effect_action" &&
        issue.effectPath ===
          "grandwalkerData.divineSkills[0].effects[0].steps[0].action"
    )
  );
});

test("all shared mechanic containers and unnamed back faces are audited", () => {
  for (const mechanic of [
    "mirageData",
    "accelData",
    "changeData",
    "zeroCounterData",
    "quartzData",
  ]) {
    const report = buildCoverageReport([
      card({ [mechanic]: { effects: [effect({ stub: "pending" })] } }),
    ]);
    assert.ok(
      report.auditIssues.some(
        (issue) =>
          issue.effectPath === `${mechanic}.effects[0]` &&
          issue.severity === "violation"
      )
    );
  }
  const report = buildCoverageReport([
    card({
      backFace: card({
        cardNo: undefined,
        effects: [effect({ stub: "pending" })],
      }),
    }),
  ]);
  assert.equal(report.totals.total, 2);
  assert.equal(report.auditIssues[0].cardNo, "TEST01-C01#backFace");
});

test("shared carrier and rebirth rule attribution do not become unclaimed body text", () => {
  const findings = collectCoverageFindings([
    card({
      textLines: [
        "■自分はデッキから1枚ドローする。",
        "【ミラージュ：コスト2】",
        "この面に裏返ったとき、フィールドに残る、カウント+1する。",
      ],
      mirageData: { cost: 2 },
    }),
  ]);
  assert.deepEqual(findings, []);
});

test("guided oracle carriers account for both trigger and placement body lines only when their mechanics are encoded", () => {
  const textLines = [
    "【導託：〔火星／地球＆コスト3以上〕〔火星＆アルティメット〕〔火星／地球＆ブレイヴ〕】",
    "◆対象の自分のスピリット/アルティメット/ブレイヴを召喚/煌臨したとき、ボイドからコア1個をこのネクサスに置ける。",
    "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
  ];
  const exactGrandwalkerData = {
    kind: "guided",
    oracleTriggerKinds: ["summon", "advent"],
    oracleConditions: [
      { tribes: ["火星", "地球"], categories: ["spirit"], minCost: 3 },
      { tribes: ["火星"], categories: ["ultimate"] },
      { tribes: ["火星", "地球"], categories: ["brave"] },
    ],
  };
  const correct = collectCoverageFindings([
    card({
      textLines,
      effects: [],
      grandwalkerData: exactGrandwalkerData,
    }),
  ]);
  assert.equal(
    correct.some((issue) => issue.kind === "unaccounted_text_line"),
    false
  );

  const missingOracleConditions = collectCoverageFindings([
    card({
      textLines,
      effects: [],
      grandwalkerData: { kind: "guided", oracleConditions: [] },
    }),
  ]).filter((issue) => issue.kind === "unaccounted_text_line");
  assert.deepEqual(
    missingOracleConditions.map((issue) => issue.textRef),
    [[0], [1], [2]]
  );

  const wrongTriggerKind = collectCoverageFindings([
    card({
      textLines,
      effects: [],
      grandwalkerData: {
        kind: "guided",
        oracleTriggerKinds: ["summon", "place"],
        oracleConditions: [
          { tribes: ["火星", "地球"], categories: ["spirit"], minCost: 3 },
          { tribes: ["火星"], categories: ["ultimate"] },
          { tribes: ["火星", "地球"], categories: ["brave"] },
        ],
      },
    }),
  ]).filter((issue) => issue.kind === "unaccounted_text_line");
  assert.deepEqual(
    wrongTriggerKind.map((issue) => issue.textRef),
    [[0], [1], [2]]
  );

  const missingUltimateCondition = collectCoverageFindings([
    card({
      textLines,
      effects: [],
      grandwalkerData: {
        kind: "guided",
        oracleTriggerKinds: ["summon", "advent"],
        oracleConditions: [
          { tribes: ["火星", "地球"], categories: ["spirit"], minCost: 3 },
          { tribes: ["火星", "地球"], categories: ["brave"] },
        ],
      },
    }),
  ]).filter((issue) => issue.kind === "unaccounted_text_line");
  assert.deepEqual(
    missingUltimateCondition.map((issue) => issue.textRef),
    [[0], [1], [2]]
  );

  const addedFourthCondition = collectCoverageFindings([
    card({
      textLines,
      effects: [],
      grandwalkerData: {
        ...exactGrandwalkerData,
        oracleConditions: [
          ...exactGrandwalkerData.oracleConditions,
          { tribes: ["火星"], categories: ["spirit"] },
        ],
      },
    }),
  ]).filter((issue) => issue.kind === "unaccounted_text_line");
  assert.deepEqual(
    addedFourthCondition.map((issue) => issue.textRef),
    [[0], [1], [2]]
  );

  const wrongNexusKind = collectCoverageFindings([
    card({
      textLines,
      effects: [],
      grandwalkerData: { ...exactGrandwalkerData, kind: "grandwalker" },
    }),
  ]).filter((issue) => issue.kind === "unaccounted_text_line");
  assert.deepEqual(
    wrongNexusKind.map((issue) => issue.textRef),
    [[0], [1], [2]],
    "創界神へ種別を壊した定型導託は header を含めて carrier にできない"
  );

  for (const [label, extra] of [
    ["導託を強制化する", { oracleExecutionMode: "mandatory" }],
    ["導託を同一ステップ1回に制限する", { oracleTriggerLimit: "step_once" }],
  ]) {
    const restrictedOracleCarrier = collectCoverageFindings([
      card({
        textLines,
        effects: [],
        grandwalkerData: { ...exactGrandwalkerData, ...extra },
      }),
    ]).filter((issue) => issue.kind === "unaccounted_text_line");
    assert.deepEqual(
      restrictedOracleCarrier.map((issue) => issue.textRef),
      [[0], [1], [2]],
      `${label} は「置ける」かつ回数句のない本文と非等価のため carrier にできない`
    );
  }

  for (const [label, extra] of [
    ["AND 系統条件", { tribesLogic: "and" }],
    ["追加必須系統", { tribesRequired: ["地球"] }],
    ["無系統限定", { noTribes: true }],
    ["系統部分一致除外", { excludeTribeSubstring: ["火星"] }],
  ]) {
    const restrictedTribeCarrier = collectCoverageFindings([
      card({
        textLines,
        effects: [],
        grandwalkerData: {
          ...exactGrandwalkerData,
          oracleConditions: exactGrandwalkerData.oracleConditions.map(
            (condition, index) =>
              index === 0 ? { ...condition, ...extra } : condition
          ),
        },
      }),
    ]).filter((issue) => issue.kind === "unaccounted_text_line");
    assert.deepEqual(
      restrictedTribeCarrier.map((issue) => issue.textRef),
      [[0], [1], [2]],
      `${label} は本文より狭い導託条件のため carrier にできない`
    );
  }

  const disabledPlacementOracle = collectCoverageFindings([
    card({
      textLines,
      effects: [],
      grandwalkerData: { ...exactGrandwalkerData, placementOracle: false },
    }),
  ]).filter((issue) => issue.kind === "unaccounted_text_line");
  assert.deepEqual(
    disabledPlacementOracle.map((issue) => issue.textRef),
    [[2]]
  );

  for (const [label, placementOracle] of [
    ["同名不在ゲートを外す", { sameNameGate: false }],
    ["公開枚数を4枚にする", { revealCount: 4 }],
    ["同名ターン制限を加える", { turnLimit: "per_card_name" }],
    ["残りをデッキ下に置く", { remainderDest: "bottom" }],
  ]) {
    const changedPlacementCarrier = collectCoverageFindings([
      card({
        textLines,
        effects: [],
        grandwalkerData: { ...exactGrandwalkerData, placementOracle },
      }),
    ]).filter((issue) => issue.kind === "unaccounted_text_line");
    assert.deepEqual(
      changedPlacementCarrier.map((issue) => issue.textRef),
      [[2]],
      `${label} は配置時導託本文と非等価のため carrier にできない`
    );
  }
});

test("attack-alternative flip carrier attributes a fully covered level header and matching count increase only", () => {
  const textLines = [
    "Lv1-Lv2",
    "このスピリットはアタックするかわりに裏返せる。このとき、自分のカウント+3する。",
  ];
  const correct = collectCoverageFindings([
    card({
      textLines,
      effects: [],
      levelDefs: [{ level: 1 }, { level: 2 }],
      attackAlternativeFlip: { countIncreaseAmount: 3 },
    }),
  ]);
  assert.equal(
    correct.some((issue) => issue.kind === "unaccounted_text_line"),
    false
  );

  const missingCarrier = collectCoverageFindings([
    card({ textLines, effects: [] }),
  ]).filter((issue) => issue.kind === "unaccounted_text_line");
  assert.deepEqual(
    missingCarrier.map((issue) => issue.textRef),
    [[0], [1]]
  );

  const wrongAmount = collectCoverageFindings([
    card({
      textLines,
      effects: [],
      attackAlternativeFlip: { countIncreaseAmount: 2 },
    }),
  ]).filter((issue) => issue.kind === "unaccounted_text_line");
  assert.deepEqual(
    wrongAmount.map((issue) => issue.textRef),
    [[0], [1]]
  );

  const levelScopedHeader = collectCoverageFindings([
    card({
      textLines: ["Lv2", textLines[1]],
      effects: [],
      levelDefs: [{ level: 1 }, { level: 2 }],
      attackAlternativeFlip: { countIncreaseAmount: 3 },
    }),
  ]).filter((issue) => issue.kind === "unaccounted_text_line");
  assert.deepEqual(
    levelScopedHeader.map((issue) => issue.textRef),
    [[0]]
  );
});

test("trash advent host carrier attributes its permission and core charge only when both are encoded", () => {
  const textLines = [
    "〔ターンに1回：同名〕トラッシュにあるこのカードは、フィールドで、スピリットとしているものとして自分の「スレイプニール」を【煌臨】できる。",
    "このとき、【煌臨】するカードにフィールド/リザーブのコアを好きなだけ置く。",
  ];
  const correct = collectCoverageFindings([
    card({
      textLines,
      effects: [],
      trashAdventHostGrant: {
        cardNames: [{ contains: "スレイプニール" }],
        chargeCoresOnAdvent: true,
      },
    }),
  ]);
  assert.equal(
    correct.some((issue) => issue.kind === "unaccounted_text_line"),
    false
  );

  const combinedLine =
    "〔ターンに1回：同名〕トラッシュにあるこのカードは、フィールドで、スピリットとしているものとして自分の「スレイプニール」を【煌臨】できる。このとき、煌臨するカードにフィールド/リザーブのコアを好きなだけ置く。";
  const combinedCorrect = collectCoverageFindings([
    card({
      textLines: [combinedLine],
      effects: [],
      trashAdventHostGrant: {
        cardNames: [{ contains: "スレイプニール" }],
        chargeCoresOnAdvent: true,
      },
    }),
  ]);
  assert.equal(
    combinedCorrect.some((issue) => issue.kind === "unaccounted_text_line"),
    false
  );

  const missingCoreCharge = collectCoverageFindings([
    card({
      textLines,
      effects: [],
      trashAdventHostGrant: {
        cardNames: [{ contains: "スレイプニール" }],
      },
    }),
  ]);
  const coreIssue = missingCoreCharge.find(
    (issue) => issue.kind === "unaccounted_text_line"
  );
  assert.ok(coreIssue);
  assert.deepEqual(coreIssue.textRef, [1]);

  const combinedMissingCoreCharge = collectCoverageFindings([
    card({
      textLines: [combinedLine],
      effects: [],
      trashAdventHostGrant: {
        cardNames: [{ contains: "スレイプニール" }],
      },
    }),
  ]);
  const combinedIssue = combinedMissingCoreCharge.find(
    (issue) => issue.kind === "unaccounted_text_line"
  );
  assert.ok(combinedIssue);
  assert.deepEqual(combinedIssue.textRef, [0]);
});

test("back-face rebirth carrier is attributed to the parent reset action", () => {
  const front = card({
    textLines: ["このカードは転醒できる。"],
    effects: [
      effect({
        textRef: [0],
        steps: [
          {
            action: { kind: "rebirth", countBonusMode: "reset_to_zero" },
          },
        ],
      }),
    ],
  });
  front.backFace = card({
    cardNo: "TEST01-C01(B)",
    textLines: [
      "この面に裏返ったとき、フィールドに残り、カウントを0にする。（自分のカウントエリアのコアすべてをボイドに置く。）",
    ],
    effects: [],
  });

  assert.deepEqual(collectCoverageFindings([front]), []);
});

test("rebirth trigger header requires an adjacent rebirth effect that accounts for its body", () => {
  const textLines = [
    "Lv1『このネクサスの転醒時』",
    "相手のスピリット1体を破壊する。",
  ];
  const correct = collectCoverageFindings([
    card({
      textLines,
      effects: [
        effect({
          timing: { kind: "card_event", event: "rebirth" },
          textRef: [1],
        }),
      ],
    }),
  ]);
  assert.equal(
    correct.some((issue) => issue.kind === "unaccounted_text_line"),
    false,
    "the rebirth event and its adjacent referenced body account for the timing header"
  );

  const broken = collectCoverageFindings([
    card({
      textLines,
      effects: [
        effect({
          timing: { kind: "card_event", event: "attack" },
          textRef: [1],
        }),
      ],
    }),
  ]);
  assert.deepEqual(
    broken
      .filter((issue) => issue.kind === "unaccounted_text_line")
      .map((issue) => issue.textRef),
    [[0]],
    "a different event must not claim a rebirth timing header"
  );

  const missingBody = collectCoverageFindings([
    card({
      textLines,
      effects: [
        effect({
          timing: { kind: "card_event", event: "rebirth" },
          textRef: [1],
          steps: [],
        }),
      ],
    }),
  ]);
  assert.ok(
    missingBody.some((issue) => issue.kind === "empty_effect_steps"),
    "a rebirth event and textRef without an encoded body must remain reviewable"
  );
});

test("a complete declaration carrier resolves an otherwise empty effect", () => {
  const report = buildCoverageReport([
    card({
      textLines: ["【ミラージュ：コスト2】"],
      effects: [effect({ steps: [] })],
      mirageData: { cost: 2 },
    }),
  ]);
  assert.equal(report.auditViolationCount, 0);
  assert.deepEqual(report.auditIssues, []);
});

test("mirage trash-set carrier attributes only explicit canSetFromTrash permission", () => {
  const text = "トラッシュにあるこのカードはセットできる。";
  const correct = collectCoverageFindings([
    card({
      textLines: [text],
      effects: [],
      mirageData: { cost: 1, reduction: [], canSetFromTrash: true },
    }),
  ]);
  assert.equal(
    correct.some((entry) => entry.kind === "unaccounted_text_line"),
    false
  );

  const broken = collectCoverageFindings([
    card({
      textLines: [text],
      effects: [],
      mirageData: { cost: 1, reduction: [] },
    }),
  ]);
  assert.deepEqual(
    broken
      .filter((entry) => entry.kind === "unaccounted_text_line")
      .map((entry) => entry.textRef),
    [[0]]
  );
});

test("invalid attribution metadata reports uncertainty without hiding the source", () => {
  const report = buildCoverageReport([
    card({
      adventData: { beforeAdventSourceAddition: { textRef: 0 } },
      effects: [effect({ steps: [], textRef: [] })],
    }),
  ]);
  const issue = report.auditIssues.find(
    (item) => item.kind === "text_accountability_unavailable"
  );
  assert.equal(issue.severity, "review");
  assert.equal(issue.evidence.sourceLines.length, 1);
});

test("malformed containers and non-object effects produce violations without crashing", () => {
  for (const overrides of [
    { effects: [null] },
    { effects: "invalid" },
    { mirageData: { effects: {} } },
    { grandwalkerData: { divineSkills: [null] } },
  ]) {
    const report = buildCoverageReport([card(overrides)]);
    assert.ok(report.auditViolationCount > 0, JSON.stringify(overrides));
    assert.equal(report.complete, false);
  }
});

test("missing or malformed steps and action kinds are violations", () => {
  for (const steps of [
    undefined,
    {},
    [null],
    [{}],
    [{ action: { kind: "" } }],
    [{ action: { kind: "draw" }, choice: {} }],
  ]) {
    assert.ok(
      buildCoverageReport([card({ effects: [effect({ steps })] })])
        .auditViolationCount > 0
    );
  }
});

test("invalid textRef values and bounds are violations", () => {
  for (const textRef of ["0", [-1], [0.5], [1], ["0"]]) {
    const report = buildCoverageReport([
      card({ effects: [effect({ textRef })] }),
    ]);
    assert.ok(
      report.auditIssues.some((issue) => issue.kind === "invalid_text_ref")
    );
    assert.equal(report.complete, false);
  }
});

test("missing or malformed timing cannot count as executable implementation", () => {
  for (const timing of [undefined, "on_summon", {}, { kind: "" }]) {
    const report = buildCoverageReport([
      card({ effects: [effect({ timing })] }),
    ]);
    assert.ok(
      report.auditIssues.some((issue) => issue.kind === "invalid_effect_timing")
    );
    assert.equal(report.complete, false);
  }
});

test("missing and empty textRef are review, not semantic implementation proof", () => {
  for (const textRef of [undefined, []]) {
    const report = buildCoverageReport([
      card({ effects: [effect({ textRef })] }),
    ]);
    assert.equal(report.auditViolationCount, 0);
    assert.ok(
      report.auditIssues.some((issue) => issue.kind === "missing_text_ref")
    );
    assert.ok(
      report.auditIssues.some((issue) => issue.kind === "unaccounted_text_line")
    );
  }
});

test("unknown effect containers are discoverable without changing legacy done counts", () => {
  const report = buildCoverageReport([
    card({ effects: [], futureData: { effects: [effect()] } }),
  ]);
  assert.equal(report.totals.todo, 1);
  assert.ok(
    report.auditIssues.some(
      (issue) => issue.kind === "unregistered_effect_container"
    )
  );
});

test("arbitrary V1 action.steps are not misvalidated as EffectStep", () => {
  const report = buildCoverageReport([
    card({
      effects: [
        effect({
          steps: [
            {
              action: { kind: "v1_steps", steps: [{ kind: "Draw", count: 1 }] },
            },
          ],
        }),
      ],
    }),
  ]);
  assert.equal(report.auditViolationCount, 0);
});

test("JSON CLI is ASCII-safe and high-confidence violations fail the gate", () => {
  const result = cli(
    [card({ effects: [effect({ stub: "未実装" })] })],
    ["--json", "--gate"]
  );
  assert.equal(result.status, 1);
  assert.ok([...result.stdout].every((char) => char.charCodeAt(0) <= 0x7f));
  assert.equal(JSON.parse(result.stdout).auditViolationCount, 1);
});

test("review alone passes CLI gate and --set scopes violation checks", () => {
  const fixtures = [
    card({ effects: [effect({ steps: [] })] }),
    card({ cardNo: "TEST02-C01", effects: [effect({ stub: "pending" })] }),
  ];
  assert.equal(cli([fixtures[0]], ["--json", "--gate"]).status, 0);
  assert.equal(
    cli(fixtures, ["--json", "--gate", "--set", "TEST01"]).status,
    0
  );
  assert.equal(cli(fixtures, ["--gate", "--set", "TEST02"]).status, 1);
  assert.equal(cli([card({ effects: [] })], ["--json", "--gate"]).status, 1);
});

test("source-text declaration carriers require their exact generic DSL contracts", () => {
  const unaccountedLines = (definition) =>
    collectCoverageFindings([card(definition)]).filter(
      (issue) => issue.kind === "unaccounted_text_line"
    );
  const trueGuidedOracle = {
    cardNo: "TEST01-CX01",
    textLines: [
      "【真・導託：〔８６＆ブレイヴ〕】",
      "◆対象の自分のブレイヴを召喚したとき、このネクサスにコア+1できる。",
      "◆〔ターンに1回：同名〕このネクサスを配置したとき、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につき、このネクサスにコア+1する。",
    ],
    grandwalkerData: {
      kind: "guided",
      oracleConditions: [{ tribes: ["８６"], categories: ["brave"] }],
      oracleTriggerKinds: ["summon"],
      placementOracle: { sameNameGate: false, turnLimit: "per_card_name" },
    },
    effects: [],
  };
  assert.deepEqual(unaccountedLines(trueGuidedOracle), []);
  assert.ok(
    unaccountedLines({
      ...trueGuidedOracle,
      grandwalkerData: {
        ...trueGuidedOracle.grandwalkerData,
        oracleTriggerKinds: ["advent"],
      },
    }).length > 0,
    "a true guided oracle must retain review when summon-only trigger wiring is broken"
  );
  assert.ok(
    unaccountedLines({
      ...trueGuidedOracle,
      grandwalkerData: {
        ...trueGuidedOracle.grandwalkerData,
        oracleConditions: [
          {
            ...trueGuidedOracle.grandwalkerData.oracleConditions[0],
            colors: ["red"],
          },
        ],
      },
    }).length > 0,
    "a true guided oracle must retain review when its source-text condition gains a color restriction"
  );
  assert.ok(
    unaccountedLines({
      ...trueGuidedOracle,
      grandwalkerData: {
        ...trueGuidedOracle.grandwalkerData,
        oracleConditions: [
          {
            ...trueGuidedOracle.grandwalkerData.oracleConditions[0],
            colorCount: 1,
          },
        ],
      },
    }).length > 0,
    "a true guided oracle must retain review when its source-text condition gains a color-count restriction"
  );
  assert.ok(
    unaccountedLines({
      ...trueGuidedOracle,
      grandwalkerData: {
        ...trueGuidedOracle.grandwalkerData,
        placementOracle: {
          ...trueGuidedOracle.grandwalkerData.placementOracle,
          revealCount: 2,
        },
      },
    }).length > 0,
    "a true guided oracle must retain review when its placement oracle reveals fewer than the printed three cards"
  );
  assert.ok(
    unaccountedLines({
      ...trueGuidedOracle,
      grandwalkerData: {
        ...trueGuidedOracle.grandwalkerData,
        placementOracle: {
          ...trueGuidedOracle.grandwalkerData.placementOracle,
          remainderDest: "bottom",
        },
      },
    }).length > 0,
    "a true guided oracle must retain review when its placement oracle does not trash the printed cards"
  );
  assert.ok(
    unaccountedLines({
      ...trueGuidedOracle,
      grandwalkerData: {
        ...trueGuidedOracle.grandwalkerData,
        placementOracleReturnToHand: { cardName: { contains: "８６" } },
      },
    }).length > 0,
    "a true guided oracle must retain review when its placement oracle adds an unprinted trash-to-hand return"
  );

  const printedOverCount = {
    textLines: ["【OC条件：カウント5以上】"],
    printedOverCount: { minCount: 5, bpBonus: 8000 },
    overCount: { minCount: 5, bpBonus: 8000 },
    effects: [],
  };
  assert.deepEqual(unaccountedLines(printedOverCount), []);
  assert.ok(
    unaccountedLines({
      ...printedOverCount,
      overCount: { minCount: 4, bpBonus: 8000 },
    }).length > 0,
    "the printed OC condition must agree with the runtime over-count threshold"
  );

  const proxy = {
    textLines: [
      "Lv2",
      "〔ターンに1回：同名〕自分は、魂状態を含む「神薙 ユウ」に《ソウルコア》をトラッシュに置いたものとして【契約合体】できる。",
    ],
    contractCombineProxyData: {
      requiredLevel: 2,
      targetCardNames: [{ contains: "神薙 ユウ" }],
    },
    effects: [],
  };
  assert.deepEqual(unaccountedLines(proxy), []);
  assert.ok(
    unaccountedLines({
      ...proxy,
      contractCombineProxyData: {
        ...proxy.contractCombineProxyData,
        requiredLevel: 1,
      },
    }).length > 0,
    "a proxy contract-combine declaration must retain review for a wrong level"
  );

  const tokenDeck = {
    textLines: ["このカードはデッキに入れられない。"],
    maxTokenDeckCount: 1,
    effects: [],
  };
  assert.deepEqual(unaccountedLines(tokenDeck), []);
  assert.ok(
    unaccountedLines({ ...tokenDeck, maxTokenDeckCount: 0 }).length > 0,
    "a nonpositive token-pool capacity must retain review"
  );

  const singleton = {
    textLines: ["このカードはデッキに1枚しか入れられない。"],
    maxDeckCount: 1,
    effects: [],
  };
  assert.deepEqual(unaccountedLines(singleton), []);
  assert.ok(
    unaccountedLines({ ...singleton, maxDeckCount: 2 }).length > 0,
    "a non-singleton deck cap must retain review"
  );

  const independentToken = {
    textLines: [
      "このカード/スピリットはコアを、出すとき以外で置けず、移動するとき/このスピリットがフィールドを離れるとき、ボイドに置かなければならない。",
    ],
    maxTokenDeckCount: 6,
    tokenIndependentCoreManagement: {
      redirectCoresToVoid: true,
      placementRestrictedToEnterField: true,
    },
    effects: [],
  };
  assert.deepEqual(unaccountedLines(independentToken), []);
  assert.ok(
    unaccountedLines({
      ...independentToken,
      tokenIndependentCoreManagement: {
        ...independentToken.tokenIndependentCoreManagement,
        redirectCoresToVoid: false,
      },
    }).length > 0,
    "a token without forced-void redirection must retain review"
  );
});

test("module import is side-effect-free even with CLI fixture and gate environment", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "await import('./scripts/cards-coverage.mjs'); console.log('imported');",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        ORICA_CARDS_COVERAGE_FIXTURE_JSON: "not json",
        ORICA_CARDS_COVERAGE_NO_WRITE: "1",
      },
      encoding: "utf8",
    }
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "imported");
});

test("unconditional tribe data accounts for empty declaration steps only when every printed tribe matches", () => {
  const source = "このカードは、系統：「幻想」/「起幻」を持つ。";
  const valid = card({
    printedCategory: "magic",
    tribe: "幻想・起幻",
    textLines: [source],
    effects: [effect({ timing: { kind: "continuous" }, steps: [] })],
  });
  assert.deepEqual(collectCoverageFindings([valid]), []);
  for (const tribe of [undefined, "幻想", "幻想・起幻・紅魔", "幻想・・起幻"]) {
    assert.ok(kinds([{ ...valid, tribe }]).includes("empty_effect_steps"));
  }
  // The identity-only carrier must not hide the remainder of an effect line.
  const extraAction = {
    ...valid,
    textLines: [source.slice(0, -1) + "。1枚ドローする。"],
  };
  assert.ok(kinds([extraAction]).includes("empty_effect_steps"));
  const missingAttribution = { ...valid, effects: [] };
  assert.deepEqual(collectCoverageFindings([missingAttribution]), []);
  assert.ok(
    kinds([{ ...missingAttribution, tribe: "幻想" }]).includes(
      "unaccounted_text_line"
    )
  );
});

console.log(`PASS ${passed} fidelity coverage tests`);
