import { describe, expect, it } from "vitest";
import {
  applySelectedBurstCascadeAction,
  buildSelectedBurstCascadeFixture,
  type SelectedBurstCascadeFixture,
} from "./fixtures/selected-burst-cascade";

function resolveC14Response(fixture: SelectedBurstCascadeFixture) {
  let state = fixture.state;
  // Follow the server-generated priority through the nested C14 response. When
  // there is no parent stack, resolution may close the window after one pass.
  for (let i = 0; i < 4; i += 1) {
    if (
      state.stackWindow?.pendingStackAction?.cardInstanceId !==
      fixture.ids.negateSourceInstanceId
    )
      break;
    const actor = state.stackWindow.priorityPlayerId;
    state = applySelectedBurstCascadeAction(state, actor, "pass_stack");
  }
  return state;
}

function finishParentBurst(
  fixture: SelectedBurstCascadeFixture,
  state: ReturnType<typeof resolveC14Response>
) {
  for (let i = 0; i < 6; i += 1) {
    if (
      !state.pendingBurstChecks.some(
        (check) => check.checkId === fixture.ids.parentBurstCheckId
      )
    )
      return state;
    const priority = state.stackWindow?.priorityPlayerId;
    if (!priority) return state;
    state = applySelectedBurstCascadeAction(state, priority, "pass_stack");
  }
  return state;
}

describe("selected burst parent cascade survives a C14 response", () => {
  it.each([false, true])(
    "retains and completes working then parent once (reverse=%s)",
    (reversePlayers) => {
      const fixture = buildSelectedBurstCascadeFixture({ reversePlayers });
      const resolved = resolveC14Response(fixture);
      // The working Bob M03 must finish/cancel first, then the suspended parent
      // Alice M03 must be the next active stack. A lost or duplicated stack cannot
      // satisfy both the event count and next-stack assertions.
      expect(resolved.stackWindow?.pendingStackAction?.cardInstanceId).toBe(
        fixture.ids.parentBurstInstanceId
      );
      expect(
        resolved.log.filter((entry) =>
          entry.startsWith(`burst:resolved:${fixture.ids.workingBurstCheckId}:`)
        )
      ).toHaveLength(1);
      expect(resolved.pendingBurstChecks.map((check) => check.checkId)).toEqual(
        [fixture.ids.parentBurstCheckId]
      );

      const finished = finishParentBurst(fixture, resolved);
      expect(
        finished.log.filter((entry) =>
          entry.startsWith(`burst:resolved:${fixture.ids.parentBurstCheckId}:`)
        )
      ).toHaveLength(1);
      expect(finished.pendingBurstChecks).toEqual([]);
      expect(finished.pendingStackCascade).toBeNull();
      expect(finished.pendingImmediateBattleEnds).toEqual([]);
      expect(finished.pendingStackNegateRequests).toEqual([]);
      expect(finished.gameResult).toBeNull();
      const completions = finished.log.filter(
        (entry) =>
          entry.startsWith(
            `burst:resolved:${fixture.ids.workingBurstCheckId}:`
          ) ||
          entry.startsWith(`burst:resolved:${fixture.ids.parentBurstCheckId}:`)
      );
      expect(completions).toHaveLength(2);
      expect(completions[0]).toContain(fixture.ids.workingBurstCheckId);
      expect(completions[1]).toContain(fixture.ids.parentBurstCheckId);
    }
  );

  it("does not fabricate a parent when only the working burst exists", () => {
    const fixture = buildSelectedBurstCascadeFixture({ includeParent: false });
    const resolved = resolveC14Response(fixture);
    expect(resolved.pendingBurstChecks).toEqual([]);
    expect(
      resolved.log.filter((entry) =>
        entry.startsWith(`burst:resolved:${fixture.ids.workingBurstCheckId}:`)
      )
    ).toHaveLength(1);
    expect(
      resolved.log.some((entry) =>
        entry.includes(fixture.ids.parentBurstCheckId)
      )
    ).toBe(false);
  });
});
