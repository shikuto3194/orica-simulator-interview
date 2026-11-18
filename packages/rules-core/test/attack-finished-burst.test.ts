/**
 * 構造化 BurstTrigger `attack_finished`（「相手のスピリット／アルティメットのアタック後」）の
 * end-to-end 検証。
 *
 * - mapBurstTriggerToEventKind が attack_finished → attack_after（既存 firing 経路を流用）、
 *   mapBurstTriggerToWhose が player をそのまま whose に伝搬することを、実カードの
 *   registration（buildBurstEffectLookup(ALL_CARDS)）で確認する。
 * - BSTH003-X02「[夢時空]霧雨 魔梨沙」: 相手アタック後にコストを支払わず自身を召喚する
 *   バーストが宣言可能になり、解決すると burst → field へ移ることを盤面で確認する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildBurstEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);
const noLookup = (_: string) => undefined;

describe("attack_finished burst registration（実カード）", () => {
  it.each(["BSTH003-X02", "BSTH09-M02"])(
    "%s は attack_after (whose: opponent) の burst registration を持つ",
    (cardNo) => {
      const regs = getRegisteredBurstActions(cardNo) ?? [];
      const attackAfter = regs.filter((r) => r.eventKind === "attack_after");
      expect(attackAfter.length).toBeGreaterThanOrEqual(1);
      expect(attackAfter[0]?.whose).toBe("opponent");
    }
  );
});

describe("BSTH003 の attack_finished バースト: 無料自己召喚 carrier", () => {
  it.each([
    ["BSTH003-M03", 1],
    ["BSTH003-X02", 1],
  ] as const)(
    "%s は『コストを支払わずに召喚する』を costModifier:free で表す",
    (cardNo, effectIndex) => {
      const effect = getCardDefinitionById(cardNo)!.effects![effectIndex]!;
      const summonStep = effect.steps.find(
        (step) => step.action.kind === "summon"
      );

      expect(summonStep?.action).toMatchObject({
        kind: "summon",
        target: { kind: "self" },
        costModifier: "free",
      });
    }
  );
});

describe("attack_finished burst end-to-end: BSTH003-X02 自己召喚", () => {
  function buildScenario(): GameState {
    const 魔梨沙 = createCardInstance(getCardDefinitionById("BSTH003-X02")!, {
      instanceId: "marisa-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const bobAttacker = createCardInstance(
      getCardDefinitionById("BSTH09-M02")!,
      {
        // 任意の spirit を相手アタッカーに流用（バースト発動主体ではない）。
        instanceId: "bob-attacker",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }
    );
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        // 無料なのは召喚コストだけ。Lv1の場入りに必要な1コアは別途供給し、pendingMultiPlacementまで完走させる。
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 1 },
        { lifeNormalCoreCount: 5 },
      ],
    });
    return {
      ...base,
      turnNumber: 4,
      activePlayerId: "bob",
      step: "attack",
      window: "none",
      activeAttack: {
        attackId: "attack-1",
        attackerInstanceId: "bob-attacker",
        defenderPlayerId: "alice",
        blockerInstanceId: null,
        cardEventChainId: null,
        windowState: "battle_resolution",
      } as GameState["activeAttack"],
      cardInstances: [魔梨沙, bobAttacker],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "marisa-burst" }],
      pendingBurstChecks: [
        {
          checkId: "attack-after-1",
          actingPlayerId: "alice",
          eventKind: "attack_after",
          source: "battle_resolution",
          chainId: "test:attack-finished-burst:106",
          attackId: "attack-1",
          relatedPlayerId: "bob",
          amount: 0,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    };
  }

  function findBurstDeclaration(
    state: GameState,
    sourceInstanceId = "marisa-burst"
  ) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredBurstActions,
    }).find(
      (a): a is Extract<LegalAction, { kind: "resolve_pending_burst_check" }> =>
        a.kind === "resolve_pending_burst_check" &&
        a.sourceInstanceId === sourceInstanceId
    );
  }

  function resolveBurstDeclaration(state: GameState, action: LegalAction) {
    const afterDeclaration = applyLegalAction({
      state,
      action,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver: noLookup,
    }).state;
    expect(afterDeclaration.stackWindow?.burstWindowKind).toBe("activation");

    const activationPass = getLegalActions({
      state: afterDeclaration,
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredBurstActions,
    }).find((a) => a.kind === "pass_stack");
    expect(activationPass).toBeDefined();
    const afterActivationPass = applyLegalAction({
      state: afterDeclaration,
      action: activationPass!,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver: noLookup,
    }).state;
    expect(afterActivationPass.stackWindow?.burstWindowKind).toBe(
      "effect_declaration"
    );

    const effectDeclarationPass = getLegalActions({
      state: afterActivationPass,
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredBurstActions,
    }).find((a) => a.kind === "pass_stack");
    expect(effectDeclarationPass).toBeDefined();
    return applyLegalAction({
      state: afterActivationPass,
      action: effectDeclarationPass!,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver: noLookup,
    });
  }

  function resolvePendingTarget(state: GameState, targetInstanceIds: string[]) {
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredBurstActions,
    }).find(
      (
        candidate
      ): candidate is Extract<
        LegalAction,
        { kind: "resolve_pending_effect_target" }
      > => candidate.kind === "resolve_pending_effect_target"
    );
    expect(action).toBeDefined();
    for (const targetInstanceId of targetInstanceIds) {
      expect(action?.candidateTargetInstanceIds).toContain(targetInstanceId);
    }
    if (!action) throw new Error("expected a pending effect target action");

    return applyLegalAction({
      state,
      action,
      targetInstanceIds,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver: noLookup,
    }).state;
  }

  function resolveMandatoryPlacement(
    state: GameState,
    destinationInstanceId: string
  ) {
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredBurstActions,
    }).find(
      (
        candidate
      ): candidate is Extract<
        LegalAction,
        { kind: "resolve_pending_multi_placement" }
      > => candidate.kind === "resolve_pending_multi_placement"
    );
    expect(action).toBeDefined();
    expect(action?.targets.map((target) => target.instanceId)).toContain(
      destinationInstanceId
    );
    if (!action) throw new Error("expected a pending multi-placement action");

    return applyLegalAction({
      state,
      action,
      multiPlacementAllocations: [
        {
          destinationInstanceId,
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver: noLookup,
    }).state;
  }

  it("相手アタック後に召喚コストの支払い用コアがなくてもバースト宣言が提示され、無料で burst→field へ召喚される", () => {
    const initial = buildScenario();
    const decl = findBurstDeclaration(initial);
    expect(decl).toBeDefined();

    const staged = resolveBurstDeclaration(initial, decl!).state;
    const result = resolveMandatoryPlacement(staged, "marisa-burst");

    // バーストはセット状態から外れ、本体はLv1場入りコアも含めて場へ召喚される（最終盤面変化）。
    expect(
      result.setBurstStates.some((b) => b.cardInstanceId === "marisa-burst")
    ).toBe(false);
    const marisa = result.cardInstances.find(
      (c) => c.instanceId === "marisa-burst"
    );
    expect(marisa?.zone).toBe("field");
    expect(marisa?.normalCoreCount).toBe(1);
    expect(result.pendingMultiPlacement).toBeNull();
    expect(
      result.log.some(
        (entry) =>
          entry.startsWith("effect:summon:marisa-burst:") &&
          entry.includes(":cost=0")
      )
    ).toBe(true);
    expect(
      result.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(0);
  });

  it("BSTH003-M03 は創界神ネクサス2つから各6コアを移し、Lv1コアを置いて無料で自己召喚する", () => {
    const base = buildScenario();
    const reimu = createCardInstance(getCardDefinitionById("BSTH003-M03")!, {
      instanceId: "reimu-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const firstGrandwalker = createCardInstance(
      getCardDefinitionById("BSTH003-X03")!,
      {
        instanceId: "bob-grandwalker-1",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 6,
      }
    );
    const secondGrandwalker = createCardInstance(
      getCardDefinitionById("BSTH003-X03")!,
      {
        instanceId: "bob-grandwalker-2",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 6,
      }
    );
    const initial: GameState = {
      ...base,
      cardInstances: [
        reimu,
        ...base.cardInstances.filter(
          (card) => card.instanceId !== "marisa-burst"
        ),
        firstGrandwalker,
        secondGrandwalker,
      ],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "reimu-burst" }],
    };
    const decl = findBurstDeclaration(initial, "reimu-burst");
    expect(decl).toBeDefined();
    const bobVoidBefore = initial.players.find(
      (player) => player.id === "bob"
    )!.voidNormalCoreCount;

    let resolved = resolveBurstDeclaration(initial, decl!).state;
    resolved = resolvePendingTarget(resolved, [
      "bob-grandwalker-1",
      "bob-grandwalker-2",
    ]);
    resolved = resolveMandatoryPlacement(resolved, "reimu-burst");

    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "bob-grandwalker-2"
      )?.normalCoreCount
    ).toBe(0);
    expect(
      resolved.players.find((player) => player.id === "bob")
        ?.voidNormalCoreCount
    ).toBe(bobVoidBefore + 12);
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "reimu-burst")
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expect(resolved.pendingEffectTargetSelection).toBeNull();
    expect(resolved.pendingMultiPlacement).toBeNull();
    expect(
      resolved.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(0);
    expect(
      resolved.log.some(
        (entry) =>
          entry.startsWith("effect:summon:reimu-burst:") &&
          entry.includes(":cost=0")
      )
    ).toBe(true);
  });
});

/**
 * 負の系（require_related_instance_on_field）:
 * 「相手のスピリットのアタック後」バーストは、解決前にアタッカーがフィールドを離れていた
 * 場合は発動できない（公式 2024-03-30 改定。source-findings-official-battle-brave-burst.md §3）。
 *
 * 例: 『このスピリットのアタック時』このスピリットを手札に戻せる、で攻撃側が自身を手札へ
 * 戻すと、後続のバースト発動タイミングにアタッカー不在 → attack_after の structured event は
 * validationMode "require_related_instance_on_field"（trigger-system.ts）で発動候補を弾く。
 *
 * 上の positive 系は pendingBurstCheck に relatedInstanceId を持たないため guard を素通りする
 * （relatedInstanceId != null が false）。ここでは production 経路と同形に relatedInstanceId を
 * セットし、アタッカー在/不在で発動可否が切り替わることを固定する。
 */
describe("attack_finished burst guard: アタッカー離脱で不発", () => {
  function buildScenario(attackerZone: "field" | "hand"): GameState {
    const 魔梨沙 = createCardInstance(getCardDefinitionById("BSTH003-X02")!, {
      instanceId: "marisa-burst",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const bobAttacker = createCardInstance(
      getCardDefinitionById("BSTH09-M02")!,
      {
        instanceId: "bob-attacker",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: attackerZone,
        normalCoreCount: attackerZone === "field" ? 1 : 0,
      }
    );
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 4 },
        { lifeNormalCoreCount: 5 },
      ],
    });
    return {
      ...base,
      turnNumber: 4,
      activePlayerId: "bob",
      step: "attack",
      window: "none",
      activeAttack: {
        attackId: "attack-1",
        attackerInstanceId: "bob-attacker",
        defenderPlayerId: "alice",
        blockerInstanceId: null,
        cardEventChainId: null,
        windowState: "battle_resolution",
      } as GameState["activeAttack"],
      cardInstances: [魔梨沙, bobAttacker],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "marisa-burst" }],
      pendingBurstChecks: [
        {
          checkId: "attack-after-1",
          actingPlayerId: "alice",
          eventKind: "attack_after",
          source: "battle_resolution",
          chainId: "test:attack-finished-burst:438",
          attackId: "attack-1",
          relatedPlayerId: "bob",
          // production 経路（maybeQueueAttackAfterBurstCheck）と同形にアタッカーを関連付ける。
          relatedInstanceId: "bob-attacker",
          amount: 0,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    };
  }

  function findBurstDeclaration(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredBurstActions,
    }).find(
      (a): a is Extract<LegalAction, { kind: "resolve_pending_burst_check" }> =>
        a.kind === "resolve_pending_burst_check" &&
        a.sourceInstanceId === "marisa-burst"
    );
  }

  it("アタッカーが場に残っていればバースト宣言が提示される（対照）", () => {
    expect(findBurstDeclaration(buildScenario("field"))).toBeDefined();
  });

  it("アタッカーが手札へ戻っていればバースト宣言は提示されない（不発）", () => {
    expect(findBurstDeclaration(buildScenario("hand"))).toBeUndefined();
  });
});
