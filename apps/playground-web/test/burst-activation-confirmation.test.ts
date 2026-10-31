import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  moveCardZone,
  previewBurstEffectSuppression,
  recomputeAndRebuildContinuousEffects,
  sanitizeStateForViewer,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import { buildBurstConfirmationScenario } from "../src/scenario-burst-confirmation";
import {
  buildEffectQueue,
  isAutomaticEffectQueueDrain,
} from "../src/components/EffectQueueOverlay";

const cards = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const definitions = new Map(cards.map((card) => [card.cardNo, card]));
const getCardDefinitionById = (id: string) => definitions.get(id);
const lookups = {
  getCardDefinitionById,
  getRegisteredBurstActions: buildBurstEffectLookup(cards),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(cards),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
  getRegisteredMagicActions: buildMagicLookup(cards),
};
const scene = (mode: string) =>
  buildBurstConfirmationScenario(cards, new URLSearchParams({ mode }));
const actions = (state: GameState, player = "alice") =>
  getLegalActions({ state, actingPlayerId: player, ...lookups });
function preview(state: GameState) {
  const action = actions(state).find(
    (action) => action.kind === "resolve_pending_burst_check"
  )!;
  expect(action).toBeDefined();
  if (action.kind !== "resolve_pending_burst_check")
    throw new Error("Missing burst");
  return previewBurstEffectSuppression({ state, action, ...lookups });
}
function act(state: GameState, player: string, kind: LegalAction["kind"]) {
  const action = actions(state, player).find((action) => action.kind === kind)!;
  expect(action).toBeDefined();
  return applyLegalAction({ state, action, ...lookups }).state;
}

describe("バースト発動前の表示用確認", () => {
  it.each(["nullify", "cannot", "nullify-bypass"])(
    "%s: 抑止元を示し、確認だけでは状態を変更しない",
    (mode) => {
      const state = scene(mode);
      const before = structuredClone(state);
      expect(preview(state)?.sources).toMatchObject([
        { sourceInstanceId: "suppressor" },
      ]);
      expect(state).toEqual(before);
      expect(
        preview(sanitizeStateForViewer(state, "alice"))?.sources
      ).toHaveLength(1);
    }
  );
  it.each(["normal", "immune", "bypass"])(
    "%s: 抑止なし・発動中耐性・発揮できない無視は確認不要",
    (mode) => {
      const state = scene(mode);
      const before = structuredClone(state);
      expect(preview(state)).toBeNull();
      expect(state).toEqual(before);
    }
  );
  it("発動禁止はキュー非表示、選べない確認だけを自動整理する", () => {
    const state = scene("forbidden");
    const legal = actions(state);
    expect(legal.some((a) => a.kind === "resolve_pending_burst_check")).toBe(
      false
    );
    const queue = buildEffectQueue(
      state,
      getCardDefinitionById,
      lookups.getRegisteredTriggeredEffectActions,
      "alice",
      legal
    );
    expect(queue).toEqual([]);
    const decline = legal.find(
      (a) => a.kind === "decline_pending_burst_check"
    )!;
    expect(isAutomaticEffectQueueDrain(decline, queue)).toBe(true);
    const after = applyLegalAction({
      state,
      action: decline,
      ...lookups,
    }).state;
    expect(after.pendingBurstChecks).toEqual([]);
    expect(
      after.cardInstances.find((c) => c.instanceId === "burst")?.zone
    ).toBe("burst");
  });
  it("通常の辞退は自動整理せず選択を残す", () => {
    const state = scene("nullify");
    const legal = actions(state);
    const queue = buildEffectQueue(
      state,
      getCardDefinitionById,
      lookups.getRegisteredTriggeredEffectActions,
      "alice",
      legal
    );
    expect(queue).toHaveLength(1);
    expect(
      isAutomaticEffectQueueDrain(
        legal.find((a) => a.kind === "decline_pending_burst_check")!,
        queue
      )
    ).toBe(false);
  });
  it("対象外フィルター・タイミング外・自分の抑止は確認理由にしない", () => {
    const state = scene("nullify");
    const source = state.activeContinuousEffects[0]!;
    for (const ce of [
      {
        ...source,
        metadata: {
          ...source.metadata,
          targetFilter: { colors: ["red" as const] },
        },
      },
      {
        ...source,
        timingScope: { player: "self" as const, period: "attack" as const },
      },
      { ...source, actingPlayerId: "alice" },
    ]) {
      expect(preview({ ...state, activeContinuousEffects: [ce] })).toBeNull();
    }
  });
  it("複数の抑止元はすべて表示に渡し、無関係な効果を含めない", () => {
    const state = scene("nullify");
    const source = state.activeContinuousEffects[0]!;
    state.activeContinuousEffects.push({
      ...source,
      effectId: "second",
      sourceInstanceId: "second-source",
    });
    const warning = preview(state);
    expect(warning?.sources.map((ce) => ce.sourceInstanceId)).toEqual([
      "suppressor",
      "second-source",
    ]);
  });
  it("無効化が残れば、発動後にコア追加・召喚を行わずトラッシュへ置く", () => {
    let state = scene("nullify");
    const before = structuredClone(state.players);
    expect(preview(state)).not.toBeNull();
    state = act(state, "alice", "resolve_pending_burst_check");
    state = act(state, "bob", "pass_stack");
    state = act(state, "bob", "pass_stack");
    expect(
      state.cardInstances.find((c) => c.instanceId === "burst")?.zone
    ).toBe("trash");
    expect(state.players).toEqual(before);
    expect(
      state.log.some((line) => line.startsWith("burst:effect-suppressed:"))
    ).toBe(true);
  });
  it.each(["activation", "effect_declaration"])(
    "%s窓で常時抑止元が離れたら、過去の確認に束縛されず発揮する",
    (stage) => {
      let state = scene("continuous");
      expect(preview(state)?.sources).toMatchObject([
        { sourceDefinitionId: "BSTH09.2-転醒R03(B)" },
      ]);
      state = act(state, "alice", "resolve_pending_burst_check");
      if (stage === "effect_declaration")
        state = act(state, "bob", "pass_stack");
      // 応答による離脱を共通ゾーン移動で再現。以後は通常の発動・発揮窓を通す。
      state = recomputeAndRebuildContinuousEffects(
        moveCardZone(state, "suppressor", "trash"),
        getCardDefinitionById
      );
      while (state.stackWindow)
        state = act(state, state.stackWindow.priorityPlayerId, "pass_stack");
      expect(
        state.cardInstances.find((c) => c.instanceId === "burst")?.zone
      ).toBe("field");
      expect(
        state.log.some((line) => line.startsWith("burst:effect-suppressed:"))
      ).toBe(false);
      expect(state.pendingBurstChecks).toEqual([]);
    }
  );
});
