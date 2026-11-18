/**
 * P3-51 検証: 同一 timing で複数 effect を持つカードの battle-immediate 解決時、
 * resolve した registration の effectIndex 以外の effect が誤発動しないこと。
 *
 * 検証カード（合成）:
 *   effects[0]: attack 時 → draw 1 (mandatory)
 *   effects[1]: attack 時 → 自身回復 (recover, mandatory)
 *
 * registrationIndex=1 (recover) を resolve したとき、draw が走らないことを確認する。
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

const noMagicLookup = (() => undefined) as (
  cardNo: string
) => readonly RegisteredMagicAction[] | undefined;

function makeAttackerWithDualAttackEffects(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `P3-51 dual ${cardNo}`,
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
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
      {
        timing: { kind: "card_event", event: "attack" },
        applicability: { zone: "field" },
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
      },
    ],
  };
}

function setupAttackWithDualPrompts(def: CardDefinition): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(def, {
        instanceId: "alice-attacker",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
        exhaustState: "exhausted",
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
        promptId: "p3-51-prompt-1",
        attackId: "attack-group:1:alice:battle-entity:alice-attacker",
        timing: "attack",
        sourceKind: "spirit",
        sourceInstanceId: "alice-attacker",
        sourceDefinitionId: def.cardNo,
        sourceCardNo: def.cardNo,
        actingPlayerId: "alice",
        participantEntityId: "battle-entity:alice-attacker",
        registrationIndex: 1,
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

describe("P3-51: battle-immediate 解決時の effectIndex isolation", () => {
  it("registrationIndex=1 (recover) を resolve しても effects[0] (draw) は発動しない", () => {
    const def = makeAttackerWithDualAttackEffects("P3-51-DUAL");
    const lookup = (id: string) => (id === def.cardNo ? def : undefined);
    const battleImmediateLookup = buildBattleImmediateEffectLookup([def]);

    const baseState = setupAttackWithDualPrompts(def);
    const beforeHand =
      baseState.players.find((p) => p.id === "alice")?.handCount ?? 0;
    const beforeAttacker = baseState.cardInstances.find(
      (c) => c.instanceId === "alice-attacker"
    )!;
    expect(beforeAttacker.exhaustState).toBe("exhausted");

    // alice に出ている resolve_battle_immediate_effect から prompt-1 を resolve
    const aliceActions = getLegalActions({
      state: baseState,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredMagicActions: noMagicLookup,
    });
    const declarePrompt1 = aliceActions.find(
      (a) =>
        a.kind === "resolve_battle_immediate_effect" &&
        "promptId" in a &&
        (a as { promptId?: string }).promptId === "p3-51-prompt-1"
    );
    expect(declarePrompt1).toBeDefined();

    // 宣言 → stack open → bob が pass → resolver が走る
    const afterDeclare = applyLegalAction({
      state: baseState,
      action: declarePrompt1!,
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });

    const bobPass = getLegalActions({
      state: afterDeclare.state,
      actingPlayerId: "bob",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredMagicActions: noMagicLookup,
    }).find((a) => a.kind === "pass_battle_flash")!;

    const afterResolve = applyLegalAction({
      state: afterDeclare.state,
      action: bobPass,
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });

    const aliceFinal = afterResolve.state.players.find(
      (p) => p.id === "alice"
    )!;
    const attackerFinal = afterResolve.state.cardInstances.find(
      (c) => c.instanceId === "alice-attacker"
    )!;

    // effects[1] (recover) 発動: exhausted → recovered
    expect(attackerFinal.exhaustState).toBe("recovered");
    // effects[0] (draw) は発動しない: 手札枚数据え置き
    expect(aliceFinal.handCount).toBe(beforeHand);
    // ログ: draw が含まれない
    expect(
      afterResolve.state.log.some((entry) =>
        entry.startsWith("effect:draw:alice")
      )
    ).toBe(false);
    // ログ: recover が含まれる
    expect(
      afterResolve.state.log.some((entry) => entry.includes("recover"))
    ).toBe(true);
  });
});
