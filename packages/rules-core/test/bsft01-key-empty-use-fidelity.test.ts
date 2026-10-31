import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildMagicLookup,
  buildFieldCardEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type ActiveStack,
  type GameState,
} from "../src";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";

// 03b 空撃ち / 03c その後 / 公式Q25496: 対象0でも使用は成立する。
// BSFT保存原文: 「このカードの○○効果が使用されたとき、効果発揮後…」。
const defs = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const getDef = (id: string) => defs.find((d) => d.cardNo === id);
const lookups = {
  getCardDefinitionById: getDef,
  getRegisteredMagicActions: buildMagicLookup(defs),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};
const key = (s: GameState) =>
  s.cardInstances.find((c) => c.instanceId === "key")!;
function setup(no: string, life = 5, host = false): GameState {
  const def = getDef(no)!;
  const effect = def.effects![1]!;
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(def, {
          instanceId: "key",
          ownerPlayerId: "alice",
          zone: "in_use",
          normalCoreCount: 0,
        }),
        ...(host
          ? [
              createCardInstance(getDef("BSFT01-CX01")!, {
                instanceId: "lucy",
                ownerPlayerId: "alice",
                zone: "field",
                normalCoreCount: 1,
              }),
            ]
          : []),
      ],
      playerOverrides: [
        {
          lifeNormalCoreCount: life,
          lifeSoulCoreCount: 0,
          reserveNormalCoreCount: 12,
          reserveSoulCoreCount: 0,
          voidNormalCoreCount: 20,
          deckCount: 0,
          handCount: 0,
        },
        {},
      ],
    }),
    activePlayerId: "alice",
    step:
      effect.timing.kind === "activated" && effect.timing.mode === "main"
        ? "main"
        : "attack",
  };
}
function resolveBody(state: GameState) {
  return executeEffect({
    chainId: "test:bsft01-key-empty-use-fidelity:74",
    state,
    sourceInstanceId: "key",
    actingPlayerId: "alice",
    effectIndex: 1,
    effect: getDef(key(state).definitionId)!.effects![1]!,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
    targetInstanceIds: [],
    targetSelectionResolved: true,
  });
}
function choose(state: GameState, choice: "execute" | "decline") {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).find(
    (a) =>
      a.kind === "resolve_pending_step_optional_choice" && a.choice === choice
  );
  expect(action, `missing optional ${choice}`).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups }).state;
}
function flip(state: GameState) {
  expect(state.pendingStepOptionalChoice?.stepLabel).toBe("rebirth_window");
  const pending = choose(state, "execute");
  expect(pending.pendingCoreDistribution).not.toBeNull();
  const action = getLegalActions({
    state: pending,
    actingPlayerId: "alice",
    ...lookups,
  }).find((a) => a.kind === "resolve_pending_core_distribution")!;
  return applyLegalAction({
    state: pending,
    action,
    coreDistributionAllocations: { key: 1 },
    coreDistributionSourceAllocations: { reserve: 1 },
    ...lookups,
  }).state;
}

describe("BSFT01 鍵ブレイヴの空撃ち使用後", () => {
  it.each(["02", "06", "08", "10", "12", "13"])(
    "TR%s: 本文対象/回収候補が0でも転醒し、内包コア配置を確定できる",
    (n) => {
      const before = setup(`BSFT01-TR${n}(A)`);
      const body = resolveBody(before);
      const after = flip(body);
      expect(key(after).definitionId).toBe(`BSFT01-TR${n}(B)`);
      expect(key(after).zone).toBe("field");
      expect(key(after).normalCoreCount).toBe(1);
      expect(after.players[0]!.countValue).toBe(1);
    }
  );
  it("TR01: ライフ0では本文を使用しても転醒/合体を提示しない", () => {
    const after = resolveBody(setup("BSFT01-TR01(A)", 0, true));
    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(after.pendingCoreDistribution).toBeNull();
    expect(key(after).definitionId).toBe("BSFT01-TR01(A)");
    expect(key(after).attachedToInstanceId).toBeNull();
    expect(after.players[0]!.countValue).toBe(0);
  });
  it("TR06: 対象0で疲労を使用後、転醒を辞退してルーシィへ合体できる", () => {
    const body = resolveBody(setup("BSFT01-TR06(A)", 5, true));
    const declined = choose(body, "decline");
    expect(declined.pendingStepOptionalChoice?.stepLabel).toBe(
      "combine_window"
    );
    const after = choose(declined, "execute");
    expect(key(after).definitionId).toBe("BSFT01-TR06(A)");
    expect(key(after).attachedToInstanceId).toBe("lucy");
    expect(after.players[0]!.countValue).toBe(0);
    const flipped = flip(resolveBody(setup("BSFT01-TR06(A)", 5, true)));
    expect(key(flipped).attachedToInstanceId).toBeNull();
    expect(flipped.pendingStepOptionalChoice?.stepLabel).not.toBe(
      "combine_window"
    );
  });
  it("TR06: コアを追加しない転醒完了後も合体を再提示しない", () => {
    const before = setup("BSFT01-TR06(A)", 5, true);
    key(before).zone = "field";
    key(before).normalCoreCount = 1;
    const pending = choose(resolveBody(before), "execute");
    expect(pending.pendingCoreDistribution).not.toBeNull();
    const action = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    const after = applyLegalAction({
      state: pending,
      action,
      coreDistributionAllocations: {},
      coreDistributionSourceAllocations: {},
      ...lookups,
    }).state;
    expect(key(after).definitionId).toBe("BSFT01-TR06(B)");
    expect(key(after).normalCoreCount).toBe(1);
    expect(after.players[0]!.countValue).toBe(1);
    expect(after.pendingStepOptionalChoice?.stepLabel).not.toBe(
      "combine_window"
    );
  });
  it("TR07: 相手の疲労対象がいなくても現在のバトルを終了し、転醒窓へ進む", () => {
    const before = setup("BSFT01-TR07(A)", 5, true);
    before.window = "flash_before_block";
    before.activeAttack = {
      attackId: "empty-tr07",
      primaryEntityId: "lucy-entity",
      participantEntityIds: ["lucy-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "lucy-entity", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["lucy-entity"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    before.battleEntities = [
      {
        entityId: "lucy-entity",
        memberInstanceIds: ["lucy"],
        resolvedBp: 3000,
        resolvedSymbols: ["yellow"],
        attackState: "attacking",
      },
    ];
    const after = resolveBody(before);
    expect(after.activeAttack).toBeNull();
    expect(after.battlesEndedThisTurn).toBe(1);
    expect(after.step).toBe("attack");
    expect(after.window).toBe("none");
    expect(after.pendingStepOptionalChoice?.stepLabel).toBe("rebirth_window");
    expect(after.log).toContain("battle:end:empty-tr07");
  });
  it("TR02: 手札からスタック空撃ちを宣言し、支払いと応答窓を経て転醒できる", () => {
    let state = setup("BSFT01-TR02(A)");
    key(state).zone = "hand";
    state.players[0]!.handCount = 1;
    const outer: ActiveStack = {
      stackId: "outer",
      chainId: "outer",
      actionKind: "magic",
      actingPlayerId: "bob",
      cardInstanceId: "outer-card",
      cardDefinitionId: "BSFT01-C02",
      targetInstanceIds: [],
      targetEffectFilterTags: [],
      reducedCost: 0,
      totalReduction: 0,
      chosenTiming: "flash",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    state.cardInstances.push(
      createCardInstance(getDef("BSFT01-C02")!, {
        instanceId: "outer-card",
        ownerPlayerId: "bob",
        zone: "in_use",
      })
    );
    state.window = "stack";
    state.stackWindow = {
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      actingPlayerId: "bob",
      previousWindow: "none",
      stackResponseSourcePlayerId: "bob",
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: outer,
    };
    const use = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "use_magic" && a.sourceInstanceId === "key");
    expect(use).toBeDefined();
    if (!use || use.kind !== "use_magic") throw new Error("missing key magic");
    expect(use.requiredTargetCount).toBe(0);
    const cost = use.reducedCost;
    state = applyLegalAction({
      state,
      action: use,
      paymentSources: cost ? [{ kind: "reserve", amount: cost }] : [],
      ...lookups,
    }).state;
    expect(state.players[0]!.reserveNormalCoreCount).toBe(12 - cost);
    expect(key(state).zone).toBe("in_use");
    for (let i = 0; i < 5 && !state.pendingStepOptionalChoice; i++) {
      const pass = getLegalActions({
        state,
        actingPlayerId: state.stackWindow!.priorityPlayerId,
        ...lookups,
      }).find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      state = applyLegalAction({ state, action: pass!, ...lookups }).state;
    }
    const after = flip(state);
    expect(key(after).definitionId).toBe("BSFT01-TR02(B)");
    expect(key(after).zone).toBe("field");
    expect(after.players[0]!.countValue).toBe(1);
  });
});
