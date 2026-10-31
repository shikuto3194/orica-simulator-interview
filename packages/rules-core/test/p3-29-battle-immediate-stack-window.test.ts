/**
 * P3-29 Phase 2: バトル即時効果の発揮宣言で battle flash sub-stack 窓が開くことを検証する。
 *
 * - resolve_battle_immediate_effect 発行時、resolver は即時実行されず ActiveStack
 *   (actionKind="battle_immediate_effect") を pendingStackAction に積んで stack 窓を開く。
 * - 相手の pass_battle_flash 1 回で窓がクローズし deferred resolver が走る。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState, RegisteredMagicAction } from "../src";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src/index";
import { buildBattleImmediateEffectLookup } from "../src/effect/structured-effect-registrations";

const fieldEffectLookup = (() => undefined) as Parameters<
  typeof getLegalActions
>[0]["getRegisteredFieldCardEffectActions"];

function makeAttackerWithDrawOnAttack(
  cardNo: string,
  options?: { usageLimit?: boolean }
): CardDefinition {
  return {
    cardNo,
    name: `P3-29 BI ${cardNo}`,
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
        timing: { kind: "card_event", event: "attack" },
        applicability: { zone: "field" },
        ...(options?.usageLimit
          ? { usageLimit: { kind: "per_instance", duration: "turn" } as const }
          : {}),
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
}

function makeStackMagic(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `P3-29 BI ${cardNo}`,
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

function setupAttackInProgress(def: CardDefinition): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(def, {
        instanceId: "alice-attacker",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
    ],
    playerOverrides: [{ deckCount: 5 }],
    battleEntities: [
      {
        entityId: "battle-entity:alice-attacker",
        memberInstanceIds: ["alice-attacker"],
        resolvedBp: 2000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "attack-group:1:alice:battle-entity:alice-attacker",
      primaryEntityId: "battle-entity:alice-attacker",
      participantEntityIds: ["battle-entity:alice-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:alice-attacker",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["battle-entity:alice-attacker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: null,
      },
    },
    battleImmediateEffects: [
      {
        promptId: "p3-29-bi-prompt-1",
        attackId: "attack-group:1:alice:battle-entity:alice-attacker",
        timing: "attack",
        sourceKind: "spirit",
        sourceInstanceId: "alice-attacker",
        sourceDefinitionId: def.cardNo,
        sourceCardNo: def.cardNo,
        actingPlayerId: "alice",
        participantEntityId: "battle-entity:alice-attacker",
        registrationIndex: 0,
      },
    ],
  });
  return {
    ...base,
    step: "attack",
    window: "flash_before_block",
    activePlayerId: "alice",
    turnNumber: 2,
  };
}

describe("P3-29 Phase 2: バトル即時効果の発揮宣言が battle flash sub-stack 窓を開く", () => {
  it("alice が resolve_battle_immediate_effect を発行すると stack_before_block 窓が開き、bob のパスで resolver が走る", () => {
    const def = makeAttackerWithDrawOnAttack("P3-29-BI-DRAW");
    const lookup = makeLookup([def]);
    const battleImmediateLookup = buildBattleImmediateEffectLookup([def]);

    const baseState = setupAttackInProgress(def);

    const aliceActions = getLegalActions({
      state: baseState,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    const declaration = aliceActions.find(
      (a) => a.kind === "resolve_battle_immediate_effect"
    );
    expect(declaration).toBeDefined();
    if (
      !declaration ||
      declaration.kind !== "resolve_battle_immediate_effect"
    ) {
      throw new Error("expected resolve_battle_immediate_effect");
    }

    const beforeHand =
      baseState.players.find((p) => p.id === "alice")?.handCount ?? 0;

    // 発揮宣言: 即時解決ではなく stack 窓が開く
    const declared = applyLegalAction({
      state: baseState,
      action: declaration,
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });

    expect(declared.state.window).toBe("stack_before_block");
    const flash = declared.state.activeAttack?.flashWindowState ?? null;
    expect(flash).not.toBeNull();
    expect(flash!.pendingStackAction).not.toBeNull();
    expect(flash!.pendingStackAction!.actionKind).toBe(
      "battle_immediate_effect"
    );
    expect(flash!.pendingStackAction!.cardInstanceId).toBe("alice-attacker");
    expect(flash!.priorityPlayerId).toBe("bob");
    // prompt は宣言段階で除去 (deferred resolver で再 insert)
    expect(declared.state.battleImmediateEffects).toHaveLength(0);
    // alice はまだドローしていない
    const aliceAfterDeclare = declared.state.players.find(
      (p) => p.id === "alice"
    )!;
    expect(aliceAfterDeclare.handCount).toBe(beforeHand);

    // 窓中の legal actions: alice には prompt 由来の resolve は出ない (pass を bob が握る)
    const aliceDuringWindow = getLegalActions({
      state: declared.state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    });
    expect(
      aliceDuringWindow.some(
        (a) => a.kind === "resolve_battle_immediate_effect"
      )
    ).toBe(false);

    // bob が pass → 1-pass close & deferred resolver 実行
    const bobPassActions = getLegalActions({
      state: declared.state,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    });
    const passAction = bobPassActions.find(
      (a) => a.kind === "pass_battle_flash"
    );
    expect(passAction).toBeDefined();

    const resolved = applyLegalAction({
      state: declared.state,
      action: passAction!,
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });

    // 窓は閉じ、prompt も無し、alice は draw 1 完了
    expect(resolved.state.window).not.toBe("stack_before_block");
    expect(resolved.state.battleImmediateEffects).toEqual([]);
    const aliceFinal = resolved.state.players.find((p) => p.id === "alice")!;
    expect(aliceFinal.handCount).toBe(beforeHand + 1);
  });

  it("stack 窓中に source が場を離れた deferred battle immediate を fizzle して drain する", () => {
    const def = makeAttackerWithDrawOnAttack("P3-29-BI-SOURCE-LEFT", {
      usageLimit: true,
    });
    const lookup = makeLookup([def]);
    const battleImmediateLookup = buildBattleImmediateEffectLookup([def]);
    const baseState = setupAttackInProgress(def);
    const declaration = getLegalActions({
      state: baseState,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find((action) => action.kind === "resolve_battle_immediate_effect")!;
    const declared = applyLegalAction({
      state: baseState,
      action: declaration,
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;
    expect(declared.effectUsageRecords).toHaveLength(1);
    const sourceLeftDuringStack: GameState = {
      ...declared,
      cardInstances: declared.cardInstances.map((card) =>
        card.instanceId === "alice-attacker" ? { ...card, zone: "trash" } : card
      ),
    };
    const passAction = getLegalActions({
      state: sourceLeftDuringStack,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    }).find((action) => action.kind === "pass_battle_flash");

    expect(passAction).toBeDefined();
    const resolved = applyLegalAction({
      state: sourceLeftDuringStack,
      action: passAction!,
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;

    expect(resolved.battleImmediateEffects).toEqual([]);
    expect(resolved.effectUsageRecords).toEqual([]);
    expect(resolved.log).toContain(
      "effect:effect-fizzled:battle:immediate:p3-29-bi-prompt-1:battle-immediate-source-not-on-field"
    );
  });

  it("発揮宣言時のログに battle:immediate:declared が記録される", () => {
    const def = makeAttackerWithDrawOnAttack("P3-29-BI-LOG");
    const lookup = makeLookup([def]);
    const battleImmediateLookup = buildBattleImmediateEffectLookup([def]);

    const baseState = setupAttackInProgress(def);

    const decl = getLegalActions({
      state: baseState,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find((a) => a.kind === "resolve_battle_immediate_effect")!;

    const declared = applyLegalAction({
      state: baseState,
      action: decl,
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });

    expect(
      declared.state.log.some((entry) =>
        entry.startsWith(
          "battle:immediate:declared:p3-29-bi-prompt-1:attack:alice"
        )
      )
    ).toBe(true);
    expect(
      declared.state.log.some((entry) =>
        entry.startsWith("battle:flash:stack:open:")
      )
    ).toBe(true);
  });

  it("bob の stack magic 割り込みを LIFO で解決してから battle immediate を解決する", () => {
    const def = makeAttackerWithDrawOnAttack("P3-29-BI-LIFO-DRAW");
    const stackMagicDef = makeStackMagic("P3-29-BI-LIFO-STACK-MAGIC");
    const lookup = makeLookup([def, stackMagicDef]);
    const battleImmediateLookup = buildBattleImmediateEffectLookup([def]);
    const magicLookup = makeMagicLookup({
      [stackMagicDef.cardNo]: {
        timing: "stack",
        reason: "p3_29_battle_immediate_lifo_response",
      },
    });
    const resolverLookup = (cardNo: string) =>
      cardNo === stackMagicDef.cardNo
        ? (currentState: GameState) => ({
            ...currentState,
            log: [
              ...currentState.log,
              "p3-29:lifo:battle-immediate:bob-stack-resolved",
            ],
          })
        : undefined;

    const baseAttackState = setupAttackInProgress(def);
    const baseState: GameState = {
      ...baseAttackState,
      cardInstances: [
        ...baseAttackState.cardInstances,
        createCardInstance(stackMagicDef, {
          instanceId: "bob-stack-magic",
          ownerPlayerId: "bob",
          zone: "hand",
        }),
      ],
    };
    const beforeHand =
      baseState.players.find((p) => p.id === "alice")?.handCount ?? 0;

    const declaration = getLegalActions({
      state: baseState,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find((a) => a.kind === "resolve_battle_immediate_effect")!;

    const declared = applyLegalAction({
      state: baseState,
      action: declaration,
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;

    const bobStackAction = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
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

    const pending = stacked.activeAttack?.flashWindowState?.pendingStackAction;
    expect(pending?.actionKind).toBe("magic");
    expect(pending?.previousPendingStackAction?.actionKind).toBe(
      "battle_immediate_effect"
    );
    expect(stacked.activeAttack?.flashWindowState?.priorityPlayerId).toBe(
      "alice"
    );

    const alicePass = getLegalActions({
      state: stacked,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredMagicActions: magicLookup,
    }).find((a) => a.kind === "pass_battle_flash")!;

    const resolved = applyLegalAction({
      state: stacked,
      action: alicePass,
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredMagicActions: magicLookup,
      getHandWrittenEffectResolver: resolverLookup,
    }).state;

    const stackResolvedIndex = resolved.log.indexOf(
      "p3-29:lifo:battle-immediate:bob-stack-resolved"
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
