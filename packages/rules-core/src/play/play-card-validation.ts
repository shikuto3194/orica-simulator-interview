import { getCardById } from "../card/card-lookup";
import { isInHandForOwnEffect } from "../effect/card-access-rules";
import type {
  CardCategory,
  CardDefinition,
  CardInstance,
  GameState,
  Zone,
} from "../model";
import { collectUnderCardScopeIds } from "../model";

export function getPlayCardInstanceOrThrow(
  state: GameState,
  instanceId: string,
  detail: string
): CardInstance {
  const cardInstance = getCardById(state, instanceId);

  if (!cardInstance) {
    throw new Error(`${detail}: ${instanceId}`);
  }

  return cardInstance;
}

export function getPlayCardDefinitionOrThrow(
  definitionId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): CardDefinition {
  const definition = getCardDefinitionById(definitionId);

  if (!definition) {
    throw new Error(`Unknown card definition: ${definitionId}`);
  }

  return definition;
}

export function assertMainStepPlayCardAction(
  state: GameState,
  actingPlayerId: string,
  options?: { allowNonMainStep?: boolean }
): void {
  if (!options?.allowNonMainStep && state.step !== "main") {
    throw new Error(`Card play actions require main step: ${state.step}`);
  }

  // 自己召喚許可 (「手札/手元にあるこのカードは召喚できる」) は timingScope:"opponent"/"both"
  // で非アクティブプレイヤー (防御側) も使える。allowNonMainStep 時は main step 限定を
  // 緩めるのと同じ理由で、acting player が active でなくてもよい
  // (フラッシュ窓の優先権保持者が対象。controllerPlayerId 一致は別途 getHandCardAndDefinition
  // が検証する)。
  if (!options?.allowNonMainStep && state.activePlayerId !== actingPlayerId) {
    throw new Error(
      `Card play actions require the acting player to be active: acting=${actingPlayerId} active=${state.activePlayerId}`
    );
  }
}

export function getHandCardAndDefinition(options: {
  state: GameState;
  actingPlayerId: string;
  cardInstanceId: string;
  expectedCategories: readonly CardCategory[];
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  allowNonMainStep?: boolean;
  /**
   * hand/set_aside 以外に許容するゾーン (engine-advent-source-summon-permission)。
   * 「手札/トラッシュにあるこのカードは召喚できる」型の召喚許可 action は、上流の
   * `getAvailableHandSummonPermissionLegalActions` が effect.applicability.zone で
   * 既にゲート済みのため、実行側では宣言されたゾーンのみをここで追加許容する
   * （通常の手札プレイ経路には影響しない）。
   */
  additionalAllowedZones?: readonly Zone[];
  /**
   * 煌臨元 (advent_source) アンダーカードを許容する (BSSL01-X03)。煌臨元は runtime Zone 上
   * "field" のままホストの下に重なるため、`additionalAllowedZones` の単純な zone 一致では
   * 表現できず、collectUnderCardScopeIds による個別判定が必要。
   */
  allowAdventSourceZone?: boolean;
  /**
   * 魂状態カードを許容する。魂状態は runtime Zone 上 "field" のまま
   * players[].soulStateInstanceIds で表すため、単純な zone 一致では表現できない。
   */
  allowSoulStateZone?: boolean;
}): {
  card: CardInstance;
  definition: CardDefinition;
} {
  assertMainStepPlayCardAction(
    options.state,
    options.actingPlayerId,
    options.allowNonMainStep ? { allowNonMainStep: true } : undefined
  );

  const card = getPlayCardInstanceOrThrow(
    options.state,
    options.cardInstanceId,
    "Unknown hand card"
  );
  const definition = getPlayCardDefinitionOrThrow(
    card.definitionId,
    options.getCardDefinitionById
  );

  if (card.controllerPlayerId !== options.actingPlayerId) {
    throw new Error(`Hand card is not controlled by ${options.actingPlayerId}`);
  }

  const isAllowedAdventSourceField =
    options.allowAdventSourceZone === true &&
    card.zone === "field" &&
    collectUnderCardScopeIds(options.state).adventSource.has(card.instanceId);
  const isAllowedSoulStateField =
    options.allowSoulStateZone === true &&
    card.zone === "field" &&
    options.state.players.some((player) =>
      player.soulStateInstanceIds.includes(card.instanceId)
    );

  if (
    card.zone !== "hand" &&
    card.zone !== "set_aside" &&
    !isInHandForOwnEffect(
      options.state,
      card,
      options.actingPlayerId,
      options.getCardDefinitionById
    ) &&
    !options.additionalAllowedZones?.includes(card.zone) &&
    !isAllowedAdventSourceField &&
    !isAllowedSoulStateField
  ) {
    throw new Error(
      `Hand/set-aside card must be in hand or set_aside: ${card.instanceId} zone=${card.zone}`
    );
  }

  if (!options.expectedCategories.includes(definition.printedCategory)) {
    throw new Error(
      `Card category does not match action: expected=${options.expectedCategories.join("|")} actual=${definition.printedCategory}`
    );
  }

  return {
    card,
    definition,
  };
}
