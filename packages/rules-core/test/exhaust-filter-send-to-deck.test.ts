/**
 * 疲労状態フィルタ付き send_to_deck の配線・盤面変化検証。
 *
 * CardFilter.exhaustState は実装済み（card-filter.ts）だが、以下のバースト
 * 効果はカードデータ側で未配線（stale stub）だった。疲労状態の相手のみを
 * 対象にできること（回復状態は除外）と、対象がデッキ下へ戻ることを検証する。
 *
 *  - BSTH03-M04 [永夜抄]十六夜 咲夜 effect[0]（バースト）
 *  - BSTH05-M03 [風神録]霧雨 魔理沙 effect[1]（バースト）
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
} from "../src";
import { matchesCardFilter } from "../src/card/card-filter";
import { generateBurstRegistrations } from "../src/effect/structured-effect-registrations";
import { getEffectPreventionLevel } from "../src/legal/legal-actions-shared";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

/** 相手スピリット役の汎用カード（バニラスピリット） */
const VANILLA = "BSTH003-C01";

const CASES = [
  {
    cardNo: "BSTH05-M03",
    effectIndex: 1,
    preventionRestriction: { onlyPreventableByKeywords: ["超重装甲"] },
  },
  {
    cardNo: "BSTH03-M04",
    effectIndex: 0,
    preventionRestriction: { onlyPreventableByTribes: ["起幻"] },
  },
] as const;

function expectedBypassFilter(
  preventionRestriction: (typeof CASES)[number]["preventionRestriction"]
): Record<string, unknown> {
  if ("onlyPreventableByKeywords" in preventionRestriction) {
    return { keywords: preventionRestriction.onlyPreventableByKeywords };
  }
  return { tribes: preventionRestriction.onlyPreventableByTribes };
}

describe("疲労状態フィルタ付き send_to_deck", () => {
  for (const { cardNo, effectIndex, preventionRestriction } of CASES) {
    describe(cardNo, () => {
      const srcDef = cardNoMap.get(cardNo)!;
      const burst = srcDef.effects![effectIndex]!;
      const sendStep = burst.steps[0]!;
      const summonStep = burst.steps[1]!;

      it("カードデータが存在し stub が解消されている", () => {
        expect(srcDef).toBeDefined();
        expect(burst.stub).toBeUndefined();
      });

      it("send_to_deck に exhaustState フィルタが配線されている", () => {
        expect(sendStep.action.kind).toBe("send_to_deck");
        if (sendStep.action.kind === "send_to_deck") {
          expect(sendStep.action.target.kind).toBe("filter");
          if (sendStep.action.target.kind === "filter") {
            expect(sendStep.action.target.filter.exhaustState).toBe(
              "exhausted"
            );
          }
        }
      });

      it("効果に preventionRestriction が配線されている（stale maxPreventable:0 は撤去）", () => {
        expect(sendStep.action.maxPreventable).toBeUndefined();
        expect(burst.preventionRestriction).toEqual(preventionRestriction);
      });

      it("burst registration が scoped targetLockBypass を導出", () => {
        // RegisteredBurstAction には effectIndex が無いため、このカードの burst は
        // 1 個だけである前提で effect 全件を検証する
        // (prevention-restriction-stale-stub-sweep.test.ts と同じ convention)。
        const regs = generateBurstRegistrations(srcDef);
        expect(regs.length).toBeGreaterThan(0);
        for (const reg of regs) {
          expect(getEffectPreventionLevel(reg)).toBe("none");
          expect(reg.targetLockBypass).toEqual({
            kind: "preventing_effect_filter",
            filter: {
              ...expectedBypassFilter(preventionRestriction),
              bypassUnlessMatches: true,
            },
          });
        }
      });

      it("self-summon が free で配線されている（from_zone hand 誤りの是正）", () => {
        expect(summonStep.action.kind).toBe("summon");
        if (summonStep.action.kind === "summon") {
          expect(summonStep.action.target.kind).toBe("self");
          expect(summonStep.action.costModifier).toBe("free");
        }
      });

      it("カードの実フィルタは疲労状態のみマッチ・回復状態は除外", () => {
        if (sendStep.action.kind !== "send_to_deck") throw new Error("kind");
        if (sendStep.action.target.kind !== "filter") throw new Error("filter");
        const filter = sendStep.action.target.filter;
        const oppDef = cardNoMap.get(VANILLA)!;
        const exhausted = createCardInstance(oppDef, {
          instanceId: "ex",
          ownerPlayerId: "bob",
          zone: "field",
          exhaustState: "exhausted",
        });
        const recovered = createCardInstance(oppDef, {
          instanceId: "rec",
          ownerPlayerId: "bob",
          zone: "field",
          exhaustState: "recovered",
        });
        expect(matchesCardFilter(exhausted, oppDef, filter)).toBe(true);
        expect(matchesCardFilter(recovered, oppDef, filter)).toBe(false);
      });

      it("解決時: 指定した疲労状態の相手スピリットがデッキ下へ戻る", () => {
        const oppDef = cardNoMap.get(VANILLA)!;
        const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
        const src = createCardInstance(srcDef, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        });
        const exhausted = createCardInstance(oppDef, {
          instanceId: "opp-exhausted",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "exhausted",
        });
        const state: GameState = {
          ...base,
          activePlayerId: "alice",
          step: "main",
          cardInstances: [src, exhausted],
        };
        const result = flushPendingLeaves(
          executeEffect({
            chainId: "test:exhaust-filter-send-to-deck:156",
            state,
            effect: burst,
            sourceInstanceId: "src-1",
            actingPlayerId: "alice",
            getCardDefinitionById,
            targetInstanceIds: ["opp-exhausted"],
          }),
          getCardDefinitionById
        );
        const zone = result.cardInstances.find(
          (c) => c.instanceId === "opp-exhausted"
        )?.zone;
        expect(zone).toBe("deck");
      });
    });
  }
});
