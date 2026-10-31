import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  getLegalActions,
  createEmptyGameState,
  createCardInstance,
  buildTriggeredEffectLookup,
  queuePendingReactionsFromTriggerEvents,
  executeEffect,
  type CardDefinition,
  type Effect,
  type EffectStep,
  type ApplyLegalActionOptions,
  type LegalAction,
} from "../src";
import {
  isRetriggerCE,
  executeMatchingRetriggers,
} from "../src/effect/retrigger-system";

function card(cardNo: string, effects: Effect[] = []): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    keywordTags: [],
    textLines: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects,
  };
}
const placement: EffectStep = {
  action: {
    kind: "core_distribute",
    from: { kind: "reserve", player: "self" },
    to: {
      kind: "filter",
      player: "self",
      filter: { category: ["spirit"] },
      count: "all",
    },
    amount: "all",
    mode: "player_choice",
    minTotal: 1,
  },
};
const count: EffectStep = {
  action: { kind: "count_increase", player: "self", amount: 10 },
};

function fixture(
  source: CardDefinition,
  watchers: CardDefinition[] = [],
  handSource = false,
  pick = card("PICK")
) {
  const filler = card("FILLER");
  const defs = [source, ...watchers, pick, filler];
  const lookups = {
    getCardDefinitionById: (id: string) => defs.find((d) => d.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredBurstActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredMagicActions: () => [],
  };
  let state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      {
        handCount: handSource ? 2 : 1,
        deckCount: 3,
        reserveNormalCoreCount: 6,
      },
      {},
    ],
    cardInstances: [
      ...[source, ...watchers].map((d) =>
        createCardInstance(d, {
          instanceId: d.cardNo,
          ownerPlayerId: "alice",
          zone: handSource && d === source ? "hand" : "field",
          normalCoreCount: handSource && d === source ? 0 : 1,
        })
      ),
      createCardInstance(pick, {
        instanceId: "pick",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      ...["deck1", "deck2", "deck3"].map((instanceId) =>
        createCardInstance(filler, {
          instanceId,
          ownerPlayerId: "alice",
          zone: "deck",
        })
      ),
    ],
  });
  state = { ...state, step: "main", turnNumber: 3 };
  const actions = () =>
    ["alice", "bob"].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...lookups })
    );
  const act = (
    predicate: (a: LegalAction) => boolean,
    input: Partial<ApplyLegalActionOptions> = {}
  ) => {
    const available = actions();
    const action = available.find(predicate);
    expect(action, JSON.stringify(available)).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      ...lookups,
      ...input,
    }).state;
  };
  const pass = () => {
    while (state.stackWindow) act((a) => a.kind === "pass_stack");
  };
  return {
    get state() {
      return state;
    },
    set state(value) {
      state = value;
    },
    lookups,
    act,
    pass,
    resolve(id: string, input: Partial<ApplyLegalActionOptions> = {}) {
      act(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === id,
        input
      );
      pass();
    },
    summonEvent(chainId: string) {
      state = queuePendingReactionsFromTriggerEvents(
        state,
        [
          {
            actingPlayerId: "alice",
            eventKind: "summon",
            source: "action_resolution",
            chainId,
            attackId: null,
            relatedPlayerId: "alice",
            relatedInstanceId: source.cardNo,
            amount: null,
          },
        ],
        undefined,
        lookups
      );
    },
    abort() {
      // 実際の保存・復元を挟んでもスケジューラの進行を保持する。
      state = JSON.parse(JSON.stringify(state));
      act(
        (a) =>
          a.kind ===
          (state.pendingMultiPlacement
            ? "abort_pending_multi_placement"
            : "abort_pending_core_distribution")
      );
    },
  };
}

describe("配置中止で観測・確定済み履歴・呼出し元の後処理を巻き戻さない", () => {
  it("未確定召喚を中止したカードのゾーン寿命CEは元に戻す", () => {
    const pick = card("PICK", [
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            ...count,
            retrigger: {
              event: "attack",
              triggerPlayer: "self",
              maxCount: 1,
              duration: { scope: "while_in_trash" },
            },
          },
        ],
      },
    ]);
    const source = card("SOURCE", [
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "trash",
                filter: { cardName: { exact: "PICK" } },
                count: 1,
              },
              costModifier: "free",
            },
          },
        ],
      },
    ]);
    const f = fixture(source, [], false, pick);
    f.state = {
      ...f.state,
      players: f.state.players.map((p) =>
        p.id === "alice" ? { ...p, handCount: 0, trashCount: 1 } : p
      ),
      cardInstances: f.state.cardInstances.map((c) =>
        c.instanceId === "pick" ? { ...c, zone: "trash" } : c
      ),
    };
    f.state = executeEffect({
      state: f.state,
      chainId: "register-trash",
      effect: pick.effects![0]!,
      sourceInstanceId: "pick",
      actingPlayerId: "alice",
      ...f.lookups,
    });
    expect(f.state.activeContinuousEffects.filter(isRetriggerCE)).toHaveLength(
      1
    );
    f.summonEvent("summon-source");
    f.resolve("SOURCE", { targetInstanceIds: ["pick"] });
    expect(f.state.pendingMultiPlacement).not.toBeNull();
    expect(f.state.activeContinuousEffects.filter(isRetriggerCE)).toHaveLength(
      0
    );
    f.state = JSON.parse(JSON.stringify(f.state));
    f.act((a) => a.kind === "abort_pending_multi_placement");
    expect(
      f.state.cardInstances.find((c) => c.instanceId === "pick")?.zone
    ).toBe("trash");
    f.state = executeMatchingRetriggers({
      state: f.state,
      event: "attack",
      triggerCard: f.state.cardInstances.find(
        (c) => c.instanceId === "SOURCE"
      )!,
      triggerCardDefinition: source,
      ...f.lookups,
    });
    expect(f.state.players[0]!.countValue).toBe(10);
    expect(f.state.activeContinuousEffects.filter(isRetriggerCE)).toHaveLength(
      0
    );
  });

  it.each(["core", "multi", "stone", "brave"] as const)(
    "確定済み前段の疲労で失効したCEを%s中止で復活させない",
    (kind) => {
      const source = card("SOURCE", [
        {
          timing: { kind: "card_event", event: "summon" },
          steps: [
            { action: { kind: "exhaust", target: { kind: "self" } } },
            kind === "core"
              ? placement
              : kind === "stone"
                ? {
                    action: {
                      kind: "rebirth",
                      maxCount: 5,
                      retainCores: 0,
                      postRebirthChoice: {
                        kind: "brave_combine_or_core",
                        coreCount: 1,
                      },
                    },
                  }
                : {
                    action: {
                      kind: "summon",
                      target: {
                        kind: "from_zone",
                        zone: "hand",
                        filter: { cardName: { exact: "PICK" } },
                        count: 1,
                      },
                      costModifier: "free",
                    },
                  },
          ],
        },
      ]);
      if (kind === "stone") {
        source.isDoubleSided = true;
        source.backFace = {
          ...card("SOURCE_back"),
          printedCategory: "brave",
          effects: [],
        };
      }
      const pick = card("PICK");
      if (kind === "brave") {
        pick.printedCategory = "brave";
        pick.braveCondition = { minCost: 0 };
      }
      const f = fixture(source, [], false, pick);
      f.state = executeEffect({
        state: f.state,
        chainId: "register-until-exhaust",
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "bp_modify",
                target: { kind: "self" },
                amount: 1000,
                duration: { scope: "turn", untilEvents: ["exhaust"] },
              },
            },
          ],
        },
        sourceInstanceId: "SOURCE",
        actingPlayerId: "alice",
        ...f.lookups,
      });
      expect(f.state.activeContinuousEffects).toHaveLength(1);
      f.summonEvent("summon-source");
      f.resolve(
        "SOURCE",
        kind === "multi" || kind === "brave"
          ? { targetInstanceIds: ["pick"] }
          : {}
      );
      expect(f.state.activeContinuousEffects).toHaveLength(0);
      if (kind === "stone" || kind === "brave") {
        f.state = JSON.parse(JSON.stringify(f.state));
        f.act(
          (a) =>
            a.kind === "resolve_brave_combine_choice" &&
            a.chosenHostInstanceId === null
        );
      }
      f.abort();
      expect(
        f.state.cardInstances.find((c) => c.instanceId === "SOURCE")
          ?.exhaustState
      ).toBe("exhausted");
      expect(f.state.activeContinuousEffects).toHaveLength(0);
    }
  );
  it("確定済みドローの観測を数え、2回目だけ発揮する", () => {
    const source = card("SOURCE", [
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [{ action: { kind: "draw", count: 1 } }, placement],
      },
    ]);
    const watch = card("WATCH", [
      {
        timing: { kind: "game_event", event: "after_draw", player: "self" },
        occurrenceGate: { duration: "turn", targetCount: 2 },
        steps: [count],
      },
    ]);
    const f = fixture(source, [watch]);
    for (let i = 1; i <= 3; i++) {
      f.summonEvent(`summon-${i}`);
      f.resolve("SOURCE");
      f.abort();
      if (i === 2) f.resolve("WATCH");
      expect(f.state.players[0]!.countValue).toBe(i === 1 ? 0 : 10);
      expect(f.state.pendingTriggeredEffects).toHaveLength(0);
    }
    expect(f.state.players[0]!.handCount).toBe(4);
    expect(f.state.effectOccurrenceRecords.some((r) => r.count === 3)).toBe(
      true
    );
  });

  it("前段で確定した召喚の履歴を残し、カード使用後を1回解決する", () => {
    const source = card("SOURCE", [
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "hand",
                filter: { cardName: { exact: "PICK" } },
                count: 1,
              },
              costModifier: "free",
            },
          },
          placement,
        ],
      },
    ]);
    const watch = card("WATCH", [
      {
        timing: {
          kind: "game_event",
          event: "card_used",
          player: "self",
          triggerFilter: { cardName: { exact: "PICK" } },
        },
        steps: [count],
      },
    ]);
    const f = fixture(source, [watch]);
    f.summonEvent("summon-source");
    f.resolve("SOURCE", { targetInstanceIds: ["pick"] });
    f.act((a) => a.kind === "resolve_pending_multi_placement", {
      multiPlacementAllocations: [
        {
          destinationInstanceId: "pick",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    });
    expect(f.state.pendingCoreDistribution).not.toBeNull();
    f.abort();
    expect(
      f.state.cardInstances.find((c) => c.instanceId === "pick")?.zone
    ).toBe("field");
    expect(
      f.state.turnSummonedCardRefs.some((r) => r.instanceId === "pick")
    ).toBe(true);
    expect(
      f.state.flashCardUsageLog.some((r) => r.cardInstanceId === "pick")
    ).toBe(true);
    f.resolve("WATCH");
    expect(f.state.players[0]!.countValue).toBe(10);
    expect(f.state.pendingTriggeredEffects).toHaveLength(0);
  });

  it("アクセル本文の中止後に使用カードをin_useから待機状態へ移す", () => {
    const source = card("ACCEL");
    source.accelData = {
      timing: "main",
      cost: 0,
      reduction: [],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [{ action: { kind: "draw", count: 1 } }, placement],
        },
      ],
    };
    const f = fixture(source, [card("HOST")], true);
    f.act((a) => a.kind === "use_accel" && a.sourceInstanceId === "ACCEL");
    f.pass();
    expect(f.state.pendingCoreDistribution).not.toBeNull();
    expect(f.state.pendingAccelCleanups).toHaveLength(1);
    f.abort();
    expect(
      f.state.cardInstances.find((c) => c.instanceId === "ACCEL")?.zone
    ).toBe("set_aside");
    expect(f.state.pendingAccelCleanups).toHaveLength(0);
    expect(f.state.players[0]!.handCount).toBe(2);
  });

  it.each([1, 2])(
    "再誘発の残りを再開し、上限%d回の消費を復活させない",
    (maxCount) => {
      const retrigger = {
        event: "attack" as const,
        triggerPlayer: "self" as const,
        maxCount,
        duration: { scope: "turn" as const },
        autoResolveOptional: false,
      };
      const source = card("SOURCE", [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            { ...placement, retrigger },
            { ...count, retrigger },
          ],
        },
      ]);
      const f = fixture(source);
      f.state = executeEffect({
        state: f.state,
        chainId: "register-retrigger",
        effect: source.effects![0]!,
        sourceInstanceId: "SOURCE",
        actingPlayerId: "alice",
        ...f.lookups,
      });
      f.state = { ...f.state, step: "attack" };
      f.act((a) => a.kind === "attack" && a.sourceInstanceId === "SOURCE");
      while (f.state.preDeclarationStackWindow)
        f.act((a) => a.kind === "pass_pre_declaration_stack");
      expect(f.state.pendingCoreDistribution).not.toBeNull();
      expect(f.state.pendingRetriggerContinuations).toHaveLength(1);
      f.abort();
      expect(f.state.players[0]!.countValue).toBe(10);
      expect(f.state.pendingRetriggerContinuations).toHaveLength(0);
      const remaining = f.state.activeContinuousEffects.filter(isRetriggerCE);
      expect(remaining).toHaveLength(maxCount === 1 ? 0 : 2);
      expect(remaining.every((r) => r.retriggerFireCount === 1)).toBe(true);
      // 次のイベントでは残回数分だけ発揮し、消費後のイベントでは再発揮しない。
      for (let occurrence = 2; occurrence <= 3; occurrence++) {
        f.state = executeMatchingRetriggers({
          state: f.state,
          event: "attack",
          triggerCard: f.state.cardInstances.find(
            (c) => c.instanceId === "SOURCE"
          )!,
          triggerCardDefinition: source,
          ...f.lookups,
        });
        if (occurrence <= maxCount) f.abort();
        expect(f.state.pendingCoreDistribution).toBeNull();
        expect(f.state.pendingRetriggerContinuations).toHaveLength(0);
        expect(f.state.players[0]!.countValue).toBe(maxCount * 10);
        expect(
          f.state.activeContinuousEffects.filter(isRetriggerCE)
        ).toHaveLength(0);
      }
    }
  );

  it.each(["trash", "swap"] as const)(
    "チェンジ本文の中止後も%sの後処理を選べる",
    (outcome) => {
      const source = card("CHANGE");
      source.changeData = {
        cost: 0,
        reduction: [],
        swapCondition: { maxCost: 5 },
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [{ action: { kind: "draw", count: 1 } }, placement],
          },
        ],
      };
      const f = fixture(source, [card("HOST")], true);
      f.act((a) => a.kind === "use_change" && a.sourceInstanceId === "CHANGE");
      f.pass();
      expect(f.state.pendingCoreDistribution).not.toBeNull();
      expect(f.state.pendingAccelCleanups).toHaveLength(1);
      f.abort();
      expect(f.state.pendingChangeCleanupChoice).not.toBeNull();
      f.act(
        (a) =>
          a.kind === "resolve_pending_change_cleanup_choice" &&
          a.outcome === outcome,
        outcome === "swap" ? { targetInstanceIds: ["HOST"] } : {}
      );
      expect(
        f.state.cardInstances.find((c) => c.instanceId === "CHANGE")?.zone
      ).toBe(outcome === "swap" ? "field" : "trash");
      expect(
        f.state.cardInstances.find((c) => c.instanceId === "HOST")?.zone
      ).toBe(outcome === "swap" ? "hand" : "field");
      expect(f.state.pendingAccelCleanups).toHaveLength(0);
      expect(f.state.pendingChangeCleanupChoice).toBeNull();
    }
  );
});
