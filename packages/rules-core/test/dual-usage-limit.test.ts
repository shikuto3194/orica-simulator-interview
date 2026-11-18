/**
 * 二重 usageLimit (per_card_name turn + per_instance game) の検証。
 *
 * BSTH01-X04【フォーオブアカインド】:
 *   〔ターンに1回：同名〕かつ ゲーム中に1回
 *   → per_card_name/turn AND per_instance/game の AND 条件。
 */
import { describe, expect, it } from "vitest";
import { BSTH01_CARDS } from "../../card-data/src/cards/BSTH01";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { moveCardZone } from "../src/core/core-system";
import {
  canUseEffectUsage,
  listEffectUsage,
  seedEffectUsage,
} from "./helpers/effect-usage-fixture";
import type { GameState, EffectUsageLimit } from "../src/model";

/** 最小限の GameState を生成 */
function makeState(overrides?: Partial<GameState>): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [instanceA, instanceB].map((instanceId) =>
        createCardInstance(
          BSTH01_CARDS.find((c) => c.cardNo === definitionId)!,
          { instanceId, ownerPlayerId: "alice", zone: "field", cores: 3 }
        )
      ),
    }),
    turnNumber: 1,
    step: "main",
    ...overrides,
  };
}

const dualLimit: EffectUsageLimit[] = [
  { kind: "per_card_name", duration: "turn" },
  { kind: "per_instance", duration: "game" },
];

const effectLabel = "effect:1";
const instanceA = "flan-1";
const instanceB = "flan-2";
const definitionId = "BSTH01-X04";

describe("二重 usageLimit (per_card_name turn + per_instance game)", () => {
  it("初期状態: 使用可能", () => {
    const state = makeState();
    expect(
      canUseEffectUsage(state, {
        sourceInstanceId: instanceA,
        effectLabel,
        usageLimit: dualLimit,
      })
    ).toBe(true);
  });

  it("1回使用後: 同ターン同名は不可 (per_card_name turn)", () => {
    let state = makeState();
    state = seedEffectUsage(state, {
      sourceInstanceId: instanceA,
      effectLabel,
      usageLimit: dualLimit,
    });

    // 同インスタンス: 不可 (both limits block)
    expect(
      canUseEffectUsage(state, {
        sourceInstanceId: instanceA,
        effectLabel,
        usageLimit: dualLimit,
      })
    ).toBe(false);

    // 別インスタンス同名: per_card_name turn がブロック
    expect(
      canUseEffectUsage(state, {
        sourceInstanceId: instanceB,
        effectLabel,
        usageLimit: dualLimit,
      })
    ).toBe(false);
  });

  it("ターン経過後: per_card_name turn はリセットされるが per_instance game が残る", () => {
    // ターン1で instanceA が使用
    let state = makeState({ turnNumber: 1 });
    state = seedEffectUsage(state, {
      sourceInstanceId: instanceA,
      effectLabel,
      usageLimit: dualLimit,
    });

    // ターン2に進む
    state = { ...state, turnNumber: 2 } as GameState;

    // instanceA: per_instance game がブロック (ゲーム中に1回使用済み)
    expect(
      canUseEffectUsage(state, {
        sourceInstanceId: instanceA,
        effectLabel,
        usageLimit: dualLimit,
      })
    ).toBe(false);

    // instanceB (同名別個体): per_card_name turn はターン変わりでリセット、
    // per_instance game は instanceB では未使用 → 使用可能
    expect(
      canUseEffectUsage(state, {
        sourceInstanceId: instanceB,
        effectLabel,
        usageLimit: dualLimit,
      })
    ).toBe(true);
  });

  it("同じ物理カードが再登場しても同名ターン制限は残り、次のターンには新個体として使える", () => {
    const context = {
      sourceInstanceId: instanceA,
      effectLabel,
      usageLimit: dualLimit,
    };
    const used = seedEffectUsage(makeState(), context);
    const returned = moveCardZone(
      moveCardZone(used, instanceA, "trash"),
      instanceA,
      "field"
    );
    expect(canUseEffectUsage(returned, context)).toBe(false);
    expect(canUseEffectUsage({ ...returned, turnNumber: 3 }, context)).toBe(
      true
    );
  });

  it("seedEffectUsage は配列内の全 duration で使用枠を生成する", () => {
    let state = makeState();
    state = seedEffectUsage(state, {
      sourceInstanceId: instanceA,
      effectLabel,
      usageLimit: dualLimit,
    });

    // turn duration と game duration の 2 枠
    expect(listEffectUsage(state)).toHaveLength(2);
    const durations = listEffectUsage(state)
      .map((r) => r.period)
      .sort();
    expect(durations).toEqual(["game", "turn"]);
  });

  it("単一 usageLimit (後方互換): 従来通り動作する", () => {
    const singleLimit: EffectUsageLimit = {
      kind: "per_card_name",
      duration: "turn",
    };
    let state = makeState();

    expect(
      canUseEffectUsage(state, {
        sourceInstanceId: instanceA,
        effectLabel,
        usageLimit: singleLimit,
      })
    ).toBe(true);

    state = seedEffectUsage(state, {
      sourceInstanceId: instanceA,
      effectLabel,
      usageLimit: singleLimit,
    });

    expect(
      canUseEffectUsage(state, {
        sourceInstanceId: instanceA,
        effectLabel,
        usageLimit: singleLimit,
      })
    ).toBe(false);

    expect(listEffectUsage(state)).toHaveLength(1);
  });
});
