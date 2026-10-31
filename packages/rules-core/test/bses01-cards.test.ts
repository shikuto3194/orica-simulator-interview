import { finishCoreChoices } from "./helpers/core-choice-driver";
/**
 * BSES01 (８６-エイティシックス-) カードの effects 検証テスト。
 * 系統「８６」の導界者ブレイヴ（ジャガーノート合体）中心。
 * フラッシュ自己召喚（accel 的「手札/手元のこのカードは召喚できる」）・スピリット状態の
 * ブレイヴ アタック/ブロック禁止・星霊衣系の自己回収は基盤未実装のため stub。
 * 召喚時 deck reveal / draw、合体中の bounce / prevent_battle / suppress_effect /
 * send_to_deck / leave_field core_move / 行きつく果てまで(トラッシュ枚数)BP+ のみ DSL 変換済み。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  filterRestrictedTimings,
  flushPendingLeaves,
  getAvailableFieldCardEffectLegalActions,
  getLegalActions,
  generateTriggeredEffectRegistrations,
  matchesTriggerEvent,
  rebuildContinuousEffectsFromField,
  useAttackAsAction,
} from "../src";
import type {
  CardDefinition,
  ContinuousEffect,
  GameState,
  PendingTriggeredEffect,
} from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  getCandidateTargetInstanceIds,
  removeExpiredContinuousEffects,
} from "../src/legal/legal-actions-shared";
import { queueBattleEndTriggers } from "../src/effect/trigger-system";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const noLookup = () => [];
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

function passStackUntilClosed(
  state: GameState,
  extraOptions: Record<string, unknown> = {}
): GameState {
  let current = state;
  let guard = 0;
  while (
    (current.stackWindow ||
      current.activeAttack?.flashWindowState?.pendingStackAction) &&
    guard++ < 10
  ) {
    const responderId =
      current.stackWindow?.priorityPlayerId ??
      current.activeAttack?.flashWindowState.priorityPlayerId;
    if (!responderId) {
      throw new Error("stack responder not found");
    }
    const pass = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
      ...extraOptions,
    } as unknown as Parameters<typeof getLegalActions>[0]).find(
      (action) =>
        action.kind === "pass_stack" || action.kind === "pass_battle_flash"
    );
    if (!pass) {
      throw new Error(
        `pass_stack/pass_battle_flash for ${responderId} not found`
      );
    }
    current = applyLegalAction({
      state: current,
      action: pass,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
      ...extraOptions,
    } as Parameters<typeof applyLegalAction>[0]).state;
  }
  return current;
}

/**
 * pendingDeckReveal の picking + ordering_remainder を一気通貫で進める
 * (bsth09-deck-reveal-swap.test.ts walkPicksAndOrdering と同型)。
 * remainder="bottom" 固定 (top_or_bottom ではない) でも 2 枚以上残ると
 * ordering_remainder フェーズを経由するため、pick 単発では完了しない。
 */
function drainDeckRevealPickAndOrder(
  state: GameState,
  pickCardIds: string[]
): GameState {
  let cur = state;
  if (cur.pendingStepOptionalChoice?.stepIndex === 0) {
    const action = getLegalActions({
      state: cur,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    )!;
    cur = applyLegalAction({
      state: cur,
      action,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    }).state;
  }
  for (let step = 0; step < 10; step++) {
    if (cur.pendingDeckReveal === null) break;
    const phase = cur.pendingDeckReveal.phase;
    if (phase === "picking") {
      const pick = getLegalActions({
        state: cur,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      }).find((action) => action.kind === "resolve_pending_deck_reveal_pick");
      if (!pick) break;
      cur = applyLegalAction({
        state: cur,
        action: pick,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noLookup,
        selectedDeckRevealCardIds: pickCardIds,
      }).state;
    } else if (phase === "ordering_remainder") {
      const remaining = cur.pendingDeckReveal.revealedCardInstanceIds.filter(
        (id) => !cur.pendingDeckReveal!.pickedCardInstanceIds.includes(id)
      );
      const order = getLegalActions({
        state: cur,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      }).find((action) => action.kind === "resolve_pending_deck_reveal_order");
      if (!order) break;
      cur = applyLegalAction({
        state: cur,
        action: order,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noLookup,
        deckRevealRemainderOrder: remaining,
      }).state;
    } else {
      break;
    }
  }
  return cur;
}

describe("BSES01-C01 Para-RAID Activate", () => {
  const c = card("BSES01-C01");
  it("フラッシュ：デッキ3オープン→指揮官/86 ネクサス/ブレイヴ1枚 pick（残り bottom）", () => {
    const flash = c.effects![2]!;
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    const reveal = flash.steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(3);
      expect(reveal.remainder).toBe("bottom_or_trash");
      expect(reveal.picks[0]!.filter!.category).toEqual(["nexus", "brave"]);
      expect(reveal.picks[0]!.filter!.tribes).toEqual(["指揮官", "８６"]);
      expect(reveal.picks[0]!.destination).toBe("hand");
    }
    // [0] 自己回収はマジック以外発生源限定で実装済 (trigger_source_category exclude:magic)。
    const recovery = c.effects![0]!;
    expect(recovery.stub).toBeUndefined();
    expect(recovery.timing).toEqual({
      kind: "card_event",
      event: ["revealed", "moved_to_trash"],
    });
    expect(recovery.condition).toEqual(
      expect.arrayContaining([
        { kind: "trigger_source_category", exclude: ["magic"] },
      ])
    );
    // [2] 導界者ネクサス保護は対象開示応答で実装済み。
    const protect = c.effects![1]!;
    expect(protect.stub).toBeUndefined();
    expect(protect.timing).toMatchObject({
      kind: "game_event",
      player: "self",
      event: "targeted",
      triggerFilter: {
        category: ["nexus"],
        tribes: ["指揮官"],
        targetsGrandwalker: "only",
        hasMechanic: ["guided"],
      },
      cause: ["opponent_effect"],
    });
    expect(protect.steps[0]!.action.kind).toBe("move_card");
    expect(protect.steps[1]!.connector).toBe("conditional_cost");
    expect(protect.steps[1]!.action).toEqual({
      kind: "effect_resistance",
      target: { kind: "trigger_related_instance" },
      resistsOutcome: ["leave_field", "core_below_min"],
      source: "opponent",
      duration: { scope: "step" },
      coreMinimum: 2,
    });
  });

  it("[board] フラッシュ後段: pick 解決後「フィールドに置ける」を選ぶと in_use→field (トラッシュへ行かない)", () => {
    const flash = c.effects![2]!;
    const nexusPick = createCardInstance(card("BSES01-C02"), {
      instanceId: "reveal-pick",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const filler1 = createCardInstance(c, {
      instanceId: "reveal-filler-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const filler2 = createCardInstance(c, {
      instanceId: "reveal-filler-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const magic = createCardInstance(c, {
      instanceId: "para-raid-flash",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [magic, nexusPick, filler1, filler2],
        playerOverrides: [{ deckCount: 3 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
    };

    const afterReveal = executeEffect({
      chainId: "test:bses01-cards:252",
      state,
      effect: flash,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    });

    const afterPick = drainDeckRevealPickAndOrder(afterReveal, [
      nexusPick.instanceId,
    ]);

    expect(afterPick.pendingDeckReveal).toBeNull();
    expect(
      afterPick.cardInstances.find((x) => x.instanceId === nexusPick.instanceId)
        ?.zone
    ).toBe("hand");
    expect(
      afterPick.cardInstances.find((x) => x.instanceId === filler1.instanceId)
        ?.zone
    ).toBe("deck");
    expect(afterPick.pendingStepOptionalChoice).not.toBeNull();
    const psoc = afterPick.pendingStepOptionalChoice!;
    expect(psoc.sourceInstanceId).toBe(magic.instanceId);

    const afterExecute = applyLegalAction({
      state: afterPick,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    }).state;

    expect(afterExecute.pendingStepOptionalChoice).toBeNull();
    expect(
      afterExecute.cardInstances.find((x) => x.instanceId === magic.instanceId)
        ?.zone
    ).toBe("field");
  });

  it("[board] 実マジック使用パイプライン(use_magic→pass_stack→pick→optional choice)でも実行選択でフィールドに残る", () => {
    // pendingDeckReveal / optional choice が開いている間は magic cleanup を延期し、
    // execute 選択で field へ移った場合は trash へ送らない。
    const nexusPick = createCardInstance(card("BSES01-C02"), {
      instanceId: "pipeline-pick",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const filler1 = createCardInstance(c, {
      instanceId: "pipeline-filler-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const filler2 = createCardInstance(c, {
      instanceId: "pipeline-filler-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const magic = createCardInstance(c, {
      instanceId: "pipeline-magic",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const magicLookup = buildMagicLookup(ALL_CARDS);
    const lookups = {
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredBurstActions: noLookup,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [magic, nexusPick, filler1, filler2],
        playerOverrides: [
          { deckCount: 3, handCount: 1, reserveNormalCoreCount: 3 },
          {},
        ],
      }),
      activePlayerId: "alice",
      step: "main",
      window: "main_step",
    };

    const useMagic = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === magic.instanceId &&
        action.timing === "flash"
    );
    expect(useMagic).toBeDefined();

    const afterUse = applyLegalAction({
      state,
      action: useMagic!,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      ...lookups,
    }).state;
    expect(afterUse.stackWindow).not.toBeNull();
    expect(
      afterUse.cardInstances.find((x) => x.instanceId === magic.instanceId)
        ?.zone
    ).toBe("in_use");

    const pass = getLegalActions({
      state: afterUse,
      actingPlayerId: "bob",
      ...lookups,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();

    const afterPass = applyLegalAction({
      state: afterUse,
      action: pass!,
      ...lookups,
    }).state;

    expect(afterPass.pendingStepOptionalChoice?.stepIndex).toBe(0);
    expect(
      afterPass.cardInstances.find((x) => x.instanceId === magic.instanceId)
        ?.zone
    ).toBe("in_use");

    const afterPick = drainDeckRevealPickAndOrder(afterPass, [
      nexusPick.instanceId,
    ]);
    expect(afterPick.pendingDeckReveal).toBeNull();
    expect(
      afterPick.cardInstances.find((x) => x.instanceId === nexusPick.instanceId)
        ?.zone
    ).toBe("hand");

    const psoc = afterPick.pendingStepOptionalChoice!;
    expect(psoc).toBeDefined();
    expect(psoc.sourceInstanceId).toBe(magic.instanceId);

    const afterExecute = applyLegalAction({
      state: afterPick,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      ...lookups,
    }).state;

    expect(afterExecute.pendingStepOptionalChoice).toBeNull();
    expect(
      afterExecute.cardInstances.find((x) => x.instanceId === magic.instanceId)
        ?.zone
    ).toBe("field");
  });

  it("[board] フラッシュ後段: 「フィールドに置ける」を辞退すると magic cleanup で trash へ移る", () => {
    const flash = c.effects![2]!;
    const nexusPick = createCardInstance(card("BSES01-C02"), {
      instanceId: "reveal-pick-decline",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const filler1 = createCardInstance(c, {
      instanceId: "reveal-decline-filler-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const filler2 = createCardInstance(c, {
      instanceId: "reveal-decline-filler-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    const magic = createCardInstance(c, {
      instanceId: "para-raid-flash-decline",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "in_use",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [magic, nexusPick, filler1, filler2],
        playerOverrides: [{ deckCount: 3 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
    };

    const afterReveal = executeEffect({
      chainId: "test:bses01-cards:468",
      state,
      effect: flash,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    });
    const afterPick = drainDeckRevealPickAndOrder(afterReveal, [
      nexusPick.instanceId,
    ]);
    expect(afterPick.pendingDeckReveal).toBeNull();

    const psoc = afterPick.pendingStepOptionalChoice!;
    expect(psoc).toBeDefined();

    const afterDecline = applyLegalAction({
      state: afterPick,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    }).state;

    expect(afterDecline.pendingStepOptionalChoice).toBeNull();
    expect(
      afterDecline.cardInstances.find((x) => x.instanceId === magic.instanceId)
        ?.zone
    ).toBe("trash");
  });

  it("BSES01-C01 [2] は対象開示応答で自身を破棄し、このステップの間、対象の離脱とコア2個未満を防ぐ", () => {
    const targetDef: CardDefinition = {
      cardNo: "TEST-BSES01-C01-GUIDED-NEXUS",
      name: "テスト導界者ネクサス",
      printedCategory: "nexus",
      colors: ["white"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: ["white"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      tribe: "指揮官",
      grandwalkerData: { kind: "guided" },
    };
    const magicDef: CardDefinition = {
      cardNo: "TEST-BSES01-C01-OPPONENT-CORE-MAGIC",
      name: "テスト相手コア除去マジック",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手の導界者ネクサス1つのコアすべてをボイドに置く。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "cores",
              action: {
                kind: "core_move",
                from: {
                  kind: "field_card",
                  player: "opponent",
                  filter: {
                    category: ["nexus"],
                    tribes: ["指揮官"],
                    targetsGrandwalker: true,
                  },
                },
                to: { kind: "void", player: "opponent" },
                amount: "all",
              },
            },
          ],
        },
      ],
    };
    const destroyDef: CardDefinition = {
      cardNo: "TEST-BSES01-C01-OPPONENT-DESTROY-MAGIC",
      name: "テスト相手破壊マジック",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手の導界者ネクサス1つを破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "destroy",
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["nexus"],
                    tribes: ["指揮官"],
                    targetsGrandwalker: true,
                  },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const paraRaid = createCardInstance(c, {
      instanceId: "bses01-c01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const target = createCardInstance(targetDef, {
      instanceId: "bses01-c01-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bses01-c01-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const destroyMagic = createCardInstance(destroyDef, {
      instanceId: "bses01-c01-destroy-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [paraRaid, target, magic, destroyMagic],
    });
    const definitions = [...ALL_CARDS, targetDef, magicDef, destroyDef];
    const getDef = (id: string): CardDefinition | undefined =>
      definitions.find((def) => def.cardNo === id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions: (cardNo: string) => {
        const def = definitions.find((d) => d.cardNo === cardNo);
        return def ? generateTriggeredEffectRegistrations(def) : [];
      },
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    };

    const disclosure = executeEffect({
      chainId: "test:bses01-cards:645",
      state: baseState,
      effect: magicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
      targetInstanceIds: [target.instanceId],
      targetStepId: "cores",
      effectActionKind: "magic",
    });

    expect(disclosure.pendingTargetedDisclosureContinuation).toMatchObject({
      sourceDefinitionId: magicDef.cardNo,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      targetInstanceIds: [target.instanceId],
      targetStepId: "cores",
    });
    expect(disclosure.pendingTriggeredEffects[0]).toMatchObject({
      eventKind: "targeted",
      relatedInstanceId: target.instanceId,
      effectSourceDefinitionId: magicDef.cardNo,
      effectSourceInstanceId: magic.instanceId,
      effectActionKind: "magic",
    });

    const resolveParaRaid = getLegalActions({
      state: disclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === paraRaid.instanceId
    );
    expect(resolveParaRaid).toBeDefined();

    const afterDeclare = applyLegalAction({
      state: disclosure,
      action: resolveParaRaid!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    const pass = getLegalActions({
      state: afterDeclare,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();

    const after = applyLegalAction({
      state: afterDeclare,
      action: pass!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    expect(
      after.cardInstances.find(
        (card) => card.instanceId === paraRaid.instanceId
      )?.zone
    ).toBe("trash");
    const protectedTarget = after.cardInstances.find(
      (card) => card.instanceId === target.instanceId
    );
    expect(protectedTarget?.zone).toBe("field");
    expect(protectedTarget?.normalCoreCount).toBe(2);
    expect(after.pendingTargetedDisclosureContinuation).toBeNull();
    expect(
      after.activeContinuousEffects.some(
        (effect) =>
          effect.modifierTag === "cannot_reduce_cores_below" &&
          effect.targetInstanceId === target.instanceId &&
          effect.sourceInstanceId === paraRaid.instanceId
      )
    ).toBe(true);
    expect(
      after.activeContinuousEffects.some(
        (effect) =>
          effect.modifierTag === "cannot_leave_field" &&
          effect.targetInstanceId === target.instanceId &&
          effect.sourceInstanceId === paraRaid.instanceId
      )
    ).toBe(true);

    const afterDestroyAttempt = executeEffect({
      chainId: "test:bses01-cards:735",
      state: after,
      effect: destroyDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: destroyMagic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
      targetInstanceIds: [target.instanceId],
      targetStepId: "destroy",
      effectActionKind: "magic",
    });

    const targetAfterDestroy = afterDestroyAttempt.cardInstances.find(
      (card) => card.instanceId === target.instanceId
    );
    expect(targetAfterDestroy?.zone).toBe("field");
    expect(targetAfterDestroy?.pendingLeaveKind).toBeNull();
    const blockedLeave = afterDestroyAttempt.pendingLeaveEntities.find(
      (entry) => entry.instanceId === target.instanceId
    );
    expect(blockedLeave).toMatchObject({
      kind: "destroy",
      blockedByResistance: true,
    });
    expect(
      afterDestroyAttempt.log.some((line) =>
        line.includes("effect:destroy:blocked-by-resistance")
      )
    ).toBe(true);

    const afterStepEnd = {
      ...afterDestroyAttempt,
      activeContinuousEffects: removeExpiredContinuousEffects(
        afterDestroyAttempt,
        {
          kind: "step_end",
          step: afterDestroyAttempt.step,
          activePlayerId: afterDestroyAttempt.activePlayerId,
        }
      ),
    };
    expect(
      afterStepEnd.activeContinuousEffects.some(
        (effect) =>
          effect.targetInstanceId === target.instanceId &&
          (effect.modifierTag === "cannot_leave_field" ||
            effect.modifierTag === "cannot_reduce_cores_below")
      )
    ).toBe(false);
  });

  it("BSES01-C01 [2] は指揮官の創界神ネクサス対象時には誘発しない", () => {
    const grandwalkerDef: CardDefinition = {
      cardNo: "TEST-BSES01-C01-CREATOR-NEXUS",
      name: "テスト創界神ネクサス",
      printedCategory: "nexus",
      colors: ["white"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: ["white"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      tribe: "指揮官",
      grandwalkerData: { kind: "grandwalker" },
    };
    const magicDef: CardDefinition = {
      cardNo: "TEST-BSES01-C01-OPPONENT-CREATOR-TARGET",
      name: "テスト創界神対象マジック",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [
        "相手の系統：「指揮官」を持つ創界神ネクサス1つのコアすべてをボイドに置く。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "cores",
              action: {
                kind: "core_move",
                from: {
                  kind: "field_card",
                  player: "opponent",
                  filter: {
                    category: ["nexus"],
                    tribes: ["指揮官"],
                    targetsGrandwalker: true,
                  },
                },
                to: { kind: "void", player: "opponent" },
                amount: "all",
              },
            },
          ],
        },
      ],
    };
    const paraRaid = createCardInstance(c, {
      instanceId: "bses01-c01-creator-check",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const target = createCardInstance(grandwalkerDef, {
      instanceId: "bses01-c01-creator-target",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const magic = createCardInstance(magicDef, {
      instanceId: "bses01-c01-creator-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [paraRaid, target, magic],
    });
    const definitions = [...ALL_CARDS, grandwalkerDef, magicDef];
    const getDef = (id: string): CardDefinition | undefined =>
      definitions.find((def) => def.cardNo === id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions: (cardNo: string) => {
        const def = definitions.find((d) => d.cardNo === cardNo);
        return def ? generateTriggeredEffectRegistrations(def) : [];
      },
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    };

    const result = executeEffect({
      chainId: "test:bses01-cards:881",
      state,
      effect: magicDef.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
      targetInstanceIds: [target.instanceId],
      targetStepId: "cores",
      effectActionKind: "magic",
    });

    expect(
      result.pendingTriggeredEffects.some(
        (pending) => pending.sourceInstanceId === paraRaid.instanceId
      )
    ).toBe(false);
    expect(
      getLegalActions({
        state: result,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        ...effectLookups,
      }).some(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === paraRaid.instanceId
      )
    ).toBe(false);
  });
});

describe("BSES01-C02 [天狼星]クジョー・ニコ", () => {
  const c = card("BSES01-C02");
  it("召喚時：デッキ3オープン→86 ブレイヴ1枚 pick（ターンに1回:同名）", () => {
    expect(c.braveCondition).toEqual({ cardNameContains: ["ジャガーノート"] });
    const summon = c.effects![2]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    const reveal = summon.steps[0]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(3);
      expect(reveal.picks[0]!.filter!.tribes).toEqual(["８６"]);
      expect(reveal.picks[0]!.filter!.category).toEqual(["brave"]);
    }
    // フラッシュ自己召喚 [2,3] は手札/手元の起動効果として実装済み。
    const flashSummon = c.effects![1]!;
    expect(flashSummon.stub).toBeUndefined();
    expect(flashSummon.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(flashSummon.timingScope).toEqual({
      player: "both",
      period: "attack",
    });
    expect(flashSummon.applicability).toEqual({ zone: ["hand", "set_aside"] });
    expect(flashSummon.steps[0]!.action.kind).toBe("summon");
  });

  it("[legal action] 手札自己召喚起動効果はフラッシュ効果使用ログに記録される", () => {
    const attackerDef = card("BSES01-T01");
    const source = createCardInstance(c, {
      instanceId: "alice-c02-hand",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const attacker = createCardInstance(attackerDef, {
      instanceId: "alice-juggernaut",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
      exhaustState: "exhausted",
    });
    const handLookup = buildHandActivatedEffectLookup([c, attackerDef]);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source, attacker],
        playerOverrides: [
          { deckCount: 5, reserveNormalCoreCount: 5, handCount: 1 },
          { deckCount: 5, reserveNormalCoreCount: 5 },
        ],
        battleEntities: [
          {
            entityId: "battle-entity:alice-juggernaut",
            memberInstanceIds: ["alice-juggernaut"],
            resolvedBp: 3000,
            resolvedSymbols: ["white"],
            attackState: "attacking",
          },
        ],
        activeAttack: {
          attackId: "attack-group:bses-c02-permission",
          primaryEntityId: "battle-entity:alice-juggernaut",
          participantEntityIds: ["battle-entity:alice-juggernaut"],
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: [
            {
              participantEntityId: "battle-entity:alice-juggernaut",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-entity:alice-juggernaut"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: {
            kind: "before_block",
            priorityPlayerId: "alice",
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: "alice",
            pendingStackAction: null,
          },
        },
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "flash_before_block",
      turnNumber: 2,
    };
    const restrictFlash: ContinuousEffect = {
      effectId: "ce:c02-restrict-flash",
      sourceInstanceId: "bob-source",
      sourceDefinitionId: "TEST-RESTRICT-FLASH",
      actingPlayerId: "bob",
      modifierTag: "restrict_flash_hand",
      targetInstanceId: "alice",
      duration: { scope: "turn" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: null,
    };
    expect(
      getLegalActions({
        state: { ...state, activeContinuousEffects: [restrictFlash] },
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: noLookup,
        getRegisteredFieldCardEffectActions: noLookup,
        getRegisteredHandActivatedEffectActions: handLookup,
      }).some(
        (candidate) =>
          candidate.kind === "use_hand_card_effect" &&
          candidate.sourceInstanceId === "alice-c02-hand"
      )
    ).toBe(false);

    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).find(
      (candidate) =>
        candidate.kind === "use_hand_card_effect" &&
        candidate.sourceInstanceId === "alice-c02-hand"
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_hand_card_effect") {
      throw new Error("BSES01-C02 hand activated effect action not found");
    }
    expect(action).toMatchObject({
      effectIndex: 1,
      chosenTiming: "flash",
      sourceActivationZone: "hand",
    });

    const declared = applyLegalAction({
      state,
      action,
      summonPaymentSources: [{ kind: "reserve", amount: c.cost }],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredHandActivatedEffectActions: handLookup,
    }).state;
    expect(
      declared.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "alice-c02-hand"
      )?.zone
    ).toBe("in_use");
    expect(
      declared.players.find((player) => player.id === "alice")
        ?.reserveNormalCoreCount
    ).toBe(5);
    const afterStack = passStackUntilClosed(declared, {
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredHandActivatedEffectActions: handLookup,
    });
    // P3-138: C02 は relatedTokenCardNos:["BSES01-T01"] を持つ系統「８６」ブレイヴなので、
    // 宣言時 (コスト支払い前) に新しい M1A4 トークンが自動的に場へ出て強制合体する
    // (既存の "alice-juggernaut" は 印字「〔重複不可〕」の対象外候補にはならず、任意選択
    // 自体が提示されない — voluntary な resolve_brave_combine_choice は存在しない)。
    expect(afterStack.pendingBraveCombineChoice).toBeNull();
    const newToken = afterStack.cardInstances.find(
      (cardInstance) =>
        cardInstance.definitionId === "BSES01-T01" &&
        cardInstance.instanceId !== "alice-juggernaut"
    );
    expect(newToken).toBeDefined();
    const resolved = finishCoreChoices(afterStack, getDef);

    expect(
      resolved.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "alice-c02-hand"
      )?.zone
    ).toBe("field");
    expect(
      resolved.flashEffectActivationLog.some(
        (entry) =>
          entry.sourceInstanceId === "alice-c02-hand" &&
          entry.sourceDefinitionId === "BSES01-C02" &&
          entry.effectIndex === 1
      )
    ).toBe(true);
  });
});

describe("BSES01-C05 [鷹揚]ハルト・キーツ", () => {
  const c = card("BSES01-C05");
  it("召喚時：デッキの下から1枚ドロー（ターンに1回:同名）", () => {
    const summon = c.effects![2]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    const draw = summon.steps[0]!.action;
    expect(draw.kind).toBe("draw");
    if (draw.kind === "draw") {
      expect(draw.count).toBe(1);
      expect(draw.position).toBe("bottom");
    }
    // 下からドロー位置指定が実装され stub は解消済み。
    expect(summon.stub).toBeUndefined();
  });
});

describe("BSES01-C06 [桜花]カイエ・タニヤ", () => {
  const c = card("BSES01-C06");
  it("合体中：相手による離脱時、ボイド→フィールド/リザーブにコア2（ターンに1回:同名）", () => {
    const leave = c.effects![2]!;
    expect(leave.applicability).toEqual({ combined: true });
    expect(leave.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: ["opponent_effect", "battle"],
    });
    const move = leave.steps[0]!.action;
    expect(move.kind).toBe("core_move");
    if (move.kind === "core_move") {
      expect(move.from).toEqual({ kind: "void", player: "self" });
      expect(move.amount).toBe(2);
      expect(
        move.splitDestinations!.destinations.map((d) => d.location.kind)
      ).toEqual(["field", "reserve"]);
    }
  });

  it("[board] field/reserve split で field pending 後も reserve 配分を失わない", () => {
    const source = createCardInstance(c, {
      instanceId: "c06-split-source",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 0,
      attachedToInstanceId: "c06-split-ally",
    });
    const ally = createCardInstance(card("BSES01-T01"), {
      instanceId: "c06-split-ally",
      ownerPlayerId: "player-1",
      controllerPlayerId: "player-1",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["c06-split-source"],
    });
    const base = createEmptyGameState({
      startingVoidNormalCoreCount: 2,
      cardInstances: [source, ally],
    });
    const reserveBefore = base.players.find(
      (p) => p.id === "player-1"
    )!.reserveNormalCoreCount;

    const opened = executeEffect({
      chainId: "test:bses01-cards:1171",
      state: base,
      effect: c.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: "c06-split-source",
      actingPlayerId: "player-1",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    });
    expect(opened.pendingCoreSplitSelection).not.toBeNull();

    const split = getLegalActions({
      state: opened,
      actingPlayerId: "player-1",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    }).find((a) => a.kind === "resolve_pending_core_split");
    expect(split).toBeDefined();
    const afterSplit = applyLegalAction({
      state: opened,
      action: split!,
      coreSplitDistribution: [1, 1],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    }).state;

    expect(afterSplit.pendingCoreSplitSelection).toBeNull();
    expect(afterSplit.pendingCoreDistribution).not.toBeNull();
    expect(
      afterSplit.players.find((p) => p.id === "player-1")!
        .reserveNormalCoreCount
    ).toBe(reserveBefore + 1);

    const distribution = getLegalActions({
      state: afterSplit,
      actingPlayerId: "player-1",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(distribution).toBeDefined();
    const resolved = applyLegalAction({
      state: afterSplit,
      action: distribution!,
      coreDistributionAllocations: { "c06-split-ally": 1 },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    }).state;

    expect(resolved.pendingCoreDistribution).toBeNull();
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === "c06-split-ally"
      )?.normalCoreCount
    ).toBe(2);
    expect(
      resolved.players.find((p) => p.id === "player-1")!.voidNormalCoreCount
    ).toBe(0);
    expect(
      resolved.players.find((p) => p.id === "player-1")!.reserveNormalCoreCount
    ).toBe(reserveBefore + 1);
  });
});

describe("BSES01-M02 [笑う狐]セオト・リッカ", () => {
  const c = card("BSES01-M02");
  it("合体中：フラッシュでこのスピリットを手札に戻す（self bounce、ターンに1回:同名）", () => {
    // effects[1]=通常コスト自己召喚, [2]=コスト0自己召喚, [3]=合体中の self bounce。
    const flash = c.effects![3]!;
    expect(flash.applicability).toEqual({ combined: true });
    expect(flash.timing).toEqual({ kind: "activated", mode: "flash" });
    const bounce = flash.steps[0]!.action;
    expect(bounce.kind).toBe("bounce");
    if (bounce.kind === "bounce")
      expect(bounce.target).toEqual({ kind: "self" });
  });
});

describe("BSES01-M03 [雪魔女]アンジュ・エマ", () => {
  const c = card("BSES01-M03");
  it("合体中：召喚/アタック/ブロック時、相手1体をアタック/ブロック不可", () => {
    const trig = c.effects![2]!;
    expect(trig.applicability).toEqual({ combined: true });
    expect(trig.timing).toEqual({
      kind: "card_event",
      event: ["summon", "attack", "block"],
    });
    const pb = trig.steps[0]!.action;
    expect(pb.kind).toBe("prevent_battle");
    if (pb.kind === "prevent_battle") {
      expect(pb.restriction).toEqual(["attack", "block"]);
      if (pb.target.kind === "filter")
        expect(pb.target.player).toBe("opponent");
    }
  });
});

describe("BSES01-M04 [狙撃手]クレナ・ククミラ", () => {
  const c = card("BSES01-M04");
  const trig = c.effects![2]!;

  it("合体中：相手1つデッキ下 + レーナのコア5個で対象+1（P3-14 D-6 choice 前置コスト）", () => {
    expect(trig.applicability).toEqual({ combined: true });
    expect(trig.stub).toBeUndefined();
    // mode step: 基本=相手1つデッキ下 / choice[0]=レーナのコア5個→ボイド。
    const mode = trig.steps[0]!;
    expect(mode.id).toBe("mode");
    const send1 = mode.action;
    expect(send1.kind).toBe("send_to_deck");
    if (send1.kind === "send_to_deck") {
      expect(send1.position).toBe("bottom");
      if (send1.target.kind === "filter") {
        expect(send1.target.player).toBe("opponent");
        expect(send1.target.count).toBe(1);
        expect(send1.target.filter.category).toEqual([
          "spirit",
          "ultimate",
          "nexus",
        ]);
      }
    }
    const costAction = mode.choice![0]!.action;
    expect(costAction.kind).toBe("core_move");
    if (costAction.kind === "core_move") {
      expect(costAction.amount).toBe(5);
      expect(costAction.to).toEqual({ kind: "void", player: "self" });
      if (costAction.from.kind === "field_card") {
        expect(costAction.from.player).toBe("self");
        expect(costAction.from.filter.category).toEqual(["nexus"]);
        expect(costAction.from.filter.cardName).toEqual({ contains: "レーナ" });
        // 「自分の導界者ネクサスの『レーナ』」= guided 排他
        // (verifier 2026-06-23 round 10 lens 1)。
        expect(costAction.from.filter.targetsGrandwalker).toBe("only");
        expect(costAction.from.filter.hasMechanic).toEqual(["guided"]);
      }
    }
    // 後段: conditional_cost で 2 体（=対象+1）。ref_choice gating。
    const expand = trig.steps[1]!;
    expect(expand.connector).toBe("conditional_cost");
    expect(expand.stepCondition).toEqual({
      kind: "ref_choice",
      stepId: "mode",
      choiceIndex: 1,
    });
    const send2 = expand.action;
    expect(send2.kind).toBe("send_to_deck");
    if (send2.kind === "send_to_deck" && send2.target.kind === "filter") {
      expect(send2.target.count).toBe(2);
    }
  });

  // 行動テスト: choice 前置コストの解決（template: choice-prepaid-cost.test.ts）。
  // 「自分の導界者ネクサスの『レーナ』」を満たすため grandwalkerData.kind:"guided" を付与
  // (verifier 2026-06-23 round 10 lens 1 補正)。
  function nexusDef(): CardDefinition {
    return {
      cardNo: "M04-NEXUS-レーナ",
      name: "[テスト]レーナ",
      printedCategory: "nexus",
      colors: ["white"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["white"],
      textLines: [],
      keywordTags: [],
      tribe: "導界者",
      sourceUrls: [],
      sourceConfidence: "C",
      grandwalkerData: { kind: "guided" },
    } as CardDefinition;
  }
  function spiritDef(no: string): CardDefinition {
    return {
      cardNo: no,
      name: no,
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
    } as CardDefinition;
  }
  function build(nexusCores: number): {
    state: GameState;
    defs: Map<string, CardDefinition>;
  } {
    const nx = nexusDef();
    const sp = spiritDef("M04-OPP-1");
    const sp2 = spiritDef("M04-OPP-2");
    const host = spiritDef("M04-HOST");
    // m04-1 を host に合体させて applicability { combined: true } を満たす。
    const m04 = createCardInstance(c, {
      instanceId: "m04-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const cards = [
      createCardInstance(nx, {
        instanceId: "lena-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: nexusCores,
      }),
      createCardInstance(host, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      { ...m04, attachedToInstanceId: "host-1" },
      createCardInstance(sp, {
        instanceId: "opp-1",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(sp2, {
        instanceId: "opp-2",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ];
    const defs = new Map<string, CardDefinition>([
      [nx.cardNo, nx],
      [c.cardNo, c],
      [sp.cardNo, sp],
      [sp2.cardNo, sp2],
      [host.cardNo, host],
    ]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: cards,
        startingVoidNormalCoreCount: 0,
      }),
      activePlayerId: "alice",
      step: "attack" as const,
    };
    return { state, defs };
  }
  function buildWithNonLenaCores(): {
    state: GameState;
    defs: Map<string, CardDefinition>;
  } {
    const built = build(3);
    const otherNexus: CardDefinition = {
      ...nexusDef(),
      cardNo: "M04-NEXUS-OTHER",
      name: "[テスト]別ネクサス",
    };
    return {
      state: {
        ...built.state,
        cardInstances: [
          ...built.state.cardInstances,
          createCardInstance(otherNexus, {
            instanceId: "other-nexus",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 5,
          }),
        ],
      },
      defs: new Map([...built.defs, [otherNexus.cardNo, otherNexus]]),
    };
  }
  const zoneOf = (s: GameState, id: string) =>
    s.cardInstances.find((c) => c.instanceId === id)?.zone;
  const coresOf = (s: GameState, id: string) =>
    s.cardInstances.find((c) => c.instanceId === id)?.normalCoreCount ?? 0;
  const voidOf = (s: GameState) =>
    s.players.find((p) => p.id === "alice")!.voidNormalCoreCount;
  const run = (
    s: GameState,
    defs: Map<string, CardDefinition>,
    choiceIndex: number,
    targets: string[]
  ) => {
    const getDefForTest = (id: string) => defs.get(id);
    return flushPendingLeaves(
      executeEffect({
        chainId: "test:bses01-cards:1458",
        state: s,
        effect: trig,
        sourceInstanceId: "m04-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDefForTest,
        getRegisteredTriggeredEffectActions: () => [],
        choiceIndex,
        targetInstanceIds: targets,
      }),
      getDefForTest
    );
  };

  it("choiceIndex=0 (基本): 相手1体のみデッキ下、レーナのコアは動かない", () => {
    const { state, defs } = build(5);
    const after = run(state, defs, 0, ["opp-1"]);
    expect(zoneOf(after, "opp-1")).toBe("deck");
    expect(zoneOf(after, "opp-2")).toBe("field");
    expect(coresOf(after, "lena-1")).toBe(5);
    expect(voidOf(after)).toBe(0);
  });

  it("choiceIndex=1 (コスト払い): レーナのコア5個→ボイド + 相手2体デッキ下", () => {
    const { state, defs } = build(5);
    const after = run(state, defs, 1, ["opp-1", "opp-2"]);
    expect(coresOf(after, "lena-1")).toBe(0);
    expect(voidOf(after)).toBe(5);
    expect(zoneOf(after, "opp-1")).toBe("deck");
    expect(zoneOf(after, "opp-2")).toBe("deck");
  });

  it("コア不足 (3個) → コスト no-op → 全体不発 (ことで双方向)", () => {
    const { state, defs } = build(3);
    const after = run(state, defs, 1, ["opp-1", "opp-2"]);
    expect(coresOf(after, "lena-1")).toBe(3);
    expect(voidOf(after)).toBe(0);
    expect(zoneOf(after, "opp-1")).toBe("field");
    expect(zoneOf(after, "opp-2")).toBe("field");
  });

  it("BSES01-M04 はレーナでないネクサスのコアを対象+1コストに使わない", () => {
    const { state, defs } = buildWithNonLenaCores();
    const after = run(state, defs, 1, ["opp-1", "opp-2"]);
    expect(coresOf(after, "lena-1")).toBe(3);
    expect(coresOf(after, "other-nexus")).toBe(5);
    expect(voidOf(after)).toBe(0);
    expect(zoneOf(after, "opp-1")).toBe("field");
    expect(zoneOf(after, "opp-2")).toBe("field");
  });

  it("BSES01-M04 は通常ネクサスの『レーナ』を対象+1コストに使わない (targetsGrandwalker:'only' 排他)", () => {
    // 通常ネクサスの「レーナ」名義（grandwalkerData なし）はコスト源にできない。
    // verifier 2026-06-23 round 10 lens 1 補正。
    const lenaNonGuided: CardDefinition = {
      ...nexusDef(),
      cardNo: "M04-NEXUS-レーナ-NON-GUIDED",
      name: "[テスト]通常レーナ",
      grandwalkerData: undefined,
    } as CardDefinition;
    const built = build(0); // lena-1 (guided) は cores=0 で不適格
    const stateWithNonGuided: GameState = {
      ...built.state,
      cardInstances: [
        ...built.state.cardInstances,
        createCardInstance(lenaNonGuided, {
          instanceId: "lena-non-guided",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 5,
        }),
      ],
    };
    const defsWith = new Map([
      ...built.defs,
      [lenaNonGuided.cardNo, lenaNonGuided],
    ]);
    const after = run(stateWithNonGuided, defsWith, 1, ["opp-1", "opp-2"]);
    // 通常レーナのコアは触られず、コスト不払い → 全体不発。
    expect(coresOf(after, "lena-non-guided")).toBe(5);
    expect(voidOf(after)).toBe(0);
    expect(zoneOf(after, "opp-1")).toBe("field");
    expect(zoneOf(after, "opp-2")).toBe("field");
  });
});

describe("BSES01-M01 [戦人狼]ライデン・シュガ", () => {
  const c = card("BSES01-M01");
  const summon = c.effects![2]!;

  it("召喚時はバースト手札戻し or effect-source stack 発揮不可の二択", () => {
    expect(summon.stub).toBeUndefined();
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    const base = summon.steps[0]!;
    expect(base.action.kind).toBe("discard_set_burst");
    const restrict = base.choice![0]!;
    expect(restrict.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
      maxCount: 1,
    });
    expect(restrict.action).toEqual({
      kind: "restrict_stack",
      player: "opponent",
      duration: { scope: "turn" },
      targetScope: "effect_source",
      effectFilter: { activatedMode: ["stack"] },
    });
  });

  function makeStackRestrictionState(immuneSource = false): GameState {
    const source = createCardInstance(c, {
      instanceId: "alice-bses01-m01",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const stackSource = createCardInstance(card("BSES01-C02"), {
      instanceId: "bob-stack-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, stackSource],
    });
    const immunity: ContinuousEffect[] = immuneSource
      ? [
          {
            effectId: "ce:bob-stack-source-immune",
            sourceInstanceId: "bob-stack-source",
            sourceDefinitionId: stackSource.definitionId,
            actingPlayerId: "bob",
            modifierTag: "defense_immune",
            targetInstanceId: "bob-stack-source",
            duration: { scope: "turn" },
            createdAtTurn: base.turnNumber,
            createdAtAttackId: null,
          },
        ]
      : [];
    return executeEffect({
      chainId: "test:bses01-cards:1601",
      state: { ...base, activeContinuousEffects: immunity },
      effect: summon,
      sourceInstanceId: "alice-bses01-m01",
      actingPlayerId: "alice",
      choiceIndex: 1,
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: () => [],
    });
  }

  function makeSummonPending(
    pendingId: string,
    sourceInstanceId = "alice-bses01-m01"
  ): PendingTriggeredEffect {
    return {
      pendingId,
      eventKind: "summon",
      actingPlayerId: "alice",
      source: "action_resolution",
      chainId: "test:bses01-cards:1616",
      attackId: null,
      relatedPlayerId: null,
      relatedInstanceId: sourceInstanceId,
      amount: null,
      step: "main",
      window: "default",
      resolvedSourceInstanceIds: [],
    } as PendingTriggeredEffect;
  }

  function makeTriggeredChoiceState(): GameState {
    const source = createCardInstance(c, {
      instanceId: "alice-bses01-m01",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const burst = createCardInstance(card("BSTH01-M13"), {
      instanceId: "bob-set-burst",
      ownerPlayerId: "bob",
      zone: "burst",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, burst],
    });
    return {
      ...base,
      step: "main",
      activePlayerId: "alice",
      pendingTriggeredEffects: [makeSummonPending("bses01-m01-pending-1")],
      setBurstStates: [{ playerId: "bob", cardInstanceId: "bob-set-burst" }],
    };
  }

  const triggeredChoiceLookups = {
    getCardDefinitionById: (id: string) => cardNoMap.get(id),
    getRegisteredTriggeredEffectActions: (cardNo: string) =>
      cardNo === c.cardNo ? generateTriggeredEffectRegistrations(c) : [],
    getRegisteredFieldCardEffectActions: noLookup,
    getRegisteredBurstActions: noLookup,
  };

  function getBses01TriggeredActions(state: GameState) {
    return getLegalActions({
      state,
      actingPlayerId: "alice",
      ...triggeredChoiceLookups,
    }).filter((a) => a.kind === "resolve_pending_triggered_effect") as Array<{
      kind: "resolve_pending_triggered_effect";
      choiceIndex?: number;
      deferredChoiceIndexes?: readonly number[];
      skipOnly?: boolean;
      [key: string]: unknown;
    }>;
  }

  function declareAndCloseTriggeredChoice(
    state: GameState,
    action: Parameters<typeof applyLegalAction>[0]["action"],
    choiceIndex: number
  ): GameState {
    const declared = applyLegalAction({
      state,
      action,
      ...triggeredChoiceLookups,
    });
    expect(declared.state.stackWindow).not.toBeNull();
    const passAction = getLegalActions({
      state: declared.state,
      actingPlayerId: "bob",
      ...triggeredChoiceLookups,
    }).find((a) => a.kind === "pass_stack");
    expect(passAction).toBeDefined();
    const afterStack = applyLegalAction({
      state: declared.state,
      action: passAction!,
      ...triggeredChoiceLookups,
    }).state;
    const choiceAction = getLegalActions({
      state: afterStack,
      actingPlayerId: "alice",
      ...triggeredChoiceLookups,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_pending_step_choice" &&
        candidate.choiceIndex === choiceIndex
    );
    expect(choiceAction).toBeDefined();
    return applyLegalAction({
      state: afterStack,
      action: choiceAction!,
      ...triggeredChoiceLookups,
    }).state;
  }

  it("effect-source restrict_stack は相手の通常 stack 効果を source 単位で除外する", () => {
    const after = makeStackRestrictionState();
    expect(
      filterRestrictedTimings(
        ["stack"],
        after,
        "bob",
        undefined,
        (id) => cardNoMap.get(id),
        undefined,
        "field",
        "bob-stack-source",
        { timingKind: "activated", activatedMode: "stack" }
      )
    ).toEqual([]);
  });

  it("effect-source restrict_stack は発揮元カードの相手効果耐性で回避される", () => {
    const after = makeStackRestrictionState(true);
    expect(
      filterRestrictedTimings(
        ["stack"],
        after,
        "bob",
        undefined,
        (id) => cardNoMap.get(id),
        undefined,
        "field",
        "bob-stack-source",
        { timingKind: "activated", activatedMode: "stack" }
      )
    ).toEqual(["stack"]);
  });

  it("effect-source restrict_stack は grant_effect 由来の stack 効果も除外する", () => {
    const after = makeStackRestrictionState();
    const withGrantedStack: GameState = {
      ...after,
      activeContinuousEffects: [
        ...after.activeContinuousEffects,
        {
          effectId: "ce:grant-stack",
          sourceInstanceId: "alice-bses01-m01",
          sourceDefinitionId: c.cardNo,
          actingPlayerId: "alice",
          modifierTag: "granted_effect",
          targetInstanceId: "bob-stack-source",
          duration: { scope: "turn" },
          createdAtTurn: after.turnNumber,
          createdAtAttackId: null,
          metadata: {
            grantedEffect: {
              timing: { kind: "activated", mode: "stack" },
              steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
            },
          },
        },
      ],
    };

    expect(
      getAvailableFieldCardEffectLegalActions(
        {
          state: withGrantedStack,
          actingPlayerId: "bob",
          getCardDefinitionById: (id) => cardNoMap.get(id),
          getRegisteredFieldCardEffectActions: noLookup,
          getRegisteredTriggeredEffectActions: noLookup,
        },
        "stack"
      ).filter((a) => a.reason === "granted_activated_effect")
    ).toEqual([]);
  });

  it("同名ゲーム1回の stack 発揮不可 choice は legal action 経路で封鎖され、バースト戻し choice は残る", () => {
    const state = makeTriggeredChoiceState();
    const firstActions = getBses01TriggeredActions(state).filter(
      (a) => a.skipOnly !== true
    );
    expect(firstActions).toHaveLength(1);
    expect(firstActions[0]?.choiceIndex).toBeUndefined();
    expect(firstActions[0]?.deferredChoiceIndexes).toEqual([0, 1]);

    const afterRestrict = declareAndCloseTriggeredChoice(
      state,
      firstActions[0]!,
      1
    );
    expect(
      afterRestrict.effectUsageRecords.some(
        (r) => r.effectLabel === "effect:2:choice:1"
      )
    ).toBe(true);
    // 一度きりの制限は後段の stack 封鎖 choice だけに所属する。前段の
    // バースト手札戻しはこの実行では選ばれず、盤面のバーストは残る。
    expect(
      afterRestrict.cardInstances.find(
        (instance) => instance.instanceId === "bob-set-burst"
      )?.zone
    ).toBe("burst");

    const secondState: GameState = {
      ...afterRestrict,
      pendingTriggeredEffects: [makeSummonPending("bses01-m01-pending-2")],
    };
    const secondActions = getBses01TriggeredActions(secondState).filter(
      (a) => a.skipOnly !== true
    );
    expect(secondActions).toHaveLength(1);
    expect(secondActions[0]?.choiceIndex).toBeUndefined();
    expect(secondActions[0]?.deferredChoiceIndexes).toEqual([0]);
  });
});

describe("BSES01-R01 [黒妖犬]ダイヤ・イルマ", () => {
  const c = card("BSES01-R01");
  it("合体中：召喚/アタック/ブロック時、相手1体の効果を発揮させない（suppress_effect entire）", () => {
    const trig = c.effects![2]!;
    expect(trig.applicability).toEqual({ combined: true });
    const sup = trig.steps[0]!.action;
    expect(sup.kind).toBe("suppress_effect");
    if (sup.kind === "suppress_effect") {
      expect(sup.scope).toBe("entire");
      expect(sup.duration).toEqual({ scope: "turn" });
      if (sup.target.kind === "filter")
        expect(sup.target.player).toBe("opponent");
    }
  });
});

describe("BSES01-R03 [火炎尾]レッカ・リン", () => {
  const c = card("BSES01-R03");
  it("合体中：フラッシュ自己破壊 + 破壊時 相手ライフ1コアをリザーブ", () => {
    const selfDestroy = c.effects![2]!;
    expect(selfDestroy.applicability).toEqual({ combined: true });
    expect(selfDestroy.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(selfDestroy.steps[0]!.action.kind).toBe("destroy");
    if (selfDestroy.steps[0]!.action.kind === "destroy") {
      expect(selfDestroy.steps[0]!.action.target).toEqual({ kind: "self" });
    }
    const onDestroy = c.effects![3]!;
    expect(onDestroy.timing).toEqual({ kind: "card_event", event: "destroy" });
    const move = onDestroy.steps[0]!.action;
    expect(move.kind).toBe("core_move");
    if (move.kind === "core_move") {
      expect(move.from).toEqual({ kind: "life", player: "opponent" });
      expect(move.to).toEqual({ kind: "reserve", player: "opponent" });
    }
    // stub は解消済み（消滅トリガーを実装したため）。
    expect(onDestroy.stub).toBeUndefined();
  });

  it("破壊/消滅時の報酬は destroy と vanish の 2 つの card_event で表現し、使用回数を共有する", () => {
    const onDestroy = c.effects![3]!;
    const onVanish = c.effects![4]!;
    expect(onVanish.timing).toEqual({
      kind: "card_event",
      event: "vanish",
      // 「自分による消滅では発揮されない」: self_effect を除く。
      cause: ["opponent_effect", "battle", "state_based"],
    });
    // 同名ターン1回を共有（limitGroupId で合算）。
    expect(onDestroy.limitGroupId).toBe("BSES01-R03-leave-reward");
    expect(onVanish.limitGroupId).toBe("BSES01-R03-leave-reward");
    // 報酬本体は同一（相手ライフ1コア→リザーブ）。
    const vmove = onVanish.steps[0]!.action;
    expect(vmove.kind).toBe("core_move");
    if (vmove.kind === "core_move") {
      expect(vmove.from).toEqual({ kind: "life", player: "opponent" });
      expect(vmove.to).toEqual({ kind: "reserve", player: "opponent" });
    }
  });

  it("vanish トリガーは消滅(相手起因/state-based)で発火し、自分による消滅では発火しない", () => {
    const regs = generateTriggeredEffectRegistrations(c);
    const vanishReg = regs.find((r) => r.eventKind === "vanish");
    expect(vanishReg).toBeDefined();
    // DSL event:"vanish" + cause が leave_field/causeKind:vanish の eventMatcher に解決される。
    expect(vanishReg!.eventMatcher).toEqual({
      family: "leave_field",
      causeKind: "vanish",
      cause: ["opponent_effect", "battle", "state_based"],
    });
    const matcher = vanishReg!.eventMatcher!;
    // 相手効果による消滅 → 発火する。
    expect(
      matchesTriggerEvent(matcher, {
        family: "leave_field",
        causeKind: "vanish",
        cause: "opponent_effect",
        validationMode: "snapshot_only",
      })
    ).toBe(true);
    // コア不足（state-based）による消滅 → 発火する。
    expect(
      matchesTriggerEvent(matcher, {
        family: "leave_field",
        causeKind: "vanish",
        cause: "state_based",
        validationMode: "snapshot_only",
      })
    ).toBe(true);
    // 自分の効果による消滅 → 発火しない。
    expect(
      matchesTriggerEvent(matcher, {
        family: "leave_field",
        causeKind: "vanish",
        cause: "self_effect",
        validationMode: "snapshot_only",
      })
    ).toBe(false);
    // 自分のコア移動由来 (state-based-self) の消滅 → 発火しない。
    // ENGINE-trigger-cause-self-state-based-exclude:
    // 「自分による消滅では発揮されない」を貫くため、自帰属 state-based を分離。
    expect(
      matchesTriggerEvent(matcher, {
        family: "leave_field",
        causeKind: "vanish",
        cause: "state_based_self",
        validationMode: "snapshot_only",
      })
    ).toBe(false);
    // 破壊 (causeKind:destroy) は vanish トリガーにマッチしない。
    expect(
      matchesTriggerEvent(matcher, {
        family: "leave_field",
        causeKind: "destroy",
        cause: "opponent_effect",
        validationMode: "snapshot_only",
      })
    ).toBe(false);
  });
});

describe("BSES01-X01 [葬儀屋]シンエイ・ノウゼン", () => {
  const c = card("BSES01-X01");
  it("合体中：行きつく果てまで 1枚以上 トラッシュのブレイヴ1枚につき自身BP+1000", () => {
    const tier1 = c.effects![2]!;
    expect(tier1.applicability).toEqual({ combined: true });
    const bp = tier1.steps[0]!.action;
    expect(bp.kind).toBe("bp_modify");
    if (bp.kind === "bp_modify") {
      expect(bp.target).toEqual({ kind: "self" });
      expect(typeof bp.amount === "object" && "source" in bp.amount).toBe(true);
      if (typeof bp.amount === "object" && "source" in bp.amount) {
        expect(bp.amount.multiplier).toBe(1000);
        expect(bp.amount.source.kind).toBe("cards_in_zone");
        if (bp.amount.source.kind === "cards_in_zone") {
          expect(bp.amount.source.zone).toBe("trash");
          expect(bp.amount.source.filter!.category).toEqual(["brave"]);
        }
      }
    }
  });

  it("合体中：行きつく果てまで 4枚以上 アタック/ブロック中フラッシュで自身BP以下の相手1体破壊 ([9] 実装済み)", () => {
    const tier2 = c.effects![3]!;
    expect(tier2.stub).toBeUndefined();
    expect(tier2.applicability).toEqual({ combined: true });
    expect(tier2.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(tier2.activationLabel).toBe("none");
    expect(tier2.executionMode).toBe("optional");
    expect(tier2.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
      maxCount: 1,
    });
    // 発揮条件: トラッシュのブレイヴ >= 4 ∧ 自身がアタック/ブロック中。
    const trashCond = tier2.condition!.find((c) => c.kind === "cards_in_zone")!;
    expect(trashCond).toBeDefined();
    if (trashCond.kind === "cards_in_zone") {
      expect(trashCond.zone).toBe("trash");
      expect(trashCond.filter!.category).toEqual(["brave"]);
      expect(trashCond.min).toBe(4);
    }
    expect(tier2.condition!.some((c) => c.kind === "in_battle")).toBe(true);
    // 動的 BP 比較破壊: maxBpSource=self_effective_bp、相手スピ/アル 1 体。
    const action = tier2.steps[0]!.action;
    if (action.kind === "destroy" && "filter" in action.target) {
      expect(action.target.filter.maxBpSource).toBe("self_effective_bp");
      expect(action.target.filter.category).toEqual(["spirit", "ultimate"]);
      expect(action.target.count).toBe(1);
      expect(action.target.player).toBe("opponent");
    } else {
      throw new Error("destroy filter target expected");
    }
  });

  // 動的 BP 比較破壊（maxBpSource: self_effective_bp）のエンジン実行（盤面: 自身BP以下のみ
  // 破壊予約・超過は残す）は、合体中ブレイヴ発動元では host BP を self として参照し、
  // 同じ「このスピリット」への BP+ も host に乗る。
  it("[board] 合体中ブレイヴ由来の BP以下破壊は host の修正込み実効BPを参照する", () => {
    const hostDef: CardDefinition = {
      cardNo: "TEST-BSES01-HOST",
      name: "テストホスト",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const lookup = (id: string) =>
      id === hostDef.cardNo ? hostDef : cardNoMap.get(id);
    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "player-1",
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedChildrenIds: ["x01-brave"],
    };
    const brave = {
      ...createCardInstance(c, {
        instanceId: "x01-brave",
        ownerPlayerId: "player-1",
        zone: "field",
      }),
      attachedToInstanceId: "host-1",
    };
    const boostedReachDef: CardDefinition = {
      cardNo: "TEST-BSES01-BOOSTED-REACH",
      name: "BP修正込み対象",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 6,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 8000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const boostedReach = createCardInstance(boostedReachDef, {
      instanceId: "boosted-reach-1",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 1,
    });
    const tooHighDef: CardDefinition = {
      cardNo: "TEST-BSES01-TOO-HIGH",
      name: "超過BP対象",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 8,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 10000 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const tooHigh = createCardInstance(tooHighDef, {
      instanceId: "too-high-1",
      ownerPlayerId: "player-2",
      zone: "field",
      normalCoreCount: 1,
    });
    const trashBraves = Array.from({ length: 4 }, (_, index) =>
      createCardInstance(c, {
        instanceId: `trash-brave-${index + 1}`,
        ownerPlayerId: "player-1",
        zone: "trash",
      })
    );
    const state = createEmptyGameState({
      cardInstances: [host, brave, boostedReach, tooHigh, ...trashBraves],
    });
    const getCardDefinitionById = (id: string) =>
      id === boostedReachDef.cardNo
        ? boostedReachDef
        : id === tooHighDef.cardNo
          ? tooHighDef
          : lookup(id);

    const withBpModifier = executeEffect({
      chainId: "test:bses01-cards:2100",
      state,
      effect: c.effects![2]!,
      sourceInstanceId: "x01-brave",
      actingPlayerId: "player-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(
      withBpModifier.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "bp_modifier" && ce.targetInstanceId === "host-1"
      )
    ).toBe(true);

    const result = executeEffect({
      chainId: "test:bses01-cards:2115",
      state: withBpModifier,
      effect: { ...c.effects![3]!, condition: undefined },
      sourceInstanceId: "x01-brave",
      actingPlayerId: "player-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(
      result.cardInstances.find(
        (card) => card.instanceId === "boosted-reach-1"
      )!.pendingLeaveKind
    ).toBe("destroy");
    expect(
      result.cardInstances.find((card) => card.instanceId === "too-high-1")!
        .pendingLeaveKind
    ).toBeNull();
  });

  it("合体中：行きつく果てまで 8枚以上 バトル終了時ターンに1回回復 (cards_in_zone min:8)", () => {
    const tier3 = c.effects![4]!;
    expect(tier3.stub).toBeUndefined();
    expect(tier3.applicability).toEqual({ combined: true });
    expect(tier3.timing).toEqual({ kind: "card_event", event: "battle_end" });
    expect(tier3.usageLimit).toEqual({
      kind: "per_instance",
      duration: "turn",
      maxCount: 1,
    });
    const cond = tier3.condition![0]!;
    expect(cond.kind).toBe("cards_in_zone");
    if (cond.kind === "cards_in_zone") {
      expect(cond.player).toBe("self");
      expect(cond.zone).toBe("trash");
      expect(cond.filter!.category).toEqual(["brave"]);
      expect(cond.min).toBe(8);
    }
    expect(tier3.steps[0]!.action.kind).toBe("recover");
  });
});

describe("BSES01 ブレイヴ: フラッシュ自己召喚 [2,3] が手札起動効果として実装済み", () => {
  // effects[1] が「フラッシュ『お互いのアタックステップ』手札/手元のこのカードは召喚できる」。
  // costModifier未指定=通常コスト(軽減適用) / override=軽減前コスト上書き。
  it.each([
    ["BSES01-C02", null],
    ["BSES01-C05", null],
    ["BSES01-C06", null],
    ["BSES01-M02", null],
    ["BSES01-M03", null],
    ["BSES01-M04", 2],
    ["BSES01-R01", null],
    ["BSES01-R03", null],
    ["BSES01-X01", 2],
  ] as Array<[string, number | null]>)(
    "%s: 自己召喚起動効果 (fixedPayment=%s)",
    (no, fixedPayment) => {
      const c = card(no);
      const eff = c.effects![1]!;
      expect(eff.stub).toBeUndefined();
      expect(eff.timing).toEqual({ kind: "activated", mode: "flash" });
      expect(eff.timingScope).toEqual({ player: "both", period: "attack" });
      expect(eff.applicability).toEqual({ zone: ["hand", "set_aside"] });
      const action = eff.steps[0]!.action;
      expect(action.kind).toBe("summon");
      if (action.kind === "summon") {
        expect(action.target).toEqual({ kind: "self" });
        if (fixedPayment === null) {
          expect(action.costModifier).toBeUndefined();
        } else {
          expect(action.costModifier).toEqual({ override: fixedPayment });
        }
      }
    }
  );

  it("BSES01-M02: 〔ターンに1回:同名〕無料召喚を別効果 [2] で表現", () => {
    const eff = card("BSES01-M02").effects![2]!;
    expect(eff.stub).toBeUndefined();
    expect(eff.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(eff.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    const action = eff.steps[0]!.action;
    expect(action.kind).toBe("summon");
    if (action.kind === "summon") {
      expect(action.costModifier).toBe("free");
    }
  });
});

describe("BSES01-C03 迎撃砲", () => {
  const c = card("BSES01-C03");

  it("[0,1] フラッシュ『お互いのアタックステップ』手札/手元のこのネクサスは配置できる（自己配置起動効果）", () => {
    const place = c.effects![0]!;
    expect(place.stub).toBeUndefined();
    expect(place.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(place.timingScope).toEqual({ player: "both", period: "attack" });
    expect(place.applicability?.zone).toEqual(["hand", "set_aside"]);
    expect(place.executionMode).toBe("optional");
    const action = place.steps[0]!.action;
    expect(action.kind).toBe("summon");
    if (action.kind === "summon") {
      expect(action.target.kind).toBe("self");
    }
  });

  it("[3,4] スタック『自分のアタックステップ』ブロック宣言する相手1体を手札に戻す（ターン1回:同名）", () => {
    const bounce = c.effects![1]!;
    expect(bounce.stub).toBeUndefined();
    expect(bounce.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(bounce.timingScope).toEqual({ player: "self", period: "attack" });
    expect(bounce.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    const action = bounce.steps[0]!.action;
    expect(action.kind).toBe("bounce");
    if (action.kind === "bounce" && action.target.kind === "filter") {
      expect(action.target.player).toBe("opponent");
      expect(action.target.filter.category).toEqual(["spirit", "ultimate"]);
      expect(action.target.filter.battleState).toBe("blocking");
      expect(action.target.count).toBe(1);
    }
  });

  it("[6,7] 自分のジャガーノートのアタック宣言成立時、カウント6以上＋レーナ在場でこのネクサスのコア2個をボイドに置きライフ減少を防げなくする", () => {
    const lifeImmune = c.effects![2]!;
    expect(lifeImmune.stub).toBeUndefined();
    expect(lifeImmune.timing).toMatchObject({
      kind: "game_event",
      player: "self",
      event: "attack",
      triggerFilter: { cardName: { contains: "ジャガーノート" } },
    });
    expect(lifeImmune.executionMode).toBe("optional");
    expect(lifeImmune.condition).toContainEqual({
      kind: "count_value",
      player: "self",
      min: 6,
    });
    expect(lifeImmune.condition).toContainEqual({
      kind: "cards_in_zone",
      player: "self",
      zone: "field",
      filter: {
        category: ["nexus"],
        cardName: { contains: "レーナ" },
        targetsGrandwalker: "only",
        hasMechanic: ["guided"],
      },
      min: 1,
    });
    expect(lifeImmune.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "this_card" },
      to: { kind: "void", player: "self" },
      amount: 2,
    });
    expect(lifeImmune.steps[1]!.stepCondition).toEqual({
      kind: "ref_succeeded",
      stepId: "c03-life-damage-unpreventable-cost",
    });
    expect(lifeImmune.steps[1]!.action).toEqual({
      kind: "grant_life_damage_source_prevention_immunity",
      player: "self",
      sourceFilter: { cardName: { contains: "ジャガーノート" } },
      duration: { scope: "battle" },
    });
  });

  it("[6,7 解決] ジャガーノートのアタック宣言後にコア2個を支払うと、このバトルのジャガーノート起因ライフ減少が相手の防止を貫通する", () => {
    const nexus = createCardInstance(c, {
      instanceId: "c03-life-immune-nexus",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 3,
    });
    const lena = createCardInstance(card("BSES01-CX01"), {
      instanceId: "c03-life-immune-lena",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 4,
    });
    const juggernaut = createCardInstance(card("BSES01-T01"), {
      instanceId: "c03-life-immune-juggernaut",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [nexus, lena, juggernaut],
        playerOverrides: [{ countValue: 6 }, {}],
      }),
      step: "attack" as const,
      turnNumber: 1,
      activePlayerId: "alice",
    };
    const effectLookups = {
      getRegisteredTriggeredEffectActions: (cardNo: string) => {
        const def = cardNoMap.get(cardNo);
        return def ? generateTriggeredEffectRegistrations(def) : [];
      },
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    };

    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: juggernaut.instanceId,
      getCardDefinitionById: getDef,
      ...effectLookups,
    });
    expect(tentative.window).toBe("pre_declaration_stack");
    const confirmed = applyLegalAction({
      state: tentative,
      action: {
        kind: "pass_pre_declaration_stack",
        actionId: "pass-pre-decl:bob",
        can: true,
        reason: "test",
        actingPlayerId: "bob",
      } as never,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    const attackPending = confirmed.pendingTriggeredEffects.find(
      (p) =>
        p.eventKind === "attack" &&
        p.relatedInstanceId === juggernaut.instanceId
    );
    expect(attackPending).toBeDefined();
    const attackId = confirmed.activeAttack?.attackId;
    expect(attackId).toBeTruthy();

    const resolveC03 = getLegalActions({
      state: confirmed,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === nexus.instanceId
    );
    expect(resolveC03).toBeDefined();

    const afterDeclare = applyLegalAction({
      state: confirmed,
      action: resolveC03!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const after = passStackUntilClosed(afterDeclare, effectLookups);

    expect(
      after.cardInstances.find((c) => c.instanceId === nexus.instanceId)
        ?.normalCoreCount
    ).toBe(1);
    const grant = after.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "life_damage_source_prevention_immunity"
    );
    expect(grant).toMatchObject({
      sourceInstanceId: nexus.instanceId,
      targetInstanceId: "alice",
      duration: { scope: "battle" },
      createdAtAttackId: attackId,
      metadata: { sourceFilter: { cardName: { contains: "ジャガーノート" } } },
    });
  });

  it("[6,7 未充足] カウント6未満なら、コア支払い解決アクションを提示しない", () => {
    const nexus = createCardInstance(c, {
      instanceId: "c03-life-unmet-nexus",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 3,
    });
    const lena = createCardInstance(card("BSES01-CX01"), {
      instanceId: "c03-life-unmet-lena",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 4,
    });
    const juggernaut = createCardInstance(card("BSES01-T01"), {
      instanceId: "c03-life-unmet-juggernaut",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [nexus, lena, juggernaut],
        playerOverrides: [{ countValue: 5 }, {}],
      }),
      step: "attack" as const,
      turnNumber: 1,
      activePlayerId: "alice",
    };
    const effectLookups = {
      getRegisteredTriggeredEffectActions: (cardNo: string) => {
        const def = cardNoMap.get(cardNo);
        return def ? generateTriggeredEffectRegistrations(def) : [];
      },
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    };

    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: juggernaut.instanceId,
      getCardDefinitionById: getDef,
      ...effectLookups,
    });
    const confirmed = applyLegalAction({
      state: tentative,
      action: {
        kind: "pass_pre_declaration_stack",
        actionId: "pass-pre-decl:bob",
        can: true,
        reason: "test",
        actingPlayerId: "bob",
      } as never,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    const resolveC03 = getLegalActions({
      state: confirmed,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === nexus.instanceId
    );
    expect(resolveC03).toBeUndefined();
  });

  it("[board] ブロック中の相手スピリットを手札に戻す（非ブロック相手は残る）", () => {
    const nexus = createCardInstance(c, {
      instanceId: "nexus-c03",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const blocker = createCardInstance(card("BSES01-T01"), {
      instanceId: "opp-block",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const idle = createCardInstance(card("BSES01-T01"), {
      instanceId: "opp-idle",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [nexus, blocker, idle],
      }),
      activePlayerId: "alice",
      step: "attack" as const,
      // ブロック状態は battleEntities の attackState で表現する。
      battleEntities: [
        {
          entityId: "battle-opp-block",
          memberInstanceIds: ["opp-block"],
          resolvedBp: 4000,
          resolvedSymbols: [],
          attackState: "blocking",
        },
      ],
    };
    const after = flushPendingLeaves(
      executeEffect({
        chainId: "test:bses01-cards:2510",
        state,
        effect: c.effects![1]!,
        sourceInstanceId: "nexus-c03",
        actingPlayerId: "alice",
        getCardDefinitionById: (id: string) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions: () => [],
      }),
      (id) => cardNoMap.get(id)
    );
    const zoneOf = (id: string) =>
      after.cardInstances.find((x) => x.instanceId === id)?.zone;
    // ブロック中のトークンは離場してトークンプールへ戻る。非ブロックの相手は場に残る。
    expect(zoneOf("opp-block")).toBe("removed_from_game");
    expect(zoneOf("opp-idle")).toBe("field");
  });
});

describe("BSES01-CX01 レーナ・ミリーゼ", () => {
  const c = card("BSES01-CX01");

  it("【契約域】は対象開示時とバトル終了時にCX01のコア2個を支払いジャガーノートを手札へ戻す", () => {
    const targeted = c.effects![1]!;
    expect(targeted.stub).toBeUndefined();
    expect(targeted.executionMode).toBe("optional");
    expect(targeted.timing).toMatchObject({
      kind: "game_event",
      player: "self",
      event: "targeted",
      triggerFilter: { cardName: [{ contains: "ジャガーノート" }] },
      cause: ["opponent_effect"],
    });
    expect(targeted.condition).toContainEqual({ kind: "min_level", value: 2 });
    expect(targeted.usageLimit).toContainEqual({
      kind: "per_instance",
      duration: "turn",
    });
    expect(targeted.steps[0]!.action).toEqual({
      kind: "core_move",
      from: { kind: "this_card" },
      to: { kind: "void", player: "self" },
      amount: {
        source: { kind: "trigger_related_instances" },
        multiplier: 2,
      },
    });
    expect(targeted.steps[1]!.connector).toBe("conditional_cost");
    expect(targeted.steps[1]!.action).toEqual({
      kind: "bounce",
      target: { kind: "trigger_related_instances" },
    });

    const battleEnd = c.effects![2]!;
    expect(battleEnd.stub).toBeUndefined();
    expect(battleEnd.executionMode).toBe("optional");
    expect(battleEnd.timing).toMatchObject({
      kind: "game_event",
      player: "self",
      event: "battle_end",
      triggerFilter: { cardName: [{ contains: "ジャガーノート" }] },
    });
    expect(battleEnd.steps).toEqual(targeted.steps);
  });

  function createTargetDisclosureState(options?: {
    effectUsageRecords?: GameState["effectUsageRecords"];
    juggernautInstanceId?: string;
    juggernautInstanceIds?: string[];
    lenaCores?: number;
    juggernautCores?: number;
    targetCount?: number;
  }) {
    const coreMagic: CardDefinition = {
      cardNo: "TEST-BSES01-CX01-CORE",
      name: "テスト相手コア移動マジック",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: ["相手のジャガーノート1体のコア2個をボイドに置く。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "cores",
              action: {
                kind: "core_move",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { cardName: [{ contains: "ジャガーノート" }] },
                  count: options?.targetCount ?? 1,
                },
                from: { kind: "target_card" },
                to: { kind: "void", player: "opponent" },
                amount: 2,
              },
            },
          ],
        },
      ],
    };
    const lena = createCardInstance(c, {
      instanceId: "bses01-cx01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: options?.lenaCores ?? 4,
    });
    const juggernautInstanceIds = options?.juggernautInstanceIds ?? [
      options?.juggernautInstanceId ?? "bses01-cx01-juggernaut",
    ];
    const juggernauts = juggernautInstanceIds.map((instanceId) =>
      createCardInstance(card("BSES01-T01"), {
        instanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: options?.juggernautCores ?? 1,
      })
    );
    const juggernaut = juggernauts[0]!;
    const magic = createCardInstance(coreMagic, {
      instanceId: "bses01-cx01-magic",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [lena, ...juggernauts, magic],
      playerOverrides: [{ countValue: 4 }, {}],
    });
    const definitions = [...ALL_CARDS, coreMagic];
    const getDef = (id: string): CardDefinition | undefined =>
      id === coreMagic.cardNo ? coreMagic : cardNoMap.get(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions: (cardNo: string) => {
        const def = definitions.find((d) => d.cardNo === cardNo);
        return def ? generateTriggeredEffectRegistrations(def) : [];
      },
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    };
    return {
      baseState: {
        ...baseState,
        effectUsageRecords:
          options?.effectUsageRecords ?? baseState.effectUsageRecords,
      },
      coreMagic,
      effectLookups,
      getDef,
      juggernaut,
      juggernauts,
      lena,
      magic,
    };
  }

  it("対象開示応答でコア2個を支払い、元効果解決前にBSES01-T01を手札へ戻す", () => {
    const {
      baseState,
      coreMagic,
      effectLookups,
      getDef,
      juggernaut,
      lena,
      magic,
    } = createTargetDisclosureState();
    const disclosure = executeEffect({
      chainId: "test:bses01-cards:2687",
      state: baseState,
      effect: coreMagic.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
      targetInstanceIds: [juggernaut.instanceId],
      targetStepId: "cores",
      effectActionKind: "magic",
    });

    expect(disclosure.pendingTargetedDisclosureContinuation).toMatchObject({
      sourceDefinitionId: coreMagic.cardNo,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      targetInstanceIds: [juggernaut.instanceId],
      targetStepId: "cores",
    });
    expect(disclosure.pendingTriggeredEffects[0]).toMatchObject({
      eventKind: "targeted",
      relatedInstanceId: juggernaut.instanceId,
      effectSourceDefinitionId: coreMagic.cardNo,
      effectSourceInstanceId: magic.instanceId,
    });

    const resolveLena = getLegalActions({
      state: disclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === lena.instanceId
    );
    expect(resolveLena).toBeDefined();
    expect(resolveLena).toMatchObject({ executionMode: "optional" });

    const afterDeclare = applyLegalAction({
      state: disclosure,
      action: resolveLena!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const pass = getLegalActions({
      state: afterDeclare,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();

    const after = applyLegalAction({
      state: afterDeclare,
      action: pass!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    expect(
      after.cardInstances.find((card) => card.instanceId === lena.instanceId)
        ?.normalCoreCount
    ).toBe(2);
    const moved = after.cardInstances.find(
      (card) => card.instanceId === juggernaut.instanceId
    );
    expect(moved?.zone).toBe("removed_from_game");
    expect(moved?.pendingLeaveKind).toBeNull();
    expect(after.pendingTargetedDisclosureContinuation).toBeNull();
    expect(after.log).toContain(
      "effect:core_move:this_card:bses01-cx01-field->void:alice:2"
    );
    const bounceIndex = after.log.findIndex(
      (entry) => entry === "effect:bounce:bses01-cx01-juggernaut:to_hand"
    );
    expect(bounceIndex).toBeGreaterThanOrEqual(0);
  });

  it("対象開示応答を任意で使わない場合、元効果だけが解決される", () => {
    const {
      baseState,
      coreMagic,
      effectLookups,
      getDef,
      juggernaut,
      lena,
      magic,
    } = createTargetDisclosureState({ juggernautCores: 3 });
    const disclosure = executeEffect({
      chainId: "test:bses01-cards:2777",
      state: baseState,
      effect: coreMagic.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
      targetInstanceIds: [juggernaut.instanceId],
      targetStepId: "cores",
      effectActionKind: "magic",
    });
    const resolveLena = getLegalActions({
      state: disclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === lena.instanceId
    );
    expect(resolveLena).toBeDefined();

    const after = applyLegalAction({
      state: disclosure,
      action: resolveLena!,
      skipOptionalEffect: true,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    const unchangedLena = after.cardInstances.find(
      (card) => card.instanceId === lena.instanceId
    );
    const target = after.cardInstances.find(
      (card) => card.instanceId === juggernaut.instanceId
    );
    expect(unchangedLena?.normalCoreCount).toBe(4);
    expect(target?.zone).toBe("field");
    expect(target?.normalCoreCount).toBe(1);
    expect(after.pendingTargetedDisclosureContinuation).toBeNull();
    expect(after.log).not.toContain(
      "effect:bounce:bses01-cx01-juggernaut:to_hand"
    );
  });

  it("発揮宣言後にCX01のコアが2個未満なら対象を手札へ戻さない", () => {
    const {
      baseState,
      coreMagic,
      effectLookups,
      getDef,
      juggernaut,
      lena,
      magic,
    } = createTargetDisclosureState({ juggernautCores: 3 });
    const disclosure = executeEffect({
      chainId: "test:bses01-cards:2834",
      state: baseState,
      effect: coreMagic.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
      targetInstanceIds: [juggernaut.instanceId],
      targetStepId: "cores",
      effectActionKind: "magic",
    });
    const resolveLena = getLegalActions({
      state: disclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === lena.instanceId
    );
    expect(resolveLena).toBeDefined();

    const afterDeclare = applyLegalAction({
      state: disclosure,
      action: resolveLena!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const afterCoreLost = {
      ...afterDeclare,
      cardInstances: afterDeclare.cardInstances.map((card) =>
        card.instanceId === lena.instanceId
          ? { ...card, normalCoreCount: 1 }
          : card
      ),
    };
    const pass = getLegalActions({
      state: afterCoreLost,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();

    const after = applyLegalAction({
      state: afterCoreLost,
      action: pass!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    const target = after.cardInstances.find(
      (card) => card.instanceId === juggernaut.instanceId
    );
    expect(
      after.cardInstances.find((card) => card.instanceId === lena.instanceId)
        ?.normalCoreCount
    ).toBe(1);
    expect(target?.zone).toBe("field");
    expect(target?.normalCoreCount).toBe(1);
    expect(after.log).not.toContain(
      "effect:bounce:bses01-cx01-juggernaut:to_hand"
    );
    expect(after.pendingTargetedDisclosureContinuation).toBeNull();
  });

  it("同一対象開示で2体対象になった場合、4コア支払いで2体とも手札へ戻す", () => {
    const {
      baseState,
      coreMagic,
      effectLookups,
      getDef,
      juggernauts,
      lena,
      magic,
    } = createTargetDisclosureState({
      juggernautInstanceIds: [
        "bses01-cx01-juggernaut-target-1",
        "bses01-cx01-juggernaut-target-2",
      ],
      juggernautCores: 3,
      lenaCores: 6,
      targetCount: 2,
    });
    const targetIds = juggernauts.map((card) => card.instanceId);
    const disclosure = executeEffect({
      chainId: "test:bses01-cards:2921",
      state: baseState,
      effect: coreMagic.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: magic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
      targetInstanceIds: targetIds,
      targetStepId: "cores",
      effectActionKind: "magic",
    });

    const resolveLena = getLegalActions({
      state: disclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === lena.instanceId
    );
    expect(resolveLena).toBeDefined();
    const afterDeclare = applyLegalAction({
      state: disclosure,
      action: resolveLena!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    const pass = getLegalActions({
      state: afterDeclare,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    const after = applyLegalAction({
      state: afterDeclare,
      action: pass!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;

    expect(
      after.cardInstances.find((card) => card.instanceId === lena.instanceId)
        ?.normalCoreCount
    ).toBe(2);
    for (const targetId of targetIds) {
      expect(
        after.cardInstances.find((card) => card.instanceId === targetId)?.zone
      ).toBe("removed_from_game");
    }
    expect(after.log).toContain(
      "effect:core_move:this_card:bses01-cx01-field->void:alice:4"
    );
  });

  it("対象開示応答は同一ターン2回目を別ジャガーノートでも使用できない", () => {
    const first = createTargetDisclosureState({
      juggernautInstanceId: "bses01-cx01-juggernaut-1",
    });
    const firstDisclosure = executeEffect({
      chainId: "test:bses01-cards:2983",
      state: first.baseState,
      effect: first.coreMagic.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: first.magic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: first.getDef,
      ...first.effectLookups,
      targetInstanceIds: [first.juggernaut.instanceId],
      targetStepId: "cores",
      effectActionKind: "magic",
    });
    const firstResolve = getLegalActions({
      state: firstDisclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: first.getDef,
      ...first.effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === first.lena.instanceId
    );
    expect(firstResolve).toBeDefined();
    const firstDeclare = applyLegalAction({
      state: firstDisclosure,
      action: firstResolve!,
      getCardDefinitionById: first.getDef,
      ...first.effectLookups,
    }).state;
    const firstPass = getLegalActions({
      state: firstDeclare,
      actingPlayerId: "bob",
      getCardDefinitionById: first.getDef,
      ...first.effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(firstPass).toBeDefined();
    const afterFirst = applyLegalAction({
      state: firstDeclare,
      action: firstPass!,
      getCardDefinitionById: first.getDef,
      ...first.effectLookups,
    }).state;
    expect(afterFirst.effectUsageRecords.length).toBeGreaterThan(0);

    const second = createTargetDisclosureState({
      effectUsageRecords: afterFirst.effectUsageRecords,
      juggernautInstanceId: "bses01-cx01-juggernaut-2",
    });
    const secondDisclosure = executeEffect({
      chainId: "test:bses01-cards:3031",
      state: second.baseState,
      effect: second.coreMagic.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: second.magic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: second.getDef,
      ...second.effectLookups,
      targetInstanceIds: [second.juggernaut.instanceId],
      targetStepId: "cores",
      effectActionKind: "magic",
    });
    const secondResolve = getLegalActions({
      state: secondDisclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: second.getDef,
      ...second.effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === second.lena.instanceId &&
        action.skipOnly !== true
    );
    expect(secondResolve).toBeUndefined();
  });

  function createBattleEndState(options?: {
    effectUsageRecords?: GameState["effectUsageRecords"];
    juggernautInstanceId?: string;
    juggernautInstanceIds?: string[];
    lenaCores?: number;
    juggernautCores?: number;
  }) {
    const lena = createCardInstance(c, {
      instanceId: "bses01-cx01-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: options?.lenaCores ?? 4,
    });
    const juggernautInstanceIds = options?.juggernautInstanceIds ?? [
      options?.juggernautInstanceId ?? "bses01-cx01-juggernaut",
    ];
    const juggernauts = juggernautInstanceIds.map((instanceId) =>
      createCardInstance(card("BSES01-T01"), {
        instanceId,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: options?.juggernautCores ?? 1,
      })
    );
    const juggernaut = juggernauts[0]!;
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [lena, ...juggernauts],
      playerOverrides: [{ countValue: 4 }, {}],
    });
    const stateWithUsage: GameState = {
      ...baseState,
      effectUsageRecords:
        options?.effectUsageRecords ?? baseState.effectUsageRecords,
    };
    const getDef = (id: string): CardDefinition | undefined =>
      cardNoMap.get(id);
    const effectLookups = {
      getRegisteredTriggeredEffectActions: (cardNo: string) => {
        const def = cardNoMap.get(cardNo);
        return def ? generateTriggeredEffectRegistrations(def) : [];
      },
      getRegisteredBurstActions: noLookup,
      getRegisteredFieldCardEffectActions: noLookup,
    };
    const queued = queueBattleEndTriggers({
      state: stateWithUsage,
      participantInstanceIds: juggernauts.map((card) => card.instanceId),
      attackId: "attack:bses01-cx01",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions:
        effectLookups.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: noLookup,
    });
    return { effectLookups, getDef, juggernaut, juggernauts, lena, queued };
  }

  it("対象開示応答を使った同一ターンでもバトル終了時応答は別枠で使用できる", () => {
    const targeted = createTargetDisclosureState({
      juggernautInstanceId: "bses01-cx01-juggernaut-targeted",
    });
    const disclosure = executeEffect({
      chainId: "test:bses01-cards:3120",
      state: targeted.baseState,
      effect: targeted.coreMagic.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: targeted.magic.instanceId,
      actingPlayerId: "bob",
      getCardDefinitionById: targeted.getDef,
      ...targeted.effectLookups,
      targetInstanceIds: [targeted.juggernaut.instanceId],
      targetStepId: "cores",
      effectActionKind: "magic",
    });
    const resolveTargeted = getLegalActions({
      state: disclosure,
      actingPlayerId: "alice",
      getCardDefinitionById: targeted.getDef,
      ...targeted.effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === targeted.lena.instanceId
    );
    expect(resolveTargeted).toBeDefined();
    const declared = applyLegalAction({
      state: disclosure,
      action: resolveTargeted!,
      getCardDefinitionById: targeted.getDef,
      ...targeted.effectLookups,
    }).state;
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      getCardDefinitionById: targeted.getDef,
      ...targeted.effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    const afterTargeted = applyLegalAction({
      state: declared,
      action: pass!,
      getCardDefinitionById: targeted.getDef,
      ...targeted.effectLookups,
    }).state;

    const battleEnd = createBattleEndState({
      effectUsageRecords: afterTargeted.effectUsageRecords,
      juggernautInstanceId: "bses01-cx01-juggernaut-battle-end",
    });
    const resolveBattleEnd = getLegalActions({
      state: battleEnd.queued,
      actingPlayerId: "alice",
      getCardDefinitionById: battleEnd.getDef,
      ...battleEnd.effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === battleEnd.lena.instanceId &&
        action.eventKind === "battle_end"
    );
    expect(resolveBattleEnd).toBeDefined();
  });

  function resolveBattleEndLena(
    queued: GameState,
    lenaInstanceId: string,
    getDef: (id: string) => CardDefinition | undefined,
    effectLookups: {
      getRegisteredTriggeredEffectActions: (
        cardNo: string
      ) => ReturnType<typeof generateTriggeredEffectRegistrations>;
      getRegisteredBurstActions: typeof noLookup;
      getRegisteredFieldCardEffectActions: typeof noLookup;
    },
    options?: { skip?: boolean; afterDeclare?: (state: GameState) => GameState }
  ): GameState {
    const resolveLena = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === lenaInstanceId &&
        action.eventKind === "battle_end"
    );
    expect(resolveLena).toBeDefined();
    expect(resolveLena).toMatchObject({ executionMode: "optional" });

    const afterDeclare = applyLegalAction({
      state: queued,
      action: resolveLena!,
      ...(options?.skip ? { skipOptionalEffect: true } : {}),
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
    if (options?.skip) return afterDeclare;

    const stateForPass = options?.afterDeclare?.(afterDeclare) ?? afterDeclare;
    const pass = getLegalActions({
      state: stateForPass,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    return applyLegalAction({
      state: stateForPass,
      action: pass!,
      getCardDefinitionById: getDef,
      ...effectLookups,
    }).state;
  }

  it("バトル終了時もCX01のコア2個を支払いBSES01-T01を手札へ戻す", () => {
    const { effectLookups, getDef, juggernaut, lena, queued } =
      createBattleEndState();
    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.eventKind === "battle_end" && p.actingPlayerId === "alice"
    );
    expect(pending).toMatchObject({
      relatedInstanceId: juggernaut.instanceId,
      eventKind: "battle_end",
    });

    const after = resolveBattleEndLena(
      queued,
      lena.instanceId,
      getDef,
      effectLookups
    );

    expect(
      after.cardInstances.find((card) => card.instanceId === lena.instanceId)
        ?.normalCoreCount
    ).toBe(2);
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === juggernaut.instanceId
      )?.zone
    ).toBe("removed_from_game");
  });

  it("バトル終了時の任意応答を使わない場合、ジャガーノートは場に残る", () => {
    const { effectLookups, getDef, juggernaut, lena, queued } =
      createBattleEndState();
    const after = resolveBattleEndLena(
      queued,
      lena.instanceId,
      getDef,
      effectLookups,
      { skip: true }
    );

    expect(
      after.cardInstances.find((card) => card.instanceId === lena.instanceId)
        ?.normalCoreCount
    ).toBe(4);
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === juggernaut.instanceId
      )?.zone
    ).toBe("field");
  });

  it("バトル終了時の発揮宣言後にCX01のコアが2個未満なら手札へ戻さない", () => {
    const { effectLookups, getDef, juggernaut, lena, queued } =
      createBattleEndState();
    const after = resolveBattleEndLena(
      queued,
      lena.instanceId,
      getDef,
      effectLookups,
      {
        afterDeclare: (state) => ({
          ...state,
          cardInstances: state.cardInstances.map((card) =>
            card.instanceId === lena.instanceId
              ? { ...card, normalCoreCount: 1 }
              : card
          ),
        }),
      }
    );

    expect(
      after.cardInstances.find((card) => card.instanceId === lena.instanceId)
        ?.normalCoreCount
    ).toBe(1);
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === juggernaut.instanceId
      )?.zone
    ).toBe("field");
  });

  it("同一バトル終了時に2体が対象なら、4コア支払いで2体とも手札へ戻す", () => {
    const { effectLookups, getDef, juggernauts, lena, queued } =
      createBattleEndState({
        juggernautInstanceIds: [
          "bses01-cx01-juggernaut-battle-1",
          "bses01-cx01-juggernaut-battle-2",
        ],
        lenaCores: 6,
      });
    const after = resolveBattleEndLena(
      queued,
      lena.instanceId,
      getDef,
      effectLookups
    );

    expect(
      after.cardInstances.find((card) => card.instanceId === lena.instanceId)
        ?.normalCoreCount
    ).toBe(2);
    for (const target of juggernauts) {
      expect(
        after.cardInstances.find(
          (card) => card.instanceId === target.instanceId
        )?.zone
      ).toBe("removed_from_game");
    }
  });

  it("バトル終了時の発揮宣言後に対象1体が場を離れたら、残った対象1体分だけ支払う", () => {
    const { effectLookups, getDef, juggernauts, lena, queued } =
      createBattleEndState({
        juggernautInstanceIds: [
          "bses01-cx01-juggernaut-battle-live",
          "bses01-cx01-juggernaut-battle-left",
        ],
        lenaCores: 6,
      });
    const [liveTarget, leftTarget] = juggernauts;
    const after = resolveBattleEndLena(
      queued,
      lena.instanceId,
      getDef,
      effectLookups,
      {
        afterDeclare: (state) => ({
          ...state,
          cardInstances: state.cardInstances.map((card) =>
            card.instanceId === leftTarget!.instanceId
              ? { ...card, zone: "trash" }
              : card
          ),
        }),
      }
    );

    expect(
      after.cardInstances.find((card) => card.instanceId === lena.instanceId)
        ?.normalCoreCount
    ).toBe(4);
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === liveTarget!.instanceId
      )?.zone
    ).toBe("removed_from_game");
    expect(
      after.cardInstances.find(
        (card) => card.instanceId === leftTarget!.instanceId
      )?.zone
    ).toBe("trash");
  });

  it("バトル終了時応答は同一ターン2回目を別ジャガーノートでも使用できない", () => {
    const first = createBattleEndState({
      juggernautInstanceId: "bses01-cx01-juggernaut-1",
    });
    const afterFirst = resolveBattleEndLena(
      first.queued,
      first.lena.instanceId,
      first.getDef,
      first.effectLookups
    );
    expect(afterFirst.effectUsageRecords.length).toBeGreaterThan(0);

    const second = createBattleEndState({
      effectUsageRecords: afterFirst.effectUsageRecords,
      juggernautInstanceId: "bses01-cx01-juggernaut-2",
    });
    const secondResolve = getLegalActions({
      state: second.queued,
      actingPlayerId: "alice",
      getCardDefinitionById: second.getDef,
      ...second.effectLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === second.lena.instanceId &&
        action.eventKind === "battle_end" &&
        action.skipOnly !== true
    );
    expect(secondResolve).toBeUndefined();
  });
});

describe("BSES01-M01 [戦人狼]ライデン・シュガ", () => {
  const c = card("BSES01-M01");

  it("[0] スピリット状態（非合体）はアタック/ブロック不可（continuous prevent_battle）", () => {
    expect(c.braveCondition).toEqual({ cardNameContains: ["ジャガーノート"] });
    const pb = c.effects![0]!;
    expect(pb.timing).toEqual({ kind: "continuous" });
    expect(pb.applicability).toEqual({ combined: false });
    const action = pb.steps[0]!.action;
    expect(action.kind).toBe("prevent_battle");
    if (action.kind === "prevent_battle") {
      expect(action.restriction).toEqual(["attack", "block"]);
      expect(action.target).toEqual({ kind: "self" });
    }
  });

  it("[2,3] フラッシュ自己召喚起動効果（both/attack、通常コスト）", () => {
    const eff = c.effects![1]!;
    expect(eff.stub).toBeUndefined();
    expect(eff.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(eff.timingScope).toEqual({ player: "both", period: "attack" });
    expect(eff.applicability).toEqual({ zone: ["hand", "set_aside"] });
    expect(eff.steps[0]!.action.kind).toBe("summon");
  });

  it("[5,6] 召喚時のバースト戻しと読点なし stack 発揮不可を二択で表現する", () => {
    const summon = c.effects![2]!;
    expect(summon.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(summon.executionMode).toBe("optional");
    expect(summon.stub).toBeUndefined();
    const step = summon.steps[0]!;
    expect(step.action.kind).toBe("discard_set_burst");
    if (step.action.kind === "discard_set_burst") {
      expect(step.action.destination).toBe("hand");
      expect(step.action.player).toBe("opponent");
      expect(step.action.count).toBe(1);
      expect(step.action.target).toEqual({
        kind: "filter",
        player: "opponent",
        filter: {},
        count: 1,
        zone: "burst",
      });
    }
    expect(step.choice![0]!.action).toEqual({
      kind: "restrict_stack",
      player: "opponent",
      duration: { scope: "turn" },
      targetScope: "effect_source",
      effectFilter: { activatedMode: ["stack"] },
    });
    const registration = generateTriggeredEffectRegistrations(c).find(
      (r) => r.effectIndex === 2
    );
    expect(registration?.executionMode).toBe("optional");
    const [returnBurstChoice, restrictStackChoice] =
      registration?.choices ?? [];
    expect(returnBurstChoice?.candidateTargetPlayerScope).toBe("opponent");
    expect(returnBurstChoice?.candidateTargetZones).toEqual(["burst"]);
    expect(returnBurstChoice?.requiredTargetCount).toBe(1);
    expect(returnBurstChoice?.targetCandidatesRequireSetBurstState).toBe(true);
    expect(returnBurstChoice?.targetSelectionBypassesAffectGate).toBe(true);
    expect(restrictStackChoice?.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "game",
      maxCount: 1,
    });
  });

  it("[5,6] default choiceはセット済みバースト1つを相手手札へ戻す", () => {
    const source = createCardInstance(c, {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const burstDef = card("BSTH01-M13");
    const burst = createCardInstance(burstDef, {
      ownerPlayerId: "bob",
      zone: "burst",
      instanceId: "bob-burst",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, burst],
      startingLife: 5,
    });
    const after = executeEffect({
      chainId: "test:bses01-cards:3505",
      state: {
        ...state,
        setBurstStates: [{ playerId: "bob", cardInstanceId: "bob-burst" }],
      },
      effect: c.effects![2]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });

    const moved = after.cardInstances.find((x) => x.instanceId === "bob-burst");
    expect(moved?.zone).toBe("hand");
    expect(after.setBurstStates).toEqual([]);
    expect(
      after.log.some((l) =>
        l.includes("effect:discard_set_burst:bob:bob-burst->hand")
      )
    ).toBe(true);
  });

  it("[5,6] targetInstanceIdsで選んだセット済みバーストだけを相手手札へ戻す", () => {
    const source = createCardInstance(c, {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const burstDef = card("BSTH01-M13");
    const firstBurst = createCardInstance(burstDef, {
      ownerPlayerId: "bob",
      zone: "burst",
      instanceId: "bob-burst-first",
    });
    const secondBurst = createCardInstance(burstDef, {
      ownerPlayerId: "bob",
      zone: "burst",
      instanceId: "bob-burst-second",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, firstBurst, secondBurst],
      startingLife: 5,
    });
    const after = executeEffect({
      chainId: "test:bses01-cards:3548",
      state: {
        ...state,
        setBurstStates: [
          { playerId: "bob", cardInstanceId: "bob-burst-first" },
          { playerId: "bob", cardInstanceId: "bob-burst-second" },
        ],
      },
      effect: c.effects![2]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      targetInstanceIds: ["bob-burst-second"],
      targetStepId: "__step_0",
      targetSelectionResolved: true,
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });

    expect(
      after.cardInstances.find((x) => x.instanceId === "bob-burst-first")?.zone
    ).toBe("burst");
    expect(
      after.cardInstances.find((x) => x.instanceId === "bob-burst-second")?.zone
    ).toBe("hand");
    expect(after.setBurstStates).toEqual([
      { playerId: "bob", cardInstanceId: "bob-burst-first" },
    ]);
    expect(
      after.log.some((l) =>
        l.includes("effect:discard_set_burst:bob:bob-burst-second->hand")
      )
    ).toBe(true);
  });

  it("[5,6] 候補列挙はburst zoneでもsetBurstStatesに無いカードを除外する", () => {
    const source = createCardInstance(c, {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const burstDef = card("BSTH01-M13");
    const activeBurst = createCardInstance(burstDef, {
      ownerPlayerId: "bob",
      zone: "burst",
      instanceId: "bob-active-burst",
    });
    const setBurst = createCardInstance(burstDef, {
      ownerPlayerId: "bob",
      zone: "burst",
      instanceId: "bob-set-burst",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, activeBurst, setBurst],
      startingLife: 5,
    });
    const registration = generateTriggeredEffectRegistrations(c).find(
      (r) => r.effectIndex === 2
    )!;
    const returnBurstChoice = registration.choices![0]!;

    expect(
      getCandidateTargetInstanceIds(
        {
          ...state,
          setBurstStates: [
            { playerId: "bob", cardInstanceId: "bob-set-burst" },
          ],
        },
        "alice",
        returnBurstChoice,
        {
          getCardDefinitionById: (id) => cardNoMap.get(id),
          sourceInstanceId: source.instanceId,
          sourceDefinition: c,
        }
      )
    ).toEqual(["bob-set-burst"]);
  });

  it("[5,6] auto経路もsetBurstStatesに無いburst zoneカードを選ばない", () => {
    const source = createCardInstance(c, {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const burstDef = card("BSTH01-M13");
    const activeBurst = createCardInstance(burstDef, {
      ownerPlayerId: "bob",
      zone: "burst",
      instanceId: "bob-active-burst",
    });
    const setBurst = createCardInstance(burstDef, {
      ownerPlayerId: "bob",
      zone: "burst",
      instanceId: "bob-set-burst",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, activeBurst, setBurst],
      startingLife: 5,
    });
    const after = executeEffect({
      chainId: "test:bses01-cards:3649",
      state: {
        ...state,
        setBurstStates: [{ playerId: "bob", cardInstanceId: "bob-set-burst" }],
      },
      effect: c.effects![2]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });

    expect(
      after.cardInstances.find((x) => x.instanceId === "bob-active-burst")?.zone
    ).toBe("burst");
    expect(
      after.cardInstances.find((x) => x.instanceId === "bob-set-burst")?.zone
    ).toBe("hand");
    expect(after.setBurstStates).toEqual([]);
  });

  it("[5,6] 発動宣言済みセット中バーストを手札に戻したら解決待ちもキャンセルする", () => {
    const source = createCardInstance(c, {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const burstDef = card("BSTH01-M13");
    const burst = createCardInstance(burstDef, {
      ownerPlayerId: "bob",
      zone: "burst",
      instanceId: "bob-burst",
    });
    const checkId = "burst-check-bob-burst";
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, burst],
      startingLife: 5,
    });
    const after = executeEffect({
      chainId: "test:bses01-cards:3687",
      state: {
        ...base,
        window: "stack",
        setBurstStates: [{ playerId: "bob", cardInstanceId: "bob-burst" }],
        revealedBurstStates: [
          { playerId: "bob", cardInstanceId: "bob-burst", checkId },
        ],
        pendingBurstChecks: [
          {
            checkId,
            actingPlayerId: "bob",
            eventKind: "attack_after",
            source: "battle_resolution",
            chainId: "test:bses01-cards:3696",
            attackId: null,
            relatedPlayerId: "alice",
            amount: 0,
            step: "attack",
            window: "battle_resolution",
            resolvedBurstCardInstanceIds: ["bob-burst"],
          },
        ],
        stackWindow: {
          actingPlayerId: "bob",
          previousWindow: "main",
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "alice",
          subStackEverOpened: false,
          burstWindowKind: "activation",
          pendingStackAction: {
            stackId: "stack:bob-burst",
            actionKind: "burst_activation",
            chainId: `burst:${checkId}`,
            actingPlayerId: "bob",
            cardInstanceId: "bob-burst",
            cardDefinitionId: burst.definitionId,
            targetInstanceIds: [],
            targetEffectFilterTags: [],
            burstCheckId: checkId,
          },
        },
      },
      effect: c.effects![2]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });

    expect(
      after.cardInstances.find((x) => x.instanceId === "bob-burst")?.zone
    ).toBe("hand");
    expect(after.setBurstStates).toEqual([]);
    expect(after.revealedBurstStates).toEqual([]);
    expect(after.pendingBurstChecks).toEqual([]);
    expect(after.stackWindow?.pendingStackAction).toBeNull();
    expect(
      after.log.some((l) =>
        l.includes(
          "effect:discard_set_burst:bob:bob-burst:cancelled-burst-activation:burst-check-bob-burst"
        )
      )
    ).toBe(true);
  });

  it("[5,6] nested stack chain に残る発動宣言済みバーストもキャンセルする", () => {
    const source = createCardInstance(c, {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const responder = createCardInstance(card("BSES01-C02"), {
      ownerPlayerId: "alice",
      zone: "field",
      instanceId: "alice-responder",
      cores: 1,
    });
    const burstDef = card("BSTH01-M13");
    const burst = createCardInstance(burstDef, {
      ownerPlayerId: "bob",
      zone: "burst",
      instanceId: "bob-burst",
    });
    const checkId = "burst-check-bob-burst";
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, responder, burst],
      startingLife: 5,
    });
    const after = executeEffect({
      chainId: "test:bses01-cards:3777",
      state: {
        ...base,
        window: "stack",
        setBurstStates: [{ playerId: "bob", cardInstanceId: "bob-burst" }],
        revealedBurstStates: [
          { playerId: "bob", cardInstanceId: "bob-burst", checkId },
        ],
        pendingBurstChecks: [
          {
            checkId,
            actingPlayerId: "bob",
            eventKind: "attack_after",
            source: "battle_resolution",
            chainId: "test:bses01-cards:3786",
            attackId: null,
            relatedPlayerId: "alice",
            amount: 0,
            step: "attack",
            window: "battle_resolution",
            resolvedBurstCardInstanceIds: ["bob-burst"],
          },
        ],
        stackWindow: {
          actingPlayerId: "bob",
          previousWindow: "main",
          priorityPlayerId: "bob",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "alice",
          subStackEverOpened: true,
          burstWindowKind: "activation",
          pendingStackAction: {
            stackId: "stack:alice-response",
            actionKind: "field_card_effect",
            chainId: "field:alice-response",
            actingPlayerId: "alice",
            cardInstanceId: "alice-responder",
            cardDefinitionId: responder.definitionId,
            targetInstanceIds: [],
            targetEffectFilterTags: [],
            previousResponseSourcePlayerId: "bob",
            previousPendingStackAction: {
              stackId: "stack:bob-burst",
              actionKind: "burst_activation",
              chainId: `burst:${checkId}`,
              actingPlayerId: "bob",
              cardInstanceId: "bob-burst",
              cardDefinitionId: burst.definitionId,
              targetInstanceIds: [],
              targetEffectFilterTags: [],
              burstCheckId: checkId,
            },
          },
        },
      },
      effect: c.effects![2]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });

    expect(after.revealedBurstStates).toEqual([]);
    expect(after.pendingBurstChecks).toEqual([]);
    expect(after.stackWindow?.pendingStackAction?.stackId).toBe(
      "stack:alice-response"
    );
    expect(
      after.stackWindow?.pendingStackAction?.previousPendingStackAction
    ).toBeNull();
  });

  it("[5,6] セット中バーストの効果耐性は手札戻しを止める", () => {
    const source = createCardInstance(c, {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const burstDef = card("BSTH01-M13");
    const burst = createCardInstance(burstDef, {
      ownerPlayerId: "bob",
      zone: "burst",
      instanceId: "bob-burst",
    });
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, burst],
      startingLife: 5,
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      {
        ...base,
        setBurstStates: [{ playerId: "bob", cardInstanceId: "bob-burst" }],
      },
      (id) => cardNoMap.get(id)
    );
    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "defense_immune" &&
          ce.targetInstanceId === "bob-burst"
      )
    ).toBe(true);

    const after = executeEffect({
      chainId: "test:bses01-cards:3880",
      state: rebuilt,
      effect: c.effects![2]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });

    const protectedBurst = after.cardInstances.find(
      (x) => x.instanceId === "bob-burst"
    );
    expect(protectedBurst?.zone).toBe("burst");
    expect(after.setBurstStates).toEqual([
      { playerId: "bob", cardInstanceId: "bob-burst" },
    ]);
    expect(
      after.log.some((l) =>
        l.includes("effect:discard_set_burst:bob:0:blocked")
      )
    ).toBe(true);
    expect(after.publicDisclosures.flatMap((event) => event.targets)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "card",
          instanceId: "bob-burst",
          definitionIdSnapshot: protectedBurst!.definitionId,
        }),
      ])
    );
    expect(after.revealedBurstStates).toEqual([]);
  });

  it("[5,6] bounce耐性で止まったセット中バーストを2枚目へ自動振替しない", () => {
    const source = createCardInstance(c, {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const firstBurstDef = card("BSTH01-M13");
    const secondBurstDef = card("BSTH01-M13");
    const protectedBurst = createCardInstance(firstBurstDef, {
      ownerPlayerId: "bob",
      zone: "burst",
      instanceId: "bob-burst-protected",
    });
    const secondBurst = createCardInstance(secondBurstDef, {
      ownerPlayerId: "bob",
      zone: "burst",
      instanceId: "bob-burst-second",
    });
    const cannotBounce: ContinuousEffect = {
      effectId: "ce-cannot-bounce-burst",
      sourceInstanceId: "bob-burst-protected",
      sourceDefinitionId: protectedBurst.definitionId,
      actingPlayerId: "bob",
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cannot_be_bounced",
      targetInstanceId: "bob-burst-protected",
      metadata: { source: "opponent_effect" },
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, protectedBurst, secondBurst],
      startingLife: 5,
    });
    const after = executeEffect({
      chainId: "test:bses01-cards:3945",
      state: {
        ...state,
        setBurstStates: [
          { playerId: "bob", cardInstanceId: "bob-burst-protected" },
          { playerId: "bob", cardInstanceId: "bob-burst-second" },
        ],
        activeContinuousEffects: [cannotBounce],
      },
      effect: c.effects![2]!,
      sourceInstanceId: source.instanceId,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => cardNoMap.get(id),
    });

    expect(
      after.cardInstances.find((x) => x.instanceId === "bob-burst-protected")
        ?.zone
    ).toBe("burst");
    expect(
      after.cardInstances.find((x) => x.instanceId === "bob-burst-second")?.zone
    ).toBe("burst");
    expect(after.setBurstStates).toEqual([
      { playerId: "bob", cardInstanceId: "bob-burst-protected" },
      { playerId: "bob", cardInstanceId: "bob-burst-second" },
    ]);
    expect(after.publicDisclosures.flatMap((event) => event.targets)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "card",
          instanceId: "bob-burst-protected",
          definitionIdSnapshot: protectedBurst.definitionId,
        }),
      ])
    );
    expect(
      after.log.some((l) =>
        l.includes("effect:discard_set_burst:bob:bob-burst-second->hand")
      )
    ).toBe(false);
  });
});

describe("BSES01-R02 スカベンジャー・ファイド", () => {
  const c = card("BSES01-R02");

  it("[7] Lv1 このスピリットはアタック/ブロックできない（continuous prevent_battle）", () => {
    const pb = c.effects![2]!;
    expect(pb.stub).toBeUndefined();
    expect(pb.timing).toEqual({ kind: "continuous" });
    const action = pb.steps[0]!.action;
    expect(action.kind).toBe("prevent_battle");
    if (action.kind === "prevent_battle") {
      expect(action.restriction).toEqual(["attack", "block"]);
      expect(action.target).toEqual({ kind: "self" });
    }
  });

  it("[0][2][3,4] ミラージュ機構とセット中トラッシュ耐性を構造化DSLで表す", () => {
    expect(c.mirageData).toEqual({ cost: 1, reduction: [] });
    expect(c.effects).toHaveLength(3);
    expect(c.effects![0]!.cardEventDisposition).toEqual({
      kind: "set_as_mirage",
    });
    expect(c.effects![1]!.applicability).toEqual({
      zone: ["mirage_set"],
    });
  });
});
