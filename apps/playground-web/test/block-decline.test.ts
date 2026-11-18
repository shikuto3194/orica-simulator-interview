import { describe, expect, it } from "vitest";
import type { LegalAction } from "@orica/rules-core";
import {
  blockDeclineLabelOverride,
  selectBlockDeclineActions,
} from "../src/utils/block-decline";
import { ACTION_UI_ROUTES, getActionLabel } from "../src/components/action-ui";

const action = (kind: string, actionId = kind): LegalAction =>
  ({ kind, actionId }) as unknown as LegalAction;

describe("ブロック辞退の出し分け", () => {
  const block = action("block", "b1");
  const decline = action("decline_block", "d1");
  const pass = action("pass_stack", "p1");

  it("ブロック候補がある間だけ、decline_block を返す", () => {
    expect(
      selectBlockDeclineActions({
        actions: [block, decline, pass],
        hasPendingAction: false,
      })
    ).toEqual([decline]);
    // block 候補が無ければ出さない (旧: hasBlockActions が false)。
    expect(
      selectBlockDeclineActions({
        actions: [decline, pass],
        hasPendingAction: false,
      })
    ).toEqual([]);
  });

  it("別の pending 操作中は出さない", () => {
    expect(
      selectBlockDeclineActions({
        actions: [block, decline],
        hasPendingAction: true,
      })
    ).toEqual([]);
  });

  it("decline_block が合法手に無ければ、ボタンも出ない (押しても何も起きないボタンを出さない)", () => {
    expect(
      selectBlockDeclineActions({ actions: [block], hasPendingAction: false })
    ).toEqual([]);
  });

  it("他の行動を混ぜない", () => {
    const result = selectBlockDeclineActions({
      actions: [block, decline, pass, action("decline_block", "d2")],
      hasPendingAction: false,
    });
    expect(result.every((a) => a.kind === "decline_block")).toBe(true);
    expect(result).toHaveLength(2);
  });
});

describe("ブロック辞退のラベル", () => {
  const decline = action("decline_block");

  it("まだ誰もブロックしていなければ既定の「ブロックしない」", () => {
    expect(blockDeclineLabelOverride(decline, [])).toBeUndefined();
    expect(
      blockDeclineLabelOverride(decline, [{ blockedByEntityIds: [] }])
    ).toBeUndefined();
    expect(getActionLabel(decline)).toBe("ブロックしない");
  });

  it("1体以上ブロック宣言済みなら「ブロック完了」", () => {
    expect(
      blockDeclineLabelOverride(decline, [
        { blockedByEntityIds: [] },
        { blockedByEntityIds: ["blocker-1"] },
      ])
    ).toBe("ブロック完了");
  });

  it("decline_block 以外のラベルは変えない", () => {
    expect(
      blockDeclineLabelOverride(action("pass_stack"), [
        { blockedByEntityIds: ["x"] },
      ])
    ).toBeUndefined();
  });

  it("decline_block は他の行動ボタンと同じ ActionBar の1経路", () => {
    expect(ACTION_UI_ROUTES.decline_block).toBe("action-bar");
  });
});
