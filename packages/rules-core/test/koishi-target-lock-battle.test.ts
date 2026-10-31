import { describe, expect, it } from "vitest";
import { getAttackDeclarationBlockReason } from "../src/battle/battle-availability";
import {
  createCardInstance,
  rebuildContinuousEffectsFromField,
  type GameState,
} from "../src";
import {
  koishiDefinition,
  koishiTargetLockState,
} from "./helpers/koishi-target-lock";

function attackReason(state: GameState, sourceInstanceId = "koishi") {
  return getAttackDeclarationBlockReason({
    state,
    actingPlayerId: state.activePlayerId!,
    sourceInstanceId,
    getCardDefinitionById: koishiDefinition,
  });
}

describe("BSTH06-X02: ラストジャッジメントの全体攻撃禁止と対象ロック", () => {
  it.each([0, 5])(
    "相手カウント%dでもこいしは攻撃でき、勇儀は攻撃できない",
    (count) => {
      const state = koishiTargetLockState("alice", count);
      expect(state.activeContinuousEffects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            modifierTag: "cannot_include",
            targetInstanceId: "koishi",
          }),
          expect.objectContaining({
            modifierTag: "prevent_battle_attack",
            targetFilter: {
              player: "opponent",
              category: ["spirit", "ultimate"],
            },
          }),
        ])
      );
      expect(attackReason(state)).toBeNull();
      expect(attackReason(state, "yuugi")).toBe("source_not_ready");
    }
  );

  it("『一切の効果で防げない』は対象ロックを貫通する", () => {
    const printed = koishiDefinition("BSTH04-C11")!.effects![2]!;
    const state = koishiTargetLockState("alice", 5, {
      ...printed,
      targetLockBypass: { kind: "all_effects" },
    });
    expect(attackReason(state)).toBe("source_not_ready");
  });

  it("『お互いの効果では防げない』も対象ロックを貫通しない", () => {
    const state = koishiTargetLockState("alice", 5, {
      ...koishiDefinition("BSTH04-C11")!.effects![2]!,
      targetLockBypass: { kind: "blanket_affect_immunity" },
    });
    expect(attackReason(state)).toBeNull();
  });

  it.each([
    ["cannot_be_targeted", null],
    ["cannot_include", "source_not_ready"],
  ] as const)(
    "%sだけを除去した場合も全体包含と明示対象を区別する",
    (removed, expected) => {
      const state = koishiTargetLockState();
      state.activeContinuousEffects = state.activeContinuousEffects.filter(
        (ce) => ce.modifierTag !== removed
      );
      expect(attackReason(state)).toBe(expected);
    }
  );

  it.each([0, 5])("通常の効果免疫は相手カウント%dの防止可否に従う", (count) => {
    const state = koishiTargetLockState("alice", count);
    state.activeContinuousEffects = state.activeContinuousEffects
      .filter((ce) => ce.modifierTag !== "cannot_be_targeted")
      .map((ce) =>
        ce.modifierTag === "cannot_include"
          ? { ...ce, modifierTag: "defense_immune" }
          : ce
      );
    expect(attackReason(state)).toBe(count === 0 ? null : "source_not_ready");
  });

  it("攻撃禁止の登録後に場へ出たこいしにも対象ロックが適用される", () => {
    const state = koishiTargetLockState();
    state.cardInstances.push(
      createCardInstance(koishiDefinition("BSTH06-X02")!, {
        instanceId: "late-koishi",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const rebuilt = rebuildContinuousEffectsFromField(state, koishiDefinition);
    expect(attackReason(rebuilt, "late-koishi")).toBeNull();
    expect(attackReason(rebuilt, "yuugi")).toBe("source_not_ready");
  });

  it("ルール強度の攻撃禁止は対象ロックでは解除できない", () => {
    const state = koishiTargetLockState();
    state.activeContinuousEffects = state.activeContinuousEffects.map((ce) =>
      ce.modifierTag === "prevent_battle_attack"
        ? { ...ce, metadata: { ...ce.metadata, ruleStrength: true } }
        : ce
    );
    expect(attackReason(state)).toBe("source_not_ready");
  });

  it("対象ロックが無効な期間は攻撃禁止が適用される", () => {
    const state = koishiTargetLockState();
    state.activeContinuousEffects = state.activeContinuousEffects.map((ce) =>
      ce.modifierTag === "cannot_be_targeted" ||
      ce.modifierTag === "cannot_include"
        ? { ...ce, timingScope: { player: "self", period: "main" } }
        : ce
    );
    expect(attackReason(state)).toBe("source_not_ready");
  });
});
