/**
 * engine-drain 2 (P3-14 C-2): ダブルフェイス B 面を定義ルックアップ + 効果レジストリへ登録し、
 * 転醒時 (card_event:"rebirth") が **production の lookup 経路** で解決されることの統合テスト。
 *
 * 背景: executeRebirth は instance の definitionId を backFace.cardNo へ swap する。だが
 * ALL_CARDS は表面 (top-level) のみを公開し、定義ルックアップ・triggered-effect レジストリは
 * 表面 cardNo でしかキーを張らないため、転醒後の getCardDefinitionById(裏面cardNo) が undefined
 * を返し、B 面『転醒時』効果が解決もレジストリ登録もされなかった (engine-drain 1 で判明)。
 *
 * 本テストは increment 1 の hand-registered fixture と違い、production と同じビルダー
 * (expandCardDefinitionsWithBackFaces → buildTriggeredEffectLookup / 定義 Map) を使い、
 * **実在のダブルフェイスカード** BSTH07-転醒R01 (B 面 BSTH07-転醒R01(B) は
 * card_event:"rebirth" の destroy 効果を持つ) を場に置いて executeRebirth で裏返し、
 * collectAndQueueTriggerReactions が B 面『転醒時』効果を pending 化することを検証する。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src/model";
import type { RebirthAction } from "../src/model";
import {
  collectAndQueueTriggerReactions,
  collectTriggerEventsFromStateDelta,
} from "../src/effect/trigger-system";
import {
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "../src/effect/structured-effect-registrations";
import { executeRebirth } from "../src/effect/structured-effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { ALL_CARDS } from "../../card-data/src/generated-index";

// 実在のダブルフェイス転醒ネクサス (BSTH07 東方星蓮船)。表面 (A) / 裏面 (B)。
const FRONT_NO = "BSTH07-転醒R01(A)";
const BACK_NO = "BSTH07-転醒R01(B)";

/**
 * production と同じ展開・ルックアップ構築。game-api.ts の installCardLookups と同経路:
 * 表面プール (ALL_CARDS) → expandCardDefinitionsWithBackFaces → 定義 Map + triggered レジストリ。
 */
function buildProductionLookups(defs: readonly CardDefinition[]) {
  const expanded = expandCardDefinitionsWithBackFaces(defs);
  const map = new Map(expanded.map((d) => [d.cardNo, d]));
  return {
    getCardDefinitionById: (id: string) => map.get(id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(expanded),
  };
}

describe("rebirth B-face registration — production lookup path (BSTH07-転醒R01)", () => {
  it("ALL_CARDS exposes the front but NOT the back face (deckable pool unchanged)", () => {
    const front = ALL_CARDS.find((c) => c.cardNo === FRONT_NO);
    expect(front, `${FRONT_NO} must exist in ALL_CARDS`).toBeDefined();
    expect(front!.isDoubleSided).toBe(true);
    expect(front!.backFace?.cardNo).toBe(BACK_NO);
    // 裏面は個別デッキカードではない: 公開プールに top-level で漏れていないこと。
    expect(ALL_CARDS.some((c) => c.cardNo === BACK_NO)).toBe(false);
  });

  it("expandCardDefinitionsWithBackFaces does NOT mutate the input and only appends back faces", () => {
    const before = ALL_CARDS.length;
    const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    // 入力 (= デッキ構築プール) は据え置き。
    expect(ALL_CARDS.length).toBe(before);
    // 展開版は表面を全て含み、かつ裏面を 1 件以上追加している。
    expect(expanded.length).toBeGreaterThan(before);
    expect(expanded.some((c) => c.cardNo === FRONT_NO)).toBe(true);
  });

  it("production getCardDefinitionById resolves the B-face cardNo to a usable definition", () => {
    const { getCardDefinitionById } = buildProductionLookups(ALL_CARDS);
    const backDef = getCardDefinitionById(BACK_NO);
    expect(
      backDef,
      `${BACK_NO} must resolve from the production lookup`
    ).toBeDefined();
    expect(backDef!.cardNo).toBe(BACK_NO);
    expect(backDef!.printedCategory).toBe("nexus");
    // 合成定義は B 面の card_event:"rebirth" 効果を保持する。
    expect(
      backDef!.effects?.some((e) => {
        if (e.timing.kind !== "card_event") return false;
        const events = Array.isArray(e.timing.event)
          ? e.timing.event
          : [e.timing.event];
        return events.includes("rebirth");
      })
    ).toBe(true);
  });

  it("the production triggered-effect registry registers the B-face rebirth effect under the B-face cardNo", () => {
    const { getRegisteredTriggeredEffectActions } =
      buildProductionLookups(ALL_CARDS);
    // 表面 cardNo には rebirth registration は無い (転醒前)。
    const frontRegs = getRegisteredTriggeredEffectActions(FRONT_NO) ?? [];
    expect(frontRegs.some((r) => r.eventKind === "rebirth")).toBe(false);
    // 裏面 cardNo に rebirth registration が登録されている。
    const backRegs = getRegisteredTriggeredEffectActions(BACK_NO) ?? [];
    expect(backRegs.some((r) => r.eventKind === "rebirth")).toBe(true);
  });

  it("executeRebirth flip + collectAndQueueTriggerReactions queues the B-face 転醒時 effect (production lookup)", () => {
    const lookups = buildProductionLookups(ALL_CARDS);
    const front = lookups.getCardDefinitionById(FRONT_NO)!;

    // 転醒ネクサスを場に配置。カウントは maxCount(3) 以下にして転醒条件を満たす。
    const nexus = createCardInstance(front, {
      instanceId: "tenten-1",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "nexus",
      normalCoreCount: 1,
    });
    const before: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [nexus],
    });
    // 既定 countValue は 0 (createPlayerState) で maxCount(3) 以下。転醒条件を満たす。

    // 転醒条件 (game_event トリガー、maxCount 3) を実 effect から取得。
    const rebirthStep = front.effects?.find((e) =>
      e.steps.some((s) => s.action.kind === "rebirth")
    );
    const rebirthAction = rebirthStep?.steps.find(
      (s) => s.action.kind === "rebirth"
    )?.action as RebirthAction;
    expect(rebirthAction?.kind).toBe("rebirth");

    const after = executeRebirth(
      before,
      "alice",
      rebirthAction,
      "tenten-1",
      lookups.getCardDefinitionById,
      "test:rebirth-backface-registration:127"
    );

    // flip 成立: definitionId が B 面へ swap、カウント +1。
    const flipped = after.cardInstances.find(
      (c) => c.instanceId === "tenten-1"
    )!;
    expect(flipped.definitionId).toBe(BACK_NO);
    expect(flipped.zone).toBe("field");
    expect(after.players.find((p) => p.id === "alice")!.countValue).toBe(1);

    // delta から rebirth イベントが 1 件検出される (production lookup 経由)。
    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: null,
      attackId: null,
      getCardDefinitionById: lookups.getCardDefinitionById,
    });
    expect(events.filter((e) => e.eventKind === "rebirth").length).toBe(1);

    // B 面『転醒時』効果が pending triggered effect として queue される。
    const queued = collectAndQueueTriggerReactions({
      chainId: "test:rebirth-backface-registration:155",
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });

    const rebirthPendings = queued.pendingTriggeredEffects.filter(
      (p) => p.eventKind === "rebirth"
    );
    expect(rebirthPendings.length).toBe(1);
    expect(rebirthPendings[0]!.relatedInstanceId).toBe("tenten-1");
    expect(rebirthPendings[0]!.actingPlayerId).toBe("alice");
  });
});
