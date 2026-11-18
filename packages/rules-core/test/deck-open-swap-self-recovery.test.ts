/**
 * swap 型 デッキオープン/トラッシュ自己回収（「手札1枚と入れ替えられる」）。
 *
 * 仕様（10_rules/07b §鍵/星霊デッキオープン置換 line 40, 裁定 2026-06-14 / needs-ruling
 *   BSFT01-C01 resolved 2026-06-15）:
 *   - 「デッキからオープンされた／トラッシュに置かれたこのカードは、手札1枚と入れ替えられる」
 *     は swap 型 disposition。可能形語尾 = 任意。
 *   - 受理時このカードを手札へ加え、手札1枚を「このカード」の行き先へ送る（同一物として扱う）。
 *     行き先はこのカードの処理先: オープン由来=オープン効果の remainder / トラッシュ由来=トラッシュ。
 *   - 入れ替えで出す手札はプレイヤー選択（discard_hand 型 pendingZoneSelection 再利用）。
 *   - 手札0枚なら入れ替え不能 → 受理候補に出さず、直接受理も拒否する。
 *   - 入れ替えで加えたカード自身は出す候補から除外（07b line 42 不活性則）。
 *
 * 対象カード:
 *   - BSDB01-C07 カプセルコーポレーション（地球人/サイヤ人・オープンのみ）
 *   - BSSG01-C07 SONG司令室（装者/錬金術師・オープンのみ）
 *   - BSSG01-R02 絶唱（系統限定なし・オープンのみ）
 *   - BSFT01-C03 星霊界（鍵/星霊・オープン/トラッシュ）
 *   - BSLH01-M05 創の軌跡（CB・オープン/トラッシュ）
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src/index";
import {
  findMovedToTrashAutoEffect,
  findRevealedEffect,
  processMovedToTrashEffects,
  materializeDeferredTrashOptionalAdds,
} from "../src/effect/structured-effect-interpreter";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src/index";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const C07 = cardNoMap.get("BSDB01-C07")!; // 地球人/サイヤ人・オープン
const SONG = cardNoMap.get("BSSG01-C07")!; // 装者/錬金術師・オープン
const ZESSHO = cardNoMap.get("BSSG01-R02")!; // 系統限定なし・オープン
const SEIREI = cardNoMap.get("BSFT01-C03")!; // 鍵/星霊・オープン/トラッシュ
const SOU_NO_KISEKI = cardNoMap.get("BSLH01-M05")!; // CB・オープン/トラッシュ

/** swap カード1枚（revealed）＋手札 N 枚を alice に置いた state を作る。 */
function revealedStateWithHand(
  def: CardDefinition,
  handDef: CardDefinition,
  handCount: number
) {
  const self = createCardInstance(def, {
    instanceId: "self-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "revealed",
  });
  const handCards = Array.from({ length: handCount }, (_, i) =>
    createCardInstance(handDef, {
      instanceId: `hand-${i}`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    })
  );
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [self, ...handCards],
  });
  const state: GameState = {
    ...base,
    players: base.players.map((p) =>
      p.id === "alice" ? { ...p, handCount } : p
    ),
  };
  return {
    state,
    selfId: self.instanceId,
    handIds: handCards.map((c) => c.instanceId),
  };
}

describe("swap 型 disposition の検出（findRevealedEffect / findMovedToTrashAutoEffect）", () => {
  it("BSDB01-C07: 地球人効果でオープンされたら disposition.kind=swap でマッチ", () => {
    const { state, selfId } = revealedStateWithHand(C07, C07, 0);
    const match = findRevealedEffect(state, selfId, C07, getDef, {
      sourceTribes: ["地球人"],
      fromZone: "deck",
    });
    expect(match).toBeDefined();
    expect(match!.disposition.kind).toBe("swap");
    expect(match!.executionMode).toBe("optional");
  });

  it("BSDB01-C07: サイヤ人効果でもマッチ / 無関係系統ではマッチしない", () => {
    const { state, selfId } = revealedStateWithHand(C07, C07, 0);
    expect(
      findRevealedEffect(state, selfId, C07, getDef, {
        sourceTribes: ["サイヤ人"],
        fromZone: "deck",
      })
    ).toBeDefined();
    expect(
      findRevealedEffect(state, selfId, C07, getDef, {
        sourceTribes: ["妖精"],
        fromZone: "deck",
      })
    ).toBeUndefined();
  });

  it("BSSG01-R02: 系統限定なし → どの効果でオープンされても swap でマッチ", () => {
    const { state, selfId } = revealedStateWithHand(ZESSHO, ZESSHO, 0);
    const match = findRevealedEffect(state, selfId, ZESSHO, getDef, {
      sourceColors: ["red"],
      fromZone: "deck",
    });
    expect(match).toBeDefined();
    expect(match!.disposition.kind).toBe("swap");
  });

  it("BSFT01-C03: トラッシュ行き（鍵効果）で findMovedToTrashAutoEffect が kind=swap", () => {
    const self = createCardInstance(SEIREI, {
      instanceId: "self-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [self],
    });
    const match = findMovedToTrashAutoEffect(
      state,
      self.instanceId,
      SEIREI,
      getDef,
      {
        sourceTribes: ["鍵"],
        // BSFT01-C03 [0] は trigger_source_player:"self" ガード付き (audit-bsft01 解消)。
        sourcePlayerId: "alice",
        fromZone: "deck",
      }
    );
    expect(match).toBeDefined();
    expect(match!.kind).toBe("swap");
  });

  it("BSLH01-M05: 自分のCB効果でオープン/トラッシュなら swap、相手/非CBでは不一致", () => {
    const { state, selfId } = revealedStateWithHand(
      SOU_NO_KISEKI,
      SOU_NO_KISEKI,
      0
    );
    const revealedMatch = findRevealedEffect(
      state,
      selfId,
      SOU_NO_KISEKI,
      getDef,
      {
        sourceTribes: ["CB"],
        sourcePlayerId: "alice",
        fromZone: "deck",
      }
    );
    expect(revealedMatch).toBeDefined();
    expect(revealedMatch!.disposition.kind).toBe("swap");
    expect(revealedMatch!.executionMode).toBe("optional");
    expect(
      findRevealedEffect(state, selfId, SOU_NO_KISEKI, getDef, {
        sourceTribes: ["CB"],
        sourcePlayerId: "bob",
        fromZone: "deck",
      })
    ).toBeUndefined();
    expect(
      findRevealedEffect(state, selfId, SOU_NO_KISEKI, getDef, {
        sourceTribes: ["星霊"],
        sourcePlayerId: "alice",
        fromZone: "deck",
      })
    ).toBeUndefined();

    const trashSelf = createCardInstance(SOU_NO_KISEKI, {
      instanceId: "sou-trash-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const trashState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [trashSelf],
    });
    const trashMatch = findMovedToTrashAutoEffect(
      trashState,
      trashSelf.instanceId,
      SOU_NO_KISEKI,
      getDef,
      {
        sourceTribes: ["CB"],
        sourcePlayerId: "alice",
        fromZone: "deck",
      }
    );
    expect(trashMatch).toBeDefined();
    expect(trashMatch!.kind).toBe("swap");
  });
});

describe("swap end-to-end（revealed）: 受理 → 手札へ加え + 手札1枚をこのカードの行き先へ送る選択", () => {
  it("BSDB01-C07: card-event disposition swap resolves the revealed card into hand and swaps one hand card to the reveal remainder", () => {
    // 地球人/サイヤ人効果でオープンされたカプセルコーポレーション + 手札2枚。
    // 前段の findRevealedEffect 回帰で cardEventDisposition:swap への到達を確認し、
    // ここではその disposition が共通経路で作る盤面遷移を確認する。
    const { state, selfId, handIds } = revealedStateWithHand(C07, C07, 2);
    // revealed_choice pending を直接組む。
    const dispositionMap = { [selfId]: { kind: "swap" as const } };
    const attackId = "attack:revealed-swap:1";
    const pendingState: GameState = {
      ...state,
      pendingDeckReveal: {
        pendingId: "dr-test",
        actingPlayerId: "alice",
        sourceInstanceId: "src",
        sourceDefinitionId: "src",
        revealedCardInstanceIds: [selfId],
        picks: [],
        remainder: "bottom",
        phase: "revealed_choice",
        currentPickIndex: 0,
        pickedCardInstanceIds: [],
        origin: "deck",
        revealedAutoAddCandidateIds: [selfId],
        revealedDispositionMap: dispositionMap,
        continuation: {
          chainId: "test:deck-open-swap-self-recovery:235",
          sourceDefinitionId: "BSDB01-C07",
          effectIndex: 0,
          sourceInstanceId: "src",
          actingPlayerId: "alice",
          resumeStepIndex: 1,
          recordStepId: "revealed-swap-record",
          stepContext: { results: {} },
          battleEndDeferralAttackId: attackId,
        },
      },
      pendingBattleEndFinalizeAttackIds: [attackId],
      activeContinuousEffects: [
        {
          effectId: "ce-revealed-swap-battle-end",
          sourceInstanceId: "src",
          sourceDefinitionId: "BSDB01-C07",
          actingPlayerId: "alice",
          duration: { scope: "battle" },
          createdAtTurn: state.turnNumber,
          createdAtAttackId: attackId,
          modifierTag: "defense_immune",
          targetInstanceId: selfId,
        },
      ],
    };

    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    const { state: resolved } = applyLegalAction({
      state: pendingState,
      action,
      getCardDefinitionById: getDef,
      selectedDeckRevealCardIds: [selfId],
    });

    // この時点では swap-out 未解決なので、このカードはまだ revealed で保持。
    expect(
      resolved.cardInstances.find((c) => c.instanceId === selfId)!.zone
    ).toBe("revealed");
    // 入れ替え用の手札選択 pending が立つ（GUI 整合）。
    expect(resolved.pendingZoneSelection).not.toBeNull();
    const zs = resolved.pendingZoneSelection!;
    expect(zs.actionKind).toBe("discard_hand");
    expect(zs.sourceZone).toBe("hand");
    // 行き先は「このカード」の行き先 = この synthetic open の remainder → デッキ下。
    expect(zs.destination).toBe("deck_bottom");
    expect(zs.maxCount).toBe(1);
    expect(zs.canSkip).toBe(false);
    expect(zs.continuation?.battleEndDeferralAttackId).toBe(attackId);
    // 入れ替えで加えたカード自身は出す候補から除外（不活性則）。
    expect(zs.candidateCardInstanceIds).not.toContain(selfId);
    expect(zs.candidateCardInstanceIds.sort()).toEqual([...handIds].sort());

    // 手札カード1枚を選んで入れ替え実行 → デッキ下へ。
    const swapAction = getLegalActions({
      state: resolved,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_zone_selection")!;
    const { state: done } = applyLegalAction({
      state: resolved,
      action: swapAction,
      getCardDefinitionById: getDef,
      selectedZoneCardIds: [handIds[0]!],
    });
    expect(done.cardInstances.find((c) => c.instanceId === selfId)!.zone).toBe(
      "hand"
    );
    expect(
      done.cardInstances.find((c) => c.instanceId === handIds[0])!.zone
    ).toBe("deck");
    expect(done.pendingZoneSelection).toBeNull();
    expect(done.pendingBattleEndFinalizeAttackIds).not.toContain(attackId);
    expect(
      done.activeContinuousEffects.some(
        (ce) => ce.effectId === "ce-revealed-swap-battle-end"
      )
    ).toBe(false);
  });

  it("複数 swap 候補を同時受理したら、受理枚数ぶん手札1枚との交換を順次要求する", () => {
    const selfA = createCardInstance(SONG, {
      instanceId: "swap-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "revealed",
    });
    const selfB = createCardInstance(SONG, {
      instanceId: "swap-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "revealed",
    });
    const handA = createCardInstance(SONG, {
      instanceId: "hand-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const handB = createCardInstance(SONG, {
      instanceId: "hand-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [selfA, selfB, handA, handB],
    });
    const pendingState: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, handCount: 2 } : p
      ),
      pendingDeckReveal: {
        pendingId: "dr-test",
        actingPlayerId: "alice",
        sourceInstanceId: "src",
        sourceDefinitionId: "src",
        revealedCardInstanceIds: [selfA.instanceId, selfB.instanceId],
        picks: [],
        remainder: "bottom",
        phase: "revealed_choice",
        currentPickIndex: 0,
        pickedCardInstanceIds: [],
        origin: "deck",
        revealedAutoAddCandidateIds: [selfA.instanceId, selfB.instanceId],
        revealedDispositionMap: {
          [selfA.instanceId]: { kind: "swap" as const },
          [selfB.instanceId]: { kind: "swap" as const },
        },
      },
    };

    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    expect(action.maxPickCount).toBe(2);

    let cur = applyLegalAction({
      state: pendingState,
      action,
      getCardDefinitionById: getDef,
      selectedDeckRevealCardIds: [selfA.instanceId, selfB.instanceId],
    }).state;
    expect(cur.pendingZoneSelection?.swapPickedInstanceId).toBe(
      selfA.instanceId
    );
    expect(cur.pendingDeckRevealSwapChain).toHaveLength(1);
    expect(cur.pendingZoneSelection!.candidateCardInstanceIds.sort()).toEqual([
      handA.instanceId,
      handB.instanceId,
    ]);

    const firstSwap = getLegalActions({
      state: cur,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_zone_selection")!;
    cur = applyLegalAction({
      state: cur,
      action: firstSwap,
      getCardDefinitionById: getDef,
      selectedZoneCardIds: [handA.instanceId],
    }).state;
    expect(cur.pendingZoneSelection?.swapPickedInstanceId).toBe(
      selfB.instanceId
    );
    expect(cur.pendingZoneSelection!.candidateCardInstanceIds).toEqual([
      handB.instanceId,
    ]);

    const secondSwap = getLegalActions({
      state: cur,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_zone_selection")!;
    const done = applyLegalAction({
      state: cur,
      action: secondSwap,
      getCardDefinitionById: getDef,
      selectedZoneCardIds: [handB.instanceId],
    }).state;

    expect(
      done.cardInstances.find((c) => c.instanceId === selfA.instanceId)!.zone
    ).toBe("hand");
    expect(
      done.cardInstances.find((c) => c.instanceId === selfB.instanceId)!.zone
    ).toBe("hand");
    expect(
      done.cardInstances.find((c) => c.instanceId === handA.instanceId)!.zone
    ).toBe("deck");
    expect(
      done.cardInstances.find((c) => c.instanceId === handB.instanceId)!.zone
    ).toBe("deck");
    expect(done.pendingZoneSelection).toBeNull();
    expect(done.pendingDeckRevealSwapChain).toHaveLength(0);
  });

  it("BSLH01-C04 型の remainder:trash で BSLH01-M05 を受理したら swap-out 手札も trash へ送る", () => {
    const { state, selfId, handIds } = revealedStateWithHand(
      SOU_NO_KISEKI,
      SOU_NO_KISEKI,
      1
    );
    const pendingState: GameState = {
      ...state,
      pendingDeckReveal: {
        pendingId: "dr-bslh01-c04",
        actingPlayerId: "alice",
        sourceInstanceId: "bslh01-c04-src",
        sourceDefinitionId: "BSLH01-C04",
        revealedCardInstanceIds: [selfId],
        picks: [{ count: 1, filter: { tribes: ["CB"] } }],
        remainder: "trash",
        phase: "revealed_choice",
        currentPickIndex: 0,
        pickedCardInstanceIds: [],
        origin: "deck",
        revealedAutoAddCandidateIds: [selfId],
        revealedDispositionMap: { [selfId]: { kind: "swap" as const } },
      },
    };
    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    const { state: resolved } = applyLegalAction({
      state: pendingState,
      action,
      getCardDefinitionById: getDef,
      selectedDeckRevealCardIds: [selfId],
    });

    expect(resolved.pendingZoneSelection?.destination).toBe("trash");
    const swapAction = getLegalActions({
      state: resolved,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_zone_selection")!;
    const { state: done } = applyLegalAction({
      state: resolved,
      action: swapAction,
      getCardDefinitionById: getDef,
      selectedZoneCardIds: [handIds[0]!],
    });

    expect(done.cardInstances.find((c) => c.instanceId === selfId)!.zone).toBe(
      "hand"
    );
    expect(
      done.cardInstances.find((c) => c.instanceId === handIds[0])!.zone
    ).toBe("trash");
  });

  it("top_or_bottom の top 選択後に swap-out 手札を deck top へ送る", () => {
    const self = createCardInstance(ZESSHO, {
      instanceId: "swap-top",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "revealed",
    });
    const remainder = createCardInstance(SONG, {
      instanceId: "remaining-revealed",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "revealed",
    });
    const hand = createCardInstance(SONG, {
      instanceId: "hand-top",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const deckExisting = createCardInstance(SONG, {
      instanceId: "deck-existing",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [self, remainder, hand, deckExisting],
    });
    const pendingState: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, handCount: 1, deckCount: 1 } : p
      ),
      pendingDeckReveal: {
        pendingId: "dr-top-bottom",
        actingPlayerId: "alice",
        sourceInstanceId: "src",
        sourceDefinitionId: "src",
        revealedCardInstanceIds: [self.instanceId, remainder.instanceId],
        picks: [],
        remainder: "top_or_bottom",
        phase: "revealed_choice",
        currentPickIndex: 0,
        pickedCardInstanceIds: [],
        origin: "deck",
        revealedAutoAddCandidateIds: [self.instanceId],
        revealedDispositionMap: {
          [self.instanceId]: { kind: "swap" as const },
        },
      },
    };

    const accept = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    let cur = applyLegalAction({
      state: pendingState,
      action: accept,
      getCardDefinitionById: getDef,
      selectedDeckRevealCardIds: [self.instanceId],
    }).state;
    expect(cur.pendingDeckReveal?.phase).toBe("picking");
    const order = getLegalActions({
      state: cur,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_order")!;
    cur = applyLegalAction({
      state: cur,
      action: order,
      getCardDefinitionById: getDef,
      deckRevealRemainderOrder: [remainder.instanceId],
      deckRevealPlacement: "top",
    }).state;

    expect(cur.pendingZoneSelection?.destination).toBe("deck_bottom");
    expect(cur.pendingZoneSelection?.destinationPosition).toBe("top");
    expect(cur.pendingZoneSelection?.swapPickedFallbackRemainder).toBe("top");
    const swap = getLegalActions({
      state: cur,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_zone_selection")!;
    const done = applyLegalAction({
      state: cur,
      action: swap,
      getCardDefinitionById: getDef,
      selectedZoneCardIds: [hand.instanceId],
    }).state;

    expect(
      done.cardInstances.find((c) => c.instanceId === self.instanceId)!.zone
    ).toBe("hand");
    const aliceDeck = done.cardInstances.filter(
      (c) => c.ownerPlayerId === "alice" && c.zone === "deck"
    );
    expect(aliceDeck[0]!.instanceId).toBe(hand.instanceId);
  });

  it("手札1枚で swap 2枚の同時受理は max 超過として拒否する", () => {
    const selfA = createCardInstance(SONG, {
      instanceId: "swap-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "revealed",
    });
    const selfB = createCardInstance(SONG, {
      instanceId: "swap-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "revealed",
    });
    const hand = createCardInstance(SONG, {
      instanceId: "hand-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [selfA, selfB, hand],
    });
    const pendingState: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, handCount: 1 } : p
      ),
      pendingDeckReveal: {
        pendingId: "dr-test",
        actingPlayerId: "alice",
        sourceInstanceId: "src",
        sourceDefinitionId: "src",
        revealedCardInstanceIds: [selfA.instanceId, selfB.instanceId],
        picks: [],
        remainder: "trash",
        phase: "revealed_choice",
        currentPickIndex: 0,
        pickedCardInstanceIds: [],
        origin: "deck",
        revealedAutoAddCandidateIds: [selfA.instanceId, selfB.instanceId],
        revealedDispositionMap: {
          [selfA.instanceId]: { kind: "swap" as const },
          [selfB.instanceId]: { kind: "swap" as const },
        },
      },
    };
    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    expect(action.maxPickCount).toBe(1);
    expect(() =>
      applyLegalAction({
        state: pendingState,
        action,
        getCardDefinitionById: getDef,
        selectedDeckRevealCardIds: [selfA.instanceId, selfB.instanceId],
      })
    ).toThrow(/exceeds max/);
  });

  it("手札0枚なら入れ替え不能 → swap は受理候補に出ず、直接受理も拒否", () => {
    const { state, selfId } = revealedStateWithHand(SONG, SONG, 0);
    const pendingState: GameState = {
      ...state,
      pendingDeckReveal: {
        pendingId: "dr-test",
        actingPlayerId: "alice",
        sourceInstanceId: "src",
        sourceDefinitionId: "src",
        revealedCardInstanceIds: [selfId],
        picks: [],
        remainder: "trash",
        phase: "revealed_choice",
        currentPickIndex: 0,
        pickedCardInstanceIds: [],
        origin: "deck",
        revealedAutoAddCandidateIds: [selfId],
        revealedDispositionMap: { [selfId]: { kind: "swap" as const } },
      },
    };
    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    expect(action.candidateCardInstanceIds).not.toContain(selfId);
    expect(action.maxPickCount).toBe(0);

    expect(() =>
      applyLegalAction({
        state: pendingState,
        action,
        getCardDefinitionById: getDef,
        selectedDeckRevealCardIds: [selfId],
      })
    ).toThrow(/Invalid deck reveal revealed choice candidate/);

    const { state: declined } = applyLegalAction({
      state: pendingState,
      action,
      getCardDefinitionById: getDef,
      selectedDeckRevealCardIds: [],
    });
    expect(
      declined.cardInstances.find((c) => c.instanceId === selfId)!.zone
    ).toBe("trash");
    expect(declined.pendingZoneSelection).toBeNull();
  });
});

describe("swap end-to-end（trash）: 鍵効果でトラッシュ行き → 受理で手札へ + 手札1枚をトラッシュへ", () => {
  it("BSFT01-C03: trash 由来の入れ替えは行き先がトラッシュ", () => {
    const self = createCardInstance(SEIREI, {
      instanceId: "self-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const handCard = createCardInstance(SEIREI, {
      instanceId: "hand-0",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [self, handCard],
    });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, handCount: 1 } : p
      ),
    };

    // 鍵効果でトラッシュ行き → 遅延キュー → materialize で revealed_choice(origin=trash)。
    // BSFT01-C03 [0] は trigger_source_player:"self" ガード付き (audit-bsft01 解消)。
    const deferred = processMovedToTrashEffects(
      state,
      [self.instanceId],
      getDef,
      {
        sourceTribes: ["鍵"],
        sourcePlayerId: "alice",
        fromZone: "deck",
      }
    );
    expect(deferred.pendingTrashOptionalAdds).toHaveLength(1);
    expect(deferred.pendingTrashOptionalAdds[0]!.swapInstanceIds).toEqual([
      self.instanceId,
    ]);

    const pendingState = materializeDeferredTrashOptionalAdds(deferred);
    expect(pendingState.pendingDeckReveal).not.toBeNull();
    expect(pendingState.pendingDeckReveal!.origin).toBe("trash");
    expect(
      pendingState.pendingDeckReveal!.revealedDispositionMap![self.instanceId]!
        .kind
    ).toBe("swap");

    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    const { state: resolved } = applyLegalAction({
      state: pendingState,
      action,
      getCardDefinitionById: getDef,
      selectedDeckRevealCardIds: [self.instanceId],
    });

    expect(
      resolved.cardInstances.find((c) => c.instanceId === self.instanceId)!.zone
    ).toBe("trash");
    // trash 由来 → 入れ替えで出す手札はトラッシュへ。
    expect(resolved.pendingZoneSelection).not.toBeNull();
    expect(resolved.pendingZoneSelection!.destination).toBe("trash");

    const swapAction = getLegalActions({
      state: resolved,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_zone_selection")!;
    const { state: done } = applyLegalAction({
      state: resolved,
      action: swapAction,
      getCardDefinitionById: getDef,
      selectedZoneCardIds: [handCard.instanceId],
    });
    expect(
      done.cardInstances.find((c) => c.instanceId === handCard.instanceId)!.zone
    ).toBe("trash");
    expect(
      done.cardInstances.find((c) => c.instanceId === self.instanceId)!.zone
    ).toBe("hand");
  });
});
