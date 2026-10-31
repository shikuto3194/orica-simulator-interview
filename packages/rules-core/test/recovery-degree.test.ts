import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
} from "../src";
import type { Action, ExhaustState } from "../src";
import { refreshExhaustStates } from "../src/core/core-system";
import { getCandidateTargetInstanceIds } from "../src/legal/legal-actions-shared";
import { collectTriggerEventsFromStateDelta } from "../src/effect/trigger-system";
import { appendPublicDisclosuresForEffectStepTransition } from "../src/public-disclosure";

const cards = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const lookup = (id: string) => cards.find((card) => card.cardNo === id);
const eugeo = lookup("BSSA01-転醒X03(A)")!;

function board(exhaustState: ExhaustState) {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(eugeo, {
        instanceId: "host",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 4,
        exhaustState,
        attachedChildrenIds: ["brave"],
      }),
      createCardInstance(lookup("BSSA01-転醒X02(A)")!, {
        instanceId: "brave",
        ownerPlayerId: "alice",
        zone: "field",
        attachedToInstanceId: "host",
        exhaustState,
      }),
    ],
  });
}

function resolve(state: ReturnType<typeof board>, action?: Action) {
  return executeEffect({
    chainId: "test:recovery-degree:43",
    state,
    effect: action
      ? { timing: { kind: "activated", mode: "flash" }, steps: [{ action }] }
      : eugeo.effects![3]!,
    sourceInstanceId: "host",
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
  });
}

describe("回復すると回復状態にするの区別", () => {
  it.each([
    ["heavily_exhausted", "exhausted"],
    ["exhausted", "recovered"],
    ["recovered", "recovered"],
  ] as const)("ユージオの回復: %s → %s、合体子も同期する", (before, after) => {
    const state = board(before);
    const result = resolve(state);
    expect(result.cardInstances.map((card) => card.exhaustState)).toEqual([
      after,
      after,
    ]);
    expect(state.cardInstances[0]!.exhaustState).toBe(before);
    const events = collectTriggerEventsFromStateDelta({
      beforeState: state,
      afterState: result,
      source: "effect_resolution",
      getCardDefinitionById: lookup,
    }).filter((event) => event.eventKind === "recover");
    expect(events.map((event) => event.relatedInstanceId)).toEqual(
      before === after ? [] : ["host"]
    );
  });

  it("通常回復2回で重疲労から回復状態になる", () => {
    const recover: Action = { kind: "recover", target: { kind: "self" } };
    const once = resolve(board("heavily_exhausted"), recover);
    expect(once.cardInstances[0]!.exhaustState).toBe("exhausted");
    expect(resolve(once, recover).cardInstances[0]!.exhaustState).toBe(
      "recovered"
    );
  });

  it("回復状態にするなら重疲労から直接回復する", () => {
    const result = resolve(board("heavily_exhausted"), {
      kind: "set_exhaust_state",
      state: "recovered",
      target: { kind: "self" },
    });
    expect(result.cardInstances.map((card) => card.exhaustState)).toEqual([
      "recovered",
      "recovered",
    ]);
  });

  it("一段階回復でも回復として公開し、完全回復まで疲労原因を保持する", () => {
    const before = board("heavily_exhausted");
    before.cardInstances[0]!.exhaustedByUnpreventableEffect = true;
    const action: Action = { kind: "recover", target: { kind: "self" } };
    const after = resolve(before, action);
    expect(after.cardInstances[0]!.exhaustedByUnpreventableEffect).toBe(true);
    expect(
      resolve(after, action).cardInstances[0]!.exhaustedByUnpreventableEffect
    ).toBe(false);
    const disclosed = appendPublicDisclosuresForEffectStepTransition({
      before,
      after,
      action,
      actorPlayerId: "alice",
      sourceInstanceId: "host",
    });
    expect(
      disclosed.publicDisclosures.flatMap((entry) => entry.results)
    ).toContainEqual(
      expect.objectContaining({
        kind: "exhaust_state",
        instanceId: "host",
        exhaustState: "exhausted",
        actionLabel: "recover",
      })
    );
  });

  it.each([
    ["recover", "heavily_exhausted", "heavily_exhausted", "recovered"],
    ["recover", "exhausted", "exhausted", "recovered"],
    ["become_recovered", "heavily_exhausted", "exhausted", "heavily_exhausted"],
    ["become_recovered", "exhausted", "exhausted", "exhausted"],
  ] as const)(
    "禁止文言 %s / %s: 通常回復と状態指定を区別する",
    (restriction, initial, stepped, fully) => {
      const before = resolve(board(initial), {
        kind: "restrict_recovery",
        player: "self",
        restriction,
        duration: { scope: "turn" },
      });
      const action: Action = { kind: "recover", target: { kind: "self" } };
      expect(resolve(before, action).cardInstances[0]!.exhaustState).toBe(
        stepped
      );
      expect(
        resolve(before, {
          kind: "set_exhaust_state",
          state: "recovered",
          target: { kind: "self" },
        }).cardInstances[0]!.exhaustState
      ).toBe(fully);
      expect(
        refreshExhaustStates(before, "alice", lookup).cardInstances[0]!
          .exhaustState
      ).toBe(stepped);
      const candidates = getCandidateTargetInstanceIds(
        before,
        "alice",
        {
          candidateTargetZones: ["field"],
          candidateTargetPlayerScope: "acting_player",
          targetCardFilterActionKind: "recover",
        },
        { getCardDefinitionById: lookup }
      );
      expect(candidates.includes("host")).toBe(initial !== stepped);
    }
  );

  it.each(["heavily_exhausted", "exhausted", "recovered"] as const)(
    "次回リフレッシュ禁止を %s でも消費する",
    (initial) => {
      let marked = resolve(
        board(initial === "recovered" ? "exhausted" : initial),
        { kind: "prevent_next_recovery", target: { kind: "self" } }
      );
      if (initial === "recovered")
        marked = resolve(marked, {
          kind: "set_exhaust_state",
          state: "recovered",
          target: { kind: "self" },
        });
      const first = refreshExhaustStates(marked, "alice", lookup);
      expect(first.cardInstances[0]!.exhaustState).toBe(initial);
      expect(first.cardInstances[0]!.skipNextRefreshRecovery).toBe(false);
      const second = refreshExhaustStates(first, "alice", lookup);
      expect(second.cardInstances[0]!.exhaustState).toBe(
        initial === "heavily_exhausted" ? "exhausted" : "recovered"
      );
    }
  );

  it("全収録面の『回復状態に』本文に通常recoverを割り当てない", () => {
    const explicit = cards.filter((card) =>
      card.textLines.some((line) => /回復状態に/.test(line))
    );
    expect(explicit.map((card) => card.cardNo).sort()).toEqual([
      "BSKB01-TX01(A)",
      "BSSA01-転醒X02(B)",
      "BSTH01-M01",
      "BSTH08.5-X02",
    ]);
    for (const card of explicit) {
      const effects = card.effects!.filter((effect) =>
        effect.textRef?.some((index) =>
          /回復状態に/.test(card.textLines[index]!)
        )
      );
      expect(effects.length, card.cardNo).toBeGreaterThan(0);
      for (const effect of effects) {
        expect(
          effect.steps.some(
            (step) =>
              step.action.kind === "set_exhaust_state" &&
              step.action.state === "recovered"
          ),
          card.cardNo
        ).toBe(true);
        expect(
          effect.steps.some((step) => step.action.kind === "recover"),
          card.cardNo
        ).toBe(false);
      }
    }
  });
});
