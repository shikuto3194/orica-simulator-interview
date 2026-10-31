import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type PlaceNexusLegalAction,
} from "../src";

const ALICE = "alice";
const BOB = "bob";

const PERMISSION_NEXUS: CardDefinition = {
  cardNo: "TEST-PLACE-PERMISSION-NEXUS",
  name: "Place Permission Nexus",
  printedCategory: "nexus",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  keywordTags: [],
  levelDefs: [{ level: 1, requiredCores: 0 }],
  symbols: ["red"],
  effects: [
    {
      applicability: { zone: "hand" },
      timing: { kind: "activated", mode: "flash" },
      steps: [],
    },
    {
      timing: { kind: "card_event", event: "place", sourceEffectIndex: 0 },
      steps: [{ action: { kind: "noop" } }],
    },
  ],
};

const DEFINITIONS = [PERMISSION_NEXUS];
const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  DEFINITIONS.find((definition) => definition.cardNo === id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(DEFINITIONS);
const getRegisteredBurstActions = buildBurstEffectLookup(DEFINITIONS);

function makePlacePermissionAction(): PlaceNexusLegalAction {
  return {
    kind: "place_nexus",
    actionId: "place:test-nexus:permission",
    can: true,
    reason: "test_place_permission",
    actingPlayerId: ALICE,
    sourceInstanceId: "test-nexus",
    sourceDefinitionId: PERMISSION_NEXUS.cardNo,
    sourceCardNo: PERMISSION_NEXUS.cardNo,
    targetMode: "none",
    requiredTargetCount: 0,
    targetEffectFilterTags: ["general"],
    candidateTargetInstanceIds: [],
    availableChosenLifeCoreKinds: [],
    requiresChosenLifeCoreKind: false,
    reducedCost: 0,
    additionalCost: 0,
    finalCost: 0,
    totalReduction: 0,
    availableReserveCoreAmount: 0,
    availableOnBoardCoreSources: [],
    availableSoulCoreOnlySources: [],
    enterFieldCorePlacementRule: "none",
    maximumEnterFieldCoreCount: 0,
    minimumEnterFieldCoreCount: 0,
    requiresEnterFieldCorePlacements: false,
    placePermissionEffectIndex: 0,
  };
}

describe("place permission sourceEffectIndex plumbing", () => {
  it("placePermissionEffectIndex is preserved on ActiveStack and place triggers", () => {
    const state = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          createCardInstance(PERMISSION_NEXUS, {
            instanceId: "test-nexus",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "hand",
          }),
        ],
      }),
      activePlayerId: ALICE,
      step: "attack" as const,
    };

    const afterDeclare = applyLegalAction({
      state,
      action: makePlacePermissionAction(),
      paymentSources: [],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;

    expect(afterDeclare.stackWindow?.pendingStackAction?.actionKind).toBe(
      "place_nexus"
    );
    expect(
      afterDeclare.stackWindow?.pendingStackAction?.sourceEffectIndex
    ).toBe(0);

    const pass = afterDeclare.stackWindow?.priorityPlayerId
      ? {
          kind: "pass_stack" as const,
          actionId: "pass:test",
          can: true as const,
          reason: "test_pass",
          actingPlayerId: afterDeclare.stackWindow.priorityPlayerId,
        }
      : undefined;
    expect(pass).toBeDefined();
    const afterPass = applyLegalAction({
      state: afterDeclare,
      action: pass!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;

    const placement = getLegalActions({
      state: afterPass,
      actingPlayerId: afterPass.pendingEnterFieldPlacement!.actingPlayerId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).find(
      (action) => action.kind === "resolve_pending_enter_field_placement"
    );
    expect(placement).toBeDefined();
    const afterPlacement = applyLegalAction({
      state: afterPass,
      action: placement!,
      enterFieldCorePlacements: [],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;

    expect(
      afterPlacement.pendingTriggeredEffects.some(
        (pending) =>
          pending.eventKind === "place" &&
          pending.relatedInstanceId === "test-nexus" &&
          pending.sourceEffectIndex === 0
      )
    ).toBe(true);
  });
});
