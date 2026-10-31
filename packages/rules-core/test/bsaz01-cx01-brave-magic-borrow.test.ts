import { finishCoreChoices } from "./helpers/core-choice-driver";
/**
 * BSAZ01-CX01「界塚伊奈帆」engine-field-magic-self-placement / engine-brave-combine-
 * soul-state-source クラスタで全 stub 解消済み:
 *   textRef[0]: 魂/スピリット状態のこのカード/ブレイヴは、召喚/煌臨した
 *     スレイプニール自身 (trigger_related_instance) にも合体できる。
 *   effects[0] textRef[1]: スピリット状態は疲労せずアタック/ブロック不可 (BSGE01-C05 同型)。
 *   effects[1] textRef[3,4]: Lv1『メインステップ』[ゲームに1回：同名] デッキ13枚オープン→
 *     地球マジック3枚までフィールド + コスト4以下「スレイプニール」1枚をコスト不要召喚。
 *   effects[2,3] textRef[7,8]: 【合体中】フラッシュ/スタック、ターンに1回1コストで
 *     フィールドの地球マジックのフラッシュ/スタック効果を発揮 (limitGroupId 共有)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  applyLegalAction,
} from "../src";
import { getAvailableBraveCombineLegalActions } from "../src/legal/legal-actions-availability";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noLookup = () => [];

const CX01 = cardNoMap.get("BSAZ01-CX01")!;
// KG-6 スレイプニール (無印、cost 3) — CX01 の「コスト4以下の『スレイプニール』」に合致する。
const SLEIPNIR_C01 = cardNoMap.get("BSAZ01-C01")!;
// 系統「地球」を持つマジック (BSAZ01-C04)。
const EARTH_MAGIC_C04 = cardNoMap.get("BSAZ01-C04")!;

const ALICE = "alice";
const BOB = "bob";

const getCx01EventCombineEffect = () => {
  const effect = CX01.effects!.find(
    (e) =>
      e.textRef?.includes(0) &&
      e.steps.some((s) => s.action.kind === "brave_combine_effect")
  );
  if (!effect) throw new Error("BSAZ01-CX01 textRef[0] combine effect missing");
  return effect;
};

describe("BSAZ01-CX01 braveCondition + stub 解消済み", () => {
  it("braveCondition: cardNameContains['スレイプニール'] が top-level に配線済み", () => {
    expect(CX01.braveCondition).toEqual({
      cardNameContains: ["スレイプニール"],
    });
    expect(CX01.allowMainStepBraveCombine).toBeUndefined();
  });

  it("stub effect は残っていない", () => {
    const stubEffects = CX01.effects!.filter((e) => e.stub !== undefined);
    expect(stubEffects).toHaveLength(0);
  });

  it("[board] 魂状態の CX01 は通常 main brave_combine としては出ない", () => {
    const brave = createCardInstance(CX01, {
      instanceId: "cx01-soul-brave-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const sleipnir = createCardInstance(SLEIPNIR_C01, {
      instanceId: "sleipnir-soul-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, sleipnir],
        playerOverrides: [{ soulStateInstanceIds: [brave.instanceId] }, {}],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    expect(actions.some((a) => a.braveInstanceId === brave.instanceId)).toBe(
      false
    );
  });

  it("[board] 魂状態から textRef[0] 誘発で合体すると、そのときのスレイプニールへ付き魂状態から除去される", () => {
    const brave = createCardInstance(CX01, {
      instanceId: "cx01-soul-brave-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const sleipnir = createCardInstance(SLEIPNIR_C01, {
      instanceId: "sleipnir-soul-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, sleipnir],
        playerOverrides: [{ soulStateInstanceIds: [brave.instanceId] }, {}],
      }),
      activePlayerId: ALICE,
      step: "main",
    };

    const after = executeEffect({
      chainId: "test:bsaz01-cx01-brave-magic-borrow:125",
      state,
      sourceInstanceId: brave.instanceId,
      effect: getCx01EventCombineEffect(),
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      triggerRelatedInstanceId: sleipnir.instanceId,
    });

    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.soulStateInstanceIds).not.toContain(brave.instanceId);
    expect(
      after.cardInstances.find((c) => c.instanceId === brave.instanceId)
        ?.attachedToInstanceId
    ).toBe(sleipnir.instanceId);
  });

  it("[board] スピリット状態(場のブレイヴ)の CX01 は通常 main brave_combine として出る", () => {
    const brave = createCardInstance(CX01, {
      instanceId: "cx01-brave-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
    });
    const sleipnir = createCardInstance(SLEIPNIR_C01, {
      instanceId: "sleipnir-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, sleipnir],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const combine = actions.find(
      (a) =>
        a.braveInstanceId === brave.instanceId &&
        a.targetInstanceId === sleipnir.instanceId
    );
    expect(combine).toBeDefined();

    const after = applyLegalAction({
      state,
      action: combine!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    }).state;
    expect(
      after.cardInstances.find((c) => c.instanceId === brave.instanceId)
        ?.attachedToInstanceId
    ).toBe(sleipnir.instanceId);
    expect(
      after.cardInstances.find((c) => c.instanceId === sleipnir.instanceId)
        ?.attachedChildrenIds
    ).toContain(brave.instanceId);
  });

  it("[board] textRef[0] 誘発は、別の既存スレイプニールではなく trigger_related_instance のスレイプニールだけに合体する", () => {
    const brave = createCardInstance(CX01, {
      instanceId: "cx01-brave-trigger-only",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
    });
    const oldSleipnir = createCardInstance(SLEIPNIR_C01, {
      instanceId: "sleipnir-old",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const newSleipnir = createCardInstance(SLEIPNIR_C01, {
      instanceId: "sleipnir-new",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, oldSleipnir, newSleipnir],
      }),
      activePlayerId: ALICE,
      step: "main",
    };

    const after = executeEffect({
      chainId: "test:bsaz01-cx01-brave-magic-borrow:227",
      state,
      sourceInstanceId: brave.instanceId,
      effect: getCx01EventCombineEffect(),
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      triggerRelatedInstanceId: newSleipnir.instanceId,
    });

    expect(
      after.cardInstances.find((c) => c.instanceId === brave.instanceId)
        ?.attachedToInstanceId
    ).toBe(newSleipnir.instanceId);
    expect(
      after.cardInstances.find((c) => c.instanceId === oldSleipnir.instanceId)
        ?.attachedChildrenIds
    ).not.toContain(brave.instanceId);
  });

  it("[board] 系統「地球」を持たない自分のスピリットとは合体できない (cardNameContains 不一致)", () => {
    const brave = createCardInstance(CX01, {
      instanceId: "cx01-brave-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
    });
    const otherSpirit = createCardInstance(EARTH_MAGIC_C04, {
      instanceId: "other-spirit-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, otherSpirit],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    expect(actions.some((a) => a.braveInstanceId === brave.instanceId)).toBe(
      false
    );
  });
});

describe("BSAZ01-CX01 effects[0] textRef[1]: スピリット状態は疲労せずアタック/ブロック不可", () => {
  const effect = CX01.effects![0]!;

  it("continuous + applicability.combined:false + effect_resistance(exhaust) + prevent_battle", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing.kind).toBe("continuous");
    expect(effect.applicability?.combined).toBe(false);
    const resistance = effect.steps[0]!.action;
    expect(resistance.kind).toBe("effect_resistance");
    if (resistance.kind === "effect_resistance") {
      expect(resistance.resistsOutcome).toBe("exhaust");
      expect(resistance.ruleStrength).toBe(true);
    }
    const battleBan = effect.steps[1]!.action;
    expect(battleBan.kind).toBe("prevent_battle");
    if (battleBan.kind === "prevent_battle") {
      expect(battleBan.restriction).toEqual(["attack", "block"]);
      expect(battleBan.ruleStrength).toBe(true);
    }
  });
});

describe("BSAZ01-CX01 effects[1] textRef[3,4]: Lv1メイン デッキ13オープン→地球マジック3枚 field + コスト4以下スレイプニール1枚コスト不要召喚", () => {
  const effect = CX01.effects![1]!;

  it("deck_reveal: revealCount13 / picks二群 (magic→field, spirit cardName+maxCost→field) / remainder bottom", () => {
    expect(effect.executionMode).toBe("optional");
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
    });
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("deck_reveal");
    if (action.kind !== "deck_reveal") throw new Error("unreachable");
    expect(action.revealCount).toBe(13);
    expect(action.remainder).toBe("bottom");
    expect(action.suppressRevealedEffects).toBe(true);
    expect(action.picks).toEqual([
      {
        count: 3,
        filter: { category: ["magic"], tribes: ["地球"] },
        destination: "field",
      },
      {
        count: 1,
        filter: {
          category: ["spirit", "ultimate", "brave"],
          maxCost: 4,
          cardName: [{ contains: "スレイプニール" }],
        },
        destination: "field",
        mandatory: true,
      },
    ]);
  });

  it("[board] 実行: デッキ13枚オープン→地球マジック1枚(3枚まで)と必須スレイプニール1枚(コスト4以下)をfield直接配置、印字コストを支払わず最低Lvコアだけを置く", () => {
    const brave = createCardInstance(CX01, {
      instanceId: "cx01-brave-3",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
    });
    const magicInDeck = createCardInstance(EARTH_MAGIC_C04, {
      instanceId: "deck-magic-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const sleipnirInDeck = createCardInstance(SLEIPNIR_C01, {
      instanceId: "deck-sleipnir-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const fillerCards = Array.from({ length: 6 }, (_, i) =>
      createCardInstance(SLEIPNIR_C01, {
        instanceId: `deck-filler-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, magicInDeck, sleipnirInDeck, ...fillerCards],
        // スレイプニールの印字コストは3、最低Lvコアは1。無償召喚なら
        // reserve から最低Lv分だけが置かれ、通常召喚の3コア支払いは起きない。
        playerOverrides: [{ deckCount: 8, reserveNormalCoreCount: 4 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main",
    };

    const afterReveal = executeEffect({
      chainId: "test:bsaz01-cx01-brave-magic-borrow:374",
      state,
      effect,
      sourceInstanceId: brave.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    });

    let cur = afterReveal;
    for (let step = 0; step < 10 && cur.pendingDeckReveal !== null; step++) {
      const phase = cur.pendingDeckReveal.phase;
      if (phase === "picking") {
        const pick = getLegalActions({
          state: cur,
          actingPlayerId: ALICE,
          getCardDefinitionById: getDef,
        }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
        if (!pick) break;
        if (cur.pendingDeckReveal.currentPickIndex === 1) {
          expect(() =>
            applyLegalAction({
              state: cur,
              action: pick,
              getCardDefinitionById: getDef,
              getRegisteredTriggeredEffectActions: noLookup,
              selectedDeckRevealCardIds: [],
            })
          ).toThrow("Deck reveal pick requires 1 selection(s); got 0");
        }
        const target =
          cur.pendingDeckReveal.currentPickIndex === 0
            ? [magicInDeck.instanceId]
            : [sleipnirInDeck.instanceId];
        cur = applyLegalAction({
          state: cur,
          action: pick,
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: noLookup,
          selectedDeckRevealCardIds: target,
        }).state;
      } else if (phase === "ordering_remainder") {
        const remaining = cur.pendingDeckReveal.revealedCardInstanceIds.filter(
          (id) => !cur.pendingDeckReveal!.pickedCardInstanceIds.includes(id)
        );
        const order = getLegalActions({
          state: cur,
          actingPlayerId: ALICE,
          getCardDefinitionById: getDef,
        }).find(
          (action) => action.kind === "resolve_pending_deck_reveal_order"
        );
        if (!order) break;
        cur = applyLegalAction({
          state: cur,
          action: order,
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: noLookup,
          deckRevealRemainderOrder: remaining,
        }).state;
      } else {
        break;
      }
    }

    expect(cur.pendingDeckReveal).toBeNull();
    expect(
      cur.cardInstances.find((c) => c.instanceId === magicInDeck.instanceId)
        ?.zone
    ).toBe("field");
    expect(
      cur.cardInstances.find((c) => c.instanceId === sleipnirInDeck.instanceId)
        ?.zone
    ).toBe("field");
    expect(
      cur.cardInstances.find((c) => c.instanceId === sleipnirInDeck.instanceId)
        ?.zoneRoleName
    ).toBe("spirit");
    cur = finishCoreChoices(cur, getDef);
    const alice = cur.players.find((player) => player.id === ALICE)!;
    const sleipnir = cur.cardInstances.find(
      (card) => card.instanceId === sleipnirInDeck.instanceId
    )!;
    expect(alice.reserveNormalCoreCount).toBe(3);
    expect(sleipnir.normalCoreCount).toBe(1);
  });

  it("[board] suppressRevealedEffects: revealed disposition (BSES01-C01 手札自己回収) を持つカードがオープンされても発揮されない", () => {
    const brave = createCardInstance(CX01, {
      instanceId: "cx01-brave-suppress",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
    });
    const revealedEffectCard = createCardInstance(
      cardNoMap.get("BSES01-C01")!,
      {
        instanceId: "deck-revealed-effect-1",
        ownerPlayerId: ALICE,
        zone: "deck",
      }
    );
    const fillerCards = Array.from({ length: 12 }, (_, i) =>
      createCardInstance(SLEIPNIR_C01, {
        instanceId: `deck-suppress-filler-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, revealedEffectCard, ...fillerCards],
        playerOverrides: [{ deckCount: 13 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main",
    };

    const afterReveal = executeEffect({
      chainId: "test:bsaz01-cx01-brave-magic-borrow:493",
      state,
      effect,
      sourceInstanceId: brave.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    });

    expect(afterReveal.pendingDeckReveal).not.toBeNull();
    expect(
      afterReveal.pendingDeckReveal!.revealedAutoAddCandidateIds ?? []
    ).not.toContain(revealedEffectCard.instanceId);
    expect(
      afterReveal.cardInstances.find(
        (c) => c.instanceId === revealedEffectCard.instanceId
      )?.zone
    ).not.toBe("hand");
  });
});

describe("BSAZ01-CX01 effects[2,3] textRef[7,8]: 【合体中】フラッシュ/スタック ターンに1回1コストでフィールドの地球マジックのフラッシュ/スタック効果を発揮", () => {
  it("flash/stack の2枠は同一 limitGroupId で per_instance/turn を共有する", () => {
    const flashEffect = CX01.effects![2]!;
    const stackEffect = CX01.effects![3]!;
    expect(flashEffect.applicability?.combined).toBe(true);
    expect(flashEffect.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flashEffect.timingScope).toEqual({
      player: "both",
      period: "attack",
    });
    expect(flashEffect.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
    });
    expect(flashEffect.limitGroupId).toBe("bsaz01-cx01-borrow");
    expect(stackEffect.limitGroupId).toBe(flashEffect.limitGroupId);
    expect(stackEffect.timing).toEqual({ kind: "activated", mode: "stack" });

    expect(flashEffect.steps[0]!.action).toEqual({
      kind: "pay_cost",
      amount: 1,
    });
    const borrow = flashEffect.steps[1]!.action;
    expect(flashEffect.steps[1]!.connector).toBe("conditional_cost");
    expect(borrow.kind).toBe("borrow_magic_effect");
    if (borrow.kind === "borrow_magic_effect") {
      expect(borrow.borrowModes).toEqual(["flash"]);
      expect(borrow.target.kind).toBe("filter");
    }

    const stackBorrow = stackEffect.steps[1]!.action;
    if (stackBorrow.kind === "borrow_magic_effect") {
      expect(stackBorrow.borrowModes).toEqual(["stack"]);
    }
  });

  it("[board] 実行: 合体中のCX01がリザーブ1コアを支払い、フィールドの地球マジックのフラッシュ効果を借用発揮する", () => {
    const brave = createCardInstance(CX01, {
      instanceId: "cx01-brave-4",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: "sleipnir-host-1",
    });
    const host = createCardInstance(SLEIPNIR_C01, {
      instanceId: "sleipnir-host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
      attachedChildrenIds: [brave.instanceId],
    });
    const fieldMagic = createCardInstance(EARTH_MAGIC_C04, {
      instanceId: "field-magic-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const flashEffect = CX01.effects![2]!;
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [brave, host, fieldMagic],
        playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
      }),
      activePlayerId: ALICE,
      step: "attack",
    };

    const after = executeEffect({
      chainId: "test:bsaz01-cx01-brave-magic-borrow:585",
      state,
      effect: flashEffect,
      sourceInstanceId: brave.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    });

    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.trashNormalCoreCount).toBe(1);
  });
});
