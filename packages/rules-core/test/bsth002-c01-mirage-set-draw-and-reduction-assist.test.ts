/**
 * BSTH002-C01「化け化け」effects[1,2] (旧 stub) 検証。
 *
 * textLines:
 * - [4,5]【セット中】『自分のメインステップ』
 *   「ターンに1回、手札1枚を手元に置くことで、自分はデッキの上から1枚ドローする。
 *    この効果は、ターンに1回しか使えない。」
 * - [7,8]【セット中】
 *   「自分が系統：「封魔」を持つカードの召喚/配置/使用、効果の使用をするとき、
 *    その軽減シンボル1つを満たす。」
 *
 * effects[1] は BSGE01-C03 と同型 (timing:activated mode:"main" +
 * applicability.zone:["mirage_set"] + move_card→draw conditional_cost)。
 * effects[2] は BSTH09.2-転醒R03(A) effects[2] と同型 (treat_as reduction_symbol +
 * whenPayingForFilter.tribes + waivesReductionRequirement:true)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  calculateReduction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import { buildFieldCardEffectLookup } from "../src/effect/structured-effect-registrations";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const C01 = cardNoMap.get("BSTH002-C01")!; // 化け化け
const C02 = cardNoMap.get("BSTH002-C02")!; // 里香 (tribe:"幻想・封魔・職人", reductionSymbols:["white"])

const ALICE = "alice";
const BOB = "bob";

describe("BSTH002-C01 effects[0] shape (セット中メイン: 手札1枚→手元 conditional_cost ドロー1)", () => {
  const effect = C01.effects![0]!;

  it("セット中メインのドローは個体ごとのターン1回と同名共有のターン1回を併記する", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "main" });
    expect(effect.applicability).toEqual({ zone: ["mirage_set"] });
    expect(effect.usageLimit).toEqual([
      { kind: "per_instance", duration: "turn" },
      { kind: "per_card_name", duration: "turn" },
    ]);
  });

  it("steps: move_card(手札1枚→手元) → conditional_cost draw(1枚)", () => {
    expect(effect.steps).toHaveLength(2);
    expect(effect.steps[0]!.action).toEqual({
      kind: "move_card",
      target: {
        kind: "filter",
        player: "self",
        zone: "hand",
        filter: {},
        count: 1,
      },
      from: { zone: "hand", player: "self" },
      to: { zone: "set_aside", player: "self" },
      count: 1,
    });
    expect(effect.steps[1]!.action).toEqual({ kind: "draw", count: 1 });
    expect(effect.steps[1]!.connector).toBe("conditional_cost");
  });
});

describe("BSTH002-C01 effects[1] shape (セット中: 封魔カード軽減シンボル1つ補助)", () => {
  const effect = C01.effects![1]!;

  it("stub 解消済み、continuous + applicability=mirage_set", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "continuous" });
    expect(effect.applicability).toEqual({ zone: ["mirage_set"] });
  });

  it("treat_as reduction_symbol + whenPayingForFilter.tribes:封魔 + waivesReductionRequirement:true", () => {
    const treatAs = effect.steps[0]!.action;
    expect(treatAs.kind).toBe("treat_as");
    if (treatAs.kind === "treat_as") {
      expect(treatAs.aspects).toEqual(["reduction_symbol"]);
      expect(treatAs.whenPayingForFilter).toEqual({ tribes: ["封魔"] });
      expect(treatAs.waivesReductionRequirement).toBe(true);
    }
  });
});

describe("BSTH002-C01 盤面検証: セット中メイン 手札1枚を手元に置いてデッキ上から1枚ドロー", () => {
  it("legal declaration は二つのターン制限を記録し、同名2枚の再宣言をともに除外する", () => {
    const bakebake1 = createCardInstance(C01, {
      instanceId: "bakebake-1",
      ownerPlayerId: ALICE,
      zone: "mirage",
    });
    const bakebake2 = createCardInstance(C01, {
      instanceId: "bakebake-2",
      ownerPlayerId: ALICE,
      zone: "mirage",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          bakebake1,
          bakebake2,
          createCardInstance(C02, {
            instanceId: "hand-cost",
            ownerPlayerId: ALICE,
            zone: "hand",
          }),
          createCardInstance(C02, {
            instanceId: "deck-draw",
            ownerPlayerId: ALICE,
            zone: "deck",
          }),
        ],
        playerOverrides: [{ handCount: 1, deckCount: 1 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main",
    };
    const fieldLookup = buildFieldCardEffectLookup(ALL_CARDS);
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).find(
      (candidate) =>
        candidate.kind === "use_field_card_effect" &&
        candidate.sourceInstanceId === "bakebake-1"
    );
    expect(action).toBeDefined();
    if (!action) return;
    const declared = applyLegalAction({
      state,
      action,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    // AND 制限は一つの宣言 record に集約され、個体・同名のどちらの matcher
    // でもこれを消費済みとして扱う。下の legal action 列挙で両方の再宣言を拒否する。
    expect(declared.effectUsageRecords).toHaveLength(1);
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: declared.stackWindow!.priorityPlayerId,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).find((candidate) => candidate.kind === "pass_stack");
    expect(pass).toBeDefined();
    if (!pass) return;
    const afterPass = applyLegalAction({
      state: declared,
      action: pass,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    const target = getLegalActions({
      state: afterPass,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).find((candidate) => candidate.kind === "resolve_pending_effect_target");
    expect(target).toBeDefined();
    if (!target) return;
    let afterResolutionWindow = applyLegalAction({
      state: afterPass,
      action: target,
      targetInstanceIds: ["hand-cost"],
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    if (afterResolutionWindow.stackWindow) {
      const finalPass = getLegalActions({
        state: afterResolutionWindow,
        actingPlayerId: afterResolutionWindow.stackWindow.priorityPlayerId,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: fieldLookup,
        getRegisteredTriggeredEffectActions: () => [],
      }).find((candidate) => candidate.kind === "pass_stack");
      expect(finalPass).toBeDefined();
      if (!finalPass) return;
      afterResolutionWindow = applyLegalAction({
        state: afterResolutionWindow,
        action: finalPass,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: fieldLookup,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
    }
    expect(
      afterResolutionWindow.cardInstances.find(
        (card) => card.instanceId === "hand-cost"
      )?.zone
    ).toBe("set_aside");
    expect(
      afterResolutionWindow.cardInstances.find(
        (card) => card.instanceId === "deck-draw"
      )?.zone
    ).toBe("hand");
    const available = getLegalActions({
      state: afterResolutionWindow,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      available.some(
        (candidate) =>
          candidate.kind === "use_field_card_effect" &&
          (candidate.sourceInstanceId === "bakebake-1" ||
            candidate.sourceInstanceId === "bakebake-2")
      )
    ).toBe(false);
  });

  it("手札1枚が手元(set_aside)へ移動し、デッキ上から1枚ドローする", () => {
    const bakebake = createCardInstance(C01, {
      instanceId: "bakebake-mirage",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "mirage",
    });
    const handCard = createCardInstance(C02, {
      instanceId: "hand-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const deckCard = createCardInstance(C02, {
      instanceId: "deck-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [bakebake, handCard, deckCard],
        playerOverrides: [{ handCount: 1, deckCount: 1 }, {}],
      }),
      activePlayerId: ALICE,
      step: "main",
    };

    const after = executeEffect({
      chainId: "test:bsth002-c01-mirage-set-draw-and-reduction-assist:257",
      state: before,
      effect: C01.effects![0]!,
      sourceInstanceId: "bakebake-mirage",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(
      after.cardInstances.find((c) => c.instanceId === "hand-1")!.zone
    ).toBe("set_aside");
    const drawnCount = after.log.filter((l) =>
      l.includes("effect:draw")
    ).length;
    expect(drawnCount).toBe(1);
    expect(after.players.find((p) => p.id === ALICE)!.deckCount).toBe(0);
    expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(1);
  });
});

describe("BSTH002-C01 盤面検証: セット中、封魔カードの召喚コストが軽減シンボル1つ分自動で満たされる", () => {
  it("化け化けがミラージュセット中 → 系統:封魔の里香召喚コストが1軽減される", () => {
    const bakebake = createCardInstance(C01, {
      instanceId: "bakebake-mirage",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "mirage",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [bakebake],
    };

    const reduction = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: C02,
      getCardDefinitionById,
    });
    expect(reduction.totalReduction).toBe(1);
    expect(reduction.reducedCost).toBe(C02.cost - 1);
  });

  it("化け化けが手札にある(セット中でない)場合は軽減されない", () => {
    const bakebakeInHand = createCardInstance(C01, {
      instanceId: "bakebake-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [bakebakeInHand],
    };

    const reduction = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: C02,
      getCardDefinitionById,
    });
    expect(reduction.totalReduction).toBe(0);
    expect(reduction.reducedCost).toBe(C02.cost);
  });
});
