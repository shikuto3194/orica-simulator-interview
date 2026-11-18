/**
 * ENGINE-effect-immunity-hand-zone-scope-context-gap:
 * assertMagicTargetIsAllowed (magic-system.ts) が getPreventionBlockReason を context
 * 無しで呼んでいたため、zone-scoped effect_immunity (ENGINE-effect-immunity-hand-zone-scope、
 * BSTH02.7-C03/BSDB01-C06/BSRK01-C02/BSTS01-C05 の手札/手元免疫) が
 * resolveMagicMainAndMoveToTrash 経由の相手マジック効果に対して機能しなかった
 * (adversarial verifier round2 lens2 発見、BSTH02.7-R01 レビュー中)。
 * context (actingPlayerId/effectSource/getCardDefinitionById) を配線し、
 * zone-aware な resolveCardImmunityAffect 経路を通るよう修正した。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffectImmunity,
  playMagicCardAsAction,
} from "../src/index";
import type { CardDefinition, GameState } from "../src/index";

const IMMUNITY_SOURCE: CardDefinition = {
  cardNo: "TEST-HAND-IMMUNITY-SOURCE",
  name: "手札免疫の発生源",
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const HAND_CARD: CardDefinition = {
  cardNo: "TEST-ALICE-HAND-CARD",
  name: "アリスの手札カード",
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const OPPONENT_MAGIC: CardDefinition = {
  cardNo: "TEST-BOB-TARGETING-MAGIC",
  name: "ボブの対象指定マジック",
  printedCategory: "magic",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const DEFS = new Map<string, CardDefinition>([
  [IMMUNITY_SOURCE.cardNo, IMMUNITY_SOURCE],
  [HAND_CARD.cardNo, HAND_CARD],
  [OPPONENT_MAGIC.cardNo, OPPONENT_MAGIC],
]);
const getDef = (id: string) => DEFS.get(id);

function buildState(): GameState {
  const source = createCardInstance(IMMUNITY_SOURCE, {
    instanceId: "immunity-source",
    ownerPlayerId: "alice",
    zone: "field",
  });
  const handCard = createCardInstance(HAND_CARD, {
    instanceId: "alice-hand-card",
    ownerPlayerId: "alice",
    zone: "hand",
  });
  const bobMagic = createCardInstance(OPPONENT_MAGIC, {
    instanceId: "bob-magic",
    ownerPlayerId: "bob",
    zone: "hand",
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [source, handCard, bobMagic],
  });
  // 「自分の手札は相手の効果を受けない」= zone-scoped effect_immunity
  // (target: player:self, zone:hand, count:-1, duration:while_on_field)。
  return executeEffectImmunity(
    base,
    "alice",
    {
      target: { player: "self", count: -1, zone: "hand" },
      duration: { scope: "while_on_field" },
    },
    "immunity-source",
    getDef
  );
}

describe("ENGINE-effect-immunity-hand-zone-scope-context-gap: assertMagicTargetIsAllowed の context 配線", () => {
  it("相手のマジックが免疫中の手札カードを対象にすると prevented_by_defense でブロックされる", () => {
    const state = buildState();

    expect(() =>
      playMagicCardAsAction({
        state,
        actingPlayerId: "bob",
        magicInstanceId: "bob-magic",
        targetInstanceIds: ["alice-hand-card"],
        withoutCost: true,
        paymentSources: [],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: undefined,
      })
    ).toThrow(/prevented_by_defense/);
  });

  it("自分(alice)自身のマジックは同じ手札カードを対象にしてもブロックされない (opponent-only 免疫)", () => {
    const state = buildState();
    const aliceMagic = createCardInstance(OPPONENT_MAGIC, {
      instanceId: "alice-magic",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const stateWithAliceMagic: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, aliceMagic],
    };

    expect(() =>
      playMagicCardAsAction({
        state: stateWithAliceMagic,
        actingPlayerId: "alice",
        magicInstanceId: "alice-magic",
        targetInstanceIds: ["alice-hand-card"],
        withoutCost: true,
        paymentSources: [],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: undefined,
      })
    ).not.toThrow();
  });
});
