import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(
  new URL("../../../scripts/git-merge-ledger.mjs", import.meta.url)
);

type HistoryEntry = {
  date: string;
  total: number;
  stub: number;
  uncovered: number;
  delta: number;
};

function entries(from: number, to: number): HistoryEntry[] {
  const step = from <= to ? 1 : -1;
  const out: HistoryEntry[] = [];
  for (let total = from; total !== to + step; total += step) {
    out.push({
      date: "2026-07-09",
      total,
      stub: total,
      uncovered: 0,
      delta: -1,
    });
  }
  return out;
}

function withDelta(entry: HistoryEntry, delta: number): HistoryEntry {
  return { ...entry, delta };
}

function ledger(history: HistoryEntry[], currentTotal: number) {
  return {
    note: "test",
    metric: "total = stub + uncovered + noTextRef + symbolMismatch",
    current: {
      date: "2026-07-14",
      stub: currentTotal,
      uncovered: 0,
      noTextRef: 0,
      symbolMismatch: 0,
      total: currentTotal,
      needsDslOpen: 0,
      needsRulingOpen: 0,
      coverageTodo: 0,
    },
    low: { total: currentTotal, date: "2026-07-14" },
    history,
  };
}

function runMergeFromBase(
  baseHistory: HistoryEntry[],
  oursHistory: HistoryEntry[],
  theirsHistory: HistoryEntry[]
) {
  const dir = mkdtempSync(join(tmpdir(), "orica-ledger-merge-"));
  try {
    const base = join(dir, "base.json");
    const ours = join(dir, "ours.json");
    const theirs = join(dir, "theirs.json");
    writeFileSync(base, JSON.stringify(ledger(baseHistory, 999)), "utf8");
    writeFileSync(ours, JSON.stringify(ledger(oursHistory, 300)), "utf8");
    writeFileSync(theirs, JSON.stringify(ledger(theirsHistory, 299)), "utf8");

    const result = spawnSync(
      process.execPath,
      [scriptPath, base, ours, theirs],
      {
        encoding: "utf8",
      }
    );
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(readFileSync(ours, "utf8")) as ReturnType<typeof ledger>;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("git-merge-ledger history merge", () => {
  it("keeps a trimmed lane tail when the other lane still has the old prefix", () => {
    const common = entries(401, 323);
    const base = [...entries(403, 402), ...common];
    const ours = [...common, ...entries(322, 322)];
    const theirs = base;

    const merged = runMergeFromBase(base, ours, theirs);

    expect(merged.history).toEqual(ours);
    expect(merged.history).toHaveLength(80);
  });

  it("treats same date and total as shared history even when derived delta differs", () => {
    const base = entries(401, 324);
    const ours = [withDelta(base[0]!, -99), ...base.slice(1)];
    const theirs = base;

    const merged = runMergeFromBase(base, ours, theirs);

    expect(merged.history).toEqual(base);
  });

  it("keeps both competing append tails once after the shared history", () => {
    const common = entries(401, 324);
    const ours = [...common, ...entries(323, 323)];
    const theirs = [...common, ...entries(322, 322)];

    const merged = runMergeFromBase(common, ours, theirs);

    expect(merged.history).toEqual([
      ...common,
      ...entries(323, 323),
      ...entries(322, 322),
    ]);
  });

  it("deduplicates overlapping lane tails before appending the newer suffix", () => {
    const base = entries(301, 297);
    const ours = [...base, ...entries(296, 294)];
    const theirs = [...base, ...entries(295, 293)];

    const merged = runMergeFromBase(base, ours, theirs);

    expect(merged.history).toEqual([...base, ...entries(296, 293)]);
  });

  it("deduplicates overlapping lane tails when the longer tail is theirs", () => {
    const base = entries(301, 297);
    const ours = [...base, ...entries(295, 294)];
    const theirs = [...base, ...entries(296, 293)];

    const merged = runMergeFromBase(base, ours, theirs);

    expect(merged.history).toEqual([...base, ...entries(296, 293)]);
  });

  it("aligns a trimmed suffix by exact occurrence when date and total repeat", () => {
    const repeatedPrefix = [
      withDelta(entries(380, 380)[0]!, -1),
      withDelta(entries(379, 379)[0]!, -1),
      withDelta(entries(380, 380)[0]!, 1),
    ];
    const repeatedBoundary = [withDelta(entries(379, 379)[0]!, -1)];
    const base = [...repeatedPrefix, ...repeatedBoundary, ...entries(378, 301)];
    const tail = entries(300, 300);
    const ours = [...base.slice(3), ...tail];
    const theirs = base;

    const merged = runMergeFromBase(base, ours, theirs);

    expect(merged.history).toEqual(ours);
    expect(merged.history).toHaveLength(80);
    expect(merged.history[0]).toEqual(repeatedBoundary[0]);
  });
});
