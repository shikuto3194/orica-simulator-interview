/**
 * P3-119 根治回帰: バースト/ミラージュにセットされたカードの appliesToCard treat_as
 * 継続効果 (「このカードの軽減シンボル/シンボルは○○としても扱う」型) が、
 * recomputeAndRebuildContinuousEffects を繰り返し呼んでも register/expire を
 * 無限往復しないことを固定する。
 *
 * 旧実装は executeTreatAs が duration.scope: "while_on_field" を無条件でハードコード
 * しており、かつ recomputeContinuousEffects の targetInstanceId 検査が
 * duration.scope に関わらず「対象カードが field 不在なら除去」を適用していたため、
 * バースト/ミラージュにセットされたカードの CE は登録直後に必ず除去され、次の
 * rebuild で再登録される無限往復 (fuzz gate ハングの真因、seed=9 で turn=25 固定)
 * を起こしていた。
 *
 * 正源: issues/P3-119/root-cause-2026-07-14.md。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

// P3-119 root-cause で確認した「keywordTags:burst + appliesToCard treat_as」8枚。
// 「このカードの軽減シンボル」型は cardStateOnly で CE 非登録になったため、
// 振動しないことを zero-CE として確認する。
const BURST_TREAT_AS_CARDS = [
  // 「このネクサス」の効果はバーストセット中に適用されない。
  ["BSDB01-C07", false],
  ["BSTH003-M03", false],
  ["BSTH003-X02", false],
  ["BSTH02-C02", false],
  ["BSTH02-M03", false],
  ["BSTH08-C04", true],
  ["BSTS01-M01", true],
  ["BSTS01-X03", true],
] as const;

function buildBurstScenario(cardNo: string): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const card = createCardInstance(cardNoMap.get(cardNo)!, {
    instanceId: "burst-card",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "burst",
  });
  return {
    ...base,
    cardInstances: [card],
    setBurstStates: [{ playerId: "alice", cardInstanceId: "burst-card" }],
  };
}

// 対象は appliesToCard treat_as CE のみに絞る (他の条件付き常時効果の
// "effect:condition-unmet:<id>" は毎 rebuild 呼び出しで正常に 1 行ずつ増える
// 無害なログで、本回帰が検出したい register/expire 往復とは無関係)。
function treatAsCEs(state: GameState) {
  return state.activeContinuousEffects.filter(
    (ce) =>
      ce.sourceInstanceId === "burst-card" &&
      ce.modifierTag.startsWith("treat_as_")
  );
}
function treatAsLogLines(state: GameState) {
  return state.log.filter(
    (line) =>
      line.startsWith("effect:treat_as:registered:") ||
      line.startsWith("continuous-effect:expired:dsl-ce-treat_as-")
  );
}

describe("P3-119: burst-set treat_as CE は recompute を繰り返しても振動しない", () => {
  for (const [cardNo, expectsCe] of BURST_TREAT_AS_CARDS) {
    it(`${cardNo}: 20 回 recomputeAndRebuildContinuousEffects を呼んでも treat_as CE が発散しない`, () => {
      let state = buildBurstScenario(cardNo);
      state = recomputeAndRebuildContinuousEffects(
        state,
        getCardDefinitionById
      );

      const initialCEs = treatAsCEs(state);
      if (expectsCe) {
        expect(initialCEs.length).toBeGreaterThan(0);
        for (const ce of initialCEs) {
          expect(ce.duration.scope).toBe("while_set");
        }
      } else {
        expect(initialCEs).toHaveLength(0);
      }
      const initialEffectIds = new Set(initialCEs.map((ce) => ce.effectId));
      const treatAsLogCountAfterFirst = treatAsLogLines(state).length;

      for (let i = 0; i < 20; i++) {
        state = recomputeAndRebuildContinuousEffects(
          state,
          getCardDefinitionById
        );
      }

      // 往復が起きていれば treat_as:registered / continuous-effect:expired が
      // 20 回分積み上がる。冪等なら 2 回目以降 treat_as 関連ログは一切増えない。
      expect(treatAsLogLines(state).length).toBe(treatAsLogCountAfterFirst);
      const stillCEs = treatAsCEs(state);
      expect(stillCEs.length).toBe(initialCEs.length);
      expect(new Set(stillCEs.map((ce) => ce.effectId))).toEqual(
        initialEffectIds
      );
    });
  }
});
