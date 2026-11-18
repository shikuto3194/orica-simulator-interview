import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createTrainingEngine } from "../src/trace-smoke";

function fixtureCardNos(): string[] {
  const cardNos = createTrainingEngine()
    .cards.filter((card) => (card.maxTokenDeckCount ?? 0) <= 0)
    .slice(0, 24)
    .map((card) => card.cardNo);
  if (cardNos.length < 24) {
    throw new Error("deck selection fixture requires at least 24 cards");
  }
  return cardNos;
}

export async function writeDeckSelectionFixture(root: string): Promise<string> {
  const cardNos = fixtureCardNos();
  const deckA = cardNos.slice(0, 12);
  const deckB = cardNos.slice(12, 24);
  const artifact = {
    schemaVersion: 1,
    exportedAt: "2026-08-15T00:00:00.000Z",
    tierSource: {
      path: "fixture-tier.md",
      latestEntry: "fixture",
    },
    decks: [
      {
        id: "deck-a",
        name: "Fixture Alpha",
        archetype: "Alpha",
        variant: null,
        tier: "tier1",
        tierWeight: 1,
        effectiveWeight: 1,
        sanitizedCardNos: deckA,
        sanitizedTotal: deckA.length,
      },
      {
        id: "deck-b",
        name: "Fixture Beta",
        archetype: "Beta",
        variant: null,
        tier: "tier2",
        tierWeight: 0.65,
        effectiveWeight: 0.65,
        sanitizedCardNos: deckB,
        sanitizedTotal: deckB.length,
      },
    ],
    selectionSets: {
      bootstrapSmoke: [
        { id: "deck-a", effectiveWeight: 1 },
        { id: "deck-b", effectiveWeight: 0.65 },
      ],
      policyBootstrap: [
        { id: "deck-a", effectiveWeight: 1 },
        { id: "deck-b", effectiveWeight: 0.65 },
      ],
      gauntletCore: [
        { id: "deck-a", effectiveWeight: 1 },
        { id: "deck-b", effectiveWeight: 0.65 },
      ],
      gauntletExtended: [
        { id: "deck-a", effectiveWeight: 1 },
        { id: "deck-b", effectiveWeight: 0.65 },
      ],
      robustnessOnly: [{ id: "deck-b", effectiveWeight: 0.65 }],
    },
  };
  const path = join(root, "selected-decks.json");
  await writeFile(path, JSON.stringify(artifact, null, 2), "utf8");
  return path;
}
