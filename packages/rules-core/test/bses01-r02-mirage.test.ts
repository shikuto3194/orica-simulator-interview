/**
 * BSES01-R02 スカベンジャー・ファイド:
 * 自分の効果でデッキからオープン/トラッシュへ置かれたときの有償ミラージュセットと、
 * 【セット中】の自分トラッシュ「８６」カードへの相手効果耐性を盤面で検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import {
  materializeDeferredTrashOptionalAdds,
  processMovedToTrashEffects,
} from "../src/effect/structured-effect-interpreter";
import { useSetMirageAsAction } from "../src/mechanics/mirage-system";

const ALICE = "alice";
const BOB = "bob";
const cardMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);
const card = (cardNo: string): CardDefinition => {
  const definition = cardMap.get(cardNo);
  if (!definition) throw new Error(`Missing card definition: ${cardNo}`);
  return definition;
};
const R02 = card("BSES01-R02");
const R03 = card("BSES01-R03");

const REVEAL_SOURCE: CardDefinition = {
  cardNo: "TEST-BSES01-R02-REVEAL-SOURCE",
  name: "BSES01-R02公開元",
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  effects: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const OPPONENT_TRASH_SOURCE: CardDefinition = {
  cardNo: "TEST-BSES01-R02-OPPONENT-TRASH-SOURCE",
  name: "相手トラッシュ操作元",
  printedCategory: "magic",
  colors: ["yellow"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "search_zone",
            zone: "trash",
            player: "opponent",
            count: 1,
            destination: "hand",
          },
        },
      ],
    },
  ],
  sourceUrls: [],
  sourceConfidence: "C",
};

const getDef = (id: string): CardDefinition | undefined =>
  id === REVEAL_SOURCE.cardNo
    ? REVEAL_SOURCE
    : id === OPPONENT_TRASH_SOURCE.cardNo
      ? OPPONENT_TRASH_SOURCE
      : cardMap.get(id);
const noTriggers = () => [];

const REVEAL_EFFECT = {
  timing: { kind: "activated" as const, mode: "main" as const },
  steps: [
    {
      action: {
        kind: "deck_reveal" as const,
        revealCount: 1,
        picks: [],
        remainder: "bottom" as const,
      },
    },
  ],
};

function revealedPick(state: GameState) {
  const action = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggers,
  }).find((candidate) => candidate.kind === "resolve_pending_deck_reveal_pick");
  if (!action || action.kind !== "resolve_pending_deck_reveal_pick") {
    throw new Error("revealed_choice action not found");
  }
  return action;
}

function revealR02(options: {
  reserve: number;
  sourceFieldCores?: number;
  alreadySetThisTurn?: boolean;
  protectedTrashCard?: boolean;
}): {
  state: GameState;
  targetId: string;
  sourceId: string;
  protectedId?: string;
} {
  const sourceId = "r02-reveal-source";
  const targetId = "r02-revealed";
  const source = createCardInstance(REVEAL_SOURCE, {
    instanceId: sourceId,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: options.sourceFieldCores ?? 0,
  });
  const target = createCardInstance(R02, {
    instanceId: targetId,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "deck",
  });
  const protectedCard = options.protectedTrashCard
    ? createCardInstance(R03, {
        instanceId: "r03-protected",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
      })
    : undefined;
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [{ reserveNormalCoreCount: options.reserve }, {}],
    cardInstances: [source, target, ...(protectedCard ? [protectedCard] : [])],
  });
  const state: GameState = {
    ...base,
    activePlayerId: ALICE,
    step: "start",
    players: base.players.map((player) =>
      player.id === ALICE ? { ...player, deckCount: 1 } : player
    ),
    ...(options.alreadySetThisTurn
      ? { mirageSetPlayerIdsThisTurn: [ALICE] }
      : {}),
  };
  const afterReveal = executeEffect({
    chainId: "test:bses01-r02-mirage:168",
    state,
    effect: REVEAL_EFFECT,
    sourceInstanceId: sourceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggers,
  });
  return {
    state: afterReveal,
    targetId,
    sourceId,
    ...(protectedCard ? { protectedId: protectedCard.instanceId } : {}),
  };
}

function resolveEffectSet(
  state: GameState,
  targetId: string,
  paymentSources:
    | readonly { kind: "reserve"; amount: number }[]
    | readonly { kind: "card"; instanceId: string; amount: number }[]
): GameState {
  return applyLegalAction({
    state,
    action: revealedPick(state),
    selectedDeckRevealCardIds: [targetId],
    deckRevealMiragePaymentSourcesByInstanceId: { [targetId]: paymentSources },
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggers,
  }).state;
}

describe("BSES01-R02 スカベンジャー・ファイドのミラージュ本文", () => {
  it("BSES01-R02 [0]/[2]/[3,4]: card_event有償セットとセット中トラッシュ86耐性をDSLで表す", () => {
    expect(R02.mirageData).toEqual({ cost: 1, reduction: [] });
    expect(R02.effects?.[0]).toMatchObject({
      timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
      cardEventDisposition: { kind: "set_as_mirage" },
      executionMode: "optional",
      condition: [
        { kind: "trigger_source_player", player: "self" },
        { kind: "trigger_from_zone", zones: ["deck"] },
      ],
      textRef: [0],
    });
    expect(R02.effects?.[1]).toMatchObject({
      timing: { kind: "continuous" },
      applicability: { zone: ["mirage_set"] },
      textRef: [3, 4],
    });
  });

  it("BSES01-R02 mirage_cost=1,reduction=[]: ミラージュ手札セットでリザーブ1コアを支払う", () => {
    const hand = createCardInstance(R02, {
      instanceId: "r02-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
      cardInstances: [hand],
    });
    const result = useSetMirageAsAction({
      state: { ...base, activePlayerId: ALICE, step: "main" },
      actingPlayerId: ALICE,
      sourceInstanceId: hand.instanceId,
      paymentSources: [{ kind: "reserve", amount: 1 }],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggers,
    }).state;
    expect(
      result.cardInstances.find((entry) => entry.instanceId === hand.instanceId)
        ?.zone
    ).toBe("mirage");
    expect(
      result.players.find((player) => player.id === ALICE)
        ?.reserveNormalCoreCount
    ).toBe(0);
  });

  it("BSES01-R02 [0] 公開由来: 合計コア0ならセット候補に出ない", () => {
    const { state, targetId } = revealR02({ reserve: 0, sourceFieldCores: 0 });
    expect(state.pendingDeckReveal?.phase).toBe("revealed_choice");
    expect(state.pendingDeckReveal?.revealedDispositionMap?.[targetId]).toEqual(
      {
        kind: "set_as_mirage",
      }
    );
    expect(revealedPick(state).candidateCardInstanceIds).not.toContain(
      targetId
    );
  });

  it("BSES01-R02 [0] 公開由来: メイン外・通常セット済みでもリザーブ1コアで有償セットし、スタックを開かない", () => {
    const { state, targetId } = revealR02({
      reserve: 1,
      alreadySetThisTurn: true,
      protectedTrashCard: true,
    });
    expect(revealedPick(state).candidateCardInstanceIds).toContain(targetId);
    const resolved = resolveEffectSet(state, targetId, [
      { kind: "reserve", amount: 1 },
    ]);
    expect(
      resolved.cardInstances.find((entry) => entry.instanceId === targetId)
        ?.zone
    ).toBe("mirage");
    expect(
      resolved.players.find((player) => player.id === ALICE)
        ?.reserveNormalCoreCount
    ).toBe(0);
    expect(resolved.mirageSetPlayerIdsThisTurn).toEqual([ALICE]);
    expect(resolved.stackWindow).toBeNull();
    expect(resolved.pendingDeckReveal).toBeNull();
  });

  it("BSES01-R02 [0] 公開由来: リザーブ0でも自分フィールド上の1コアで支払える", () => {
    const { state, targetId, sourceId } = revealR02({
      reserve: 0,
      sourceFieldCores: 1,
    });
    expect(revealedPick(state).candidateCardInstanceIds).toContain(targetId);
    const resolved = resolveEffectSet(state, targetId, [
      { kind: "card", instanceId: sourceId, amount: 1 },
    ]);
    expect(
      resolved.cardInstances.find((entry) => entry.instanceId === targetId)
        ?.zone
    ).toBe("mirage");
    expect(
      resolved.cardInstances.find((entry) => entry.instanceId === sourceId)
        ?.normalCoreCount
    ).toBe(0);
    expect(
      resolved.players.find((player) => player.id === ALICE)
        ?.reserveNormalCoreCount
    ).toBe(0);
  });

  it("BSES01-R02 [0] トラッシュ由来: 自分のデッキ由来効果で置かれた後も同じ有償セットを解決する", () => {
    const target = createCardInstance(R02, {
      instanceId: "r02-trash",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
      cardInstances: [target],
    });
    const pending = materializeDeferredTrashOptionalAdds(
      processMovedToTrashEffects(base, [target.instanceId], getDef, {
        sourcePlayerId: ALICE,
        fromZone: "deck",
      })
    );
    expect(pending.pendingDeckReveal?.origin).toBe("trash");
    expect(revealedPick(pending).candidateCardInstanceIds).toContain(
      target.instanceId
    );
    const resolved = resolveEffectSet(pending, target.instanceId, [
      { kind: "reserve", amount: 1 },
    ]);
    expect(
      resolved.cardInstances.find(
        (entry) => entry.instanceId === target.instanceId
      )?.zone
    ).toBe("mirage");
    expect(
      resolved.players.find((player) => player.id === ALICE)
        ?.reserveNormalCoreCount
    ).toBe(0);
  });

  it("BSES01-R02 [3,4] セット中: 相手のトラッシュ操作は自分の系統86カードを選べない", () => {
    const { state, targetId, protectedId } = revealR02({
      reserve: 1,
      protectedTrashCard: true,
    });
    const afterSet = resolveEffectSet(state, targetId, [
      { kind: "reserve", amount: 1 },
    ]);
    const opponentSource = createCardInstance(OPPONENT_TRASH_SOURCE, {
      instanceId: "opponent-trash-source",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const unprotectedTrashCard = createCardInstance(REVEAL_SOURCE, {
      instanceId: "unprotected-trash-card",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const stateWithOpponent = rebuildContinuousEffectsFromField(
      {
        ...afterSet,
        activePlayerId: BOB,
        cardInstances: [
          ...afterSet.cardInstances,
          opponentSource,
          unprotectedTrashCard,
        ],
      },
      getDef
    );
    const result = executeEffect({
      chainId: "test:bses01-r02-mirage:378",
      state: stateWithOpponent,
      effect: OPPONENT_TRASH_SOURCE.effects![0]!,
      sourceInstanceId: opponentSource.instanceId,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggers,
    });
    expect(
      result.cardInstances.find((entry) => entry.instanceId === protectedId)
        ?.zone
    ).toBe("trash");
    expect(
      result.cardInstances.find(
        (entry) => entry.instanceId === unprotectedTrashCard.instanceId
      )?.zone
    ).toBe("hand");
    expect(result.pendingZoneSelection).toBeNull();
  });
});
