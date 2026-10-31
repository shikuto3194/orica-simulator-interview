/**
 * pendingZoneSelection の continuation 再開テスト。
 *
 * 「手札N枚まで破棄→破棄1枚につき2枚ドロー」(BSSL01-C01 型) のように、ゾーン選択
 * (discard「N枚まで」) の結果枚数に後続ステップ (draw count = cards_from_ref × 2) が
 * 依存する効果を検証する。従来は discard pending 生成でループが break し後続ステップが
 * 落ちていた (silent drop)。本 increment で continuation を注入し、解決時に選択カードを
 * recordStepId の StepResult として記録してから後続ステップを再開する。
 *
 * ルール正源: 「〜まで」「〜できる」= 任意 (project_kuwaerareru_optional / 10_rules/03b)。
 * 破棄→ドローは単一効果の逐次ステップ (特別なタイミング裁定は不要)。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, GameState } from "../src";

// 「手札2枚まで破棄。破棄1枚につき2枚ドローする。」メインマジック。
const discardThenDrawMagic: CardDefinition = {
  cardNo: "TEST-DISCARD-THEN-DRAW",
  name: "テスト・破棄連動ドロー",
  printedCategory: "magic",
  colors: ["purple"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [
    "メイン",
    "自分の手札を2枚まで破棄する。その後、破棄したカード1枚につき2枚引く。",
  ],
  keywordTags: [],
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "disc",
          action: {
            kind: "discard",
            player: "self",
            count: { min: 0, max: 2 },
          },
        },
        {
          action: {
            kind: "draw",
            count: {
              source: { kind: "cards_from_ref", stepId: "disc" },
              multiplier: 2,
            },
          },
        },
      ],
    },
  ],
  sourceUrls: [],
  sourceConfidence: "C",
};

const filler: CardDefinition = {
  cardNo: "TEST-FILLER",
  name: "フィラー",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = [discardThenDrawMagic, filler];
const map = new Map(defs.map((d) => [d.cardNo, d]));
const getCardDefinitionById = (id: string) => map.get(id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
};

/** ALICE: 手札に handN 枚 + source magic、デッキに deckN 枚。 */
function baseState(handN: number, deckN: number): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{ handCount: handN, deckCount: deckN }, {}],
  });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [
      createCardInstance(discardThenDrawMagic, {
        instanceId: "magic-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      ...Array.from({ length: handN }, (_, i) =>
        createCardInstance(filler, {
          instanceId: `hand-${i}`,
          ownerPlayerId: "alice",
          zone: "hand",
        })
      ),
      ...Array.from({ length: deckN }, (_, i) =>
        createCardInstance(filler, {
          instanceId: `deck-${i}`,
          ownerPlayerId: "alice",
          zone: "deck",
        })
      ),
    ],
  };
}

function runEffect(state: GameState): GameState {
  return executeEffect({
    chainId: "test:zone-selection-continuation:124",
    state,
    effect: discardThenDrawMagic.effects![0]!,
    effectIndex: 0,
    sourceInstanceId: "magic-1",
    actingPlayerId: "alice",
    ...lookups,
  });
}

function handCount(state: GameState, player = "alice"): number {
  return state.players.find((p) => p.id === player)!.handCount;
}

describe("pendingZoneSelection continuation: discard N まで → 破棄1枚につき2枚ドロー", () => {
  it("discard step が continuation 付き pending を生成し後続 draw を保留する", () => {
    const after = runEffect(baseState(3, 10));
    const pending = after.pendingZoneSelection;
    expect(pending).not.toBeNull();
    expect(pending!.actionKind).toBe("discard_hand");
    expect(pending!.maxCount).toBe(2);
    expect(pending!.continuation).toBeDefined();
    expect(pending!.continuation!.resumeStepIndex).toBe(1);
    expect(pending!.continuation!.recordStepId).toBe("disc");
    // 保留中: まだ破棄もドローもしていない。
    expect(after.cardInstances.filter((c) => c.zone === "trash").length).toBe(
      0
    );
  });

  it("2枚破棄 → cards_from_ref×2 = 4枚ドロー", () => {
    const pendingState = runEffect(baseState(3, 10));
    const handBefore = handCount(pendingState); // 3 filler + 1 magic = 4
    const resolved = applyLegalAction({
      state: pendingState,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["hand-0", "hand-1"],
      ...lookups,
    }).state;
    expect(resolved.pendingZoneSelection ?? null).toBeNull();
    // 2枚トラッシュ。
    expect(
      resolved.cardInstances.filter(
        (c) => c.zone === "trash" && c.ownerPlayerId === "alice"
      ).length
    ).toBe(2);
    // 4枚ドロー: handCount = (4 - 2 破棄) + 4 = 6。
    expect(handCount(resolved)).toBe(handBefore - 2 + 4);
    // デッキは 10 - 4 = 6。
    expect(resolved.players.find((p) => p.id === "alice")!.deckCount).toBe(6);
  });

  it("1枚破棄 → 2枚ドロー", () => {
    const pendingState = runEffect(baseState(3, 10));
    const handBefore = handCount(pendingState);
    const resolved = applyLegalAction({
      state: pendingState,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["hand-0"],
      ...lookups,
    }).state;
    expect(handCount(resolved)).toBe(handBefore - 1 + 2);
    expect(resolved.players.find((p) => p.id === "alice")!.deckCount).toBe(8);
  });

  it("skip (0枚破棄) → 0枚ドロー (cards_from_ref=0)", () => {
    const pendingState = runEffect(baseState(3, 10));
    const handBefore = handCount(pendingState);
    const resolved = applyLegalAction({
      state: pendingState,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: [],
      ...lookups,
    }).state;
    expect(handCount(resolved)).toBe(handBefore);
    expect(resolved.players.find((p) => p.id === "alice")!.deckCount).toBe(10);
    expect(
      resolved.cardInstances.filter((c) => c.zone === "trash").length
    ).toBe(0);
  });
});
