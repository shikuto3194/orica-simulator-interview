import { executeEffectAndChooseEntryCores } from "./helpers/choose-effect-entry-cores";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  collectAndQueueTriggerReactions,
  buildTriggeredEffectLookup,
  buildBurstEffectLookup,
  getAvailableTriggeredEffectSourceChoices,
  type CardDefinition,
  type GameState,
} from "../src";
import { expireCurrentEffectContinuousEffects } from "../src/effect/effect-interpreter";
import {
  applyLegalAction,
  getLegalActions,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  type LegalAction,
} from "../src";
import { buildC07UpToScenario } from "../../../apps/playground-web/src/scenario-bsrk01-c07";

const base = ALL_CARDS.find((c) => c.cardNo === "BSRK01-C07")!;
const observer: CardDefinition = {
  ...base,
  cardNo: "REACTION-OBSERVER",
  effects: [
    {
      timing: { kind: "game_event", event: "increase_hand", player: "both" },
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
};
const burst: CardDefinition = {
  ...base,
  cardNo: "REACTION-BURST",
  effects: [
    {
      timing: {
        kind: "burst",
        trigger: { kind: "hand_increase", player: "both" },
      },
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
  ],
};
const cards = [...ALL_CARDS, observer, burst];
const getDef = (id: string) => cards.find((c) => c.cardNo === id)!;
const lookups = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  getRegisteredBurstActions: buildBurstEffectLookup(cards),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
  getRegisteredMagicActions: buildMagicLookup(cards),
};
const sources = (state: GameState) =>
  state.pendingTriggeredEffects.flatMap((pendingEffect) =>
    getAvailableTriggeredEffectSourceChoices({
      state,
      pendingEffect,
      ...lookups,
    }).map((c) => c.sourceCard.instanceId)
  );

describe("原因効果に限定した誘発抑止", () => {
  it("本番バーストの宣言窓・発揮窓を経ても、ドローに直接反応した相手効果だけを抑止する", () => {
    let state = buildC07UpToScenario(
      cards,
      new URLSearchParams({ burst: "1" })
    );
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        ...["alice", "bob"].map((p) =>
          createCardInstance(observer, {
            instanceId: `observer-${p}`,
            ownerPlayerId: p,
            zone: "field",
            normalCoreCount: 1,
          })
        ),
        createCardInstance(burst, {
          instanceId: "counter-burst",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
      ],
      setBurstStates: [
        ...state.setBurstStates,
        { playerId: "alice", cardInstanceId: "counter-burst" },
      ],
    };
    const act = (player: string, kind: LegalAction["kind"]) => {
      const action = getLegalActions({
        state,
        actingPlayerId: player,
        ...lookups,
      }).find((a) => a.kind === kind);
      expect(action).toBeDefined();
      state = applyLegalAction({ state, action: action!, ...lookups }).state;
    };
    act("bob", "resolve_pending_burst_check");
    act("alice", "pass_stack");
    act("alice", "pass_stack");
    expect(sources(state)).toContain("observer-bob");
    expect(sources(state)).not.toContain("observer-alice");
    expect(
      state.pendingBurstChecks.find((c) => c.actingPlayerId === "alice")
        ?.effectSuppressed
    ).toBe(true);
  });
  for (const owner of ["alice", "bob"]) {
    for (const choiceIndex of [0, 1]) {
      it(`${owner}/BSTH05.5-C10/選択${choiceIndex}: 通常使用から破棄方法・対象選択を再開しても相手反応を抑止する`, () => {
        const opponent = owner === "alice" ? "bob" : "alice";
        const c10 = getDef("BSTH05.5-C10");
        let state: GameState = {
          ...createEmptyGameState({
            playerIds: ["alice", "bob"],
            playerOverrides: [
              { reserveNormalCoreCount: 10 },
              { reserveNormalCoreCount: 10 },
            ],
            cardInstances: [
              createCardInstance(c10, {
                instanceId: "source",
                ownerPlayerId: owner,
                zone: "hand",
              }),
              ...[owner, opponent].map((p) =>
                createCardInstance(observer, {
                  instanceId: `observer-${p}`,
                  ownerPlayerId: p,
                  zone: "field",
                  normalCoreCount: 1,
                })
              ),
              createCardInstance(burst, {
                instanceId: "opponent-burst",
                ownerPlayerId: opponent,
                zone: "burst",
              }),
              ...Array.from({ length: 5 }, (_, i) =>
                createCardInstance(i < 2 ? c10 : base, {
                  instanceId: `deck-${i}`,
                  ownerPlayerId: owner,
                  zone: "deck",
                })
              ),
            ],
            setBurstStates: [
              { playerId: opponent, cardInstanceId: "opponent-burst" },
            ],
          }),
          step: "main",
          activePlayerId: owner,
          turnNumber: 3,
        };
        const run = (
          player: string,
          kind: LegalAction["kind"],
          extra: Partial<Parameters<typeof applyLegalAction>[0]> = {}
        ) => {
          const action = getLegalActions({
            state,
            actingPlayerId: player,
            ...lookups,
          }).find(
            (a) =>
              a.kind === kind &&
              (a.kind !== "resolve_pending_step_choice" ||
                a.choiceIndex === choiceIndex)
          );
          expect(action).toBeDefined();
          state = applyLegalAction({
            state,
            action: action!,
            ...lookups,
            ...extra,
          }).state;
        };
        const assertSuppressed = () => {
          expect(sources(state)).not.toContain(`observer-${opponent}`);
          expect(sources(state)).toContain(`observer-${owner}`);
          expect(
            state.pendingBurstChecks.find((c) => c.actingPlayerId === opponent)
              ?.effectSuppressed
          ).toBe(true);
        };
        run(owner, "use_magic", {
          paymentSources: [{ kind: "reserve", amount: 4 }],
        });
        run(opponent, "pass_stack");
        expect(state.pendingStepChoice).not.toBeNull();
        expect(
          state.cardInstances.filter(
            (c) => c.ownerPlayerId === owner && c.zone === "hand"
          )
        ).toHaveLength(3);
        assertSuppressed();
        run(owner, "resolve_pending_step_choice");
        if (choiceIndex === 1) {
          expect(state.pendingZoneSelection).not.toBeNull();
          assertSuppressed();
          run(owner, "resolve_pending_zone_selection", {
            selectedZoneCardIds: ["deck-0"],
          });
        }
        expect(state.pendingStepChoice).toBeNull();
        expect(state.pendingZoneSelection).toBeNull();
        expect(state.pendingStackCascade).toBeNull();
        expect(
          state.cardInstances.find((c) => c.instanceId === "source")?.zone
        ).toBe("trash");
        expect(
          state.cardInstances.filter(
            (c) => c.ownerPlayerId === owner && c.zone === "hand"
          )
        ).toHaveLength(choiceIndex === 0 ? 0 : 2);
        expect(
          state.players.find((p) => p.id === owner)?.reserveNormalCoreCount
        ).toBe(6);
        assertSuppressed();
      });
    }
    for (const [cardNo, handCount, choiceIndex] of [
      ["BSTH02-M02", 0, 0],
      ["BSTH02-M02", 6, 0],
      ["BSTH03-M07", 0, 0],
      ["BSTH03-M07", 0, 1],
      ["BSTH05.5-C10", 0, 0],
      ["BSTH05.5-C10", 0, 1],
    ] as const) {
      it(`${owner}/${cardNo}/手札${handCount}/選択${choiceIndex}: 直接の相手反応のみ・複数・後続独立`, () => {
        const opponent = owner === "alice" ? "bob" : "alice";
        const effectIndex = cardNo === "BSTH05.5-C10" ? 1 : 0;
        const make = (
          no: string,
          id: string,
          player: string,
          zone: "field" | "hand" | "deck" | "burst" | "in_use"
        ) =>
          createCardInstance(getDef(no), {
            instanceId: id,
            ownerPlayerId: player,
            zone,
            normalCoreCount: zone === "field" ? 1 : 0,
          });
        const before: GameState = {
          ...createEmptyGameState({
            playerIds: ["alice", "bob"],
            cardInstances: [
              make(
                cardNo,
                "source",
                owner,
                cardNo === "BSTH05.5-C10" ? "in_use" : "burst"
              ),
              make(observer.cardNo, "own-observer", owner, "field"),
              make(observer.cardNo, "opponent-1", opponent, "field"),
              make(observer.cardNo, "opponent-2", opponent, "field"),
              make(burst.cardNo, "own-burst", owner, "burst"),
              make(burst.cardNo, "opponent-burst", opponent, "burst"),
              ...Array.from({ length: handCount }, (_, i) =>
                make(base.cardNo, `hand-${i}`, opponent, "hand")
              ),
              ...[owner, opponent].flatMap((p) =>
                Array.from({ length: 8 }, (_, i) =>
                  make(
                    cardNo === "BSTH05.5-C10" && i === 0 ? cardNo : base.cardNo,
                    `deck-${p}-${i}`,
                    p,
                    "deck"
                  )
                )
              ),
            ],
            setBurstStates: [
              { playerId: owner, cardInstanceId: "own-burst" },
              { playerId: opponent, cardInstanceId: "opponent-burst" },
            ],
            playerOverrides: ["alice", "bob"].map((p) => ({
              handCount: p === opponent ? handCount : 0,
              deckCount: 8,
              reserveNormalCoreCount: 10,
            })),
          }),
          activePlayerId: owner,
          step: "main",
          turnNumber: 3,
          activeContinuousEffects: [
            "own-observer",
            "opponent-1",
            "opponent-2",
          ].map((id) => ({
            effectId: `grant-${id}`,
            sourceInstanceId: "own-observer",
            sourceDefinitionId: observer.cardNo,
            actingPlayerId: owner,
            duration: { scope: "turn" },
            createdAtTurn: 3,
            createdAtAttackId: null,
            modifierTag: "granted_effect",
            targetInstanceId: id,
            metadata: { grantedEffect: observer.effects![0]! },
          })),
        };
        const after = executeEffectAndChooseEntryCores({
          state: before,
          sourceInstanceId: "source",
          actingPlayerId: owner,
          effect: getDef(cardNo).effects![effectIndex]!,
          effectIndex,
          chainId: "cause-resolution",
          summonEnterFieldCorePlacements: [
            { kind: "reserve_normal", amount: 1 },
          ],
          choiceIndex,
          getCardDefinitionById: getDef,
          deferCurrentEffectCleanup: true,
        });
        let queued = collectAndQueueTriggerReactions({
          beforeState: before,
          afterState: after,
          source: "action_resolution",
          chainId: "cause-resolution",
          causedByPlayerId: owner,
          causedBySourceInstanceId: "source",
          ...lookups,
        });
        expect(sources(queued)).toContain("own-observer");
        const granted = queued.pendingTriggeredEffects.filter(
          (p) => p.mechanic?.kind === "granted_effect"
        );
        expect(granted.filter((p) => p.actingPlayerId === owner)).toHaveLength(
          1
        );
        expect(
          granted.filter((p) => p.actingPlayerId === opponent)
        ).toHaveLength(cardNo === "BSTH03-M07" ? 2 : 0);
        for (const id of ["opponent-1", "opponent-2"])
          expect(sources(queued).includes(id)).toBe(cardNo === "BSTH03-M07");
        expect(
          queued.pendingBurstChecks.find((c) => c.actingPlayerId === opponent)
            ?.effectSuppressed
        ).toBe(true);
        expect(
          queued.pendingBurstChecks.find((c) => c.actingPlayerId === owner)
            ?.effectSuppressed
        ).not.toBe(true);
        // 未解決の予約が残っていても、別の解決 ID に抑止が漏れない。
        const clean = {
          ...queued,
          pendingTriggeredEffects: [],
          pendingPrivateDeclarations: [],
          pendingBurstChecks: [],
        };
        const later = executeEffectAndChooseEntryCores({
          state: clean,
          sourceInstanceId: "source",
          actingPlayerId: owner,
          chainId: "later-same-card",
          effect: {
            timing: { kind: "activated", mode: "main" },
            steps: [{ action: { kind: "draw", count: 1 } }],
          },
          getCardDefinitionById: getDef,
          deferCurrentEffectCleanup: true,
        });
        const laterQueued = collectAndQueueTriggerReactions({
          beforeState: clean,
          afterState: later,
          source: "action_resolution",
          chainId: "later-same-card",
          causedByPlayerId: owner,
          causedBySourceInstanceId: "source",
          ...lookups,
        });
        expect(sources(laterQueued)).toEqual(
          expect.arrayContaining(["opponent-1", "opponent-2", "own-observer"])
        );
        expect(
          laterQueued.pendingBurstChecks.every((c) => !c.effectSuppressed)
        ).toBe(true);
        queued = expireCurrentEffectContinuousEffects(
          queued,
          "source",
          effectIndex
        );
        expect(
          queued.activeContinuousEffects.some(
            (ce) => ce.modifierTag === "negate_caused_reaction"
          )
        ).toBe(false);
        expect(
          queued.pendingBurstChecks.find((c) => c.actingPlayerId === opponent)
            ?.effectSuppressed
        ).toBe(true);
      });
    }
  }
});
