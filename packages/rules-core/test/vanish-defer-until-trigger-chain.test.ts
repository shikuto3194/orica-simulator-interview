/**
 * 待機状態のトラッシュ移動タイミング: コスト支払い由来の消滅は、原因の召喚チェーン
 * (召喚時誘発 + 派生) が閉じるまでフィールドに残る。
 *
 * ルール正源: 10_rules/04_state-based-rules.md
 * - 「その離脱によって発生した効果と派生効果の解決を終えた後に移動する」(行99-100)
 * - 「原因の効果チェーンが閉じた時点」(行105)
 * - 例1: コスト支払い消滅は使用効果チェーン全体に紐づく (行108-121)
 *
 * 修正 (P3-84): アクション解決中 (`runActionMainResolution` → `finalizeEffectResolution`)
 * の SBA 消滅を解決チェーンに束縛し、flush ゲート (`canFlushPendingLeaveEntity`) が
 * 同一チェーンの `pendingTriggeredEffects` (召喚時誘発等) も見て、未解決の間は flush
 * しないようにした。
 *
 * 修正 (P3-85): deferred 解決経路 (`resolve_pending_triggered_effect` の多段スタック窓) では
 * 召喚時誘発の「解決中」サブチェーンが exact 一致しないため B が早期 flush していた。
 * `hasPendingDescendantTriggeredEffects` で子孫 chainId を包含判定し、ネスト鎖全体の閉鎖を待つ。
 *
 * 注: production では trigger lookup が必須 (P3-39) で、responder 不在イベントは
 * `getAvailableTriggeredEffectSourceChoices` で filter され `pendingTriggeredEffects` に
 * 入らない (burst check には入るが、バーストは全効果解決後に発揮されるため移動を待たせない /
 * `04_state-based-rules.md` 行159・169)。よって gate は実 responder のみで反応する。
 */
import { describe, it, expect } from "vitest";
import type { CardDefinition, GameState } from "../src/model";
import { playSummonAsAction, flushPendingLeaves } from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { createCardInstance, createEmptyGameState } from "../src/factories";

function makeSpirit(
  cardNo: string,
  effects: CardDefinition["effects"] = undefined,
  cost = 1
): CardDefinition {
  const base: CardDefinition = {
    cardNo,
    name: `Spirit ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
  return effects !== undefined ? { ...base, effects } : base;
}

function setup() {
  // A: 召喚時に draw 1 (観測可能な召喚時誘発)
  const defA = makeSpirit(
    "SUM-A",
    [
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
    1
  );
  // B: フィールドに 1 コア (Lv1 要求 1)。A のコスト支払いで奪うと 0 → 消滅
  const defB = makeSpirit("FIELD-B");

  const baseState = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(defA, {
        instanceId: "hand-A",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(defB, {
        instanceId: "field-B",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
    ],
    playerOverrides: [{ reserveNormalCoreCount: 3, deckCount: 5 }],
  });
  const state: GameState = {
    ...baseState,
    step: "main",
    activePlayerId: "alice",
  };
  const lookup = (id: string) => [defA, defB].find((d) => d.cardNo === id);
  const triggeredLookup = buildTriggeredEffectLookup([defA, defB]);
  return { state, lookup, triggeredLookup };
}

describe("待機状態: コスト支払い消滅は召喚時誘発の解決まで残る", () => {
  it("A 召喚の維持コアで B が消滅しても、召喚時誘発が未解決の間 B はフィールドに残る", () => {
    const { state, lookup, triggeredLookup } = setup();

    const result = playSummonAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "hand-A",
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    // A の召喚時誘発が未解決でキューに残っている
    const summonPending = result.state.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "summon"
    );
    expect(summonPending.length).toBe(1);

    // B はまだ消滅待機状態のままフィールドに残っている (トラッシュに行っていない)
    const B = result.state.cardInstances.find(
      (c) => c.instanceId === "field-B"
    );
    expect(B?.zone).toBe("field");
    expect(B?.pendingLeaveKind).toBe("vanish");
    // pendingLeaveEntities にも残っている (flush 未実行)
    expect(
      result.state.pendingLeaveEntities.some((e) => e.instanceId === "field-B")
    ).toBe(true);
  });

  it("召喚チェーンが閉じれば (誘発キューが空になれば) B はトラッシュへ移動する", () => {
    const { state, lookup, triggeredLookup } = setup();

    const result = playSummonAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "hand-A",
      paymentSources: [{ kind: "card", instanceId: "field-B", amount: 1 }],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    // 召喚時誘発の解決完了をシミュレート (誘発キューを空に) して flush
    const chainClosed: GameState = {
      ...result.state,
      pendingTriggeredEffects: [],
    };
    const afterFlush = flushPendingLeaves(chainClosed, lookup);

    const B = afterFlush.cardInstances.find((c) => c.instanceId === "field-B");
    expect(B?.zone).toBe("trash");
  });
});
