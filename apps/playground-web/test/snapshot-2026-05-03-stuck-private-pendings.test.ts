/**
 * 2026-05-03 snapshot 詰み再現と回帰テスト:
 *
 * 同名カード 2 枚 (M01 パチュリー) が start-step に private 誘発し、
 * 両方を declare → 一方を select_pending_to_resolve した状態。
 * - 旧挙動: BattleScreen の auto-fire useEffect が `pendingTriggeredEffects.length !== 1`
 *   で早期 return → selected pending に対応する resolve ボタンが画面から消失して進行不能。
 * - 修正後: auto-fire は selectedByTurnPlayer=true の pending を pick して発火する。
 *
 * 同時にエンジン側の usageLimit 伝搬修正により M01 ケースでは
 * そもそも 2 件 declare まで進まない (queue 段階で 1 件に絞られる)。
 * 本テストでは GUI 側のフェイルセーフを担保するため、別カードで
 * 「複数 private declared pending + 一件 selected」状態を構築して検証する。
 */

import { describe, expect, it } from "vitest";
import {
  type CardDefinition,
  type GameState,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  buildTriggeredEffectLookup,
} from "@orica/rules-core";

function makePrivateTriggerDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `private trigger ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "phase", step: "start", subPhase: "start" },
        applicability: { zone: "hand" },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };
}

function buildTwoDeclaredState(): {
  state: GameState;
  defs: CardDefinition[];
} {
  const def1 = makePrivateTriggerDef("PRIV-1");
  const def2 = makePrivateTriggerDef("PRIV-2");
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(def1, {
        instanceId: "card-priv-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(def2, {
        instanceId: "card-priv-2",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
  });
  return {
    defs: [def1, def2],
    state: {
      ...base,
      activePlayerId: "alice",
      step: "start",
      window: "none",
      pendingTriggeredEffects: [
        {
          pendingId: "trigger:declared:0",
          actingPlayerId: "alice",
          eventKind: "start_step",
          source: "step_transition",
          chainId: "test:snapshot-2026-05-03-stuck-private-pendings:80",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: null,
          step: "start",
          window: "none",
          resolvedSourceInstanceIds: ["card-priv-1"],
          declaredFromPrivateZone: true,
          declaredSourceInstanceId: "card-priv-1",
          declaredSourceDefinitionId: "PRIV-1",
          declaredSourceKind: "spirit",
          declaredRegistrationIndex: 0,
        },
        {
          pendingId: "trigger:declared:1",
          actingPlayerId: "alice",
          eventKind: "start_step",
          source: "step_transition",
          chainId: "test:snapshot-2026-05-03-stuck-private-pendings:99",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: null,
          step: "start",
          window: "none",
          resolvedSourceInstanceIds: ["card-priv-2"],
          declaredFromPrivateZone: true,
          declaredSourceInstanceId: "card-priv-2",
          declaredSourceDefinitionId: "PRIV-2",
          declaredSourceKind: "spirit",
          declaredRegistrationIndex: 0,
          selectedByTurnPlayer: true,
        },
      ],
    },
  };
}

describe("2026-05-03 詰み: 複数 private declared pending + 一件 selected", () => {
  it("getLegalActions は selected な pending の resolve action を 1 件返す", () => {
    const { state, defs } = buildTwoDeclaredState();
    const getDefinition = (id: string) =>
      defs.find((definition) => definition.cardNo === id);
    const getRegisteredTriggeredEffectActions =
      buildTriggeredEffectLookup(defs);

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions,
    });

    const resolveActions = actions.filter(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    expect(resolveActions).toHaveLength(1);
    expect(resolveActions[0]).toMatchObject({
      kind: "resolve_pending_triggered_effect",
      pendingId: "trigger:declared:1",
      sourceInstanceId: "card-priv-2",
    });
  });

  it("auto-fire 選択ロジック (BattleScreen) は selected な pending を pick する", () => {
    // BattleScreen.tsx auto-fire useEffect の「対象 pending を選ぶ」式を再現:
    // - length === 1 → その 1 件
    // - length >= 2 → selectedByTurnPlayer === true の pending
    const { state } = buildTwoDeclaredState();
    expect(state.pendingTriggeredEffects.length).toBe(2);

    const pickedPending =
      state.pendingTriggeredEffects.length === 1
        ? state.pendingTriggeredEffects[0]
        : (state.pendingTriggeredEffects.find(
            (p) => p.selectedByTurnPlayer === true
          ) ?? null);

    expect(pickedPending).not.toBeNull();
    expect(pickedPending?.pendingId).toBe("trigger:declared:1");
    expect(pickedPending?.declaredFromPrivateZone).toBe(true);
  });

  it("auto-fire 選択は legal action 1 件と一意マッチする", () => {
    const { state, defs } = buildTwoDeclaredState();
    const getDefinition = (id: string) =>
      defs.find((definition) => definition.cardNo === id);
    const getRegisteredTriggeredEffectActions =
      buildTriggeredEffectLookup(defs);

    const pickedPending = state.pendingTriggeredEffects.find(
      (p) => p.selectedByTurnPlayer === true
    );
    expect(pickedPending).toBeDefined();

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions,
    });
    const matching = actions.filter(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        "pendingId" in a &&
        (a as { pendingId?: string }).pendingId === pickedPending!.pendingId &&
        (!("choiceIndex" in a) ||
          (a as { choiceIndex?: number }).choiceIndex === undefined)
    );
    expect(matching).toHaveLength(1);
  });
});
