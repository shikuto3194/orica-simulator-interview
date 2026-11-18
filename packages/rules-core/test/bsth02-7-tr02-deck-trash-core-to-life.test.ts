/**
 * BSTH02.7-TR02(A) アリスのマトリョーシカ [3,4] Lv2-Lv3『このスピリットのアタック時』
 *   「自分のデッキの上から2枚をトラッシュに置ける。そうしたとき、トラッシュの
 *    《ソウルコア》以外のコア1個を自分のライフに置ける。」
 *
 * deck_reveal(revealCount:2, picks:[], remainder:"trash") =「デッキの上から2枚をトラッシュ」を
 * step[0]、connector:"conditional_result"（「そうしたとき」= 前段の成功が前提）の core_move
 * trash→life を step[1] で表現する。generic な「コア」はソウルコアを含む
 * ([[project_soul_core_movement_generic]])。trash→life の core_move はソウルコアも対象になり得る
 * （handleTrashToLife、通常/ソウル混在時は持ち主選択 pendingLifeCoreSelection まで立つ）ため、
 * 印字「《ソウルコア》以外の」を effectKind:"normal_only" で明示除外している
 * （BSSA01-C01 と同型の GUI 誤表示バグの再発防止）。
 * 従来「デッキ上2枚トラッシュ→ソウルコア以外のコア1個をライフに置ける」で stub だった効果を
 * board 変化で検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";

function drainOptionalStepsWithExecute(
  state: GameState,
  getDef: (id: string) => CardDefinition | undefined
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

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

describe("BSTH02.7-TR02(A) アリスのマトリョーシカ — アタック時 デッキ破棄→トラッシュコア→ライフ", () => {
  const c = card("BSTH02.7-TR02(A)");
  const attackEffect = c.effects![1]!;

  it("構造: step0 = deck_reveal(2, remainder:trash), step1 = conditional_result core_move(trash→life)。stub 解消済み", () => {
    expect(attackEffect.stub).toBeUndefined();
    expect(attackEffect.timing).toEqual({
      kind: "card_event",
      event: "attack",
    });

    const reveal = attackEffect.steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(2);
      expect(reveal.picks).toEqual([]);
      expect(reveal.remainder).toBe("trash");
    }

    const result = attackEffect.steps[1]!;
    expect(result.connector).toBe("conditional_result");
    const move = result.action;
    expect(move.kind).toBe("core_move");
    if (move.kind === "core_move") {
      expect(move.from).toEqual({ kind: "trash", player: "self" });
      expect(move.to).toEqual({ kind: "life", player: "self" });
      expect(move.amount).toBe(1);
      // 《ソウルコア》以外の明示（省略すると通常/ソウル混在時にソウルコアも
      // 選択候補として pendingLifeCoreSelection に出てしまう）。
      expect(move.effectKind).toBe("normal_only");
    }
  });

  it("[board] デッキ上2枚がトラッシュへ → トラッシュのコア1個がライフへ移る", () => {
    const src = createCardInstance(c, {
      instanceId: "matryoshka",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2, // Lv2 (min_level:2 を満たす)
    });
    const deckTop1 = createCardInstance(card("BSTH001-R01"), {
      instanceId: "alice-deck-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const deckTop2 = createCardInstance(card("BSTH001-R02"), {
      instanceId: "alice-deck-2",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before = createEmptyGameState({
      cardInstances: [src, deckTop1, deckTop2],
      playerOverrides: [
        { deckCount: 2, trashNormalCoreCount: 2, lifeNormalCoreCount: 3 },
        {},
      ],
    });
    const after = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bsth02-7-tr02-deck-trash-core-to-life:122",
        state: before,
        effect: attackEffect,
        sourceInstanceId: "matryoshka",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );

    // デッキ上2枚はトラッシュへ。
    expect(
      after.cardInstances.find((x) => x.instanceId === "alice-deck-1")!.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((x) => x.instanceId === "alice-deck-2")!.zone
    ).toBe("trash");
    expect(alice(after).deckCount).toBe(0);

    // そうしたとき: トラッシュの通常コア1個がライフへ（2→1, ライフ 3→4）。
    expect(alice(after).trashNormalCoreCount).toBe(1);
    expect(alice(after).lifeNormalCoreCount).toBe(4);
  });

  it("[board] トラッシュに通常+ソウル混在でもソウルコアは候補外・持ち主選択待ちを発生させない", () => {
    const src = createCardInstance(c, {
      instanceId: "matryoshka",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2, // Lv2 (min_level:2 を満たす)
    });
    const deckTop1 = createCardInstance(card("BSTH001-R01"), {
      instanceId: "alice-deck-1",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const deckTop2 = createCardInstance(card("BSTH001-R02"), {
      instanceId: "alice-deck-2",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before = createEmptyGameState({
      cardInstances: [src, deckTop1, deckTop2],
      playerOverrides: [
        {
          deckCount: 2,
          trashNormalCoreCount: 1,
          trashSoulCoreCount: 1,
          soulCoreLocation: { kind: "trash" as const },
          lifeNormalCoreCount: 3,
        },
        {},
      ],
    });
    const after = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bsth02-7-tr02-deck-trash-core-to-life:178",
        state: before,
        effect: attackEffect,
        sourceInstanceId: "matryoshka",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );

    // 通常/ソウル混在でも真の選択肢が無いため owner-choice pending は発生しない。
    expect(after.pendingLifeCoreSelection).toBeNull();
    // トラッシュの通常コア1個のみがライフへ。ソウルコアはトラッシュに残る。
    expect(alice(after).trashNormalCoreCount).toBe(0);
    expect(alice(after).trashSoulCoreCount).toBe(1);
    expect(alice(after).soulCoreLocation).toEqual({ kind: "trash" });
    expect(alice(after).lifeNormalCoreCount).toBe(4);
  });

  it("[board] デッキが空のとき: deck_reveal 不成立 → conditional_result でコア移動はスキップ", () => {
    const src = createCardInstance(c, {
      instanceId: "matryoshka",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const before = createEmptyGameState({
      cardInstances: [src],
      playerOverrides: [
        { deckCount: 0, trashNormalCoreCount: 2, lifeNormalCoreCount: 3 },
        {},
      ],
    });
    const after = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bsth02-7-tr02-deck-trash-core-to-life:213",
        state: before,
        effect: attackEffect,
        sourceInstanceId: "matryoshka",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }),
      getDef
    );

    // デッキ破棄が起きていない → トラッシュ/ライフのコアは不変。
    expect(alice(after).trashNormalCoreCount).toBe(2);
    expect(alice(after).lifeNormalCoreCount).toBe(3);
  });
});
