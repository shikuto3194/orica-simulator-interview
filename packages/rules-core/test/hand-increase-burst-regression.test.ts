import { describe, expect, it } from "vitest";
import { checkAndQueuePlacementOracle } from "../src/mechanics/oracle-system";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildHandIncreaseBurstScenario } from "../../../apps/playground-web/src/scenario-hand-increase-burst";
import { moveCardZone } from "../src/core/core-system";
import { recordHandExchange } from "../src/zone/hand-increase";
import { executeMatchingRetriggers } from "../src/effect/retrigger-system";
import {
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
  collectAndQueueTriggerReactions,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type Effect,
  type GameState,
  type LegalAction,
  applyLegalAction,
  queuePendingReactionsFromTriggerEvents,
  buildFieldCardEffectLookup,
  queuePendingLeave,
  finalizeEffectResolution,
  advanceStep,
  processPendingImmediateBattleEnds,
} from "../src";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const handIncreaseBurstCardNos = ALL_CARDS.filter((card) =>
  card.textLines.some((line) => /【.*バースト.*手札.*増え/.test(line))
).map((card) => card.cardNo);
const lookups = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
};

function fixture(burstCardNo = "BSTH03-M05") {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definitions.get(burstCardNo)!, {
          instanceId: "burst",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
        createCardInstance(definitions.get("BSTH01-C04")!, {
          instanceId: "source",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        ...["deck1", "deck2", "deck3"].map((instanceId) =>
          createCardInstance(definitions.get("BSTH01-C04")!, {
            instanceId,
            ownerPlayerId: "bob",
            zone: "deck",
          })
        ),
      ],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "burst" }],
      playerOverrides: [{ handCount: 0 }, { handCount: 0, deckCount: 3 }],
    }),
    activePlayerId: "bob",
    step: "main" as const,
    turnNumber: 3,
  };
}

describe("相手の効果による手札増加バーストの実行経路", () => {
  it.each(handIncreaseBurstCardNos)(
    "%s: 単純な1ドローから実カードのバースト発動候補が出る",
    (cardNo) => {
      const before = fixture(cardNo);
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      };
      const after = executeEffect({
        chainId: "test:hand-increase-burst-regression:81",
        state: before,
        effect,
        actingPlayerId: "bob",
        sourceInstanceId: "source",
        ...lookups,
      });
      expect(after.players[1]!.handCount).toBe(1);
      const queued = collectAndQueueTriggerReactions({
        chainId: "test:hand-increase-burst-regression:89",
        beforeState: before,
        afterState: after,
        source: "action_resolution",
        causedByPlayerId: "bob",
        causedBySourceInstanceId: "source",
        ...lookups,
      });
      expect(queued.pendingBurstChecks).toHaveLength(1);
      expect(
        getLegalActions({
          state: queued,
          actingPlayerId: "alice",
          ...lookups,
        }).some(
          (a) =>
            a.kind === "resolve_pending_burst_check" &&
            a.sourceInstanceId === "burst"
        )
      ).toBe(true);
    }
  );
  it("召喚時の1ドローを正規アクションで解決するとバーストが発動できる", () => {
    const base = fixture();
    let state = queuePendingReactionsFromTriggerEvents(
      {
        ...base,
        cardInstances: base.cardInstances.map((c) =>
          c.instanceId === "source" ? { ...c, definitionId: "BSSA01-C01" } : c
        ),
        players: base.players.map((p) => ({ ...p, countValue: 1 })),
      },
      [
        {
          actingPlayerId: "bob",
          eventKind: "summon",
          source: "action_resolution",
          chainId: "test:hand-increase-burst-regression:122",
          attackId: null,
          relatedPlayerId: "bob",
          relatedInstanceId: "source",
          amount: null,
        },
      ],
      undefined,
      lookups
    );
    for (const [player, kind] of [
      ["bob", "resolve_pending_triggered_effect"],
      ["alice", "pass_stack"],
    ]) {
      const actions = getLegalActions({
        state,
        actingPlayerId: player!,
        ...lookups,
      });
      const action = actions.find((a) => a.kind === kind);
      expect(action, JSON.stringify(actions)).toBeDefined();
      state = applyLegalAction({ state, action: action!, ...lookups }).state;
    }
    expect(state.players[1]!.handCount).toBe(1);
    expect(state.pendingBurstChecks, JSON.stringify(state.log)).toHaveLength(1);
    expect(
      getLegalActions({ state, actingPlayerId: "alice", ...lookups }).some(
        (a) =>
          a.kind === "resolve_pending_burst_check" &&
          a.sourceInstanceId === "burst"
      )
    ).toBe(true);
  });
});

function act(
  state: GameState,
  player: string,
  predicate: (a: LegalAction) => boolean,
  input = {}
) {
  const actions = getLegalActions({
    state,
    actingPlayerId: player,
    ...lookups,
  });
  const action = actions.find(predicate);
  expect(action, JSON.stringify(actions)).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups, ...input })
    .state;
}

describe("報告された実カードの組み合わせ", () => {
  it("ユージオの召喚時オープン→手札追加でソウエイの発動候補が出る", () => {
    let state = buildHandIncreaseBurstScenario(
      ALL_CARDS,
      new URLSearchParams({ owner: "bob", stage: "open" })
    );
    state = act(
      state,
      "bob",
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    state = act(state, "alice", (a) => a.kind === "pass_stack");
    state = act(
      state,
      "bob",
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    state = act(
      state,
      "bob",
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    state = act(
      state,
      "bob",
      (a) => a.kind === "resolve_pending_deck_reveal_pick",
      { selectedDeckRevealCardIds: ["draw"] }
    );
    state = act(
      state,
      "bob",
      (a) => a.kind === "resolve_pending_deck_reveal_order",
      { deckRevealRemainderOrder: ["remainder1", "remainder2"] }
    );
    expect(state.pendingBurstChecks).toHaveLength(1);
    state = act(
      state,
      "alice",
      (a) =>
        a.kind === "resolve_pending_burst_check" &&
        a.sourceInstanceId === "souei"
    );
    expect(state.revealedBurstStates).toMatchObject([
      { cardInstanceId: "souei" },
    ]);
  });
  it.each(["alice", "bob"])(
    "%s ユウの初回挿入→1ドローでソウエイを発動できる",
    (owner) => {
      const opponent = owner === "alice" ? "bob" : "alice";
      let state = buildHandIncreaseBurstScenario(
        ALL_CARDS,
        new URLSearchParams({ owner })
      );
      state = act(
        state,
        owner,
        (a) =>
          a.kind === "use_field_card_effect" &&
          a.sourceInstanceId === "yu" &&
          a.timing === "normal"
      );
      state = act(state, opponent, (a) => a.kind === "pass_stack");
      state = act(
        state,
        owner,
        (a) => a.kind === "resolve_pending_effect_target",
        { targetInstanceIds: ["insert"] }
      );
      expect(state.players.find((p) => p.id === owner)?.handCount).toBe(1);
      expect(
        state.cardInstances.find((c) => c.instanceId === "insert")
          ?.attachedToInstanceId
      ).toBe("yu");
      expect(
        state.cardInstances.find((c) => c.instanceId === "draw")?.zone
      ).toBe("hand");
      expect(state.pendingBurstChecks).toMatchObject([
        {
          actingPlayerId: opponent,
          amount: 1,
          event: { cause: "self_effect" },
        },
      ]);
      state = act(
        state,
        opponent,
        (a) =>
          a.kind === "resolve_pending_burst_check" &&
          a.sourceInstanceId === "souei"
      );
      expect(state.revealedBurstStates).toMatchObject([
        { cardInstanceId: "souei" },
      ]);
    }
  );
  it("ユウの下カードと手札の入れ替えではソウエイを発動しない", () => {
    let state = buildHandIncreaseBurstScenario(
      ALL_CARDS,
      new URLSearchParams({ owner: "bob" })
    );
    state = act(
      state,
      "bob",
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "yu" &&
        a.timing === "normal"
    );
    state = act(state, "alice", (a) => a.kind === "pass_stack");
    state = act(
      state,
      "bob",
      (a) => a.kind === "resolve_pending_effect_target",
      { targetInstanceIds: ["insert"] }
    );
    state = act(
      state,
      "alice",
      (a) => a.kind === "decline_pending_burst_check"
    );
    const before = state;
    const effect = definitions
      .get("BSGE01-CX01")!
      .effects!.find((effect) =>
        effect.steps.some((step) => step.action.kind === "swap_bullet_edit")
      )!;
    const after = executeEffect({
      chainId: "test:hand-increase-burst-regression:309",
      state,
      effect,
      sourceInstanceId: "yu",
      actingPlayerId: "bob",
      targetInstanceIds: ["draw"],
      ...lookups,
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "insert")?.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "draw")
        ?.attachedToInstanceId
    ).toBe("yu");
    expect(queue(before, after).pendingBurstChecks).toEqual([]);
  });
  it("手札ランガの発動はセット中ソウエイを公開しない", () => {
    let state = buildHandIncreaseBurstScenario(
      ALL_CARDS,
      new URLSearchParams({ stage: "hand-burst", owner: "bob" })
    );
    state = act(
      state,
      "alice",
      (a) =>
        a.kind === "resolve_pending_burst_check" &&
        a.sourceInstanceId === "ranga"
    );
    expect(state.revealedBurstStates.map((r) => r.cardInstanceId)).toEqual([
      "ranga",
    ]);
    expect(state.setBurstStates).toContainEqual({
      playerId: "alice",
      cardInstanceId: "souei",
    });
    state = act(state, "bob", (a) => a.kind === "pass_stack");
    expect(state.revealedBurstStates.map((r) => r.cardInstanceId)).toEqual([
      "ranga",
    ]);
    expect(state.setBurstStates).toContainEqual({
      playerId: "alice",
      cardInstanceId: "souei",
    });
  });
});

function resolveSteps(
  before: GameState,
  steps: Effect["steps"],
  actor = "bob"
) {
  return executeEffect({
    chainId: "test:hand-increase-burst-regression:361",
    state: before,
    effect: { timing: { kind: "activated", mode: "main" }, steps },
    actingPlayerId: actor,
    sourceInstanceId: "source",
    ...lookups,
  });
}
function queue(
  before: GameState,
  after: GameState,
  actor: string | null = "bob"
) {
  return collectAndQueueTriggerReactions({
    chainId: "test:hand-increase-burst-regression:374",
    beforeState: before,
    afterState: after,
    source: "action_resolution",
    causedByPlayerId: actor,
    causedBySourceInstanceId: actor ? "source" : null,
    ...lookups,
  });
}

describe.each(handIncreaseBurstCardNos)(
  "%s: 手札増加の事実、原因、入れ替えの区別",
  (burstCardNo) => {
    it("オープン後の after_triggers は手札増加を一度だけ収集し通常バーストを待たない", () => {
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            id: "open",
            action: {
              kind: "deck_reveal",
              revealCount: 1,
              picks: [{ count: 1 }],
              remainder: "trash",
            },
          },
          {
            connector: "after_triggers",
            action: { kind: "count_increase", amount: 1 },
          },
        ],
      };
      const sourceDef = {
        ...definitions.get("BSTH01-C04")!,
        effects: [effect],
      };
      const deps = {
        ...lookups,
        getCardDefinitionById: (id: string) =>
          id === sourceDef.cardNo ? sourceDef : definitions.get(id),
      };
      let state = executeEffect({
        chainId: "test:hand-increase-burst-regression:415",
        ...deps,
        state: fixture(burstCardNo),
        effect,
        sourceInstanceId: "source",
        actingPlayerId: "bob",
        effectIndex: 0,
      });
      const action = getLegalActions({
        ...deps,
        state,
        actingPlayerId: "bob",
      }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
      expect(action).toBeDefined();
      state = applyLegalAction({
        ...deps,
        state,
        action: action!,
        selectedDeckRevealCardIds: ["deck1"],
      }).state;
      expect(state.pendingBurstChecks).toHaveLength(1);
      expect(state.pendingBurstChecks[0]?.amount).toBe(1);
      expect(state.players[1]!.countValue).toBe(0);
      expect(state.pendingAfterTriggersContinuations).toHaveLength(0);
    });
    it("配置時導託の手札回収も正規スタック解決から発動する", () => {
      const base = fixture(burstCardNo);
      let state: GameState = {
        ...base,
        cardInstances: base.cardInstances.map((card) =>
          card.instanceId === "source"
            ? createCardInstance(definitions.get("BSAZ02-X04")!, {
                instanceId: "source",
                ownerPlayerId: "bob",
                zone: "field",
              })
            : card.instanceId === "deck1"
              ? { ...card, definitionId: "BSAZ02-C10" }
              : card
        ),
      };
      state = checkAndQueuePlacementOracle(
        state,
        "source",
        lookups.getCardDefinitionById,
        "test:hand-increase-burst-regression:456"
      );
      state = act(
        state,
        "bob",
        (a) => a.kind === "resolve_pending_triggered_effect"
      );
      state = act(state, "alice", (a) => a.kind === "pass_stack");
      expect(
        state.cardInstances.find((c) => c.instanceId === "deck1")?.zone
      ).toBe("hand");
      expect(state.pendingBurstChecks).toHaveLength(1);
      expect(state.pendingBurstChecks[0]).toMatchObject({
        amount: 1,
        relatedInstanceId: "source",
        event: { cause: "self_effect" },
      });
    });
    it("即時終了の親効果と予約効果を別の原因で一度ずつ収集する", () => {
      const effect: Effect = {
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
        steps: [{ action: { kind: "draw", count: 1 } }],
      };
      const sourceDef = {
        ...definitions.get("BSTH01-C04")!,
        effects: [effect],
      };
      const deps = {
        ...lookups,
        getCardDefinitionById: (id: string) =>
          id === sourceDef.cardNo ? sourceDef : definitions.get(id),
      };
      const base = fixture(burstCardNo);
      const before: GameState = {
        ...base,
        step: "attack",
        activeAttack: {
          attackId: "native-audit",
          primaryEntityId: "entity",
          participantEntityIds: ["entity"],
          groupMode: "single",
          target: { kind: "player", playerId: "alice" },
          blockAssignments: [],
          symbolResolutionOrder: ["entity"],
          flashBeforeBlockCompleted: true,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        battleEntities: [
          {
            entityId: "entity",
            memberInstanceIds: ["source"],
            resolvedBp: 1000,
            resolvedSymbols: ["red"],
            attackState: "attacking",
          },
        ],
        pendingBattleEndDeferrals: [
          {
            deferralId: "native-audit-draw",
            attackId: "native-audit",
            actingPlayerId: "bob",
            sourceInstanceId: "source",
            sourceDefinitionId: sourceDef.cardNo,
            effectIndex: 0,
          },
        ],
      };
      const executed = executeEffect({
        ...deps,
        state: before,
        effect: {
          timing: { kind: "activated", mode: "flash" },
          steps: [{ action: { kind: "end_battle" } }],
        },
        sourceInstanceId: "burst",
        actingPlayerId: "alice",
        chainId: "parent-end",
      });
      const after = finalizeEffectResolution({
        ...deps,
        state: executed,
        beforeState: before,
        chainId: "parent-end",
        endLogs: [],
        actingPlayerId: "alice",
        causedBySourceInstanceId: "burst",
      });
      expect(after.players[1]!.handCount).toBe(1);
      expect(after.pendingBurstChecks).toHaveLength(1);
      expect(after.pendingBurstChecks[0]).toMatchObject({
        amount: 1,
        relatedInstanceId: "source",
        event: { cause: "self_effect" },
      });
    });
    it.each([
      "redirect",
      "inline_draw",
      "battle_end",
      "borrowed_choice",
      "borrowed_target",
    ] as const)("%s の再開・自動実行から二次誘発を収集する", (route) => {
      const effect: Effect =
        route === "inline_draw"
          ? {
              timing: {
                kind: "phase",
                step: "draw",
                subPhase: "start",
                whose: "self",
              },
              inline: true,
              steps: [
                {
                  action: {
                    kind: "draw_modify",
                    amount: 0,
                    duration: { scope: "step", step: "draw" },
                  },
                },
                { action: { kind: "draw", count: 1 } },
              ],
            }
          : {
              timing:
                route === "battle_end"
                  ? {
                      kind: "card_event",
                      event: "attack",
                      deferredTo: "battle_end",
                    }
                  : { kind: "activated", mode: "main" },
              steps: [{ action: { kind: "draw", count: 1 } }],
            };
      effect.steps.push({
        connector: "after_triggers",
        action: { kind: "count_increase", amount: 1 },
      });
      const sourceDef = {
        ...definitions.get("BSTH01-C04")!,
        effects: [effect],
      };
      const deps = {
        ...lookups,
        getCardDefinitionById: (id: string) =>
          id === sourceDef.cardNo ? sourceDef : definitions.get(id),
      };
      let state = fixture(burstCardNo);
      if (route === "inline_draw") {
        state = advanceStep(
          { ...state, step: "core" },
          deps.getCardDefinitionById,
          deps.getRegisteredTriggeredEffectActions,
          deps.getRegisteredBurstActions
        );
      } else if (route === "battle_end") {
        state = processPendingImmediateBattleEnds({
          ...deps,
          state: {
            ...state,
            pendingImmediateBattleEnds: [
              {
                attackId: "audit-battle",
                participantInstanceIds: ["source"],
                blockSideInstanceIds: [],
                participantSnapshots: [],
              },
            ],
            pendingBattleEndDeferrals: [
              {
                deferralId: "audit-defer",
                attackId: "audit-battle",
                actingPlayerId: "bob",
                sourceInstanceId: "source",
                sourceDefinitionId: sourceDef.cardNo,
                effectIndex: 0,
              },
            ],
          },
        });
      } else if (route === "borrowed_choice" || route === "borrowed_target") {
        state =
          route === "borrowed_choice"
            ? {
                ...state,
                pendingBorrowedEffectChoice: {
                  chainId: "test:borrowed-choice",
                  pendingId: "borrow",
                  actingPlayerId: "bob",
                  sourceInstanceId: "source",
                  targetInstanceId: "source",
                  targetDefinitionId: sourceDef.cardNo,
                  borrowEvents: ["summon"],
                  candidates: [{ effectIndex: 0 }],
                },
              }
            : {
                ...state,
                pendingBorrowedEffectTargetSelection: {
                  chainId: "test:borrowed-target",
                  pendingId: "borrow-target",
                  actingPlayerId: "bob",
                  choosingPlayerId: "bob",
                  sourceInstanceId: "source",
                  targetInstanceId: "source",
                  targetDefinitionId: sourceDef.cardNo,
                  borrowedEffectIndex: 0,
                  requiredTargetCount: 1,
                  maxTargetCount: 1,
                  candidateInstanceIds: ["source"],
                  targetStepId: "draw",
                  targetStepIndex: 0,
                  stepContext: { results: {} },
                },
              };
        const action = getLegalActions({
          state,
          actingPlayerId: "bob",
          ...deps,
        }).find(
          (a) =>
            a.kind ===
            (route === "borrowed_choice"
              ? "resolve_borrowed_effect_choice"
              : "resolve_borrowed_effect_target")
        );
        expect(action).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          ...deps,
          targetInstanceIds: ["source"],
        }).state;
      } else {
        state = {
          ...state,
          pendingTargetRedirects: [
            {
              pendingId: "audit-redirect",
              redirectEffectId: "audit-redirect-ce",
              promptedPlayerId: "alice",
              sourceEffectInstanceId: "source",
              sourceEffectDefinitionId: sourceDef.cardNo,
              originalResolvedInstanceIds: ["source"],
              redirectableInstanceId: "source",
              candidateTokenInstanceIds: ["source"],
              continuation: {
                chainId: "test:hand-increase-burst-regression:708",
                sourceDefinitionId: sourceDef.cardNo,
                sourceInstanceId: "source",
                actingPlayerId: "bob",
                effectIndex: 0,
                resumeStepIndex: 0,
                stepContext: { results: {} },
              },
            },
          ],
        };
        const action = getLegalActions({
          state,
          actingPlayerId: "alice",
          ...deps,
        }).find((a) => a.kind === "decline_target_redirect");
        expect(action).toBeDefined();
        state = applyLegalAction({ state, action: action!, ...deps }).state;
      }
      expect(state.players[1]!.handCount).toBe(route === "inline_draw" ? 2 : 1);
      expect(state.pendingBurstChecks).toHaveLength(1);
      expect(state.pendingBurstChecks[0]).toMatchObject({
        amount: 1,
        relatedInstanceId: "source",
        event: { cause: "self_effect" },
      });
    });
    it.each(["deck", "trash"] as const)(
      "%s 由来の任意手札追加も発動する",
      (origin) => {
        const base = moveCardZone(
          fixture(burstCardNo),
          "deck1",
          origin === "deck" ? "revealed" : "trash"
        );
        const before: GameState = {
          ...base,
          pendingDeckReveal: {
            pendingId: "choice",
            actingPlayerId: "bob",
            sourceInstanceId: "source",
            sourceDefinitionId: "BSTH01-C04",
            revealedCardInstanceIds: ["deck1"],
            picks: [],
            remainder: "bottom",
            phase: "revealed_choice",
            currentPickIndex: 0,
            pickedCardInstanceIds: [],
            revealedAutoAddCandidateIds: ["deck1"],
            revealedDispositionMap: {
              deck1: { kind: "move", destination: "hand" },
            },
            origin,
          },
        };
        const state = act(
          before,
          "bob",
          (a) => a.kind === "resolve_pending_deck_reveal_pick",
          { selectedDeckRevealCardIds: ["deck1"] }
        );
        expect(
          state.cardInstances.find((c) => c.instanceId === "deck1")?.zone
        ).toBe("hand");
        expect(state.pendingBurstChecks).toHaveLength(1);
        expect(state.pendingBurstChecks[0]?.event?.cause).toBe("self_effect");
      }
    );

    it("再発火するドローの原因と二次誘発を保存する", () => {
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: { kind: "draw", count: 1 },
            retrigger: {
              event: "attack",
              triggerPlayer: "self",
              maxCount: 1,
              duration: { scope: "turn" },
            },
          },
        ],
      };
      const sourceDef = {
        ...definitions.get("BSTH01-C04")!,
        effects: [effect],
      };
      const deps = {
        ...lookups,
        getCardDefinitionById: (id: string) =>
          id === sourceDef.cardNo ? sourceDef : definitions.get(id),
      };
      const before = executeEffect({
        chainId: "test:hand-increase-burst-regression:801",
        state: fixture(burstCardNo),
        effect,
        effectIndex: 0,
        sourceInstanceId: "source",
        actingPlayerId: "bob",
        ...deps,
      });
      const state = executeMatchingRetriggers({
        state: before,
        event: "attack",
        triggerCard: before.cardInstances.find(
          (c) => c.instanceId === "source"
        )!,
        triggerCardDefinition: sourceDef,
        ...deps,
      });
      expect(state.players[1]!.handCount).toBe(1);
      expect(state.pendingBurstChecks).toHaveLength(1);
      expect(state.pendingBurstChecks[0]?.event).toMatchObject({
        cause: "self_effect",
      });
      expect(state.pendingBurstChecks[0]?.relatedInstanceId).toBe("source");
    });
    it.each(["trash", "deck"] as const)(
      "%s の選択から手札に加えた結果だけで発動候補が出る",
      (zone) => {
        let before = fixture(burstCardNo);
        for (const id of ["deck1", "deck2"])
          before = moveCardZone(before, id, zone);
        let state = resolveSteps(before, [
          {
            action: {
              kind: "search_zone",
              zone,
              count: 1,
              filter: {},
              destination: "hand",
            },
          },
        ]);
        expect(state.pendingZoneSelection).not.toBeNull();
        state = act(
          state,
          "bob",
          (a) => a.kind === "resolve_pending_zone_selection",
          { selectedZoneCardIds: ["deck1"] }
        );
        expect(
          state.cardInstances.find((c) => c.instanceId === "deck1")?.zone
        ).toBe("hand");
        expect(state.pendingBurstChecks).toMatchObject([
          { amount: 1, event: { cause: "self_effect" } },
        ]);
        expect(state.pendingBurstChecks).toHaveLength(1);
      }
    );
    it.each(["bob", "alice"])(
      "合体カードを戻す途中の選択後も原因=%sを保持する",
      (causePlayerId) => {
        const base = fixture(burstCardNo);
        const braveDefinition = {
          ...definitions.get("BSTH01-C04")!,
          cardNo: "TEST-HAND-INCREASE-BRAVE",
          printedCategory: "brave" as const,
          effects: [],
        };
        const deps = {
          ...lookups,
          getCardDefinitionById: (id: string) =>
            id === braveDefinition.cardNo
              ? braveDefinition
              : definitions.get(id),
        };
        const before: GameState = {
          ...base,
          cardInstances: [
            ...base.cardInstances.map((card) =>
              card.instanceId === "source"
                ? { ...card, attachedChildrenIds: ["brave"] }
                : card
            ),
            createCardInstance(braveDefinition, {
              instanceId: "brave",
              ownerPlayerId: "bob",
              zone: "field",
              attachedToInstanceId: "source",
            }),
          ],
        };
        let state = finalizeEffectResolution({
          state: queuePendingLeave({
            state: before,
            instanceId: "source",
            kind: "bounce",
            leaveDestination: { zone: "hand" },
            cause: "effect_resolution",
            causePlayerId,
            causedByEffectSourceInstanceId: "source",
            chainId: "bounce-with-choice",
          }),
          beforeState: before,
          actingPlayerId: causePlayerId,
          causedBySourceInstanceId: "source",
          chainId: "bounce-with-choice",
          endLogs: [],
          ...deps,
        });
        expect(state.pendingBraveLeaveChoice?.hostInstanceId).toBe("source");
        const action = getLegalActions({
          state,
          actingPlayerId: "bob",
          ...deps,
        }).find(
          (a) =>
            a.kind === "resolve_brave_leave_choice" &&
            a.choice === "send_with_host"
        );
        expect(action).toBeDefined();
        state = applyLegalAction({ state, action: action!, ...deps }).state;
        expect(state.players[1]!.handCount).toBe(2);
        expect(state.pendingBurstChecks).toHaveLength(
          causePlayerId === "bob" ? 1 : 0
        );
      }
    );
    it.each(["hand", "hand_swap"] as const)(
      "オープン後の選択再開：%s を正しく区別する",
      (destination) => {
        const before = moveCardZone(fixture(burstCardNo), "deck3", "hand");
        let state = resolveSteps(before, [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 2,
              picks: [{ filter: {}, count: 1, destination }],
              remainder: "bottom",
            },
          },
        ]);
        for (
          let i = 0;
          i < 6 && (state.pendingDeckReveal || state.pendingZoneSelection);
          i++
        ) {
          if (state.pendingDeckReveal?.phase === "picking") {
            state = act(
              state,
              "bob",
              (a) => a.kind === "resolve_pending_deck_reveal_pick",
              { selectedDeckRevealCardIds: ["deck1"] }
            );
          } else if (state.pendingDeckReveal?.phase === "ordering_remainder") {
            const pending = state.pendingDeckReveal;
            state = act(
              state,
              "bob",
              (a) => a.kind === "resolve_pending_deck_reveal_order",
              {
                deckRevealRemainderOrder:
                  pending.revealedCardInstanceIds.filter(
                    (id) => !pending.pickedCardInstanceIds.includes(id)
                  ),
              }
            );
          } else if (state.pendingZoneSelection) {
            state = act(
              state,
              "bob",
              (a) => a.kind === "resolve_pending_zone_selection",
              { selectedZoneCardIds: ["deck3"] }
            );
          } else
            throw new Error(
              `Unexpected phase ${state.pendingDeckReveal?.phase}`
            );
        }
        expect(state.pendingDeckReveal).toBeNull();
        expect(state.pendingZoneSelection).toBeNull();
        expect(
          state.cardInstances.find((c) => c.instanceId === "deck1")?.zone
        ).toBe("hand");
        expect(state.pendingBurstChecks.length).toBe(
          destination === "hand" ? 1 : 0
        );
      }
    );
    it("2ドロー後に全破棄して総数0でも増加2枚として発動する", () => {
      const before = fixture(burstCardNo);
      const after = resolveSteps(before, [
        { action: { kind: "draw", count: 2 } },
        {
          action: {
            kind: "discard",
            fromZone: "hand",
            player: "self",
            count: "all",
          },
        },
      ]);
      expect(after.players[1]!.handCount).toBe(0);
      expect(queue(before, after).pendingBurstChecks).toMatchObject([
        { amount: 2 },
      ]);
    });
    it("1枚破棄することでトラッシュから1枚回収：総数不変でも発動する", () => {
      const base = fixture(burstCardNo);
      const before = moveCardZone(base, "deck1", "hand");
      before.cardInstances.push(
        createCardInstance(definitions.get("BSTH01-C22")!, {
          instanceId: "recover",
          ownerPlayerId: "bob",
          zone: "trash",
        })
      );
      const after = resolveSteps(before, [
        {
          id: "pay",
          action: {
            kind: "discard",
            fromZone: "hand",
            player: "self",
            count: 1,
          },
        },
        {
          stepCondition: { kind: "ref_executed", stepId: "pay" },
          action: {
            kind: "search_zone",
            zone: "trash",
            count: 1,
            filter: { category: ["magic"] },
            destination: "hand",
          },
        },
      ]);
      expect(after.players[1]!.handCount).toBe(1);
      expect(
        after.cardInstances.find((c) => c.instanceId === "recover")?.zone
      ).toBe("hand");
      expect(
        after.cardInstances.find((c) => c.instanceId === "deck1")?.zone
      ).toBe("trash");
      expect(queue(before, after).pendingBurstChecks).toMatchObject([
        { amount: 1 },
      ]);
    });
    it.each(["trash", "revealed", "field", "set_aside", "deck"] as const)(
      "%s から手札に加える/戻すと発動する",
      (zone) => {
        const before = moveCardZone(fixture(burstCardNo), "deck1", zone);
        const after = moveCardZone(before, "deck1", "hand");
        expect(queue(before, after).pendingBurstChecks).toMatchObject([
          { amount: 1 },
        ]);
      }
    );
    it("戻したカードを同じ効果内で破棄しても、戻した事実は残る", () => {
      // 非フィールドからの回収を使い、離場待機ではなく同一解決内の手札増加履歴を検証する。
      const before = moveCardZone(fixture(burstCardNo), "source", "trash");
      const after = resolveSteps(before, [
        { action: { kind: "move_self", destination: "hand" } },
        {
          action: {
            kind: "discard",
            fromZone: "hand",
            player: "self",
            count: "all",
          },
        },
      ]);
      expect(after.players[1]!.handCount).toBe(0);
      expect(queue(before, after).pendingBurstChecks).toMatchObject([
        { amount: 1 },
      ]);
    });
    it.each(["alice", null])(
      "相手自身の効果ではない増加（原因=%s）では発動しない",
      (actor) => {
        const before = fixture(burstCardNo);
        const after = moveCardZone(before, "deck1", "hand");
        expect(queue(before, after, actor).pendingBurstChecks).toEqual([]);
      }
    );
    it("手元の増加では発動しない", () => {
      const before = fixture(burstCardNo);
      expect(
        queue(before, moveCardZone(before, "deck1", "set_aside"))
          .pendingBurstChecks
      ).toEqual([]);
    });
    it.each([1, 2])(
      "1枚と%d枚の入れ替えでは発動しない。別のドローは発動する",
      (incomingCount) => {
        const before = moveCardZone(fixture(burstCardNo), "source", "hand");
        let swapped = moveCardZone(before, "source", "trash");
        for (const id of ["deck1", "deck2"].slice(0, incomingCount))
          swapped = moveCardZone(swapped, id, "hand");
        swapped = recordHandExchange(before, swapped);
        expect(queue(before, swapped).pendingBurstChecks).toEqual([]);
        const drawn = resolveSteps(swapped, [
          { action: { kind: "draw", count: 1 } },
        ]);
        expect(queue(before, drawn).pendingBurstChecks).toMatchObject([
          { amount: 1 },
        ]);
      }
    );
    it("差分なしの再収集で過去の手札増加を再発火しない", () => {
      const before = fixture(burstCardNo);
      const once = queue(
        before,
        resolveSteps(before, [{ action: { kind: "draw", count: 1 } }])
      );
      const settled = { ...once, pendingBurstChecks: [] };
      expect(queue(settled, settled).pendingBurstChecks).toEqual([]);
    });
  }
);
