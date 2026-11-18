/**
 * BSKB01-R01「アックスナイト＆ジャベリンナイト＆メイスナイト＆トライデントナイト」effects[0]:
 * 「〔重複不可〕自分のメインステップ終了時、自分のカウント5以上で、魂状態を含む自分の
 * 「メタナイト」がいれば、手札にある、このカードと「メタナイト」1枚を破棄できる。そうしたとき、
 * このターンの間、自分の「コア除去効果」で移動するコアの数を+2する。」
 *
 * BSKB01-C02 (手札からのメインステップ終了時起動 precedent) と同型の declare/resolve/stack
 * フローに、自己破棄 + 手札「メタナイト」フィルタ discard の2枚の処理、その達成後の
 * core_move_amount_modifier (BSTH001-転醒R02(A) precedent) 登録を確認する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { advanceStep } from "../src/turn-system";
import {
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);
const getRegisteredBurstActions = buildBurstEffectLookup(ALL_CARDS);
const getRegisteredFieldCardEffectActions =
  buildFieldCardEffectLookup(ALL_CARDS);

const ALICE = "player-1";
const BOB = "player-2";

describe("BSKB01-R01 effects[0]: 手札の自己＋メタナイト破棄でコア除去効果+2", () => {
  it("card data: stub が消えている", () => {
    const def = card("BSKB01-R01");
    const target = def.effects?.[0];
    expect(target?.stub).toBeUndefined();
    expect(
      target?.steps.some((s) => s.action.kind === "core_move_amount_modifier")
    ).toBe(true);
  });

  it.each([1, 2])(
    "カウント5以上＋メタナイト在場・手札候補%d枚で、自己+メタナイト破棄後にコア除去効果+2を得る",
    (partnerCount) => {
      const source = card("BSKB01-R01");
      const metaknight = card("BSKB01-C01");

      const handSource = createCardInstance(source, {
        instanceId: "r01-hand",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });
      const fieldMetaknight = createCardInstance(metaknight, {
        instanceId: "metaknight-field",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const handMetaknight = createCardInstance(metaknight, {
        instanceId: "metaknight-hand",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });

      const base = createEmptyGameState({
        playerIds: [ALICE, BOB],
        activePlayerId: ALICE,
        cardInstances: [
          handSource,
          fieldMetaknight,
          handMetaknight,
          ...(partnerCount === 2
            ? [
                createCardInstance(metaknight, {
                  instanceId: "other-partner",
                  ownerPlayerId: ALICE,
                  zone: "hand",
                }),
              ]
            : []),
        ],
      });

      const before: GameState = {
        ...base,
        turnNumber: 2,
        step: "main",
        window: "none",
        players: base.players.map((p) =>
          p.id === ALICE ? { ...p, countValue: 5 } : p
        ),
      };

      const queued = advanceStep(
        before,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions
      );
      expect(queued.step).toBe("main");
      expect(queued.window).toBe("step_end");
      expect(
        queued.pendingPrivateDeclarations.some(
          (d) => d.sourceInstanceId === handSource.instanceId
        )
      ).toBe(true);

      const declareAction = getLegalActions({
        state: queued,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
        getRegisteredFieldCardEffectActions,
      }).find(
        (a) =>
          a.kind === "declare_private_triggered_effect" &&
          a.sourceInstanceId === handSource.instanceId
      );
      expect(declareAction).toBeDefined();

      const declared = applyLegalAction({
        state: queued,
        action: declareAction!,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
        getRegisteredFieldCardEffectActions,
      }).state;

      const resolveAction = getLegalActions({
        state: declared,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
        getRegisteredFieldCardEffectActions,
      }).find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === handSource.instanceId
      );
      expect(resolveAction).toBeDefined();

      const stacked = applyLegalAction({
        state: declared,
        action: resolveAction!,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
        getRegisteredFieldCardEffectActions,
      }).state;

      const passAction = getLegalActions({
        state: stacked,
        actingPlayerId: BOB,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
        getRegisteredFieldCardEffectActions,
      }).find((a) => a.kind === "pass_stack");
      expect(passAction).toBeDefined();

      const passed = applyLegalAction({
        state: stacked,
        action: passAction!,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
        getRegisteredFieldCardEffectActions,
      }).state;

      // 候補1枚は自動解決、複数枚は相方の破棄stepで選択する。
      let state = passed;
      if (partnerCount === 2) {
        const targetAction = getLegalActions({
          state,
          actingPlayerId: ALICE,
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions,
          getRegisteredBurstActions,
          getRegisteredFieldCardEffectActions,
        }).find(
          (a) => a.kind === "resolve_pending_step_optional_target_selection"
        );
        expect(targetAction).toBeDefined();
        state = applyLegalAction({
          state,
          action: targetAction!,
          targetInstanceIds: [handMetaknight.instanceId],
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions,
          getRegisteredBurstActions,
          getRegisteredFieldCardEffectActions,
        }).state;
        expect(
          state.cardInstances.find((c) => c.instanceId === "other-partner")
            ?.zone
        ).toBe("hand");
      }

      // 自己 (BSKB01-R01) と手札の「メタナイト」がともにトラッシュへ破棄される。
      expect(
        state.cardInstances.find((c) => c.instanceId === handSource.instanceId)
          ?.zone
      ).toBe("trash");
      expect(
        state.cardInstances.find(
          (c) => c.instanceId === handMetaknight.instanceId
        )?.zone
      ).toBe("trash");
      // 場のメタナイトは破棄対象ではない (手札限定の破棄)。
      expect(
        state.cardInstances.find(
          (c) => c.instanceId === fieldMetaknight.instanceId
        )?.zone
      ).toBe("field");

      // core_move_amount_modifier CE がこのターンの間 (turn, whose:self) で +2 登録される。
      const ce = state.activeContinuousEffects.find(
        (e) => e.modifierTag === "core_move_amount_modifier"
      );
      expect(ce).toBeDefined();
      expect(ce?.modifierAmount).toBe(2);
      expect(ce?.metadata?.coreMoveAmountScope).toBe("self_player");
      expect(ce?.duration).toEqual({ scope: "turn", whose: "self" });
    }
  );

  it("手札にメタナイトが無くても宣言して自己破棄できるが、2枚破棄未達成ではコア除去効果+2を得ない", () => {
    const source = card("BSKB01-R01");
    const metaknight = card("BSKB01-C01");

    const handSource = createCardInstance(source, {
      instanceId: "r01-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    // メタナイトは場のみ。発揮条件は満たし、手札の自己破棄だけを実行できる。
    const fieldMetaknight = createCardInstance(metaknight, {
      instanceId: "metaknight-field",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });

    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      activePlayerId: ALICE,
      cardInstances: [handSource, fieldMetaknight],
    });

    const before: GameState = {
      ...base,
      turnNumber: 2,
      step: "main",
      window: "none",
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, countValue: 5 } : p
      ),
    };

    const queued = advanceStep(
      before,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
    expect(
      queued.pendingPrivateDeclarations.some(
        (d) => d.sourceInstanceId === handSource.instanceId
      )
    ).toBe(true);

    const declareAction = getLegalActions({
      state: queued,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (a) =>
        a.kind === "declare_private_triggered_effect" &&
        a.sourceInstanceId === handSource.instanceId
    );
    expect(declareAction).toBeDefined();

    const lookups = {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
    };
    let state = applyLegalAction({
      state: queued,
      action: declareAction!,
      ...lookups,
    }).state;
    const resolve = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...lookups,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === handSource.instanceId
    );
    expect(resolve).toBeDefined();
    expect(resolve?.skipOnly).not.toBe(true);
    state = applyLegalAction({ state, action: resolve!, ...lookups }).state;
    const pass = getLegalActions({
      state,
      actingPlayerId: BOB,
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();
    state = applyLegalAction({ state, action: pass!, ...lookups }).state;
    expect(
      state.cardInstances.find((c) => c.instanceId === handSource.instanceId)
        ?.zone
    ).toBe("trash");
    expect(
      state.activeContinuousEffects.some(
        (e) => e.modifierTag === "core_move_amount_modifier"
      )
    ).toBe(false);
  });
});
