import { expect, it } from "vitest";
import {
  applyLegalAction,
  buildBurstEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type Effect,
  type LegalAction,
  type ActiveStack,
  type GameState,
} from "../src";

import {
  resumeStackCascadeIfReady,
  resolveStackCascade,
} from "../src/legal/stack-resolution-core";

const base: CardDefinition = {
  cardNo: "ORDER-BASE",
  name: "順序検証",
  printedCategory: "spirit",
  cost: 0,
  colors: ["red"],
  reductionSymbols: [],
  symbolColors: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  keywordTags: [],
  textLines: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const define = (
  id: string,
  timing: Effect["timing"],
  action: Effect["steps"][number]["action"],
  magic = false
): CardDefinition => ({
  ...base,
  cardNo: id,
  name: id,
  printedCategory: magic ? "magic" : "spirit",
  effects: [{ timing, steps: [{ action }] }],
});
const a = define(
  "A",
  { kind: "activated", mode: "stack" },
  { kind: "draw", count: 1 },
  true
);
const b = define(
  "B",
  { kind: "activated", mode: "stack" },
  { kind: "count_decrease", player: "self", amount: 1 },
  true
);
const c = define(
  "C",
  { kind: "game_event", event: "count_decrease", player: "self" },
  {
    kind: "core_move",
    from: { kind: "void", player: "self" },
    to: { kind: "reserve", player: "self" },
    amount: 2,
  }
);
const d = define(
  "D",
  { kind: "game_event", event: "count_decrease", player: "self" },
  { kind: "count_increase", player: "self", amount: 1 }
);
const e = define(
  "E",
  { kind: "game_event", event: "count_increase", player: "self" },
  { kind: "draw", count: 1 }
);
const f: CardDefinition = {
  ...define(
    "F",
    { kind: "burst", trigger: { kind: "hand_increase", player: "opponent" } },
    { kind: "count_increase", player: "self", amount: 1 },
    true
  ),
  textLines: [
    "【バースト：相手の効果で相手の手札が増えた後】",
    "自分のカウント+1する。",
  ],
  keywordTags: ["burst"],
};
const g = define(
  "G",
  { kind: "game_event", event: "count_increase", player: "self" },
  { kind: "draw", count: 1 }
);
const cards = [base, a, b, c, d, e, f, g];
const lookups = {
  getCardDefinitionById: (id: string) =>
    cards.find((card) => card.cardNo === id),
  getRegisteredMagicActions: buildMagicLookup(cards),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  getRegisteredBurstActions: buildBurstEffectLookup(cards),
  getRegisteredFieldCardEffectActions: () => [],
};

it("B→D→E→F発動→C→F発揮と誘発G→独立したスタックAの順に完走する", () => {
  let state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      { countValue: 1, reserveNormalCoreCount: 10, handCount: 1, deckCount: 2 },
      { countValue: 1, reserveNormalCoreCount: 10, handCount: 1, deckCount: 1 },
    ],
    cardInstances: [
      createCardInstance(base, {
        instanceId: "attacker",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      ...[a, b].map((card, i) =>
        createCardInstance(card, {
          instanceId: card.cardNo,
          ownerPlayerId: i ? "bob" : "alice",
          zone: "hand",
        })
      ),
      ...[c, d, e, g].map((card) =>
        createCardInstance(card, {
          instanceId: card.cardNo,
          ownerPlayerId: card === g ? "alice" : "bob",
          zone: "field",
          normalCoreCount: 1,
        })
      ),
      createCardInstance(f, {
        instanceId: "F",
        ownerPlayerId: "alice",
        zone: "burst",
      }),
      ...["alice", "alice", "bob"].map((ownerPlayerId, i) =>
        createCardInstance(base, {
          instanceId: `deck-${i}`,
          ownerPlayerId,
          zone: "deck",
        })
      ),
    ],
  });
  state = {
    ...state,
    step: "attack",
    activePlayerId: "bob",
    turnNumber: 2,
    setBurstStates: [{ playerId: "alice", cardInstanceId: "F" }],
  };
  const available = () =>
    ["alice", "bob"].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...lookups })
    );
  const triggerSources = () =>
    available()
      .filter(
        (action) =>
          action.kind === "select_pending_to_resolve" ||
          action.kind === "resolve_pending_triggered_effect"
      )
      .map((action) =>
        "sourceInstanceId" in action ? action.sourceInstanceId : undefined
      );
  const act = (predicate: (action: LegalAction) => boolean) => {
    const choices = available();
    const action = choices.find(predicate);
    expect(action, JSON.stringify(choices)).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      ...lookups,
      ...(action?.kind === "use_magic" ? { paymentSources: [] } : {}),
    }).state;
  };
  const trigger = (id: string) => {
    act(
      (action) =>
        (action.kind === "select_pending_to_resolve" ||
          action.kind === "resolve_pending_triggered_effect") &&
        action.sourceInstanceId === id
    );
    if (!state.stackWindow)
      act(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === id
      );
    act((action) => action.kind === "pass_stack");
  };
  const waitingA = () => {
    expect(
      state.cardInstances.find((card) => card.instanceId === "A")?.zone
    ).toBe("in_use");
    expect(
      state.pendingStackCascade?.remainingStacks.map(
        (stack) => stack.cardInstanceId
      )
    ).toContain("A");
  };
  act(
    (action) =>
      action.kind === "attack" && action.sourceInstanceId === "attacker"
  );
  act(
    (action) => action.kind === "use_magic" && action.sourceInstanceId === "A"
  );
  act(
    (action) => action.kind === "use_magic" && action.sourceInstanceId === "B"
  );
  act((action) => action.kind === "pass_pre_declaration_stack");
  expect(triggerSources().sort()).toEqual(["C", "D"]);
  waitingA();
  trigger("D");
  expect(
    available().some(
      (action) =>
        "sourceInstanceId" in action && action.sourceInstanceId === "C"
    )
  ).toBe(false);
  trigger("E");
  expect(state.players[1]!.handCount).toBe(1);
  act(
    (action) =>
      action.kind === "resolve_pending_burst_check" &&
      action.sourceInstanceId === "F"
  );
  expect(state.stackWindow?.burstWindowKind).toBe("activation");
  act((action) => action.kind === "pass_stack");
  waitingA();
  expect(state.stackWindow).toBeNull();
  expect(triggerSources()).toContain("C");
  expect(state.players[0]!.countValue).toBe(1);
  expect(state.players[0]!.handCount).toBe(0);
  trigger("C");
  expect(state.players[1]!.reserveNormalCoreCount).toBe(12);
  expect(state.pendingTriggeredEffects).toHaveLength(0);
  expect(state.stackWindow?.burstWindowKind).toBe("effect_declaration");
  waitingA();
  act((action) => action.kind === "pass_stack");
  expect(state.players[0]!.countValue).toBe(2);
  expect(state.players[0]!.handCount).toBe(0);
  expect(triggerSources()).toEqual(["G"]);
  waitingA();
  trigger("G");
  expect(state.players[0]!.handCount).toBe(2);
  expect(state.players[1]!.handCount).toBe(1);
  expect(state.players[1]!.countValue).toBe(1);
  expect(state.pendingStackCascade).toBeNull();
  expect(state.pendingTriggeredEffects).toHaveLength(0);
  expect(state.pendingBurstChecks).toHaveLength(0);
  expect(state.pendingEffectCompletions).toHaveLength(0);
  expect(
    state.cardInstances
      .filter((card) => ["A", "B", "F"].includes(card.instanceId))
      .every((card) => card.zone === "trash")
  ).toBe(true);
});

// 02 stack order: the outer stack's deferred cost belongs to that outer
// resolution; the independent response burst completes before it resumes.
for (const owner of ["alice", "bob"]) {
  const opponent = owner === "alice" ? "bob" : "alice";
  function deferredCostFixture(explicitDependency = true) {
    const head: ActiveStack = {
      stackId: "response-burst",
      chainId: "response-burst",
      actionKind: "burst_activation",
      actingPlayerId: owner,
      cardInstanceId: "F",
      cardDefinitionId: f.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: [],
      burstCheckId: "check-response",
      burstActivationSourceZone: "burst",
      burstRegistrationIndex: 0,
      burstSourceKind: "magic",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    const outer: ActiveStack = {
      stackId: "outer",
      chainId: "outer",
      actionKind: "magic",
      actingPlayerId: owner,
      cardInstanceId: "A",
      cardDefinitionId: a.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: [],
      chosenTiming: "stack",
      magicEffectIndex: 0,
      magicEffectiveColors: ["red"],
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
      ...(explicitDependency
        ? { waitForResolutionChainIds: [head.chainId] }
        : {}),
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: ["alice", "bob"].map((id) => ({
          deckCount: id === owner ? 1 : 0,
          handCount: 0,
        })),
        cardInstances: [
          createCardInstance(a, {
            instanceId: "A",
            ownerPlayerId: owner,
            zone: "in_use",
          }),
          createCardInstance(f, {
            instanceId: "F",
            ownerPlayerId: owner,
            zone: "burst",
          }),
          createCardInstance(base, {
            instanceId: "cost",
            ownerPlayerId: owner,
            zone: "field",
            normalCoreCount: 0,
          }),
          createCardInstance(base, {
            instanceId: "deck",
            ownerPlayerId: owner,
            zone: "deck",
          }),
        ],
      }),
      activePlayerId: owner,
      step: "main",
      turnNumber: 2,
      pendingLeaveEntities: [
        {
          instanceId: "cost",
          kind: "vanish",
          cause: "cost_payment",
          causePlayerId: null,
          chainId: outer.chainId,
          deferZoneMoveUntilChainEnd: true,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "check-response",
          actingPlayerId: owner,
          eventKind: "hand_increase",
          source: "action_resolution",
          chainId: "response",
          attackId: null,
          relatedPlayerId: opponent,
          amount: 1,
          step: "main",
          window: "none",
          resolvedBurstCardInstanceIds: [],
          activationSelected: true,
        },
      ],
      revealedBurstStates: [
        {
          playerId: owner,
          cardInstanceId: "F",
          checkId: "check-response",
          activationPending: false,
        },
      ],
    };
    return { state, head, outer };
  }
  it(`${owner}: 外側コストを保持してバースト発揮宣言へ進む`, () => {
    const { state, head, outer } = deferredCostFixture();
    const result = resumeStackCascadeIfReady(
      {
        ...state,
        pendingStackCascade: {
          remainingStacks: [
            { ...head, burstEffectDeclarationPending: true },
            outer,
          ],
          waitForTriggeredEffects: true,
        },
      },
      lookups
    );
    expect(result.stackWindow?.burstWindowKind).toBe("effect_declaration");
    expect(result.pendingLeaveEntities).toEqual(state.pendingLeaveEntities);
    expect(
      result.cardInstances.find((c) => c.instanceId === "cost")?.zone
    ).toBe("field");
    expect(
      result.pendingStackCascade?.remainingStacks.map((s) => s.stackId)
    ).toEqual(["outer"]);
  });
  it(`${owner}: 発揮宣言後の再開はworking tailも照合し、本体→外側→コスト離脱まで完走する`, () => {
    const { state, head, outer } = deferredCostFixture();
    const result = resolveStackCascade(
      state,
      [
        {
          ...head,
          burstEffectDeclared: true,
          effectDeclarationTriggerQueued: true,
        },
        outer,
      ],
      lookups
    );
    expect(result.players.find((p) => p.id === owner)?.countValue).toBe(1);
    expect(result.players.find((p) => p.id === owner)?.handCount).toBe(1);
    expect(
      result.cardInstances.find((c) => c.instanceId === "cost")?.zone
    ).toBe("trash");
    expect(result.pendingLeaveEntities).toHaveLength(0);
    expect(result.pendingBurstChecks).toHaveLength(0);
    expect(result.revealedBurstStates).toHaveLength(0);
    expect(result.pendingStackCascade).toBeNull();
    const burstIndex = result.log.findIndex((l) =>
      l.startsWith("burst:resolve-main:start:")
    );
    expect(burstIndex).toBeGreaterThanOrEqual(0);
    expect(
      result.log.findIndex((l) =>
        l.startsWith("magic:resolve-main:start:outer")
      )
    ).toBeGreaterThan(burstIndex);
  });
  it(`${owner}: 明示的な応答待ちがない外側コストは発揮前blockerに残す`, () => {
    const { state, head, outer } = deferredCostFixture(false);
    const result = resumeStackCascadeIfReady(
      {
        ...state,
        pendingStackCascade: {
          remainingStacks: [
            { ...head, burstEffectDeclarationPending: true },
            outer,
          ],
        },
      },
      lookups
    );
    expect(result.stackWindow).toBeNull();
    expect(result.pendingLeaveEntities).toEqual(state.pendingLeaveEntities);
    expect(result.pendingStackCascade?.remainingStacks[0]?.stackId).toBe(
      head.stackId
    );
  });
}
