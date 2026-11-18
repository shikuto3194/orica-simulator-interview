/**
 * ブレイヴ / アルティメットの召喚時誘発の発火に関する回帰テスト。
 *
 * 背景 (公式ルール / source-findings-official-battle-brave-burst.md):
 * - ブレイヴ召喚はスピリット召喚として扱わない。
 * - ただしブレイヴ自身の「召喚時」効果は通常召喚・直接合体の両方で発動する。
 *
 * 修正前のバグ:
 * 1. `source_kind_category_mismatch` チェックが printedCategory を素朴に sourceKind と
 *    比較していたため、ブレイヴ (printedCategory="brave") / アルティメット
 *    (printedCategory="ultimate") の誘発効果 (登録 sourceKind="spirit") が全て
 *    silent drop されていた。→ `isCategoryCompatibleWithSourceKind` で解消。
 * 2. ブレイヴ場入り時に summon イベントが発行されず、ブレイヴ自身の召喚時効果が
 *    発火しなかった。→ enter_field 検出で brave も summon イベントを発行 + 汎用
 *    responder (game_event:summon / burst:summon) は summonResponderMatchesCategoryScope で除外。
 *
 * 追加 (問題A/B): アルティメット召喚も「スピリット召喚ではない」ため、triggerFilter が
 * category を明示しない汎用 responder には反応しない。category=[ultimate]/[brave] を
 * 明示した responder のみ後段 matchesCardFilter で当該カテゴリ召喚を拾う。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src/model";
import {
  playSummonAsAction,
  getLegalActions,
  applyLegalAction,
} from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { createCardInstance, createEmptyGameState } from "../src/factories";

function makeCard(
  cardNo: string,
  printedCategory: CardDefinition["printedCategory"],
  effects: CardDefinition["effects"]
): CardDefinition {
  return {
    cardNo,
    name: `Card ${cardNo}`,
    printedCategory,
    colors: ["red"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    ...(effects ? { effects } : {}),
  };
}

const selfSummonEffect: CardDefinition["effects"] = [
  {
    timing: { kind: "card_event", event: "summon" },
    steps: [
      {
        action: {
          kind: "core_move",
          from: { kind: "void", player: "self" },
          to: { kind: "reserve", player: "self" },
          amount: 1,
        },
      },
    ],
  },
];

const genericSpiritSummonResponder: CardDefinition["effects"] = [
  {
    timing: { kind: "game_event", player: "either", event: "summon" },
    steps: [
      {
        action: {
          kind: "core_move",
          from: { kind: "void", player: "self" },
          to: { kind: "reserve", player: "self" },
          amount: 1,
        },
      },
    ],
  },
];

/** triggerFilter で category を明示した game_event:summon responder。 */
function categorySummonResponder(
  categories: CardDefinition["printedCategory"][]
): CardDefinition["effects"] {
  return [
    {
      timing: {
        kind: "game_event",
        player: "either",
        event: "summon",
        triggerFilter: { category: categories },
      },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "void", player: "self" },
            to: { kind: "reserve", player: "self" },
            amount: 1,
          },
        },
      ],
    },
  ];
}

function summonFromHand(
  def: CardDefinition,
  fieldCards: CardDefinition[] = []
) {
  const defs = [def, ...fieldCards];
  const baseState = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(def, {
        instanceId: "hand-card",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      ...fieldCards.map((fc, i) =>
        createCardInstance(fc, {
          instanceId: `field-${i}`,
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        })
      ),
    ],
    playerOverrides: [{ reserveNormalCoreCount: 3, voidNormalCoreCount: 10 }],
  });
  const state = {
    ...baseState,
    step: "main" as const,
    activePlayerId: "alice",
  };
  const lookup = (id: string) => defs.find((d) => d.cardNo === id);
  const result = playSummonAsAction({
    state,
    actingPlayerId: "alice",
    cardInstanceId: "hand-card",
    paymentSources: [{ kind: "reserve", amount: 2 }],
    enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  });
  return result.state.pendingTriggeredEffects;
}

describe("ブレイヴ / アルティメット 召喚時誘発", () => {
  it("アルティメット自身の召喚時効果が発火する (Part A: category-mismatch 解消)", () => {
    const pending = summonFromHand(
      makeCard("ULT-SELF", "ultimate", selfSummonEffect)
    );
    expect(pending.length).toBe(1);
  });

  it("ブレイヴ自身の召喚時効果が発火する (Part B: brave summon イベント発行)", () => {
    const pending = summonFromHand(
      makeCard("BRAVE-SELF", "brave", selfSummonEffect)
    );
    expect(pending.length).toBe(1);
  });

  it("汎用『スピリット召喚時』responder はスピリット召喚で発火する", () => {
    const responder = makeCard("RESP", "spirit", genericSpiritSummonResponder);
    const pending = summonFromHand(
      makeCard("SUMMONED-SPIRIT", "spirit", undefined),
      [responder]
    );
    expect(pending.length).toBe(1);
  });

  it("汎用『スピリット召喚時』responder はブレイヴ召喚では発火しない (ブレイヴ召喚 ≠ スピリット召喚)", () => {
    const responder = makeCard("RESP2", "spirit", genericSpiritSummonResponder);
    const pending = summonFromHand(
      makeCard("SUMMONED-BRAVE", "brave", undefined),
      [responder]
    );
    expect(pending.length).toBe(0);
  });

  it("ブレイヴ召喚 → 解決時に合体を選んでも、ブレイヴ自身の召喚時効果が発火する", () => {
    const braveDef = makeCard("BRAVE-COMBINE-SELF", "brave", selfSummonEffect);
    const hostDef = makeCard("COMBINE-HOST", "spirit", undefined);
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(braveDef, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(hostDef, {
          instanceId: "host-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 5, voidNormalCoreCount: 10 }],
    });
    const state: GameState = {
      ...baseState,
      step: "main",
      activePlayerId: "alice",
    };
    const defs = [braveDef, hostDef];
    const lookup = (id: string) => defs.find((d) => d.cardNo === id);
    const triggered = buildTriggeredEffectLookup(defs);
    const acts = (s: GameState, player: string) =>
      getLegalActions({
        state: s,
        actingPlayerId: player,
        getCardDefinitionById: lookup,
        getRegisteredFieldCardEffectActions: () => [],
      });

    // 召喚はコスト支払い後にスタック窓を開く (合体可否は窓より後)。
    const summon = acts(state, "alice").find(
      (a) => a.kind === "summon" && a.sourceInstanceId === "brave-1"
    );
    expect(summon).toBeDefined();
    const opened = applyLegalAction({
      state,
      action: summon!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggered,
      paymentSources: [{ kind: "reserve", amount: 2 }],
    }).state;
    expect(opened.window).toBe("stack");

    // bob パスで窓を閉じ、解決時の合体選択へ。
    const pass = acts(opened, "bob").find((a) => a.kind === "pass_stack");
    const afterPass = applyLegalAction({
      state: opened,
      action: pass!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggered,
    }).state;

    // host-1 へ合体を選択 → 場入りコア配置 (min 0) → ブレイヴ場入り。
    const combine = acts(afterPass, "alice").find(
      (a) =>
        a.kind === "resolve_brave_combine_choice" &&
        a.chosenHostInstanceId === "host-1"
    );
    expect(combine).toBeDefined();
    const afterChoice = applyLegalAction({
      state: afterPass,
      action: combine!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggered,
    }).state;
    const place = acts(afterChoice, "alice").find(
      (a) => a.kind === "resolve_pending_enter_field_placement"
    );
    expect(place).toBeDefined();
    const resolved = applyLegalAction({
      state: afterChoice,
      action: place!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggered,
      enterFieldCorePlacements: [],
    }).state;

    // ブレイヴは合体状態だが、自身の card_event:summon が誘発する。
    const queuedForBrave = resolved.log.some(
      (l) => l.startsWith("trigger:queued:") && l.includes(":summon:")
    );
    expect(queuedForBrave).toBe(true);
  });

  it("汎用『スピリット召喚時』responder はアルティメット召喚では発火しない (問題A: アルティメット召喚 ≠ スピリット召喚)", () => {
    const responder = makeCard(
      "RESP-A",
      "spirit",
      genericSpiritSummonResponder
    );
    const pending = summonFromHand(
      makeCard("SUMMONED-ULT", "ultimate", undefined),
      [responder]
    );
    expect(pending.length).toBe(0);
  });

  it("triggerFilter category=[ultimate] の responder はアルティメット召喚で発火する (問題B)", () => {
    const responder = makeCard(
      "RESP-B-ULT",
      "spirit",
      categorySummonResponder(["ultimate"])
    );
    const pending = summonFromHand(
      makeCard("SUMMONED-ULT2", "ultimate", undefined),
      [responder]
    );
    expect(pending.length).toBe(1);
  });

  it("triggerFilter category=[brave] の responder はブレイヴ召喚で発火する (問題B)", () => {
    const responder = makeCard(
      "RESP-B-BRAVE",
      "spirit",
      categorySummonResponder(["brave"])
    );
    const pending = summonFromHand(
      makeCard("SUMMONED-BRAVE2", "brave", undefined),
      [responder]
    );
    expect(pending.length).toBe(1);
  });

  it("triggerFilter category=[ultimate] の responder はスピリット召喚では発火しない", () => {
    const responder = makeCard(
      "RESP-B-ULT2",
      "spirit",
      categorySummonResponder(["ultimate"])
    );
    const pending = summonFromHand(
      makeCard("SUMMONED-SPIRIT2", "spirit", undefined),
      [responder]
    );
    expect(pending.length).toBe(0);
  });
});
