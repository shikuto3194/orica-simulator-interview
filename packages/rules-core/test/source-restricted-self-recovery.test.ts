/**
 * 発生源限定の自己回収 add 型（系統 / 色限定）の card-data 配線回帰。
 *
 * 仕様（10_rules/07b §6 裁定 2026-06-11、add 型は 2026-06-14 実装済）:
 *   「自分の系統：「X」/色 を持つ効果でデッキからオープンされたか、トラッシュに置かれた
 *    このカードは手札に加えられる」= BSFT01-C02 と同型の
 *    card_event(revealed / moved_to_trash) + trigger_tribes|trigger_colors
 *    + trigger_from_zone:deck + optional。本テストは新規配線カードを回帰する。
 *
 * 重要: trigger_tribes / trigger_colors は **トリガーを引き起こした効果のソースカード**
 *   で判定し、効果を持つカード自身（＝回収対象）へはフォールバックしない。
 *
 * 対象カード（本イテレーションで stub 解消）:
 *   - BSTH001-C05 死なばもろとも（靈異・オープンのみ）
 *   - BSTH001-C06 星幽剣士（靈異・オープンのみ）
 *   - BSTH003-R03 Reincarnation（黄/赤色・オープン/トラッシュ）
 *   - BSTH07.8-C05 霧の湖（妖精・オープン/トラッシュ・ネクサス）
 *   - BSTH07.8-R04 凍符「パーフェクトフリーズ」（妖精・オープン/トラッシュ・マジック）
 *   - BSTH09-R03 「進撃の小人」（勇傑/妖戒・オープンのみ・手札5枚以下ゲート）
 */
import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/index";
import {
  findMovedToTrashAutoEffect,
  findRevealedEffect,
} from "../src/effect/structured-effect-interpreter";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState, Zone } from "../src/index";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

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

describe("発生源限定自己回収: 靈異 revealed (BSTH001-C05 / C06)", () => {
  for (const cardNo of ["BSTH001-C05", "BSTH001-C06"]) {
    const def = cardNoMap.get(cardNo)!;

    it(`${cardNo}: 靈異効果でデッキからオープン → 手札へ（任意）`, () => {
      const { state, id } = stateWith(def, "revealed");
      const match = findRevealedEffect(state, id, def, getDef, {
        sourceTribes: ["靈異"],
        sourcePlayerId: "alice",
        fromZone: "deck",
      });
      expect(match).toBeDefined();
      expect(match!.disposition.kind).toBe("move");
      expect(match!.executionMode).toBe("optional");
    });

    it(`${cardNo}: 無関係系統ではマッチしない`, () => {
      const { state, id } = stateWith(def, "revealed");
      expect(
        findRevealedEffect(state, id, def, getDef, {
          sourceTribes: ["紅魔"],
          sourcePlayerId: "alice",
          fromZone: "deck",
        })
      ).toBeUndefined();
    });

    it(`${cardNo}: 相手の靈異効果や発生源プレイヤー不明では回収できない`, () => {
      const { state, id } = stateWith(def, "revealed");
      for (const sourcePlayerId of ["bob", undefined]) {
        expect(
          findRevealedEffect(state, id, def, getDef, {
            sourceTribes: ["靈異"],
            ...(sourcePlayerId !== undefined ? { sourcePlayerId } : {}),
            fromZone: "deck",
          })
        ).toBeUndefined();
      }
    });

    it(`${cardNo}: トラッシュ行きでは発火しない（テキストはオープンのみ）`, () => {
      const { state, id } = stateWith(def, "trash");
      expect(
        findMovedToTrashAutoEffect(state, id, def, getDef, {
          sourceTribes: ["靈異"],
          sourcePlayerId: "alice",
          fromZone: "deck",
        })
      ).toBeUndefined();
    });
  }
});

describe("発生源限定自己回収: 黄/赤色 revealed+trash (BSTH003-R03)", () => {
  const def = cardNoMap.get("BSTH003-R03")!;

  it("黄の効果でデッキからオープン → 手札へ", () => {
    const { state, id } = stateWith(def, "revealed");
    const match = findRevealedEffect(state, id, def, getDef, {
      sourceColors: ["yellow"],
      fromZone: "deck",
    });
    expect(match).toBeDefined();
    expect(match!.disposition.kind).toBe("move");
  });

  it("赤の効果でトラッシュ行き → 手札へ", () => {
    const { state, id } = stateWith(def, "trash");
    const match = findMovedToTrashAutoEffect(state, id, def, getDef, {
      sourceColors: ["red"],
      fromZone: "deck",
    });
    expect(match).toBeDefined();
    expect(match!.kind).toBe("add_to_hand");
  });

  it("無関係な色（青）ではマッチしない", () => {
    const { state, id } = stateWith(def, "revealed");
    expect(
      findRevealedEffect(state, id, def, getDef, {
        sourceColors: ["blue"],
        fromZone: "deck",
      })
    ).toBeUndefined();
  });
});

describe("発生源限定自己回収: 妖精 ネクサス revealed+trash (BSTH07.8-C05)", () => {
  const def = cardNoMap.get("BSTH07.8-C05")!;

  it("自分の妖精効果でデッキからオープン → 手札へ", () => {
    const { state, id } = stateWith(def, "revealed");
    expect(
      findRevealedEffect(state, id, def, getDef, {
        sourceTribes: ["妖精"],
        sourcePlayerId: "alice",
        fromZone: "deck",
      })
    ).toBeDefined();
  });

  it("自分の妖精効果でトラッシュ行き → 手札へ", () => {
    const { state, id } = stateWith(def, "trash");
    expect(
      findMovedToTrashAutoEffect(state, id, def, getDef, {
        sourceTribes: ["妖精"],
        sourcePlayerId: "alice",
        fromZone: "deck",
      })
    ).toBeDefined();
  });

  it("デッキ由来でない（fromZone=hand）ならマッチしない", () => {
    const { state, id } = stateWith(def, "revealed");
    expect(
      findRevealedEffect(state, id, def, getDef, {
        sourceTribes: ["妖精"],
        sourcePlayerId: "alice",
        fromZone: "hand",
      })
    ).toBeUndefined();
  });

  it("相手の妖精効果や sourcePlayerId 不在ではマッチしない", () => {
    const { state, id } = stateWith(def, "revealed");
    expect(
      findRevealedEffect(state, id, def, getDef, {
        sourceTribes: ["妖精"],
        sourcePlayerId: "bob",
        fromZone: "deck",
      })
    ).toBeUndefined();
    expect(
      findRevealedEffect(state, id, def, getDef, {
        sourceTribes: ["妖精"],
        fromZone: "deck",
      })
    ).toBeUndefined();
  });
});

describe("発生源限定自己回収: 妖精 マジック revealed+trash (BSTH07.8-R04)", () => {
  const def = cardNoMap.get("BSTH07.8-R04")!;

  it("自分の妖精効果でデッキからオープン → 手札へ", () => {
    const { state, id } = stateWith(def, "revealed");
    expect(
      findRevealedEffect(state, id, def, getDef, {
        sourceTribes: ["妖精"],
        sourcePlayerId: "alice",
        fromZone: "deck",
      })
    ).toBeDefined();
  });

  it("自分の霧の湖効果なら、sourceTribes が無くても名前 branch で手札へ", () => {
    const { state, id } = stateWith(def, "revealed");
    expect(
      findRevealedEffect(state, id, def, getDef, {
        sourceCardName: "霧の湖",
        sourcePlayerId: "alice",
        fromZone: "deck",
      })
    ).toBeDefined();
  });

  it("自分の妖精効果でトラッシュ行き → 手札へ", () => {
    const { state, id } = stateWith(def, "trash");
    expect(
      findMovedToTrashAutoEffect(state, id, def, getDef, {
        sourceTribes: ["妖精"],
        sourcePlayerId: "alice",
        fromZone: "deck",
      })
    ).toBeDefined();
  });

  it("デッキ由来でない（fromZone=hand）ならマッチしない", () => {
    const { state, id } = stateWith(def, "revealed");
    expect(
      findRevealedEffect(state, id, def, getDef, {
        sourceTribes: ["妖精"],
        sourcePlayerId: "alice",
        fromZone: "hand",
      })
    ).toBeUndefined();
  });

  it("相手の妖精効果や sourcePlayerId 不在ではマッチしない", () => {
    const { state, id } = stateWith(def, "revealed");
    expect(
      findRevealedEffect(state, id, def, getDef, {
        sourceTribes: ["妖精"],
        sourcePlayerId: "bob",
        fromZone: "deck",
      })
    ).toBeUndefined();
    expect(
      findRevealedEffect(state, id, def, getDef, {
        sourceTribes: ["妖精"],
        fromZone: "deck",
      })
    ).toBeUndefined();
  });

  it("霧の湖でも妖精でもない自分の効果ではマッチしない", () => {
    const { state, id } = stateWith(def, "revealed");
    expect(
      findRevealedEffect(state, id, def, getDef, {
        sourceCardName: "チルノ",
        sourceTribes: ["氷精"],
        sourcePlayerId: "alice",
        fromZone: "deck",
      })
    ).toBeUndefined();
  });
});

describe("発生源限定自己回収: 青色 revealed+trash + trash限定コアボーナス (BSTH05.5-R10)", () => {
  const def = cardNoMap.get("BSTH05.5-R10")!;

  it("自分の青の効果でデッキからオープン → 手札へ（ボーナス core_move step は無視される）", () => {
    const { state, id } = stateWith(def, "revealed");
    const match = findRevealedEffect(state, id, def, getDef, {
      sourceColors: ["blue"],
      fromZone: "deck",
    });
    expect(match).toBeDefined();
    expect(match!.disposition.kind).toBe("move");
    expect(match!.executionMode).toBe("optional");
  });

  it("自分の青の効果でトラッシュ行き → 手札へ＋ボイドから青の導界者ネクサスへコア+1のボーナス", () => {
    const { state, id } = stateWith(def, "trash");
    const match = findMovedToTrashAutoEffect(state, id, def, getDef, {
      sourceColors: ["blue"],
      fromZone: "deck",
    });
    expect(match).toBeDefined();
    expect(match!.kind).toBe("add_to_hand");
    expect(match!.bonusSteps).toHaveLength(1);
    expect(match!.bonusSteps[0]!.action.kind).toBe("core_move");
  });

  it("無関係な色（白）ではマッチしない", () => {
    const { state, id } = stateWith(def, "revealed");
    expect(
      findRevealedEffect(state, id, def, getDef, {
        sourceColors: ["white"],
        fromZone: "deck",
      })
    ).toBeUndefined();
  });

  it("デッキ由来でない（fromZone=hand）ならマッチしない", () => {
    const { state, id } = stateWith(def, "trash");
    expect(
      findMovedToTrashAutoEffect(state, id, def, getDef, {
        sourceColors: ["blue"],
        fromZone: "hand",
      })
    ).toBeUndefined();
  });
});

describe("発生源限定自己回収: 勇傑/妖戒 + hand_count ゲート (BSTH09-R03)", () => {
  const def = cardNoMap.get("BSTH09-R03")!;

  it("勇傑効果でオープン＆手札5枚以下 → 手札へ", () => {
    const { state, id } = stateWith(def, "revealed", 5);
    expect(
      findRevealedEffect(state, id, def, getDef, {
        sourceTribes: ["勇傑"],
        fromZone: "deck",
      })
    ).toBeDefined();
  });

  it("妖戒効果でもマッチする", () => {
    const { state, id } = stateWith(def, "revealed", 0);
    expect(
      findRevealedEffect(state, id, def, getDef, {
        sourceTribes: ["妖戒"],
        fromZone: "deck",
      })
    ).toBeDefined();
  });

  it("手札6枚なら hand_count(max:5) ゲートで発火しない", () => {
    const { state, id } = stateWith(def, "revealed", 6);
    expect(
      findRevealedEffect(state, id, def, getDef, {
        sourceTribes: ["勇傑"],
        fromZone: "deck",
      })
    ).toBeUndefined();
  });
});
