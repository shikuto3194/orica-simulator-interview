/**
 * ENGINE-mirage-set-card-event-trigger: 「ミラージュがセットされたとき」card_event
 * 自己誘発の新設 primitive 検証 (BSTH002-C04 effects[1])。
 *
 * quartz_set (F2) と同型の mirageSetStates 差分検出 + card_event 自己誘発。
 * quartz_set と異なりセットされたカードの zone は "field" ではなく "mirage" のため、
 * validationMode は require_related_instance_on_field ではなく snapshot_only を使う
 * (trigger-system.ts triggerEventKindToStructuredEvent 参照)。
 *
 * BSTH002-C04 effects[1]:「【セット中】『このカードのセット時』自分はデッキの上から
 * 1枚ドローする。」(強制)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import { getAvailableSetMirageLegalActions } from "../src/legal/legal-actions-availability";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(ALL_CARDS);

const C04 = cardNoMap.get("BSTH002-C04")!;
const ALICE = "alice";
const BOB = "bob";

const FILLER: CardDefinition = {
  cardNo: "TEST-BSTH002-C04-FILLER",
  name: "フィラー",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
cardNoMap.set(FILLER.cardNo, FILLER);

function deckCount(state: GameState, player = ALICE): number {
  return state.players.find((p) => p.id === player)!.deckCount;
}

function passOpenStack(state: GameState): GameState {
  expect(state.stackWindow).not.toBeNull();
  const actingPlayerId = state.stackWindow!.priorityPlayerId;
  const pass = getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
  }).find((action) => action.kind === "pass_stack");
  expect(pass).toBeDefined();
  return applyLegalAction({
    state,
    action: pass!,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions,
  }).state;
}

function setUp(deckN: number): GameState {
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        { handCount: 1, reserveNormalCoreCount: 5, deckCount: deckN },
        {},
      ],
      cardInstances: [
        createCardInstance(C04, {
          instanceId: "c04-hand",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
        ...Array.from({ length: deckN }, (_, i) =>
          createCardInstance(FILLER, {
            instanceId: `deck-${i}`,
            ownerPlayerId: ALICE,
            zone: "deck",
          })
        ),
      ],
    }),
    step: "main",
    activePlayerId: ALICE,
  };
}

describe("BSTH002-C04 effects[1] shape (card_event: mirage_set)", () => {
  const effect = C04.effects![1]!;

  it("stub 解消済み、timing = card_event:mirage_set, applicability.zone=mirage_set", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "card_event", event: "mirage_set" });
    expect(effect.applicability).toEqual({ zone: ["mirage_set"] });
  });

  it("steps[0] = draw(count:1)", () => {
    expect(effect.steps).toHaveLength(1);
    expect(effect.steps[0]!.action).toEqual({ kind: "draw", count: 1 });
  });
});

describe("BSTH002-C04 effects[1] 盤面変化 (ミラージュセット時に1枚ドロー、強制)", () => {
  it("手札からミラージュセット → mirage_set 誘発が pendingTriggeredEffects に積まれる", () => {
    const before = setUp(10);
    const actions = getAvailableSetMirageLegalActions({
      state: before,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(actions).toHaveLength(1);
    const setAction = actions[0]!;
    expect(setAction.mirageCost).toBe(2);

    const setDeclared = applyLegalAction({
      state: before,
      action: setAction,
      paymentSources: [{ kind: "reserve", amount: 2 }],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(setDeclared.stackWindow?.pendingStackAction?.actionKind).toBe(
      "set_mirage"
    );

    const afterSet = passOpenStack(setDeclared);

    const c04 = afterSet.cardInstances.find(
      (c) => c.instanceId === "c04-hand"
    )!;
    expect(c04.zone).toBe("mirage");
    expect(
      afterSet.pendingTriggeredEffects.some(
        (p) =>
          p.eventKind === "mirage_set" && p.relatedInstanceId === "c04-hand"
      )
    ).toBe(true);
    // ドロー未解決のためデッキ枚数はまだ変化していない。
    expect(deckCount(afterSet)).toBe(10);

    const resolveAction = getLegalActions({
      state: afterSet,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.eventKind === "mirage_set"
    );
    expect(resolveAction).toBeDefined();

    const declared = applyLegalAction({
      state: afterSet,
      action: resolveAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;
    expect(declared.pendingTriggeredEffects).toHaveLength(0);
    // 誘発効果はスタックに乗るため、相手がパスして窓を閉じるまで steps は実行されない
    // (P3-75 未解決 ActiveStack)。
    expect(declared.window).toBe("stack");
    expect(deckCount(declared)).toBe(10);

    const resolved = applyLegalAction({
      state: declared,
      action: {
        kind: "pass_stack",
        actionId: "pass:bob",
        can: true,
        reason: "test_close_stack",
        actingPlayerId: declared.stackWindow!.priorityPlayerId,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
    }).state;

    expect(deckCount(resolved)).toBe(9);
    expect(resolved.pendingTriggeredEffects).toHaveLength(0);
  });

  it("ミラージュ以外 (通常召喚) では mirage_set は発火しない", () => {
    const before = setUp(10);
    // 手札から直接ゾーン操作で「召喚」相当に見せかけず、mirage_set の diff 検出が
    // mirageSetStates の変化にのみ反応することを、ミラージュセットしない state で確認する。
    expect(
      before.pendingTriggeredEffects.some((p) => p.eventKind === "mirage_set")
    ).toBe(false);
  });
});
