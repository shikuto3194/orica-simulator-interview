/**
 * `core_move_destination_replacement` primitive (engine-core-move-destination-replacement):
 * 「このスピリットの効果で移動する相手のコアはトラッシュに置かれる」(BSKB01-R03【合体中】) /
 * 「相手のライフから移動するコアすべてをボイドに置く」(BSTH03-M05 Lv5) の強制置換。
 *
 * `life_gain_replacement` (BSTH02.7-X03) と異なり任意選択ではなく強制置換のため pending を
 * 挟まず、`executeCoreMove` が該当 CE を検知すると `to` を上書きして再実行する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeCoreMove,
  executeEffect,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id);

describe("BSKB01-R03 effects[1]: 合体中『自分のアタックステップ』このスピリットの効果で移動する相手のコアすべてはトラッシュに置かれる", () => {
  const r03 = card("BSKB01-R03");

  function combinedContinuousEffect(): {
    effect: NonNullable<CardDefinition["effects"]>[number];
    effectIndex: number;
  } {
    const effectIndex = (r03.effects ?? []).findIndex(
      (e) =>
        e.timing.kind === "continuous" &&
        e.steps.some(
          (s) => s.action.kind === "core_move_destination_replacement"
        )
    );
    if (effectIndex < 0) {
      throw new Error(
        "BSKB01-R03 core_move_destination_replacement effect not found"
      );
    }
    return { effect: r03.effects![effectIndex]!, effectIndex };
  }

  function boardWithCombinedR03(): GameState {
    return {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          createCardInstance(r03, {
            instanceId: "r03",
            ownerPlayerId: ALICE,
            zone: "field",
            normalCoreCount: 1,
            // 合体状態 (matchesCardFilter.combined 判定: attachedChildrenIds.length>0)。
            attachedChildrenIds: ["brave-dummy"],
          }),
          createCardInstance(r03, {
            instanceId: "bob-target",
            ownerPlayerId: BOB,
            zone: "field",
            normalCoreCount: 2,
          }),
        ],
      }),
      step: "attack",
      activePlayerId: ALICE,
    };
  }

  it("stub が解消され、core_move_destination_replacement action を持つ", () => {
    const { effect } = combinedContinuousEffect();
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability).toEqual({ combined: true });
    expect(effect.timingScope).toEqual({ player: "self", period: "attack" });
    expect(effect.steps[0]!.action).toEqual({
      kind: "core_move_destination_replacement",
      fromOwner: "opponent",
      matchCausingSourceOnly: true,
      toZone: "trash",
      duration: { scope: "while_on_field" },
    });
  });

  it("continuous 効果は core_move_destination_replacement CE を登録する", () => {
    const { effect, effectIndex } = combinedContinuousEffect();
    const state = boardWithCombinedR03();
    const afterRegister = executeEffect({
      chainId: "test:core-move-destination-replacement:99",
      state,
      effect,
      effectIndex,
      sourceInstanceId: "r03",
      actingPlayerId: ALICE,
      targetInstanceIds: [],
      getCardDefinitionById,
    });

    const ce = afterRegister.activeContinuousEffects.find(
      (c) => c.modifierTag === "core_move_destination_replacement"
    );
    expect(ce).toBeDefined();
    expect(ce?.sourceInstanceId).toBe("r03");
    expect(ce?.metadata).toEqual({
      fromOwner: "opponent",
      matchCausingSourceOnly: true,
      toZone: "trash",
    });
  });

  function stateWithReplacementCE(): GameState {
    const { effect, effectIndex } = combinedContinuousEffect();
    return executeEffect({
      chainId: "test:core-move-destination-replacement:123",
      state: boardWithCombinedR03(),
      effect,
      effectIndex,
      sourceInstanceId: "r03",
      actingPlayerId: ALICE,
      targetInstanceIds: [],
      getCardDefinitionById,
    });
  }

  it("このスピリット(r03)の効果で移動する相手のコアは、意図した移動先ではなく強制的にトラッシュへ置かれる", () => {
    const state = stateWithReplacementCE();
    const bobBefore = state.players.find((p) => p.id === BOB)!;
    const afterMove = executeCoreMove(
      state,
      ALICE,
      { kind: "field", player: "opponent" },
      { kind: "reserve", player: "opponent" }, // 本来の移動先 (置換で上書きされる)
      1,
      "r03",
      undefined,
      undefined,
      getCardDefinitionById
    );

    expect(afterMove.log.some((l) => l.includes("destination_replaced"))).toBe(
      true
    );
    const bobTarget = afterMove.cardInstances.find(
      (c) => c.instanceId === "bob-target"
    )!;
    const bobAfter = afterMove.players.find((p) => p.id === BOB)!;
    expect(bobTarget.normalCoreCount).toBe(1);
    expect(bobAfter.reserveNormalCoreCount).toBe(
      bobBefore.reserveNormalCoreCount
    );
    expect(bobAfter.trashNormalCoreCount).toBe(
      bobBefore.trashNormalCoreCount + 1
    );
  });

  it("別カードの効果 (matchCausingSourceOnly 不一致) で移動する相手のコアは置換されない", () => {
    const state = stateWithReplacementCE();
    const bobBefore = state.players.find((p) => p.id === BOB)!;
    const afterMove = executeCoreMove(
      state,
      ALICE,
      { kind: "field", player: "opponent" },
      { kind: "reserve", player: "opponent" },
      1,
      "some-other-source",
      undefined,
      undefined,
      getCardDefinitionById
    );

    expect(afterMove.log.some((l) => l.includes("destination_replaced"))).toBe(
      false
    );
    const bobAfter = afterMove.players.find((p) => p.id === BOB)!;
    expect(bobAfter.reserveNormalCoreCount).toBe(
      bobBefore.reserveNormalCoreCount + 1
    );
    expect(bobAfter.trashNormalCoreCount).toBe(bobBefore.trashNormalCoreCount);
  });

  it("自分のアタックステップ外 (timingScope 不一致) では置換されない", () => {
    const state: GameState = { ...stateWithReplacementCE(), step: "main" };
    const bobBefore = state.players.find((p) => p.id === BOB)!;
    const afterMove = executeCoreMove(
      state,
      ALICE,
      { kind: "field", player: "opponent" },
      { kind: "reserve", player: "opponent" },
      1,
      "r03",
      undefined,
      undefined,
      getCardDefinitionById
    );

    expect(afterMove.log.some((l) => l.includes("destination_replaced"))).toBe(
      false
    );
    const bobAfter = afterMove.players.find((p) => p.id === BOB)!;
    expect(bobAfter.reserveNormalCoreCount).toBe(
      bobBefore.reserveNormalCoreCount + 1
    );
  });
});

describe("BSTH03-M05 effects[2]: Lv5『このアルティメットのアタック時』相手のライフから移動するコアすべてをボイドに置く", () => {
  const m05 = card("BSTH03-M05");

  function lv5AttackEffect(): {
    effect: NonNullable<CardDefinition["effects"]>[number];
    effectIndex: number;
  } {
    const effectIndex = (m05.effects ?? []).findIndex(
      (e) =>
        e.timing.kind === "card_event" &&
        e.timing.event === "attack" &&
        e.steps.some(
          (s) => s.action.kind === "core_move_destination_replacement"
        )
    );
    if (effectIndex < 0) {
      throw new Error(
        "BSTH03-M05 core_move_destination_replacement effect not found"
      );
    }
    return { effect: m05.effects![effectIndex]!, effectIndex };
  }

  function boardWithM05(): GameState {
    return {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        playerOverrides: [{}, { lifeNormalCoreCount: 3 }],
        cardInstances: [
          createCardInstance(m05, {
            instanceId: "m05",
            ownerPlayerId: ALICE,
            zone: "field",
            normalCoreCount: 4,
          }),
        ],
      }),
      step: "attack",
      activePlayerId: ALICE,
    };
  }

  it("stub が解消され、core_move_destination_replacement action を持つ (duration:attack)", () => {
    const { effect } = lv5AttackEffect();
    expect(effect.stub).toBeUndefined();
    expect(effect.condition).toContainEqual({ kind: "min_level", value: 5 });
    expect(effect.steps[0]!.action).toEqual({
      kind: "core_move_destination_replacement",
      fromOwner: "opponent",
      fromZone: "life",
      toZone: "void",
      duration: { scope: "attack" },
    });
  });

  function stateWithReplacementCE(): GameState {
    const { effect, effectIndex } = lv5AttackEffect();
    return executeEffect({
      chainId: "test:core-move-destination-replacement:272",
      state: boardWithM05(),
      effect,
      effectIndex,
      sourceInstanceId: "m05",
      actingPlayerId: ALICE,
      targetInstanceIds: [],
      getCardDefinitionById,
    });
  }

  it("相手のライフから移動するコアは、原因を問わず (バトルダメージ由来でも) ボイドに置かれる", () => {
    const state = stateWithReplacementCE();
    const bobBefore = state.players.find((p) => p.id === BOB)!;
    // バトルダメージ由来のライフ→トラッシュ移動を模す (sourceInstanceId は m05 と無関係)。
    const afterMove = executeCoreMove(
      state,
      ALICE,
      { kind: "life", player: "opponent" },
      { kind: "trash", player: "opponent" },
      1,
      "battle-damage-source",
      undefined,
      undefined,
      getCardDefinitionById
    );

    expect(afterMove.log.some((l) => l.includes("destination_replaced"))).toBe(
      true
    );
    const bob = afterMove.players.find((p) => p.id === BOB)!;
    expect(bob.lifeNormalCoreCount).toBe(bobBefore.lifeNormalCoreCount - 1);
    expect(bob.trashNormalCoreCount).toBe(bobBefore.trashNormalCoreCount);
    expect(bob.voidNormalCoreCount).toBe(bobBefore.voidNormalCoreCount + 1);
  });

  it("相手のライフ以外 (fromZone 不一致) から移動するコアは置換されない", () => {
    const base = stateWithReplacementCE();
    const state: GameState = {
      ...base,
      cardInstances: [
        ...base.cardInstances,
        createCardInstance(m05, {
          instanceId: "bob-target",
          ownerPlayerId: BOB,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const afterMove = executeCoreMove(
      state,
      ALICE,
      { kind: "field", player: "opponent" },
      { kind: "trash", player: "opponent" },
      1,
      "some-source",
      undefined,
      undefined,
      getCardDefinitionById
    );

    expect(afterMove.log.some((l) => l.includes("destination_replaced"))).toBe(
      false
    );
    const bobTarget = afterMove.cardInstances.find(
      (c) => c.instanceId === "bob-target"
    )!;
    expect(bobTarget.normalCoreCount).toBe(0);
    expect(
      afterMove.players.find((p) => p.id === BOB)!.trashNormalCoreCount
    ).toBe(1);
  });
});
