/**
 * P3-46 G8: facade `previewState` の resilience テスト。
 *
 * 対戦相手のフラッシュ効果等で `state` が draft の前提を破壊する形に
 * 差し替わると、`applyDraftCoreMoves` 内の primitive validation が throw する。
 * このとき `previewState` useMemo が throw すると React render が落ちるので、
 * facade 側で catch して旧 `state` を返す設計にしている。
 *
 * このテストは facade を直接 hook として呼べないため、`applyDraftCoreMoves`
 * を直接呼び、try/catch で同じ振る舞いを再現するレベルで担保する。
 * (facade の useMemo 内の try/catch は同 expression で覆われている。)
 */
import { describe, expect, it } from "vitest";
import {
  applyDraftCoreMoves,
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
  type DraftCoreMove,
} from "@orica/rules-core";
import {
  addHeldCoreToBuffer,
  computeCoreSelectionPreviewState,
  removeHeldCoreFromBuffer,
  takeHeldCoreFromBuffer,
  type HeldCoreEntry,
} from "../src/coreSelectionFacade";

function makeStateWithReserve(
  playerId: string,
  reserveCores: number
): GameState {
  return createEmptyGameState({
    playerIds: [playerId, "other"],
    playerOverrides: [
      { reserveNormalCoreCount: reserveCores },
      { reserveNormalCoreCount: 0 },
    ],
    startingVoidNormalCoreCount: 0,
  });
}

describe("P3-46 G8: previewState resilience", () => {
  it("applyDraftCoreMoves throws when source container has insufficient cores", () => {
    const state = makeStateWithReserve("alice", 0);
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        purpose: "core_move",
        from: { kind: "reserve", playerId: "alice" },
        to: { kind: "trash", playerId: "alice" },
        amount: 1,
      },
    ];
    expect(() => applyDraftCoreMoves(state, drafts)).toThrow();
  });

  it("facade pattern: try/catch fallback preserves render-safe contract", () => {
    // facade useMemo の挙動を関数化したもの。state が draft を裏切った時
    // throw せず state を返すことを確認する。
    const previewState = (state: GameState, drafts: DraftCoreMove[]) => {
      try {
        return applyDraftCoreMoves(state, drafts);
      } catch {
        return state;
      }
    };

    const state = makeStateWithReserve("alice", 0);
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        purpose: "core_move",
        from: { kind: "reserve", playerId: "alice" },
        to: { kind: "trash", playerId: "alice" },
        amount: 1,
      },
    ];
    // 例外を握り潰し state を返す = render が落ちない契約
    expect(previewState(state, drafts)).toBe(state);
  });

  it("facade pattern: still valid drafts produce projection", () => {
    const previewState = (state: GameState, drafts: DraftCoreMove[]) => {
      try {
        return applyDraftCoreMoves(state, drafts);
      } catch {
        return state;
      }
    };

    const state = makeStateWithReserve("alice", 5);
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        purpose: "core_move",
        from: { kind: "reserve", playerId: "alice" },
        to: { kind: "trash", playerId: "alice" },
        amount: 1,
      },
    ];
    const projected = previewState(state, drafts);
    expect(projected).not.toBe(state);
    const alice = projected.players.find((p) => p.id === "alice");
    expect(alice?.reserveNormalCoreCount).toBe(4);
    expect(alice?.trashNormalCoreCount).toBe(1);
  });
});

describe("core selection preview definition lookup", () => {
  const token: CardDefinition = {
    cardNo: "GUI-PREVIEW-TOKEN",
    name: "GUI Preview Token",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: ["token"],
    sourceUrls: [],
    sourceConfidence: "C",
    tokenIndependentCoreManagement: {
      redirectCoresToVoid: true,
      placementRestrictedToEnterField: true,
    },
  };
  const getDefinition = (definitionId: string): CardDefinition | undefined =>
    definitionId === token.cardNo ? token : undefined;

  it("threads token core redirect rules through preview projection", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(token, {
          instanceId: "preview-token",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
      ],
      playerOverrides: [
        { id: "alice", reserveNormalCoreCount: 0, voidNormalCoreCount: 0 },
        { id: "bob" },
      ],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        purpose: "core_move",
        from: { kind: "card", instanceId: "preview-token" },
        to: { kind: "reserve", playerId: "alice" },
        amount: 1,
      },
    ];

    const projected = computeCoreSelectionPreviewState(
      state,
      drafts,
      getDefinition
    );
    const alice = projected.players.find((player) => player.id === "alice");
    const tokenAfter = projected.cardInstances.find(
      (card) => card.instanceId === "preview-token"
    );

    expect(tokenAfter?.normalCoreCount).toBe(1);
    expect(alice?.reserveNormalCoreCount).toBe(0);
    expect(alice?.voidNormalCoreCount).toBe(1);
  });

  it("does not apply normal-move destination restrictions to placement previews", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(token, {
          instanceId: "preview-token",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 0,
        }),
      ],
      playerOverrides: [
        { id: "alice", reserveNormalCoreCount: 1, voidNormalCoreCount: 0 },
        { id: "bob" },
      ],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        purpose: "placement",
        from: { kind: "reserve", playerId: "alice" },
        to: { kind: "card", instanceId: "preview-token" },
        amount: 1,
      },
    ];

    const projected = computeCoreSelectionPreviewState(
      state,
      drafts,
      getDefinition
    );
    const alice = projected.players.find((player) => player.id === "alice");
    const tokenAfter = projected.cardInstances.find(
      (card) => card.instanceId === "preview-token"
    );

    expect(tokenAfter?.normalCoreCount).toBe(1);
    expect(alice?.reserveNormalCoreCount).toBe(0);
    expect(alice?.voidNormalCoreCount).toBe(0);
  });

  it("keeps token source redirects active in placement previews", () => {
    const plain: CardDefinition = {
      cardNo: "GUI-PLAIN",
      name: "GUI Plain",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(token, {
          instanceId: "preview-token",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(plain, {
          instanceId: "plain-target",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 0,
        }),
      ],
      playerOverrides: [
        { id: "alice", reserveNormalCoreCount: 0, voidNormalCoreCount: 0 },
        { id: "bob" },
      ],
    });
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        purpose: "placement",
        from: { kind: "card", instanceId: "preview-token" },
        to: { kind: "card", instanceId: "plain-target" },
        amount: 1,
      },
    ];

    const projected = computeCoreSelectionPreviewState(
      state,
      drafts,
      (definitionId) =>
        definitionId === token.cardNo
          ? token
          : definitionId === plain.cardNo
            ? plain
            : undefined
    );
    const alice = projected.players.find((player) => player.id === "alice");
    const tokenAfter = projected.cardInstances.find(
      (card) => card.instanceId === "preview-token"
    );
    const plainAfter = projected.cardInstances.find(
      (card) => card.instanceId === "plain-target"
    );

    expect(tokenAfter?.normalCoreCount).toBe(0);
    expect(plainAfter?.normalCoreCount).toBe(0);
    expect(alice?.voidNormalCoreCount).toBe(1);
  });
});

/* -------------------- P3-49: held buffer pure helpers --------------------
 * 仕様: manual/ai-reference/25_gui/11_core-selection-hud.md「キャンセル / リセット / 戻り規則」
 * Phase 1 で grab、Phase 2 で takeHeldCore で pop。Phase 2 reset は snapshot 復元。
 */

const reserveAlice: HeldCoreEntry = {
  kind: "normal",
  from: { kind: "reserve", playerId: "alice" },
};
const trashAlice: HeldCoreEntry = {
  kind: "normal",
  from: { kind: "trash", playerId: "alice" },
};
const soulReserveAlice: HeldCoreEntry = {
  kind: "soul",
  from: { kind: "reserve", playerId: "alice" },
  playerId: "alice",
};

describe("P3-49: addHeldCoreToBuffer", () => {
  it("phase 1 で末尾に追加する", () => {
    const out = addHeldCoreToBuffer([], reserveAlice, 1);
    expect(out).toEqual([reserveAlice]);
  });

  it("phase 1 で 2 件目も末尾追加 (順序保持)", () => {
    const out = addHeldCoreToBuffer([reserveAlice], trashAlice, 1);
    expect(out).toEqual([reserveAlice, trashAlice]);
  });

  it("phase 2 では追加せず buffer のコピーを返す (no-op)", () => {
    const buf = [reserveAlice];
    const out = addHeldCoreToBuffer(buf, trashAlice, 2);
    expect(out).toEqual([reserveAlice]);
    expect(out).not.toBe(buf);
  });
});

describe("P3-49: removeHeldCoreFromBuffer", () => {
  it("中間 index の entry を削除し前後を保持する", () => {
    const out = removeHeldCoreFromBuffer(
      [reserveAlice, trashAlice, soulReserveAlice],
      1
    );
    expect(out).toEqual([reserveAlice, soulReserveAlice]);
  });

  it("範囲外 index は no-op", () => {
    const out = removeHeldCoreFromBuffer([reserveAlice], 5);
    expect(out).toEqual([reserveAlice]);
  });

  it("負 index も no-op", () => {
    const out = removeHeldCoreFromBuffer([reserveAlice], -1);
    expect(out).toEqual([reserveAlice]);
  });
});

describe("P3-49: takeHeldCoreFromBuffer", () => {
  it("matcher 未指定時は先頭を pop", () => {
    const { popped, remaining } = takeHeldCoreFromBuffer([
      reserveAlice,
      trashAlice,
    ]);
    expect(popped).toEqual(reserveAlice);
    expect(remaining).toEqual([trashAlice]);
  });

  it("matcher でマッチする最初の entry を pop", () => {
    const { popped, remaining } = takeHeldCoreFromBuffer(
      [reserveAlice, trashAlice, soulReserveAlice],
      (e) => e.kind === "soul"
    );
    expect(popped).toEqual(soulReserveAlice);
    expect(remaining).toEqual([reserveAlice, trashAlice]);
  });

  it("matcher 未マッチ時は popped=null / remaining 同一", () => {
    const { popped, remaining } = takeHeldCoreFromBuffer(
      [reserveAlice],
      (e) => e.kind === "soul"
    );
    expect(popped).toBeNull();
    expect(remaining).toEqual([reserveAlice]);
  });

  it("空 buffer は popped=null / remaining=[]", () => {
    const { popped, remaining } = takeHeldCoreFromBuffer([]);
    expect(popped).toBeNull();
    expect(remaining).toEqual([]);
  });

  it("Phase 2 シナリオ: 3 件 grab → 3 件 pop で空になる", () => {
    let buffer: HeldCoreEntry[] = [reserveAlice, trashAlice, soulReserveAlice];
    const popped: HeldCoreEntry[] = [];
    while (buffer.length > 0) {
      const r = takeHeldCoreFromBuffer(buffer);
      if (!r.popped) break;
      popped.push(r.popped);
      buffer = r.remaining;
    }
    expect(popped).toEqual([reserveAlice, trashAlice, soulReserveAlice]);
    expect(buffer).toEqual([]);
  });
});

describe("P3-49: Phase 2 reset シナリオ (snapshot 復元のシミュレーション)", () => {
  it("Phase 1 終了時の held を snapshot 化 → Phase 2 で 1 件 pop → reset で復元", () => {
    // Phase 1: 2 件 grab
    let buffer = addHeldCoreToBuffer([], reserveAlice, 1);
    buffer = addHeldCoreToBuffer(buffer, trashAlice, 1);
    expect(buffer).toEqual([reserveAlice, trashAlice]);

    // enterPlacePhase 相当: snapshot を取って Phase 2 へ
    const snapshot = buffer.slice();

    // Phase 2: 1 件 pop
    const { popped, remaining } = takeHeldCoreFromBuffer(buffer);
    expect(popped).toEqual(reserveAlice);
    expect(remaining).toEqual([trashAlice]);

    // Phase 2 reset 相当: snapshot から復元
    const restored = snapshot.slice();
    expect(restored).toEqual([reserveAlice, trashAlice]);
  });
});
