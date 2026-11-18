import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src";
import { validateMainDeckDefinitions } from "../src/card/card-filter";

const cardsByNo = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));

function card(cardNo: string): CardDefinition {
  const definition = cardsByNo.get(cardNo);
  if (!definition) throw new Error(`card not found: ${cardNo}`);
  return definition;
}

describe("印字済みデッキ枚数制限 carrier", () => {
  it("source-text deck-limit carriers: token-pool cards are rejected from the main deck and singleton cards reject a second copy", () => {
    const tokenCardNos = [
      "BSES01-T01",
      "BSKB01-T01",
      "BSLH01-T01",
      "BSLH01-T02",
      "BSLH01-T03",
      "BSLH01-T04",
      "BSLH01-T05",
      "BSLH01-T06",
      "BSSL01-T01",
    ];
    const tokenIssues = validateMainDeckDefinitions(tokenCardNos.map(card));
    expect(tokenIssues).toHaveLength(tokenCardNos.length);
    expect(tokenIssues).toEqual(
      expect.arrayContaining(
        tokenCardNos.map((cardNo) =>
          expect.objectContaining({
            kind: "unavailable",
            cardNo,
            reason: "token",
          })
        )
      )
    );

    const singletonIssues = validateMainDeckDefinitions([
      card("BSLH01-C03"),
      card("BSLH01-C03"),
      card("BSLH01-M02"),
      card("BSLH01-M02"),
    ]);
    expect(singletonIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "too_many_copies",
          cardNo: "BSLH01-C03",
          count: 2,
          maxDeckCount: 1,
        }),
        expect.objectContaining({
          kind: "too_many_copies",
          cardNo: "BSLH01-M02",
          count: 2,
          maxDeckCount: 1,
        }),
      ])
    );
  });
});
