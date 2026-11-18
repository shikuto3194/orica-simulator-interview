/**
 * BSTH02-C02 / BSTH02-C21 / BSTH02-R11 shape 検証。
 *
 * これらは effects に stub を残す未完成カード（変換待ち）。
 * BSTH02.ts に他カード (BSTH02-M02) の改修を加えると check:card-test-coverage の
 * changed-only モードが「同ファイル内の全 cardNo」を対象にするため、本ファイルが
 * test 参照を補完する役割を持つ。assert は印字情報と effect 構造（stub の存在含む）
 * のみで、実装が進んだら shape を強化する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  BattleEntity,
  BattleResolutionGroup,
  CardDefinition,
  Effect,
  GameState,
} from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import {
  applyLegalAction,
  getLegalActions,
  recomputeBattleEntityBp,
  rebuildContinuousEffectsFromField,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { getUnblockedLifeDamage } from "../src/battle/battle-actions";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

describe("BSTH02-C02 レティ・ホワイトロック shape", () => {
  const card = cardNoMap.get("BSTH02-C02")!;
  it("印字 / effects 構造（軽減シンボル白→紫扱い + 召喚時 deck_reveal + シンボル紫扱い + 相手召喚抑制 stub）", () => {
    expect(card).toBeDefined();
    expect(card.printedCategory).toBe("spirit");
    expect(card.colors).toEqual(["white"]);
    expect(card.tribe).toBe("幻想・冥主");

    // [0] 軽減シンボル<白>=紫扱い
    const e0 = card.effects![0]!.steps[0]!.action;
    expect(e0.kind).toBe("treat_as");
    if (e0.kind === "treat_as") {
      expect(e0.aspects).toContain("reduction_symbol");
      expect(e0.asColor).toBe("purple");
      expect(e0.appliesToCard).toBe(true);
    }

    // [1] 召喚時 deck_reveal (3枚オープン+2 pick)
    const e1 = card.effects![1]!;
    expect(e1.timing).toEqual({ kind: "card_event", event: "summon" });
    const e1act = e1.steps[0]!.action;
    expect(e1act.kind).toBe("deck_reveal");
    if (e1act.kind === "deck_reveal") {
      expect(e1act.revealCount).toBe(3);
      expect(e1act.picks).toHaveLength(2);
    }

    // [2] シンボル紫扱い (継続効果)
    const e2 = card.effects![2]!;
    expect(e2.timing).toEqual({ kind: "continuous" });
    const e2act = e2.steps[0]!.action;
    if (e2act.kind === "treat_as") {
      expect(e2act.aspects).toContain("symbol");
      expect(e2act.asColor).toBe("purple");
    }

    // [3] 相手がバースト効果以外の効果でスピリットカードを召喚するとき+3コスト
    //   (engine-summon-cause-conditional-cost-tax、詳細は下記 describe ブロック)
    const e3 = card.effects![3]!;
    expect(e3.stub).toBeUndefined();
    expect(e3.timing).toEqual({ kind: "continuous" });
    const e3act = e3.steps[0]!.action;
    expect(e3act.kind).toBe("cost_modify");
    if (e3act.kind === "cost_modify") {
      expect(e3act.player).toBe("opponent");
      expect(e3act.cardFilter).toMatchObject({
        category: ["spirit"],
        summonCause: ["effect"],
      });
      expect(e3act.modifier).toMatchObject({ additionalCostValue: 3 });
    }
  });
});

describe("BSTH02-C02 相手がバースト効果以外の効果でスピリットカードを召喚するとき+3コスト", () => {
  const c02 = cardNoMap.get("BSTH02-C02")!;
  const target = cardNoMap.get("BSSA01-C01")!; // spirit, printed cost 3
  const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
  const ALICE = "player-1";
  const BOB = "player-2";

  function resolveSummonPlacement(state: GameState): GameState {
    const action = getLegalActions({
      state,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions: () => [],
    }).find(
      (candidate) => candidate.kind === "resolve_pending_multi_placement"
    );
    expect(action).toBeDefined();
    return applyLegalAction({
      state,
      action: action!,
      multiPlacementAllocations: [
        {
          destinationInstanceId: "bob-target",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
  }

  function makeStateWithTax(): GameState {
    const c02Instance = createCardInstance(c02, {
      instanceId: "c02-tax",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const targetInHand = createCardInstance(target, {
      instanceId: "bob-target",
      ownerPlayerId: BOB,
      zone: "hand",
    });
    const state = createEmptyGameState({
      cardInstances: [c02Instance, targetInHand],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 10 },
      ],
    });
    return rebuildContinuousEffectsFromField(state, getDef);
  }

  const summonEffect = {
    timing: { kind: "continuous" as const },
    steps: [
      {
        action: {
          kind: "summon" as const,
          target: {
            kind: "from_zone" as const,
            zone: "hand" as const,
            count: 1,
          },
        },
      },
    ],
  };

  it("[board] 相手の非バースト効果によるスピリット召喚は印字コスト+3を支払う", () => {
    const state = makeStateWithTax();
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "additional_cost"
      )
    ).toBe(true);

    const afterSummon = executeEffect({
      chainId: "test:bsth02-c02-c21-r11-shape:166",
      state,
      effect: summonEffect,
      sourceInstanceId: "bob-target",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(afterSummon.pendingMultiPlacement).not.toBeNull();
    const next = resolveSummonPlacement(afterSummon);

    const summoned = next.cardInstances.find(
      (c) => c.instanceId === "bob-target"
    )!;
    expect(summoned.zone).toBe("field");
    const bob = next.players.find((p) => p.id === BOB)!;
    // 印字コスト3 + タックス3 = 6支払い、さらに場入り時維持コア1個 → reserve 10-6-1=3
    expect(bob.reserveNormalCoreCount).toBe(3);
  });

  it("[board] バースト効果解決中の召喚には+3コストタックスが乗らない", () => {
    const state = makeStateWithTax();

    const afterSummon = executeEffect({
      chainId: "test:bsth02-c02-c21-r11-shape:189",
      state,
      effect: summonEffect,
      sourceInstanceId: "bob-target",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      effectActionKind: "burst_activation",
    });
    expect(afterSummon.pendingMultiPlacement).not.toBeNull();
    const next = resolveSummonPlacement(afterSummon);

    const summoned = next.cardInstances.find(
      (c) => c.instanceId === "bob-target"
    )!;
    expect(summoned.zone).toBe("field");
    const bob = next.players.find((p) => p.id === BOB)!;
    // 印字コスト3のみ (タックスなし)、さらに場入り時維持コア1個 → reserve 10-3-1=6
    expect(bob.reserveNormalCoreCount).toBe(6);
  });
});

describe("BSTH02-C21 白玉楼 shape", () => {
  const card = cardNoMap.get("BSTH02-C21")!;
  it("印字（紫ネクサス・幻想/冥主）/ effects 構造（ドロー+2 (prepaidCost) + Lv2 西行妖連動 stub）", () => {
    expect(card).toBeDefined();
    expect(card.printedCategory).toBe("nexus");
    expect(card.colors).toEqual(["purple"]);
    expect(card.tribe).toBe("幻想・冥主");

    // [0] 自分のドローステップ「手札破棄でドロー+2」= inline draw_modify.prepaidCost で実装済
    //   (詳細: bsth02-r01-r02-r03-c21-discard-cost-draw.test.ts)
    const e0 = card.effects![0]!;
    expect(e0.timing).toMatchObject({ kind: "phase", step: "draw" });
    expect(e0.stub).toBeUndefined();
    const e0act = e0.steps[0]!.action;
    expect(e0act.kind).toBe("draw_modify");
    if (e0act.kind === "draw_modify") expect(e0act.amount).toBe(2);

    // [1] Lv2 西行妖がある + 相手ネクサス/創界神 Lv1コスト(requiredCores)=1
    //   (engine-bsth02-c21-cumulative-core-cost-fix で stub 解消)。
    //   「Lv1コスト」= levelDefs[0].requiredCores (10_rules/03a_cost-payment.md SSOT)、
    //   召喚/使用コスト (card.cost) とは別概念のため override_properties.levelCost で表現。
    const e1 = card.effects![1]!;
    expect(e1.timing).toEqual({ kind: "continuous" });
    expect(e1.condition).toEqual([
      { kind: "min_level", value: 2 },
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "西行妖" }],
      },
    ]);
    expect(e1.stub).toBeUndefined();
    expect(e1.steps).toHaveLength(2);
    const e1s0 = e1.steps[0]!.action;
    expect(e1s0.kind).toBe("override_properties");
    if (e1s0.kind === "override_properties") {
      expect(e1s0.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        filter: { category: ["nexus"] },
        count: "all",
      });
      expect(e1s0.properties).toMatchObject({ levelCost: { lv1: 1 } });
    }
    const e1s1 = e1.steps[1]!.action;
    expect(e1s1.kind).toBe("override_properties");
    if (e1s1.kind === "override_properties") {
      expect(e1s1.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        filter: {
          category: ["nexus"],
          targetsGrandwalker: "only",
          everHadCorePlaced: true,
        },
        count: "all",
      });
      expect(e1s1.properties).toMatchObject({ levelCost: { lv1: 1 } });
    }
  });
});

describe("BSTH02-R11 六道剣「一念無量劫」 shape", () => {
  const card = cardNoMap.get("BSTH02-R11")!;
  it("印字（白マジック・幻想/冥主・複合軽減）/ effects 構造（card_event 手札追加+コア配置 / フラッシュ life防止+deck耐性）", () => {
    expect(card).toBeDefined();
    expect(card.printedCategory).toBe("magic");
    expect(card.colors).toEqual(["white"]);
    expect(card.reductionSymbols).toEqual(["white", "purple", "guide"]);
    expect(card.tribe).toBe("幻想・冥主");

    // [0] card_event(revealed/moved_to_trash) → 手札へ移動 + ボイド→導界者ネクサスへコア1
    const e0 = card.effects![0]!;
    expect(e0.timing).toMatchObject({
      kind: "card_event",
      event: ["revealed", "moved_to_trash"],
    });
    expect(e0.cardEventDisposition).toEqual({
      kind: "move",
      destination: "hand",
    });
    expect(e0.executionMode).toBe("optional");
    const moveSelf = e0.steps[0]!.action;
    expect(moveSelf.kind).toBe("move_self");
    if (moveSelf.kind === "move_self")
      expect(moveSelf.destination).toBe("hand");
    const coreMove = e0.steps[1]!.action;
    expect(coreMove.kind).toBe("core_move");
    if (coreMove.kind === "core_move") {
      expect(coreMove.from).toMatchObject({ kind: "void", player: "self" });
      expect(coreMove.amount).toBe(1);
    }

    // [1] フラッシュ life_damage_interception(replace, opponent, attackerFilter cost4+ spirit/ultimate)
    //   + 自分のデッキは相手の効果を受けない
    const e1 = card.effects![1]!;
    expect(e1.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(e1.stub).toBeUndefined();
    expect(e1.steps).toHaveLength(2);
    const e1act = e1.steps[0]!.action;
    expect(e1act.kind).toBe("life_damage_interception");
    if (e1act.kind === "life_damage_interception") {
      expect(e1act.player).toBe("self");
      expect(e1act.cause).toBe("opponent");
      expect(e1act.mode).toBe("replace");
      expect(e1act.duration).toEqual({ scope: "turn" });
      expect(e1act.attackerFilter).toMatchObject({
        category: ["spirit", "ultimate"],
        minCost: 4,
      });
    }
    const e1s1 = e1.steps[1]!.action;
    expect(e1s1.kind).toBe("effect_immunity");
    if (e1s1.kind === "effect_immunity") {
      expect(e1s1.target).toMatchObject({
        kind: "filter",
        player: "self",
        filter: {},
        count: "all",
        zone: ["deck"],
      });
      expect(e1s1.duration).toEqual({ scope: "turn" });
    }
  });

  it("[board] BSTH02-R11: cost4以上アタッカーのライフ減少を防ぎ、自分のデッキは相手効果を受けない", () => {
    // 自分 (ALICE) が BSTH02-R11 を使用してフラッシュ life_damage_interception を登録。
    // BOB の cost4 スピリット (filter 一致) は防止、cost3 スピリット (filter 外) は 1 ダメージ。
    const ALICE = "player-1";
    const BOB = "player-2";
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id);

    const magic = createCardInstance(card, {
      instanceId: "r11-magic",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const highCost = createCardInstance(cardNoMap.get("BSSA01-C04")!, {
      instanceId: "atk-high",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const lowCost = createCardInstance(cardNoMap.get("BSSA01-C01")!, {
      instanceId: "atk-low",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const deckCard = createCardInstance(cardNoMap.get("BSSA01-C01")!, {
      instanceId: "alice-deck-card",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    let state: GameState = createEmptyGameState({
      cardInstances: [magic, highCost, lowCost, deckCard],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });
    state = executeEffect({
      chainId: "test:bsth02-c02-c21-r11-shape:371",
      state,
      effect: card.effects![1]!,
      sourceInstanceId: "r11-magic",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "life_damage_interception"
      )
    ).toBe(true);
    const deckImmunity = state.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "defense_immune" &&
        ce.sourceInstanceId === "r11-magic"
    );
    expect(deckImmunity).toBeDefined();
    expect(deckImmunity!.targetFilter).toEqual({
      player: "self",
      zone: ["deck"],
    });
    expect(deckImmunity!.duration).toEqual({ scope: "turn" });

    const protectedDeckCard = state.cardInstances.find(
      (c) => c.instanceId === "alice-deck-card"
    )!;
    expect(
      isCardImmuneToOpponentEffect(
        state,
        protectedDeckCard,
        BOB,
        "none",
        { definition: cardNoMap.get("BSSA01-C01")! },
        getDef
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        state,
        protectedDeckCard,
        ALICE,
        "none",
        { definition: cardNoMap.get("BSSA01-C01")! },
        getDef
      )
    ).toBe(false);

    const opponentDeckReveal: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "deck_reveal",
            player: "opponent",
            revealCount: 1,
            picks: [],
            remainder: "trash",
          },
        },
      ],
    };
    const blockedReveal = executeEffect({
      chainId: "test:bsth02-c02-c21-r11-shape:434",
      state,
      effect: opponentDeckReveal,
      sourceInstanceId: "atk-high",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(blockedReveal.pendingDeckReveal).toBeNull();
    expect(
      blockedReveal.cardInstances.find(
        (c) => c.instanceId === "alice-deck-card"
      )!.zone
    ).toBe("deck");
    expect(blockedReveal.players.find((p) => p.id === ALICE)!.deckCount).toBe(
      state.players.find((p) => p.id === ALICE)!.deckCount
    );
    expect(blockedReveal.log).toContain(
      "effect:deck_reveal:player-1:immune:no-revealable"
    );
    const opponentPeekDeck: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "peek_deck",
            player: "opponent",
            count: 1,
            revealTo: "self",
          },
        },
      ],
    };
    const blockedPeek = executeEffect({
      chainId: "test:bsth02-c02-c21-r11-shape:467",
      state,
      effect: opponentPeekDeck,
      sourceInstanceId: "atk-high",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      blockedPeek.cardInstances.find((c) => c.instanceId === "alice-deck-card")!
        .zone
    ).toBe("deck");
    expect(blockedPeek.log).toContain(
      "effect:peek_deck:player-1:immune:no-peekable"
    );

    const opponentDeckMill: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "discard",
            player: "opponent",
            fromZone: "deck",
            count: 1,
          },
        },
      ],
    };
    const blockedMill = executeEffect({
      chainId: "test:bsth02-c02-c21-r11-shape:496",
      state,
      effect: opponentDeckMill,
      sourceInstanceId: "atk-high",
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      blockedMill.cardInstances.find((c) => c.instanceId === "alice-deck-card")!
        .zone
    ).toBe("deck");
    expect(blockedMill.players.find((p) => p.id === ALICE)!.deckCount).toBe(
      state.players.find((p) => p.id === ALICE)!.deckCount
    );
    expect(blockedMill.log).toContain(
      "effect:discard_deck:player-1:immune:no-discardable"
    );

    const battleEntities: BattleEntity[] = [
      {
        entityId: "e-high",
        memberInstanceIds: ["atk-high"],
        resolvedBp: 5000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
      {
        entityId: "e-low",
        memberInstanceIds: ["atk-low"],
        resolvedBp: 5000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ];
    const group: BattleResolutionGroup = {
      attackId: "atk-1",
      groupMode: "single",
      target: { kind: "player", playerId: ALICE },
      symbolResolutionOrder: ["e-high", "e-low"],
      participantSnapshots: battleEntities.map((b) => ({
        entityId: b.entityId,
        memberInstanceIds: b.memberInstanceIds,
        resolvedBp: b.resolvedBp,
        resolvedSymbols: b.resolvedSymbols,
        blockedBy: [],
      })),
    };
    const battleState: GameState = {
      ...state,
      battleEntities,
      battleResolutionGroup: group,
    };
    const dmg = getUnblockedLifeDamage(battleState, getDef);
    expect(dmg).not.toBeNull();
    // cost4 アタッカーは防止、cost3 アタッカーのみ 1 ダメージ。
    expect(dmg!.totalLifeDamage).toBe(1);
  });

  it("[regression] BSTH02-R11: アタック中に合体した cost7 スピリットは2シンボルのままライフ減少0", () => {
    const ALICE = "player-1";
    const BOB = "player-2";
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id);

    const magic = createCardInstance(card, {
      instanceId: "r11-magic-midbattle",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const host = createCardInstance(cardNoMap.get("BSGE01-CX01")!, {
      instanceId: "ge-host",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["ge-brave"],
    });
    const brave = createCardInstance(cardNoMap.get("BSGE01-TX01(A)")!, {
      instanceId: "ge-brave",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: "ge-host",
    });
    const staleEntity: BattleEntity = {
      entityId: "battle-entity:ge-host",
      memberInstanceIds: ["ge-host"],
      resolvedBp: 3000,
      resolvedSymbols: ["red"],
      attackState: "attacking",
    };
    let state: GameState = {
      ...createEmptyGameState({
        cardInstances: [magic, host, brave],
        playerOverrides: [
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        ],
      }),
      activePlayerId: BOB,
      step: "attack",
      turnNumber: 3,
      battleEntities: [staleEntity],
    };

    state = executeEffect({
      chainId: "test:bsth02-c02-c21-r11-shape:603",
      state,
      effect: card.effects![1]!,
      sourceInstanceId: "r11-magic-midbattle",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    state = recomputeBattleEntityBp(state, getDef);

    const entity = state.battleEntities[0]!;
    expect(entity.memberInstanceIds).toEqual(["ge-host", "ge-brave"]);
    expect(entity.resolvedSymbols).toEqual(["red", "red"]);

    const battleState: GameState = {
      ...state,
      battleResolutionGroup: {
        attackId: "atk-midbattle-combined",
        groupMode: "single",
        target: { kind: "player", playerId: ALICE },
        symbolResolutionOrder: [entity.entityId],
        participantSnapshots: [
          {
            entityId: entity.entityId,
            memberInstanceIds: entity.memberInstanceIds,
            resolvedBp: entity.resolvedBp,
            resolvedSymbols: entity.resolvedSymbols,
            blockedBy: [],
          },
        ],
      },
    };

    const unprotected = getUnblockedLifeDamage(
      {
        ...battleState,
        activeContinuousEffects: battleState.activeContinuousEffects.filter(
          (ce) => ce.modifierTag !== "life_damage_interception"
        ),
      },
      getDef
    );
    expect(unprotected?.totalLifeDamage).toBe(2);

    const protectedDamage = getUnblockedLifeDamage(battleState, getDef);
    expect(protectedDamage).not.toBeNull();
    expect(protectedDamage!.totalLifeDamage).toBe(0);
  });
});
