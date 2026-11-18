import { execFileSync } from "node:child_process";
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
  return parseCardSource(readFileSync(path, "utf8"));
}

function parseCardSource(source) {
  source = source.replace(/\r\n/g, "\n");
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
        source: section,
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

export function changedCardNosFromDiff({ root, files, fullDiff, baseTree }) {
  const cardFiles = new Set(
    files.filter((file) =>
      /packages\/card-data\/src\/cards\/.+\.ts$/.test(file)
    )
  );
  const rangesByFile = new Map();
  const deletionsByFile = new Map();
  let currentFile = null;
  let oldFile = null;
  for (const line of fullDiff.split(/\r?\n/)) {
    const file = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (file) {
      currentFile = cardFiles.has(file[2]) ? file[2] : null;
      oldFile = file[1];
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!currentFile || !hunk) continue;
    const count = Number(hunk[4] ?? 1);
    if (count === 0) {
      const deletion = deletionsByFile.get(currentFile) ?? {
        oldFile,
        ranges: [],
      };
      deletion.ranges.push({
        start: Number(hunk[1]),
        end: Number(hunk[1]) + Number(hunk[2] ?? 1) - 1,
      });
      deletionsByFile.set(currentFile, deletion);
      continue;
    }
    const ranges = rangesByFile.get(currentFile) ?? [];
    ranges.push({ start: Number(hunk[3]), end: Number(hunk[3]) + count - 1 });
    rangesByFile.set(currentFile, ranges);
  }
  const deletedCardNos = [...deletionsByFile].flatMap(([file, deletion]) => {
    if (!baseTree)
      throw new Error("baseTree is required for deleted card lines");
    const currentCards = new Map(
      parseCardEntries(join(root, file)).map((card) => [card.cardNo, card])
    );
    const original = execFileSync(
      "git",
      ["show", `${baseTree}:${deletion.oldFile}`],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
      }
    );
    // Attribute removed lines in the old tree. A new-side deletion anchor can
    // point at a neighbouring card; an entirely removed card has no new clause.
    return parseCardSource(original)
      .filter((card) => {
        const current = currentCards.get(card.cardNo);
        return (
          current &&
          current.source !== card.source &&
          deletion.ranges.some(
            (range) =>
              card.startLine <= range.end && range.start <= card.endLine
          )
        );
      })
      .map((card) => card.cardNo);
  });
  return [
    ...new Set([
      ...deletedCardNos,
      ...[...rangesByFile.entries()].flatMap(([file, ranges]) =>
        parseCardEntries(join(root, file))
          .filter((card) =>
            ranges.some(
              (range) =>
                card.startLine <= range.end && range.start <= card.endLine
            )
          )
          .map((card) => card.cardNo)
      ),
    ]),
  ].sort();
}
