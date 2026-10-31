/**
 * BSTH03-M01「[永夜抄]博麗 霊夢」Lv5『このアルティメットのアタック時』効果。
 *
 * 「このアルティメットはブロックされず、アルティメットとして扱わない。」
 * - ブロック不可: 既存 unblockable action (実装済み)。
 * - 「アルティメットとして扱わない」: engine-category-negation-override で新設した
 *   override_properties.properties.excludeCategory を使い、getEffectiveCategory が
 *   印字 category (ultimate) と一致する間だけ undefined を返すようにする
 *   (=「アルティメット」を対象とする相手の効果・フィルタにマッチしなくなる)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { getEffectiveCategory } from "../src/mechanics/act-as-spirit";
import { matchesCardFilter } from "../src/card/card-filter";
import { executeBattleResolution, buildTriggeredEffectLookup } from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";

describe("BSTH03-M01 Lv5 アタック時: ブロック不可 + アルティメットとして扱わない", () => {
  const def = getCardDefinitionById("BSTH03-M01")!;
  const attackEffect = def.effects![1]!;

  it("effect 定義: unblockable + override_properties(excludeCategory:ultimate) の2ステップ", () => {
    expect(attackEffect.condition).toEqual([{ kind: "min_level", value: 5 }]);
    expect(attackEffect.steps).toHaveLength(2);
    expect(attackEffect.steps[1]!.action).toMatchObject({
      kind: "override_properties",
      target: { kind: "self" },
      properties: { excludeCategory: "ultimate" },
    });
    expect(attackEffect.stub).toBeUndefined();
  });

  it("解決後: このカードは getEffectiveCategory が undefined になり、category:['ultimate'] フィルタにマッチしなくなる", () => {
    const reimu = createCardInstance(def, {
      instanceId: "reimu-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      cores: 6,
    });
    const before: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [reimu],
      activePlayerId: ALICE,
      step: "attack",
      window: "none",
    };

    const after = executeEffect({
      chainId: "test:bsth03-m01-attack-category-negation:59",
      state: before,
      effect: attackEffect,
      sourceInstanceId: reimu.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    const card = after.cardInstances.find((c) => c.instanceId === "reimu-1")!;
    expect(getEffectiveCategory(after, card, def)).toBeUndefined();
    expect(
      matchesCardFilter(card, def, { category: ["ultimate"] }, { state: after })
    ).toBe(false);
    // 印字 category そのものを破壊してはいない (定義は変わらず ultimate のまま)。
    expect(def.printedCategory).toBe("ultimate");
  });

  it("excludeCategory 適用中でも、このアルティメット自身がバトルで相手を破壊した勝者トリガー(battle_destroy_opponent_only)は抑制されない (adversarial verifier round2 refute対応)", () => {
    const reimu = createCardInstance(def, {
      instanceId: "reimu-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 6,
    });
    const before: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      cardInstances: [reimu],
      activePlayerId: ALICE,
      step: "attack",
      window: "none",
    };

    // アタック時効果を発揮し、excludeCategory:"ultimate" CE を自身へ適用する
    // (このカードは battle 解決の間もずっと「アルティメットとして扱わない」状態)。
    const afterEffect = executeEffect({
      chainId: "test:bsth03-m01-attack-category-negation:94",
      state: before,
      effect: attackEffect,
      sourceInstanceId: reimu.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(
      getEffectiveCategory(
        afterEffect,
        afterEffect.cardInstances.find((c) => c.instanceId === "reimu-1")!,
        def
      )
    ).toBeUndefined();

    const blockerDef: CardDefinition = {
      cardNo: "BSTH03-M01-TEST-BLOCKER",
      name: "M01 battle blocker",
      printedCategory: "spirit",
      printedColors: ["red"],
      symbolColors: ["red"],
      printedCost: 3,
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      textLines: [],
      images: {},
      colors: ["red"],
    };
    const blocker = createCardInstance(blockerDef, {
      instanceId: "blocker-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    // BSTH03-M01 自身が「自分がバトルで相手だけ破壊したとき」トリガーを観測できるかを
    // 確認するため、本テスト専用に effects を1件追加した variant を使う (excludeCategory は
    // 印字 category と一致する間だけ undefined を返す override であり、このカード自身の
    // effects 定義には影響しない、model.ts / getEffectiveCategory 参照)。
    const defWithObserver: CardDefinition = {
      ...def,
      effects: [
        ...(def.effects ?? []),
        {
          timing: { kind: "card_event", event: "battle_destroy_opponent_only" },
          executionMode: "optional",
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        },
      ],
    };
    const getDefWithBlocker = (id: string): CardDefinition | undefined => {
      if (id === blockerDef.cardNo) return blockerDef;
      if (id === def.cardNo) return defWithObserver;
      return getCardDefinitionById(id);
    };
    const triggeredLookup = buildTriggeredEffectLookup([
      defWithObserver,
      blockerDef,
    ]);

    const battleState: GameState = {
      ...afterEffect,
      cardInstances: [...afterEffect.cardInstances, blocker],
      step: "attack",
      window: "none",
      activeAttack: {
        attackId: "attack-m01",
        primaryEntityId: "battle-entity:reimu-1",
        participantEntityIds: ["battle-entity:reimu-1"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:reimu-1",
            blockedByEntityIds: ["battle-entity:blocker-1"],
          },
        ],
        symbolResolutionOrder: ["battle-entity:reimu-1"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "battle-entity:reimu-1",
          memberInstanceIds: ["reimu-1"],
          resolvedBp: 23000,
          resolvedSymbols: [],
          attackState: "attacking",
        },
        {
          entityId: "battle-entity:blocker-1",
          memberInstanceIds: ["blocker-1"],
          resolvedBp: 1000,
          resolvedSymbols: ["red"],
          attackState: "blocking",
        },
      ],
    };

    const resolved = executeBattleResolution({
      state: battleState,
      getCardDefinitionById: getDefWithBlocker,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: () => [],
    }).state;

    expect(
      resolved.cardInstances.find((c) => c.instanceId === "blocker-1")!.zone
    ).toBe("trash");
    expect(resolved.pendingTriggeredEffects).toContainEqual(
      expect.objectContaining({
        eventKind: "battle_destroy_opponent_only",
        relatedInstanceId: "reimu-1",
        relatedInstanceIds: ["blocker-1"],
      })
    );
  });
});
