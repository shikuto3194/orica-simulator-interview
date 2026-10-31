/**
 * P3-67 Phase 3 e2e: 「効果発揮型」バースト (effect_activated) の発火経路検証。
 *
 * bob が card_event:summon (=「召喚時」) 効果を発揮 → 解決完了直後に
 * maybeQueueEffectActivationBurstCheck が alice の「相手の召喚時発揮後」バーストの
 * pendingBurstCheck を積むことを deferred stack 経路で確認する。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";

// bob: 「召喚時」効果 (count_decrease) を持つスピリット。発揮で effect_activation が起きる。
const activatorCard: CardDefinition = {
  cardNo: "P3-67-ACTIVATOR",
  name: "召喚時持ちスピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "card_event", event: "summon" },
      applicability: { zone: "field" },
      steps: [
        {
          action: { kind: "count_decrease", player: "self", amount: 1 },
        },
      ],
    },
  ],
};

// alice: 「相手の召喚時発揮後」バースト。
const watcherBurstCard: CardDefinition = {
  cardNo: "P3-67-WATCHER",
  name: "効果発揮型バースト",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["blue"],
  textLines: ["【バースト：相手の『このスピリットの召喚時』発揮後】"],
  keywordTags: ["burst"],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: {
        kind: "burst",
        trigger: {
          kind: "effect_activated",
          player: "opponent",
          activatedTimings: ["summon"],
        },
      },
      steps: [
        {
          action: { kind: "draw", player: "self", count: 1 },
        },
      ],
    },
  ],
};

const TEST_CARDS = [activatorCard, watcherBurstCard];
const cardNoMap = new Map(TEST_CARDS.map((c) => [c.cardNo, c]));
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(TEST_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(TEST_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(TEST_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(TEST_CARDS),
};

function buildScenario(): GameState {
  const activator = createCardInstance(activatorCard, {
    instanceId: "activator-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  const watcherBurst = createCardInstance(watcherBurstCard, {
    instanceId: "watcher-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "burst",
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [{}, { countValue: 5 }],
  });
  return {
    ...base,
    activePlayerId: "bob",
    step: "main",
    cardInstances: [activator, watcherBurst],
    setBurstStates: [{ playerId: "alice", cardInstanceId: "watcher-1" }],
    pendingTriggeredEffects: [
      {
        pendingId: "activation-pending-1",
        eventKind: "summon",
        actingPlayerId: "bob",
        source: "action_resolution",
        chainId: "test:burst-effect-activation-e2e:117",
        attackId: null,
        relatedPlayerId: "bob",
        relatedInstanceId: "activator-1",
        amount: null,
        step: "main",
        window: "default",
        resolvedSourceInstanceIds: [],
      },
    ],
  };
}

function findDeclaration(
  state: GameState
): Extract<LegalAction, { kind: "resolve_pending_triggered_effect" }> {
  const actions = getLegalActions({
    state,
    actingPlayerId: "bob",
    getCardDefinitionById,
    ...effectLookups,
  });
  const action = actions.find(
    (
      a
    ): a is Extract<
      LegalAction,
      { kind: "resolve_pending_triggered_effect" }
    > =>
      a.kind === "resolve_pending_triggered_effect" &&
      a.sourceInstanceId === "activator-1"
  );
  if (!action) throw new Error("expected resolve_pending_triggered_effect");
  return action;
}

function passUntilStackClosed(state: GameState): GameState {
  let cur = state;
  for (let i = 0; i < 12 && cur.stackWindow !== null; i++) {
    const priority = cur.stackWindow.priorityPlayerId;
    const actions = getLegalActions({
      state: cur,
      actingPlayerId: priority,
      getCardDefinitionById,
      ...effectLookups,
    });
    const pass = actions.find((a) => a.kind === "pass_stack");
    if (!pass) break;
    cur = applyLegalAction({
      state: cur,
      action: pass,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
  }
  return cur;
}

describe("P3-67 Phase 3 e2e: effect_activated burst", () => {
  it("bob の召喚時効果発揮後、alice の effect_activated バーストチェックが積まれる", () => {
    const initial = buildScenario();
    const decl = findDeclaration(initial);

    const declared = applyLegalAction({
      state: initial,
      action: decl,
      getCardDefinitionById,
      ...effectLookups,
    });

    const resolved = passUntilStackClosed(declared.state);

    const activationChecks = resolved.pendingBurstChecks.filter(
      (c) => c.eventKind === "effect_activated"
    );
    expect(activationChecks).toHaveLength(1);
    expect(activationChecks[0]!.actingPlayerId).toBe("alice");
    expect(activationChecks[0]!.relatedPlayerId).toBe("bob");
    expect(activationChecks[0]!.relatedInstanceId).toBe("activator-1");
  });

  it("watcher バーストが無ければ effect_activated チェックは積まれない (prune)", () => {
    const initial = buildScenario();
    // alice のバーストセットを外す → responder 不在 → prune される
    const withoutBurst: GameState = {
      ...initial,
      setBurstStates: [],
    };
    const decl = findDeclaration(withoutBurst);
    const declared = applyLegalAction({
      state: withoutBurst,
      action: decl,
      getCardDefinitionById,
      ...effectLookups,
    });
    const resolved = passUntilStackClosed(declared.state);
    expect(
      resolved.pendingBurstChecks.filter(
        (c) => c.eventKind === "effect_activated"
      )
    ).toHaveLength(0);
  });
});
