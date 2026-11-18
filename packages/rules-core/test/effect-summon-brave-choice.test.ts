import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";
import { queueEnterFieldCorePlacement } from "../src/zone/enter-field-placement-pending";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  canExecuteSummonSelfNow,
  executeRefSummon,
  executeSoulStateSummon,
} from "../src/effect/structured-summon";
import { buildEffectBraveChoiceScenario } from "../../../apps/playground-web/src/scenario-effect-brave-choice";

const host: CardDefinition = {
  cardNo: "TEST-BRAVE-CHOICE-HOST",
  name: "合体先",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 5,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "deck_reveal",
            revealCount: 3,
            picks: [
              {
                filter: { category: ["brave"] },
                count: 2,
                destination: "field",
              },
            ],
            remainder: "trash",
          },
        },
      ],
    },
  ],
};
const brave: CardDefinition = {
  ...host,
  cardNo: "TEST-BRAVE-CHOICE",
  name: "召喚ブレイヴ",
  printedCategory: "brave",
  braveCondition: { minCost: 5 },
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "summon",
            target: { kind: "self" },
            costModifier: "free",
          },
        },
      ],
    },
  ],
};
const lookup = (id: string) => [host, brave].find((def) => def.cardNo === id);
function setup(zone: "deck" | "hand" = "deck", copies = 1): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 4, deckCount: copies + 1 }],
      cardInstances: [
        createCardInstance(host, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        ...Array.from({ length: copies }, (_, i) =>
          createCardInstance(brave, {
            instanceId: `brave-${i}`,
            ownerPlayerId: "alice",
            zone,
          })
        ),
        createCardInstance(host, {
          instanceId: "remainder",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ],
    }),
    activePlayerId: "alice",
    step: "main",
  };
}
function actions(state: GameState) {
  return getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
  });
}
function choose(state: GameState, hostId: string | null) {
  const action = actions(state).find(
    (a) =>
      a.kind === "resolve_brave_combine_choice" &&
      a.chosenHostInstanceId === hostId
  );
  expect(action, JSON.stringify(state.log)).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: lookup,
  }).state;
}
function reveal(copies = 1) {
  const state = executeEffect({
    state: setup("deck", copies),
    chainId: "test:reveal-brave-choice",
    effect: host.effects![0]!,
    sourceInstanceId: "host",
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
  });
  const action = actions(state).find(
    (a) => a.kind === "resolve_pending_deck_reveal_pick"
  )!;
  return applyLegalAction({
    state,
    action,
    selectedDeckRevealCardIds: Array.from(
      { length: copies },
      (_, i) => `brave-${i}`
    ),
    getCardDefinitionById: lookup,
  }).state;
}
function place(state: GameState) {
  const action = actions(state).find(
    (
      a
    ): a is Extract<LegalAction, { kind: "resolve_pending_multi_placement" }> =>
      a.kind === "resolve_pending_multi_placement"
  );
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: lookup,
    multiPlacementAllocations: action!.targets.map((t) => ({
      destinationInstanceId: t.instanceId,
      placements: t.minimumCoreCount
        ? [{ kind: "reserve_normal" as const, amount: t.minimumCoreCount }]
        : [],
    })),
  }).state;
}
describe("効果召喚ブレイヴの合体選択", () => {
  it("合体不可のBSAZ02-C10は合体を提示せずスピリット状態で召喚する", () => {
    const prohibited = ALL_CARDS.find((card) => card.cardNo === "BSAZ02-C10")!;
    const getCardDefinitionById = (id: string) =>
      id === prohibited.cardNo ? prohibited : lookup(id);
    const base = setup("hand");
    const before = {
      ...base,
      cardInstances: base.cardInstances.map((card) =>
        card.instanceId === "brave-0"
          ? createCardInstance(prohibited, {
              instanceId: "brave-0",
              ownerPlayerId: "alice",
              zone: "hand",
            })
          : card
      ),
    };
    const state = executeRefSummon(
      before,
      "alice",
      {
        kind: "summon",
        target: { kind: "ref", stepId: "selected" },
        costModifier: "free",
      },
      getCardDefinitionById,
      ["brave-0"],
      "host"
    );
    expect(state.pendingBraveCombineChoice).toBeNull();
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find((action) => action.kind === "resolve_pending_multi_placement")!;
    const final = applyLegalAction({
      state,
      action,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      multiPlacementAllocations: [
        {
          destinationInstanceId: "brave-0",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    }).state;
    expect(
      final.cardInstances.find((card) => card.instanceId === "brave-0")
    ).toMatchObject({
      zone: "field",
      attachedToInstanceId: null,
      normalCoreCount: 1,
    });
    expect(final.pendingMultiPlacement).toBeNull();
  });
  it("公開から直接合体するとき任意のコアを置いて合体先へ渡せる", () => {
    const state = choose(reveal(), "host");
    expect(state.pendingMultiPlacement?.targets[0]?.minimumCoreCount).toBe(0);
    const action = actions(state).find(
      (action) => action.kind === "resolve_pending_multi_placement"
    )!;
    const final = applyLegalAction({
      state,
      action,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      multiPlacementAllocations: [
        {
          destinationInstanceId: "brave-0",
          placements: [{ kind: "reserve_normal", amount: 2 }],
        },
      ],
    }).state;
    expect(
      final.cardInstances.find((card) => card.instanceId === "brave-0")
    ).toMatchObject({ attachedToInstanceId: "host", normalCoreCount: 0 });
    expect(
      final.cardInstances.find((card) => card.instanceId === "host")
        ?.normalCoreCount
    ).toBe(3);
    expect(final.players[0]!.reserveNormalCoreCount).toBe(2);
    expect(final.pendingMultiPlacement).toBeNull();
    expect(final.pendingDeckReveal).toBeNull();
  });
  it("直接合体できる自己召喚は維持コア不足でも発揮可能", () => {
    const expensiveBrave: CardDefinition = {
      ...brave,
      levelDefs: [{ level: 1, requiredCores: 10, bp: 5000 }],
    };
    expect(
      canExecuteSummonSelfNow({
        state: setup("hand"),
        sourceInstanceId: "brave-0",
        target: { kind: "self", zone: "hand" },
        costModifier: "free",
        getCardDefinitionById: (id) =>
          id === brave.cardNo ? expensiveBrave : lookup(id),
      })
    ).toBe(true);
  });
  it("直前に参照した対象を召喚するときも合体先を選べる", () => {
    const state = executeRefSummon(
      setup("hand"),
      "alice",
      {
        kind: "summon",
        target: { kind: "ref", stepId: "selected" },
        costModifier: "free",
      },
      lookup,
      ["brave-0"],
      "host"
    );
    expect(
      place(choose(state, "host")).cardInstances.find(
        (c) => c.instanceId === "brave-0"
      )?.attachedToInstanceId
    ).toBe("host");
  });
  it("魂状態から効果で召喚するときも合体先を選べる", () => {
    const base = setup("hand");
    const before: GameState = {
      ...base,
      cardInstances: base.cardInstances.map((card) =>
        card.instanceId === "brave-0" ? { ...card, zone: "field" } : card
      ),
      players: base.players.map((player) =>
        player.id === "alice"
          ? { ...player, soulStateInstanceIds: ["brave-0"] }
          : player
      ),
    };
    const state = executeSoulStateSummon(
      before,
      "test:soul-brave",
      "alice",
      undefined,
      "free",
      "host",
      lookup,
      ["brave-0"]
    );
    const final = place(choose(state, "host"));
    expect(
      final.cardInstances.find((c) => c.instanceId === "brave-0")
        ?.attachedToInstanceId
    ).toBe("host");
    expect(final.players[0]!.soulStateInstanceIds).toEqual([]);
  });
  it("メタナイトの公開から宝剣ギャラクシアを召喚する", () => {
    const getCardDefinitionById = (id: string) =>
      ALL_CARDS.find((card) => card.cardNo === id);
    const getRegisteredTriggeredEffectActions = buildTriggeredEffectLookup([
      ...ALL_CARDS,
    ]);
    let state = buildEffectBraveChoiceScenario([...ALL_CARDS]);
    for (const id of ["brave-deck-0", "brave-deck-1"]) {
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById,
      }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
      state = applyLegalAction({
        state,
        action,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        selectedDeckRevealCardIds: [id],
        ...(id === "brave-deck-0"
          ? { paymentSources: [{ kind: "reserve" as const, amount: 1 }] }
          : {}),
      }).state;
    }
    expect(
      state.pendingBraveCombineChoice,
      JSON.stringify({
        reveal: state.pendingDeckReveal,
        mp: state.pendingMultiPlacement?.targets,
        cards: state.cardInstances.map((c) => ({
          id: c.instanceId,
          zone: c.zone,
        })),
        log: state.log,
      })
    ).toMatchObject({
      braveInstanceId: "brave-deck-0",
      hostCandidateInstanceIds: ["brave-host"],
    });
    const available = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    });
    expect(available.map((a) => a.kind)).toContain(
      "resolve_brave_combine_choice"
    );
    state = applyLegalAction({
      state,
      action: available.find(
        (a) =>
          a.kind === "resolve_brave_combine_choice" &&
          a.chosenHostInstanceId === "brave-host"
      )!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;
    state = applyLegalAction({
      state,
      action: getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById,
      }).find((action) => action.kind === "resolve_pending_multi_placement")!,
      multiPlacementAllocations: [],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(
      state.pendingTriggeredEffects,
      JSON.stringify(state.log)
    ).toHaveLength(1);
  });
  it("維持コアが不足していても直接合体を選べる", () => {
    const before = setup("hand");
    const entered = {
      ...before,
      cardInstances: before.cardInstances.map((card) =>
        card.instanceId === "brave-0"
          ? { ...card, zone: "field" as const, minimumRequiredCores: 10 }
          : card
      ),
    };
    const pending = queueEnterFieldCorePlacement({
      state: entered,
      beforeState: before,
      instanceId: "brave-0",
      getCardDefinitionById: lookup,
      eventKind: "summon",
    });
    expect(pending.pendingBraveCombineChoice?.spiritStateAffordable).toBe(
      false
    );
    expect(
      actions(pending).every(
        (action) =>
          action.kind === "resolve_brave_combine_choice" &&
          action.chosenHostInstanceId !== null
      )
    ).toBe(true);
    expect(
      place(choose(pending, "host")).cardInstances.find(
        (card) => card.instanceId === "brave-0"
      )?.attachedToInstanceId
    ).toBe("host");
  });
  it("合体先がない召喚と召喚以外の場入りはコア配置へ進む", () => {
    for (const eventKind of ["summon", "put", "place", null] as const) {
      const before = setup("hand");
      const entered = {
        ...before,
        cardInstances: before.cardInstances
          .filter(
            (card) => eventKind !== "summon" || card.instanceId !== "host"
          )
          .map((card) =>
            card.instanceId === "brave-0"
              ? { ...card, zone: "field" as const }
              : card
          ),
      };
      const pending = queueEnterFieldCorePlacement({
        state: entered,
        beforeState: before,
        instanceId: "brave-0",
        getCardDefinitionById: lookup,
        eventKind,
      });
      expect(pending.pendingBraveCombineChoice).toBeNull();
      expect(
        place(pending).cardInstances.find(
          (card) => card.instanceId === "brave-0"
        )
      ).toMatchObject({
        zone: "field",
        normalCoreCount: 1,
        attachedToInstanceId: null,
      });
    }
  });
  it("同時召喚の合体先が埋まり維持不能になった後続ブレイヴで入力待ちを残さない", () => {
    const before = setup("hand", 2);
    let state = {
      ...before,
      cardInstances: before.cardInstances.map((card) =>
        card.instanceId.startsWith("brave-")
          ? { ...card, zone: "field" as const, minimumRequiredCores: 10 }
          : card
      ),
    };
    for (const instanceId of ["brave-0", "brave-1"])
      state = queueEnterFieldCorePlacement({
        state,
        beforeState: before,
        instanceId,
        getCardDefinitionById: lookup,
        eventKind: "summon",
      });
    const final = place(choose(state, "host"));
    expect(
      final.cardInstances.find((card) => card.instanceId === "brave-1")?.zone
    ).toBe("trash");
    expect(final.pendingMultiPlacement).toBeNull();
    expect(final.pendingBraveCombineChoice).toBeNull();
  });
  it("公開から直接合体し、残札処理まで完走する", () => {
    const pending = reveal();
    expect(pending.pendingBraveCombineChoice?.braveInstanceId).toBe("brave-0");
    const final = place(choose(pending, "host"));
    expect(
      final.cardInstances.find((c) => c.instanceId === "brave-0")
    ).toMatchObject({
      zone: "field",
      attachedToInstanceId: "host",
      normalCoreCount: 0,
    });
    expect(
      final.cardInstances.find((c) => c.instanceId === "remainder")?.zone
    ).toBe("trash");
    expect(final.pendingDeckReveal).toBeNull();
    expect(final.pendingMultiPlacement).toBeNull();
  });
  it("公開から合体しない選択後にコアを配置できる", () => {
    const final = place(choose(reveal(), null));
    expect(
      final.cardInstances.find((c) => c.instanceId === "brave-0")
    ).toMatchObject({
      zone: "field",
      attachedToInstanceId: null,
      normalCoreCount: 1,
    });
    expect(
      final.cardInstances.find((c) => c.instanceId === "remainder")?.zone
    ).toBe("trash");
    expect(final.pendingBraveCombineChoice).toBeNull();
    expect(final.pendingMultiPlacement).toBeNull();
  });
  it("同時召喚の1体目で合体先を使った後、2体目の維持コアと残札を処理する", () => {
    const final = place(choose(reveal(2), "host"));
    expect(
      final.cardInstances.find((c) => c.instanceId === "brave-0")
        ?.attachedToInstanceId
    ).toBe("host");
    expect(
      final.cardInstances.find((c) => c.instanceId === "brave-1")
    ).toMatchObject({
      zone: "field",
      attachedToInstanceId: null,
      normalCoreCount: 1,
    });
    expect(
      final.cardInstances.find((c) => c.instanceId === "remainder")?.zone
    ).toBe("trash");
  });
  it("自身の効果で手札から召喚するときも合体を選べる", () => {
    const state = executeEffect({
      state: setup("hand"),
      chainId: "test:self-brave-choice",
      effect: brave.effects![0]!,
      sourceInstanceId: "brave-0",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
    });
    const final = place(choose(state, "host"));
    expect(
      final.cardInstances.find((c) => c.instanceId === "brave-0")
        ?.attachedToInstanceId
    ).toBe("host");
    expect(final.pendingMultiPlacement).toBeNull();
  });
});
