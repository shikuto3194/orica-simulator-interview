import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
/**
 * 原文監査: 「その後、このカードをコストを支払わずに召喚する」バーストの
 * self-summon step は costModifier:"free" を明示し、維持コアだけで場に出る。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src";
import type { CardDefinition } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const cases = [
  { cardNo: "BSTS01-M01", effectIndex: 2 },
  { cardNo: "BSTS01-R02", effectIndex: 0 },
  { cardNo: "BSTS01-X03", effectIndex: 1 },
  { cardNo: "BSTH06-M01", effectIndex: 0 },
  { cardNo: "BSTH07-M01", effectIndex: 0 },
  { cardNo: "BSTH07-M02", effectIndex: 0 },
  { cardNo: "BSTH07-M03", effectIndex: 0 },
  { cardNo: "BSTH08-C04", effectIndex: 1 },
  { cardNo: "BSTH08-C05", effectIndex: 0 },
  { cardNo: "BSTH08-C06", effectIndex: 0 },
  { cardNo: "BSTH08.5-X02", effectIndex: 0 },
  { cardNo: "BSTH09-M01", effectIndex: 1 },
  { cardNo: "BSTH09-M02", effectIndex: 0 },
  { cardNo: "BSTH09-M03", effectIndex: 0 },
] as const;

describe.each(cases)("$cardNo burst self-summon", ({ cardNo, effectIndex }) => {
  const card = cardNoMap.get(cardNo)!;
  const effect = card.effects![effectIndex]!;
  const selfSummonStep = effect.steps.find(
    (step) =>
      step.action.kind === "summon" && step.action.target.kind === "self"
  )!;

  it("[board] costModifier free を明示し、維持コア1個だけでバーストから場へ出る", () => {
    expect(selfSummonStep.action.kind).toBe("summon");
    if (selfSummonStep.action.kind !== "summon") return;
    expect(selfSummonStep.action.target).toEqual({ kind: "self" });
    expect(selfSummonStep.action.costModifier).toBe("free");

    const source = createCardInstance(card, {
      instanceId: `${cardNo}-burst`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const initial = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 1 }, {}],
      cardInstances: [source],
    });
    const after = executeEffectWithChosenMinimumCores({
      chainId: "test:burst-self-summon-free-cost-audit:54",
      state: initial,
      effect: { ...effect, steps: [selfSummonStep] },
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    expect(
      after.cardInstances.find(
        (entry) => entry.instanceId === source.instanceId
      )?.zone
    ).toBe("field");
    expect(
      after.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(0);
  });
});
