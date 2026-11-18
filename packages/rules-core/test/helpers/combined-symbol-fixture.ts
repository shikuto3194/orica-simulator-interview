import { createCardInstance, createEmptyGameState } from "../../src/factories";
import type {
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../../src/model";

export function combinedSymbolFixture(
  category: "spirit" | "ultimate" | "nexus" = "spirit",
  owner = "alice"
) {
  const hostDef: CardDefinition = {
    cardNo: `SYMBOL-HOST-${category}`,
    name: "シンボル監査ホスト",
    printedCategory: category,
    colors: ["red"],
    cost: 5,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    symbolColors: [category === "ultimate" ? "ultimate_symbol" : "red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  const braveDef: CardDefinition = {
    ...hostDef,
    cardNo: "SYMBOL-BRAVE",
    name: "シンボル監査ブレイヴ",
    printedCategory: "brave",
    colors: ["blue"],
    symbolColors: ["blue"],
  };
  const getDef = (id: string) =>
    [hostDef, braveDef].find((d) => d.cardNo === id);
  const host = createCardInstance(hostDef, {
    instanceId: "symbol-host",
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: 1,
    attachedChildrenIds: ["symbol-brave"],
  });
  const brave = createCardInstance(braveDef, {
    instanceId: "symbol-brave",
    ownerPlayerId: owner,
    zone: "field",
    attachedToInstanceId: host.instanceId,
  });
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave],
    }),
    activePlayerId: owner,
    turnNumber: 3,
    step: "main",
  };
  const ce = (overrides: Partial<ContinuousEffect>): ContinuousEffect => ({
    effectId: "symbol-ce",
    sourceInstanceId: host.instanceId,
    sourceDefinitionId: hostDef.cardNo,
    actingPlayerId: owner,
    targetInstanceId: host.instanceId,
    modifierTag: "override_properties",
    duration: { scope: "turn" },
    createdAtTurn: 3,
    createdAtAttackId: null,
    ...overrides,
  });
  return { state, host, brave, hostDef, braveDef, getDef, ce };
}
