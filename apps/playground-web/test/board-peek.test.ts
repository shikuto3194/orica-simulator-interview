import { describe, expect, it } from "vitest";
import {
  boardPeekLabel,
  boardPeekLayer,
  isActionBarPeeked,
} from "../src/utils/board-peek";

describe("盤面確認ボタンは画面に1つ: 層の優先度", () => {
  it("モーダル > 効果キュー > ActionBar のみ、どれも無ければボタンなし", () => {
    expect(
      boardPeekLayer({
        hasFullScreenModal: true,
        queueCount: 3,
        actionButtonCount: 2,
      })
    ).toBe("modal");
    expect(
      boardPeekLayer({
        hasFullScreenModal: false,
        queueCount: 3,
        actionButtonCount: 2,
      })
    ).toBe("queue");
    expect(
      boardPeekLayer({
        hasFullScreenModal: false,
        queueCount: 0,
        actionButtonCount: 1,
      })
    ).toBe("action");
    expect(
      boardPeekLayer({
        hasFullScreenModal: false,
        queueCount: 0,
        actionButtonCount: 0,
      })
    ).toBeNull();
  });
});

describe("盤面確認ボタンのラベル", () => {
  const base = { queueCount: 17, modalReturnLabel: "対象選択に戻る" };
  it("隠していないときは常に「盤面確認」", () => {
    for (const layer of ["modal", "queue", "action"] as const) {
      expect(boardPeekLabel({ ...base, layer, peeked: false })).toBe(
        "盤面確認"
      );
    }
  });
  it("隠している間は、戻り先が分かるラベルになる", () => {
    expect(boardPeekLabel({ ...base, layer: "modal", peeked: true })).toBe(
      "対象選択に戻る"
    );
    expect(boardPeekLabel({ ...base, layer: "queue", peeked: true })).toBe(
      "解決待ち 17"
    );
    expect(boardPeekLabel({ ...base, layer: "action", peeked: true })).toBe(
      "操作に戻る"
    );
  });
});

describe("ActionBar を隠す条件", () => {
  const base = {
    hasUiPending: false,
    effectQueueVisible: true,
    actionBarPeeked: false,
  };
  it("効果キューを盤面確認で隠したときは、ActionBar も一緒に隠す (デッキ等を覆わない)", () => {
    expect(
      isActionBarPeeked({ ...base, layer: "queue", effectQueueVisible: false })
    ).toBe(true);
    expect(isActionBarPeeked({ ...base, layer: "queue" })).toBe(false);
  });
  it("UI pending 中のキュー自動非表示は盤面確認ではないので隠さない", () => {
    expect(
      isActionBarPeeked({
        ...base,
        layer: "queue",
        hasUiPending: true,
        effectQueueVisible: false,
      })
    ).toBe(false);
  });
  it("キューが無いときは ActionBar 自身のトグルだけで隠す", () => {
    expect(
      isActionBarPeeked({ ...base, layer: "action", actionBarPeeked: true })
    ).toBe(true);
    expect(isActionBarPeeked({ ...base, layer: "action" })).toBe(false);
    expect(isActionBarPeeked({ ...base, layer: "modal" })).toBe(false);
    expect(isActionBarPeeked({ ...base, layer: null })).toBe(false);
  });
});
