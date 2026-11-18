import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  getEffectiveSymbols,
  getLegalActions,
  recomputeAndRebuildContinuousEffects,
  type GameState,
} from "../src/runtime";
import { getBlockDeclarationBlockReason } from "../src/battle/battle-availability";

const getDef = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const card = (no: string, id: string, cores: number, owner = "alice") =>
  createCardInstance(getDef(no)!, {
    instanceId: id,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
  });

function board(late: boolean, immune: boolean): GameState {
  const target = card("BSTH04-X03", "attacker", 1);
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        card("BSTH04-XX01", "eiki", 4),
        ...(late ? [] : [target]),
        card(immune ? "BSTH04-R01" : "BSTH01-C01", "blocker", 1, "bob"),
      ],
    }),
    activePlayerId: "alice",
    step: "attack",
    window: "none",
  };
  state = recomputeAndRebuildContinuousEffects(state, getDef);
  if (late) {
    state = recomputeAndRebuildContinuousEffects(
      { ...state, cardInstances: [...state.cardInstances, target] },
      getDef
    );
  }
  return {
    ...state,
    window: "declare_block",
    activeAttack: {
      attackId: "eiki-attack",
      primaryEntityId: "attacking-unit",
      participantEntityIds: ["attacking-unit"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "attacking-unit", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["attacking-unit"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    },
    battleEntities: [
      {
        entityId: "attacking-unit",
        memberInstanceIds: ["attacker"],
        resolvedBp: 7000,
        resolvedSymbols: ["yellow", "purple"],
        attackState: "attacking",
      },
    ],
  };
}

describe("映姫の導域は後から出た対象もブロックされない", () => {
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    "後入り=%s・ブロッカー耐性=%sでもブロック候補を出さない",
    (late, immune) => {
      const state = board(late!, immune!);
      const attacker = state.cardInstances.find(
        (c) => c.instanceId === "attacker"
      )!;
      expect(
        getEffectiveSymbols(
          state,
          attacker,
          getDef(attacker.definitionId)!,
          getDef
        )
      ).toEqual(["yellow", "purple"]);
      expect(
        getBlockDeclarationBlockReason({
          state,
          actingPlayerId: "bob",
          sourceInstanceId: "blocker",
          participantEntityId: "attacking-unit",
          getCardDefinitionById: getDef,
        })
      ).toBe("attacker_unblockable");
      expect(
        getLegalActions({
          state,
          actingPlayerId: "bob",
          getCardDefinitionById: getDef,
        }).filter((a) => a.kind === "block")
      ).toHaveLength(0);
    }
  );

  it.each(["level", "leave", "target"])(
    "%s の条件が外れたらブロック可能に戻る",
    (change) => {
      const base = board(true, true);
      const state = recomputeAndRebuildContinuousEffects(
        {
          ...base,
          cardInstances: base.cardInstances.map((c) => {
            if (c.instanceId === "eiki" && change === "level")
              return { ...c, normalCoreCount: 3 };
            if (c.instanceId === "eiki" && change === "leave")
              return { ...c, zone: "trash" as const };
            if (c.instanceId === "attacker" && change === "target")
              return { ...c, definitionId: "BSTH04-C01" };
            return c;
          }),
        },
        getDef
      );
      expect(
        getLegalActions({
          state,
          actingPlayerId: "bob",
          getCardDefinitionById: getDef,
        }).filter((a) => a.kind === "block")
      ).toHaveLength(1);
    }
  );

  it("『ブロックされない相手をブロックできる』明示効果だけは例外になる", () => {
    const base = board(true, true);
    const state: GameState = {
      ...base,
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        {
          effectId: "explicit-block-unblockable",
          sourceInstanceId: "blocker",
          sourceDefinitionId: "BSTH04-R01",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: base.turnNumber,
          createdAtAttackId: null,
          modifierTag: "block_unblockable",
          targetInstanceId: "blocker",
        },
      ],
    };
    expect(
      getLegalActions({
        state,
        actingPlayerId: "bob",
        getCardDefinitionById: getDef,
      }).filter((a) => a.kind === "block")
    ).toHaveLength(1);
  });
});
