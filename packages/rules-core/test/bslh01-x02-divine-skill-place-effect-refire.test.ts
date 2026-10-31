/**
 * BSLH01-X02「[創界神]キーア-零の至宝」【神技：3】Lv2『自分のメインステップ』:
 * 「〔ターンに1回：同名〕〔このネクサスのコア-3する〕このネクサスの『このネクサスの配置時』
 * 効果を発揮する。」
 *
 * self 再発揮 (project_summon_effect_reactivation_pattern) として、『このネクサスの配置時』
 * 効果 (card_event:"place", textRef:[8,9]) の steps を grandwalkerData.divineSkills[0].effects
 * へそのまま複製する（BSLH01-X01 divineSkills precedent と同型）。コスト(コア3個→ボイド)・
 * 「ターンに1回：同名」制限は divineSkills 経路でエンジンが検査・支払う
 * (project_divine_skill_model_target_maxuses)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import { getAvailableDivineSkillLegalActions } from "../src/legal/legal-actions-availability";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const X02 = cardNoMap.get("BSLH01-X02")!;
const getCardDef = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ?? ALL_CARDS.find((c) => c.cardNo === id);

const ALICE = "alice";
const BOB = "bob";

function skill() {
  return X02.grandwalkerData!.divineSkills![0]!;
}

function baseState(normalCoreCount: number): GameState {
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [
      { reserveNormalCoreCount: 10 },
      { reserveNormalCoreCount: 10 },
    ],
  });
  const x02Instance = createCardInstance(X02, {
    instanceId: "x02",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount,
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    cardInstances: [x02Instance],
  };
}

/** 開いたスタック窓を responder のパスで閉じ、deferred 解決まで進める。 */
function passStackUntilClosed(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const responderId = current.stackWindow.priorityPlayerId;
    const actions = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById: getCardDef,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const pass = actions.find((a) => a.kind === "pass_stack");
    expect(pass, `pass_stack for ${responderId}`).toBeDefined();
    current = (
      applyLegalAction({
        state: current,
        action: pass!,
        getCardDefinitionById: getCardDef,
      } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
    ).state;
  }
  expect(current.stackWindow).toBeNull();
  return current;
}

describe("BSLH01-X02 【神技：3】: divineSkills(divine_skill) place-effect self re-fire", () => {
  it("card-data: coreCost=3 / timing=main / Lv2 / ターンに1回:同名、effects は配置時 summon steps の複製", () => {
    const s = skill();
    expect(s.label).toBe("divine_skill");
    expect(s.coreCost).toBe(3);
    expect(s.timing).toBe("main");
    expect(s.minLevel).toBe(2);
    expect(s.turnLimit).toBe("once_per_name");

    const steps = s.effects![0]!.steps;
    expect(steps).toHaveLength(1);
    const action = steps[0]!.action;
    expect(action.kind).toBe("put");
    if (action.kind !== "put") throw new Error("unreachable");
    expect(action.target).toEqual({
      kind: "from_token_pool",
      count: 1,
      allRelatedTokens: true,
    });
  });

  it("実行: コア-3でネクサス配置時効果を再発揮し、トークン3体(アイオーンα/β/γ)を出す", () => {
    const state = baseState(3);

    const declareActions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    const declare = declareActions.find(
      (a) => a.sourceInstanceId === "x02" && a.skillIndex === 0
    );
    expect(declare).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: declare!,
      getCardDefinitionById: getCardDef,
    });
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    expect(declared.state.stackWindow).not.toBeNull();

    const finalState = passStackUntilClosed(declared.state);

    const x02After = finalState.cardInstances.find(
      (c) => c.instanceId === "x02"
    )!;
    expect(x02After.normalCoreCount).toBe(0);

    const tokens = finalState.cardInstances.filter(
      (c) =>
        c.zone === "field" &&
        ["BSLH01-T04", "BSLH01-T05", "BSLH01-T06"].includes(c.definitionId)
    );
    expect(tokens.map((t) => t.definitionId).sort()).toEqual([
      "BSLH01-T04",
      "BSLH01-T05",
      "BSLH01-T06",
    ]);

    // ターンに1回：同名 — 同ターン中の再宣言は不可（コア0でも制限が先に効く）。
    const secondDeclare = getAvailableDivineSkillLegalActions({
      state: finalState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(
      secondDeclare.some(
        (a) => a.sourceInstanceId === "x02" && a.skillIndex === 0
      )
    ).toBe(false);
  });

  it("Lv1 (コア3未満) では神技：3が候補に出ない", () => {
    const state = baseState(2);
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(
      actions.some((a) => a.sourceInstanceId === "x02" && a.skillIndex === 0)
    ).toBe(false);
  });
});
