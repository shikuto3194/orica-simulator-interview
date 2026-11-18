import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  setFirstPlayer,
} from "../src/index";
import {
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
} from "../src/effect/structured-effect-registrations";
import type { CardDefinition, GameState } from "../src/index";
import { BSTH01_CARDS } from "../../card-data/src/cards/BSTH01";

/**
 * Regression: end_attack_step アクション (アタックステップ終了 → エンドステップ突入) で
 * advanceStep に getRegisteredTriggeredEffectActions が渡されておらず、
 * step_transition / end_step イベントが「リスナーなし」フィルタを通らずに
 * pendingTriggeredEffects に残留する。
 *
 * 結果として ActionBar の「次のステップ」ボタンが pendingTriggeredEffects.length > 0
 * により disabled となり、`window` も `end_step_cleanup` へ進めずラベルが
 * 「ターン終了」に切り替わらない。
 */
describe("regression: end_attack_step は誘発リスナーが無いイベントを残さない", () => {
  it("毛玉のみのフィールド/手札で end_attack_step を実行しても pendingTriggeredEffects が空のまま", () => {
    const cardDefs: CardDefinition[] = BSTH01_CARDS;
    const getCardDefinitionById = (id: string) =>
      cardDefs.find((d) => d.cardNo === id);
    const triggeredLookup = buildTriggeredEffectLookup(cardDefs);
    const battleImmediateLookup = buildBattleImmediateEffectLookup(cardDefs);
    const fieldCardLookup = buildFieldCardEffectLookup(cardDefs);
    const magicLookup = buildMagicLookup(cardDefs);

    const kedama = cardDefs.find((d) => d.cardNo === "BSTH01-C01")!;
    const aliceHand = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(kedama, {
        instanceId: `alice-hand-${i}`,
        ownerPlayerId: "alice",
        zone: "hand",
      })
    );
    const bobHand = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(kedama, {
        instanceId: `bob-hand-${i}`,
        ownerPlayerId: "bob",
        zone: "hand",
      })
    );

    let state: GameState = setFirstPlayer(
      createEmptyGameState({ playerIds: ["alice", "bob"] }),
      "bob"
    );
    state = {
      ...state,
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "none",
      cardInstances: [...aliceHand, ...bobHand],
    };

    const result = applyLegalAction({
      state,
      action: { kind: "end_attack_step", actingPlayerId: "alice" },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getRegisteredFieldCardEffectActions: fieldCardLookup,
      getRegisteredMagicActions: magicLookup,
    });

    expect(result.state.step).toBe("end");
    expect(result.state.window).toBe("end_step_effects");
    // 修正前: ['start_step', 'end_step'] が残留 → 「次のステップ」ボタンが disabled
    expect(
      result.state.pendingTriggeredEffects.map((p) => p.eventKind)
    ).toEqual([]);
  });
});
