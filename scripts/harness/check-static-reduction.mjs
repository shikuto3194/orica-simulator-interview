import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reductionProjection } from "./semantic-scope.mjs";

const cards = JSON.parse(process.env.ORICA_STATIC_CARDS || "[]");
if (!Array.isArray(cards) || !cards.length)
  throw new Error("Static reduction gate requires changed card identities");
const translations = {
  赤: "red",
  紫: "purple",
  緑: "green",
  白: "white",
  黄: "yellow",
  青: "blue",
  黒: "black",
  神: "god",
  導: "guide",
  極: "ultimate_symbol",
  七: "seven",
  六: "six",
};
const cache = new Map();
for (const id of cards) {
  if (!/^[A-Z]+\d+(?:\.\d+)?-[\p{L}\p{N}_()-]+$/u.test(id))
    throw new Error("Unsupported static card identity: " + id);
  const pack = id.split("-")[0];
  const files = [
    `packages/card-data/src/cards/${pack}.ts`,
    `packages/card-data/raw/by-pack/${pack}.js`,
    "packages/card-data/raw/cardData.js",
  ];
  const values = files.map((file) => {
    if (!cache.has(file))
      cache.set(
        file,
        reductionProjection(file, readFileSync(resolve(file), "utf8"))
      );
    const value = cache.get(file)?.records.get(id);
    if (!value) throw new Error(`Missing/ambiguous reduction: ${file} ${id}`);
    return value.map((color) => {
      const normalized = translations[color] ?? color;
      if (!Object.values(translations).includes(normalized))
        throw new Error("Unknown reduction symbol: " + color);
      return normalized;
    });
  });
  if (
    values.some((value) => JSON.stringify(value) !== JSON.stringify(values[0]))
  )
    throw new Error("Raw/implementation reduction mismatch: " + id);
}
console.log(
  `Static reduction values and three copies agree: ${cards.join(", ")}`
);
