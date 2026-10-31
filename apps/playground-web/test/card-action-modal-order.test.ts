import { describe, it, expect } from "vitest";
import type { LegalAction } from "@orica/rules-core";
import {
  CARD_ACTION_MODAL_ORDER,
  CARD_ACTION_MODAL_DEFAULT_PRIORITY,
  sortCardActionsForModal,
} from "../src/utils/card-action-modal-order";

function makeAction<K extends LegalAction["kind"]>(
  kind: K,
  index: number
): { kind: K; actionId: string } {
  return { kind, actionId: `${kind}-${index}` };
}

describe("CARD_ACTION_MODAL_ORDER", () => {
  it("attack が最優先 (0)、use_field_card_effect が 2 番手", () => {
    expect(CARD_ACTION_MODAL_ORDER.attack).toBe(0);
    expect(CARD_ACTION_MODAL_ORDER.block).toBe(1);
    expect(CARD_ACTION_MODAL_ORDER.use_field_card_effect).toBe(2);
  });

  it("default priority は未定義 kind より大きい", () => {
    const allDefined = Object.values(CARD_ACTION_MODAL_ORDER);
    for (const v of allDefined) {
      expect(v).toBeLessThan(CARD_ACTION_MODAL_DEFAULT_PRIORITY);
    }
  });
});

describe("sortCardActionsForModal", () => {
  it("attack + use_field_card_effect が混在しても アタック先頭になる", () => {
    const input = [
      makeAction("use_field_card_effect", 1),
      makeAction("attack", 1),
    ];
    const result = sortCardActionsForModal(input);
    expect(result.map((a) => a.kind)).toEqual([
      "attack",
      "use_field_card_effect",
    ]);
  });

  it("attack / block / use_field_card_effect が混在: 戦闘宣言 → 効果発揮の順", () => {
    const input = [
      makeAction("use_field_card_effect", 1),
      makeAction("block", 1),
      makeAction("attack", 1),
    ];
    const result = sortCardActionsForModal(input);
    expect(result.map((a) => a.kind)).toEqual([
      "attack",
      "block",
      "use_field_card_effect",
    ]);
  });

  it("brave_* グループは戦闘 / 効果発揮の後に出る", () => {
    const input = [
      makeAction("brave_combine", 1),
      makeAction("use_field_card_effect", 1),
      makeAction("attack", 1),
      makeAction("brave_separate", 1),
    ];
    const result = sortCardActionsForModal(input);
    expect(result.map((a) => a.kind)).toEqual([
      "attack",
      "use_field_card_effect",
      "brave_combine",
      "brave_separate",
    ]);
  });

  it("配置 / 使用系の順序: summon → place_nexus → set_burst → use_magic", () => {
    const input = [
      makeAction("use_magic", 1),
      makeAction("set_burst", 1),
      makeAction("summon", 1),
      makeAction("place_nexus", 1),
    ];
    const result = sortCardActionsForModal(input);
    expect(result.map((a) => a.kind)).toEqual([
      "summon",
      "place_nexus",
      "set_burst",
      "use_magic",
    ]);
  });

  it("未知の kind は末尾に回る (default priority)", () => {
    const input = [
      makeAction("attack", 1),
      // 型システム上は LegalAction["kind"] だが、実行時 fallback の検証として
      // 構造を満たす偽 kind を渡す。
      { kind: "unknown_kind" as LegalAction["kind"], actionId: "x" },
      makeAction("use_field_card_effect", 1),
    ];
    const result = sortCardActionsForModal(input);
    expect(result.map((a) => a.kind)).toEqual([
      "attack",
      "use_field_card_effect",
      "unknown_kind",
    ]);
  });

  it("元配列は変更されない (immutable)", () => {
    const input = [
      makeAction("use_field_card_effect", 1),
      makeAction("attack", 1),
    ];
    const before = input.slice();
    sortCardActionsForModal(input);
    expect(input).toEqual(before);
  });

  it("同 priority の action は元の相対順を保持 (stable sort)", () => {
    const input = [
      makeAction("attack", 1),
      makeAction("attack", 2),
      makeAction("attack", 3),
    ];
    const result = sortCardActionsForModal(input);
    expect(result.map((a) => a.actionId)).toEqual([
      "attack-1",
      "attack-2",
      "attack-3",
    ]);
  });
});
