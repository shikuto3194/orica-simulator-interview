import type { CardDefinition, GameState } from "@orica/rules-core";
import {
  getEnterFieldCorePlacementSourceCapacity,
  isSoulCoreOn,
} from "@orica/rules-core";

/** 維持コア配置UIで使うフィールドカードソース情報 */
export interface PlacementFieldSource {
  instanceId: string;
  definitionId: string;
  /** このカードから配置可能な通常コア数 (コスト支払い後の残数)。 */
  maxAmount: number;
  /** 通常/ソウルを合わせた供給上限。 */
  maxTotalAmount: number;
  /**
   * このカードにソウルコアが在り、配置元にできるか。
   * 通常コア 0 + ソウルコアのみのスピリットもソースに含めるための判定。
   * ソウルコアは maxAmount に含めず、soulCoreConfirm ダイアログで別枠処理する。
   */
  hasSoul: boolean;
}

export function buildPlacementFieldSources(options: {
  state: GameState;
  actingPlayerId: string;
  getDefinition: (definitionId: string) => CardDefinition | undefined;
  excludeInstanceIds?: ReadonlySet<string>;
}): PlacementFieldSource[] {
  return options.state.cardInstances
    .filter((card) => {
      if (options.excludeInstanceIds?.has(card.instanceId)) return false;
      const definition = options.getDefinition(card.definitionId);
      const canProvideNormal =
        card.normalCoreCount > 0 &&
        getEnterFieldCorePlacementSourceCapacity(
          options.state,
          options.actingPlayerId,
          card,
          definition,
          "normal"
        ) > 0;
      const canProvideSoul =
        isSoulCoreOn(options.state, card.instanceId) &&
        getEnterFieldCorePlacementSourceCapacity(
          options.state,
          options.actingPlayerId,
          card,
          definition,
          "soul"
        ) > 0;
      return canProvideNormal || canProvideSoul;
    })
    .map((card) => {
      const definition = options.getDefinition(card.definitionId);
      const canProvideNormal =
        card.normalCoreCount > 0 &&
        getEnterFieldCorePlacementSourceCapacity(
          options.state,
          options.actingPlayerId,
          card,
          definition,
          "normal"
        ) > 0;
      const canProvideSoul =
        isSoulCoreOn(options.state, card.instanceId) &&
        getEnterFieldCorePlacementSourceCapacity(
          options.state,
          options.actingPlayerId,
          card,
          definition,
          "soul"
        ) > 0;
      return {
        instanceId: card.instanceId,
        definitionId: card.definitionId,
        maxAmount: canProvideNormal
          ? getEnterFieldCorePlacementSourceCapacity(
              options.state,
              options.actingPlayerId,
              card,
              definition,
              "normal"
            )
          : 0,
        maxTotalAmount: getEnterFieldCorePlacementSourceCapacity(
          options.state,
          options.actingPlayerId,
          card,
          definition,
          "generic"
        ),
        hasSoul: canProvideSoul,
      };
    });
}
