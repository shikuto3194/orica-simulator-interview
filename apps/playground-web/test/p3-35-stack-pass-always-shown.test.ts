/**
 * P3-35 Phase 2-C: スタックパスボタン常時表示の不変条件
 *
 * - stack window 中、responder の legal actions に `pass_stack` は常に含まれる
 *   （能動スタック手段の有無に関わらず）。
 * - `hasActiveStackOptions` は能動スタック手段が無い patchouli シナリオで `false`。
 *
 * GUI 側 (BattleScreen) で onlyStackPassAvailable 自動パスを撤廃したため、
 * pass_stack ボタンは responder のクリックを必須とする。本テストは engine 側の
 * 不変条件のみを検証する（GUI auto-fire 撤廃の振る舞いは React の useEffect
 * 内でしか観測できないため、ここでは扱わない）。
 */
import { describe, expect, it } from "vitest";
import {
  advanceStep,
  applyLegalAction,
  buildHandActivatedEffectLookup,
  buildTriggeredEffectLookup,
  getLegalActions,
  hasActiveStackOptions,
  type LegalAction,
} from "@orica/rules-core";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import { SCENARIOS } from "../src/scenarios";

const getDefinition = (id: string) =>
  ALL_CARDS.find((card) => card.cardNo === id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);
const getRegisteredHandActivatedEffectActions =
  buildHandActivatedEffectLookup(ALL_CARDS);

describe("P3-35 Phase 2-C: stack pass button always shown", () => {
  it("bob (responder) has pass_stack and no other active stack options on Patchouli's start-step trigger", () => {
    const initial = SCENARIOS["patchouli-start-summon"]!.build(ALL_CARDS);
    const queued = advanceStep(
      initial,
      getDefinition,
      getRegisteredTriggeredEffectActions
    );

    const summonAction = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions,
      getRegisteredHandActivatedEffectActions,
    }).find(
      (a): a is Extract<LegalAction, { kind: "summon" }> =>
        a.kind === "summon" && a.sourceCardNo === "BSTH01-M01"
    );

    const afterDeclareEffect = applyLegalAction({
      state: queued,
      action: summonAction!,
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions,
      getRegisteredHandActivatedEffectActions,
      paymentSources: [{ kind: "reserve", amount: 1 }],
    }).state;

    expect(afterDeclareEffect.window).toBe("stack");
    expect(afterDeclareEffect.stackWindow?.priorityPlayerId).toBe("bob");

    // bob の legal actions には pass_stack が含まれる
    const bobActions = getLegalActions({
      state: afterDeclareEffect,
      actingPlayerId: "bob",
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions: () => [],
    });
    expect(bobActions.some((a) => a.kind === "pass_stack")).toBe(true);

    // bob は能動スタック手段を一切持たない（patchouli シナリオは bob 側に flash 系カードなし）
    expect(
      hasActiveStackOptions({
        state: afterDeclareEffect,
        actingPlayerId: "bob",
        getCardDefinitionById: getDefinition,
        getRegisteredTriggeredEffectActions,
        getRegisteredFieldCardEffectActions: () => [],
      })
    ).toBe(false);

    // pass_stack 以外の能動アクション（flash/magic/accel/change/divine_skill）は無し
    const ACTIVE_STACK_KINDS = new Set([
      "use_field_card_effect",
      "use_magic",
      "use_accel",
      "use_change",
    ]);
    const activeStackActions = bobActions.filter((a) =>
      ACTIVE_STACK_KINDS.has(a.kind)
    );
    expect(activeStackActions).toHaveLength(0);
  });

  it("hasActiveStackOptions returns false when no stack window is open", () => {
    const initial = SCENARIOS["patchouli-start-summon"]!.build(ALL_CARDS);
    expect(initial.stackWindow).toBeNull();
    expect(
      hasActiveStackOptions({
        state: initial,
        actingPlayerId: "bob",
        getCardDefinitionById: getDefinition,
        getRegisteredTriggeredEffectActions,
        getRegisteredFieldCardEffectActions: () => [],
      })
    ).toBe(false);
  });
});
