import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  collectCardFaces,
  collectEffectContainers,
} from "../../../scripts/card-text-accountability-core.mjs";
import audit from "./fixtures/reveal-retrieval-audit.json";
import type { DSL, Effect } from "../src";

const faces = ALL_CARDS.flatMap(collectCardFaces).map(({ face }) => face);
const get = (no: string) => faces.find((face) => face.cardNo === no)!;
const at = (value: unknown, path: string): unknown =>
  path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .reduce((v: unknown, key) => (v as Record<string, unknown>)[key], value);
function find(value: unknown, kind: string, path = ""): string[] {
  if (!value || typeof value !== "object") return [];
  return [
    ...("kind" in value && value.kind === kind ? [path] : []),
    ...Object.entries(value).flatMap(([key, child]) =>
      key === "backFace"
        ? []
        : find(
            child,
            kind,
            Array.isArray(value)
              ? `${path}[${key}]`
              : path
                ? `${path}.${key}`
                : key
          )
    ),
  ];
}
const normalized = (s: string) => s.replace(/\s/g, "");
const rawDir = resolve("packages/card-data/raw/by-pack");
const originals = new Map<string, string>();
const originalOpenLines = new Map<string, string[]>();
for (const file of readdirSync(rawDir).filter((f) => f.endsWith(".js"))) {
  const { default: pack } = await import(
    pathToFileURL(resolve(rawDir, file)).href
  );
  for (const card of pack)
    for (const face of card.isDoubleSided ? [card.front, card.back] : [card]) {
      originals.set(face.cardNumber, normalized(face.effect ?? ""));
      originalOpenLines.set(
        face.cardNumber,
        (face.effect ?? "")
          .split(/\r?\n/)
          .filter((line: string) => /オープン|公開/.test(line))
      );
    }
}

describe("原文と全カードの公開・回収強制/任意の照合", () => {
  it("全634面のdeck_revealを漏れなく監査対象に含める", () => {
    expect(faces.length).toBeGreaterThan(0);
    const actual = faces.flatMap((face) =>
      find(face, "deck_reveal").map((path) => `${face.cardNo}:${path}`)
    );
    expect(actual.sort()).toEqual(
      audit.reveals.map((r) => `${r.cardNo}:${r.path}`).sort()
    );
  });
  it("raw原文のオープン/公開文がTS本文にも存在する（全カード）", () => {
    for (const [no, lines] of originalOpenLines)
      for (const line of lines) {
        const face = get(no);
        expect(face, no).toBeDefined();
        expect(normalized(face.textLines.join("")), `${no}: ${line}`).toContain(
          normalized(line)
        );
      }
  });
  for (const row of audit.reveals)
    it(`${row.cardNo} ${row.path}`, () => {
      const face = get(row.cardNo);
      for (const line of row.sourceLines) {
        expect(originals.get(row.cardNo), line).toContain(normalized(line));
        expect(normalized(face.textLines.join("")), line).toContain(
          normalized(line)
        );
      }
      const action = at(face, row.path) as DSL.DeckRevealAction;
      expect(
        action.picks.map((p) => ({
          count: p.count,
          mandatory: p.mandatory === true,
          destination: p.destination ?? "hand",
        }))
      ).toEqual(row.picks);
      const segments = row.path.replace(/\[(\d+)\]/g, ".$1").split(".");
      const modes: string[] = [];
      let node: Record<string, unknown> = face;
      for (const key of segments) {
        node = node[key] as Record<string, unknown>;
        if (typeof node?.executionMode === "string")
          modes.push(node.executionMode);
      }
      expect(modes).toEqual(row.executionModes);
    });
  it("公開されたカード自身の効果も全件照合する", () => {
    const actual: string[] = [];
    for (const face of faces)
      for (const { path, effects } of collectEffectContainers(face))
        effects.forEach((effect, index) => {
          if (
            effect.timing.kind === "card_event" &&
            [effect.timing.event].flat().includes("revealed")
          )
            actual.push(`${face.cardNo}:${path}[${index}]`);
        });
    expect(actual.sort()).toEqual(
      audit.onRevealed.map((r) => `${r.cardNo}:${r.path}`).sort()
    );
    for (const row of audit.onRevealed) {
      expect(
        (at(get(row.cardNo), row.path) as Effect).executionMode,
        row.cardNo
      ).toBe(row.executionMode);
      for (const line of row.sourceLines)
        expect(originals.get(row.cardNo), `${row.cardNo}: ${line}`).toContain(
          normalized(line)
        );
    }
  });
});
