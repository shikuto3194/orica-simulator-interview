import { describe, expect, it } from "vitest";
import {
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  resolveDeferredMagicStack,
} from "../src";
import type { ActiveStack, CardDefinition, GameState } from "../src";

const groupedMagic: CardDefinition = {
  cardNo: "P3-109-GROUPED-MAGIC",
  name: "P3-109 grouped magic",
  printedCategory: "magic",
  colors: ["purple"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: ["フラッシュ", "相手のスピリット1体を破壊する。"],
  keywordTags: [],
  effects: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const targetSpirit: CardDefinition = {
  cardNo: "P3-109-TARGET-SPIRIT",
  name: "P3-109 target spirit",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  effects: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = [groupedMagic, targetSpirit];
const defMap = new Map(defs.map((def) => [def.cardNo, def]));
const lookups = {
  getCardDefinitionById: (id: string) => defMap.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  getRegisteredBurstActions: buildBurstEffectLookup(defs),
};

function buildState(targetZone: "field" | "hand"): GameState {
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    cardInstances: [
      createCardInstance(groupedMagic, {
        instanceId: "magic-1",
        ownerPlayerId: "alice",
        zone: "in_use",
      }),
      createCardInstance(targetSpirit, {
        instanceId: "target-1",
        ownerPlayerId: "bob",
        zone: targetZone,
        cores: targetZone === "field" ? 1 : 0,
      }),
    ],
  };
}

function buildStack(options: {
  candidateTargetZones?: readonly ("field" | "hand")[];
  isNullified?: boolean;
}): ActiveStack {
  return {
    stackId: "stack-1",
    actionKind: "magic",
    chainId: "chain-1",
    actingPlayerId: "alice",
    cardInstanceId: "magic-1",
    cardDefinitionId: groupedMagic.cardNo,
    targetInstanceIds: ["target-1"],
    targetEffectFilterTags: [],
    targetGroups: [
      {
        requiredTargetCount: 1,
        ...(options.candidateTargetZones !== undefined
          ? { candidateTargetZones: options.candidateTargetZones }
          : {}),
        candidateTargetInstanceIds: ["target-1"],
      },
    ],
    ...(options.isNullified === true ? { isNullified: true } : {}),
  };
}

describe("P3-109: grouped magic targetGroups resolve-time recheck", () => {
  it("treats an omitted group zone as field and fizzles when the selected target left the field", () => {
    const resolved = resolveDeferredMagicStack({
      state: buildState("hand"),
      activeStack: buildStack({}),
      ...lookups,
    });

    expect(resolved.log).toContain("magic:effect-fizzled:chain-1:target-1");
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "magic-1")?.zone
    ).toBe("trash");
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "target-1")
        ?.zone
    ).toBe("hand");
  });

  it("does not reject an explicitly non-field grouped target zone", () => {
    const resolved = resolveDeferredMagicStack({
      state: buildState("hand"),
      activeStack: buildStack({
        candidateTargetZones: ["hand"],
      }),
      ...lookups,
    });

    expect(
      resolved.log.some((entry) => entry.startsWith("magic:effect-fizzled:"))
    ).toBe(false);
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "magic-1")?.zone
    ).toBe("trash");
  });

  it("skips grouped target recheck when the stack was already nullified", () => {
    const resolved = resolveDeferredMagicStack({
      state: buildState("hand"),
      activeStack: buildStack({ isNullified: true }),
      ...lookups,
    });

    expect(
      resolved.log.some((entry) => entry.startsWith("magic:effect-fizzled:"))
    ).toBe(false);
    expect(resolved.log).toContain("magic:nullified:chain-1:magic-1");
  });
});
