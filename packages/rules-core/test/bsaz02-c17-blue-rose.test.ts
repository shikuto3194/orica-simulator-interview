/**
 * BSAZ02-C17「青い薔薇の花言葉」effects[0,1] 検証。
 *
 * 原文 (textLines[0,2,3]):
 *   系統：「火星」を持つ自分のアルティメットがアタック/ブロックしている間、手札にあるこの
 *   カードのコストを4にする。
 *   フラッシュ
 *   シンボル1つの相手のスピリット/アルティメットを1体をデッキの下に戻す。その後、自分の
 *   トラッシュの系統：「火星」を持つネクサスカード1枚をコストを支払わずに配置する。配置した
 *   導界者ネクサスの「配置したとき」の【導託】は発揮されない。
 *
 * 検証点:
 *  - effects[0]: 系統「火星」の自分のアルティメットが「アタック中」「ブロック中」いずれかの
 *    ときだけ、手札のこのカードのコストが6→4に上書きされる (field_has.battleState:"in_battle"
 *    新設、"attacking"|"blocking" いずれかを許容する ConditionClause 拡張)。アイドル状態や
 *    フィールド上 (applicability zone 外) では上書きされない。
 *  - effects[1]: シンボル1つの相手ユニットをデッキ下へ戻し (symbolCount フィルタ)、続けて
 *    自分のトラッシュの火星ネクサス1枚をコスト不要で配置する (SummonAction.suppressPlacementOracle
 *    新設)。配置された導界者ネクサスの「配置したとき」神託 (checkAndQueuePlacementOracle) が
 *    finalizeEffectResolution の diff 検出で不発になることを、抑止フラグ有無の対比で確認する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, Effect, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";
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
const noTriggerLookup = () => undefined;

const ALICE = "player-1";
const BOB = "player-2";
const C17 = card("BSAZ02-C17");
// BSAZ02-X04「[導界者]アセイラム・ヴァース・アリューシア」: printedCategory:nexus,
// tribe「導界者・火星・アルドノア」、grandwalkerData.kind:"guided"（配置時導託対象）。
const X04 = card("BSAZ02-X04");
// BSAZ02-C01「アルギュレ」: 系統「火星・ＣＦ・アルドノア」、printedCategory:ultimate。
const MARS_ULTIMATE = card("BSAZ02-C01");
// symbolColors 長さ1 の相手ユニット候補。
const SINGLE_SYMBOL_UNIT = MARS_ULTIMATE;

describe("BSAZ02-C17 effects[0]（手札コスト: 自分の火星アルティメットがアタック/ブロック中なら4）", () => {
  function costWith(attackState: "idle" | "attacking" | "blocking"): number {
    const source = createCardInstance(C17, {
      instanceId: "self-c17",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const marsUltimate = createCardInstance(MARS_ULTIMATE, {
      instanceId: "mars-ultimate",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, marsUltimate],
      battleEntities:
        attackState === "idle"
          ? []
          : [
              {
                entityId: "be-mars-ultimate",
                memberInstanceIds: ["mars-ultimate"],
                resolvedBp: 8000,
                resolvedSymbols: [],
                attackState,
              },
            ],
    });
    return calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: C17,
      getCardDefinitionById: getDef,
      sourceInstanceId: "self-c17",
    }).printedCost;
  }

  it("火星アルティメットがアタック中: 手札の印字コスト6→4に上書き", () => {
    expect(costWith("attacking")).toBe(4);
  });

  it("火星アルティメットがブロック中: 手札の印字コスト6→4に上書き", () => {
    expect(costWith("blocking")).toBe(4);
  });

  it("火星アルティメットがアイドル状態 (バトル外): 印字コストは6のまま", () => {
    expect(costWith("idle")).toBe(6);
  });

  it("フィールド上 (applicability zone 外): アタック中でも上書きせず印字6のまま", () => {
    const source = createCardInstance(C17, {
      instanceId: "self-c17",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const marsUltimate = createCardInstance(MARS_ULTIMATE, {
      instanceId: "mars-ultimate",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, marsUltimate],
      battleEntities: [
        {
          entityId: "be-mars-ultimate",
          memberInstanceIds: ["mars-ultimate"],
          resolvedBp: 8000,
          resolvedSymbols: [],
          attackState: "attacking",
        },
      ],
    });
    const result = calculateReduction({
      state,
      actingPlayerId: ALICE,
      card: C17,
      getCardDefinitionById: getDef,
      sourceInstanceId: "self-c17",
    });
    expect(result.printedCost).toBe(6);
  });
});

describe("BSAZ02-C17 effects[1]（フラッシュ: シンボル1つの相手を戻し、火星ネクサスをコスト不要配置）", () => {
  function baseState(): GameState {
    const src = createCardInstance(C17, {
      instanceId: "src-c17",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const bobUnit = createCardInstance(SINGLE_SYMBOL_UNIT, {
      instanceId: "bob-unit",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const trashNexus = createCardInstance(X04, {
      instanceId: "trash-x04",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const deckFiller = createCardInstance(MARS_ULTIMATE, {
      instanceId: "deck-filler",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "deck",
    });
    return createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, bobUnit, trashNexus, deckFiller],
    });
  }

  it("シンボル1つの相手ユニットをデッキ下へ戻し、トラッシュの火星ネクサスをコスト不要で場に配置する", () => {
    const before = baseState();
    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsaz02-c17-blue-rose:176",
        state: before,
        effect: C17.effects![1]!,
        effectIndex: 1,
        sourceInstanceId: "src-c17",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      }),
      getDef
    );

    const bounced = after.cardInstances.find(
      (c) => c.instanceId === "bob-unit"
    );
    expect(bounced?.zone).toBe("deck");

    const placed = after.cardInstances.find(
      (c) => c.instanceId === "trash-x04"
    );
    expect(placed?.zone).toBe("field");
    expect(placed?.zoneRoleName).toBe("nexus");
    // コストを支払わずに配置 = リザーブが減っていない。
    const alice = after.players.find((p) => p.id === ALICE)!;
    const aliceBefore = before.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(
      aliceBefore.reserveNormalCoreCount
    );
  });

  it("配置された導界者ネクサスに oraclePlacementSuppressed が立つ (suppressPlacementOracle 経由)", () => {
    const before = baseState();
    const after = executeEffect({
      chainId: "test:bsaz02-c17-blue-rose:208",
      state: before,
      effect: C17.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: "src-c17",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const placed = after.cardInstances.find(
      (c) => c.instanceId === "trash-x04"
    );
    expect(placed?.oraclePlacementSuppressed).toBe(true);
  });

  it("finalizeEffectResolution 通過後も配置時神託 (placement_oracle) の pending が積まれない", () => {
    const before = baseState();
    const afterSteps = executeEffect({
      chainId: "test:bsaz02-c17-blue-rose:225",
      state: before,
      effect: C17.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: "src-c17",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const finalized = finalizeEffectResolution({
      state: afterSteps,
      beforeState: before,
      chainId: "c17-flash-chain",
      endLogs: [],
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: undefined,
      causedBySourceInstanceId: "src-c17",
    });
    const placementOraclePendings = finalized.pendingTriggeredEffects.filter(
      (p) => p.mechanic?.kind === "placement_oracle"
    );
    expect(placementOraclePendings).toHaveLength(0);
  });

  it("oraclePlacementSuppressed は finalizeEffectResolution の diff パスで消費され false に戻る (move_card 等の別経路での将来の再配置へ persist しないことの確認、verifier round1 指摘の修正)", () => {
    const before = baseState();
    const afterSteps = executeEffect({
      chainId: "test:bsaz02-c17-blue-rose:253",
      state: before,
      effect: C17.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: "src-c17",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const finalized = finalizeEffectResolution({
      state: afterSteps,
      beforeState: before,
      chainId: "c17-flash-chain-consume",
      endLogs: [],
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: undefined,
      causedBySourceInstanceId: "src-c17",
    });
    const placed = finalized.cardInstances.find(
      (c) => c.instanceId === "trash-x04"
    );
    expect(placed?.oraclePlacementSuppressed).toBe(false);

    // このカードが場を離れ、C17 とは無関係な (suppressPlacementOracle を経由しない) 別経路
    // (move_card 等) で再びフィールドへ入ったケースを模擬する。フラグが消費済みなら、この
    // 2回目の配置では通常どおり配置時神託の pending が積まれるはず。
    const leftFieldState: GameState = {
      ...finalized,
      pendingTriggeredEffects: [],
      cardInstances: finalized.cardInstances.map((c) =>
        c.instanceId === "trash-x04" ? { ...c, zone: "trash" as const } : c
      ),
    };
    const reenteredState: GameState = {
      ...leftFieldState,
      cardInstances: leftFieldState.cardInstances.map((c) =>
        c.instanceId === "trash-x04"
          ? { ...c, zone: "field" as const, zoneRoleName: "nexus" }
          : c
      ),
    };
    const finalizedAfterReentry = finalizeEffectResolution({
      state: reenteredState,
      beforeState: leftFieldState,
      chainId: "c17-flash-chain-reentry",
      endLogs: [],
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: undefined,
      causedBySourceInstanceId: null,
    });
    const reentryPendings =
      finalizedAfterReentry.pendingTriggeredEffects.filter(
        (p) =>
          p.mechanic?.kind === "placement_oracle" &&
          p.mechanic.grandwalkerInstanceId === "trash-x04"
      );
    expect(reentryPendings).toHaveLength(1);
  });

  it("対照: suppressPlacementOracle を外した同型 summon なら配置時神託の pending が積まれる (抑止フラグの効果を確認)", () => {
    const originalSteps = C17.effects![1]!.steps;
    const summonStep = originalSteps[1]!;
    if (summonStep.action.kind !== "summon") {
      throw new Error("expected steps[1] to be a summon action");
    }
    const unsuppressedEffect: Effect = {
      ...C17.effects![1]!,
      steps: [
        originalSteps[0]!,
        {
          ...summonStep,
          action: { ...summonStep.action, suppressPlacementOracle: false },
        },
      ],
    };
    const before = baseState();
    const afterSteps = executeEffect({
      chainId: "test:bsaz02-c17-blue-rose:333",
      state: before,
      effect: unsuppressedEffect,
      effectIndex: 1,
      sourceInstanceId: "src-c17",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const finalized = finalizeEffectResolution({
      state: afterSteps,
      beforeState: before,
      chainId: "c17-flash-chain-control",
      endLogs: [],
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: undefined,
      causedBySourceInstanceId: "src-c17",
    });
    const placementOraclePendings = finalized.pendingTriggeredEffects.filter(
      (p) =>
        p.mechanic?.kind === "placement_oracle" &&
        p.mechanic.grandwalkerInstanceId === "trash-x04"
    );
    expect(placementOraclePendings).toHaveLength(1);
  });
});
