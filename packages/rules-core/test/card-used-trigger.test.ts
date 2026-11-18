import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src";
import {
  applyLegalAction,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type FlashCardUsageLogEntry,
  type GameState,
} from "../src";
import {
  finalizeCardUsageAndQueueTriggers,
  queuePendingReactionsFromTriggerEvents,
} from "../src/effect/trigger-system";

const lucy = ALL_CARDS.find((card) => card.cardNo === "BSFT01-CX01")!;
const key = ALL_CARDS.find((card) => card.cardNo === "BSFT01-TR01(A)")!;
const other: CardDefinition = {
  ...key,
  cardNo: "audit-used-non-key",
  tribe: "検証",
  textLines: [],
  effects: [],
};
const cards = [...ALL_CARDS, other];
const lookup = (id: string) => cards.find((card) => card.cardNo === id);
const options = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  getRegisteredBurstActions: () => undefined,
};
function fixture(
  mode: FlashCardUsageLogEntry["mode"] = "flash",
  playerId = "alice",
  definition = key
): GameState {
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(lucy, {
        instanceId: "lucy",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 0,
      }),
      createCardInstance(definition, {
        instanceId: "used",
        ownerPlayerId: playerId,
        zone: "trash",
      }),
    ],
  });
  state.players[0]!.soulStateInstanceIds = ["lucy"];
  state.step = "attack";
  state.flashCardUsageLog = [
    {
      chainId: "test:card-used-trigger:59",
      playerId,
      cardInstanceId: "used",
      cardDefinitionId: definition.cardNo,
      turnNumber: state.turnNumber,
      step: "attack",
      attackId: null,
      mode,
      completion: "resolving",
    },
  ];
  return state;
}
function lucyPending(state: GameState) {
  return state.pendingTriggeredEffects.filter(
    (p) => p.eventKind === "card_used"
  );
}
describe("カード使用後の誘発", () => {
  it.each(["main", "flash", "stack", "play"] as const)(
    "%s 使用は完了後に1回だけ誘発する",
    (mode) => {
      const after = finalizeCardUsageAndQueueTriggers(fixture(mode), options);
      expect(after.flashCardUsageLog[0]?.completion).toBe("completed");
      expect(lucyPending(after)).toHaveLength(1);
      const consumed = { ...after, pendingTriggeredEffects: [] };
      expect(
        lucyPending(finalizeCardUsageAndQueueTriggers(consumed, options))
      ).toHaveLength(0);
    }
  );
  it("宣言中、直接の効果発揮、相手使用、鍵以外では誘発しない", () => {
    const declared = fixture();
    declared.flashCardUsageLog[0]!.completion = "declared";
    expect(
      lucyPending(finalizeCardUsageAndQueueTriggers(declared, options))
    ).toHaveLength(0);
    const direct = fixture();
    direct.flashCardUsageLog = [];
    expect(
      lucyPending(finalizeCardUsageAndQueueTriggers(direct, options))
    ).toHaveLength(0);
    expect(
      lucyPending(
        finalizeCardUsageAndQueueTriggers(fixture("flash", "bob"), options)
      )
    ).toHaveLength(0);
    expect(
      lucyPending(
        finalizeCardUsageAndQueueTriggers(
          fixture("flash", "alice", other),
          options
        )
      )
    ).toHaveLength(0);
  });
  it("任意選択や派生誘発が残る間は通知せず、最後の解決後に誘発する", () => {
    const pending = finalizeCardUsageAndQueueTriggers(fixture(), options)
      .pendingTriggeredEffects[0]!;
    const before = fixture();
    before.pendingTriggeredEffects = [{ ...pending, eventKind: "summon" }];
    expect(finalizeCardUsageAndQueueTriggers(before, options)).toBe(before);
    before.pendingTriggeredEffects = [];
    expect(
      lucyPending(finalizeCardUsageAndQueueTriggers(before, options))
    ).toHaveLength(1);
  });
  it("使用後に転醒しても使用したA面の系統で判定する", () => {
    const state = fixture();
    state.cardInstances = state.cardInstances.map((card) =>
      card.instanceId === "used"
        ? { ...card, definitionId: other.cardNo }
        : card
    );
    expect(
      lucyPending(finalizeCardUsageAndQueueTriggers(state, options))
    ).toHaveLength(1);
  });
  it("効果召喚した2枚も使用に含め、同時使用はソースごとに1回だけ誘発する", () => {
    const state = fixture();
    state.flashCardUsageLog = [];
    state.cardInstances.push(
      createCardInstance(key, {
        instanceId: "used-2",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const events = ["used", "used-2"].map((relatedInstanceId) => ({
      eventKind: "summon" as const,
      source: "action_resolution" as const,
      actingPlayerId: "alice",
      relatedPlayerId: "alice",
      relatedInstanceId,
      chainId: "effect-summon-two",
      attackId: null,
      amount: null,
    }));
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      events,
      undefined,
      options
    );
    const repeated = queuePendingReactionsFromTriggerEvents(
      queued,
      events,
      undefined,
      options
    );
    expect(repeated.flashCardUsageLog).toHaveLength(2);
    const after = finalizeCardUsageAndQueueTriggers(
      {
        ...repeated,
        pendingTriggeredEffects: [],
        pendingPrivateDeclarations: [],
      },
      options
    );
    expect(lucyPending(after)).toHaveLength(1);
  });
  it("通常配置の宣言履歴と場入り観測は同じ1回の使用になる", () => {
    const state = fixture("play");
    state.flashCardUsageLog[0]!.completion = "declared";
    const after = queuePendingReactionsFromTriggerEvents(
      state,
      [
        {
          eventKind: "place",
          source: "action_resolution",
          actingPlayerId: "alice",
          relatedPlayerId: "alice",
          relatedInstanceId: "used",
          chainId: "normal-place",
          attackId: null,
          amount: null,
        },
      ],
      undefined,
      options
    );
    expect(after.flashCardUsageLog).toHaveLength(1);
    expect(after.flashCardUsageLog[0]?.completion).toBe("resolving");
  });
  it("応答の鍵使用後は、外側のマジックを発揮する前にルーシィが誘発する", () => {
    const magic = (
      id: string,
      mode: "main" | "stack",
      tribe: string
    ): CardDefinition => ({
      ...other,
      cardNo: id,
      name: id,
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      keywordTags: [],
      tribe,
      textLines: [
        mode === "main" ? "メイン" : "スタック",
        "自分のカウント+1する。",
      ],
      effects: [
        {
          timing: { kind: "activated", mode },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
          textRef: [0, 1],
        },
      ],
    });
    const outer = magic("audit-outer", "main", "検証");
    const response = magic("audit-key-response", "stack", "鍵");
    const definitions = [...cards, outer, response];
    const lookups = {
      ...options,
      getRegisteredFieldCardEffectActions: () => [],
      getCardDefinitionById: (id: string) =>
        definitions.find((card) => card.cardNo === id),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredMagicActions: buildMagicLookup(definitions),
    };
    let state = fixture();
    state.flashCardUsageLog = [];
    state.activePlayerId = "bob";
    state.step = "main";
    state.cardInstances = state.cardInstances.filter(
      (card) => card.instanceId !== "used"
    );
    state.cardInstances.push(
      createCardInstance(outer, {
        instanceId: "outer",
        ownerPlayerId: "bob",
        zone: "hand",
      }),
      createCardInstance(response, {
        instanceId: "response",
        ownerPlayerId: "alice",
        zone: "hand",
      })
    );
    const act = (player: string, kind: string, source?: string) => {
      const action = getLegalActions({
        state,
        actingPlayerId: player,
        ...lookups,
      }).find(
        (action) =>
          action.kind === kind &&
          (!source ||
            ("sourceInstanceId" in action &&
              action.sourceInstanceId === source))
      );
      expect(action).toBeDefined();
      state = applyLegalAction({
        state,
        action: action!,
        actingPlayerId: player,
        ...lookups,
      }).state;
    };
    act("bob", "use_magic", "outer");
    act("alice", "use_magic", "response");
    act("bob", "pass_stack");
    expect(
      state.players.find((player) => player.id === "alice")?.countValue
    ).toBe(1);
    expect(
      state.players.find((player) => player.id === "bob")?.countValue
    ).toBe(0);
    expect(
      state.cardInstances.find((card) => card.instanceId === "outer")?.zone
    ).toBe("in_use");
    expect(lucyPending(state)).toHaveLength(1);
    expect(state.pendingStackCascade?.remainingStacks).toHaveLength(1);
  });
});
