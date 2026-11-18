#!/usr/bin/env node
/**
 * P3-96 任意文言検出器の単体テスト。pure 関数のため card-data ビルドや engine 状態に
 * 依存しない。`node scripts/test-optional-wording-detector.mjs` で実行。
 *
 * 期待: 「できる」/「〜ける」/「〜せる」/「〜られる」を含む文に対して true、否定形
 * (できない/られない/えない) と能力付与 (アタックできる/ブロックできる) を含む文を
 * false positive にしないこと、および effect/step の任意表現を再帰検出すること。
 */
import {
  hasOptionalWording,
  hasOptionalExpression,
  stepHasOptionalExpression,
} from "./optional-wording-detector.mjs";

let pass = 0;
let fail = 0;
function check(label, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${label}`);
  }
}

// 1. hasOptionalWording: 可能形検出
check(
  "can detect 「できる」",
  hasOptionalWording("自分はデッキの上から2枚ドローできる。") === true
);
check(
  "can detect 「裏返せる」",
  hasOptionalWording("このネクサスを裏返せる。") === true
);
check(
  "can detect 「置ける」",
  hasOptionalWording("コアを好きなだけ置ける。") === true
);
check(
  "can detect 「加えられる」",
  hasOptionalWording("手札に加えられる。") === true
);
check(
  "can detect 「入れ替えられる」",
  hasOptionalWording("手札1枚と入れ替えられる。") === true
);

// 2. hasOptionalWording: 否定形は false positive にしない
check(
  "ignores 「できない」",
  hasOptionalWording("相手はアタックステップを終了できない。") === false
);
check(
  "ignores 「使えない」",
  hasOptionalWording("転醒は同時に使えない。") === false
);
check(
  "ignores 「破壊されない」",
  hasOptionalWording("このスピリットは破壊されない。") === false
);

// 3. hasOptionalWording: 能力付与は false positive にしない
check(
  "ignores 「アタックできる」(ability grant, state-permission)",
  hasOptionalWording("このスピリットはアタックできる。") === false
);
check(
  "ignores 「ブロックできる」(ability grant)",
  hasOptionalWording("相手のスピリット2体までをブロックできる。") === false
);
// verifier round 6: 「指定してアタックできる」 は player-choice なので true (BSKB01-C01 型)
check(
  "detects 「指定してアタックできる」 as player-choice (not ability grant, BSKB01-C01 型)",
  hasOptionalWording(
    "相手のスピリット/アルティメット1体に指定してアタックできる。"
  ) === true
);
// 「発揮できる」は player choice 任意 (バースト発火の任意) として true
// (verifier round 3 Lens 6 BSTS01-X03 refute, 2026-06-23)
check(
  "detects 「発揮できる」 as player-choice optional (not ability grant)",
  hasOptionalWording("バースト効果を発揮できる。") === true
);

// 4. hasOptionalWording: 否定セグメントの隣に肯定セグメントがあると true
check(
  "detects 「できる」 when negation is in a different segment",
  hasOptionalWording(
    "相手はアタックできない。自分はデッキの上から2枚ドローできる。"
  ) === true
);

// 4b. hasOptionalWording: 同一セグメントに否定と肯定が混在すると肯定側を拾う
//     (verifier round 4 Lens 6 refute BSTH01-M13, 2026-06-23)
check(
  "detects 「発揮できる」 when 「発揮できない」 is in the same segment (BSTH01-M13 型)",
  hasOptionalWording(
    "相手のバースト効果を発揮できないが、無視して発揮できる。"
  ) === true
);
check(
  "detects 「戻せる」 when 「戻せない」 is in the same segment",
  hasOptionalWording(
    "自分のスピリットは戻せないが、相手のスピリットは戻せる。"
  ) === true
);

// 4c. hasOptionalWording: 否定 → 肯定 順 (肯定が後) でも肯定を拾う
//     (verifier round 7 Lens 6 refute: NEGATION_MASK が前方文字を貪欲に消す silent FN)
check(
  "detects 「戻せる」 when 「破壊できない」 is later in the same segment (round 7 fix)",
  hasOptionalWording("自分のスピリットは戻せるが、破壊できない。") === true
);

// 5. hasOptionalWording: 空文字列・undefined は false
check("empty string → false", hasOptionalWording("") === false);
check("null → false", hasOptionalWording(null) === false);
check("undefined → false", hasOptionalWording(undefined) === false);

// 6. hasOptionalExpression: effect.executionMode === "optional"
check(
  "effect.executionMode='optional' → true",
  hasOptionalExpression({ executionMode: "optional", steps: [] }) === true
);
check(
  "effect.executionMode missing → false",
  hasOptionalExpression({ steps: [{ action: { kind: "destroy" } }] }) === false
);

// 7. hasOptionalExpression: step.executionMode === "optional"
check(
  "step.executionMode='optional' → true",
  hasOptionalExpression({
    steps: [{ executionMode: "optional", action: { kind: "destroy" } }],
  }) === true
);

// 8. hasOptionalExpression: target.count.min === 0
check(
  "target.count.min:0 → true",
  hasOptionalExpression({
    steps: [
      {
        action: {
          kind: "destroy",
          target: { kind: "filter", count: { min: 0, max: 3 } },
        },
      },
    ],
  }) === true
);

// 9. hasOptionalExpression: 実 DSL shape (step.choice / step.connector === "conditional_cost")
//    (verifier round 1 Lens 5 修正, 2026-06-23)
check(
  "step.choice (array) → true",
  hasOptionalExpression({
    steps: [
      { choice: [{ action: { kind: "destroy" } }], action: { kind: "noop" } },
    ],
  }) === true
);
check(
  "step.connector='conditional_cost' → true",
  hasOptionalExpression({
    steps: [
      {
        connector: "conditional_cost",
        action: { kind: "destroy" },
      },
    ],
  }) === true
);
check(
  "step.connector='sequential' → false (任意ではない)",
  hasOptionalExpression({
    steps: [
      { action: { kind: "draw", count: 1 } },
      { connector: "sequential", action: { kind: "discard", count: 1 } },
    ],
  }) === false
);
check(
  "step.connector='conditional_result' → false (前 step の成功条件、player 任意ではない)",
  hasOptionalExpression({
    steps: [{ connector: "conditional_result", action: { kind: "draw" } }],
  }) === false
);

// 10. hasOptionalExpression: stepCondition は任意性として扱わない
//    (verifier round 1 Lens 5 refute, 2026-06-23: stepCondition は前 step 結果による
//    強制ゲートで player 選択ではない)
check(
  "step.stepCondition → false (任意ではない)",
  hasOptionalExpression({
    steps: [
      {
        stepCondition: { kind: "ref_succeeded" },
        action: { kind: "draw" },
      },
    ],
  }) === false
);

// 10b. legacy action.kind (revealed_choice / optional_branch) は引き続き true
check(
  "action.kind='revealed_choice' → true (legacy)",
  hasOptionalExpression({
    steps: [{ action: { kind: "revealed_choice" } }],
  }) === true
);

// 10c. action.optional === true (BSTH01-X04 register_redirect_effect_target 型)
//      (verifier round 7 Lens 5 refute, 2026-06-23)
check(
  "action.optional===true → true (BSTH01-X04 register_redirect_effect_target 型)",
  hasOptionalExpression({
    steps: [
      {
        action: {
          kind: "register_redirect_effect_target",
          optional: true,
        },
      },
    ],
  }) === true
);

// 10d. step.repeat.optional === true (動的/固定 反復の任意化)
check(
  "step.repeat.optional===true → true",
  hasOptionalExpression({
    steps: [
      {
        action: { kind: "bp_modify" },
        repeat: { optional: true, additional: 3 },
      },
    ],
  }) === true
);

// 11. hasOptionalExpression: amount.min:0 (core_move 0..N)
check(
  "amount.min:0 → true",
  hasOptionalExpression({
    steps: [{ action: { kind: "core_move", amount: { min: 0, max: 2 } } }],
  }) === true
);

// 12. hasOptionalExpression: ネストされた action.steps を再帰
check(
  "nested action.steps with optional → true",
  hasOptionalExpression({
    steps: [
      {
        action: {
          kind: "wrapper",
          steps: [
            {
              action: {
                kind: "destroy",
                target: { count: { min: 0, max: 1 } },
              },
            },
          ],
        },
      },
    ],
  }) === true
);

// 13. stepHasOptionalExpression: 純関数として直接テスト
check(
  "stepHasOptionalExpression(null) → false",
  stepHasOptionalExpression(null) === false
);
check(
  "stepHasOptionalExpression({}) → false",
  stepHasOptionalExpression({}) === false
);

// 14. Lens 6 補強: positive list 漏れの保険 (POSSIBLE_SUFFIX_RE)。
//    新しい可能形カードでも文末 ~られる/~せられる/~えられる は拾えること。
check(
  "POSSIBLE_SUFFIX_RE catches 「数えられる」 (positive list 漏れの保険)",
  hasOptionalWording("これは1体として数えられる。") === true
);
check(
  "POSSIBLE_SUFFIX_RE catches 「比べられる」",
  hasOptionalWording("このスピリットと比べられる。") === true
);

// 15. Lens 6: 強制動詞は false positive にしない (FORCED_VERB_NEAR で剥がす)
check(
  "FORCED_VERB_NEAR ignores 「疲労させる」",
  hasOptionalWording("相手のスピリットを疲労させる。") === false
);
check(
  "FORCED_VERB_NEAR ignores 「比べる」 (mandatory)",
  hasOptionalWording("お互いのBPを比べる。") === false
);
check(
  "FORCED_VERB_NEAR ignores 「加える」 (mandatory transitive)",
  hasOptionalWording("手札に加える。") === false
);
check(
  "FORCED_VERB_NEAR ignores 「重ねる」 (mandatory transitive)",
  hasOptionalWording("対象に重ねる。") === false
);

// 16. Lens 6 BSAZ01-C02 型: 同一セグメント混在 (能力付与 + 任意 可能形)
//     ABILITY_GRANT は該当句だけマスクし、残りの 「BP-3000でき」 を拾うこと
//     (verifier round 2 refute, 2026-06-23)
check(
  "ABILITY_GRANT only masks the phrase, not the whole segment (BSAZ01-C02 型)",
  hasOptionalWording(
    "相手のスピリット1体をBP-3000でき、BP0になったスピリットを破壊する。このスピリットの合体中、追加で1回この効果を発揮できる。"
  ) === true
);

// 17. Lens 6 BSTS01-C03 型: 「見れる」 (positive list 漏れ)
//     (verifier round 2 refute, 2026-06-23)
check(
  "positive list includes 「見れる」 (BSTS01 corpus)",
  hasOptionalWording("自分のデッキの上から3枚を見れる。") === true
);

// 17b. Lens 6 verifier round 5: ABILITY_GRANT は state-permission のみ
//      「召喚できる」「使用できる」「配置できる」 は player-choice 任意として true
check(
  "detects 「召喚できる」 as player-choice optional (not ability grant)",
  hasOptionalWording("手札のこのカードを軽減シンボル満たして召喚できる。") ===
    true
);
check(
  "detects 「使用できる」 as player-choice optional",
  hasOptionalWording("コストを支払わずに使用できる。") === true
);
check(
  "detects 「配置できる」 as player-choice optional",
  hasOptionalWording("コストを支払わずに配置できる。") === true
);

// 17c. Lens 6 verifier round 5: POSSIBLE_SUFFIX_RE 〜ける/〜せる suffix
//      「下における」 (置く + え-段 + る) を拾うこと
check(
  "POSSIBLE_SUFFIX_RE catches 「おける」 (置く 可能形 hiragana)",
  hasOptionalWording("トラッシュのコアを裏向きで下における。") === true
);

// 17d. FORCED_VERB_MASK 拡張で「受ける/続ける」等は依然 false
check(
  "FORCED_VERB_MASK ignores 「受ける」",
  hasOptionalWording("相手の効果を受ける。") === false
);

// 17e. Lens 6 verifier round 6: 「アタックステップを終了できる」は player-choice 任意
check(
  "detects 「アタックステップを終了できる」 as player-choice (not ability grant)",
  hasOptionalWording("自分のアタックステップを終了できる。") === true
);

// 17f. Lens 6 verifier round 6: 「使える」「選べる」 等 〜える 可能形
check(
  "detects 「使える」 (positive list extension)",
  hasOptionalWording("このカードを使える。") === true
);
check(
  "detects 「選べる」",
  hasOptionalWording("自分の好きなスピリットを選べる。") === true
);

// 17g. Lens 6 verifier round 6: FORCED_VERB_MASK phrase 単位
//      強制動詞と可能形 suffix が同セグメント混在しても可能形を拾うこと
check(
  "FORCED_VERB_MASK only masks the phrase, leaves other possible-form in segment (BSAZ02-C03 型)",
  hasOptionalWording("コアを受けるが、自分のスピリット1体を選べる。") === true
);

// 18. count.min:1 + dynamic max は optional 表現に数えない
//     (verifier round 3 Lens 6 refute, 2026-06-23)
check(
  "target.count.min:1 + max:dynamic → false (1体強制 + 追加動的上限は fully optional ではない)",
  hasOptionalExpression({
    steps: [
      {
        action: {
          kind: "destroy",
          target: {
            count: { min: 1, max: { kind: "count_value", player: "self" } },
          },
        },
      },
    ],
  }) === false
);
check(
  "target.count.min:0 + max:dynamic → true (fully optional)",
  hasOptionalExpression({
    steps: [
      {
        action: {
          kind: "destroy",
          target: {
            count: { min: 0, max: { kind: "count_value", player: "self" } },
          },
        },
      },
    ],
  }) === true
);

// 19. grant_effect の付与先で発火する任意性 (BSFT01-C04 型)。
check(
  "grant_effect.grantedEffect.executionMode='optional' → true",
  hasOptionalExpression({
    steps: [
      {
        action: {
          kind: "grant_effect",
          grantedEffect: {
            executionMode: "optional",
            steps: [{ action: { kind: "stay_on_field" } }],
          },
        },
      },
    ],
  }) === true
);

// 20. P3-96 warning drain (28→0): effect.timing.kind==='activated' は起動宣言そのものが
//     opt-in なので executionMode 無しでも true (BSGE01-TR01(A) effects[1] 「裏返せる」型)。
check(
  "effect.timing.kind='activated' → true (起動効果は宣言自体が任意)",
  hasOptionalExpression({
    timing: { kind: "activated", mode: "flash" },
    steps: [{ action: { kind: "rebirth" } }],
  }) === true
);
check(
  "effect.timing.kind='continuous' (not activated) → false のまま",
  hasOptionalExpression({
    timing: { kind: "continuous" },
    steps: [{ action: { kind: "destroy" } }],
  }) === false
);

// 21. useCostPayment 可変枚数 (0..maxCount) は任意コスト (BSAZ03-M01 effects[2] 型)。
check(
  "useCostPayment.kind='discard_hand' → true (0..maxCount は常に任意)",
  hasOptionalExpression({
    steps: [
      {
        action: {
          kind: "cost_modify",
          useCostPayment: {
            kind: "discard_hand",
            sourceZone: "hand",
            maxCount: 5,
          },
        },
      },
    ],
  }) === true
);
check(
  "useCostPayment.kind='exclude' with no minCount → true (0..maxCount)",
  hasOptionalExpression({
    steps: [
      {
        action: {
          kind: "cost_modify",
          useCostPayment: { kind: "exclude", sourceZone: "trash", maxCount: 4 },
        },
      },
    ],
  }) === true
);
check(
  "useCostPayment.kind='exclude' with minCount:1 → false (必須除外数、任意ではない、BSFT01-X01 型)",
  hasOptionalExpression({
    steps: [
      {
        action: {
          kind: "cost_modify",
          useCostPayment: {
            kind: "exclude",
            sourceZone: "field",
            maxCount: 1,
            minCount: 1,
          },
        },
      },
    ],
  }) === false
);

// 22. action.kind==='life_gain_replacement' は replace/decline 選択が定義上常に任意
//     (BSTH02.7-X03 effects[2] 型)。
check(
  "action.kind='life_gain_replacement' → true",
  hasOptionalExpression({
    steps: [
      {
        action: {
          kind: "life_gain_replacement",
          player: "self",
          duration: { scope: "while_on_field" },
        },
      },
    ],
  }) === true
);

// 23. キーワード括弧内の一般 permission は、その effect 自身の任意文言として数えない。
check(
  "masks 【アルドノアドライブ】 keyword permission",
  hasOptionalWording(
    "【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで置ける。あるとき、以下の効果を得る）\nLv3『このアルティメットのアタック時』"
  ) === false
);
check(
  "masks 【クォーツ】 keyword permission",
  hasOptionalWording(
    "【クォーツ：精神3｜コストC2｜属性値：<幻>5（手札から対象にセットできる）】"
  ) === false
);
check(
  "masks key brave soul-state keyword permission",
  hasOptionalWording(
    "鍵ブレイヴは、合体しているスピリットが魂状態になるとき、合体している状態で魂状態にできる。Lv1"
  ) === false
);
check(
  "masks quartz host slot permission",
  hasOptionalWording(
    "魂状態のこのカードには、クォーツ名の異なるカードを右左に3枚ずつまでと中央に1枚までセットできる。（セット中のカードは魂状態として扱う。）"
  ) === false
);
check(
  "keeps real optional wording after keyword permission mask",
  hasOptionalWording(
    "【ミラージュ：コスト2（このカードは手札からセットできる）】\n自分はデッキの上から1枚ドローできる。"
  ) === true
);

// 24. 常時型 optional overlay / replacement は executionMode ではなく action が任意性を担う。
check(
  "grant_optional_deck_reveal_count_boost → true",
  hasOptionalExpression({
    steps: [{ action: { kind: "grant_optional_deck_reveal_count_boost" } }],
  }) === true
);
check(
  "grant_paid_prevention_immunity → true",
  hasOptionalExpression({
    steps: [{ action: { kind: "grant_paid_prevention_immunity" } }],
  }) === true
);
check(
  "effect_resistance with replacement → true",
  hasOptionalExpression({
    steps: [{ action: { kind: "effect_resistance", replacement: {} } }],
  }) === true
);
check(
  "effect.timing.kind='burst' → true",
  hasOptionalExpression({
    timing: { kind: "burst", trigger: { kind: "own_attack" } },
    steps: [{ action: { kind: "destroy" } }],
  }) === true
);
check(
  "offer_magic_pre_cost_trigger → true",
  hasOptionalExpression({
    steps: [{ action: { kind: "offer_magic_pre_cost_trigger" } }],
  }) === true
);
check(
  "allow_ignore_summon_condition → true",
  hasOptionalExpression({
    steps: [{ action: { kind: "allow_ignore_summon_condition" } }],
  }) === true
);
check(
  "connect_battle → true",
  hasOptionalExpression({
    steps: [{ action: { kind: "connect_battle" } }],
  }) === true
);

console.log(`\n[optional-wording-detector] ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
