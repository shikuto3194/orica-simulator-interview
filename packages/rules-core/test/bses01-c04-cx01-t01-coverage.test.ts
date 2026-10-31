import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
import { finishCoreChoices } from "./helpers/core-choice-driver";
/**
 * BSES01 coverage-todo 3枚変換テスト: C04 / CX01 / T01。
 *
 * C04 (軍用地図):
 *   [0] effect_immunity(self) — 相手の効果を受けない。
 *   [2,3] flash — 86ブレイヴ1枚を1コスト召喚し、同名ブレイヴ合体中の自分スピリットへ grant。
 *
 * CX01 ([白銀の契約者]ヴラディレーナ・ミリーゼ):
 *   導託 = grandwalkerData。divineSkills で契約技:2(count+2/任意ドロー/終了制限)を表現。
 *   【復活】= applicability.soulState + place(self)。
 *
 * T01 (M1A4 ジャガーノート):
 *   [6,7] アタック/ブロック時、合体中なら指揮官 導界者ネクサスにコア+1。
 */
import { describe, it, expect } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  advanceStep,
  collectGameStateInvariantIssues,
  getStrongestDefenseLevel,
} from "../src/runtime";
import type { CardDefinition, GameState } from "../src/runtime";
import type { Effect } from "../src/dsl-types";
import {
  createEmptyGameState,
  createCardInstance,
  initializeGame,
  mulliganHand,
} from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import {
  materializeDeferredTrashOptionalAdds,
  processMovedToTrashEffects,
} from "../src/effect/structured-trash-ops";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { collectTriggerEventsFromStateDelta } from "../src/effect/trigger-system";
import { generateTriggeredEffectRegistrations } from "../src/effect/structured-effect-registrations";
import { flushPendingLeaves } from "../src/state-based-actions";
import {
  checkAndQueueOracleChoices,
  checkAndQueuePlacementOracle,
  resolvePlacementOracleMechanic,
} from "../src/mechanics/oracle-system";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggerLookup = () => [];
const noBurstLookup = () => [];
const noFieldLookup = () => [];

const ALICE = "player-1";
const _BOB = "player-2";
const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

function bses01C04ImmunityEffects(state: GameState) {
  return state.activeContinuousEffects.filter(
    (effect) =>
      effect.sourceDefinitionId === "BSES01-C04" &&
      effect.modifierTag === "defense_immune" &&
      effect.provenance?.effectIndex === 0
  );
}

function expectBses01C04HandImmunityForCurrentHandOnly(
  state: GameState,
  ownerPlayerId: string
) {
  const cardsById = new Map(
    state.cardInstances.map((instance) => [instance.instanceId, instance])
  );
  const handMaps = state.cardInstances.filter(
    (instance) =>
      instance.ownerPlayerId === ownerPlayerId &&
      instance.zone === "hand" &&
      instance.definitionId === "BSES01-C04"
  );
  const effects = bses01C04ImmunityEffects(state);

  expect(handMaps.length).toBeGreaterThan(0);
  expect(effects).toHaveLength(handMaps.length);
  for (const map of handMaps) {
    expect(
      effects.some(
        (effect) =>
          effect.sourceInstanceId === map.instanceId &&
          effect.targetInstanceId === map.instanceId
      )
    ).toBe(true);
  }
  for (const effect of effects) {
    const source = cardsById.get(effect.sourceInstanceId);
    expect(source?.zone).toBe("hand");
    expect(effect.targetInstanceId).toBe(effect.sourceInstanceId);
  }
}

const HOST_DEF: CardDefinition = {
  cardNo: "BSES01-C04-HOST",
  name: "[テスト]ジャガーノート host",
  printedCategory: "spirit",
  colors: ["white"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["white"],
  textLines: [],
  keywordTags: [],
  tribe: "８６",
  sourceUrls: [],
  sourceConfidence: "C",
} as CardDefinition;

const ORACLE_BRAVE_DEF: CardDefinition = {
  cardNo: "BSES01-CX01-ORACLE-BRAVE",
  name: "[テスト]８６ブレイヴ",
  printedCategory: "brave",
  colors: ["white"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["white"],
  textLines: [],
  keywordTags: [],
  tribe: "８６",
  sourceUrls: [],
  sourceConfidence: "C",
} as CardDefinition;

const getDefWithHost = (id: string): CardDefinition | undefined =>
  id === HOST_DEF.cardNo
    ? HOST_DEF
    : id === ORACLE_BRAVE_DEF.cardNo
      ? ORACLE_BRAVE_DEF
      : getDef(id);

const triggeredLookup = (cardNo: string) => {
  const def = getDefWithHost(cardNo);
  return def ? generateTriggeredEffectRegistrations(def) : [];
};

type TestLegalAction = ReturnType<typeof getLegalActions>[number];

function legalActions(state: GameState, actingPlayerId = ALICE) {
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById: getDefWithHost,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    getRegisteredBurstActions: noBurstLookup,
    getRegisteredFieldCardEffectActions: noFieldLookup,
  } as unknown as Parameters<typeof getLegalActions>[0]);
}

function applyAction(
  state: GameState,
  action: TestLegalAction,
  extra?: Partial<Parameters<typeof applyLegalAction>[0]>
): GameState {
  return (
    applyLegalAction({
      state,
      action,
      getCardDefinitionById: getDefWithHost,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
      ...extra,
    } as unknown as Parameters<typeof applyLegalAction>[0]) as {
      state: GameState;
    }
  ).state;
}

function passStackWindows(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const responderId = current.stackWindow.priorityPlayerId;
    const pass = legalActions(current, responderId).find(
      (a) => a.kind === "pass_stack"
    );
    expect(pass, `pass_stack for ${responderId}`).toBeDefined();
    current = finishCoreChoices(applyAction(current, pass!), getDefWithHost, {
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
    });
  }
  expect(guard).toBeLessThan(10);
  return current;
}

function activateAndResolveGrantedBounce(
  state: GameState,
  sourceInstanceId: string
): GameState {
  const action = legalActions(state).find(
    (a) =>
      a.kind === "use_field_card_effect" &&
      a.sourceInstanceId === sourceInstanceId &&
      (a as { grantedEffectCeId?: string }).grantedEffectCeId !== undefined
  );
  expect(
    action,
    `BSES01-C04 granted bounce for ${sourceInstanceId}`
  ).toBeDefined();
  const afterFlush = flushPendingLeaves(
    passStackWindows(applyAction(state, action!)),
    getDefWithHost
  );
  if (afterFlush.pendingBraveLeaveChoice === null) return afterFlush;
  const keepBrave = legalActions(
    afterFlush,
    afterFlush.pendingBraveLeaveChoice.choosingPlayerId
  ).find(
    (candidate) =>
      candidate.kind === "resolve_brave_leave_choice" &&
      candidate.choice === "keep"
  );
  expect(keepBrave).toBeDefined();
  return applyAction(afterFlush, keepBrave!);
}

// ============================================================
// BSES01-C04 軍用地図
// ============================================================
describe("BSES01-C04 軍用地図", () => {
  const c04 = card("BSES01-C04");

  it("effects 配列が定義されている", () => {
    expect(c04.effects).toBeDefined();
    expect(c04.effects!.length).toBeGreaterThanOrEqual(2);
  });

  it("[0] 公開/使用中 zone 束縛の effect_immunity(self) と revealed/trash blocked disposition を持つ", () => {
    const eff = c04.effects![0]!;
    expect(eff.timing).toEqual({ kind: "continuous" });
    expect(eff.applicability).toEqual({
      zone: ["hand", "set_aside", "in_use", "trash", "field"],
    });
    expect(eff.stub).toBeUndefined();
    expect(eff.steps[0]!.action).toEqual({
      kind: "effect_immunity",
      target: { kind: "self" },
      duration: { scope: "permanent" },
    });

    const revealedBlock = c04.effects!.find(
      (effect) =>
        effect.timing.kind === "card_event" &&
        effect.timing.event === "revealed"
    );
    expect(revealedBlock).toBeDefined();
    expect(revealedBlock!.cardEventDisposition).toEqual({ kind: "blocked" });
    expect(revealedBlock!.stub).toBeUndefined();

    const trashBlock = c04.effects!.find(
      (effect) =>
        effect.timing.kind === "card_event" &&
        effect.timing.event === "moved_to_trash"
    );
    expect(trashBlock).toBeDefined();
    expect(trashBlock!.cardEventDisposition).toEqual({ kind: "blocked" });
    expect(trashBlock!.stub).toBeUndefined();
  });

  it("[2,3] flash summon 86ブレイヴ from hand/手元 at cost 1 and grants同名合体スピリット", () => {
    const eff = c04.effects![1]!;
    expect(eff.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(eff.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    expect(eff.executionMode).toBe("optional");
    expect(eff.stub).toBeUndefined();
    const action = eff.steps[0]!.action;
    expect(eff.steps[0]!.id).toBe("summon-86-brave");
    expect(action.kind).toBe("summon");
    if (action.kind === "summon" && action.target.kind === "from_zone") {
      expect(action.target.zone).toEqual(["hand", "set_aside"]);
      expect(action.target.filter?.category).toEqual(["brave"]);
      expect(action.target.filter?.tribes).toEqual(["８６"]);
      expect(action.target.count).toBe(1);
      expect(action.costModifier).toEqual({ fixedPayment: 1 });
      expect(action).not.toHaveProperty(
        "resolveSummonedBraveForcedTokenCombine"
      );
    }
    const blockAction = eff.steps[1]!.action;
    expect(eff.steps[1]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "summon-86-brave",
    });
    expect(blockAction.kind).toBe("block_unblockable");
    if (blockAction.kind === "block_unblockable") {
      expect(blockAction.duration).toEqual({
        scope: "step",
        step: "start",
        whose: "self",
      });
      if (blockAction.target.kind === "filter") {
        expect(blockAction.target.filter.attachedBrave?.cardName).toEqual({
          kind: "from_step_ref",
          stepId: "summon-86-brave",
        });
      }
    }
    expect(eff.steps[2]!.prompt).toEqual({
      sourceText:
        "このスピリットは「ブロックされない」相手のスピリット/アルティメットをブロックできる。さらに、〔ターンに1回：同名〕フラッシュタイミングでこのスピリットは手札に戻せる。",
    });
    const grantAction = eff.steps[2]!.action;
    expect(grantAction.kind).toBe("grant_effect");
    if (grantAction.kind === "grant_effect") {
      expect(grantAction.grantedEffect?.timing).toEqual({
        kind: "activated",
        mode: "flash",
      });
      expect(grantAction.grantedEffect?.activationLabel).toBe("none");
      expect(grantAction.grantedEffect?.usageLimit).toEqual({
        kind: "per_card_name",
        duration: "turn",
        maxCount: 1,
      });
      expect(grantAction.grantedEffect?.steps[0]?.action.kind).toBe("bounce");
    }
  });

  it("[board] BSES01-C04 は hand/set_aside/in_use/trash/field で相手効果への defense_immune CE を登録し、deck へ広がらない", () => {
    for (const zone of [
      "hand",
      "set_aside",
      "in_use",
      "trash",
      "field",
    ] as const) {
      const map = createCardInstance(c04, {
        instanceId: `map-${zone}`,
        ownerPlayerId: ALICE,
        zone,
      });
      const state = createEmptyGameState({
        playerIds: [ALICE, _BOB],
        cardInstances: [map],
      });
      const rebuilt = rebuildContinuousEffectsFromField(state, getDef);
      const ce = rebuilt.activeContinuousEffects.find(
        (effect) =>
          effect.modifierTag === "defense_immune" &&
          effect.targetInstanceId === `map-${zone}`
      );
      expect(ce, `BSES01-C04 ${zone} immunity CE`).toBeDefined();
      expect(ce!.sourceInstanceId).toBe(`map-${zone}`);
      expect(getStrongestDefenseLevel(rebuilt, `map-${zone}`)).toBe("immune");

      const recomputed = recomputeContinuousEffects(rebuilt);
      expect(
        recomputed.activeContinuousEffects.some(
          (effect) =>
            effect.effectId === ce!.effectId &&
            effect.modifierTag === "defense_immune" &&
            effect.targetInstanceId === `map-${zone}`
        ),
        `BSES01-C04 ${zone} immunity survives recompute`
      ).toBe(true);
    }
    const deckMap = createCardInstance(c04, {
      instanceId: "map-deck",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const deckState = createEmptyGameState({
      playerIds: [ALICE, _BOB],
      cardInstances: [deckMap],
    });
    const rebuiltDeck = rebuildContinuousEffectsFromField(deckState, getDef);
    expect(
      rebuiltDeck.activeContinuousEffects.some(
        (effect) =>
          effect.modifierTag === "defense_immune" &&
          effect.targetInstanceId === "map-deck"
      )
    ).toBe(false);
    expect(getStrongestDefenseLevel(rebuiltDeck, "map-deck")).toBe("none");
  });

  it("[engine] 初期手札とマリガン後の BSES01-C04 は continuous invariant を満たす", () => {
    const filler = card("BSES01-C01");
    const aliceDeck = Array.from({ length: 40 }, () => c04);
    const bobDeck = Array.from({ length: 40 }, () => filler);

    const started = initializeGame({
      decks: [aliceDeck, bobDeck],
      allowUnavailableDeckCards: true,
    });

    expectBses01C04HandImmunityForCurrentHandOnly(started, "alice");
    expect(
      collectGameStateInvariantIssues(started, {
        getCardDefinitionById: getDef,
      })
    ).toEqual([]);

    const afterMulligan = mulliganHand(started, "alice", getDef);
    expectBses01C04HandImmunityForCurrentHandOnly(afterMulligan, "alice");
    expect(
      collectGameStateInvariantIssues(afterMulligan, {
        getCardDefinitionById: getDef,
      })
    ).toEqual([]);
  });

  it("[engine] 通常ドローで手札に入った BSES01-C04 は continuous invariant を満たす", () => {
    const before = {
      ...createEmptyGameState({
        playerIds: [ALICE, _BOB],
        startingDeckCount: 0,
        cardInstances: [
          createCardInstance(c04, {
            instanceId: "normal-draw-map",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "deck",
          }),
          createCardInstance(card("BSES01-C01"), {
            instanceId: "normal-draw-filler",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "deck",
          }),
        ],
        playerOverrides: [{ deckCount: 2, handCount: 0 }, {}],
      }),
      activePlayerId: ALICE,
      turnNumber: 2,
      step: "core" as const,
    };

    expect(bses01C04ImmunityEffects(before)).toHaveLength(0);

    const after = advanceStep(before, getDef, noTriggerLookup, noBurstLookup);

    expect(after.step).toBe("draw");
    expect(
      after.cardInstances.find((card) => card.instanceId === "normal-draw-map")
        ?.zone
    ).toBe("hand");
    expectBses01C04HandImmunityForCurrentHandOnly(after, ALICE);
    expect(
      collectGameStateInvariantIssues(after, {
        getCardDefinitionById: getDef,
      })
    ).toEqual([]);
  });

  it("[engine] 効果ドローで手札に入った BSES01-C04 は continuous invariant を満たす", () => {
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    };
    const before = {
      ...createEmptyGameState({
        playerIds: [ALICE, _BOB],
        startingDeckCount: 0,
        cardInstances: [
          createCardInstance(card("BSES01-C01"), {
            instanceId: "effect-draw-source",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "field",
          }),
          createCardInstance(c04, {
            instanceId: "effect-draw-map",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "deck",
          }),
        ],
        playerOverrides: [{ deckCount: 1, handCount: 0 }, {}],
      }),
      activePlayerId: ALICE,
      turnNumber: 2,
      step: "main" as const,
    };

    expect(bses01C04ImmunityEffects(before)).toHaveLength(0);

    const after = executeEffect({
      chainId: "test:bses01-c04-cx01-t01-coverage:472",
      state: before,
      effect,
      sourceInstanceId: "effect-draw-source",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    expect(
      after.cardInstances.find((card) => card.instanceId === "effect-draw-map")
        ?.zone
    ).toBe("hand");
    expectBses01C04HandImmunityForCurrentHandOnly(after, ALICE);
    expect(
      collectGameStateInvariantIssues(after, {
        getCardDefinitionById: getDef,
      })
    ).toEqual([]);
  });

  it("[engine] search_deck 選択解決で手札に入った BSES01-C04 は continuous invariant を満たす", () => {
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "search_zone",
            zone: "deck",
            player: "self",
            count: 1,
            destination: "hand",
          },
        },
      ],
    };
    const before = {
      ...createEmptyGameState({
        playerIds: [ALICE, _BOB],
        startingDeckCount: 0,
        cardInstances: [
          createCardInstance(card("BSES01-C01"), {
            instanceId: "search-source",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "field",
          }),
          createCardInstance(c04, {
            instanceId: "search-map-a",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "deck",
          }),
          createCardInstance(c04, {
            instanceId: "search-map-b",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "deck",
          }),
        ],
        playerOverrides: [{ deckCount: 2, handCount: 0 }, {}],
      }),
      activePlayerId: ALICE,
      turnNumber: 2,
      step: "main" as const,
    };

    const pendingState = executeEffect({
      chainId: "test:bses01-c04-cx01-t01-coverage:539",
      state: before,
      effect,
      sourceInstanceId: "search-source",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const pending = pendingState.pendingZoneSelection!;
    expect(pending).not.toBeNull();
    expect(pending.actionKind).toBe("search_deck");

    const after = (
      applyLegalAction({
        state: pendingState,
        action: {
          kind: "resolve_pending_zone_selection",
          actionId: `zs-${pending.actionKind}`,
          can: true,
          reason: "test",
          actingPlayerId: pending.actingPlayerId,
          pendingId: pending.pendingId,
          actionKind: pending.actionKind,
          candidateCardInstanceIds: pending.candidateCardInstanceIds,
          maxCount: pending.maxCount,
          canSkip: pending.canSkip ?? true,
        },
        selectedZoneCardIds: ["search-map-a"],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        getRegisteredBurstActions: noBurstLookup,
      } as unknown as Parameters<typeof applyLegalAction>[0]) as {
        state: GameState;
      }
    ).state;

    expect(
      after.cardInstances.find((card) => card.instanceId === "search-map-a")
        ?.zone
    ).toBe("hand");
    expectBses01C04HandImmunityForCurrentHandOnly(after, ALICE);
    expect(
      collectGameStateInvariantIssues(after, {
        getCardDefinitionById: getDef,
      })
    ).toEqual([]);
  });

  it("[engine] in_use の extra-zone 登録は self effect_immunity だけの continuous effect に限定する", () => {
    const mixedDef: CardDefinition = {
      cardNo: "BSES01-C04-MIXED-IN-USE-GUARD",
      name: "[テスト] in_use 混在継続効果",
      printedCategory: "magic",
      colors: ["white"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [
        "このカードは相手の効果を受けない。このターンの間、自分はライフを減らされない。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "continuous" },
          applicability: { zone: "in_use" },
          steps: [
            {
              action: {
                kind: "effect_immunity",
                target: { kind: "self" },
                duration: { scope: "permanent" },
              },
            },
            {
              action: {
                kind: "prevent_life_damage",
                player: "self",
                duration: { scope: "turn" },
              },
            },
          ],
          textRef: [0],
        },
      ],
    } as CardDefinition;
    const source = createCardInstance(mixedDef, {
      instanceId: "mixed-in-use",
      ownerPlayerId: ALICE,
      zone: "in_use",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, _BOB],
      cardInstances: [source],
    });
    const rebuilt = rebuildContinuousEffectsFromField(state, (id) =>
      id === mixedDef.cardNo ? mixedDef : getDef(id)
    );

    expect(rebuilt.activeContinuousEffects).toHaveLength(0);
    expect(getStrongestDefenseLevel(rebuilt, "mixed-in-use")).toBe("none");
  });

  it("[board] BSES01-C04 はデッキからオープンされても手札追加 pick 候補にならない", () => {
    const sourceDef: CardDefinition = {
      cardNo: "BSES01-C04-REVEAL-SRC",
      name: "[テスト]デッキオープン源",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["white"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 1,
                picks: [
                  {
                    count: 1,
                    filter: { category: ["magic"] },
                    destination: "hand",
                  },
                ],
                remainder: "bottom",
              },
            },
          ],
        },
      ],
    };
    const source = createCardInstance(sourceDef, {
      instanceId: "reveal-src",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const map = createCardInstance(c04, {
      instanceId: "map-deck",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const defs = (id: string) =>
      id === sourceDef.cardNo ? sourceDef : getDef(id);
    const state = createEmptyGameState({
      playerIds: [ALICE, _BOB],
      cardInstances: [source, map],
      playerOverrides: [{ deckCount: 1 }, {}],
    });

    const afterReveal = executeEffect({
      chainId: "test:bses01-c04-cx01-t01-coverage:698",
      state,
      effect: sourceDef.effects![0]!,
      sourceInstanceId: "reveal-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: defs,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    expect(afterReveal.pendingDeckReveal?.phase).toBe("picking");
    expect(
      afterReveal.pendingDeckReveal?.revealedDispositionMap?.["map-deck"]
    ).toEqual({ kind: "blocked" });
    const pickAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById: defs,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();
    expect(pickAction!.candidateCardInstanceIds).not.toContain("map-deck");
    const handCountBeforePick = alice(afterReveal).handCount;
    const afterSkip = applyLegalAction({
      state: afterReveal,
      action: pickAction!,
      getCardDefinitionById: defs,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      selectedDeckRevealCardIds: [],
    }).state;

    expect(afterSkip.pendingDeckReveal).toBeNull();
    expect(
      afterSkip.cardInstances.find((c) => c.instanceId === "map-deck")?.zone
    ).toBe("trash");
    expect(alice(afterSkip).handCount).toBe(handCountBeforePick);
    expect(alice(afterSkip).deckCount).toBe(0);

    expect(() =>
      applyLegalAction({
        state: afterReveal,
        action: pickAction!,
        getCardDefinitionById: defs,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
        selectedDeckRevealCardIds: ["map-deck"],
      })
    ).toThrow(
      /Invalid deck reveal revealed choice candidate|Invalid deck reveal pick candidate/
    );
  });

  it("[board] BSES01-C04 の blocked disposition は field pick までは除外しない", () => {
    const sourceDef: CardDefinition = {
      cardNo: "BSES01-C04-REVEAL-FIELD-SRC",
      name: "[テスト]デッキオープン field pick 源",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["white"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 1,
                picks: [
                  {
                    count: 1,
                    filter: { category: ["magic"] },
                    destination: "field",
                  },
                ],
                remainder: "bottom",
              },
            },
          ],
        },
      ],
    };
    const source = createCardInstance(sourceDef, {
      instanceId: "reveal-field-src",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const map = createCardInstance(c04, {
      instanceId: "map-field-deck",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const defs = (id: string) =>
      id === sourceDef.cardNo ? sourceDef : getDef(id);

    const afterReveal = executeEffect({
      chainId: "test:bses01-c04-cx01-t01-coverage:797",
      state: createEmptyGameState({
        playerIds: [ALICE, _BOB],
        cardInstances: [source, map],
        playerOverrides: [{ deckCount: 1 }, {}],
      }),
      effect: sourceDef.effects![0]!,
      sourceInstanceId: "reveal-field-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: defs,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    expect(afterReveal.pendingDeckReveal?.phase).toBe("picking");
    expect(
      afterReveal.pendingDeckReveal?.revealedDispositionMap?.["map-field-deck"]
    ).toEqual({ kind: "blocked" });
    const pickAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById: defs,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();
    expect(pickAction!.candidateCardInstanceIds).toContain("map-field-deck");
    const handCountBeforePick = alice(afterReveal).handCount;

    const afterPick = applyLegalAction({
      state: afterReveal,
      action: pickAction!,
      getCardDefinitionById: defs,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      selectedDeckRevealCardIds: ["map-field-deck"],
    }).state;

    expect(afterPick.pendingDeckReveal).toBeNull();
    expect(
      afterPick.cardInstances.find((c) => c.instanceId === "map-field-deck")
        ?.zone
    ).toBe("field");
    expect(alice(afterPick).handCount).toBe(handCountBeforePick);
  });

  it("[board] BSES01-C04 の blocked disposition は revealed_choice 後の pick 候補にも残る", () => {
    const optional = card("BSES01-C01");
    const sourceDef: CardDefinition = {
      cardNo: "BSES01-C04-REVEAL-CHOICE-SRC",
      name: "[テスト]revealed choice 経由オープン源",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["white"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 2,
                picks: [
                  {
                    count: 1,
                    filter: { category: ["magic"] },
                    destination: "hand",
                  },
                ],
                remainder: "bottom",
              },
            },
          ],
        },
      ],
    };
    const source = createCardInstance(sourceDef, {
      instanceId: "reveal-choice-src",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const optionalCard = createCardInstance(optional, {
      instanceId: "optional-deck",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const map = createCardInstance(c04, {
      instanceId: "map-choice-deck",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const defs = (id: string) =>
      id === sourceDef.cardNo ? sourceDef : getDef(id);
    const afterReveal = executeEffect({
      chainId: "test:bses01-c04-cx01-t01-coverage:894",
      state: createEmptyGameState({
        playerIds: [ALICE, _BOB],
        cardInstances: [source, optionalCard, map],
        playerOverrides: [{ deckCount: 2 }, {}],
      }),
      effect: sourceDef.effects![0]!,
      sourceInstanceId: "reveal-choice-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: defs,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    expect(afterReveal.pendingDeckReveal?.phase).toBe("revealed_choice");
    expect(
      afterReveal.pendingDeckReveal?.revealedAutoAddCandidateIds
    ).toContain("optional-deck");
    expect(
      afterReveal.pendingDeckReveal?.revealedDispositionMap?.["map-choice-deck"]
    ).toEqual({ kind: "blocked" });

    const choiceAction = getLegalActions({
      state: afterReveal,
      actingPlayerId: ALICE,
      getCardDefinitionById: defs,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(choiceAction).toBeDefined();
    expect(choiceAction!.candidateCardInstanceIds).not.toContain(
      "map-choice-deck"
    );

    const afterChoice = applyLegalAction({
      state: afterReveal,
      action: choiceAction!,
      getCardDefinitionById: defs,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      selectedDeckRevealCardIds: [],
    }).state;
    expect(afterChoice.pendingDeckReveal?.phase).toBe("picking");
    expect(
      afterChoice.pendingDeckReveal?.revealedDispositionMap?.["map-choice-deck"]
    ).toEqual({ kind: "blocked" });

    const pickAction = getLegalActions({
      state: afterChoice,
      actingPlayerId: ALICE,
      getCardDefinitionById: defs,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
    expect(pickAction).toBeDefined();
    expect(pickAction!.candidateCardInstanceIds).not.toContain(
      "map-choice-deck"
    );
    expect(pickAction!.candidateCardInstanceIds).toContain("optional-deck");
  });

  it("[board] BSES01-C04 はトラッシュに置かれても任意手札追加/入れ替え pending を生成しない", () => {
    const map = createCardInstance(c04, {
      instanceId: "map-trash",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, _BOB],
      cardInstances: [map],
    });
    const afterTrash = processMovedToTrashEffects(
      state,
      ["map-trash"],
      getDef,
      {
        sourceColors: ["white"],
        sourceTribes: [],
        sourcePlayerId: ALICE,
        fromZone: "deck",
      }
    );
    const materialized = materializeDeferredTrashOptionalAdds(afterTrash);

    expect(materialized.pendingTrashOptionalAdds).toHaveLength(0);
    expect(materialized.pendingDeckReveal).toBeNull();
    expect(
      materialized.cardInstances.find((card) => card.instanceId === "map-trash")
        ?.zone
    ).toBe("trash");
  });

  it("[board] BSES01-C04 はトラッシュ滞在中の search_zone 手札追加候補にならない", () => {
    const sourceDef: CardDefinition = {
      cardNo: "BSES01-C04-TRASH-HAND-SRC",
      name: "[テスト]トラッシュ手札回収源",
      printedCategory: "magic",
      colors: ["white"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "search_zone",
                zone: "trash",
                player: "self",
                count: 1,
                filter: { category: ["magic"] },
                destination: "hand",
              },
            },
          ],
        },
      ],
    };
    const source = createCardInstance(sourceDef, {
      instanceId: "trash-hand-src",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const map = createCardInstance(c04, {
      instanceId: "map-trash-hand",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const defs = (id: string) =>
      id === sourceDef.cardNo ? sourceDef : getDef(id);

    const afterSearch = executeEffect({
      chainId: "test:bses01-c04-cx01-t01-coverage:1027",
      state: createEmptyGameState({
        playerIds: [ALICE, _BOB],
        cardInstances: [source, map],
      }),
      effect: sourceDef.effects![0]!,
      sourceInstanceId: "trash-hand-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: defs,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    expect(afterSearch.pendingZoneSelection).toBeNull();
    expect(
      afterSearch.cardInstances.find(
        (card) => card.instanceId === map.instanceId
      )?.zone
    ).toBe("trash");
  });

  it("[board] BSES01-C04 は hand+trash 複合 search_zone の手札追加候補にもならない", () => {
    const sourceDef: CardDefinition = {
      cardNo: "BSES01-C04-HAND-TRASH-HAND-SRC",
      name: "[テスト]手札トラッシュ手札回収源",
      printedCategory: "magic",
      colors: ["white"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "search_zone",
                zone: ["hand", "trash"],
                player: "self",
                count: 1,
                filter: { category: ["magic"] },
                destination: "hand",
              },
            },
          ],
        },
      ],
    };
    const source = createCardInstance(sourceDef, {
      instanceId: "hand-trash-hand-src",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const map = createCardInstance(c04, {
      instanceId: "map-hand-trash-hand",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const defs = (id: string) =>
      id === sourceDef.cardNo ? sourceDef : getDef(id);

    const afterSearch = executeEffect({
      chainId: "test:bses01-c04-cx01-t01-coverage:1092",
      state: createEmptyGameState({
        playerIds: [ALICE, _BOB],
        cardInstances: [source, map],
      }),
      effect: sourceDef.effects![0]!,
      sourceInstanceId: "hand-trash-hand-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: defs,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    expect(afterSearch.pendingZoneSelection).toBeNull();
    expect(
      afterSearch.cardInstances.find(
        (card) => card.instanceId === map.instanceId
      )?.zone
    ).toBe("trash");
  });

  it("[board] BSES01-C04 はトラッシュ滞在中の hand-trash swap incoming 候補にならない", () => {
    const sourceDef: CardDefinition = {
      cardNo: "BSES01-C04-TRASH-SWAP-SRC",
      name: "[テスト]手札トラッシュ入替源",
      printedCategory: "magic",
      colors: ["white"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "queue_hand_trash_swap",
                outgoingFilter: {},
                outgoingZones: ["hand"],
                incomingFilter: { category: ["magic"] },
              },
            },
          ],
        },
      ],
    };
    const handCardDef: CardDefinition = {
      cardNo: "BSES01-C04-HAND-SWAP-COST",
      name: "[テスト]入替手札候補",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["white"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const source = createCardInstance(sourceDef, {
      instanceId: "trash-swap-src",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const handCard = createCardInstance(handCardDef, {
      instanceId: "swap-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const map = createCardInstance(c04, {
      instanceId: "map-trash-swap",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const defs = (id: string) =>
      id === sourceDef.cardNo
        ? sourceDef
        : id === handCardDef.cardNo
          ? handCardDef
          : getDef(id);

    const afterQueue = executeEffect({
      chainId: "test:bses01-c04-cx01-t01-coverage:1178",
      state: createEmptyGameState({
        playerIds: [ALICE, _BOB],
        cardInstances: [source, handCard, map],
      }),
      effect: sourceDef.effects![0]!,
      sourceInstanceId: "trash-swap-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: defs,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    expect(afterQueue.pendingHandTrashSwapChoice).toBeNull();
    expect(
      afterQueue.cardInstances.find(
        (card) => card.instanceId === map.instanceId
      )?.zone
    ).toBe("trash");
  });

  it("[board] BSES01-C04 は set_aside-trash swap incoming 候補にもならない", () => {
    const sourceDef: CardDefinition = {
      cardNo: "BSES01-C04-TRASH-SET-ASIDE-SWAP-SRC",
      name: "[テスト]手元トラッシュ入替源",
      printedCategory: "magic",
      colors: ["white"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "queue_hand_trash_swap",
                outgoingFilter: {},
                outgoingZones: ["set_aside"],
                incomingFilter: { category: ["magic"] },
              },
            },
          ],
        },
      ],
    };
    const setAsideDef: CardDefinition = {
      cardNo: "BSES01-C04-SET-ASIDE-SWAP-COST",
      name: "[テスト]入替手元候補",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["white"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const source = createCardInstance(sourceDef, {
      instanceId: "trash-set-aside-swap-src",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const setAsideCard = createCardInstance(setAsideDef, {
      instanceId: "swap-set-aside",
      ownerPlayerId: ALICE,
      zone: "set_aside",
    });
    const map = createCardInstance(c04, {
      instanceId: "map-trash-set-aside-swap",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const defs = (id: string) =>
      id === sourceDef.cardNo
        ? sourceDef
        : id === setAsideDef.cardNo
          ? setAsideDef
          : getDef(id);

    const afterQueue = executeEffect({
      chainId: "test:bses01-c04-cx01-t01-coverage:1264",
      state: createEmptyGameState({
        playerIds: [ALICE, _BOB],
        cardInstances: [source, setAsideCard, map],
      }),
      effect: sourceDef.effects![0]!,
      sourceInstanceId: "trash-set-aside-swap-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: defs,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    expect(afterQueue.pendingHandTrashSwapChoice).toBeNull();
    expect(
      afterQueue.cardInstances.find(
        (card) => card.instanceId === map.instanceId
      )?.zone
    ).toBe("trash");
  });

  it("[board] BSES01-C04 は stale な set_aside swap apply 再検証でも incoming 不可", () => {
    const sourceDef: CardDefinition = {
      cardNo: "BSES01-C04-STALE-SET-ASIDE-SWAP-SRC",
      name: "[テスト]stale 手元トラッシュ入替源",
      printedCategory: "magic",
      colors: ["white"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const setAsideDef: CardDefinition = {
      cardNo: "BSES01-C04-STALE-SET-ASIDE-SWAP-COST",
      name: "[テスト]stale 入替手元候補",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["white"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const source = createCardInstance(sourceDef, {
      instanceId: "stale-swap-src",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const setAsideCard = createCardInstance(setAsideDef, {
      instanceId: "stale-swap-set-aside",
      ownerPlayerId: ALICE,
      zone: "set_aside",
    });
    const map = createCardInstance(c04, {
      instanceId: "stale-map-trash-set-aside-swap",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const defs = (id: string) =>
      id === sourceDef.cardNo
        ? sourceDef
        : id === setAsideDef.cardNo
          ? setAsideDef
          : getDef(id);
    const state = createEmptyGameState({
      playerIds: [ALICE, _BOB],
      cardInstances: [source, setAsideCard, map],
    });
    const staleState: GameState = {
      ...state,
      pendingHandTrashSwapChoice: {
        chainId: "test:stale-swap",
        pendingId: "stale-swap",
        actingPlayerId: ALICE,
        sourceInstanceId: "stale-swap-src",
        sourceDefinitionId: sourceDef.cardNo,
        outgoingCandidateInstanceIds: ["stale-swap-set-aside"],
        outgoingZones: ["set_aside"],
        incomingCandidateInstanceIds: ["stale-map-trash-set-aside-swap"],
      },
    };

    expect(() =>
      applyLegalAction({
        state: staleState,
        action: {
          kind: "swap_hand_trash",
          actionId: "stale-swap-action",
          can: true,
          reason: "test stale apply revalidation",
          actingPlayerId: ALICE,
          pendingId: "stale-swap",
          sourceInstanceId: "stale-swap-src",
          sourceCardNo: sourceDef.cardNo,
          outgoingCardInstanceId: "stale-swap-set-aside",
          outgoingCardNo: setAsideDef.cardNo,
          incomingCardInstanceId: "stale-map-trash-set-aside-swap",
          incomingCardNo: "BSES01-C04",
        },
        getCardDefinitionById: defs,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      })
    ).toThrow(/incoming blocked by resistance/);
  });

  it("[board] BSES01-C04 は召喚したカードと同名ブレイヴ合体中の自分スピリットだけに block_unblockable と自己バウンスを与える", () => {
    const effect = c04.effects![1]!;
    const c05 = card("BSES01-C05");
    const c06 = card("BSES01-C06");
    const t01 = card("BSES01-T01");
    const source = createCardInstance(c04, {
      instanceId: "bses01-c04-src",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const summoned = createCardInstance(c05, {
      instanceId: "bses01-c04-summoned-c05",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const matchingHost = createCardInstance(HOST_DEF, {
      instanceId: "bses01-c04-host-match",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["bses01-c04-attached-c05"],
    });
    const matchingBrave = createCardInstance(c05, {
      instanceId: "bses01-c04-attached-c05",
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "bses01-c04-host-match",
    });
    const matchingHostSameName = createCardInstance(HOST_DEF, {
      instanceId: "bses01-c04-host-same-name",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["bses01-c04-attached-c05-same-name"],
    });
    const matchingBraveSameName = createCardInstance(c05, {
      instanceId: "bses01-c04-attached-c05-same-name",
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "bses01-c04-host-same-name",
    });
    const otherHost = createCardInstance(HOST_DEF, {
      instanceId: "bses01-c04-host-other",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["bses01-c04-attached-c06"],
    });
    const otherBrave = createCardInstance(c06, {
      instanceId: "bses01-c04-attached-c06",
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "bses01-c04-host-other",
    });
    const before = {
      ...createEmptyGameState({
        playerIds: [ALICE, _BOB],
        cardInstances: [
          source,
          summoned,
          matchingHost,
          matchingBrave,
          matchingHostSameName,
          matchingBraveSameName,
          otherHost,
          otherBrave,
        ],
        playerOverrides: [
          { countValue: 4, reserveNormalCoreCount: 5, trashNormalCoreCount: 0 },
          {},
        ],
      }),
      activePlayerId: ALICE,
      step: "main" as const,
    };

    const after = executeEffectWithChosenMinimumCores({
      chainId: "test:bses01-c04-cx01-t01-coverage:1450",
      state: before,
      effect,
      sourceInstanceId: "bses01-c04-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithHost,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: ["bses01-c04-summoned-c05"],
    });

    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "bses01-c04-summoned-c05"
      )?.zone
    ).toBe("field");
    const token = after.cardInstances.find(
      (c) => c.definitionId === t01.cardNo && c.ownerPlayerId === ALICE
    );
    expect(token).toBeDefined();
    const blockTargets = after.activeContinuousEffects
      .filter((ce) => ce.modifierTag === "block_unblockable")
      .map((ce) => ce.targetInstanceId)
      .sort();
    expect(blockTargets).toEqual(
      [
        "bses01-c04-host-match",
        "bses01-c04-host-same-name",
        token!.instanceId,
      ].sort()
    );
    const grantTargets = after.activeContinuousEffects
      .filter((ce) => ce.modifierTag === "granted_effect")
      .map((ce) => ce.targetInstanceId)
      .sort();
    expect(grantTargets).toEqual(
      [
        "bses01-c04-host-match",
        "bses01-c04-host-same-name",
        token!.instanceId,
      ].sort()
    );

    const bounced = activateAndResolveGrantedBounce(
      after,
      "bses01-c04-host-match"
    );
    expect(
      bounced.cardInstances.find(
        (c) => c.instanceId === "bses01-c04-host-match"
      )?.zone
    ).toBe("hand");
    expect(
      bounced.cardInstances.find(
        (c) => c.instanceId === "bses01-c04-host-other"
      )?.zone
    ).toBe("field");
    expect(
      legalActions(bounced).some(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceInstanceId === "bses01-c04-host-same-name" &&
          (action as { grantedEffectCeId?: string }).grantedEffectCeId !==
            undefined
      ),
      "the quoted per-card-name limit is shared by the two same-name recipients"
    ).toBe(false);
  });

  it("[board] ref_has_match から attachedBrave.cardName:from_step_ref を評価できる", () => {
    const c05 = card("BSES01-C05");
    const source = createCardInstance(c04, {
      instanceId: "bses01-c04-ref-src",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const host = createCardInstance(HOST_DEF, {
      instanceId: "bses01-c04-ref-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["bses01-c04-ref-brave"],
    });
    const attachedBrave = createCardInstance(c05, {
      instanceId: "bses01-c04-ref-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "bses01-c04-ref-host",
    });
    const before = {
      ...createEmptyGameState({
        playerIds: [ALICE, _BOB],
        cardInstances: [source, host, attachedBrave],
      }),
      activePlayerId: ALICE,
      step: "main" as const,
    };
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "remember-brave",
          action: {
            kind: "noop",
            target: {
              kind: "filter",
              player: "self",
              count: 1,
              filter: { category: ["brave"] },
            },
          },
        },
        {
          id: "remember-host",
          action: {
            kind: "noop",
            target: {
              kind: "filter",
              player: "self",
              count: 1,
              filter: { category: ["spirit"] },
            },
          },
        },
        {
          connector: "sequential",
          stepCondition: {
            kind: "ref_has_match",
            stepId: "remember-host",
            filter: {
              attachedBrave: {
                cardName: {
                  kind: "from_step_ref",
                  stepId: "remember-brave",
                },
              },
            },
          },
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    };

    const after = executeEffect({
      chainId: "test:bses01-c04-cx01-t01-coverage:1592",
      state: before,
      effect,
      sourceInstanceId: "bses01-c04-ref-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithHost,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: ["bses01-c04-ref-brave", "bses01-c04-ref-host"],
      sequentialTargetConsumption: true,
      targetSelectionResolved: true,
    });

    expect(alice(after).countValue).toBe(1);
  });

  it("[board] BSES01-C04 は召喚した86ブレイヴのT01直合体を解決してからgrant対象を評価する", () => {
    const effect = c04.effects![1]!;
    const c05 = card("BSES01-C05");
    const t01 = card("BSES01-T01");
    const source = createCardInstance(c04, {
      instanceId: "bses01-c04-src-t01",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const summoned = createCardInstance(c05, {
      instanceId: "bses01-c04-summoned-c05-t01",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const before = {
      ...createEmptyGameState({
        playerIds: [ALICE, _BOB],
        cardInstances: [source, summoned],
        playerOverrides: [
          { countValue: 4, reserveNormalCoreCount: 5, trashNormalCoreCount: 1 },
          {},
        ],
      }),
      activePlayerId: ALICE,
      step: "main" as const,
    };

    const current = executeEffectWithChosenMinimumCores({
      chainId: "test:bses01-c04-cx01-t01-coverage:1634",
      state: before,
      effect,
      sourceInstanceId: "bses01-c04-src-t01",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithHost,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: noBurstLookup,
      targetInstanceIds: ["bses01-c04-summoned-c05-t01"],
    });

    expect(
      current.cardInstances.find(
        (c) => c.instanceId === "bses01-c04-summoned-c05-t01"
      )?.zone
    ).toBe("field");
    expect(current.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(current.pendingTriggeredEffects).toHaveLength(1);
    expect(
      Object.keys(
        current.pendingTriggeredEffects[0]!
          .relatedInstanceIdsBySourceRegistrationKey ?? {}
      )
    ).toEqual(["bses01-c04-summoned-c05-t01#0"]);

    const token = current.cardInstances.find(
      (c) => c.definitionId === t01.cardNo && c.ownerPlayerId === ALICE
    );
    expect(token).toBeDefined();
    expect(token!.zone).toBe("field");
    expect(token!.attachedChildrenIds).toContain("bses01-c04-summoned-c05-t01");
    expect(
      current.cardInstances.find(
        (c) => c.instanceId === "bses01-c04-summoned-c05-t01"
      )?.attachedToInstanceId
    ).toBe(token!.instanceId);
    expect(current.pendingTriggeredEffects).toHaveLength(1);
    expect(current.pendingAfterTriggersContinuations).toHaveLength(0);

    const blockTargets = current.activeContinuousEffects
      .filter((ce) => ce.modifierTag === "block_unblockable")
      .map((ce) => ce.targetInstanceId);
    expect(blockTargets).toEqual([token!.instanceId]);
    const grantTargets = current.activeContinuousEffects
      .filter((ce) => ce.modifierTag === "granted_effect")
      .map((ce) => ce.targetInstanceId);
    expect(grantTargets).toEqual([token!.instanceId]);

    expect(
      legalActions(current).some(
        (a) =>
          a.kind === "use_field_card_effect" &&
          a.sourceInstanceId === token!.instanceId &&
          (a as { grantedEffectCeId?: string }).grantedEffectCeId !== undefined
      )
    ).toBe(false);

    const c05SummonActions = legalActions(current, ALICE).filter(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "bses01-c04-summoned-c05-t01" &&
        a.sourceCardNo === c05.cardNo
    );
    expect(c05SummonActions.some((a) => a.executionMode === "optional")).toBe(
      true
    );
    expect(c05SummonActions.some((a) => a.executionMode === "mandatory")).toBe(
      false
    );
  });

  it("[board] BSES01-C04 はカウント4未満なら召喚のみで grant 後段を登録しない", () => {
    const effect = c04.effects![1]!;
    const c05 = card("BSES01-C05");
    const source = createCardInstance(c04, {
      instanceId: "bses01-c04-src-low-count",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const summoned = createCardInstance(c05, {
      instanceId: "bses01-c04-summoned-low-count",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const matchingHost = createCardInstance(HOST_DEF, {
      instanceId: "bses01-c04-host-low-count",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["bses01-c04-attached-low-count"],
    });
    const matchingBrave = createCardInstance(c05, {
      instanceId: "bses01-c04-attached-low-count",
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "bses01-c04-host-low-count",
    });
    const before = {
      ...createEmptyGameState({
        playerIds: [ALICE, _BOB],
        cardInstances: [source, summoned, matchingHost, matchingBrave],
        playerOverrides: [
          { countValue: 3, reserveNormalCoreCount: 5, trashNormalCoreCount: 0 },
          {},
        ],
      }),
      activePlayerId: ALICE,
      step: "main" as const,
    };

    const after = executeEffectWithChosenMinimumCores({
      chainId: "test:bses01-c04-cx01-t01-coverage:1744",
      state: before,
      effect,
      sourceInstanceId: "bses01-c04-src-low-count",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDefWithHost,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: ["bses01-c04-summoned-low-count"],
    });

    expect(
      after.cardInstances.find(
        (c) => c.instanceId === "bses01-c04-summoned-low-count"
      )?.zone
    ).toBe("field");
    expect(
      after.activeContinuousEffects.filter(
        (ce) =>
          ce.modifierTag === "block_unblockable" ||
          ce.modifierTag === "granted_effect"
      )
    ).toHaveLength(0);
  });
});

// ============================================================
// BSES01-CX01 [白銀の契約者]ヴラディレーナ・ミリーゼ
// ============================================================
describe("BSES01-CX01 [白銀の契約者]ヴラディレーナ・ミリーゼ", () => {
  const cx01 = card("BSES01-CX01");

  it("grandwalkerData が導界者として定義されている", () => {
    expect(cx01.grandwalkerData).toBeDefined();
    expect(cx01.grandwalkerData!.kind).toBe("guided");
    expect(cx01.grandwalkerData!.oracleConditions).toEqual([
      { tribes: ["８６"], categories: ["brave"] },
    ]);
    expect(cx01.grandwalkerData!.oracleTriggerKinds).toEqual(["summon"]);
    expect(cx01.grandwalkerData!.placementOracle).toEqual({
      sameNameGate: false,
      turnLimit: "per_card_name",
    });
  });

  it("divineSkills で契約技:2 が定義されている", () => {
    const skills = cx01.grandwalkerData!.divineSkills;
    expect(skills).toBeDefined();
    expect(skills!.length).toBe(1);
    const skill = skills![0]!;
    expect(skill.label).toBe("contract_skill");
    expect(skill.coreCost).toBe(2);
    expect(skill.timing).toBe("main");
    expect(skill.minLevel).toBe(1);
    expect(skill.maxLevel).toBe(2);
    expect(skill.turnLimit).toBe("once");
  });

  it("契約技効果: count+2 と任意ドロー、終了制限アクションがある", () => {
    const skills = cx01.grandwalkerData!.divineSkills!;
    const skill = skills[0]!;
    const eff = skill.effects![0]!;
    const action = eff.steps[0]!.action;
    expect(eff.stub).toBeUndefined();
    expect(action.kind).toBe("count_increase");
    if (action.kind === "count_increase") {
      expect(action.player).toBe("self");
      expect(action.amount).toBe(2);
    }
    expect(eff.steps[1]!.action.kind).toBe("draw");
    expect(eff.steps[1]!.executionMode).toBe("optional");
    expect(eff.steps.map((step) => step.action.kind)).toEqual([
      "count_increase",
      "draw",
      "restrict_end_battle",
      "restrict_end_turn",
      "restrict_end_step",
      "restrict_end_attack_step",
    ]);
  });

  it("effects に【復活】place(self) がある", () => {
    expect(cx01.effects).toBeDefined();
    const revival = cx01.effects!.find(
      (e) => e.steps.length > 0 && e.steps[0]!.action.kind === "place"
    );
    expect(revival).toBeDefined();
    expect(revival!.timing).toEqual({ kind: "activated", mode: "main" });
    expect(revival!.applicability?.soulState).toBe(true);
    expect(revival!.usageLimit?.kind).toBe("per_card_name");
    expect(revival!.usageLimit?.duration).toBe("turn");
  });

  it("[board] BSES01-CX01 【復活】は魂状態から配置して place event と配置時神託を発火する", () => {
    const revival = cx01.effects!.find(
      (e) => e.steps.length > 0 && e.steps[0]!.action.kind === "place"
    )!;
    const nexus = createCardInstance(cx01, {
      instanceId: "lena-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const deckCard = createCardInstance(card("BSES01-C04"), {
      instanceId: "deck-card",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const before = createEmptyGameState({
      cardInstances: [nexus, deckCard],
      playerOverrides: [{ soulStateInstanceIds: ["lena-nexus"] }, {}],
    });

    const afterSteps = executeEffect({
      chainId: "test:bses01-c04-cx01-t01-coverage:1854",
      state: before,
      effect: revival,
      sourceInstanceId: "lena-nexus",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    expect(alice(afterSteps).soulStateInstanceIds).not.toContain("lena-nexus");
    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: afterSteps,
      source: "action_resolution",
      chainId: "bses01-cx01-revival",
      attackId: null,
      getCardDefinitionById: getDef,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        eventKind: "place",
        relatedInstanceId: "lena-nexus",
        fromZone: "field",
      })
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        eventKind: "summon",
        relatedInstanceId: "lena-nexus",
      })
    );

    const finalized = finalizeEffectResolution({
      state: afterSteps,
      beforeState: before,
      chainId: "bses01-cx01-revival",
      endLogs: [],
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: undefined,
      causedBySourceInstanceId: "lena-nexus",
    });
    const placementOraclePendings = finalized.pendingTriggeredEffects.filter(
      (p) =>
        p.mechanic?.kind === "placement_oracle" &&
        p.mechanic.grandwalkerInstanceId === "lena-nexus"
    );
    expect(placementOraclePendings).toHaveLength(1);
  });

  it("[board] BSES01-CX01 配置時神託は別同名ネクサス在場だけでは止まらない", () => {
    const first = createCardInstance(cx01, {
      instanceId: "lena-first",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const second = createCardInstance(cx01, {
      instanceId: "lena-second",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const deckCard = createCardInstance(card("BSES01-C04"), {
      instanceId: "deck-card",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const state = createEmptyGameState({
      cardInstances: [first, second, deckCard],
      playerOverrides: [{ deckCount: 1 }, {}],
    });

    const queued = checkAndQueuePlacementOracle(
      state,
      "lena-second",
      getDef,
      "test:bses01-c04-cx01-t01-coverage:1926"
    );
    expect(
      queued.pendingTriggeredEffects.filter(
        (p) =>
          p.mechanic?.kind === "placement_oracle" &&
          p.mechanic.grandwalkerInstanceId === "lena-second"
      )
    ).toHaveLength(1);
  });

  it("[board] BSES01-CX01 真・導託は対象８６ブレイヴの召喚だけでキューし、煌臨ではキューしない", () => {
    const nexus = createCardInstance(cx01, {
      instanceId: "lena-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(ORACLE_BRAVE_DEF, {
      instanceId: "oracle-brave",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      cardInstances: [nexus, brave],
      playerOverrides: [{ voidNormalCoreCount: 1 }, {}],
    });

    const afterSummon = checkAndQueueOracleChoices(
      state,
      "oracle-brave",
      "summon",
      getDefWithHost,
      "test:bses01-c04-cx01-t01-coverage:true-guided-summon"
    );
    expect(
      afterSummon.pendingTriggeredEffects.filter(
        (pending) =>
          pending.mechanic?.kind === "oracle" &&
          pending.mechanic.grandwalkerInstanceId === "lena-nexus"
      )
    ).toHaveLength(1);

    const afterAdvent = checkAndQueueOracleChoices(
      state,
      "oracle-brave",
      "advent",
      getDefWithHost,
      "test:bses01-c04-cx01-t01-coverage:true-guided-advent"
    );
    expect(afterAdvent.pendingTriggeredEffects).toHaveLength(0);
  });

  it("[board] 配置時神託のターン1同名制限は通常配置と復活配置で共有される", () => {
    const revival = cx01.effects!.find(
      (e) => e.steps.length > 0 && e.steps[0]!.action.kind === "place"
    )!;
    const nexus = createCardInstance(cx01, {
      instanceId: "lena-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const deckCards = Array.from({ length: 4 }, (_, index) =>
      createCardInstance(card("BSES01-C04"), {
        instanceId: `deck-card-${index}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    let state = createEmptyGameState({
      cardInstances: [nexus, ...deckCards],
      playerOverrides: [{ deckCount: 4 }, {}],
    });

    state = checkAndQueuePlacementOracle(
      state,
      "lena-nexus",
      getDef,
      "test:bses01-c04-cx01-t01-coverage:1957"
    );
    expect(
      state.pendingTriggeredEffects.filter(
        (p) => p.mechanic?.kind === "placement_oracle"
      )
    ).toHaveLength(1);
    state = resolvePlacementOracleMechanic(
      state,
      { kind: "placement_oracle", grandwalkerInstanceId: "lena-nexus" },
      getDef
    );
    expect(
      state.effectUsageRecords.some(
        (record) =>
          record.sourceDefinitionId === cx01.cardNo &&
          record.effectLabel === "placement_oracle" &&
          record.duration === "turn"
      )
    ).toBe(true);

    const beforeRevival = {
      ...state,
      pendingTriggeredEffects: [],
      players: state.players.map((player) =>
        player.id === ALICE
          ? { ...player, soulStateInstanceIds: ["lena-nexus"] }
          : player
      ),
    };
    const afterSteps = executeEffect({
      chainId: "test:bses01-c04-cx01-t01-coverage:1986",
      state: beforeRevival,
      effect: revival,
      sourceInstanceId: "lena-nexus",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    const finalized = finalizeEffectResolution({
      state: afterSteps,
      beforeState: beforeRevival,
      chainId: "bses01-cx01-revival-after-placement-oracle",
      endLogs: [],
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      getRegisteredBurstActions: undefined,
      causedBySourceInstanceId: "lena-nexus",
    });
    expect(
      finalized.pendingTriggeredEffects.filter(
        (p) =>
          p.mechanic?.kind === "placement_oracle" &&
          p.mechanic.grandwalkerInstanceId === "lena-nexus"
      )
    ).toHaveLength(0);
  });

  it("[board] 契約技 count+2 がカウントを増加させる", () => {
    const skills = cx01.grandwalkerData!.divineSkills!;
    const skill = skills[0]!;
    const eff = skill.effects![0]!;

    const nexus = createCardInstance(cx01, {
      instanceId: "lena-nexus",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });

    const before = createEmptyGameState({
      cardInstances: [nexus],
      playerOverrides: [{ countValue: 0 }, {}],
    });

    const after = executeEffect({
      chainId: "test:bses01-c04-cx01-t01-coverage:2032",
      state: before,
      effect: eff,
      sourceInstanceId: "lena-nexus",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });

    expect(alice(after).countValue).toBe(2);
  });
});

// ============================================================
// BSES01-T01 M1A4 ジャガーノート
// ============================================================
describe("BSES01-T01 M1A4 ジャガーノート", () => {
  const t01 = card("BSES01-T01");

  it("effects 配列が定義されている", () => {
    expect(t01.effects).toBeDefined();
    expect(t01.effects!.length).toBeGreaterThanOrEqual(3);
  });

  it("[2] 自身の支払い前effectsがトークンデッキからputし直接合体を要求する", () => {
    const eff = t01.effects![0]!;
    expect(eff.applicability).toEqual({ zone: "token_pool" });
    expect(eff.timing).toMatchObject({
      kind: "game_event",
      event: "summon",
      beforeCost: true,
    });
    expect(eff.usageLimit).toEqual({ kind: "no_duplicate" });
    expect(eff.steps[0]!.action).toMatchObject({
      kind: "put",
      target: { kind: "from_token_pool", source: "self" },
      trashCoreMax: 1,
      trashCoreKind: "normal",
      requireDirectCombineWithTrigger: true,
    });
  });

  it("[4] ブレイヴ分離不可 + 残存不可は prevent_brave_separation CE", () => {
    const eff = t01.effects![1]!;
    expect(eff.stub).toBeUndefined();
    expect(eff.steps.length).toBe(1);
    const action = eff.steps[0]!.action;
    expect(action.kind).toBe("prevent_brave_separation");
    if (action.kind === "prevent_brave_separation") {
      expect(action.target).toEqual({ kind: "self" });
      expect(action.duration).toEqual({ scope: "while_on_field" });
    }
  });

  it("[6,7] アタック/ブロック時に合体中なら指揮官 導界者ネクサスにコア+1 (void→field_card, guided 排他)", () => {
    const eff = t01.effects![2]!;
    expect(eff.timing).toEqual({
      kind: "card_event",
      event: ["attack", "block"],
    });
    expect(eff.condition).toEqual([{ kind: "combined" }]);
    expect(eff.executionMode).toBe("optional");
    const action = eff.steps[0]!.action;
    expect(action.kind).toBe("core_move");
    if (action.kind === "core_move") {
      // 「コア+1」= ボイドからカード上へ (oracle 同型 / verifier 2026-06-23 round 7 lens 1)。
      expect(action.from).toEqual({ kind: "void", player: "self" });
      expect(action.amount).toBe(1);
      // 宛先は指揮官+導界者ネクサスのみ (targetsGrandwalker:"only" + hasMechanic:["guided"])。
      if (action.to.kind === "field_card") {
        expect(action.to.filter?.tribes).toEqual(["指揮官"]);
        expect(action.to.filter?.category).toEqual(["nexus"]);
        expect(action.to.filter?.targetsGrandwalker).toBe("only");
        expect(action.to.filter?.hasMechanic).toEqual(["guided"]);
      }
    }
  });

  it("[structure] アタック時 core_move の DSL 構造が正しい (void→field_card)", () => {
    const eff = t01.effects![2]!;
    expect(eff.steps.length).toBe(1);
    const action = eff.steps[0]!.action;
    expect(action.kind).toBe("core_move");
    if (action.kind === "core_move") {
      expect(action.from).toEqual({ kind: "void", player: "self" });
      expect(action.to).toMatchObject({
        kind: "field_card",
        player: "self",
      });
      expect(action.amount).toBe(1);
    }
  });

  it("[board] 合体中アタック解決後、指揮官+導界者ネクサスのみが void から +1 コアを得る (通常 nexus / 創界神ネクサスは除外)", () => {
    // verifier 2026-06-23 round 11 lens 5 補正: shape のみでなく実行経路で
    // targetsGrandwalker:"only" + hasMechanic:["guided"] の排他を踏む。
    const guidedLena: CardDefinition = {
      cardNo: "T01-LENA-GUIDED",
      name: "[テスト]レーナ guided",
      printedCategory: "nexus",
      colors: ["white"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["white"],
      textLines: [],
      keywordTags: [],
      tribe: "指揮官",
      sourceUrls: [],
      sourceConfidence: "C",
      grandwalkerData: { kind: "guided" },
    } as CardDefinition;
    const grandwalkerLena: CardDefinition = {
      ...guidedLena,
      cardNo: "T01-LENA-GRANDWALKER",
      name: "[テスト]創界神レーナ",
      grandwalkerData: { kind: "grandwalker" },
    } as CardDefinition;
    const regularNexus: CardDefinition = {
      ...guidedLena,
      cardNo: "T01-NEXUS-REGULAR",
      name: "[テスト]通常 指揮官ネクサス",
      grandwalkerData: undefined,
    } as CardDefinition;
    // host を作成 (T01 を combine する先)。
    const hostDef: CardDefinition = {
      cardNo: "T01-HOST",
      name: "[テスト]ホスト",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      tribe: "８６",
      sourceUrls: [],
      sourceConfidence: "C",
    } as CardDefinition;
    const t01Inst = createCardInstance(t01, {
      instanceId: "t01-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const cards = [
      createCardInstance(guidedLena, {
        instanceId: "lena-guided",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      }),
      createCardInstance(grandwalkerLena, {
        instanceId: "lena-grandwalker",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      }),
      createCardInstance(regularNexus, {
        instanceId: "nexus-regular",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      }),
      createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      { ...t01Inst, attachedToInstanceId: "host-1" },
    ];
    const aliceWithVoid = (s: GameState): GameState => ({
      ...s,
      players: s.players.map((p) =>
        p.id === ALICE ? { ...p, voidNormalCoreCount: 5 } : p
      ),
    });
    const baseDefs = new Map<string, CardDefinition>([
      [t01.cardNo, t01],
      [guidedLena.cardNo, guidedLena],
      [grandwalkerLena.cardNo, grandwalkerLena],
      [regularNexus.cardNo, regularNexus],
      [hostDef.cardNo, hostDef],
    ]);
    const baseState = aliceWithVoid(
      createEmptyGameState({
        playerIds: [ALICE, _BOB],
        cardInstances: cards,
      })
    );
    const eff = t01.effects![2]!;
    const after = executeEffect({
      chainId: "test:bses01-c04-cx01-t01-coverage:2214",
      state: baseState,
      effect: eff,
      sourceInstanceId: "t01-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) => baseDefs.get(id),
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      // optional + 単一対象自動解決: AI が選ばずとも guided レーナのみが候補のため
      // 確定で 1 個コア+1 が乗る (instance 指定で揺らぎ防止)。
      targetInstanceIds: ["lena-guided"],
    });
    const cores = (id: string) =>
      after.cardInstances.find((c) => c.instanceId === id)?.normalCoreCount ??
      0;
    expect(cores("lena-guided")).toBe(1);
    expect(cores("lena-grandwalker")).toBe(0);
    expect(cores("nexus-regular")).toBe(0);
    // void から 1 個減る (5→4)
    expect(alice(after).voidNormalCoreCount).toBe(4);
  });
});
