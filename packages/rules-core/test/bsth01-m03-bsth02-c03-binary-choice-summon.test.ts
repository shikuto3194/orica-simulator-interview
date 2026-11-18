// 召喚時の公開後二択は reveal-then-choose-retrieval.test.ts で盤面検証する。
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  generateBattleImmediateEffectRegistrations,
  type CardDefinition,
  type GameState,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

describe("BSTH01-M03 アタック時 二択 deck_reveal (界放:1): 排他化", () => {
  const card = cardNoMap.get("BSTH01-M03")!;
  const guidedNexusDef = cardNoMap.get("BSTH01-XX01")!;

  it("effects[2] の stub が消えている", () => {
    expect(card.effects).toHaveLength(3);
    expect(card.effects![2]!.stub).toBeUndefined();
  });

  it("effects[2] = attack trigger に 1 step.choice + ref_choice + conditional_cost", () => {
    const e2 = card.effects![2]!;
    expect(e2.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(e2.executionMode).toBe("optional");
    expect(e2.applicability?.level).toEqual({ min: 2 });
    expect(e2.steps).toHaveLength(2);

    // step 0: default = deck_reveal 相手 1 → top, choice[0] = core_move 導界者ネクサス → this_card amount:1
    const step0 = e2.steps[0]!;
    expect(step0.id).toBe("mode");
    expect(step0.action.kind).toBe("deck_reveal");
    if (step0.action.kind === "deck_reveal") {
      expect(step0.action.player).toBe("opponent");
      expect(step0.action.revealCount).toBe(1);
      expect(step0.action.remainder).toBe("top");
    }
    expect(step0.choice).toHaveLength(1);
    const variant1 = step0.choice![0]!;
    expect(variant1.action.kind).toBe("core_move");
    if (variant1.action.kind === "core_move") {
      expect(variant1.action.from.kind).toBe("field_card");
      if (variant1.action.from.kind === "field_card") {
        expect(variant1.action.from.player).toBe("self");
        expect(variant1.action.from.filter).toMatchObject({
          category: ["nexus"],
          tribes: ["導界者"],
          targetsGrandwalker: true,
        });
      }
      expect(variant1.action.to?.kind).toBe("this_card");
      expect(variant1.action.amount).toBe(1);
    }

    // step 1: paid 側 deck_reveal 相手 1 → bottom, ref_choice mode/1, conditional_cost
    const step1 = e2.steps[1]!;
    expect(step1.connector).toBe("conditional_cost");
    expect(step1.stepCondition).toEqual({
      kind: "ref_choice",
      stepId: "mode",
      choiceIndex: 1,
    });
    expect(step1.action.kind).toBe("deck_reveal");
    if (step1.action.kind === "deck_reveal") {
      expect(step1.action.player).toBe("opponent");
      expect(step1.action.revealCount).toBe(1);
      expect(step1.action.remainder).toBe("bottom");
    }
  });

  it("registration (battle immediate): attack 起動は 1 件 + choices.length=2 + variant1.requiredCoreMoveCost", () => {
    // card_event:"attack" は battle immediate 系で処理される (CARD_EVENT_TO_BATTLE_IMMEDIATE)。
    // triggered registration には載らない (P3-14 C-2 META 規約)。
    const regs = generateBattleImmediateEffectRegistrations(card);
    const attackRegs = regs.filter(
      (r) => r.timing === "attack" && r.effectIndex === 2
    );
    expect(attackRegs).toHaveLength(1);
    const reg = attackRegs[0]!;
    expect(reg.choices).toBeDefined();
    expect(reg.choices).toHaveLength(2);
    // variant 0 = free (cost なし)
    expect(reg.choices![0]!.requiredCoreMoveCost).toBeUndefined();
    expect(reg.choices![0]!.requiredPayCostAmount ?? 0).toBe(0);
    // variant 1 = paid 1 (core_move 導界者ネクサス → this_card)。pay_cost ではなく core_move 由来。
    expect(reg.choices![1]!.requiredPayCostAmount).toBeUndefined();
    const cost = reg.choices![1]!.requiredCoreMoveCost;
    expect(cost).toBeDefined();
    expect(cost!.amount).toBe(1);
    expect(cost!.sourcePlayer).toBe("self");
    expect(cost!.sourceFilter).toMatchObject({
      category: ["nexus"],
      tribes: ["導界者"],
      targetsGrandwalker: true,
    });
  });

  describe("executeEffect: 排他 variant の挙動", () => {
    function buildAttackState(args: { nexusCores: number }): GameState {
      const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const sourceInst = createCardInstance(card, {
        instanceId: "src-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 3, // Lv2 (requiredCores:3)
      });
      const nexusInst = createCardInstance(guidedNexusDef, {
        instanceId: "nx-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: args.nexusCores,
      });
      const deckCards = [0, 1, 2].map((i) =>
        createCardInstance(guidedNexusDef, {
          instanceId: `dk-${i}`,
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "deck",
        })
      );
      return {
        ...base,
        activePlayerId: "alice",
        step: "main",
        cardInstances: [sourceInst, nexusInst, ...deckCards],
      };
    }

    it("mode 0: core_move は走らず free 側 deck_reveal pending (remainder=top)", () => {
      const state = buildAttackState({ nexusCores: 3 });
      const after = executeEffect({
        chainId: "test:bsth01-m03-bsth02-c03-binary-choice-summon:138",
        state,
        effect: card.effects![2]!,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
        choiceIndex: 0,
      });
      // 導界者ネクサスのコアは不変
      const nexus = after.cardInstances.find((c) => c.instanceId === "nx-1")!;
      expect(nexus.normalCoreCount).toBe(3);
      const src = after.cardInstances.find((c) => c.instanceId === "src-1")!;
      expect(src.normalCoreCount).toBe(3);
      // deck_reveal pending (相手デッキ 1 → top)
      expect(after.pendingDeckReveal).not.toBeNull();
      expect(after.pendingDeckReveal!.remainder).toBe("top");
      // bob のデッキカードが reveal される
      const revealedIds = after.pendingDeckReveal!.revealedCardInstanceIds;
      expect(revealedIds).toHaveLength(1);
      const revealed = after.cardInstances.find(
        (c) => c.instanceId === revealedIds[0]
      )!;
      expect(revealed.ownerPlayerId).toBe("bob");
    });

    it("mode 1 ネクサスコア充足: core_move 1 後に paid 側 deck_reveal pending (remainder=bottom)", () => {
      const state = buildAttackState({ nexusCores: 2 });
      const after = executeEffect({
        chainId: "test:bsth01-m03-bsth02-c03-binary-choice-summon:165",
        state,
        effect: card.effects![2]!,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
        choiceIndex: 1,
      });
      // 導界者ネクサスから 1 個減
      const nexus = after.cardInstances.find((c) => c.instanceId === "nx-1")!;
      expect(nexus.normalCoreCount).toBe(1);
      // ソースに 1 個追加 (3 → 4)
      const src = after.cardInstances.find((c) => c.instanceId === "src-1")!;
      expect(src.normalCoreCount).toBe(4);
      // deck_reveal pending (相手デッキ 1 → bottom)
      expect(after.pendingDeckReveal).not.toBeNull();
      expect(after.pendingDeckReveal!.remainder).toBe("bottom");
      const revealedIds = after.pendingDeckReveal!.revealedCardInstanceIds;
      expect(revealedIds).toHaveLength(1);
      const revealed = after.cardInstances.find(
        (c) => c.instanceId === revealedIds[0]
      )!;
      expect(revealed.ownerPlayerId).toBe("bob");
    });

    it("mode 1 ネクサスコア 0: conditional_cost ロールバックで deck_reveal pending 出ず", () => {
      const state = buildAttackState({ nexusCores: 0 });
      const after = executeEffect({
        chainId: "test:bsth01-m03-bsth02-c03-binary-choice-summon:192",
        state,
        effect: card.effects![2]!,
        sourceInstanceId: "src-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
        choiceIndex: 1,
      });
      const nexus = after.cardInstances.find((c) => c.instanceId === "nx-1")!;
      expect(nexus.normalCoreCount).toBe(0);
      const src = after.cardInstances.find((c) => c.instanceId === "src-1")!;
      expect(src.normalCoreCount).toBe(3);
      // ref_choice mode/1 は満たすが、core_move が支払い不能 → conditional_cost rollback
      expect(after.pendingDeckReveal).toBeNull();
    });
  });
});
