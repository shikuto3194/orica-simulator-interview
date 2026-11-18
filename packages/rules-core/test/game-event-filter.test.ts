/**
 * P3-27 game_event timing の player / triggerFilter 反映漏れ — テスト。
 *
 * 仕様:
 *   - `Timing.game_event` の `player` (誰の召喚に反応するか) と
 *     `triggerFilter` (召喚されたカードのフィルタ) は registration → candidate 列挙時に
 *     評価される必要がある。
 *
 * 修正対象:
 *   `getAvailableTriggeredEffectSourceChoices` は registration の元 effect が
 *   `game_event` 由来であるとき、`player` と `triggerFilter` を pendingEffect の
 *   relatedPlayerId / relatedInstanceId に対して評価しなければならない。
 */
import { describe, it, expect } from "vitest";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { getAvailableTriggeredEffectSourceChoices } from "../src/effect/trigger-system";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type {
  CardDefinition,
  GameState,
  PendingTriggeredEffect,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

// ============================================================
// ヘルパー
// ============================================================

function makeSpiritDef(
  cardNo: string,
  effects: Effect[],
  overrides?: Partial<CardDefinition>
): CardDefinition {
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
    ...overrides,
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
    ...(overrides.fromZone !== undefined
      ? { fromZone: overrides.fromZone }
      : {}),
  } as PendingTriggeredEffect;
}

// ============================================================
// player フィルタ
// ============================================================

describe("game_event:summon の player フィルタ", () => {
  function setup(player: "self" | "opponent" | "either"): {
    state: GameState;
    sourceDef: CardDefinition;
    triggerDef: CardDefinition;
    sourceCardId: string;
    selfTriggerId: string;
    opponentTriggerId: string;
    actingPlayer: string;
    opponent: string;
    lookupActions: ReturnType<typeof buildTriggeredEffectLookup>;
    getDef: (id: string) => CardDefinition | undefined;
  } {
    const actingPlayer = "alice";
    const opponent = "bob";

    const sourceEffect: Effect = {
      timing: {
        kind: "game_event",
        player,
        event: "summon",
      },
      executionMode: "optional",
      steps: [{ action: { kind: "draw", player: "self", amount: 1 } }],
    };
    const sourceDef = makeSpiritDef("TEST-GE-SOURCE", [sourceEffect]);
    const triggerDef = makeSpiritDef("TEST-GE-TRIGGER", []);

    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "ge-src",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });
    const selfTrigger = createCardInstance(triggerDef, {
      instanceId: "ge-self-trg",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });
    const opponentTrigger = createCardInstance(triggerDef, {
      instanceId: "ge-opp-trg",
      ownerPlayerId: opponent,
      controllerPlayerId: opponent,
      zone: "field",
      normalCoreCount: 1,
    });

    const state = createEmptyGameState({
      playerIds: [actingPlayer, opponent],
      cardInstances: [sourceCard, selfTrigger, opponentTrigger],
    });

    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [triggerDef.cardNo, triggerDef],
    ]);

    return {
      state,
      sourceDef,
      triggerDef,
      sourceCardId: sourceCard.instanceId,
      selfTriggerId: selfTrigger.instanceId,
      opponentTriggerId: opponentTrigger.instanceId,
      actingPlayer,
      opponent,
      lookupActions: buildTriggeredEffectLookup([sourceDef, triggerDef]),
      getDef: (id) => defs.get(id),
    };
  }

  it("player='self': 自分の召喚で source が候補に含まれる", () => {
    const ctx = setup("self");
    const pending = makePending({
      pendingId: "pte:self-ok",
      actingPlayerId: ctx.actingPlayer,
      relatedPlayerId: ctx.actingPlayer,
      relatedInstanceId: ctx.selfTriggerId,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeDefined();
  });

  it("player='self': 相手の召喚で source は候補に含まれない", () => {
    const ctx = setup("self");
    const pending = makePending({
      pendingId: "pte:self-ng",
      actingPlayerId: ctx.actingPlayer,
      relatedPlayerId: ctx.opponent,
      relatedInstanceId: ctx.opponentTriggerId,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeUndefined();
  });

  it("player='opponent': 相手の召喚で source が候補に含まれる", () => {
    const ctx = setup("opponent");
    const pending = makePending({
      pendingId: "pte:opp-ok",
      actingPlayerId: ctx.actingPlayer,
      relatedPlayerId: ctx.opponent,
      relatedInstanceId: ctx.opponentTriggerId,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeDefined();
  });

  it("player='opponent': 自分の召喚で source は候補に含まれない", () => {
    const ctx = setup("opponent");
    const pending = makePending({
      pendingId: "pte:opp-ng",
      actingPlayerId: ctx.actingPlayer,
      relatedPlayerId: ctx.actingPlayer,
      relatedInstanceId: ctx.selfTriggerId,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeUndefined();
  });

  it("player='either': 自分・相手いずれの召喚でも候補に含まれる", () => {
    const ctx = setup("either");

    const selfPending = makePending({
      pendingId: "pte:either-self",
      actingPlayerId: ctx.actingPlayer,
      relatedPlayerId: ctx.actingPlayer,
      relatedInstanceId: ctx.selfTriggerId,
    });
    expect(
      getAvailableTriggeredEffectSourceChoices({
        state: ctx.state,
        pendingEffect: selfPending,
        getCardDefinitionById: ctx.getDef,
        getRegisteredTriggeredEffectActions: ctx.lookupActions,
      }).find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeDefined();

    const oppPending = makePending({
      pendingId: "pte:either-opp",
      actingPlayerId: ctx.actingPlayer,
      relatedPlayerId: ctx.opponent,
      relatedInstanceId: ctx.opponentTriggerId,
    });
    expect(
      getAvailableTriggeredEffectSourceChoices({
        state: ctx.state,
        pendingEffect: oppPending,
        getCardDefinitionById: ctx.getDef,
        getRegisteredTriggeredEffectActions: ctx.lookupActions,
      }).find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeDefined();
  });
});

// ============================================================
// triggerFilter 評価
// ============================================================

describe("game_event:summon の triggerFilter 評価", () => {
  function setup(): {
    state: GameState;
    sourceDef: CardDefinition;
    matchingDef: CardDefinition;
    nonMatchingDef: CardDefinition;
    sourceCardId: string;
    matchingCardId: string;
    nonMatchingCardId: string;
    actingPlayer: string;
    lookupActions: ReturnType<typeof buildTriggeredEffectLookup>;
    getDef: (id: string) => CardDefinition | undefined;
  } {
    const actingPlayer = "alice";

    const sourceEffect: Effect = {
      timing: {
        kind: "game_event",
        player: "self",
        event: "summon",
        triggerFilter: {
          category: ["spirit"],
          colors: ["red"],
          tribes: ["夜族"],
          minCost: 8,
        },
      },
      executionMode: "optional",
      steps: [{ action: { kind: "draw", player: "self", amount: 1 } }],
    };
    const sourceDef = makeSpiritDef("TEST-GE-FILTER-SRC", [sourceEffect]);

    // フィルタにマッチ: 赤・夜族・cost 8
    const matchingDef = makeSpiritDef("TEST-GE-MATCHING", [], {
      colors: ["red"],
      cost: 8,
      tribe: "夜族",
    });
    // フィルタ不一致: 赤・夜族・cost 5 (minCost 8 を満たさない)
    const nonMatchingDef = makeSpiritDef("TEST-GE-NONMATCHING", [], {
      colors: ["red"],
      cost: 5,
      tribe: "夜族",
    });

    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "ge-flt-src",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });
    const matchingCard = createCardInstance(matchingDef, {
      instanceId: "ge-flt-match",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });
    const nonMatchingCard = createCardInstance(nonMatchingDef, {
      instanceId: "ge-flt-nomatch",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });

    const state = createEmptyGameState({
      playerIds: [actingPlayer, "bob"],
      cardInstances: [sourceCard, matchingCard, nonMatchingCard],
    });

    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [matchingDef.cardNo, matchingDef],
      [nonMatchingDef.cardNo, nonMatchingDef],
    ]);

    return {
      state,
      sourceDef,
      matchingDef,
      nonMatchingDef,
      sourceCardId: sourceCard.instanceId,
      matchingCardId: matchingCard.instanceId,
      nonMatchingCardId: nonMatchingCard.instanceId,
      actingPlayer,
      lookupActions: buildTriggeredEffectLookup([
        sourceDef,
        matchingDef,
        nonMatchingDef,
      ]),
      getDef: (id) => defs.get(id),
    };
  }

  it("filter にマッチするカードの召喚で source が候補に含まれる", () => {
    const ctx = setup();
    const pending = makePending({
      pendingId: "pte:flt-ok",
      actingPlayerId: ctx.actingPlayer,
      relatedPlayerId: ctx.actingPlayer,
      relatedInstanceId: ctx.matchingCardId,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeDefined();
  });

  it("filter 不一致のカード (cost 5 < minCost 8) の召喚では候補に含まれない", () => {
    const ctx = setup();
    const pending = makePending({
      pendingId: "pte:flt-ng",
      actingPlayerId: ctx.actingPlayer,
      relatedPlayerId: ctx.actingPlayer,
      relatedInstanceId: ctx.nonMatchingCardId,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeUndefined();
  });

  it("triggerFilter 指定時に relatedInstanceId が null なら候補に含まれない (fail-closed)", () => {
    const ctx = setup();
    const pending = makePending({
      pendingId: "pte:flt-no-context",
      actingPlayerId: ctx.actingPlayer,
      relatedPlayerId: ctx.actingPlayer,
      relatedInstanceId: null,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeUndefined();
  });
});

// ============================================================
// excludeTriggerSelf 自己除外 (BSTS01-CX01「このスピリットの召喚以外で」)
// ============================================================

describe("game_event の excludeTriggerSelf 自己除外", () => {
  function setup(): {
    state: GameState;
    sourceCardId: string;
    otherCardId: string;
    actingPlayer: string;
    lookupActions: ReturnType<typeof buildTriggeredEffectLookup>;
    getDef: (id: string) => CardDefinition | undefined;
  } {
    const actingPlayer = "alice";

    // BSTS01-CX01[2,3,4] 同型: 自分の系統「暴嵐」の召喚/煌臨/配置でカウント+1。
    // 「このスピリットの召喚以外で」= excludeTriggerSelf:true。source 自身も系統「暴嵐」
    // なので、source 自身の召喚では triggerFilter は通るが自己除外で候補から外れる。
    const sourceEffect: Effect = {
      timing: {
        kind: "game_event",
        player: "self",
        event: ["summon", "advent", "place"],
        triggerFilter: { tribes: ["暴嵐"] },
        excludeTriggerSelf: true,
      },
      executionMode: "optional",
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    };
    const sourceDef = makeSpiritDef("TEST-GE-EXSELF-SRC", [sourceEffect], {
      tribe: "暴嵐",
    });
    // 別の系統「暴嵐」カード (triggerFilter にマッチ、自己でない)。
    const otherDef = makeSpiritDef("TEST-GE-EXSELF-OTHER", [], {
      tribe: "暴嵐",
    });

    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "ge-exself-src",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });
    const otherCard = createCardInstance(otherDef, {
      instanceId: "ge-exself-other",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });

    const state = createEmptyGameState({
      playerIds: [actingPlayer, "bob"],
      cardInstances: [sourceCard, otherCard],
    });

    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [otherDef.cardNo, otherDef],
    ]);

    return {
      state,
      sourceCardId: sourceCard.instanceId,
      otherCardId: otherCard.instanceId,
      actingPlayer,
      lookupActions: buildTriggeredEffectLookup([sourceDef, otherDef]),
      getDef: (id) => defs.get(id),
    };
  }

  it("自カード自身の召喚では候補に含まれない (自己除外)", () => {
    const ctx = setup();
    const pending = makePending({
      pendingId: "pte:exself-self",
      actingPlayerId: ctx.actingPlayer,
      relatedPlayerId: ctx.actingPlayer,
      relatedInstanceId: ctx.sourceCardId,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeUndefined();
  });

  it("別の系統「暴嵐」カードの召喚では候補に含まれる", () => {
    const ctx = setup();
    const pending = makePending({
      pendingId: "pte:exself-other",
      actingPlayerId: ctx.actingPlayer,
      relatedPlayerId: ctx.actingPlayer,
      relatedInstanceId: ctx.otherCardId,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeDefined();
  });

  it("自カード自身の煌臨 (advent) でも自己除外される", () => {
    const ctx = setup();
    const pending = makePending({
      chainId: "test:game-event-filter:538",
      pendingId: "pte:exself-advent",
      actingPlayerId: ctx.actingPlayer,
      eventKind: "advent",
      relatedPlayerId: ctx.actingPlayer,
      relatedInstanceId: ctx.sourceCardId,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeUndefined();
  });
});

// ============================================================
// trigger_from_zone (場入り前ゾーン) condition 評価
// 「手札から召喚したとき」= condition trigger_from_zone(hand) を pendingEffect.fromZone
// (collectTriggerEvents が場入り前ゾーンを載せる) で listing 時に評価する。
// BSTH07.8-XX01[2] 導域: 妖精スピリットを手札から召喚→1ドロー、の基盤。
// ============================================================

describe("game_event:summon の trigger_from_zone 条件", () => {
  function setup(): {
    state: GameState;
    sourceCardId: string;
    triggerCardId: string;
    actingPlayer: string;
    lookupActions: ReturnType<typeof buildTriggeredEffectLookup>;
    getDef: (id: string) => CardDefinition | undefined;
  } {
    const actingPlayer = "alice";

    // 自分の妖精スピリットを「手札から」召喚したとき 1 ドロー。
    const sourceEffect: Effect = {
      timing: {
        kind: "game_event",
        player: "self",
        event: "summon",
        triggerFilter: { tribes: ["妖精"], category: ["spirit"] },
      },
      condition: [{ kind: "trigger_from_zone", zones: ["hand"] }],
      executionMode: "optional",
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    };
    const sourceDef = makeSpiritDef("TEST-GE-FROMZONE-SRC", [sourceEffect]);
    const fairyDef = makeSpiritDef("TEST-GE-FROMZONE-FAIRY", [], {
      tribe: "妖精",
    });

    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "ge-fz-src",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });
    const fairyCard = createCardInstance(fairyDef, {
      instanceId: "ge-fz-fairy",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });

    const state = createEmptyGameState({
      playerIds: [actingPlayer, "bob"],
      cardInstances: [sourceCard, fairyCard],
    });

    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
      [fairyDef.cardNo, fairyDef],
    ]);

    return {
      state,
      sourceCardId: sourceCard.instanceId,
      triggerCardId: fairyCard.instanceId,
      actingPlayer,
      lookupActions: buildTriggeredEffectLookup([sourceDef, fairyDef]),
      getDef: (id) => defs.get(id),
    };
  }

  it("fromZone='hand' の召喚で source が候補に含まれる", () => {
    const ctx = setup();
    const pending = makePending({
      pendingId: "pte:fz-hand",
      actingPlayerId: ctx.actingPlayer,
      relatedPlayerId: ctx.actingPlayer,
      relatedInstanceId: ctx.triggerCardId,
      fromZone: "hand",
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeDefined();
  });

  it("fromZone='trash' の召喚では候補に含まれない (手札以外は不発)", () => {
    const ctx = setup();
    const pending = makePending({
      pendingId: "pte:fz-trash",
      actingPlayerId: ctx.actingPlayer,
      relatedPlayerId: ctx.actingPlayer,
      relatedInstanceId: ctx.triggerCardId,
      fromZone: "trash",
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeUndefined();
  });

  it("fromZone 未注入では候補に含まれない (fail-closed)", () => {
    const ctx = setup();
    const pending = makePending({
      pendingId: "pte:fz-none",
      actingPlayerId: ctx.actingPlayer,
      relatedPlayerId: ctx.actingPlayer,
      relatedInstanceId: ctx.triggerCardId,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeUndefined();
  });
});

// ============================================================
// player フィルタ fail-closed
// ============================================================

describe("game_event:summon の player フィルタ (fail-closed)", () => {
  it("player='self' で relatedPlayerId が null なら候補に含まれない", () => {
    const actingPlayer = "alice";
    const sourceEffect: Effect = {
      timing: { kind: "game_event", player: "self", event: "summon" },
      executionMode: "optional",
      steps: [{ action: { kind: "draw", player: "self", amount: 1 } }],
    };
    const sourceDef = makeSpiritDef("TEST-GE-PLAYER-NULL", [sourceEffect]);
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "ge-pn-src",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [actingPlayer, "bob"],
      cardInstances: [sourceCard],
    });

    const pending = makePending({
      pendingId: "pte:player-null",
      actingPlayerId: actingPlayer,
      relatedPlayerId: null,
      relatedInstanceId: null,
    });

    const choices = getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect: pending,
      getCardDefinitionById: (id) =>
        id === sourceDef.cardNo ? sourceDef : undefined,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        sourceDef,
      ]),
    });

    expect(
      choices.find((c) => c.sourceCard.instanceId === sourceCard.instanceId)
    ).toBeUndefined();
  });
});

// ============================================================
// requireTriggerSelf 自己ソース帰属 (BSTS01-CX01「この『リムル』の効果で…」)
// ============================================================

describe("game_event の requireTriggerSelf 自己ソース帰属", () => {
  function setup(): {
    state: GameState;
    sourceCardId: string;
    actingPlayer: string;
    lookupActions: ReturnType<typeof buildTriggeredEffectLookup>;
    getDef: (id: string) => CardDefinition | undefined;
  } {
    const actingPlayer = "alice";

    // BSTS01-CX01[5,6,7] 同型: 「この『リムル』の効果で自分のカウントが増えたとき」。
    // requireTriggerSelf:true で count_increase の発生源カードが listener 自身の
    // instance に一致するときだけ反応する。relatedInstanceId には
    // causedBySourceInstanceId (=効果発揮元カード) が乗る。
    const sourceEffect: Effect = {
      timing: {
        kind: "game_event",
        player: "self",
        event: "count_increase",
        requireTriggerSelf: true,
      },
      executionMode: "optional",
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    };
    const sourceDef = makeSpiritDef("TEST-GE-REQSELF-SRC", [sourceEffect]);

    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "ge-reqself-src",
      ownerPlayerId: actingPlayer,
      controllerPlayerId: actingPlayer,
      zone: "field",
      normalCoreCount: 1,
    });

    const state = createEmptyGameState({
      playerIds: [actingPlayer, "bob"],
      cardInstances: [sourceCard],
    });

    const defs = new Map<string, CardDefinition>([
      [sourceDef.cardNo, sourceDef],
    ]);

    return {
      state,
      sourceCardId: sourceCard.instanceId,
      actingPlayer,
      lookupActions: buildTriggeredEffectLookup([sourceDef]),
      getDef: (id) => defs.get(id),
    };
  }

  it("自カード自身の効果由来 count_increase は候補に含まれる", () => {
    const ctx = setup();
    const pending = makePending({
      chainId: "test:game-event-filter:793",
      pendingId: "pte:reqself-self",
      actingPlayerId: ctx.actingPlayer,
      eventKind: "count_increase",
      relatedPlayerId: ctx.actingPlayer,
      relatedInstanceId: ctx.sourceCardId,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeDefined();
  });

  it("他カードの効果由来 count_increase は候補に含まれない", () => {
    const ctx = setup();
    const pending = makePending({
      chainId: "test:game-event-filter:813",
      pendingId: "pte:reqself-other",
      actingPlayerId: ctx.actingPlayer,
      eventKind: "count_increase",
      relatedPlayerId: ctx.actingPlayer,
      relatedInstanceId: "some-other-card",
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeUndefined();
  });

  it("relatedInstanceId が null (源不明の count_increase) でも候補に含まれない", () => {
    const ctx = setup();
    const pending = makePending({
      chainId: "test:game-event-filter:833",
      pendingId: "pte:reqself-null",
      actingPlayerId: ctx.actingPlayer,
      eventKind: "count_increase",
      relatedPlayerId: ctx.actingPlayer,
      relatedInstanceId: null,
    });
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: ctx.state,
      pendingEffect: pending,
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookupActions,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.sourceCardId)
    ).toBeUndefined();
  });
});
