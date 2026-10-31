/**
 * P3-127: attack/join_active_attack のコスト源 (破壊/重疲労させるカード) 候補が
 * 複数あるとき、GUI は同一攻撃宣言から生じる cost-source variant を 1 ボタンに
 * 集約したうえで候補選択モーダルへ振り分ける。attackCostGroupKey はその集約キー
 * (=同一攻撃宣言かどうかの判定) を担う。
 */
import { describe, expect, it } from "vitest";
import { attackCostGroupKey } from "../src/components/action-ui";
import type {
  AttackLegalAction,
  JoinActiveAttackLegalAction,
} from "@orica/rules-core";

function attack(overrides: Partial<AttackLegalAction> = {}): AttackLegalAction {
  return {
    kind: "attack",
    actionId: "legal:attack:1",
    can: true,
    reason: "attack",
    actingPlayerId: "alice",
    sourceInstanceId: "spirit-1",
    sourceDefinitionId: "TEST-SPIRIT",
    sourceCardNo: "TEST-SPIRIT",
    battleEntityId: "battle-1",
    ...overrides,
  } as AttackLegalAction;
}

function joinActiveAttack(
  overrides: Partial<JoinActiveAttackLegalAction> = {}
): JoinActiveAttackLegalAction {
  return {
    kind: "join_active_attack",
    actionId: "legal:join:1",
    can: true,
    reason: "join_active_attack",
    actingPlayerId: "alice",
    sourceInstanceId: "spirit-2",
    sourceDefinitionId: "TEST-SPIRIT",
    sourceCardNo: "TEST-SPIRIT",
    attackId: "attack-1",
    grantSourceInstanceId: "grant-1",
    ...overrides,
  } as JoinActiveAttackLegalAction;
}

describe("attackCostGroupKey", () => {
  it("同一 sourceInstanceId の attack はコスト源候補が違っても同一キー (BSDB01-C09 型)", () => {
    const a = attack({ battleDestroyCostSourceInstanceId: "spirit-2" });
    const b = attack({ battleDestroyCostSourceInstanceId: "spirit-3" });
    expect(attackCostGroupKey(a)).toBe(attackCostGroupKey(b));
  });

  it("attack は sourceInstanceId が違えば別キー", () => {
    const a = attack({ sourceInstanceId: "spirit-1" });
    const b = attack({ sourceInstanceId: "spirit-9" });
    expect(attackCostGroupKey(a)).not.toBe(attackCostGroupKey(b));
  });

  it("join_active_attack は同一 sourceInstanceId+attackId ならコスト源候補が違っても同一キー", () => {
    const a = joinActiveAttack({
      attackExhaustCostSourceInstanceId: "spirit-4",
    });
    const b = joinActiveAttack({
      attackExhaustCostSourceInstanceId: "spirit-5",
    });
    expect(attackCostGroupKey(a)).toBe(attackCostGroupKey(b));
  });

  it("join_active_attack は attackId が違えば別キー (別の合流先アタック)", () => {
    const a = joinActiveAttack({ attackId: "attack-1" });
    const b = joinActiveAttack({ attackId: "attack-2" });
    expect(attackCostGroupKey(a)).not.toBe(attackCostGroupKey(b));
  });

  it("attack と join_active_attack は sourceInstanceId が同じでもキーが衝突しない (kind prefix)", () => {
    const a = attack({ sourceInstanceId: "spirit-1" });
    const b = joinActiveAttack({
      sourceInstanceId: "spirit-1",
      attackId: "attack-1",
    });
    expect(attackCostGroupKey(a)).not.toBe(attackCostGroupKey(b));
  });
});
