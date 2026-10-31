/**
 * P3-151 cluster フォローアップ (adversarial verifier round2 refute):
 * `resolve_pending_core_shoot` の selfplay-driver 側自動入力供給が、移動先
 * (`pendingCoreShootSelection.toKind`) がソウルコア移動不可 (`void` 等、SSOT は
 * `coreShootSoulDestinationAllowed`) であるにもかかわらず、通常コアとソウルコアを
 * 両方保持するカードを「ソウルコアも1個分カウントできる」と誤認していた。
 *
 * `applyPendingCoreShootAction`（effect-target-handlers.ts）は toKind:"void" のとき
 * ソウルコア移動を黙って blocked 扱いにするだけで throw しない (バリデーションは
 * 「配分合計 + ソウル指定の有無」だけを見る) ため、通常コア分だけが実際に減り、
 * ソウルコア分は移動しないまま "配分合計は要求量を満たした" ことになってしまい、
 * 要求されたコアシュート総数より少ない数しか実際には除去されない
 * (crash にはならず silent under-delivery になるため fuzz の stuck/error 検知には
 * 掛からない)。
 *
 * BattleScreen.tsx の GUI 実装は移動先が soul 不可のとき自動辞退でこの罠を回避して
 * いるが、selfplay-driver 側は同種のガードを欠いていた。本テストは
 * coreShootSoulDestinationAllowed による gate 追加後、要求どおり通常コアのみで
 * 全量が配分されることを検証する。
 */
import { describe, expect, it } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";
import { applyChosenAction, type Engine } from "./selfplay-driver";

const ALICE = "alice";
const BOB = "bob";

const SPIRIT_DEF: CardDefinition = {
  cardNo: "SPCSVOID-BEARER",
  name: "Selfplay Core Shoot Void Bearer",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
} as unknown as CardDefinition;

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  id === SPIRIT_DEF.cardNo ? SPIRIT_DEF : undefined;

const engine: Engine = {
  cards: [SPIRIT_DEF],
  getCardDefinitionById,
  lookups: {
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredHandActivatedEffectActions: () => [],
    getRegisteredMagicActions: () => [],
  },
};

/** 通常コア2個 + ソウルコアを保持するカードのみが候補の pending core_shoot → void 状態。 */
function makeSoulBearerVoidShootState(): GameState {
  const bearer = createCardInstance(SPIRIT_DEF, {
    instanceId: "bearer-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 2,
  });
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [bearer],
    playerOverrides: [
      { soulCoreLocation: { kind: "card", instanceId: "bearer-1" } },
      {},
    ],
  });
  return {
    ...base,
    step: "main",
    activePlayerId: ALICE,
    pendingCoreShootSelection: {
      pendingId: "cs-void-test",
      actingPlayerId: ALICE,
      sourceInstanceId: "bearer-1",
      sourceDefinitionId: SPIRIT_DEF.cardNo,
      candidates: [
        {
          instanceId: "bearer-1",
          definitionId: SPIRIT_DEF.cardNo,
          availableCores: 2,
        },
      ],
      totalAmount: 2,
      toKind: "void",
      toPlayerId: ALICE,
      fromPlayerId: ALICE,
      remainingActions: [],
      effectTiming: { kind: "activated", mode: "main" },
    },
  };
}

describe("selfplay-driver: resolve_pending_core_shoot toKind=void ではソウルコアを配分に使わない", () => {
  it("要求された総数 (totalAmount) 全てを通常コアだけで配分し、ソウルコアには手を出さない", () => {
    const state = makeSoulBearerVoidShootState();
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_core_shoot");
    expect(action).toBeDefined();
    if (!action) throw new Error("unreachable");

    const result = applyChosenAction(state, action, engine);

    const bearerAfter = result.cardInstances.find(
      (c) => c.instanceId === "bearer-1"
    );
    // 通常コア2個が両方ボイドへ (要求 totalAmount=2 をちょうど満たす)。
    // 修正前は distribution が {bearer-1: 1} + coreShootSoulCoreInstanceId で
    // "合計2" を偽装し、実際には normalCoreCount が 1 しか減らなかった。
    expect(bearerAfter?.normalCoreCount).toBe(0);
    // ソウルコアは void へ移動できないため、カード上に残置されたまま。
    const aliceAfter = result.players.find((p) => p.id === ALICE);
    expect(aliceAfter?.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "bearer-1",
    });
    expect(result.pendingCoreShootSelection).toBeNull();
  });
});
