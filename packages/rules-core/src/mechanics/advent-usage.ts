/**
 * 煌臨の回数制限(P3-170 I02〜I04)。専用の使用済み配列を持たず、共通の使用枠で管理する。
 *
 * 種別(kind)ごとに「どの能力の枠か」を構造参照で表す。同名共有は、使用者(プレイヤー)ごとに、
 * 許可元の printed name で共有する(10_rules/03e の同名=同じプレイヤー内、08a5)。
 *
 * - declare        : 煌臨カードの `adventData.declareUsageLimit`(通常の declare_advent の〔ターンに1回:同名〕)。
 * - alternate_cost : 「置いたものとして煌臨」の代替コスト(自己 `alternateCostAdvent` または
 *                    許可元 `hostDualAdventGrant`)。許可元がある場合は許可元の名前で共有し、
 *                    実際に煌臨したカードの名前ではない(08a5)。
 * - trash_host     : `trashAdventHostGrant`(トラッシュにある許可元カードが手札の煌臨元を煌臨させる)。
 * - trash_source   : `adventData.adventSourceZone:"trash"`(トラッシュからの煌臨)。
 *
 * 消費は「煌臨が成立した後」だけで行い、不発・宣言取消では消費しない(08a5:21)。
 */

import type { UsageSite } from "../effect/effect-usage-accounting";
import {
  abilityFingerprint,
  makeAbilityRef,
  sharedNameAbilityRef,
} from "../effect-usage";
import {
  canUseEffectUsage,
  consumeEffectUsageLogged,
} from "../legal/legal-actions-shared";
import type { CardDefinition, EffectUsageLimit, GameState } from "../model";

export type AdventUsageKind =
  | "declare"
  | "alternate_cost"
  | "trash_host"
  | "trash_source";

/** 〔ターンに1回:同名〕(許可元の printed name で共有、使用者ごと)。 */
const SAME_NAME_ONCE_PER_TURN: EffectUsageLimit = {
  kind: "per_card_name",
  duration: "turn",
};

export interface AdventUsageArgs {
  state: GameState;
  kind: AdventUsageKind;
  /** 煌臨を行うプレイヤー(使用者)。 */
  actingPlayerId: string;
  /** 枠の主体となるカード個体(許可元・煌臨元)。 */
  instanceId: string;
  /** 枠の主体となるカード定義(許可元が別にあるときは許可元)。 */
  definition: CardDefinition;
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
}

export function adventUsageSite(args: AdventUsageArgs): UsageSite {
  const limits =
    args.kind === "declare"
      ? args.definition.adventData?.declareUsageLimit
      : SAME_NAME_ONCE_PER_TURN;
  return {
    state: args.state,
    ability: makeAbilityRef("advent", args.definition.cardNo, args.kind),
    nameAbility: sharedNameAbilityRef(
      args.definition.name,
      abilityFingerprint({ adventUsage: args.kind })
    ),
    sourceInstanceId: args.instanceId,
    sourceDefinitionId: args.definition.cardNo,
    playerId: args.actingPlayerId,
    nameKey: args.definition.name,
    limits,
    ...(args.getCardDefinitionById
      ? { getCardDefinitionById: args.getCardDefinitionById }
      : {}),
  };
}

/** この煌臨の回数枠が使用可能か。制限が無い(declareUsageLimit 未設定)なら true。 */
export function canUseAdventUsage(args: AdventUsageArgs): boolean {
  return canUseEffectUsage(adventUsageSite(args));
}

/** 煌臨成立後に枠を消費して更新後の state を返す。既に上限なら state を変更しない。 */
export function consumeAdventUsage(args: AdventUsageArgs): GameState {
  return consumeEffectUsageLogged(adventUsageSite(args)).state;
}
