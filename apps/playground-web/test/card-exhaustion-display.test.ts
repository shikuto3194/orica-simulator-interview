import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCardInstance, type Zone } from "@orica/rules-core";
import { ALL_CARDS } from "@orica/card-data";
import { CardView } from "../src/components/CardView";

const definition = ALL_CARDS.find((card) => card.cardNo === "BSGE01-TX01(A)")!;
function render(
  zone: Zone,
  exhaustState: "exhausted" | "heavily_exhausted",
  isSoulState = false
) {
  const card = createCardInstance(definition, {
    instanceId: "returned-brave",
    ownerPlayerId: "bob",
    zone,
    exhaustState,
  });
  return renderToStaticMarkup(
    React.createElement(CardView, { card, definition, isSoulState })
  );
}

describe("カードの疲労表示のゾーン", () => {
  it.each(["exhausted", "heavily_exhausted"] as const)(
    "保存された手札の%s値を回転表示しない",
    (exhaustState) => {
      expect(render("hand", exhaustState)).not.toMatch(
        /card-(?:heavily-)?exhausted/
      );
    }
  );
  it.each(["deck", "trash", "in_use", "removed_from_game"] as const)(
    "%sでは疲労表示しない",
    (zone) => {
      expect(render(zone, "exhausted")).not.toContain("card-exhausted");
    }
  );
  it("フィールドの疲労・重疲労は表示し、魂状態は回転させない", () => {
    expect(render("field", "exhausted")).toContain("card-exhausted");
    expect(render("field", "heavily_exhausted")).toContain(
      "card-heavily-exhausted"
    );
    expect(render("field", "exhausted", true)).not.toContain("card-exhausted");
  });
});
