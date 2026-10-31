import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  executeEffect,
  type GameState,
  type LegalAction,
  type CardDefinition,
} from "../src";
import type { HandWrittenBurstPostResolutionPolicyLookup } from "../src/mechanics/burst-system";

const getDef = (id: string) => ALL_CARDS.find((c) => c.cardNo === id);
const lookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
};
const actions = (state: GameState, actingPlayerId = "alice") =>
  getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById: getDef,
    ...lookups,
  });
function apply(
  state: GameState,
  action: LegalAction,
  targetInstanceIds?: string[],
  getHandWrittenBurstPostResolutionPolicy?: HandWrittenBurstPostResolutionPolicyLookup
) {
  return applyLegalAction({
    state,
    action,
    ...(targetInstanceIds ? { targetInstanceIds } : {}),
    ...(getHandWrittenBurstPostResolutionPolicy
      ? { getHandWrittenBurstPostResolutionPolicy }
      : {}),
    getCardDefinitionById: getDef,
    ...lookups,
  }).state;
}
function choose(
  state: GameState,
  predicate: (a: LegalAction) => boolean,
  getHandWrittenBurstPostResolutionPolicy?: HandWrittenBurstPostResolutionPolicyLookup
) {
  const action = [...actions(state), ...actions(state, "bob")].find(predicate);
  expect(action).toBeDefined();
  return apply(
    state,
    action!,
    undefined,
    getHandWrittenBurstPostResolutionPolicy
  );
}
function fixture(): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const make = (
    no: string,
    id: string,
    zone: "field" | "burst" | "deck",
    owner = "alice"
  ) =>
    createCardInstance(getDef(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
      ...(owner === "bob" ? { normalCoreCount: 1 } : {}),
    });
  return {
    ...base,
    step: "main",
    activePlayerId: "bob",
    turnNumber: 3,
    cardInstances: [
      make("BSLH01-CX01", "host", "field"),
      { ...make("BSLH01-C06", "old", "field"), zoneRoleName: "quartz" },
      make("BSLH01-R05", "burst", "burst"),
      make("BSTH01-C02", "target-a", "field", "bob"),
      make("BSTH01-C02", "target-b", "field", "bob"),
      ...Array.from({ length: 5 }, (_, i) =>
        make("BSTH01-C02", `deck-${i}`, "deck")
      ),
    ],
    quartzSetStates: [
      {
        quartzInstanceId: "old",
        hostInstanceId: "host",
        ownerPlayerId: "alice",
        slot: "right",
      },
    ],
    setBurstStates: [{ playerId: "alice", cardInstanceId: "burst" }],
    players: base.players.map((p) => ({
      ...p,
      handCount: 0,
      deckCount: p.id === "alice" ? 5 : 1,
      ...(p.id === "alice"
        ? { soulStateInstanceIds: ["host", "old"], countValue: 0 }
        : {}),
    })),
    pendingBurstChecks: [
      {
        checkId: "r05-check",
        actingPlayerId: "alice",
        eventKind: "effect_activated",
        event: {
          family: "effect_activation",
          actionKind: "summon",
          validationMode: "snapshot_only",
        },
        source: "action_resolution",
        chainId: "test:burst-quartz-placement",
        attackId: null,
        relatedPlayerId: "bob",
        relatedInstanceId: "target-a",
        amount: 1,
        step: "main",
        window: "none",
        resolvedBurstCardInstanceIds: [],
      },
    ],
  };
}
function startBurst(
  state = fixture(),
  getHandWrittenBurstPostResolutionPolicy?: HandWrittenBurstPostResolutionPolicyLookup
) {
  let current = choose(
    state,
    (a) => a.kind === "resolve_pending_burst_check",
    getHandWrittenBurstPostResolutionPolicy
  );
  expect(current.stackWindow?.burstWindowKind).toBe("activation");
  current = choose(
    current,
    (a) => a.kind === "pass_stack",
    getHandWrittenBurstPostResolutionPolicy
  );
  expect(current.stackWindow?.burstWindowKind).toBe("effect_declaration");
  current = choose(
    current,
    (a) => a.kind === "pass_stack",
    getHandWrittenBurstPostResolutionPolicy
  );
  expect(current.pendingStepChoice).not.toBeNull();
  return choose(
    current,
    (a) => a.kind === "resolve_pending_step_choice" && a.choiceIndex === 1,
    getHandWrittenBurstPostResolutionPolicy
  );
}
function finish(state: GameState) {
  let current = state;
  for (let i = 0; i < 20; i++) {
    const all = [...actions(current), ...actions(current, "bob")];
    const input =
      all.find(
        (a) => a.kind === "resolve_pending_step_optional_target_selection"
      ) ??
      all.find((a) => a.kind === "resolve_pending_effect_target_selection") ??
      all.find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice ===
            (current.pendingStepOptionalChoice?.sourceInstanceId === "burst"
              ? "execute"
              : "decline")
      ) ??
      all.find((a) => a.kind === "skip_optional_triggered_effect") ??
      all.find((a) => a.kind === "resolve_pending_triggered_effect") ??
      all.find((a) => a.kind === "pass_stack");
    if (!input) return current;
    current = apply(
      current,
      input,
      input.kind === "resolve_pending_effect_target_selection" ||
        input.kind === "resolve_pending_step_optional_target_selection"
        ? ["target-b"]
        : undefined
    );
  }
  throw new Error("burst continuation did not drain");
}

describe("Telegram 629905086: BSLH01-R05の本番バースト→スタック→位置→継続", () => {
  it.each(["center", "right"] as const)(
    "未占有%sを選ぶまで交換も後続破壊も進まない",
    (slot) => {
      const pending = startBurst();
      expect(pending.pendingStepChoice?.choices.map((c) => c.label)).toEqual([
        "クォーツセット(左)",
        "クォーツセット(中央)",
        "クォーツセット(右)",
        expect.stringContaining("クォーツ入れ替え"),
      ]);
      expect(pending.quartzSetStates).toEqual(fixture().quartzSetStates);
      expect(
        pending.cardInstances.find((c) => c.instanceId === "target-a")?.zone
      ).toBe("field");
      expect(
        pending.cardInstances.find((c) => c.instanceId === "target-b")?.zone
      ).toBe("field");
      expect(pending.pendingEffectTargetSelection).toBeNull();
      const index = pending.pendingStepChoice!.choices.find(
        (c) =>
          c.label ===
          (slot === "center" ? "クォーツセット(中央)" : "クォーツセット(右)")
      )!.choiceIndex;
      const after = choose(
        pending,
        (a) =>
          a.kind === "resolve_pending_step_choice" && a.choiceIndex === index
      );
      expect(
        after.quartzSetStates.find((q) => q.quartzInstanceId === "burst")?.slot
      ).toBe(slot);
      const completed = finish(after);
      expect(
        completed.cardInstances.find((c) => c.instanceId === "target-a")?.zone
      ).toBe("field");
      expect(
        completed.cardInstances.find((c) => c.instanceId === "target-b")?.zone
      ).toBe("trash");
      expect(
        completed.log.filter(
          (l) => l === `effect:quartz_set:burst->host:${slot}`
        )
      ).toHaveLength(1);
      // R05の2枚と、そのセットで誘発したENIGMAの1枚を各一度だけ解決。
      expect(completed.players[0]!.handCount).toBe(3);
      expect(completed.players[0]!.countValue).toBe(2);
      expect(completed.pendingStepChoice).toBeNull();
    }
  );
  it("占有右を選んで旧クォーツをtrashへ送り、後続効果を一度だけ解決する", () => {
    const pending = startBurst();
    expect(pending.pendingStepChoice).not.toBeNull();
    const index = pending.pendingStepChoice!.choices.find((c) =>
      c.label.includes("入れ替え")
    )!.choiceIndex;
    const action = actions(pending).find(
      (a) => a.kind === "resolve_pending_step_choice" && a.choiceIndex === index
    )!;
    const placed = apply(pending, action);
    expect(
      placed.cardInstances.find((c) => c.instanceId === "old")
    ).toMatchObject({ zone: "trash", zoneRoleName: "spirit-card" });
    expect(placed.players[0]!.soulStateInstanceIds).toEqual(["host", "burst"]);
    expect(placed.players[0]!.handCount).toBe(0);
    expect(placed.quartzSetStates).toEqual([
      {
        quartzInstanceId: "burst",
        hostInstanceId: "host",
        ownerPlayerId: "alice",
        slot: "right",
      },
    ]);
    const completed = finish(placed);
    expect(completed.players[0]!.handCount).toBe(3);
    expect(completed.players[0]!.countValue).toBe(2);
    expect(
      completed.log.filter((l) => l === "effect:quartz_set:burst->host:right")
    ).toHaveLength(1);
    expect(
      completed.log.filter(
        (l) => l.startsWith("effect:destroy:") && l.includes("target-b")
      )
    ).toHaveLength(1);
    expect(() => apply(completed, action)).toThrow();
  });
  it("正規APIのstay_in_burstポリシーを位置pendingへ保持し、旧クォーツをburstへ送る", () => {
    const stayPolicy: HandWrittenBurstPostResolutionPolicyLookup = () => ({
      kind: "stay_in_burst",
    });
    const pending = startBurst(fixture(), stayPolicy);
    expect(pending.log).toContain("burst:post-resolution:stay:r05-check:burst");
    expect(
      pending.pendingStepChoice?.continuation?.stepContext
        .burstPostResolutionDestination
    ).toBe("burst");
    expect(pending.quartzSetStates).toEqual(fixture().quartzSetStates);
    const index = pending.pendingStepChoice!.choices.find((c) =>
      c.label.includes("入れ替え")
    )!.choiceIndex;
    // 再開時にlookupを省略しても、発揮開始時の実効ポリシーを既定値へ戻さない。
    const placed = choose(
      pending,
      (a) => a.kind === "resolve_pending_step_choice" && a.choiceIndex === index
    );
    expect(
      placed.cardInstances.find((c) => c.instanceId === "old")
    ).toMatchObject({ zone: "burst" });
    expect(
      placed.cardInstances.find((c) => c.instanceId === "burst")
    ).toMatchObject({ zone: "field" });
    expect(
      placed.quartzSetStates.find((q) => q.quartzInstanceId === "burst")?.slot
    ).toBe("right");
    expect(placed.players[0]!.handCount).toBe(0);
    const completed = finish(placed);
    expect(
      completed.cardInstances.find((c) => c.instanceId === "old")?.zone
    ).toBe("burst");
    expect(completed.players[0]!.handCount).toBe(3);
    expect(completed.players[0]!.countValue).toBe(2);
    expect(
      completed.log.filter((l) => l === "effect:quartz_set:burst->host:right")
    ).toHaveLength(1);
    expect(
      completed.log.filter(
        (l) => l.startsWith("effect:destroy:") && l.includes("target-b")
      )
    ).toHaveLength(1);
  });
});

it("バースト以外も、スタック→任意手順→対象選択→位置選択の継続を共有する", () => {
  const source: CardDefinition = {
    ...getDef("BSTH01-C02")!,
    cardNo: "TEST-QUARTZ-CONTINUATION",
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            executionMode: "optional",
          },
          {
            targetSelectionTiming: "on_step",
            action: {
              kind: "quartz_set",
              free: true,
              target: {
                kind: "filter",
                player: "self",
                zone: "hand",
                filter: { hasQuartzData: true },
                count: 1,
              },
            },
          },
          { action: { kind: "count_increase", player: "self", amount: 2 } },
        ],
      },
    ],
  };
  const cards = [...ALL_CARDS, source];
  const get = (id: string) => cards.find((c) => c.cardNo === id);
  const localLookups = {
    ...lookups,
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  };
  const base = fixture();
  let current: GameState = {
    ...base,
    activePlayerId: "alice",
    pendingBurstChecks: [],
    setBurstStates: [],
    players: base.players.map((p) =>
      p.id === "alice" ? { ...p, handCount: 1 } : p
    ),
    cardInstances: [
      ...base.cardInstances.map((c) =>
        c.instanceId === "burst" ? { ...c, zone: "hand" as const } : c
      ),
      createCardInstance(source, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  };
  const act = (predicate: (a: LegalAction) => boolean, targets?: string[]) => {
    const action = ["alice", "bob"]
      .flatMap((actingPlayerId) =>
        getLegalActions({
          state: current,
          actingPlayerId,
          getCardDefinitionById: get,
          ...localLookups,
        })
      )
      .find(predicate);
    expect(action).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: action!,
      ...(targets ? { targetInstanceIds: targets } : {}),
      getCardDefinitionById: get,
      ...localLookups,
    }).state;
  };
  act(
    (a) => a.kind === "use_field_card_effect" && a.sourceInstanceId === "source"
  );
  act((a) => a.kind === "pass_stack");
  expect(current.pendingStepOptionalChoice).not.toBeNull();
  act(
    (a) =>
      a.kind === "resolve_pending_step_optional_choice" &&
      a.choice === "execute"
  );
  if (current.pendingStepOptionalTargetSelection)
    act(
      (a) => a.kind === "resolve_pending_step_optional_target_selection",
      ["burst"]
    );
  expect(current.pendingStepChoice).not.toBeNull();
  expect(current.quartzSetStates).toEqual(base.quartzSetStates);
  expect(current.players[0]!.countValue).toBe(1);
  act(
    (a) =>
      a.kind === "resolve_pending_step_choice" &&
      a.choiceLabel.includes("入れ替え")
  );
  expect(current.quartzSetStates[0]!.slot).toBe("right");
  expect(current.cardInstances.find((c) => c.instanceId === "old")?.zone).toBe(
    "hand"
  );
  expect(current.players[0]!.countValue).toBe(3);
});

it("明示した対話は任意手順後のchoiceへ保持し、headless解決は自動のまま保つ", () => {
  const source: CardDefinition = {
    ...getDef("BSTH01-C02")!,
    cardNo: "TEST-INTERACTIVE-CONTINUATION",
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: { kind: "count_increase", player: "self", amount: 1 },
            executionMode: "optional",
          },
          {
            action: { kind: "count_increase", player: "self", amount: 3 },
            choice: [
              { action: { kind: "count_increase", player: "self", amount: 4 } },
            ],
          },
        ],
      },
    ],
  };
  const get = (id: string) => (id === source.cardNo ? source : getDef(id));
  const options = {
    getCardDefinitionById: get,
    getRegisteredTriggeredEffectActions: () => [],
  };
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(source, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  });
  const run = (promptUnresolvedChoice: boolean) =>
    executeEffect({
      state: base,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      effect: source.effects![0]!,
      effectIndex: 0,
      chainId: "test:interactive-continuation",
      promptUnresolvedChoice,
      ...options,
    });
  const select = (state: GameState) => {
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...options,
    }).find(
      (a) =>
        (a.kind === "resolve_pending_step_choice" && a.choiceIndex === 0) ||
        (a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "execute")
    );
    expect(action).toBeDefined();
    return applyLegalAction({ state, action: action!, ...options }).state;
  };
  const first = run(true);
  expect(first.players[0]!.countValue).toBe(0);
  const second = select(first);
  expect(second.pendingStepChoice).not.toBeNull();
  expect(second.players[0]!.countValue).toBe(1);
  const done = select(second);
  expect(done.pendingStepChoice).toBeNull();
  expect(done.players[0]!.countValue).toBe(4);
  const headless = select(run(false));
  expect(headless.pendingStepChoice).toBeNull();
  expect(headless.players[0]!.countValue).toBe(4);
});
