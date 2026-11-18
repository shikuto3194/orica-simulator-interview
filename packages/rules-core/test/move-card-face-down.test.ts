/**
 * P3-47 F-1 Step 5/7: move_card action の faceDown オプションを検証する。
 *
 * Step 5:
 * - faceDown=true 指定で deck top → field 移動時に faceDown=true で配置されること
 * - faceDown=false 指定で明示的に表向き配置になること
 * - 省略時は applyFaceDownPolicyOnZoneChange の規則に従うこと
 *   (2026-05-29 裁定: 離場で常に faceDown 解除。明示 faceDown:true のみ維持)
 *
 * Step 7 (統合):
 * - フランドール想定 flow: 「裏向きで 3 枚 field → コア 1 個ずつ → トラッシュ送り」で
 *   faceDown 状態が一貫して扱われること
 * - JSON round-trip (snapshot import/export 経路) で faceDown 値が保持されること
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { flushPendingLeaves } from "../src/state-based-actions";
import {
  createGameSnapshot,
  parseGameSnapshot,
  restoreSnapshot,
} from "../src/snapshot";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "player-1";

function dummyDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "Test Card",
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

function getCard(state: GameState, id: string): CardInstance {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

function getCardDef(_id: string): CardDefinition | undefined {
  return dummyDef();
}

function makeStateWithDeckTop(
  cardCount: number,
  cardOpts: Partial<CardInstance> = {}
): GameState {
  const state = createEmptyGameState({
    playerOverrides: [{ deckCount: cardCount }, {}],
  });
  const deckCards = Array.from({ length: cardCount }, (_, i) =>
    createCardInstance(dummyDef({ cardNo: `DECK-${i}` }), {
      instanceId: `deck-${i}`,
      ownerPlayerId: ALICE,
      zone: "deck",
      ...cardOpts,
    })
  );
  return {
    ...state,
    cardInstances: [...state.cardInstances, ...deckCards],
  };
}

function runEffect(state: GameState, effect: Effect): GameState {
  return executeEffect({
    chainId: "test:move-card-face-down:78",
    state,
    effect,
    sourceInstanceId: "src",
    actingPlayerId: ALICE,
    getCardDefinitionById: getCardDef,
  });
}

describe("P3-47 F-1 Step 5: move_card faceDown オプション", () => {
  it("faceDown=true 指定: deck top 3 枚を field に裏向きで配置", () => {
    const state = makeStateWithDeckTop(3);
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "move_card",
            from: { zone: "deck", player: "self", position: "top" },
            to: { zone: "field", player: "self" },
            count: 3,
            faceDown: true,
          },
        },
      ],
    };
    const result = runEffect(state, effect);

    for (let i = 0; i < 3; i++) {
      const card = getCard(result, `deck-${i}`);
      expect(card.zone).toBe("field");
      expect(card.faceDown).toBe(true);
    }
  });

  it("faceDown=false 指定: 既存 faceDown 状態を上書きして表向きに", () => {
    const state = makeStateWithDeckTop(1, { faceDown: true });
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "move_card",
            from: { zone: "deck", player: "self", position: "top" },
            to: { zone: "field", player: "self" },
            count: 1,
            faceDown: false,
          },
        },
      ],
    };
    const result = runEffect(state, effect);
    expect(getCard(result, "deck-0").faceDown).toBe(false);
  });

  it("faceDown 省略時: 公開領域 (field) 移動で既存 faceDown=true は解除される", () => {
    const state = makeStateWithDeckTop(1, { faceDown: true });
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "move_card",
            from: { zone: "deck", player: "self", position: "top" },
            to: { zone: "field", player: "self" },
            count: 1,
          },
        },
      ],
    };
    const result = runEffect(state, effect);
    expect(getCard(result, "deck-0").faceDown).toBe(false);
  });

  it("faceDown 省略時: 手札移動でも faceDown=true は解除される (2026-05-29 裁定: 離場で通常カードに戻る)", () => {
    const state = makeStateWithDeckTop(1, { faceDown: true });
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "move_card",
            from: { zone: "deck", player: "self", position: "top" },
            to: { zone: "hand", player: "self" },
            count: 1,
          },
        },
      ],
    };
    const result = runEffect(state, effect);
    // 旧: 非公開領域は維持 → true。新: 離場で常に解除 → false (秘匿はゾーン可視性が担保)。
    expect(getCard(result, "deck-0").faceDown).toBe(false);
  });

  it("faceDown=true で deck bottom に積む (top/bottom 位置指定経路でも faceDown が伝搬)", () => {
    const state = makeStateWithDeckTop(1);
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "move_card",
            from: { zone: "deck", player: "self", position: "top" },
            to: { zone: "deck", player: "self", position: "bottom" },
            count: 1,
            faceDown: true,
          },
        },
      ],
    };
    const result = runEffect(state, effect);
    // 同 zone 移動でも faceDown=true が維持される (deck は private なので zone policy も維持側)
    expect(getCard(result, "deck-0").faceDown).toBe(true);
  });
});

describe("P3-47 F-1 Step 7: 統合フロー (フランドール想定)", () => {
  it("3 枚裏向き field → コア 1 個ずつ → トラッシュ送り で faceDown が解除される", () => {
    // Phase 1: deck top 3 枚を field に裏向きで配置
    const state = makeStateWithDeckTop(3);
    const placeEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "move_card",
            from: { zone: "deck", player: "self", position: "top" },
            to: { zone: "field", player: "self" },
            count: 3,
            faceDown: true,
          },
        },
      ],
    };
    const placed = runEffect(state, placeEffect);

    for (let i = 0; i < 3; i++) {
      const card = getCard(placed, `deck-${i}`);
      expect(card.zone).toBe("field");
      expect(card.faceDown).toBe(true);
    }

    // Phase 2: 各カードに 1 個ずつコアを乗せる (本来は pendingCoreDistribution 経路だが
    // ここでは状態ベースで直接付与し、faceDown 状態がコア操作で破壊されないことを確認)
    const withCores: GameState = {
      ...placed,
      cardInstances: placed.cardInstances.map((c) =>
        c.zone === "field" && c.ownerPlayerId === ALICE
          ? { ...c, normalCoreCount: 1 }
          : c
      ),
    };
    for (let i = 0; i < 3; i++) {
      const card = getCard(withCores, `deck-${i}`);
      expect(card.normalCoreCount).toBe(1);
      expect(card.faceDown).toBe(true);
    }

    // Phase 3: 3 枚を field → trash へ移動 (faceDown 省略 → zone policy 適用 → 表向きに戻る)
    const trashEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "move_card",
            from: { zone: "field", player: "self" },
            to: { zone: "trash", player: "self" },
            count: 3,
          },
        },
      ],
    };
    const queued = runEffect(withCores, trashEffect);
    const trashed = flushPendingLeaves(queued, getCardDef);

    for (let i = 0; i < 3; i++) {
      const card = getCard(trashed, `deck-${i}`);
      expect(card.zone).toBe("trash");
      // 公開領域 (trash) へ移動した時点で faceDown は解除される
      expect(card.faceDown).toBe(false);
    }
  });

  it("snapshot import/export round-trip (JSON) で faceDown 状態が保持される", () => {
    const state = makeStateWithDeckTop(3);
    const placed = runEffect(state, {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "move_card",
            from: { zone: "deck", player: "self", position: "top" },
            to: { zone: "field", player: "self" },
            count: 3,
            faceDown: true,
          },
        },
      ],
    });

    // 再現環境を意識した round-trip: createGameSnapshot → JSON.stringify → JSON.parse
    // → parseGameSnapshot → restoreSnapshot
    const snapshot = createGameSnapshot(placed, {
      label: "p3-47-f1-step7",
      nowIso: "2026-05-05T00:00:00.000Z",
    });
    const json = JSON.parse(JSON.stringify(snapshot));
    const parseResult = parseGameSnapshot(json);
    expect(parseResult.ok).toBe(true);
    if (!parseResult.ok) return;

    const restored = restoreSnapshot(parseResult.snapshot, getCardDef);
    for (let i = 0; i < 3; i++) {
      const card = restored.state.cardInstances.find(
        (c) => c.instanceId === `deck-${i}`
      );
      expect(card?.zone).toBe("field");
      expect(card?.faceDown).toBe(true);
    }
  });

  it("round-trip 前後で faceDown=false / 表向き状態も維持される (混在ケース)", () => {
    // 裏向き 2 枚 + 表向き 1 枚
    const state = makeStateWithDeckTop(3);
    const placedDown = runEffect(state, {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "move_card",
            from: { zone: "deck", player: "self", position: "top" },
            to: { zone: "field", player: "self" },
            count: 2,
            faceDown: true,
          },
        },
      ],
    });
    const mixed = runEffect(placedDown, {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "move_card",
            from: { zone: "deck", player: "self", position: "top" },
            to: { zone: "field", player: "self" },
            count: 1,
          },
        },
      ],
    });

    const snapshot = createGameSnapshot(mixed, {
      nowIso: "2026-05-05T00:00:00.000Z",
    });
    const json = JSON.parse(JSON.stringify(snapshot));
    const parsed = parseGameSnapshot(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { state: restored } = restoreSnapshot(parsed.snapshot, getCardDef);

    expect(
      restored.cardInstances.find((c) => c.instanceId === "deck-0")?.faceDown
    ).toBe(true);
    expect(
      restored.cardInstances.find((c) => c.instanceId === "deck-1")?.faceDown
    ).toBe(true);
    expect(
      restored.cardInstances.find((c) => c.instanceId === "deck-2")?.faceDown
    ).toBe(false);
  });
});
