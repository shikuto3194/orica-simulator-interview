/**
 * trigger_tribes 条件 ＋ 系統限定の自己回収（鍵/星霊・地球人）。
 *
 * 仕様（10_rules/07b §6 裁定 2026-06-11）:
 *   「系統：「鍵」/「星霊」を持つ効果でデッキからオープン/トラッシュ行きしたこのカードは
 *    手札に加えられる」= 実装済み BSTH01-R12（trigger_colors 版）と同型。
 *   差分はトリガー原因が「色」→「系統」になる点のみ。trigger_tribes 条件で表現する。
 *
 * 重要: trigger_tribes は **トリガーを引き起こした効果のソースカードの系統** で判定し、
 *   効果を持つカード自身（＝回収対象）の系統へはフォールバックしない。
 *   （C02 自身の tribe は「光導・星霊」を含むため、フォールバックすると自カードで誤発火する）。
 *
 * 対象カード:
 *   - BSFT01-C02 ルーシィキック（鍵/星霊・オープン/トラッシュ → 手札）
 *   - BSFT01-C04 ハートフィリア財閥（鍵/星霊・手札5枚以下のとき → 手札。hand_count ゲート）
 *   - BSDB01-C10 仙豆（地球人・オープン → 手札。revealed のみ）
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
import type { CardDefinition, GameState, Zone } from "../src/index";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const C02 = cardNoMap.get("BSFT01-C02")!; // 鍵/星霊 → 手札
const C04 = cardNoMap.get("BSFT01-C04")!; // 鍵/星霊 + 手札5枚以下
const C10 = cardNoMap.get("BSDB01-C10")!; // 地球人 → 手札（オープンのみ）

function stateWith(def: CardDefinition, zone: Zone, handCount = 0) {
  const inst = createCardInstance(def, {
    instanceId: "self-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone,
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [inst],
  });
  const state: GameState = {
    ...base,
    players: base.players.map((p) =>
      p.id === "alice" ? { ...p, handCount } : p
    ),
  };
  return { state, id: inst.instanceId };
}

describe("trigger_tribes: moved_to_trash 自己回収（BSFT01-C02 鍵/星霊）", () => {
  it("ソース効果が系統「星霊」かつデッキ由来なら自己回収がマッチする", () => {
    const { state, id } = stateWith(C02, "trash");
    const match = findMovedToTrashAutoEffect(state, id, C02, getDef, {
      sourceTribes: ["星霊"],
      fromZone: "deck",
    });
    expect(match).toBeDefined();
    expect(match!.kind).toBe("add_to_hand");
    expect(match!.executionMode).toBe("optional");
  });

  it("ソース系統「鍵」でもマッチする", () => {
    const { state, id } = stateWith(C02, "trash");
    expect(
      findMovedToTrashAutoEffect(state, id, C02, getDef, {
        sourceTribes: ["鍵"],
        fromZone: "deck",
      })
    ).toBeDefined();
  });

  it("無関係な系統「紅魔」ではマッチしない", () => {
    const { state, id } = stateWith(C02, "trash");
    expect(
      findMovedToTrashAutoEffect(state, id, C02, getDef, {
        sourceTribes: ["紅魔"],
        fromZone: "deck",
      })
    ).toBeUndefined();
  });

  it("sourceTribes 不在なら自カードの系統（星霊）へフォールバックせずマッチしない", () => {
    const { state, id } = stateWith(C02, "trash");
    // C02 自身の tribe は「光導・星霊」。フォールバックすると誤発火する。
    expect(
      findMovedToTrashAutoEffect(state, id, C02, getDef, {
        sourceColors: ["blue"],
        fromZone: "deck",
      })
    ).toBeUndefined();
  });

  it("デッキ由来でない（fromZone=hand）ならマッチしない", () => {
    const { state, id } = stateWith(C02, "trash");
    expect(
      findMovedToTrashAutoEffect(state, id, C02, getDef, {
        sourceTribes: ["星霊"],
        fromZone: "hand",
      })
    ).toBeUndefined();
  });

  it("end-to-end: 星霊効果でトラッシュ行き → 任意追加が遅延キューへ → 選択で手札へ", () => {
    const { state, id } = stateWith(C02, "trash");
    const deferred = processMovedToTrashEffects(state, [id], getDef, {
      sourceTribes: ["星霊"],
      fromZone: "deck",
    });
    // mid-effect では即手札に入れず退避キューへ（スタック窓を開かない）。
    expect(deferred.cardInstances.find((c) => c.instanceId === id)!.zone).toBe(
      "trash"
    );
    expect(deferred.pendingTrashOptionalAdds).toHaveLength(1);

    const pendingState = materializeDeferredTrashOptionalAdds(deferred);
    expect(pendingState.pendingDeckReveal).not.toBeNull();
    expect(pendingState.pendingDeckReveal!.origin).toBe("trash");

    const action = getLegalActions({
      state: pendingState,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
    const { state: resolved } = applyLegalAction({
      state: pendingState,
      action,
      getCardDefinitionById: getDef,
      selectedDeckRevealCardIds: [id],
    });
    expect(resolved.cardInstances.find((c) => c.instanceId === id)!.zone).toBe(
      "hand"
    );
  });
});

describe("trigger_tribes + hand_count + trigger_source_player: BSFT01-C04（自分の鍵/星霊効果・手札5枚以下のとき）", () => {
  it("自分起因かつ手札5枚以下ならマッチする", () => {
    const { state, id } = stateWith(C04, "trash", 5);
    expect(
      findMovedToTrashAutoEffect(state, id, C04, getDef, {
        sourceTribes: ["鍵"],
        sourcePlayerId: "alice",
        fromZone: "deck",
      })
    ).toBeDefined();
  });

  it("手札6枚ならマッチしない（hand_count max:5 ゲート）", () => {
    const { state, id } = stateWith(C04, "trash", 6);
    expect(
      findMovedToTrashAutoEffect(state, id, C04, getDef, {
        sourceTribes: ["鍵"],
        sourcePlayerId: "alice",
        fromZone: "deck",
      })
    ).toBeUndefined();
  });

  it("相手起因 (sourcePlayerId=bob) ではマッチしない (trigger_source_player:self ガード)", () => {
    const { state, id } = stateWith(C04, "trash", 5);
    expect(
      findMovedToTrashAutoEffect(state, id, C04, getDef, {
        sourceTribes: ["鍵"],
        sourcePlayerId: "bob",
        fromZone: "deck",
      })
    ).toBeUndefined();
  });

  it("sourcePlayerId 不在 (legacy context) ではマッチしない (trigger_source_player:self ガード)", () => {
    const { state, id } = stateWith(C04, "trash", 5);
    expect(
      findMovedToTrashAutoEffect(state, id, C04, getDef, {
        sourceTribes: ["鍵"],
        fromZone: "deck",
      })
    ).toBeUndefined();
  });
});

describe("trigger_tribes: revealed 自己回収（BSDB01-C10 地球人）", () => {
  it("地球人効果でデッキからオープンされたらマッチする", () => {
    const { state, id } = stateWith(C10, "revealed");
    const match = findRevealedEffect(state, id, C10, getDef, {
      sourceTribes: ["地球人"],
      fromZone: "deck",
      sourcePlayerId: "alice",
    });
    expect(match).toBeDefined();
    expect(match!.disposition.kind).toBe("move");
  });

  it("BSDB01-C10 は相手の地球人効果では回収できない", () => {
    const { state, id } = stateWith(C10, "revealed");
    expect(
      findRevealedEffect(state, id, C10, getDef, {
        sourceTribes: ["地球人"],
        fromZone: "deck",
        sourcePlayerId: "bob",
      })
    ).toBeUndefined();
  });

  it("無関係な系統ではマッチしない / sourceTribes 不在でもマッチしない", () => {
    const { state, id } = stateWith(C10, "revealed");
    expect(
      findRevealedEffect(state, id, C10, getDef, {
        sourceTribes: ["サイヤ人"],
        fromZone: "deck",
      })
    ).toBeUndefined();
    expect(
      findRevealedEffect(state, id, C10, getDef, {
        sourceColors: ["red"],
        fromZone: "deck",
      })
    ).toBeUndefined();
  });
});
