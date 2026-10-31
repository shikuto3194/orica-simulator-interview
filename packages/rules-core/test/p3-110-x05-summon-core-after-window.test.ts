/**
 * P3-110: 即時型効果召喚（咲夜 BSTH01-X05）の維持コア配置は発揮応答スタック窓の後。
 *
 * 裁定 2026-06-21: 「召喚することで〜」型の内包召喚は「解決中」に属し、発揮応答窓の後に
 * 維持コアを配置する。正しい順序 = 宣言 → 発揮応答窓 → 窓クローズ → 解決（コスト→維持コア→無効化）。
 *
 * 本テストは GUI と同じく「発揮宣言時に summonPaymentSources のみ渡し、維持コアは渡さない」
 * ペイロードで resolve し、維持コアが**窓クローズ後**に pendingMultiPlacement として要求される
 * （= 発揮宣言時／窓前ではない）ことを assert する。旧バグ（維持コアが窓より前）の回帰ガード。
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
  getLegalActions,
} from "../src";
import type { ActiveAttack, CardDefinition, GameState } from "../src";

const 咲夜 = ALL_CARDS.find((c) => c.cardNo === "BSTH01-X05")!;
const bobFlash = ALL_CARDS.find((c) => c.cardNo === "BSTH05-R02")!;
const lastJudgment = ALL_CARDS.find((c) => c.cardNo === "BSTH04-C11")!;

const aliceAttackerDef: CardDefinition = {
  cardNo: "P3-110-ATTACKER",
  name: "P3-110 アタッカー",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const defs = [咲夜, bobFlash, lastJudgment, aliceAttackerDef];
const defMap = new Map(defs.map((d) => [d.cardNo, d]));
const lookups = {
  getCardDefinitionById: (id: string) => defMap.get(id),
  getRegisteredMagicActions: buildMagicLookup(defs),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(defs),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  getRegisteredBurstActions: buildBurstEffectLookup(defs),
};

function buildState(flashDefinition = bobFlash, opponentCount = 0): GameState {
  const attacker = createCardInstance(aliceAttackerDef, {
    instanceId: "alice-attacker",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
    exhaustState: "recovered",
  });
  const sakuya = createCardInstance(咲夜, {
    instanceId: "sakuya-1",
    ownerPlayerId: "alice",
    zone: "hand",
  });
  const flash = createCardInstance(flashDefinition, {
    instanceId: "bob-flash-1",
    ownerPlayerId: "bob",
    zone: "hand",
  });
  const activeAttack: ActiveAttack = {
    attackId: "atk-1",
    primaryEntityId: "e-attacker",
    participantEntityIds: ["e-attacker"],
    groupMode: "single",
    target: { kind: "player", playerId: "bob" },
    blockAssignments: [],
    symbolResolutionOrder: [],
    flashBeforeBlockCompleted: false,
    flashAfterBlockCompleted: false,
    flashWindowState: {
      kind: "before_block",
      priorityPlayerId: "bob",
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: "bob",
      pendingStackAction: null,
    },
  };
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [attacker, sakuya, flash],
    activeAttack,
    battleEntities: [
      {
        entityId: "e-attacker",
        memberInstanceIds: ["alice-attacker"],
        resolvedBp: 5000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    playerOverrides: [
      { id: "alice", reserveNormalCoreCount: 4 },
      { id: "bob", reserveNormalCoreCount: 8, countValue: opponentCount },
    ],
  });
  return {
    ...base,
    step: "attack",
    activePlayerId: "alice",
    window: "flash_before_block",
  };
}

describe("P3-110 咲夜: 維持コアは発揮応答窓クローズ後に要求される", () => {
  it.each([
    { flashDefinition: bobFlash, opponentCount: 0 },
    { flashDefinition: lastJudgment, opponentCount: 1 },
    { flashDefinition: lastJudgment, opponentCount: 2 },
  ])(
    "$flashDefinition.cardNo / カウント$opponentCount: 発揮宣言 → 窓後の維持コア配置 → 召喚+発揮前無効化（公式Q1481）",
    ({ flashDefinition, opponentCount }) => {
      const state = buildState(flashDefinition, opponentCount);

      // 1. bob がフラッシュ使用。
      const useFlash = getLegalActions({
        state,
        actingPlayerId: "bob",
        ...lookups,
      }).find(
        (a) => a.kind === "use_magic" && a.sourceInstanceId === "bob-flash-1"
      );
      let cur = applyLegalAction({
        state,
        action: useFlash!,
        paymentSources: [{ kind: "reserve", amount: 4 }],
        ...lookups,
      }).state;

      // 2. 窓クローズまで進める。咲夜 resolve には summonPaymentSources のみ渡し、
      //    summonEnterFieldCorePlacements は渡さない（GUI 修正後の発揮宣言ペイロード）。
      const passKinds = [
        "declare_private_triggered_effect",
        "resolve_pending_triggered_effect",
        "pass_battle_flash",
        "pass_stack",
        "pass_pre_declaration_stack",
      ];
      let sawWindowBeforePlacement = false;
      let placementPendingSeen = false;

      for (let i = 0; i < 30; i++) {
        const sakuya = cur.cardInstances.find(
          (c) => c.instanceId === "sakuya-1"
        );
        if (sakuya?.zone === "field" && cur.pendingMultiPlacement === null)
          break;

        // 維持コア要求 (pendingMultiPlacement) が立ったら配置する。
        if (cur.pendingMultiPlacement !== null) {
          placementPendingSeen = true;
          // 旧バグ回帰ガード: この時点でフラッシュ応答スタック窓は既に閉じている。
          // （維持コアが窓より前に来ていない）
          expect(cur.stackWindow).toBeNull();
          const resolveMp = getLegalActions({
            state: cur,
            actingPlayerId: "alice",
            ...lookups,
          }).find((a) => a.kind === "resolve_pending_multi_placement");
          expect(resolveMp).toBeDefined();
          cur = applyLegalAction({
            state: cur,
            action: resolveMp!,
            multiPlacementAllocations: [
              {
                destinationInstanceId: "sakuya-1",
                placements: [{ kind: "reserve_normal", amount: 1 }],
              },
            ],
            ...lookups,
          }).state;
          continue;
        }

        let advanced = false;
        for (const pid of ["alice", "bob"]) {
          const acts = getLegalActions({
            state: cur,
            actingPlayerId: pid,
            ...lookups,
          }).filter((a) => a.can);
          let next;
          for (const k of passKinds) {
            next = acts.find((a) => a.kind === k);
            if (next) break;
          }
          if (next) {
            // 発揮宣言時には維持コアを渡さず、payment のみ（GUI 修正後の挙動）。
            const freePayload =
              next.kind === "resolve_pending_triggered_effect"
                ? { summonPaymentSources: [] }
                : {};
            // declare の時点でフラッシュ窓がまだ閉じていない（窓前）ことを記録。
            if (next.kind === "declare_private_triggered_effect") {
              sawWindowBeforePlacement = cur.pendingMultiPlacement === null;
            }
            cur = applyLegalAction({
              state: cur,
              action: next,
              ...freePayload,
              ...lookups,
            }).state;
            advanced = true;
            break;
          }
        }
        if (!advanced) break;
      }

      // 維持コアが pendingMultiPlacement 経由で（窓後に）要求されたこと。
      expect(sawWindowBeforePlacement).toBe(true);
      expect(placementPendingSeen).toBe(true);

      // 咲夜は場入りし、維持コア 1 個が乗っている。
      const sakuyaAfter = cur.cardInstances.find(
        (c) => c.instanceId === "sakuya-1"
      );
      expect(sakuyaAfter?.zone).toBe("field");
      expect(sakuyaAfter?.normalCoreCount).toBe(1);

      // bob フラッシュは無効化されてトラッシュ。
      const flashAfter = cur.cardInstances.find(
        (c) => c.instanceId === "bob-flash-1"
      );
      expect(flashAfter?.zone).toBe("trash");
      expect(cur.log.some((l) => l.startsWith("magic:nullified:"))).toBe(true);
      expect(
        cur.activeContinuousEffects.some(
          (effect) =>
            effect.sourceInstanceId === "bob-flash-1" &&
            effect.provenance?.effectIndex === 2
        )
      ).toBe(false);

      // alice リザーブ: フラッシュ無効化で減らず、維持コア 1 個ぶんのみ減少（4 → 3）。
      const aliceAfter = cur.players.find((p) => p.id === "alice")!;
      expect(aliceAfter.reserveNormalCoreCount).toBe(3);
    }
  );
});
