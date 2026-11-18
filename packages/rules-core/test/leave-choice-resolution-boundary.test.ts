import { executeEffect } from "../src/effect/effect-interpreter";
import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { queuePendingLeave } from "../src/state-based-actions";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";
import {
  buildTriggeredEffectLookup,
  buildBurstEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import type { CardDefinition, GameState } from "../src/model";

const hostDef: CardDefinition = {
  cardNo: "TEST-LEAVE-CHOICE-CONTRACT",
  name: "離脱選択テスト契約",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  keywordTags: ["contract"],
  textLines: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const braveDef: CardDefinition = {
  ...hostDef,
  cardNo: "TEST-LEAVE-CHOICE-BRAVE",
  name: "離脱選択テストブレイヴ",
  printedCategory: "brave",
  keywordTags: [],
};

function setup(
  withTrigger = false,
  withBurst = false,
  withDerivedTrigger = false,
  leaveKind: "destroy" | "vanish" | "bounce" = "destroy",
  withGrantedTrigger = false
) {
  const definition: CardDefinition = withTrigger
    ? {
        ...hostDef,
        effects: [
          {
            id: "leave-count",
            timing: { kind: "card_event", event: "leave_field" },
            steps: [
              {
                id: "count",
                action: { kind: "count_increase", player: "self", amount: 1 },
              },
            ],
          },
        ],
      }
    : hostDef;
  const burstDef: CardDefinition = {
    ...hostDef,
    cardNo: "TEST-LEAVE-BURST",
    name: "離脱バースト",
    printedCategory: "magic",
    keywordTags: ["burst"],
    textLines: ["【バースト：相手による自分のスピリット破壊後】"],
    effects: [
      {
        timing: {
          kind: "burst",
          trigger: { kind: "spirit_destroyed", player: "self" },
        },
        steps: [
          {
            id: "burst-count",
            action: { kind: "count_increase", player: "self", amount: 10 },
          },
        ],
      },
    ],
  };
  const observerDef: CardDefinition = {
    ...hostDef,
    cardNo: "TEST-COUNT-OBSERVER",
    keywordTags: [],
    effects: [
      {
        timing: { kind: "game_event", event: "count_increase", player: "self" },
        steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      },
    ],
  };
  const definitions = [definition, braveDef, burstDef, observerDef];
  const getCardDefinitionById = (id: string) =>
    definitions.find((d) => d.cardNo === id);
  const lookups = {
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
    getRegisteredBurstActions: buildBurstEffectLookup(definitions),
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredMagicActions: () => [],
    getRegisteredPlayCardActions: () => [],
  };
  let beforeState = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{ contractCardNo: hostDef.cardNo }, {}],
    cardInstances: [
      createCardInstance(definition, {
        instanceId: "host",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
        attachedChildrenIds: ["brave"],
      }),
      createCardInstance(braveDef, {
        instanceId: "brave",
        ownerPlayerId: "alice",
        zone: "field",
        attachedToInstanceId: "host",
      }),
    ],
  });
  if (withDerivedTrigger)
    beforeState.cardInstances.push(
      createCardInstance(observerDef, {
        instanceId: "observer",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      })
    );
  if (withBurst) {
    beforeState.cardInstances.push(
      createCardInstance(burstDef, {
        instanceId: "burst",
        ownerPlayerId: "alice",
        zone: "burst",
        faceDown: true,
      })
    );
    beforeState.setBurstStates = [
      { playerId: "alice", cardInstanceId: "burst" },
    ];
  }
  if (withGrantedTrigger)
    beforeState = executeEffect({
      chainId: "test:leave-choice-resolution-boundary:147",
      state: beforeState,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      ...lookups,
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "grant_effect",
              target: { kind: "self" },
              grantedEffect: {
                timing: { kind: "card_event", event: "leave_field" },
                steps: [
                  {
                    action: {
                      kind: "count_increase",
                      player: "self",
                      amount: 1,
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    });
  const pending = queuePendingLeave({
    state: beforeState,
    instanceId: "host",
    kind: leaveKind,
    ...(leaveKind === "bounce"
      ? { leaveDestination: { zone: "hand" as const } }
      : {}),
    cause: "effect_resolution",
    causePlayerId: "bob",
    chainId: "destroy-host",
  });
  const state = finalizeEffectResolution({
    state: pending,
    beforeState,
    chainId: "destroy-host",
    endLogs: [],
    actingPlayerId: "bob",
    causedBySourceInstanceId: null,
    ...lookups,
  });
  const choose = (current: GameState, kind: string, choice: string) => {
    const action = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === kind && "choice" in a && a.choice === choice);
    expect(action, `${kind}:${choice}`).toBeDefined();
    return applyLegalAction({ state: current, action: action!, ...lookups })
      .state;
  };
  const act = (
    current: GameState,
    kind: string,
    skipOptionalEffect = false
  ) => {
    const actions = ["alice", "bob"].flatMap((actingPlayerId) =>
      getLegalActions({ state: current, actingPlayerId, ...lookups })
    );
    const action = actions.find(
      (a) => a.kind === kind && !("skipOnly" in a && a.skipOnly)
    );
    expect(action, JSON.stringify(actions)).toBeDefined();
    return applyLegalAction({
      state: current,
      action: action!,
      skipOptionalEffect,
      ...lookups,
    }).state;
  };
  return { state, choose, act, ...lookups };
}

describe("離脱選択は待機中の効果解決後に行う (公式Q1501)", () => {
  it.each([false, true])(
    "付与された離脱時効果も実移動前に解決する: 派生=%s",
    (derived) => {
      const { state, act } = setup(false, false, derived, "destroy", true);
      expect(state.pendingBraveLeaveChoice).toBeNull();
      let current = act(
        act(state, "resolve_pending_triggered_effect"),
        "pass_stack"
      );
      expect(current.players[0]?.countValue).toBe(1);
      if (derived) {
        expect(current.pendingBraveLeaveChoice).toBeNull();
        current = act(
          act(current, "resolve_pending_triggered_effect"),
          "pass_stack"
        );
      }
      expect(current.pendingBraveLeaveChoice).not.toBeNull();
    }
  );

  it("通常の破壊時効果が未解決なら魂状態/ブレイヴの選択をまだ提示しない", () => {
    const { state } = setup(true);
    expect(state.pendingTriggeredEffects.length).toBeGreaterThan(0);
    expect(state.pendingSoulStateReplacement).toBeNull();
    expect(state.pendingBraveLeaveChoice).toBeNull();
  });

  it.each(["destroy", "vanish", "bounce"] as const)(
    "%s の誘発を解決した後、同行ブレイヴも移動先へ確定する",
    (kind) => {
      const { state, act, choose } = setup(true, false, false, kind);
      expect(state.pendingBraveLeaveChoice).toBeNull();
      let current = act(
        act(state, "resolve_pending_triggered_effect"),
        "pass_stack"
      );
      current = choose(current, "resolve_brave_leave_choice", "send_with_host");
      current = choose(current, "resolve_soul_state_replacement", "decline");
      expect(
        current.cardInstances.every(
          (card) => card.zone === (kind === "bounce" ? "hand" : "trash")
        )
      ).toBe(true);
      expect(current.pendingLeaveEntities).toEqual([]);
    }
  );

  it("破壊時効果を宣言・解決してから選択を提示する", () => {
    const { state, act } = setup(true);
    const declared = act(state, "resolve_pending_triggered_effect");
    expect(declared.pendingSoulStateReplacement).toBeNull();
    expect(declared.pendingBraveLeaveChoice).toBeNull();
    const resolved = act(declared, "pass_stack");
    expect(resolved.players[0]?.countValue).toBe(1);
    expect(resolved.pendingSoulStateReplacement).not.toBeNull();
    expect(resolved.pendingBraveLeaveChoice).not.toBeNull();
  });

  it.each([false, true])(
    "バースト発動宣言は選択より前、他の誘発=%s",
    (withTrigger) => {
      const { state, act } = setup(withTrigger, true);
      expect(state.pendingBurstChecks).toHaveLength(1);
      expect(state.pendingSoulStateReplacement).toBeNull();
      expect(state.pendingBraveLeaveChoice).toBeNull();
      const declared = act(state, "resolve_pending_burst_check");
      expect(declared.players[0]?.countValue).toBe(0);
    }
  );

  it.each(["keep", "decline"])(
    "バースト宣言後も実移動選択を完了するまで本体を解決しない: %s",
    (soulChoice) => {
      const { state, act, choose } = setup(false, true);
      let current = act(state, "resolve_pending_burst_check");
      current = act(current, "pass_stack");
      expect(current.pendingBraveLeaveChoice).not.toBeNull();
      expect(current.pendingSoulStateReplacement).not.toBeNull();
      expect(current.players[0]?.countValue).toBe(0);
      current = choose(current, "resolve_brave_leave_choice", "send_with_host");
      current = choose(current, "resolve_soul_state_replacement", soulChoice);
      expect(current.pendingLeaveEntities).toEqual([]);
      expect(
        current.cardInstances.find((c) => c.instanceId === "brave")?.zone
      ).toBe("trash");
      expect(
        current.pendingBurstChecks.filter((c) => c.activationSelected !== true)
      ).toEqual([]);
      if (soulChoice === "decline") {
        current = act(current, "pass_stack");
        expect(current.players[0]?.countValue).toBe(10);
      } else {
        expect(current.players[0]?.countValue).toBe(0);
        expect(current.setBurstStates).toContainEqual({
          playerId: "alice",
          cardInstanceId: "burst",
        });
        expect(current.pendingStackCascade).toBeNull();
      }
    }
  );

  it("破壊時効果から派生したカウント増加時効果も選択前に解決する", () => {
    const { state, act } = setup(true, false, true);
    let current = act(
      act(state, "resolve_pending_triggered_effect"),
      "pass_stack"
    );
    expect(
      current.pendingTriggeredEffects.some(
        (e) => e.eventKind === "count_increase"
      )
    ).toBe(true);
    expect(current.pendingBraveLeaveChoice).toBeNull();
    expect(current.pendingSoulStateReplacement).toBeNull();
    current = act(
      act(current, "resolve_pending_triggered_effect"),
      "pass_stack"
    );
    expect(current.pendingBraveLeaveChoice).not.toBeNull();
  });

  it("辞退済みのバースト発動宣言を実移動時に再提示しない", () => {
    const { state, act, choose } = setup(false, true);
    let current = act(state, "decline_pending_burst_check");
    current = choose(current, "resolve_brave_leave_choice", "send_with_host");
    current = choose(current, "resolve_soul_state_replacement", "decline");
    expect(current.pendingBurstChecks).toEqual([]);
  });

  it("バーストを宣言しない選択の直後に離脱選択が開く", () => {
    const { state, act } = setup(false, true);
    const current = act(state, "decline_pending_burst_check");
    expect(current.pendingBraveLeaveChoice).not.toBeNull();
    expect(current.pendingSoulStateReplacement).not.toBeNull();
  });

  it("同行を選び魂状態を辞退したら、他の誘発がない同じ操作内で両方がトラッシュへ移る", () => {
    const { state, choose } = setup();
    const sent = choose(state, "resolve_brave_leave_choice", "send_with_host");
    const left = choose(sent, "resolve_soul_state_replacement", "decline");
    expect(left.pendingTriggeredEffects).toEqual([]);
    expect(left.cardInstances.filter((c) => c.zone === "field")).toEqual([]);
    expect(left.pendingLeaveEntities).toEqual([]);
  });

  it("同行を選び魂状態にしたらブレイヴだけがトラッシュへ移る", () => {
    const { state, choose } = setup();
    const sent = choose(state, "resolve_brave_leave_choice", "send_with_host");
    const left = choose(sent, "resolve_soul_state_replacement", "keep");
    expect(left.cardInstances.find((c) => c.instanceId === "brave")?.zone).toBe(
      "trash"
    );
    expect(left.players[0]?.soulStateInstanceIds).toContain("host");
    expect(left.pendingLeaveEntities).toEqual([]);
  });
});
