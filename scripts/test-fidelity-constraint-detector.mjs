#!/usr/bin/env node
import assert from "node:assert/strict";
import { findConstraintFidelityIssues as detect } from "./fidelity-constraint-detector.mjs";
import { extractQuantifiedEffectRepeats } from "./quantified-effect-repeat.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
let passed = 0;
let failed = 0;
function check(name, run) {
  try {
    run();
    passed++;
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}\n${error.stack}`);
  }
}
const effect = (
  steps = [{ action: { kind: "draw", count: 1 } }],
  extra = {}
) => ({
  timing: { kind: "card_event", event: "summon" },
  textRef: [0],
  steps,
  ...extra,
});
const withLimit = (usageLimit, extra = {}) =>
  effect(undefined, { usageLimit, ...extra });
const issue = (issues, kind, severity = "violation") =>
  issues.find((item) => item.kind === kind && item.severity === severity);
const none = (value, text, options = {}) =>
  assert.deepEqual(detect(value, [text], options), []);
const turn = { kind: "per_card_name", duration: "turn" };
const game = { kind: "per_instance", duration: "game" };
const dualText =
  "〔ターンに1回：同名〕ゲーム中に1回、相手のスピリット1体を破壊できる。";

check("同名/個体を区別: 正しい同名ターン制限", () =>
  none(withLimit(turn), "〔ターンに1回：同名〕1枚ドローする。")
);
check("コア配分の『1個ずつ』は同名ターン制限を曖昧にしない", () =>
  none(
    effect(
      [
        { action: { kind: "core_move" } },
        { action: { kind: "core_distribute" } },
      ],
      { usageLimit: turn }
    ),
    "〔ターンに1回：同名〕自分のスピリットの下にカードが置かれたとき、ボイドからコア1個ずつをこのネクサスと自分の創界神ネクサスに置く。"
  )
);
check("コア配分文でも同名制限の個体化を検知", () => {
  const found = issue(
    detect(
      effect(
        [
          { action: { kind: "core_move" } },
          { action: { kind: "core_distribute" } },
        ],
        { usageLimit: { kind: "per_instance", duration: "turn" } }
      ),
      [
        "〔ターンに1回：同名〕自分のスピリットの下にカードが置かれたとき、ボイドからコア1個ずつをこのネクサスと自分の創界神ネクサスに置く。",
      ]
    ),
    "usage_constraint_mismatch"
  );
  assert.equal(found.severity, "violation");
  assert.match(found.evidence, /per_card_name/);
});
check("同名/個体を区別: 個体への誤変換を検知", () => {
  const found = issue(
    detect(withLimit({ kind: "per_instance" }), [
      "〔ターンに1回：同名〕1枚ドローする。",
    ]),
    "usage_constraint_mismatch"
  );
  assert.equal(found.path, "$.usageLimit");
  assert.match(found.evidence, /per_card_name/);
  assert.match(found.evidence, /per_instance/);
});
check("裸のターンに1回は個体制限", () =>
  none(
    withLimit({ kind: "per_instance" }),
    "ターンに1回、自分は1枚ドローする。"
  )
);
check("明示的に無視して発揮する同名ターン制限を再発揮側へ要求しない", () =>
  none(
    effect([{ action: { kind: "summon", target: { kind: "self" } } }]),
    "相手がスタック効果を発揮したとき、このスピリットの『このスピリットのアタック時』効果をLvと〔ターンに1回:同名〕を無視して発揮できる。"
  )
);
check("無視構文がない同名ターン制限の個体化は引き続き検知する", () => {
  const found = issue(
    detect(withLimit({ kind: "per_instance", duration: "turn" }), [
      "〔ターンに1回:同名〕このスピリットのアタック時、1枚ドローする。",
    ]),
    "usage_constraint_mismatch"
  );
  assert.equal(found.severity, "violation");
});
const battleEndRecoverText =
  "Lv1-Lv2-Lv3『このスピリットのアタック時』\nこのスピリットは、相手の効果を受けず、バトル終了時、ターンに1回、回復する。";
const battleImmunity = {
  timing: { kind: "card_event", event: "attack" },
  textRef: [0, 1],
  steps: [
    {
      action: {
        kind: "effect_immunity",
        target: { kind: "self" },
        duration: { scope: "battle" },
      },
    },
  ],
};
const battleEndRecover = (usageLimit) => ({
  timing: { kind: "card_event", event: "attack", deferredTo: "battle_end" },
  textRef: [0, 1],
  usageLimit,
  steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
});
check(
  "同一原文の攻撃中耐性とバトル終了自己回復を分離したturn carrierを認識",
  () =>
    none(battleImmunity, battleEndRecoverText.split("\n"), {
      siblingEffects: [
        battleEndRecover({ kind: "per_instance", duration: "turn" }),
      ],
    })
);
check(
  "分離したバトル終了回復のturn carrierが同名共有に壊れれば不一致を検出する",
  () => {
    const found = detect(battleImmunity, battleEndRecoverText.split("\n"), {
      siblingEffects: [
        battleEndRecover({ kind: "per_card_name", duration: "turn" }),
      ],
    });
    assert.ok(
      found.some((entry) => entry.kind === "usage_constraint_mismatch")
    );
  }
);
const conditionalSelfRecoverText =
  "Lv3-Lv4『このアルティメットのアタック時』\n相手のスピリット/アルティメット1体を手札に戻せる。自分のカウント2以上のとき、ターンに1回、このアルティメットは回復する。";
const conditionalSelfRecoverSource = {
  timing: { kind: "card_event", event: "attack" },
  textRef: [0, 1],
  condition: [{ kind: "min_level", value: 3 }],
  executionMode: "optional",
  steps: [
    {
      action: {
        kind: "bounce",
        target: { kind: "filter", player: "opponent" },
      },
    },
  ],
};
const conditionalSelfRecover = (usageLimit, extra = {}) => ({
  timing: { kind: "card_event", event: "attack" },
  textRef: [0, 1],
  condition: [
    { kind: "min_level", value: 3 },
    { kind: "count_value", player: "self", min: 2 },
  ],
  usageLimit,
  steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
  ...extra,
});
check("任意先行actionから分離した条件付き自己回復のturn carrierを認識", () =>
  none(conditionalSelfRecoverSource, conditionalSelfRecoverText.split("\n"), {
    siblingEffects: [
      conditionalSelfRecover({ kind: "per_instance", duration: "turn" }),
    ],
  })
);
check(
  "分離した条件付き自己回復のturn carrierを同名共有に壊すと不一致を残す",
  () => {
    const found = detect(
      conditionalSelfRecoverSource,
      conditionalSelfRecoverText.split("\n"),
      {
        siblingEffects: [
          conditionalSelfRecover({ kind: "per_card_name", duration: "turn" }),
        ],
      }
    );
    assert.ok(
      found.some((entry) => entry.kind === "usage_constraint_mismatch")
    );
  }
);
check(
  "条件付き自己回復のcount条件を落とした兄弟はcarrierとして認めない",
  () => {
    const found = detect(
      conditionalSelfRecoverSource,
      conditionalSelfRecoverText.split("\n"),
      {
        siblingEffects: [
          conditionalSelfRecover(
            { kind: "per_instance", duration: "turn" },
            { condition: [{ kind: "min_level", value: 3 }] }
          ),
        ],
      }
    );
    assert.ok(
      found.some((entry) => entry.kind === "usage_constraint_mismatch")
    );
  }
);
check("ゲーム中に2回は個体・game・maxCount2", () =>
  none(
    withLimit({ ...game, maxCount: 2 }),
    "ゲーム中に2回、自分は1枚ドローする。"
  )
);
check("しか使えないは同名共有", () =>
  none(
    withLimit({ kind: "per_card_name", duration: "game" }),
    "この効果はゲーム中に1回しか使えない。1枚ドローする。"
  )
);
check("同名ゲーム制限をターンでリセットしてはいけない", () =>
  assert.ok(
    issue(
      detect(withLimit(turn), ["〔ゲームに1回：同名〕1枚ドローする。"]),
      "usage_constraint_mismatch"
    )
  )
);
check("角括弧内で連結した同名ゲーム制限を個体制限と誤読しない", () =>
  none(
    withLimit({ kind: "per_card_name", duration: "game" }),
    "［ゲームに1回同名］1枚ドローする。"
  )
);
check("角括弧内で連結した同名ゲーム制限の個体化を検知する", () => {
  const found = issue(
    detect(withLimit({ kind: "per_instance", duration: "game" }), [
      "［ゲームに1回同名］1枚ドローする。",
    ]),
    "usage_constraint_mismatch"
  );
  assert.equal(found.severity, "violation");
  assert.match(found.evidence, /per_card_name/);
});
check("BSSA型turn/gameのAND配列を保持", () =>
  none(withLimit([turn, game]), dualText)
);
check("BSSA型のgame成分欠落は外側補完を否定できないのでreview", () =>
  assert.ok(
    issue(
      detect(withLimit(turn), [dualText]),
      "usage_constraint_mismatch",
      "review"
    )
  )
);
check("BSSA型の個体gameを同名gameに揃えると違反", () =>
  assert.ok(
    issue(
      detect(withLimit([turn, { kind: "per_card_name", duration: "game" }]), [
        dualText,
      ]),
      "usage_constraint_mismatch"
    )
  )
);
check("同じ手順の親/子制限はANDとして成立", () =>
  none(
    effect([{ action: { kind: "draw", count: 1 }, usageLimit: game }], {
      usageLimit: turn,
    }),
    dualText
  )
);
check("別々の兄弟手順に分かれた制限でAND成立と断定しない", () => {
  const found = detect(
    effect([
      { action: { kind: "draw", count: 1 }, usageLimit: turn },
      { action: { kind: "draw", count: 1 }, usageLimit: game },
    ]),
    [dualText]
  );
  const review = issue(found, "usage_constraint_mismatch", "review");
  assert.ok(review);
  assert.match(review.evidence, /steps\[0\]/);
  assert.match(review.evidence, /steps\[1\]/);
  assert.equal(
    found.filter((entry) => entry.severity === "violation").length,
    0
  );
});
check(
  "named noop usage gate は従属 action 群の同名ゲーム制限を一元化できる",
  () =>
    none(
      effect([
        {
          id: "excluded-cards",
          action: { kind: "remove_from_game", target: { kind: "self" } },
        },
        {
          id: "once-per-game",
          stepCondition: {
            kind: "ref_count",
            stepId: "excluded-cards",
            min: 13,
          },
          usageLimit: { kind: "per_card_name", duration: "game" },
          action: {
            kind: "noop",
            target: { kind: "ref", stepId: "excluded-cards" },
          },
        },
        {
          stepCondition: { kind: "ref_succeeded", stepId: "once-per-game" },
          action: { kind: "draw", count: 1 },
        },
      ]),
      "カード13枚を除外する。13枚以上：〔ゲームに1回：同名〕1枚ドローする。"
    )
);
check("従属actionのないnoop usage gateで本文の回数制限を充足しない", () => {
  const found = detect(
    effect([
      {
        id: "once-per-game",
        usageLimit: { kind: "per_card_name", duration: "game" },
        action: { kind: "noop", target: { kind: "self" } },
      },
      { action: { kind: "draw", count: 1 } },
    ]),
    ["〔ゲームに1回：同名〕1枚ドローする。"]
  );
  assert.ok(issue(found, "usage_constraint_mismatch", "review"));
  assert.ok(found.every((entry) => entry.severity !== "violation"));
});
check(
  "さらに節の任意noop usage gateは逐次ref_executed後続を一元制限できる",
  () =>
    none(
      effect([
        { action: { kind: "count_increase", amount: 1 } },
        {
          id: "once-per-turn",
          action: { kind: "noop" },
          executionMode: "optional",
          usageLimit: { kind: "per_instance", duration: "turn" },
          connector: "sequential",
        },
        {
          action: { kind: "draw", count: 2 },
          connector: "sequential",
          stepCondition: { kind: "ref_executed", stepId: "once-per-turn" },
        },
      ]),
      "自分のカウント+1する。さらに、ターンに1回、自分はデッキを上から2枚ドローできる。"
    )
);
check("さらに節の逐次後段step制限は前段を止めずに所属する", () =>
  none(
    effect([
      {
        action: { kind: "core_move" },
        executionMode: "optional",
      },
      {
        action: { kind: "deck_reveal" },
        connector: "sequential",
        executionMode: "optional",
        usageLimit: turn,
      },
    ]),
    "ボイドからコア1個をこのスピリットに置ける。さらに、〔ターンに1回：同名〕自分のデッキを上から3枚オープンできる。"
  )
);
check("さらに節の後段制限を個体制限に崩す壊れた表現はreviewに残す", () => {
  const found = detect(
    effect([
      {
        action: { kind: "core_move" },
        executionMode: "optional",
      },
      {
        action: { kind: "deck_reveal" },
        connector: "sequential",
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn" },
      },
    ]),
    [
      "ボイドからコア1個をこのスピリットに置ける。さらに、〔ターンに1回：同名〕自分のデッキを上から3枚オープンできる。",
    ]
  );
  assert.ok(issue(found, "usage_constraint_mismatch", "review"));
});
check(
  "さらに条件節の個体ターン制限は後段stepだけの正しいcarrierとして認識する",
  () =>
    none(
      effect([
        { action: { kind: "draw", count: 1 } },
        {
          action: { kind: "recover", target: { kind: "self" } },
          connector: "simultaneous",
          condition: [{ kind: "count_value", player: "self", min: 2 }],
          usageLimit: { kind: "per_instance", duration: "turn" },
        },
      ]),
      "自分は、デッキの上から1枚ドローする。さらに、自分のカウント2以上のとき、ターンに1回、このスピリットは回復する。"
    )
);
check("さらに条件節の同名制限を個体制限に崩す壊れた表現はreviewに残す", () => {
  const found = detect(
    effect([
      { action: { kind: "draw", count: 1 } },
      {
        action: { kind: "recover", target: { kind: "self" } },
        connector: "simultaneous",
        condition: [{ kind: "count_value", player: "self", min: 2 }],
        usageLimit: { kind: "per_instance", duration: "turn" },
      },
    ]),
    [
      "自分は、デッキの上から1枚ドローする。さらに、自分のカウント2以上のとき、〔ターンに1回：同名〕このスピリットは回復する。",
    ]
  );
  assert.ok(issue(found, "usage_constraint_mismatch", "review"));
});
check(
  "読点後の自己回復だけにある個体ターン制限を正しいcarrierとして認識する",
  () =>
    none(
      effect([
        { action: { kind: "core_move" } },
        {
          action: { kind: "recover", target: { kind: "self" } },
          connector: "sequential",
          usageLimit: { kind: "per_instance", duration: "turn" },
        },
      ]),
      "相手の創界神ネクサスのコア4個をボイドに置き、ターンに1回、このスピリットは回復する。"
    )
);
check("読点後の自己回復制限を同名共有へ崩す壊れたcarrierは検知する", () => {
  const found = issue(
    detect(
      effect([
        { action: { kind: "core_move" } },
        {
          action: { kind: "recover", target: { kind: "self" } },
          connector: "sequential",
          usageLimit: { kind: "per_card_name", duration: "turn" },
        },
      ]),
      [
        "相手の創界神ネクサスのコア4個をボイドに置き、ターンに1回、このスピリットは回復する。",
      ]
    ),
    "usage_constraint_mismatch"
  );
  assert.equal(found.path, "$.usageLimit");
  assert.equal(found.severity, "violation");
});
check("読点後の自己回復制限を親Effectへ広げるとscope reviewに残す", () => {
  const found = issue(
    detect(
      effect(
        [
          { action: { kind: "core_move" } },
          {
            action: { kind: "recover", target: { kind: "self" } },
            connector: "sequential",
            usageLimit: { kind: "per_instance", duration: "turn" },
          },
        ],
        { usageLimit: { kind: "per_instance", duration: "turn" } }
      ),
      [
        "相手の創界神ネクサスのコア4個をボイドに置き、ターンに1回、このスピリットは回復する。",
      ]
    ),
    "usage_scope_review",
    "review"
  );
  assert.equal(found.path, "$.usageLimit");
  assert.match(found.evidence, /親の制限が他の手順にも及ぶ=true/);
});
check(
  "conditional_cost の代替回復だけに付いた個体ターン制限を正しい carrier として認識する",
  () =>
    none(
      effect([
        { id: "select", action: { kind: "noop" } },
        { id: "cost", action: { kind: "set_self_as_mirage" } },
        {
          id: "send",
          action: { kind: "send_to_deck" },
          connector: "conditional_cost",
          conditionalCostAlternativeStepIds: ["recover"],
          stepCondition: { kind: "ref_executed", stepId: "cost" },
        },
        {
          id: "recover",
          action: { kind: "recover" },
          executionMode: "optional",
          usageLimit: { kind: "per_instance", duration: "turn" },
          stepCondition: { kind: "ref_executed", stepId: "cost" },
        },
      ]),
      "ミラージュをセットすることで、相手のスピリット2体までをデッキの下に戻し、ターンに1回、このスピリットは回復できる。"
    )
);
check(
  "conditional_cost 代替回復の制限を親へ広げる壊れた表現はreviewに残す",
  () => {
    const found = detect(
      effect(
        [
          { id: "select", action: { kind: "noop" } },
          { id: "cost", action: { kind: "set_self_as_mirage" } },
          {
            id: "send",
            action: { kind: "send_to_deck" },
            connector: "conditional_cost",
            conditionalCostAlternativeStepIds: ["recover"],
            stepCondition: { kind: "ref_executed", stepId: "cost" },
          },
          {
            id: "recover",
            action: { kind: "recover" },
            executionMode: "optional",
            stepCondition: { kind: "ref_executed", stepId: "cost" },
          },
        ],
        { usageLimit: { kind: "per_instance", duration: "turn" } }
      ),
      [
        "ミラージュをセットすることで、相手のスピリット2体までをデッキの下に戻し、ターンに1回、このスピリットは回復できる。",
      ]
    );
    assert.ok(issue(found, "usage_constraint_mismatch", "review"));
  }
);
check(
  "さらに節でも任意noop gateと後続が連結していなければ回数制限を充足しない",
  () => {
    const issueFound = issue(
      detect(
        effect([
          { action: { kind: "count_increase", amount: 1 } },
          {
            id: "once-per-turn",
            action: { kind: "noop" },
            executionMode: "optional",
            usageLimit: { kind: "per_instance", duration: "turn" },
            connector: "sequential",
          },
          { action: { kind: "draw", count: 2 }, connector: "sequential" },
        ]),
        [
          "自分のカウント+1する。さらに、ターンに1回、自分はデッキを上から2枚ドローできる。",
        ]
      ),
      "usage_constraint_mismatch",
      "review"
    );
    assert.ok(issueFound);
  }
);
check("単一stepでもaction配下の回数を所属不明のまま断定しない", () => {
  const found = detect(
    effect([{ action: { kind: "draw", count: 1, usageLimit: turn } }]),
    ["〔ターンに1回：同名〕1枚ドローする。"]
  );
  assert.ok(issue(found, "usage_constraint_mismatch", "review"));
  assert.ok(found.every((entry) => entry.severity !== "violation"));
});
check("promptで一意に帰属した後段の回数を検査", () => {
  const text = "〔ターンに1回：同名〕1枚ドローできる。";
  const value = effect([
    { action: { kind: "count_increase", amount: 1 } },
    {
      action: { kind: "draw", count: 1 },
      prompt: { sourceText: text },
      usageLimit: { kind: "per_instance" },
    },
  ]);
  const found = issue(
    detect(value, [`カウント+1する。${text}`]),
    "usage_constraint_mismatch"
  );
  assert.equal(found.path, "$.steps[1].usageLimit");
});
check("正しいprompt所属の後段制限は通る", () => {
  const text = "〔ターンに1回：同名〕1枚ドローできる。";
  none(
    effect([
      { action: { kind: "count_increase", amount: 1 } },
      {
        action: { kind: "draw", count: 1 },
        prompt: { sourceText: text },
        usageLimit: turn,
      },
    ]),
    `カウント+1する。${text}`
  );
});
check("共有textRefの後段carrierは先行Effectへ回数制限を誤適用しない", () => {
  const trailing = "〔ターンに1回：同名〕1枚ドローできる。";
  const source = effect([{ action: { kind: "count_increase", amount: 1 } }]);
  const trailingEffect = effect(
    [
      {
        prompt: { sourceText: trailing },
        action: { kind: "draw", count: 1 },
      },
      {
        prompt: { sourceText: trailing },
        action: { kind: "recover" },
      },
    ],
    { usageLimit: turn }
  );
  const text = `カウント+1する。${trailing}`;
  none(source, text, { siblingEffects: [source, trailingEffect] });
  none(trailingEffect, text, { siblingEffects: [source, trailingEffect] });
});
check(
  "共有textRefの担当carrierは複数の先行トリガーから回数制限を分離する",
  () => {
    const drawClause =
      "自分のクォーツがセットされたとき、〔ターンに2回：同名〕自分はデッキの上から1枚ドローできる。";
    const text =
      "このカードが魂状態になったときと、自分のスタートステップに、自分のカウント+2する。また、" +
      drawClause;
    const start = effect([{ action: { kind: "count_increase", amount: 2 } }]);
    const enteredSoulState = effect([
      { action: { kind: "count_increase", amount: 2 } },
    ]);
    const quartzSetDraw = effect(
      [
        {
          prompt: { sourceText: drawClause },
          action: { kind: "draw", count: 1 },
        },
      ],
      {
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 2,
        },
      }
    );
    const siblings = [start, enteredSoulState, quartzSetDraw];
    for (const current of siblings)
      none(current, text, { siblingEffects: siblings });
  }
);
check(
  "共有textRefの担当carrierを失うと先行トリガーの制限帰属をreviewする",
  () => {
    const drawClause =
      "自分のクォーツがセットされたとき、〔ターンに2回：同名〕自分はデッキの上から1枚ドローできる。";
    const text =
      "このカードが魂状態になったときと、自分のスタートステップに、自分のカウント+2する。また、" +
      drawClause;
    const start = effect([{ action: { kind: "count_increase", amount: 2 } }]);
    const enteredSoulState = effect([
      { action: { kind: "count_increase", amount: 2 } },
    ]);
    const quartzSetDraw = effect([{ action: { kind: "draw", count: 1 } }], {
      usageLimit: {
        kind: "per_card_name",
        duration: "turn",
        maxCount: 2,
      },
    });
    const siblings = [start, enteredSoulState, quartzSetDraw];
    assert.ok(
      issue(
        detect(start, [text], { siblingEffects: siblings }),
        "usage_constraint_mismatch",
        "review"
      )
    );
    assert.ok(
      issue(
        detect(enteredSoulState, [text], { siblingEffects: siblings }),
        "usage_constraint_mismatch",
        "review"
      )
    );
  }
);
check(
  "共有textRefの後段carrierを失うと先行Effectの制限所属をreviewする",
  () => {
    const trailing = "〔ターンに1回：同名〕1枚ドローできる。";
    const source = effect([{ action: { kind: "count_increase", amount: 1 } }]);
    const missingCarrier = effect([{ action: { kind: "draw", count: 1 } }], {
      usageLimit: turn,
    });
    const found = detect(source, [`カウント+1する。${trailing}`], {
      siblingEffects: [source, missingCarrier],
    });
    assert.ok(issue(found, "usage_constraint_mismatch", "review"));
  }
);
check(
  "「その後」の末尾手順だけにある回数制限を正しい所属として認識する",
  () => {
    const text =
      "自分のカウント+2し、自分はデッキの上から1枚ドローできる。その後、ターンに1回、このスピリットのBP以下の相手のスピリット1体を破壊できる。";
    none(
      effect([
        { action: { kind: "count_increase", amount: 2 } },
        {
          action: { kind: "draw", count: 1 },
          executionMode: "optional",
          connector: "simultaneous",
        },
        {
          action: { kind: "destroy" },
          connector: "sequential",
          executionMode: "optional",
          usageLimit: { kind: "per_instance", duration: "turn" },
        },
      ]),
      text
    );
  }
);
check(
  "「さらに」の末尾手順だけにあるステップ制限を正しい所属として認識する",
  () => {
    const text =
      "このスピリットに黒シンボル1つを追加する。さらに、ステップに1回、このスピリットは回復できる。";
    none(
      effect([
        { action: { kind: "symbol_add", symbol: "black" } },
        {
          action: { kind: "recover", target: { kind: "self" } },
          connector: "simultaneous",
          executionMode: "optional",
          usageLimit: { kind: "per_instance", duration: "step" },
        },
      ]),
      text
    );
  }
);
check("「さらに」の末尾回復をターン制限へ誤変換すると検出する", () => {
  const text =
    "このスピリットに黒シンボル1つを追加する。さらに、ステップに1回、このスピリットは回復できる。";
  const found = issue(
    detect(
      effect([
        { action: { kind: "symbol_add", symbol: "black" } },
        {
          action: { kind: "recover", target: { kind: "self" } },
          connector: "simultaneous",
          executionMode: "optional",
          usageLimit: { kind: "per_instance", duration: "turn" },
        },
      ]),
      [text]
    ),
    "usage_constraint_mismatch",
    "review"
  );
  assert.equal(found.severity, "review");
  assert.match(found.evidence, /"duration":"step"/);
});
check("「さらに」の回数制限を親 Effect に重ねて前段を制限しない", () => {
  const text =
    "このスピリットに黒シンボル1つを追加する。さらに、ステップに1回、このスピリットは回復できる。";
  const limit = { kind: "per_instance", duration: "step" };
  const found = issue(
    detect(
      effect(
        [
          { action: { kind: "symbol_add", symbol: "black" } },
          {
            action: { kind: "recover", target: { kind: "self" } },
            connector: "simultaneous",
            executionMode: "optional",
            usageLimit: limit,
          },
        ],
        { usageLimit: limit }
      ),
      [text]
    ),
    "usage_scope_review",
    "review"
  );
  assert.ok(found);
  assert.equal(found.path, "$.usageLimit");
  assert.match(found.evidence, /親の制限が他の手順にも及ぶ=true/);
});
check(
  "「そうしたとき」の末尾回復だけにある個体ターン制限を正しい所属として認識する",
  () => {
    const text =
      "トラッシュのコア2個をこのスピリットに置ける。そうしたとき、ボイドからコア1個を自分のライフに置き、ターンに1回、このスピリットは回復する。";
    none(
      effect([
        { id: "move-trash-cores", action: { kind: "core_move" } },
        { connector: "conditional_result", action: { kind: "core_move" } },
        {
          connector: "sequential",
          stepCondition: { kind: "ref_succeeded", stepId: "move-trash-cores" },
          usageLimit: { kind: "per_instance", duration: "turn" },
          action: { kind: "recover", target: { kind: "self" } },
        },
      ]),
      text
    );
  }
);
check(
  "「そうしたとき」の回復制限を親 Effect に広げた壊れた carrier は検出する",
  () => {
    const text =
      "トラッシュのコア2個をこのスピリットに置ける。そうしたとき、ボイドからコア1個を自分のライフに置き、ターンに1回、このスピリットは回復する。";
    const found = issue(
      detect(
        effect(
          [
            { id: "move-trash-cores", action: { kind: "core_move" } },
            { connector: "conditional_result", action: { kind: "core_move" } },
            {
              connector: "sequential",
              stepCondition: {
                kind: "ref_succeeded",
                stepId: "move-trash-cores",
              },
              action: { kind: "recover", target: { kind: "self" } },
            },
          ],
          { usageLimit: { kind: "per_instance", duration: "turn" } }
        ),
        [text]
      ),
      "usage_constraint_mismatch"
    );
    assert.ok(found);
    assert.equal(found.severity, "violation");
  }
);
check(
  "成功数条件の後段だけにある個体ターン制限を正しい所属として認識する",
  () => {
    const text =
      "相手のスピリットを好きなだけ破壊する。1体以上破壊したとき、ターンに1回、相手のライフのコア1個をリザーブに置ける。";
    none(
      effect([
        { id: "destroy", action: { kind: "destroy" } },
        {
          connector: "after_triggers",
          stepCondition: { kind: "ref_count", stepId: "destroy", min: 1 },
          usageLimit: { kind: "per_instance", duration: "turn" },
          action: { kind: "core_move" },
        },
      ]),
      text
    );
  }
);
check(
  "state check 後の成功数条件にある個体ターン制限を正しい所属として認識する",
  () => {
    const text =
      "相手のスピリットを好きなだけ破壊する。1体以上破壊したとき、ターンに1回、相手のライフのコア1個をリザーブに置ける。";
    none(
      effect([
        { id: "destroy", action: { kind: "destroy" } },
        {
          connector: "after_state_check",
          stepCondition: { kind: "ref_count", stepId: "destroy", min: 1 },
          usageLimit: { kind: "per_instance", duration: "turn" },
          action: { kind: "core_move" },
        },
      ]),
      text
    );
  }
);
check(
  "state check 後の成功数条件で前段参照を失った制限 carrier は review に残す",
  () => {
    const text =
      "相手のスピリットを好きなだけ破壊する。1体以上破壊したとき、ターンに1回、相手のライフのコア1個をリザーブに置ける。";
    const found = issue(
      detect(
        effect([
          { id: "destroy", action: { kind: "destroy" } },
          {
            connector: "after_state_check",
            stepCondition: { kind: "ref_count", stepId: "wrong-step", min: 1 },
            usageLimit: { kind: "per_instance", duration: "turn" },
            action: { kind: "core_move" },
          },
        ]),
        [text]
      ),
      "usage_constraint_mismatch",
      "review"
    );
    assert.ok(found);
  }
);
check("成功数条件の後段制限を同名共有へ誤変換した carrier は検出する", () => {
  const text =
    "相手のスピリットを好きなだけ破壊する。1体以上破壊したとき、ターンに1回、相手のライフのコア1個をリザーブに置ける。";
  const found = issue(
    detect(
      effect([
        { id: "destroy", action: { kind: "destroy" } },
        {
          connector: "after_triggers",
          stepCondition: { kind: "ref_count", stepId: "destroy", min: 1 },
          usageLimit: { kind: "per_card_name", duration: "turn" },
          action: { kind: "core_move" },
        },
      ]),
      [text]
    ),
    "usage_constraint_mismatch"
  );
  assert.equal(found.severity, "violation");
  assert.equal(found.path, "$.usageLimit");
});
check(
  "成功数条件の後段制限を親 Effect に重ねた carrier は scope review に残す",
  () => {
    const text =
      "相手のスピリットを好きなだけ破壊する。1体以上破壊したとき、ターンに1回、相手のライフのコア1個をリザーブに置ける。";
    const found = issue(
      detect(
        effect(
          [
            { id: "destroy", action: { kind: "destroy" } },
            {
              connector: "after_triggers",
              stepCondition: {
                kind: "ref_count",
                stepId: "destroy",
                min: 1,
              },
              usageLimit: { kind: "per_instance", duration: "turn" },
              action: { kind: "core_move" },
            },
          ],
          { usageLimit: { kind: "per_instance", duration: "turn" } }
        ),
        [text]
      ),
      "usage_scope_review",
      "review"
    );
    assert.equal(found.path, "$.usageLimit");
  }
);
const paidCostThresholdLimitText =
  "3コストまで支払うことで、支払ったコストにより以下の効果を発揮する。1コスト以上：相手のスピリット1体のコア1個をリザーブに置く。2コスト以上：相手のネクサス1つのコアすべてをボイドに置く。3コスト：〔ターンに1回：同名〕このスピリットを手札に戻し、自分のトラッシュのカード1枚を手札に戻す。";
const paidCostThresholdLimitCarrier = (usageLimit = turn, rootExtra = {}) =>
  effect(
    [
      {
        id: "paid-cost",
        action: { kind: "noop" },
        choice: [
          { action: { kind: "pay_cost", amount: 1 } },
          { action: { kind: "pay_cost", amount: 2 } },
          { action: { kind: "pay_cost", amount: 3 } },
        ],
      },
      {
        action: { kind: "core_move" },
        stepCondition: {
          kind: "all",
          conditions: [
            { kind: "ref_choice", stepId: "paid-cost", choiceIndex: 1 },
            { kind: "ref_succeeded", stepId: "paid-cost" },
          ],
        },
      },
      {
        id: "pay3-bounce-self",
        action: { kind: "bounce", target: { kind: "self" } },
        usageLimit,
        stepCondition: {
          kind: "all",
          conditions: [
            { kind: "ref_choice", stepId: "paid-cost", choiceIndex: 3 },
            { kind: "ref_succeeded", stepId: "paid-cost" },
          ],
        },
      },
      {
        action: { kind: "bounce", target: { kind: "filter" } },
        stepCondition: { kind: "ref_succeeded", stepId: "pay3-bounce-self" },
      },
    ],
    rootExtra
  );
check("支払い閾値節の同名制限は3コスト段と従属処理だけに所属する", () =>
  none(paidCostThresholdLimitCarrier(), paidCostThresholdLimitText)
);
check("支払い閾値節の同名制限を個体制限へ誤変換すると検知する", () => {
  const found = issue(
    detect(
      paidCostThresholdLimitCarrier({ kind: "per_instance", duration: "turn" }),
      [paidCostThresholdLimitText]
    ),
    "usage_constraint_mismatch"
  );
  assert.equal(found.path, "$.usageLimit");
  assert.equal(found.severity, "violation");
});
check("支払い閾値節の制限を親Effectへ広げるとscope reviewに残す", () => {
  const found = issue(
    detect(paidCostThresholdLimitCarrier(turn, { usageLimit: turn }), [
      paidCostThresholdLimitText,
    ]),
    "usage_scope_review",
    "review"
  );
  assert.equal(found.path, "$.usageLimit");
  assert.match(found.evidence, /親の制限が他の手順にも及ぶ=true/);
});
check("「その後」の末尾手順で同名共有へ誤変換した回数制限は検出する", () => {
  const text =
    "自分のカウント+2し、自分はデッキの上から1枚ドローできる。その後、ターンに1回、このスピリットのBP以下の相手のスピリット1体を破壊できる。";
  const found = issue(
    detect(
      effect([
        { action: { kind: "count_increase", amount: 2 } },
        {
          action: { kind: "draw", count: 1 },
          executionMode: "optional",
          connector: "simultaneous",
        },
        {
          action: { kind: "destroy" },
          connector: "sequential",
          executionMode: "optional",
          usageLimit: { kind: "per_card_name", duration: "turn" },
        },
      ]),
      [text]
    ),
    "usage_constraint_mismatch"
  );
  assert.equal(found.path, "$.usageLimit");
  assert.equal(found.severity, "violation");
});
check("先行と「その後」の同一軸制限は後段stepだけでは両方を満たさない", () => {
  const text =
    "ターンに1回、自分はデッキの上から1枚ドローできる。その後、ターンに1回、相手のスピリット1体を破壊できる。";
  const found = issue(
    detect(
      effect([
        { action: { kind: "draw", count: 1 }, executionMode: "optional" },
        {
          action: { kind: "destroy" },
          connector: "sequential",
          executionMode: "optional",
          usageLimit: { kind: "per_instance", duration: "turn" },
        },
      ]),
      [text]
    ),
    "usage_constraint_mismatch",
    "review"
  );
  assert.equal(found.path, "$.usageLimit");
  assert.match(found.evidence, /別手順=\[\]/);
});
check(
  "「その後」の回数制限が成功時の従属手順を伴っても正しい所属を保つ",
  () => {
    const text =
      "自分のカウント+1する。その後、ターンに1回、自分はデッキの上から2枚ドローできる。ドロー後、自分は手札1枚を破棄する。";
    none(
      effect([
        { action: { kind: "count_increase", amount: 1 } },
        {
          id: "draw",
          connector: "sequential",
          executionMode: "optional",
          usageLimit: { kind: "per_instance", duration: "turn" },
          action: { kind: "draw", count: 2 },
        },
        {
          connector: "sequential",
          stepCondition: { kind: "ref_succeeded", stepId: "draw" },
          action: { kind: "discard", count: 1 },
        },
      ]),
      text
    );
  }
);
check(
  "「その後」の回数制限が同一usageGroupの複数手順に掛かっても正しい所属を保つ",
  () => {
    const text =
      "自分のカウント+1する。その後、ターンに1回、相手のネクサス2つを破壊でき、自分はデッキの上から2枚ドローできる。";
    none(
      effect([
        { action: { kind: "count_increase", amount: 1 } },
        {
          id: "destroy",
          usageGroupId: "destroy-and-draw",
          connector: "sequential",
          executionMode: "optional",
          usageLimit: { kind: "per_instance", duration: "turn" },
          action: { kind: "destroy" },
        },
        {
          usageGroupId: "destroy-and-draw",
          connector: "simultaneous",
          executionMode: "optional",
          usageLimit: { kind: "per_instance", duration: "turn" },
          action: { kind: "draw", count: 2 },
        },
      ]),
      text
    );
  }
);
const afterTriggeredLimitText =
  "相手のスピリット1体を手札に戻せる。さらに、この効果発揮後、〔ターンに1回：同名〕自分はデッキの上から1枚ドローできる。";
const afterTriggeredLimitCarrier = () =>
  effect([
    {
      id: "bounce",
      action: { kind: "bounce", target: { kind: "filter" } },
    },
    {
      id: "post-trigger-draw",
      connector: "after_triggers",
      usageLimit: turn,
      action: { kind: "draw", count: 1 },
    },
  ]);
check("この効果発揮後の同名制限はafter_triggers後段だけに所属する", () =>
  none(afterTriggeredLimitCarrier(), afterTriggeredLimitText)
);
check("この効果発揮後でも後段usageLimitが欠落すればreviewを残す", () => {
  const broken = afterTriggeredLimitCarrier();
  delete broken.steps[1].usageLimit;
  assert.ok(
    issue(
      detect(broken, [afterTriggeredLimitText]),
      "usage_constraint_mismatch",
      "review"
    )
  );
});
check("この効果発揮後をsequentialで表す偽carrierは認めない", () => {
  const broken = afterTriggeredLimitCarrier();
  broken.steps[1].connector = "sequential";
  assert.ok(
    issue(
      detect(broken, [afterTriggeredLimitText]),
      "usage_constraint_mismatch",
      "review"
    )
  );
});
check("無関係なafter_triggers制限で無制限の後段節を充足扱いにしない", () => {
  const broken = effect([
    { id: "bounce", action: { kind: "bounce", target: { kind: "filter" } } },
    {
      id: "unrelated-after-trigger",
      connector: "after_triggers",
      usageLimit: turn,
      action: { kind: "count_increase", amount: 1 },
    },
    { action: { kind: "draw", count: 1 } },
  ]);
  assert.ok(
    issue(
      detect(broken, [afterTriggeredLimitText]),
      "usage_constraint_mismatch",
      "review"
    )
  );
});
check("この効果発揮後の同名制限を親Effectにも重ねて前段を制限しない", () => {
  const broken = afterTriggeredLimitCarrier();
  broken.usageLimit = turn;
  const found = issue(
    detect(broken, [afterTriggeredLimitText]),
    "usage_scope_review",
    "review"
  );
  assert.ok(found);
  assert.equal(found.path, "$.usageLimit");
  assert.match(found.evidence, /親の制限が他の手順にも及ぶ=true/);
});
const conditionedAfterTriggeredLimitText =
  "相手のスピリット1体を重疲労でき、相手のトラッシュにあるカード1枚を除外できる。この効果発揮後、このスピリットがLv2以上でバトル中のとき〔ターンに1回：同名〕このスピリットを手札に戻せる。";
const conditionedAfterTriggeredLimitCarrier = () =>
  effect([
    {
      action: { kind: "exhaust", target: { kind: "filter" } },
      executionMode: "optional",
    },
    {
      action: { kind: "remove_from_game", target: { kind: "filter" } },
      connector: "simultaneous",
      executionMode: "optional",
    },
    {
      id: "post-trigger-bounce",
      connector: "after_triggers",
      usageLimit: turn,
      condition: [{ kind: "min_level", value: 2 }],
      action: { kind: "bounce", target: { kind: "self" } },
    },
  ]);
check("条件句を挟むこの効果発揮後の同名制限を後段carrierへ帰属する", () =>
  none(
    conditionedAfterTriggeredLimitCarrier(),
    conditionedAfterTriggeredLimitText
  )
);
check("条件句を挟むこの効果発揮後でも後段carrierを欠けばreviewを残す", () => {
  const broken = conditionedAfterTriggeredLimitCarrier();
  delete broken.steps[2].usageLimit;
  assert.ok(
    issue(
      detect(broken, [conditionedAfterTriggeredLimitText]),
      "usage_constraint_mismatch",
      "review"
    )
  );
});
check(
  "条件句を挟むこの効果発揮後の制限を親へ広げる偽carrierをreviewする",
  () => {
    const broken = conditionedAfterTriggeredLimitCarrier();
    broken.usageLimit = turn;
    assert.ok(
      issue(
        detect(broken, [conditionedAfterTriggeredLimitText]),
        "usage_scope_review",
        "review"
      )
    );
  }
);
check("条件付き後段のsourceTextはゲーム同名制限をそのstepへ帰属する", () => {
  const text =
    "この効果で自分のアルティメットを戻したとき、〔ゲームに1回：同名〕その本来のコスト1につきコア1個を置く。";
  const steps = [
    { id: "bounce", action: { kind: "send_to_deck" } },
    {
      stepCondition: { kind: "ref_has_match", stepId: "bounce" },
      prompt: { sourceText: text },
      usageLimit: { kind: "per_card_name", duration: "game" },
      action: { kind: "core_move" },
    },
  ];
  none(effect(steps), `対象1体をデッキの下に戻す。${text}`);

  const wrongScope = issue(
    detect(
      effect([
        steps[0],
        {
          ...steps[1],
          usageLimit: { kind: "per_instance", duration: "game" },
        },
      ]),
      [`対象1体をデッキの下に戻す。${text}`]
    ),
    "usage_constraint_mismatch"
  );
  assert.equal(wrongScope.path, "$.steps[1].usageLimit");
  assert.equal(wrongScope.severity, "violation");
});
check("条件付き後段の同名ゲーム制限は親の個体ターン制限と独立する", () => {
  const trailingText =
    "この効果で「ヴァース」を破壊したとき、［ゲームに1回同名］自分はデッキの上から3枚ドローする。";
  const steps = [
    { id: "destroy-grandwalker", action: { kind: "destroy" } },
    {
      stepCondition: {
        kind: "ref_has_match",
        stepId: "destroy-grandwalker",
      },
      prompt: { sourceText: trailingText },
      usageLimit: { kind: "per_card_name", duration: "game" },
      action: { kind: "draw", count: 3 },
    },
  ];
  const text = `ターンに1回、自分のターンなら、創界神ネクサス2つまでを破壊する。${trailingText}`;
  none(
    effect(steps, {
      usageLimit: { kind: "per_instance", duration: "turn" },
    }),
    text
  );

  const wrongScope = issue(
    detect(
      effect(
        [
          steps[0],
          {
            ...steps[1],
            usageLimit: { kind: "per_instance", duration: "game" },
          },
        ],
        { usageLimit: { kind: "per_instance", duration: "turn" } }
      ),
      [text]
    ),
    "usage_constraint_mismatch"
  );
  assert.equal(wrongScope.path, "$.steps[1].usageLimit");
  assert.equal(wrongScope.severity, "violation");
});
check(
  "後段だけをpromptへ帰属しても、本文にない親の回数制限はreviewに残す",
  () => {
    const trailingText =
      "この効果で「ヴァース」を破壊したとき、［ゲームに1回同名］自分はデッキの上から3枚ドローする。";
    const found = issue(
      detect(
        effect(
          [
            { id: "destroy-grandwalker", action: { kind: "destroy" } },
            {
              stepCondition: {
                kind: "ref_has_match",
                stepId: "destroy-grandwalker",
              },
              prompt: { sourceText: trailingText },
              usageLimit: { kind: "per_card_name", duration: "game" },
              action: { kind: "draw", count: 3 },
            },
          ],
          { usageLimit: { kind: "per_instance", duration: "turn" } }
        ),
        [`創界神ネクサス1つを破壊する。${trailingText}`]
      ),
      "usage_extra_constraint_review",
      "review"
    );
    assert.equal(found.path, "$.usageLimit");
    assert.match(found.evidence, /per_instance/);
  }
);
check("選択肢のpromptは選択肢だけのステップ同名制限を本文へ帰属する", () => {
  const drawText =
    "〔ステップに1回:同名〕自分はデッキの上から2枚ドローできる。";
  none(
    effect([
      {
        action: { kind: "recover", target: { kind: "self" } },
        choice: [
          {
            prompt: { sourceText: drawText },
            usageLimit: { kind: "per_card_name", duration: "step" },
            action: { kind: "draw", player: "self", count: 2 },
          },
        ],
      },
    ]),
    `このスピリットを回復させるか、${drawText}`
  );
});
check("選択肢のpromptでも個体制限への誤変換は検知する", () => {
  const drawText =
    "〔ステップに1回:同名〕自分はデッキの上から2枚ドローできる。";
  const found = issue(
    detect(
      effect([
        {
          action: { kind: "recover", target: { kind: "self" } },
          choice: [
            {
              prompt: { sourceText: drawText },
              usageLimit: { kind: "per_instance", duration: "step" },
              action: { kind: "draw", player: "self", count: 2 },
            },
          ],
        },
      ]),
      [`このスピリットを回復させるか、${drawText}`]
    ),
    "usage_constraint_mismatch"
  );
  assert.equal(found.path, "$.steps[0].choice[0].usageLimit");
  assert.equal(found.severity, "violation");
});
check("または後段だけの同名ゲーム制限をchoice carrierとして認識する", () => {
  const text =
    "相手のバースト1つを手札に戻せる。または、〔ゲームに1回:同名〕このターンの間、相手はスタック効果を発揮できない。";
  none(
    effect([
      {
        action: { kind: "discard_set_burst", player: "opponent" },
        choice: [
          {
            action: {
              kind: "restrict_stack",
              player: "opponent",
              duration: { scope: "turn" },
            },
            usageLimit: {
              kind: "per_card_name",
              duration: "game",
              maxCount: 1,
            },
          },
        ],
      },
    ]),
    text
  );
});
check("または後段だけの同名ゲーム制限を個体制限にすると検知する", () => {
  const text =
    "相手のバースト1つを手札に戻せる。または、〔ゲームに1回:同名〕このターンの間、相手はスタック効果を発揮できない。";
  const found = issue(
    detect(
      effect([
        {
          action: { kind: "discard_set_burst", player: "opponent" },
          choice: [
            {
              action: {
                kind: "restrict_stack",
                player: "opponent",
                duration: { scope: "turn" },
              },
              usageLimit: {
                kind: "per_instance",
                duration: "game",
                maxCount: 1,
              },
            },
          ],
        },
      ]),
      [text]
    ),
    "usage_constraint_mismatch"
  );
  assert.equal(found.path, "$.usageLimit");
  assert.equal(found.severity, "violation");
});
check("または後段だけの制限を親へ重ねると前段まで狭めるためreviewする", () => {
  const text =
    "相手のバースト1つを手札に戻せる。または、〔ゲームに1回:同名〕このターンの間、相手はスタック効果を発揮できない。";
  const found = issue(
    detect(
      effect(
        [
          {
            action: { kind: "discard_set_burst", player: "opponent" },
            choice: [
              {
                action: {
                  kind: "restrict_stack",
                  player: "opponent",
                  duration: { scope: "turn" },
                },
                usageLimit: {
                  kind: "per_card_name",
                  duration: "game",
                  maxCount: 1,
                },
              },
            ],
          },
        ],
        {
          usageLimit: {
            kind: "per_card_name",
            duration: "game",
            maxCount: 1,
          },
        }
      ),
      [text]
    ),
    "usage_scope_review",
    "review"
  );
  assert.equal(found.path, "$.usageLimit");
  assert.match(found.evidence, /親の制限が他の手順にも及ぶ=true/);
});
check(
  "または枝のusageLimitはref_choiceで後段へ接続しても正しい所属を保つ",
  () => {
    const text =
      "自分は1枚ドローできる。または、〔ゲームに1回:同名〕自分のカウント+1することで、このターンの間、相手のスピリットのBPを-3000する。";
    none(
      effect([
        {
          id: "mode",
          action: { kind: "draw", count: 1 },
          choice: [
            {
              action: { kind: "count_increase", amount: 1 },
              usageLimit: { kind: "per_card_name", duration: "game" },
            },
          ],
        },
        {
          connector: "conditional_cost",
          stepCondition: { kind: "ref_choice", stepId: "mode", choiceIndex: 1 },
          action: { kind: "bp_modify", amount: -3000 },
        },
      ]),
      text
    );
  }
);
check("または枝の後段が別choiceを参照した壊れたcarrierはreviewを残す", () => {
  const text =
    "自分は1枚ドローできる。または、〔ゲームに1回:同名〕自分のカウント+1することで、このターンの間、相手のスピリットのBPを-3000する。";
  const found = issue(
    detect(
      effect([
        {
          id: "mode",
          action: { kind: "draw", count: 1 },
          choice: [
            {
              action: { kind: "count_increase", amount: 1 },
              usageLimit: { kind: "per_card_name", duration: "game" },
            },
          ],
        },
        {
          connector: "conditional_cost",
          stepCondition: { kind: "ref_choice", stepId: "mode", choiceIndex: 0 },
          action: { kind: "bp_modify", amount: -3000 },
        },
      ]),
      [text]
    ),
    "usage_constraint_mismatch",
    "review"
  );
  assert.ok(found);
});
check("手札追加なしの後段ステップ制限をref_count carrierとして認識する", () => {
  const text =
    "自分のデッキを上から3枚オープンできる。その後、手札に加えなかったとき、〔ステップに1回:同名〕自分は1枚ドローできる。";
  none(
    effect([
      { id: "reveal", action: { kind: "deck_reveal", revealCount: 3 } },
      {
        stepCondition: {
          kind: "ref_count",
          stepId: "reveal",
          result: "hand_added",
          min: 0,
          max: 0,
        },
        usageLimit: { kind: "per_card_name", duration: "step" },
        action: { kind: "draw", count: 1 },
      },
    ]),
    text
  );
});
check("手札追加なしの後段が別stepを参照した壊れたcarrierはreviewを残す", () => {
  const text =
    "自分のデッキを上から3枚オープンできる。その後、手札に加えなかったとき、〔ステップに1回:同名〕自分は1枚ドローできる。";
  const found = issue(
    detect(
      effect([
        { id: "reveal", action: { kind: "deck_reveal", revealCount: 3 } },
        {
          stepCondition: {
            kind: "ref_count",
            stepId: "wrong-reveal",
            result: "hand_added",
            min: 0,
            max: 0,
          },
          usageLimit: { kind: "per_card_name", duration: "step" },
          action: { kind: "draw", count: 1 },
        },
      ]),
      [text]
    ),
    "usage_constraint_mismatch",
    "review"
  );
  assert.ok(found);
});
check(
  "ドロー不成立の後段ステップ制限を反転choice carrierとして認識する",
  () => {
    const text =
      "自分はデッキの下から2枚ドローできる。または、自分のカウント+1する。その後、ドローしなかったとき、〔ステップに1回:同名〕自分は1枚ドローできる。";
    none(
      effect([
        {
          id: "mode",
          action: { kind: "draw", count: 2 },
          choice: [{ action: { kind: "count_increase", amount: 1 } }],
        },
        {
          connector: "sequential",
          stepCondition: {
            kind: "all",
            conditions: [
              { kind: "ref_choice", stepId: "mode", choiceIndex: 0 },
              { kind: "ref_succeeded", stepId: "mode" },
            ],
            not: true,
          },
          usageLimit: { kind: "per_card_name", duration: "step" },
          action: { kind: "draw", count: 1 },
        },
      ]),
      text
    );
  }
);
check("ドロー不成立の反転条件を失った壊れたcarrierはreviewを残す", () => {
  const text =
    "自分はデッキの下から2枚ドローできる。または、自分のカウント+1する。その後、ドローしなかったとき、〔ステップに1回:同名〕自分は1枚ドローできる。";
  const found = issue(
    detect(
      effect([
        {
          id: "mode",
          action: { kind: "draw", count: 2 },
          choice: [{ action: { kind: "count_increase", amount: 1 } }],
        },
        {
          connector: "sequential",
          stepCondition: {
            kind: "all",
            conditions: [
              { kind: "ref_choice", stepId: "mode", choiceIndex: 0 },
              { kind: "ref_succeeded", stepId: "mode" },
            ],
            not: false,
          },
          usageLimit: { kind: "per_card_name", duration: "step" },
          action: { kind: "draw", count: 1 },
        },
      ]),
      [text]
    ),
    "usage_constraint_mismatch",
    "review"
  );
  assert.ok(found);
});
check(
  "親の同名ターン制限は選択肢全体とref_choice後続を一意に制限できる",
  () => {
    const text =
      "〔ターンに1回：同名〕自分のデッキを上から6枚オープンし、その中のカード名：「アルドノアドライブ」すべてと系統：「ＣＦ」持つアルティメットカード1枚を手札に加え、残ったカードはデッキの下に戻す。または、トラッシュにあるカード名：「アルドノアドライブ」1枚と系統：「ＣＦ」を持つアルティメットカード1枚を手札に戻す。";
    none(
      effect(
        [
          {
            id: "mode",
            action: { kind: "deck_reveal", revealCount: 6 },
            choice: [
              {
                action: { kind: "move_card", target: { kind: "filter" } },
              },
            ],
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "ref_choice",
              stepId: "mode",
              choiceIndex: 1,
            },
            action: { kind: "move_card", target: { kind: "filter" } },
          },
        ],
        { usageLimit: turn }
      ),
      text
    );
  }
);
check("選択肢全体を誤って個体制限にした例は未確認のまま残す", () => {
  const text =
    "〔ターンに1回：同名〕自分のデッキを上から6枚オープンする。または、トラッシュにあるカード1枚を手札に戻す。";
  const found = issue(
    detect(
      effect(
        [
          {
            id: "mode",
            action: { kind: "deck_reveal", revealCount: 6 },
            choice: [
              {
                action: { kind: "move_card", target: { kind: "filter" } },
              },
            ],
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "ref_choice",
              stepId: "mode",
              choiceIndex: 1,
            },
            action: { kind: "move_card", target: { kind: "filter" } },
          },
        ],
        { usageLimit: { kind: "per_instance", duration: "turn" } }
      ),
      [text]
    ),
    "usage_constraint_mismatch",
    "review"
  );
  assert.ok(found);
});
check(
  "choice の後段だけを制限する本文は root usageLimit で確定扱いにしない",
  () => {
    const text =
      "1枚ドローする。または、カード1枚を手札に戻す。その後、〔ターンに1回：同名〕自分はデッキの上から1枚ドローする。";
    const found = issue(
      detect(
        effect(
          [
            {
              id: "mode",
              action: { kind: "draw", count: 1 },
              choice: [
                {
                  action: { kind: "move_card", target: { kind: "filter" } },
                },
              ],
            },
            {
              connector: "sequential",
              action: { kind: "draw", count: 1 },
            },
          ],
          { usageLimit: turn }
        ),
        [text]
      ),
      "usage_scope_review",
      "review"
    );
    assert.ok(found);
  }
);
check(
  "後段だけの回数をrootから継承して前段まで制限する場合はscope review",
  () => {
    const text = "〔ターンに1回：同名〕カウント+1する。";
    const found = detect(
      effect(
        [
          { action: { kind: "draw", count: 1 } },
          {
            action: { kind: "count_increase", amount: 1 },
            prompt: { sourceText: text },
          },
        ],
        { usageLimit: turn }
      ),
      [`1枚ドローする。その後${text}`]
    );
    const review = issue(found, "usage_scope_review", "review");
    assert.ok(review);
    assert.equal(review.path, "$.steps[1].usageLimit");
    assert.match(review.evidence, /親の制限が他の手順にも及ぶ=true/);
  }
);
check("回数制約の欠落だけは外側carrierを参照できないのでreview", () => {
  const found = detect(effect(), ["〔ターンに1回：同名〕1枚ドローする。"]);
  assert.ok(issue(found, "usage_constraint_mismatch", "review"));
  assert.ok(found.every((entry) => entry.severity === "review"));
});
check("prompt分離後の制約句だけでは違反を断定しない", () => {
  const text = "1枚ドローする。";
  const found = detect(
    effect([
      { action: { kind: "draw", count: 1 }, prompt: { sourceText: text } },
    ]),
    [`〔ターンに1回：同名〕${text}`]
  );
  assert.ok(issue(found, "usage_constraint_mismatch", "review"));
  assert.ok(found.every((entry) => entry.severity === "review"));
});
check("本文が制限句だけなら誤ったownerに見えてもreview", () => {
  const found = detect(withLimit({ kind: "per_instance" }), [
    "〔ターンに1回：同名〕",
  ]);
  assert.ok(issue(found, "usage_constraint_mismatch", "review"));
  assert.ok(found.every((entry) => entry.severity === "review"));
});
check("内側grantの回数制限で外側を充足しない", () => {
  const value = effect([
    { action: { kind: "grant_effect", grantedEffect: withLimit(turn) } },
  ]);
  assert.ok(
    issue(
      detect(value, ["〔ターンに1回：同名〕効果を与える。"]),
      "usage_constraint_mismatch",
      "review"
    )
  );
});
check("内側Effectは自分のtextRefで検査する", () => {
  const inner = withLimit({ kind: "per_instance" }, { textRef: [1] });
  const found = detect(
    effect([{ action: { kind: "grant_effect", grantedEffect: inner } }]),
    ["次の効果を与える。", "〔ターンに1回：同名〕1枚ドローする。"]
  );
  assert.equal(
    issue(found, "usage_constraint_mismatch").path,
    "$.steps[0].action.grantedEffect.usageLimit"
  );
});
check("付与先が明示所有する回数文を親の制限欠落と誤認しない", () => {
  const inner = {
    timing: { kind: "activated", mode: "flash" },
    executionMode: "optional",
    usageLimit: { kind: "per_instance", duration: "turn" },
    steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
    textRef: [1],
  };
  assert.deepEqual(
    detect(
      effect([{ action: { kind: "grant_effect", grantedEffect: inner } }], {
        textRef: [0, 1],
      }),
      [
        "自分のスピリット1体を指定する。",
        "そのスピリットは、このターン中に1回、フラッシュタイミングで回復できる。",
      ]
    ),
    []
  );
});
check("付与先が所有する回数制限の欠落は内側 path で残す", () => {
  const inner = {
    timing: { kind: "activated", mode: "flash" },
    executionMode: "optional",
    steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
    textRef: [1],
  };
  const found = detect(
    effect([{ action: { kind: "grant_effect", grantedEffect: inner } }], {
      textRef: [0, 1],
    }),
    [
      "自分のスピリット1体を指定する。",
      "そのスピリットは、このターン中に1回、フラッシュタイミングで回復できる。",
    ]
  );
  const missing = issue(found, "usage_constraint_mismatch", "review");
  assert.equal(missing.path, "$.steps[0].action.grantedEffect.usageLimit");
  assert.equal(
    found.some((entry) => entry.path === "$.usageLimit"),
    false
  );
});
check(
  "引用句をsourceTextで明示した付与効果は外側と内側の回数制限を別scopeで認識する",
  () => {
    const quoted =
      "このスピリットは「ブロックされない」相手のスピリットをブロックできる。さらに、〔ターンに1回：同名〕フラッシュタイミングでこのスピリットは手札に戻せる。";
    const inner = {
      timing: { kind: "activated", mode: "flash" },
      usageLimit: turn,
      executionMode: "optional",
      steps: [{ action: { kind: "bounce", target: { kind: "self" } } }],
    };
    const value = effect(
      [
        { action: { kind: "summon", target: { kind: "self" } } },
        {
          prompt: { sourceText: quoted },
          action: { kind: "grant_effect", grantedEffect: inner },
        },
      ],
      { usageLimit: turn }
    );
    const text =
      '〔ターンに1回：同名〕自分のブレイヴ1枚を召喚できる。自分のスピリットに、"' +
      quoted +
      '"を与える。';
    none(value, text);
  }
);
check("引用句の付与回数を誤ったscopeへ変えた場合は内側pathで検知する", () => {
  const quoted =
    "さらに、〔ターンに1回：同名〕フラッシュタイミングでこのスピリットは手札に戻せる。";
  const value = effect(
    [
      { action: { kind: "summon", target: { kind: "self" } } },
      {
        prompt: { sourceText: quoted },
        action: {
          kind: "grant_effect",
          grantedEffect: {
            timing: { kind: "activated", mode: "flash" },
            usageLimit: { kind: "per_instance", duration: "turn" },
            steps: [{ action: { kind: "bounce", target: { kind: "self" } } }],
          },
        },
      },
    ],
    { usageLimit: turn }
  );
  const found = issue(
    detect(value, [
      '〔ターンに1回：同名〕自分のブレイヴ1枚を召喚できる。自分のスピリットに、"さらに、〔ターンに1回：同名〕フラッシュタイミングでこのスピリットは手札に戻せる。"を与える。',
    ]),
    "usage_constraint_mismatch"
  );
  assert.equal(found.path, "$.steps[1].action.grantedEffect.usageLimit");
});
check("合体中の回数上書きを本文どおりの条件付き carrier として認識", () => {
  const value = withLimit({
    ...turn,
    maxCountOverrides: [{ when: [{ kind: "combined" }], maxCount: 3 }],
  });
  const found = detect(value, [
    "〔ターンに1回：同名〕1枚ドローする。合体中、この効果を[ターンに3回]に変更する。",
  ]);
  assert.deepEqual(found, []);
});
check("カウント条件の回数加算を条件付き上限 carrier として認識", () => {
  const value = withLimit({
    ...game,
    maxCountOverrides: [
      {
        when: [{ kind: "count_value", player: "self", min: 5 }],
        maxCount: 2,
      },
    ],
  });
  none(
    value,
    "ゲーム中に1回、自分は1枚ドローできる。自分のカウント5以上のときこの効果をゲーム中にに発揮できる回数を+1する。"
  );
});
check("カウント条件の回数加算を別条件・別上限で実装すると候補を残す", () => {
  const value = withLimit({
    ...game,
    maxCountOverrides: [
      {
        when: [{ kind: "count_value", player: "self", min: 4 }],
        maxCount: 3,
      },
    ],
  });
  assert.ok(
    issue(
      detect(value, [
        "ゲーム中に1回、自分は1枚ドローできる。自分のカウント5以上のときこの効果をゲーム中にに発揮できる回数を+1する。",
      ]),
      "usage_constraint_mismatch",
      "review"
    )
  );
});
check("sourceText が分けた星霊衣の配置上限を入替手順へ誤帰属しない", () => {
  const placeText =
    "ゲーム中に1回、自分のカウント3以上のとき、このスピリットのブレイヴ1つを分離してこのカード/スピリットの下に裏面で置ける。自分のカウント5以上のときこの効果をゲーム中にに発揮できる回数を+1する。";
  const swapText =
    "下のカードは、フラッシュタイミングでこのスピリットのブレイヴ1つと入れ替えられ、フィールドを離れたとき、破棄する。";
  const place = effect(
    [
      {
        prompt: { sourceText: placeText },
        action: { kind: "place_star_garment" },
      },
    ],
    {
      usageLimit: {
        ...game,
        maxCountOverrides: [
          {
            when: [{ kind: "count_value", player: "self", min: 5 }],
            maxCount: 2,
          },
        ],
      },
    }
  );
  const swap = effect([
    {
      prompt: { sourceText: swapText },
      action: { kind: "swap_star_garment" },
    },
  ]);
  none(place, `${placeText}（${swapText}）`);
  none(swap, `${placeText}（${swapText}）`);
});
check("合体中の回数上書きが本文の回数と異なれば候補を残す", () => {
  const value = withLimit({
    ...turn,
    maxCountOverrides: [{ when: [{ kind: "combined" }], maxCount: 2 }],
  });
  assert.ok(
    issue(
      detect(value, [
        "〔ターンに1回：同名〕1枚ドローする。合体中、この効果を[ターンに3回]に変更する。",
      ]),
      "usage_constraint_mismatch",
      "review"
    )
  );
});
check(
  "合体以外の追加条件付き上書きを本文の合体中だけの変更として通さない",
  () => {
    const value = withLimit({
      ...turn,
      maxCountOverrides: [
        {
          when: [
            { kind: "combined" },
            { kind: "count_value", player: "self", min: 5 },
          ],
          maxCount: 3,
        },
      ],
    });
    assert.ok(
      issue(
        detect(value, [
          "〔ターンに1回：同名〕1枚ドローする。合体中、この効果を[ターンに3回]に変更する。",
        ]),
        "usage_constraint_mismatch",
        "review"
      )
    );
  }
);
check("実行不能なself_state上書きは合体中の正しいcarrierとして通さない", () => {
  const value = withLimit({
    ...turn,
    maxCountOverrides: [
      { when: [{ kind: "self_state", state: "combined" }], maxCount: 3 },
    ],
  });
  assert.ok(
    issue(
      detect(value, [
        "〔ターンに1回：同名〕1枚ドローする。合体中、この効果を[ターンに3回]に変更する。",
      ]),
      "usage_constraint_mismatch",
      "review"
    )
  );
});
check(
  "合体中上書きに加算dynamicを併記して非合体回数を増やす実装を通さない",
  () => {
    const value = withLimit({
      ...turn,
      maxCount: 1,
      maxCountAdditionalDynamic: {
        source: { kind: "count_value", player: "self" },
        divisor: 4,
      },
      maxCountOverrides: [{ when: [{ kind: "combined" }], maxCount: 3 }],
    });
    assert.ok(
      issue(
        detect(value, [
          "〔ターンに1回：同名〕1枚ドローする。合体中、この効果を[ターンに3回]に変更する。",
        ]),
        "usage_scope_review",
        "review"
      )
    );
  }
);
check(
  "同名の基礎制限と個体上書きへの分裂を合体中の正しいcarrierとして通さない",
  () => {
    const value = withLimit([
      { ...turn, maxCount: 1 },
      {
        kind: "per_instance",
        duration: "turn",
        maxCount: 1,
        maxCountOverrides: [{ when: [{ kind: "combined" }], maxCount: 3 }],
      },
    ]);
    assert.ok(
      issue(
        detect(value, [
          "〔ターンに1回：同名〕1枚ドローする。合体中、この効果を[ターンに3回]に変更する。",
        ]),
        "usage_constraint_mismatch",
        "review"
      )
    );
  }
);
check("同じscopeの矛盾する上限を見逃さない", () =>
  assert.ok(
    issue(
      detect(
        withLimit([
          { ...turn, maxCount: 1 },
          { ...turn, maxCount: 2 },
        ]),
        ["〔ターンに2回：同名〕1枚ドローする。"]
      ),
      "usage_constraint_mismatch"
    )
  )
);
check("重複不可を同名ターン1回に狭めない", () =>
  assert.ok(
    issue(
      detect(withLimit(turn), ["〔重複不可〕1枚ドローする。"]),
      "usage_constraint_mismatch"
    )
  )
);
check("重複不可のdurationは無視される", () =>
  none(
    withLimit({ kind: "no_duplicate", duration: "game" }),
    "〔重複不可〕1枚ドローする。"
  )
);
check("キーワード共有枠はper_groupで受ける", () =>
  none(
    withLimit({ kind: "per_group" }, { limitGroupId: "shared-key" }),
    "〔ターンに1回：【共有技能】〕1枚ドローする。"
  )
);
check("キーワード共有枠を同名に置換すると違反", () =>
  assert.ok(
    issue(
      detect(withLimit(turn), ["〔ターンに1回：【共有技能】〕1枚ドローする。"]),
      "usage_constraint_mismatch"
    )
  )
);
check("per_groupの共有ID欠落", () =>
  assert.ok(
    issue(
      detect(withLimit({ kind: "per_group" }), [
        "〔ターンに1回：【共有技能】〕1枚ドローする。",
      ]),
      "usage_constraint_mismatch"
    )
  )
);
check("ゲート中の誤記を汎用の期間定義にしない", () =>
  assert.ok(
    issue(
      detect(withLimit([turn, game]), [
        "〔ターンに1回：同名〕ゲート中に1回、配置できる。",
      ]),
      "usage_unrecognized_period",
      "review"
    )
  )
);
check("全角数字/コロンを処理", () =>
  none(
    withLimit({ ...turn, maxCount: 2 }),
    "〔ターンに２回：同名〕１枚ドローする。"
  )
);
check("発生順の『ターンに2回目』をusageLimitとして誤認しない", () =>
  none(
    effect([{ action: { kind: "core_move", amount: 1 } }], {
      occurrenceGate: { duration: "turn", targetCount: 2 },
    }),
    "ターンに2回目に相手のカードがフィールドを離れたとき、コア1個を置ける。"
  )
);
check("発生順の『ターンに2回目』でoccurrenceGate欠落を見逃さない", () =>
  assert.ok(
    issue(
      detect(effect([{ action: { kind: "core_move", amount: 1 } }]), [
        "ターンに2回目に相手のカードがフィールドを離れたとき、コア1個を置ける。",
      ]),
      "occurrence_gate_mismatch",
      "review"
    )
  )
);
check("発生順の『ターンに2回目』でoccurrenceGateの回数不一致を見逃さない", () =>
  assert.ok(
    issue(
      detect(
        effect([{ action: { kind: "core_move", amount: 1 } }], {
          occurrenceGate: { duration: "turn", targetCount: 1 },
        }),
        [
          "ターンに2回目に相手のカードがフィールドを離れたとき、コア1個を置ける。",
        ]
      ),
      "occurrence_gate_mismatch",
      "review"
    )
  )
);
check("実際の『ターンに2回』のusageLimit欠落は検出し続ける", () =>
  assert.ok(
    issue(
      detect(effect([{ action: { kind: "core_move", amount: 1 } }]), [
        "ターンに2回、相手のカードがフィールドを離れたとき、コア1個を置ける。",
      ]),
      "usage_constraint_mismatch",
      "review"
    )
  )
);
check("ずつの観測対象別制限は通常個体に決め打ちしない", () =>
  none(
    withLimit({ kind: "per_trigger_related_instance" }),
    "ターンに1回ずつ、1枚ドローする。"
  )
);
check("同じ本文のcontinuous補助carrierには発揮回数を強要しない", () =>
  none(
    effect([{ action: { kind: "cost_modify", modifier: "free" } }], {
      timing: { kind: "continuous" },
    }),
    "〔ターンに1回：同名〕コストを支払わずに召喚できる。"
  )
);

const costEffect = (action) => effect([{ action }]);

const cardEventFreePlacementText =
  "自分の黄/紫の効果でデッキからオープンされたか、トラッシュに置かれたこのカードは、コストを支払わずに配置できる。";
const cardEventFreePlacement = () =>
  effect([{ action: { kind: "move_self", destination: "field" } }], {
    timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
    executionMode: "optional",
    cardEventDisposition: { kind: "move", destination: "field" },
  });
check("card_event自身field配置を無償配置carrierとして認識", () =>
  none(cardEventFreePlacement(), cardEventFreePlacementText)
);
check("card_eventの明示dispositionがfield以外なら無償配置reviewを残す", () => {
  const broken = cardEventFreePlacement();
  broken.cardEventDisposition.destination = "hand";
  assert.ok(
    issue(
      detect(broken, [cardEventFreePlacementText]),
      "payment_scope_review",
      "review"
    )
  );
});
check(
  "card_eventの先頭field配置はdisposition省略の後方互換でも無償を保つ",
  () => {
    const legacy = cardEventFreePlacement();
    delete legacy.cardEventDisposition;
    none(legacy, cardEventFreePlacementText);
  }
);

const directBraveCombineFreeText =
  "手札にあるこのカードは、系統：「導魔」を持つ自分のスピリットが相手の効果の対象になったとき、コストを支払わずに直接合体するように召喚できる。";
const directBraveCombineFree = {
  kind: "brave_combine_effect",
  asSummon: true,
  target: { kind: "trigger_related_instance" },
};
check("effect内の手札ブレイヴ直接合体召喚を無償carrierとして認識", () =>
  none(costEffect(directBraveCombineFree), directBraveCombineFreeText)
);
check("直接合体召喚のasSummonが欠ければ無償payment reviewを残す", () => {
  const broken = clone(directBraveCombineFree);
  delete broken.asSummon;
  assert.ok(
    issue(
      detect(costEffect(broken), [directBraveCombineFreeText]),
      "payment_scope_review",
      "review"
    )
  );
});
check(
  "別ブレイヴを合体元にする直接合体をこのカードの無償carrierにしない",
  () => {
    const broken = clone(directBraveCombineFree);
    broken.source = { stepId: "choose-other-brave" };
    assert.ok(
      issue(
        detect(costEffect(broken), [directBraveCombineFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
const paidText =
  "合体中の鍵ブレイヴ1つを除外することで、召喚コストすべてを支払ったものとして召喚できる。";
const paid = {
  kind: "cost_modify",
  target: { kind: "self" },
  modifier: { additionalCostValue: 0 },
  useCostPayment: {
    kind: "exclude",
    sourceZone: "field",
    minCount: 1,
    maxCount: 1,
    fullCostPaid: true,
  },
};
check("星霊王型の全額支払い済みを保持", () => none(costEffect(paid), paidText));
check("通常召喚許可と分離した全額支払い carrier を本文リンクで認識", () => {
  const permission = effect(
    [
      {
        action: {
          kind: "summon",
          normalActionPermission: true,
          target: { kind: "self" },
        },
      },
    ],
    { timing: { kind: "continuous" } }
  );
  const payment = clone(paid);
  payment.useCostPayment.normalActionPermissionEffectIndex = 0;
  none(permission, paidText, {
    normalActionPermissionEffectIndex: 0,
    siblingEffects: [
      effect([{ action: payment }], { timing: { kind: "continuous" } }),
    ],
  });
});
check("分離 carrier が全額支払い済みを欠くと review を残す", () => {
  const permission = effect(
    [
      {
        action: {
          kind: "summon",
          normalActionPermission: true,
          target: { kind: "self" },
        },
      },
    ],
    { timing: { kind: "continuous" } }
  );
  const broken = clone(paid);
  broken.useCostPayment.normalActionPermissionEffectIndex = 0;
  delete broken.useCostPayment.fullCostPaid;
  const found = detect(permission, [paidText], {
    normalActionPermissionEffectIndex: 0,
    siblingEffects: [
      effect([{ action: broken }], { timing: { kind: "continuous" } }),
    ],
  });
  assert.ok(
    issue(found, "payment_constraint_mismatch") ||
      issue(found, "payment_scope_review")
  );
});
check(
  "分離 carrier の permission index が異なれば全額支払い済みと誤認しない",
  () => {
    const permission = effect(
      [
        {
          action: {
            kind: "summon",
            normalActionPermission: true,
            target: { kind: "self" },
          },
        },
      ],
      { timing: { kind: "continuous" } }
    );
    const mismatched = clone(paid);
    mismatched.useCostPayment.normalActionPermissionEffectIndex = 1;
    const found = detect(permission, [paidText], {
      normalActionPermissionEffectIndex: 0,
      siblingEffects: [
        effect([{ action: mismatched }], { timing: { kind: "continuous" } }),
      ],
    });
    assert.ok(issue(found, "payment_scope_review", "review"));
  }
);
check("全額支払い済みを固定割引に退行させると違反", () => {
  const broken = clone(paid);
  delete broken.useCostPayment.fullCostPaid;
  broken.modifier.additionalCostValue = -12;
  assert.ok(
    issue(detect(costEffect(broken), [paidText]), "payment_constraint_mismatch")
  );
});
check("全額支払い済みと軽減シンボル充足は異なる", () => {
  const broken = clone(paid);
  delete broken.useCostPayment.fullCostPaid;
  broken.useCostPayment.fullReduction = true;
  assert.ok(
    issue(detect(costEffect(broken), [paidText]), "payment_constraint_mismatch")
  );
});
const freeText =
  "トラッシュのコア5個以上をフィールド/リザーブに置くことで、コストを支払わずに召喚する。";
const bell = {
  kind: "cost_modify",
  target: { kind: "self" },
  modifier: "free",
  useCostPayment: { kind: "core_move", sourceZone: "trash", minCount: 5 },
};
check("ベル型のfreeを保持", () => none(costEffect(bell), freeText));
const freeUseProhibitionText =
  "お互いコストを支払わずに手札/手元のカードを使えない。";
const freeUseProhibition = effect(
  [
    {
      action: {
        kind: "restrict_use",
        player: "self",
        filter: { zone: ["hand", "set_aside"], maxCost: 0 },
        duration: { scope: "permanent" },
      },
    },
  ],
  { timing: { kind: "continuous" } }
);
check("無償使用の禁止文はfree payment carrierを要求しない", () =>
  none(freeUseProhibition, freeUseProhibitionText)
);
check("無償使用の許可文はfree payment carrier欠落を検出し続ける", () =>
  assert.ok(
    issue(
      detect(costEffect({ kind: "draw", count: 1 }), [
        "手札のカードをコストを支払わずに使用できる。",
      ]),
      "payment_scope_review",
      "review"
    )
  )
);
const bellHandSummon = effect(
  [{ action: { kind: "summon", target: { kind: "self" } } }],
  {
    timing: { kind: "activated", mode: "flash" },
    applicability: { zone: ["hand"] },
    condition: [{ kind: "count_value", player: "self", min: 5 }],
  }
);
const bellAlternativePayment = effect([{ action: bell }], {
  timing: { kind: "continuous" },
  condition: [{ kind: "count_value", player: "self", min: 5 }],
});
check("手札起動召喚と同一原文の代替支払いfree carrierを認識", () =>
  none(bellHandSummon, freeText, {
    siblingEffects: [bellAlternativePayment],
  })
);
check("手札起動召喚の兄弟代替支払いfreeが壊れればreviewを残す", () => {
  const brokenPayment = clone(bellAlternativePayment);
  brokenPayment.steps[0].action.modifier = { additionalCostValue: 0 };
  const found = detect(bellHandSummon, [freeText], {
    siblingEffects: [brokenPayment],
  });
  assert.ok(
    issue(found, "payment_scope_review", "review") ||
      issue(found, "payment_constraint_mismatch", "review")
  );
});
check("field-onlyの兄弟代替支払いcarrierを手札召喚へ誤帰属しない", () => {
  const fieldOnlyPayment = clone(bellAlternativePayment);
  fieldOnlyPayment.applicability = { zone: ["field"] };
  const found = detect(bellHandSummon, [freeText], {
    siblingEffects: [fieldOnlyPayment],
  });
  assert.ok(
    issue(found, "payment_scope_review", "review") ||
      issue(found, "payment_constraint_mismatch", "review")
  );
});
check(
  "自分のアタックステップだけの兄弟carrierをお互いの手札召喚へ誤帰属しない",
  () => {
    const selfAttackPayment = clone(bellAlternativePayment);
    selfAttackPayment.timingScope = { player: "self", period: "attack" };
    const found = detect(bellHandSummon, [freeText], {
      siblingEffects: [selfAttackPayment],
    });
    assert.ok(
      issue(found, "payment_scope_review", "review") ||
        issue(found, "payment_constraint_mismatch", "review")
    );
  }
);
for (const [label, mutate] of [
  ["kind", (payment) => (payment.kind = "exclude")],
  ["sourceZone", (payment) => (payment.sourceZone = "life")],
  ["minCount", (payment) => (payment.minCount = 4)],
]) {
  check(`兄弟代替支払いの${label}が本文と不一致ならreviewを残す`, () => {
    const brokenPayment = clone(bellAlternativePayment);
    mutate(brokenPayment.steps[0].action.useCostPayment);
    const found = detect(bellHandSummon, [freeText], {
      siblingEffects: [brokenPayment],
    });
    assert.ok(
      issue(found, "payment_scope_review", "review") ||
        issue(found, "payment_constraint_mismatch", "review")
    );
  });
}
const freeLifeDamageUseText =
  "手札にあるこのカードは、アタックステップ中、相手の効果で自分のライフが減るとき、コストを支払わずに使用することで自分のライフは減らない。";
const freeLifeDamageUse = () =>
  effect(
    [
      {
        action: {
          kind: "life_damage_interception",
          player: "self",
          cause: "opponent_effect",
          mode: "replace",
          useCostGate: { zones: ["hand"], effectIndex: 2 },
        },
      },
    ],
    {
      applicability: { zone: "hand" },
      timing: { kind: "continuous" },
      timingScope: { player: "both", period: "attack" },
    }
  );
const freeLifeDamageUseOptions = (source) => ({
  containerEffects: [
    effect([], { timing: { kind: "card_event", event: "summon" } }),
    source,
    effect([], { timing: { kind: "activated", mode: "flash" } }),
  ],
});
check("ライフ減少置換の手札無償使用 carrier を認識", () =>
  none(
    freeLifeDamageUse(),
    freeLifeDamageUseText,
    freeLifeDamageUseOptions(freeLifeDamageUse())
  )
);
check("ライフ減少置換の無償使用で useCostGate が欠ければ review を残す", () => {
  const broken = freeLifeDamageUse();
  delete broken.steps[0].action.useCostGate;
  assert.ok(
    issue(
      detect(broken, [freeLifeDamageUseText], freeLifeDamageUseOptions(broken)),
      "payment_scope_review",
      "review"
    )
  );
});
for (const [label, mutate] of [
  ["player", (value) => (value.steps[0].action.player = "opponent")],
  ["cause", (value) => (value.steps[0].action.cause = "self_effect")],
  ["applicability", (value) => delete value.applicability],
  ["timingScope", (value) => delete value.timingScope],
  [
    "effectIndex の参照先",
    (value) => (value.steps[0].action.useCostGate.effectIndex = 0),
  ],
]) {
  check(`ライフ減少置換の無償使用で ${label} が壊れれば review を残す`, () => {
    const broken = freeLifeDamageUse();
    mutate(broken);
    assert.ok(
      issue(
        detect(
          broken,
          [freeLifeDamageUseText],
          freeLifeDamageUseOptions(broken)
        ),
        "payment_scope_review",
        "review"
      )
    );
  });
}
const choiceBranchFreeSummonText =
  "自分の『孫悟空』/『ベジータ』が相手の効果の対象になるとき、コストを支払わずに召喚できる。そうしたとき、その対象をこのスピリットのみにする。または、その効果がスタック効果のとき、アタックステップなら、相手はスタック効果を発揮できない。";
const choiceBranchFreeSummon = () =>
  effect([
    {
      action: {
        kind: "summon",
        target: { kind: "self" },
        costModifier: "free",
      },
      choice: [
        {
          action: {
            kind: "summon",
            target: { kind: "self" },
            costModifier: "free",
          },
        },
      ],
    },
    {
      action: {
        kind: "redirect_target",
        from: { kind: "trigger_related_instance" },
        to: { kind: "self" },
        mode: "all_current_effect_targets",
      },
    },
  ]);
check("同一EffectStepの排他的choice無償召喚を一つのcarrierとして認識", () =>
  none(choiceBranchFreeSummon(), choiceBranchFreeSummonText)
);
check("排他的choiceの一方が無償でなければpayment reviewを残す", () => {
  const broken = choiceBranchFreeSummon();
  delete broken.steps[0].choice[0].action.costModifier;
  assert.ok(
    issue(
      detect(broken, [choiceBranchFreeSummonText]),
      "payment_scope_review",
      "review"
    )
  );
});
const quartzSetAndResummonFreeText =
  "このカードをコストを支払わずに召喚するか、自分の魂状態の対象にコストを支払わずにセットする。その後、スピリット1体を除外する。この効果発揮後、除外した対象を持ち主のフィールドに疲労状態でコストを支払わずに召喚する。";
const quartzSetAndResummonFree = () =>
  effect([
    {
      action: {
        kind: "summon",
        target: { kind: "self" },
        costModifier: "free",
      },
      choice: [
        {
          action: {
            kind: "quartz_set",
            target: { kind: "self" },
            free: true,
          },
        },
      ],
    },
    {
      id: "excluded",
      action: { kind: "remove_from_game", target: { kind: "filter" } },
    },
    {
      action: {
        kind: "summon",
        target: { kind: "ref", stepId: "excluded" },
        costModifier: "free",
      },
    },
  ]);
check(
  "同一文の自己召喚・クォーツセット・除外対象再召喚の無料carrierを個別に対応付ける",
  () => none(quartzSetAndResummonFree(), quartzSetAndResummonFreeText)
);
check("クォーツセット分の無料carrierが欠ければpayment reviewを残す", () => {
  const broken = quartzSetAndResummonFree();
  delete broken.steps[0].choice[0].action.free;
  assert.ok(
    issue(
      detect(broken, [quartzSetAndResummonFreeText]),
      "payment_scope_review",
      "review"
    )
  );
});
const choiceScopedFreeSummonText =
  "このカードをコストを支払わずに召喚するか、対象のスピリットをコストを支払わずに召喚する。";
const choiceScopedFreeSummon = () =>
  effect([
    {
      action: {
        kind: "summon",
        target: { kind: "self" },
        costModifier: "free",
      },
      choice: [
        {
          action: {
            kind: "summon",
            target: { kind: "filter" },
          },
        },
      ],
    },
  ]);
check(
  "choice後枝の別対象無料召喚にself carrierを流用せず、欠落をreviewする",
  () => {
    assert.ok(
      issue(
        detect(choiceScopedFreeSummon(), [choiceScopedFreeSummonText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
const grantInnerText =
  "『このスピリットのアタック時』バトル終了時、自分のカウント9以上で、相手のライフのコア2個をトラッシュに置く。";
const grantScopeText = `〔ターンに1回:同名〕このターンの間、自分の「ベジータ」すべてに、“${grantInnerText}”を与える。`;
const grantedEffectScopeCarrier = () =>
  effect(
    [
      {
        prompt: { sourceText: grantInnerText },
        action: {
          kind: "grant_effect",
          target: { kind: "filter", player: "self", filter: {}, count: "all" },
          duration: { scope: "turn" },
          grantedEffect: {
            timing: { kind: "card_event", event: "battle_end" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
        },
      },
    ],
    { usageLimit: turn }
  );
check("付与効果の引用本文をsourceTextで分離し外側の同名制限だけに帰属", () =>
  none(grantedEffectScopeCarrier(), grantScopeText)
);
check("付与効果の引用本文carrierが欠ければ外側制限の誤帰属reviewを残す", () => {
  const broken = grantedEffectScopeCarrier();
  delete broken.steps[0].prompt;
  assert.ok(
    issue(
      detect(broken, [grantScopeText]),
      "usage_constraint_mismatch",
      "review"
    )
  );
});
const turnReservationText =
  "このターンの間、相手によって自分のライフが減ったとき、減った数1につき、ボイドからコア1個を自分のライフに置ける。";
const turnReservationScopeCarrier = () =>
  effect(
    [
      {
        prompt: { sourceText: turnReservationText },
        action: {
          kind: "grant_effect",
          target: { kind: "self" },
          turnReservation: true,
          duration: { scope: "turn" },
          grantedEffect: {
            timing: { kind: "game_event", event: "reduce_life" },
            executionMode: "optional",
            steps: [{ action: { kind: "core_move", amount: 1 } }],
          },
        },
      },
    ],
    { usageLimit: turn }
  );
const turnReservationScopeText = `〔ターンに1回：同名〕魂状態を含む自分の「メタナイト」がいるとき、${turnReservationText}`;
check(
  "turnReservationの反復本文をcarrierで分離し、発行時だけの同名制限を認識",
  () => none(turnReservationScopeCarrier(), turnReservationScopeText)
);
check(
  "turnReservationの本文carrierを失えば、内側反応の制限所属をreviewへ戻す",
  () => {
    const broken = turnReservationScopeCarrier();
    delete broken.steps[0].prompt;
    const found = detect(broken, [turnReservationScopeText]);
    const nested = issue(found, "usage_constraint_mismatch", "review");
    assert.equal(nested.path, "$.steps[0].action.grantedEffect.usageLimit");
  }
);
const conditionalFreeUseText =
  "〔ターンに1回：同名〕手札にあるこのカードは、自分のスピリットがブロックしたとき、コストを支払わずに使用できる。";
check("条件付き無償使用primitiveをfree支払いとして認識", () =>
  none(
    effect(
      [
        {
          action: { kind: "use_magic_without_cost", magicTiming: "flash" },
        },
      ],
      { usageLimit: turn }
    ),
    conditionalFreeUseText
  )
);
check("無償使用本文でprimitiveが欠落すればreviewを残す", () => {
  const found = detect(
    effect([{ action: { kind: "draw", count: 1 } }], { usageLimit: turn }),
    [conditionalFreeUseText]
  );
  assert.ok(issue(found, "payment_scope_review", "review"));
  assert.ok(found.every((entry) => entry.severity !== "violation"));
});
const splitHandFreeUseText =
  "手札にあるこのカードは、相手の効果を受けず、相手によって自分のライフが減ったとき、コストを支払わずに使用できる。";
const handImmunityWithSharedText = {
  applicability: { zone: ["hand"] },
  timing: { kind: "continuous" },
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
const sharedConditionalFreeMagicUse = {
  applicability: { zone: "hand" },
  timing: { kind: "game_event", player: "self", event: "reduce_life" },
  textRef: [0],
  steps: [{ action: { kind: "use_magic_without_cost", magicTiming: "flash" } }],
};
check("同一本文・手札zoneの兄弟free-use carrierを免疫effect起点でも認識", () =>
  none(handImmunityWithSharedText, splitHandFreeUseText, {
    siblingEffects: [handImmunityWithSharedText, sharedConditionalFreeMagicUse],
  })
);
check("同一本文でも兄弟free-use carrierが欠落すればreviewを残す", () => {
  const found = detect(handImmunityWithSharedText, [splitHandFreeUseText], {
    siblingEffects: [handImmunityWithSharedText],
  });
  assert.ok(issue(found, "payment_scope_review", "review"));
});
check("兄弟free-use carrierのzone照合は入力配列を変更しない", () => {
  const continuous = clone(handImmunityWithSharedText);
  continuous.applicability.zone = ["trash", "hand"];
  const freeUse = clone(sharedConditionalFreeMagicUse);
  freeUse.applicability.zone = ["hand", "trash"];
  const before = JSON.stringify([continuous, freeUse]);
  none(continuous, splitHandFreeUseText, {
    siblingEffects: [continuous, freeUse],
  });
  assert.equal(JSON.stringify([continuous, freeUse]), before);
});
const conditionalFreeMirageSetText =
  "自分はデッキの上から1枚ドローし、セットしている自分のミラージュがなければ、このカードをコストを支払わずにセットする。";
check("効果解決中の無償ミラージュセットprimitiveをfree支払いとして認識", () =>
  none(
    effect(
      [
        { action: { kind: "draw", count: 1 } },
        { action: { kind: "set_self_as_mirage", onlyIfNoMirage: true } },
      ],
      { timing: { kind: "activated", mode: "flash" } }
    ),
    conditionalFreeMirageSetText
  )
);
check("無償ミラージュセットprimitiveを外すと支払いreviewを残す", () => {
  const found = detect(
    effect([{ action: { kind: "draw", count: 1 } }], {
      timing: { kind: "activated", mode: "flash" },
    }),
    [conditionalFreeMirageSetText]
  );
  assert.ok(issue(found, "payment_scope_review", "review"));
});
const deckRevealFieldEntryFreeText =
  "自分のデッキを上から13枚オープンでき、その中のコスト4以下のスピリットカード1枚をコストを支払わずに召喚する。残ったカードはデッキの下に戻す。";
const deckRevealFieldEntryFree = {
  kind: "deck_reveal",
  revealCount: 13,
  picks: [
    {
      count: 1,
      filter: { category: ["spirit"], maxCost: 4 },
      destination: "field",
    },
  ],
  remainder: "bottom",
};
const deckRevealMultiPickFieldEntryFree = {
  kind: "deck_reveal",
  revealCount: 13,
  picks: [
    {
      count: 3,
      filter: { category: ["magic"], tribes: ["地球"] },
      destination: "field",
    },
    {
      count: 1,
      filter: {
        category: ["spirit"],
        maxCost: 4,
        cardName: [{ contains: "スレイプニール" }],
      },
      destination: "field",
    },
  ],
  remainder: "bottom",
};
const deckRevealMultiPickFieldEntryFreeText =
  "自分はデッキの上から13枚オープンでき、その中の系統：「地球」を持つマジックカード3枚までをフィールドに置き、コスト4以下の「スレイプニール」1枚をコストを支払わずに召喚する。残ったカードはデッキの下に戻す。";
check("deck_revealのfield pickを無償召喚carrierとして認識", () =>
  none(costEffect(deckRevealFieldEntryFree), deckRevealFieldEntryFreeText)
);
const deckRevealTribeOnlyFieldEntryFreeText =
  "自分のデッキを上から6枚オープンする。その中の系統：「CB」を持つカード3枚までをコストを支払わずに召喚し、残りはデッキの下に戻す。";
const deckRevealTribeOnlyFieldEntryFree = {
  kind: "deck_reveal",
  revealCount: 6,
  picks: [
    {
      count: 3,
      filter: {
        category: ["spirit", "ultimate", "brave"],
        tribes: ["CB"],
      },
      destination: "field",
    },
  ],
  remainder: "bottom",
};
check(
  "deck_revealの直近系統だけでも複数カテゴリの無償召喚carrierへ一意に帰属する",
  () =>
    none(
      costEffect(deckRevealTribeOnlyFieldEntryFree),
      deckRevealTribeOnlyFieldEntryFreeText
    )
);
check(
  "deck_revealの無償召喚対象系統が別系統へ壊れるとpayment reviewを残す",
  () => {
    const broken = clone(deckRevealTribeOnlyFieldEntryFree);
    broken.picks[0].filter.tribes = ["CF"];
    assert.ok(
      issue(
        detect(costEffect(broken), [deckRevealTribeOnlyFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check("deck_revealの無償召喚対象枚数が縮むとpayment reviewを残す", () => {
  const broken = clone(deckRevealTribeOnlyFieldEntryFree);
  broken.picks[0].count = 1;
  assert.ok(
    issue(
      detect(costEffect(broken), [deckRevealTribeOnlyFieldEntryFreeText]),
      "payment_scope_review",
      "review"
    )
  );
});
const deckRevealNameOrTribeFieldEntryFreeText =
  "自分のデッキを上から4枚オープンできる。その中のカード名:「幻想郷」、または系統:「創界神」/「靈異」を持つ赤/紫のネクサスカード1枚をコストを支払わずに配置し、系統:「靈異」を持つコスト4以上のスピリットカード1枚を手札に加える。残ったカードは好きな順番でデッキの下に戻す。";
const deckRevealNameOrTribeFieldEntryFree = {
  kind: "deck_reveal",
  revealCount: 4,
  picks: [
    {
      count: 1,
      filter: {
        filterOr: [
          {
            category: ["nexus"],
            colors: ["red", "purple"],
            cardName: { exact: "幻想郷" },
          },
          {
            category: ["nexus"],
            colors: ["red", "purple"],
            tribes: ["創界神", "靈異"],
          },
        ],
      },
      destination: "field",
    },
    {
      count: 1,
      filter: { category: ["spirit"], tribes: ["靈異"], minCost: 4 },
      destination: "hand",
    },
  ],
  remainder: "bottom",
};
check("名前または系統のfilterOr field pickを無償配置carrierとして認識", () =>
  none(
    costEffect(deckRevealNameOrTribeFieldEntryFree),
    deckRevealNameOrTribeFieldEntryFreeText
  )
);
check("名前または系統の名前枝が壊れると無償配置reviewを残す", () => {
  const broken = clone(deckRevealNameOrTribeFieldEntryFree);
  broken.picks[0].filter.filterOr[0].cardName = { exact: "博麗神社" };
  assert.ok(
    issue(
      detect(costEffect(broken), [deckRevealNameOrTribeFieldEntryFreeText]),
      "payment_scope_review",
      "review"
    )
  );
});
check("名前または系統の系統枝が壊れると無償配置reviewを残す", () => {
  const broken = clone(deckRevealNameOrTribeFieldEntryFree);
  broken.picks[0].filter.filterOr[1].tribes = ["創界神", "ＣＦ"];
  assert.ok(
    issue(
      detect(costEffect(broken), [deckRevealNameOrTribeFieldEntryFreeText]),
      "payment_scope_review",
      "review"
    )
  );
});
check(
  "nested filterOr の外側 category/colors は engine で無視されるため無償配置carrierにしない",
  () => {
    const broken = clone(deckRevealNameOrTribeFieldEntryFree);
    broken.picks[0].filter.category = ["nexus"];
    broken.picks[0].filter.colors = ["red", "purple"];
    assert.ok(
      issue(
        detect(costEffect(broken), [deckRevealNameOrTribeFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "direct filterOr の空配列は engine で候補ゼロのため無償配置carrierにしない",
  () => {
    const broken = clone(deckRevealNameOrTribeFieldEntryFree);
    broken.picks[0].filterOr = [];
    assert.ok(
      issue(
        detect(costEffect(broken), [deckRevealNameOrTribeFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
const deckRevealMirageSetFreeText =
  "自分のデッキを上から5枚オープンする。その中のミラージュ効果を持つ緑/青のカードをコストを支払わずにセットし、緑/青のブレイヴカード1枚を手札に加える。残ったカードはデッキの下に戻す。";
const deckRevealMirageSetFree = {
  kind: "deck_reveal",
  revealCount: 5,
  picks: [
    {
      count: 1,
      filter: { colors: ["green", "blue"], hasMechanic: ["mirage"] },
      destination: "mirage_set",
    },
    {
      count: 1,
      filter: { category: ["brave"], colors: ["green", "blue"] },
      destination: "hand",
    },
  ],
  remainder: "bottom",
};
check("deck_revealのmirage_set pickを無償セットcarrierとして認識", () =>
  none(costEffect(deckRevealMirageSetFree), deckRevealMirageSetFreeText)
);
check(
  "deck_revealの無償mirage_set pickが手札行きへ壊れるとpayment reviewを残す",
  () => {
    const broken = clone(deckRevealMirageSetFree);
    broken.picks[0].destination = "hand";
    assert.ok(
      issue(
        detect(costEffect(broken), [deckRevealMirageSetFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "deck_revealの無償mirage_set pickが本文外の色を許すとpayment reviewを残す",
  () => {
    const broken = clone(deckRevealMirageSetFree);
    broken.picks[0].filter.colors = ["red"];
    assert.ok(
      issue(
        detect(costEffect(broken), [deckRevealMirageSetFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "deck_revealの無償mirage_set pickが色を重複させるとpayment reviewを残す",
  () => {
    const broken = clone(deckRevealMirageSetFree);
    broken.picks[0].filter.colors = ["green", "green"];
    assert.ok(
      issue(
        detect(costEffect(broken), [deckRevealMirageSetFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "deck_revealの無償mirage_set pickが2枚セットへ壊れるとpayment reviewを残す",
  () => {
    const broken = clone(deckRevealMirageSetFree);
    broken.picks[0].count = 2;
    assert.ok(
      issue(
        detect(costEffect(broken), [deckRevealMirageSetFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "deck_revealの無償mirage_set pickがburstも許すとpayment reviewを残す",
  () => {
    const broken = clone(deckRevealMirageSetFree);
    broken.picks[0].filter.hasMechanic = ["mirage", "burst"];
    assert.ok(
      issue(
        detect(costEffect(broken), [deckRevealMirageSetFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "deck_revealの無償mirage_set pickがfilterOrで別色を許すとpayment reviewを残す",
  () => {
    const broken = clone(deckRevealMirageSetFree);
    broken.picks[0].filter.filterOr = [{ colors: ["red"] }];
    assert.ok(
      issue(
        detect(costEffect(broken), [deckRevealMirageSetFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "deck_revealの無償mirage_set pick直下filterOrが別色を許すとpayment reviewを残す",
  () => {
    const broken = clone(deckRevealMirageSetFree);
    broken.picks[0].filterOr = [{ colors: ["red"] }];
    assert.ok(
      issue(
        detect(costEffect(broken), [deckRevealMirageSetFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "deck_revealの無償mirage_set pickが相手デッキを開くとpayment reviewを残す",
  () => {
    const broken = clone(deckRevealMirageSetFree);
    broken.player = "opponent";
    assert.ok(
      issue(
        detect(costEffect(broken), [deckRevealMirageSetFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "無償mirage_set後の別の相手デッキ文に相手revealを誤帰属せずpayment reviewを残す",
  () => {
    const broken = clone(deckRevealMirageSetFree);
    broken.player = "opponent";
    const text =
      "自分のデッキを上から5枚オープンする。その中のミラージュ効果を持つ緑/青のカードをコストを支払わずにセットし、相手のデッキを上から1枚破棄する。";
    assert.ok(
      issue(
        detect(costEffect(broken), [text]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
const deckRevealCategoryOnlyFieldEntryFreeText =
  "自分のデッキを上から5枚オープンする。その中の、「アルドノアドライブ」1枚を手札に加え、アルティメットカード1枚を召喚条件を無視してコストを支払わずに召喚する。残ったカードはデッキの下に戻す。";
const deckRevealCategoryOnlyFieldEntryFree = {
  kind: "deck_reveal",
  revealCount: 5,
  picks: [
    {
      count: 1,
      filter: { cardName: { exact: "アルドノアドライブ" } },
      destination: "hand",
    },
    {
      count: 1,
      filter: { category: ["ultimate"] },
      destination: "field",
    },
  ],
  remainder: "bottom",
};
check("deck_revealの直近カテゴリだけでも無償召喚carrierへ一意に帰属する", () =>
  none(
    costEffect(deckRevealCategoryOnlyFieldEntryFree),
    deckRevealCategoryOnlyFieldEntryFreeText
  )
);
check(
  "deck_revealの直近カテゴリに別カテゴリを混在させたfield pickを無償召喚carrierと誤認しない",
  () => {
    const broken = clone(deckRevealCategoryOnlyFieldEntryFree);
    broken.picks[1].filter.category = ["ultimate", "spirit"];
    assert.ok(
      issue(
        detect(costEffect(broken), [deckRevealCategoryOnlyFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "コスト境界のない無償文を無関係なdeck_reveal field pickへ誤帰属しない",
  () => {
    const found = detect(
      costEffect({
        kind: "deck_reveal",
        revealCount: 3,
        picks: [
          {
            count: 1,
            filter: { category: ["magic"] },
            destination: "field",
          },
        ],
        remainder: "bottom",
      }),
      [
        "自分のデッキを上から3枚オープンし、その中のマジックカード1枚をフィールドに置く。このカードをコストを支払わずに召喚する。",
      ]
    );
    assert.ok(issue(found, "payment_scope_review", "review"));
  }
);
check("複数pickでも無償文とコスト境界を同じfield pickへ帰属する", () =>
  none(
    costEffect(deckRevealMultiPickFieldEntryFree),
    deckRevealMultiPickFieldEntryFreeText
  )
);
check("複数pickの対象だけ手札行きへ壊れると無償/コスト範囲reviewを残す", () => {
  const broken = clone(deckRevealMultiPickFieldEntryFree);
  broken.picks[1].destination = "hand";
  const found = detect(costEffect(broken), [
    deckRevealMultiPickFieldEntryFreeText,
  ]);
  assert.ok(issue(found, "payment_scope_review", "review"));
  assert.ok(issue(found, "target_cost_scope_review", "review"));
});
check("deck_revealの無償召喚対象名が別名へ壊れるとpayment reviewを残す", () => {
  const broken = clone(deckRevealMultiPickFieldEntryFree);
  broken.picks[1].filter.cardName = [{ contains: "ベジータ" }];
  assert.ok(
    issue(
      detect(costEffect(broken), [deckRevealMultiPickFieldEntryFreeText]),
      "payment_scope_review",
      "review"
    )
  );
});
check("deck_revealのfield pickが手札行きへ壊れると無償召喚reviewを残す", () => {
  const broken = clone(deckRevealFieldEntryFree);
  broken.picks[0].destination = "hand";
  assert.ok(
    issue(
      detect(costEffect(broken), [deckRevealFieldEntryFreeText]),
      "payment_scope_review",
      "review"
    )
  );
});
check("deck_revealのfield pickのコスト上限ずれを検知", () => {
  const broken = clone(deckRevealFieldEntryFree);
  broken.picks[0].filter.maxCost = 5;
  const found = issue(
    detect(costEffect(broken), [deckRevealFieldEntryFreeText]),
    "target_cost_bound_mismatch"
  );
  assert.ok(found);
  assert.equal(found.path, "$.steps[0].action.picks[0].filter.maxCost");
});
const discardedDeckCardsFieldEntryFreeText =
  "自分のデッキを上から7枚破棄できる。その中の系統：「火星」を持つ導界者ネクサスカード2枚までをコストを支払わずに配置できる。";
const discardedDeckCardsFieldEntryFree = () =>
  effect([
    {
      id: "mill",
      action: {
        kind: "discard",
        player: "self",
        fromZone: "deck",
        count: 7,
      },
    },
    {
      action: {
        kind: "move_card",
        target: {
          kind: "filter",
          player: "self",
          zone: "trash",
          filter: { category: ["nexus"], tribes: ["火星", "導界者"] },
          count: { min: 0, max: 2 },
          stepId: "mill",
        },
        from: { zone: "trash", player: "self" },
        to: { zone: "field", player: "self" },
        count: 2,
      },
    },
  ]);
check("デッキ破棄集合のstepId field entryを無償配置carrierとして認識", () =>
  none(discardedDeckCardsFieldEntryFree(), discardedDeckCardsFieldEntryFreeText)
);
const searchZoneFieldEntryFreeText =
  "自分の手札/トラッシュにある「戦艦ハルバード」1枚をコストを支払わずに配置できる。";
const searchZoneFieldEntryFree = {
  kind: "search_zone",
  zone: ["hand", "trash"],
  filter: {
    category: ["nexus"],
    cardName: [{ contains: "戦艦ハルバード" }],
  },
  count: { min: 0, max: 1 },
  destination: "field",
};
check("search_zoneのfield entryを無償配置carrierとして認識", () =>
  none(costEffect(searchZoneFieldEntryFree), searchZoneFieldEntryFreeText)
);
check(
  "search_zoneの無償field entryが手札行きへ壊れるとpayment reviewを残す",
  () => {
    const broken = clone(searchZoneFieldEntryFree);
    broken.destination = "hand";
    assert.ok(
      issue(
        detect(costEffect(broken), [searchZoneFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "search_zoneの無償field entryが本文外のデッキ検索へ壊れるとpayment reviewを残す",
  () => {
    const broken = clone(searchZoneFieldEntryFree);
    broken.zone = ["deck"];
    assert.ok(
      issue(
        detect(costEffect(broken), [searchZoneFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "search_zoneの無償field entryから本文指定のトラッシュを落とすとpayment reviewを残す",
  () => {
    const broken = clone(searchZoneFieldEntryFree);
    broken.zone = ["hand"];
    assert.ok(
      issue(
        detect(costEffect(broken), [searchZoneFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "search_zoneの無償field entryが相手の検索元を使うとpayment reviewを残す",
  () => {
    const broken = clone(searchZoneFieldEntryFree);
    broken.player = "opponent";
    assert.ok(
      issue(
        detect(costEffect(broken), [searchZoneFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check("search_zoneの無償field entryが別名も許すとpayment reviewを残す", () => {
  const broken = clone(searchZoneFieldEntryFree);
  broken.filter.cardName.push({ contains: "別名" });
  assert.ok(
    issue(
      detect(costEffect(broken), [searchZoneFieldEntryFreeText]),
      "payment_scope_review",
      "review"
    )
  );
});
check(
  "search_zoneの無償field entryが2枚配置へ壊れるとpayment reviewを残す",
  () => {
    const broken = clone(searchZoneFieldEntryFree);
    broken.count = { min: 0, max: 2 };
    assert.ok(
      issue(
        detect(costEffect(broken), [searchZoneFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "search_zoneの無償field entryがfilterOrで別名を許すとpayment reviewを残す",
  () => {
    const broken = clone(searchZoneFieldEntryFree);
    broken.filter.filterOr = [{ cardName: [{ contains: "別名" }] }];
    assert.ok(
      issue(
        detect(costEffect(broken), [searchZoneFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "移動先player省略時は移動元playerを継承するデッキ破棄無償配置を認識",
  () => {
    const implicitDestinationPlayer = clone(discardedDeckCardsFieldEntryFree());
    delete implicitDestinationPlayer.steps[1].action.to.player;
    none(implicitDestinationPlayer, discardedDeckCardsFieldEntryFreeText);
  }
);
check("相手デッキ破棄の本文と相手scopeが一致する無償配置carrierを認識", () => {
  const opponentScope = clone(discardedDeckCardsFieldEntryFree());
  opponentScope.steps[0].action.player = "opponent";
  opponentScope.steps[1].action.target.player = "opponent";
  opponentScope.steps[1].action.from.player = "opponent";
  opponentScope.steps[1].action.to.player = "opponent";
  none(
    opponentScope,
    discardedDeckCardsFieldEntryFreeText.replace("自分のデッキ", "相手のデッキ")
  );
});
check(
  "破棄後に別トラッシュ対象を配置する本文へstepIdを誤付与しても無償配置と認識しない",
  () => {
    const unrelatedTrashTarget = clone(discardedDeckCardsFieldEntryFree());
    const unrelatedTrashText = discardedDeckCardsFieldEntryFreeText.replace(
      "。その中の系統：",
      "。その後、自分のトラッシュにある系統："
    );
    assert.ok(
      issue(
        detect(unrelatedTrashTarget, [unrelatedTrashText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "中間の別処理だけがその中を参照しても後続トラッシュ配置を無償配置と認識しない",
  () => {
    const unrelatedTrashTarget = clone(discardedDeckCardsFieldEntryFree());
    const unrelatedTrashText =
      "自分のデッキを上から7枚破棄できる。その中のカード1枚を手札に加える。その後、自分のトラッシュにある系統：『火星』を持つ導界者ネクサスカード2枚までをコストを支払わずに配置できる。";
    assert.ok(
      issue(
        detect(unrelatedTrashTarget, [unrelatedTrashText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "同一文でその中を手札へ動かした後のトラッシュ配置を無償配置と認識しない",
  () => {
    const unrelatedTrashTarget = clone(discardedDeckCardsFieldEntryFree());
    const unrelatedTrashText =
      "自分のデッキを上から7枚破棄できる。その中のカード1枚を手札に加え、自分のトラッシュにある系統：『火星』を持つ導界者ネクサスカード2枚までをコストを支払わずに配置できる。";
    assert.ok(
      issue(
        detect(unrelatedTrashTarget, [unrelatedTrashText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check("その中を手元へ動かした後の手元起点配置を無償配置と認識しない", () => {
  const unrelatedSetAsideTarget = clone(discardedDeckCardsFieldEntryFree());
  const unrelatedSetAsideText =
    "自分のデッキを上から7枚破棄できる。その中のカード1枚を手元に置き、自分の手元から系統：『火星』を持つ導界者ネクサスカード2枚までをコストを支払わずに配置できる。";
  assert.ok(
    issue(
      detect(unrelatedSetAsideTarget, [unrelatedSetAsideText]),
      "payment_scope_review",
      "review"
    )
  );
});
check(
  "その中をミラージュへセットした後のミラージュ起点配置を無償配置と認識しない",
  () => {
    const unrelatedMirageTarget = clone(discardedDeckCardsFieldEntryFree());
    const unrelatedMirageText =
      "自分のデッキを上から7枚破棄できる。その中のカード1枚をミラージュとしてセットし自分のミラージュから系統：『火星』を持つ導界者ネクサスカード2枚までをコストを支払わずに配置できる。";
    assert.ok(
      issue(
        detect(unrelatedMirageTarget, [unrelatedMirageText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "デッキ破棄集合のfield entryが手札行きへ壊れると無償配置reviewを残す",
  () => {
    const broken = clone(discardedDeckCardsFieldEntryFree());
    broken.steps[1].action.to.zone = "hand";
    assert.ok(
      issue(
        detect(broken, [discardedDeckCardsFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "デッキ破棄集合のfield entryからstepIdが欠落すると無償配置reviewを残す",
  () => {
    const broken = clone(discardedDeckCardsFieldEntryFree());
    delete broken.steps[1].action.target.stepId;
    assert.ok(
      issue(
        detect(broken, [discardedDeckCardsFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check("手札破棄への退行をデッキ破棄集合の無償配置と誤認しない", () => {
  const broken = clone(discardedDeckCardsFieldEntryFree());
  broken.steps[0].action.fromZone = "hand";
  assert.ok(
    issue(
      detect(broken, [discardedDeckCardsFieldEntryFreeText]),
      "payment_scope_review",
      "review"
    )
  );
});
check(
  "デッキ破棄集合と対象playerが異なるfield entryを無償配置と誤認しない",
  () => {
    const broken = clone(discardedDeckCardsFieldEntryFree());
    broken.steps[1].action.target.player = "opponent";
    assert.ok(
      issue(
        detect(broken, [discardedDeckCardsFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "デッキ破棄集合と対象zoneが異なるfield entryを無償配置と誤認しない",
  () => {
    const broken = clone(discardedDeckCardsFieldEntryFree());
    broken.steps[1].action.target.zone = "hand";
    assert.ok(
      issue(
        detect(broken, [discardedDeckCardsFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "デッキ破棄集合と移動元playerが異なるfield entryを無償配置と誤認しない",
  () => {
    const broken = clone(discardedDeckCardsFieldEntryFree());
    broken.steps[1].action.from.player = "opponent";
    assert.ok(
      issue(
        detect(broken, [discardedDeckCardsFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "デッキ破棄集合と移動先playerが異なるfield entryを無償配置と誤認しない",
  () => {
    const broken = clone(discardedDeckCardsFieldEntryFree());
    broken.steps[1].action.to.player = "opponent";
    assert.ok(
      issue(
        detect(broken, [discardedDeckCardsFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "本文が自分のデッキなのに全playerを相手へ揃えたfield entryを無償配置と誤認しない",
  () => {
    const broken = clone(discardedDeckCardsFieldEntryFree());
    broken.steps[0].action.player = "opponent";
    broken.steps[1].action.target.player = "opponent";
    broken.steps[1].action.from.player = "opponent";
    broken.steps[1].action.to.player = "opponent";
    assert.ok(
      issue(
        detect(broken, [discardedDeckCardsFieldEntryFreeText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
const discardToFieldWithoutCostText =
  "自分の手札1枚を破棄することで、ドロー枚数を+1する。破棄したカードが、「ダルザナ・マグバレッジ」のとき、トラッシュに置くかわりにコスト支払わずに配置する。";
const discardToFieldWithoutCost = {
  kind: "draw_modify",
  amount: 1,
  duration: { scope: "step", step: "draw" },
  prepaidCost: {
    kind: "discard_hand",
    cardFilter: {},
    discardDisposition: {
      kind: "move_instead",
      ifCardFilter: { cardName: { contains: "ダルザナ・マグバレッジ" } },
      destination: "field",
    },
  },
};
check("破棄カードのfield置換carrierを無償配置として認識", () =>
  none(costEffect(discardToFieldWithoutCost), discardToFieldWithoutCostText)
);
check(
  "破棄カードのfield置換がトラッシュ行きへ壊れた場合は無償配置reviewを残す",
  () => {
    const broken = clone(discardToFieldWithoutCost);
    broken.prepaidCost.discardDisposition.destination = "trash";
    assert.ok(
      issue(
        detect(costEffect(broken), [discardToFieldWithoutCostText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "破棄カードのfield置換から条件名filterが欠落した場合はreviewを残す",
  () => {
    const broken = clone(discardToFieldWithoutCost);
    delete broken.prepaidCost.discardDisposition.ifCardFilter;
    assert.ok(
      issue(
        detect(costEffect(broken), [discardToFieldWithoutCostText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check("破棄カードのfield置換の条件名filterが別名の場合はreviewを残す", () => {
  const broken = clone(discardToFieldWithoutCost);
  broken.prepaidCost.discardDisposition.ifCardFilter.cardName.contains =
    "別のカード名";
  assert.ok(
    issue(
      detect(costEffect(broken), [discardToFieldWithoutCostText]),
      "payment_scope_review",
      "review"
    )
  );
});
const discardToFieldExactWithoutCostText =
  "自分の手札1枚を破棄することで、ドロー枚数を+1する。破棄したカードが、カード名：「ダルザナ・マグバレッジ」のとき、トラッシュに置くかわりにコスト支払わずに配置する。";
const discardToFieldExactWithoutCost = {
  ...clone(discardToFieldWithoutCost),
  prepaidCost: {
    ...clone(discardToFieldWithoutCost.prepaidCost),
    discardDisposition: {
      ...clone(discardToFieldWithoutCost.prepaidCost.discardDisposition),
      ifCardFilter: {
        cardName: { exact: "ダルザナ・マグバレッジ" },
      },
    },
  },
};
check("カード名指定の破棄カードfield置換carrierを無償配置として認識", () =>
  none(
    costEffect(discardToFieldExactWithoutCost),
    discardToFieldExactWithoutCostText
  )
);
check(
  "カード名指定の破棄カードfield置換で条件名filterが欠落した場合はreviewを残す",
  () => {
    const broken = clone(discardToFieldExactWithoutCost);
    delete broken.prepaidCost.discardDisposition.ifCardFilter;
    assert.ok(
      issue(
        detect(costEffect(broken), [discardToFieldExactWithoutCostText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "カード名指定の破棄カードfield置換がcontains化した場合はreviewを残す",
  () => {
    const broken = clone(discardToFieldExactWithoutCost);
    broken.prepaidCost.discardDisposition.ifCardFilter.cardName = {
      contains: "ダルザナ・マグバレッジ",
    };
    assert.ok(
      issue(
        detect(costEffect(broken), [discardToFieldExactWithoutCostText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check(
  "カード名指定の破棄カードfield置換が別exact名の場合はreviewを残す",
  () => {
    const broken = clone(discardToFieldExactWithoutCost);
    broken.prepaidCost.discardDisposition.ifCardFilter.cardName.exact =
      "別のカード名";
    assert.ok(
      issue(
        detect(costEffect(broken), [discardToFieldExactWithoutCostText]),
        "payment_scope_review",
        "review"
      )
    );
  }
);
check("ベル型の印字コスト分だけ割引する近似を検知", () =>
  assert.ok(
    issue(
      detect(costEffect({ ...bell, modifier: { additionalCostValue: -9 } }), [
        freeText,
      ]),
      "payment_constraint_mismatch"
    )
  )
);
check("summon側にmodifierがなくても別continuous補完を考慮してreview", () => {
  const found = detect(
    costEffect({ kind: "summon", target: { kind: "self" } }),
    [freeText]
  );
  assert.ok(issue(found, "payment_constraint_mismatch", "review"));
  assert.ok(found.every((entry) => entry.severity !== "violation"));
});
const reverseRebirthFreeText =
  "このスピリットを裏返してコストを支払わずに配置できる。";
check("無償の逆転醒配置primitiveをfree支払いとして認識", () =>
  none(
    costEffect({
      kind: "reverse_rebirth",
      mode: "summon",
      withoutCost: true,
    }),
    reverseRebirthFreeText
  )
);
check("逆転醒配置からwithoutCostが欠落すればreviewを残す", () => {
  const found = detect(
    costEffect({ kind: "reverse_rebirth", mode: "summon" }),
    [reverseRebirthFreeText]
  );
  assert.ok(issue(found, "payment_constraint_mismatch", "review"));
  assert.ok(found.every((entry) => entry.severity !== "violation"));
});
const extraText =
  "相手はマジックカードを使用するとき、3コスト余分に支払わなければならない。";
const extraPayment = {
  kind: "cost_modify",
  player: "opponent",
  modifier: { additionalCostValue: 3 },
  additionalPayment: true,
};
check("余分コストの明示flagを保持", () =>
  none(costEffect(extraPayment), extraText)
);
const sharedContinuousExtraLines = [
  "",
  "",
  "",
  "",
  "",
  "Lv1-Lv2",
  "このスピリットのシンボルは紫としても扱う。相手がバースト効果以外の効果でスピリットカードを召喚するとき、3コスト余分に支払わなければ召喚できない。",
];
const continuousExtraCarrier = effect([{ action: extraPayment }], {
  timing: { kind: "continuous" },
  textRef: [5, 6],
});
const continuousSymbolCompanion = effect(
  [
    {
      action: { kind: "treat_as", aspects: ["symbol"], asColor: "purple" },
    },
  ],
  { timing: { kind: "continuous" }, textRef: [5, 6] }
);
check("同一本文の継続 sibling に分離した余分コストcarrierを認識", () =>
  none(continuousSymbolCompanion, sharedContinuousExtraLines, {
    siblingEffects: [continuousExtraCarrier],
  })
);
check("同一本文の継続 sibling で余分コストflagが欠ければ解消しない", () => {
  const broken = clone(continuousExtraCarrier);
  delete broken.steps[0].action.additionalPayment;
  const found = detect(continuousSymbolCompanion, sharedContinuousExtraLines, {
    siblingEffects: [broken],
  });
  assert.ok(
    issue(found, "payment_constraint_mismatch") ||
      issue(found, "payment_constraint_mismatch", "review") ||
      issue(found, "payment_scope_review", "review")
  );
});
check("余分コストを通常コスト変更へ落とすと違反", () =>
  assert.ok(
    issue(
      detect(costEffect({ ...extraPayment, additionalPayment: undefined }), [
        extraText,
      ]),
      "payment_constraint_mismatch"
    )
  )
);
check("余分コストflagが正しくても静的金額違いを検知", () => {
  const found = issue(
    detect(
      costEffect({ ...extraPayment, modifier: { additionalCostValue: 2 } }),
      [extraText]
    ),
    "payment_constraint_mismatch"
  );
  assert.ok(found);
  assert.match(found.evidence, /additionalCostValue:3/);
  assert.match(found.evidence, /"additionalCostValue":2/);
});
check("余分コストの動的金額は静的な違反と断定しない", () => {
  const found = detect(
    costEffect({
      ...extraPayment,
      modifier: { additionalCostValue: { source: { kind: "count_value" } } },
    }),
    [extraText]
  );
  assert.ok(issue(found, "payment_constraint_mismatch", "review"));
  assert.ok(found.every((entry) => entry.severity === "review"));
});
const countScaledExtraText =
  "自分のカウント3につき、1コスト余分に支払わなければならない。";
const countScaledExtraPayment = {
  ...extraPayment,
  modifier: {
    additionalCostValue: {
      source: { kind: "count_value", player: "self" },
      divisor: 3,
    },
  },
};
check("カウントNにつきの余分コストを動的 additionalCostValue として認識", () =>
  none(costEffect(countScaledExtraPayment), countScaledExtraText)
);
check("カウントNにつきの余分コストで groupMultiplier を誤ると検知", () => {
  const found = issue(
    detect(
      costEffect({
        ...countScaledExtraPayment,
        modifier: {
          additionalCostValue: {
            ...countScaledExtraPayment.modifier.additionalCostValue,
            groupMultiplier: 2,
          },
        },
      }),
      [countScaledExtraText]
    ),
    "payment_constraint_mismatch",
    "review"
  );
  assert.ok(found);
  assert.match(found.evidence, /count_value/);
});
check("カウントNにつきの余分コストで subtract を混ぜると検知", () => {
  const found = issue(
    detect(
      costEffect({
        ...countScaledExtraPayment,
        modifier: {
          additionalCostValue: {
            ...countScaledExtraPayment.modifier.additionalCostValue,
            subtract: { kind: "count_value", player: "self" },
          },
        },
      }),
      [countScaledExtraText]
    ),
    "payment_constraint_mismatch",
    "review"
  );
  assert.ok(found);
  assert.match(found.evidence, /subtract/);
});
check("複数cost_modifyの対応を一意に決めない", () => {
  const found = detect(
    effect([
      { action: extraPayment },
      { action: { ...extraPayment, additionalPayment: undefined } },
    ]),
    [extraText]
  );
  assert.ok(issue(found, "payment_scope_review", "review"));
  assert.ok(found.every((entry) => entry.severity !== "violation"));
});
const overrideText = "手札/手元にあるこのカードはコスト2として召喚できる。";
check("コスト2として召喚は軽減前override", () =>
  none(
    costEffect({
      kind: "summon",
      target: { kind: "self" },
      costModifier: { override: 2 },
    }),
    overrideText
  )
);
check("通常のコスト扱いをadvent専用primitiveへ誤配線すると検知", () => {
  const found = detect(
    costEffect({
      kind: "advent_cost_override",
      target: { kind: "self" },
      costTreatedAs: 2,
    }),
    [overrideText]
  );
  assert.ok(
    issue(found, "payment_constraint_mismatch") ||
      issue(found, "payment_scope_review", "review")
  );
});
const adventOverrideText =
  "Lv2\n系統:「幻想」と「妖戒」を持つコスト4以下のスピリットすべては、自分が【煌臨】するとき、コスト5としても扱う。";
const adventOverrideCarrier = {
  kind: "advent_cost_override",
  target: {
    kind: "filter",
    player: "self",
    filter: {
      category: ["spirit"],
      tribes: ["幻想", "妖戒"],
      tribesLogic: "and",
      maxCost: 4,
    },
    count: "all",
  },
  costTreatedAs: 5,
  duration: { scope: "while_on_field" },
};
const adventOverrideEffect = effect([{ action: adventOverrideCarrier }], {
  timing: { kind: "continuous" },
  condition: [{ kind: "min_level", value: 2 }],
});
check("煌臨条件だけのコスト5扱いをadvent_cost_overrideで認識", () =>
  none(adventOverrideEffect, adventOverrideText)
);
check("煌臨条件コスト付与をcard_eventで発揮させると検知", () => {
  const found = detect(costEffect(adventOverrideCarrier), [adventOverrideText]);
  assert.ok(issue(found, "payment_constraint_mismatch"));
});
check("煌臨条件コスト付与からLv2 gateを外すと検知", () => {
  const found = detect(
    effect([{ action: adventOverrideCarrier }], {
      timing: { kind: "continuous" },
    }),
    [adventOverrideText]
  );
  assert.ok(issue(found, "payment_constraint_mismatch"));
});
check("煌臨条件コスト付与は同じLv2 applicability gateでも認識", () =>
  none(
    effect([{ action: adventOverrideCarrier }], {
      timing: { kind: "continuous" },
      applicability: { level: { min: 2 } },
    }),
    adventOverrideText
  )
);
check("煌臨条件コスト付与を通常cost_modifyへ退行させると検知", () => {
  const found = detect(
    costEffect({
      kind: "cost_modify",
      target: adventOverrideCarrier.target,
      modifier: { override: 5 },
    }),
    [adventOverrideText]
  );
  assert.ok(issue(found, "payment_constraint_mismatch"));
});
check("煌臨条件コスト付与の数値違いを検知", () => {
  const found = detect(
    costEffect({ ...adventOverrideCarrier, costTreatedAs: 4 }),
    [adventOverrideText]
  );
  assert.ok(issue(found, "payment_constraint_mismatch"));
});
check("コスト2として召喚を固定支払い2へ落とすと違反", () =>
  assert.ok(
    issue(
      detect(
        costEffect({
          kind: "summon",
          target: { kind: "self" },
          costModifier: { fixedPayment: 2 },
        }),
        [overrideText]
      ),
      "payment_constraint_mismatch"
    )
  )
);
check("固定2コスト支払っての本文はoverrideに誤変換しない", () =>
  none(
    costEffect({
      kind: "summon",
      target: { kind: "self" },
      costModifier: { fixedPayment: 2 },
    }),
    "2コスト支払って召喚する。"
  )
);
const fromZoneOverrideText =
  "自分のトラッシュにある系統：「動玩」を持つコスト6以下のスピリットカード1枚をコスト0として召喚できる。";
const fromZoneOverrideEffect = (maxCost) =>
  costEffect({
    kind: "summon",
    target: {
      kind: "from_zone",
      zone: "trash",
      filter: { category: ["spirit"], tribes: ["動玩"], maxCost },
      count: 1,
    },
    costModifier: { override: 0 },
  });
check("from_zone の対象コスト上限とコスト0 override を認識", () =>
  none(fromZoneOverrideEffect(6), fromZoneOverrideText)
);
check("from_zone の対象コスト上限を狭めると検知", () => {
  const found = issue(
    detect(fromZoneOverrideEffect(5), [fromZoneOverrideText]),
    "target_cost_bound_mismatch",
    "review"
  );
  assert.ok(found);
  assert.equal(found.path, "$.steps[0].action.target.filter.maxCost");
});
check("本文に無料と有料の別経路が混在する場合はreview", () => {
  const found = detect(
    costEffect({
      kind: "summon",
      target: { kind: "self" },
      costModifier: { fixedPayment: 2 },
    }),
    [
      "このカードはコスト2として召喚できる。別の方法ではコストを支払わずに召喚する。",
    ]
  );
  assert.ok(found.some((entry) => entry.severity === "review"));
  assert.ok(found.every((entry) => entry.severity !== "violation"));
});

const pairedFreeSelfSummonText =
  "手札にあるこのカードは召喚できる。〔ターンに1回：同名〕このとき、コストを支払わずに召喚できる。";
const paidSelfSummonVariant = {
  timing: { kind: "activated", mode: "flash" },
  timingScope: { player: "both", period: "attack" },
  applicability: { zone: ["hand", "set_aside"] },
  executionMode: "optional",
  textRef: [0],
  steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
};
const freeSelfSummonVariant = {
  ...clone(paidSelfSummonVariant),
  usageLimit: turn,
  steps: [
    {
      action: {
        kind: "summon",
        target: { kind: "self" },
        costModifier: "free",
      },
    },
  ],
};
check(
  "同一原文の通常/無料self summon兄弟へ回数制限と無料指定を正しく帰属する",
  () =>
    assert.deepEqual(
      detect(paidSelfSummonVariant, [pairedFreeSelfSummonText], {
        siblingEffects: [freeSelfSummonVariant],
      }),
      []
    )
);
check("兄弟の無料carrierが壊れれば通常/無料self summon分割を認識しない", () => {
  const brokenFree = clone(freeSelfSummonVariant);
  delete brokenFree.steps[0].action.costModifier;
  const found = detect(paidSelfSummonVariant, [pairedFreeSelfSummonText], {
    siblingEffects: [brokenFree],
  });
  assert.ok(issue(found, "usage_constraint_mismatch", "review"));
  assert.ok(issue(found, "payment_constraint_mismatch", "review"));
});

const bulletEditText =
  "ゲーム中に1回、手札1枚をこのカード/スピリットの下に置ける。そうしたとき、デッキの上から1枚ドローする。（下のカードは、フラッシュタイミングで手札1枚と入れ替えられ、フィールドを離れるとき、破棄する。）";
const bulletEditParenthetical =
  "下のカードは、フラッシュタイミングで手札1枚と入れ替えられ、フィールドを離れるとき、破棄する。";
const swapBulletEditEffect = (prompt = true) => ({
  timing: { kind: "activated", mode: "flash" },
  executionMode: "optional",
  textRef: [0],
  steps: [
    {
      action: {
        kind: "swap_bullet_edit",
        target: { kind: "filter", zone: "hand", player: "self", count: 1 },
      },
      ...(prompt ? { prompt: { sourceText: bulletEditParenthetical } } : {}),
    },
  ],
});
check("括弧内で独立するバレット入替は親のゲーム回数制限を継承しない", () =>
  none(swapBulletEditEffect(), bulletEditText)
);
check(
  "括弧内の原文帰属を失うとバレット入替の回数制限を未確認として残す",
  () => {
    const found = detect(swapBulletEditEffect(false), [bulletEditText]);
    assert.ok(issue(found, "usage_constraint_mismatch", "review"));
  }
);

const targetEffect = (filter) =>
  costEffect({
    kind: "destroy",
    target: { kind: "filter", player: "opponent", filter, count: 1 },
  });
const costConditionChangeText =
  "自分のカウント3以上のとき、このブレイヴの効果の条件を「本来のコスト9以下」に変更する。";
const costPreventBattleEffect = (maxCost) =>
  effect([
    {
      action: {
        kind: "prevent_battle",
        target: {
          kind: "filter",
          player: "opponent",
          filter: {
            category: ["spirit"],
            maxCost,
            costBasis: "printed",
          },
          count: 2,
        },
        restriction: ["block"],
        duration: { scope: "turn" },
      },
    },
  ]);
const costConditionChangeEffect = (addLimitAmount) =>
  effect(
    [
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
    {
      timing: { kind: "continuous" },
      condition: [{ kind: "count_value", player: "self", min: 3 }],
    }
  );
check("自己効果のコスト条件変更を先行prevent_battle+deltaで認識", () =>
  none(costConditionChangeEffect(2), costConditionChangeText, {
    referencedEffects: [costPreventBattleEffect(7)],
  })
);
check("自己効果のコスト条件変更でdeltaが壊れるとreviewを残す", () =>
  assert.ok(
    issue(
      detect(costConditionChangeEffect(1), [costConditionChangeText], {
        referencedEffects: [costPreventBattleEffect(7)],
      }),
      "target_cost_scope_review",
      "review"
    )
  )
);
const attackerFilterEffect = (minCost) =>
  effect([
    {
      action: {
        kind: "life_damage_interception",
        player: "self",
        attackerFilter: {
          category: ["spirit", "ultimate"],
          minCost,
        },
      },
    },
  ]);
const attackerFilterText =
  "このターンの間、自分のライフはコスト5以上の相手のスピリット/アルティメットのアタックでは1しか減らない。";
check("アタッカーのコスト下限をattackerFilterで認識", () =>
  none(attackerFilterEffect(5), attackerFilterText)
);
check("アタッカーのコスト下限欠落を検知", () => {
  const found = issue(
    detect(attackerFilterEffect(undefined), [attackerFilterText]),
    "target_cost_bound_mismatch"
  );
  assert.ok(found);
  assert.equal(found.path, "$.steps[0].action.attackerFilter.minCost");
});
const attackerFilterWithDeckImmunityEffect = (minCost) =>
  effect([
    {
      action: {
        kind: "life_damage_interception",
        player: "self",
        cause: "opponent",
        mode: "replace",
        attackerFilter: {
          category: ["spirit", "ultimate"],
          minCost,
        },
        duration: { scope: "turn" },
      },
    },
    {
      action: {
        kind: "effect_immunity",
        target: {
          kind: "filter",
          player: "self",
          filter: {},
          count: "all",
          zone: ["deck"],
        },
        duration: { scope: "turn" },
      },
    },
  ]);
const attackerFilterWithDeckImmunityText =
  "このターンの間、コスト4以上の相手のスピリット/アルティメットによって自分のライフは減らず、自分のデッキは相手の効果を受けない。";
check(
  "ライフ減少の発生カードのコスト条件と同一effect内のデッキ耐性targetを混同しない",
  () =>
    none(
      attackerFilterWithDeckImmunityEffect(4),
      attackerFilterWithDeckImmunityText
    )
);
check(
  "同一effect内のデッキ耐性があってもライフ減少発生カードのコスト下限欠落を検知",
  () => {
    const found = issue(
      detect(attackerFilterWithDeckImmunityEffect(undefined), [
        attackerFilterWithDeckImmunityText,
      ]),
      "target_cost_bound_mismatch",
      "review"
    );
    assert.ok(found);
    assert.equal(found.path, "$.steps[0].action.attackerFilter.minCost");
  }
);
const stackSourceRestrictionEffect = (minCost) =>
  effect(
    [
      {
        action: {
          kind: "restrict_stack",
          player: "opponent",
          targetScope: "effect_source",
          sourceCardFilter: {
            category: ["spirit"],
            tribes: ["CB"],
            minCost,
          },
          duration: { scope: "while_set" },
        },
      },
    ],
    {
      timing: { kind: "continuous" },
      timingScope: { player: "both", period: "attack" },
    }
  );
const stackSourceRestrictionText =
  "アタックステップ中、相手は自分の系統:「CB」を持つコスト6以上のスピリットをスタックタイミング元にして、スタック効果を使用できない。";
check("stack timing source のコスト下限を sourceCardFilter で認識", () =>
  none(stackSourceRestrictionEffect(6), stackSourceRestrictionText)
);
check("stack timing source のコスト下限欠落を sourceCardFilter で検知", () => {
  const found = issue(
    detect(stackSourceRestrictionEffect(undefined), [
      stackSourceRestrictionText,
    ]),
    "target_cost_bound_mismatch"
  );
  assert.ok(found);
  assert.equal(found.path, "$.steps[0].action.sourceCardFilter.minCost");
});
check("stack timing source 制限の主体を反転すると review を残す", () => {
  const broken = stackSourceRestrictionEffect(6);
  broken.steps[0].action.player = "self";
  const found = issue(
    detect(broken, [stackSourceRestrictionText]),
    "target_cost_scope_review",
    "review"
  );
  assert.ok(found);
  assert.equal(found.path, "$.steps[0].action.player");
  assert.match(found.evidence, /restrict_stack\.player:opponent/);
});
check("対象コスト上限の正しい定義", () =>
  none(
    targetEffect({ category: ["spirit"], maxCost: 5 }),
    "コスト5以下の相手のスピリット1体を破壊する。"
  )
);
const discardHandCostEffect = (maxCost) =>
  effect([
    {
      action: {
        kind: "discard",
        player: "opponent",
        count: 1,
        filter: {
          isContract: false,
          ...(maxCost === undefined ? {} : { maxCost }),
        },
        selectionPlayer: "effect_controller",
      },
    },
  ]);
const discardHandCostText =
  "相手の手札の内容を見れる。その中の契約カード以外のコスト3以下のカード1枚を破棄する。";
check("手札破棄 action.filter のコスト上限を正準 carrier として認識", () =>
  none(discardHandCostEffect(3), discardHandCostText)
);
check("手札破棄 action.filter のコスト上限が欠ければ検知する", () => {
  const found = issue(
    detect(discardHandCostEffect(undefined), [discardHandCostText]),
    "target_cost_bound_mismatch"
  );
  assert.ok(found);
  assert.equal(found.path, "$.steps[0].action.filter.maxCost");
});
check("対象コスト上限欠落", () =>
  assert.ok(
    issue(
      detect(targetEffect({ category: ["spirit"] }), [
        "コスト5以下の相手のスピリット1体を破壊する。",
      ]),
      "target_cost_bound_mismatch"
    )
  )
);
check("対象コスト上限のoff-by-one", () =>
  assert.ok(
    issue(
      detect(targetEffect({ maxCost: 6 }), [
        "コスト5以下の相手のスピリット1体を破壊する。",
      ]),
      "target_cost_bound_mismatch"
    )
  )
);
check("未満は整数上限N-1", () =>
  none(
    targetEffect({ maxCost: 4 }),
    "コスト5未満の相手のスピリット1体を破壊する。"
  )
);
check("以上は下限", () =>
  none(
    targetEffect({ minCost: 5 }),
    "コスト5以上の相手のスピリット1体を破壊する。"
  )
);
check("本来のコストはprinted基準", () =>
  none(
    targetEffect({ maxCost: 5, costBasis: "printed" }),
    "本来のコスト5以下の相手のスピリット1体を破壊する。"
  )
);
check("本来のコストのbasis欠落", () =>
  assert.ok(
    issue(
      detect(targetEffect({ maxCost: 5 }), [
        "本来のコスト5以下の相手のスピリット1体を破壊する。",
      ]),
      "target_cost_basis_mismatch"
    )
  )
);
const sharedHeavyArmorText =
  'Lv1-Lv2このスピリットと系統:「幻想」を持つ自分のコスト6以上の紫のスピリットすべてに"【超重装甲:紫/緑/白】このスピリットは相手の紫/緑/白の効果を受けない。"を与える。';
const sharedHeavyArmorSelfEffect = () =>
  effect(
    [
      {
        action: {
          kind: "effect_immunity",
          target: { kind: "self" },
          sourceScope: { colors: ["purple", "green", "white"] },
          duration: { scope: "while_on_field" },
        },
      },
    ],
    { timing: { kind: "continuous" }, textRef: [0] }
  );
const sharedHeavyArmorFilterEffect = (minCost) =>
  effect(
    [
      {
        action: {
          kind: "effect_immunity",
          target: {
            kind: "filter",
            player: "self",
            filter: {
              category: ["spirit"],
              tribes: ["幻想"],
              colors: ["purple"],
              minCost,
            },
            count: "all",
            excludeSelf: true,
          },
          sourceScope: { colors: ["purple", "green", "white"] },
          duration: { scope: "while_on_field" },
        },
      },
    ],
    { timing: { kind: "continuous" }, textRef: [0] }
  );
check("共有本文をself+条件付き超重装甲へ分離したコスト下限carrierを認識", () =>
  none(sharedHeavyArmorSelfEffect(), sharedHeavyArmorText, {
    siblingEffects: [sharedHeavyArmorFilterEffect(6)],
  })
);
check("共有本文の超重装甲 sibling のコスト下限を壊すとreviewを残す", () => {
  const found = issue(
    detect(sharedHeavyArmorSelfEffect(), [sharedHeavyArmorText], {
      siblingEffects: [sharedHeavyArmorFilterEffect(5)],
    }),
    "target_cost_scope_review",
    "review"
  );
  assert.ok(found);
  assert.match(found.evidence, /コスト6以上/);
});
const leaveFieldTriggerEffect = (triggerFilter) => ({
  timing: {
    kind: "game_event",
    player: "self",
    event: "leave_field",
    triggerFilter,
  },
  executionMode: "optional",
  textRef: [0],
  steps: [
    {
      action: {
        kind: "move_card",
        target: { kind: "self" },
        from: { zone: "trash", player: "self" },
        to: { zone: "hand" },
        count: 1,
      },
    },
  ],
});
const leaveFieldTriggerText =
  "本来のコスト6以上の自分のスピリットが相手によってフィールドを離れるとき、手札に戻せる。";
check("誘発イベント主体の本来コスト条件を triggerFilter で認識", () =>
  none(
    leaveFieldTriggerEffect({
      category: ["spirit"],
      minCost: 6,
      costBasis: "printed",
    }),
    leaveFieldTriggerText
  )
);
check("誘発イベント主体の本来コスト境界を壊すと review を残す", () => {
  const found = issue(
    detect(
      leaveFieldTriggerEffect({
        category: ["spirit"],
        minCost: 5,
        costBasis: "printed",
      }),
      [leaveFieldTriggerText]
    ),
    "target_cost_bound_mismatch",
    "review"
  );
  assert.ok(found);
  assert.equal(found.path, "$.timing.triggerFilter.minCost");
});
const battleEndTriggerEffect = (maxCost) => ({
  timing: {
    kind: "game_event",
    player: "opponent",
    event: "battle_end",
    triggerFilter: { category: ["spirit"], maxCost },
  },
  executionMode: "optional",
  textRef: [0],
  steps: [
    {
      action: {
        kind: "destroy",
        target: { kind: "trigger_related_instance" },
      },
    },
  ],
});
const battleEndTriggerText =
  "コスト5以下の相手のスピリットのバトル終了時、その対象を破壊できる。";
check(
  "誘発イベント主体のコスト条件を『バトル終了時』でも triggerFilter で認識",
  () => none(battleEndTriggerEffect(5), battleEndTriggerText)
);
check(
  "『バトル終了時』誘発の triggerFilter コスト境界を壊すと review を残す",
  () => {
    const found = issue(
      detect(battleEndTriggerEffect(4), [battleEndTriggerText]),
      "target_cost_bound_mismatch"
    );
    assert.ok(found);
    assert.equal(found.path, "$.timing.triggerFilter.maxCost");
  }
);
check(
  "後段 action の対象を処理した後の『バトル終了時』は triggerFilter で充足しない",
  () => {
    const findings = detect(battleEndTriggerEffect(5), [
      "コスト5以下の相手のスピリットを破壊し、バトル終了時、その対象を破壊できる。",
    ]);
    assert.ok(findings.length > 0);
  }
);
const prefixedOwnerSummonTriggerEffect = (minCost) => ({
  timing: {
    kind: "game_event",
    player: "self",
    event: "summon",
    triggerFilter: {
      category: ["spirit"],
      tribes: ["封魔"],
      minCost,
    },
  },
  executionMode: "optional",
  textRef: [0],
  steps: [
    {
      action: {
        kind: "bounce",
        target: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit", "ultimate"] },
          count: 1,
        },
      },
    },
  ],
});
const prefixedOwnerSummonTriggerText =
  "系統:「封魔」を持つ自分のコスト3以上のスピリットが召喚されたとき、相手のスピリット/アルティメット1体を手札に戻せる。";
check("所有者がコスト句の前にある召喚誘発の下限を triggerFilter で認識", () =>
  none(prefixedOwnerSummonTriggerEffect(3), prefixedOwnerSummonTriggerText)
);
check("所有者がコスト句の前にある召喚誘発の下限を壊すと review を残す", () => {
  const found = detect(prefixedOwnerSummonTriggerEffect(2), [
    prefixedOwnerSummonTriggerText,
  ]);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], {
    kind: "target_cost_bound_mismatch",
    path: "$.timing.triggerFilter.minCost",
    message: "本文のコスト境界が対象filterに一致しない",
    evidence:
      '本文=コスト3以上; 期待=minCost:3; 実値={"category":["spirit"],"tribes":["封魔"],"minCost":2}',
    severity: "review",
  });
});
const sharedTextContinuousProtection = effect(
  [
    {
      action: {
        kind: "effect_resistance",
        target: {
          kind: "filter",
          player: "self",
          filter: { category: ["nexus"], tribes: ["紅魔"] },
          count: "all",
        },
        duration: { scope: "permanent" },
      },
    },
  ],
  { timing: { kind: "continuous" } }
);
const sharedTextSummonTrigger = (minCost) =>
  effect([{ action: { kind: "draw", count: 1 } }], {
    timing: {
      kind: "game_event",
      player: "self",
      event: "summon",
      triggerFilter: {
        category: ["spirit"],
        colors: ["red"],
        tribes: ["夜族"],
        minCost,
      },
    },
    executionMode: "optional",
  });
const sharedTextContinuousAndSummonText =
  "系統:「紅魔」を持つ自分のネクサスは、相手の効果では破壊されない。系統:「夜族」を持つコスト8以上の自分の赤のスピリットが召喚されたとき、ライフが5になるようにボイドからコアを置ける。";
check(
  "共有textRefの継続効果へ兄弟召喚triggerのコスト下限を誤帰属させない",
  () =>
    none(sharedTextContinuousProtection, sharedTextContinuousAndSummonText, {
      siblingEffects: [sharedTextSummonTrigger(8)],
    })
);
check(
  "共有textRefの兄弟召喚triggerのコスト下限を壊すと継続効果側にもreviewを残す",
  () => {
    const found = issue(
      detect(
        sharedTextContinuousProtection,
        [sharedTextContinuousAndSummonText],
        {
          siblingEffects: [sharedTextSummonTrigger(7)],
        }
      ),
      "target_cost_bound_mismatch",
      "review"
    );
    assert.ok(found);
    assert.equal(found.path, "$.steps[0].action.target.filter.minCost");
  }
);
const leaveFieldThenDestroyEffect = (triggerFilter) => ({
  timing: {
    kind: "game_event",
    player: "self",
    event: "leave_field",
    triggerFilter,
  },
  executionMode: "optional",
  textRef: [0],
  steps: [
    {
      action: {
        kind: "destroy",
        target: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit"] },
          count: 1,
        },
      },
    },
  ],
});
const leaveFieldThenDestroyText =
  "自分のスピリットがフィールドを離れるとき、コスト6以上の相手のスピリット1体を破壊できる。";
check(
  "後段対象のコスト境界を triggerFilter で満たしたものとして見逃さない",
  () => {
    const found = issue(
      detect(
        leaveFieldThenDestroyEffect({ category: ["spirit"], minCost: 6 }),
        [leaveFieldThenDestroyText]
      ),
      "target_cost_bound_mismatch",
      "review"
    );
    assert.ok(found);
    assert.equal(found.path, "$.steps[0].action.target.filter.minCost");
  }
);
const leaveFieldTriggerSourceEffect = (triggerSourceFilter) => ({
  timing: {
    kind: "game_event",
    player: "opponent",
    event: "leave_field",
    triggerFilter: { category: ["spirit", "ultimate"] },
    triggerSourceFilter,
  },
  textRef: [0],
  steps: [
    {
      action: {
        kind: "suppress_pending_leave_effects",
        target: { kind: "trigger_related_instance", includePendingLeave: true },
        suppressDestroyedEffects: "destroyed_only",
      },
    },
  ],
});
const leaveFieldTriggerSourceText =
  "系統：「CB」を持つコスト6以上の自分のスピリットの効果でフィールドを離れる相手のスピリット/アルティメットの効果は発揮されない。";
check("離脱を起こす効果のコスト条件を triggerSourceFilter で認識", () =>
  none(
    leaveFieldTriggerSourceEffect({
      category: ["spirit"],
      tribes: ["CB"],
      minCost: 6,
    }),
    leaveFieldTriggerSourceText
  )
);
check("離脱を起こす効果のコスト境界を壊すと violation を残す", () => {
  const found = issue(
    detect(
      leaveFieldTriggerSourceEffect({
        category: ["spirit"],
        tribes: ["CB"],
        minCost: 5,
      }),
      [leaveFieldTriggerSourceText]
    ),
    "target_cost_bound_mismatch"
  );
  assert.ok(found);
  assert.equal(found.path, "$.timing.triggerSourceFilter.minCost");
});
check(
  "通常コストをprintedだけに狭めると追加コストが一致する対象を落とす",
  () => {
    const found = issue(
      detect(targetEffect({ maxCost: 5, costBasis: "printed" }), [
        "コスト5以下の相手のスピリットを破壊する。",
      ]),
      "target_cost_basis_mismatch",
      "review"
    );
    assert.ok(found);
    assert.match(found.evidence, /effective_or_additional/);
    assert.match(found.evidence, /実値=printed/);
  }
);
for (const separator of ["～", "〜", "~", "-", "から"]) {
  check(`範囲${separator}表記の両境界を検査`, () => {
    const text = `コストが5${separator}8の相手のスピリット1体を破壊する。`;
    none(targetEffect({ minCost: 5, maxCost: 8 }), text);
    const found = detect(targetEffect({ minCost: 4, maxCost: 9 }), [text]);
    assert.equal(
      found.filter((entry) => entry.kind === "target_cost_bound_mismatch")
        .length,
      2
    );
    assert.ok(found.every((entry) => entry.severity === "violation"));
  });
}
const dualCostText =
  "本来のコストを含むコストが5～8の自分のスピリットすべてに効果を与える。";
const dualCostFilter = {
  minCost: 5,
  maxCost: 8,
  exclude: {
    filterOr: [
      { maxCost: 4, costBasis: "printed" },
      { minCost: 9, costBasis: "printed" },
    ],
  },
};
check("本来を含む範囲は実効範囲AND印字範囲外除外で成立", () =>
  none(targetEffect(dualCostFilter), dualCostText)
);
check("本来を含む範囲をprintedだけへ縮約するとreview", () => {
  const found = issue(
    detect(targetEffect({ minCost: 5, maxCost: 8, costBasis: "printed" }), [
      dualCostText,
    ]),
    "target_cost_basis_mismatch",
    "review"
  );
  assert.ok(found);
  assert.match(found.evidence, /印字AND実効/);
  assert.match(found.evidence, /"minCost":5,"maxCost":8/);
  assert.match(found.evidence, /printed/);
});
check("本来を含む範囲を既定の実効側だけへ縮約するとreview", () =>
  assert.ok(
    issue(
      detect(targetEffect({ minCost: 5, maxCost: 8 }), [dualCostText]),
      "target_cost_basis_mismatch",
      "review"
    )
  )
);
check("本来を含む範囲の印字側境界off-by-oneを検知", () => {
  const broken = clone(dualCostFilter);
  broken.exclude.filterOr[0].maxCost = 5;
  assert.ok(
    issue(
      detect(targetEffect(broken), [dualCostText]),
      "target_cost_basis_mismatch",
      "review"
    )
  );
});
check("本来を含む範囲の実効側上限欠落を検知", () => {
  const broken = clone(dualCostFilter);
  delete broken.maxCost;
  const found = detect(targetEffect(broken), [dualCostText]);
  assert.ok(issue(found, "target_cost_bound_mismatch", "review"));
  assert.ok(issue(found, "target_cost_basis_mismatch", "review"));
});
check("印字範囲外の除外に別条件が付けば同じAND制約とは証明しない", () => {
  const broken = clone(dualCostFilter);
  broken.exclude.filterOr[0].colors = ["yellow"];
  assert.ok(
    issue(
      detect(targetEffect(broken), [dualCostText]),
      "target_cost_basis_mismatch",
      "review"
    )
  );
});
check("印字範囲外除外のさらに除外があれば同値とは証明しない", () => {
  const broken = clone(dualCostFilter);
  broken.exclude.exclude = { category: ["spirit"] };
  assert.ok(
    issue(
      detect(targetEffect(broken), [dualCostText]),
      "target_cost_basis_mismatch",
      "review"
    )
  );
});
check(
  "textRefを持たない付与効果は外側grant targetの印字AND実効コストcarrierを継承する",
  () => {
    const grant = effect([
      {
        action: {
          kind: "grant_effect",
          target: {
            kind: "filter",
            player: "self",
            filter: dualCostFilter,
            count: "all",
          },
          grantedEffect: {
            timing: { kind: "card_event", event: "destroy" },
            steps: [
              { action: { kind: "stay_on_field", target: { kind: "self" } } },
            ],
          },
        },
      },
    ]);
    none(
      grant,
      "本来のコストを含むコストが5～8の自分のスピリットすべては相手の効果で破壊されたとき、同じ状態でフィールドに残せる。"
    );
  }
);
check("付与効果の外側targetから印字側範囲を落とすとreviewを残す", () => {
  const brokenFilter = clone(dualCostFilter);
  delete brokenFilter.exclude;
  const grant = effect([
    {
      action: {
        kind: "grant_effect",
        target: {
          kind: "filter",
          player: "self",
          filter: brokenFilter,
          count: "all",
        },
        grantedEffect: {
          timing: { kind: "card_event", event: "destroy" },
          steps: [
            { action: { kind: "stay_on_field", target: { kind: "self" } } },
          ],
        },
      },
    },
  ]);
  const found = issue(
    detect(grant, [
      "本来のコストを含むコストが5～8の自分のスピリットすべては相手の効果で破壊されたとき、同じ状態でフィールドに残せる。",
    ]),
    "target_cost_basis_mismatch",
    "review"
  );
  assert.ok(found);
});
check("本来のコスト範囲だけならprintedで成立", () =>
  none(
    targetEffect({ minCost: 5, maxCost: 8, costBasis: "printed" }),
    "本来のコストが5～8の相手のスピリットを破壊する。"
  )
);
const referencedCostDestroyText =
  "本来のコストが6以下の相手のスピリット1体を破壊する。この「コスト破壊効果」の上限を+2する。";
const referencedCostDestroyModifier = effect(
  [
    {
      action: {
        kind: "effect_param_modify",
        effectClass: "cost_destroy",
        scope: "self",
        addLimitAmount: 2,
        duration: { scope: "while_on_field" },
      },
    },
  ],
  { timing: { kind: "continuous" } }
);
check(
  "同一本文のコスト破壊上限修飾は兄弟destroyの印字コストfilterをcarrierとして認識",
  () =>
    assert.deepEqual(
      detect(referencedCostDestroyModifier, [referencedCostDestroyText], {
        siblingEffects: [
          targetEffect({
            category: ["spirit"],
            maxCost: 6,
            costBasis: "printed",
          }),
        ],
      }),
      []
    )
);
check(
  "同一本文でも兄弟destroyの本来コストcarrierが壊れればreviewを残す",
  () => {
    const found = detect(
      referencedCostDestroyModifier,
      [referencedCostDestroyText],
      {
        siblingEffects: [
          targetEffect({
            category: ["spirit"],
            maxCost: 5,
            costBasis: "printed",
          }),
        ],
      }
    );
    assert.ok(issue(found, "target_cost_scope_review", "review"));
  }
);
check("ORfilterの分岐にある正しい上限を欠落と断定しない", () => {
  const found = detect(targetEffect({ filterOr: [{ maxCost: 5 }] }), [
    "コスト5以下のスピリットを破壊する。",
  ]);
  assert.ok(issue(found, "target_cost_scope_review", "review"));
  assert.ok(found.every((entry) => entry.severity !== "violation"));
});
const sharedCostUnionTargetText =
  "コスト4以下の相手のスピリット/アルティメット1体を疲労させる。";
const sharedCostUnionTargetFilter = {
  filterOr: [
    { category: ["spirit"], maxCost: 4 },
    { category: ["ultimate"], maxCost: 4 },
  ],
};
const opponentBurstCostText =
  "系統:「起幻」を持つ自分のスピリット/アルティメットがアタックしている間、相手のコスト6以下のバースト効果を無効にする。";
const opponentBurstCostNegate = (targetFilter) =>
  effect(
    [
      {
        action: {
          kind: "negate",
          negateTarget: "opponent_burst",
          targetFilter,
          duration: { scope: "while_on_field" },
        },
      },
    ],
    { timing: { kind: "continuous" } }
  );
check(
  "opponent_burst negate の targetFilter を実効コスト境界 carrier として認識",
  () => none(opponentBurstCostNegate({ maxCost: 6 }), opponentBurstCostText)
);
check("opponent_burst negate のコスト上限を壊すと review を残す", () => {
  const found = detect(opponentBurstCostNegate({ maxCost: 5 }), [
    opponentBurstCostText,
  ]);
  const mismatch = issue(found, "target_cost_bound_mismatch", "review");
  assert.ok(mismatch);
  assert.equal(mismatch.path, "$.steps[0].action.targetFilter.maxCost");
});
const summonPlaceCostText =
  "相手のコスト4以下のスピリットカード/ネクサスカード1枚の召喚/配置を無効にする。";
const summonPlaceCostNegate = (summonFilter, placeFilter) =>
  effect(
    [
      {
        action: {
          kind: "negate",
          negateTarget: "summon",
          targetFilter: summonFilter,
        },
      },
      {
        action: {
          kind: "negate",
          negateTarget: "place",
          targetFilter: placeFilter,
        },
      },
    ],
    { timing: { kind: "activated", mode: "stack" } }
  );
check(
  "summon/place negate の分割 targetFilter を共有コスト境界 carrier として認識",
  () =>
    none(
      summonPlaceCostNegate(
        { category: ["spirit"], maxCost: 4 },
        { category: ["nexus"], maxCost: 4 }
      ),
      summonPlaceCostText
    )
);
check("summon/place negate の片側コスト上限を壊すと review を残す", () => {
  const found = detect(
    summonPlaceCostNegate(
      { category: ["spirit"], maxCost: 4 },
      { category: ["nexus"], maxCost: 3 }
    ),
    [summonPlaceCostText]
  );
  const mismatch = issue(found, "target_cost_bound_mismatch", "review");
  assert.ok(mismatch);
  assert.equal(mismatch.path, "$.steps[1].action.targetFilter.maxCost");
});
check(
  "summon/place negate の片側コストcarrierを落とすと scope review を残す",
  () => {
    const found = detect(
      summonPlaceCostNegate(
        { category: ["spirit"], maxCost: 4 },
        { category: ["nexus"] }
      ),
      [summonPlaceCostText]
    );
    assert.ok(issue(found, "target_cost_scope_review", "review"));
  }
);
check(
  "summon/place negate の action ごとの対象種別を入れ替えると scope review を残す",
  () => {
    const found = detect(
      summonPlaceCostNegate(
        { category: ["nexus"], maxCost: 4 },
        { category: ["spirit"], maxCost: 4 }
      ),
      [summonPlaceCostText]
    );
    const mismatch = issue(found, "target_cost_scope_review", "review");
    assert.ok(mismatch);
    assert.equal(mismatch.path, "$.steps[0].action.targetFilter.category");
  }
);
check(
  "summon/place negate が同じ action 種別へ重複すると scope review を残す",
  () => {
    const found = detect(
      effect(
        [
          {
            action: {
              kind: "negate",
              negateTarget: "summon",
              targetFilter: { category: ["spirit"], maxCost: 4 },
            },
          },
          {
            action: {
              kind: "negate",
              negateTarget: "summon",
              targetFilter: { category: ["nexus"], maxCost: 4 },
            },
          },
        ],
        { timing: { kind: "activated", mode: "stack" } }
      ),
      [summonPlaceCostText]
    );
    assert.ok(issue(found, "target_cost_scope_review", "review"));
  }
);
check(
  "同じコスト句が列挙カテゴリ全体に掛かるORfilter枝を正しいcarrierとして認識",
  () =>
    none(targetEffect(sharedCostUnionTargetFilter), sharedCostUnionTargetText)
);
check("列挙カテゴリORfilterの片枝だけ上限を壊すと対応する枝を検出する", () => {
  const broken = clone(sharedCostUnionTargetFilter);
  broken.filterOr[1].maxCost = 3;
  const found = detect(targetEffect(broken), [sharedCostUnionTargetText]);
  const mismatch = issue(found, "target_cost_bound_mismatch", "violation");
  assert.ok(mismatch);
  assert.equal(
    mismatch.path,
    "$.steps[0].action.target.filter.filterOr[1].maxCost"
  );
});
check(
  "列挙カテゴリORfilterで同じカテゴリを重複しても完全被覆とは扱わない",
  () => {
    const broken = clone(sharedCostUnionTargetFilter);
    broken.filterOr[1].category = ["spirit"];
    assert.ok(
      issue(
        detect(targetEffect(broken), [sharedCostUnionTargetText]),
        "target_cost_scope_review",
        "review"
      )
    );
  }
);
for (const [label, extraBranch] of [
  ["同一カテゴリ", { category: ["spirit"] }],
  ["本文外カテゴリ", { category: ["nexus"] }],
  ["カテゴリなし", {}],
]) {
  check(
    `全カテゴリを含むORfilter枝に無制限の${label}枝があればreviewを残す`,
    () => {
      const broken = clone(sharedCostUnionTargetFilter);
      broken.filterOr = [
        { category: ["spirit", "ultimate"], maxCost: 4 },
        extraBranch,
      ];
      assert.ok(
        issue(
          detect(targetEffect(broken), [sharedCostUnionTargetText]),
          "target_cost_scope_review",
          "review"
        )
      );
    }
  );
}
check("全カテゴリを含むORfilter枝に本文外のBP枝があればreviewを残す", () => {
  const broken = clone(sharedCostUnionTargetFilter);
  broken.filterOr = [
    { category: ["spirit", "ultimate"], maxCost: 4 },
    { category: ["spirit"], maxBp: 8000 },
  ];
  assert.ok(
    issue(
      detect(targetEffect(broken), [sharedCostUnionTargetText]),
      "target_cost_scope_review",
      "review"
    )
  );
});
check("コストcarrier枝に本文外のBP制限があればreviewを残す", () => {
  const broken = clone(sharedCostUnionTargetFilter);
  broken.filterOr[0].maxBp = 8000;
  assert.ok(
    issue(
      detect(targetEffect(broken), [sharedCostUnionTargetText]),
      "target_cost_scope_review",
      "review"
    )
  );
});
check("本来のBP句にbpBasisなしの別OR枝があればreviewを残す", () => {
  const found = detect(
    targetEffect({
      filterOr: [
        { category: ["spirit"], maxBp: 8000 },
        { category: ["nexus"], maxCost: 4 },
      ],
    }),
    ["相手の本来のBP8000以下のスピリット/コスト4以下のネクサス1つを破壊する。"]
  );
  assert.ok(issue(found, "target_cost_scope_review", "review"));
});
check("別文の通常BP句をコストOR枝の根拠にしない", () => {
  const found = detect(
    targetEffect({
      filterOr: [
        { category: ["spirit"], maxBp: 8000 },
        { category: ["nexus"], maxCost: 4 },
      ],
    }),
    [
      "BP8000以下の相手のスピリット1体を疲労させる。その後、コスト4以下の相手のネクサス1つを破壊する。",
    ]
  );
  assert.ok(issue(found, "target_cost_scope_review", "review"));
});
check("列挙外のORfilter枝を混ぜると正しいcarrierと断定せずreviewを残す", () => {
  const broken = clone(sharedCostUnionTargetFilter);
  broken.filterOr.push({ category: ["nexus"], maxCost: 4 });
  assert.ok(
    issue(
      detect(targetEffect(broken), [sharedCostUnionTargetText]),
      "target_cost_scope_review",
      "review"
    )
  );
});
const splitBpAndCostTargetText =
  "相手のBP8000以下のスピリット/コスト4以下のネクサス1つを破壊する。";
const splitBpAndCostTargetFilter = {
  filterOr: [
    { category: ["spirit"], maxBp: 8000 },
    { category: ["nexus"], maxCost: 4 },
  ],
};
check(
  "カテゴリ直前のコスト句はORfilterの対応する枝を正しいcarrierとして認識",
  () => none(targetEffect(splitBpAndCostTargetFilter), splitBpAndCostTargetText)
);
check("カテゴリ直前のコスト句でも対応OR枝の上限が壊れれば検出する", () => {
  const broken = clone(splitBpAndCostTargetFilter);
  broken.filterOr[1].maxCost = 3;
  const found = detect(targetEffect(broken), [splitBpAndCostTargetText]);
  const mismatch = found.find(
    (entry) => entry.kind === "target_cost_bound_mismatch"
  );
  assert.ok(mismatch);
  assert.equal(
    mismatch.path,
    "$.steps[0].action.target.filter.filterOr[1].maxCost"
  );
});
const splitTribeAndCostTargetText =
  "その中の系統：「CB」を持つネクサスカード1枚か、系統：「CB」/「EE」を持つコスト4以上のスピリットカード1枚を手札に加える。";
const splitTribeAndCostTargetFilter = {
  filterOr: [
    { category: ["nexus"], tribes: ["CB"] },
    { category: ["spirit"], tribes: ["CB", "EE"], minCost: 4 },
  ],
};
check("系統条件を伴うコストOR枝と別系統枝を正しいcarrierとして認識", () =>
  none(targetEffect(splitTribeAndCostTargetFilter), splitTribeAndCostTargetText)
);
check("系統条件を伴うコストOR枝の下限が壊れれば検出する", () => {
  const broken = clone(splitTribeAndCostTargetFilter);
  broken.filterOr[1].minCost = 3;
  const found = detect(targetEffect(broken), [splitTribeAndCostTargetText]);
  const mismatch = issue(found, "target_cost_bound_mismatch", "violation");
  assert.ok(mismatch);
  assert.equal(
    mismatch.path,
    "$.steps[0].action.target.filter.filterOr[1].minCost"
  );
});
check("本文にない系統をコストOR枝へ足すとreviewを残す", () => {
  const broken = clone(splitTribeAndCostTargetFilter);
  broken.filterOr[1].tribes = ["CB"];
  assert.ok(
    issue(
      detect(targetEffect(broken), [splitTribeAndCostTargetText]),
      "target_cost_scope_review",
      "review"
    )
  );
});
const sharedTribeGuidedNexusCostText =
  "系統：「星蓮」/「闘神」を持つ自分の導界者ネクサス/コスト5以上のスピリットすべてに青のシンボル1つずつを追加する。";
const sharedTribeGuidedNexusCostFilter = {
  filterOr: [
    {
      category: ["nexus"],
      tribes: ["星蓮", "闘神"],
      targetsGrandwalker: true,
      hasMechanic: ["guided"],
    },
    {
      category: ["spirit"],
      tribes: ["星蓮", "闘神"],
      minCost: 5,
    },
  ],
};
check("共有系統の導界者ネクサス/コスト枝を正しいcarrierとして認識", () =>
  none(
    targetEffect(sharedTribeGuidedNexusCostFilter),
    sharedTribeGuidedNexusCostText
  )
);
check("共有系統のコスト枝の下限が壊れれば検出する", () => {
  const broken = clone(sharedTribeGuidedNexusCostFilter);
  broken.filterOr[1].minCost = 4;
  assert.ok(
    issue(
      detect(targetEffect(broken), [sharedTribeGuidedNexusCostText]),
      "target_cost_bound_mismatch",
      "violation"
    )
  );
});
check("共有系統の導界者枝がtarget lockを欠けばreviewを残す", () => {
  const broken = clone(sharedTribeGuidedNexusCostFilter);
  delete broken.filterOr[0].targetsGrandwalker;
  assert.ok(
    issue(
      detect(targetEffect(broken), [sharedTribeGuidedNexusCostText]),
      "target_cost_scope_review",
      "review"
    )
  );
});
for (const [label, patch] of [
  ["系統", { tribes: ["EE"] }],
  ["カテゴリ", { category: ["spirit"] }],
]) {
  check(`先行OR枝の${label}が本文と違えばreviewを残す`, () => {
    const broken = clone(splitTribeAndCostTargetFilter);
    Object.assign(broken.filterOr[0], patch);
    assert.ok(
      issue(
        detect(targetEffect(broken), [splitTribeAndCostTargetText]),
        "target_cost_scope_review",
        "review"
      )
    );
  });
}
check("ORfilterでは無視される直接上限の見かけの一致を通さない", () =>
  assert.ok(
    issue(
      detect(
        targetEffect({ maxCost: 5, filterOr: [{ category: ["spirit"] }] }),
        ["コスト5以下のスピリットを破壊する。"]
      ),
      "target_cost_scope_review",
      "review"
    )
  )
);
check("発揮条件のコストを対象filterに押し込まない", () => {
  const found = detect(targetEffect({}), [
    "コスト5以下の自分のスピリットがいるとき、相手のスピリット1体を破壊する。",
  ]);
  assert.ok(issue(found, "target_cost_bound_mismatch", "review"));
  assert.ok(found.every((entry) => entry.severity !== "violation"));
});
const printedFieldConditionText =
  "本来のコスト9以上の自分の「ベジータ」がいるとき、相手のスピリットすべてをデッキの下に戻せる。";
const printedFieldConditionEffect = (minCost, conditionOverrides = {}) =>
  effect(
    [
      {
        action: {
          kind: "send_to_deck",
          target: {
            kind: "filter",
            player: "opponent",
            filter: { category: ["spirit"] },
            count: "all",
          },
        },
      },
    ],
    {
      condition: [
        {
          kind: "field_has",
          player: "self",
          cardNames: [{ contains: "ベジータ" }],
          minCost,
          costBasis: "printed",
          ...conditionOverrides,
        },
      ],
    }
  );
check("本来のコスト付きfield_has発揮条件を後段targetへ誤帰属しない", () =>
  none(printedFieldConditionEffect(9), printedFieldConditionText)
);
check(
  "field_hasの本来コスト境界を壊すと対象誤帰属を抑止せずreviewを残す",
  () => {
    const found = detect(printedFieldConditionEffect(8), [
      printedFieldConditionText,
    ]);
    assert.ok(issue(found, "target_cost_bound_mismatch", "review"));
    assert.ok(issue(found, "target_cost_basis_mismatch", "review"));
  }
);
check("field_hasの主体が違うと対象誤帰属を抑止せずreviewを残す", () => {
  const found = detect(printedFieldConditionEffect(9, { player: "opponent" }), [
    printedFieldConditionText,
  ]);
  assert.ok(issue(found, "target_cost_bound_mismatch", "review"));
  assert.ok(issue(found, "target_cost_basis_mismatch", "review"));
});
check("field_hasのカード名が違うと対象誤帰属を抑止せずreviewを残す", () => {
  const found = detect(
    printedFieldConditionEffect(9, { cardNames: [{ contains: "孫悟空" }] }),
    [printedFieldConditionText]
  );
  assert.ok(issue(found, "target_cost_bound_mismatch", "review"));
  assert.ok(issue(found, "target_cost_basis_mismatch", "review"));
});
const printedExactFieldConditionText =
  "本来のコスト9以上の自分のカード名：「ベジータ」がいるとき、相手のスピリットすべてをデッキの下に戻せる。";
check(
  "カード名：表記のfield_has発揮条件はexactで後段targetへ誤帰属しない",
  () =>
    none(
      printedFieldConditionEffect(9, { cardNames: [{ exact: "ベジータ" }] }),
      printedExactFieldConditionText
    )
);
check(
  "カード名：表記をcontainsにすると対象誤帰属を抑止せずreviewを残す",
  () => {
    const found = detect(printedFieldConditionEffect(9), [
      printedExactFieldConditionText,
    ]);
    assert.ok(issue(found, "target_cost_bound_mismatch", "review"));
    assert.ok(issue(found, "target_cost_basis_mismatch", "review"));
  }
);
const printedFieldConditionCategoryText =
  "本来のコスト9以上の自分のスピリットがいるとき、相手のスピリットすべてをデッキの下に戻せる。";
check("単純な種別のfield_has発揮条件を後段targetへ誤帰属しない", () =>
  none(
    printedFieldConditionEffect(9, {
      cardNames: undefined,
      category: ["spirit"],
    }),
    printedFieldConditionCategoryText
  )
);
check("名前のないfield_hasへ余計なカード名を加えるとreviewを残す", () => {
  const found = detect(
    printedFieldConditionEffect(9, { category: ["spirit"] }),
    [printedFieldConditionCategoryText]
  );
  assert.ok(issue(found, "target_cost_bound_mismatch", "review"));
  assert.ok(issue(found, "target_cost_basis_mismatch", "review"));
});
check("field_hasの対象種別が違うとreviewを残す", () => {
  const found = detect(
    printedFieldConditionEffect(9, {
      cardNames: undefined,
      category: ["ultimate"],
    }),
    [printedFieldConditionCategoryText]
  );
  assert.ok(issue(found, "target_cost_bound_mismatch", "review"));
  assert.ok(issue(found, "target_cost_basis_mismatch", "review"));
});
check("単純なfield_hasへ未解析の系統制約を加えるとreviewを残す", () => {
  const found = detect(
    printedFieldConditionEffect(9, {
      cardNames: undefined,
      category: ["spirit"],
      tribes: ["サイヤ人"],
    }),
    [printedFieldConditionCategoryText]
  );
  assert.ok(issue(found, "target_cost_bound_mismatch", "review"));
  assert.ok(issue(found, "target_cost_basis_mismatch", "review"));
});
const sourceScopedImmunity = (maxCost) =>
  effect(
    [
      {
        action: {
          kind: "effect_immunity",
          target: {
            kind: "filter",
            player: "self",
            filter: { category: ["nexus"], tribes: ["地球"] },
            count: "all",
          },
          duration: { scope: "permanent" },
          sourceScope: { maxCost },
        },
      },
    ],
    { timing: { kind: "continuous" } }
  );
const sourceScopedImmunityText =
  "Lv1-Lv2【弾幕:コスト9以下】系統:「地球」を持つ自分のネクサスは、相手のコスト9以下の効果を受けない。";
check("効果発生源のコスト制約をeffect_immunity.sourceScopeで認識", () =>
  none(sourceScopedImmunity(9), sourceScopedImmunityText)
);
check("効果発生源のコスト境界をsourceScopeから落とさない", () => {
  const found = detect(sourceScopedImmunity(8), [sourceScopedImmunityText]);
  assert.ok(issue(found, "source_effect_cost_bound_mismatch"));
  assert.equal(
    found.some((entry) => entry.kind === "target_cost_scope_review"),
    false
  );
});
const sourceAndTargetScopedImmunity = (targetMaxCost) =>
  effect(
    [
      {
        action: {
          kind: "effect_immunity",
          target: {
            kind: "filter",
            player: "self",
            filter: { category: ["nexus"], maxCost: targetMaxCost },
            count: "all",
          },
          duration: { scope: "permanent" },
          sourceScope: { maxCost: 9 },
        },
      },
    ],
    { timing: { kind: "continuous" } }
  );
const sourceAndTargetScopedImmunityText =
  "コスト9以下の自分のネクサスは、相手のコスト9以下の効果を受けない。";
check("同値の発生源と対象コストを別の役割として保持", () =>
  none(sourceAndTargetScopedImmunity(9), sourceAndTargetScopedImmunityText)
);
check("同値の発生源コストがあっても対象コストの欠落を検知", () =>
  assert.ok(
    issue(
      detect(sourceAndTargetScopedImmunity(8), [
        sourceAndTargetScopedImmunityText,
      ]),
      "target_cost_bound_mismatch"
    )
  )
);
check("カウントによる動的上限は静的な違反にしない", () => {
  const found = detect(targetEffect({ maxCostSource: "self_count" }), [
    "コスト5以下の相手のスピリット1体を破壊する。自分のカウントにつき上限を変更する。",
  ]);
  assert.ok(issue(found, "target_cost_bound_mismatch", "review"));
});
check("複数対象のコスト対応はreview", () =>
  assert.ok(
    issue(
      detect(
        effect([
          targetEffect({ maxCost: 5 }).steps[0],
          targetEffect({ maxCost: 7 }).steps[0],
        ]),
        ["コスト5以下のスピリットとコスト7以下のネクサスを破壊する。"]
      ),
      "target_cost_scope_review",
      "review"
    )
  )
);
for (const [min, max] of [
  ["minCost", "maxCost"],
  ["minBp", "maxBp"],
  ["minCores", "maxCores"],
  ["minCount", "maxCount"],
  ["min", "max"],
]) {
  check(`静的な上下限矛盾 ${min}/${max}`, () => {
    const value = targetEffect({ [min]: 6, [max]: 5 });
    const found = issue(detect(value, []), "constraint_empty_range");
    assert.equal(found.path, "$.steps[0].action.target.filter");
    assert.match(found.evidence, /6/);
    assert.match(found.evidence, /5/);
  });
}
check("同じ下限と上限は可能", () =>
  none(targetEffect({ minCost: 5, maxCost: 5 }), "対象を破壊する。")
);
check("動的境界を数値に強制変換しない", () =>
  none(
    targetEffect({ minCost: 5, maxCost: { source: { kind: "count_value" } } }),
    "対象を破壊する。"
  )
);
check("否定条件の空区間は断定せずreview", () =>
  assert.ok(
    issue(
      detect(
        effect(undefined, {
          condition: [{ kind: "count_value", min: 6, max: 5, not: true }],
        }),
        []
      ),
      "constraint_empty_range",
      "review"
    )
  )
);
check("ORfilterで無視される直接上下限は空区間違反と断定しない", () => {
  const found = detect(
    targetEffect({
      minCost: 6,
      maxCost: 5,
      filterOr: [{ category: ["spirit"] }],
    }),
    []
  );
  assert.ok(issue(found, "constraint_empty_range", "review"));
  assert.ok(found.every((entry) => entry.severity !== "violation"));
});
check("内側Effectの静的矛盾も固有pathで検査", () => {
  const value = effect([
    {
      action: {
        kind: "grant_effect",
        grantedEffect: targetEffect({ minCost: 9, maxCost: 2 }),
      },
    },
  ]);
  assert.equal(
    issue(detect(value, []), "constraint_empty_range").path,
    "$.steps[0].action.grantedEffect.steps[0].action.target.filter"
  );
});
const quantifiedEffectRepeatText =
  "自分のデッキを上から4枚オープンできる。その中のカード1枚を召喚できる。残ったカードはデッキの下に戻す。この効果を自分のカウント1につき1回発揮できる。";
const quantifiedAdditionalEffectRepeatText =
  "相手のスピリット1体をBP-10000する。この効果を自分のカウント1につき追加で発揮し、BPが0なら破壊する。";
const quantifiedDecreasedCountRepeatText =
  "減らしたカウント1につき、この効果を追加で1回発揮する。";
const quantifiedBraveRepeatText =
  "この効果を、このスピリットのブレイヴ1つにつき追加でもう1度発揮し、BPが0なら破壊する。";
const quantifiedUnknownUnitRepeatText =
  "この効果を自分の手札のカード１枚につき、追加で１回発揮する。";
const quantifiedMaximumAdditionalText =
  "この効果を自分のカウントの数まで追加で発揮できる。";
check("数まで追加の量化句を上限付き任意反復として抽出", () => {
  assert.deepEqual(
    extractQuantifiedEffectRepeats(quantifiedMaximumAdditionalText),
    [
      {
        text: "この効果を自分のカウントの数まで追加で発揮できる",
        index: 0,
        measure: "自分のカウント",
        perMeasure: 1,
        count: 1,
        additional: true,
        optional: true,
      },
    ]
  );
});
check("数まで追加は基本1回とcount最大N回のoptional carrierを認識", () =>
  none(
    effect([
      {
        action: { kind: "draw", count: 1 },
        repeat: {
          optional: true,
          additional: { source: { kind: "count_value", player: "self" } },
        },
      },
    ]),
    [quantifiedMaximumAdditionalText]
  )
);
check("後続へ続く数まで追加の本文も正確な句として抽出", () => {
  assert.equal(
    extractQuantifiedEffectRepeats(
      "この効果を自分のカウントの数まで追加で発揮し、BPが0なら破壊する。"
    )[0]?.text,
    "この効果を自分のカウントの数まで追加で発揮し"
  );
});
check("数まで追加の明示的な恒等係数と空条件は正例", () =>
  none(
    effect([
      {
        action: { kind: "draw", count: 1 },
        repeat: {
          optional: true,
          condition: [],
          allowDuplicateTargets: true,
          additional: {
            source: { kind: "count_value", player: "self" },
            preOffset: 0,
            multiplier: 1,
            divisor: 1,
            groupMultiplier: 1,
            offset: 0,
            minValue: 0,
          },
        },
      },
    ]),
    [quantifiedMaximumAdditionalText]
  )
);
for (const [label, additionalMutation, repeatMutation] of [
  ["乗数2", { multiplier: 2 }],
  ["除数2", { divisor: 2 }],
  ["除算前加算1", { preOffset: 1 }],
  ["グループ乗数2", { groupMultiplier: 2 }],
  ["上限0", { cap: 0 }],
  ["下限1", { minValue: 1 }],
  ["減算", { subtract: { kind: "count_value", player: "self" } }],
  ["後段加算1", { offset: 1 }],
  ["未知の回数modifier", { extraMultiplier: 2 }],
  [
    "未印字のsource制約",
    { source: { kind: "count_value", player: "self", min: 1 } },
  ],
  ["実行回数0の上書き", {}, { executionAdditional: 0 }],
  [
    "実行回数式の上書き",
    {},
    {
      executionAdditional: {
        source: { kind: "count_value", player: "opponent" },
      },
    },
  ],
  [
    "追加条件",
    {},
    { condition: [{ kind: "count_value", player: "self", min: 1 }] },
  ],
  ["不正な追加条件", {}, { condition: null }],
  ["重複対象の禁止", {}, { allowDuplicateTargets: false }],
  ["未知のrepeat制約", {}, { limit: 1 }],
]) {
  check(`数まで追加の未印字変換 ${label} を正例として受理しない`, () => {
    const found = issue(
      detect(
        effect([
          {
            action: { kind: "draw", count: 1 },
            repeat: {
              optional: true,
              additional: {
                source: { kind: "count_value", player: "self" },
                ...additionalMutation,
              },
              ...repeatMutation,
            },
          },
        ]),
        [quantifiedMaximumAdditionalText]
      ),
      "quantified_effect_repeat_missing",
      "violation"
    );
    assert.equal(found.severity, "violation");
  });
}
check("数まで追加の係数付き本文は単純carrierで確定せずreview", () => {
  assert.ok(
    issue(
      detect(
        effect([
          {
            action: { kind: "draw", count: 1 },
            repeat: {
              optional: true,
              additional: { source: { kind: "count_value", player: "self" } },
            },
          },
        ]),
        ["この効果を自分のカウントの数まで追加で2回発揮できる。"]
      ),
      "quantified_effect_repeat_review",
      "review"
    )
  );
});
for (const [label, repeat] of [
  ["反復欠落", undefined],
  [
    "任意性欠落",
    { additional: { source: { kind: "count_value", player: "self" } } },
  ],
  [
    "基本分欠落",
    {
      optional: true,
      additional: {
        source: { kind: "count_value", player: "self" },
        offset: -1,
      },
    },
  ],
  [
    "相手count",
    {
      optional: true,
      additional: { source: { kind: "count_value", player: "opponent" } },
    },
  ],
]) {
  check(`数まで追加の壊れたcarrier ${label} は検知`, () => {
    const value = effect([
      { action: { kind: "draw", count: 1 }, ...(repeat ? { repeat } : {}) },
    ]);
    assert.ok(
      issue(
        detect(value, [quantifiedMaximumAdditionalText]),
        "quantified_effect_repeat_missing",
        "violation"
      )
    );
  });
}
check("数まで追加の未知の量化対象もreviewへ残す", () => {
  const found = issue(
    detect(effect([{ action: { kind: "draw", count: 1 } }]), [
      "この効果を自分の手札のカードの数まで追加で発揮できる。",
    ]),
    "quantified_effect_repeat_review",
    "review"
  );
  assert.match(found.evidence, /手札のカード/);
});
check("量化構文は枚単位・読点・全角数字を正規化して抽出", () => {
  assert.deepEqual(
    extractQuantifiedEffectRepeats(quantifiedUnknownUnitRepeatText),
    [
      {
        text: "この効果を自分の手札のカード1枚につき、追加で1回発揮する",
        index: 0,
        measure: "自分の手札のカード",
        perMeasure: 1,
        count: 1,
        additional: true,
      },
    ]
  );
});
check("未知の量化対象は not_applicable でなく review に残す", () => {
  const found = issue(
    detect(
      effect([
        {
          action: { kind: "draw", count: 1 },
          repeat: {
            additional: { source: { kind: "count_value", player: "self" } },
          },
        },
      ]),
      [quantifiedUnknownUnitRepeatText]
    ),
    "quantified_effect_repeat_review",
    "review"
  );
  assert.match(found.evidence, /カード1枚/);
});
check("量化された効果反復を count N 回の repeat carrier として認識", () =>
  none(
    effect(
      [
        {
          action: { kind: "deck_reveal", revealCount: 4 },
          repeat: {
            additional: {
              source: { kind: "count_value", player: "self" },
              offset: -1,
            },
          },
        },
      ],
      { condition: [{ kind: "count_value", player: "self", min: 1 }] }
    ),
    [quantifiedEffectRepeatText]
  )
);
check("量化された効果反復を count>=1 条件だけに縮約すると検知", () => {
  const found = issue(
    detect(
      effect([{ action: { kind: "deck_reveal", revealCount: 4 } }], {
        condition: [{ kind: "count_value", player: "self", min: 1 }],
      }),
      [quantifiedEffectRepeatText]
    ),
    "quantified_effect_repeat_missing"
  );
  assert.equal(found.severity, "violation");
  assert.match(found.evidence, /offset:-1/);
});
check("複数手順の先頭だけを反復して後続を省く形は review を残す", () => {
  const found = issue(
    detect(
      effect(
        [
          {
            action: { kind: "deck_reveal", revealCount: 4 },
            repeat: {
              additional: {
                source: { kind: "count_value", player: "self" },
                offset: -1,
              },
            },
          },
          { action: { kind: "draw", count: 1 } },
        ],
        { condition: [{ kind: "count_value", player: "self", min: 1 }] }
      ),
      [quantifiedEffectRepeatText]
    ),
    "quantified_effect_repeat_missing",
    "review"
  );
  assert.match(found.evidence, /\$\.steps\[1\]/);
});
check("量化された効果反復を usageLimit だけに縮約すると検知", () => {
  const found = issue(
    detect(
      effect([{ action: { kind: "deck_reveal", revealCount: 4 } }], {
        condition: [{ kind: "count_value", player: "self", min: 1 }],
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
      }),
      [quantifiedEffectRepeatText]
    ),
    "quantified_effect_repeat_missing"
  );
  assert.equal(found.severity, "violation");
  assert.match(found.evidence, /usageLimit/);
});
check(
  "暗黙の1回を伴う『追加で発揮し』を count N 追加の repeat carrier として認識",
  () =>
    none(
      effect([
        {
          id: "bp0",
          action: { kind: "bp_modify", amount: -10000 },
          repeat: {
            additional: { source: { kind: "count_value", player: "self" } },
          },
        },
      ]),
      [quantifiedAdditionalEffectRepeatText]
    )
);
check(
  "暗黙の1回を伴う『追加で発揮し』を condition だけに縮約すると検知",
  () => {
    const found = issue(
      detect(
        effect([{ action: { kind: "bp_modify", amount: -10000 } }], {
          condition: [{ kind: "count_value", player: "self", min: 1 }],
        }),
        [quantifiedAdditionalEffectRepeatText]
      ),
      "quantified_effect_repeat_missing"
    );
    assert.equal(found.severity, "violation");
  }
);
check(
  "前置された『減らしたカウントにつき』は executionAdditional carrier を認識",
  () =>
    none(
      effect([
        {
          id: "bp0",
          action: { kind: "bp_modify", amount: -10000 },
          repeat: {
            additional: {
              source: { kind: "count_value", player: "self" },
              offset: -1,
            },
            executionAdditional: {
              source: { kind: "selected_targets", stepId: "bp0" },
              offset: -1,
            },
            optional: true,
          },
        },
      ]),
      [quantifiedDecreasedCountRepeatText]
    )
);
check(
  "支払い→反復→BP0破壊の完結した減少カウント carrier を複数手順でも認識",
  () =>
    none(
      effect([
        {
          action: {
            kind: "count_decrease",
            player: "self",
            amount: { source: { kind: "selected_targets", stepId: "bp0" } },
          },
        },
        {
          id: "bp0",
          action: { kind: "bp_modify", amount: -10000 },
          connector: "conditional_cost",
          repeat: {
            additional: {
              source: { kind: "count_value", player: "self" },
              offset: -1,
            },
            executionAdditional: {
              source: { kind: "selected_targets", stepId: "bp0" },
              offset: -1,
            },
            optional: true,
          },
        },
        {
          action: {
            kind: "destroy",
            target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
          },
          connector: "sequential",
        },
      ]),
      [quantifiedDecreasedCountRepeatText]
    )
);
check("減少カウント反復で別 step の支払いは正例にしない", () => {
  const found = issue(
    detect(
      effect([
        {
          action: {
            kind: "count_decrease",
            player: "self",
            amount: { source: { kind: "selected_targets", stepId: "wrong" } },
          },
        },
        {
          id: "bp0",
          action: { kind: "bp_modify", amount: -10000 },
          connector: "conditional_cost",
          repeat: {
            additional: {
              source: { kind: "count_value", player: "self" },
              offset: -1,
            },
            executionAdditional: {
              source: { kind: "selected_targets", stepId: "bp0" },
              offset: -1,
            },
          },
        },
        {
          action: {
            kind: "destroy",
            target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
          },
          connector: "sequential",
        },
      ]),
      [quantifiedDecreasedCountRepeatText]
    ),
    "quantified_effect_repeat_missing",
    "review"
  );
  assert.equal(found.severity, "review");
});
for (const [label, repeatedStep] of [
  [
    "conditional_cost を sequential にした",
    {
      id: "bp0",
      action: { kind: "bp_modify", amount: -10000 },
      connector: "sequential",
      repeat: {
        additional: {
          source: { kind: "count_value", player: "self" },
          offset: -1,
        },
        executionAdditional: {
          source: { kind: "selected_targets", stepId: "bp0" },
          offset: -1,
        },
        optional: true,
      },
    },
  ],
  [
    "任意反復 optional:true を外した",
    {
      id: "bp0",
      action: { kind: "bp_modify", amount: -10000 },
      connector: "conditional_cost",
      repeat: {
        additional: {
          source: { kind: "count_value", player: "self" },
          offset: -1,
        },
        executionAdditional: {
          source: { kind: "selected_targets", stepId: "bp0" },
          offset: -1,
        },
      },
    },
  ],
  [
    "BP修正本体を draw に替えた",
    {
      id: "bp0",
      action: { kind: "draw", count: 1 },
      connector: "conditional_cost",
      repeat: {
        additional: {
          source: { kind: "count_value", player: "self" },
          offset: -1,
        },
        executionAdditional: {
          source: { kind: "selected_targets", stepId: "bp0" },
          offset: -1,
        },
        optional: true,
      },
    },
  ],
]) {
  check(`減少カウント反復で ${label}形は正例にしない`, () => {
    const found = issue(
      detect(
        effect([
          {
            action: {
              kind: "count_decrease",
              player: "self",
              amount: {
                source: { kind: "selected_targets", stepId: "bp0" },
              },
            },
          },
          repeatedStep,
          {
            action: {
              kind: "destroy",
              target: {
                kind: "ref",
                stepId: "bp0",
                result: "bp_became_zero",
              },
            },
            connector: "sequential",
          },
        ]),
        [quantifiedDecreasedCountRepeatText]
      ),
      "quantified_effect_repeat_missing",
      "review"
    );
    assert.equal(found.severity, "review");
  });
}
check(
  "前置された『減らしたカウントにつき』を usageLimit に縮約すると検知",
  () => {
    const found = issue(
      detect(
        effect([{ action: { kind: "bp_modify", amount: -10000 } }], {
          usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        }),
        [quantifiedDecreasedCountRepeatText]
      ),
      "quantified_effect_repeat_missing"
    );
    assert.equal(found.severity, "violation");
  }
);
check(
  "ブレイヴ数を後置した『追加でもう1度』は braves_on_source carrier を認識",
  () =>
    none(
      effect([
        {
          action: { kind: "bp_modify", amount: -3000 },
          repeat: { additional: { source: { kind: "braves_on_source" } } },
        },
      ]),
      [quantifiedBraveRepeatText]
    )
);
check("ブレイヴ数を後置した『追加でもう1度』を条件だけに縮約すると検知", () => {
  const found = issue(
    detect(
      effect([{ action: { kind: "bp_modify", amount: -3000 } }], {
        condition: [{ kind: "combined" }],
      }),
      [quantifiedBraveRepeatText]
    ),
    "quantified_effect_repeat_missing"
  );
  assert.equal(found.severity, "violation");
});
check("係数付き量化反復は壊れた repeat があっても静的 review を残す", () => {
  const found = issue(
    detect(
      effect([
        {
          action: { kind: "deck_reveal", revealCount: 4 },
          repeat: { additional: 1 },
        },
      ]),
      ["この効果を自分のカウント2につき1回発揮できる。"]
    ),
    "quantified_effect_repeat_review",
    "review"
  );
  assert.equal(found.severity, "review");
});
check("非反復の『1個ずつ』を量化された効果反復として検出しない", () =>
  none(effect([{ action: { kind: "core_distribute", count: 1 } }]), [
    "自分のスピリット2体に、ボイドからコア1個ずつを置く。",
  ])
);
check("未参照文の制約を押し付けない", () =>
  none({ ...withLimit(turn), textRef: [] }, dualText)
);
check("stubは別監査に委ねる", () =>
  none(
    { ...targetEffect({ minCost: 9, maxCost: 2 }), stub: true },
    "コスト5以下を破壊する。"
  )
);
check("減らしたカウントの offset を壊すと量化反復として通さない", () => {
  const found = issue(
    detect(
      effect([
        {
          id: "bp0",
          action: { kind: "bp_modify", amount: -10000 },
          repeat: {
            additional: {
              source: { kind: "count_value", player: "self" },
              offset: 99,
            },
            executionAdditional: {
              source: { kind: "selected_targets", stepId: "bp0" },
              offset: -1,
            },
          },
        },
      ]),
      [quantifiedDecreasedCountRepeatText]
    ),
    "quantified_effect_repeat_missing"
  );
  assert.match(found.evidence, /offset/);
});
check("減らしたカウントの対象 stepId を壊すと量化反復として通さない", () => {
  const found = issue(
    detect(
      effect([
        {
          id: "bp0",
          action: { kind: "bp_modify", amount: -10000 },
          repeat: {
            additional: {
              source: { kind: "count_value", player: "self" },
              offset: -1,
            },
            executionAdditional: {
              source: { kind: "selected_targets", stepId: "wrong" },
              offset: -1,
            },
          },
        },
      ]),
      [quantifiedDecreasedCountRepeatText]
    ),
    "quantified_effect_repeat_missing"
  );
  assert.match(found.evidence, /wrong/);
});
check("入力を変更せず安定したinterfaceで返す", () => {
  const value = withLimit(turn);
  const before = JSON.stringify(value);
  const first = detect(value, [dualText]);
  assert.equal(JSON.stringify(value), before);
  assert.deepEqual(detect(value, [dualText]), first);
  for (const entry of first) {
    assert.deepEqual(Object.keys(entry).sort(), [
      "evidence",
      "kind",
      "message",
      "path",
      "severity",
    ]);
    assert.match(entry.path, /^\$/);
    assert.ok(["violation", "review"].includes(entry.severity));
    assert.ok(entry.message.length && entry.evidence.length);
  }
});

console.log(
  `[fidelity-constraint-detector] ${passed} passed, ${failed} failed`
);
if (failed) process.exitCode = 1;
