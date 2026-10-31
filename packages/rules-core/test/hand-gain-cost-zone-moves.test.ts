import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  createActionInputDecisionNode,
  executeEffect,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  type Effect,
  type GameState,
  type Zone,
} from "../src";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getCardDefinitionById = (id: string) => definitions.get(id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: () => [],
};
const mirror = getCardDefinitionById("BSTH04-転醒R01(A)")!;

function setup(reserve = 1, zone: Zone = "deck", fieldCores = 0): GameState {
  const cards = [
    ["source", mirror.cardNo, "alice", "field", 0],
    ["tax", "BSRK01-C02", "bob", "field", 1],
    ["first", "BSTH04-C01", "alice", zone, 0],
    ["second", "BSTH04-C03", "alice", zone, 0],
    ["supply", "BSRK01-C02", "alice", "field", fieldCores],
  ] as const;
  return rebuildContinuousEffectsFromField(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: reserve,
            handCount: 0,
            deckCount: zone === "deck" ? 2 : 0,
          },
          {},
        ],
        cardInstances: cards.map(
          ([instanceId, no, ownerPlayerId, cardZone, normalCoreCount]) =>
            createCardInstance(getCardDefinitionById(no)!, {
              instanceId,
              ownerPlayerId,
              zone: cardZone,
              normalCoreCount,
            })
        ),
      }),
      activePlayerId: "alice",
      step: "main",
    },
    getCardDefinitionById
  );
}

function run(state: GameState, effect: Effect = mirror.effects![0]!) {
  return executeEffect({
    chainId: "test:hand-gain-cost-zone-moves:62",
    state,
    effect,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    ...lookups,
  });
}

function choose(
  state: GameState,
  kind: string,
  payload: Partial<Parameters<typeof applyLegalAction>[0]> = {}
) {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).find(
    (a) => a.kind === kind && (!("choice" in a) || a.choice === "execute")
  );
  expect(action, `missing ${kind}`).toBeDefined();
  return applyLegalAction({ state, action: action!, ...payload, ...lookups })
    .state;
}

function zone(state: GameState, id: string) {
  return state.cardInstances.find((card) => card.instanceId === id)?.zone;
}

function selectMirror(state: GameState) {
  state = run(state);
  expect(zone(state, "first")).toBe("trash");
  expect(zone(state, "second")).toBe("trash");
  state = choose(state, "resolve_pending_step_optional_choice");
  return choose(state, "resolve_pending_step_optional_target_selection", {
    targetInstanceIds: ["second"],
  });
}

describe("BSRK01-C02: 汎用ゾーン回収にもプレイヤー対象の対価を要求する", () => {
  it.each(["reserve", "field", "decline", "zero"] as const)(
    "BSTH04-転醒R01(A): 対象選択後のHUD、%s、破棄を再実行せず選択した札だけ回収",
    (mode) => {
      let state = selectMirror(
        setup(
          mode === "zero" || mode === "field" ? 0 : 1,
          "deck",
          mode === "field" ? 1 : 0
        )
      );
      expect(state.pendingCoreSourceAllocation?.requiredTotal).toBe(1);
      expect(state.pendingCoreSourceAllocation?.canDecline).toBe(true);
      expect(zone(state, "second")).toBe("trash");
      state = choose(state, "resolve_core_source_allocation", {
        coreSourceAllocations:
          mode === "reserve"
            ? { reserve: 1 }
            : mode === "field"
              ? { supply: 1 }
              : {},
      });
      const paid = mode === "reserve" || mode === "field";
      expect(zone(state, "first")).toBe("trash");
      expect(zone(state, "second")).toBe(paid ? "hand" : "trash");
      expect(state.players[0]!.handCount).toBe(paid ? 1 : 0);
      expect(state.players[0]!.trashNormalCoreCount).toBe(paid ? 1 : 0);
      expect(state.players[0]!.deckCount).toBe(0);
      expect(state.pendingCoreSourceAllocation).toBeNull();
      expect(state.pendingStepOptionalTargetSelection).toBeNull();
      expect(
        state.log.filter(
          (line) => line === "effect:move_card:deck->trash:2cards"
        )
      ).toHaveLength(1);
    }
  );

  it.each(["trash", "deck", "revealed"] as const)(
    "move_card: %s → 手札は2枚でも対価1回",
    (origin) => {
      let state = run(setup(1, origin), {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: origin, player: "self" },
              to: { zone: "hand" },
              count: 2,
            },
          },
        ],
      });
      expect(state.pendingCoreSourceAllocation?.requiredTotal).toBe(1);
      state = choose(state, "resolve_core_source_allocation", {
        coreSourceAllocations: { reserve: 1 },
      });
      expect(state.players[0]!.handCount).toBe(2);
      expect(state.players[0]!.trashNormalCoreCount).toBe(1);
      expect(state.pendingCoreSourceAllocation).toBeNull();
    }
  );

  it.each(["trash", "deck"] as const)(
    "search_zone: %s の自動確定回収にも対価",
    (origin) => {
      let state = run(setup(1, origin), {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: origin,
              destination: "hand",
              count: 2,
              mandatory: true,
            },
          },
        ],
      });
      expect(state.pendingCoreSourceAllocation?.requiredTotal).toBe(1);
      state = choose(state, "resolve_core_source_allocation", {
        coreSourceAllocations: {},
      });
      expect(state.players[0]!.handCount).toBe(0);
      expect(zone(state, "first")).toBe(origin);
    }
  );

  it("後続の独立した回収へ支払いを流用しない", () => {
    const move = (id: string): Effect["steps"][number] => ({
      action: {
        kind: "move_card",
        from: { zone: "trash", player: "self" },
        to: { zone: "hand" },
        count: 1,
        target: {
          kind: "filter",
          zone: "trash",
          player: "self",
          count: 1,
          filter: {
            cardName: {
              exact: getCardDefinitionById(
                id === "first" ? "BSTH04-C01" : "BSTH04-C03"
              )!.name,
            },
          },
        },
      },
    });
    let state = run(setup(1, "trash"), {
      timing: { kind: "activated", mode: "main" },
      steps: [move("first"), move("second")],
    });
    state = choose(state, "resolve_core_source_allocation", {
      coreSourceAllocations: { reserve: 1 },
    });
    expect(zone(state, "first")).toBe("hand");
    expect(state.pendingCoreSourceAllocation).not.toBeNull();
    state = choose(state, "resolve_core_source_allocation", {
      coreSourceAllocations: {},
    });
    expect(zone(state, "second")).toBe("trash");
  });

  it("支払拒否は回収成功や対象参照を後続へ渡さない", () => {
    let state = run(setup(1, "trash"), {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "recover",
          action: {
            kind: "move_card",
            from: { zone: "trash", player: "self" },
            to: { zone: "hand" },
            count: 1,
            target: {
              kind: "filter",
              zone: "trash",
              player: "self",
              count: 1,
              filter: {
                cardName: { exact: getCardDefinitionById("BSTH04-C03")!.name },
              },
            },
          },
        },
        {
          stepCondition: { kind: "ref_succeeded", stepId: "recover" },
          action: { kind: "draw", player: "self", count: 1 },
        },
      ],
    });
    state = choose(state, "resolve_core_source_allocation", {
      coreSourceAllocations: {},
    });
    expect(zone(state, "second")).toBe("trash");
    expect(state.pendingCoreSourceAllocation).toBeNull();
    expect(state.log.some((line) => line.startsWith("effect:draw:"))).toBe(
      false
    );
  });

  it("ソウルコアでも回収対価を支払える", () => {
    const base = setup(0);
    base.players[0]!.soulCoreLocation = { kind: "reserve" };
    base.players[0]!.reserveSoulCoreCount = 1;
    let state = selectMirror(base);
    state = choose(state, "resolve_core_source_allocation", {
      coreSourceAllocations: {},
      coreSourceSoulCoreInstanceId: "reserve",
    });
    expect(zone(state, "second")).toBe("hand");
    expect(state.players[0]!.soulCoreLocation).toEqual({ kind: "trash" });
    expect(state.players[0]!.trashNormalCoreCount).toBe(0);
  });

  it("コア0の回収選択でAIは実行不能な支払いを提示しない", () => {
    const state = run(setup(0, "trash"), {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "search_zone",
            zone: "trash",
            count: 1,
            destination: "hand",
            mandatory: true,
          },
        },
      ],
    });
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_zone_selection")!;
    const choices = createActionInputDecisionNode(
      state,
      action,
      lookups
    )!.choices;
    expect(choices.length).toBeGreaterThan(0);
    for (const choice of choices) {
      const after = applyLegalAction({
        state,
        action,
        ...choice.applyOptions,
        ...lookups,
      }).state;
      expect(after.players[0]!.handCount).toBe(0);
      expect(after.pendingZoneSelection).toBeNull();
    }
  });

  it.each(["deck", "trash"] as const)(
    "%s の選択モーダル: 支払元選択・拒否・強制枚数は独立",
    (origin) => {
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: origin,
              count: 1,
              destination: "hand",
              mandatory: true,
            },
          },
        ],
      };
      const state = run(setup(0, origin, 1), effect);
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      }).find((a) => a.kind === "resolve_pending_zone_selection")!;
      expect(
        action.kind === "resolve_pending_zone_selection" && action.handGainCost
      ).toBe(1);
      const choices = createActionInputDecisionNode(
        state,
        action,
        lookups
      )?.choices;
      expect(
        choices?.some((c) => c.applyOptions?.selectedZoneCardIds?.length === 0)
      ).toBe(true);
      const paid = choose(state, "resolve_pending_zone_selection", {
        selectedZoneCardIds: ["second"],
        paymentSources: [{ kind: "card", instanceId: "supply", amount: 1 }],
      });
      expect(zone(paid, "second")).toBe("hand");
      expect(paid.players[0]!.trashNormalCoreCount).toBe(1);
      const declined = choose(state, "resolve_pending_zone_selection", {
        selectedZoneCardIds: ["second"],
        paymentSources: [],
      });
      expect(zone(declined, "second")).toBe(origin);
      expect(declined.players[0]!.handCount).toBe(0);
      expect(declined.players[0]!.trashNormalCoreCount).toBe(0);
      expect(declined.pendingZoneSelection).toBeNull();
      const skipped = choose(state, "resolve_pending_zone_selection", {
        selectedZoneCardIds: [],
      });
      expect(skipped.players[0]!.handCount).toBe(0);
    }
  );

  it("手札/トラッシュ混合検索は選んだカードの実ゾーンで課税する", () => {
    const base = setup(1, "trash");
    base.cardInstances.find((c) => c.instanceId === "first")!.zone = "hand";
    base.players[0]!.handCount = 1;
    const state = run(base, {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "search_zone",
            zone: ["hand", "trash"],
            count: 1,
            destination: "hand",
            mandatory: true,
          },
        },
      ],
    });
    const fromHand = choose(state, "resolve_pending_zone_selection", {
      selectedZoneCardIds: ["first"],
    });
    expect(fromHand.players[0]!.reserveNormalCoreCount).toBe(1);
    expect(fromHand.players[0]!.handCount).toBe(1);
    const fromTrash = choose(state, "resolve_pending_zone_selection", {
      selectedZoneCardIds: ["second"],
    });
    expect(fromTrash.players[0]!.reserveNormalCoreCount).toBe(0);
    expect(fromTrash.players[0]!.handCount).toBe(2);
  });

  it.each(["hand", "set_aside"] as const)(
    "BSTH08.5-C24: リザーブ0でもフィールドから払う/%s",
    (destination) => {
      const state = run(setup(0, "trash", 1), {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              count: 1,
              destination: "hand_or_set_aside_choice",
              mandatory: true,
            },
          },
        ],
      });
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      }).find((a) => a.kind === "resolve_pending_zone_selection")!;
      expect(
        action.kind === "resolve_pending_zone_selection" &&
          action.perCardDestinationChoices?.second
      ).toContain("hand");
      const after = choose(state, "resolve_pending_zone_selection", {
        selectedZoneCardIds: ["second"],
        zoneSelectionDestinationByCardId: { second: destination },
        paymentSources:
          destination === "hand"
            ? [{ kind: "card", instanceId: "supply", amount: 1 }]
            : [],
      });
      expect(zone(after, "second")).toBe(destination);
      expect(after.players[0]!.trashNormalCoreCount).toBe(
        destination === "hand" ? 1 : 0
      );
    }
  );

  it.each(["set_aside", "removed_from_game"] as const)(
    "%s から手札への移動はC02の列挙外",
    (origin) => {
      const state = run(setup(1, origin), {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: origin, player: "self" },
              to: { zone: "hand" },
              count: 2,
            },
          },
        ],
      });
      expect(state.pendingCoreSourceAllocation).toBeNull();
      expect(state.players[0]!.handCount).toBe(2);
      expect(state.players[0]!.reserveNormalCoreCount).toBe(1);
    }
  );

  it("プレイヤー耐性は要求を防ぐが、創界石である効果元の耐性は免除理由にならない", () => {
    const base = setup();
    base.activeContinuousEffects.push({
      effectId: "player-immune",
      sourceInstanceId: "supply",
      sourceDefinitionId: "BSRK01-C02",
      actingPlayerId: "alice",
      modifierTag: "player_effect_immunity",
      targetInstanceId: "alice",
      duration: { scope: "this_turn" },
      createdAtTurn: base.turnNumber,
      createdAtAttackId: null,
    });
    const state = selectMirror(base);
    expect(state.pendingCoreSourceAllocation).toBeNull();
    expect(zone(state, "second")).toBe("hand");
    expect(state.players[0]!.reserveNormalCoreCount).toBe(1);
  });
});
