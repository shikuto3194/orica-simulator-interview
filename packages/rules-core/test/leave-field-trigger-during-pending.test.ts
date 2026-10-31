/**
 * ENGINE-leave-field-trigger-during-pending (2026-06-25, engine-claude lane)
 *
 * 仕様:
 *   `Timing.card_event` の `event:"leave_field"` 宣言は「フィールドを離れるとき」の
 *   umbrella term として、pendingLeave 生成時の pre-flush emission (destroy / vanish /
 *   bounce) を match させる。これにより `stay_on_field` / `rebirth` 等の pre-flush 必須
 *   アクションが正しく発火する (BSLH01-R01, BSLH01-TR01(A), BSGE01-R01..R05,
 *   BSTH03-M08 等の既存カード群が silent broken だった件の解消)。
 *
 *   post-flush eventKind="leave_field" emission 自体に対しては宣言と直接 match するが
 *   sourceCard.zone が "trash" となるため別途 sourceZone gate で弾かれる (burst 専用経路へ)。
 *
 *   CardEventType に "bounce" が無いため `event:"bounce"` を直接宣言する DSL は無いが、
 *   leave_field 宣言の自動展開で bounce 由来の pre-flush 離脱もカバーされる。
 */
import { describe, it, expect } from "vitest";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { getAvailableTriggeredEffectSourceChoices } from "../src/effect/trigger-system";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type {
  CardDefinition,
  GameState,
  PendingTriggeredEffect,
  TriggerEventKind,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

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
    eventKind: TriggerEventKind;
    relatedInstanceId: string;
  }
): PendingTriggeredEffect {
  return {
    pendingId: overrides.pendingId,
    actingPlayerId: overrides.actingPlayerId,
    eventKind: overrides.eventKind,
    source: overrides.source ?? "action_resolution",
    chainId: overrides.chainId ?? null,
    attackId: overrides.attackId ?? null,
    relatedPlayerId:
      overrides.relatedPlayerId ?? overrides.actingPlayerId ?? null,
    relatedInstanceId: overrides.relatedInstanceId,
    amount: overrides.amount ?? null,
    step: overrides.step ?? "main",
    window: overrides.window ?? "main_open",
    resolvedSourceInstanceIds: overrides.resolvedSourceInstanceIds ?? [],
    ...(overrides.cause !== undefined ? { cause: overrides.cause } : {}),
  } as PendingTriggeredEffect;
}

const LEAVE_FIELD_EFFECT: Effect = {
  timing: { kind: "card_event", event: "leave_field" },
  executionMode: "optional",
  steps: [
    {
      action: {
        kind: "core_move",
        from: { kind: "void", player: "self" },
        to: { kind: "this_card" },
        amount: 1,
      },
    },
    {
      action: { kind: "stay_on_field", target: { kind: "self" } },
      connector: "conditional_cost",
    },
  ],
};

describe('ENGINE-leave-field-trigger-during-pending: event:"leave_field" は pre-flush destroy/vanish/bounce に match する', () => {
  function setup(): {
    state: GameState;
    def: CardDefinition;
    selfId: string;
    actingPlayer: string;
    lookupActions: ReturnType<typeof buildTriggeredEffectLookup>;
  } {
    const def = makeSpiritDef("TEST-LEAVE-FIELD-UMBRELLA-001", [
      LEAVE_FIELD_EFFECT,
    ]);
    const actingPlayer = "alice";
    const self = createCardInstance(def, {
      instanceId: "self-A",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [actingPlayer, "bob"],
      cardInstances: [self],
    });
    return {
      state,
      def,
      selfId: self.instanceId,
      actingPlayer,
      lookupActions: buildTriggeredEffectLookup([def]),
    };
  }

  it('pre-flush eventKind="destroy" は宣言 event:"leave_field" の自カードを source choice に含める', () => {
    const { state, def, selfId, actingPlayer, lookupActions } = setup();
    const pending = makePending({
      chainId: "test:leave-field-trigger-during-pending:126",
      pendingId: "pte:destroy",
      actingPlayerId: actingPlayer,
      eventKind: "destroy",
      relatedInstanceId: selfId,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: pending,
      getCardDefinitionById: (id) => (id === def.cardNo ? def : undefined),
      getRegisteredTriggeredEffectActions: lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === selfId)
    ).toBeDefined();
  });

  it('pre-flush eventKind="vanish" も leave_field 宣言にマッチする', () => {
    const { state, def, selfId, actingPlayer, lookupActions } = setup();
    const pending = makePending({
      chainId: "test:leave-field-trigger-during-pending:145",
      pendingId: "pte:vanish",
      actingPlayerId: actingPlayer,
      eventKind: "vanish",
      relatedInstanceId: selfId,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: pending,
      getCardDefinitionById: (id) => (id === def.cardNo ? def : undefined),
      getRegisteredTriggeredEffectActions: lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === selfId)
    ).toBeDefined();
  });

  it('pre-flush eventKind="bounce" も leave_field 宣言にマッチする (DSL 直接宣言不可の代替路)', () => {
    const { state, def, selfId, actingPlayer, lookupActions } = setup();
    const pending = makePending({
      chainId: "test:leave-field-trigger-during-pending:164",
      pendingId: "pte:bounce",
      actingPlayerId: actingPlayer,
      eventKind: "bounce",
      relatedInstanceId: selfId,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: pending,
      getCardDefinitionById: (id) => (id === def.cardNo ? def : undefined),
      getRegisteredTriggeredEffectActions: lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === selfId)
    ).toBeDefined();
  });

  it('post-flush eventKind="leave_field" 単体は宣言と直接 match するが zone=trash で別途弾かれる', () => {
    const {
      state: baseState,
      def,
      selfId,
      actingPlayer,
      lookupActions,
    } = setup();
    // 物理離脱完了を模擬: source カードを trash へ移動
    const state: GameState = {
      ...baseState,
      cardInstances: baseState.cardInstances.map((c) =>
        c.instanceId === selfId ? { ...c, zone: "trash" } : c
      ),
    };
    const pending = makePending({
      chainId: "test:leave-field-trigger-during-pending:196",
      pendingId: "pte:leave-field-post-flush",
      actingPlayerId: actingPlayer,
      eventKind: "leave_field",
      relatedInstanceId: selfId,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: pending,
      getCardDefinitionById: (id) => (id === def.cardNo ? def : undefined),
      getRegisteredTriggeredEffectActions: lookupActions,
    });
    // sourceZone="field" default 検査で弾かれ source choice は空。
    expect(
      choices.find((c) => c.sourceCard.instanceId === selfId)
    ).toBeUndefined();
  });

  it('leave_field を宣言していない event:"summon" 単体は destroy 等で発火しない (umbrella の影響範囲を狭める回帰ガード)', () => {
    const summonOnlyDef = makeSpiritDef("TEST-LEAVE-FIELD-UMBRELLA-002", [
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", player: "self", amount: 1 } }],
      },
    ]);
    const actingPlayer = "alice";
    const self = createCardInstance(summonOnlyDef, {
      instanceId: "summon-only-A",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [actingPlayer, "bob"],
      cardInstances: [self],
    });
    const pending = makePending({
      chainId: "test:leave-field-trigger-during-pending:234",
      pendingId: "pte:destroy-against-summon",
      actingPlayerId: actingPlayer,
      eventKind: "destroy",
      relatedInstanceId: self.instanceId,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: pending,
      getCardDefinitionById: (id) =>
        id === summonOnlyDef.cardNo ? summonOnlyDef : undefined,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        summonOnlyDef,
      ]),
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === self.instanceId)
    ).toBeUndefined();
  });

  it('event:["leave_field","summon"] 配列宣言は summon と destroy/vanish/bounce の両系統に反応する', () => {
    const bothDef = makeSpiritDef("TEST-LEAVE-FIELD-UMBRELLA-003", [
      {
        timing: {
          kind: "card_event",
          event: ["leave_field", "summon"],
        },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", player: "self", amount: 1 } }],
      },
    ]);
    const actingPlayer = "alice";
    const self = createCardInstance(bothDef, {
      instanceId: "both-A",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [actingPlayer, "bob"],
      cardInstances: [self],
    });
    const lookup = buildTriggeredEffectLookup([bothDef]);
    for (const kind of ["destroy", "vanish", "bounce", "summon"] as const) {
      const pending = makePending({
        chainId: "test:leave-field-trigger-during-pending:279",
        pendingId: `pte:${kind}`,
        actingPlayerId: actingPlayer,
        eventKind: kind as TriggerEventKind,
        relatedInstanceId: self.instanceId,
      });
      const choices = getAvailableTriggeredEffectSourceChoices({
        state,
        pendingEffect: pending,
        getCardDefinitionById: (id) =>
          id === bothDef.cardNo ? bothDef : undefined,
        getRegisteredTriggeredEffectActions: lookup,
      });
      expect(
        choices.find((c) => c.sourceCard.instanceId === self.instanceId),
        `${kind} 期待: source 候補に含まれる`
      ).toBeDefined();
    }
  });
});
