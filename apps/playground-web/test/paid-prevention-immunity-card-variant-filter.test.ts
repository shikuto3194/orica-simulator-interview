/**
 * ENGINE-paid-prevention-immunity-card-cost Step3 の GUI 側フォローアップ:
 * `payPreventionImmunityCost` variant は候補カード数が amount を超えるとき
 * `paidPreventionImmunityCardSelection` の明示指定を要求するが、GUI に候補
 * ピッカーが無いため未フィルタのまま提示すると "explicit ... is required" で
 * throw する (adversarial verifier 2026-07-28 refute)。ピッカー実装までは
 * `isUnsupportedPaidPreventionImmunityCardVariant` で該当 variant を myActions
 * から除外する。候補数===amount (engine 側が自動確定) は従来通り提示してよい。
 */
import { describe, expect, it } from "vitest";
import { isUnsupportedPaidPreventionImmunityCardVariant } from "../src/components/BattleScreen";
import type { LegalAction } from "@orica/rules-core";

function baseAction(overrides: Record<string, unknown> = {}): LegalAction {
  return {
    kind: "resolve_pending_triggered_effect",
    actionId: "legal:resolve:1",
    can: true,
    reason: "resolve",
    actingPlayerId: "alice",
    pendingId: "pending-1",
    ...overrides,
  } as unknown as LegalAction;
}

describe("isUnsupportedPaidPreventionImmunityCardVariant", () => {
  it("候補フィールドが無いアクションは対象外 (false)", () => {
    expect(isUnsupportedPaidPreventionImmunityCardVariant(baseAction())).toBe(
      false
    );
  });

  it("候補数 === amount のときは false (engine 側が自動確定するので提示してよい)", () => {
    const action = baseAction({
      paidPreventionImmunityCardCostCandidateInstanceIds: ["c1", "c2"],
      paidPreventionImmunityCardCostAmount: 2,
    });
    expect(isUnsupportedPaidPreventionImmunityCardVariant(action)).toBe(false);
  });

  it("候補数 < amount のときは false (afford 判定で本来 offer されないケースだが、フィルタ関数単体としても安全側)", () => {
    const action = baseAction({
      paidPreventionImmunityCardCostCandidateInstanceIds: ["c1"],
      paidPreventionImmunityCardCostAmount: 2,
    });
    expect(isUnsupportedPaidPreventionImmunityCardVariant(action)).toBe(false);
  });

  it("候補数 > amount のときは true (GUI 未対応の選択が必要なので除外する)", () => {
    const action = baseAction({
      paidPreventionImmunityCardCostCandidateInstanceIds: ["c1", "c2", "c3"],
      paidPreventionImmunityCardCostAmount: 2,
    });
    expect(isUnsupportedPaidPreventionImmunityCardVariant(action)).toBe(true);
  });
});
