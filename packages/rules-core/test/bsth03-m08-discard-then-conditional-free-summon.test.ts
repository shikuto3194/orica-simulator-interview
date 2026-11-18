/**
 * BSTH03-M08 [永夜抄]魂魄 妖夢 —
 *   effects[0]「相手は、相手の手札が2枚になるように破棄する。その後、
 *   自分のライフが5以下なら、このカードをコストを支払わずに召喚する。」
 *
 * 破棄が相手選択のため pendingZoneSelection (discard_hand, targetHandSize:2) を経由する。
 * ZoneSelectionContinuation は effect-interpreter.ts で discard_hand を含む任意の
 * actionKind に汎用配線済み (zone-selection-continuation.test.ts の BSSL01-C01 型と同型)。
 * 本テストは、continuation 解決後に life_value 条件付き free summon step が正しく
 * 再開されることを実カードで確認する（旧 stub 注記の「zone-selection 後続ステップ継続
 * primitive が必要」は誤検知で、既存 primitive で表現可能だったことの検証）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const m08 = card("BSTH03-M08");

const filler: CardDefinition = {
  cardNo: "M08-TEST-FILLER",
  name: "テストフィラー",
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

const defs = [m08, filler];
const defMap = new Map(defs.map((d) => [d.cardNo, d]));
const getCardDefinitionById = (id: string) => defMap.get(id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
};

/** alice: M08 を trash に保持 (バースト解決後を模す)。bob: 手札 handN 枚。 */
function buildState(handN: number, aliceLifeCores: number): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      { lifeNormalCoreCount: aliceLifeCores },
      { handCount: handN },
    ],
  });
  return {
    ...base,
    activePlayerId: "bob",
    step: "main",
    cardInstances: [
      createCardInstance(m08, {
        instanceId: "m08-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "trash",
      }),
      ...Array.from({ length: handN }, (_, i) =>
        createCardInstance(filler, {
          instanceId: `bob-hand-${i}`,
          ownerPlayerId: "bob",
          zone: "hand",
        })
      ),
    ],
  };
}

function runEffect(state: GameState): GameState {
  return executeEffect({
    chainId: "test:bsth03-m08-discard-then-conditional-free-summon:89",
    state,
    effect: m08.effects![0]!,
    effectIndex: 0,
    sourceInstanceId: "m08-1",
    actingPlayerId: "alice",
    ...lookups,
  });
}

describe("BSTH03-M08 妖夢 — 破棄(手札2枚まで)継続 → ライフ条件付き free self-summon", () => {
  it("stub なし・discard が continuation 付き pendingZoneSelection を生成する", () => {
    const effect = m08.effects![0]!;
    expect(effect.stub).toBeUndefined();
    const after = runEffect(buildState(5, 5));
    const pending = after.pendingZoneSelection;
    expect(pending).not.toBeNull();
    expect(pending!.actionKind).toBe("discard_hand");
    expect(pending!.actingPlayerId).toBe("bob");
    expect(pending!.maxCount).toBe(3); // 5枚 -> 2枚になるまで3枚破棄
    expect(pending!.continuation).toBeDefined();
    expect(pending!.continuation!.resumeStepIndex).toBe(1);
  });

  it("ライフ5以下: 破棄解決後、このカードをコストを支払わず自己召喚する", () => {
    const pendingState = runEffect(buildState(5, 5));
    const selected = pendingState
      .cardInstances!.filter(
        (c) => c.ownerPlayerId === "bob" && c.zone === "hand"
      )
      .slice(0, 3)
      .map((c) => c.instanceId);
    const resolved = applyLegalAction({
      state: pendingState,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: selected,
      ...lookups,
    }).state;
    expect(resolved.pendingZoneSelection ?? null).toBeNull();
    expect(resolved.players.find((p) => p.id === "bob")!.handCount).toBe(2);
    const m08Instance = resolved.cardInstances.find(
      (c) => c.instanceId === "m08-1"
    )!;
    expect(m08Instance.zone).toBe("field");
  });

  it("ライフ6 (5超): 破棄は実行されるが free summon 条件を満たさず場に出ない", () => {
    const pendingState = runEffect(buildState(5, 6));
    const selected = pendingState
      .cardInstances!.filter(
        (c) => c.ownerPlayerId === "bob" && c.zone === "hand"
      )
      .slice(0, 3)
      .map((c) => c.instanceId);
    const resolved = applyLegalAction({
      state: pendingState,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: selected,
      ...lookups,
    }).state;
    expect(resolved.players.find((p) => p.id === "bob")!.handCount).toBe(2);
    const m08Instance = resolved.cardInstances.find(
      (c) => c.instanceId === "m08-1"
    )!;
    expect(m08Instance.zone).toBe("trash");
  });
});
