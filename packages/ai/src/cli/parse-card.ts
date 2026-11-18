#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_CARDS } from "@orica/card-data";
import type { CardDefinition } from "@orica/rules-core";
import { parseCardToEffects } from "../parsers/card-to-effects.js";
import type { CardParseFewShot } from "../prompts/card-parse.js";

interface Args {
  cardNo: string | undefined;
  apply: boolean;
  proposalsDir: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const DEFAULT_PROPOSALS_DIR = join(REPO_ROOT, "packages/card-data/proposals");

function parseArgs(argv: string[]): Args {
  const args: Args = {
    cardNo: undefined,
    apply: false,
    proposalsDir: DEFAULT_PROPOSALS_DIR,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--card") args.cardNo = argv[++i];
    else if (a === "--apply") args.apply = argv[++i] === "true";
    else if (a === "--proposals-dir")
      args.proposalsDir = argv[++i] ?? args.proposalsDir;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.cardNo) {
    console.error(
      "usage: orica-ai-parse-card --card BSTH05-X01 [--apply true]"
    );
    process.exit(2);
  }
  const target = ALL_CARDS.find((c) => c.cardNo === args.cardNo);
  if (!target) {
    console.error(`[parse-card] cardNo not found: ${args.cardNo}`);
    process.exit(3);
  }
  const fewShots = selectFewShots(ALL_CARDS, target);
  console.warn(`[parse-card] using ${fewShots.length} few-shots`);

  const result = await parseCardToEffects({
    cardNo: target.cardNo,
    cardName: target.name ?? target.cardNo,
    textLines: target.textLines ?? [],
    fewShots,
  });

  await mkdir(args.proposalsDir, { recursive: true });
  const ext = result.ok ? "json" : "error.json";
  const outPath = join(args.proposalsDir, `${args.cardNo}.${ext}`);
  await writeFile(
    outPath,
    JSON.stringify(
      result.ok
        ? {
            cardNo: result.cardNo,
            effects: result.output,
            repaired: result.repaired,
          }
        : {
            cardNo: result.cardNo,
            error: result.error,
            repaired: result.repaired,
            rawJson: result.rawJson,
          },
      null,
      2
    ) + "\n",
    "utf8"
  );
  if (result.ok) {
    console.warn(`[parse-card] OK → ${outPath} (repaired=${result.repaired})`);
  } else {
    console.error(
      `[parse-card] FAILED → ${outPath} (repaired=${result.repaired})`
    );
    console.error(`  error: ${result.error}`);
    process.exit(4);
  }
}

function selectFewShots(
  all: CardDefinition[],
  target: CardDefinition
): CardParseFewShot[] {
  const candidates = all.filter(
    (c) =>
      c.cardNo !== target.cardNo &&
      Array.isArray(c.effects) &&
      c.effects.length > 0 &&
      Array.isArray(c.textLines) &&
      c.textLines.length > 0
  );
  candidates.sort(
    (a, b) => (a.effects?.length ?? 0) - (b.effects?.length ?? 0)
  );
  return candidates.slice(0, 6).map((c) => ({
    cardNo: c.cardNo,
    cardName: c.name ?? c.cardNo,
    textLines: c.textLines ?? [],
    effectsJson: JSON.stringify({ effects: c.effects }, null, 2),
  }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
