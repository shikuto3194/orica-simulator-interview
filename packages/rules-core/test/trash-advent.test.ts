/**
 * トラッシュのカードを煌臨元にする許可 (BSAZ01-C01/C02)。
 *
 * ルール正源: manual/ai-reference/10_rules/08a_advent-rebirth-contract.md §1 手順1
 *   手札のスレイプニールを上に重ね、トラッシュのC01/C02は下の煌臨元になる。
 *   〔ターンに1回:同名〕で同じプレイヤーの同名カードの許可を共有する。
 *   「このとき、煌臨するカードにフィールド/リザーブのコアを好きなだけ置く」=
 *   chargeCoresOnAdvent (08a:180 と同じ buildChargeCoresPendingCoreDistribution)。
 *
 * 表現:
 *   CardDefinition.trashAdventHostGrant + chargeCoresOnAdvent:true。
 *   手札カードの通常の煌臨タイミング/ソウルコア支払いを保持する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";
import { adventSourceIdsOf } from "../src/model";
import { getAdventTargets } from "../src/mechanics/advent-system";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
};

/**
 * ALICE の手札に煌臨する「スレイプニール」、トラッシュに煌臨元を置く。
 * ソウルコアはリザーブに置き、リザーブ通常コアも用意する。
 */
function buildState(adventNo: string, fieldTargetNo: string): GameState {
  // 重ね先: トラッシュのC01/C02。
  const target = createCardInstance(card(fieldTargetNo), {
    instanceId: "target-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "trash",
    normalCoreCount: 0,
  });
  // 煌臨するカード: 手札のX01。
  const advent = createCardInstance(card(adventNo), {
    instanceId: "advent-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
    normalCoreCount: 0,
  });
  // コア source 用の別フィールドスピリット
  const source = createCardInstance(card("BSAZ01-C16"), {
    instanceId: "source-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 3,
  });
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [
      {
        handCount: 1,
        soulCoreLocation: { kind: "reserve" },
        reserveNormalCoreCount: 2,
        countValue: 0,
      },
      {},
    ],
  });
  return {
    ...base,
    activePlayerId: BOB,
    step: "attack",
    window: "flash_before_block",
    activeAttack: {
      attackId: "trash-host-attack",
      primaryEntityId: "attacker-entity",
      participantEntityIds: ["attacker-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: ALICE },
      blockAssignments: [
        { participantEntityId: "attacker-entity", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["attacker-entity"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: ALICE,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: ALICE,
        pendingStackAction: null,
      },
    },
    battleEntities: [
      {
        entityId: "attacker-entity",
        memberInstanceIds: ["attacker-1"],
        resolvedBp: 1000,
        resolvedSymbols: ["yellow"],
        attackState: "attacking",
      },
    ],
    cardInstances: [
      target,
      advent,
      source,
      createCardInstance(card("BSAZ01-C01"), {
        instanceId: "attacker-1",
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "exhausted",
      }),
    ],
  };
}

function getCard(state: GameState, id: string) {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}
function getPlayer(state: GameState, id: string) {
  return state.players.find((p) => p.id === id)!;
}

/**
 * P3-112: declare_advent は今やスタック窓を開く（apply 即時解決ではない）。
 * responder のパスで窓を閉じ、deferred 解決（ソウルコア消費＋重ね＋使用制限記録）まで進める。
 */
function passStackUntilClosed(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (
    (current.stackWindow ||
      current.activeAttack?.flashWindowState?.pendingStackAction) &&
    guard++ < 10
  ) {
    const responderId =
      current.stackWindow?.priorityPlayerId ??
      current.activeAttack!.flashWindowState!.priorityPlayerId;
    const pass = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById,
      ...effectLookups,
    }).find((a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash");
    if (!pass) {
      throw new Error(`pass_stack for ${responderId} not found`);
    }
    current = applyLegalAction({
      state: current,
      action: pass,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
  }
  if (current.pendingEffectTargetSelection) {
    const actingPlayerId = current.pendingEffectTargetSelection.actingPlayerId;
    const resolveTarget = getLegalActions({
      state: current,
      actingPlayerId,
      getCardDefinitionById,
      ...effectLookups,
    }).find(
      (
        a
      ): a is Extract<LegalAction, { kind: "resolve_pending_effect_target" }> =>
        a.kind === "resolve_pending_effect_target"
    );
    if (!resolveTarget) {
      throw new Error(
        "resolve_pending_effect_target not found after advent stack"
      );
    }
    current = applyLegalAction({
      state: current,
      action: resolveTarget,
      targetInstanceIds: ["target-1"],
      getCardDefinitionById,
      ...effectLookups,
    }).state;
  }
  return current;
}

function findTrashAdventDeclaration(
  state: GameState
): Extract<LegalAction, { kind: "declare_advent" }> {
  const actions = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    ...effectLookups,
  });
  const decl = actions.find(
    (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
      a.kind === "declare_advent" &&
      a.sourceInstanceId === "advent-1" &&
      a.candidateTargetInstanceIds.includes("target-1")
  );
  if (!decl)
    throw new Error("hand advent declaration onto trash host not found");
  return decl;
}

describe.each([
  ["BSAZ01-X01", "BSAZ01-C01"],
  ["BSAZ01-X01", "BSAZ01-C02"],
])(
  "手札 %s の下へトラッシュ %s を重ねる (08a §1 手順1)",
  (adventNo, fieldTargetNo) => {
    it("手札からトラッシュのカードへ煌臨し、ソウルコアを消費して場へ重なる", () => {
      const state = buildState(adventNo, fieldTargetNo);
      const decl = findTrashAdventDeclaration(state);
      expect(decl.adventSourceZone).toBe("hand");
      expect(
        card(fieldTargetNo).trashAdventHostGrant?.chargeCoresOnAdvent
      ).toBe(true);
      expect(
        getLegalActions({
          state: {
            ...state,
            activePlayerId: ALICE,
            step: "main",
            window: "none",
            activeAttack: null,
          },
          actingPlayerId: ALICE,
          getCardDefinitionById,
          ...effectLookups,
        }).some((action) => action.kind === "declare_advent")
      ).toBe(false);

      const result = applyLegalAction({
        state,
        action: decl,
        targetInstanceIds: ["target-1"],
        getCardDefinitionById,
        ...effectLookups,
      });
      const newState = passStackUntilClosed(result.state);

      // 手札のX01が上、トラッシュのtarget-1が下の煌臨元。
      const adv = getCard(newState, "advent-1");
      expect(adv.zone).toBe("field");
      expect(adventSourceIdsOf(adv)).toContain("target-1");
      expect(getCard(newState, "target-1").zone).toBe("field");
      // ソウルコアが消費されている (reserve → soulCoreDest:"trash")
      expect(getPlayer(newState, ALICE).soulCoreLocation).not.toEqual({
        kind: "reserve",
      });
      // 〔ターンに1回:同名〕記録が立つ
      expect(newState.usedTrashAdventKeysThisTurn).toContain(
        ALICE + ":" + card(fieldTargetNo).name
      );
    });

    it("chargeCoresOnAdvent で任意コア配置 pending(any_movable) が生成される", () => {
      const state = buildState(adventNo, fieldTargetNo);
      const decl = findTrashAdventDeclaration(state);
      const result = applyLegalAction({
        state,
        action: decl,
        targetInstanceIds: ["target-1"],
        getCardDefinitionById,
        ...effectLookups,
      });
      const newState = passStackUntilClosed(result.state);

      const pending = newState.pendingCoreDistribution;
      expect(pending).not.toBeNull();
      expect(pending!.fromKind).toBe("any_movable");
      expect(pending!.actingPlayerId).toBe(ALICE);
      // 配置先は煌臨スピリット (advent-1) のみ
      expect(pending!.candidates.map((c) => c.instanceId)).toEqual([
        "advent-1",
      ]);
      // ソース: リザーブ(2) + source-1(3)。トラッシュの煌臨元にはコアが無い。
      expect(pending!.sourceAvailable?.["reserve"]).toBe(2);
      expect(pending!.sourceAvailable?.["field:source-1"]).toBe(3);
      // 任意 = 最小0
      expect(pending!.minTotal ?? 0).toBe(0);

      // C01/C02 原文の「フィールド/リザーブのコアを好きなだけ置く」を
      // pending の生成で終わらせず、両方の供給元から選んだコアが実際に
      // 煌臨カードへ移る最終盤面まで確認する。
      const resolve = getLegalActions({
        state: newState,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        ...effectLookups,
      }).find(
        (
          action
        ): action is Extract<
          LegalAction,
          { kind: "resolve_pending_core_distribution" }
        > => action.kind === "resolve_pending_core_distribution"
      );
      expect(resolve).toBeDefined();
      const resolved = applyLegalAction({
        state: newState,
        action: resolve!,
        coreDistributionAllocations: { "advent-1": 3 },
        coreDistributionSourceAllocations: {
          reserve: 2,
          "field:source-1": 1,
        },
        getCardDefinitionById,
        ...effectLookups,
      }).state;
      expect(resolved.pendingCoreDistribution).toBeNull();
      expect(getCard(resolved, "advent-1").normalCoreCount).toBe(3);
      expect(getPlayer(resolved, ALICE).reserveNormalCoreCount).toBe(0);
      expect(getCard(resolved, "source-1").normalCoreCount).toBe(2);
    });

    it("同名はこのターン2回目を宣言できない (〔ターンに1回:同名〕)", () => {
      const state = buildState(adventNo, fieldTargetNo);
      const decl = findTrashAdventDeclaration(state);
      const declared = applyLegalAction({
        state,
        action: decl,
        targetInstanceIds: ["target-1"],
        getCardDefinitionById,
        ...effectLookups,
      }).state;
      // P3-112: 窓を閉じて deferred 解決 (usedTrashAdventKeysThisTurn 記録含む) まで進めてから
      // 2回目の宣言を試みる (窓を開けたままだと stackWindow!==null の別ガードで偽陽性になる)。
      const afterFirst = passStackUntilClosed(declared);

      // 2回目に向けて再びトラッシュへ同名カードを戻し、煌臨先も用意する。
      const secondAdvent = createCardInstance(card(adventNo), {
        instanceId: "advent-2",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
        normalCoreCount: 0,
      });
      const secondTarget = createCardInstance(card(fieldTargetNo), {
        instanceId: "target-2",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "trash",
        normalCoreCount: 0,
      });
      const replenished: GameState = {
        ...afterFirst,
        pendingCoreDistribution: null,
        cardInstances: [
          ...afterFirst.cardInstances,
          secondAdvent,
          secondTarget,
        ],
        players: afterFirst.players.map((p) =>
          p.id === ALICE ? { ...p, soulCoreLocation: { kind: "reserve" } } : p
        ),
      };

      // 任意コア配置や召喚時誘発の待機による偽陽性を避け、煌臨元候補そのものを比較する。
      const candidates = (candidateState: GameState) =>
        getAdventTargets(
          candidateState,
          ALICE,
          card(adventNo).adventData!,
          getCardDefinitionById,
          card(adventNo)
        ).map((candidate) => candidate.instanceId);
      expect(candidates(replenished)).not.toContain("target-2");
      expect(
        candidates({ ...replenished, usedTrashAdventKeysThisTurn: [] })
      ).toContain("target-2");
    });
  }
);
