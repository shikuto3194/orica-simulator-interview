import { describe, it, expect, beforeEach } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import {
  isAdventRestricted,
  recomputeContinuousEffects,
} from "../src/legal/legal-actions-shared";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffectTag,
  GameState,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

// ============================================================
// ENGINE-restrict-advent: 「相手は【煌臨】できない」(BSFT01-X01 [4,5])。
// restrict_stack (P3-75) と同型の player-scoped CE。
// ============================================================

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-RA-001",
    name: "テストスピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "星竜",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

function makeInstance(
  def: CardDefinition,
  overrides: Partial<CardInstance> = {}
): CardInstance {
  const base = createCardInstance(def, {
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  return { ...base, ...overrides };
}

function makeState(cards: CardInstance[]): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
    startingLife: 5,
  });
}

const defRegistry = new Map<string, CardDefinition>();
function getDef(id: string): CardDefinition | undefined {
  return defRegistry.get(id);
}
function registerDef(def: CardDefinition): void {
  defRegistry.set(def.cardNo, def);
}

function runEffect(action: Effect["steps"][number]["action"]) {
  const sourceDef = makeDef({ cardNo: "RA-SRC" });
  registerDef(sourceDef);
  const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
  const state = makeState([sourceCard]);

  const effect: Effect = {
    timing: { kind: "card_event", event: "attack" },
    steps: [{ action }],
  };

  return executeEffect({
    chainId: "test:restrict-advent:79",
    state,
    effect,
    sourceInstanceId: "src-1",
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
  });
}

describe("ENGINE-restrict-advent: restrict_advent — CE 登録", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("restrict_advent アクションで restrict_advent タグの CE が登録される", () => {
    const result = runEffect({
      kind: "restrict_advent",
      player: "opponent",
      duration: { scope: "turn" },
    });

    const ces = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === ("restrict_advent" as ContinuousEffectTag)
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]!.targetInstanceId).toBe("bob"); // opponent
    expect(ces[0]!.duration.scope).toBe("turn");
  });

  it("ログに restrict_advent:registered が記録される", () => {
    const result = runEffect({
      kind: "restrict_advent",
      player: "opponent",
      duration: { scope: "turn" },
    });

    expect(
      result.log.some((l) => l.includes("effect:restrict_advent:registered"))
    ).toBe(true);
  });
});

describe("ENGINE-restrict-advent: isAdventRestricted — CE 消費", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("restrict_advent CE があるとき isAdventRestricted が true", () => {
    const result = runEffect({
      kind: "restrict_advent",
      player: "opponent",
      duration: { scope: "turn" },
    });

    expect(isAdventRestricted(result, "bob")).toBe(true);
    // alice (CE 発動者) は制限されない
    expect(isAdventRestricted(result, "alice")).toBe(false);
  });

  it("restrict_advent CE が無いとき isAdventRestricted が false", () => {
    const state = makeState([]);
    expect(isAdventRestricted(state, "bob")).toBe(false);
  });

  it("CE は player-scoped のため recomputeContinuousEffects を跨いでも除去されない", () => {
    const result = runEffect({
      kind: "restrict_advent",
      player: "opponent",
      duration: { scope: "turn" },
    });

    // targetInstanceId が playerId (card ではない) のため、isPlayerScopedCETag に
    // 未登録だと「対象カードが field 不在」誤判定で即除去される (adversarial verifier round1 指摘)。
    const recomputed = recomputeContinuousEffects(result);
    const ce = recomputed.activeContinuousEffects.find(
      (c) => c.modifierTag === "restrict_advent"
    );
    expect(ce).toBeDefined();
    expect(ce?.targetInstanceId).toBe("bob");
    expect(isAdventRestricted(recomputed, "bob")).toBe(true);
  });
});

describe("ENGINE-restrict-advent: didNonCardActionChangeState 配線 (adversarial verifier round2 lens2 指摘反映)", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("restrict_advent step の CE 登録成功が stepSucceeded=true として後続 ref_succeeded step へ伝播する", () => {
    const sourceDef = makeDef({ cardNo: "RA-SRC-2" });
    registerDef(sourceDef);
    const sourceCard = makeInstance(sourceDef, { instanceId: "src-2" });
    const state = makeState([sourceCard]);

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          id: "restrict-step",
          action: {
            kind: "restrict_advent",
            player: "opponent",
            duration: { scope: "turn" },
          },
        },
        {
          id: "bonus-step",
          stepCondition: { kind: "ref_succeeded", stepId: "restrict-step" },
          action: { kind: "count_increase", player: "self", amount: 5 },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:restrict-advent:192",
      state,
      effect,
      sourceInstanceId: "src-2",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const alice = result.players.find((p) => p.id === "alice")!;
    // restrict_advent が didNonCardActionChangeState の switch から漏れていると
    // stepSucceeded は affected.length>0 のフォールバックに落ち (CE 登録は zone 変化を
    // 起こさないため常に false)、ref_succeeded ゲートで bonus-step が skip されて 0 のままになる。
    expect(alice.countValue).toBe(5);
  });
});
