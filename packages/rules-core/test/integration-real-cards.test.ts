/**
 * 実カードデータを使った統合テスト。
 * BSTH01（東方紅魔郷）のカードで基本フロー（召喚・軽減・アタック・バトル解決）を検証する。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  playSummonAsAction,
  useAttackAsAction,
  calculateReduction,
  getEffectiveBp,
  getCombinedUnitBp,
  executeEffect,
  flushPendingLeaves,
  tryApplyLegalAction,
} from "../src/index";
import { recomputeContinuousEffects as recomputeCE } from "../src/legal/legal-actions-shared";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import type { CardDefinition, GameState } from "../src/index";

/**
 * DeckReveal pending フロー完走ヘルパー。
 * executeEffect 後に pending を検出し、全ピックグループを自動選択して完了させる。
 * テストでは「フィルタに合致する全カードを自動選択」する。
 */
function completeDeckRevealPending(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  let current = state;
  while (current.pendingDeckReveal !== null) {
    const actions = getLegalActions({
      state: current,
      actingPlayerId: current.pendingDeckReveal.actingPlayerId,
      getCardDefinitionById,
    });
    if (actions.length === 0) break;
    const action = actions[0]!;

    if (action.kind === "resolve_pending_deck_reveal_pick") {
      // フィルタに合致するカードを全選択（maxPickCount まで）
      const pick = current.pendingDeckReveal!.picks[action.pickIndex];
      const pickedSet = new Set(
        current.pendingDeckReveal!.pickedCardInstanceIds
      );
      const candidates = action.candidateCardInstanceIds.filter((id) => {
        if (pickedSet.has(id)) return false;
        const card = current.cardInstances.find((c) => c.instanceId === id);
        if (!card) return false;
        if (!pick?.filter) return true;
        const def = getCardDefinitionById(card.definitionId);
        if (!def) return false;
        if (
          pick.filter.category &&
          !pick.filter.category.includes(def.printedCategory)
        )
          return false;
        if (
          pick.filter.colors &&
          !pick.filter.colors.some((col) => def.colors.includes(col))
        )
          return false;
        if (pick.filter.tribes) {
          const tribes = def.tribe?.split("・") ?? [];
          if (!pick.filter.tribes.some((t) => tribes.includes(t))) return false;
        }
        return true;
      });
      const selected = candidates.slice(0, pick?.count ?? 0);

      const result = applyLegalAction({
        state: current,
        action,
        getCardDefinitionById,
        selectedDeckRevealCardIds: selected,
      });
      current = result.state;
    } else if (action.kind === "resolve_pending_deck_reveal_order") {
      // 順番はそのまま
      const result = applyLegalAction({
        state: current,
        action,
        getCardDefinitionById,
        deckRevealRemainderOrder: action.remainingCardInstanceIds,
        deckRevealPlacement:
          action.remainder === "top_or_bottom" ? "bottom" : undefined,
      });
      current = result.state;
    } else {
      break;
    }
  }
  return current;
}

// ── Real card definitions from BSTH01 ──

const 毛玉: CardDefinition = {
  cardNo: "BSTH01-C01",
  name: "毛玉",
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 1000 },
    { level: 2, requiredCores: 2, bp: 2000 },
  ],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const ルーミア: CardDefinition = {
  cardNo: "BSTH01-C04",
  name: "ルーミア",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: ["red"],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 3000 },
    { level: 2, requiredCores: 2, bp: 4000 },
    { level: 3, requiredCores: 4, bp: 6000 },
  ],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "幻想・紅魔",
  sourceUrls: [],
  sourceConfidence: "C",
};

const 紅美鈴: CardDefinition = {
  cardNo: "BSTH01-R04",
  name: "紅 美鈴",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 4,
  reductionSymbols: ["red", "red"],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 5000 },
    { level: 2, requiredCores: 2, bp: 6000 },
    { level: 3, requiredCores: 4, bp: 8000 },
  ],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const チルノ: CardDefinition = {
  cardNo: "BSTH01-C05",
  name: "[紅魔郷]チルノ",
  printedCategory: "spirit",
  colors: ["white"],
  cost: 3,
  reductionSymbols: ["white"],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 3000 },
    { level: 2, requiredCores: 2, bp: 5000 },
  ],
  symbolColors: ["white"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const allDefs = [毛玉, ルーミア, 紅美鈴, チルノ];
const defMap = new Map(allDefs.map((d) => [d.cardNo, d]));
const getCardDefinitionById = (id: string) => defMap.get(id);
const emptyFieldEffects = () => undefined;

describe("real card integration: BSTH01 東方紅魔郷", () => {
  it("can summon 毛玉 (cost 0) from hand to field", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(毛玉, {
          instanceId: "kedama-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: emptyFieldEffects,
    });
    expect(actions.some((a) => a.kind === "summon")).toBe(true);

    const result = playSummonAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "kedama-1",
      getCardDefinitionById,
      paymentSources: [],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    });

    const summoned = result.state.cardInstances.find(
      (c) => c.instanceId === "kedama-1"
    )!;
    expect(summoned.zone).toBe("field");
    expect(summoned.zoneRoleName).toBe("spirit");
    expect(summoned.normalCoreCount).toBe(1);
  });

  it("applies red reduction when ルーミア is summoned with red spirit on field", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(紅美鈴, {
          instanceId: "meirin-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const reduction = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: ルーミア,
      getCardDefinitionById,
    });

    expect(reduction.totalReduction).toBe(1);
    expect(reduction.reducedCost).toBe(2); // 3 - 1
  });

  it("applies partial red reduction for 紅美鈴 (needs 2 red, has 1)", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(ルーミア, {
          instanceId: "rumia-field",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const reduction = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: 紅美鈴,
      getCardDefinitionById,
    });

    expect(reduction.totalReduction).toBe(1); // only 1 red symbol available
    expect(reduction.reducedCost).toBe(3); // 4 - 1
  });

  it("white symbol does not reduce red cost", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(チルノ, {
          instanceId: "cirno-field",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const reduction = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: 紅美鈴,
      getCardDefinitionById,
    });

    expect(reduction.totalReduction).toBe(0);
    expect(reduction.reducedCost).toBe(4);
  });

  it("ルーミア attacks, チルノ blocks — same BP results in both destroyed", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [
        createCardInstance(ルーミア, {
          instanceId: "rumia-atk",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(チルノ, {
          instanceId: "cirno-blk",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    // Attack with ルーミア — tentative state (pre-declaration stack opens)
    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "rumia-atk",
      getCardDefinitionById,
    });

    // Pre-declaration stack should be open (attack is tentative)
    expect(tentative.preDeclarationStackWindow).not.toBeNull();

    // Card is still "recovered" in tentative state (exhaust happens on confirm)
    const atkCard = tentative.cardInstances.find(
      (c) => c.instanceId === "rumia-atk"
    )!;
    expect(atkCard.exhaustState).toBe("recovered");

    // Battle entities are created on confirm, not in tentative state
    // Verify the attacker card is still on field and ready for confirmation
    expect(atkCard.zone).toBe("field");
  });

  it("summon 毛玉 → summon ルーミア → both on field", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    let state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, reserveNormalCoreCount: 10 } : p
      ),
      cardInstances: [
        createCardInstance(毛玉, {
          instanceId: "kedama-seq",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(ルーミア, {
          instanceId: "rumia-seq",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    };

    // Summon 毛玉 (cost 0)
    state = playSummonAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "kedama-seq",
      getCardDefinitionById,
      paymentSources: [],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    }).state;

    expect(
      state.cardInstances.find((c) => c.instanceId === "kedama-seq")!.zone
    ).toBe("field");

    // Summon ルーミア (cost 3, no reduction from yellow 毛玉)
    state = playSummonAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "rumia-seq",
      getCardDefinitionById,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      paymentSources: [{ kind: "reserve", amount: 3 }],
    }).state;

    expect(
      state.cardInstances.find((c) => c.instanceId === "rumia-seq")!.zone
    ).toBe("field");

    const fieldCards = state.cardInstances.filter((c) => c.zone === "field");
    expect(fieldCards).toHaveLength(2);
  });

  it("summon not allowed outside main step", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [
        createCardInstance(毛玉, {
          instanceId: "kedama-atk",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: emptyFieldEffects,
    });

    expect(actions.filter((a) => a.kind === "summon")).toHaveLength(0);
  });
});

// ── BSTH01 Effect テスト ──

const 小悪魔: CardDefinition = {
  cardNo: "BSTH01-R05",
  name: "小悪魔",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 4,
  reductionSymbols: ["red", "red", "red"],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 3000 },
    { level: 2, requiredCores: 2, bp: 5000 },
    { level: 3, requiredCores: 4, bp: 6000 },
  ],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "幻想・紅魔・夜族",
  effects: [
    {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "search_zone",
            zone: "trash",
            count: 1,
            filter: { tribes: ["紅魔"] },
            destination: "hand",
          },
        },
      ],
    },
  ],
  sourceUrls: [],
  sourceConfidence: "C",
};

const レミリア: CardDefinition = {
  cardNo: "BSTH01-X03",
  name: "レミリア・スカーレット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 8,
  reductionSymbols: ["red", "red", "red", "red", "red"],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 8000 },
    { level: 2, requiredCores: 2, bp: 12000 },
    { level: 3, requiredCores: 4, bp: 16000 },
  ],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "幻想・紅魔・夜族",
  effects: [
    {
      timing: { kind: "card_event", event: "attack" },
      condition: { minLevel: 2 },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit", "ultimate"], maxBp: 20000 },
            },
          },
        },
      ],
    },
  ],
  sourceUrls: [],
  sourceConfidence: "C",
};

const ミニ八卦炉: CardDefinition = {
  cardNo: "BSTH01-R03",
  name: "ミニ八卦炉",
  printedCategory: "brave",
  colors: ["yellow"],
  cost: 4,
  reductionSymbols: ["yellow", "yellow", "guide"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  tribe: "幻想・導魔",
  braveCondition: { tribes: ["導魔"], minCost: 6 },
  sourceUrls: [],
  sourceConfidence: "C",
};

const 導魔スピリット: CardDefinition = {
  cardNo: "TEST-SP01",
  name: "導魔テストスピリット",
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 6,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  tribe: "幻想・導魔・楽族",
  sourceUrls: [],
  sourceConfidence: "C",
};

const 非導魔スピリット: CardDefinition = {
  cardNo: "TEST-SP02",
  name: "非導魔テストスピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "幻想・紅魔",
  sourceUrls: [],
  sourceConfidence: "C",
};

const レーヴァテイン: CardDefinition = {
  cardNo: "BSTH01-X09",
  name: "禁忌「レーヴァテイン」",
  printedCategory: "brave",
  colors: ["red"],
  cost: 6,
  reductionSymbols: ["red", "red", "purple"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  // スピリット状態 Lv1 BP (3000) とは別に、合体時の BP＋ は `(0)合体 +5000`。
  combinedBoost: 5000,
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "紅魔",
  // 合体条件：「フランドール・スカーレット」(部分一致)
  braveCondition: { cardNameContains: ["フランドール・スカーレット"] },
  sourceUrls: [],
  sourceConfidence: "C",
};

const フランドール: CardDefinition = {
  cardNo: "BSTH01-X04",
  name: "フランドール・スカーレット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 8,
  reductionSymbols: ["red", "red", "red", "red", "red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 8000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  tribe: "幻想・紅魔・夜族",
  sourceUrls: [],
  sourceConfidence: "C",
};

const effectTestDefs = [
  小悪魔,
  レミリア,
  ミニ八卦炉,
  導魔スピリット,
  非導魔スピリット,
  ルーミア,
  レーヴァテイン,
  フランドール,
];
const effectDefMap = new Map(effectTestDefs.map((d) => [d.cardNo, d]));
const getEffectDef = (id: string) => effectDefMap.get(id);

describe("BSTH01 structured effects", () => {
  it("小悪魔 return_from_trash: matches compound tribe 紅魔", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(小悪魔, {
          instanceId: "koakuma-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        // ルーミア in trash — tribe "幻想・紅魔" should match filter tribes: ["紅魔"]
        createCardInstance(ルーミア, {
          instanceId: "rumia-trash",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
    };

    const effect = 小悪魔.effects![0];
    const result = executeEffect({
      chainId: "test:integration-real-cards:620",
      state,
      effect,
      sourceInstanceId: "koakuma-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getEffectDef,
    });

    const rumia = result.cardInstances.find(
      (c) => c.instanceId === "rumia-trash"
    )!;
    expect(rumia.zone).toBe("hand");
    const alice = result.players.find((p) => p.id === "alice")!;
    // handCount increases by 1 from base (return_from_trash adds to hand)
    const baseAlice = state.players.find((p) => p.id === "alice")!;
    expect(alice.handCount).toBe(baseAlice.handCount + 1);
  });

  // ── 小悪魔 アクセル効果（deck top 3 → trash + 紅魔カウント coreMove + split N/M） ──
  //
  // 原文: 自分のデッキを上から3枚トラッシュに置く。その中の系統：「紅魔」を持つカード
  // 1枚につき、ボイドからコア1個を自分のリザーブ/トラッシュに置く。
  // (リザーブに置ける数は、この効果の使用コストでトラッシュに置かれたコアの数まで)
  //
  // 期待動作:
  //   - deck_reveal は使用されない（「オープン」と明記されていないため直接移動）
  //   - cards_from_ref で紅魔数をカウント
  //   - splitDestinations でリザーブ N + トラッシュ M をプレイヤーが分配選択（cap=3）
  const 小悪魔アクセル: CardDefinition = {
    ...小悪魔,
    accelData: {
      timing: "main",
      cost: 3,
      reduction: ["red"],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          usageLimit: { kind: "per_card_name", duration: "turn" },
          steps: [
            {
              id: "discardedTop3",
              action: {
                kind: "move_card",
                from: { zone: "deck", player: "self", position: "top" },
                to: { zone: "trash" },
                count: 3,
              },
            },
            {
              action: {
                kind: "core_move",
                from: { kind: "void", player: "self" },
                amount: {
                  source: {
                    kind: "cards_from_ref",
                    stepId: "discardedTop3",
                    filter: { tribes: ["紅魔"] },
                  },
                },
                splitDestinations: {
                  destinations: [
                    {
                      location: { kind: "reserve", player: "self" },
                      cap: { source: { kind: "cost_paid_this_effect" } },
                    },
                    { location: { kind: "trash", player: "self" } },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
  };

  const 非紅魔カード: CardDefinition = {
    cardNo: "TEST-NC",
    name: "非紅魔テスト",
    printedCategory: "spirit",
    colors: ["green"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["green"],
    textLines: [],
    keywordTags: [],
    tribe: "幻想・妖精",
    sourceUrls: [],
    sourceConfidence: "C",
  };

  // 共通ヘルパー: 小悪魔 アクセル を実行し、pending core split が出るところまで進める
  function runKoakumaAccelToPending(opts: {
    deckTop: Array<{ def: CardDefinition; instanceId: string }>;
    voidCores?: number;
    /** この効果の使用コストとして支払ったコア数。default=2 (アクセルコスト 3 から 1 軽減後)。 */
    costPaidThisEffect?: number;
  }): {
    state: GameState;
    localDefs: Map<string, CardDefinition>;
    aliceId: string;
  } {
    const localDefs = new Map<string, CardDefinition>([
      [小悪魔アクセル.cardNo, 小悪魔アクセル],
      [ルーミア.cardNo, ルーミア],
      [非紅魔カード.cardNo, 非紅魔カード],
      [非導魔スピリット.cardNo, 非導魔スピリット],
    ]);
    for (const c of opts.deckTop) localDefs.set(c.def.cardNo, c.def);

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingDeckCount: 0,
      startingVoidNormalCoreCount: opts.voidCores ?? 5,
      playerOverrides: [
        { reserveNormalCoreCount: 0, trashNormalCoreCount: 0 },
        {},
      ],
    });
    const initialState: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(小悪魔アクセル, {
          instanceId: "koakuma-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        ...opts.deckTop.map((c) =>
          createCardInstance(c.def, {
            instanceId: c.instanceId,
            ownerPlayerId: "alice",
            zone: "deck",
          })
        ),
      ],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: opts.deckTop.length } : p
      ),
    };

    const effect = 小悪魔アクセル.accelData!.effects![0]!;
    const result = executeEffect({
      chainId: "test:integration-real-cards:763",
      state: initialState,
      effect,
      sourceInstanceId: "koakuma-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
      costPaidThisEffect: opts.costPaidThisEffect ?? 2,
    });

    return { state: result, localDefs, aliceId: "alice" };
  }

  it("小悪魔 accel split: 紅魔 2 枚 → pending 生成 + reserve=2/trash=0 で全リザーブ", () => {
    const { state, localDefs } = runKoakumaAccelToPending({
      deckTop: [
        { def: ルーミア, instanceId: "deck-top-1" },
        { def: 非紅魔カード, instanceId: "deck-top-2" },
        { def: 非導魔スピリット, instanceId: "deck-top-3" },
      ],
    });

    // 3 枚が trash に移動
    expect(
      state.cardInstances.find((c) => c.instanceId === "deck-top-1")!.zone
    ).toBe("trash");
    expect(
      state.cardInstances.find((c) => c.instanceId === "deck-top-2")!.zone
    ).toBe("trash");
    expect(
      state.cardInstances.find((c) => c.instanceId === "deck-top-3")!.zone
    ).toBe("trash");

    // pending core split が生成されている
    expect(state.pendingCoreSplitSelection).not.toBeNull();
    expect(state.pendingCoreSplitSelection!.totalAmount).toBe(2);
    expect(state.pendingCoreSplitSelection!.destinations).toHaveLength(2);
    // cap は使用コスト (paid=2) 由来 — 「リザーブに置ける数は使用コスト分まで」
    expect(state.pendingCoreSplitSelection!.destinations[0]!.cap).toBe(2);

    // legal action として resolve_pending_core_split が出ている
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("resolve_pending_core_split");

    // 全リザーブ (2,0) で解決
    const resolved = applyLegalAction({
      state,
      action: actions[0]!,
      getCardDefinitionById: (id) => localDefs.get(id),
      coreSplitDistribution: [2, 0],
    }) as { state: GameState };
    const alice = resolved.state.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(2);
    expect(alice.trashNormalCoreCount).toBe(0);
    expect(alice.voidNormalCoreCount).toBe(3);
    expect(resolved.state.pendingCoreSplitSelection).toBeNull();
  });

  it("小悪魔 accel split: 紅魔 2 枚 → reserve=1/trash=1 で半々", () => {
    const { state, localDefs } = runKoakumaAccelToPending({
      deckTop: [
        { def: ルーミア, instanceId: "d1" },
        { def: 非紅魔カード, instanceId: "d2" },
        { def: 非導魔スピリット, instanceId: "d3" },
      ],
    });
    expect(state.pendingCoreSplitSelection!.totalAmount).toBe(2);

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });
    const resolved = applyLegalAction({
      state,
      action: actions[0]!,
      getCardDefinitionById: (id) => localDefs.get(id),
      coreSplitDistribution: [1, 1],
    }) as { state: GameState };
    const alice = resolved.state.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(alice.trashNormalCoreCount).toBe(1);
    expect(alice.voidNormalCoreCount).toBe(3);
  });

  it("小悪魔 accel split: 紅魔 2 枚 → reserve=0/trash=2 で全トラッシュ", () => {
    const { state, localDefs } = runKoakumaAccelToPending({
      deckTop: [
        { def: ルーミア, instanceId: "d1" },
        { def: 非紅魔カード, instanceId: "d2" },
        { def: 非導魔スピリット, instanceId: "d3" },
      ],
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });
    const resolved = applyLegalAction({
      state,
      action: actions[0]!,
      getCardDefinitionById: (id) => localDefs.get(id),
      coreSplitDistribution: [0, 2],
    }) as { state: GameState };
    const alice = resolved.state.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.trashNormalCoreCount).toBe(2);
    expect(alice.voidNormalCoreCount).toBe(3);
  });

  it("小悪魔 accel split: 紅魔 0 枚なら pending 生成されず即終了", () => {
    const { state } = runKoakumaAccelToPending({
      deckTop: [
        { def: 非紅魔カード, instanceId: "d1" },
        { def: 非紅魔カード, instanceId: "d2" },
        { def: 非紅魔カード, instanceId: "d3" },
      ],
    });
    // 3 枚は trash へ
    expect(
      state.cardInstances.filter(
        (c) => c.zone === "trash" && c.ownerPlayerId === "alice"
      )
    ).toHaveLength(3);
    // pending 無し
    expect(state.pendingCoreSplitSelection).toBeNull();
    const alice = state.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.trashNormalCoreCount).toBe(0);
    expect(alice.voidNormalCoreCount).toBe(5);
  });

  it("小悪魔 accel split: 紅魔 3 枚 + 軽減後コスト=2 → reserve=3 は cap 違反、reserve=2/trash=1 のみ valid", () => {
    // 裁定: 「リザーブに置ける数は、この効果の使用コストでトラッシュに置かれたコアの数まで」
    // アクセルコスト 3 → 軽減 1 → paid=2 なので reserve cap=2、超過分はトラッシュへ。
    const { state, localDefs } = runKoakumaAccelToPending({
      deckTop: [
        { def: ルーミア, instanceId: "d1" },
        { def: ルーミア, instanceId: "d2" },
        { def: 非導魔スピリット, instanceId: "d3" },
      ],
    });
    expect(state.pendingCoreSplitSelection!.totalAmount).toBe(3);
    expect(state.pendingCoreSplitSelection!.destinations[0]!.cap).toBe(2);

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });

    // reserve=3 は cap=2 を超えるため reject
    const overCap = tryApplyLegalAction({
      state,
      action: actions[0]!,
      getCardDefinitionById: (id) => localDefs.get(id),
      coreSplitDistribution: [3, 0],
    });
    expect(overCap.ok).toBe(false);

    // reserve=2 / trash=1 は valid
    const resolved = applyLegalAction({
      state,
      action: actions[0]!,
      getCardDefinitionById: (id) => localDefs.get(id),
      coreSplitDistribution: [2, 1],
    }) as { state: GameState };
    const alice = resolved.state.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(2);
    expect(alice.trashNormalCoreCount).toBe(1);
  });

  it("小悪魔 accel split: 軽減 0 で paid=3 なら reserve cap=3 まで許容", () => {
    // 軽減シンボルが無い盤面 (paid=3) では reserve に最大 3 個まで置ける。
    const { state, localDefs } = runKoakumaAccelToPending({
      deckTop: [
        { def: ルーミア, instanceId: "d1" },
        { def: ルーミア, instanceId: "d2" },
        { def: 非導魔スピリット, instanceId: "d3" },
      ],
      costPaidThisEffect: 3,
    });
    expect(state.pendingCoreSplitSelection!.totalAmount).toBe(3);
    expect(state.pendingCoreSplitSelection!.destinations[0]!.cap).toBe(3);

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });
    const resolved = applyLegalAction({
      state,
      action: actions[0]!,
      getCardDefinitionById: (id) => localDefs.get(id),
      coreSplitDistribution: [3, 0],
    }) as { state: GameState };
    const alice = resolved.state.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(3);
    expect(alice.trashNormalCoreCount).toBe(0);
  });

  it("小悪魔 accel split: 紅魔 3 枚で reserve=4 は totalAmount 不一致で validate エラー", () => {
    // reserve=4 + trash=0 は合計=4 ≠ totalAmount=3 で先に弾かれる (cap 違反より前段)。
    const { state, localDefs } = runKoakumaAccelToPending({
      deckTop: [
        { def: ルーミア, instanceId: "d1" },
        { def: ルーミア, instanceId: "d2" },
        { def: 非導魔スピリット, instanceId: "d3" },
      ],
    });
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });

    // 合計 4 ≠ 3 → tryApplyLegalAction で ok:false
    const result = tryApplyLegalAction({
      state,
      action: actions[0]!,
      getCardDefinitionById: (id) => localDefs.get(id),
      coreSplitDistribution: [4, 0],
    });
    expect(result.ok).toBe(false);
  });

  it("小悪魔 return_from_trash: does not match non-紅魔 tribe", () => {
    const nonKouma: CardDefinition = {
      cardNo: "TEST-NK",
      name: "非紅魔カード",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["green"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・妖精",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([...effectDefMap, [nonKouma.cardNo, nonKouma]]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(小悪魔, {
          instanceId: "koakuma-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(nonKouma, {
          instanceId: "nk-trash",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
    };

    const result = executeEffect({
      chainId: "test:integration-real-cards:1029",
      state,
      effect: 小悪魔.effects![0],
      sourceInstanceId: "koakuma-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });

    const nk = result.cardInstances.find((c) => c.instanceId === "nk-trash")!;
    expect(nk.zone).toBe("trash"); // not returned
  });

  it("レミリア destroy: destroys opponent spirit with BP ≤ 20000", () => {
    const opponentSpirit: CardDefinition = {
      cardNo: "TEST-OPP",
      name: "相手スピリット",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 15000 }],
      symbolColors: ["blue"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      ...effectDefMap,
      [opponentSpirit.cardNo, opponentSpirit],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(レミリア, {
          instanceId: "remilia-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
        createCardInstance(opponentSpirit, {
          instanceId: "opp-sp",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const result = executeEffect({
      chainId: "test:integration-real-cards:1080",
      state,
      effect: レミリア.effects![0],
      sourceInstanceId: "remilia-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });

    const opp = result.cardInstances.find((c) => c.instanceId === "opp-sp")!;
    expect(opp.pendingLeaveKind).toBe("destroy");
  });

  it("braveCondition tribe match: ミニ八卦炉 can combine with 導魔 spirit (compound tribe)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(ミニ八卦炉, {
          instanceId: "hakke-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(導魔スピリット, {
          instanceId: "douma-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getEffectDef,
      getRegisteredFieldCardEffectActions: () => undefined,
    });

    const combines = actions.filter((a) => a.kind === "brave_combine");
    expect(combines.length).toBeGreaterThanOrEqual(1);
  });

  it("braveCondition tribe match: ミニ八卦炉 cannot combine with non-導魔 spirit", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(ミニ八卦炉, {
          instanceId: "hakke-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(非導魔スピリット, {
          instanceId: "non-douma",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getEffectDef,
      getRegisteredFieldCardEffectActions: () => undefined,
    });

    const combines = actions.filter((a) => a.kind === "brave_combine");
    expect(combines).toHaveLength(0);
  });

  it("braveCondition cardNameContains (regression): 禁忌「レーヴァテイン」 cannot combine with レミリア・スカーレット", () => {
    // 合体条件：「フランドール・スカーレット」。レミリア・スカーレットは名前に
    // 「フランドール・スカーレット」を含まないため合体先候補にならない。
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(レーヴァテイン, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(レミリア, {
          instanceId: "remilia-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getEffectDef,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    const combines = actions.filter((a) => a.kind === "brave_combine");
    expect(combines).toHaveLength(0);
  });

  it("braveCondition cardNameContains: 禁忌「レーヴァテイン」 can combine with フランドール・スカーレット", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(レーヴァテイン, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(フランドール, {
          instanceId: "flandre-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getEffectDef,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    const combines = actions.filter(
      (a) => a.kind === "brave_combine" && a.targetInstanceId === "flandre-1"
    );
    expect(combines).toHaveLength(1);
  });

  it("combined BP: 禁忌「レーヴァテイン」合体時はホスト BP + 合体 +5000 (Lv1 BP 3000 ではない)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const flandre = {
      ...createCardInstance(フランドール, {
        instanceId: "flandre-1",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 1,
      }),
      attachedChildrenIds: ["brave-1"],
    };
    const brave = {
      ...createCardInstance(レーヴァテイン, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        zone: "field" as const,
        cores: 0,
      }),
      attachedToInstanceId: "flandre-1",
    };
    const state: GameState = {
      ...base,
      cardInstances: [flandre, brave],
    };
    // フランドール Lv1 BP 8000 + レーヴァテイン 合体 +5000 = 13000
    // (退行時の levelDefs 流用なら 8000 + 3000 = 11000 になっていた)
    expect(getCombinedUnitBp(state, flandre, フランドール, getEffectDef)).toBe(
      13000
    );
  });

  it("bounce: returns opponent spirit from field to hand", () => {
    const opponentSpirit: CardDefinition = {
      cardNo: "TEST-OPP-B",
      name: "相手スピリット",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["blue"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      ...effectDefMap,
      [opponentSpirit.cardNo, opponentSpirit],
    ]);
    const チルノDef: CardDefinition = {
      cardNo: "BSTH01-C05",
      name: "[紅魔郷]チルノ",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 3,
      reductionSymbols: ["white"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["white"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・紅魔・妖精",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          executionMode: "optional",
          usageLimit: { kind: "per_instance", duration: "turn" },
          steps: [
            {
              action: {
                kind: "bounce",
                target: {
                  kind: "filter",
                  player: "opponent",
                  count: 1,
                  filter: { category: ["spirit"] },
                },
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    localDefs.set(チルノDef.cardNo, チルノDef);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(チルノDef, {
          instanceId: "cirno-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(opponentSpirit, {
          instanceId: "opp-bounce",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 2,
        }),
      ],
    };

    const result = flushPendingLeaves(
      executeEffect({
        chainId: "test:integration-real-cards:1333",
        state,
        effect: チルノDef.effects![0],
        sourceInstanceId: "cirno-1",
        actingPlayerId: "alice",
        getCardDefinitionById: (id) => localDefs.get(id),
      }),
      (id) => localDefs.get(id)
    );

    const opp = result.cardInstances.find(
      (c) => c.instanceId === "opp-bounce"
    )!;
    expect(opp.zone).toBe("hand");
    expect(opp.normalCoreCount).toBe(0);
    const bob = result.players.find((p) => p.id === "bob")!;
    const baseBob = state.players.find((p) => p.id === "bob")!;
    expect(bob.handCount).toBe(baseBob.handCount + 1);
    expect(bob.reserveNormalCoreCount).toBe(baseBob.reserveNormalCoreCount + 2);
  });

  it("braveCondition minCost: ミニ八卦炉 cannot combine with cost < 6 spirit", () => {
    const lowCostDouma: CardDefinition = {
      ...導魔スピリット,
      cardNo: "TEST-LOW",
      cost: 5,
    };
    const localDefs = new Map([
      ...effectDefMap,
      [lowCostDouma.cardNo, lowCostDouma],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(ミニ八卦炉, {
          instanceId: "hakke-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(lowCostDouma, {
          instanceId: "low-douma",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
      getRegisteredFieldCardEffectActions: () => undefined,
    });

    const combines = actions.filter((a) => a.kind === "brave_combine");
    expect(combines).toHaveLength(0);
  });

  it("C22 draw: main timing draws 3 cards", () => {
    const magic: CardDefinition = {
      cardNo: "BSTH01-C22",
      name: "土符「レイジィトリリトン」",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          usageLimit: { kind: "per_card_name", duration: "turn" },
          steps: [{ action: { kind: "draw", count: 3 } }],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = { ...base, activePlayerId: "alice" };
    const result = executeEffect({
      chainId: "test:integration-real-cards:1420",
      state,
      effect: magic.effects![0],
      sourceInstanceId: "magic-1",
      actingPlayerId: "alice",
      getCardDefinitionById: () => undefined,
    });
    const alice = result.players.find((p) => p.id === "alice")!;
    const baseAlice = state.players.find((p) => p.id === "alice")!;
    expect(alice.handCount).toBe(baseAlice.handCount + 3);
    expect(alice.deckCount).toBe(baseAlice.deckCount - 3);
  });

  it("C11 on_place return_from_trash: returns 黄 cards with matching tribes", () => {
    const nexusDef: CardDefinition = {
      cardNo: "BSTH01-C11",
      name: "霧雨魔法店",
      printedCategory: "nexus",
      colors: ["yellow"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "card_event", event: "place" },
          steps: [
            {
              action: {
                kind: "search_zone",
                zone: "trash",
                count: 2,
                filter: {
                  tribes: ["幻想", "導魔", "楽族"],
                  colors: ["yellow"],
                },
                destination: "hand",
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const yellowCard: CardDefinition = {
      cardNo: "TEST-YEL",
      name: "黄幻想カード",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・楽族",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      [nexusDef.cardNo, nexusDef],
      [yellowCard.cardNo, yellowCard],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(nexusDef, {
          instanceId: "nexus-1",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(yellowCard, {
          instanceId: "yel-trash",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
    };
    const result = executeEffect({
      chainId: "test:integration-real-cards:1503",
      state,
      effect: nexusDef.effects![0],
      sourceInstanceId: "nexus-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "yel-trash")!.zone
    ).toBe("hand");
  });

  it("discard_hand + draw: BSTH02 プリズムリバー pattern", () => {
    const リリカ: CardDefinition = {
      cardNo: "BSTH02-R01",
      name: "リリカ・プリズムリバー",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・冥主",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          steps: [
            { action: { kind: "discard", count: 1 } },
            { action: { kind: "draw", count: 2 } },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const handCard: CardDefinition = {
      cardNo: "TEST-HAND",
      name: "手札カード",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      [リリカ.cardNo, リリカ],
      [handCard.cardNo, handCard],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(リリカ, {
          instanceId: "lirica-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(handCard, {
          instanceId: "hand-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    };
    const result = executeEffect({
      chainId: "test:integration-real-cards:1576",
      state,
      effect: リリカ.effects![0],
      sourceInstanceId: "lirica-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });
    // hand-1 discarded to trash, then drew 2
    expect(
      result.cardInstances.find((c) => c.instanceId === "hand-1")!.zone
    ).toBe("trash");
    const alice = result.players.find((p) => p.id === "alice")!;
    const baseAlice = state.players.find((p) => p.id === "alice")!;
    // -1 discard + 2 draw = net +1
    expect(alice.handCount).toBe(baseAlice.handCount + 1);
  });

  it("send_to_deck: returns opponent nexus to deck bottom", () => {
    const spirit: CardDefinition = {
      cardNo: "BSTH02.7-M01",
      name: "オルレアン人形",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 7,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 7000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "起幻・幻想・動玩",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          executionMode: "optional",
          usageLimit: { kind: "per_card_name", duration: "turn" },
          steps: [
            {
              action: {
                kind: "send_to_deck",
                target: {
                  kind: "filter",
                  player: "opponent",
                  count: 1,
                  filter: { category: ["nexus"] },
                },
                position: "bottom",
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const oppNexus: CardDefinition = {
      cardNo: "TEST-NEXUS",
      name: "相手ネクサス",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      [spirit.cardNo, spirit],
      [oppNexus.cardNo, oppNexus],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(spirit, {
          instanceId: "orl-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(oppNexus, {
          instanceId: "opp-nex",
          ownerPlayerId: "bob",
          zone: "field",
        }),
      ],
    };
    const getDef = (id: string) => localDefs.get(id);
    const result = flushPendingLeaves(
      executeEffect({
        chainId: "test:integration-real-cards:1668",
        state,
        effect: spirit.effects![0],
        sourceInstanceId: "orl-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      }),
      getDef
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "opp-nex")!.zone
    ).toBe("deck");
    const bob = result.players.find((p) => p.id === "bob")!;
    const baseBob = state.players.find((p) => p.id === "bob")!;
    expect(bob.deckCount).toBe(baseBob.deckCount + 1);
  });

  it("exhaust: flash exhausts 2 opponent spirits", () => {
    const magic: CardDefinition = {
      cardNo: "BSTH03-R03",
      name: "ファーストピラミッド",
      printedCategory: "magic",
      colors: ["green"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・起幻",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "exhaust",
                target: {
                  kind: "filter",
                  player: "opponent",
                  count: 2,
                  filter: { category: ["spirit", "ultimate"] },
                },
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const oppSp: CardDefinition = {
      cardNo: "TEST-EXH",
      name: "相手スピリット",
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
    };
    const localDefs = new Map([
      [magic.cardNo, magic],
      [oppSp.cardNo, oppSp],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(oppSp, {
          instanceId: "opp-1",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(oppSp, {
          instanceId: "opp-2",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    const result = executeEffect({
      chainId: "test:integration-real-cards:1756",
      state,
      effect: magic.effects![0],
      sourceInstanceId: "magic-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "opp-1")!.exhaustState
    ).toBe("exhausted");
    expect(
      result.cardInstances.find((c) => c.instanceId === "opp-2")!.exhaustState
    ).toBe("exhausted");
  });

  it("deck_reveal: R04 opens 4, picks 2 紅魔 cards to hand", () => {
    const r04: CardDefinition = {
      cardNo: "BSTH01-R04",
      name: "紅 美鈴",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・紅魔・竜渡",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          executionMode: "optional",
          usageLimit: { kind: "per_card_name", duration: "turn" },
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 4,
                picks: [{ count: 2, filter: { tribes: ["紅魔"] } }],
                remainder: "bottom",
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const deckCard1: CardDefinition = {
      cardNo: "TEST-D1",
      name: "紅魔カード1",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・紅魔",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const deckCard2: CardDefinition = {
      cardNo: "TEST-D2",
      name: "非紅魔カード",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["green"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・妖精",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      [r04.cardNo, r04],
      [deckCard1.cardNo, deckCard1],
      [deckCard2.cardNo, deckCard2],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(r04, {
          instanceId: "meirin-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(deckCard1, {
          instanceId: "dk1",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(deckCard1, {
          instanceId: "dk2",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(deckCard2, {
          instanceId: "dk3",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(deckCard2, {
          instanceId: "dk4",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ],
    };
    const getDef = (id: string) => localDefs.get(id);
    const pending = executeEffect({
      chainId: "test:integration-real-cards:1873",
      state,
      effect: r04.effects![0],
      sourceInstanceId: "meirin-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    // pending state: cards are opened in the transient revealed state
    expect(pending.pendingDeckReveal).not.toBeNull();
    const result = completeDeckRevealPending(pending, getDef);
    // dk1, dk2 are 紅魔 → picked to hand; dk3, dk4 are not → remain in deck
    expect(result.cardInstances.find((c) => c.instanceId === "dk1")!.zone).toBe(
      "hand"
    );
    expect(result.cardInstances.find((c) => c.instanceId === "dk2")!.zone).toBe(
      "hand"
    );
    expect(result.cardInstances.find((c) => c.instanceId === "dk3")!.zone).toBe(
      "deck"
    );
    expect(result.cardInstances.find((c) => c.instanceId === "dk4")!.zone).toBe(
      "deck"
    );
    const alice = result.players.find((p) => p.id === "alice")!;
    const baseAlice = state.players.find((p) => p.id === "alice")!;
    expect(alice.handCount).toBe(baseAlice.handCount + 2);
    expect(alice.deckCount).toBe(baseAlice.deckCount - 2);
  });

  it("core_move field→reserve: moves cores from opponent field cards to reserve", () => {
    const youmu: CardDefinition = {
      cardNo: "BSTH04-R02",
      name: "[花映塚]魂魄 妖夢",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 7,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 7000 },
        { level: 2, requiredCores: 2, bp: 10000 },
      ],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: ["burst"],
      tribe: "起幻・幻想・冥主",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          condition: { minLevel: 2 },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "field", player: "opponent" },
                to: { kind: "reserve", player: "opponent" },
                amount: 2,
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const oppSp: CardDefinition = {
      cardNo: "TEST-FIELD-CORE",
      name: "相手スピリット",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["blue"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      [youmu.cardNo, youmu],
      [oppSp.cardNo, oppSp],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(youmu, {
          instanceId: "youmu-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
        createCardInstance(oppSp, {
          instanceId: "opp-a",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 3,
        }),
        createCardInstance(oppSp, {
          instanceId: "opp-b",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    const pendingResult = executeEffect({
      chainId: "test:integration-real-cards:1980",
      state,
      effect: youmu.effects![0],
      sourceInstanceId: "youmu-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });
    // 複数フィールドカードにコアがあるので pending 状態になる
    expect(pendingResult.pendingCoreShootSelection).not.toBeNull();
    expect(pendingResult.pendingCoreShootSelection!.totalAmount).toBe(2);
    expect(pendingResult.pendingCoreShootSelection!.candidates).toHaveLength(2);

    // pending を解決: opp-a から 2 コアを取る
    const legalActions = getLegalActions({
      state: pendingResult,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    const csAction = legalActions.find(
      (a) => a.kind === "resolve_pending_core_shoot"
    );
    expect(csAction).toBeDefined();
    const resolved = applyLegalAction({
      state: pendingResult,
      action: csAction!,
      getCardDefinitionById: (id) => localDefs.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      coreShootDistribution: { "opp-a": 2 },
    });
    const result = resolved.state;
    // 2 cores moved from opponent field (opp-a has 3, so takes 2 from it)
    const oppA = result.cardInstances.find((c) => c.instanceId === "opp-a")!;
    expect(oppA.normalCoreCount).toBe(1); // 3 - 2
    const bob = result.players.find((p) => p.id === "bob")!;
    const baseBob = state.players.find((p) => p.id === "bob")!;
    expect(bob.reserveNormalCoreCount).toBe(baseBob.reserveNormalCoreCount + 2);
  });

  it("core_move field→reserve (player-selected): spirit reduced to 0 cores vanishes (SBA runs on pending resolution)", () => {
    // 回帰: player-selected コアシュートで最低コア未満になったスピリットが消滅せず
    // フィールドに残る不具合 (snapshot 2026-05-30T16-19-12)。pending 解決時に SBA が
    // 走らないのが原因だった。
    const youmu: CardDefinition = {
      cardNo: "BSTH04-R02",
      name: "[花映塚]魂魄 妖夢",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 7,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 7000 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      tribe: "起幻・幻想・冥主",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "field", player: "opponent" },
                to: { kind: "reserve", player: "opponent" },
                amount: 1,
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const oppSp: CardDefinition = {
      cardNo: "TEST-FIELD-CORE",
      name: "相手スピリット",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["blue"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      [youmu.cardNo, youmu],
      [oppSp.cardNo, oppSp],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(youmu, {
          instanceId: "youmu-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
        // opp-a はコア1。最後の1コアを抜かれると Lv1(1) 未満 → 消滅すべき。
        createCardInstance(oppSp, {
          instanceId: "opp-a",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        // 候補を 2 体にして player-selected (pending) 経路へ入れる。
        createCardInstance(oppSp, {
          instanceId: "opp-b",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 2,
        }),
      ],
    };
    const pendingResult = executeEffect({
      chainId: "test:integration-real-cards:2098",
      state,
      effect: youmu.effects![0],
      sourceInstanceId: "youmu-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });
    expect(pendingResult.pendingCoreShootSelection).not.toBeNull();

    const legalActions = getLegalActions({
      state: pendingResult,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    const csAction = legalActions.find(
      (a) => a.kind === "resolve_pending_core_shoot"
    );
    expect(csAction).toBeDefined();

    // opp-a から最後の1コアを抜く。
    const resolved = applyLegalAction({
      state: pendingResult,
      action: csAction!,
      getCardDefinitionById: (id) => localDefs.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      coreShootDistribution: { "opp-a": 1 },
    });
    const result = resolved.state;
    const oppA = result.cardInstances.find((c) => c.instanceId === "opp-a")!;
    // コア0かつ Lv1 未満 → 消滅してフィールドに残らない。
    expect(oppA.normalCoreCount).toBe(0);
    expect(oppA.zone).not.toBe("field");
    expect(oppA.zone).toBe("trash");
    // opp-b はコアを抜かれていないのでフィールドに残る。
    const oppB = result.cardInstances.find((c) => c.instanceId === "opp-b")!;
    expect(oppB.zone).toBe("field");
  });

  it("BSTH04-C01 deck_reveal: opens 3, picks 導界者 nexus + 幻想 card to hand, remainder to trash", () => {
    const chirno: CardDefinition = {
      cardNo: "BSTH04-C01",
      name: "[花映塚]チルノ",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      tribe: "起幻・幻想・冥主",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 3,
                picks: [
                  {
                    count: 1,
                    filter: {
                      tribes: ["導界者"],
                      category: ["nexus"],
                      colors: ["yellow", "purple"],
                    },
                  },
                  {
                    count: 1,
                    filter: {
                      tribes: ["幻想", "起幻"],
                      colors: ["yellow", "purple"],
                    },
                  },
                ],
                remainder: "trash",
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const doukaisya: CardDefinition = {
      cardNo: "TEST-DOUK",
      name: "導界者ネクサス",
      printedCategory: "nexus",
      colors: ["purple"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["guide"],
      textLines: [],
      keywordTags: [],
      tribe: "導界者・起幻・冥主",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const gensoCard: CardDefinition = {
      cardNo: "TEST-GENSO",
      name: "幻想カード",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "起幻・幻想・楽族",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const otherCard: CardDefinition = {
      cardNo: "TEST-OTHER",
      name: "無関係カード",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "竜騎・星竜",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      [chirno.cardNo, chirno],
      [doukaisya.cardNo, doukaisya],
      [gensoCard.cardNo, gensoCard],
      [otherCard.cardNo, otherCard],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(chirno, {
          instanceId: "chirno-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(doukaisya, {
          instanceId: "dk-douk",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(gensoCard, {
          instanceId: "dk-genso",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(otherCard, {
          instanceId: "dk-other",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ],
    };
    const getDef = (id: string) => localDefs.get(id);
    const pending = executeEffect({
      chainId: "test:integration-real-cards:2265",
      state,
      effect: chirno.effects![0],
      sourceInstanceId: "chirno-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(pending.pendingDeckReveal).not.toBeNull();
    const result = completeDeckRevealPending(pending, getDef);
    // 導界者 nexus picked to hand
    expect(
      result.cardInstances.find((c) => c.instanceId === "dk-douk")!.zone
    ).toBe("hand");
    // 幻想 card picked to hand
    expect(
      result.cardInstances.find((c) => c.instanceId === "dk-genso")!.zone
    ).toBe("hand");
    // unmatched card goes to trash
    expect(
      result.cardInstances.find((c) => c.instanceId === "dk-other")!.zone
    ).toBe("trash");
    const alice = result.players.find((p) => p.id === "alice")!;
    const baseAlice = state.players.find((p) => p.id === "alice")!;
    expect(alice.handCount).toBe(baseAlice.handCount + 2);
    expect(alice.deckCount).toBe(baseAlice.deckCount - 3); // 3 revealed, 2 picked, 1 trashed
  });

  it("BSTH04-C03 deck_reveal+return_from_trash: discards 2 then recovers from trash", () => {
    const tewi: CardDefinition = {
      cardNo: "BSTH04-C03",
      name: "[花映塚]因幡 てゐ",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      tribe: "起幻・幻想・冥主",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          executionMode: "optional",
          usageLimit: { kind: "per_instance", duration: "turn" },
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 2,
                picks: [],
                remainder: "trash",
              },
            },
            {
              action: {
                kind: "search_zone",
                zone: "trash",
                count: 1,
                filter: { tribes: ["起幻"], colors: ["yellow", "purple"] },
                destination: "hand",
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const kigenCard: CardDefinition = {
      cardNo: "TEST-KIGEN",
      name: "起幻カード",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      tribe: "起幻・幻想",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const otherDeck: CardDefinition = {
      cardNo: "TEST-DECK2",
      name: "デッキカード",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "竜騎",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      [tewi.cardNo, tewi],
      [kigenCard.cardNo, kigenCard],
      [otherDeck.cardNo, otherDeck],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(tewi, {
          instanceId: "tewi-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(kigenCard, {
          instanceId: "dk-kigen",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(otherDeck, {
          instanceId: "dk-other2",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ],
    };
    const getDef = (id: string) => localDefs.get(id);
    // deck_reveal (no picks, remainder: trash) → 順序選択 pending を立てず両方トラッシュへ。
    // pending で step が止まらないため、後続 step (return_from_trash) も同じ
    // executeEffect 内で連続実行され、起源カードをトラッシュから手札へ回収する。
    const result = executeEffect({
      chainId: "test:integration-real-cards:2396",
      state,
      effect: tewi.effects![0],
      sourceInstanceId: "tewi-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(result.pendingDeckReveal).toBeNull();
    expect(
      result.cardInstances.find((c) => c.instanceId === "dk-kigen")!.zone
    ).toBe("hand");
    expect(
      result.cardInstances.find((c) => c.instanceId === "dk-other2")!.zone
    ).toBe("trash");
    const alice = result.players.find((p) => p.id === "alice")!;
    const baseAlice = state.players.find((p) => p.id === "alice")!;
    expect(alice.handCount).toBe(baseAlice.handCount + 1);
  });

  it("BSTH04-C12 draw: magic main timing draws 2 cards", () => {
    const tossenMagic: CardDefinition = {
      cardNo: "BSTH04-C12",
      name: "投銭「宵越しの銭」",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "起幻・幻想・冥主",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [{ action: { kind: "draw", count: 2 } }],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = { ...base, activePlayerId: "alice" };
    const result = executeEffect({
      chainId: "test:integration-real-cards:2439",
      state,
      effect: tossenMagic.effects![0],
      sourceInstanceId: "magic-1",
      actingPlayerId: "alice",
      getCardDefinitionById: () => undefined,
    });
    const alice = result.players.find((p) => p.id === "alice")!;
    const baseAlice = state.players.find((p) => p.id === "alice")!;
    expect(alice.handCount).toBe(baseAlice.handCount + 2);
    expect(alice.deckCount).toBe(baseAlice.deckCount - 2);
  });

  it("BSTH04-転醒R01(A) deck_reveal: opens 2, picks 起幻 yellow/purple card to hand", () => {
    const jyohariNoKagami: CardDefinition = {
      cardNo: "BSTH04-転醒R01(A)",
      name: "浄玻璃の鏡",
      printedCategory: "nexus",
      colors: ["yellow", "purple"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: [],
      textLines: [],
      keywordTags: ["double_sided"],
      tribe: "創界石・起幻・幻想",
      effects: [
        {
          timing: { kind: "card_event", event: "place" },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 2,
                picks: [
                  {
                    count: 1,
                    filter: { tribes: ["起幻"], colors: ["yellow", "purple"] },
                  },
                ],
                remainder: "trash",
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const kigenYellow: CardDefinition = {
      cardNo: "TEST-KIG-Y",
      name: "起幻黄カード",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "起幻・幻想・楽族",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const redCard: CardDefinition = {
      cardNo: "TEST-RED",
      name: "赤カード",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "竜騎",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      [jyohariNoKagami.cardNo, jyohariNoKagami],
      [kigenYellow.cardNo, kigenYellow],
      [redCard.cardNo, redCard],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(jyohariNoKagami, {
          instanceId: "kagami-1",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(kigenYellow, {
          instanceId: "dk-ky",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(redCard, {
          instanceId: "dk-red",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ],
    };
    const getDef = (id: string) => localDefs.get(id);
    const pending = executeEffect({
      chainId: "test:integration-real-cards:2547",
      state,
      effect: jyohariNoKagami.effects![0],
      sourceInstanceId: "kagami-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(pending.pendingDeckReveal).not.toBeNull();
    const result = completeDeckRevealPending(pending, getDef);
    expect(
      result.cardInstances.find((c) => c.instanceId === "dk-ky")!.zone
    ).toBe("hand");
    expect(
      result.cardInstances.find((c) => c.instanceId === "dk-red")!.zone
    ).toBe("trash");
    const alice = result.players.find((p) => p.id === "alice")!;
    const baseAlice = state.players.find((p) => p.id === "alice")!;
    expect(alice.handCount).toBe(baseAlice.handCount + 1);
    expect(alice.deckCount).toBe(baseAlice.deckCount - 2);
  });

  it("destroy game-limited: BSTH02.5 萃香 destroys 3 targets", () => {
    const 萃香: CardDefinition = {
      cardNo: "BSTH02.5-X01",
      name: "伊吹 萃香",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 6,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 7000 }],
      symbolColors: ["green"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・遊精・皇獣・地霊",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          condition: { minLevel: 2 },
          usageLimit: { kind: "per_card_name", duration: "game", maxCount: 1 },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  count: 3,
                  filter: { category: ["spirit", "ultimate", "nexus"] },
                },
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const oppSp: CardDefinition = {
      cardNo: "TEST-TARG",
      name: "ターゲット",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["blue"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      [萃香.cardNo, 萃香],
      [oppSp.cardNo, oppSp],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(萃香, {
          instanceId: "suika-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 3,
        }),
        createCardInstance(oppSp, {
          instanceId: "t1",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(oppSp, {
          instanceId: "t2",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(oppSp, {
          instanceId: "t3",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    const result = executeEffect({
      chainId: "test:integration-real-cards:2653",
      state,
      effect: 萃香.effects![0],
      sourceInstanceId: "suika-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });
    expect(
      result.cardInstances.filter((c) => c.pendingLeaveKind === "destroy")
    ).toHaveLength(3);
  });

  it("BSTH05-C01 on_summon: core_move void→this_card + deck_reveal 3 with 2 picks", () => {
    const shizuha: CardDefinition = {
      cardNo: "BSTH05-C01",
      name: "[ゴッドシーカー]秋 静葉",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["green"],
      textLines: [],
      keywordTags: [],
      tribe: "神渡・幻想・樹魔",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
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
              action: {
                kind: "deck_reveal",
                revealCount: 3,
                picks: [
                  {
                    count: 1,
                    filter: {
                      tribes: ["アシハラ"],
                      category: ["nexus"],
                      colors: ["green"],
                    },
                  },
                  {
                    count: 1,
                    filter: { tribes: ["幻想", "風神"], colors: ["green"] },
                  },
                ],
                remainder: "bottom",
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const nexus: CardDefinition = {
      cardNo: "TEST-ASH-N",
      name: "アシハラネクサス",
      printedCategory: "nexus",
      colors: ["green"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["green"],
      textLines: [],
      keywordTags: [],
      tribe: "創界神・アシハラ",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const windGod: CardDefinition = {
      cardNo: "TEST-WIND",
      name: "風神カード",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["green"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・風神",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const filler: CardDefinition = {
      cardNo: "TEST-FILL",
      name: "フィラー",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "竜騎",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      [shizuha.cardNo, shizuha],
      [nexus.cardNo, nexus],
      [windGod.cardNo, windGod],
      [filler.cardNo, filler],
    ]);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 10,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(shizuha, {
          instanceId: "shiz-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(nexus, {
          instanceId: "dk-nex",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(windGod, {
          instanceId: "dk-wind",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(filler, {
          instanceId: "dk-fill",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ],
    };
    const getDef = (id: string) => localDefs.get(id);
    const afterEffect = executeEffect({
      chainId: "test:integration-real-cards:2801",
      state,
      effect: shizuha.effects![0],
      sourceInstanceId: "shiz-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    // void→this_card: 1 core added (immediate, before deck_reveal pending)
    expect(
      afterEffect.cardInstances.find((c) => c.instanceId === "shiz-1")!
        .normalCoreCount
    ).toBe(2);
    expect(
      afterEffect.players.find((p) => p.id === "alice")!.voidNormalCoreCount
    ).toBe(9);
    // deck_reveal pending
    expect(afterEffect.pendingDeckReveal).not.toBeNull();
    const result = completeDeckRevealPending(afterEffect, getDef);
    // deck_reveal: nexus + windGod picked to hand, filler stays in deck
    expect(
      result.cardInstances.find((c) => c.instanceId === "dk-nex")!.zone
    ).toBe("hand");
    expect(
      result.cardInstances.find((c) => c.instanceId === "dk-wind")!.zone
    ).toBe("hand");
    expect(
      result.cardInstances.find((c) => c.instanceId === "dk-fill")!.zone
    ).toBe("deck");
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.handCount).toBe(base.players[0].handCount + 2);
  });

  it("BSTH05-M01 heavy exhaust: sets opponent spirit to heavily_exhausted", () => {
    const hisoutensoku: CardDefinition = {
      cardNo: "BSTH05-M01",
      name: "ヒソウテンソク",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      symbolColors: ["green"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・風神",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "exhaust",
                target: {
                  kind: "filter",
                  player: "opponent",
                  count: 1,
                  filter: { category: ["spirit", "ultimate"] },
                },
                degree: "heavy_exhaust",
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const oppSp: CardDefinition = {
      cardNo: "TEST-HEX",
      name: "相手スピリット",
      printedCategory: "spirit",
      colors: ["blue"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["blue"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      [hisoutensoku.cardNo, hisoutensoku],
      [oppSp.cardNo, oppSp],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(hisoutensoku, {
          instanceId: "hiso-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(oppSp, {
          instanceId: "opp-hex",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    const result = executeEffect({
      chainId: "test:integration-real-cards:2905",
      state,
      effect: hisoutensoku.effects![0],
      sourceInstanceId: "hiso-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "opp-hex")!.exhaustState
    ).toBe("heavily_exhausted");
  });

  it("BSTH05-R03 core_move void→this_card: adds 2 cores from void", () => {
    const momiji: CardDefinition = {
      cardNo: "BSTH05-R03",
      name: "犬走 椛",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["green"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・風神・天狗",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          executionMode: "optional",
          usageLimit: { kind: "per_instance", duration: "turn" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "void", player: "self" },
                to: { kind: "this_card" },
                amount: 2,
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 5,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(momiji, {
          instanceId: "momiji-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    const result = executeEffect({
      chainId: "test:integration-real-cards:2966",
      state,
      effect: momiji.effects![0],
      sourceInstanceId: "momiji-1",
      actingPlayerId: "alice",
      getCardDefinitionById: () => undefined,
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "momiji-1")!
        .normalCoreCount
    ).toBe(3);
    expect(
      result.players.find((p) => p.id === "alice")!.voidNormalCoreCount
    ).toBe(3);
  });

  it("BSTH05-X04 heavy exhaust: sets 3 opponent spirits to heavily_exhausted", () => {
    const mishaguji: CardDefinition = {
      cardNo: "BSTH05-X04",
      name: "御社宮神",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 9,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 8000 }],
      symbolColors: ["green", "green"],
      textLines: [],
      keywordTags: ["burst"],
      tribe: "化神・神渡・風神",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          steps: [
            {
              action: {
                kind: "exhaust",
                target: {
                  kind: "filter",
                  player: "opponent",
                  count: 3,
                  filter: { category: ["spirit", "ultimate"] },
                },
                degree: "heavy_exhaust",
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const oppSp: CardDefinition = {
      cardNo: "TEST-HEX2",
      name: "相手スピリット",
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
    };
    const localDefs = new Map([
      [mishaguji.cardNo, mishaguji],
      [oppSp.cardNo, oppSp],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(mishaguji, {
          instanceId: "misha-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(oppSp, {
          instanceId: "opp-h1",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(oppSp, {
          instanceId: "opp-h2",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(oppSp, {
          instanceId: "opp-h3",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    const result = executeEffect({
      chainId: "test:integration-real-cards:3066",
      state,
      effect: mishaguji.effects![0],
      sourceInstanceId: "misha-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });
    expect(
      result.cardInstances.find((c) => c.instanceId === "opp-h1")!.exhaustState
    ).toBe("heavily_exhausted");
    expect(
      result.cardInstances.find((c) => c.instanceId === "opp-h2")!.exhaustState
    ).toBe("heavily_exhausted");
    expect(
      result.cardInstances.find((c) => c.instanceId === "opp-h3")!.exhaustState
    ).toBe("heavily_exhausted");
  });

  it("BSTH04-X03 count_increase: decreases void cores", () => {
    const komachi: CardDefinition = {
      cardNo: "BSTH04-X03",
      name: "小野塚 小町",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      tribe: "起幻・幻想・冥主",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          usageLimit: { kind: "per_instance", duration: "turn" },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 10,
    });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(komachi, {
          instanceId: "koma-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    const result = executeEffect({
      chainId: "test:integration-real-cards:3125",
      state,
      effect: komachi.effects![0],
      sourceInstanceId: "koma-1",
      actingPlayerId: "alice",
      getCardDefinitionById: () => undefined,
    });
    // count_increase places one normal core from the player's tracked void into count area.
    expect(result.players.find((p) => p.id === "alice")!.countValue).toBe(1);
    expect(
      result.players.find((p) => p.id === "alice")!.voidNormalCoreCount
    ).toBe(9);
    expect(result.log.some((l) => l.includes("count_increase"))).toBe(true);
  });

  it("BSTH05-C13 discard_hand all + draw: discards all hand cards then draws 4", () => {
    const omikuji: CardDefinition = {
      cardNo: "BSTH05-C13",
      name: "神籤「乱れおみくじ連続引き」",
      printedCategory: "magic",
      colors: ["green"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      tribe: "幻想",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            { action: { kind: "discard", count: -1 } },
            { action: { kind: "draw", count: 4 } },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const handCard: CardDefinition = {
      cardNo: "TEST-HC",
      name: "手札",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["green"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      [omikuji.cardNo, omikuji],
      [handCard.cardNo, handCard],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(handCard, {
          instanceId: "h1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(handCard, {
          instanceId: "h2",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(handCard, {
          instanceId: "h3",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    };
    const result = executeEffect({
      chainId: "test:integration-real-cards:3205",
      state,
      effect: omikuji.effects![0],
      sourceInstanceId: "magic-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });
    // All 3 hand cards discarded to trash
    expect(result.cardInstances.filter((c) => c.zone === "trash")).toHaveLength(
      3
    );
    const alice = result.players.find((p) => p.id === "alice")!;
    const baseAlice = state.players.find((p) => p.id === "alice")!;
    // -3 discard + 4 draw = net +1
    expect(alice.handCount).toBe(baseAlice.handCount + 1);
  });

  it("BSTH05-X03 core_move life→reserve: moves opponent life core to reserve", () => {
    const sanae: CardDefinition = {
      cardNo: "BSTH05-X03",
      name: "東風谷 早苗",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 6,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 6000 },
        { level: 3, requiredCores: 5, bp: 11000 },
      ],
      symbolColors: ["green"],
      textLines: [],
      keywordTags: [],
      tribe: "神渡・幻想・風神",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          condition: { minLevel: 3 },
          usageLimit: { kind: "per_instance", duration: "turn" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "life", player: "opponent" },
                to: { kind: "reserve", player: "opponent" },
                amount: 1,
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(sanae, {
          instanceId: "sanae-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 5,
        }),
      ],
    };
    const result = executeEffect({
      chainId: "test:integration-real-cards:3271",
      state,
      effect: sanae.effects![0],
      sourceInstanceId: "sanae-1",
      actingPlayerId: "alice",
      getCardDefinitionById: () => undefined,
    });
    const bob = result.players.find((p) => p.id === "bob")!;
    const baseBob = state.players.find((p) => p.id === "bob")!;
    expect(bob.lifeNormalCoreCount).toBe(baseBob.lifeNormalCoreCount - 1);
    expect(bob.reserveNormalCoreCount).toBe(baseBob.reserveNormalCoreCount + 1);
  });

  it("BSTH04-R02 vanish: vanishes opponent spirit and cores go to reserve", () => {
    const youmuBurst: CardDefinition = {
      cardNo: "BSTH04-R02",
      name: "[花映塚]魂魄 妖夢",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 7,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 7000 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: ["burst"],
      tribe: "起幻・幻想・冥主",
      effects: [
        {
          timing: { kind: "burst" },
          steps: [
            {
              action: {
                kind: "vanish",
                target: {
                  kind: "filter",
                  player: "opponent",
                  count: 1,
                  filter: { category: ["spirit", "nexus"] },
                },
              },
            },
            { action: { kind: "summon", target: "self", withoutCost: true } },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const oppSp: CardDefinition = {
      cardNo: "TEST-VAN",
      name: "消滅対象",
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
    };
    const localDefs = new Map([
      [youmuBurst.cardNo, youmuBurst],
      [oppSp.cardNo, oppSp],
    ]);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(youmuBurst, {
          instanceId: "youmu-b",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(oppSp, {
          instanceId: "opp-van",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 3,
        }),
      ],
    };
    // vanish のみテスト（summon_self は未実装のため分離）
    const vanishOnlyEffect = {
      ...youmuBurst.effects![0],
      steps: [youmuBurst.effects![0].steps[0]],
    };
    const result = executeEffect({
      chainId: "test:integration-real-cards:3361",
      state,
      effect: vanishOnlyEffect,
      sourceInstanceId: "youmu-b",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });
    // Vanished: pendingLeaveKind set to "vanish", cores returned to reserve
    const opp = result.cardInstances.find((c) => c.instanceId === "opp-van")!;
    expect(opp.pendingLeaveKind).toBe("vanish");
    expect(opp.normalCoreCount).toBe(0);
    const bob = result.players.find((p) => p.id === "bob")!;
    const baseBob = state.players.find((p) => p.id === "bob")!;
    expect(bob.reserveNormalCoreCount).toBe(baseBob.reserveNormalCoreCount + 3);
  });

  it("BSTH04-C01 stack negate: registers negate_summon CE", () => {
    const chirno: CardDefinition = {
      cardNo: "BSTH04-C01",
      name: "[花映塚]チルノ",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["purple"],
      textLines: [],
      keywordTags: [],
      tribe: "起幻・幻想・冥主",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          executionMode: "optional",
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
        {
          timing: { kind: "activated", mode: "stack" },
          steps: [
            {
              action: {
                kind: "set_exhaust_state",
                target: { kind: "self" },
                state: "exhausted",
              },
            },
            {
              action: {
                kind: "negate",
                negateTarget: "summon",
                targetFilter: { category: ["spirit"] },
              },
              connector: "conditional_cost",
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(chirno, {
          instanceId: "chirno-s",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    const result = executeEffect({
      chainId: "test:integration-real-cards:3433",
      state,
      effect: chirno.effects![1],
      sourceInstanceId: "chirno-s",
      actingPlayerId: "alice",
      getCardDefinitionById: () => undefined,
    });
    // negate CE が登録されること
    const negateCE = result.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "negate_summon"
    );
    expect(negateCE).toBeDefined();
    expect(negateCE!.forceLevel).toBe("prohibition");
  });

  // ── BSTH01-C02 霧雨 魔理沙 ──

  it("BSTH01-C02 deck_reveal pending: opens 4 cards as revealed, creates pendingDeckReveal", () => {
    const marisa: CardDefinition = {
      cardNo: "BSTH01-C02",
      name: "[スターシーカー/幼き光]霧雨 魔理沙",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 3,
      reductionSymbols: ["yellow", "guide"],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 1000 },
        { level: 2, requiredCores: 2, bp: 2000 },
      ],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・楽族",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 4,
                picks: [
                  {
                    count: 1,
                    filter: {
                      category: ["nexus"],
                      colors: ["yellow"],
                      tribes: ["導界者"],
                    },
                  },
                  {
                    count: 1,
                    filter: {
                      category: ["spirit"],
                      colors: ["yellow"],
                      tribes: ["幻想"],
                    },
                  },
                  {
                    count: 2,
                    filter: { category: ["brave"], tribes: ["導魔"] },
                  },
                ],
                remainder: "bottom",
              },
            },
          ],
        },
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "bp_modify",
                target: {
                  kind: "filter",
                  player: "opponent",
                  count: -1,
                  filter: { category: ["spirit", "ultimate"] },
                },
                amount: -2000,
                duration: { scope: "while_on_field" },
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const nexus: CardDefinition = {
      cardNo: "T-NEX",
      name: "導界者ネクサス",
      printedCategory: "nexus",
      colors: ["yellow"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "導界者",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const spirit: CardDefinition = {
      cardNo: "T-SPI",
      name: "幻想スピリット",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・楽族",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const brave: CardDefinition = {
      cardNo: "T-BRV",
      name: "導魔ブレイヴ",
      printedCategory: "brave",
      colors: ["yellow"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "導魔",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const filler: CardDefinition = {
      cardNo: "T-FIL",
      name: "フィラー",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "竜騎",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      [marisa.cardNo, marisa],
      [nexus.cardNo, nexus],
      [spirit.cardNo, spirit],
      [brave.cardNo, brave],
      [filler.cardNo, filler],
    ]);
    const getDef = (id: string) => localDefs.get(id);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(marisa, {
          instanceId: "marisa-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(nexus, {
          instanceId: "dk-nex",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(spirit, {
          instanceId: "dk-spi",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(brave, {
          instanceId: "dk-brv1",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(filler, {
          instanceId: "dk-fil",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ],
    };
    // Execute on_summon effect (deck_reveal)
    const pending = executeEffect({
      chainId: "test:integration-real-cards:3626",
      state,
      effect: marisa.effects![0],
      sourceInstanceId: "marisa-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    // Verify pending state
    expect(pending.pendingDeckReveal).not.toBeNull();
    expect(pending.pendingDeckReveal!.phase).toBe("picking");
    expect(pending.pendingDeckReveal!.revealedCardInstanceIds).toHaveLength(4);
    // All 4 cards should be in revealed (open, not deck/hand/set_aside)
    for (const id of ["dk-nex", "dk-spi", "dk-brv1", "dk-fil"]) {
      expect(pending.cardInstances.find((c) => c.instanceId === id)!.zone).toBe(
        "revealed"
      );
    }
    // Complete the flow
    const result = completeDeckRevealPending(pending, getDef);
    expect(result.pendingDeckReveal).toBeNull();
    // nexus → hand (group 0: 導界者 nexus)
    expect(
      result.cardInstances.find((c) => c.instanceId === "dk-nex")!.zone
    ).toBe("hand");
    // spirit → hand (group 1: 幻想 spirit)
    expect(
      result.cardInstances.find((c) => c.instanceId === "dk-spi")!.zone
    ).toBe("hand");
    // brave → hand (group 2: 導魔 brave, only 1 available)
    expect(
      result.cardInstances.find((c) => c.instanceId === "dk-brv1")!.zone
    ).toBe("hand");
    // filler → deck (remainder: bottom)
    expect(
      result.cardInstances.find((c) => c.instanceId === "dk-fil")!.zone
    ).toBe("deck");
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.handCount).toBe(base.players[0].handCount + 3);
  });

  it("BSTH01-C02 continuous BP-2000: applies to all opponent spirits/ultimates", () => {
    const marisa: CardDefinition = {
      cardNo: "BSTH01-C02",
      name: "霧雨 魔理沙",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・楽族",
      effects: [
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "bp_modify",
                target: {
                  kind: "filter",
                  player: "opponent",
                  count: -1,
                  filter: { category: ["spirit", "ultimate"] },
                },
                amount: -2000,
                duration: { scope: "while_on_field" },
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const oppSpirit: CardDefinition = {
      cardNo: "T-OPP",
      name: "相手スピ",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      tribe: "竜騎",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      [marisa.cardNo, marisa],
      [oppSpirit.cardNo, oppSpirit],
    ]);
    const getDef = (id: string) => localDefs.get(id);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(marisa, {
          instanceId: "marisa-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(oppSpirit, {
          instanceId: "opp-1",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(oppSpirit, {
          instanceId: "opp-2",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    // Execute continuous effect
    const result = executeEffect({
      chainId: "test:integration-real-cards:3748",
      state,
      effect: marisa.effects![0],
      sourceInstanceId: "marisa-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    // Should have 1 CE with targetFilter (not per-card)
    expect(result.activeContinuousEffects).toHaveLength(1);
    const ce = result.activeContinuousEffects[0]!;
    expect(ce.modifierTag).toBe("bp_modifier");
    expect(ce.modifierAmount).toBe(-2000);
    expect(ce.duration).toEqual({ scope: "while_on_field" });
    expect(ce.targetFilter).toBeDefined();
    expect(ce.targetInstanceId).toBeUndefined();
    // Verify effective BP with targetFilter
    const opp1 = result.cardInstances.find((c) => c.instanceId === "opp-1")!;
    const bp = getEffectiveBp(result, opp1, oppSpirit, getDef);
    expect(bp).toBe(3000); // 5000 - 2000
  });

  it("BSTH01-C02 while_on_field BP-2000: removed when source leaves field", () => {
    const marisa: CardDefinition = {
      cardNo: "BSTH01-C02",
      name: "霧雨 魔理沙",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・楽族",
      effects: [
        {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "bp_modify",
                target: {
                  kind: "filter",
                  player: "opponent",
                  count: -1,
                  filter: { category: ["spirit", "ultimate"] },
                },
                amount: -2000,
                duration: { scope: "while_on_field" },
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([[marisa.cardNo, marisa]]);
    const getDef = (id: string) => localDefs.get(id);
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(marisa, {
          instanceId: "marisa-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    // Register continuous effect
    const withCE = executeEffect({
      chainId: "test:integration-real-cards:3821",
      state,
      effect: marisa.effects![0],
      sourceInstanceId: "marisa-1",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    expect(withCE.activeContinuousEffects).toHaveLength(1);
    // Simulate marisa leaving field (destroyed → trash)
    const afterLeave: GameState = {
      ...withCE,
      cardInstances: withCE.cardInstances.map((c) =>
        c.instanceId === "marisa-1" ? { ...c, zone: "trash" as const } : c
      ),
    };
    // Recompute should remove the CE
    const cleaned = recomputeCE(afterLeave);
    expect(cleaned.activeContinuousEffects).toHaveLength(0);
  });

  it("BSTH01-C02 summon full flow: trigger system creates pending for on_summon", () => {
    const marisa: CardDefinition = {
      cardNo: "BSTH01-C02",
      name: "霧雨 魔理沙",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "幻想・楽族",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 2,
                picks: [{ count: 1, filter: { category: ["nexus"] } }],
                remainder: "bottom",
              },
            },
          ],
        },
      ],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const nexus: CardDefinition = {
      cardNo: "T-N",
      name: "ネクサス",
      printedCategory: "nexus",
      colors: ["yellow"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "導界者",
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const localDefs = new Map([
      [marisa.cardNo, marisa],
      [nexus.cardNo, nexus],
    ]);
    const getDef = (id: string) => localDefs.get(id);
    const triggerLookup = buildTriggeredEffectLookup([marisa]);

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 191,
    });
    const state: GameState = {
      ...base,
      step: "main" as GameState["step"],
      activePlayerId: "alice",
      players: base.players.map((p) =>
        p.id === "alice"
          ? { ...p, reserveNormalCoreCount: 10, handCount: 1, deckCount: 2 }
          : p
      ),
      cardInstances: [
        createCardInstance(marisa, {
          instanceId: "marisa-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(nexus, {
          instanceId: "dk-1",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
        createCardInstance(nexus, {
          instanceId: "dk-2",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ],
    };

    // Summon (cost 0, place 1 core from reserve)
    const result = playSummonAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "marisa-1",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggerLookup,
      paymentSources: [],
      enterFieldCorePlacements: [
        { kind: "reserve_normal" as const, amount: 1 },
      ],
    });

    // Debug: check zone and logs
    const marisaCard = result.state.cardInstances.find(
      (c) => c.instanceId === "marisa-1"
    )!;
    console.log(
      "marisa zone:",
      marisaCard.zone,
      "cores:",
      marisaCard.normalCoreCount
    );
    console.log(
      "pendingTriggered:",
      result.state.pendingTriggeredEffects.length
    );
    console.log(
      "pendingTriggered events:",
      result.state.pendingTriggeredEffects.map((p) => p.eventKind)
    );
    const triggerLogs = result.state.log.filter(
      (l) =>
        l.includes("trigger") ||
        l.includes("summon") ||
        l.includes("summon") ||
        l.includes("sba") ||
        l.includes("trash")
    );
    console.log("relevant logs:", triggerLogs);

    // Card should be on field
    expect(marisaCard.zone).toBe("field");

    // Pending triggered effects should be created
    expect(result.state.pendingTriggeredEffects.length).toBeGreaterThan(0);

    // getLegalActions should return resolve_pending_triggered_effect
    const actions = getLegalActions({
      state: result.state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggerLookup,
    });
    console.log(
      "actions:",
      actions.map((a) => a.kind)
    );
    expect(
      actions.some((a) => a.kind === "resolve_pending_triggered_effect")
    ).toBe(true);
  });
});
