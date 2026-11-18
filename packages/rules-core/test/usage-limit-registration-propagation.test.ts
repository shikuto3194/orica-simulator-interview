/**
 * effect.usageLimit が magic / field-card-activated / battle-immediate
 * registration に正しく伝搬されているかを担保する不変条件テスト。
 *
 * 2026-05-03: 修正前は `extractFieldTargetingMetadata` で targeting メタを
 * 抽出するだけで `effect.usageLimit` は registration に乗らず、紅魔館 /
 * ヴワル魔法図書館 / [導界者]系 / 攻撃時 per_instance turn など 36 件の
 * 効果がターン内で無制限に発動できる状態だった。
 *
 * magic / field-card / battle-immediate 系の registration は effectIndex を
 * 持たないため、本テストでは「effect.usageLimit を持つ effect の数」と
 * 「registration 中で usageLimit を持つレコードの数」を timing ごとに
 * 突き合わせて等しいことを確認する。
 *
 * per-choice usageLimit 導入後 (magic / field-card / hand-activated /
 * battle-immediate / triggered):
 * - registration.usageLimit に乗るのは effect 単位の `Effect.usageLimit` (共有制限) のみ。
 * - choice ステップの step/choice usageLimit (「1回ずつ」) は registration.choices[k].usageLimit
 *   に per-entry で保持され、共有制限へは潰されない (BSTH01-C05 / C21)。
 */
import { describe, expect, it } from "vitest";
import {
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  isHandActivatedApplicabilityZone,
  isHandActivatedOnlyApplicabilityZone,
  isHandSummonPermissionEffect,
  isMagicUsableApplicabilityZone,
  buildMagicLookup,
} from "../src/effect/structured-effect-registrations";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { isMagicCompatibleDefinition } from "../src/card/card-filter";

describe("usageLimit が effects → registrations へ伝搬する", () => {
  it("magic activated 効果: effect.usageLimit 数 == registration usageLimit 数 (timing 別)", () => {
    const lookup = buildMagicLookup(ALL_CARDS);
    for (const def of ALL_CARDS) {
      if (
        (def.printedCategory !== "magic" &&
          !isMagicCompatibleDefinition(def)) ||
        !def.effects
      )
        continue;
      const expected: Record<string, number> = {};
      const expectedChoiceLimited: Record<string, number> = {};
      for (const e of def.effects) {
        if (e.timing.kind !== "activated") continue;
        // ミラージュ/バーストセット中などの zone-specific magic は
        // 通常の use_magic ではなく field source 登録へ分担する。
        // ただし hand/set_aside/trash の組合せ (engine-magic-trash-use-permission、
        // BSDB01-R03「トラッシュからも使用できる」) は通常どおり use_magic 登録の対象。
        if (
          e.applicability?.zone !== undefined &&
          !isMagicUsableApplicabilityZone(e.applicability.zone)
        )
          continue;
        const mode = e.timing.mode;
        if (mode !== "main" && mode !== "flash" && mode !== "stack") continue;
        // 純 stub (steps 空 かつ stub 注記あり) の効果は registration を生成しない
        // (generateMagicRegistrations の skip と整合。mode 不問、
        // engine-hand-self-card-main-end-activation-timing で main/flash にも拡張)。
        if (e.steps.length === 0 && e.stub) continue;
        const choiceStep = e.steps.find((s) => s.choice && s.choice.length > 0);
        // 共有制限 (effect 単位) → registration.usageLimit。timing は mode と 1:1。
        // フラッシュ効果はスタック効果ではない (公式Q&A Q5) ため flash→stack 派生 reg は無く、
        // flash 効果は flash timing の 1 件のみ (スタック応答に出るのは mode:"stack")。
        if (e.usageLimit) {
          expected[mode] = (expected[mode] ?? 0) + 1;
        }
        // 変種別制限 (per-entry) → registration.choices[k].usageLimit
        if (
          choiceStep &&
          (choiceStep.usageLimit ||
            (choiceStep.choice ?? []).some((c) => c.usageLimit))
        ) {
          expectedChoiceLimited[mode] = (expectedChoiceLimited[mode] ?? 0) + 1;
        }
      }
      const regs = lookup(def.cardNo) ?? [];
      const actual: Record<string, number> = {};
      const actualChoiceLimited: Record<string, number> = {};
      for (const r of regs) {
        if (r.usageLimit) {
          actual[r.timing] = (actual[r.timing] ?? 0) + 1;
        }
        if ((r.choices ?? []).some((c) => c.usageLimit)) {
          actualChoiceLimited[r.timing] =
            (actualChoiceLimited[r.timing] ?? 0) + 1;
        }
      }
      expect(actual, `${def.cardNo} (${def.name})`).toEqual(expected);
      expect(
        actualChoiceLimited,
        `${def.cardNo} (${def.name}) choices`
      ).toEqual(expectedChoiceLimited);
    }
  });

  it("field-card activated 効果: effect.usageLimit 数 == registration usageLimit 数 (timing 別)", () => {
    const lookup = buildFieldCardEffectLookup(ALL_CARDS);
    for (const def of ALL_CARDS) {
      if (
        !def.effects ||
        !["spirit", "nexus", "brave", "ultimate", "magic"].includes(
          def.printedCategory
        )
      )
        continue;
      const expected: Record<string, number> = {};
      for (const e of def.effects) {
        const choiceStep = e.steps.find((s) => s.choice && s.choice.length > 0);
        const effectiveLimit = e.usageLimit ?? choiceStep?.usageLimit;
        if (!effectiveLimit || e.timing.kind !== "activated") continue;
        // 非フィールド起動効果は field 登録ではなく hand-activated 登録に乗る。
        if (
          e.applicability?.zone !== undefined &&
          isHandActivatedOnlyApplicabilityZone(e.applicability.zone)
        )
          continue;
        // 手札/手元/トラッシュ/煌臨元/魂状態からの自己召喚許可は
        // field 効果ではなく summon permission action として扱う。
        if (isHandSummonPermissionEffect(e)) continue;
        // 通常の magic / magic_compatible brave は use_magic 登録に乗る。
        // field 登録に乗るのはミラージュ/バーストセット中などの明示ゾーン効果だけ。
        if (
          (def.printedCategory === "magic" ||
            isMagicCompatibleDefinition(def)) &&
          (e.applicability?.zone === undefined ||
            (e.applicability.zone !== undefined &&
              isMagicUsableApplicabilityZone(e.applicability.zone)))
        )
          continue;
        const mode = e.timing.mode;
        if (mode !== "main" && mode !== "flash" && mode !== "stack") continue;
        if (mode === "stack" && e.steps.length === 0) continue;
        if (mode === "stack" && e.stub) continue;
        const timing = mode === "main" ? "normal" : mode;
        expected[timing] = (expected[timing] ?? 0) + 1;
      }
      const regs = lookup(def.cardNo) ?? [];
      const actual: Record<string, number> = {};
      for (const r of regs) {
        if (!r.usageLimit) continue;
        const t = r.timing ?? "unknown";
        actual[t] = (actual[t] ?? 0) + 1;
      }
      expect(actual, `${def.cardNo} (${def.name})`).toEqual(expected);
    }
  });

  it("hand-activated 効果: effect.usageLimit 数 == registration usageLimit 数", () => {
    const lookup = buildHandActivatedEffectLookup(ALL_CARDS);
    for (const def of ALL_CARDS) {
      if (!def.effects) continue;
      // magic / magic_compatible は generateMagicRegistrations が一元登録する
      // (generateHandActivatedEffectRegistrations 側の magic 除外と対称)。
      if (def.printedCategory === "magic" || isMagicCompatibleDefinition(def))
        continue;
      let expected = 0;
      for (const e of def.effects) {
        const choiceStep = e.steps.find((s) => s.choice && s.choice.length > 0);
        const effectiveLimit = e.usageLimit ?? choiceStep?.usageLimit;
        if (
          !effectiveLimit ||
          e.timing.kind !== "activated" ||
          e.applicability?.zone === undefined ||
          !isHandActivatedApplicabilityZone(e.applicability.zone) ||
          (e.steps.length === 0 && e.stub) ||
          isHandSummonPermissionEffect(e)
        )
          continue;
        expected += 1;
      }
      const regs = lookup(def.cardNo) ?? [];
      const actual = regs.filter((r) => r.usageLimit).length;
      expect(actual, `${def.cardNo} (${def.name})`).toEqual(expected);
    }
  });

  it("magic / magic_compatible の activated 効果は hand-activated 登録へ二重登録されない (engine-trash-zone-flash-activated-recovery の zone gate 拡張との衝突ガード、BSDB01-R03 adversarial verifier 2026-07-13 refute)", () => {
    const handLookup = buildHandActivatedEffectLookup(ALL_CARDS);
    for (const def of ALL_CARDS) {
      if (def.printedCategory !== "magic" && !isMagicCompatibleDefinition(def))
        continue;
      const regs = handLookup(def.cardNo) ?? [];
      expect(regs, `${def.cardNo} (${def.name})`).toEqual([]);
    }
  });

  it("battle-immediate (attack/block card_event) 効果: effect.usageLimit 数 == registration usageLimit 数", () => {
    const lookup = buildBattleImmediateEffectLookup(ALL_CARDS);
    for (const def of ALL_CARDS) {
      if (!def.effects) continue;
      const expected: Record<string, number> = {};
      const expectedChoiceLimited: Record<string, number> = {};
      for (const e of def.effects) {
        if (e.timing.kind !== "card_event") continue;
        const choiceStep = e.steps.find((s) => s.choice && s.choice.length > 0);
        const hasChoiceLimit =
          choiceStep !== undefined &&
          (choiceStep.usageLimit !== undefined ||
            (choiceStep.choice ?? []).some((c) => c.usageLimit));
        const evs = Array.isArray(e.timing.event)
          ? e.timing.event
          : [e.timing.event];
        for (const ev of evs) {
          if (ev !== "attack" && ev !== "block") continue;
          // 共有制限 (effect 単位) → registration.usageLimit
          if (e.usageLimit) {
            expected[ev] = (expected[ev] ?? 0) + 1;
          }
          // 変種別制限 (per-entry) → registration.choices[k].usageLimit
          if (hasChoiceLimit) {
            expectedChoiceLimited[ev] = (expectedChoiceLimited[ev] ?? 0) + 1;
          }
        }
      }
      const regs = lookup(def.cardNo) ?? [];
      const actual: Record<string, number> = {};
      const actualChoiceLimited: Record<string, number> = {};
      for (const r of regs) {
        if (r.usageLimit) {
          actual[r.timing] = (actual[r.timing] ?? 0) + 1;
        }
        if ((r.choices ?? []).some((c) => c.usageLimit)) {
          actualChoiceLimited[r.timing] =
            (actualChoiceLimited[r.timing] ?? 0) + 1;
        }
      }
      expect(actual, `${def.cardNo} (${def.name})`).toEqual(expected);
      expect(
        actualChoiceLimited,
        `${def.cardNo} (${def.name}) choices`
      ).toEqual(expectedChoiceLimited);
    }
  });
});
