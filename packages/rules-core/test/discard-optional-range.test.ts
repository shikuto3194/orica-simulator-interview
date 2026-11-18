/**
 * 「N枚まで破棄」= 任意の上限付き範囲破棄 (DiscardAction.count = { min: 0, max: N }) の解決テスト。
 *
 * resolveCountToNumber は範囲を min (=0) に潰すため、従来は「N枚まで」が無条件 no-op だった
 * (BSKB01 等が silent に破棄ゼロ)。本 increment で上限 (max) を実効枚数とし、min===0 のとき
 * 候補が1枚でもあれば常に選択モーダル (0..max を任意で破棄、canSkip) を提示する。
 *
 * 上限 max は DynamicCount も可 (「自分のカウント2につき手札1枚まで破棄」)。
 *
 * ルール正源: 「〜できる」「〜まで」= 任意 (project_kuwaerareru_optional / 10_rules/03b)。
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "player-1";

function dummyDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-DISCARD-RANGE",
    name: "範囲破棄テスト",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
    ...overrides,
  } as CardDefinition;
}

const def = dummyDef();
function getCardDef(): CardDefinition {
  return def;
}

function handCard(id: string, owner: string): CardInstance {
  return createCardInstance(def, {
    instanceId: id,
    ownerPlayerId: owner,
    zone: "hand",
  });
}

function deckCard(id: string, owner: string): CardInstance {
  return createCardInstance(def, {
    instanceId: id,
    ownerPlayerId: owner,
    zone: "deck",
  });
}

/** ALICE が handN 枚の手札を持つ盤面。countValue も任意指定。 */
function baseState(handN: number, countValue = 0): GameState {
  const cards = Array.from({ length: handN }, (_, i) =>
    handCard(`a-h-${i}`, ALICE)
  );
  return createEmptyGameState({
    cardInstances: cards,
    playerOverrides: [{ handCount: handN, countValue }, {}],
  });
}

function baseDeckState(deckN: number): GameState {
  const cards = Array.from({ length: deckN }, (_, i) =>
    deckCard(`a-d-${i}`, ALICE)
  );
  return createEmptyGameState({
    cardInstances: cards,
    playerOverrides: [{ deckCount: deckN }, {}],
  });
}

function runDiscard(
  state: GameState,
  count: Effect["steps"][number]["action"]
) {
  const effect: Effect = {
    timing: { kind: "activated", mode: "main" },
    steps: [{ action: count }],
  };
  return executeEffect({
    chainId: "test:discard-optional-range:90",
    state,
    effect,
    sourceInstanceId: "src",
    actingPlayerId: ALICE,
    getCardDefinitionById: getCardDef,
  });
}

const upTo2 = {
  kind: "discard" as const,
  player: "self" as const,
  count: { min: 0, max: 2 },
};

describe("discard 任意上限範囲 (count: { min: 0, max: N })", () => {
  it("手札3枚 / 2枚まで破棄 → 選択 pending (maxCount=2, canSkip, 候補3)", () => {
    const result = runDiscard(baseState(3), upTo2);
    const pending = result.pendingZoneSelection;
    expect(pending).not.toBeNull();
    expect(pending!.actingPlayerId).toBe(ALICE);
    expect(pending!.actionKind).toBe("discard_hand");
    expect(pending!.maxCount).toBe(2);
    expect(pending!.canSkip).toBe(true);
    expect(pending!.candidateCardInstanceIds.length).toBe(3);
    // pending 中は未破棄。
    expect(result.cardInstances.filter((c) => c.zone === "trash").length).toBe(
      0
    );
  });

  it("手札1枚 / 2枚まで → maxCount は候補数 1 に切り下げ", () => {
    const result = runDiscard(baseState(1), upTo2);
    expect(result.pendingZoneSelection).not.toBeNull();
    expect(result.pendingZoneSelection!.maxCount).toBe(1);
    expect(result.pendingZoneSelection!.canSkip).toBe(true);
  });

  it("手札0枚 / 2枚まで → pending を立てず no-op", () => {
    const result = runDiscard(baseState(0), upTo2);
    expect(result.pendingZoneSelection ?? null).toBeNull();
  });

  it("上限が DynamicCount (カウント2につき手札1枚まで): countValue5 → maxCount=floor(5/2)=2", () => {
    const result = runDiscard(baseState(4, 5), {
      kind: "discard",
      player: "self",
      count: {
        min: 0,
        max: { source: { kind: "count_value", player: "self" }, divisor: 2 },
      },
    });
    expect(result.pendingZoneSelection).not.toBeNull();
    expect(result.pendingZoneSelection!.maxCount).toBe(2);
  });

  it("選択0枚 (skip) で確定 → 1枚も破棄されない", () => {
    const pendingState = runDiscard(baseState(3), upTo2);
    const resolved = applyLegalAction({
      state: pendingState,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: [],
      getCardDefinitionById: getCardDef,
    }).state;
    expect(resolved.pendingZoneSelection ?? null).toBeNull();
    expect(
      resolved.cardInstances.filter((c) => c.zone === "trash").length
    ).toBe(0);
  });

  it("上限まで (2枚) 選択 → 選んだ2枚が破棄される", () => {
    const pendingState = runDiscard(baseState(3), upTo2);
    const resolved = applyLegalAction({
      state: pendingState,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["a-h-0", "a-h-1"],
      getCardDefinitionById: getCardDef,
    }).state;
    expect(resolved.pendingZoneSelection ?? null).toBeNull();
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "a-h-0")!.zone
    ).toBe("trash");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "a-h-1")!.zone
    ).toBe("trash");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "a-h-2")!.zone
    ).toBe("hand");
  });

  it.each([false, true])(
    "トラッシュ耐性=%s: デッキからの任意ミルの選択解決で3→1枚になる",
    (trashImmune) => {
      const initial = baseDeckState(3);
      if (trashImmune) {
        initial.activeContinuousEffects.push({
          effectId: "trash-immunity",
          sourceInstanceId: "src",
          sourceDefinitionId: def.cardNo,
          actingPlayerId: ALICE,
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetFilter: { player: "self", zone: ["trash"] },
          immunityPlayerScope: "any",
        });
      }
      const pendingState = runDiscard(initial, {
        ...upTo2,
        fromZone: "deck",
      });
      expect(pendingState.pendingZoneSelection).toMatchObject({
        actionKind: "discard_hand",
        sourceZone: "deck",
        maxCount: 2,
      });

      const resolved = applyLegalAction({
        state: pendingState,
        action: { kind: "resolve_pending_zone_selection" },
        selectedZoneCardIds: ["a-d-0", "a-d-1"],
        getCardDefinitionById: getCardDef,
      }).state;

      expect(
        resolved.players.find((player) => player.id === ALICE)!.deckCount
      ).toBe(1);
      expect(
        resolved.cardInstances.filter(
          (card) => card.ownerPlayerId === ALICE && card.zone === "deck"
        )
      ).toHaveLength(1);
      expect(
        resolved.cardInstances.filter(
          (card) => card.ownerPlayerId === ALICE && card.zone === "trash"
        )
      ).toHaveLength(2);
    }
  );

  it("デッキからの任意ミルで同じカードを重複選択すると状態を変えず拒否する", () => {
    const pendingState = runDiscard(baseDeckState(3), {
      ...upTo2,
      fromZone: "deck",
    });

    expect(() =>
      applyLegalAction({
        state: pendingState,
        action: { kind: "resolve_pending_zone_selection" },
        selectedZoneCardIds: ["a-d-0", "a-d-0"],
        getCardDefinitionById: getCardDef,
      })
    ).toThrow("Zone selection contains duplicate card instance IDs");
    expect(
      pendingState.players.find((player) => player.id === ALICE)!.deckCount
    ).toBe(3);
    expect(
      pendingState.cardInstances.filter((card) => card.zone === "deck")
    ).toHaveLength(3);
  });
});
