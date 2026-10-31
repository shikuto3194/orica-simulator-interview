import { getCardById } from "../card/card-lookup";
import {
  canMoveCoresFrom,
  canMoveNormalCoresFrom,
} from "../core/core-movability";
import {
  isSoulCoreOn,
  moveNormalCores,
  moveSoulCore,
} from "../core/core-system";
import type { EnterFieldCorePlacementPolicy } from "./enter-field-placement-policy";
import {
  hasForcedCoreVoidRedirect,
  hasIndependentCoreManagement,
} from "../model";
import type { CardDefinition, CardInstance, GameState } from "../model";
import type { FieldCoreSourceMinimum } from "../model";
import { getEffectiveCategory } from "../mechanics/act-as-spirit";

export type EnterFieldCorePlacement =
  | {
      kind: "reserve_normal";
      amount: number;
    }
  | {
      kind: "reserve_soul";
    }
  | {
      kind: "card_normal";
      instanceId: string;
      amount: number;
    }
  | {
      kind: "card_soul";
      instanceId: string;
    }
  | {
      kind: "trash_normal";
      amount: number;
    }
  | {
      kind: "trash_soul";
    }
  | {
      kind: "void_normal";
      amount: number;
    };

function getCardInstanceOrThrow(
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

export function getPlacedCoreCount(
  placements: readonly EnterFieldCorePlacement[]
): number {
  return placements.reduce((sum, placement) => {
    switch (placement.kind) {
      case "reserve_normal":
      case "card_normal":
      case "trash_normal":
        return sum + placement.amount;
      case "reserve_soul":
      case "card_soul":
      case "trash_soul":
        return sum + 1;
      case "void_normal":
        return sum + placement.amount;
    }
  }, 0);
}

function assertPositivePlacementAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`Placement amount must be positive: ${amount}`);
  }
}

export type EnterFieldCorePlacementSourceBlockReason =
  | "wrong_controller"
  | "not_field"
  | "pending_leave"
  | "cannot_move_cores"
  | "forced_void_redirect";

export type EnterFieldCorePlacementSourceCoreKind = "normal" | "soul";

export function getEnterFieldCorePlacementSourceBlockReason(
  state: GameState,
  actingPlayerId: string,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition | undefined,
  coreKind: EnterFieldCorePlacementSourceCoreKind
): EnterFieldCorePlacementSourceBlockReason | null {
  if (sourceCard.controllerPlayerId !== actingPlayerId) {
    return "wrong_controller";
  }
  if (sourceCard.zone !== "field") return "not_field";
  // 03f: 待機中も残存コアは支払い・維持コアの選択元。実移動まではカード上に残る。
  const canMoveRequestedCore =
    coreKind === "normal"
      ? canMoveNormalCoresFrom(state, sourceCard, sourceDefinition)
      : canMoveCoresFrom(state, sourceCard, sourceDefinition);
  if (
    (coreKind === "normal" && sourceCard.normalCoreCount <= 0) ||
    (coreKind === "soul" && !isSoulCoreOn(state, sourceCard.instanceId)) ||
    !canMoveRequestedCore
  ) {
    return "cannot_move_cores";
  }
  if (sourceDefinition && hasForcedCoreVoidRedirect(sourceDefinition)) {
    return "forced_void_redirect";
  }
  return null;
}

export function canProvideEnterFieldCorePlacementSource(
  state: GameState,
  actingPlayerId: string,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition | undefined,
  coreKind: EnterFieldCorePlacementSourceCoreKind
): boolean {
  return (
    getEnterFieldCorePlacementSourceCapacity(
      state,
      actingPlayerId,
      sourceCard,
      sourceDefinition,
      coreKind
    ) > 0
  );
}

/** 個別の通常/ソウル候補と、その合計残数制約を共有する。 */
export function getEnterFieldCorePlacementSourceCapacity(
  state: GameState,
  actingPlayerId: string,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition | undefined,
  coreKind: EnterFieldCorePlacementSourceCoreKind | "generic",
  minimum: FieldCoreSourceMinimum | undefined = state.pendingMultiPlacement
    ?.fieldCoreSourceMinimum
): number {
  const normal =
    getEnterFieldCorePlacementSourceBlockReason(
      state,
      actingPlayerId,
      sourceCard,
      sourceDefinition,
      "normal"
    ) === null
      ? sourceCard.normalCoreCount
      : 0;
  const soul =
    getEnterFieldCorePlacementSourceBlockReason(
      state,
      actingPlayerId,
      sourceCard,
      sourceDefinition,
      "soul"
    ) === null
      ? sourceCard.soulCoreCount
      : 0;
  const count =
    coreKind === "normal" ? normal : coreKind === "soul" ? soul : normal + soul;
  const category = sourceDefinition
    ? getEffectiveCategory(state, sourceCard, sourceDefinition)
    : undefined;
  if (
    !minimum ||
    category === undefined ||
    !minimum.categories.includes(category)
  )
    return count;
  return Math.max(
    0,
    Math.min(
      count,
      sourceCard.normalCoreCount + sourceCard.soulCoreCount - minimum.minimum
    )
  );
}

function validatePlacementSourceCard(
  state: GameState,
  actingPlayerId: string,
  instanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  coreKind: EnterFieldCorePlacementSourceCoreKind
): void {
  const sourceCard = getCardInstanceOrThrow(
    state,
    instanceId,
    "Unknown placement source card"
  );

  if (sourceCard.controllerPlayerId !== actingPlayerId) {
    throw new Error(
      `Placement source card is not controlled by ${actingPlayerId}: ${instanceId}`
    );
  }

  if (sourceCard.zone !== "field") {
    throw new Error(
      `Placement source card must be on the field: ${instanceId}`
    );
  }

  const sourceDefinition = getCardDefinitionById(sourceCard.definitionId);
  const blockReason = getEnterFieldCorePlacementSourceBlockReason(
    state,
    actingPlayerId,
    sourceCard,
    sourceDefinition,
    coreKind
  );

  switch (blockReason) {
    case null:
      return;
    case "cannot_move_cores":
      throw new Error(
        `Placement source card cannot provide enter-field cores: ${instanceId}`
      );
    case "forced_void_redirect":
      throw new Error(
        `Placement source card would redirect moved cores to void: ${instanceId}`
      );
    case "wrong_controller":
    case "not_field":
    case "pending_leave":
      throw new Error(
        `Placement source card cannot provide enter-field cores: ${instanceId}`
      );
  }
}

function validatePlacementDestinationCard(
  state: GameState,
  destinationInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): void {
  const destinationCard = getCardInstanceOrThrow(
    state,
    destinationInstanceId,
    "Unknown placement destination card"
  );
  const destinationDefinition = getCardDefinitionById(
    destinationCard.definitionId
  );

  if (
    destinationDefinition &&
    hasIndependentCoreManagement(destinationDefinition)
  ) {
    throw new Error(
      `Independent-core cards cannot receive enter-field core placements: ${destinationInstanceId}`
    );
  }
}

export function assertEnterFieldCorePlacementsAllowed(
  policy: EnterFieldCorePlacementPolicy,
  placements: readonly EnterFieldCorePlacement[]
): void {
  if (policy.rule === "forbidden" && placements.length > 0) {
    throw new Error("This card does not allow enter-field core placements");
  }

  const selectedCoreCount = getPlacedCoreCount(placements);

  if (
    policy.maximumCoreCount !== null &&
    selectedCoreCount > policy.maximumCoreCount
  ) {
    throw new Error(
      `Too many enter-field cores selected: maximum=${policy.maximumCoreCount} selected=${selectedCoreCount}`
    );
  }

  // BSLH01-T13: policy.allowedTrashNormalCoreCount が明示設定されているときのみ検証する
  // (opt-in)。他の trash 経路 (BSSL01-X01/C06 の pendingMultiPlacement) はこのフィールドを
  // 一切設定しない別 policy 構築経路のため、undefined のままここをスキップして従来通り
  // 呼び出し元 (pending-action-handlers.ts) 側の trashCoreMax 系チェックに委ねる。
  if (policy.allowedTrashNormalCoreCount !== undefined) {
    const trashNormalAmount = placements.reduce(
      (sum, placement) =>
        placement.kind === "trash_normal" ? sum + placement.amount : sum,
      0
    );
    if (trashNormalAmount > policy.allowedTrashNormalCoreCount) {
      throw new Error(
        `Too many trash-sourced enter-field cores selected: maximum=${policy.allowedTrashNormalCoreCount} selected=${trashNormalAmount}`
      );
    }
  }
}

export function applyEnterFieldCorePlacements(options: {
  state: GameState;
  actingPlayerId: string;
  destinationInstanceId: string;
  placements: readonly EnterFieldCorePlacement[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  fieldCoreSourceMinimum?: FieldCoreSourceMinimum;
  /**
   * BSSL01-X01/C06: 通常は使えない追加 source は通常の単体維持コア配置には漏らさず、
   * capped pendingMultiPlacement 検証を通った経路だけが opt-in する。
   */
  allowTrashNormal?: boolean;
  allowTrashSoul?: boolean;
  allowVoidNormal?: boolean;
}): GameState {
  let currentState = options.state;

  if (options.placements.length > 0) {
    validatePlacementDestinationCard(
      currentState,
      options.destinationInstanceId,
      options.getCardDefinitionById
    );
  }

  for (const placement of options.placements) {
    if (placement.kind === "card_normal" || placement.kind === "card_soul") {
      validatePlacementSourceCard(
        currentState,
        options.actingPlayerId,
        placement.instanceId,
        options.getCardDefinitionById,
        placement.kind === "card_normal" ? "normal" : "soul"
      );
      const source = getCardInstanceOrThrow(
        currentState,
        placement.instanceId,
        "Unknown placement source card"
      );
      const capacity = getEnterFieldCorePlacementSourceCapacity(
        currentState,
        options.actingPlayerId,
        source,
        options.getCardDefinitionById(source.definitionId),
        placement.kind === "card_normal" ? "normal" : "soul",
        options.fieldCoreSourceMinimum
      );
      if ((placement.kind === "card_normal" ? placement.amount : 1) > capacity)
        throw new Error(
          `Placement source card exceeds available cores or minimum remaining cores: ${placement.instanceId}`
        );
    }
    switch (placement.kind) {
      case "reserve_normal":
        assertPositivePlacementAmount(placement.amount);
        currentState = moveNormalCores(
          currentState,
          {
            kind: "reserve",
            playerId: options.actingPlayerId,
          },
          {
            kind: "card",
            instanceId: options.destinationInstanceId,
          },
          placement.amount,
          options.getCardDefinitionById,
          { allowEnterFieldOnlyPlacementDestination: true }
        );
        break;
      case "reserve_soul":
        currentState = moveSoulCore(
          currentState,
          options.actingPlayerId,
          {
            kind: "reserve",
            playerId: options.actingPlayerId,
          },
          {
            kind: "card",
            instanceId: options.destinationInstanceId,
          },
          1,
          options.getCardDefinitionById,
          { allowEnterFieldOnlyPlacementDestination: true }
        );
        break;
      case "card_normal":
        assertPositivePlacementAmount(placement.amount);
        currentState = moveNormalCores(
          currentState,
          {
            kind: "card",
            instanceId: placement.instanceId,
          },
          {
            kind: "card",
            instanceId: options.destinationInstanceId,
          },
          placement.amount,
          options.getCardDefinitionById,
          { allowEnterFieldOnlyPlacementDestination: true }
        );
        break;
      case "card_soul":
        currentState = moveSoulCore(
          currentState,
          options.actingPlayerId,
          {
            kind: "card",
            instanceId: placement.instanceId,
          },
          {
            kind: "card",
            instanceId: options.destinationInstanceId,
          },
          1,
          options.getCardDefinitionById,
          { allowEnterFieldOnlyPlacementDestination: true }
        );
        break;
      case "trash_normal":
        if (options.allowTrashNormal !== true) {
          throw new Error(
            "Trash normal core placement is only allowed by capped pending multi placement"
          );
        }
        assertPositivePlacementAmount(placement.amount);
        currentState = moveNormalCores(
          currentState,
          {
            kind: "trash",
            playerId: options.actingPlayerId,
          },
          {
            kind: "card",
            instanceId: options.destinationInstanceId,
          },
          placement.amount,
          options.getCardDefinitionById,
          { allowEnterFieldOnlyPlacementDestination: true }
        );
        break;
      case "trash_soul":
        if (options.allowTrashSoul !== true) {
          throw new Error(
            "Trash soul core placement is only allowed by capped pending multi placement"
          );
        }
        currentState = moveSoulCore(
          currentState,
          options.actingPlayerId,
          {
            kind: "trash",
            playerId: options.actingPlayerId,
          },
          {
            kind: "card",
            instanceId: options.destinationInstanceId,
          },
          1,
          options.getCardDefinitionById,
          { allowEnterFieldOnlyPlacementDestination: true }
        );
        break;
      case "void_normal":
        if (options.allowVoidNormal !== true) {
          throw new Error(
            "Void normal core placement is only allowed by capped pending multi placement targets"
          );
        }
        assertPositivePlacementAmount(placement.amount);
        currentState = moveNormalCores(
          currentState,
          {
            kind: "void",
            playerId: options.actingPlayerId,
          },
          {
            kind: "card",
            instanceId: options.destinationInstanceId,
          },
          placement.amount,
          options.getCardDefinitionById,
          { allowEnterFieldOnlyPlacementDestination: true }
        );
        break;
    }
  }

  return currentState;
}
