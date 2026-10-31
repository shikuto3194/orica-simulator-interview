/**
 * P3-47 Phase 3: フランドール・スカーレット (BSTH01-X04)【フォーオブアカインド】
 * 実カード単体機能テスト。
 *
 * 検証範囲 (rulings-and-verification.md 検証計画 #9 / #10 / #13 / #14):
 * - #9  token 破壊 → デッキ裏向きカードがトラッシュへ表向きで移動 (裁定 #1)
 * - #10 本体 (フランドール) フィールド離脱 → token のスピリット扱い解除 +
 *       裏向きカード自体はフィールド残留・コアも維持 (裁定 #2)
 * - #13 二重 usageLimit (per_card_name turn + per_instance game) を実カード経由で検証
 * - #14 token のステータスコピー: live_copy_from_source + currentLv で host 追従、
 *       1 コア with host Lv2 → 表示 Lv2 / BP13000
 *
 * Phase 2-2 で発動成功 / pending core distribution / CE 登録の単体テスト
 * (core-distribute-continuation.test.ts) を完了済。本ファイルは Phase 3 の
 * 「単体機能テスト」として、活性化後の盤面挙動を実カードで end-to-end 確認する。
 */
import { describe, it, expect } from "vitest";
import { BSTH01_CARDS } from "../../card-data/src/cards/BSTH01";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import {
  flushPendingLeaves,
  queuePendingLeave,
} from "../src/state-based-actions";
import { applyFaceDownPolicyOnZoneChange } from "../src/zone/face-down-policy";
import {
  recomputeContinuousEffects,
  canUseEffectByUsageLimit,
  recordEffectUsageIfLimited,
} from "../src/legal/legal-actions-shared";
import {
  getActAsSpiritMetadata,
  isSpirit,
} from "../src/mechanics/act-as-spirit";
import { getEffectiveBp, getEffectiveLevel } from "../src/battle/battle-shared";
import type { CardDefinition, CardInstance, GameState } from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

const FRANDOLLE_CARD = BSTH01_CARDS.find((c) => c.cardNo === "BSTH01-X04")!;
// 裏向きデッキカードに使うフィラー。
// 印字 category=magic にして、act_as_spirit CE が外れた後は isSpirit=false に確実に
// 戻ることを確認できるようにする (spirit を使うと印字経路で常に true になる)。
const fillerDef: CardDefinition = {
  cardNo: "FILLER",
  name: "Filler",
  printedCategory: "magic",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "紅魔",
  sourceUrls: [],
  sourceConfidence: "C",
};

const defRegistry = new Map<string, CardDefinition>([
  [FRANDOLLE_CARD.cardNo, FRANDOLLE_CARD],
  [fillerDef.cardNo, fillerDef],
]);
const getCardDefinitionById = (id: string) => defRegistry.get(id);

/**
 * フランドール【フォーオブアカインド】を発動済みの盤面を作る。
 * - host 配置 (cores 指定) + deck 上 3 枚は filler
 * - effects[1] を実行 → pending core distribution → 各 token に 1 コアずつ分配
 * 戻り値: act_as_spirit + redirect_effect_target CE が登録済の state, host, tokens
 */
function setupActivatedScene(opts: {
  hostCores: number;
  aliceReserveCores?: number;
  deckCardCount?: number;
}): {
  state: GameState;
  hostId: string;
  tokenIds: readonly string[];
} {
  const reserveCores = opts.aliceReserveCores ?? 3;
  const deckCount = opts.deckCardCount ?? 5;

  const host = createCardInstance(FRANDOLLE_CARD, {
    instanceId: "host-flandre",
    ownerPlayerId: ALICE,
    zone: "field",
    cores: opts.hostCores,
  });
  const deckCards: CardInstance[] = [];
  for (let i = 0; i < deckCount; i++) {
    deckCards.push(
      createCardInstance(fillerDef, {
        instanceId: `filler-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
        cores: 0,
      })
    );
  }

  const baseState = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [host, ...deckCards],
    startingLife: 5,
  });
  const state: GameState = {
    ...baseState,
    activePlayerId: ALICE,
    players: baseState.players.map((p) =>
      p.id === ALICE
        ? {
            ...p,
            reserveNormalCoreCount: reserveCores,
            deckCount,
          }
        : p
    ),
  };

  const afterEffect = executeEffect({
    chainId: "test:p3-47-frandolle-phase3:124",
    state,
    effect: FRANDOLLE_CARD.effects![1]!,
    effectIndex: 1,
    sourceInstanceId: host.instanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById,
  });
  const pending = afterEffect.pendingCoreDistribution!;
  const allocations: Record<string, number> = {};
  for (const c of pending.candidates) allocations[c.instanceId] = 1;
  const totalAlloc = pending.candidates.length;

  const actions = getLegalActions({
    state: afterEffect,
    actingPlayerId: ALICE,
    getCardDefinitionById,
  });
  const cdAction = actions.find(
    (a) => a.kind === "resolve_pending_core_distribution"
  )!;
  // P3-47 F-5: フランドール step2 が any_movable_self に切り替わったため、
  // multi-source な sourceAllocations を渡す。テスト前提では reserve のみから
  // 全コアを取る (reserve=3 が確保されている)。
  const applied = applyLegalAction({
    state: afterEffect,
    action: cdAction,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    coreDistributionAllocations: allocations,
    coreDistributionSourceAllocations: { reserve: totalAlloc },
  });

  return {
    state: applied.state,
    hostId: host.instanceId,
    tokenIds: pending.candidates.map((c) => c.instanceId),
  };
}

describe("P3-47 Phase 3: 検証 #14 token ステータスコピー (live_copy + currentLv)", () => {
  it("host Lv2 (3 cores, BP13000) → 各 token も表示 Lv2 / BP13000 (1 core でも host 追従)", () => {
    const { state, hostId, tokenIds } = setupActivatedScene({ hostCores: 3 });
    const host = state.cardInstances.find((c) => c.instanceId === hostId)!;
    expect(getEffectiveBp(state, host, FRANDOLLE_CARD)).toBe(13000);
    expect(getEffectiveLevel(state, host, FRANDOLLE_CARD)).toBe(2);

    for (const tokenId of tokenIds) {
      const tok = state.cardInstances.find((c) => c.instanceId === tokenId)!;
      expect(tok.normalCoreCount).toBe(1); // 1 コア (Lvコスト1 で生存)
      expect(getEffectiveBp(state, tok, fillerDef, getCardDefinitionById)).toBe(
        13000
      );
      expect(
        getEffectiveLevel(state, tok, fillerDef, getCardDefinitionById)
      ).toBe(2);
      expect(isSpirit(tok, state, getCardDefinitionById)).toBe(true);
    }
  });

  it("host Lv3 (5 cores, BP18000) → 各 token も Lv3 / BP18000 に追従", () => {
    const { state, hostId, tokenIds } = setupActivatedScene({
      hostCores: 5,
      aliceReserveCores: 4,
    });
    const host = state.cardInstances.find((c) => c.instanceId === hostId)!;
    expect(getEffectiveLevel(state, host, FRANDOLLE_CARD)).toBe(3);
    expect(getEffectiveBp(state, host, FRANDOLLE_CARD)).toBe(18000);

    for (const tokenId of tokenIds) {
      const tok = state.cardInstances.find((c) => c.instanceId === tokenId)!;
      expect(getEffectiveBp(state, tok, fillerDef, getCardDefinitionById)).toBe(
        18000
      );
      expect(
        getEffectiveLevel(state, tok, fillerDef, getCardDefinitionById)
      ).toBe(3);
    }
  });
});

describe("P3-47 Phase 3: 検証 #9 token 破壊 → 裏向きカードがトラッシュへ表向きで移動", () => {
  it("token を destroy queue → flushPendingLeaves で trash に移動 + faceDown=false", () => {
    const { state: setup, tokenIds } = setupActivatedScene({ hostCores: 3 });
    const targetTokenId = tokenIds[0]!;
    // token は face-down で field 上にあることを前提確認
    const beforeTok = setup.cardInstances.find(
      (c) => c.instanceId === targetTokenId
    )!;
    expect(beforeTok.zone).toBe("field");
    expect(beforeTok.faceDown).toBe(true);
    expect(beforeTok.normalCoreCount).toBe(1);

    let next = queuePendingLeave({
      state: setup,
      instanceId: targetTokenId,
      kind: "destroy",
      cause: "effect_resolution",
      chainId: `chain:destroy:${targetTokenId}`,
      causePlayerId: BOB,
      deferZoneMoveUntilChainEnd: false,
    });
    next = flushPendingLeaves(next, getCardDefinitionById);

    const afterTok = next.cardInstances.find(
      (c) => c.instanceId === targetTokenId
    )!;
    expect(afterTok.zone).toBe("trash");
    // 共通ルール: 公開領域へ移動するときは表向きに戻る
    expect(afterTok.faceDown).toBe(false);
  });

  it("token destroy 後、recompute で当該 token の act_as_spirit CE が削除される (host CE と他 token CE は残る)", () => {
    const {
      state: setup,
      hostId,
      tokenIds,
    } = setupActivatedScene({
      hostCores: 3,
    });
    const targetTokenId = tokenIds[0]!;

    let next = queuePendingLeave({
      state: setup,
      instanceId: targetTokenId,
      kind: "destroy",
      cause: "effect_resolution",
      chainId: `chain:destroy:${targetTokenId}`,
      causePlayerId: BOB,
      deferZoneMoveUntilChainEnd: false,
    });
    next = flushPendingLeaves(next, getCardDefinitionById);
    next = recomputeContinuousEffects(next);

    // 当該 token の act_as_spirit CE は除去
    const remaining = next.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "act_as_spirit"
    );
    expect(remaining).toHaveLength(2);
    expect(remaining.every((ce) => ce.targetInstanceId !== targetTokenId)).toBe(
      true
    );
    // host の redirect_effect_target CE は残る (host は field 残留)
    const redirectCEs = next.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "redirect_effect_target"
    );
    expect(redirectCEs).toHaveLength(1);
    expect(redirectCEs[0]!.sourceInstanceId).toBe(hostId);
  });
});

describe("P3-69 (2026-05-29 裁定): token を手札へバウンス → 分身でなくなり通常カードに戻る", () => {
  it("bounce → 手札: faceDown 解除 + act_as_spirit CE 除去 + spirit 扱い解除 (他カードと同様)", () => {
    const { state: setup, tokenIds } = setupActivatedScene({ hostCores: 3 });
    const targetTokenId = tokenIds[0]!;
    const before = setup.cardInstances.find(
      (c) => c.instanceId === targetTokenId
    )!;
    // 前提: token は field 上で裏向き + フランドール扱い (spirit)
    expect(before.zone).toBe("field");
    expect(before.faceDown).toBe(true);
    expect(isSpirit(before, setup, getCardDefinitionById)).toBe(true);

    // 手札へバウンス: 既定 faceDown ポリシー (離場で解除) を適用し zone=hand に
    const moved = applyFaceDownPolicyOnZoneChange(
      { ...before, zone: "hand" as const, normalCoreCount: 0 },
      "hand"
    );
    let next: GameState = {
      ...setup,
      cardInstances: setup.cardInstances.map((c) =>
        c.instanceId === targetTokenId ? moved : c
      ),
    };
    // フィールドを離れたので while_on_field の act_as_spirit CE を recompute で除去
    next = recomputeContinuousEffects(next);

    const after = next.cardInstances.find(
      (c) => c.instanceId === targetTokenId
    )!;
    expect(after.zone).toBe("hand");
    expect(after.faceDown).toBe(false); // 通常カードに戻る (裏向き解除)
    expect(getActAsSpiritMetadata(next, targetTokenId)).toBeUndefined(); // 付与解除
    expect(isSpirit(after, next, getCardDefinitionById)).toBe(false); // 印字 magic に復帰
  });
});

describe("P3-47 Phase 3: 検証 #10 host 離脱 → 裏向きカードはフィールド残留 + token のスピリット扱い解除", () => {
  it("host destroy 後、token は field 残留 + コア維持 + spirit 扱い解除 (CE 自動除去)", () => {
    const {
      state: setup,
      hostId,
      tokenIds,
    } = setupActivatedScene({
      hostCores: 3,
    });
    // 事前確認: token は spirit 扱い (印字 magic + act_as_spirit CE)
    for (const tokenId of tokenIds) {
      const tok = setup.cardInstances.find((c) => c.instanceId === tokenId)!;
      expect(isSpirit(tok, setup, getCardDefinitionById)).toBe(true);
    }

    let next = queuePendingLeave({
      state: setup,
      instanceId: hostId,
      kind: "destroy",
      cause: "effect_resolution",
      chainId: `chain:destroy:host`,
      causePlayerId: BOB,
      deferZoneMoveUntilChainEnd: false,
    });
    next = flushPendingLeaves(next, getCardDefinitionById);
    next = recomputeContinuousEffects(next);

    // host は trash に移動済
    const hostAfter = next.cardInstances.find((c) => c.instanceId === hostId)!;
    expect(hostAfter.zone).toBe("trash");

    // 各 token はフィールドに残留 (裁定 #2: 「フィールドにある間」がかかるのは裏向きカードのみで、
    // 本体離脱で token のスピリット扱いだけ解除され裏向きカード自体は残る)
    for (const tokenId of tokenIds) {
      const tok = next.cardInstances.find((c) => c.instanceId === tokenId)!;
      expect(tok.zone).toBe("field");
      expect(tok.faceDown).toBe(true);
      // コアも維持
      expect(tok.normalCoreCount).toBe(1);
      // act_as_spirit CE が削除されたので spirit 扱い解除
      expect(getActAsSpiritMetadata(next, tokenId)).toBeUndefined();
      expect(isSpirit(tok, next, getCardDefinitionById)).toBe(false);
    }

    // host source の redirect_effect_target CE も recompute で除去される
    const redirectCEs = next.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "redirect_effect_target"
    );
    expect(redirectCEs).toHaveLength(0);
    // すべての act_as_spirit CE も除去
    const actAsSpiritCEs = next.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "act_as_spirit"
    );
    expect(actAsSpiritCEs).toHaveLength(0);
  });
});

describe("P3-47 Phase 3: 検証 #13 二重 usageLimit (per_card_name turn + per_instance game)", () => {
  // 実カード BSTH01-X04 effects[1] の usageLimit を直接参照して検証する
  const usageLimit = FRANDOLLE_CARD.effects![1]!.usageLimit!;
  const definitionId = FRANDOLLE_CARD.cardNo;
  const effectLabel = "effect:1";

  it("effects[1].usageLimit が per_card_name/turn と per_instance/game の配列である", () => {
    expect(Array.isArray(usageLimit)).toBe(true);
    const arr = usageLimit as ReadonlyArray<{
      kind: string;
      duration: string;
    }>;
    expect(arr).toHaveLength(2);
    expect(arr.find((u) => u.kind === "per_card_name")?.duration).toBe("turn");
    expect(arr.find((u) => u.kind === "per_instance")?.duration).toBe("game");
  });

  it("instance-A 1 回使用後、同ターン instance-B (同名別個体) は per_card_name turn でブロック", () => {
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: ["flan-A", "flan-B"].map((instanceId) =>
          createCardInstance(FRANDOLLE_CARD, {
            instanceId,
            ownerPlayerId: ALICE,
            zone: "field",
            cores: 3,
          })
        ),
      }),
      turnNumber: 1,
      step: "main",
    };

    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "flan-A",
      sourceDefinitionId: definitionId,
      effectLabel,
      usageLimit,
    });

    // 同ターンの別個体: per_card_name turn がブロック
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "flan-B",
        sourceDefinitionId: definitionId,
        effectLabel,
        usageLimit,
      })
    ).toBe(false);
  });

  it("ターン経過後、instance-A は per_instance game でブロック / 別個体 instance-B は使用可", () => {
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: ["flan-A", "flan-B"].map((instanceId) =>
          createCardInstance(FRANDOLLE_CARD, {
            instanceId,
            ownerPlayerId: ALICE,
            zone: "field",
            cores: 3,
          })
        ),
      }),
      turnNumber: 1,
      step: "main",
    };

    state = recordEffectUsageIfLimited({
      state,
      sourceInstanceId: "flan-A",
      sourceDefinitionId: definitionId,
      effectLabel,
      usageLimit,
    });
    state = { ...state, turnNumber: 3 };

    // instance-A: per_instance game で永続ブロック
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "flan-A",
        sourceDefinitionId: definitionId,
        effectLabel,
        usageLimit,
      })
    ).toBe(false);
    // instance-B (再召喚等の別個体): turn ブロックは解除、game ブロックは別 instance で未使用
    expect(
      canUseEffectByUsageLimit({
        state,
        sourceInstanceId: "flan-B",
        sourceDefinitionId: definitionId,
        effectLabel,
        usageLimit,
      })
    ).toBe(true);
  });
});
