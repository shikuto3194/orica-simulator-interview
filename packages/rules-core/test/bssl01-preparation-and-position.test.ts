import { describe, expect, it } from "vitest";
import { BSSL01_CARDS } from "../../card-data/src/cards/BSSL01";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  applyFieldPositions,
  buildTriggeredEffectLookup,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import type { Effect } from "../src/dsl-types";
import { executeAdvent } from "../src/mechanics/advent-system";
import { executeEffect } from "../src/effect/effect-interpreter";
import { moveCardZone } from "../src/core/core-system";

const card = (suffix: string) =>
  BSSL01_CARDS.find((c) => c.cardNo === `BSSL01-${suffix}`)!;
const getDef = (id: string) => BSSL01_CARDS.find((c) => c.cardNo === id);
const triggers = buildTriggeredEffectLookup(BSSL01_CARDS);
const instance = (
  suffix: string,
  id: string,
  zone: "field" | "hand" | "trash" | "deck" = "field"
) =>
  createCardInstance(card(suffix), {
    instanceId: id,
    ownerPlayerId: "alice",
    zone,
    normalCoreCount: zone === "field" ? 3 : 0,
  });
function setup(role: "spirit" | "soul" | "advent-source" = "spirit") {
  const host = instance("CX01", "host");
  if (role !== "spirit") host.normalCoreCount = 0;
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      host,
      instance("X02", "x02", "hand"),
      instance("C01", "hand-player", "hand"),
      instance("C01", "trash-player", "trash"),
      instance("C01", "unselected", "trash"),
      instance("M01", "other", "hand"),
      instance("M01", "draw", "deck"),
    ],
    playerOverrides: [
      {
        countValue: 7,
        handCount: 3,
        deckCount: 1,
        reserveNormalCoreCount: 5,
        soulCoreLocation: { kind: "reserve" },
        contractCardNo: "BSSL01-CX01",
        soulStateInstanceIds: role === "soul" ? ["host"] : [],
      },
      {},
    ],
  });
  if (role === "advent-source")
    state.cardInstances.push({
      ...instance("X01", "upper"),
      underCards: [{ cardInstanceId: "host", role: "advent_source" }],
    });
  return { ...state, step: "attack" as const };
}
function prepare(state: GameState) {
  return executeAdvent(
    state,
    "alice",
    {
      adventCardInstanceId: "x02",
      targetInstanceId: "host",
      adventData: card("X02").adventData!,
      isContractAdvent: true,
    },
    getDef
  );
}
function select(state: GameState, ids: string[], lookup = getDef) {
  const options = {
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggers,
  };
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...options,
  }).find((a) => a.kind === "resolve_pending_zone_selection");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    selectedZoneCardIds: ids,
    ...options,
  }).state;
}

describe("BSSL01-X02 煌臨前の追加", () => {
  it.each(["spirit", "soul", "advent-source"] as const)(
    "%sへの煌臨は、手札にいる間に0枚または手札/トラッシュ混在を選ぶ",
    (role) => {
      for (const chosen of [[], ["hand-player", "trash-player"]]) {
        const pending = prepare(setup(role));
        expect(pending.pendingZoneSelection?.candidateCardInstanceIds).toEqual([
          "hand-player",
          "trash-player",
          "unselected",
        ]);
        expect(
          pending.cardInstances.find((c) => c.instanceId === "x02")!.zone
        ).toBe("hand");
        expect(pending.players[0]!.soulCoreLocation).toEqual({
          kind: "reserve",
        });
        const after = select(pending, chosen);
        const x02 = after.cardInstances.find((c) => c.instanceId === "x02")!;
        expect(x02.zone).toBe("field");
        expect(x02.underCards.map((c) => c.cardInstanceId)).toEqual(
          expect.arrayContaining(["host", ...chosen])
        );
        expect(x02.underCards).toHaveLength(1 + chosen.length);
        expect(
          after.cardInstances.find((c) => c.instanceId === "unselected")!.zone
        ).toBe("trash");
        expect(
          after.cardInstances.find((c) => c.instanceId === "other")!.zone
        ).toBe("hand");
        expect(after.players[0]!.soulCoreLocation).toEqual({
          kind: "card",
          instanceId: "x02",
        });
        expect(after.pendingZoneSelection).toBeNull();
      }
    }
  );
  it("追加先が離れたら追加・ソウルコア移動・煌臨をしない", () => {
    const pending = prepare(setup());
    const after = select(moveCardZone(pending, "host", "trash"), [
      "hand-player",
    ]);
    expect(
      after.cardInstances.find((c) => c.instanceId === "hand-player")!.zone
    ).toBe("hand");
    expect(after.cardInstances.find((c) => c.instanceId === "x02")!.zone).toBe(
      "hand"
    );
    expect(after.players[0]!.soulCoreLocation).toEqual({ kind: "reserve" });
  });
  it("効果による煌臨も追加選択を挟み、その後に元効果のドローへ戻る", () => {
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "advent",
            target: {
              kind: "filter",
              player: "self",
              zone: "hand",
              filter: { cardName: { exact: card("X02").name } },
              count: 1,
            },
          },
        },
        {
          connector: "conditional_result",
          action: { kind: "draw", player: "self", count: 1 },
        },
      ],
    };
    const def: CardDefinition = { ...card("CX01"), effects: [effect] };
    const lookup = (id: string) => (id === def.cardNo ? def : getDef(id));
    for (const role of ["spirit", "soul"] as const)
      for (const chosen of [[], ["hand-player", "trash-player"]]) {
        const pending = executeEffect({
          chainId: "test:bssl01-preparation-and-position:175",
          state: setup(role),
          effect,
          sourceInstanceId: "host",
          actingPlayerId: "alice",
          getCardDefinitionById: lookup,
          getRegisteredTriggeredEffectActions: triggers,
          targetInstanceIds: ["x02"],
        });
        expect(pending.players[0]!.deckCount).toBe(1);
        expect(pending.pendingZoneSelection?.adventPreparation).toBeDefined();
        let after = select(pending, chosen, lookup);
        if (role === "soul") {
          expect(after.pendingCoreDistribution).not.toBeNull();
          expect(after.players[0]!.deckCount).toBe(1);
          const action = getLegalActions({
            state: after,
            actingPlayerId: "alice",
            getCardDefinitionById: lookup,
          }).find((a) => a.kind === "resolve_pending_core_distribution");
          expect(action).toBeDefined();
          after = applyLegalAction({
            state: after,
            action: action!,
            coreDistributionAllocations: { x02: 1 },
            coreDistributionSourceAllocations: { reserve: 1 },
            getCardDefinitionById: lookup,
            getRegisteredTriggeredEffectActions: triggers,
          }).state;
        }
        expect(
          after.cardInstances.find((c) => c.instanceId === "x02")!.zone
        ).toBe("field");
        expect(after.players[0]!.deckCount).toBe(0);
        expect(
          after.cardInstances.find((c) => c.instanceId === "draw")!.zone
        ).toBe("hand");
      }
  });
});

describe("BSSL01-M03 右隣への配置を対価にする", () => {
  function board(
    own: "recovered" | "exhausted" | "heavily_exhausted",
    host: typeof own
  ) {
    const state = setup();
    state.cardInstances[0]!.exhaustState = host;
    state.cardInstances.push({
      ...instance("M03", "kaisel"),
      exhaustState: own,
    });
    state.battleEntities = [
      {
        entityId: "attacker",
        memberInstanceIds: ["host"],
        resolvedBp: 3000,
        resolvedSymbols: ["purple"],
        attackState: "attacking",
      },
    ];
    state.activeAttack = {
      attackId: "battle",
      primaryEntityId: "attacker",
      participantEntityIds: ["attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [],
      symbolResolutionOrder: [],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    return state;
  }
  const run = (state: GameState) =>
    executeEffect({
      chainId: "test:bssl01-preparation-and-position:251",
      state,
      effect: card("M03").effects![1]!,
      sourceInstanceId: "kaisel",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggers,
    });
  it.each(["recovered", "exhausted", "heavily_exhausted"] as const)(
    "参照先%sに合わせ、元から同じ状態でも配置対価が成立する",
    (targetState) => {
      for (const from of [
        "recovered",
        "exhausted",
        "heavily_exhausted",
      ] as const) {
        const after = run(board(from, targetState));
        const kaisel = after.cardInstances.find(
          (c) => c.instanceId === "kaisel"
        )!;
        expect(kaisel.exhaustState).toBe(targetState);
        expect(kaisel.fieldPosition).toEqual({
          anchorInstanceId: "host",
          side: "right",
        });
        expect(
          after.activeContinuousEffects.some(
            (ce) => ce.modifierTag === "battle_cost_gate_block"
          )
        ).toBe(true);
        const sorted = applyFieldPositions([
          kaisel,
          instance("C01", "brave-host"),
          after.cardInstances[0]!,
        ]);
        expect(sorted.map((c) => c.instanceId)).toEqual([
          "brave-host",
          "host",
          "kaisel",
        ]);
        expect(
          moveCardZone(after, "host", "trash").cardInstances.find(
            (c) => c.instanceId === "kaisel"
          )!.fieldPosition
        ).toBeUndefined();
      }
    }
  );
  it("参照先がいなければブロック対価を課さない", () => {
    const before = board("recovered", "exhausted");
    const after = run(moveCardZone(before, "host", "trash"));
    expect(
      after.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "battle_cost_gate_block"
      )
    ).toBe(false);
  });
  it("状態変更が防がれたら配置とブロック対価も成立しない", () => {
    const effect: Effect = {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "effect_resistance",
            target: { kind: "self" },
            resistsOutcome: "exhaust",
            source: "all",
            duration: { scope: "turn" },
          },
        },
      ],
    };
    const protectedState = executeEffect({
      chainId: "test:bssl01-preparation-and-position:323",
      state: board("recovered", "exhausted"),
      effect,
      sourceInstanceId: "kaisel",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggers,
    });
    const after = run(protectedState);
    const kaisel = after.cardInstances.find((c) => c.instanceId === "kaisel")!;
    expect(kaisel.exhaustState).toBe("recovered");
    expect(kaisel.fieldPosition).toBeUndefined();
    expect(
      after.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "battle_cost_gate_block"
      )
    ).toBe(false);
  });
});
