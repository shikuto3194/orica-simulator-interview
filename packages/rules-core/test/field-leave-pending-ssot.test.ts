import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeMoveCard } from "../src/effect/native-move-core-handlers";
import {
  executeBounce,
  executeSendToDeck,
} from "../src/effect/structured-zone-ops";
import { executeRemoveFromGame } from "../src/effect/structured-card-replacement";
import { createStepExecutionContext } from "../src/step-execution-context";
import {
  flushPendingLeaves,
  resolveBraveLeaveChoice,
} from "../src/state-based-actions";
import type {
  BounceAction,
  CardDefinition,
  RemoveFromGameAction,
  SendToDeckAction,
} from "../src/model";
import type { DSL } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);

const FIELD_SPIRIT: CardDefinition = {
  cardNo: "TEST-FIELD-LEAVE-PENDING-SPIRIT",
  name: "テストフィールド離脱スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
} as CardDefinition;

const getDef = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ?? (id === FIELD_SPIRIT.cardNo ? FIELD_SPIRIT : undefined);

function createFieldLeaveState(instanceId = "field-spirit") {
  const spirit = createCardInstance(FIELD_SPIRIT, {
    instanceId,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  return {
    spirit,
    state: createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [spirit],
    }),
  };
}

describe("field-leave pending SSOT", () => {
  it("move_card の field→trash は直接移動せず pendingLeave で非破壊離脱として待機する", () => {
    const spirit = createCardInstance(FIELD_SPIRIT, {
      instanceId: "field-spirit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [spirit],
    });
    const action: DSL.MoveCardAction = {
      kind: "move_card",
      target: { kind: "self" },
      from: { zone: "field", player: "self" },
      to: { zone: "trash" },
      count: 1,
    };

    const queued = executeMoveCard(
      action,
      state,
      ALICE,
      spirit.instanceId,
      getDef,
      createStepExecutionContext(state)
    );

    expect(
      queued.cardInstances.find((c) => c.instanceId === spirit.instanceId)?.zone
    ).toBe("field");
    expect(queued.pendingLeaveEntities).toEqual([
      expect.objectContaining({
        instanceId: spirit.instanceId,
        kind: "bounce",
        leaveDestination: { zone: "trash" },
      }),
    ]);

    const flushed = flushPendingLeaves(queued, getDef);
    expect(
      flushed.cardInstances.find((c) => c.instanceId === spirit.instanceId)
        ?.zone
    ).toBe("trash");
  });

  it("bounce の field→hand は直接移動せず pendingLeave で待機する", () => {
    const { spirit, state } = createFieldLeaveState();
    const action: BounceAction = {
      kind: "bounce",
      target: { player: "self", category: ["spirit"] },
    };

    const queued = executeBounce(
      state,
      ALICE,
      action,
      getDef,
      spirit.instanceId,
      [spirit.instanceId]
    );

    expect(
      queued.cardInstances.find((c) => c.instanceId === spirit.instanceId)?.zone
    ).toBe("field");
    expect(queued.pendingLeaveEntities).toEqual([
      expect.objectContaining({
        instanceId: spirit.instanceId,
        kind: "bounce",
        leaveDestination: { zone: "hand" },
      }),
    ]);
  });

  it("send_to_deck の field→deck は bounce 待機 + deck destination で待機する", () => {
    const { spirit, state } = createFieldLeaveState();
    const action: SendToDeckAction = {
      kind: "send_to_deck",
      target: { player: "self", category: ["spirit"] },
      position: "top",
    };

    const queued = executeSendToDeck(
      state,
      ALICE,
      action,
      getDef,
      spirit.instanceId,
      [spirit.instanceId]
    );

    expect(
      queued.cardInstances.find((c) => c.instanceId === spirit.instanceId)?.zone
    ).toBe("field");
    expect(queued.pendingLeaveEntities).toEqual([
      expect.objectContaining({
        instanceId: spirit.instanceId,
        kind: "bounce",
        leaveDestination: { zone: "deck", position: "top" },
      }),
    ]);
  });

  it("remove_from_game の field→removed_from_game は remove_from_game 待機で待機する", () => {
    const { spirit, state } = createFieldLeaveState();
    const action: RemoveFromGameAction = {
      kind: "remove_from_game",
      target: { player: "self", category: ["spirit"] },
    };

    const queued = executeRemoveFromGame(
      state,
      ALICE,
      action,
      getDef,
      spirit.instanceId,
      [spirit.instanceId]
    );

    expect(
      queued.cardInstances.find((c) => c.instanceId === spirit.instanceId)?.zone
    ).toBe("field");
    expect(queued.pendingLeaveEntities).toEqual([
      expect.objectContaining({
        instanceId: spirit.instanceId,
        kind: "remove_from_game",
      }),
    ]);
  });

  it("move_card の field→deck は合体ブレイヴ選択と契約魂状態選択を pending 経由で出す", () => {
    const contractDef = getDef("BSGE01-CX01")!;
    const braveDef = getDef("BSGE01-C05")!;
    const contract = createCardInstance(contractDef, {
      instanceId: "contract-host",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["contract-brave"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "contract-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
      attachedToInstanceId: contract.instanceId,
    });
    const source = createCardInstance(FIELD_SPIRIT, {
      instanceId: "alice-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [contract, brave, source],
      playerOverrides: [{}, { contractCardNo: contractDef.cardNo }],
    });

    const queued = executeMoveCard(
      {
        kind: "move_card",
        target: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit"] },
          count: 1,
        },
        from: { zone: "field", player: "opponent" },
        to: { zone: "deck", position: "bottom" },
        count: 1,
      },
      state,
      ALICE,
      source.instanceId,
      getDef,
      createStepExecutionContext(state),
      [contract.instanceId]
    );

    expect(queued.pendingLeaveEntities).toEqual([
      expect.objectContaining({
        instanceId: contract.instanceId,
        kind: "bounce",
        leaveDestination: { zone: "deck", position: "bottom" },
      }),
    ]);
    expect(
      queued.pendingLeaveEntities.some(
        (pending) => pending.instanceId === brave.instanceId
      )
    ).toBe(false);

    const awaitingBrave = flushPendingLeaves(queued, getDef);
    expect(awaitingBrave.pendingBraveLeaveChoice).toMatchObject({
      choosingPlayerId: BOB,
      hostInstanceId: contract.instanceId,
      braveInstanceIds: [brave.instanceId],
      leaveKind: "bounce",
      leaveDestination: { zone: "deck", position: "bottom" },
    });
    expect(awaitingBrave.pendingSoulStateReplacement).toMatchObject({
      choosingPlayerId: BOB,
      cardInstanceId: contract.instanceId,
      originalLeaveKind: "bounce",
    });

    const keptBrave = resolveBraveLeaveChoice(
      awaitingBrave,
      "keep",
      {
        reserve: 1,
      },
      getDef
    );
    const awaitingSoul = flushPendingLeaves(keptBrave, getDef);
    expect(awaitingSoul.pendingBraveLeaveChoice).toBeNull();
    expect(awaitingSoul.pendingSoulStateReplacement).toMatchObject({
      choosingPlayerId: BOB,
      cardInstanceId: contract.instanceId,
      originalLeaveKind: "bounce",
    });
  });
});
