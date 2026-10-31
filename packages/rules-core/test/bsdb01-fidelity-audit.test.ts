import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  getAvailableTriggeredEffectSourceChoices,
  getEffectiveBp,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  synthesizeBackFaceDefinition,
  type Effect,
  type GameState,
} from "../src";

const defs = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const tx = defs.get("BSDB01-TX01(A)")!;
defs.set("BSDB01-TX01(B)", synthesizeBackFaceDefinition(tx, tx.backFace!));
const card = (no: string) => defs.get(`BSDB01-${no}`)!;
const getDef = (id: string) => defs.get(id);
const lookups = {
  getRegisteredFieldCardEffectActions: () => undefined,
  getRegisteredBurstActions: () => undefined,
  getHandWrittenEffectResolver: () => undefined,
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
    ...defs.values(),
  ]),
  getRegisteredBattleImmediateEffectActions: buildBattleImmediateEffectLookup([
    ...defs.values(),
  ]),
};
function instance(
  no: string,
  id: string,
  owner = "alice",
  zone: "field" | "deck" | "hand" | "trash" = "field",
  cores = 3
) {
  return createCardInstance(card(no), {
    instanceId: id,
    ownerPlayerId: owner,
    zone,
    normalCoreCount: zone === "field" ? cores : 0,
  });
}
function setup(
  no: string,
  count = 0,
  extras: GameState["cardInstances"] = []
): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        instance(no, "source"),
        ...Array.from({ length: 8 }, (_, i) =>
          instance("C05", `deck-${i}`, "alice", "deck")
        ),
        ...extras,
      ],
      playerOverrides: [{ countValue: count, deckCount: 8, handCount: 0 }, {}],
    }),
    activePlayerId: "alice",
    turnNumber: 3,
    step: "attack",
    window: "none",
  };
}
function run(state: GameState, effect: Effect, source = "source", index = 0) {
  return executeEffect({
    chainId: "test:bsdb01-fidelity-audit:75",
    state,
    effect,
    sourceInstanceId: source,
    effectIndex: index,
    actingPlayerId: "alice",
    ...lookups,
  });
}
function optional(state: GameState, choice: "execute" | "decline") {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).find(
    (a) =>
      a.kind === "resolve_pending_step_optional_choice" && a.choice === choice
  );
  expect(action, JSON.stringify(state.pendingStepOptionalChoice)).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups }).state;
}
function discard(state: GameState) {
  const pending = state.pendingZoneSelection!;
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).find((a) => a.kind === "resolve_pending_zone_selection");
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    selectedZoneCardIds: state.cardInstances
      .filter((c) => c.zone === "hand" && c.ownerPlayerId === "alice")
      .slice(0, pending.maxCount)
      .map((c) => c.instanceId),
    ...lookups,
  }).state;
}
function rebuild(state: GameState) {
  return rebuildContinuousEffectsFromField(state, getDef);
}

describe("BSDB01 全カード面の原文忠実度監査", () => {
  it("C06: 孫悟空不在ではドローもかめはめ波回収も発揮できない", () => {
    const initial = setup("C06", 0, [
      instance("C09", "kamehameha", "alice", "trash"),
    ]);
    const state = optional(
      run(initial, card("C06").effects[1]!, "source", 1),
      "decline"
    );
    expect(state.players[0]).toMatchObject({
      countValue: 0,
      handCount: 0,
      deckCount: 8,
    });
    expect(
      state.cardInstances.find((c) => c.instanceId === "kamehameha")?.zone
    ).toBe("trash");
    expect(state.pendingStepOptionalChoice).toBeNull();
    expect(state.pendingStepChoice).toBeNull();
    expect(state.pendingZoneSelection).toBeNull();
  });
  it.each(["bean-0", "bean-1"])(
    "C05/C10: 回収は任意の1枚だけ選べ、通常サーチは強制 (%s)",
    (selected) => {
      let initial = setup("C05");
      initial = {
        ...initial,
        cardInstances: [
          initial.cardInstances[0]!,
          instance("C10", "bean-0", "alice", "deck"),
          instance("C10", "bean-1", "alice", "deck"),
          instance("C01", "search", "alice", "deck"),
        ],
        players: initial.players.map((p) =>
          p.id === "alice" ? { ...p, deckCount: 3 } : p
        ),
      };
      let state = optional(run(initial, card("C05").effects[0]!), "execute");
      const pick = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
      expect(pick).toMatchObject({
        candidateCardInstanceIds: ["bean-0", "bean-1"],
        maxPickCount: 1,
        canSkip: true,
      });
      expect(() =>
        applyLegalAction({
          state,
          action: pick,
          selectedDeckRevealCardIds: ["bean-0", "bean-1"],
          ...lookups,
        })
      ).toThrow(/no_duplicate/);
      state = applyLegalAction({
        state,
        action: pick,
        selectedDeckRevealCardIds: [selected],
        ...lookups,
      }).state;
      expect(
        state.cardInstances.find((c) => c.instanceId === selected)?.zone
      ).toBe("hand");
      const search = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
      expect(search).toMatchObject({
        candidateCardInstanceIds: ["search"],
        maxPickCount: 1,
        canSkip: false,
      });
      expect(() =>
        applyLegalAction({
          state,
          action: search,
          selectedDeckRevealCardIds: [],
          ...lookups,
        })
      ).toThrow();
    }
  );
  it("C03: 破壊とドローを両方発揮しても共通のターン1回を一度だけ消費する", () => {
    const effect = card("C03").effects[0]!;
    let state = run(setup("C03", 0, [instance("C06", "nexus", "bob")]), effect);
    state = optional(state, "execute");
    state = optional(state, "execute");
    expect(state.players[0]).toMatchObject({ countValue: 1, handCount: 2 });
    expect(
      state.cardInstances.find((c) => c.instanceId === "nexus")?.zone
    ).toBe("trash");
    expect(
      state.effectUsageRecords.filter((r) =>
        r.effectLabel.includes("nexus-and-draw")
      )
    ).toHaveLength(1);
    expect(run(state, effect).pendingStepOptionalChoice).toBeNull();
  });
  it("C03: 両方辞退した場合は後のアタックでも使用できる", () => {
    const effect = card("C03").effects[0]!;
    let state = optional(
      optional(run(setup("C03"), effect), "decline"),
      "decline"
    );
    expect(state.effectUsageRecords).toHaveLength(0);
    state = optional(run(state, effect), "decline");
    expect(state.pendingStepOptionalChoice?.stepIndex).toBe(2);
  });
  it("C01/CX01: 対象不在の任意破壊も発揮でき、破壊効果監視を誘発する", () => {
    const initial = setup("C01", 0, [instance("CX01", "buddy")]);
    initial.cardInstances[0]!.underCards = [
      { cardInstanceId: "buddy", role: "advent_source" },
    ];
    let state = optional(run(initial, card("C01").effects[0]!), "decline");
    state = optional(state, "execute");
    expect(
      state.pendingTriggeredEffects.filter(
        (e) => e.eventKind === "effect_steps_resolved"
      )
    ).toHaveLength(1);
  });
  it("X01/CX01: 同一効果の破壊後判定には、後で解決するCX01のカウント増加を使わない", () => {
    const initial = setup("X01", 8, [
      instance("CX01", "buddy"),
      instance("C05", "victim", "bob"),
    ]);
    initial.cardInstances[0]!.underCards = [
      { cardInstanceId: "buddy", role: "advent_source" },
    ];
    let state = run(initial, card("X01").effects[2]!, "source", 2);
    const target = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (a) => a.kind === "resolve_pending_step_optional_target_selection"
    )!;
    state = applyLegalAction({
      state,
      action: target,
      targetInstanceIds: ["victim"],
      ...lookups,
    }).state;
    const event = state.pendingTriggeredEffects.find(
      (e) => e.eventKind === "effect_steps_resolved"
    );
    expect(
      event,
      JSON.stringify({
        log: state.log,
        pending: Object.entries(state)
          .filter(
            ([k, v]) =>
              k.startsWith("pending") &&
              v !== null &&
              (!Array.isArray(v) || v.length > 0)
          )
          .map(([k]) => k),
      })
    ).toBeDefined();
    expect(state.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(state.pendingStepOptionalChoice).toBeNull();
    const life = state.players[1]!.lifeNormalCoreCount;
    for (let i = 0; i < 12 && state.players[0]!.countValue === 8; i++) {
      const legal = getLegalActions({
        state,
        actingPlayerId: state.stackWindow?.priorityPlayerId ?? "alice",
        ...lookups,
      });
      const action =
        legal.find((a) => a.kind === "pass_stack") ??
        legal.find(
          (a) =>
            a.kind === "select_pending_to_resolve" &&
            a.eventKind === "effect_steps_resolved"
        ) ??
        legal.find(
          (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
        );
      expect(action, JSON.stringify(legal)).toBeDefined();
      state = applyLegalAction({ state, action: action!, ...lookups }).state;
    }
    expect(state.players[0]!.countValue).toBe(9);
    expect(state.players[1]!.lifeNormalCoreCount).toBe(life);
    expect(state.pendingStepOptionalChoice).toBeNull();
  });
  it("CX01: 破壊後の任意選択を完了してから、実際の誘発解決でカウントを1増やす", () => {
    const initial = setup("C01", 0, [instance("CX01", "buddy")]);
    initial.cardInstances[0]!.underCards = [
      { cardInstanceId: "buddy", role: "advent_source" },
    ];
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
        { executionMode: "optional", action: { kind: "draw", count: 1 } },
      ],
    };
    const testId = "TEST-DESTROY-THEN-DRAW";
    defs.set(testId, { ...card("C01"), cardNo: testId, effects: [effect] });
    initial.cardInstances[0]!.definitionId = testId;
    let state = run(initial, effect);
    expect(
      state.pendingTriggeredEffects.filter(
        (e) => e.eventKind === "effect_steps_resolved"
      )
    ).toHaveLength(0);
    state = optional(state, "decline");
    expect(
      state.pendingTriggeredEffects.filter(
        (e) => e.eventKind === "effect_steps_resolved"
      )
    ).toHaveLength(1);
    for (let i = 0; i < 12 && state.players[0]!.countValue === 0; i++) {
      const player = state.stackWindow?.priorityPlayerId ?? "alice";
      const legal = getLegalActions({
        state,
        actingPlayerId: player,
        ...lookups,
      });
      const action =
        legal.find((a) => a.kind === "pass_stack") ??
        legal.find(
          (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
        );
      expect(action, JSON.stringify(legal)).toBeDefined();
      state = applyLegalAction({ state, action: action!, ...lookups }).state;
    }
    expect(state.players[0]!.countValue).toBe(1);
  });
  it("CX01: 同一ターンの別々の破壊効果には各1回応答し、後段の同名制限を先頭誘発へ誤適用しない", () => {
    // 原文は一行内で「破壊効果を発揮したとき、カウント+1する。また、…
    // 〔ターンに1回:同名〕ボイドからコア…」と二つの誘発を列挙する。前者には
    // 回数制限がないため、別々の破壊効果の解決ごとにカウントを増やせる。
    const destroyEffect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
      ],
    };
    const destroySourceId = "TEST-BSDB01-CX01-DESTROY";
    defs.set(destroySourceId, {
      ...card("C01"),
      cardNo: destroySourceId,
      effects: [destroyEffect],
    });
    const initial = setup("C01", 0, [
      instance("CX01", "buddy"),
      instance("C01", "second-source"),
      instance("C05", "first-victim", "bob"),
      instance("C05", "second-victim", "bob"),
    ]);
    initial.cardInstances = initial.cardInstances.map((cardInstance) => {
      if (
        cardInstance.instanceId === "source" ||
        cardInstance.instanceId === "second-source"
      )
        return { ...cardInstance, definitionId: destroySourceId };
      return cardInstance;
    });
    initial.cardInstances[0]!.underCards = [
      { cardInstanceId: "buddy", role: "advent_source" },
    ];

    const destroyAndResolveCx01 = (before: GameState, sourceId: string) => {
      let current = run(before, destroyEffect, sourceId);
      // 破壊 action の完了で積まれた effect_steps_resolved を、通常の
      // stack pass → source-backed resolve 経路で解決する。
      for (let guard = 0; guard < 24; guard++) {
        const actingPlayerId = current.stackWindow?.priorityPlayerId ?? "alice";
        const actions = getLegalActions({
          state: current,
          actingPlayerId,
          ...lookups,
        });
        const action =
          actions.find((candidate) => candidate.kind === "pass_stack") ??
          actions.find(
            (candidate) =>
              candidate.kind === "resolve_pending_step_optional_choice" &&
              candidate.choice === "decline"
          ) ??
          actions.find(
            (candidate) =>
              candidate.kind === "resolve_pending_triggered_effect" &&
              candidate.sourceInstanceId === "buddy" &&
              candidate.sourceDefinitionId === "BSDB01-CX01" &&
              candidate.registrationIndex !== undefined
          );
        if (!action) break;
        current = applyLegalAction({
          state: current,
          action,
          ...lookups,
        }).state;
        if (
          current.effectUsageRecords.filter(
            (record) =>
              record.sourceInstanceId === "buddy" &&
              record.effectLabel === "effect:0"
          ).length > 0
        )
          throw new Error("CX01 effects[0] must not consume a usageLimit");
        // 先頭のカウント増加だけで止めず、実離脱で発生する後段の任意効果も完走する。
      }
      expect(current.pendingStepOptionalChoice).toBeNull();
      expect(current.stackWindow).toBeNull();
      return current;
    };

    let state = destroyAndResolveCx01(initial, "source");
    expect(state.players[0]!.countValue).toBe(1);
    state = destroyAndResolveCx01(state, "second-source");
    expect(state.players[0]!.countValue).toBe(2);
  });
  const boosts = [
    ["C01", 2, 3000],
    ["C02", 2, 4000],
    ["C03", 7, 10000],
    ["C04", 5, 6000],
    ["M01", 5, 7000],
    ["R01", 5, 10000],
    ["R02", 5, 8000],
    ["TX01(A)", 10, 9000],
    ["TX01(B)", 14, 20000],
    ["X01", 9, 17000],
    ["X02", 7, 8000],
  ] as const;
  it.each(boosts)(
    "%s: OC%s の前後で印字BP+%sを反映し、カウント低下で解除",
    (no, min, bonus) => {
      const def = card(no);
      for (const count of [min - 1, min, min + 1, min - 1]) {
        const state = rebuild(setup(no, count));
        const source = state.cardInstances.find(
          (c) => c.instanceId === "source"
        )!;
        const level = def.levelDefs.filter((l) => l.requiredCores <= 3).at(-1)!;
        const gokuAura = no === "X01" ? count * 1000 : 0;
        expect(getEffectiveBp(state, source, def, getDef)).toBe(
          level.bp + gokuAura + (count >= min ? bonus : 0)
        );
      }
    }
  );
  it.each(["C01", "C02", "C03", "C04"])("%s: 契約煌臨として登録する", (no) => {
    expect(card(no).adventData?.adventVariant).toBe("contract");
  });
  it("C01: カウント→任意ドロー→個体ターン1回の破壊を一つの効果として順に解決", () => {
    const effect = card("C01").effects[0]!;
    const initial = setup("C01", 0, [
      instance("C05", "victim", "bob"),
      instance("C01", "other"),
    ]);
    let state = run(initial, effect);
    expect(state.players[0].countValue).toBe(2);
    state = optional(state, "decline");
    expect(state.pendingStepOptionalChoice?.stepIndex).toBe(2);
    state = optional(state, "execute");
    expect(
      state.cardInstances.find((c) => c.instanceId === "victim")?.zone
    ).toBe("trash");
    state = optional(run(state, effect), "decline");
    expect(state.pendingStepOptionalChoice).toBeNull();
    state = optional(run(state, effect, "other"), "decline");
    expect(state.pendingStepOptionalChoice?.stepIndex).toBe(2);
  });
  it("C02: OC破壊失敗時のカウント増加は強制で、同名別個体は使用可能", () => {
    const effect = card("C02").effects[1]!;
    expect(effect.executionMode ?? "mandatory").toBe("mandatory");
    const state = run(setup("C02", 2), effect, "source", 1);
    expect(state.players[0].countValue).toBe(3);
    expect(effect.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
  });
  it("C03: ネクサス不在でもドロー単独を選べ、カウント増加は毎回行う", () => {
    const effect = card("C03").effects[0]!;
    let state = optional(run(setup("C03"), effect), "decline");
    state = optional(state, "execute");
    expect(state.players[0]).toMatchObject({
      countValue: 1,
      deckCount: 6,
      handCount: 2,
    });
    state = run(state, effect);
    expect(state.players[0].countValue).toBe(2);
    expect(state.pendingStepOptionalChoice).toBeNull();
  });
  it("C04: 破壊を断ってもカウントを増やせる", () => {
    const effect = card("C04").effects[0]!;
    let state = run(
      setup("C04", 0, [instance("C05", "victim", "bob")]),
      effect
    );
    state = optional(state, "decline");
    state = optional(state, "execute");
    expect(state.players[0].countValue).toBe(2);
    expect(
      state.cardInstances.find((c) => c.instanceId === "victim")
        ?.pendingLeaveKind
    ).toBeNull();
  });
  it("C08: カウントとドローを別々に辞退でき、ドロー後だけ破棄する", () => {
    const effect = card("C08").effects[1]!;
    const initial = setup("C08", 0, [instance("CX01", "buddy")]);
    let state = optional(run(initial, effect, "source", 1), "decline");
    state = discard(optional(state, "execute"));
    expect(state.players[0]).toMatchObject({
      countValue: 0,
      handCount: 1,
      deckCount: 6,
    });
    state = optional(run(initial, effect, "source", 1), "execute");
    state = optional(state, "decline");
    expect(state.players[0]).toMatchObject({
      countValue: 2,
      handCount: 0,
      deckCount: 8,
    });
    expect(state.pendingZoneSelection).toBeNull();
  });
  it("C09: フィールドのマジックは破壊せず破棄する", () => {
    const state = executeEffect({
      chainId: "test:bsdb01-fidelity-audit:560",
      state: setup("C09", 0, [instance("C10", "magic", "bob")]),
      effect: card("C09").effects[1]!,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      effectIndex: 1,
      choiceIndex: 1,
      ...lookups,
    });
    const target = flushPendingLeaves(state, getDef).cardInstances.find(
      (c) => c.instanceId === "magic"
    )!;
    expect(target.zone, JSON.stringify(state.log)).toBe("trash");
    expect(target.pendingLeaveKind).toBeNull();
    expect(
      state.pendingLeaveEntities.some(
        (e) => e.instanceId === "magic" && e.kind === "destroy"
      )
    ).toBe(false);
  });
  it.each([false, true])(
    "CX01: 破壊対象の有無=%sでも破壊効果1発揮につき1回だけカウント増加を誘発",
    (hasTarget) => {
      const initial = setup("C01", 0, [
        instance("CX01", "buddy"),
        ...(hasTarget ? [instance("C05", "victim", "bob")] : []),
      ]);
      initial.cardInstances[0].underCards = [
        { cardInstanceId: "buddy", role: "advent_source" },
      ];
      const effect: Effect = {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
        ],
      };
      const after = run(initial, effect);
      const pending = after.pendingTriggeredEffects.filter(
        (e) => e.eventKind === "effect_steps_resolved"
      );
      expect(pending).toHaveLength(1);
      const choices = getAvailableTriggeredEffectSourceChoices({
        state: after,
        pendingEffect: pending[0]!,
        ...lookups,
      });
      expect(
        choices.some(
          (c) =>
            c.sourceCard.instanceId === "buddy" &&
            c.actionRegistration.effectIndex === 0
        )
      ).toBe(true);
      expect(
        run(after, card("CX01").effects[0]!, "buddy").players[0].countValue
      ).toBe(1);
    }
  );
  it("CX01: 破壊以外の効果と辞退した破壊stepではカウント効果を誘発しない", () => {
    const initial = setup("C01", 0, [instance("CX01", "buddy")]);
    initial.cardInstances[0].underCards = [
      { cardInstanceId: "buddy", role: "advent_source" },
    ];
    let state = run(initial, {
      timing: { kind: "activated", mode: "flash" },
      steps: [{ action: { kind: "draw", count: 1 } }],
    });
    expect(
      state.pendingTriggeredEffects.filter(
        (e) => e.eventKind === "effect_steps_resolved"
      )
    ).toHaveLength(0);
    state = optional(run(initial, card("C01").effects[0]!), "decline");
    state = optional(state, "decline");
    expect(
      state.pendingTriggeredEffects.filter(
        (e) => e.eventKind === "effect_steps_resolved"
      )
    ).toHaveLength(0);
  });
  it("TX01(A): OC条件のカウント10で攻撃中だけ継続し、アタック時効果を追加しない", () => {
    let initial = setup("TX01(A)", 10);
    expect(
      rebuild(initial).activeContinuousEffects.some(
        (e) => e.modifierTag === "unblockable"
      )
    ).toBe(false);
    initial.battleEntities = [
      {
        entityId: "attacker",
        memberInstanceIds: ["source"],
        resolvedBp: 15000,
        resolvedSymbols: ["red", "blue"],
        attackState: "attacking",
      },
    ];
    let state = rebuild(initial);
    expect(
      state.activeContinuousEffects.some((e) => e.modifierTag === "unblockable")
    ).toBe(true);
    initial = {
      ...initial,
      players: initial.players.map((p) =>
        p.id === "alice" ? { ...p, countValue: 9 } : p
      ),
    };
    state = rebuild(initial);
    expect(
      state.activeContinuousEffects.some((e) => e.modifierTag === "unblockable")
    ).toBe(false);
  });
});
