/**
 * 盤面条件付き自カードコスト上書き（cost_modify 自己対象 modifier:{override:N}）の回帰テスト。
 *
 * 「自分のカウント5以上のとき、手札/トラッシュ/煌臨元にあるこのカードをコスト5にする」型
 * （BSSL01-X03 ベリオン、印字コスト10）。cost-system.getEffectiveBaseCostOverride が
 * card.effects を直接読み、applicability(zone)+condition(count_value) を評価して成立時に
 * 印字コストを override 値へ差し替える（10_rules/03a §コスト軽減下限 L22「軽減シンボル/
 * override/free すべてを通した結果が floor を下回らない」）。
 *
 * 煌臨元（advent_source）は runtime Zone 上 "field" のままホストの下に重なるため、
 * ApplicabilityZone に "advent_source" を追加し evaluateApplicability が
 * collectUnderCardScopeIds().adventSource で別チェックする（needs-dsl.audit BSSL01-X03、
 * adversarial verifier 2026-07-02 指摘）。
 *
 * calculateReduction は SSOT のため availability / resolution / accel すべてに反映される。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  calculateReduction,
  getEffectiveCostFloor,
} from "../src/core/cost-system";
import { createCardInstance, createEmptyGameState } from "../src";
import type { CardDefinition, CardInstance, GameState } from "../src";

const defMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string) => defMap.get(id);

const PLAYER = "p1";

/** BSSL01-X03 を指定ゾーンに置き、自分の countValue を設定した state を作る。 */
function stateWithSelf(
  zone: "hand" | "trash" | "field",
  countValue: number
): { state: GameState; instanceId: string } {
  const instanceId = "self-veriion";
  const instance: CardInstance = createCardInstance(getDef("BSSL01-X03")!, {
    instanceId,
    ownerPlayerId: PLAYER,
    controllerPlayerId: PLAYER,
    zone,
  });
  const state = createEmptyGameState({
    playerIds: [PLAYER, "p2"],
    cardInstances: [instance],
  });
  const withCount: GameState = {
    ...state,
    players: state.players.map((p) =>
      p.id === PLAYER ? { ...p, countValue } : p
    ),
  };
  return { state: withCount, instanceId };
}

function reduce(state: GameState, sourceInstanceId: string): number {
  return calculateReduction({
    state,
    actingPlayerId: PLAYER,
    card: getDef("BSSL01-X03")!,
    getCardDefinitionById: getDef,
    sourceInstanceId,
  }).reducedCost;
}

function printed(state: GameState, sourceInstanceId: string): number {
  return calculateReduction({
    state,
    actingPlayerId: PLAYER,
    card: getDef("BSSL01-X03")!,
    getCardDefinitionById: getDef,
    sourceInstanceId,
  }).printedCost;
}

describe("自カードコスト上書き (cost_modify self override)", () => {
  it("BSSL01-X03 手札・カウント5以上: 印字10 → コスト5に上書き", () => {
    const { state, instanceId } = stateWithSelf("hand", 5);
    expect(printed(state, instanceId)).toBe(5);
    // 軽減供給源なし → 上書き後コスト 5 のまま。
    expect(reduce(state, instanceId)).toBe(5);
  });

  it("BSSL01-X03 トラッシュ・カウント5以上: 同様に上書き成立", () => {
    const { state, instanceId } = stateWithSelf("trash", 5);
    expect(printed(state, instanceId)).toBe(5);
  });

  it("BSSL01-X03 カウント4 (条件未満): 上書きせず印字10", () => {
    const { state, instanceId } = stateWithSelf("hand", 4);
    expect(printed(state, instanceId)).toBe(10);
    expect(reduce(state, instanceId)).toBe(10);
  });

  it("BSSL01-X03 フィールド (applicability zone 外): 上書きせず印字10", () => {
    const { state, instanceId } = stateWithSelf("field", 9);
    expect(printed(state, instanceId)).toBe(10);
  });

  it("直接読みは self target の override/floor だけを自カードコストへ反映する", () => {
    const synthetic: CardDefinition = {
      cardNo: "TEST-NON-SELF-COST-MODIFY",
      name: "non-self cost modify",
      printedCategory: "magic",
      colors: ["red"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      effects: [
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "cost_modify",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
                modifier: { override: 1 },
              },
            },
            {
              action: {
                kind: "cost_modify",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: { category: ["spirit"] },
                  count: 1,
                },
                modifier: { floor: 4 },
              },
            },
          ],
        },
      ],
    };
    const instance = createCardInstance(synthetic, {
      instanceId: "non-self-cost-modify",
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [PLAYER, "p2"],
      cardInstances: [instance],
    });

    const reduction = calculateReduction({
      state,
      actingPlayerId: PLAYER,
      card: synthetic,
      getCardDefinitionById: (id) =>
        id === synthetic.cardNo ? synthetic : getDef(id),
      sourceInstanceId: instance.instanceId,
    });

    expect(reduction.printedCost).toBe(5);
    expect(
      getEffectiveCostFloor(
        synthetic,
        state,
        PLAYER,
        (id) => (id === synthetic.cardNo ? synthetic : getDef(id)),
        instance.instanceId
      )
    ).toBe(0);
  });

  it("BSSL01-X03 煌臨元 (advent_source underCard)・カウント5以上: 上書き成立", () => {
    const selfInstanceId = "self-veriion";
    const hostInstanceId = "host";
    const selfInstance: CardInstance = createCardInstance(
      getDef("BSSL01-X03")!,
      {
        instanceId: selfInstanceId,
        ownerPlayerId: PLAYER,
        controllerPlayerId: PLAYER,
        zone: "field",
      }
    );
    const hostInstance: CardInstance = createCardInstance(
      getDef("BSSL01-X03")!,
      {
        instanceId: hostInstanceId,
        ownerPlayerId: PLAYER,
        controllerPlayerId: PLAYER,
        zone: "field",
      }
    );
    hostInstance.underCards = [
      { cardInstanceId: selfInstanceId, role: "advent_source" as const },
    ];
    const state = createEmptyGameState({
      playerIds: [PLAYER, "p2"],
      cardInstances: [selfInstance, hostInstance],
    });
    const withCount: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === PLAYER ? { ...p, countValue: 5 } : p
      ),
    };
    expect(printed(withCount, selfInstanceId)).toBe(5);
  });

  it("BSSL01-X03 フィールド上だが煌臨元でない (ホストの underCards に無い): 上書きせず印字10", () => {
    const selfInstanceId = "self-veriion";
    const hostInstanceId = "host";
    const selfInstance: CardInstance = createCardInstance(
      getDef("BSSL01-X03")!,
      {
        instanceId: selfInstanceId,
        ownerPlayerId: PLAYER,
        controllerPlayerId: PLAYER,
        zone: "field",
      }
    );
    const hostInstance: CardInstance = createCardInstance(
      getDef("BSSL01-X03")!,
      {
        instanceId: hostInstanceId,
        ownerPlayerId: PLAYER,
        controllerPlayerId: PLAYER,
        zone: "field",
      }
    );
    // underCards が空 → self は普通に field にいるだけで advent_source ではない。
    const state = createEmptyGameState({
      playerIds: [PLAYER, "p2"],
      cardInstances: [selfInstance, hostInstance],
    });
    const withCount: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === PLAYER ? { ...p, countValue: 5 } : p
      ),
    };
    expect(printed(withCount, selfInstanceId)).toBe(10);
  });

  it("BSSL01-X03 sourceInstanceId 無し (条件/applicability 評価不可): 上書きしない", () => {
    const { state } = stateWithSelf("hand", 9);
    // sourceInstanceId 無しでは applicability/condition を評価できないため
    // override は採用されない（fail-closed）。
    const result = calculateReduction({
      state,
      actingPlayerId: PLAYER,
      card: getDef("BSSL01-X03")!,
      getCardDefinitionById: getDef,
    });
    expect(result.printedCost).toBe(10);
  });
});
