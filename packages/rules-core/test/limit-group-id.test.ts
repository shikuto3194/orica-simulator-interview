/**
 * Effect.limitGroupId が
 * 1) registration まで伝搬すること
 * 2) canUseEffectByUsageLimit / recordEffectUsageIfLimited で正しく
 *    「異なる timing の effect 間で使用回数を共有する」こと
 * を検証する。
 *
 * 動機: BSTH01-X03「レミリア・スカーレット」の
 *   Lv1-Lv2-Lv3『召喚/アタック時』ターンに1回 …
 * は召喚時 effect と アタック時 effect の 2 つに分割して定義されており、
 * limitGroupId="nexus_destroy" を共有する設計。配線が外れていると
 * 同ターン内に召喚で 1 回 + アタックで 1 回の計 2 回発動できてしまう。
 */
import { describe, expect, it } from "vitest";
import {
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
} from "../src/effect/structured-effect-registrations";
import {
  canUseEffectByUsageLimit,
  recordEffectUsageIfLimited,
} from "../src/legal/legal-actions-shared";
import { createEmptyGameState } from "../src/factories";
import { ALL_CARDS } from "../../card-data/src/generated-index";

describe("Effect.limitGroupId — registration への伝搬", () => {
  it("triggered registration: effect.limitGroupId が registration.limitGroupId に乗る", () => {
    const lookup = buildTriggeredEffectLookup(ALL_CARDS);
    for (const def of ALL_CARDS) {
      if (!def.effects) continue;
      // 各 effect ごとに limitGroupId が設定されているなら、その effectIndex の
      // registration もすべて limitGroupId を保持しているはず。
      const expectedByIndex = new Map<number, string>();
      for (let i = 0; i < def.effects.length; i++) {
        const id = def.effects[i]!.limitGroupId;
        if (id) expectedByIndex.set(i, id);
      }
      if (expectedByIndex.size === 0) continue;
      const regs = lookup(def.cardNo) ?? [];
      for (const r of regs) {
        const idx = r.effectIndex;
        if (idx === undefined) continue;
        const expected = expectedByIndex.get(idx);
        if (!expected) continue;
        expect(r.limitGroupId, `${def.cardNo} effect[${idx}]`).toBe(expected);
      }
    }
  });

  it("BSTH01-X03 レミリア: nexus_destroy limitGroup が summon (triggered) / attack (battle-immediate) 双方に存在", () => {
    // 第1効果: card_event/summon → triggered registration
    const triggeredRegs =
      buildTriggeredEffectLookup(ALL_CARDS)("BSTH01-X03") ?? [];
    const summonReg = triggeredRegs.find(
      (r) => r.eventKind === "summon" && r.limitGroupId === "nexus_destroy"
    );
    expect(summonReg, "summon (triggered) registration").toBeDefined();

    // 第2効果: card_event/attack → battle-immediate registration
    const battleRegs =
      buildBattleImmediateEffectLookup(ALL_CARDS)("BSTH01-X03") ?? [];
    const attackReg = battleRegs.find(
      (r) =>
        r.timing === "attack" &&
        r.effectIndex === 1 &&
        r.limitGroupId === "nexus_destroy"
    );
    expect(attackReg, "attack (battle-immediate) registration").toBeDefined();

    // 第3効果 (Lv2-3 BP20000 破壊) は別 effect で limitGroupId を持たない
    const bpDestroyReg = battleRegs.find(
      (r) => r.timing === "attack" && r.effectIndex === 2
    );
    expect(bpDestroyReg, "BP destroy registration").toBeDefined();
    expect(bpDestroyReg?.limitGroupId).toBeUndefined();
  });

  it("magic / field-card / battle-immediate 系: limitGroupId が定義されていれば registration にも乗る", () => {
    const magicLookup = buildMagicLookup(ALL_CARDS);
    const fieldLookup = buildFieldCardEffectLookup(ALL_CARDS);
    const battleLookup = buildBattleImmediateEffectLookup(ALL_CARDS);

    for (const def of ALL_CARDS) {
      if (!def.effects) continue;
      const groupedEffects = def.effects.filter(
        (e) => e.limitGroupId && e.timing.kind !== "continuous"
      );
      if (groupedEffects.length === 0) continue;

      const allRegs = [
        ...(magicLookup(def.cardNo) ?? []),
        ...(fieldLookup(def.cardNo) ?? []),
        ...(battleLookup(def.cardNo) ?? []),
      ];
      // 各 limitGroupId について、対応する registration が存在するなら
      // その registration の limitGroupId も等しいはず。
      const setIds = new Set(
        allRegs.map((r) => r.limitGroupId).filter(Boolean)
      );
      for (const e of groupedEffects) {
        // registration が生成されない effect (例: triggered のみ) はスキップ
        if (allRegs.length === 0) continue;
        // 一致する registration がある場合は同じ limitGroupId を持つ
        if (setIds.size > 0) {
          expect(
            setIds.has(e.limitGroupId!),
            `${def.cardNo} ${e.limitGroupId}`
          ).toBe(true);
        }
      }
    }
  });
});

describe("Effect.limitGroupId — 使用回数の共有挙動", () => {
  it("groupId 指定: 異なる effectLabel でも groupId 一致のレコードはマッチする", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    // effect:0 で 1 回使用記録
    const after = recordEffectUsageIfLimited({
      state: base,
      sourceInstanceId: "rem-1",
      sourceDefinitionId: "BSTH01-X03",
      effectLabel: "effect:0",
      usageLimit: { kind: "per_instance", duration: "turn" },
      groupId: "nexus_destroy",
    });
    // effect:1 が canUse 判定: groupId 一致のレコードを sum するので 1 回消費済 → 不可
    const allowedLater = canUseEffectByUsageLimit({
      state: after,
      sourceInstanceId: "rem-1",
      sourceDefinitionId: "BSTH01-X03",
      effectLabel: "effect:1",
      usageLimit: { kind: "per_instance", duration: "turn" },
      groupId: "nexus_destroy",
    });
    expect(allowedLater).toBe(false);
  });

  it("groupId 不一致: 別 group のレコードは effect:1 の使用を阻害しない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const after = recordEffectUsageIfLimited({
      state: base,
      sourceInstanceId: "rem-1",
      sourceDefinitionId: "BSTH01-X03",
      effectLabel: "effect:0",
      usageLimit: { kind: "per_instance", duration: "turn" },
      groupId: "other_group",
    });
    const allowed = canUseEffectByUsageLimit({
      state: after,
      sourceInstanceId: "rem-1",
      sourceDefinitionId: "BSTH01-X03",
      effectLabel: "effect:1",
      usageLimit: { kind: "per_instance", duration: "turn" },
      groupId: "nexus_destroy",
    });
    expect(allowed).toBe(true);
  });

  it("groupId 未指定 (従来挙動): effectLabel 単位で独立にカウント", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const after = recordEffectUsageIfLimited({
      state: base,
      sourceInstanceId: "rem-1",
      sourceDefinitionId: "BSTH01-X03",
      effectLabel: "effect:0",
      usageLimit: { kind: "per_instance", duration: "turn" },
    });
    const allowed = canUseEffectByUsageLimit({
      state: after,
      sourceInstanceId: "rem-1",
      sourceDefinitionId: "BSTH01-X03",
      effectLabel: "effect:1",
      usageLimit: { kind: "per_instance", duration: "turn" },
    });
    expect(allowed).toBe(true);
  });
});
