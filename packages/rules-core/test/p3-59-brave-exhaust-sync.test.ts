import { describe, it, expect } from "vitest";
import type { CardDefinition, GameState } from "../src/index";
import {
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  applyLegalAction,
  useAttackAsAction,
  useBlockAsAction,
  usePassPreDeclarationStackAsAction,
  confirmAttackDeclarationAsAction,
  confirmBlockDeclarationAsAction,
} from "../src/index";

function createDemoCardDefinition(
  overrides: Partial<CardDefinition> &
    Pick<CardDefinition, "cardNo" | "name" | "printedCategory">
): CardDefinition {
  return {
    cardNo: overrides.cardNo,
    name: overrides.name,
    printedCategory: overrides.printedCategory,
    colors: overrides.colors ?? ["red"],
    cost: overrides.cost ?? 3,
    reductionSymbols: overrides.reductionSymbols ?? [],
    levelDefs: overrides.levelDefs ?? [],
    symbolColors: overrides.symbolColors ?? [],
    textLines: overrides.textLines ?? [],
    keywordTags: overrides.keywordTags ?? [],
    sourceUrls: overrides.sourceUrls ?? [],
    sourceConfidence: overrides.sourceConfidence ?? "C",
  };
}

function createDefinitionLookup(definitions: CardDefinition[]) {
  const definitionMap = new Map(
    definitions.map((definition) => [definition.cardNo, definition])
  );
  return (definitionId: string) => definitionMap.get(definitionId);
}

function createFieldEffectActionRegistrationLookup(
  _record: Record<string, readonly never[]>
) {
  return () => [];
}

function setupCombinedSpiritState() {
  const hostDef = createDemoCardDefinition({
    cardNo: "HOST-001",
    name: "Host Spirit",
    printedCategory: "spirit",
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
  });
  const braveDef = createDemoCardDefinition({
    cardNo: "BRAVE-001",
    name: "Attached Brave",
    printedCategory: "brave",
    levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
    symbolColors: ["white"],
  });
  const opponentDef = createDemoCardDefinition({
    cardNo: "OPP-001",
    name: "Opponent Spirit",
    printedCategory: "spirit",
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    symbolColors: ["blue"],
  });

  const lookup = createDefinitionLookup([hostDef, braveDef, opponentDef]);

  const hostCard = {
    ...createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    }),
    attachedChildrenIds: ["brave-1"],
  };
  const braveCard = {
    ...createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    }),
    attachedToInstanceId: "host-1",
  };
  const opponentCard = createCardInstance(opponentDef, {
    instanceId: "opp-1",
    ownerPlayerId: "bob",
    zone: "field",
    cores: 1,
  });

  return {
    hostDef,
    braveDef,
    opponentDef,
    lookup,
    hostCard,
    braveCard,
    opponentCard,
  };
}

describe("P3-59: brave exhaustState sync on attack/block declaration", () => {
  it("attack declaration exhausts both host and attached brave", () => {
    const { lookup, hostCard, braveCard, opponentCard } =
      setupCombinedSpiritState();

    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [hostCard, braveCard, opponentCard],
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };

    // Alice selects attack action
    const attackAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "attack" && a.sourceInstanceId === "host-1");

    expect(attackAction).toBeDefined();

    // Apply attack → pre-declaration stack
    const tentative = applyLegalAction({
      state,
      action: attackAction!,
      getCardDefinitionById: lookup,
    });

    // Bob passes pre-declaration stack
    const bobPass = getLegalActions({
      state: tentative.state,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "pass_pre_declaration_stack");

    const result = applyLegalAction({
      state: tentative.state,
      action: bobPass!,
      getCardDefinitionById: lookup,
    });

    const host = result.state.cardInstances.find(
      (c) => c.instanceId === "host-1"
    );
    const brave = result.state.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    );

    expect(host?.exhaustState).toBe("exhausted");
    expect(brave?.exhaustState).toBe("exhausted");
  });

  it("block declaration exhausts both blocker host and attached brave", () => {
    const { hostDef, braveDef, opponentDef, lookup } =
      setupCombinedSpiritState();

    // Bob owns combined spirit (blocker), Alice owns attacker
    const attackerCard = createCardInstance(opponentDef, {
      instanceId: "attacker-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const blockerHost = {
      ...createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
      attachedChildrenIds: ["brave-1"],
    };
    const blockerBrave = {
      ...createCardInstance(braveDef, {
        instanceId: "brave-1",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 0,
      }),
      attachedToInstanceId: "host-1",
    };

    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [attackerCard, blockerHost, blockerBrave],
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };

    // fullyDeclareAttack: Alice attacks with attacker-1
    const tentativeAttack = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: lookup,
    });
    const afterAttackPass = usePassPreDeclarationStackAsAction({
      state: tentativeAttack,
      actingPlayerId: "bob",
    });
    const attackResult = confirmAttackDeclarationAsAction(
      afterAttackPass.closedWindow!,
      afterAttackPass.state,
      { getCardDefinitionById: lookup }
    );

    // closeAvailableBattleFlashWindow: open + both pass
    const openAction = getLegalActions({
      state: attackResult.state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "open_battle_flash");
    expect(openAction).toBeDefined();

    const openedState = applyLegalAction({
      state: attackResult.state,
      action: openAction!,
      getCardDefinitionById: lookup,
    }).state;

    const firstPriority =
      openedState.activeAttack?.flashWindowState?.priorityPlayerId ?? "alice";
    const firstPass = getLegalActions({
      state: openedState,
      actingPlayerId: firstPriority,
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "pass_battle_flash");

    const afterFirstPass = applyLegalAction({
      state: openedState,
      action: firstPass!,
      getCardDefinitionById: lookup,
    }).state;

    const secondPriority =
      afterFirstPass.activeAttack?.flashWindowState?.priorityPlayerId;
    let readyForBlock = afterFirstPass;
    if (secondPriority) {
      const secondPass = getLegalActions({
        state: afterFirstPass,
        actingPlayerId: secondPriority,
        getCardDefinitionById: lookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
      }).find((a) => a.kind === "pass_battle_flash");
      readyForBlock = applyLegalAction({
        state: afterFirstPass,
        action: secondPass!,
        getCardDefinitionById: lookup,
      }).state;
    }

    // fullyDeclareBlock: Bob blocks with combined spirit
    const tentativeBlock = useBlockAsAction({
      state: readyForBlock,
      actingPlayerId: "bob",
      sourceInstanceId: "host-1",
      participantEntityId: "battle-entity:attacker-1",
      getCardDefinitionById: lookup,
    });
    const afterBlockPass = usePassPreDeclarationStackAsAction({
      state: tentativeBlock,
      actingPlayerId: "alice",
    });
    const blockResult = confirmBlockDeclarationAsAction(
      afterBlockPass.closedWindow!,
      afterBlockPass.state,
      { getCardDefinitionById: lookup }
    );

    const host = blockResult.state.cardInstances.find(
      (c) => c.instanceId === "host-1"
    );
    const brave = blockResult.state.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    );

    expect(host?.exhaustState).toBe("exhausted");
    expect(brave?.exhaustState).toBe("exhausted");
  });
});
