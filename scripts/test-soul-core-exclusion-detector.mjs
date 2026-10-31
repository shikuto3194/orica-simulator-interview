#!/usr/bin/env node
/**
 * soul-core-exclusion-detector.mjs の単体テスト。pure 関数のため card-data ビルドや
 * engine 状態に依存しない。`node scripts/test-soul-core-exclusion-detector.mjs` で実行。
 *
 * 期待: 「《ソウルコア》以外」指定に対し effectKind:"normal_only" が無い場合を検出し、
 * 指定が無いカード / normal_only を持つカードを false positive にしないこと。
 * ネスト（steps / choice 配下）のアクションも拾うこと。
 */
import {
  collectCoreMoveActions,
  findSoulCoreExclusionViolation,
  hasSoulCoreExclusionWording,
} from "./soul-core-exclusion-detector.mjs";

let pass = 0;
let fail = 0;
function check(label, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL: ${label}`);
  }
}

// --- 語彙検出 ---
check(
  "《ソウルコア》以外 を検出",
  hasSoulCoreExclusionWording(
    "自分のトラッシュの《ソウルコア》以外のコア3個を自分のリザーブに置ける。"
  )
);
check(
  "《ソウルコア》単独では検出しない",
  !hasSoulCoreExclusionWording("《ソウルコア》を自分のリザーブに置く。")
);
check("空文字で false", !hasSoulCoreExclusionWording(""));
check("undefined で false", !hasSoulCoreExclusionWording(undefined));

// --- ネスト走査 ---
check(
  "steps 配下の core_move を拾う",
  collectCoreMoveActions([{ steps: [{ kind: "core_move" }] }]).length === 1
);
check(
  "choice の分岐配下も拾う",
  collectCoreMoveActions([
    {
      steps: [
        { kind: "choice", options: [{ steps: [{ kind: "core_move" }] }] },
      ],
    },
  ]).length === 1
);
check(
  "core_distribute も対象",
  collectCoreMoveActions([{ kind: "core_distribute" }]).length === 1
);
check(
  "無関係な kind は拾わない",
  collectCoreMoveActions([{ kind: "draw" }]).length === 0
);

// --- 判定 ---
const wording = [
  "自分のトラッシュの《ソウルコア》以外のコア1個をリザーブに置ける。",
];

check(
  "語彙なし → null",
  findSoulCoreExclusionViolation(
    ["カードを1枚引く。"],
    [{ kind: "core_move" }]
  ) === null
);
check(
  "normal_only あり → null",
  findSoulCoreExclusionViolation(wording, [
    { steps: [{ kind: "core_move", effectKind: "normal_only" }] },
  ]) === null
);
check(
  "normal_only なし → missing_effect_kind",
  findSoulCoreExclusionViolation(wording, [{ kind: "core_move" }])?.reason ===
    "missing_effect_kind"
);
check(
  "core アクション不在 → missing_action",
  findSoulCoreExclusionViolation(wording, [{ kind: "draw" }])?.reason ===
    "missing_action"
);
check(
  "effects 空 → missing_action",
  findSoulCoreExclusionViolation(wording, [])?.reason === "missing_action"
);
check(
  "複数アクションのうち1件でも normal_only なら null",
  findSoulCoreExclusionViolation(wording, [
    { kind: "core_move" },
    { kind: "core_move", effectKind: "normal_only" },
  ]) === null
);

// --- core_distribute.from.trashCoreKind による source 単位の表現 ---
check(
  "core_distribute の trashCoreKind:normal_only でトラッシュ source の除外を満たす",
  findSoulCoreExclusionViolation(
    [
      "トラッシュの《ソウルコア》以外のコア1個までとフィールド/リザーブのコアを好きなだけこのスピリットに置く。",
    ],
    [
      {
        kind: "core_distribute",
        from: {
          kind: "field_reserve_and_trash_self",
          trashCoreLimit: 1,
          trashCoreKind: "normal_only",
        },
      },
    ]
  ) === null
);

// --- summon.trashCoreKind による表現 (BSES01-T01。2026-08-03 の誤検出の回帰テスト) ---
check(
  "summon.trashCoreKind:normal で満たす",
  findSoulCoreExclusionViolation(wording, [
    {
      steps: [
        {
          action: { kind: "summon", trashCoreMax: 1, trashCoreKind: "normal" },
        },
      ],
    },
  ]) === null
);
check(
  "summon.trashCoreKind:generic は満たさない (ソウル込み)",
  findSoulCoreExclusionViolation(wording, [
    {
      steps: [
        {
          action: { kind: "summon", trashCoreMax: 1, trashCoreKind: "generic" },
        },
      ],
    },
  ])?.reason === "missing_effect_kind"
);
check(
  "trashCoreMax を持たない通常 summon は無関係 (missing_action のまま)",
  findSoulCoreExclusionViolation(wording, [
    { steps: [{ action: { kind: "summon", target: { kind: "self" } } }] },
  ])?.reason === "missing_action"
);

console.log(`soul-core-exclusion-detector: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
