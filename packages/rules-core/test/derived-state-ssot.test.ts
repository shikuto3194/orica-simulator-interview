import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DERIVED_STATE_FILES,
  findDerivedStateSsotIssues,
} from "../../../scripts/derived-state-ssot.mjs";

const sources = new Map<string, string>(
  Object.values(DERIVED_STATE_FILES).map((file) => [
    file as string,
    readFileSync(file as string, "utf8"),
  ])
);
function changed(file: string, edit: (source: string) => string) {
  const result = new Map(sources);
  const before = sources.get(file)!;
  const after = edit(before);
  expect(after).not.toBe(before);
  result.set(file, after);
  return findDerivedStateSsotIssues(result);
}
describe("check:ssot derived-state ownership", () => {
  const deckKnowledgeFile =
    "packages/rules-core/src/ai-search-deck-knowledge.ts";
  const deckKnowledgeSource = readFileSync(deckKnowledgeFile, "utf8");
  it("permits only validated copies of observed counts in the search constraint helper", () => {
    const testSources = new Map(sources);
    testSources.set(deckKnowledgeFile, deckKnowledgeSource);
    expect(findDerivedStateSsotIssues(testSources)).toEqual([]);
  });
  it("preserves literal meaning while allowing formatting-only copy changes", () => {
    const testSources = new Map(sources);
    testSources.set(
      deckKnowledgeFile,
      deckKnowledgeSource.replace(
        'count(data(player, "handCount"))',
        "count(\n data( player, 'handCount' )\n )"
      )
    );
    expect(findDerivedStateSsotIssues(testSources)).toEqual([]);
  });
  it.each([
    [
      'count(data(player, "handCount"))',
      'count(data(player, "handCount")) + 1',
    ],
    ['count(data(player, "deckCount"))', "player.deckCount"],
    ['count(data(player, "handCount"))', 'count(data(player, "hand Count"))'],
    [
      "function projectObservedZoneCounts(player: AiPlayerFeatures) {",
      "function projectObservedZoneCounts(player: AiPlayerFeatures, count = (v: number) => v + 1) {",
    ],
    [
      "function projectObservedZoneCounts(player: AiPlayerFeatures) {",
      "function projectObservedZoneCounts(player: AiPlayerFeatures) { const count = (v: number) => v + 1;",
    ],
    [
      "function projectObservedZoneCounts(player: AiPlayerFeatures) {",
      "function projectObservedZoneCounts(player: AiPlayerFeatures) { player.handCount++;",
    ],
  ])(
    "rejects computed or in-place state count writes in the same helper: %s",
    (before, after) => {
      const testSources = new Map(sources);
      expect(deckKnowledgeSource).toContain(before);
      testSources.set(
        deckKnowledgeFile,
        deckKnowledgeSource.replace(before, after)
      );
      expect(findDerivedStateSsotIssues(testSources)).not.toEqual([]);
    }
  );
  it("rejects a nested helper that shadows module validators", () => {
    const testSources = new Map(sources);
    testSources.set(
      deckKnowledgeFile,
      `${deckKnowledgeSource}\nfunction outer(count) { function projectObservedZoneCounts(player) { return { handCount: count(data(player, "handCount")), deckCount: count(data(player, "deckCount")) }; } return projectObservedZoneCounts; }`
    );
    expect(findDerivedStateSsotIssues(testSources)).not.toEqual([]);
  });
  it("does not exempt unrelated functions or another module with the same helper name", () => {
    for (const file of [
      deckKnowledgeFile,
      "packages/rules-core/src/foreign-writer.ts",
    ]) {
      const testSources = new Map(sources);
      testSources.set(
        file,
        `${file === deckKnowledgeFile ? deckKnowledgeSource : ""}\nfunction ${file === deckKnowledgeFile ? "otherWriter" : "projectObservedZoneCounts"}(player) { return { handCount: count(data(player, "handCount")) }; }`
      );
      expect(findDerivedStateSsotIssues(testSources)).not.toEqual([]);
    }
  });
  const searchFieldFile = "packages/rules-core/src/ai-search-state-fields.ts";
  const searchFieldSource = readFileSync(searchFieldFile, "utf8");
  it("探索用fieldのトップレベル文字列分類を盤面更新へ読み替えない", () => {
    const testSources = new Map(sources);
    testSources.set(searchFieldFile, searchFieldSource);
    expect(findDerivedStateSsotIssues(testSources)).toEqual([]);
  });
  it.each([
    "return {...state, cardInstances: cards}",
    "return {...state, zoneCountMode: 'abstract'}",
    "state.cardInstances = cards",
    "state.zoneCountMode = 'abstract'",
    "const AI_SEARCH_STATE_FIELD_POLICIES = {cardInstances: 'sampled'}; return AI_SEARCH_STATE_FIELD_POLICIES",
  ])("分類正源内でも実状態の更新と局所の偽分類を拒否する: %s", (body) => {
    const testSources = new Map(sources);
    testSources.set(
      searchFieldFile,
      `${searchFieldSource}\nfunction update(state, cards) { ${body}; }`
    );
    expect(findDerivedStateSsotIssues(testSources)).not.toEqual([]);
  });
  it("分類値へ実カード配列を混入した場合も拒否する", () => {
    const testSources = new Map(sources);
    testSources.set(
      searchFieldFile,
      searchFieldSource.replace(
        'cardInstances: "sampled"',
        "cardInstances: cards"
      )
    );
    expect(findDerivedStateSsotIssues(testSources)).not.toEqual([]);
  });
  it("実際の共通処理はすべての検査に通る", () => {
    expect(findDerivedStateSsotIssues(sources)).toEqual([]);
  });
  it("同期を迂回するreturnを拒否する", () => {
    expect(
      changed(DERIVED_STATE_FILES.rebuild, (s) =>
        s.replace(
          "return finalizeContinuousEffectRebuild(current, getCardDefinitionById);",
          "return current;"
        )
      )
    ).not.toEqual([]);
  });
  it("追加された早期returnも拒否する", () => {
    expect(
      changed(DERIVED_STATE_FILES.rebuild, (s) =>
        s.replace(
          "const narrowedSourceIds =",
          "if (sourceInstanceIds.size === 0) return state;\n const narrowedSourceIds ="
        )
      )
    ).not.toEqual([]);
  });
  it("共通finalizerから再計算を削除した退行を拒否する", () => {
    expect(
      changed(DERIVED_STATE_FILES.rebuild, (s) =>
        s.replace(
          "return recomputeBattleEntityBp(current, getCardDefinitionById);",
          "// recomputeBattleEntityBp(current, getCardDefinitionById)\n return current;"
        )
      )
    ).not.toEqual([]);
  });
  it("finalizer内の早期returnも拒否する", () => {
    expect(
      changed(DERIVED_STATE_FILES.rebuild, (s) =>
        s.replace(
          "return recomputeBattleEntityBp(current, getCardDefinitionById);",
          "if (!current.battle) return current;\n return recomputeBattleEntityBp(current, getCardDefinitionById);"
        )
      )
    ).not.toEqual([]);
  });
  it("CE配列だけをキーとするキャッシュを拒否する", () => {
    expect(
      changed(DERIVED_STATE_FILES.battle, (s) =>
        s.replace(
          "identityCache.get(state)",
          "identityCache.get(state.activeContinuousEffects)"
        )
      )
    ).not.toEqual([]);
  });
  it("lookupが変わった場合の検査削除を拒否する", () => {
    expect(
      changed(DERIVED_STATE_FILES.battle, (s) =>
        s.replace(/cached\.lookup\s*===\s*getCardDefinitionById/, "true")
      )
    ).not.toEqual([]);
  });
  it("不変条件の配線をコメントで代用できない", () => {
    expect(
      changed(DERIVED_STATE_FILES.invariants, (s) =>
        s.replace(
          /collectBattleEntityDerivedValueIssues\(\{[\s\S]*?\}\);/,
          "// collectBattleEntityDerivedValueIssues({ state });"
        )
      )
    ).not.toEqual([]);
  });
  it.each([
    "state.cardInstances.push(card)",
    "state.activeContinuousEffects = next",
    "const rows = state.effectUsageRecords; rows.splice(0, 1)",
    "state.cardInstances[0] = card",
    "state.activeContinuousEffects.length = 0",
  ])("キャッシュ元の破壊的更新を拒否する: %s", (body) => {
    const testSources = new Map(sources);
    testSources.set(
      "packages/rules-core/src/new-handler.ts",
      `export function update(state, card, next) { ${body}; }`
    );
    expect(findDerivedStateSsotIssues(testSources)).not.toEqual([]);
  });
  it("共通配列更新とコメント中の例は許可する", () => {
    const testSources = new Map(sources);
    testSources.set(
      "packages/rules-core/src/new-handler.ts",
      "// state.cardInstances.push(card)\n export function update(state, card) { return replaceCardInstances(state, [...state.cardInstances, card]); }"
    );
    expect(findDerivedStateSsotIssues(testSources)).toEqual([]);
  });
  it.each([
    "return {...state, cardInstances: cards}",
    "return {...player, handCount: player.handCount + 1}",
    "return {...player, deckCount}",
    "return {...state, zoneCountMode: 'abstract'}",
    "player.handCount++",
    "player['deckCount'] -= 1",
  ])("共通所有者を迂回する個別同期を拒否する: %s", (body) => {
    const testSources = new Map(sources);
    testSources.set(
      "packages/rules-core/src/new-handler.ts",
      `function update(state, player, cards, deckCount) { ${body}; }`
    );
    expect(findDerivedStateSsotIssues(testSources)).not.toEqual([]);
  });
});
