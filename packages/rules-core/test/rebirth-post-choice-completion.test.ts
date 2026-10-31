import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { applyLegalAction, getLegalActions } from "../src";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { GameState, RebirthAction } from "../src/model";
import { executeRebirth } from "../src/effect/structured-card-replacement";
import {
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "../src/effect/structured-effect-registrations";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const byId = new Map(
  definitions.map((definition) => [definition.cardNo, definition])
);
const lookups = {
  getCardDefinitionById: (id: string) => byId.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
};
const player = (state: GameState) => state.players[0]!;
const source = (state: GameState) =>
  state.cardInstances.find((card) => card.instanceId === "source")!;

function actionFor(cardNo: string): RebirthAction {
  for (const effect of byId.get(cardNo)!.effects ?? []) {
    for (const step of effect.steps) {
      if (step.action.kind === "rebirth" && step.action.postRebirthChoice) {
        return { ...step.action, triggerDescription: "C-rebirth regression" };
      }
    }
  }
  throw new Error(`No printed post-choice rebirth: ${cardNo}`);
}

function board(cardNo: string, cores = 0, reserve = 2, withHost = false) {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      {
        countValue: 1,
        reserveNormalCoreCount: reserve,
        reserveSoulCoreCount: 0,
        soulCoreLocation: { kind: "trash" },
        voidNormalCoreCount: 20,
      },
      {},
    ],
    cardInstances: [
      createCardInstance(byId.get(cardNo)!, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: cores,
      }),
      ...(withHost
        ? [
            createCardInstance(
              byId.get(
                cardNo.startsWith("BSTH09")
                  ? "BSTH09-X01"
                  : cardNo.includes("X04")
                    ? "BSSA01-X02"
                    : "BSSA01-X01"
              )!,
              {
                instanceId: "host",
                ownerPlayerId: "alice",
                zone: "field",
                normalCoreCount: 2,
              }
            ),
          ]
        : []),
    ],
  });
}

function queue(
  state: GameState,
  action = actionFor(source(state).definitionId)
) {
  return executeRebirth(
    state,
    "alice",
    action,
    "source",
    lookups.getCardDefinitionById,
    "test:C-rebirth",
    "pending_triggered:C-rebirth"
  );
}

function combine(state: GameState, host: string | null) {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).find(
    (candidate) =>
      candidate.kind === "resolve_brave_combine_choice" &&
      candidate.chosenHostInstanceId === host
  );
  expect(action).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups }).state;
}

function coreAction(state: GameState) {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).find(
    (candidate) => candidate.kind === "resolve_pending_core_distribution"
  );
  expect(action).toBeDefined();
  return action!;
}

function place(state: GameState, amount = 1) {
  return applyLegalAction({
    state,
    action: coreAction(state),
    ...lookups,
    coreDistributionAllocations: amount ? { source: amount } : {},
    coreDistributionSourceAllocations: amount ? { reserve: amount } : {},
  }).state;
}

describe("C-rebirth: printed choices commit only after valid input", () => {
  it.each(["BSSA01-転醒X01(A)", "BSSA01-転醒X04(A)"])(
    "%s: combine and core routes keep A/count until completion (JSON round trip)",
    (cardNo) => {
      const pending = queue(board(cardNo, 0, 2, true));
      expect(source(pending).definitionId).toBe(cardNo);
      expect(player(pending).countValue).toBe(1);
      expect(
        pending.pendingTriggeredEffects.filter(
          (effect) => effect.eventKind === "rebirth"
        )
      ).toHaveLength(0);
      expect(pending.resolvedRebirthTimingWindowIds ?? []).not.toContain(
        "pending_triggered:C-rebirth"
      );
      const combined = combine(JSON.parse(JSON.stringify(pending)), "host");
      expect(source(combined).definitionId).toBe(cardNo.replace("(A)", "(B)"));
      expect(source(combined).attachedToInstanceId).toBe("host");
      expect(player(combined).countValue).toBe(2);
      expect(player(combined).voidNormalCoreCount).toBe(19);
      const corePending = combine(JSON.parse(JSON.stringify(pending)), null);
      expect(source(corePending).definitionId).toBe(cardNo);
      expect(player(corePending).countValue).toBe(1);
      const placed = place(JSON.parse(JSON.stringify(corePending)));
      expect(source(placed).definitionId).toBe(cardNo.replace("(A)", "(B)"));
      expect(source(placed).normalCoreCount).toBe(1);
      expect(player(placed).countValue).toBe(2);
      expect(player(placed).reserveNormalCoreCount).toBe(1);
      expect(placed.pendingCoreDistribution).toBeNull();
      expect(
        placed.log.findIndex((entry) => entry.includes(":flip_to:"))
      ).toBeLessThan(
        placed.log.findIndex((entry) => entry.includes(":completion:count"))
      );
    }
  );

  it.each(["BSSA01-転醒X01(A)", "BSSA01-転醒X04(A)"])(
    "%s: no host/no movable core leaves the front face and count intact",
    (cardNo) => {
      const blocked = queue(board(cardNo, 0, 0));
      expect(source(blocked).definitionId).toBe(cardNo);
      expect(player(blocked).countValue).toBe(1);
      expect(blocked.pendingStoneFlipCombine).toBeNull();
      expect(blocked.pendingCoreDistribution).toBeNull();
      expect(blocked.log.some((entry) => entry.includes(":flip_to:"))).toBe(
        false
      );
    }
  );

  it("BSTH09-TR01(A): declining optional combine completes rebirth without attaching", () => {
    const pending = queue(board("BSTH09-TR01(A)", 1, 2, true));
    expect(source(pending).definitionId).toBe("BSTH09-TR01(A)");
    const resolved = combine(pending, null);
    expect(source(resolved).definitionId).toBe("BSTH09-TR01(B)");
    expect(source(resolved).attachedToInstanceId).toBeNull();
    expect(player(resolved).countValue).toBe(2);
  });

  it.each(["count", "same timing"])(
    "core completion rejected by %s does not move cores, count, or resume subsequent steps",
    (reason) => {
      const pending = queue(board("BSTH02.7-TR01(A)"));
      if (reason === "count") player(pending).countValue = 10;
      else
        pending.resolvedRebirthTimingWindowIds = [
          "pending_triggered:C-rebirth",
        ];
      const expectedCount = player(pending).countValue;
      const resolved = place(pending);
      expect(source(resolved).definitionId).toBe("BSTH02.7-TR01(A)");
      expect(source(resolved).normalCoreCount).toBe(0);
      expect(player(resolved).reserveNormalCoreCount).toBe(2);
      expect(player(resolved).countValue).toBe(expectedCount);
      expect(resolved.pendingCoreDistribution).toBeNull();
      expect(
        resolved.pendingTriggeredEffects.filter(
          (effect) => effect.eventKind === "rebirth"
        )
      ).toHaveLength(0);
      expect(
        resolved.log.some((entry) => entry.includes(":completion:count"))
      ).toBe(false);
    }
  );

  it.each(["BSSA01-転醒X01(A)", "BSSA01-転醒X04(A)", "BSTH02.7-TR01(A)"])(
    "%s: empty mandatory placement cancels without swapping or spending",
    (cardNo) => {
      let pending = queue(board(cardNo));
      if (pending.pendingStoneFlipCombine) pending = combine(pending, null);
      const resolved = place(pending, 0);
      expect(source(resolved).definitionId).toBe(cardNo);
      expect(player(resolved).countValue).toBe(1);
      expect(player(resolved).reserveNormalCoreCount).toBe(2);
      expect(resolved.pendingCoreDistribution).toBeNull();
    }
  );

  it("BSFT01-TR01(A): B-face trigger is collected after placement and count, exactly once", () => {
    const pending = queue(board("BSFT01-TR01(A)", 0));
    expect(source(pending).definitionId).toBe("BSFT01-TR01(A)");
    expect(
      pending.pendingTriggeredEffects.filter(
        (effect) => effect.eventKind === "rebirth"
      )
    ).toHaveLength(0);
    const resolved = place(JSON.parse(JSON.stringify(pending)));
    expect(source(resolved).definitionId).toBe("BSFT01-TR01(B)");
    expect(source(resolved).normalCoreCount).toBe(1);
    expect(player(resolved).countValue).toBe(2);
    expect(
      resolved.pendingTriggeredEffects.filter(
        (effect) => effect.eventKind === "rebirth"
      )
    ).toHaveLength(1);
  });

  it("mandatory combine cannot be bypassed by a null input", () => {
    const pending = queue(board("BSTH09-TR01(A)", 1, 2, true), {
      ...actionFor("BSTH09-TR01(A)"),
      postRebirthChoice: { kind: "brave_combine", optional: false },
    });
    const action = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      ...lookups,
    }).find((candidate) => candidate.kind === "resolve_brave_combine_choice")!;
    expect(() =>
      applyLegalAction({
        state: pending,
        action: { ...action, chosenHostInstanceId: null } as typeof action,
        ...lookups,
      })
    ).toThrow(/combine/i);
    expect(source(pending).definitionId).toBe("BSTH09-TR01(A)");
    expect(player(pending).countValue).toBe(1);
  });

  it("a host that left during an interrupted prompt is rejected before face/count commit", () => {
    const pending = queue(board("BSSA01-転醒X01(A)", 0, 2, true));
    const action = getLegalActions({
      state: pending,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (candidate) =>
        candidate.kind === "resolve_brave_combine_choice" &&
        candidate.chosenHostInstanceId === "host"
    )!;
    pending.cardInstances.find((card) => card.instanceId === "host")!.zone =
      "trash";
    expect(() =>
      applyLegalAction({ state: pending, action, ...lookups })
    ).toThrow(/combine host/i);
    expect(source(pending).definitionId).toBe("BSSA01-転醒X01(A)");
    expect(player(pending).countValue).toBe(1);
  });

  it.each([
    "BSSA01-転醒X01(A)",
    "BSSA01-転醒X04(A)",
    "BSTH02.7-TR01(A)",
    "BSFT01-TR01(A)",
  ])(
    "%s: a soul core alone satisfies placement and preserves the count ordering",
    (cardNo) => {
      const before = board(cardNo, 0, 0);
      player(before).reserveSoulCoreCount = 1;
      player(before).soulCoreLocation = { kind: "reserve" };
      let pending = queue(before);
      if (pending.pendingStoneFlipCombine) pending = combine(pending, null);
      expect(source(pending).definitionId).toBe(cardNo);
      const resolved = applyLegalAction({
        state: pending,
        action: coreAction(pending),
        ...lookups,
        coreDistributionAllocations: {},
        coreDistributionSoulCoreInstanceId: "source",
      }).state;
      expect(source(resolved).definitionId).toBe(cardNo.replace("(A)", "(B)"));
      expect(source(resolved).soulCoreCount).toBe(1);
      expect(player(resolved).soulCoreLocation).toEqual({
        kind: "card",
        instanceId: "source",
      });
      expect(player(resolved).countValue).toBe(2);
    }
  );

  it.each(["hand", "set_aside", "in_use"] as const)(
    "BSFT01 magic rebirth from %s keeps the front face until placement",
    (zone) => {
      const before = board("BSFT01-TR01(A)");
      source(before).zone = zone;
      const pending = queue(before);
      expect(source(pending)).toMatchObject({
        zone,
        definitionId: "BSFT01-TR01(A)",
      });
      expect(player(pending).countValue).toBe(1);
      const resolved = place(JSON.parse(JSON.stringify(pending)));
      expect(source(resolved)).toMatchObject({
        zone: "field",
        definitionId: "BSFT01-TR01(B)",
        normalCoreCount: 1,
      });
      expect(player(resolved).countValue).toBe(2);
      expect(
        resolved.pendingTriggeredEffects.filter(
          (effect) => effect.eventKind === "rebirth"
        )
      ).toHaveLength(1);
    }
  );

  it.each(
    definitions
      .filter(
        (definition) =>
          definition.cardNo.startsWith("BSFT01-TR") &&
          definition.cardNo.endsWith("(A)")
      )
      .map((definition) => definition.cardNo)
  )(
    "%s: every key's printed core choice preserves face and count before input",
    (cardNo) => {
      const pending = queue(board(cardNo, 0));
      expect(source(pending).definitionId).toBe(cardNo);
      expect(player(pending).countValue).toBe(1);
      expect(pending.pendingCoreDistribution).not.toBeNull();
      expect(
        pending.pendingTriggeredEffects.filter(
          (effect) => effect.eventKind === "rebirth"
        )
      ).toHaveLength(0);
    }
  );

  it("insufficient reserve at resumption rejects placement without modifying the input board", () => {
    const pending = combine(queue(board("BSSA01-転醒X01(A)")), null);
    player(pending).reserveNormalCoreCount = 0;
    const beforeInput = JSON.stringify(pending);
    expect(() => place(pending)).toThrow(/Not enough normal cores/);
    expect(JSON.stringify(pending)).toBe(beforeInput);
  });

  it("an oversized mandatory placement is rejected while A/count remain unchanged", () => {
    const pending = combine(queue(board("BSSA01-転醒X04(A)")), null);
    const beforeInput = JSON.stringify(pending);
    expect(() => place(pending, 2)).toThrow(/exceeds maximum/);
    expect(JSON.stringify(pending)).toBe(beforeInput);
  });
});
