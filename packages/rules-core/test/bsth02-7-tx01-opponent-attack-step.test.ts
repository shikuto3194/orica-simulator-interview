import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  advanceStep,
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "../src";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const tx01 = definitions.find((d) => d.cardNo === "BSTH02.7-TX01(B)")!;
const spirit: CardDefinition = {
  cardNo: "TEST-TX01-TARGET",
  name: "テストスピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const burst: CardDefinition = {
  ...spirit,
  cardNo: "TEST-TX01-BURST",
  name: "テストバースト",
  textLines: ["【バースト：自分のライフ減少後】", "自分は1枚ドローする。"],
  keywordTags: ["burst"],
};
const ultimate: CardDefinition = {
  ...spirit,
  cardNo: "TEST-TX01-ULTIMATE",
  printedCategory: "ultimate",
};
const map = new Map(
  [...definitions, spirit, ultimate, burst].map((d) => [d.cardNo, d])
);
const lookups = {
  getCardDefinitionById: (id: string) => map.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
  getRegisteredFieldCardEffectActions: () => [],
};

function setup(cores = 2, activePlayerId = "bob"): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ handCount: 2 }, { deckCount: 1 }],
      cardInstances: [
        {
          ...createCardInstance(tx01, {
            instanceId: "tx01",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: cores,
          }),
          originalDefinitionId: "BSTH02.7-TX01(A)",
        },
        createCardInstance(spirit, {
          instanceId: "opponent",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(spirit, {
          instanceId: "deck-top",
          ownerPlayerId: "bob",
          zone: "deck",
        }),
        createCardInstance(burst, {
          instanceId: "burst-hand",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(burst, {
          instanceId: "burst-aside",
          ownerPlayerId: "alice",
          zone: "set_aside",
        }),
        createCardInstance(tx01, {
          instanceId: "not-burst",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    }),
    turnNumber: 6,
    activePlayerId,
    step: "main",
    window: "none",
  };
}

function enterAttack(state: GameState): GameState {
  return advanceStep(
    state,
    lookups.getCardDefinitionById,
    lookups.getRegisteredTriggeredEffectActions
  );
}

function resolve(
  initial: GameState,
  options: { returnTarget?: boolean; burstId?: string | null } = {}
): GameState {
  let state = initial;
  for (let i = 0; i < 20; i++) {
    const actions = ["alice", "bob"].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...lookups })
    );
    const action = actions.find((a) => {
      if (!a.can) return false;
      if (a.kind === "resolve_pending_step_optional_choice") {
        const execute =
          a.stepIndex === 0
            ? options.returnTarget !== false &&
              state.pendingStepOptionalChoice?.canExecute !== false
            : options.burstId !== null;
        return a.choice === (execute ? "execute" : "decline");
      }
      return [
        "resolve_pending_triggered_effect",
        "pass_stack",
        "resolve_pending_effect_target",
        "resolve_pending_step_optional_target_selection",
        "resolve_pending_burst_check",
      ].includes(a.kind);
    });
    if (!action) return state;
    const targetInstanceIds =
      (state.pendingEffectTargetSelection?.stepIndex ??
        state.pendingStepOptionalTargetSelection?.stepIndex) === 1
        ? [options.burstId ?? "burst-hand"]
        : ["opponent"];
    if (
      (action.kind === "resolve_pending_effect_target" ||
        action.kind === "resolve_pending_step_optional_target_selection") &&
      (state.pendingEffectTargetSelection?.stepIndex ??
        state.pendingStepOptionalTargetSelection?.stepIndex) === 1
    ) {
      expect(action.candidateTargetInstanceIds).not.toContain("not-burst");
    }
    state = applyLegalAction({
      state,
      action,
      ...lookups,
      ...(action.kind === "resolve_pending_effect_target" ||
      action.kind === "resolve_pending_step_optional_target_selection"
        ? { targetInstanceIds }
        : {}),
    }).state;
  }
  throw new Error("TX01 effect did not finish");
}

describe("BSTH02.7-TX01(B) Lv2 相手のアタックステップ開始時", () => {
  it("相手メイン→アタックでLv2効果をキューに積む", () => {
    const state = enterAttack(setup());
    expect(state.step).toBe("attack");
    expect(state.pendingTriggeredEffects).toEqual([
      expect.objectContaining({
        actingPlayerId: "alice",
        eventKind: "start_step",
      }),
    ]);
  });

  it.each([
    [1, "bob"],
    [2, "alice"],
  ])("コア%s・%sのターンでは誘発しない", (cores, active) => {
    expect(
      enterAttack(setup(cores as number, active as string))
        .pendingTriggeredEffects
    ).toHaveLength(0);
  });

  it.each(["burst-hand", "burst-aside"])(
    "デッキ下へ戻してから%sをセットする",
    (burstId) => {
      const state = resolve(enterAttack(setup()), { burstId });
      expect(
        state.cardInstances
          .filter((c) => c.zone === "deck" && c.ownerPlayerId === "bob")
          .map((c) => c.instanceId)
      ).toEqual(["deck-top", "opponent"]);
      expect(state.setBurstStates).toEqual([
        { playerId: "alice", cardInstanceId: burstId },
      ]);
      expect(
        state.cardInstances.find((c) => c.instanceId === burstId)?.zone
      ).toBe("burst");
      expect(state.players.find((p) => p.id === "alice")?.handCount).toBe(
        burstId === "burst-hand" ? 1 : 2
      );
      expect(state.pendingTriggeredEffects).toHaveLength(0);
    }
  );

  it("アルティメットもデッキ下へ戻せる", () => {
    const initial = setup();
    initial.cardInstances.find(
      (c) => c.instanceId === "opponent"
    )!.definitionId = ultimate.cardNo;
    const state = resolve(enterAttack(initial), { burstId: null });
    expect(
      state.cardInstances.find((c) => c.instanceId === "opponent")?.zone
    ).toBe("deck");
    expect(state.setBurstStates).toHaveLength(0);
  });

  it("戻すことを辞退してもバーストだけセットできる", () => {
    const state = resolve(enterAttack(setup()), { returnTarget: false });
    expect(
      state.cardInstances.find((c) => c.instanceId === "opponent")?.zone
    ).toBe("field");
    expect(state.setBurstStates).toHaveLength(1);
  });

  it("相手に対象がなくてもバーストをセットできる", () => {
    const initial = setup();
    initial.cardInstances = initial.cardInstances.filter(
      (c) => c.instanceId !== "opponent"
    );
    const state = resolve(enterAttack(initial));
    expect(state.setBurstStates).toHaveLength(1);
  });
  it("効果セットは通常セット済みのターンでも置き換えられ、通常セット回数を増やさない", () => {
    const initial = setup();
    initial.burstSetPlayerIdsThisTurn = ["alice"];
    initial.cardInstances.push(
      createCardInstance(burst, {
        instanceId: "old-burst",
        ownerPlayerId: "alice",
        zone: "burst",
      })
    );
    initial.setBurstStates = [
      { playerId: "alice", cardInstanceId: "old-burst" },
    ];
    const state = resolve(enterAttack(initial));
    expect(state.setBurstStates).toEqual([
      { playerId: "alice", cardInstanceId: "burst-hand" },
    ]);
    expect(
      state.cardInstances.find((c) => c.instanceId === "old-burst")?.zone
    ).toBe("trash");
    expect(state.burstSetPlayerIdsThisTurn).toEqual(["alice"]);
  });
});
