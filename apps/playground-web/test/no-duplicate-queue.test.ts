import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionBar } from "../src/components/ActionBar";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createActionInputDecisionNode,
  getLegalActions,
  type GameState,
} from "@orica/rules-core";
import {
  buildNoDuplicateScenario,
  buildRimuruPendingLeaveScenario,
} from "../src/scenario-no-duplicate";
import { buildEffectQueue } from "../src/components/EffectQueueOverlay";

const opts = {
  getCardDefinitionById: (id: string) => ALL_CARDS.find((c) => c.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: () => undefined,
  getRegisteredBurstActions: () => undefined,
};
const actions = (state: GameState) =>
  ["alice", "bob"].flatMap((actingPlayerId) =>
    getLegalActions({ state, actingPlayerId, ...opts })
  );
const queue = (state: GameState) =>
  buildEffectQueue(
    state,
    opts.getCardDefinitionById,
    opts.getRegisteredTriggeredEffectActions,
    "alice",
    actions(state)
  );
describe("リムル: 重複不可キューと自己発揮元", () => {
  it.each(["alice", "bob"])(
    "%s のターンで必須の重複元をスキップして別個体を発揮できる",
    (activePlayerId) => {
      let state = { ...buildNoDuplicateScenario(ALL_CARDS), activePlayerId };
      const findSoul = () =>
        actions(state).find(
          (a) =>
            (a.kind === "resolve_pending_triggered_effect" ||
              a.kind === "select_pending_to_resolve") &&
            a.sourceInstanceId === "rimuru-soul"
        )!;
      let action = findSoul();
      if (action.kind === "select_pending_to_resolve") {
        expect(action.actingPlayerId).toBe("bob");
        const html = renderToStaticMarkup(
          React.createElement(ActionBar, {
            actions: [action],
            onActionClick: () => {},
            onSkipOptional: () => {},
          })
        );
        expect(html).not.toContain('class="action-btn action-skip"');
        state = applyLegalAction({ state, action, ...opts }).state;
        action = findSoul();
      }
      expect(action).toMatchObject({
        executionMode: "mandatory",
        canSkipDuplicate: true,
        actingPlayerId: "alice",
      });
      expect(
        createActionInputDecisionNode(state, action, opts)?.choices.map(
          (choice) => choice.applyOptions?.skipOptionalEffect
        )
      ).toEqual([false, true]);
      const html = renderToStaticMarkup(
        React.createElement(ActionBar, {
          actions: [action],
          onActionClick: () => {},
          onSkipOptional: () => {},
        })
      );
      expect(html).toContain("スキップ");
      expect(html).not.toContain("発揮しない");
      state = applyLegalAction({
        state,
        action,
        ...opts,
        skipOptionalEffect: true,
      }).state;
      expect(state.stackWindow).toBeNull();
      expect(state.effectUsageRecords).toHaveLength(0);
      expect(state.players[0]?.countValue).toBe(4);
      expect(
        queue(state).filter((i) => i.sourceInstanceId === "rimuru-soul")
      ).toHaveLength(0);
      let remaining = actions(state).find(
        (a) =>
          (a.kind === "resolve_pending_triggered_effect" ||
            a.kind === "select_pending_to_resolve") &&
          a.sourceInstanceId === "rimuru-spirit"
      )!;
      expect(remaining).not.toHaveProperty("canSkipDuplicate");
      if (remaining.kind === "select_pending_to_resolve") {
        state = applyLegalAction({ state, action: remaining, ...opts }).state;
        remaining = actions(state).find(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.sourceInstanceId === "rimuru-spirit"
        )!;
      }
      state = applyLegalAction({ state, action: remaining, ...opts }).state;
      state = applyLegalAction({
        state,
        action: actions(state).find((a) => a.kind === "pass_stack")!,
        ...opts,
      }).state;
      expect(state.players[0]?.countValue).toBe(5);
      expect(
        state.pendingTriggeredEffects.some(
          (p) => p.eventKind === "count_increase"
        )
      ).toBe(activePlayerId === "alice");
    }
  );
  it.each([
    ["hand", "手札"],
    ["trash", "トラッシュ"],
  ] as const)("発揮元が %s ならゾーン名を表示する", (zone, label) => {
    const state = buildNoDuplicateScenario(ALL_CARDS);
    const source = state.cardInstances.find(
      (card) => card.instanceId === "rimuru-spirit"
    )!;
    source.zone = zone;
    const items = buildEffectQueue(
      state,
      opts.getCardDefinitionById,
      (id) =>
        opts.getRegisteredTriggeredEffectActions(id)?.map((registration) => ({
          ...registration,
          sourceZone: zone,
        })),
      "alice"
    );
    expect(
      items.find((item) => item.sourceInstanceId === source.instanceId)
        ?.sourceStateLabel
    ).toBe(label);
  });

  it("離脱待機状態の発揮元はカード種別ではなく待機状態と表示する", () => {
    let state = buildRimuruPendingLeaveScenario(ALL_CARDS);
    expect(queue(state).map((item) => item.sourceStateLabel)).toEqual([
      "待機状態",
    ]);
    state = applyLegalAction({
      state,
      action: actions(state).find((action) => action.kind === "pass_stack")!,
      ...opts,
    }).state;
    expect(state.players[0]?.countValue).toBe(4);
    expect(queue(state)).toHaveLength(0);
  });

  it("消滅待機のリムルは別リムルの召喚を観測せず、召喚された自身もカウントを増やさない", () => {
    const state = buildRimuruPendingLeaveScenario(ALL_CARDS, false);
    expect(state.pendingTriggeredEffects).toHaveLength(0);
    expect(queue(state)).toHaveLength(0);
    expect(state.players[0]?.countValue).toBe(4);
  });

  it.each(["rimuru-soul", "rimuru-spirit"])(
    "%s を発揮すると他方が消え、スピリットだけ後続ドローする",
    (sourceInstanceId) => {
      let state = buildNoDuplicateScenario(ALL_CARDS);
      const before = queue(state).filter(
        (item) => item.definitionId === "BSTS01-CX01"
      );
      expect(before).toHaveLength(2);
      expect(before.map((item) => item.sourceStateLabel).sort()).toEqual([
        "スピリット",
        "魂状態",
      ]);
      const action = actions(state).find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === sourceInstanceId
      )!;
      expect(action).toBeDefined();
      state = applyLegalAction({ state, action, ...opts }).state;
      expect(
        queue(state).filter(
          (item) =>
            item.kind === "triggered" && item.definitionId === "BSTS01-CX01"
        )
      ).toHaveLength(0);
      const pass = actions(state).find((a) => a.kind === "pass_stack")!;
      state = applyLegalAction({ state, action: pass, ...opts }).state;
      expect(state.players[0]?.countValue).toBe(5);
      const draws = actions(state).filter(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.eventKind === "count_increase"
      );
      expect(draws).toHaveLength(sourceInstanceId === "rimuru-spirit" ? 1 : 0);
      expect(
        actions(state).some(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.eventKind === "summon" &&
            a.sourceDefinitionId === "BSTS01-CX01"
        )
      ).toBe(false);
      if (draws[0]) {
        const hand = state.players[0]!.handCount;
        state = applyLegalAction({ state, action: draws[0], ...opts }).state;
        state = applyLegalAction({
          state,
          action: actions(state).find((a) => a.kind === "pass_stack")!,
          ...opts,
        }).state;
        expect(state.players[0]?.handCount).toBe(hand + 1);
      }
      const other = actions(state).find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "summoned"
      )!;
      expect(other).toBeDefined();
      state = applyLegalAction({
        state,
        action: other,
        ...opts,
        skipOptionalEffect: true,
      }).state;
      expect(state.pendingTriggeredEffects).toHaveLength(0);
      expect(
        actions(state).some(
          (a) => a.kind === "resolve_pending_triggered_effect"
        )
      ).toBe(false);
    }
  );
});
