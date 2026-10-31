import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { hash } from "./shared.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const fixedDeckManifestPath = resolve(
  root,
  "scripts/ismcts/fixed-decks.json"
);
// Updating the frozen input requires a reviewed source change, not merely a
// checksum rewritten beside altered cards/seeds. This is an input contract;
// it does not certify any game, calibration, deployment or search result.
export const fixedDeckManifestHash =
  "d795be5dfcf55abec90b8c1c086933c28177c7446da98ef1710703a7f2a15fa5";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  return value;
}

export function fixedInputHash(value) {
  return hash(JSON.stringify(canonical(JSON.parse(JSON.stringify(value)))));
}

export function readFixedDeckManifest() {
  const manifest = JSON.parse(readFileSync(fixedDeckManifestPath, "utf8"));
  const { contentSha256, ...content } = manifest;
  if (
    contentSha256 !== fixedDeckManifestHash ||
    fixedInputHash(content) !== fixedDeckManifestHash
  )
    throw new Error("fixed deck manifest hash mismatch; review frozen input");
  return manifest;
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// Use the same card database, lookup construction and normal main-deck
// validator as existing training/initializeGame consumers. Loading definitions
// creates no match, budget reservation, service request or model inference.
export async function withFixedDeckCatalog(fn) {
  const server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { entries: [], noDiscovery: true },
    resolve: {
      alias: {
        "@orica/rules-core": resolve(root, "packages/rules-core/src/index.ts"),
        "@orica/card-data": resolve(root, "packages/card-data/src/index.ts"),
      },
    },
  });
  try {
    const { createTrainingEngine } = await server.ssrLoadModule(
      "/apps/cli/src/trace-smoke.ts"
    );
    const core = await server.ssrLoadModule(
      "/packages/rules-core/src/index.ts"
    );
    return await fn({
      engine: createTrainingEngine(),
      core,
      validateMainDeckDefinitions: core.validateMainDeckDefinitions,
      minDeckSize: core.MIN_DECK_SIZE,
    });
  } finally {
    await server.close();
  }
}

export function resolveFixedDecks(manifest, catalog) {
  const { contentSha256, ...content } = manifest;
  if (
    contentSha256 !== fixedDeckManifestHash ||
    fixedInputHash(content) !== fixedDeckManifestHash
  )
    throw new Error("fixed deck manifest hash mismatch; review frozen input");
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "ismcts-fixed-decks" ||
    manifest.decks.length !== 8 ||
    new Set(manifest.decks.map((deck) => deck.id)).size !== 8 ||
    typeof catalog.validateMainDeckDefinitions !== "function" ||
    !Number.isSafeInteger(catalog.minDeckSize) ||
    catalog.minDeckSize < 1
  )
    throw new Error("invalid fixed deck/catalog contract");
  const decks = manifest.decks.map((deck) => {
    if (
      !["tier1", "tier2"].includes(deck.tier) ||
      !deck.reason?.trim() ||
      deck.cardNos.length < catalog.minDeckSize ||
      fixedInputHash(deck.cardNos) !== deck.cardNosSha256
    )
      throw new Error(`invalid frozen deck input: ${deck.id}`);
    const cards = deck.cardNos.map((cardNo) => {
      const definition = catalog.engine.getCardDefinitionById(cardNo);
      if (!definition || definition.cardNo !== cardNo)
        throw new Error(`unknown/mismatched fixed deck card: ${cardNo}`);
      return definition;
    });
    const issues = catalog.validateMainDeckDefinitions(cards);
    if (issues.length)
      throw new Error(
        `invalid normal main deck ${deck.id}: ${JSON.stringify(issues)}`
      );
    if (fixedInputHash(cards) !== deck.definitionsSha256)
      throw new Error(`fixed deck definitions changed: ${deck.id}`);
    // Do not freeze the shared engine database or let a caller mutate later
    // games through this pool. Each deck owns an immutable JSON data copy.
    return {
      ...deck,
      cardNos: [...deck.cardNos],
      cards: JSON.parse(JSON.stringify(cards)),
    };
  });
  const ids = new Set(decks.map((deck) => deck.id));
  const { training, calibration, smokePairs, releasePairs } = manifest.seeds;
  const usedSeeds = new Set(calibration);
  if (
    calibration.length !== 3 ||
    usedSeeds.size !== 3 ||
    smokePairs.length !== 8 ||
    releasePairs.length !== 200 ||
    !Number.isSafeInteger(training.first) ||
    !Number.isSafeInteger(training.last) ||
    training.first < 0 ||
    training.last > 0x7fffffff ||
    training.first > training.last
  )
    throw new Error("invalid fixed seed contract");
  for (const pair of [...smokePairs, ...releasePairs]) {
    if (
      pair.decks.length !== 2 ||
      pair.decks[0] === pair.decks[1] ||
      pair.decks.some((id) => !ids.has(id)) ||
      usedSeeds.has(pair.seed)
    )
      throw new Error("invalid/duplicate fixed evaluation pair");
    usedSeeds.add(pair.seed);
  }
  for (const seed of usedSeeds)
    if (
      !Number.isSafeInteger(seed) ||
      seed < 0 ||
      seed > 0x7fffffff ||
      (seed >= training.first && seed <= training.last)
    )
      throw new Error("evaluation/calibration overlaps training seed range");
  return deepFreeze({
    manifestHash: contentSha256,
    source: { ...manifest.source },
    decks,
    seeds: JSON.parse(JSON.stringify(manifest.seeds)),
  });
}

export async function loadFixedDecks() {
  return withFixedDeckCatalog((catalog) =>
    resolveFixedDecks(readFixedDeckManifest(), catalog)
  );
}

export function fixedEvaluationGames(pool, phase) {
  if (!["smoke", "release"].includes(phase))
    throw new Error("unknown fixed evaluation phase");
  const frozen = readFixedDeckManifest();
  if (
    pool.manifestHash !== fixedDeckManifestHash ||
    fixedInputHash(pool.source) !== fixedInputHash(frozen.source) ||
    fixedInputHash(pool.seeds) !== fixedInputHash(frozen.seeds) ||
    fixedInputHash(pool.decks.map((deck) => deck.id)) !==
      fixedInputHash(frozen.decks.map((deck) => deck.id))
  )
    throw new Error("evaluation pool differs from frozen input");
  for (const [index, deck] of pool.decks.entries()) {
    const { cards, ...metadata } = deck;
    const expected = frozen.decks[index];
    if (
      fixedInputHash(metadata) !== fixedInputHash(expected) ||
      !Array.isArray(cards) ||
      fixedInputHash(cards) !== expected.definitionsSha256
    )
      throw new Error("evaluation pool differs from frozen input");
  }
  return evaluationSchedule(frozen, phase);
}

// Manifest-only scheduling lets admission bind a game before loading the card
// catalog. Executing it still requires resolveFixedDecks' normal validation.
export function fixedEvaluationSchedule(phase) {
  if (!["smoke", "release"].includes(phase))
    throw new Error("unknown fixed evaluation phase");
  return evaluationSchedule(readFixedDeckManifest(), phase);
}

function evaluationSchedule(frozen, phase) {
  // This is immutable input, not an evaluation result. Both seats use the
  // same pair/seed; every attempt must later be retained by the runner.
  return deepFreeze(
    frozen.seeds[`${phase}Pairs`].flatMap((pair, index) =>
      [0, 1].map((seat) => ({
        id: `${phase}-${index}-${seat}`,
        pairId: `${phase}-${index}`,
        seed: pair.seed,
        seat,
        decks: seat === 0 ? [...pair.decks] : [...pair.decks].reverse(),
      }))
    )
  );
}
