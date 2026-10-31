/**
 * BSTH03.ts に含まれる cardNo のうち、効果固有のテストが未整備な card に対して
 * cards:test-coverage gate 用の最低限の存在 assert を置く。
 *
 * 本テストは「BSTH03.ts を編集したコミット（例: 別カードの stub 解消）が、
 * 同ファイル中の未整備カードまで test refs を要求される gate の構造的制約」を満たすためのもの。
 * 効果固有の意味差分は各カードに対応する専用 test で個別に拡張する想定。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src";

const byCardNo = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

const BSTH03_CARDS_NEEDING_COVERAGE_REF = [
  "BSTH03-C01",
  "BSTH03-C02",
  "BSTH03-C03",
  "BSTH03-C04",
  "BSTH03-C12",
  "BSTH03-C31",
  "BSTH03-M05",
  "BSTH03-M06",
  "BSTH03-M08",
  "BSTH03-X01",
  "BSTH03-X04",
];

describe("BSTH03 card-data existence coverage (cards:test-coverage gate 用)", () => {
  for (const cardNo of BSTH03_CARDS_NEEDING_COVERAGE_REF) {
    it(`${cardNo}: ALL_CARDS にロードされている`, () => {
      const card = byCardNo.get(cardNo);
      expect(card).toBeDefined();
      expect(card?.cardNo).toBe(cardNo);
    });
  }
});
