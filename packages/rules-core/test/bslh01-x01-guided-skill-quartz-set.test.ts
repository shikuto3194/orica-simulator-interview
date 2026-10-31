/**
 * BSLH01-X01「[導界者]キーア」【導技：2】Lv1-Lv2 フラッシュ:
 * 「〔ターンに1回、このネクサスのコア-2する〕自分のデッキを上から2枚オープンし、
 * その中のクォーツ効果を持つカード1枚をコストを支払わずに魂状態の対象にセットする。
 * 残ったカードはデッキの下に戻す。」
 *
 * 「このネクサスのコア-2する」bracket cost を持つため
 * project_divine_skill_model_target_maxuses に従い grandwalkerData.divineSkills
 * (label:"guided_skill") でモデル化する（effects[] 自己コスト step は legal-actions が
 * 検査しないバグを踏むため禁止、bsth04-dotechi-core-cost-gate.test.ts 参照）。
 * deck_reveal の選択前境界で公開カードを選び、quartz_set(free:true) を完了してから残りを戻す。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const X01 = cardNoMap.get("BSLH01-X01")!;
const getCardDefinitionById = (id: string) => cardNoMap.get(id) ?? defs.get(id);
const noTriggeredLookup = () => [];

const ALICE = "alice";
const BOB = "bob";

const hostDef: CardDefinition = {
  cardNo: "TEST-X01-ENIGMA-HOST",
  name: "ENIGMA[戦術オーブメント]テスト",
  printedCategory: "brave",
  colors: ["blue"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  quartzHostData: { slots: { left: 3, center: 1, right: 3 } },
};

const quartzCard: CardDefinition = {
  cardNo: "TEST-X01-QUARTZ",
  name: "テストクォーツ",
  printedCategory: "spirit",
  colors: ["black"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  quartzData: {
    quartzName: "テスト駆動",
    cost: 0,
    reduction: [],
    countCost: 1,
    attributeValues: {},
  },
};

const filler: CardDefinition = {
  cardNo: "TEST-X01-FILLER",
  name: "テストフィラー",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = new Map<string, CardDefinition>(
  [hostDef, quartzCard, filler].map((d) => [d.cardNo, d])
);

function skill() {
  return X01.grandwalkerData!.divineSkills![0]!;
}

function baseState(): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const x01Instance = createCardInstance(X01, {
    instanceId: "x01",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 2,
  });
  const host = createCardInstance(hostDef, {
    instanceId: "x01-host",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const quartz = createCardInstance(quartzCard, {
    instanceId: "quartz-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "deck",
  });
  const fillerInstance = createCardInstance(filler, {
    instanceId: "filler-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "deck",
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    cardInstances: [x01Instance, host, quartz, fillerInstance],
    players: base.players.map((p) =>
      p.id === ALICE
        ? {
            ...p,
            deckCount: 2,
            countValue: 0,
            soulStateInstanceIds: ["x01-host"],
          }
        : p
    ),
  };
}

describe("BSLH01-X01 【導技：2】: divineSkills(guided_skill) + deck_reveal(ref) + quartz_set(free)", () => {
  it("候補が2枚あれば公開状態でカードを選び、セット完了後に残りを戻す", () => {
    const state = baseState();
    const filler = state.cardInstances.find(
      (c) => c.instanceId === "filler-1"
    )!;
    filler.definitionId = quartzCard.cardNo;
    let after = executeEffect({
      chainId: "test:bslh01-x01-guided-skill-quartz-set:146",
      state,
      effect: skill().effects![0]!,
      effectIndex: 0,
      divineSkillIndex: 0,
      sourceInstanceId: "x01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    });
    expect(
      after.cardInstances.filter((c) => c.zone === "revealed")
    ).toHaveLength(2);
    expect(after.quartzSetStates).toHaveLength(0);
    const action = getLegalActions({
      state: after,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_step_optional_target_selection");
    expect(action).toBeDefined();
    after = applyLegalAction({
      state: after,
      action: action!,
      targetInstanceIds: ["filler-1"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    }).state;
    expect(after.pendingStepChoice).not.toBeNull();
    const placement = getLegalActions({
      state: after,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_choice" && a.choiceLabel.includes("右")
    );
    expect(placement).toBeDefined();
    after = applyLegalAction({
      state: after,
      action: placement!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    }).state;
    expect(
      after.cardInstances.find((c) => c.instanceId === "filler-1")?.zoneRoleName
    ).toBe("quartz");
    expect(
      after.cardInstances.find((c) => c.instanceId === "quartz-1")?.zone
    ).toBe("deck");
    expect(after.players.find((p) => p.id === ALICE)?.handCount).toBe(
      state.players.find((p) => p.id === ALICE)?.handCount
    );
    expect(after.pendingDeckReveal).toBeNull();
  });
  it("card-data: coreCost=2 / timing=flash / Lv1-2 / ターン1回、effects は deck_reveal→quartz_set(ref,free)", () => {
    const s = skill();
    expect(s.label).toBe("guided_skill");
    expect(s.coreCost).toBe(2);
    expect(s.timing).toBe("flash");
    expect(s.minLevel).toBe(1);
    expect(s.maxLevel).toBe(2);
    expect(s.turnLimit).toBe("once");

    const steps = s.effects![0]!.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0]!.id).toBe("x01reveal");
    const reveal = steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind !== "deck_reveal") throw new Error("unreachable");
    expect(reveal.revealCount).toBe(2);
    expect(reveal.remainder).toBe("bottom");
    expect(reveal.picks).toEqual([]);

    const set = reveal.beforePickSteps![0]!.action;
    expect(set.kind).toBe("quartz_set");
    if (set.kind !== "quartz_set") throw new Error("unreachable");
    expect(set.target).toEqual({
      kind: "filter",
      player: "self",
      zone: "revealed",
      filter: { hasQuartzData: true },
      count: 1,
    });
    expect(set.free).toBe(true);
  });

  it("実行: 2枚オープン→クォーツ1枚を無償で魂状態ホストへセット、残りはデッキ下へ", () => {
    const state = baseState();
    let afterReveal = executeEffect({
      chainId: "test:bslh01-x01-guided-skill-quartz-set:218",
      state,
      effect: skill().effects![0]!,
      effectIndex: 0,
      divineSkillIndex: 0,
      sourceInstanceId: "x01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    });
    expect(
      afterReveal.pendingStepOptionalTargetSelection?.candidateInstanceIds
    ).toEqual(["quartz-1"]);
    const select = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_step_optional_target_selection");
    afterReveal = applyLegalAction({
      state: afterReveal,
      action: select!,
      targetInstanceIds: ["quartz-1"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    }).state;
    expect(afterReveal.pendingStepChoice).not.toBeNull();
    expect(
      afterReveal.cardInstances.find((c) => c.instanceId === "quartz-1")?.zone
    ).toBe("revealed");
    const placement = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_choice" && a.choiceLabel.includes("右")
    );
    expect(placement).toBeDefined();
    const afterPick = applyLegalAction({
      state: afterReveal,
      action: placement!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    }).state;

    expect(afterPick.pendingStepChoice).toBeNull();
    expect(afterPick.pendingDeckReveal).toBeNull();
    const quartzAfter = afterPick.cardInstances.find(
      (c) => c.instanceId === "quartz-1"
    )!;
    expect(quartzAfter.zone).toBe("field");
    expect(quartzAfter.zoneRoleName).toBe("quartz");
    expect(
      afterPick.quartzSetStates.some(
        (q) =>
          q.quartzInstanceId === "quartz-1" &&
          q.hostInstanceId === "x01-host" &&
          q.slot === "right"
      )
    ).toBe(true);
    expect(
      afterPick.players.find((p) => p.id === ALICE)!.soulStateInstanceIds
    ).toContain("quartz-1");
    // free:true のため countCost(=1) は countValue:0 のままでも成立する。
    expect(afterPick.players.find((p) => p.id === ALICE)!.countValue).toBe(0);

    const fillerAfter = afterPick.cardInstances.find(
      (c) => c.instanceId === "filler-1"
    )!;
    expect(fillerAfter.zone).toBe("deck");
  });
});
