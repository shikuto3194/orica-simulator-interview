/**
 * BSTH02-X05 八雲 藍 effects[0] 後段の検証。
 *
 * 原文 (textLines[3,4]):
 *   "Lv1-Lv2-Lv3『このスピリットの煌臨/アタック時』"
 *   "相手のスピリット/アルティメット1体をデッキの下に戻せる。さらに、このバトルの間、この
 *    スピリットに導シンボル1つを追加する。その後、自分のトラッシュにある《ソウルコア》を
 *    このスピリットに置ける。"
 *
 * 「その後」= 前段 (send_to_deck + symbol_add、simultaneous・同一 optional gate) とは独立の
 * 任意行動 (BSDB01 系の「その後、〜できる」precedent と同型、per-step executionMode:"optional")。
 * 《ソウルコア》明記 = effectKind:"explicit_soul_core"（trash→this_card ハンドラ新設
 * ENGINE-core-move-trash-to-this-card-soul）。stub 解消の検証。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import type { CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function drainOptionalStepsWithExecute(
  state: GameState,
  getDef = getCardDefinitionById
): GameState {
  let s = state;
  while (s.pendingStepOptionalChoice !== null) {
    const psoc = s.pendingStepOptionalChoice;
    s = applyLegalAction({
      state: s,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
  }
  return s;
}

describe("BSTH02-X05 八雲 藍 effects[0] 後段 (trash soul core → this_card)", () => {
  const c = cardNoMap.get("BSTH02-X05")!;

  it("stub フィールドが削除され、3ステップ目に core_move(trash→this_card, explicit_soul_core) がある", () => {
    const e = c.effects![0]!;
    expect(e.stub).toBeUndefined();
    expect(e.steps).toHaveLength(3);
    expect(e.steps[2]!.action).toEqual({
      kind: "core_move",
      from: { kind: "trash", player: "self" },
      to: { kind: "this_card" },
      amount: 1,
      effectKind: "explicit_soul_core",
    });
    expect(e.steps[2]!.connector).toBe("sequential");
    expect(e.steps[2]!.executionMode).toBe("optional");
  });

  it("自分のトラッシュにソウルコアがあるとき、実行を選ぶとこのカードへ置かれる", () => {
    const alice = createCardInstance(c, {
      instanceId: "yakumo-ran",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const opponentSpirit: CardDefinition = {
      cardNo: "TEST-BSTH02-X05-OPPONENT-SPIRIT",
      name: "対象スピリット",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["blue"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const bobSpirit = createCardInstance(opponentSpirit, {
      instanceId: "bob-spirit-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const defs = new Map<string, CardDefinition>([
      ...cardNoMap.entries(),
      [opponentSpirit.cardNo, opponentSpirit],
    ]);

    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, soulCoreLocation: { kind: "trash" as const } }
          : p
      ),
      cardInstances: [alice, bobSpirit],
    };

    const afterEffect = executeEffect({
      chainId: "test:bsth02-x05-attack-trash-soul-core:116",
      state,
      effect: c.effects![0]!,
      sourceInstanceId: "yakumo-ran",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });
    const resolved = drainOptionalStepsWithExecute(afterEffect, (id) =>
      defs.get(id)
    );

    const aliceAfter = resolved.players.find((p) => p.id === "alice")!;
    expect(aliceAfter.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "yakumo-ran",
    });
    const yakumoAfter = resolved.cardInstances.find(
      (card) => card.instanceId === "yakumo-ran"
    )!;
    expect(yakumoAfter.soulCoreCount).toBe(1);
    // 前段 (デッキ下戻し) も実行されたことを確認 (デッキの下へ、zone="deck")。
    const bobSpiritAfter = resolved.cardInstances.find(
      (card) => card.instanceId === "bob-spirit-1"
    )!;
    expect(bobSpiritAfter.zone).toBe("deck");
  });
});
