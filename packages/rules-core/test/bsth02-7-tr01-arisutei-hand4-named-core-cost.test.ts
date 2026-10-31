/**
 * BSTH02.7-TR01(A) アリス邸 effects[1] Lv1『自分のメインステップ』
 *   原文 textLines[3,4]: 「〔ターンに1回:同名〕自分の手札が4枚以下のとき、自分の
 *     導界者ネクサスの「アリス」のコア1個をボイドに置くことで、自分はデッキの
 *     上から1枚ドローする。」
 *
 * 配線意図 ([[project_summon_effect_reactivation_pattern.md]] /
 *           [[project_card_name_reference_matching]]):
 * - 「手札4枚以下」= condition: hand_count(player:"self", max:4)
 * - 「〔ターンに1回:同名〕」= usageLimit per_card_name turn
 * - 発動コスト「アリスの導界者ネクサスのコア1個 → ボイド」= step0 core_move
 *   from:field_card(category:nexus + tribes:["導界者"] + targetsGrandwalker:true
 *   + cardName:[{contains:"アリス"}]) to:void amount:1
 *   - 「アリス」を含む 導界者 nexus ⇒ BSTH02.7-CX01「［魔導と叡智の契約者］
 *     アリス・マーガトロイド」(tribe: 導界者・起幻・導魔) と一致。
 * - 「〜することで」= step1 draw の connector:"conditional_cost"。コア不足 / 候補
 *   不在で step0 が rollback されたら step1 は実行されない。
 *
 * 検証:
 * - 構造: stub 無し / condition / steps / connector の SSOT shape。
 * - 成功路: アリス 導界者 nexus にコア1個 + 手札4枚 → draw 成立、コアがボイドへ。
 * - rollback: アリス 導界者 nexus が場に無い → step0 失敗で step1 (draw) 不発。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { generateFieldCardEffectRegistrations } from "../src/effect/structured-effect-registrations";

function drainOptionalStepsWithExecute(
  state: GameState,
  getDef: (id: string) => CardDefinition | undefined
): GameState {
  let s = state;
  while (s.pendingStepOptionalChoice !== null) {
    const psoc = s.pendingStepOptionalChoice;
    s = applyLegalAction({
      state: s,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
  }
  return s;
}

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

describe("BSTH02.7-TR01(A) アリス邸 — Lv1『自分のメインステップ』hand≤4 + アリス導界者コア1→ドロー", () => {
  const c = card("BSTH02.7-TR01(A)");
  const mainEffect = c.effects![1]!;

  it("構造: stub 解消・activated/main + hand_count(max:4) + core_move(アリス導界者→void) + draw(conditional_cost)", () => {
    expect(mainEffect.stub).toBeUndefined();
    expect(mainEffect.timing).toEqual({ kind: "activated", mode: "main" });
    expect(mainEffect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(mainEffect.condition).toEqual([
      { kind: "hand_count", player: "self", max: 4 },
    ]);

    const costStep = mainEffect.steps[0]!;
    expect(costStep.action.kind).toBe("core_move");
    if (costStep.action.kind === "core_move") {
      expect(costStep.action.from).toEqual({
        kind: "field_card",
        player: "self",
        filter: {
          category: ["nexus"],
          tribes: ["導界者"],
          targetsGrandwalker: true,
          cardName: [{ contains: "アリス" }],
        },
      });
      expect(costStep.action.to).toEqual({ kind: "void", player: "self" });
      expect(costStep.action.amount).toBe(1);
    }

    const drawStep = mainEffect.steps[1]!;
    expect(drawStep.connector).toBe("conditional_cost");
    expect(drawStep.action.kind).toBe("draw");
    if (drawStep.action.kind === "draw") {
      expect(drawStep.action.count).toBe(1);
    }
  });

  it("転醒構造: 転醒に内蔵したコア配置でB面の維持コアを補う", () => {
    const rebirthEffect = c.effects![0]!;
    expect(rebirthEffect.executionMode).toBe("optional");
    expect(rebirthEffect.steps).toEqual([
      {
        action: {
          kind: "rebirth",
          maxCount: 9,
          allowPostRebirthCorePlacementForLvDeficit: true,
          postRebirthChoice: {
            kind: "core_distribute",
            minimum: "back_face_lv",
          },
        },
      },
    ]);
  });

  it("[board] 0コアのアリス邸でも、転醒後に1コア置けるなら転醒成功する", () => {
    const rebirthEffect = c.effects![0]!;
    const src = createCardInstance(c, {
      instanceId: "alice-tei-rebirth",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [
        { reserveNormalCoreCount: 1, voidNormalCoreCount: 10 },
        {},
      ],
    });

    const afterRebirth = executeEffect({
      chainId: "test:bsth02-7-tr01-arisutei-hand4-named-core-cost:148",
      state: before,
      effect: rebirthEffect,
      sourceInstanceId: "alice-tei-rebirth",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const virtualBeforePlacement = afterRebirth.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "alice-tei-rebirth"
    )!;
    expect(virtualBeforePlacement.zone).toBe("field");
    expect(virtualBeforePlacement.definitionId).toBe("BSTH02.7-TR01(A)");
    expect(virtualBeforePlacement.normalCoreCount).toBe(0);
    expect(afterRebirth.pendingCoreDistribution).toMatchObject({
      fromKind: "any_movable",
      rebirthCompletion: {
        sourceInstanceId: "alice-tei-rebirth",
        actingPlayerId: ALICE,
      },
      rollbackIfBelowMinTotal: {
        minTotal: 1,
        reason: "rebirth_minimum_core",
      },
    });
    expect(alice(afterRebirth).countValue).toBe(0);

    const resolveAction = getLegalActions({
      state: afterRebirth,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).find((action) => action.kind === "resolve_pending_core_distribution");
    expect(resolveAction).toBeDefined();

    const resolved = applyLegalAction({
      state: afterRebirth,
      action: resolveAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      coreDistributionAllocations: { "alice-tei-rebirth": 1 },
      coreDistributionSourceAllocations: { reserve: 1 },
    }).state;

    const flipped = resolved.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "alice-tei-rebirth"
    )!;
    expect(flipped.definitionId).toBe("BSTH02.7-TR01(B)");
    expect(flipped.normalCoreCount).toBe(1);
    expect(alice(resolved).countValue).toBe(1);
    expect(alice(resolved).reserveNormalCoreCount).toBe(0);
  });

  it("[board] 転醒後に最低Lvコアを置かなければ、countは増えずA面でトラッシュへ行く", () => {
    const rebirthEffect = c.effects![0]!;
    const src = createCardInstance(c, {
      instanceId: "alice-tei-rebirth-rollback",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [
        { reserveNormalCoreCount: 1, voidNormalCoreCount: 10 },
        {},
      ],
    });

    const afterRebirth = executeEffect({
      chainId: "test:bsth02-7-tr01-arisutei-hand4-named-core-cost:218",
      state: before,
      effect: rebirthEffect,
      sourceInstanceId: "alice-tei-rebirth-rollback",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const resolveAction = getLegalActions({
      state: afterRebirth,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).find((action) => action.kind === "resolve_pending_core_distribution");
    expect(resolveAction).toBeDefined();

    const resolved = applyLegalAction({
      state: afterRebirth,
      action: resolveAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      coreDistributionAllocations: {},
    }).state;

    const cardAfterFailure = resolved.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "alice-tei-rebirth-rollback"
    )!;
    expect(cardAfterFailure.definitionId).toBe("BSTH02.7-TR01(A)");
    expect(cardAfterFailure.zone).toBe("field");
    expect(cardAfterFailure.normalCoreCount).toBe(0);
    expect(alice(resolved).countValue).toBe(0);
    expect(alice(resolved).reserveNormalCoreCount).toBe(1);
    expect(
      resolved.log.some(
        (entry) =>
          entry.includes("rebirth-post-choice-cancelled") &&
          entry.includes("reason=rebirth_minimum_core:placed=0<1")
      )
    ).toBe(true);
  });

  it("[board] 転醒後に最低Lvコアを置く候補が無い場合、仮想転醒を確定せずA面のまま残る", () => {
    const rebirthEffect = c.effects![0]!;
    const src = createCardInstance(c, {
      instanceId: "alice-tei-rebirth-no-core",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const before = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [
        { reserveNormalCoreCount: 0, voidNormalCoreCount: 10 },
        {},
      ],
    });

    const resolved = executeEffect({
      chainId: "test:bsth02-7-tr01-arisutei-hand4-named-core-cost:275",
      state: before,
      effect: rebirthEffect,
      sourceInstanceId: "alice-tei-rebirth-no-core",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const cardAfterFailure = resolved.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "alice-tei-rebirth-no-core"
    )!;
    expect(cardAfterFailure.definitionId).toBe("BSTH02.7-TR01(A)");
    expect(cardAfterFailure.zone).toBe("field");
    expect(cardAfterFailure.normalCoreCount).toBe(0);
    expect(cardAfterFailure.pendingLeaveKind).toBeNull();
    expect(cardAfterFailure.pendingLeaveChainId).toBeNull();
    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(alice(resolved).countValue).toBe(0);
    expect(
      resolved.log.some((entry) =>
        entry.includes(
          "effect:rebirth:alice-tei-rebirth-no-core:post-choice-no-core:min=1"
        )
      )
    ).toBe(true);
  });

  it("[board] アリス導界者ネクサス(CX01) にコア1個 → コアがボイドへ + デッキ上1枚ドロー", () => {
    // BSTH02.7-CX01「［魔導と叡智の契約者］アリス・マーガトロイド」= 唯一の「アリス」を含む
    //   導界者 nexus (tribe: 導界者・起幻・導魔)。
    const src = createCardInstance(c, {
      instanceId: "alice-tei",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const arisuNexus = createCardInstance(card("BSTH02.7-CX01"), {
      instanceId: "alice-cx01",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const deckTop = createCardInstance(card("BSTH001-R01"), {
      instanceId: "alice-deck-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before = createEmptyGameState({
      cardInstances: [src, arisuNexus, deckTop],
      playerOverrides: [
        // 手札 0 枚 (4 枚以下を満たす)、デッキ 1 枚、ボイド/ライフ 0 枚。
        { handCount: 0, deckCount: 1, voidNormalCoreCount: 0 },
        {},
      ],
    });
    const after = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bsth02-7-tr01-arisutei-hand4-named-core-cost:331",
        state: before,
        effect: mainEffect,
        sourceInstanceId: "alice-tei",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );

    // step0: アリス nexus のコア1個 → ボイド。
    expect(
      after.cardInstances.find((x) => x.instanceId === "alice-cx01")!
        .normalCoreCount
    ).toBe(0);
    expect(alice(after).voidNormalCoreCount).toBe(1);
    // step1 (conditional_cost): デッキ上1枚を手札へ。
    expect(alice(after).deckCount).toBe(0);
    expect(alice(after).handCount).toBe(1);
    expect(
      after.cardInstances.find((x) => x.instanceId === "alice-deck-1")!.zone
    ).toBe("hand");
  });

  it("[registration] generateFieldCardEffectRegistrations が effect.condition (hand_count max:4) と usageLimit (per_card_name turn) を伝搬する — availability-gate の機械配線確認", () => {
    // legal-actions-availability.ts:2145-2157 が actionRegistration.condition を
    //   evaluateCondition で gate する SSOT 経路 (注: effect.condition は
    //   structured-effect-registrations.ts:2507-2509 で actionRegistration.condition
    //   へ転写される)。本テストは転写が壊れたら fail する (verifier round 1 lens 5 (a) 対策)。
    const regs = generateFieldCardEffectRegistrations(c);
    const mainReg = regs.find(
      (r) => r.effectIndex === 1 && r.timing === "normal"
    );
    expect(mainReg).toBeDefined();
    expect(mainReg!.condition).toEqual([
      { kind: "hand_count", player: "self", max: 4 },
    ]);
    expect(mainReg!.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
  });

  it("[board] アリス導界者ネクサスにソウルコアのみ (normal=0) → ボイドへの core_move 候補化されず → conditional_cost で draw スキップ + ソウルコア残置", () => {
    // [[project_soul_core_movement_generic]] 「硬制約はボイド不可のみ」: void destination
    //   ではソウルコアは含めない (structured-effect-interpreter.ts:2883-2886
    //   allowSoulCoreMove は to.kind ∈ {this_card, card_instance} のみ true)。
    //   `aliceNexus.normalCoreCount=0` + 自分のソウルコアを alice-cx01 上に置いた状態で
    //   step0 が候補化失敗 → step1 (draw) も発火しないことを確認。さらに alice の
    //   PlayerState.soulCoreLocation が `{kind:'card', instanceId:'alice-cx01'}` のまま
    //   保持されることも assert する (= ソウルコアがボイドに流れていない直接確認)。
    //   verifier round 2 lens 5(c) fix: GameState ではなく PlayerState 側に soulCoreLocation
    //   を置く SSOT 経路で検証する。
    const src = createCardInstance(c, {
      instanceId: "alice-tei",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const arisuNexus = createCardInstance(card("BSTH02.7-CX01"), {
      instanceId: "alice-cx01",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const deckTop = createCardInstance(card("BSTH001-R01"), {
      instanceId: "alice-deck-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before = createEmptyGameState({
      cardInstances: [src, arisuNexus, deckTop],
      startingVoidNormalCoreCount: 0,
      playerOverrides: [
        {
          handCount: 0,
          deckCount: 1,
          soulCoreLocation: { kind: "card", instanceId: "alice-cx01" },
        },
        {},
      ],
    });
    const after = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bsth02-7-tr01-arisutei-hand4-named-core-cost:414",
        state: before,
        effect: mainEffect,
        sourceInstanceId: "alice-tei",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );

    // step0 (core_move → void) 不成立 → conditional_cost で step1 (draw) も skip。
    expect(alice(after).voidNormalCoreCount).toBe(0);
    expect(alice(after).deckCount).toBe(1);
    expect(alice(after).handCount).toBe(0);
    expect(
      after.cardInstances.find((x) => x.instanceId === "alice-deck-1")!.zone
    ).toBe("deck");
    // ソウルコアは alice-cx01 上に残置 (= ボイド destination に流れていない直接確認)。
    expect(alice(after).soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "alice-cx01",
    });
  });

  it("[board] アリス導界者ネクサスが場に無い → step0 core_move 不発 → conditional_cost で draw もスキップ", () => {
    // 「アリス」を含まない 導界者 nexus が居ても、cardName:[{contains:"アリス"}]
    //   フィルタで候補化されない (BSTH02-CX01 とは別カードと仮定)。本テストでは導界者
    //   nexus を一切置かない最小ケースで検証する。
    const src = createCardInstance(c, {
      instanceId: "alice-tei",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const deckTop = createCardInstance(card("BSTH001-R01"), {
      instanceId: "alice-deck-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before = createEmptyGameState({
      cardInstances: [src, deckTop],
      startingVoidNormalCoreCount: 0,
      playerOverrides: [{ handCount: 0, deckCount: 1 }, {}],
    });
    const after = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bsth02-7-tr01-arisutei-hand4-named-core-cost:459",
        state: before,
        effect: mainEffect,
        sourceInstanceId: "alice-tei",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );

    // step0 不成立 → ボイドへ流入なし。
    expect(alice(after).voidNormalCoreCount).toBe(0);
    // conditional_cost ガード → draw されない。
    expect(alice(after).deckCount).toBe(1);
    expect(alice(after).handCount).toBe(0);
    expect(
      after.cardInstances.find((x) => x.instanceId === "alice-deck-1")!.zone
    ).toBe("deck");
  });
});
