/**
 * BSGE01 神喰「カウント保護タグ」の挙動検証。
 * 「追加したカウントは自分の系統：「神喰」を持たない効果で数えられず、その効果を受けない」
 * = protectedFromNonTribe を持つ count_increase は protectedCounts に記録され、
 * 神喰を持たない効果からは (1) カウントとして数えられず (2) 減らされない。
 */
import { describe, expect, it } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  expandCardDefinitionsWithBackFaces,
} from "../src";
import {
  executeCountIncrease,
  executeCountDecrease,
  evaluateCondition,
} from "../src/effect/structured-effect-interpreter";
import { executeEffect, type Effect } from "../src";
import { evaluateStepCondition } from "../src/effect/native-condition-connector";
import {
  createStepExecutionContext,
  deserializeStepContext,
  serializeStepContext,
} from "../src/step-execution-context";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src/model";
import { countValueVisibleToEffect } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const expandedCardMap = new Map(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((card) => [
    card.cardNo,
    card,
  ])
);
const getExpandedDef = (id: string): CardDefinition | undefined =>
  expandedCardMap.get(id);

const GODEATER = "BSGE01-C05"; // tribe: 神喰・神機・1G
const NON_GODEATER = ALL_CARDS.find(
  (c) =>
    !c.tribe?.split("・").includes("神喰") && c.printedCategory === "spirit"
)!.cardNo;

const PLAYER = "player-1";

describe("BSGE01 カウント保護タグ", () => {
  it("効果用可視カウントは発揮元系統で保護分を差し引き、総量を下回る範囲に丸める", () => {
    expect(countValueVisibleToEffect(8, { 神喰: 8 }, ["神喰", "神機"])).toBe(8);
    expect(countValueVisibleToEffect(8, { 神喰: 8 }, ["幻想"])).toBe(0);
    expect(countValueVisibleToEffect(2, { 神喰: 8 }, ["幻想"])).toBe(0);
    expect(countValueVisibleToEffect(8, { 神喰: -2 }, ["幻想"])).toBe(8);
  });

  it("カード data: 16枚の count_increase が protectedFromNonTribe:神喰 を持ち stub が消えている", () => {
    const protectedCards = ALL_CARDS.filter(
      (c) =>
        c.cardNo.startsWith("BSGE01-") &&
        c.effects?.some((e) =>
          e.steps.some(
            (s) =>
              s.action.kind === "count_increase" &&
              (s.action as { protectedFromNonTribe?: string })
                .protectedFromNonTribe === "神喰"
          )
        )
    );
    expect(protectedCards.length).toBe(16);
    // 純粋な保護タグ stub は全消し（残り2枚は別ギャップで stub 継続）
    const lingering = protectedCards.filter((c) =>
      c.effects?.some((e) => e.stub?.includes("カウント保護タグ"))
    );
    expect(lingering.length).toBe(0);
  });

  it("executeCountIncrease(protected): countValue と protectedCounts の双方が増える", () => {
    const state = createEmptyGameState({ playerIds: [PLAYER, "player-2"] });
    const next = executeCountIncrease(state, PLAYER, "self", 3, "神喰");
    const p = next.players.find((x) => x.id === PLAYER)!;
    expect(p.countValue).toBe(3);
    expect(p.protectedCounts).toEqual({ 神喰: 3 });
  });

  it("count_value 条件: 神喰ソースは保護分を数える / 非神喰ソースは数えない", () => {
    const godeater = createCardInstance(getDef(GODEATER)!, {
      ownerPlayerId: PLAYER,
      zone: "field",
      instanceId: "ge-src",
    });
    const nonGodeater = createCardInstance(getDef(NON_GODEATER)!, {
      ownerPlayerId: PLAYER,
      zone: "field",
      instanceId: "non-ge-src",
    });
    const state = createEmptyGameState({
      playerIds: [PLAYER, "player-2"],
      cardInstances: [godeater, nonGodeater],
      playerOverrides: [{ countValue: 3, protectedCounts: { 神喰: 3 } }, {}],
    });
    const clause = [{ kind: "count_value", player: "self", min: 3 } as const];
    // 神喰ソース: 3 >= 3 → true
    expect(evaluateCondition(state, clause, "ge-src", PLAYER, getDef)).toBe(
      true
    );
    // 非神喰ソース: (3 - 3) = 0 >= 3 → false（保護分は数えられない）
    expect(evaluateCondition(state, clause, "non-ge-src", PLAYER, getDef)).toBe(
      false
    );
  });

  it("borrowed dynamic count uses the effect text source tribe", () => {
    const host = createCardInstance(getDef(NON_GODEATER)!, {
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "field",
      instanceId: "borrowed-host",
    });
    const textSource = createCardInstance(getDef(GODEATER)!, {
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "field",
      instanceId: "borrowed-text-source",
    });
    const state = createEmptyGameState({
      playerIds: [PLAYER, "player-2"],
      cardInstances: [host, textSource],
      playerOverrides: [{ countValue: 8, protectedCounts: { 神喰: 8 } }, {}],
    });
    const effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "count_decrease",
            player: "self",
            amount: { source: { kind: "count_value", player: "self" } },
          },
        },
      ],
    } as unknown as Effect;

    const next = executeEffect({
      state,
      effect,
      sourceInstanceId: host.instanceId,
      effectSourceInstanceId: textSource.instanceId,
      actingPlayerId: PLAYER,
      chainId: "test:bsge01:borrowed-dynamic-count",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(
      next.players.find((player) => player.id === PLAYER)?.countValue
    ).toBe(0);
  });

  it("rebirth_precheck and execution use the same borrowed effect source", () => {
    const target = createCardInstance(getExpandedDef("BSTH03-転醒R01(A)")!, {
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "field",
      instanceId: "borrowed-rebirth-target",
    });
    const textSource = createCardInstance(getExpandedDef(GODEATER)!, {
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "field",
      instanceId: "borrowed-rebirth-source",
    });
    const state = createEmptyGameState({
      playerIds: [PLAYER, "player-2"],
      cardInstances: [target, textSource],
      playerOverrides: [{ countValue: 8, protectedCounts: { 神喰: 8 } }, {}],
    });
    const stepContext = createStepExecutionContext(state);
    stepContext.sourceInstanceId = target.instanceId;
    stepContext.effectSourceInstanceId = textSource.instanceId;
    const restoredStepContext = deserializeStepContext(
      serializeStepContext(stepContext),
      state
    );
    restoredStepContext.sourceInstanceId = target.instanceId;
    expect(restoredStepContext.effectSourceInstanceId).toBe(
      textSource.instanceId
    );

    expect(
      evaluateStepCondition(
        { kind: "rebirth_precheck", maxCount: 3 },
        restoredStepContext,
        state,
        getExpandedDef
      )
    ).toBe(false);
    restoredStepContext.effectSourceInstanceId = target.instanceId;
    expect(
      evaluateStepCondition(
        { kind: "rebirth_precheck", maxCount: 3 },
        restoredStepContext,
        state,
        getExpandedDef
      )
    ).toBe(true);
  });

  it("executeCountDecrease: 非神喰ソースは保護分まで減らせない（床）", () => {
    const state = createEmptyGameState({
      playerIds: [PLAYER, "player-2"],
      playerOverrides: [{ countValue: 5, protectedCounts: { 神喰: 3 } }, {}],
    });
    // 非神喰効果が -5 を試みる → 減らせるのは 5-3=2 まで
    const afterNon = executeCountDecrease(state, PLAYER, "self", 5, ["幻想"]);
    const pNon = afterNon.players.find((x) => x.id === PLAYER)!;
    expect(pNon.countValue).toBe(3);
    expect(pNon.protectedCounts).toEqual({ 神喰: 3 });
  });

  it("executeCountDecrease: 神喰ソースは保護分も含めて減らせる", () => {
    const state = createEmptyGameState({
      playerIds: [PLAYER, "player-2"],
      playerOverrides: [{ countValue: 5, protectedCounts: { 神喰: 3 } }, {}],
    });
    // 神喰効果が -5 → 0 まで減り、保護も 0 に丸まる
    const after = executeCountDecrease(state, PLAYER, "self", 5, [
      "神喰",
      "神機",
    ]);
    const p = after.players.find((x) => x.id === PLAYER)!;
    expect(p.countValue).toBe(0);
    expect(p.protectedCounts).toBeUndefined();
  });
});
