import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("BSTH08.5-X01 原本系の軽減同期", () => {
  for (const { file, title } of [
    {
      file: "by-pack/BSTH08.5.js",
      title: "by-pack/BSTH08.5.js は赤3・神1・導1を保持する",
    },
    { file: "cardData.js", title: "cardData.js は赤3・神1・導1を保持する" },
  ]) {
    it(title, () => {
      const source = readFileSync(
        new URL(`../../card-data/raw/${file}`, import.meta.url),
        "utf8"
      );
      const cards = new Function(
        source.replace("export default cardData;", "return cardData;")
      )() as { cardNumber?: string; reduction?: string[] }[];
      const matches = cards.filter((c) => c.cardNumber === "BSTH08.5-X01");
      expect(matches).toHaveLength(1);
      expect(matches[0]!.reduction).toEqual(["赤", "赤", "赤", "神", "導"]);
    });
  }
});
