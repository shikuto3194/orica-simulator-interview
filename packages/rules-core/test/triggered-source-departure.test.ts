import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  flushPendingLeaves,
  queuePendingLeave,
} from "../src";
import type { CardDefinition, GameState, TriggerEventKind } from "../src";
import { moveCardZone } from "../src/core/core-system";

const cards = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const base = cards.find((card) => card.cardNo === "BSTH11-X04")!;
cards.push(
  ...[
    {
      cardNo: "SOURCE-OBSERVER",
      timing: { kind: "game_event", event: "summon", player: "self" },
    },
    {
      cardNo: "SOURCE-LEAVE",
      timing: { kind: "card_event", event: "destroy" },
    },
    {
      cardNo: "SOURCE-TRASH",
      timing: { kind: "game_event", event: "summon", player: "self" },
      applicability: { zone: "trash" },
    },
  ].map(
    (probe) =>
      ({
        ...base,
        cardNo: probe.cardNo,
        name: probe.cardNo,
        effects: [
          {
            timing: probe.timing,
            applicability: probe.applicability,
            usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
            steps: [
              { action: { kind: "count_increase", player: "self", amount: 1 } },
            ],
          },
        ],
      }) as CardDefinition
  )
);
const lookup = (id: string) => cards.find((card) => card.cardNo === id);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  getRegisteredFieldCardEffectActions: () => [],
};

function declareSummonEffect(
  sourceCardNo = "BSTH11-X04",
  eventKind: TriggerEventKind = "summon",
  fromTrash = false
): GameState {
  let state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(lookup(sourceCardNo)!, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: fromTrash ? "trash" : "field",
        cores: 1,
      }),
      createCardInstance(lookup("BSSA01-X01")!, {
        instanceId: "target",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(lookup("BSTH08-C01")!, {
        instanceId: "response",
        ownerPlayerId: "bob",
        zone: "hand",
      }),
      ...(fromTrash
        ? [
            createCardInstance(base, {
              instanceId: "trigger",
              ownerPlayerId: "alice",
              zone: "field",
              cores: 1,
            }),
          ]
        : []),
    ],
  });
  state.step = "attack";
  state.activePlayerId = "alice";
  if (eventKind === "destroy")
    state = queuePendingLeave({
      state,
      instanceId: "source",
      kind: "destroy",
      cause: "opponent_effect",
      chainId: "destroy-source",
      causePlayerId: "bob",
    });
  state.pendingTriggeredEffects = [
    {
      pendingId: "source-summoned",
      eventKind,
      actingPlayerId: "alice",
      source: "action_resolution",
      chainId: "test:triggered-source-departure:109",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: fromTrash ? "trigger" : "source",
      amount: null,
      step: "main",
      window: "default",
      resolvedSourceInstanceIds: [],
      ...(eventKind === "destroy" ? { preFlushLeaveEvent: true } : {}),
    },
  ];
  const declaration = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...options,
  }).find(
    (action) =>
      action.kind === "resolve_pending_triggered_effect" &&
      action.sourceInstanceId === "source"
  );
  expect(declaration).toBeDefined();
  const declared = applyLegalAction({
    state,
    action: declaration!,
    ...options,
  }).state;
  expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe(
    "triggered_effect"
  );
  return declared;
}

function pass(state: GameState) {
  const action = getLegalActions({
    state,
    actingPlayerId: "bob",
    ...options,
  }).find((candidate) => candidate.kind === "pass_stack");
  expect(action).toBeDefined();
  return applyLegalAction({ state, action: action!, ...options }).state;
}

describe("スタック後の誘発発揮元再確認", () => {
  it("BSTH08-C01で手札へ戻ったBSTH11-X04の召喚時は不発になり、対象を要求しない", () => {
    const declared = declareSummonEffect();
    const bounced = flushPendingLeaves(
      executeEffect({
        chainId: "test:triggered-source-departure:160",
        state: declared,
        effect: lookup("BSTH08-C01")!.effects![3]!,
        sourceInstanceId: "response",
        actingPlayerId: "bob",
        targetInstanceIds: ["source"],
        ...options,
      }),
      lookup
    );
    expect(
      bounced.cardInstances.find((card) => card.instanceId === "source")!.zone
    ).toBe("hand");
    const after = pass(bounced);
    expect(
      after.cardInstances.find((card) => card.instanceId === "target")!
        .exhaustState
    ).toBe("recovered");
    expect(after.pendingEffectTargetSelection).toBeNull();
    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(after.pendingTriggeredEffects).toEqual([]);
    expect(after.stackWindow).toBeNull();
    expect(
      after.log.some((line) =>
        line.includes("effect:fizzled:source-unavailable:")
      )
    ).toBe(true);
  });

  it("場に残る発揮元の召喚時は通常通り対象選択へ進む", () => {
    const after = pass(declareSummonEffect());
    expect(after.pendingEffectTargetSelection).not.toBeNull();
    expect(
      after.log.some((line) =>
        line.includes("effect:fizzled:source-unavailable:")
      )
    ).toBe(false);
  });

  it("第三者観測の誘発も発揮元が離れれば不発、消費済み使用回数は戻さない", () => {
    const declared = declareSummonEffect("SOURCE-OBSERVER");
    expect(declared.effectUsageRecords.length).toBeGreaterThan(0);
    const after = pass(moveCardZone(declared, "source", "hand"));
    expect(after.players[0]!.countValue).toBe(0);
    expect(after.effectUsageRecords).toEqual(declared.effectUsageRecords);
    expect(after.pendingTriggeredEffects).toEqual([]);
  });

  it("自身の離脱前に待機した破壊時効果は、移動後も正規の解決を保つ", () => {
    const declared = declareSummonEffect("SOURCE-LEAVE", "destroy");
    const after = pass(moveCardZone(declared, "source", "trash"));
    expect(after.players[0]!.countValue).toBe(1);
    expect(
      after.log.some((line) =>
        line.includes("effect:fizzled:source-unavailable:")
      )
    ).toBe(false);
  });

  it.each([false, true])(
    "トラッシュ発揮は明示されたゾーンを再確認する（移動=%s）",
    (moved) => {
      const declared = declareSummonEffect("SOURCE-TRASH", "summon", true);
      const after = pass(
        moved ? moveCardZone(declared, "source", "hand") : declared
      );
      expect(after.players[0]!.countValue).toBe(moved ? 0 : 1);
    }
  );
});
