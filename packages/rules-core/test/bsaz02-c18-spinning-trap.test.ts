/**
 * BSAZ02-C18「旋転する罠」effects[0,1] 検証。
 *
 * 原文 (textLines[0,2,3]):
 *   系統：「火星」を持つ自分のアルティメットがいるとき、手札にあるこのカードのコストを5にする。
 *   フラッシュ
 *   スピリット/アルティメット1体をデッキの下に戻す。この効果で系統：「アルドノア」持つ自分の
 *   アルティメットを戻したとき、〔ゲームに1回：同名〕そのアルティメットの本来のコスト1につき、
 *   ボイドからコア1個を自分のリザーブに置く。
 *
 * 検証点:
 *  - effects[0]: 系統「火星」の自分のアルティメットが場にいるとき、手札にあるこのカードの
 *    コストが7→5に上書きされる (cost_modify 自己対象 override:5、BSSL01-X03 precedent 同型)。
 *  - effects[1]: send_to_deck で戻した対象が「自分が操作する」かつ「アルドノア」持ちアルティメット
 *    のときだけ、本来コスト分のコアがボイドからリザーブへ移る
 *    (StepCondition.ref_has_match.controllerRelation + DynamicCountSource.cost_from_ref、新設)。
 *    - 相手が操作する／アルドノア以外の系統／スピリット(アルティメット以外) はいずれも不発。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { calculateReduction } from "../src/core/cost-system";
import { flushPendingLeaves } from "../src/state-based-actions";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggerLookup = () => [];

const ALICE = "player-1";
const BOB = "player-2";
const C18 = card("BSAZ02-C18");

describe("BSAZ02-C18 effects[0]（手札コスト: 系統「火星」の自分のアルティメット存在で5に固定）", () => {
  it("火星アルティメットが場にいる: 手札の印字コスト7→5に上書き", () => {
    const source = createCardInstance(C18, {
      instanceId: "self-c18",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const marsUltimate = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "mars-ultimate",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, marsUltimate],
    });
    const result = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: C18,
      getCardDefinitionById: getDef,
      sourceInstanceId: "self-c18",
    });
    expect(result.printedCost).toBe(5);
  });

  it("火星アルティメットがいない: 印字コストは7のまま", () => {
    const source = createCardInstance(C18, {
      instanceId: "self-c18",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source],
    });
    const result = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: C18,
      getCardDefinitionById: getDef,
      sourceInstanceId: "self-c18",
    });
    expect(result.printedCost).toBe(7);
  });

  it("フィールド上 (applicability zone 外): 上書きせず印字7のまま", () => {
    const source = createCardInstance(C18, {
      instanceId: "self-c18",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const marsUltimate = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "mars-ultimate",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, marsUltimate],
    });
    const result = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: C18,
      getCardDefinitionById: getDef,
      sourceInstanceId: "self-c18",
    });
    expect(result.printedCost).toBe(7);
  });
});

describe("BSAZ02-C18 effects[1]（フラッシュ: デッキ下＋自分のアルドノアアルティメットを戻したときコア配置）", () => {
  function runFlash(state: GameState, sourceInstanceId = "src-c18"): GameState {
    return flushPendingLeaves(
      executeEffect({
        chainId: "test:bsaz02-c18-spinning-trap:122",
        state,
        effect: C18.effects![1]!,
        effectIndex: 1,
        sourceInstanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        // send_to_deck の対象選択 (count:1, filter マッチ全候補) は本テストでは
        // 単一候補のみを置くことで自動確定させる。
      }),
      getDef
    );
  }

  it("自分が操作する・アルドノア持ちアルティメットを戻す: 本来コスト分 (4) だけリザーブへコア移動", () => {
    const src = createCardInstance(C18, {
      instanceId: "src-c18",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    // BSAZ02-C01「アルギュレ」: 系統「火星・ＣＦ・アルドノア」、printedCategory:ultimate、cost:4
    const target = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "target-aldnoah-ultimate",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, target],
      startingVoidNormalCoreCount: 10,
    });
    const before = state.players.find((p) => p.id === ALICE)!;
    const after = runFlash(state);
    const moved = after.cardInstances.find(
      (c) => c.instanceId === "target-aldnoah-ultimate"
    );
    expect(moved?.zone).toBe("deck");
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(
      before.reserveNormalCoreCount + 4
    );
    expect(alice.voidNormalCoreCount).toBe(before.voidNormalCoreCount - 4);
  });

  it("〔ゲームに1回：同名〕は同名の別個体でも後段のコア移動だけを制限し、2回目も対象はデッキ下へ戻す", () => {
    const src = createCardInstance(C18, {
      instanceId: "src-c18",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const sameNameSrc = createCardInstance(C18, {
      instanceId: "same-name-src-c18",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const firstTarget = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "first-aldnoah-ultimate",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const initial = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, sameNameSrc, firstTarget],
      startingVoidNormalCoreCount: 10,
    });
    const before = initial.players.find((player) => player.id === ALICE)!;
    const first = runFlash(initial);

    // 1回目は唯一の対象を自動選択させ、解決後に2回目の唯一の対象を追加する。
    // これで target choice の pending を介さず、同名の別個体による2回目を再現できる。
    const secondTarget = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "second-aldnoah-ultimate",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const second = runFlash(
      {
        ...first,
        cardInstances: [...first.cardInstances, secondTarget],
      },
      "same-name-src-c18"
    );

    expect(
      second.cardInstances.find(
        (instance) => instance.instanceId === "first-aldnoah-ultimate"
      )?.zone
    ).toBe("deck");
    expect(
      second.cardInstances.find(
        (instance) => instance.instanceId === "second-aldnoah-ultimate"
      )?.zone
    ).toBe("deck");
    const alice = second.players.find((player) => player.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(
      before.reserveNormalCoreCount + 4
    );
    expect(second.log).toContain(
      "effect:step-usage-exhausted:same-name-src-c18:1:1"
    );
  });

  it("相手が操作するのアルドノア持ちアルティメットを戻す: コアは動かない (controllerRelation:self 不成立)", () => {
    const src = createCardInstance(C18, {
      instanceId: "src-c18",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const target = createCardInstance(card("BSAZ02-C01"), {
      instanceId: "target-aldnoah-ultimate",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, target],
      startingVoidNormalCoreCount: 10,
    });
    const before = state.players.find((p) => p.id === ALICE)!;
    const after = runFlash(state);
    const moved = after.cardInstances.find(
      (c) => c.instanceId === "target-aldnoah-ultimate"
    );
    expect(moved?.zone).toBe("deck");
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(before.reserveNormalCoreCount);
  });

  it("自分が操作するだがアルドノアを持たないアルティメットを戻す: コアは動かない (tribe 不一致)", () => {
    const src = createCardInstance(C18, {
      instanceId: "src-c18",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    // BSFT01-X01「星霊王」: 系統「光導・星霊」(アルドノア不含)、printedCategory:ultimate
    const target = createCardInstance(card("BSFT01-X01"), {
      instanceId: "target-non-aldnoah-ultimate",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, target],
      startingVoidNormalCoreCount: 10,
    });
    const before = state.players.find((p) => p.id === ALICE)!;
    const after = runFlash(state);
    const moved = after.cardInstances.find(
      (c) => c.instanceId === "target-non-aldnoah-ultimate"
    );
    expect(moved?.zone).toBe("deck");
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(before.reserveNormalCoreCount);
  });

  it("自分が操作するのアルドノア持ちスピリット(アルティメット以外)を戻す: コアは動かない (category 不一致)", () => {
    const src = createCardInstance(C18, {
      instanceId: "src-c18",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    // BSAZ02-C06「スカイキャリア」: 系統「火星・アルドノア」、printedCategory:spirit
    const target = createCardInstance(card("BSAZ02-C06"), {
      instanceId: "target-aldnoah-spirit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, target],
      startingVoidNormalCoreCount: 10,
    });
    const before = state.players.find((p) => p.id === ALICE)!;
    const after = runFlash(state);
    const moved = after.cardInstances.find(
      (c) => c.instanceId === "target-aldnoah-spirit"
    );
    expect(moved?.zone).toBe("deck");
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(before.reserveNormalCoreCount);
  });

  it("〔ゲームに1回：同名〕usageLimit が配線されている", () => {
    const coreMoveStep = C18.effects![1]!.steps[1]!;
    expect(coreMoveStep.prompt?.sourceText).toBe(
      "この効果で系統：「アルドノア」持つ自分のアルティメットを戻したとき、〔ゲームに1回：同名〕そのアルティメットの本来のコスト1につき、ボイドからコア1個を自分のリザーブに置く。"
    );
    expect(coreMoveStep.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
    });
  });
});
