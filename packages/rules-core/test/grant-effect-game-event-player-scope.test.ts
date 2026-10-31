/**
 * ENGINE-grant-effect-game-event-player-scope:
 *
 * grantedEffectMatchesEvent が game_event 付与でも timing.player /
 * triggerFilter / excludeTriggerSelf / requireTriggerSelf を通常 trigger-system
 * と同等に評価することを検証する。
 *
 * - card_event: 既存仕様（relatedInstanceId === grantee 必須）。
 * - game_event: 通常 trigger-system §1290-1510 と同じスコープ判定を適用する。
 *   count_increase 等 player 値イベント (model.ts L1990-1991) は relatedInstanceId を
 *   持たないので、card_event と同じ self 一致要求はかけられない。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type { Effect } from "../src/dsl-types";
import type { CardDefinition, GameState } from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

function spiritDef(
  cardNo: string,
  name: string,
  tribe: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name,
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 4,
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    textLines: [],
    images: {},
    tribe,
    colors: ["red"],
    ...overrides,
  } as CardDefinition;
}

const SOURCE_DEF = spiritDef("GRANT-SOURCE", "グラント源", "魔人");
const GRANTEE_DEF = spiritDef("GRANT-TARGET", "ベジータ", "サイヤ人");
const ALLY_SAIYAN_DEF = spiritDef("ALLY-SAIYAN", "孫悟空", "サイヤ人");
const ALLY_SAIYAN_BRAVE_DEF = spiritDef(
  "ALLY-SAIYAN-BRAVE",
  "界王拳",
  "サイヤ人",
  {
    printedCategory: "brave",
  }
);
const FOE_OTHER_DEF = spiritDef("FOE-OTHER", "敵兵", "魔人");

const DEFS: Record<string, CardDefinition> = {
  "GRANT-SOURCE": SOURCE_DEF,
  "GRANT-TARGET": GRANTEE_DEF,
  "ALLY-SAIYAN": ALLY_SAIYAN_DEF,
  "ALLY-SAIYAN-BRAVE": ALLY_SAIYAN_BRAVE_DEF,
  "FOE-OTHER": FOE_OTHER_DEF,
};
const getDef = (id: string): CardDefinition | undefined => DEFS[id];

/** 自分のカウントが増えたときに相手のライフコア1個を相手ボイドへ送る game_event 付与効果。 */
function makeCountIncreaseEffect(
  player: "self" | "opponent" | "either"
): Effect {
  return {
    timing: { kind: "game_event", event: "count_increase", player },
    steps: [
      {
        action: {
          kind: "core_move",
          from: { kind: "life", player: "opponent" },
          to: { kind: "void", player: "opponent" },
          amount: 1,
        },
      },
    ],
  } as unknown as Effect;
}

/** 自分のサイヤ人スピリットが召喚されたとき発火する game_event:summon + triggerFilter 付与効果。 */
const SUMMON_SAIYAN_GRANT: Effect = {
  timing: {
    kind: "game_event",
    event: "summon",
    player: "self",
    triggerFilter: { category: ["spirit"], tribes: ["サイヤ人"] },
  },
  steps: [{ action: { kind: "noop" } }],
} as unknown as Effect;

function grantEffectWith(granted: Effect): Effect {
  return {
    timing: { kind: "activated", mode: "flash" },
    steps: [
      {
        action: {
          kind: "grant_effect",
          target: {
            kind: "filter",
            player: "self",
            count: "all",
            filter: { category: ["spirit"], tribes: ["サイヤ人"] },
          },
          grantedEffect: granted,
        },
      },
    ],
  } as unknown as Effect;
}

function registerGrantOnGrantee(
  granted: Effect,
  extraCards: Parameters<typeof createCardInstance>[1][] = []
): GameState {
  const source = createCardInstance(SOURCE_DEF, {
    instanceId: "source-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const grantee = createCardInstance(GRANTEE_DEF, {
    instanceId: "grantee-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const extras = extraCards.map((opts) =>
    createCardInstance(DEFS[opts.definitionId!] ?? GRANTEE_DEF, opts)
  );
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const state: GameState = {
    ...base,
    activePlayerId: ALICE,
    cardInstances: [source, grantee, ...extras],
    activeContinuousEffects: [],
  };
  return executeEffect({
    chainId: "test:grant-effect-game-event-player-scope:145",
    state,
    effect: grantEffectWith(granted),
    sourceInstanceId: "source-1",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  });
}

function grantedPendings(state: GameState) {
  return state.pendingTriggeredEffects.filter(
    (p) => p.mechanic?.kind === "granted_effect"
  );
}

describe("ENGINE-grant-effect-game-event-player-scope", () => {
  it("game_event:count_increase + player:self は自分起因イベントで発火する (relatedInstanceId 無しでも player でゲート)", () => {
    const state = registerGrantOnGrantee(makeCountIncreaseEffect("self"));
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-game-event-player-scope:166",
          eventKind: "count_increase",
          relatedInstanceId: null,
          relatedPlayerId: ALICE,
        },
      ],
      getDef
    );
    expect(grantedPendings(next)).toHaveLength(1);
  });

  it("game_event:count_increase + player:self は相手起因イベントで不発", () => {
    const state = registerGrantOnGrantee(makeCountIncreaseEffect("self"));
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-game-event-player-scope:182",
          eventKind: "count_increase",
          relatedInstanceId: null,
          relatedPlayerId: BOB,
        },
      ],
      getDef
    );
    expect(grantedPendings(next)).toHaveLength(0);
  });

  it("game_event:count_increase + player:opponent は相手起因イベントで発火", () => {
    const state = registerGrantOnGrantee(makeCountIncreaseEffect("opponent"));
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-game-event-player-scope:198",
          eventKind: "count_increase",
          relatedInstanceId: null,
          relatedPlayerId: BOB,
        },
      ],
      getDef
    );
    expect(grantedPendings(next)).toHaveLength(1);
  });

  it("game_event:count_increase + player:either は両側で発火", () => {
    const state = registerGrantOnGrantee(makeCountIncreaseEffect("either"));
    const aliceNext = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-game-event-player-scope:214",
          eventKind: "count_increase",
          relatedInstanceId: null,
          relatedPlayerId: ALICE,
        },
      ],
      getDef
    );
    expect(grantedPendings(aliceNext)).toHaveLength(1);
    const bobNext = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-game-event-player-scope:226",
          eventKind: "count_increase",
          relatedInstanceId: null,
          relatedPlayerId: BOB,
        },
      ],
      getDef
    );
    expect(grantedPendings(bobNext)).toHaveLength(1);
  });

  it("game_event:count_increase + player:self は relatedPlayerId 無しで fail-closed", () => {
    const state = registerGrantOnGrantee(makeCountIncreaseEffect("self"));
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-game-event-player-scope:242",
          eventKind: "count_increase",
          relatedInstanceId: null,
          relatedPlayerId: null,
        },
      ],
      getDef
    );
    expect(grantedPendings(next)).toHaveLength(0);
  });

  it("game_event:summon + triggerFilter:サイヤ人 は他系統 spirit 召喚で不発", () => {
    const state = registerGrantOnGrantee(SUMMON_SAIYAN_GRANT, [
      {
        instanceId: "foe-summoned",
        definitionId: "FOE-OTHER",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      },
    ]);
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-game-event-player-scope:266",
          eventKind: "summon",
          relatedInstanceId: "foe-summoned",
          relatedPlayerId: ALICE,
        },
      ],
      getDef
    );
    expect(grantedPendings(next)).toHaveLength(0);
  });

  it("game_event:summon + triggerFilter:サイヤ人 は同系統 spirit 召喚で発火", () => {
    const state = registerGrantOnGrantee(SUMMON_SAIYAN_GRANT, [
      {
        instanceId: "ally-summoned",
        definitionId: "ALLY-SAIYAN",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      },
    ]);
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-game-event-player-scope:290",
          eventKind: "summon",
          relatedInstanceId: "ally-summoned",
          relatedPlayerId: ALICE,
        },
      ],
      getDef
    );
    // grant CE は filter:tribes=サイヤ人 で grantee-1 / ally-summoned 両方に紐付き、
    // それぞれが ally-summoned の召喚に反応する。triggerFilter が pass する。
    const pendings = grantedPendings(next);
    expect(pendings.length).toBeGreaterThanOrEqual(1);
    expect(
      pendings.every(
        (p) =>
          p.relatedInstanceId === "grantee-1" ||
          p.relatedInstanceId === "ally-summoned"
      )
    ).toBe(true);
  });

  it("game_event:summon (triggerFilter.category 未明示) はブレイヴ被召喚で不発 (汎用「召喚されたとき」はスピリット限定)", () => {
    // verifier round 1 lens 3 補正: 通常 trigger-system の summonResponderMatchesCategoryScope と SSOT。
    const genericSummonGrant: Effect = {
      timing: { kind: "game_event", event: "summon", player: "self" },
      steps: [{ action: { kind: "noop" } }],
    } as unknown as Effect;
    const state = registerGrantOnGrantee(genericSummonGrant, [
      {
        instanceId: "brave-summoned",
        definitionId: "ALLY-SAIYAN-BRAVE",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
        zoneRoleName: "brave",
      },
    ]);
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-game-event-player-scope:330",
          eventKind: "summon",
          relatedInstanceId: "brave-summoned",
          relatedPlayerId: ALICE,
        },
      ],
      getDef
    );
    expect(grantedPendings(next)).toHaveLength(0);
  });

  it("game_event:summon + triggerFilter:category=brave 明示はブレイヴ被召喚で発火", () => {
    const braveSummonGrant: Effect = {
      timing: {
        kind: "game_event",
        event: "summon",
        player: "self",
        triggerFilter: { category: ["brave"] },
      },
      steps: [{ action: { kind: "noop" } }],
    } as unknown as Effect;
    const state = registerGrantOnGrantee(braveSummonGrant, [
      {
        instanceId: "brave-summoned",
        definitionId: "ALLY-SAIYAN-BRAVE",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
        zoneRoleName: "brave",
      },
    ]);
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-game-event-player-scope:364",
          eventKind: "summon",
          relatedInstanceId: "brave-summoned",
          relatedPlayerId: ALICE,
        },
      ],
      getDef
    );
    expect(grantedPendings(next).length).toBeGreaterThanOrEqual(1);
  });

  it("card_event 付与は player フィルタを評価せず relatedInstanceId === grantee のみで判定する (既存挙動を維持)", () => {
    const cardEventGranted: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [{ action: { kind: "noop" } }],
    } as unknown as Effect;
    const state = registerGrantOnGrantee(cardEventGranted);
    // grantee 自身の attack → 発火
    const ownNext = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-game-event-player-scope:385",
          eventKind: "attack",
          relatedInstanceId: "grantee-1",
          relatedPlayerId: ALICE,
        },
      ],
      getDef
    );
    expect(grantedPendings(ownNext)).toHaveLength(1);
    // 別カードの attack → 不発（card_event は self 必須）
    const otherNext = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-game-event-player-scope:398",
          eventKind: "attack",
          relatedInstanceId: "source-1",
          relatedPlayerId: ALICE,
        },
      ],
      getDef
    );
    expect(grantedPendings(otherNext)).toHaveLength(0);
  });
});
