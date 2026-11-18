import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";
import {
  buildMagicLookup,
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { executeDiscardSetBurst } from "../src/mechanics/burst-system";

const c06 = ALL_CARDS.find((c) => c.cardNo === "BSRK01-C06")!;
const burst: CardDefinition = {
  cardNo: "TEST-C06-BURST",
  name: "破棄検証バースト",
  printedCategory: "magic",
  colors: ["blue"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: ["【バースト：自分のライフ減少後】", "1枚ドローする。"],
  keywordTags: ["burst"],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: {
        kind: "burst",
        trigger: { kind: "life_decrease", player: "self" },
      },
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
    {
      timing: {
        kind: "burst",
        trigger: { kind: "life_decrease", player: "self" },
        handSource: true,
      },
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
};
const spirit = ALL_CARDS.find((c) => c.cardNo === "BSTH01-C04")!;
const defs = [c06, burst, spirit];
const lookup = {
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBattleImmediateEffectActions: () => [],
  getRegisteredHandActivatedEffectActions: () => [],
  getCardDefinitionById: (id: string) => defs.find((c) => c.cardNo === id),
  getRegisteredMagicActions: buildMagicLookup(defs),
  getRegisteredBurstActions: buildBurstEffectLookup(defs),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
};
function makeState(
  zone: "burst" | "hand" = "burst",
  magicZone: "hand" | "set_aside" = "hand",
  step: "main" | "attack" = "attack",
  activePlayerId = "alice"
): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(c06, {
          instanceId: "c06",
          ownerPlayerId: "alice",
          zone: magicZone,
        }),
        createCardInstance(spirit, {
          instanceId: "opponent-spirit",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(burst, {
          instanceId: "burst",
          ownerPlayerId: "bob",
          zone,
        }),
        createCardInstance(burst, {
          instanceId: "draw-card",
          ownerPlayerId: "bob",
          zone: "deck",
        }),
      ],
      playerOverrides: [
        { reserveNormalCoreCount: 10 },
        { reserveNormalCoreCount: 10 },
      ],
    }),
    turnNumber: 3,
    step,
    activePlayerId,
    setBurstStates:
      zone === "burst" ? [{ playerId: "bob", cardInstanceId: "burst" }] : [],
    pendingBurstChecks: [
      {
        checkId: "check",
        actingPlayerId: "bob",
        eventKind: "reduce_life",
        source: "action_resolution",
        chainId: "test:bsrk01-c06-stack-flow:103",
        attackId: null,
        relatedPlayerId: "bob",
        relatedInstanceId: null,
        amount: 1,
        step,
        window: "none",
        resolvedBurstCardInstanceIds: [],
      },
    ],
  };
}
function actions(state: GameState, actingPlayerId: string) {
  return getLegalActions({ state, actingPlayerId, ...lookup });
}
function apply(state: GameState, action: LegalAction) {
  return applyLegalAction({
    state,
    action,
    ...lookup,
    ...(action.kind === "use_magic"
      ? {
          paymentSources: [
            { kind: "reserve" as const, amount: action.finalCost },
          ],
        }
      : {}),
  }).state;
}
function declare(state: GameState) {
  const action = actions(state, "bob").find(
    (a) =>
      a.kind === "resolve_pending_burst_check" && a.sourceInstanceId === "burst"
  );
  expect(action).toBeDefined();
  return apply(state, action!);
}
function useDiscard(state: GameState) {
  const action = actions(state, "alice").find(
    (a) =>
      a.kind === "use_magic" &&
      a.effectIndex === (state.step === "main" ? 1 : 2)
  );
  expect(action).toBeDefined();
  return apply(state, action!);
}
function pass(state: GameState, player: string) {
  const action = actions(state, player).find((a) => a.kind === "pass_stack");
  expect(action).toBeDefined();
  return apply(state, action!);
}
const zoneOf = (state: GameState, id: string) =>
  state.cardInstances.find((c) => c.instanceId === id)?.zone;

describe("BSRK01-C06 スタック宣言・バースト破棄", () => {
  it.each(["hand", "set_aside"] as const)(
    "使用元 %s: 両者attack=2効果、自分main=破棄のみ、相手main=使用不可",
    (magicZone) => {
      for (const [step, active, expected] of [
        ["attack", "alice", [0, 2]],
        ["attack", "bob", [0, 2]],
        ["main", "alice", [1]],
        ["main", "bob", []],
      ] as const) {
        const state = declare(makeState("burst", magicZone, step, active));
        expect(
          actions(state, "alice")
            .filter((a) => a.kind === "use_magic")
            .map((a) => a.effectIndex)
        ).toEqual(expected);
      }
    }
  );
  it("発動宣言への応答中はセット中、パスして発動成立後はセット中でなくなる", () => {
    const state = declare(makeState());
    expect(state.stackWindow?.burstWindowKind).toBe("activation");
    expect(state.setBurstStates).toEqual([
      { playerId: "bob", cardInstanceId: "burst" },
    ]);
    const established = pass(state, "alice");
    expect(established.stackWindow?.burstWindowKind).toBe("effect_declaration");
    expect(established.setBurstStates).toEqual([]);
  });
  it.each(["burst", "hand"] as const)(
    "%s 発動宣言へ破棄: 支払い→相手応答→破棄、元のバーストを解決しない",
    (sourceZone) => {
      const declared = declare(makeState(sourceZone));
      const paid = useDiscard(declared);
      expect(paid.players[0]!.reserveNormalCoreCount).toBe(6);
      expect(paid.stackWindow?.priorityPlayerId).toBe("bob");
      expect(zoneOf(paid, "burst")).toBe(sourceZone);
      const resolved = pass(paid, "bob");
      expect(zoneOf(resolved, "burst")).toBe("trash");
      expect(zoneOf(resolved, "draw-card")).toBe("deck");
      expect(resolved.pendingBurstChecks).toEqual([]);
      expect(resolved.revealedBurstStates).toEqual([]);
      expect(resolved.pendingStackCascade).toBeNull();
    }
  );
  it("効果発揮宣言まで進んだバーストは破棄されず、本体を解決する", () => {
    const established = pass(declare(makeState()), "alice");
    const resolved = pass(useDiscard(established), "bob");
    expect(zoneOf(resolved, "draw-card")).toBe("hand");
  });
  it("セットのみのバーストを破棄する", () => {
    const state = makeState();
    const after = executeDiscardSetBurst(
      state,
      "alice",
      "c06",
      "bob",
      1,
      lookup.getCardDefinitionById
    );
    expect(zoneOf(after, "burst")).toBe("trash");
    expect(after.setBurstStates).toEqual([]);
  });
  it("トラッシュ発動宣言への破棄は移動を起こさず、発動を中止しない", () => {
    const declared = declare(makeState("hand"));
    const active = declared.stackWindow!.pendingStackAction!;
    const state: GameState = {
      ...declared,
      cardInstances: declared.cardInstances.map((c) =>
        c.instanceId === "burst" ? { ...c, zone: "trash" } : c
      ),
      stackWindow: {
        ...declared.stackWindow!,
        pendingStackAction: { ...active, burstActivationSourceZone: "trash" },
      },
    };
    const after = executeDiscardSetBurst(
      state,
      "alice",
      "c06",
      "bob",
      1,
      lookup.getCardDefinitionById
    );
    expect(zoneOf(after, "burst")).toBe("trash");
    expect(after.pendingBurstChecks).toEqual(state.pendingBurstChecks);
    expect(after.revealedBurstStates).toEqual(state.revealedBurstStates);
    expect(after.stackWindow?.pendingStackAction).toEqual(
      state.stackWindow?.pendingStackAction
    );
    const established = pass(after, "alice");
    expect(established.stackWindow?.burstWindowKind).toBe("effect_declaration");
    const resolved = pass(established, "alice");
    expect(zoneOf(resolved, "draw-card")).toBe("hand");
  });
  it("手札戻しを選ぶと支払い・相手応答後にスピリットを選び、バーストを破棄しない", () => {
    const declared = declare(makeState());
    const bounce = actions(declared, "alice").find(
      (a) => a.kind === "use_magic" && a.effectIndex === 0
    )!;
    const paid = apply(declared, bounce);
    expect(paid.pendingEffectTargetSelection).toBeNull();
    expect(paid.stackWindow?.priorityPlayerId).toBe("bob");
    const pending = pass(paid, "bob");
    expect(pending.pendingEffectTargetSelection?.candidateInstanceIds).toEqual([
      "opponent-spirit",
    ]);
    const select = actions(pending, "alice").find(
      (a) => a.kind === "resolve_pending_effect_target"
    )!;
    const resolved = applyLegalAction({
      state: pending,
      action: select,
      ...lookup,
      targetInstanceIds: ["opponent-spirit"],
    }).state;
    expect(zoneOf(resolved, "opponent-spirit")).toBe("hand");
    expect(zoneOf(resolved, "draw-card")).toBe("hand");
  });
});
