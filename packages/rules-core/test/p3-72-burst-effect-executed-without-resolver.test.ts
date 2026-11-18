/**
 * P3-72 回帰: バースト解決時、`getHandWrittenEffectResolver` 未配線（=サーバの実構成）
 * でも構造化バースト効果 `effects.steps`（召喚を含む）が実行されることを確認する。
 *
 * 修正前: バースト解決路は resolver lookup が presence でないと
 *   executeHandWrittenEffectResolver（→ structured effects fallback）を呼ばず、
 *   召喚ステップがスキップされ finalizeResolvedBurstCard で trash 送りになっていた。
 *   （誘発効果経路は無条件 fallback を持つのに、バースト経路だけ非対称だった。）
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import { matchesCardFilter } from "../src/card/card-filter";
import type { CardDefinition, GameState } from "../src";

const cardMap = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const getCardDefinitionById = (id: string) => cardMap.get(id);

// BSTH01-X07「宵闇を司る妖怪 EXルーミア」:
//   【バースト：自分のライフ減少後】… このカードをコストを支払わずに召喚する。
const X07 = getCardDefinitionById("BSTH01-X07")!;

// サーバ (apps/playground-web/server/game-api.ts) と同一の lookups 構成。
// 意図的に getHandWrittenEffectResolver を渡さない。
const serverLikeLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
};

function passBurstStackWindow(state: GameState): GameState {
  expect(state.window).toBe("stack");
  expect(state.stackWindow?.burstWindowKind).toBeDefined();
  const pass = getLegalActions({
    state,
    actingPlayerId: state.stackWindow!.priorityPlayerId,
    getCardDefinitionById,
    ...serverLikeLookups,
  }).find((a) => a.kind === "pass_stack");
  expect(pass).toBeDefined();
  return applyLegalAction({
    state,
    action: pass!,
    getCardDefinitionById,
    ...serverLikeLookups,
  }).state;
}

function buildScenario(cardNo = "BSTH01-X07"): GameState {
  const x07Burst = createCardInstance(getCardDefinitionById(cardNo)!, {
    instanceId: "x07",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "burst",
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    startingVoidNormalCoreCount: 0,
    playerOverrides: [{ reserveNormalCoreCount: 6 }],
  });
  return {
    ...base,
    // bob のアタックステップ中に alice のライフが減った直後を想定。
    activePlayerId: "bob",
    step: "attack",
    cardInstances: [x07Burst],
    setBurstStates: [{ playerId: "alice", cardInstanceId: "x07" }],
    pendingBurstChecks: [
      {
        checkId: "c1",
        actingPlayerId: "alice",
        eventKind: "reduce_life",
        event: { family: "life", validationMode: "snapshot_only" },
        source: "action_resolution",
        chainId: "test:p3-72-burst-effect-executed-without-resolver:83",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: null,
        amount: 1,
        step: "attack",
        window: "flash_before_block",
        resolvedBurstCardInstanceIds: [],
      },
    ],
  };
}

describe("P3-72: バースト効果は resolver 未配線でも実行される", () => {
  it.each([
    "BSTH01-X07",
    "BSTH01-M13",
    "BSTH04-R01",
    "BSTH09-M01",
    "BSLH01-X10",
  ])(
    "%s: バースト自身召喚は維持コアの選択を待ち、確定後に再開する",
    (cardNo) => {
      const state = buildScenario(cardNo);
      const actions = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById,
        ...serverLikeLookups,
      });
      const resolve = actions.find(
        (a) => a.kind === "resolve_pending_burst_check"
      );
      expect(resolve).toBeDefined();

      const afterDeclaration = applyLegalAction({
        state,
        action: resolve!,
        getCardDefinitionById,
        ...serverLikeLookups,
      }).state;
      expect(afterDeclaration.stackWindow?.burstWindowKind).toBe("activation");
      const afterActivationPass = passBurstStackWindow(afterDeclaration);
      expect(afterActivationPass.stackWindow?.burstWindowKind).toBe(
        "effect_declaration"
      );
      let after = passBurstStackWindow(afterActivationPass);
      if (after.pendingStepChoice) {
        const summonChoice = getLegalActions({
          state: after,
          actingPlayerId: "alice",
          getCardDefinitionById,
          ...serverLikeLookups,
        }).find(
          (a) => a.kind === "resolve_pending_step_choice" && a.choiceIndex === 0
        );
        expect(summonChoice).toBeDefined();
        after = applyLegalAction({
          state: after,
          action: summonChoice!,
          getCardDefinitionById,
          ...serverLikeLookups,
        }).state;
      }

      const x07After = after.cardInstances.find((c) => c.instanceId === "x07")!;
      // コストなしでも維持コアは所有者が選ぶ。自動配置でHUDを飛ばさない。
      expect(after.pendingMultiPlacement).toMatchObject({
        actingPlayerId: "alice",
        targets: [{ instanceId: "x07", minimumCoreCount: 1 }],
      });
      expect(x07After.normalCoreCount).toBe(0);
      // 召喚ステップが実行され field に出る。
      expect(x07After.zone).toBe("field");
      expect(x07After.zone).not.toBe("trash");
      // バーストチェックは解決済み。
      expect(after.pendingBurstChecks).toHaveLength(0);
      const placement = getLegalActions({
        state: after,
        actingPlayerId: "alice",
        getCardDefinitionById,
        ...serverLikeLookups,
      }).find((a) => a.kind === "resolve_pending_multi_placement");
      expect(placement).toBeDefined();
      let completed = applyLegalAction({
        state: after,
        action: placement!,
        multiPlacementAllocations: [
          {
            destinationInstanceId: "x07",
            placements: [{ kind: "reserve_normal", amount: 2 }],
          },
        ],
        getCardDefinitionById,
        ...serverLikeLookups,
      }).state;
      expect(completed.pendingMultiPlacement).toBeNull();
      expect(
        completed.cardInstances.find((c) => c.instanceId === "x07")
      ).toMatchObject({
        zone: "field",
        normalCoreCount: 2,
      });
      expect(
        completed.players.find((p) => p.id === "alice")!.reserveNormalCoreCount
      ).toBe(4);
      if (completed.pendingStepOptionalChoice) {
        const skip = getLegalActions({
          state: completed,
          actingPlayerId: "alice",
          getCardDefinitionById,
          ...serverLikeLookups,
        }).find((a) => a.kind === "resolve_pending_step_optional_choice");
        expect(skip).toBeDefined();
        completed = applyLegalAction({
          state: completed,
          action: skip!,
          skipOptionalEffect: true,
          getCardDefinitionById,
          ...serverLikeLookups,
        }).state;
      }
      expect(completed.revealedBurstStates).toHaveLength(0);
    }
  );

  it("創界神/導界者ネクサスの全コアをボイドへ移し、通常ネクサスは候補外にする", () => {
    const burst = X07.effects!.find((e) => e.timing.kind === "burst")!;
    const stripStep = burst.steps[0]!.action;
    if (
      stripStep.kind !== "core_move" ||
      stripStep.from.kind !== "field_card"
    ) {
      throw new Error("expected core_move from field_card");
    }
    const filter = stripStep.from.filter;
    const grandwalkerCard: CardDefinition = {
      cardNo: "TEST-X07-GRANDWALKER",
      orikaId: 997200,
      orikaIndex: 997200,
      name: "テスト創界神",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      tribe: "創界神",
      image: "",
      rarity: "C",
      pack: "",
      maxDeckCount: 0,
      sourceUrls: [],
      sourceConfidence: "C",
      grandwalkerData: { kind: "grandwalker" },
      effects: [],
    };
    const guidedCard: CardDefinition = {
      cardNo: "TEST-X07-GUIDED",
      orikaId: 997201,
      orikaIndex: 997201,
      name: "テスト導界者",
      printedCategory: "nexus",
      colors: ["blue"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      tribe: "導界者・起幻",
      image: "",
      rarity: "C",
      pack: "",
      maxDeckCount: 0,
      sourceUrls: [],
      sourceConfidence: "C",
      grandwalkerData: { kind: "guided" },
      effects: [],
    };
    const plainNexusCard: CardDefinition = {
      cardNo: "TEST-X07-PLAIN-NEXUS",
      orikaId: 997202,
      orikaIndex: 997202,
      name: "テスト通常ネクサス",
      printedCategory: "nexus",
      colors: ["yellow"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      tribe: "幻想",
      image: "",
      rarity: "C",
      pack: "",
      maxDeckCount: 0,
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    cardMap.set(grandwalkerCard.cardNo, grandwalkerCard);
    cardMap.set(guidedCard.cardNo, guidedCard);
    cardMap.set(plainNexusCard.cardNo, plainNexusCard);

    const x07Burst = createCardInstance(X07, {
      instanceId: "x07",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "burst",
    });
    const grandwalker = createCardInstance(grandwalkerCard, {
      instanceId: "gw",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const guided = createCardInstance(guidedCard, {
      instanceId: "gd",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 4,
    });
    const plainNexus = createCardInstance(plainNexusCard, {
      instanceId: "nex",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 5,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        startingVoidNormalCoreCount: 0,
      }),
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [x07Burst, grandwalker, guided, plainNexus],
    };

    expect(
      matchesCardFilter(grandwalker, grandwalkerCard, filter, { state })
    ).toBe(true);
    expect(matchesCardFilter(guided, guidedCard, filter, { state })).toBe(true);
    expect(
      matchesCardFilter(plainNexus, plainNexusCard, filter, { state })
    ).toBe(false);

    const guidedOnlyState: GameState = {
      ...state,
      cardInstances: [x07Burst, guided, plainNexus],
    };
    const after = executeEffect({
      chainId: "test:p3-72-burst-effect-executed-without-resolver:343",
      state: guidedOnlyState,
      effect: burst,
      sourceInstanceId: "x07",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "gd")!.normalCoreCount
    ).toBe(0);
    expect(
      after.cardInstances.find((c) => c.instanceId === "nex")!.normalCoreCount
    ).toBe(5);
    expect(after.players.find((p) => p.id === "bob")!.voidNormalCoreCount).toBe(
      4
    );
    expect(after.cardInstances.find((c) => c.instanceId === "x07")!.zone).toBe(
      "field"
    );
  });
});
