/**
 * trigger_source_category 条件節（発生源カードの印字カテゴリ限定）。
 *
 * 仕様:
 *   - 「マジック以外の自分の効果で〜」(BSES01-C01 [0]) のように、効果発生源カードの
 *     印字カテゴリ (spirit/nexus/magic/brave/ultimate) で誘発をゲートする。
 *   - include:[cat...] = いずれかに一致、exclude:[cat...] = いずれにも一致しない。
 *   - TriggerContext.sourceCategory 必須。未注入は誤発火防止のためマッチ不成立。
 *
 * 対象カード:
 *   - BSES01-C01 Para-RAID Activate（マジック以外の自分の効果でオープン/トラッシュ行きで手札復帰）
 */
import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/index";
import {
  findRevealedEffect,
  findMovedToTrashAutoEffect,
} from "../src/effect/structured-effect-interpreter";
import { evaluateCondition } from "../src/effect/structured-effect-interpreter";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src/index";
import { applyLegalAction } from "../src/legal/legal-actions-apply";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const PARA = cardNoMap.get("BSES01-C01")!;

function revealedSelf() {
  const self = createCardInstance(PARA, {
    instanceId: "self-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "revealed",
  });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [self],
  });
  return { state, selfId: self.instanceId };
}

function trashedSelf() {
  const self = createCardInstance(PARA, {
    instanceId: "self-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "trash",
  });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [self],
  });
  return { state, selfId: self.instanceId };
}

describe("trigger_source_category clause - 単独評価", () => {
  // BSES01-C01 を sourceInstanceId carrier に流用（clause 評価は state を読まないため）。
  function evalCategoryClause(
    clause: {
      kind: "trigger_source_category";
      include?: import("../src/index").CardCategory[];
      exclude?: import("../src/index").CardCategory[];
    },
    triggerCtx?: {
      sourceCategory?: import("../src/index").CardCategory;
    }
  ): boolean {
    const self = createCardInstance(PARA, {
      instanceId: "carrier-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "revealed",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [self],
    });
    return evaluateCondition(
      state,
      [clause],
      self.instanceId,
      "alice",
      getDef,
      triggerCtx
    );
  }

  it("include のみ: in-list で true / out-list で false", () => {
    expect(
      evalCategoryClause(
        { kind: "trigger_source_category", include: ["nexus"] },
        { sourceCategory: "nexus" }
      )
    ).toBe(true);
    expect(
      evalCategoryClause(
        { kind: "trigger_source_category", include: ["nexus"] },
        { sourceCategory: "spirit" }
      )
    ).toBe(false);
  });

  it("include + exclude 両指定: AND で評価される", () => {
    // 「ネクサスかつマジックでない」= include:[nexus] + exclude:[magic]
    expect(
      evalCategoryClause(
        {
          kind: "trigger_source_category",
          include: ["nexus", "spirit"],
          exclude: ["magic"],
        },
        { sourceCategory: "nexus" }
      )
    ).toBe(true);
    expect(
      evalCategoryClause(
        {
          kind: "trigger_source_category",
          include: ["nexus", "spirit"],
          exclude: ["magic"],
        },
        { sourceCategory: "brave" }
      )
    ).toBe(false);
  });

  it("brave / ultimate も category 値として通過する", () => {
    expect(
      evalCategoryClause(
        { kind: "trigger_source_category", exclude: ["magic"] },
        { sourceCategory: "brave" }
      )
    ).toBe(true);
    expect(
      evalCategoryClause(
        { kind: "trigger_source_category", exclude: ["magic"] },
        { sourceCategory: "ultimate" }
      )
    ).toBe(true);
  });

  it("triggerContext 自体未注入は fail-closed (false)", () => {
    expect(
      evalCategoryClause({
        kind: "trigger_source_category",
        exclude: ["magic"],
      })
    ).toBe(false);
  });
});

describe("BSES01-C01 [0] マジック以外の自分の効果での自己回収", () => {
  it("スピリット効果でオープンされたとき add_to_hand でマッチ（マジック以外）", () => {
    const { state, selfId } = revealedSelf();
    const match = findRevealedEffect(state, selfId, PARA, getDef, {
      sourceCategory: "spirit",
      sourcePlayerId: "alice",
      fromZone: "deck",
    });
    expect(match).toBeDefined();
    expect(match!.disposition.kind).toBe("move");
    expect(match!.executionMode).toBe("optional");
  });

  it("ネクサス効果でトラッシュ行きでも add_to_hand でマッチ（マジック以外）", () => {
    const { state, selfId } = trashedSelf();
    const match = findMovedToTrashAutoEffect(state, selfId, PARA, getDef, {
      sourceCategory: "nexus",
      sourcePlayerId: "alice",
      fromZone: "deck",
    });
    expect(match).toBeDefined();
    expect(match!.kind).toBe("add_to_hand");
  });

  it("マジック効果でオープンされたときはマッチしない（exclude:[magic]）", () => {
    const { state, selfId } = revealedSelf();
    const match = findRevealedEffect(state, selfId, PARA, getDef, {
      sourceCategory: "magic",
      sourcePlayerId: "alice",
      fromZone: "deck",
    });
    expect(match).toBeUndefined();
  });

  it("相手の効果（非マジック）ではマッチしない（trigger_source_player:self）", () => {
    const { state, selfId } = revealedSelf();
    const match = findRevealedEffect(state, selfId, PARA, getDef, {
      sourceCategory: "spirit",
      sourcePlayerId: "bob",
      fromZone: "deck",
    });
    expect(match).toBeUndefined();
  });

  it("sourceCategory 未注入では誤発火しない（fail-closed）", () => {
    const { state, selfId } = revealedSelf();
    const match = findRevealedEffect(state, selfId, PARA, getDef, {
      sourcePlayerId: "alice",
      fromZone: "deck",
    });
    expect(match).toBeUndefined();
  });

  it("fromZone=deck 以外（手札等）ではマッチしない（trigger_from_zone[deck]）", () => {
    const { state, selfId } = revealedSelf();
    const match = findRevealedEffect(state, selfId, PARA, getDef, {
      sourceCategory: "spirit",
      sourcePlayerId: "alice",
      fromZone: "hand",
    });
    expect(match).toBeUndefined();
  });
});

describe("executeDeckReveal e2e: BSES01-C01 [0] sourceCategory 配線", () => {
  // BSES01-C04 (スピリット) / BSES01-C01 (マジック) を sourceInstanceId として
  // executeDeckReveal を呼び出し、BSES01-C01 (デッキ上) が trigger_source_category exclude:[magic]
  // で正しくフィルタされて pendingRevealedChoice / pendingTrashOptionalAdds に乗るか確認する。
  const SPIRIT_SRC = cardNoMap.get("BSES01-C02")!; // スピリットでなくブレイヴだが category 検査の目的では非マジック
  function setupDeckRevealState(sourceDef: CardDefinition) {
    const src = createCardInstance(sourceDef, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const para = createCardInstance(PARA, {
      instanceId: "para-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const filler = createCardInstance(PARA, {
      instanceId: "filler-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [src, para, filler],
      players: [
        { id: "alice", deckCount: 2 },
        { id: "bob", deckCount: 0 },
      ],
    });
    return { state, srcId: src.instanceId };
  }

  it("マジック以外(brave)源 → optional 自己回収候補が pendingRevealedChoice に乗る", () => {
    const { state, srcId } = setupDeckRevealState(SPIRIT_SRC);
    const next = executeDeckRevealHelper(state, srcId);
    // BSES01-C01 [0] optional → revealed_choice か pendingTrashOptionalAdds に乗っているはず。
    const collected = collectOptionalDispositions(next);
    expect(collected).toContain("para-1");
  });

  it("マジック源(BSES01-C01 自身) → exclude:[magic] で trigger 不発", () => {
    const { state, srcId } = setupDeckRevealState(PARA); // PARA = magic
    const next = executeDeckRevealHelper(state, srcId);
    const collected = collectOptionalDispositions(next);
    expect(collected).not.toContain("para-1");
  });

  it("[board] 非マジック源で revealed_choice を resolve すると para-1 が手札へ移動する (verifier 2026-06-23 round 11 lens 5)", () => {
    const { state, srcId } = setupDeckRevealState(SPIRIT_SRC);
    const next = executeDeckRevealHelper(state, srcId);
    // revealed_choice phase の resolve_pending_deck_reveal_pick action を applyLegalAction で解決し、
    // para-1 が deck → hand に移動することを最終盤面で検証する。
    const pending = next.pendingDeckReveal;
    expect(pending?.phase).toBe("revealed_choice");
    const resolved = applyLegalAction({
      state: next,
      action: {
        kind: "resolve_pending_deck_reveal_pick",
        actionId: "dr-revealed-choice",
        can: true,
        reason: "deck_reveal_revealed_choice",
        actingPlayerId: "alice",
        pendingId: pending!.pendingId,
        pickIndex: -1,
        candidateCardInstanceIds: ["para-1"],
        maxPickCount: 1,
        canSkip: true,
      },
      selectedDeckRevealCardIds: ["para-1"],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const para = resolved.state.cardInstances.find(
      (c) => c.instanceId === "para-1"
    );
    expect(para?.zone).toBe("hand");
  });

  it("[board] マジック源では para-1 が deck に残り、resolve も発火しない (final state)", () => {
    const { state, srcId } = setupDeckRevealState(PARA);
    const next = executeDeckRevealHelper(state, srcId);
    // 自己回収 trigger が exclude:[magic] で発火しないので、revealed_choice phase でも
    // para-1 は revealedAutoAddCandidateIds に乗らない。最終的に deck (or revealed) 側に残る。
    const candidates =
      next.pendingDeckReveal?.revealedAutoAddCandidateIds ?? [];
    expect(candidates).not.toContain("para-1");
    // 最終盤面: pending を picking phase (もしあれば) スキップして ordering 終了まで進めるのは
    // 本検証の範囲外。重要なのは「para-1 が候補として乗らない＝手札に追加経路が無い」こと。
    // hand 移動が無いことの確認: state.cardInstances 上 para-1 の zone は deck (revealed) のまま。
    const para = next.cardInstances.find((c) => c.instanceId === "para-1");
    expect(para?.zone).not.toBe("hand");
  });
});

import { executeDeckReveal } from "../src/effect/structured-effect-interpreter";
import type { GameState } from "../src/index";

function executeDeckRevealHelper(state: GameState, srcId: string): GameState {
  return executeDeckReveal(
    state,
    "alice",
    {
      kind: "deck_reveal",
      revealCount: 2,
      picks: [],
      remainder: "bottom",
    },
    getDef,
    srcId
  );
}

function collectOptionalDispositions(state: GameState): string[] {
  const ids: string[] = [];
  if (state.pendingDeckReveal) {
    for (const id of state.pendingDeckReveal.revealedAutoAddCandidateIds ??
      []) {
      ids.push(id);
    }
  }
  for (const e of state.pendingTrashOptionalAdds ?? []) {
    ids.push(e.instanceId);
  }
  return ids;
}
