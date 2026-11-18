import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../src";
import {
  collectGameStateInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  runStateBasedActions,
} from "../src";

const hostDefinition: CardDefinition = {
  cardNo: "TEST-HOST",
  name: "Test Host",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 3,
  reductionSymbols: ["blue"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const braveDefinition: CardDefinition = {
  cardNo: "TEST-BRAVE",
  name: "Test Brave",
  printedCategory: "brave",
  colors: ["blue"],
  cost: 2,
  reductionSymbols: ["blue"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const getDefinition = (id: string): CardDefinition | undefined =>
  id === hostDefinition.cardNo
    ? hostDefinition
    : id === braveDefinition.cardNo
      ? braveDefinition
      : undefined;

describe("brave attachment SSOT invariants", () => {
  it("flags a host-side attached child cache that points at a trash card", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(hostDefinition, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 3,
          attachedChildrenIds: ["brave"],
        }),
        createCardInstance(braveDefinition, {
          instanceId: "brave",
          ownerPlayerId: "alice",
          zone: "trash",
          cores: 0,
          attachedToInstanceId: null,
        }),
      ],
    });

    expect(collectGameStateInvariantIssues(state)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "attached_child_not_on_field" }),
        expect.objectContaining({ code: "attached_child_parent_mismatch" }),
      ])
    );
  });

  it("does not queue core-deficit vanish while an effect-summoned brave waits for direct-combine choice", () => {
    const triggerBeforeState = createEmptyGameState({
      playerIds: ["alice", "bob"],
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(hostDefinition, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 3,
        }),
        createCardInstance(braveDefinition, {
          instanceId: "brave",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
      ],
    });
    const state = {
      ...baseState,
      pendingBraveCombineChoice: {
        pendingId: "bc-test",
        actingPlayerId: "alice",
        braveInstanceId: "brave",
        braveDefinitionId: braveDefinition.cardNo,
        effectSummon: {
          sourceInstanceId: "host",
          sourceDefinitionId: hostDefinition.cardNo,
          triggerBeforeState,
        },
        hostCandidateInstanceIds: ["host"],
        spiritStateAffordable: false,
      },
    };

    const result = runStateBasedActions(state, getDefinition);

    expect(result.checks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "vanish_due_to_core_deficit",
          instanceId: "brave",
        }),
      ])
    );
    expect(result.state.pendingLeaveEntities).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instanceId: "brave", kind: "vanish" }),
      ])
    );
  });
});
