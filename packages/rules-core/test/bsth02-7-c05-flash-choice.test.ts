/**
 * BSTH02.7-C05 戦符「リトルレギオン」effects[2] フラッシュ二択の検証。
 *
 * 原文 (textLines[3,4]):
 * "自分のスピリット1体を回復させる。または、魂状態を含む自分の導界者ネクサスの
 *  「アリス・マーガトロイド」がいるとき、自分のカウント1以上なら、このターンの間、
 *  自分のライフは1しか減らない。"
 *
 * choices[0] (デフォルト) = recover 1体 / choices[1] = life_damage_interception
 * (mode:"turn_cap" cap:1)。後者は branch-local condition (field_has アリス +
 * count_value>=1) でゲートし、未充足なら resolution 時に skip（fizzle）する
 * (BSFT01-TR09(B)[7,8] と同型の field_has(includeSoulState) + count_value +
 * turn_cap ゲート、precedent: packages/rules-core/test/life-floor-cap.test.ts)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  resolveLifeDamage,
  getPlayerLifeCoreCount,
} from "../src/core/core-system";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  choiceIndex: number
): GameState {
  return executeEffect({
    chainId: "test:bsth02-7-c05-flash-choice:44",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
    choiceIndex,
  });
}

describe("BSTH02.7-C05 effects[2]: フラッシュ二択 (recover / turn_cap)", () => {
  const c05 = card("BSTH02.7-C05");
  const flashChoice = c05.effects![2]!;

  it("DSL 構造: choices[1] は branch-local condition でゲートされた turn_cap", () => {
    expect(flashChoice.stub).toBeUndefined();
    const step0 = flashChoice.steps[0]!;
    expect(step0.action.kind).toBe("recover");
    expect(step0.choice).toHaveLength(1);
    const variant1 = step0.choice![0]!;
    expect(variant1.action.kind).toBe("life_damage_interception");
    if (variant1.action.kind === "life_damage_interception") {
      expect(variant1.action.mode).toBe("turn_cap");
      expect(variant1.action.cap).toBe(1);
    }
    expect(variant1.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        category: ["nexus"],
        tribes: ["導界者"],
        cardNames: [{ contains: "アリス・マーガトロイド" }],
        includeSoulState: true,
      },
      { kind: "count_value", player: "self", min: 1 },
    ]);
  });

  it("[board] choiceIndex 0: 疲労状態のスピリットが回復する", () => {
    const source = createCardInstance(c05, {
      instanceId: "c05-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const spirit = createCardInstance(card("BSTH02.7-C02"), {
      instanceId: "sp-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      exhaustState: "exhausted",
    });
    let state = createEmptyGameState({
      cardInstances: [source, spirit],
    });
    state = runEffect(state, flashChoice, "c05-1", 0);
    const after = state.cardInstances.find((c) => c.instanceId === "sp-1")!;
    expect(after.exhaustState).toBe("recovered");
  });

  it("[board] choiceIndex 1 + アリス在場&カウント1以上: turn_cap:1 でライフ減少を1に制限", () => {
    const source = createCardInstance(c05, {
      instanceId: "c05-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const aliceNexus = createCardInstance(card("BSTH02.7-CX01"), {
      instanceId: "alice-nexus",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [source, aliceNexus],
      playerOverrides: [{ countValue: 1 }, {}],
    });
    state = runEffect(state, flashChoice, "c05-1", 1);

    const lifeOf = (s: GameState): number =>
      getPlayerLifeCoreCount(s.players.find((p) => p.id === ALICE)!);
    expect(lifeOf(state)).toBe(5);
    state = resolveLifeDamage(state, ALICE, 3, [], {
      cause: "battle",
      actingPlayerId: BOB,
    });
    // cap:1 のため 3 減少しようとしても 1 のみ減少。
    expect(lifeOf(state)).toBe(4);
  });

  it("[board] choiceIndex 1 だがアリス不在: branch condition 未充足で fizzle（ライフ制限なし）", () => {
    const source = createCardInstance(c05, {
      instanceId: "c05-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    let state = createEmptyGameState({
      cardInstances: [source],
      playerOverrides: [{ countValue: 1 }, {}],
    });
    state = runEffect(state, flashChoice, "c05-1", 1);

    const lifeOf = (s: GameState): number =>
      getPlayerLifeCoreCount(s.players.find((p) => p.id === ALICE)!);
    state = resolveLifeDamage(state, ALICE, 3, [], {
      cause: "battle",
      actingPlayerId: BOB,
    });
    // アリス不在で branch が fizzle → cap 無し → 3 全減少。
    expect(lifeOf(state)).toBe(2);
  });

  it(
    "[board] choiceIndex 1 だが同名別カード(BSTH02-M02 [妖々夢]アリス・マーガトロイド、" +
      "category:spirit)のみ在場: category/tribes 不一致で fizzle（ライフ制限なし）",
    () => {
      const source = createCardInstance(c05, {
        instanceId: "c05-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });
      const decoySpirit = createCardInstance(card("BSTH02-M02"), {
        instanceId: "decoy-alice",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      let state = createEmptyGameState({
        cardInstances: [source, decoySpirit],
        playerOverrides: [{ countValue: 1 }, {}],
      });
      state = runEffect(state, flashChoice, "c05-1", 1);

      const lifeOf = (s: GameState): number =>
        getPlayerLifeCoreCount(s.players.find((p) => p.id === ALICE)!);
      state = resolveLifeDamage(state, ALICE, 3, [], {
        cause: "battle",
        actingPlayerId: BOB,
      });
      // 同名だが category:spirit で導界者ネクサスではないため field_has 不一致 → fizzle → 3 全減少。
      expect(lifeOf(state)).toBe(2);
    }
  );
});
