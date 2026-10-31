/**
 * リグレッション: 1 つの誘発イベント (pending) に複数 responder が乗るとき、
 * 解決キューは responder ごとに 1 カードへ展開され、各カードが
 * resolve_pending_triggered_effect (source ごとに 1 件) と 1:1 対応する。
 *
 * 再現シナリオ (snapshot 2026-05-30 と同型):
 *   レミリア・スカーレット (BSTH01-X03, コスト8/赤/夜族) を召喚すると
 *     - レミリア自身の『召喚時』(card_event:summon)
 *     - 紅魔館 (BSTH01-R21) Lv2「夜族コスト8以上の赤スピリット召喚時」(game_event:summon)
 *   が同一 summon pending に同時誘発する。
 *
 * 修正前は overlay が pending 1 件 = カード 1 枚に collapse し、
 * 「発揮する/しない」が 2 組必要なのにキュー画像は 1 枚しか出ず、ボタンと効果の
 * 対応が不明だった (847638d 空撃ち実装で対象不在のレミリア効果が発揮可能化し顕在化)。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "@orica/rules-core";
import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "@orica/rules-core";
import { ALL_CARDS } from "@orica/card-data";
import { buildEffectQueue } from "../src/components/EffectQueueOverlay";

const byNo = new Map<string, CardDefinition>(
  (ALL_CARDS as CardDefinition[]).map((c) => [c.cardNo, c])
);
const getDefinition = (id: string) => byNo.get(id);
const triggeredLookup = buildTriggeredEffectLookup(
  ALL_CARDS as CardDefinition[]
);

function buildSummonState(): GameState {
  const remilia = createCardInstance(byNo.get("BSTH01-X03")!, {
    instanceId: "card-remilia",
    ownerPlayerId: "alice",
    zone: "field",
    zoneRoleName: "spirit",
    cores: 1, // Lv1
  });
  const koumakan = createCardInstance(byNo.get("BSTH01-R21")!, {
    instanceId: "card-koumakan",
    ownerPlayerId: "alice",
    zone: "field",
    zoneRoleName: "nexus",
    cores: 1, // Lv2 (game_event summon trigger は applicability level>=2)
  });
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [remilia, koumakan],
    }),
    activePlayerId: "alice",
    step: "main" as const,
    pendingTriggeredEffects: [
      {
        pendingId: "pte-summon-remilia",
        actingPlayerId: "alice",
        eventKind: "summon",
        event: {
          family: "enter_field",
          actionKind: "summon",
          validationMode: "require_related_instance_on_field",
        },
        source: "action_resolution",
        chainId: "play:alice:summon:card-remilia",
        attackId: null,
        relatedPlayerId: "alice",
        relatedInstanceId: "card-remilia",
        amount: null,
        step: "main",
        window: "none",
        resolvedSourceInstanceIds: [],
        simultaneousGroupId: "sim-group:1",
      },
    ],
  } as GameState;
}

describe("解決キュー: 1 pending 複数 responder の展開", () => {
  it("responder ごとに 1 カードへ展開され、id と sourceInstanceId が一意になる", () => {
    const state = buildSummonState();

    // 前提: engine は同一 pending に 2 件の resolve action を生成する
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const resolveActions = actions.filter(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    expect(resolveActions.length).toBe(2);
    const actionSources = new Set(
      resolveActions.map(
        (a) => (a as { sourceInstanceId?: string }).sourceInstanceId
      )
    );
    expect(actionSources).toEqual(new Set(["card-remilia", "card-koumakan"]));

    // 修正の本体: overlay も 2 カードへ展開し、ボタンと 1:1 対応する
    const items = buildEffectQueue(
      state,
      getDefinition,
      triggeredLookup,
      "alice"
    );
    const triggered = items.filter((i) => i.kind === "triggered");
    expect(triggered.length).toBe(2);

    // 各カードが responder を一意に指す (sourceInstanceId) こと
    expect(new Set(triggered.map((i) => i.sourceInstanceId))).toEqual(
      new Set(["card-remilia", "card-koumakan"])
    );
    // overlay の id が一意であること (focusStack / key 衝突防止)
    expect(new Set(triggered.map((i) => i.id)).size).toBe(2);

    // EffectQueueOverlay が参照する (pendingId, sourceInstanceId) の組が
    // overlay カードと action で一致すること
    for (const action of resolveActions) {
      const a = action as { sourceInstanceId?: string };
      const match = triggered.find(
        (i) => i.sourceInstanceId === a.sourceInstanceId
      );
      expect(match).toBeDefined();
    }
  });

  it("responder ごとに timing ラベルと効果テキストが正しく分かれる", () => {
    const state = buildSummonState();
    const items = buildEffectQueue(
      state,
      getDefinition,
      triggeredLookup,
      "alice"
    );
    const remilia = items.find((i) => i.sourceInstanceId === "card-remilia");
    const koumakan = items.find((i) => i.sourceInstanceId === "card-koumakan");
    expect(remilia).toBeDefined();
    expect(koumakan).toBeDefined();

    // ラベル: card_event『召喚時』と game_event「召喚されたとき」を区別する
    expect(remilia!.timingLabel).toBe("召喚時");
    expect(koumakan!.timingLabel).toBe("召喚されたとき");

    // 紅魔館の効果テキストは該当効果 (召喚されたとき → ライフ5) のみ。
    // フラッシュ効果 (お互いのアタックステップ / BP5000以下) を混入させない。
    expect(koumakan!.effectText).toContain("召喚されたとき");
    expect(koumakan!.effectText).not.toContain("お互いのアタックステップ");
    expect(koumakan!.effectText).not.toContain("BP5000以下");
  });

  it("一部 responder 解決済みのとき、残りの responder を表示する (解決済みは出さない)", () => {
    // 再現: 紅魔館 (card-koumakan) を先に解決 → resolvedSourceInstanceIds に入る。
    // 残るレミリア本体 (card-remilia) の召喚時 (空撃ち) だけが legal action。
    // resolution-items 側で resolvedSourceInstanceIds を「表示ソース」と誤用すると
    // 解決済みの紅魔館を表示し、残る action (レミリア) と source 不一致で
    // 前面カードの操作ボタンが消える (空撃ちバグ)。
    const state = buildSummonState();
    state.pendingTriggeredEffects = state.pendingTriggeredEffects.map((p) => ({
      ...p,
      resolvedSourceInstanceIds: ["card-koumakan"],
    }));

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });
    const resolveActions = actions.filter(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    // engine は残りの responder (レミリア) の resolve を 1 件返す
    expect(resolveActions.length).toBe(1);
    expect(
      (resolveActions[0] as { sourceInstanceId?: string }).sourceInstanceId
    ).toBe("card-remilia");

    // キューも残りの responder (レミリア) を表示し、action と source 一致する
    const items = buildEffectQueue(
      state,
      getDefinition,
      triggeredLookup,
      "alice"
    );
    const triggered = items.filter((i) => i.kind === "triggered");
    expect(triggered.length).toBe(1);
    expect(triggered[0]?.sourceInstanceId).toBe("card-remilia");
    expect(triggered[0]?.cardName).toBe("レミリア・スカーレット");
    expect(triggered[0]?.timingLabel).toBe("召喚時");
  });

  it("単一 responder では従来どおり 1 カード (id は pte- プレフィックスのまま)", () => {
    const state = buildSummonState();
    // 紅魔館を取り除き、レミリア単独に
    state.cardInstances = state.cardInstances.filter(
      (c) => c.instanceId !== "card-koumakan"
    );
    const items = buildEffectQueue(
      state,
      getDefinition,
      triggeredLookup,
      "alice"
    );
    const triggered = items.filter((i) => i.kind === "triggered");
    expect(triggered.length).toBe(1);
    expect(triggered[0]?.id).toBe("pte-pte-summon-remilia");
    expect(triggered[0]?.sourceInstanceId).toBe("card-remilia");
  });
});
