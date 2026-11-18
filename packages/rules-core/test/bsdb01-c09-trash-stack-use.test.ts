/**
 * BSDB01-C09「かめはめ波」effects[0]/[3] (textRef[0]):
 * 「〔ゲームに1回:同名〕トラッシュにあるこのカードは、相手のアタックステップ中、
 *  2コスト支払ってスタック効果を使用できる。そうしたとき、このカードを除外する。」
 *
 * トラッシュ限定の使用許可(コスト2上書き)＋使用後の自己除外という起動経路。
 * BSDB01-R03「トラッシュからも使用できる」と同型 (engine-magic-trash-use-permission):
 * - コスト上書きは effects[0] の continuous cost_modify (applicability.zone:["trash"] 限定、
 *   手札からの通常使用(printed cost 4)には影響しない)。
 * - スタック効果本体 (require_battle_destroy_cost, textRef[5,6] と同一) は effects[3] の
 *   applicability.zone:["trash"] + timingScope(相手のアタックステップ) + usageLimit(ゲームに1回:同名)
 *   registration で表現し、後段に move_self(destination:removed_from_game) を追加する
 *   （「そうしたとき、除外する」）。
 * printedCategory:"magic" のため generateMagicRegistrations 経路(getAvailableMagicLegalActions が
 * 既にトラッシュゾーンを走査する engine-magic-trash-use-permission 基盤)に乗り、
 * 新規 legal-action-availability 拡張は不要。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildMagicLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type ActiveStack,
  type CardDefinition,
  type GameState,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const C09 = cardNoMap.get("BSDB01-C09")!;
const getDef = (id: string) => cardNoMap.get(id);
const magicLookup = buildMagicLookup(ALL_CARDS);
const noTriggerLookup = () => [];

const ALICE = "alice";
const BOB = "bob";

function trashVariantEffect() {
  const eff = C09.effects!.find((e) =>
    e.steps.some(
      (s) =>
        s.action.kind === "move_self" &&
        s.action.destination === "removed_from_game"
    )
  );
  if (!eff) throw new Error("trash variant effect (move_self) not found");
  return eff;
}

function costOverrideEffect() {
  const eff = C09.effects!.find(
    (e) =>
      e.timing.kind === "continuous" &&
      e.steps.some((s) => s.action.kind === "cost_modify")
  );
  if (!eff) throw new Error("cost_modify continuous effect not found");
  return eff;
}

describe("BSDB01-C09 effects[0]/[3]: トラッシュ限定コスト2上書き + 使用後除外 (DSL 定義)", () => {
  it("effects[0]: continuous cost_modify(override:2)、applicability.zone は trash 限定", () => {
    const effect = costOverrideEffect();
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability).toEqual({ zone: ["trash"] });
    expect(effect.steps).toHaveLength(1);
    expect(effect.steps[0]!.action).toEqual({
      kind: "cost_modify",
      target: { kind: "self" },
      modifier: { override: 2 },
    });
  });

  it("effects[3]: applicability.zone:trash + timingScope(相手のアタックステップ) + usageLimit(ゲームに1回:同名)、require_battle_destroy_cost 後段に move_self(removed_from_game)", () => {
    const effect = trashVariantEffect();
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(effect.applicability).toEqual({ zone: ["trash"] });
    expect(effect.timingScope).toEqual({
      player: "opponent",
      period: "attack",
    });
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
    });
    expect(effect.steps).toHaveLength(2);
    expect(effect.steps[0]!.action.kind).toBe("require_battle_destroy_cost");
    expect(effect.steps[1]!.action).toEqual({
      kind: "move_self",
      destination: "removed_from_game",
    });
  });
});

function buildStackRespondState(magicZone: "trash" | "hand"): GameState {
  const magicCard = createCardInstance(C09, {
    instanceId: "c09-src",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: magicZone,
  });
  const bobPendingStack: ActiveStack = {
    stackId: "stack:bob-dummy",
    actionKind: "magic",
    chainId: "chain:bob-dummy",
    actingPlayerId: BOB,
    cardInstanceId: "bob-dummy-magic",
    cardDefinitionId: "BOB-DUMMY-MAGIC",
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  const base: GameState = {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [magicCard],
      playerOverrides: [{ reserveNormalCoreCount: 4 }, {}],
    }),
    step: "attack",
    activePlayerId: BOB,
    window: "stack",
    stackWindow: {
      priorityPlayerId: ALICE,
      consecutivePassCount: 0,
      actingPlayerId: BOB,
      previousWindow: "attack",
      stackResponseSourcePlayerId: BOB,
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: bobPendingStack,
    },
  };
  if (magicZone !== "trash") return base;
  // continuous cost_modify (effects[0]) は recomputeContinuousEffects 相当の再評価
  // スイープを経由するため、engine-magic-trash-use-permission.test.ts と同様
  // テストでは明示的に一度実行して CE を登録する。
  return executeEffect({
    chainId: "test:bsdb01-c09-trash-stack-use:142",
    state: base,
    effect: costOverrideEffect(),
    sourceInstanceId: "c09-src",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

function findC09UseActions(state: GameState, actingPlayerId: string) {
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredMagicActions: magicLookup,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  }).filter(
    (a): a is Extract<typeof a, { kind: "use_magic" }> =>
      a.kind === "use_magic" && a.sourceInstanceId === "c09-src"
  );
}

describe("BSDB01-C09: トラッシュ限定コスト2 use_magic の legal-action 可視性 (相手のアタックステップ中のみ)", () => {
  it("トラッシュ + 相手(bob)のアタックステップ中: コスト2上書きの use_magic が出る", () => {
    const state = buildStackRespondState("trash");
    const actions = findC09UseActions(state, ALICE);
    const overridden = actions.find((a) => a.costMode === "override");
    expect(overridden).toBeDefined();
    expect(overridden?.finalCost).toBe(2);
  });

  it("自分(alice)のアタックステップ中は timingScope(相手限定) により出ない", () => {
    const state: GameState = {
      ...buildStackRespondState("trash"),
      activePlayerId: ALICE,
      stackWindow: {
        ...buildStackRespondState("trash").stackWindow!,
        priorityPlayerId: ALICE,
      },
    };
    const actions = findC09UseActions(state, ALICE);
    expect(actions.some((a) => a.costMode === "override")).toBe(false);
  });

  it("手札にある場合はコスト2上書きの variant は出ない (通常コスト4の hand registration のみ)", () => {
    const state = buildStackRespondState("hand");
    const actions = findC09UseActions(state, ALICE);
    expect(actions.some((a) => a.costMode === "override")).toBe(false);
  });
});

describe("BSDB01-C09: トラッシュ variant 実行後の盤面変化 (破壊コストゲート登録 + 自己除外)", () => {
  it("effects[3] を実行すると、相手(bob)へ battle_destroy_cost_gate_both CE が登録され、C09自身は removed_from_game へ移動する", () => {
    const magicCard = createCardInstance(C09, {
      instanceId: "c09-trash",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [magicCard],
    });

    const after = executeEffect({
      chainId: "test:bsdb01-c09-trash-stack-use:209",
      state,
      effect: trashVariantEffect(),
      sourceInstanceId: "c09-trash",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    const gateCe = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "battle_destroy_cost_gate_both"
    );
    expect(gateCe).toBeDefined();
    expect(gateCe?.targetFilter).toMatchObject({ player: "opponent" });

    const c09After = after.cardInstances.find(
      (c) => c.instanceId === "c09-trash"
    )!;
    expect(c09After.zone).toBe("removed_from_game");
  });
});
