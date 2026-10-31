import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CARD_DECLARATION = /cardNo:\s*"([^"]+)"/g;

export function extractDeclaredCardNos(source) {
  return [
    ...new Set([...source.matchAll(CARD_DECLARATION)].map((match) => match[1])),
  ];
}

/** Preserve an explicitly referenced face instead of certifying its other face. */
export function extractReferencedCardNos(source) {
  return [
    ...source.matchAll(
      /\b([A-Z]{2,}\d+(?:\.\d+)?-(?:[A-Z]+\d+|転醒[A-Z0-9-]+)(?:\([AB]\))?)(?![A-Z0-9-])/g
    ),
  ].map((match) => match[1]);
}

export function parseCardEntries(path) {
  if (!existsSync(path)) return [];
  const source = readFileSync(path, "utf8");
  const cardStarts = [...source.matchAll(CARD_DECLARATION)];
  return cardStarts.flatMap((start, index) => {
    const nextStart = cardStarts[index + 1];
    const startLine = source.slice(0, start.index).split(/\r?\n/).length;
    const nextStartLine = nextStart
      ? source.slice(0, nextStart.index).split(/\r?\n/).length
      : null;
    const section = source.slice(
      start.index,
      nextStart?.index ?? source.length
    );
    const name = /name:\s*"([^"]+)"/.exec(section)?.[1];
    const textBlock = /textLines:\s*\[([\s\S]*?)\]/.exec(section)?.[1];
    if (!name || textBlock === undefined) return [];
    const textLines = [];
    for (const line of textBlock.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      textLines.push(line[1].replace(/\\"/g, '"').replace(/\\n/g, "\n"));
    }
    return [
      {
        cardNo: start[1],
        name,
        set: /^([A-Z]+\d+(?:\.\d+)?)/.exec(start[1])?.[1] ?? "OTHER",
        textLines,
        startLine,
        // Half-open [startLine, nextStartLine): the next card's declaration
        // never belongs to the preceding card.
        endLine:
          nextStartLine === null
            ? source.split(/\r?\n/).length
            : nextStartLine - 1,
      },
    ];
  });
}

export function changedCardNosFromDiff({ root, files, fullDiff }) {
  const cardFiles = new Set(
    files.filter((file) =>
      /packages\/card-data\/src\/cards\/.+\.ts$/.test(file)
    )
  );
  const rangesByFile = new Map();
  let currentFile = null;
  for (const line of fullDiff.split(/\r?\n/)) {
    const file = /^diff --git a\/(.+) b\/(.+)$/.exec(line)?.[2];
    if (file) {
      currentFile = cardFiles.has(file) ? file : null;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!currentFile || !hunk) continue;
    const count = Number(hunk[2] ?? 1);
    if (count === 0) continue;
    const ranges = rangesByFile.get(currentFile) ?? [];
    ranges.push({ start: Number(hunk[1]), end: Number(hunk[1]) + count - 1 });
    rangesByFile.set(currentFile, ranges);
  }
  return [
    ...new Set(
      [...rangesByFile.entries()].flatMap(([file, ranges]) =>
        parseCardEntries(join(root, file))
          .filter((card) =>
            ranges.some(
              (range) =>
                card.startLine <= range.end && range.start <= card.endLine
            )
          )
          .map((card) => card.cardNo)
      )
    ),
  ].sort();
}
