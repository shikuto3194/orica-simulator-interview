import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findAiSearchStateFieldIssues } from "../../../scripts/ai-search-state-fields.mjs";
import { AI_SEARCH_STATE_FIELD_POLICIES } from "../src/ai-search-state-fields";

const model = readFileSync("packages/rules-core/src/model.ts", "utf8");
const registry = readFileSync(
  "packages/rules-core/src/ai-search-state-fields.ts",
  "utf8"
);
function edit(source: string, before: string, after: string) {
  expect(source).toContain(before);
  return source.replace(before, after);
}
function addField(field: string) {
  return edit(
    model,
    "export interface GameState {",
    `export interface GameState {\n${field}`
  );
}

describe("I1 search source-field inventory (not H1-H3 acceptance)", () => {
  it("classifies every real GameState field and freezes the registry", () => {
    expect(findAiSearchStateFieldIssues(model, registry)).toEqual([]);
    expect(Object.isFrozen(AI_SEARCH_STATE_FIELD_POLICIES)).toBe(true);
  });

  it.each([
    "futureSecret?: string;",
    "pendingFutureSecret: { hiddenCardId: string };",
  ])("rejects an unclassified field: %s", (field) => {
    expect(findAiSearchStateFieldIssues(addField(field), registry)).toEqual([
      `unclassified GameState field: ${field.split(/[?:]/)[0]}`,
    ]);
  });

  it("rejects a deleted field that is still in the registry", () => {
    const changed = edit(model, "  turnNumberHighWaterMark?: number;", "");
    expect(findAiSearchStateFieldIssues(changed, registry)).toEqual([
      "unknown registry field: turnNumberHighWaterMark",
    ]);
  });

  it("does not infer a default policy for new optional fields", () => {
    const changedModel = addField("futureSecret?: string;");
    const changedRegistry = edit(
      registry,
      "  viewerLegalActions:",
      '  futureSecret: "excluded",\n  viewerLegalActions:'
    );
    expect(findAiSearchStateFieldIssues(changedModel, changedRegistry)).toEqual(
      []
    );
  });

  it.each([
    [
      'turnNumber: "public"',
      'turnNumber: "copy_raw"',
      "invalid field policy: turnNumber",
    ],
    [
      'turnNumber: "public"',
      "turnNumber: getPolicy()",
      "invalid field policy: turnNumber",
    ],
    [
      'turnNumber: "public"',
      'turnNumber: "public", turnNumber: "excluded"',
      "duplicate registry field: turnNumber",
    ],
    [
      'turnNumber: "public"',
      '...otherPolicies, turnNumber: "public"',
      "unsupported registry property",
    ],
  ])(
    "rejects invalid or implicit registry syntax: %s",
    (before, after, issue) => {
      expect(
        findAiSearchStateFieldIssues(model, edit(registry, before, after))
      ).toContain(issue);
    }
  );

  it("fails closed on inheritance, index signatures and malformed input", () => {
    expect(
      findAiSearchStateFieldIssues(
        edit(
          model,
          "interface GameState {",
          "interface GameState extends SecretState {"
        ),
        registry
      )
    ).toContain("GameState inheritance requires review");
    expect(
      findAiSearchStateFieldIssues(
        addField("[key: string]: unknown;"),
        registry
      )
    ).toContain("unsupported GameState member");
    expect(
      findAiSearchStateFieldIssues("export interface GameState {", registry)
    ).toContain("invalid TypeScript source");
    expect(findAiSearchStateFieldIssues("", registry)).toContain(
      "GameState interface missing"
    );
  });

  it("requires nested projection for pending, stack, usage, history and snapshots", () => {
    for (const field of [
      "pendingDeckReveal",
      "pendingPrivateDeclarations",
      "stackWindow",
      "effectUsageRecords",
      "effectOccurrenceRecords",
      "publicDisclosures",
      "knownDeckCards",
      "preGame",
      "extraTurnState",
      "gameResult",
    ] as const)
      expect(AI_SEARCH_STATE_FIELD_POLICIES[field]).toBe("viewer-private");
    expect(AI_SEARCH_STATE_FIELD_POLICIES.cardInstances).toBe("sampled");
    expect(AI_SEARCH_STATE_FIELD_POLICIES.log).toBe("excluded");
    expect(AI_SEARCH_STATE_FIELD_POLICIES.viewerLegalActions).toBe("excluded");
  });
});
