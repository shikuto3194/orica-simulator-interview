/**
 * P3-29 Phase 1: 誘発効果の発揮宣言で stack window が開くことを検証する。
 *
 * - resolve_pending_triggered_effect 発行時、resolver は即時実行されず ActiveStack
 *   (actionKind="triggered_effect") を pendingStackAction に積んで stack 窓を開く。
 * - 相手の pass_stack 1 回で窓がクローズし deferred resolver が走る。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState, RegisteredMagicAction } from "../src";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

const fieldEffectLookup = (() => undefined) as Parameters<
  typeof getLegalActions
>[0]["getRegisteredFieldCardEffectActions"];

function makeFieldSpiritWithDrawTrigger(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `P3-29 ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "summon" },
        applicability: { zone: "field" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
}

function makeStackMagic(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `P3-29 ${cardNo}`,
    printedCategory: "magic",
    colors: ["red"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

function makeLookup(defs: CardDefinition[]) {
  const map = new Map(defs.map((d) => [d.cardNo, d]));
  return (id: string) => map.get(id);
}

function makeMagicLookup(registrations: Record<string, RegisteredMagicAction>) {
  return (cardNo: string): readonly RegisteredMagicAction[] | undefined => {
    const registration = registrations[cardNo];
    return registration ? [registration] : undefined;
  };
}

describe("P3-29 Phase 1: 誘発効果の発揮宣言が stack window を開く", () => {
  it("alice が resolve_pending_triggered_effect を発行すると stack window が開き、bob のパスで resolver が走る", () => {
    const def = makeFieldSpiritWithDrawTrigger("P3-29-DRAW-TRIGGER");
    const lookup = makeLookup([def]);
    const triggeredLookup = buildTriggeredEffectLookup([def]);

    const baseState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(def, {
            instanceId: "alice-source",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
        playerOverrides: [{ deckCount: 5 }],
      }),
      step: "main",
      activePlayerId: "alice",
      pendingTriggeredEffects: [
        {
          pendingId: "p3-29-pending-1",
          eventKind: "summon",
          actingPlayerId: "alice",
          source: "action_resolution",
          chainId: "test:p3-29-triggered-stack-window:98",
          attackId: null,
          relatedPlayerId: null,
          relatedInstanceId: "alice-source",
          amount: null,
          step: "main",
          window: "default",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const aliceActions = getLegalActions({
      state: baseState,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const declaration = aliceActions.find(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    expect(declaration).toBeDefined();
    if (
      !declaration ||
      declaration.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected resolve_pending_triggered_effect");
    }
    expect(declaration.sourceInstanceId).toBe("alice-source");

    const beforeHand =
      baseState.players.find((p) => p.id === "alice")?.handCount ?? 0;

    // 発揮宣言: 即時解決ではなく stack 窓が開く
    const declared = applyLegalAction({
      state: baseState,
      action: declaration,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(declared.state.window).toBe("stack");
    expect(declared.state.stackWindow).not.toBeNull();
    expect(declared.state.stackWindow!.pendingStackAction).not.toBeNull();
    expect(declared.state.stackWindow!.pendingStackAction!.actionKind).toBe(
      "triggered_effect"
    );
    expect(declared.state.stackWindow!.pendingStackAction!.cardInstanceId).toBe(
      "alice-source"
    );
    expect(declared.state.stackWindow!.priorityPlayerId).toBe("bob");
    // pending は宣言段階で除去 (deferred resolver で再 insert)
    expect(declared.state.pendingTriggeredEffects).toHaveLength(0);
    // alice はまだドローしていない
    const aliceAfterDeclare = declared.state.players.find(
      (p) => p.id === "alice"
    )!;
    expect(aliceAfterDeclare.handCount).toBe(beforeHand);

    // 窓中の legal actions: alice には pending 由来の resolve は出ない (pass を bob が握る)
    const aliceDuringWindow = getLegalActions({
      state: declared.state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    });
    expect(
      aliceDuringWindow.some(
        (a) => a.kind === "resolve_pending_triggered_effect"
      )
    ).toBe(false);

    // bob が pass → 1-pass close & deferred resolver 実行
    const bobPassActions = getLegalActions({
      state: declared.state,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    });
    const passAction = bobPassActions.find((a) => a.kind === "pass_stack");
    expect(passAction).toBeDefined();

    const resolved = applyLegalAction({
      state: declared.state,
      action: passAction!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    // 窓は閉じ、pending も無し、alice は draw 1 完了
    expect(resolved.state.window).not.toBe("stack");
    expect(resolved.state.stackWindow).toBeNull();
    // 元の summon pending は解決済み (派生する increase_hand/after_draw は別 pending)
    expect(
      resolved.state.pendingTriggeredEffects.some(
        (p) => p.pendingId === "p3-29-pending-1"
      )
    ).toBe(false);
    const aliceFinal = resolved.state.players.find((p) => p.id === "alice")!;
    expect(aliceFinal.handCount).toBe(beforeHand + 1);
  });

  it("発揮宣言時のログに trigger:declared が記録される", () => {
    const def = makeFieldSpiritWithDrawTrigger("P3-29-LOG-CHECK");
    const lookup = makeLookup([def]);
    const triggeredLookup = buildTriggeredEffectLookup([def]);

    const baseState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(def, {
            instanceId: "src",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
        playerOverrides: [{ deckCount: 3 }],
      }),
      step: "main",
      activePlayerId: "alice",
      pendingTriggeredEffects: [
        {
          pendingId: "log-pending",
          eventKind: "summon",
          actingPlayerId: "alice",
          source: "action_resolution",
          chainId: "test:p3-29-triggered-stack-window:228",
          attackId: null,
          relatedPlayerId: null,
          relatedInstanceId: "src",
          amount: null,
          step: "main",
          window: "default",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const decl = getLegalActions({
      state: baseState,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((a) => a.kind === "resolve_pending_triggered_effect")!;

    const declared = applyLegalAction({
      state: baseState,
      action: decl,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(
      declared.state.log.some((entry) =>
        entry.startsWith("trigger:declared:log-pending:summon:alice")
      )
    ).toBe(true);
    expect(
      declared.state.log.some((entry) => entry.startsWith("stack:open:"))
    ).toBe(true);
  });

  it("bob の stack magic 割り込みを LIFO で解決してから alice の誘発効果を解決する", () => {
    const triggerDef = makeFieldSpiritWithDrawTrigger(
      "P3-29-LIFO-DRAW-TRIGGER"
    );
    const stackMagicDef = makeStackMagic("P3-29-LIFO-STACK-MAGIC");
    const lookup = makeLookup([triggerDef, stackMagicDef]);
    const triggeredLookup = buildTriggeredEffectLookup([triggerDef]);
    const magicLookup = makeMagicLookup({
      [stackMagicDef.cardNo]: {
        timing: "stack",
        reason: "p3_29_triggered_lifo_response",
      },
    });
    const resolverLookup = (cardNo: string) =>
      cardNo === stackMagicDef.cardNo
        ? (currentState: GameState) => ({
            ...currentState,
            log: [
              ...currentState.log,
              "p3-29:lifo:triggered:bob-stack-resolved",
            ],
          })
        : undefined;

    const baseState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(triggerDef, {
            instanceId: "alice-source",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(stackMagicDef, {
            instanceId: "bob-stack-magic",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
        playerOverrides: [{ deckCount: 5 }],
      }),
      step: "main",
      activePlayerId: "alice",
      pendingTriggeredEffects: [
        {
          pendingId: "p3-29-lifo-pending",
          eventKind: "summon",
          actingPlayerId: "alice",
          source: "action_resolution",
          chainId: "test:p3-29-triggered-stack-window:314",
          attackId: null,
          relatedPlayerId: null,
          relatedInstanceId: "alice-source",
          amount: null,
          step: "main",
          window: "default",
          resolvedSourceInstanceIds: [],
        },
      ],
    };
    const beforeHand =
      baseState.players.find((p) => p.id === "alice")?.handCount ?? 0;

    const declaration = getLegalActions({
      state: baseState,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((a) => a.kind === "resolve_pending_triggered_effect")!;

    const declared = applyLegalAction({
      state: baseState,
      action: declaration,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;

    const bobStackAction = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredMagicActions: magicLookup,
    }).find(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "bob-stack-magic"
    );
    expect(bobStackAction).toBeDefined();

    const stacked = applyLegalAction({
      state: declared,
      action: bobStackAction!,
      paymentSources: [],
      getCardDefinitionById: lookup,
      getRegisteredMagicActions: magicLookup,
    }).state;

    expect(stacked.stackWindow?.pendingStackAction?.actionKind).toBe("magic");
    expect(
      stacked.stackWindow?.pendingStackAction?.previousPendingStackAction
        ?.actionKind
    ).toBe("triggered_effect");
    expect(stacked.stackWindow?.priorityPlayerId).toBe("alice");

    const alicePass = getLegalActions({
      state: stacked,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredMagicActions: magicLookup,
    }).find((a) => a.kind === "pass_stack")!;

    const resolved = applyLegalAction({
      state: stacked,
      action: alicePass,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredMagicActions: magicLookup,
      getHandWrittenEffectResolver: resolverLookup,
    }).state;

    const stackResolvedIndex = resolved.log.indexOf(
      "p3-29:lifo:triggered:bob-stack-resolved"
    );
    const drawResolvedIndex = resolved.log.indexOf("effect:draw:alice:1");
    expect(stackResolvedIndex).toBeGreaterThanOrEqual(0);
    expect(drawResolvedIndex).toBeGreaterThan(stackResolvedIndex);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "bob-stack-magic")
        ?.zone
    ).toBe("trash");
    expect(resolved.players.find((p) => p.id === "alice")?.handCount).toBe(
      beforeHand + 1
    );
  });
});
