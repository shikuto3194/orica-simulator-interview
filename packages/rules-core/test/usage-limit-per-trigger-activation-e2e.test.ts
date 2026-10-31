/** 汎用 per_trigger_activation が dispatch 経路で chainId を記録することを検証する。 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type {
  CardDefinition,
  GameState,
  PendingTriggeredEffect,
} from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

const CX01: CardDefinition = {
  ...cardNoMap.get("BSDB01-CX01")!,
  cardNo: "TEST-ACTIVATION-LISTENER",
  name: "発揮単位制限の検証カード",
  effects: [
    {
      applicability: { zone: "advent_source" },
      timing: {
        kind: "game_event",
        player: "opponent",
        event: "destroy",
        cause: "opponent_effect",
      },
      condition: [{ kind: "self_state", state: "in_advent_source" }],
      usageLimit: { kind: "per_trigger_activation", duration: "turn" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
};
const HOST_DEF = cardNoMap.get("BSDB01-C01")!;

const ALICE = "alice";
const BOB = "bob";
const CX01_INSTANCE = "cx01-e2e";

function makeDestroyPending(opts: {
  pendingId: string;
  chainId: string | null;
  relatedInstanceId: string;
  selected?: boolean;
}): PendingTriggeredEffect {
  return {
    pendingId: opts.pendingId,
    actingPlayerId: ALICE,
    eventKind: "destroy",
    source: "action_resolution",
    chainId: opts.chainId,
    attackId: null,
    relatedPlayerId: BOB,
    relatedInstanceId: opts.relatedInstanceId,
    amount: null,
    step: "attack",
    window: "main",
    resolvedSourceInstanceIds: [],
    cause: "opponent_effect",
    event: {
      family: "leave_field",
      causeKind: "destroy",
      cause: "opponent_effect",
      validationMode: "snapshot_only",
    },
    ...(opts.selected ? { selectedByTurnPlayer: true } : {}),
  } as PendingTriggeredEffect;
}

function setup(): {
  state: GameState;
  lookup: ReturnType<typeof buildTriggeredEffectLookup>;
  getDef: (id: string) => CardDefinition | undefined;
} {
  const cx01 = createCardInstance(CX01, {
    instanceId: CX01_INSTANCE,
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  const host = {
    ...createCardInstance(HOST_DEF, {
      instanceId: "host-spirit",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    }),
    underCards: [
      { cardInstanceId: CX01_INSTANCE, role: "advent_source" as const },
    ],
  };
  const baseState = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [host, cx01],
    playerOverrides: [{ countValue: 0 }, {}],
  });
  const state: GameState = {
    ...baseState,
    activePlayerId: ALICE,
    step: "attack",
  };
  const defs = new Map<string, CardDefinition>([
    [CX01.cardNo, CX01],
    [HOST_DEF.cardNo, HOST_DEF],
  ]);
  return {
    state,
    lookup: buildTriggeredEffectLookup([CX01, HOST_DEF]),
    getDef: (id) => defs.get(id),
  };
}

describe("per_trigger_activation dispatch e2e", () => {
  it("apply 経路で pendingEffect.chainId が triggerActivationKey として effectUsageRecord に保存される (dispatch threading 退行検知用)", () => {
    const ctx = setup();
    const stateWithPending: GameState = {
      ...ctx.state,
      pendingTriggeredEffects: [
        makeDestroyPending({
          pendingId: "pte-e2e-X",
          chainId: "chain-e2e-X",
          relatedInstanceId: "victim-stub",
          selected: true,
        }),
      ],
    };
    const lookupOpts = {
      getCardDefinitionById: ctx.getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
      getHandWrittenEffectResolver: () => undefined,
    };
    const actions = getLegalActions({
      state: stateWithPending,
      actingPlayerId: ALICE,
      ...lookupOpts,
    });
    const resolveAction = actions.find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" && a.skipOnly !== true
    );
    expect(resolveAction).toBeDefined();
    const after = applyLegalAction({
      state: stateWithPending,
      action: resolveAction!,
      ...lookupOpts,
    }).state;
    const records = after.effectUsageRecords.filter(
      (r) => r.sourceInstanceId === CX01_INSTANCE
    );
    expect(records.length).toBeGreaterThanOrEqual(1);
    // dispatch site (legal-actions-apply.ts) が pendingEffect.chainId を thread した証跡。
    // 将来 ...(pendingEffect.chainId ? { triggerActivationKey: pendingEffect.chainId } : {})
    // を refactor で外すと本 assertion が即 fail する。
    expect(records[0]!.triggerActivationKey).toBe("chain-e2e-X");
  });
});
