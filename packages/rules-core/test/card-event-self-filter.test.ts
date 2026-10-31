/**
 * P3-26 card_event timing の self フィルタ漏れ — テスト。
 *
 * 仕様:
 *   - `Timing.card_event` は「このカード自身のイベント」のみで反応する。
 *   - 例:「このスピリットの召喚時」「このスピリットがアタックしたとき」
 *   - 他カードのイベントで反応する場合は `Timing.game_event` を使う。
 *
 * 修正対象:
 *   `getAvailableTriggeredEffectSourceChoices` は registration の元 effect が
 *   `card_event` 由来であるとき、`pendingEffect.relatedInstanceId === sourceCard.instanceId`
 *   を満たさない候補を弾かなければならない。
 */
import { describe, it, expect } from "vitest";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { getAvailableTriggeredEffectSourceChoices } from "../src/effect/trigger-system";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  CardDefinition,
  GameState,
  PendingTriggeredEffect,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

// ============================================================
// ヘルパー
// ============================================================

function makeSpiritDef(cardNo: string, effects: Effect[]): CardDefinition {
  return {
    cardNo,
    name: `テスト ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects,
  };
}

function makePending(
  overrides: Partial<PendingTriggeredEffect> & {
    pendingId: string;
    actingPlayerId: string;
  }
): PendingTriggeredEffect {
  return {
    pendingId: overrides.pendingId,
    actingPlayerId: overrides.actingPlayerId,
    eventKind: overrides.eventKind ?? "summon",
    source: overrides.source ?? "action_resolution",
    chainId: overrides.chainId ?? null,
    attackId: overrides.attackId ?? null,
    relatedPlayerId: overrides.relatedPlayerId ?? null,
    relatedInstanceId: overrides.relatedInstanceId ?? null,
    amount: overrides.amount ?? null,
    step: overrides.step ?? "main",
    window: overrides.window ?? "main_open",
    resolvedSourceInstanceIds: overrides.resolvedSourceInstanceIds ?? [],
  } as PendingTriggeredEffect;
}

const SUMMON_EFFECT: Effect = {
  timing: { kind: "card_event", event: "summon" },
  executionMode: "optional",
  steps: [
    {
      action: {
        kind: "draw",
        player: "self",
        amount: 1,
      },
    },
  ],
};

// ============================================================
// 低レベル単体テスト
// ============================================================

describe("card_event:summon は自身の召喚でのみ source choice に出る", () => {
  function setup(): {
    state: GameState;
    def: CardDefinition;
    selfA: string;
    otherB: string;
    actingPlayer: string;
    lookupActions: ReturnType<typeof buildTriggeredEffectLookup>;
  } {
    const def = makeSpiritDef("TEST-SELF-FILTER-001", [SUMMON_EFFECT]);
    const actingPlayer = "alice";

    const selfA = createCardInstance(def, {
      instanceId: "self-A",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });
    const otherB = createCardInstance(def, {
      instanceId: "other-B",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });

    const state = createEmptyGameState({
      playerIds: [actingPlayer, "bob"],
      cardInstances: [selfA, otherB],
    });

    return {
      state,
      def,
      selfA: selfA.instanceId,
      otherB: otherB.instanceId,
      actingPlayer,
      lookupActions: buildTriggeredEffectLookup([def]),
    };
  }

  it("自身の召喚 (relatedInstanceId === sourceCard.instanceId) では候補に含まれる", () => {
    const { state, def, selfA, actingPlayer, lookupActions } = setup();

    const pending = makePending({
      chainId: "test:card-event-self-filter:133",
      pendingId: "pte:self",
      actingPlayerId: actingPlayer,
      eventKind: "summon",
      relatedPlayerId: actingPlayer,
      relatedInstanceId: selfA, // 自身の召喚
    });

    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: pending,
      getCardDefinitionById: (id) => (id === def.cardNo ? def : undefined),
      getRegisteredTriggeredEffectActions: lookupActions,
    });

    const selfChoice = choices.find((c) => c.sourceCard.instanceId === selfA);
    expect(selfChoice).toBeDefined();
  });

  it("他カードの召喚 (relatedInstanceId !== sourceCard.instanceId) では候補に含まれない", () => {
    const { state, def, selfA, otherB, actingPlayer, lookupActions } = setup();

    const pending = makePending({
      chainId: "test:card-event-self-filter:155",
      pendingId: "pte:other",
      actingPlayerId: actingPlayer,
      eventKind: "summon",
      relatedPlayerId: actingPlayer,
      relatedInstanceId: otherB, // 他カードの召喚
    });

    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: pending,
      getCardDefinitionById: (id) => (id === def.cardNo ? def : undefined),
      getRegisteredTriggeredEffectActions: lookupActions,
    });

    // selfA の card_event:summon は「他カード B の召喚」では発火しない。
    // otherB 自身の card_event:summon は「自身の召喚」として候補に含まれる。
    const selfChoice = choices.find((c) => c.sourceCard.instanceId === selfA);
    expect(selfChoice).toBeUndefined();

    const otherChoice = choices.find((c) => c.sourceCard.instanceId === otherB);
    expect(otherChoice).toBeDefined();
  });

  it("relatedInstanceId === null の pending では card_event はいかなる候補にも残らない (fail-closed)", () => {
    // after_draw のような relatedInstanceId を持たない card_event の self-only 不変条件確認。
    // card_event は「自身のイベント」のみで反応するため、文脈 (= 関連カード) が
    // 取れない場合も fail-closed として弾く。
    const { state, def, lookupActions, actingPlayer } = setup();

    const pending = makePending({
      chainId: "test:card-event-self-filter:185",
      pendingId: "pte:no-context",
      actingPlayerId: actingPlayer,
      eventKind: "summon",
      relatedPlayerId: actingPlayer,
      relatedInstanceId: null,
    });

    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: pending,
      getCardDefinitionById: (id) => (id === def.cardNo ? def : undefined),
      getRegisteredTriggeredEffectActions: lookupActions,
    });

    expect(choices).toHaveLength(0);
  });
});

// ============================================================
// BSTH01-C04 ルーミア統合テスト
// ============================================================

describe("BSTH01-C04 ルーミア card_event:summon は自身以外の召喚で発火しない", () => {
  const cardNoMap = new Map<string, CardDefinition>(
    ALL_CARDS.map((c) => [c.cardNo, c])
  );
  const ルーミア = cardNoMap.get("BSTH01-C04")!;
  const lookupActions = buildTriggeredEffectLookup(ALL_CARDS);

  it("ルーミアがフィールドにいる時、別スピリットの召喚で source choice に含まれない", () => {
    const actingPlayer = "alice";

    // ルーミア (effects[0] = card_event:summon でデッキ上3枚オープン)
    const rumia = createCardInstance(ルーミア, {
      instanceId: "rumia-on-field",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });

    // 別スピリット (ルーミア以外なら何でもよい。同じくスピリットの定義を流用)
    const otherDef = makeSpiritDef("TEST-OTHER-SUMMONED", []);
    const other = createCardInstance(otherDef, {
      instanceId: "other-summoned",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });

    const state = createEmptyGameState({
      playerIds: [actingPlayer, "bob"],
      cardInstances: [rumia, other],
    });

    const pending = makePending({
      chainId: "test:card-event-self-filter:242",
      pendingId: "pte:rumia-bystander",
      actingPlayerId: actingPlayer,
      eventKind: "summon",
      relatedPlayerId: actingPlayer,
      relatedInstanceId: other.instanceId, // 「他カード」の召喚
    });

    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: pending,
      getCardDefinitionById: (id) =>
        cardNoMap.get(id) ?? (id === otherDef.cardNo ? otherDef : undefined),
      getRegisteredTriggeredEffectActions: lookupActions,
    });

    const rumiaChoice = choices.find(
      (c) => c.sourceCard.instanceId === rumia.instanceId
    );
    expect(rumiaChoice).toBeUndefined();
  });

  it("ルーミア自身の召喚では引き続き source choice に含まれる (回帰防止)", () => {
    const actingPlayer = "alice";

    const rumia = createCardInstance(ルーミア, {
      instanceId: "rumia-just-summoned",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });

    const state = createEmptyGameState({
      playerIds: [actingPlayer, "bob"],
      cardInstances: [rumia],
    });

    const pending = makePending({
      chainId: "test:card-event-self-filter:280",
      pendingId: "pte:rumia-self",
      actingPlayerId: actingPlayer,
      eventKind: "summon",
      relatedPlayerId: actingPlayer,
      relatedInstanceId: rumia.instanceId, // 自身の召喚
    });

    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: pending,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: lookupActions,
    });

    const rumiaChoice = choices.find(
      (c) => c.sourceCard.instanceId === rumia.instanceId
    );
    // ルーミアの card_event:summon (effects[0]) のみ拾う想定
    expect(rumiaChoice).toBeDefined();
  });
});
