/**
 * BSRK01-X02 [京都動乱編]緋村 剣心 effects[1]
 *   【OC中＆煌臨中】Lv1-Lv2 このスピリットは相手の効果を受けない。
 *
 * 既存プリミティブのみで stale-stub を解消した検証:
 * - OC中 = ConditionClause count_value(self,min:8) (10_rules/08a OC条件)
 * - 煌臨中 = ConditionClause self_state.advented (10_rules/08a L34: 表向き煌臨元≧1)
 * - Lv1-Lv2 = Applicability.level
 * - 「相手の効果を受けない」= effect_immunity(target:self, while_on_field)
 *
 * 条件成立時に defense_immune が登録され、いずれかの条件が外れたら登録されない
 * ことを rebuildContinuousEffectsFromField の動的再評価で確認する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition, CardInstance, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const ALICE = "alice";
const BOB = "bob";

function makeBaseState(opts?: { aliceCount?: number }): GameState {
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [{ countValue: opts?.aliceCount ?? 0 }, {}],
  });
}

/**
 * BSRK01-X02 を ALICE の場に出した状態を作る。
 * `advented=true` のとき煌臨元 1 枚を underCards に重ねる (= 表向き煌臨元≧1)。
 */
function placeKenshin(opts: { advented: boolean }): {
  state: GameState;
  selfId: string;
} {
  const def = cardNoMap.get("BSRK01-X02")!;
  const selfId = "kenshin-1";
  const card: CardInstance = createCardInstance(def, {
    instanceId: selfId,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1, // Lv1
  });
  const withAdvent: CardInstance = opts.advented
    ? {
        ...card,
        underCards: [{ cardInstanceId: "kenshin-src", role: "advent_source" }],
      }
    : card;
  return {
    state: { ...makeBaseState({ aliceCount: 8 }), cardInstances: [withAdvent] },
    selfId,
  };
}

describe("BSRK01-X02 effects[1] 【OC中＆煌臨中】Lv1-Lv2 効果耐性 (stale-stub sweep)", () => {
  const def = cardNoMap.get("BSRK01-X02");

  it("effect[1] が continuous + count_value(8) + self_state.advented + applicability Lv1-2 + effect_immunity(self) を持つ", () => {
    expect(def).toBeDefined();
    // index 1 だった耐性効果は BSRK01-X02[0] 借用発揮の card-data 実装 (2026-07-26,
    // bsrk01-magic-effect-borrow.test.ts) で index 2 へ shift した。
    const e = def!.effects![2]!;
    expect(e.timing.kind).toBe("continuous");
    expect(e.applicability).toEqual({ level: { min: 1, max: 2 } });
    expect(e.condition).toEqual([
      { kind: "count_value", player: "self", min: 8 },
      { kind: "self_state", state: "advented" },
    ]);
    expect(e.steps).toHaveLength(1);
    const action = e.steps![0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind !== "effect_immunity") throw new Error("type narrow");
    expect(action.target).toEqual({ kind: "self" });
    expect(action.duration).toEqual({ scope: "while_on_field" });
    expect(e.stub).toBeUndefined();
  });

  it("OC8 ∧ 煌臨中 ∧ Lv1 → defense_immune CE が 1 件登録される", () => {
    const { state, selfId } = placeKenshin({ advented: true });
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const immune = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "defense_immune" && ce.sourceInstanceId === selfId
    );
    expect(immune).toHaveLength(1);
  });

  it("OC8 ∧ 煌臨中だが煌臨元なし (advented=false) → 登録されない", () => {
    const { state, selfId } = placeKenshin({ advented: false });
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const immune = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "defense_immune" && ce.sourceInstanceId === selfId
    );
    expect(immune).toHaveLength(0);
  });

  it("煌臨中だが count=7 (OC未達) → 登録されない", () => {
    const { state, selfId } = placeKenshin({ advented: true });
    const withLowCount: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === ALICE ? { ...p, countValue: 7 } : p
      ),
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      withLowCount,
      getCardDefinitionById
    );
    const immune = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "defense_immune" && ce.sourceInstanceId === selfId
    );
    expect(immune).toHaveLength(0);
  });
});
