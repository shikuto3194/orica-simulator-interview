/**
 * P3-96 任意文言検出 — 可能形（できる/〜ける/〜せる/〜られる）を含む non-stub effect が
 * executionMode/min0/choice 等の任意表現を持たないことを検出する純粋関数群。
 *
 * 裁定 2026-06-12（信頼度C）: 「できる」は字面の「○○できる」に限らず、任意を意味する文言
 * すべてを含む。可能形の語尾全般が該当する。
 * 正源: manual/ai-reference/10_rules/03c_effect-text-interpretation.md §「する」vs「できる」
 *
 * 設計判断:
 * - **句読点単位で否定/能力付与セグメントを剥がしてから判定** (NEGATION_NEAR + ABILITY_GRANT)。
 *   行全体で除外すると行末の「できる」と行頭の「できない」が共存する文を取り違える。
 * - **可能形は positive list** で限定。広範な `[え-れ]る` パターンは vanilla 動詞末尾と
 *   衝突するため使わない。
 * - **任意表現の有無** は effect.executionMode / step.executionMode / step.stepCondition /
 *   action.kind in [choice,conditional_cost,revealed_choice,optional_branch] /
 *   target.count.min:0 / amount.min:0 / nested steps を再帰探索。
 */

// 高信頼可能形リスト (positive-list)。corpus からの出現 + P3-96 issue 例示 + 裁定既出。
// 「加える」「比べる」「重ねる」「疲労させる」等の **強制動詞** とは語尾で区別される
// (「加えられる」「比べられる」「数えられる」は可能形=任意; 末尾の られる が信号)。
// 新しい可能形カードを追加するときはここへ追記して `node scripts/test-optional-wording-detector.mjs`
// と corpus 比較テスト (POSSIBLE_SUFFIX_RE 側の漏れ警告) を回す。
export const OPTIONAL_WORDING_RE =
  /(?:できる|でき(?=[、。」]|そう|$)|戻せる|置ける|引ける|出せる|受けられる|加えられる|入れ替えられる|裏返せる|払える|消せる|乗せられる|渡せる|入れられる|破棄できる|破壊できる|発動できる|変えられる|得られる|取れる|与えられる|送れる|捨てられる|残せる|混ぜられる|配置できる|セットできる|奪える|疲労させられる|回復させられる|放出させられる|行える|数えられる|比べられる|減らせる|返せる|重ねられる|分けられる|させられる|押せる|消滅させられる|破棄させられる|交換できる|プレイできる|ことができる|見れる|見られる|拾える|読める|聞ける|使える|選べる|出せる|残せる|終了できる|なれる|防げる)/;

// 補助的 suffix 検出 (Lens 6 補強)。POSITIVE_LIST に追加し忘れた可能形を文末で拾う。
// 句読点直前 + 直前1文字が漢字/カナ/ひらがな に限定。〜ける/〜せる/〜られる を網羅
// (verifier round 5 Lens 6 refute: 「下における」「召喚できる」漏れ対策, 2026-06-23)。
// 残存 FP は FORCED_VERB_NEAR で剥がす。
export const POSSIBLE_SUFFIX_RE =
  /(?:[ぁ-んァ-ヶ一-龯](?:ける|せる|られる|せられる|えられる))(?=[。、)\]」』]|$)/;
// 強制動詞 (能動形 一段 / 使役 / mandatory ichidan) — POSSIBLE_SUFFIX_RE と衝突するパターンを剥がす。
// 「下における」(置ける)、「召喚できる」等の可能形ではない強制動作を捕まえる正源。
// phrase 単位の mask (replace) として運用する (verifier round 5 Lens 6 refute:
// segment 全体の veto は同セグメント別可能形を silent false negative にするため。
// NEGATION_MASK / ABILITY_GRANT と同型処理, 2026-06-23)。
export const FORCED_VERB_MASK =
  /(?:加える|比べる|与える|重ねる|入れ替える|疲労させる|回復させる|消滅させる|破棄させる|させる|を持たせる|受ける|受けない|続ける|投げる|助ける|仕掛ける|開ける|認める|混ぜる|分ける|預ける|決める|逃げる|抜ける|乗せる|寄せる|並べる|広げる|曲げる|つける|傾ける|終える|まかせる|あわせる|当てる|消す)/g;
// 後方互換 export
export const FORCED_VERB_NEAR = FORCED_VERB_MASK;

// 可能形動詞の否定 (できない/られない/せない/けない/えない/れない) を網羅。
// 検出用 (test): セグメント中にこれが含まれているかの early-out 判定。
export const NEGATION_NEAR = /(?:でき|られ|せ|け|え|れ|出来)ない/;
// マスク用 (replace): 動詞ステム (kanji/katakana 起点 + 後続 0-3 漢字/カナ/ひらがな) と
// 否定 suffix をまとめて剥がす。同一セグメントで「発揮できない…無視して発揮できる」の
// ように否定と肯定の可能形が共存するケースで、肯定側を silent false negative にしないため、
// 行単位 skip ではなく phrase 単位 mask を行う (verifier round 4 Lens 6 refute, 2026-06-23)。
// 注: ステムは kanji/katakana 起点 + 後続 0-3 文字に制限することで、節境界
// (「が」「を」「は」等の particle) をまたいだ前方クラスタ消去を防ぐ
// (verifier round 7 Lens 6 refute: 「戻せるが破壊できない」で「せるが破壊でき」まで
// 削られて肯定可能形が消える silent false negative を防ぐ, 2026-06-23)。
export const NEGATION_MASK =
  /[一-龯ァ-ヶ][一-龯ァ-ヶぁ-ん]{0,3}(?:でき|られ|せ|け|え|れ|出来)ない/g;

// 能力付与パターン: 「アタックできる/ブロックできる」等は状態付与であり player の任意行動ではない。
// セグメント全体を捨てると同セグメント内の別の任意文言を silent false negative にするため、
// マッチした能力付与句だけを replace で剥がし、残りの文字列を判定する (verifier round 2
// Lens 6 refute BSAZ01-C02, 2026-06-23)。
//
// 注: ABILITY_GRANT は **静的な状態許可** (state permission) のみマスク。
// 「アタック/ブロックできる」alone (state-grant 文脈) のみが該当。
// 「発揮できる」「召喚できる」「使用できる」「配置できる」「セットできる」「プレイできる」
// 「アタックステップを終了できる」は player-choice 任意 (verifier round 3/5/6 Lens 6 refute)。
// 判別: マッチ位置の直前に「指定して/対して/狙って/に対し」が連接していると player-choice なので
// **マスクしない** (verifier round 6 Lens 6 refute BSKB01-C01, 2026-06-23)。判別ロジックは
// hasOptionalWording の applyAbilityGrantMask に集約。
export const ABILITY_GRANT =
  /(?:アタック(?:\/ブロック)?でき(?:る|ない)?|ブロックでき(?:る|ない)?|タップ(?:.{0,3})でき(?:る|ない)?)/g;

const PLAYER_CHOICE_PRECEDING =
  /(?:指定して|対して|狙って|に対し|代わりに|かわりに)$/;

const KEYWORD_PERMISSION_MASKS = [
  // キーワード括弧内の一般 permission。該当 effect の発揮任意性ではなく、
  // grandwalker/quartz/mirage/type 等の機構側 legal action / static permission を説明する。
  /【アルドノアドライブ：[^】]+】（[^）]*?置ける[^）]*?）/g,
  /【クォーツ：[^】]+（手札から対象にセットできる）】/g,
  /【ミラージュ：[^】]+（このカードは手札からセットできる）】/g,
  /【タイプ：[^】]+】（フィールドに置かれている間、次の効果を発揮する。）/g,
  /鍵ブレイヴは、[^。\n]*魂状態にできる。/g,
  /魂状態のこのカードには、[^。\n]*セットできる。（セット中のカードは魂状態として扱う。）/g,
];

function applyAbilityGrantMask(seg) {
  return seg.replace(ABILITY_GRANT, (match, offset) => {
    const preceding = seg.slice(0, offset);
    if (PLAYER_CHOICE_PRECEDING.test(preceding)) return match; // mask しない
    return ""; // mask する
  });
}

export function hasOptionalWording(text) {
  if (!text) return false;
  let keywordMasked = String(text);
  for (const mask of KEYWORD_PERMISSION_MASKS) {
    keywordMasked = keywordMasked.replace(mask, "");
  }
  const segments = keywordMasked.split(/[。、\n]/);
  for (const seg of segments) {
    if (!seg) continue;
    // 否定句・能力付与句・強制動詞句を **マスク** (剥がす) してから残文で判定。
    // セグメント全体を skip すると同セグメント内に肯定/任意可能形が共存するときに
    // silent false negative を生む (verifier round 2/4/6 refute, 2026-06-23)。
    // ABILITY_GRANT は applyAbilityGrantMask で「指定して/対して/狙って」直前は除外。
    let masked = applyAbilityGrantMask(seg.replace(NEGATION_MASK, "")).replace(
      FORCED_VERB_MASK,
      ""
    );
    if (!masked) continue;
    if (OPTIONAL_WORDING_RE.test(masked)) return true;
    // fall-through suffix check (P3-96 Lens 6: positive list 漏れの保険)。
    // 残文 (強制動詞 mask 済) に可能形 suffix があれば true。
    if (POSSIBLE_SUFFIX_RE.test(masked + "。")) {
      return true;
    }
  }
  return false;
}

export function hasOptionalExpression(effect) {
  if (!effect) return false;
  if (effect.executionMode === "optional") return true;
  if (effect.executionMode?.kind === "optional") return true;
  // timing.kind==="activated" は generateFieldCardEffectRegistrations 等が汎用 legal action
  // 化する（召喚/使用/配置と同型のプレイヤー起動選択）。executionMode を持たなくても
  // 発動そのものが任意なので、per-effect 明示は不要 (P3-96 warning drain, BSGE01-TR01(A)
  // effects[1] 「フラッシュタイミングで裏返せる」等)。
  if (effect.timing?.kind === "activated") return true;
  // バースト発動はセット中バースト機構の declaration 自体が opt-in。
  if (effect.timing?.kind === "burst") return true;
  if (Array.isArray(effect.steps)) {
    for (const step of effect.steps) {
      if (stepHasOptionalExpression(step)) return true;
    }
  }
  return false;
}

export function stepHasOptionalExpression(step) {
  if (!step) return false;
  if (step.executionMode === "optional") return true;
  if (step.executionMode?.kind === "optional") return true;
  // 実 DSL shape (dsl-types.ts:2175-2215): step.connector === "conditional_cost"
  // = 「○○することで」双方向依存（任意コストゲート）。step.choice = 「以下から1つを
  // 選ぶ」型のサブステップ群（プレイヤー選択 = 任意性）。stepCondition は前ステップ
  // 結果に基づくゲートで player の任意行動ではないため optional 表現に数えない
  // (verifier round 1 Lens 5 refute, 2026-06-23)。
  if (step.connector === "conditional_cost") return true;
  if (Array.isArray(step.choice) && step.choice.length > 0) return true;
  // step.repeat?.optional === true (動的/固定 反復の任意化、dsl-types.ts:2056-2173)
  // BSTH01-X04 等の register_redirect_effect_target で action.optional:true を持つ
  // optional 表現 (verifier round 7 Lens 5 refute, 2026-06-23)。
  if (step.repeat && step.repeat.optional === true) return true;
  const action = step.action;
  if (!action) return false;
  if (action.optional === true) return true;
  // action.kind === "revealed_choice" / "optional_branch" は legacy 互換 (一部 DSL 拡張で利用)。
  // choice / conditional_cost は step レベルが SSOT のため action.kind ではここで判定しない。
  if (["revealed_choice", "optional_branch"].includes(action.kind)) return true;
  // life_gain_replacement は定義上「増やす代わりに〜できる」の replace/decline 選択
  // (dsl-types.ts:2007 LifeGainReplacementAction 「任意で増加を代替アクションに置換できる」)。
  // pendingLifeGainReplacementChoice が常に decline を許すため executionMode は不要。
  if (action.kind === "life_gain_replacement") return true;
  // これらは action 自体が任意の legal-action / overlay choice を生成する継続効果。
  // 文言上の「できる」は executionMode ではなく、提示された variant を選ぶかどうかで担保する。
  if (
    action.kind === "grant_optional_deck_reveal_count_boost" ||
    action.kind === "grant_paid_prevention_immunity" ||
    action.kind === "offer_magic_pre_cost_trigger" ||
    action.kind === "allow_ignore_summon_condition" ||
    action.kind === "connect_battle"
  )
    return true;
  // 置換型耐性は「置換する/しない」の確認を pending replacement action で出す。
  // BSTH08.5-M11 / X04 の「除外効果 -> 手札に戻しますか？」等。
  if (action.kind === "effect_resistance" && action.replacement) return true;
  // useCostPayment の可変枚数支払い (0〜maxCount) は本質的に任意コスト。
  // discard_hand は minCount 概念が無く常に 0 枚選択可 (dsl-types.ts:1644)。
  // exclude は minCount 省略/0 のときのみ 0 枚選択可（minCount>0 は必須除外数を表し
  // 任意ではない、dsl-types.ts:1622「除外できなければこの方法では召喚できない」）。
  const payment = action.useCostPayment;
  if (payment) {
    if (payment.kind === "discard_hand") return true;
    if (
      payment.kind === "exclude" &&
      (payment.minCount === undefined || payment.minCount === 0)
    )
      return true;
  }
  if (action.grantedEffect && hasOptionalExpression(action.grantedEffect)) {
    return true;
  }
  const target = action.target;
  if (target && typeof target === "object") {
    const count = target.count;
    if (count && typeof count === "object") {
      // 任意の signal は min === 0 のみ。dynamic max (count.max が DynamicCount オブジェクト)
      // は min:1 + max:dynamic で「1体は強制、追加で動的上限まで」というケースもあり、
      // 「fully optional」を意味しない (verifier round 3 Lens 6 refute, 2026-06-23)。
      // P3-96 issue:29 が「TargetSpec.count.min: 0」と明示。
      if (typeof count.min === "number" && count.min === 0) return true;
    }
  }
  const amount = action.amount;
  if (amount && typeof amount === "object") {
    if (typeof amount.min === "number" && amount.min === 0) return true;
  }
  if (Array.isArray(action.steps)) {
    for (const s of action.steps) if (stepHasOptionalExpression(s)) return true;
  }
  if (Array.isArray(action.branches)) {
    for (const b of action.branches) {
      if (Array.isArray(b.steps))
        for (const s of b.steps) if (stepHasOptionalExpression(s)) return true;
    }
  }
  return false;
}
