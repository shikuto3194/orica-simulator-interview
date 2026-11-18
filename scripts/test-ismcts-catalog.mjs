import assert from "node:assert/strict";
import { testFixedDecks } from "./ismcts/test-fixed-decks.mjs";
import { testFixedSmoke } from "./ismcts/test-fixed-smoke.mjs";
// These are the two existing suites that load current card/engine definitions.
// OS containment, resource reservations, telemetry and storage retain their
// unchanged original suite; this entry never represents those as passing.
const decks = await testFixedDecks();
assert.equal(decks.executed, true);
assert.equal(decks.completed, 16);
assert.equal((await testFixedSmoke()).completed, 6);
console.log(
  "ISMCTS_CATALOG_TEST_RESULT " + JSON.stringify({ completed: 22, failed: 0 })
);
