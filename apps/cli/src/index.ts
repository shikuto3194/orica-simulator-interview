import { pathToFileURL } from "node:url";

import { SAMPLE_CARDS } from "@orica/card-data";
import {
  advanceStep,
  createEmptyGameState,
  summarizeGameState,
} from "@orica/rules-core";

export function createCliReport(): string {
  const initialState = createEmptyGameState();
  const nextState = advanceStep(
    initialState,
    () => undefined,
    () => []
  );
  const lines = [
    "orica-simulator CLI",
    "====================",
    summarizeGameState(initialState),
    `next => ${summarizeGameState(nextState)}`,
    "",
    "sample cards:",
    ...SAMPLE_CARDS.map(
      (card) => `- ${card.cardNo}: ${card.name} [${card.printedCategory}]`
    ),
  ];

  return lines.join("\n");
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];

  if (!entryPath) {
    return false;
  }

  return import.meta.url === pathToFileURL(entryPath).href;
}

if (isDirectExecution()) {
  console.log(createCliReport());
}
