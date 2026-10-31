/**
 * P4-02 デルタ同期 (JSON Patch) の費用対効果計測。
 * 典型的なアクション前後の GameState JSON サイズと差分サイズを比較する。
 */
import { describe, it, expect } from "vitest";
import { compare as fjpCompare, applyPatch } from "fast-json-patch";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  EffectUsageRecord,
  GameState,
} from "../src/model";

// --- Helpers ---

function makeDef(
  cardNo: string,
  category: "spirit" | "magic" | "nexus" | "brave" = "spirit"
): CardDefinition {
  return {
    cardNo,
    name: `Test ${cardNo}`,
    printedCategory: category,
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C" as const,
  };
}

function makeFieldCard(i: number, playerId: string): CardInstance {
  return createCardInstance(makeDef(`field-${playerId}-${i}`), {
    instanceId: `${playerId}-field-${i}`,
    ownerPlayerId: playerId,
    zone: "field",
    normalCoreCount: 2,
  });
}

function makeHandCard(i: number, playerId: string): CardInstance {
  return createCardInstance(makeDef(`hand-${playerId}-${i}`), {
    instanceId: `${playerId}-hand-${i}`,
    ownerPlayerId: playerId,
    zone: "hand",
  });
}

function makeDeckCard(i: number, playerId: string): CardInstance {
  return createCardInstance(makeDef(`deck-${playerId}-${i}`), {
    instanceId: `${playerId}-deck-${i}`,
    ownerPlayerId: playerId,
    zone: "deck",
  });
}

function makeCE(i: number, targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `ce-${i}`,
    sourceInstanceId: `source-${i}`,
    sourceDefinitionId: `def-${i}`,
    actingPlayerId: "alice",
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "bp_modifier",
    modifierAmount: i % 2 === 0 ? 1000 : -500,
    targetInstanceId,
  };
}

function makeUsageRecord(i: number): EffectUsageRecord {
  return {
    sourceInstanceId: `alice-field-${i % 5}`,
    sourceDefinitionId: `field-alice-${i % 5}`,
    effectLabel: `spirit:${i % 3}`,
    turnNumber: 1,
    step: "main",
    duration: "turn",
    count: 1,
  };
}

/** 簡易 JSON Patch 生成: 2つの JSON 文字列から RFC 6902 相当のパッチを計算 */
function computeJsonPatchSize(
  before: unknown,
  after: unknown
): {
  patchOps: number;
  patchJsonSize: number;
} {
  const ops: Array<{ op: string; path: string; value?: unknown }> = [];
  diffObjects(before, after, "", ops);
  const patchJson = JSON.stringify(ops);
  return { patchOps: ops.length, patchJsonSize: patchJson.length };
}

function diffObjects(
  a: unknown,
  b: unknown,
  path: string,
  ops: Array<{ op: string; path: string; value?: unknown }>
): void {
  if (a === b) return;
  if (a === null || b === null || typeof a !== typeof b) {
    ops.push({ op: "replace", path: path || "/", value: b });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    // For arrays, if lengths differ or elements differ, replace the whole array
    // (real fast-json-patch does finer diffs, but this gives a conservative estimate)
    if (a.length !== b.length) {
      ops.push({ op: "replace", path, value: b });
      return;
    }
    for (let i = 0; i < a.length; i++) {
      diffObjects(a[i], b[i], `${path}/${i}`, ops);
    }
    return;
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const key of allKeys) {
      const escapedKey = key.replace(/~/g, "~0").replace(/\//g, "~1");
      if (!(key in aObj)) {
        ops.push({
          op: "add",
          path: `${path}/${escapedKey}`,
          value: bObj[key],
        });
      } else if (!(key in bObj)) {
        ops.push({ op: "remove", path: `${path}/${escapedKey}` });
      } else {
        diffObjects(aObj[key], bObj[key], `${path}/${escapedKey}`, ops);
      }
    }
    return;
  }
  if (a !== b) {
    ops.push({ op: "replace", path, value: b });
  }
}

// --- Scenarios ---

function createEarlyGameState(): GameState {
  const cards: CardInstance[] = [];
  // alice: hand 4, deck 36
  for (let i = 0; i < 4; i++) cards.push(makeHandCard(i, "alice"));
  for (let i = 0; i < 36; i++) cards.push(makeDeckCard(i, "alice"));
  // bob: hand 4, deck 36
  for (let i = 0; i < 4; i++) cards.push(makeHandCard(i, "bob"));
  for (let i = 0; i < 36; i++) cards.push(makeDeckCard(i, "bob"));

  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
  });
  return {
    ...base,
    step: "core" as const,
    window: "none" as const,
    activePlayerId: "alice",
    turnNumber: 1,
    log: ["game:initialized:first:alice"],
  };
}

function createMidGameState(): GameState {
  const cards: CardInstance[] = [];
  // alice: field 5, hand 3, deck 20, trash 12
  for (let i = 0; i < 5; i++) cards.push(makeFieldCard(i, "alice"));
  for (let i = 0; i < 3; i++) cards.push(makeHandCard(i, "alice"));
  for (let i = 0; i < 20; i++) cards.push(makeDeckCard(i, "alice"));
  for (let i = 0; i < 12; i++) {
    cards.push(
      createCardInstance(makeDef(`trash-alice-${i}`), {
        instanceId: `alice-trash-${i}`,
        ownerPlayerId: "alice",
        zone: "trash",
      })
    );
  }
  // bob: field 4, hand 2, deck 22, trash 12
  for (let i = 0; i < 4; i++) cards.push(makeFieldCard(i, "bob"));
  for (let i = 0; i < 2; i++) cards.push(makeHandCard(i, "bob"));
  for (let i = 0; i < 22; i++) cards.push(makeDeckCard(i, "bob"));
  for (let i = 0; i < 12; i++) {
    cards.push(
      createCardInstance(makeDef(`trash-bob-${i}`), {
        instanceId: `bob-trash-${i}`,
        ownerPlayerId: "bob",
        zone: "trash",
      })
    );
  }

  const ces: ContinuousEffect[] = [];
  for (let i = 0; i < 15; i++) {
    const target = i < 8 ? `alice-field-${i % 5}` : `bob-field-${i % 4}`;
    ces.push(makeCE(i, target));
  }

  const usageRecords: EffectUsageRecord[] = [];
  for (let i = 0; i < 10; i++) usageRecords.push(makeUsageRecord(i));

  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
  });

  const logEntries: string[] = [];
  for (let i = 0; i < 80; i++) {
    logEntries.push(
      `action:${i}:play:${Math.floor(i / 10)}:alice:main:summon:card-${i}`
    );
  }

  return {
    ...base,
    step: "main" as const,
    window: "none" as const,
    activePlayerId: "alice",
    turnNumber: 6,
    activeContinuousEffects: ces,
    effectUsageRecords: usageRecords,
    log: logEntries,
  };
}

function createLateGameState(): GameState {
  const cards: CardInstance[] = [];
  // alice: field 8, hand 2, deck 10, trash 20
  for (let i = 0; i < 8; i++) cards.push(makeFieldCard(i, "alice"));
  for (let i = 0; i < 2; i++) cards.push(makeHandCard(i, "alice"));
  for (let i = 0; i < 10; i++) cards.push(makeDeckCard(i, "alice"));
  for (let i = 0; i < 20; i++) {
    cards.push(
      createCardInstance(makeDef(`trash-alice-${i}`), {
        instanceId: `alice-trash-${i}`,
        ownerPlayerId: "alice",
        zone: "trash",
      })
    );
  }
  // bob: field 6, hand 3, deck 12, trash 19
  for (let i = 0; i < 6; i++) cards.push(makeFieldCard(i, "bob"));
  for (let i = 0; i < 3; i++) cards.push(makeHandCard(i, "bob"));
  for (let i = 0; i < 12; i++) cards.push(makeDeckCard(i, "bob"));
  for (let i = 0; i < 19; i++) {
    cards.push(
      createCardInstance(makeDef(`trash-bob-${i}`), {
        instanceId: `bob-trash-${i}`,
        ownerPlayerId: "bob",
        zone: "trash",
      })
    );
  }

  const ces: ContinuousEffect[] = [];
  for (let i = 0; i < 30; i++) {
    const target = i < 16 ? `alice-field-${i % 8}` : `bob-field-${i % 6}`;
    ces.push(makeCE(i, target));
  }

  const usageRecords: EffectUsageRecord[] = [];
  for (let i = 0; i < 25; i++) usageRecords.push(makeUsageRecord(i));

  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
  });

  const logEntries: string[] = [];
  for (let i = 0; i < 200; i++) {
    logEntries.push(
      `action:${i}:play:${Math.floor(i / 10)}:alice:main:summon:card-${i}`
    );
  }

  return {
    ...base,
    step: "attack" as const,
    window: "none" as const,
    activePlayerId: "alice",
    turnNumber: 12,
    activeContinuousEffects: ces,
    effectUsageRecords: usageRecords,
    log: logEntries,
  };
}

// --- Simulate typical actions ---

/** ドロー: 1枚をdeck→handに移動 + ログ追加 */
function simulateDraw(state: GameState): GameState {
  const deckCard = state.cardInstances.find(
    (c) => c.zone === "deck" && c.controllerPlayerId === state.activePlayerId
  );
  if (!deckCard) return state;
  return {
    ...state,
    cardInstances: state.cardInstances.map((c) =>
      c.instanceId === deckCard.instanceId ? { ...c, zone: "hand" as const } : c
    ),
    players: state.players.map((p) =>
      p.id === state.activePlayerId
        ? { ...p, handCount: p.handCount + 1, deckCount: p.deckCount - 1 }
        : p
    ),
    log: [...state.log, `draw:${deckCard.instanceId}`],
  };
}

/** コアステップ: リザーブ+1 + ステップ変更 + ログ追加 */
function simulateCoreStep(state: GameState): GameState {
  return {
    ...state,
    step: "core" as const,
    players: state.players.map((p) =>
      p.id === state.activePlayerId
        ? {
            ...p,
            reserveNormalCoreCount: p.reserveNormalCoreCount + 1,
            voidNormalCoreCount: p.voidNormalCoreCount - 1,
          }
        : p
    ),
    log: [...state.log, `core:step:${state.activePlayerId}`],
  };
}

/** 召喚: hand→field + コア配置 + ログ追加 */
function simulateSummon(state: GameState): GameState {
  const handCard = state.cardInstances.find(
    (c) => c.zone === "hand" && c.controllerPlayerId === state.activePlayerId
  );
  if (!handCard) return state;
  return {
    ...state,
    cardInstances: state.cardInstances.map((c) =>
      c.instanceId === handCard.instanceId
        ? {
            ...c,
            zone: "field" as const,
            zoneRoleName: "spirit",
            normalCoreCount: 1,
          }
        : c
    ),
    players: state.players.map((p) =>
      p.id === state.activePlayerId
        ? {
            ...p,
            handCount: p.handCount - 1,
            reserveNormalCoreCount: p.reserveNormalCoreCount - 3,
          }
        : p
    ),
    log: [
      ...state.log,
      `summon:declare:${handCard.instanceId}`,
      `summon:cost-paid:${handCard.instanceId}`,
      `summon:enter-field:${handCard.instanceId}`,
    ],
  };
}

/** アタック宣言: exhaustState変更 + activeAttack設定 + ログ追加 */
function simulateAttackDeclaration(state: GameState): GameState {
  const attacker = state.cardInstances.find(
    (c) =>
      c.zone === "field" &&
      c.controllerPlayerId === state.activePlayerId &&
      c.exhaustState === "recovered"
  );
  if (!attacker) return state;
  return {
    ...state,
    step: "attack" as const,
    cardInstances: state.cardInstances.map((c) =>
      c.instanceId === attacker.instanceId
        ? { ...c, exhaustState: "exhausted" as const }
        : c
    ),
    activeAttack: {
      attackerInstanceId: attacker.instanceId,
      attackerPlayerId: state.activePlayerId,
      blockerInstanceId: null,
      attackId: `attack-${Date.now()}`,
      designatedPlayerTarget:
        state.playerOrder.find((p) => p !== state.activePlayerId) ?? "bob",
      flashStepDone: false,
      blockStepDone: false,
      battleStarted: false,
      battleResolutionDone: false,
      damageStepDone: false,
      resolvedDamage: null,
    },
    battleEntities: [
      {
        instanceId: attacker.instanceId,
        role: "attacker" as const,
        playerId: state.activePlayerId,
        baseBp: 3000,
        effectiveBp: 3000,
        effectiveSymbols: ["red"],
      },
    ],
    log: [...state.log, `attack:declare:${attacker.instanceId}`],
  };
}

// --- Measurement ---

function measure(label: string, before: GameState, after: GameState) {
  const _beforeJson = JSON.stringify(before);
  const afterJson = JSON.stringify(after);
  const { patchOps, patchJsonSize } = computeJsonPatchSize(before, after);
  const ratio = ((patchJsonSize / afterJson.length) * 100).toFixed(1);

  console.log(
    `[DELTA] ${label}: ` +
      `fullState=${(afterJson.length / 1024).toFixed(1)}KB, ` +
      `patch=${(patchJsonSize / 1024).toFixed(1)}KB (${patchOps} ops), ` +
      `ratio=${ratio}%`
  );

  return {
    fullSize: afterJson.length,
    patchSize: patchJsonSize,
    patchOps,
    ratio: parseFloat(ratio),
  };
}

describe("P4-02 delta sync measurement", () => {
  it("early game: full state size", () => {
    const state = createEarlyGameState();
    const json = JSON.stringify(state);
    console.log(
      `[SIZE] Early game: ${(json.length / 1024).toFixed(1)}KB, ${state.cardInstances.length} cards`
    );
    expect(json.length).toBeGreaterThan(0);
  });

  it("mid game: full state size", () => {
    const state = createMidGameState();
    const json = JSON.stringify(state);
    console.log(
      `[SIZE] Mid game: ${(json.length / 1024).toFixed(1)}KB, ${state.cardInstances.length} cards, ${state.log.length} logs`
    );
    expect(json.length).toBeGreaterThan(0);
  });

  it("late game: full state size", () => {
    const state = createLateGameState();
    const json = JSON.stringify(state);
    console.log(
      `[SIZE] Late game: ${(json.length / 1024).toFixed(1)}KB, ${state.cardInstances.length} cards, ${state.log.length} logs`
    );
    expect(json.length).toBeGreaterThan(0);
  });

  it("early game: draw action delta", () => {
    const before = createEarlyGameState();
    const after = simulateDraw(before);
    const result = measure("early-draw", before, after);
    // Report ratio for decision
    expect(result.patchSize).toBeLessThan(result.fullSize);
  });

  it("mid game: core step delta", () => {
    const before = createMidGameState();
    const after = simulateCoreStep(before);
    const result = measure("mid-coreStep", before, after);
    expect(result.patchSize).toBeLessThan(result.fullSize);
  });

  it("mid game: summon delta", () => {
    const before = createMidGameState();
    const after = simulateSummon(before);
    const result = measure("mid-summon", before, after);
    expect(result.patchSize).toBeLessThan(result.fullSize);
  });

  it("mid game: draw delta", () => {
    const before = createMidGameState();
    const after = simulateDraw(before);
    const result = measure("mid-draw", before, after);
    expect(result.patchSize).toBeLessThan(result.fullSize);
  });

  it("late game: attack declaration delta", () => {
    const before = createLateGameState();
    const after = simulateAttackDeclaration(before);
    const result = measure("late-attack", before, after);
    expect(result.patchSize).toBeLessThan(result.fullSize);
  });

  it("late game: draw delta", () => {
    const before = createLateGameState();
    const after = simulateDraw(before);
    const result = measure("late-draw", before, after);
    expect(result.patchSize).toBeLessThan(result.fullSize);
  });

  it("summary: cost-benefit analysis (custom diff vs fast-json-patch)", () => {
    const scenarios = [
      {
        label: "early-draw",
        before: createEarlyGameState(),
        after: simulateDraw(createEarlyGameState()),
      },
      {
        label: "mid-core",
        before: createMidGameState(),
        after: simulateCoreStep(createMidGameState()),
      },
      {
        label: "mid-summon",
        before: createMidGameState(),
        after: simulateSummon(createMidGameState()),
      },
      {
        label: "mid-draw",
        before: createMidGameState(),
        after: simulateDraw(createMidGameState()),
      },
      {
        label: "late-attack",
        before: createLateGameState(),
        after: simulateAttackDeclaration(createLateGameState()),
      },
      {
        label: "late-draw",
        before: createLateGameState(),
        after: simulateDraw(createLateGameState()),
      },
    ];

    console.log("\n=== P4-02 Cost-Benefit Summary (fast-json-patch) ===");
    let totalFullKB = 0;
    let totalFjpPatchKB = 0;

    for (const s of scenarios) {
      const fullSize = JSON.stringify(s.after).length;
      // fast-json-patch の compare
      const fjpPatch = fjpCompare(s.before as object, s.after as object);
      const fjpPatchJson = JSON.stringify(fjpPatch);
      const fjpRatio = ((fjpPatchJson.length / fullSize) * 100).toFixed(1);
      console.log(
        `  ${s.label}: full=${(fullSize / 1024).toFixed(1)}KB → ` +
          `fjp=${(fjpPatchJson.length / 1024).toFixed(1)}KB (${fjpRatio}%, ${fjpPatch.length} ops)`
      );
      totalFullKB += fullSize;
      totalFjpPatchKB += fjpPatchJson.length;
    }

    const avgRatio = ((totalFjpPatchKB / totalFullKB) * 100).toFixed(1);
    console.log(
      `\n  Average: full=${(totalFullKB / 1024).toFixed(1)}KB → fjp=${(totalFjpPatchKB / 1024).toFixed(1)}KB (${avgRatio}%)`
    );
    console.log(
      `  Verdict: ${parseFloat(avgRatio) < 10 ? "EXCELLENT" : parseFloat(avgRatio) < 30 ? "GOOD" : "LOW VALUE"}`
    );

    expect(parseFloat(avgRatio)).toBeLessThan(50); // sanity check
  });

  it("fast-json-patch roundtrip: apply patch produces correct state", () => {
    const before = createMidGameState();
    const after = simulateSummon(before);
    const patch = fjpCompare(before as object, after as object);
    const cloned = structuredClone(before);
    const result = applyPatch(cloned, patch);
    expect(JSON.stringify(result.newDocument)).toBe(JSON.stringify(after));
  });
});
