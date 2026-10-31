/**
 * BSTH03-M06 [永夜抄]蓬莱山 輝夜 —
 *   【バースト：相手のアタックステップ開始後】
 *   指定した相手のスピリット/アルティメットをアタック不可 + 効果発揮不可にし、
 *   このカードをコストを支払わずに召喚する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const m06 = cardNoMap.get("BSTH03-M06");
if (!m06) throw new Error("BSTH03-M06 not found");

const OPPONENT_SPIRIT: CardDefinition = {
  cardNo: "TEST-M06-OPPONENT-SPIRIT",
  name: "M06 opponent spirit",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const getTestDef = (id: string): CardDefinition | undefined =>
  id === OPPONENT_SPIRIT.cardNo ? OPPONENT_SPIRIT : getDef(id);

describe("BSTH03-M06 蓬莱山 輝夜 — バースト指定ロック + 自己無料召喚", () => {
  const burst = m06.effects![0]!;

  it("構造: 指定対象を attack 不可 + blanket suppress_effect し、その後 self を free 召喚する", () => {
    expect(burst.stub).toBeUndefined();
    expect(burst.timing.kind).toBe("burst");

    const preventStep = burst.steps[0]!;
    expect(preventStep.id).toBe("designate");
    expect(preventStep.action.kind).toBe("prevent_battle");
    if (preventStep.action.kind === "prevent_battle") {
      expect(preventStep.action.restriction).toEqual(["attack"]);
      expect(preventStep.action.duration).toEqual({ scope: "turn" });
      expect(preventStep.action.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: 1,
      });
    }

    const suppressStep = burst.steps[1]!;
    expect(suppressStep.connector).toBe("simultaneous");
    expect(suppressStep.action).toEqual({
      kind: "suppress_effect",
      target: { kind: "ref", stepId: "designate" },
      duration: { scope: "turn" },
    });

    const summonStep = burst.steps[2]!;
    expect(summonStep.connector).toBe("after_triggers");
    expect(summonStep.action).toEqual({
      kind: "summon",
      target: { kind: "self" },
      costModifier: "free",
    });
  });

  it("[board] 指定した1体に attack 不可 CE と効果発揮不可 CE を同時登録する", () => {
    const source = createCardInstance(m06, {
      instanceId: "m06-burst-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const target = createCardInstance(OPPONENT_SPIRIT, {
      instanceId: "m06-target",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, target],
      }),
      activePlayerId: "bob",
      step: "attack",
    };

    const after = executeEffect({
      chainId: "test:bsth03-m06-burst-lock-self-summon:103",
      state,
      effect: burst,
      sourceInstanceId: "m06-burst-source",
      actingPlayerId: "alice",
      getCardDefinitionById: getTestDef,
      targetInstanceIds: ["m06-target"],
    });

    expect(
      after.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "prevent_battle_attack" &&
          ce.targetInstanceId === "m06-target"
      )
    ).toBe(true);
    const suppression = after.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "effect_suppression" &&
        ce.targetInstanceId === "m06-target"
    );
    expect(suppression).toBeDefined();
    expect(suppression?.metadata?.effectFilter).toBeUndefined();
  });
});
