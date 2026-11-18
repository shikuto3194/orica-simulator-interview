import { describe, expect, it } from "vitest";
import {
  promoteToFront,
  queueCardStairOffset,
  stairOrder,
} from "../src/utils/effect-queue-stair";

const names = (ids: string[]): string => ids.join("");

describe("効果キューの階段状レイアウト", () => {
  it("前面は枚数に依らず原点に固定され、後ろほど左上へ退く", () => {
    for (const count of [1, 2, 4, 7]) {
      expect(queueCardStairOffset(count - 1, count)).toEqual({ x: -0, y: -0 });
    }
    expect(queueCardStairOffset(2, 4)).toEqual({ x: -55, y: -10 });
    expect(queueCardStairOffset(1, 4)).toEqual({ x: -110, y: -20 });
    expect(queueCardStairOffset(0, 4)).toEqual({ x: -165, y: -30 });
  });

  it("前面から見て右にも下にも出ない (元の最前面が右へそれない)", () => {
    for (let position = 0; position < 6; position++) {
      const { x, y } = queueCardStairOffset(position, 6);
      expect(x).toBeLessThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(0);
    }
  });
});

describe("効果キューの前面化", () => {
  it("C を選ぶと A B D C、A を選ぶと B C D A (選んだものが最前面に来るだけ)", () => {
    const initial = ["A", "B", "C", "D"];
    expect(names(promoteToFront(initial, "C"))).toBe("ABDC");
    expect(names(promoteToFront(initial, "A"))).toBe("BCDA");
  });

  it("直前の並びを引き継ぐ: A → B → D と選ぶと C D A B → C A B D", () => {
    let ids = ["A", "B", "C", "D"];
    ids = promoteToFront(ids, "A");
    expect(names(ids)).toBe("BCDA");
    ids = promoteToFront(ids, "B");
    expect(names(ids)).toBe("CDAB");
    ids = promoteToFront(ids, "D");
    expect(names(ids)).toBe("CABD");
  });

  it("既に最前面なら同じ配列を返し、存在しない id は無視する", () => {
    const ids = ["A", "B", "C"];
    expect(promoteToFront(ids, "C")).toBe(ids);
    expect(promoteToFront(ids, "Z")).toBe(ids);
  });

  it("入力の配列は書き換えない", () => {
    const ids = ["A", "B", "C"];
    promoteToFront(ids, "A");
    expect(ids).toEqual(["A", "B", "C"]);
  });
});

describe("表示順の正規化", () => {
  it("消えた id を除き、同期前の新規 id は前面へ足す", () => {
    expect(names(stairOrder(["A", "B", "C"], ["C", "X", "A"]))).toBe("CAB");
    expect(names(stairOrder(["A", "B"], []))).toBe("AB");
    expect(names(stairOrder([], ["A"]))).toBe("");
  });
});
