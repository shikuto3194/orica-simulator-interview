/**
 * デッキ破棄耐性 — prevent_deck_discard CE の検証。
 *
 * プリミティブ:
 *  - prevent_deck_discard player:"either" → 両プレイヤーの真のデッキ破棄 (`deckDiscard: true`) から
 *    保護する player-scoped CE を 1 個ずつ登録。消費側は真の破棄だけで対象デッキ所有者の保護を
 *    照会し、保護されているカードを移動集合から除外する。
 *    手札破棄耐性 (prevent_hand_discard) と異なり「相手によって」限定ではなく原因不問。
 *
 * ルール正源: カード本文「お互いのデッキは破棄されない」(BSTH08.5-C21[1])。
 * 「破棄」は単なるデッキ→トラッシュ移動ではなく、文言どおりの破棄を表す。
 *
 * 解禁カード:
 *  - BSTH08.5-C21 [1] 手元常駐: お互いのデッキは破棄されない。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";

function runEffect(
  state: GameState,
  effect: NonNullable<CardDefinition["effects"]>[number],
  sourceInstanceId: string,
  actingPlayerId = ALICE
): GameState {
  return executeEffect({
    chainId: "test:prevent-deck-discard:43",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

/** 指定プレイヤーのデッキ枚数。 */
function deckCount(state: GameState, ownerPlayerId: string): number {
  return state.cardInstances.filter(
    (c) => c.ownerPlayerId === ownerPlayerId && c.zone === "deck"
  ).length;
}
/** 指定プレイヤーのトラッシュ枚数。 */
function trashCount(state: GameState, ownerPlayerId: string): number {
  return state.cardInstances.filter(
    (c) => c.ownerPlayerId === ownerPlayerId && c.zone === "trash"
  ).length;
}

/** デッキ→トラッシュ移動 (= 破棄) を実行する move_card 効果。 */
const deckDiscardEffect = (
  player: "self" | "opponent",
  count: number
): NonNullable<CardDefinition["effects"]>[number] => ({
  timing: { kind: "activated", mode: "flash" },
  steps: [
    {
      action: {
        kind: "move_card",
        from: { zone: "deck", player, position: "top" },
        to: { zone: "trash" },
        count,
        deckDiscard: true,
      },
    },
  ],
});

/** Q3900 の「デッキの上からN枚をトラッシュに置く」— 破棄ではない直接移動。 */
const deckToTrashPlacementEffect = (
  player: "self" | "opponent",
  count: number
): NonNullable<CardDefinition["effects"]>[number] => ({
  timing: { kind: "activated", mode: "flash" },
  steps: [
    {
      action: {
        kind: "move_card",
        from: { zone: "deck", player, position: "top" },
        to: { zone: "trash" },
        count,
      },
    },
  ],
});

function zoneEffectImmunity(
  zone: "deck" | "trash"
): NonNullable<GameState["activeContinuousEffects"]>[number] {
  return {
    effectId: `test-${zone}-effect-immunity`,
    sourceInstanceId: "c21-source",
    sourceDefinitionId: "BSTH08.5-C21",
    actingPlayerId: BOB,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetFilter: { player: "self", zone: [zone] },
    immunityPlayerScope: "any",
  };
}

/** 特定のカードだけを保護する耐性。位置付きデッキ移動の取得窓回帰に使う。 */
function cardEffectImmunity(
  targetInstanceId: string
): NonNullable<GameState["activeContinuousEffects"]>[number] {
  return {
    effectId: `test-card-effect-immunity-${targetInstanceId}`,
    sourceInstanceId: "test-immunity-source",
    sourceDefinitionId: "TEST-IMMUNITY",
    actingPlayerId: BOB,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetInstanceId,
    immunityPlayerScope: "any",
  };
}

/** 指定ゾーンにある間だけ対象カードを守る耐性。 */
function destinationCardEffectImmunity(
  zone: "trash" | "removed_from_game",
  cardName: string
): NonNullable<GameState["activeContinuousEffects"]>[number] {
  return {
    effectId: `test-${zone}-destination-card-effect-immunity`,
    sourceInstanceId: "test-immunity-source",
    sourceDefinitionId: "TEST-IMMUNITY",
    actingPlayerId: BOB,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetFilter: {
      player: "self",
      zone: [zone],
      cardName: { exact: cardName },
    },
    immunityPlayerScope: "any",
  };
}

/** デッキ N 枚 + 発揮元 1 枚を持つ初期盤面を作る。 */
function setupBoard(deckPerPlayer: number): {
  state: GameState;
  sourceId: string;
} {
  const dummy = card("BSTH08-C01");
  const cards = [];
  for (let i = 0; i < deckPerPlayer; i += 1) {
    cards.push(
      createCardInstance(dummy, {
        instanceId: `a-deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      }),
      createCardInstance(dummy, {
        instanceId: `b-deck-${i}`,
        ownerPlayerId: BOB,
        zone: "deck",
      })
    );
  }
  const source = createCardInstance(card("BSTH08.5-C21"), {
    instanceId: "c21-source",
    ownerPlayerId: ALICE,
    zone: "set_aside",
  });
  cards.push(source);
  const state = createEmptyGameState({ cardInstances: cards });
  return { state, sourceId: "c21-source" };
}

describe("prevent_deck_discard (BSTH08.5-C21 「お互いのデッキは破棄されない」)", () => {
  it("[card] BSTH08.5-C21 effect[0] は prevent_deck_discard(either) + BP閾値cap を持つ", () => {
    const def = card("BSTH08.5-C21");
    const eff = def.effects?.[0];
    expect(eff).toBeDefined();
    const kinds = eff!.steps.map((s) => s.action.kind);
    expect(kinds).toContain("prevent_deck_discard");
    expect(kinds).toContain("life_damage_interception");
    expect(eff!.steps[0]!.action).toMatchObject({
      kind: "prevent_deck_discard",
      duration: { scope: "while_in_set_aside" },
    });
    expect(eff!.steps[1]!.action).toMatchObject({
      kind: "life_damage_interception",
      duration: { scope: "while_in_set_aside" },
    });
    // stub 注記が除去されていること（忠実度違反でない）。
    expect(eff!.stub).toBeUndefined();
  });

  it("[regression] 手元常駐 CE は再計算で手元にいる間だけ同じ 3 件を保持する", () => {
    const board = setupBoard(0);
    const registered = runEffect(
      board.state,
      card("BSTH08.5-C21").effects![0]!,
      board.sourceId,
      ALICE
    );
    const before = registered.activeContinuousEffects.filter(
      (ce) => ce.sourceInstanceId === board.sourceId
    );
    expect(before).toHaveLength(3);

    const recomputed = recomputeContinuousEffects(registered);
    const after = recomputed.activeContinuousEffects.filter(
      (ce) => ce.sourceInstanceId === board.sourceId
    );
    expect(after.map((ce) => ce.effectId)).toEqual(
      before.map((ce) => ce.effectId)
    );
    expect(after.map((ce) => ce.duration)).toEqual([
      { scope: "while_in_set_aside" },
      { scope: "while_in_set_aside" },
      { scope: "while_in_set_aside" },
    ]);

    const afterSourceLeavesSetAside = recomputeContinuousEffects({
      ...registered,
      cardInstances: registered.cardInstances.map((cardInstance) =>
        cardInstance.instanceId === board.sourceId
          ? { ...cardInstance, zone: "hand" as const }
          : cardInstance
      ),
    });
    expect(
      afterSourceLeavesSetAside.activeContinuousEffects.filter(
        (ce) => ce.sourceInstanceId === board.sourceId
      )
    ).toEqual([]);
  });

  it("[board] 登録後は自分・相手どちらの真のデッキ破棄もされない", () => {
    const board = setupBoard(5);
    let state = board.state;
    const sourceId = board.sourceId;
    expect(deckCount(state, ALICE)).toBe(5);
    expect(deckCount(state, BOB)).toBe(5);

    // 手元常駐効果 (effect[0]) を登録（prevent_deck_discard either + BP cap）。
    state = runEffect(
      state,
      card("BSTH08.5-C21").effects![0]!,
      sourceId,
      ALICE
    );

    // 自分のデッキ 3 枚破棄しようとしても 0 枚（保護）。
    state = runEffect(state, deckDiscardEffect("self", 3), sourceId, ALICE);
    expect(deckCount(state, ALICE)).toBe(5);
    expect(trashCount(state, ALICE)).toBe(0);

    // 相手のデッキ 7 枚破棄しようとしても 0 枚（お互い保護）。
    state = runEffect(state, deckDiscardEffect("opponent", 7), sourceId, ALICE);
    expect(deckCount(state, BOB)).toBe(5);
    expect(trashCount(state, BOB)).toBe(0);
  });

  it("[board] 保護が無ければデッキ破棄は通常どおり成立する（リグレッション）", () => {
    const board = setupBoard(5);
    let state = board.state;
    const sourceId = board.sourceId;
    // CE を登録しない状態でデッキ→トラッシュ移動。
    state = runEffect(state, deckDiscardEffect("opponent", 3), sourceId, ALICE);
    expect(deckCount(state, BOB)).toBe(2);
    expect(trashCount(state, BOB)).toBe(3);
  });

  it("[board] true deckDiscard の『上から1枚』は先頭のカード耐性で不発になり、2枚目へ繰り上がらない", () => {
    const board = setupBoard(2);
    const after = runEffect(
      {
        ...board.state,
        players: board.state.players.map((player) =>
          player.id === BOB ? { ...player, deckCount: 2 } : player
        ),
        activeContinuousEffects: [cardEffectImmunity("b-deck-0")],
      },
      deckDiscardEffect("opponent", 1),
      board.sourceId,
      ALICE
    );

    expect(
      after.cardInstances.find((card) => card.instanceId === "b-deck-0")
    ).toMatchObject({ zone: "deck" });
    expect(
      after.cardInstances.find((card) => card.instanceId === "b-deck-1")
    ).toMatchObject({ zone: "deck" });
    expect(trashCount(after, BOB)).toBe(0);
    // 2枚とも盤面上の既知カードであり、耐性により1枚も動いていない。ここを
    // 隠れデッキ1枚と誤認して deckCount だけを減らしてはならない。
    expect(after.players.find((player) => player.id === BOB)?.deckCount).toBe(
      2
    );
  });

  it("[board] true deckDiscard は移動先トラッシュの耐性を先取りせず、デッキの2枚を動かす", () => {
    const source = createCardInstance(card("BSTH08.5-C21"), {
      instanceId: "partial-destination-source",
      ownerPlayerId: ALICE,
      zone: "set_aside",
    });
    const protectedTop = createCardInstance(card("BSTH08-C01"), {
      instanceId: "partial-destination-top",
      ownerPlayerId: BOB,
      zone: "deck",
    });
    const movableSecond = createCardInstance(card("BSKB01-C02"), {
      instanceId: "partial-destination-second",
      ownerPlayerId: BOB,
      zone: "deck",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, protectedTop, movableSecond],
      playerOverrides: [{ deckCount: 0 }, { deckCount: 2 }],
    });
    const after = runEffect(
      {
        ...base,
        activeContinuousEffects: [
          destinationCardEffectImmunity("trash", card("BSTH08-C01").name),
        ],
      },
      deckDiscardEffect("opponent", 2),
      source.instanceId,
      ALICE
    );

    expect(
      after.cardInstances.find(
        (card) => card.instanceId === protectedTop.instanceId
      )
    ).toMatchObject({ zone: "trash" });
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === movableSecond.instanceId
      )
    ).toMatchObject({ zone: "trash" });
    expect(after.players.find((player) => player.id === BOB)?.deckCount).toBe(
      0
    );
  });

  it("[board] prevent_deck_discard はデッキからトラッシュへの単なる配置を止めない (Q3900)", () => {
    const board = setupBoard(5);
    let state = runEffect(
      board.state,
      card("BSTH08.5-C21").effects![0]!,
      board.sourceId,
      ALICE
    );

    state = runEffect(
      state,
      deckToTrashPlacementEffect("self", 3),
      board.sourceId,
      ALICE
    );
    expect(deckCount(state, ALICE)).toBe(2);
    expect(trashCount(state, ALICE)).toBe(3);
  });

  it.each(["deck", "trash"] as const)(
    "[board] %s 効果耐性は移動前のデッキに適用されるときだけ配置と破棄を止める",
    (protectedZone) => {
      const board = setupBoard(3);
      const state: GameState = {
        ...board.state,
        activeContinuousEffects: [zoneEffectImmunity(protectedZone)],
      };

      const afterPlacement = runEffect(
        state,
        deckToTrashPlacementEffect("opponent", 1),
        board.sourceId,
        ALICE
      );
      expect(deckCount(afterPlacement, BOB)).toBe(
        protectedZone === "deck" ? 3 : 2
      );
      expect(trashCount(afterPlacement, BOB)).toBe(
        protectedZone === "deck" ? 0 : 1
      );

      const afterDiscard = runEffect(
        state,
        deckDiscardEffect("opponent", 1),
        board.sourceId,
        ALICE
      );
      expect(deckCount(afterDiscard, BOB)).toBe(
        protectedZone === "deck" ? 3 : 2
      );
      expect(trashCount(afterDiscard, BOB)).toBe(
        protectedZone === "deck" ? 0 : 1
      );
    }
  );

  it("[board] デッキ以外 (手札) からトラッシュへの移動は止めない", () => {
    const board = setupBoard(2);
    let state = board.state;
    const sourceId = board.sourceId;
    // 相手の手札 1 枚を追加。
    const handCard = createCardInstance(card("BSTH08-C01"), {
      instanceId: "b-hand-0",
      ownerPlayerId: BOB,
      zone: "hand",
    });
    state = {
      ...state,
      cardInstances: [...state.cardInstances, handCard],
    };
    state = runEffect(
      state,
      card("BSTH08.5-C21").effects![0]!,
      sourceId,
      ALICE
    );

    // 手札→トラッシュは prevent_deck_discard の対象外。
    const handToTrash: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "move_card",
            from: { zone: "hand", player: "opponent" },
            to: { zone: "trash" },
            count: 1,
          },
        },
      ],
    };
    state = runEffect(state, handToTrash, sourceId, ALICE);
    expect(
      state.cardInstances.filter(
        (c) => c.ownerPlayerId === BOB && c.zone === "hand"
      ).length
    ).toBe(0);
    expect(trashCount(state, BOB)).toBe(1);
    // デッキは依然保護。
    expect(deckCount(state, BOB)).toBe(2);
  });
});
