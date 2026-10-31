/**
 * 離脱→魂状態化 (非契約 soul_state 置換 CE) のエッジケース回帰。
 *
 * 既存 `soul-state-replacement-non-contract.test.ts` は通常コアのみ・effect_resolution 起因の
 * 基本 keep/decline を担保する。本ファイルは production 実装
 * (`state-based-actions.ts` checkSoulStateReplacement / resolveSoulStateReplacement) にある
 * 以下の未カバー分岐を VERIFY レーンとして固定する:
 *
 *  (A) 魂状態化対象にソウルコアが乗っていた場合、keep でソウルコアの所在が reserve に戻る
 *      (resolveSoulStateReplacement の soulCoreOwnerId 分岐)。ソウルコアは
 *      reserveNormalCoreCount には加算されない (通常コアのみ totalCoresReturned)。
 *      正源: 10_rules/08a L158-159「魂状態化時、上のコアは全てリザーブへ移動」+
 *      project_soul_core_movement_generic (汎用コア=soul 含む)。
 *  (B) cause:"battle" の離脱は causePlayerId が controller 自身でも「相手起因」扱いで
 *      keep プロンプトを立てる (checkSoulStateReplacement L851「バトル破壊は常に相手起因」)。
 *  (C) keep 受諾時、対象に紐づく "相手による破壊後" バーストチェックが抑止される
 *      (トラッシュに置かれないため。resolveSoulStateReplacement の pendingBurstChecks filter)。
 */
import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  flushPendingLeaves,
  getLegalActions,
} from "../src";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  GameState,
  PendingBurstCheck,
  PendingLeaveEntity,
} from "../src";

const ALICE = "player-1";
const BOB = "player-2";
const GE_NO = "TEST-GE-LINKAID-EDGES";

function geDef(): CardDefinition {
  return {
    cardNo: GE_NO,
    name: "GE スピリット (edges)",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 2,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 3000 },
      { level: 2, requiredCores: 2, bp: 5000 },
    ],
    textLines: [],
    images: {},
    tribe: "神喰・GE",
    keywordTags: ["soul_state"],
  } as CardDefinition;
}

const GE_DEF = geDef();
const defMap = new Map<string, CardDefinition>([[GE_NO, GE_DEF]]);
const getDef = (id: string): CardDefinition | undefined => defMap.get(id);
const noLookups = { getCardDefinitionById: getDef } as const;

function geCard(
  instanceId: string,
  cores: number,
  cause: PendingLeaveEntity["cause"]
): CardInstance {
  return createCardInstance(GE_DEF, {
    instanceId,
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
    pendingLeaveKind: "destroy",
    pendingLeaveCause: cause,
    pendingLeaveChainId: `chain-${instanceId}`,
  });
}

function pendingDestroy(
  instanceId: string,
  cause: PendingLeaveEntity["cause"],
  causePlayerId: string | null
): PendingLeaveEntity {
  return {
    instanceId,
    kind: "destroy",
    cause,
    causePlayerId,
    chainId: `chain-${instanceId}`,
    deferZoneMoveUntilChainEnd: false,
    leaveFieldCoreDestinationOverride: null,
  };
}

function soulStateReplacementCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `ce-soul-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: GE_NO,
    actingPlayerId: ALICE,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "replace_field_exit",
    targetInstanceId,
    metadata: {
      trigger: "leave_field",
      source: "opponent_effect",
      replacement: { kind: "soul_state" },
    },
  } as ContinuousEffect;
}

const getCard = (s: GameState, id: string): CardInstance =>
  s.cardInstances.find((c) => c.instanceId === id)!;
const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

describe("離脱→魂状態化 (非契約 soul_state 置換 CE) エッジ", () => {
  it("(A) ソウルコア付きの魂状態化: keep でソウルコア所在が reserve に戻る (count には加算しない)", () => {
    const card = geCard("ge", 2, "effect_resolution");
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          // ソウルコアが対象カードの上に乗っている。
          soulCoreLocation: { kind: "card", instanceId: "ge" },
        },
        {},
      ],
    });
    state.activeContinuousEffects = [soulStateReplacementCE("ge")];
    state.pendingLeaveEntities = [
      pendingDestroy("ge", "effect_resolution", BOB),
    ];

    const flushed = flushPendingLeaves(state, getDef, ["red"]);
    expect(flushed.pendingSoulStateReplacement).not.toBeNull();

    const keepAction = getLegalActions({
      state: flushed,
      actingPlayerId: ALICE,
      ...noLookups,
    }).find(
      (a) =>
        a.kind === "resolve_soul_state_replacement" &&
        (a as { choice?: string }).choice === "keep"
    )!;
    const applied = applyLegalAction({
      state: flushed,
      action: keepAction,
      ...noLookups,
    });

    const cardAfter = getCard(applied.state, "ge");
    expect(cardAfter.zone).toBe("field");
    expect(cardAfter.normalCoreCount).toBe(0);
    // 通常コア 2 はリザーブへ。
    expect(alice(applied.state).reserveNormalCoreCount).toBe(2);
    // ソウルコアは reserve に戻る (location flip)。count には混ぜない。
    expect(alice(applied.state).soulCoreLocation).toEqual({ kind: "reserve" });
    expect(alice(applied.state).soulStateInstanceIds).toContain("ge");
  });

  it("(B) cause:battle は causePlayerId=自分でも「相手起因」扱いで keep プロンプトを立てる", () => {
    const card = geCard("ge", 1, "battle");
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    state.activeContinuousEffects = [soulStateReplacementCE("ge")];
    // controller (ALICE) を causePlayerId に指定しても、cause:"battle" は常に相手起因。
    state.pendingLeaveEntities = [pendingDestroy("ge", "battle", ALICE)];

    const flushed = flushPendingLeaves(state, getDef, ["red"]);
    expect(flushed.pendingSoulStateReplacement).not.toBeNull();
    expect(flushed.pendingSoulStateReplacement!.cardInstanceId).toBe("ge");
    expect(getCard(flushed, "ge").zone).toBe("field");
  });

  it("(C) keep 受諾は対象に紐づくバーストチェックを抑止する (トラッシュに置かれない)", () => {
    const card = geCard("ge", 1, "effect_resolution");
    const burst: PendingBurstCheck = {
      checkId: "bc-1",
      actingPlayerId: ALICE,
      eventKind: "leave_field",
      source: "opponent_effect",
      chainId: "test:soul-state-replacement-non-contract-edges:185",
      attackId: null,
      relatedPlayerId: ALICE,
      relatedInstanceId: "ge",
      amount: 1,
      step: "main",
      window: "main",
      resolvedBurstCardInstanceIds: [],
    };
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
      pendingBurstChecks: [burst],
    });
    state.activeContinuousEffects = [soulStateReplacementCE("ge")];
    state.pendingLeaveEntities = [
      pendingDestroy("ge", "effect_resolution", BOB),
    ];

    const flushed = flushPendingLeaves(state, getDef, ["red"]);
    expect(flushed.pendingSoulStateReplacement).not.toBeNull();

    const keepAction = getLegalActions({
      state: flushed,
      actingPlayerId: ALICE,
      ...noLookups,
    }).find(
      (a) =>
        a.kind === "resolve_soul_state_replacement" &&
        (a as { choice?: string }).choice === "keep"
    )!;
    const applied = applyLegalAction({
      state: flushed,
      action: keepAction,
      ...noLookups,
    });

    // 対象 "ge" に紐づく burst check は除去されている。
    expect(
      applied.state.pendingBurstChecks.some(
        (bc) =>
          (bc as { relatedInstanceId?: string }).relatedInstanceId === "ge"
      )
    ).toBe(false);
    expect(getCard(applied.state, "ge").zone).toBe("field");
  });
});
