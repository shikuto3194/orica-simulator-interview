/**
 * デッキ破棄→デッキ除外書き換え — redirect_deck_discard_to_exclude CE の検証。
 *
 * プリミティブ (ENGINE-deck-discard-to-exclude-redirect):
 *  - redirect_deck_discard_to_exclude player:"opponent" → 対象プレイヤーへのデッキ破棄
 *    (`deckDiscard: true` の deck→trash) を止める代わりに、移動先を trash から removed_from_game へ
 *    差し替える player-scoped CE。prevent_deck_discard (block) の redirect 版。
 *  - 「自分のアタックステップ」限定は effect.timingScope ({player:"self",period:"attack"})
 *    に委譲し、getCEsForTarget の timingScope フィルタが現在ステップ/actingPlayer で
 *    自動判定する。
 *
 * ルール正源: カード本文「Lv2【導域】『自分のアタックステップ』相手への「デッキ破棄効果」
 * すべてを「デッキ除外効果」にする」(BSTH05.5-X02 textLines[11-12])。
 *
 * 解禁カード:
 *  - BSTH05.5-X02 [4] Lv2 常時: 相手へのデッキ破棄を自分のアタックステップ中デッキ除外にする。
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
    chainId: "test:redirect-deck-discard-to-exclude:45",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

const deckCount = (state: GameState, ownerPlayerId: string): number =>
  state.cardInstances.filter(
    (c) => c.ownerPlayerId === ownerPlayerId && c.zone === "deck"
  ).length;
const trashCount = (state: GameState, ownerPlayerId: string): number =>
  state.cardInstances.filter(
    (c) => c.ownerPlayerId === ownerPlayerId && c.zone === "trash"
  ).length;
const removedCount = (state: GameState, ownerPlayerId: string): number =>
  state.cardInstances.filter(
    (c) => c.ownerPlayerId === ownerPlayerId && c.zone === "removed_from_game"
  ).length;

function zoneEffectImmunity(
  zone: "deck" | "trash" | "removed_from_game"
): NonNullable<GameState["activeContinuousEffects"]>[number] {
  return {
    effectId: `test-${zone}-effect-immunity`,
    sourceInstanceId: "x02-source",
    sourceDefinitionId: "BSTH05.5-X02",
    actingPlayerId: BOB,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetFilter: { player: "self", zone: [zone] },
    immunityPlayerScope: "any",
  };
}

/** 除外ゾーンにあるカードだけを守る耐性。デッキには適用しない。 */
function destinationCardEffectImmunity(
  cardName: string
): NonNullable<GameState["activeContinuousEffects"]>[number] {
  return {
    effectId: "test-removed-destination-card-effect-immunity",
    sourceInstanceId: "test-immunity-source",
    sourceDefinitionId: "TEST-IMMUNITY",
    actingPlayerId: BOB,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetFilter: {
      player: "self",
      zone: ["removed_from_game"],
      cardName: { exact: cardName },
    },
    immunityPlayerScope: "any",
  };
}

/** デッキ→トラッシュ移動 (= 破棄) を実行する move_card 効果。 */
const deckDiscardEffect = (
  count: number
): NonNullable<CardDefinition["effects"]>[number] => ({
  timing: { kind: "activated", mode: "flash" },
  steps: [
    {
      action: {
        kind: "move_card",
        from: { zone: "deck", player: "opponent", position: "top" },
        to: { zone: "trash" },
        count,
        deckDiscard: true,
      },
    },
  ],
});

/** デッキ N 枚 + 発揮元 (BSTH05.5-X02) 1 枚を持つ初期盤面を作る。ALICE がこのカードの所有者。 */
function setupBoard(deckPerPlayer: number): {
  state: GameState;
  sourceId: string;
} {
  const dummy = card("BSTH08-C01");
  const cards = [];
  for (let i = 0; i < deckPerPlayer; i += 1) {
    cards.push(
      createCardInstance(dummy, {
        instanceId: `b-deck-${i}`,
        ownerPlayerId: BOB,
        zone: "deck",
      })
    );
  }
  const source = createCardInstance(card("BSTH05.5-X02"), {
    instanceId: "x02-source",
    ownerPlayerId: ALICE,
    zone: "field",
    // levelDefs: Lv1 requiredCores=0 / Lv2 requiredCores=5。Lv2 到達に必要な通常コア数。
    normalCoreCount: 5,
  });
  cards.push(source);
  const state = createEmptyGameState({ cardInstances: cards });
  return { state, sourceId: "x02-source" };
}

describe("redirect_deck_discard_to_exclude (BSTH05.5-X02 Lv2「デッキ破棄→デッキ除外」)", () => {
  it("[card] BSTH05.5-X02 effects[1] は redirect_deck_discard_to_exclude(opponent) を持ち stub 注記が無い", () => {
    const def = card("BSTH05.5-X02");
    const eff = def.effects?.[1];
    expect(eff).toBeDefined();
    const kinds = eff!.steps.map((s) => s.action.kind);
    expect(kinds).toContain("redirect_deck_discard_to_exclude");
    expect(eff!.stub).toBeUndefined();
    expect(eff!.timingScope).toEqual({ player: "self", period: "attack" });
  });

  it("[board] 自分のアタックステップ中は相手のデッキ破棄がデッキ除外 (removed_from_game) に書き換わる", () => {
    const board = setupBoard(5);
    let state = board.state;
    const sourceId = board.sourceId;
    // Lv2 常時効果 (effects[0]) を登録。
    state = runEffect(
      state,
      card("BSTH05.5-X02").effects![1]!,
      sourceId,
      ALICE
    );
    // 自分 (ALICE) のアタックステップ中にする。
    state = { ...state, step: "attack", activePlayerId: ALICE };

    state = runEffect(state, deckDiscardEffect(3), sourceId, ALICE);

    expect(deckCount(state, BOB)).toBe(2);
    expect(trashCount(state, BOB)).toBe(0);
    expect(removedCount(state, BOB)).toBe(3);
    const moves = state.publicDisclosures
      ?.flatMap((entry) => entry.results)
      .filter((result) => result.kind === "card_move");
    expect(moves).toHaveLength(3);
    expect(moves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: "removed_from_game",
          actionLabel: "move_to_removed",
        }),
      ])
    );
    expect(
      moves?.every((result) => result.actionLabel === "move_to_removed")
    ).toBe(true);
  });

  it("[board] BSLH01-T06 の discard primitive による実際のデッキ破棄も除外へ書き換わる", () => {
    const board = setupBoard(5);
    const grandMill = createCardInstance(card("BSLH01-T06"), {
      instanceId: "t06-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    let state: GameState = {
      ...board.state,
      cardInstances: [...board.state.cardInstances, grandMill],
    };
    state = runEffect(
      state,
      card("BSTH05.5-X02").effects![1]!,
      board.sourceId,
      ALICE
    );
    state = { ...state, step: "attack", activePlayerId: ALICE };

    state = runEffect(
      state,
      card("BSLH01-T06").effects![0]!,
      grandMill.instanceId,
      ALICE
    );

    expect(deckCount(state, BOB)).toBe(0);
    expect(trashCount(state, BOB)).toBe(0);
    expect(removedCount(state, BOB)).toBe(5);
  });

  it("[board] redirect 後は元の trash 効果耐性で止まらず、除外へ移動する", () => {
    const board = setupBoard(3);
    let state: GameState = {
      ...board.state,
      activeContinuousEffects: [zoneEffectImmunity("trash")],
    };
    state = runEffect(
      state,
      card("BSTH05.5-X02").effects![1]!,
      board.sourceId,
      ALICE
    );
    state = { ...state, step: "attack", activePlayerId: ALICE };

    state = runEffect(state, deckDiscardEffect(2), board.sourceId, ALICE);

    expect(deckCount(state, BOB)).toBe(1);
    expect(trashCount(state, BOB)).toBe(0);
    expect(removedCount(state, BOB)).toBe(2);
  });

  it("[board] redirect 後の除外ゾーン耐性は移動前のデッキカードを守らない", () => {
    const source = createCardInstance(card("BSTH05.5-X02"), {
      instanceId: "partial-redirect-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 5,
    });
    const protectedTop = createCardInstance(card("BSTH08-C01"), {
      instanceId: "partial-redirect-top",
      ownerPlayerId: BOB,
      zone: "deck",
    });
    const movableSecond = createCardInstance(card("BSKB01-C02"), {
      instanceId: "partial-redirect-second",
      ownerPlayerId: BOB,
      zone: "deck",
    });
    let state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, protectedTop, movableSecond],
      playerOverrides: [{ deckCount: 0 }, { deckCount: 2 }],
    });
    state = {
      ...state,
      activeContinuousEffects: [
        destinationCardEffectImmunity(card("BSTH08-C01").name),
      ],
    };
    state = runEffect(
      state,
      card("BSTH05.5-X02").effects![1]!,
      source.instanceId,
      ALICE
    );
    state = { ...state, step: "attack", activePlayerId: ALICE };

    state = runEffect(state, deckDiscardEffect(2), source.instanceId, ALICE);

    expect(
      state.cardInstances.find(
        (card) => card.instanceId === protectedTop.instanceId
      )
    ).toMatchObject({ zone: "removed_from_game" });
    expect(
      state.cardInstances.find(
        (card) => card.instanceId === movableSecond.instanceId
      )
    ).toMatchObject({ zone: "removed_from_game" });
    expect(deckCount(state, BOB)).toBe(0);
    expect(removedCount(state, BOB)).toBe(2);
  });

  it("[board] targetInstanceId=playerId の player-scoped CE は recomputeContinuousEffects を経ても除去されない（isPlayerScopedCETag allowlist 回帰）", () => {
    const board = setupBoard(5);
    let state = board.state;
    const sourceId = board.sourceId;
    state = runEffect(
      state,
      card("BSTH05.5-X02").effects![1]!,
      sourceId,
      ALICE
    );
    expect(
      state.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "redirect_deck_discard_to_exclude"
      )
    ).toHaveLength(1);

    // isPlayerScopedCETag allowlist に無いと、targetInstanceId (=BOB の playerId) を
    // card instanceId として解決しようとして「対象カード無し」で即除去される
    // (allow_ignore_summon_condition 等と同型の silent bug、adversarial verifier 指摘)。
    const recomputed = recomputeContinuousEffects(state);
    expect(
      recomputed.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "redirect_deck_discard_to_exclude"
      )
    ).toHaveLength(1);

    // recompute を経た後も、実際に redirect が機能することを確認する。
    state = { ...recomputed, step: "attack", activePlayerId: ALICE };
    state = runEffect(state, deckDiscardEffect(2), sourceId, ALICE);
    expect(trashCount(state, BOB)).toBe(0);
    expect(removedCount(state, BOB)).toBe(2);
  });

  it("[board] 自分のアタックステップ以外では通常どおりトラッシュへ破棄される（リグレッション）", () => {
    const board = setupBoard(5);
    let state = board.state;
    const sourceId = board.sourceId;
    state = runEffect(
      state,
      card("BSTH05.5-X02").effects![1]!,
      sourceId,
      ALICE
    );
    // step は既定の "start"（アタックステップではない）。

    state = runEffect(state, deckDiscardEffect(3), sourceId, ALICE);

    expect(deckCount(state, BOB)).toBe(2);
    expect(trashCount(state, BOB)).toBe(3);
    expect(removedCount(state, BOB)).toBe(0);
  });

  it("[board] X02 Lv2の自分アタックステップでも単なるデッキ→トラッシュ配置は除外へ書き換えない", () => {
    const board = setupBoard(5);
    let state = runEffect(
      board.state,
      card("BSTH05.5-X02").effects![1]!,
      board.sourceId
    );
    state = { ...state, step: "attack", activePlayerId: ALICE };
    const placement = deckDiscardEffect(2);
    const action = placement.steps[0]!.action;
    if (action.kind !== "move_card") throw new Error("expected move_card");
    delete action.deckDiscard;
    state = runEffect(state, placement, board.sourceId);
    expect(deckCount(state, BOB)).toBe(3);
    expect(trashCount(state, BOB)).toBe(2);
    expect(removedCount(state, BOB)).toBe(0);
    expect(
      state.cardInstances.filter((entry) => entry.zone === "void")
    ).toEqual([]);
  });

  it("[board] player:opponent 固定のため、発揮元自身 (ALICE) のデッキ破棄は書き換えない", () => {
    const board = setupBoard(5);
    let state = board.state;
    const sourceId = board.sourceId;
    // ALICE 自身のデッキも用意する。
    const aliceDeck = Array.from({ length: 5 }, (_, i) =>
      createCardInstance(card("BSTH08-C01"), {
        instanceId: `a-deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    state = { ...state, cardInstances: [...state.cardInstances, ...aliceDeck] };
    state = runEffect(
      state,
      card("BSTH05.5-X02").effects![1]!,
      sourceId,
      ALICE
    );
    state = { ...state, step: "attack", activePlayerId: ALICE };

    // ALICE 自身のデッキを破棄する move_card (from.player: "self")。
    const selfDeckDiscard: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "move_card",
            from: { zone: "deck", player: "self", position: "top" },
            to: { zone: "trash" },
            count: 2,
            deckDiscard: true,
          },
        },
      ],
    };
    state = runEffect(state, selfDeckDiscard, sourceId, ALICE);

    expect(deckCount(state, ALICE)).toBe(3);
    expect(trashCount(state, ALICE)).toBe(2);
    expect(removedCount(state, ALICE)).toBe(0);
  });
});
