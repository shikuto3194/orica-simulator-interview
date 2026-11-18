/**
 * BSAZ01-C17「戦術データリンク」effects[0] (textRef[0,1]):
 * 「Lv1 系統：「地球」と「ＣＦ」を持つ自分のスピリットが相手によってフィールドを離れるとき、
 *  自分のデッキを上から2枚オープンできる。その中の系統：「地球」を持つマジックカード1枚を
 *  フィールドに置く。残ったカードはデッキの下に戻す。」
 *
 * engine-field-magic-self-placement クラスタの一部だが、本カード自身は magic ではなく
 * nexus。第三者観測 (自分の他カードの leave_field を、場に常駐するこのカードが観測する) は
 * BSAZ03-M01 effects[0] (applicability.zone:trash 版) と同型、対象ゾーンが trash ではなく
 * デフォルト (field 常駐) な点のみ差分。
 * deck_reveal.picks[].destination:"field" (デッキから直接フィールド配置、配置時誘発が発火) は
 * BSSG01/BSTH003/BSTH06/BSTS01/BSES01-C01[4,5] で既実装済みの汎用 primitive を
 * 再利用するのみで、dispatch 側の新規コードは無い (SSOT)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import {
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
} from "../src/effect/trigger-system";
import { queuePendingLeave } from "../src/state-based-actions";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { getLegalActions, applyLegalAction } from "../src";
import type { CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const C17 = cardNoMap.get("BSAZ01-C17")!;
const noLookup = () => [];

const ALICE = "alice";
const BOB = "bob";

function makeSpiritDef(tribe: string): CardDefinition {
  return {
    cardNo: `TEST-BSAZ01-C17-SPIRIT-${tribe}`,
    name: `テストスピリット ${tribe}`,
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["yellow"],
    tribe,
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function makeMagicDef(tribe: string | undefined): CardDefinition {
  return {
    cardNo: `TEST-BSAZ01-C17-MAGIC-${tribe ?? "none"}`,
    name: `テストマジック ${tribe ?? "無系統"}`,
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: ["yellow"],
    levelDefs: [],
    symbolColors: [],
    tribe,
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

describe("BSAZ01-C17 effects[0]: 地球・ＣＦスピリットが相手によって離れるとき、デッキ上2枚から地球マジック1枚をフィールドに置く", () => {
  const effect = C17.effects![0]!;

  it("effect 定義: game_event(player:self, leave_field, triggerFilter tribes AND, cause opponent広義) + deck_reveal destination:field", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "leave_field",
      triggerFilter: {
        category: ["spirit"],
        tribes: ["地球", "ＣＦ"],
        tribesLogic: "and",
      },
      cause: ["opponent_effect", "battle"],
    });
    expect(effect.executionMode).toBe("optional");
    expect(effect.steps[0]!.action).toEqual({
      kind: "deck_reveal",
      revealCount: 2,
      picks: [
        {
          count: 1,
          filter: { category: ["magic"], tribes: ["地球"] },
          destination: "field",
          mandatory: true,
        },
      ],
      remainder: "bottom",
    });
  });

  function setup(spiritTribe: string) {
    const spiritDef = makeSpiritDef(spiritTribe);
    const spirit = createCardInstance(spiritDef, {
      instanceId: "spirit-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const nexus = createCardInstance(C17, {
      instanceId: "c17-field-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const before: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [spirit, nexus],
    });
    const defs = new Map<string, CardDefinition>([
      [C17.cardNo, C17],
      [spiritDef.cardNo, spiritDef],
    ]);
    const localGetDef = (id: string) => defs.get(id);
    const lookup = buildTriggeredEffectLookup([C17, spiritDef]);
    return { before, spirit, nexus, getDef: localGetDef, lookup };
  }

  function leaveByOpponent(before: GameState, spiritInstanceId: string) {
    const chainId = "c17-leave-chain";
    const withPendingLeave = queuePendingLeave({
      state: before,
      instanceId: spiritInstanceId,
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: BOB,
      chainId,
    });
    return { withPendingLeave, chainId };
  }

  it("地球・ＣＦ両系統を持つ自分のスピリットが相手起因で離れるとき、C17が誘発候補に含まれる", () => {
    const ctx = setup("地球・ＣＦ");
    const { withPendingLeave, chainId } = leaveByOpponent(
      ctx.before,
      ctx.spirit.instanceId
    );
    const queued = collectAndQueueTriggerReactions({
      beforeState: ctx.before,
      afterState: withPendingLeave,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });
    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === ctx.spirit.instanceId
    );
    expect(pending).toBeDefined();
    expect(pending!.cause).toBe("opponent_effect");

    const choices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending!,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.nexus.instanceId)
    ).toBeDefined();
  });

  it("地球のみ(ＣＦを持たない)スピリットが離れるときは誘発候補に含まれない (tribesLogic:and)", () => {
    const ctx = setup("地球");
    const { withPendingLeave, chainId } = leaveByOpponent(
      ctx.before,
      ctx.spirit.instanceId
    );
    const queued = collectAndQueueTriggerReactions({
      beforeState: ctx.before,
      afterState: withPendingLeave,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });
    expect(
      queued.pendingTriggeredEffects.find(
        (p) => p.relatedInstanceId === ctx.spirit.instanceId
      )
    ).toBeUndefined();
  });

  it("自分の効果 (self_effect) による離脱では誘発候補に含まれない (「相手によって」不一致)", () => {
    const ctx = setup("地球・ＣＦ");
    const chainId = "c17-self-leave-chain";
    const withPendingLeave = queuePendingLeave({
      state: ctx.before,
      instanceId: ctx.spirit.instanceId,
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: ALICE,
      chainId,
    });
    const queued = collectAndQueueTriggerReactions({
      beforeState: ctx.before,
      afterState: withPendingLeave,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });
    expect(
      queued.pendingTriggeredEffects.find(
        (p) => p.relatedInstanceId === ctx.spirit.instanceId
      )
    ).toBeUndefined();
  });

  it("[board] 実行: デッキ上2枚オープン→地球マジック1枚を直接フィールドに配置、残りはデッキ下", () => {
    const magicTarget = makeMagicDef("地球");
    const magicCard = createCardInstance(magicTarget, {
      instanceId: "deck-magic-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const filler = makeMagicDef(undefined);
    const fillerCard = createCardInstance(filler, {
      instanceId: "deck-filler-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const nexus = createCardInstance(C17, {
      instanceId: "c17-field-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const defs = new Map<string, CardDefinition>([
      [C17.cardNo, C17],
      [magicTarget.cardNo, magicTarget],
      [filler.cardNo, filler],
    ]);
    const localGetDef = (id: string) => defs.get(id);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [nexus, magicCard, fillerCard],
        playerOverrides: [{ deckCount: 2 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main",
    };

    const afterReveal = executeEffect({
      chainId: "test:bsaz01-c17-field-magic-self-placement:264",
      state,
      effect,
      sourceInstanceId: nexus.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: localGetDef,
      getRegisteredTriggeredEffectActions: noLookup,
    });

    let cur = afterReveal;
    for (let step = 0; step < 5 && cur.pendingDeckReveal !== null; step++) {
      const phase = cur.pendingDeckReveal.phase;
      if (phase === "picking") {
        const pick = getLegalActions({
          state: cur,
          actingPlayerId: ALICE,
          getCardDefinitionById: localGetDef,
        }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
        if (!pick) break;
        cur = applyLegalAction({
          state: cur,
          action: pick,
          getCardDefinitionById: localGetDef,
          getRegisteredTriggeredEffectActions: noLookup,
          selectedDeckRevealCardIds: [magicCard.instanceId],
        }).state;
      } else if (phase === "ordering_remainder") {
        const remaining = cur.pendingDeckReveal.revealedCardInstanceIds.filter(
          (id) => !cur.pendingDeckReveal!.pickedCardInstanceIds.includes(id)
        );
        const order = getLegalActions({
          state: cur,
          actingPlayerId: ALICE,
          getCardDefinitionById: localGetDef,
        }).find(
          (action) => action.kind === "resolve_pending_deck_reveal_order"
        );
        if (!order) break;
        cur = applyLegalAction({
          state: cur,
          action: order,
          getCardDefinitionById: localGetDef,
          getRegisteredTriggeredEffectActions: noLookup,
          deckRevealRemainderOrder: remaining,
        }).state;
      } else {
        break;
      }
    }

    expect(cur.pendingDeckReveal).toBeNull();
    expect(
      cur.cardInstances.find((c) => c.instanceId === magicCard.instanceId)?.zone
    ).toBe("field");
    expect(
      cur.cardInstances.find((c) => c.instanceId === fillerCard.instanceId)
        ?.zone
    ).toBe("deck");
  });
});
