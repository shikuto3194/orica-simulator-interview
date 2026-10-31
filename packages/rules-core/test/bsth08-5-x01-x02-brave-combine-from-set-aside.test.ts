/**
 * BSTH08.5-X01 effects[2] / BSTH08.5-X02 effects[1]
 * 「バトル終了時、このスピリットのブレイヴすべてをトラッシュに置く。その後、
 * 手元にある系統：「面霊」を持つブレイヴカード1枚をこのスピリットに合体することで、
 * このスピリットは回復する（X02は回復状態にする）。」回帰テスト。
 *
 * bsth08-5-brave-combine-from-set-aside cluster: brave_combine_effect
 * (ENGINE-brave-combine-third-party-target, BSAZ01 select_brave→combine_host と同型) で
 * 「合体」自体を効果ステップから起動する。host は {kind:"self"} で確定（合体先選択不要、
 * このスピリット自身）。合体元は noop(on_step) が手元(set_aside)の系統:面霊ブレイヴ1枚を
 * 選び、ref_succeeded ゲートで combine/recover 双方をスキップ可能にする。
 *
 * timing.deferredTo:"battle_end" の予約インターセプトは deferred-to-battle-end.test.ts が
 * 別途担保する（BSKB01-X01 battle-end test と同型の precedent）。本テストは
 * firingBattleEndDeferral:true で予約バイパスし、steps 合成そのものを直接検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { executeEffect as executeEffectRaw } from "../src/effect/effect-interpreter";
import { finishPayloadInputs } from "./helpers/payload-input-driver";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { flushPendingLeaves } from "../src/state-based-actions";
import type { CardDefinition, GameState } from "../src/model";

function executeEffect(
  options: Omit<
    Parameters<typeof executeEffectRaw>[0],
    "getRegisteredTriggeredEffectActions"
  >
) {
  return finishPayloadInputs(
    executeEffectRaw({
      ...options,
      getRegisteredTriggeredEffectActions: () => [],
    }),
    options.getCardDefinitionById
  );
}

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const attachedBraveDef = cardNoMap.get("BSTH08.5-C24")!; // 面霊ブレイヴ (合体済み、トラッシュされる側)
const setAsideBraveDef = cardNoMap.get("BSTH08.5-C23")!; // 面霊ブレイヴ (手元、新たに合体する側)

function buildState(
  hostDef: CardDefinition,
  hostInstanceId: string,
  includeCandidate: boolean
): GameState {
  const host = {
    ...createCardInstance(hostDef, {
      instanceId: hostInstanceId,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    }),
    attachedChildrenIds: ["old-brave"],
  };
  const oldBrave = {
    ...createCardInstance(attachedBraveDef, {
      instanceId: "old-brave",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 1,
    }),
    attachedToInstanceId: hostInstanceId,
  };
  const cardInstances = [host, oldBrave];
  if (includeCandidate) {
    cardInstances.push(
      createCardInstance(setAsideBraveDef, {
        instanceId: "new-brave",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "set_aside",
      })
    );
  }
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    cardInstances,
  };
}

describe("BSTH08.5-X01 effects[2]: バトル終了時ブレイヴ整理→手元面霊ブレイヴ合体で回復", () => {
  const def = cardNoMap.get("BSTH08.5-X01")!;
  const EFFECT_INDEX = 2;
  const effect = def.effects![EFFECT_INDEX]!;

  it("直接全ブレイヴ破棄 → 手元選択 → 合体成功を条件に回復", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.steps).toHaveLength(4);
    expect(effect.steps[0]!.action).toEqual({
      kind: "move_card",
      from: { zone: "field", player: "self" },
      target: {
        kind: "filter",
        player: "self",
        filter: { category: ["brave"], attachedToSource: true },
        count: "all",
      },
      to: { zone: "trash", player: "self" },
      count: "all",
    });
    expect(effect.steps[1]!.action.kind).toBe("noop");
    const selectStepId = effect.steps[1]!.id!;
    expect(effect.steps[2]!.action).toEqual({
      kind: "brave_combine_effect",
      source: { stepId: selectStepId },
      target: { kind: "self" },
    });
    expect(effect.steps[2]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: selectStepId,
    });
    expect(effect.steps[3]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: effect.steps[2]!.id,
    });
    expect(effect.steps[3]!.action).toEqual({
      kind: "recover",
      target: { kind: "self" },
    });
  });

  it("合体元ブレイヴあり: 旧ブレイヴがトラッシュへ、手元ブレイヴが合体、スピリットが回復する", () => {
    const state = buildState(def, "x01", true);
    const executed = executeEffect({
      chainId: "test:bsth08-5-x01-x02-brave-combine-from-set-aside:119",
      state,
      effect,
      effectIndex: EFFECT_INDEX,
      sourceInstanceId: "x01",
      actingPlayerId: "alice",
      getCardDefinitionById,
      firingBattleEndDeferral: true,
    });
    const after = flushPendingLeaves(executed, getCardDefinitionById);

    const oldBraveAfter = after.cardInstances.find(
      (c) => c.instanceId === "old-brave"
    )!;
    expect(oldBraveAfter.zone, after.log.join("\n")).toBe("trash");
    expect(oldBraveAfter.attachedToInstanceId).toBeNull();

    const newBraveAfter = after.cardInstances.find(
      (c) => c.instanceId === "new-brave"
    )!;
    expect(newBraveAfter.attachedToInstanceId).toBe("x01");

    const hostAfter = after.cardInstances.find((c) => c.instanceId === "x01")!;
    expect(hostAfter.attachedChildrenIds).toContain("new-brave");
    expect(hostAfter.attachedChildrenIds).not.toContain("old-brave");
    expect(hostAfter.exhaustState).toBe("recovered");
  });

  it("合体元ブレイヴなし(手元に面霊ブレイヴ無し): 選択0件でcombine/recoverともスキップし、旧ブレイヴのみトラッシュされる", () => {
    const state = buildState(def, "x01", false);
    const executed = executeEffect({
      chainId: "test:bsth08-5-x01-x02-brave-combine-from-set-aside:149",
      state,
      effect,
      effectIndex: EFFECT_INDEX,
      sourceInstanceId: "x01",
      actingPlayerId: "alice",
      getCardDefinitionById,
      firingBattleEndDeferral: true,
    });
    const after = flushPendingLeaves(executed, getCardDefinitionById);

    const oldBraveAfter = after.cardInstances.find(
      (c) => c.instanceId === "old-brave"
    )!;
    expect(oldBraveAfter.zone, after.log.join("\n")).toBe("trash");

    const hostAfter = after.cardInstances.find((c) => c.instanceId === "x01")!;
    expect(hostAfter.attachedChildrenIds).not.toContain("new-brave");
    expect(hostAfter.exhaustState).toBe("exhausted");
  });
});

describe("BSTH08.5-X02 effects[1]: バトル終了時ブレイヴ整理→手元面霊ブレイヴ合体で回復状態に", () => {
  const def = cardNoMap.get("BSTH08.5-X02")!;
  const EFFECT_INDEX = 1;
  const effect = def.effects![EFFECT_INDEX]!;

  it("X01同様の4stepで、自身のブレイヴ1枚を直接破棄する", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.steps).toHaveLength(4);
    expect(effect.steps[0]!.action.kind).toBe("move_card");
    expect(effect.steps[1]!.action.kind).toBe("noop");
    expect(effect.steps[2]!.action.kind).toBe("brave_combine_effect");
    expect(effect.steps[3]!.action).toEqual({
      kind: "set_exhaust_state",
      state: "recovered",
      target: { kind: "self" },
    });
  });

  it.each(["exhausted", "heavily_exhausted"] as const)(
    "合体元ブレイヴあり: %sから回復状態になる",
    (exhaustState) => {
      const state = buildState(def, "x02", true);
      state.cardInstances[0]!.exhaustState = exhaustState;
      const executed = executeEffect({
        chainId: "test:bsth08-5-x01-x02-brave-combine-from-set-aside:194",
        state,
        effect,
        effectIndex: EFFECT_INDEX,
        sourceInstanceId: "x02",
        actingPlayerId: "alice",
        getCardDefinitionById,
        firingBattleEndDeferral: true,
      });
      const after = flushPendingLeaves(executed, getCardDefinitionById);

      const newBraveAfter = after.cardInstances.find(
        (c) => c.instanceId === "new-brave"
      )!;
      expect(newBraveAfter.attachedToInstanceId).toBe("x02");

      const hostAfter = after.cardInstances.find(
        (c) => c.instanceId === "x02"
      )!;
      expect(hostAfter.exhaustState).toBe("recovered");
    }
  );
});

// These use the real card definitions and keep the independent brave-discard prefix.
describe.each([
  ["BSTH08.5-X01", 2],
  ["BSTH08.5-X02", 1],
] as const)("%s optional combine-for-recovery tail", (no, index) => {
  const def = cardNoMap.get(no)!;
  const effect = def.effects![index]!;
  const raw = (state: GameState) =>
    executeEffectRaw({
      state,
      effect,
      effectIndex: index,
      chainId: `tail:${no}`,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      firingBattleEndDeferral: true,
    });
  it("decline preserves the mandatory old-brave discard and spends no new brave", () => {
    expect(effect.executionMode ?? "mandatory").toBe("mandatory");
    expect(effect.steps[1]!.executionMode).toBe("optional");
    const state = finishPayloadInputs(
      raw(buildState(def, "host", true)),
      getCardDefinitionById,
      "decline"
    );
    const after = flushPendingLeaves(state, getCardDefinitionById);
    expect(
      after.cardInstances.find((c) => c.instanceId === "old-brave")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "new-brave")?.zone
    ).toBe("set_aside");
    expect(
      after.cardInstances.find((c) => c.instanceId === "host")?.exhaustState
    ).toBe("exhausted");
  });
  it("execute discards the old brave, combines the selected new brave and recovers", () => {
    const after = flushPendingLeaves(
      finishPayloadInputs(
        raw(buildState(def, "host", true)),
        getCardDefinitionById
      ),
      getCardDefinitionById
    );
    expect(
      after.cardInstances.find((c) => c.instanceId === "old-brave")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "new-brave")
        ?.attachedToInstanceId
    ).toBe("host");
    expect(
      after.cardInstances.find((c) => c.instanceId === "host")?.exhaustState
    ).toBe("recovered");
  });
  it("already recovered payoff refunds only the combine, retaining the independent discard", () => {
    const state = buildState(def, "host", true);
    state.cardInstances[0]!.exhaustState = "recovered";
    const after = flushPendingLeaves(
      finishPayloadInputs(raw(state), getCardDefinitionById),
      getCardDefinitionById
    );
    expect(
      after.cardInstances.find((c) => c.instanceId === "old-brave")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "new-brave")?.zone
    ).toBe("set_aside");
    expect(
      after.cardInstances.find((c) => c.instanceId === "new-brave")
        ?.attachedToInstanceId
    ).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "host")?.exhaustState
    ).toBe("recovered");
  });
});
