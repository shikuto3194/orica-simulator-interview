import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODAL_SRC = readFileSync(
  resolve(__dirname, "../src/components/DeckRevealModal.tsx"),
  "utf8"
);
const BATTLE_CSS = readFileSync(
  resolve(__dirname, "../src/battle.css"),
  "utf8"
);

describe("DeckRevealModal top_bottom_split order UI", () => {
  it("下/上ボタン選択を順番選択として扱い、側別の順番バッジを出す", () => {
    expect(MODAL_SRC).toContain(
      "setOrderSequence((prev) => (prev.includes(id) ? prev : [...prev, id]));"
    );
    expect(MODAL_SRC).toContain(
      "bottomIds.forEach((id, index) => labels.set(id, `下${index + 1}`));"
    );
    expect(MODAL_SRC).toContain(
      "topIds.forEach((id, index) => labels.set(id, `上${index + 1}`));"
    );
    expect(MODAL_SRC).toContain("各カードの下/上を戻す順に選んでください");
  });

  it("上下分配では下→未選択→上の実位置順へ並び替える", () => {
    expect(MODAL_SRC).toContain(
      "return [...bottomIds, ...unselectedIds, ...[...topIds].reverse()]"
    );
    expect(MODAL_SRC).toContain(
      '...orderSequence.filter((id) => splitPlacements[id] === "bottom")'
    );
    expect(MODAL_SRC).toContain(
      '.filter((id) => splitPlacements[id] === "top")'
    );
    expect(MODAL_SRC).toContain(".reverse()");
  });

  it("方向ラベルを戻し、リセットは順番確定と同じアクション列に表示する", () => {
    expect(MODAL_SRC).toContain(
      '<span className="dr-order-arrow">◀ デッキの下</span>'
    );
    expect(MODAL_SRC).toContain(
      '<span className="dr-order-arrow">デッキの上 ▶</span>'
    );
    expect(MODAL_SRC).toContain(
      "const showOrderReset = needsSplitPlacementChoice || hasOrderDraft;"
    );
    expect(MODAL_SRC).toContain("setPlacement(null);");
    expect(MODAL_SRC).toContain("順番確定");
    expect(MODAL_SRC).toContain("リセット");
  });

  it("選択済みカードは画像だけをグレーアウトし、文字入りバッジを載せられる", () => {
    expect(BATTLE_CSS).toContain(".dr-card.ordered .dr-card-img");
    expect(BATTLE_CSS).toContain("filter: grayscale(1);");
    expect(BATTLE_CSS).toContain("border-radius: 999px;");
    expect(BATTLE_CSS).toContain("min-width: 1.6em;");
  });
});
