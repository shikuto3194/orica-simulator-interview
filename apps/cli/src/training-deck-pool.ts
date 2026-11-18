import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { CardDefinition, Engine, Rng } from "@orica/rules-core";

import type { TrainingDeckSelectionSetName } from "./training-config";

export interface TrainingDeckDescriptor {
  id: string;
  name: string;
  archetype: string;
  variant: string | null;
  tier: string;
  effectiveWeight: number;
  cardCount: number;
}

export interface ResolvedTrainingDeck extends TrainingDeckDescriptor {
  cardNos: readonly string[];
  cards: readonly CardDefinition[];
}

export interface TrainingDeckPool {
  sourcePath: string;
  setName: TrainingDeckSelectionSetName;
  exportedAt: string | null;
  tierSource: {
    path: string | null;
    latestEntry: string | null;
  };
  decks: readonly ResolvedTrainingDeck[];
}

interface SelectionSetDeckSummary {
  id: string;
  effectiveWeight?: number;
}

interface SelectionArtifactDeck {
  id: string;
  name?: string;
  archetype?: string;
  variant?: string | null;
  tier?: string;
  effectiveWeight?: number;
  tierWeight?: number;
  sanitizedCardNos?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseJsonObject(text: string, path: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `${path}: invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
  if (!isRecord(value)) throw new Error(`${path}: artifact must be an object`);
  return value;
}

function parseSelectionSet(
  artifact: Record<string, unknown>,
  setName: TrainingDeckSelectionSetName,
  path: string
): SelectionSetDeckSummary[] {
  const selectionSets = artifact.selectionSets;
  if (!isRecord(selectionSets)) {
    throw new Error(`${path}: selectionSets must be an object`);
  }
  const setValue = selectionSets[setName];
  if (!Array.isArray(setValue)) {
    throw new Error(`${path}: selectionSets.${setName} must be an array`);
  }
  return setValue.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      throw new Error(`${path}: selectionSets.${setName}[${index}].id missing`);
    }
    return {
      id: entry.id,
      effectiveWeight: finiteNumber(entry.effectiveWeight, 1),
    };
  });
}

function parseDecksById(
  artifact: Record<string, unknown>,
  path: string
): Map<string, SelectionArtifactDeck> {
  const decks = artifact.decks;
  if (!Array.isArray(decks)) throw new Error(`${path}: decks must be an array`);
  const byId = new Map<string, SelectionArtifactDeck>();
  for (const [index, value] of decks.entries()) {
    if (!isRecord(value) || typeof value.id !== "string") {
      throw new Error(`${path}: decks[${index}].id missing`);
    }
    byId.set(value.id, {
      id: value.id,
      ...(typeof value.name === "string" ? { name: value.name } : {}),
      ...(typeof value.archetype === "string"
        ? { archetype: value.archetype }
        : {}),
      ...(typeof value.variant === "string" || value.variant === null
        ? { variant: value.variant }
        : {}),
      ...(typeof value.tier === "string" ? { tier: value.tier } : {}),
      ...(typeof value.effectiveWeight === "number"
        ? { effectiveWeight: value.effectiveWeight }
        : {}),
      ...(typeof value.tierWeight === "number"
        ? { tierWeight: value.tierWeight }
        : {}),
      sanitizedCardNos: value.sanitizedCardNos,
    });
  }
  return byId;
}

function resolveCardNos(args: {
  path: string;
  deck: SelectionArtifactDeck;
  engine: Engine;
}): CardDefinition[] {
  if (!Array.isArray(args.deck.sanitizedCardNos)) {
    throw new Error(
      `${args.path}: deck ${args.deck.id} sanitizedCardNos missing`
    );
  }

  const cards: CardDefinition[] = [];
  const missing = new Map<string, number>();
  for (const value of args.deck.sanitizedCardNos) {
    if (typeof value !== "string") {
      throw new Error(
        `${args.path}: deck ${args.deck.id} sanitizedCardNos contains non-string`
      );
    }
    const definition = args.engine.getCardDefinitionById(value);
    if (definition) {
      cards.push(definition);
    } else {
      missing.set(value, (missing.get(value) ?? 0) + 1);
    }
  }

  if (missing.size > 0) {
    const sample = [...missing.entries()]
      .slice(0, 12)
      .map(([cardNo, count]) => `${cardNo}x${count}`)
      .join(", ");
    throw new Error(
      `${args.path}: deck ${args.deck.name ?? args.deck.id} has unknown cardNo(s): ${sample}`
    );
  }
  if (cards.length === 0) {
    throw new Error(
      `${args.path}: deck ${args.deck.name ?? args.deck.id} is empty`
    );
  }
  return cards;
}

function deckDescriptor(
  deck: SelectionArtifactDeck,
  summary: SelectionSetDeckSummary,
  cards: readonly CardDefinition[]
): TrainingDeckDescriptor {
  const weight = finiteNumber(
    deck.effectiveWeight,
    finiteNumber(summary.effectiveWeight, finiteNumber(deck.tierWeight, 1))
  );
  return {
    id: deck.id,
    name: stringValue(deck.name, deck.id),
    archetype: stringValue(deck.archetype, "unknown"),
    variant: nullableString(deck.variant),
    tier: stringValue(deck.tier, "unknown"),
    effectiveWeight: weight > 0 ? weight : 1,
    cardCount: cards.length,
  };
}

export function summarizeTrainingDeck(
  deck: ResolvedTrainingDeck
): TrainingDeckDescriptor {
  return {
    id: deck.id,
    name: deck.name,
    archetype: deck.archetype,
    variant: deck.variant,
    tier: deck.tier,
    effectiveWeight: deck.effectiveWeight,
    cardCount: deck.cardCount,
  };
}

export async function loadTrainingDeckPool(args: {
  path: string;
  setName: TrainingDeckSelectionSetName;
  engine: Engine;
}): Promise<TrainingDeckPool> {
  const sourcePath = resolve(args.path);
  const artifact = parseJsonObject(
    await readFile(sourcePath, "utf8"),
    sourcePath
  );
  if (artifact.schemaVersion !== 1) {
    throw new Error(`${sourcePath}: schemaVersion must be 1`);
  }

  const summaries = parseSelectionSet(artifact, args.setName, sourcePath);
  const decksById = parseDecksById(artifact, sourcePath);
  const decks = summaries.map((summary) => {
    const deck = decksById.get(summary.id);
    if (!deck) {
      throw new Error(
        `${sourcePath}: selectionSets.${args.setName} references missing deck ${summary.id}`
      );
    }
    const cards = resolveCardNos({
      path: sourcePath,
      deck,
      engine: args.engine,
    });
    const descriptor = deckDescriptor(deck, summary, cards);
    return {
      ...descriptor,
      cardNos: cards.map((card) => card.cardNo),
      cards,
    } satisfies ResolvedTrainingDeck;
  });
  if (decks.length === 0) {
    throw new Error(`${sourcePath}: selectionSets.${args.setName} is empty`);
  }

  const tierSource = isRecord(artifact.tierSource) ? artifact.tierSource : {};
  return {
    sourcePath,
    setName: args.setName,
    exportedAt: nullableString(artifact.exportedAt),
    tierSource: {
      path: nullableString(tierSource.path),
      latestEntry: nullableString(tierSource.latestEntry),
    },
    decks,
  };
}

export function chooseTrainingDeck(
  pool: TrainingDeckPool,
  rng: Rng,
  excludeDeckId?: string
): ResolvedTrainingDeck {
  const candidates =
    excludeDeckId === undefined
      ? pool.decks
      : pool.decks.filter((deck) => deck.id !== excludeDeckId);
  const usable = candidates.length > 0 ? candidates : pool.decks;
  const totalWeight = usable.reduce(
    (sum, deck) => sum + Math.max(0, deck.effectiveWeight),
    0
  );
  if (totalWeight <= 0) return usable[Math.floor(rng() * usable.length)]!;

  let cursor = rng() * totalWeight;
  for (const deck of usable) {
    cursor -= Math.max(0, deck.effectiveWeight);
    if (cursor <= 0) return deck;
  }
  return usable[usable.length - 1]!;
}

export function cloneTrainingDeckCards(
  deck: ResolvedTrainingDeck
): CardDefinition[] {
  return [...deck.cards];
}
