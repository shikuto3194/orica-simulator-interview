/**
 * 「《ソウルコア》以外の」指定 → `effectKind:"normal_only"` 必須の再発防止検出。
 *
 * 背景 (2026-08-02, BSSA01-C01): 印字「トラッシュの《ソウルコア》以外のコア1個」に対し
 * card-data の `core_move(from:trash, to:life)` に `effectKind:"normal_only"` が無く、
 * 通常/ソウル混在時に `handleTrashToLife` が `pendingLifeCoreSelection` を立てて
 * **ソウルコアを選択候補に含めていた**（GUI 誤表示）。型では防げず、効果が「動く」ことしか
 * 見ない単体テストも素通りするため長期潜伏する構造的バグ。
 * 正源: memory `project_soul_core_exclusion_effectkind_gap`。
 *
 * このモジュールは pure 関数のみ。カード定義の走査結果を受け取って判定する。
 *
 * 判定の限界 (意図的。いずれも exceptions で個別に落とす):
 * - **語彙の文脈違い**: 「《ソウルコア》以外のコアを取り除けない」のようにコア除去*耐性*を
 *   述べる行にもヒットする。必要なのは effectKind ではなく除去制約 CE なので対象外
 *   （実例 BSDB01-TX01(B)）。
 * - **クロスカード実装**: 本判定はカード単位。トークンの印字テキストに書かれた能力が
 *   親カード側の effects で実装されている場合を検出できない（実例 BSES01-T01）。
 *   なお当該実装は「正しい配置」ではなく印字忠実度違反（issues/P3-138）。本監査は
 *   「ソウル除外表現の有無」だけを見るので対象外というだけで、実装の是非とは別。
 * - 「該当アクションが存在しない」= 未実装の可能性があるので別 reason で返す
 *   （実装漏れの検出も本監査の価値。P3-135 の 2 枚はこの経路で見つかった）。
 *
 * **除外表現は core_move.effectKind だけではない。** 表現が複数ある概念を1つだけ見て
 * 判定すると誤検出する（2026-08-03 に BSES01-T01 を「トラッシュ経路未実装」と誤報告した）。
 */

/** 印字テキストに「《ソウルコア》以外」指定があるか。 */
export const SOUL_CORE_EXCLUSION_RE = /《ソウルコア》以外/;

export function hasSoulCoreExclusionWording(text) {
  return SOUL_CORE_EXCLUSION_RE.test(text ?? "");
}

/** `effectKind` を持ちうるコア移動系アクション。 */
export const CORE_MOVE_ACTION_KINDS = new Set(["core_move", "core_distribute"]);

/**
 * ソウルコア除外は `core_move.effectKind` 以外の表現も持つ。
 *
 * `summon` アクションの `trashCoreMax` + `trashCoreKind`（structured-summon.ts）は
 * 「召喚時にトラッシュから置けるコア」の源指定で、`"normal"` が《ソウルコア》以外、
 * `"generic"` がソウル込み。BSES01-T01「トラッシュからも《ソウルコア》以外のコアを
 * 1個まで置ける」はこちらで表現されている。
 *
 * `core_distribute(from:{ kind:"field_reserve_and_trash_self",
 * trashCoreKind:"normal_only" })` は、フィールド/リザーブの generic なコアと、
 * トラッシュの通常コアだけを一つの配置選択にまとめる表現である。BSTH02.7-TX01(A) の
 * 「トラッシュの《ソウルコア》以外のコア1個までとフィールド/リザーブのコア」のように、
 * 除外指定が一部の source にだけ掛かる場合もこの形で満たす。
 *
 * **core_move だけを見ると誤検出する**（2026-08-03 に実際に BSES01-T01 を
 * 「トラッシュ経路未実装」と誤報告した）。表現が複数あるものは全部を満たし判定に入れる。
 */
export const SOUL_EXCLUSION_SATISFYING_KINDS = new Set([
  ...CORE_MOVE_ACTION_KINDS,
  "summon",
]);

/** そのアクションが《ソウルコア》以外を表現しているか。 */
export function actionExcludesSoulCore(action) {
  if (!action || typeof action !== "object") return false;
  if (
    CORE_MOVE_ACTION_KINDS.has(action.kind) &&
    action.effectKind === "normal_only"
  )
    return true;
  if (
    action.kind === "core_distribute" &&
    action.from?.kind === "field_reserve_and_trash_self" &&
    action.from.trashCoreKind === "normal_only"
  )
    return true;
  if (action.kind === "summon" && action.trashCoreKind === "normal")
    return true;
  return false;
}

/**
 * effects ツリーを再帰的に走査し、コア移動系アクションを集める。
 * `steps` / `choice` / 分岐など任意のネストに対応するため、構造を仮定せず全 value を辿る。
 */
export function collectCoreMoveActions(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) collectCoreMoveActions(n, out);
    return out;
  }
  if (typeof node.kind === "string" && CORE_MOVE_ACTION_KINDS.has(node.kind))
    out.push(node);
  for (const v of Object.values(node)) collectCoreMoveActions(v, out);
  return out;
}

/**
 * ソウルコア除外を表現しうるアクション全種を集める（core_move / core_distribute /
 * トラッシュ源を持つ summon）。`trashCoreMax` を持たない通常の summon は無関係なので除く。
 */
export function collectSoulExclusionCapableActions(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) collectSoulExclusionCapableActions(n, out);
    return out;
  }
  if (typeof node.kind === "string") {
    if (CORE_MOVE_ACTION_KINDS.has(node.kind)) out.push(node);
    else if (node.kind === "summon" && node.trashCoreMax !== undefined)
      out.push(node);
  }
  for (const v of Object.values(node))
    collectSoulExclusionCapableActions(v, out);
  return out;
}

/**
 * 1 枚分の判定。違反なら `{reason, detail}`、問題なければ null。
 *
 * @param {string[]} textLines 印字テキスト行
 * @param {unknown} effects    カードの effects（ネスト構造のまま渡してよい）
 */
export function findSoulCoreExclusionViolation(textLines, effects) {
  const text = (textLines ?? []).join("\n");
  if (!hasSoulCoreExclusionWording(text)) return null;

  const actions = collectSoulExclusionCapableActions(effects ?? []);
  if (actions.length === 0) {
    return {
      reason: "missing_action",
      detail:
        "「《ソウルコア》以外」指定があるが core_move / core_distribute / トラッシュ源 summon のいずれも存在しない（該当アビリティ未実装の可能性）",
    };
  }
  if (actions.some(actionExcludesSoulCore)) return null;

  const kinds = actions.map((a) => a.kind).join(", ");
  return {
    reason: "missing_effect_kind",
    detail:
      `「《ソウルコア》以外」指定があるがソウル除外表現 (core_move/core_distribute.effectKind:"normal_only" / ` +
      `core_distribute.from.trashCoreKind:"normal_only" / summon.trashCoreKind:"normal") を持つアクションが無い (${actions.length} 件: ${kinds})。` +
      `省略すると通常/ソウル混在時にソウルコアが選択候補へ漏れる`,
  };
}
