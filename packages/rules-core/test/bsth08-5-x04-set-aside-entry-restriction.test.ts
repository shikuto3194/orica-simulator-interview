/**
 * BSTH08.5-X04「希望の面」effects[1]:
 * 「このカードの効果以外で手元に置けない。」
 *
 * ENGINE-set-aside-entry-restriction: destination-zone-scoped resistance
 * (effect_resistance resistsOutcome:"enter_zone" + entryZone:"set_aside")。
 * 既存の ResistableOutcome (leave_field/bounce/send_to_deck 等) は「離脱」軸のみを
 * 区別し、移動先ゾーンを区別できないため新設した primitive。第三者ゾーン移動効果
 * (bounce/return_from_trash 等) がこのカードを手元 (set_aside) へ移動させることを
 * 阻止する一方、手札等それ以外のゾーンへの移動 (通常の bounce/return_from_trash) は
 * 妨げないことを検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  getLegalActions,
  rebuildContinuousEffectsFromField,
} from "../src/index";
import type { CardDefinition, GameState } from "../src/index";

const ALL_CARDS_MAP = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const card = (cardNo: string): CardDefinition => {
  const def = ALL_CARDS_MAP.get(cardNo);
  if (!def) throw new Error(`card not found: ${cardNo}`);
  return def;
};
const getCardDefinitionById = (id: string) => ALL_CARDS_MAP.get(id);
const emptyLookup = () => undefined;

function makeReturnFromTrashSource(
  destination: "hand" | "set_aside"
): CardDefinition {
  return {
    cardNo: `SRC-RETURN-${destination}`,
    name: "トラッシュ回収源",
    printedCategory: "magic",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              player: "opponent",
              count: 5,
              destination,
            },
          },
        ],
      },
    ],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function makeBounceSource(destination: "hand" | "set_aside"): CardDefinition {
  return {
    cardNo: `SRC-BOUNCE-X04-${destination}`,
    name: "バウンス源",
    printedCategory: "magic",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["brave"] },
                count: -1,
              },
              destination,
            },
          },
        ],
      },
    ],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function makeBaseState(
  cardInstances: GameState["cardInstances"],
  activePlayerId: string
): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const seeded = { ...base, activePlayerId, cardInstances };
  return rebuildContinuousEffectsFromField(seeded, getCardDefinitionById);
}

describe("BSTH08.5-X04 effects[1]: 手元への移動を阻止する destination-zone-scoped resistance", () => {
  const x04 = card("BSTH08.5-X04");
  const entryRestriction = x04.effects![1]!;

  it("DSL 構造: effect_resistance(resistsOutcome:enter_zone, entryZone:set_aside, source:all)", () => {
    expect(entryRestriction.stub).toBeUndefined();
    expect(entryRestriction.steps[0]!.action).toMatchObject({
      kind: "effect_resistance",
      resistsOutcome: "enter_zone",
      entryZone: "set_aside",
      source: "all",
      duration: { scope: "permanent" },
    });
  });

  it("[board] トラッシュから手元への return_from_trash は阻止され、トラッシュに留まる", () => {
    const src = makeReturnFromTrashSource("set_aside");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [x04.cardNo, x04],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(x04, {
          instanceId: "alice-x04",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
      "bob"
    );

    const result = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsth08-5-x04-set-aside-entry-restriction:155",
        state,
        effect: src.effects![0]!,
        sourceInstanceId: "src-bob",
        actingPlayerId: "bob",
        getCardDefinitionById: (id) => defs.get(id),
        getRegisteredTriggeredEffectActions: emptyLookup,
      }),
      (id) => defs.get(id)
    );

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-x04"
    )!;
    expect(after.zone).toBe("trash");
  });

  it("[board] トラッシュから手札への return_from_trash は阻止されず手札へ戻る (set_aside 限定)", () => {
    const src = makeReturnFromTrashSource("hand");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [x04.cardNo, x04],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(x04, {
          instanceId: "alice-x04",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
      "bob"
    );

    const result = executeEffect({
      chainId: "test:bsth08-5-x04-set-aside-entry-restriction:194",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-bob",
      actingPlayerId: "bob",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-x04"
    )!;
    expect(after.zone).toBe("hand");
  });

  it("[board] フィールドから手元への bounce(destination:set_aside) は阻止され場に留まる", () => {
    const src = makeBounceSource("set_aside");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [x04.cardNo, x04],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(x04, {
          instanceId: "alice-x04",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      "bob"
    );

    const result = executeEffect({
      chainId: "test:bsth08-5-x04-set-aside-entry-restriction:233",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-bob",
      actingPlayerId: "bob",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-x04"
    )!;
    expect(after.zone).toBe("field");
    expect(
      result.log.some((entry) =>
        entry.includes("blocked-by-zone-entry-resistance:bob:alice-x04")
      )
    ).toBe(true);
  });

  it("[board] フィールドから手札への bounce(destination:hand) は阻止されず手札へ戻る (set_aside 限定)", () => {
    const src = makeBounceSource("hand");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [x04.cardNo, x04],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(x04, {
          instanceId: "alice-x04",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      "bob"
    );

    const result = flushPendingLeaves(
      executeEffect({
        chainId: "test:bsth08-5-x04-set-aside-entry-restriction:278",
        state,
        effect: src.effects![0]!,
        sourceInstanceId: "src-bob",
        actingPlayerId: "bob",
        getCardDefinitionById: (id) => defs.get(id),
        getRegisteredTriggeredEffectActions: emptyLookup,
      }),
      (id) => defs.get(id)
    );

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-x04"
    )!;
    expect(after.zone).toBe("hand");
  });

  it("[board] source:all は自分 (X04 のコントローラー自身) が使う第三者効果でも阻止する", () => {
    // alice 自身が所有する別カードの bounce(destination:set_aside) で alice 自身の
    // X04 を対象にしても、source:"all" のため阻止される (opponent_effect との違いを検証)。
    const selfTargetingSrc: CardDefinition = {
      cardNo: "SRC-BOUNCE-X04-SELF",
      name: "自己バウンス源",
      printedCategory: "magic",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "bounce",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: { category: ["brave"] },
                  count: -1,
                },
                destination: "set_aside",
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defs = new Map<string, CardDefinition>([
      [selfTargetingSrc.cardNo, selfTargetingSrc],
      [x04.cardNo, x04],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(selfTargetingSrc, {
          instanceId: "src-alice-self",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(x04, {
          instanceId: "alice-x04",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      "alice"
    );

    const result = executeEffect({
      chainId: "test:bsth08-5-x04-set-aside-entry-restriction:353",
      state,
      effect: selfTargetingSrc.effects![0]!,
      sourceInstanceId: "src-alice-self",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-x04"
    )!;
    expect(after.zone).toBe("field");
  });
});

describe("BSTH08.5-X04 が deck_reveal hand_or_set_aside_choice 経路で手元へ迂回できないこと", () => {
  const C23 = ALL_CARDS_MAP.get("BSTH08.5-C23")!;
  const X04 = ALL_CARDS_MAP.get("BSTH08.5-X04")!;
  const C20 = ALL_CARDS_MAP.get("BSTH08.5-C20")!; // 面霊 ブレイヴ (spiritBravePick 候補埋め)
  const C21 = ALL_CARDS_MAP.get("BSTH08.5-C21")!; // 面霊 ブレイヴ (spiritBravePick 候補埋め)
  const ALICE = "alice";

  // 盤面に既に希望の面 (X04) が1枚 (手札) あり、cannot_enter_zone CE が事前登録済みの
  // 状態を作る。`hasBlockingPendingSelection` (effect-interpreter.ts) により
  // pendingDeckReveal が立っている間は continuous 効果の新規登録が止まるため、
  // デッキ内の唯一の X04 自身がオープンされ同一解決チェーン内で選ばれるケースは
  // 対象外 (card-data 側コメント参照)。ここでは既存の別の X04 が CE を維持している、
  // より現実的なケース (同名カードは class-wide filter で全個体に適用される) を検証する。
  function baseState(deckCards: CardDefinition[]): GameState {
    const base = createEmptyGameState({
      playerIds: [ALICE, "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 4 }],
    });
    const c23Instance = createCardInstance(C23, {
      instanceId: "c23",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "set_aside",
    });
    const existingX04 = createCardInstance(X04, {
      instanceId: "alice-x04-existing",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const deckInstances = deckCards.map((def, i) =>
      createCardInstance(def, {
        instanceId: `deck-${i + 1}`,
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const seeded: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [c23Instance, existingX04, ...deckInstances],
    };
    // pendingDeckReveal が立つ前に CE を登録しておく (実ゲームでは召喚/ドロー等で
    // 手札に X04 が入った時点で既に登録済みの状態)。
    return rebuildContinuousEffectsFromField(seeded, getCardDefinitionById);
  }

  function accelEffect() {
    return C23.accelData!.effects![0]!;
  }

  it("BSTH08.5-C23 の hand_or_set_aside_choice で別の X04 個体を set_aside 側に選ぶと拒否される", () => {
    // 無償ブランチ (面霊創界神ネクサス) を候補0枚にしつつ、有償ブランチ
    // (面霊スピリット/ブレイヴ合計3枚) に X04 を含む3枚ちょうどを揃える
    // (getDeckRevealExclusiveGroupBranches の requiredCount は候補数に関わらず
    // pick.count 固定のため、3枚選択が必須)。
    const afterReveal = executeEffect({
      chainId: "test:bsth08-5-x04-set-aside-entry-restriction:427",
      state: baseState([X04, C20, C21]),
      effect: accelEffect(),
      sourceInstanceId: "c23",
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(afterReveal.pendingDeckReveal).not.toBeNull();
    expect(
      afterReveal.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "cannot_enter_zone"
      )
    ).toBe(true);

    const actions = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const pick = actions.find(
      (a) => a.kind === "resolve_pending_deck_reveal_pick"
    );
    if (!pick || pick.kind !== "resolve_pending_deck_reveal_pick") {
      throw new Error("resolve_pending_deck_reveal_pick action not found");
    }

    // デッキ内の X04 (brave, tribe 面霊) は spiritBravePick (有償3枚) 側の候補に入る。
    expect(pick.exclusiveGroupBranches?.[1]?.candidateCardInstanceIds).toEqual([
      "deck-1",
      "deck-2",
      "deck-3",
    ]);

    expect(() =>
      applyLegalAction({
        state: afterReveal,
        action: pick,
        selectedDeckRevealCardIds: ["deck-1", "deck-2", "deck-3"],
        deckRevealPickFreeDestination: "set_aside",
        getCardDefinitionById,
      } as unknown as Parameters<typeof applyLegalAction>[0])
    ).toThrow(/blocked by resistance/);

    // hand 側の選択は阻止されない (set_aside 限定であることの確認)。
    const resolvedHand = applyLegalAction({
      state: afterReveal,
      action: pick,
      selectedDeckRevealCardIds: ["deck-1", "deck-2", "deck-3"],
      deckRevealPickFreeDestination: "hand",
      getCardDefinitionById,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    };
    const x04After = resolvedHand.state.cardInstances.find(
      (c) => c.instanceId === "deck-1"
    )!;
    expect(x04After.zone).toBe("hand");
  });
});
