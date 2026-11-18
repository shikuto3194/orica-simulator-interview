import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  rebuildContinuousEffectsFromField,
  type GameState,
} from "../src";
import { flushPendingLeaves } from "../src/state-based-actions";
import { resolveEmptyFireTargetCounts } from "../src/legal/legal-actions-shared";

const definitions = ALL_CARDS.flatMap((c) =>
  c.rebirthFace ? [c, c.rebirthFace] : [c]
);
const getCardDefinitionById = (id: string) =>
  definitions.find((c) => c.cardNo === id);
const card = (id: string) => getCardDefinitionById(id)!;
const lookups = {
  getCardDefinitionById,
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: () => undefined,
};
const instance = (no: string, id: string, owner = "alice", cores = 2) =>
  createCardInstance(card(no), {
    instanceId: id,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
  });

describe("printed quantities resolve as far as possible", () => {
  for (const no of ["BSTH06-C03", "BSTH05-R01", "BSSG01-X01"]) {
    it.each([1, 2])(
      `${no}: public optional path with %i eligible targets`,
      (count) => {
        const own = no !== "BSSG01-X01";
        let state: GameState = {
          ...createEmptyGameState({
            playerIds: ["alice", "bob"],
            cardInstances: [
              instance(no, "source"),
              ...Array.from({ length: own ? count - 1 : count }, (_, i) =>
                instance(
                  own ? no : "BSTH06-C03",
                  `target-${i}`,
                  own ? "alice" : "bob"
                )
              ),
            ],
            playerOverrides: [
              { reserveNormalCoreCount: 5, voidNormalCoreCount: 50 },
              {},
            ],
          }),
          step: "main",
          activePlayerId: "alice",
          turnNumber: 3,
        };
        state = queuePendingReactionsFromTriggerEvents(
          state,
          [
            {
              actingPlayerId: "alice",
              eventKind: own ? "summon" : "advent",
              source: "action_resolution",
              chainId: `partial:${no}:${count}`,
              attackId: null,
              relatedPlayerId: "alice",
              relatedInstanceId: "source",
              amount: null,
            },
          ],
          undefined,
          lookups
        );
        const actions = (actor = "alice") =>
          getLegalActions({ state, actingPlayerId: actor, ...lookups });
        const apply = (
          action: ReturnType<typeof actions>[number] | undefined
        ) => {
          expect(action).toBeDefined();
          state = applyLegalAction({
            state,
            action: action!,
            ...lookups,
          }).state;
        };
        apply(
          actions().find(
            (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
          )
        );
        for (let i = 0; state.stackWindow && i < 6; i++)
          apply(
            actions(state.stackWindow.priorityPlayerId).find(
              (a) => a.kind === "pass_stack"
            )
          );
        expect(state.stackWindow).toBeNull();
        state = JSON.parse(JSON.stringify(state)) as GameState;
        apply(
          actions().find(
            (a) =>
              a.kind === "resolve_pending_step_optional_choice" &&
              a.choice === "execute"
          )
        );
        for (let i = 0; i < 8; i++) {
          const pending = actions().find(
            (a) =>
              a.kind === "resolve_pending_effect_target" ||
              a.kind === "resolve_pending_step_optional_target_selection"
          );
          if (!pending) break;
          state = applyLegalAction({
            state,
            action: pending,
            ...lookups,
            targetInstanceIds: own
              ? [
                  "source",
                  ...Array.from({ length: count - 1 }, (_, n) => `target-${n}`),
                ]
              : Array.from({ length: count }, (_, n) => `target-${n}`),
          }).state;
        }
        if (own) {
          expect(
            state.cardInstances.find((c) => c.instanceId === "source")!
              .normalCoreCount
          ).toBe(3);
          expect(
            state.cardInstances
              .filter((c) => c.instanceId.startsWith("target-"))
              .every((c) => c.normalCoreCount === 3)
          ).toBe(true);
          expect(state.players[0]!.voidNormalCoreCount).toBe(50 - count);
        } else {
          expect(
            state.cardInstances
              .filter((c) => c.instanceId.startsWith("target-"))
              .every((c) => c.exhaustState === "heavily_exhausted")
          ).toBe(true);
          apply(
            actions().find(
              (a) =>
                a.kind === "resolve_pending_step_optional_choice" &&
                a.choice === "execute"
            )
          );
          const target = actions().find(
            (a) =>
              a.kind === "resolve_pending_effect_target" ||
              a.kind === "resolve_pending_step_optional_target_selection"
          );
          if (target)
            state = applyLegalAction({
              state,
              action: target,
              ...lookups,
              targetInstanceIds: Array.from(
                { length: count },
                (_, n) => `target-${n}`
              ),
            }).state;
          state = flushPendingLeaves(state, getCardDefinitionById);
          expect(
            state.cardInstances
              .filter((c) => c.instanceId.startsWith("target-"))
              .map((c) => c.zone)
          ).toEqual(Array(count).fill("deck"));
        }
      }
    );
  }

  for (const no of ["BSTH05-C11", "BSTH05-C12", "BSES01-M04"]) {
    it.each([0, 1, 2, 3, -1])(
      `${no}: full payment and %i targets (-1 = insufficient payment)`,
      (inputCount) => {
        const count = inputCount < 0 ? 1 : inputCount;
        const brave = no === "BSES01-M04";
        const cost = brave ? 5 : 3;
        const payerCores = inputCount < 0 ? cost - 1 : 10;
        const succeeds = count > 0 && payerCores >= cost;
        const effectIndex = brave ? 2 : 1;
        const source = {
          ...instance(no, "source"),
          ...(brave ? { attachedToInstanceId: "host" } : {}),
        };
        const state: GameState = {
          ...createEmptyGameState({
            playerIds: ["alice", "bob"],
            cardInstances: [
              source,
              instance("BSTH06-C03", "host"),
              instance(
                brave ? "BSES01-CX01" : "BSTH05-X01",
                "payer",
                "alice",
                payerCores
              ),
              ...Array.from({ length: count }, (_, n) =>
                instance("BSTH06-C03", `target-${n}`, "bob")
              ),
            ],
            playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
          }),
          step: "main",
          activePlayerId: "alice",
        };
        const selected = Math.min(count, brave ? 2 : 3);
        let after = executeEffect({
          state,
          effect: card(no).effects![effectIndex]!,
          effectIndex,
          sourceInstanceId: "source",
          actingPlayerId: "alice",
          chainId: `partial:${no}:${count}`,
          ...lookups,
          choiceIndex: 1,
          targetInstanceIds: Array.from(
            { length: selected },
            (_, n) => `target-${n}`
          ),
        });
        after = flushPendingLeaves(after, getCardDefinitionById);
        expect(
          after.cardInstances.find((c) => c.instanceId === "payer")!
            .normalCoreCount
        ).toBe(succeeds ? payerCores - cost : payerCores);
        for (let n = 0; n < selected; n++)
          expect(
            after.cardInstances.find((c) => c.instanceId === `target-${n}`)
          ).toMatchObject(
            !succeeds
              ? { zone: "field", exhaustState: "recovered" }
              : no === "BSTH05-C12"
                ? { exhaustState: "exhausted", zone: "field" }
                : { zone: brave ? "deck" : "hand" }
          );
      }
    );
  }

  it.each([1, 2])(
    "BSTH02-XX01 sequential targets: %i opponents still resolve and continue",
    (count) => {
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            instance("BSTH02-XX01", "source", "alice", 3),
            ...Array.from({ length: count }, (_, i) =>
              instance("BSTH06-C03", `enemy-${i}`, "bob")
            ),
          ],
        }),
        activePlayerId: "alice",
        step: "main",
      };
      let after = executeEffect({
        state,
        effect: card("BSTH02-XX01").effects![0]!,
        effectIndex: 0,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        chainId: "partial:sequential",
        ...lookups,
        sequentialTargetConsumption: true,
        targetInstanceIds: Array.from(
          { length: count },
          (_, i) => `enemy-${i}`
        ),
      });
      expect(after.pendingStepOptionalChoice).not.toBeNull();
      const decline = getLegalActions({
        state: after,
        actingPlayerId: "alice",
        ...lookups,
      }).find(
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "decline"
      );
      expect(decline).toBeDefined();
      after = applyLegalAction({
        state: after,
        action: decline!,
        ...lookups,
      }).state;
      after = flushPendingLeaves(after, getCardDefinitionById);
      expect(
        after.cardInstances
          .filter((c) => c.ownerPlayerId === "bob")
          .map((c) => c.zone)
      ).toEqual(Array(count).fill("deck"));
      expect(
        after.cardInstances.find((c) => c.instanceId === "source")
          ?.underCards ?? []
      ).toEqual([]);
      if (count === 2)
        expect(() =>
          executeEffect({
            state,
            effect: card("BSTH02-XX01").effects![0]!,
            sourceInstanceId: "source",
            actingPlayerId: "alice",
            chainId: "partial:underspecified",
            ...lookups,
            sequentialTargetConsumption: true,
            targetInstanceIds: ["enemy-0"],
          })
        ).toThrow(/missing required target/);
    }
  );

  it.each([false, true])(
    "C12: a confirmed immune target rolls back payment and all exhaustion (%s)",
    (withVulnerable) => {
      let state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            instance("BSTH05-C12", "source"),
            instance("BSTH05-X01", "payer", "alice", 10),
            instance("BSTH05-M11", "immune", "bob"),
            ...(withVulnerable
              ? [instance("BSTH06-C03", "vulnerable", "bob")]
              : []),
          ],
        }),
        activePlayerId: "alice",
        step: "main",
      };
      state = rebuildContinuousEffectsFromField(state, getCardDefinitionById);
      const after = executeEffect({
        state,
        effect: card("BSTH05-C12").effects![1]!,
        effectIndex: 1,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        choiceIndex: 1,
        chainId: "partial:resistance",
        ...lookups,
        targetInstanceIds: [
          "immune",
          ...(withVulnerable ? ["vulnerable"] : []),
        ],
      });
      expect(
        after.cardInstances.find((c) => c.instanceId === "payer")
          ?.normalCoreCount
      ).toBe(10);
      expect(
        after.cardInstances.find((c) => c.instanceId === "immune")?.exhaustState
      ).toBe("recovered");
      if (withVulnerable)
        expect(
          after.cardInstances.find((c) => c.instanceId === "vulnerable")
            ?.exhaustState
        ).toBe("recovered");
    }
  );

  it("BSRK01-R02: sequential path skips the optional ordinary nexus and resolves one grandwalker", () => {
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          instance("BSRK01-R02", "source"),
          instance("BSSG01-C07", "ordinary", "bob"),
          instance("BSTH05-X01", "grandwalker", "bob", 4),
        ],
      }),
      activePlayerId: "alice",
      step: "main",
    };
    let after = executeEffect({
      state,
      effect: card("BSRK01-R02").effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      chainId: "partial:groups",
      ...lookups,
      sequentialTargetConsumption: true,
      targetInstanceIds: ["grandwalker"],
    });
    after = flushPendingLeaves(after, getCardDefinitionById);
    expect(
      after.cardInstances.find((c) => c.instanceId === "ordinary")?.zone
    ).toBe("field");
    expect(
      after.cardInstances.find((c) => c.instanceId === "grandwalker")
    ).toMatchObject({ zone: "field", normalCoreCount: 0 });
  });

  it("result shortage clamps to candidates; payment shortage and zero result stay blocked", () => {
    expect(
      resolveEmptyFireTargetCounts({
        requiredTargetCount: 3,
        maxTargetCount: 3,
        candidateCount: 1,
        gatedByConditionalCost: true,
      })
    ).toEqual({ block: false, requiredTargetCount: 1, maxTargetCount: 1 });
    expect(
      resolveEmptyFireTargetCounts({
        requiredTargetCount: 3,
        maxTargetCount: 3,
        candidateCount: 1,
        gatedByConditionalCost: false,
        requiresFullCount: true,
      }).block
    ).toBe(true);
    expect(
      resolveEmptyFireTargetCounts({
        requiredTargetCount: 3,
        maxTargetCount: 3,
        candidateCount: 0,
        gatedByConditionalCost: true,
      }).block
    ).toBe(true);
  });
});
