/**
 * ENGINE-paid-prevention-immunity-card-cost Step3 の fuzz/selfplay 側フォローアップ:
 * `payPreventionImmunityCost` variant は候補カード数が amount を超えるとき
 * `paidPreventionImmunityCardSelection` の明示指定を要求する。selfplay-driver の
 * `resolveActionInputs` が対応する前は、fuzz がこの variant をランダムに選ぶと
 * "explicit ... is required" で throw していた (adversarial verifier 2026-07-28 refute。
 * rules-core 側の同型テストは packages/rules-core/test/
 * paid-prevention-immunity-card-cost-legal-actions.test.ts、本テストは selfplay-driver
 * が engine 呼び出しに必要な追加入力を自動供給することを検証する)。
 */
import { describe, expect, it } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  getLegalActions,
  playSummonAsAction,
  buildTriggeredEffectLookup,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";
import { applyChosenAction, type Engine } from "./selfplay-driver";

const ALICE = "alice";
const BOB = "bob";
const CARD_COST_AMOUNT = 2;

const HOST_DEF: CardDefinition = {
  cardNo: "SPDPPI-HOST",
  name: "Selfplay Paid Prevention Host",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  tribe: "鋼騎士",
  effects: [
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "grant_paid_prevention_immunity",
            target: { kind: "self" },
            cost: {
              resource: "card",
              amount: CARD_COST_AMOUNT,
              zone: "trash",
              filter: { tribes: ["鋼騎士"] },
            },
            duration: { scope: "while_on_field" },
          },
        },
      ],
    },
    {
      timing: { kind: "card_event", event: "summon" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
      ],
    },
  ],
} as unknown as CardDefinition;

const ENEMY_DEF: CardDefinition = {
  cardNo: "SPDPPI-ENEMY",
  name: "Selfplay Enemy Spirit",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
} as unknown as CardDefinition;

const FODDER_DEF: CardDefinition = {
  cardNo: "SPDPPI-FODDER",
  name: "鋼騎士のトラッシュ要員",
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
  tribe: "鋼騎士",
} as unknown as CardDefinition;

const DEFS = [HOST_DEF, ENEMY_DEF, FODDER_DEF];
const cardNoMap = new Map(DEFS.map((d) => [d.cardNo, d]));
const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id);
const triggeredLookup = buildTriggeredEffectLookup(DEFS);
const engine: Engine = {
  cards: DEFS,
  getCardDefinitionById,
  lookups: {
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredBurstActions: () => [],
    getRegisteredBattleImmediateEffectActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredHandActivatedEffectActions: () => [],
    getRegisteredMagicActions: () => [],
  },
};

/** trash に amount+1 枚の候補 (候補数 > amount) を持つ、host 召喚直後の state。 */
function makeCandidateOverAmountState(): GameState {
  const fodderCards = Array.from({ length: CARD_COST_AMOUNT + 1 }, (_, i) =>
    createCardInstance(FODDER_DEF, {
      instanceId: `fodder-${i}`,
      ownerPlayerId: ALICE,
      zone: "trash",
    })
  );
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      createCardInstance(HOST_DEF, {
        instanceId: "host-1",
        ownerPlayerId: ALICE,
        zone: "hand",
      }),
      createCardInstance(ENEMY_DEF, {
        instanceId: "enemy-1",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
      }),
      ...fodderCards,
    ],
    playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
  });
  const withHostOnField = playSummonAsAction({
    state: { ...base, step: "main", activePlayerId: ALICE },
    actingPlayerId: ALICE,
    cardInstanceId: "host-1",
    paymentSources: [{ kind: "reserve", amount: 2 }],
    enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
  return withHostOnField;
}

describe("selfplay-driver: paid-prevention-immunity card-cost variant", () => {
  it("候補数が amount を超える variant を選んでも applyChosenAction は throw しない (payPreventionImmunityCardSelection を自動供給)", () => {
    const state = makeCandidateOverAmountState();
    const paidVariant = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        (a as { payPreventionImmunityCost?: true })
          .payPreventionImmunityCost === true
    );
    expect(paidVariant).toBeDefined();
    if (!paidVariant) throw new Error("unreachable");

    expect(() => applyChosenAction(state, paidVariant, engine)).not.toThrow();

    const result = applyChosenAction(state, paidVariant, engine);
    const removedFodder = result.cardInstances.filter(
      (c) =>
        c.definitionId === "SPDPPI-FODDER" && c.zone === "removed_from_game"
    );
    expect(removedFodder).toHaveLength(CARD_COST_AMOUNT);
  });
});
