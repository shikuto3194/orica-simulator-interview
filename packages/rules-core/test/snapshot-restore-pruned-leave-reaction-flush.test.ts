/**
 * P3-164: 復元時に孤児として取り下げた離脱前反応が止めていた離脱を、その場で確定する。
 *
 * 離脱前反応 (公開 pendingTriggeredEffects / private pendingPrivateDeclarations) が積まれている間は、
 * 離脱が実移動しない。カード定義の変更や手札の変化で発揮元が解決できなくなった反応を
 * `restoreSnapshot` が取り下げても、離脱が破壊待ち (pendingLeaveKind) のまま場に残らないこと。
 *
 * 対象: private は BSLH01-X07 (手札から、自分のスピリットが相手の効果で離れるとき反応する。手札専用)。
 * 公開は合成の聴取スピリット (場から「自分のスピリットが破壊されたとき」に反応する任意効果)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { collectAndQueueTriggerReactions } from "../src/effect/trigger-system";
import { queuePendingLeave } from "../src/state-based-actions";
import {
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/runtime";
import { createGameSnapshot, restoreSnapshot } from "../src/snapshot";
import type { CardDefinition, GameState } from "../src/model";

const A = "player-1";
const B = "player-2";

const baseSpirit = {
  printedCategory: "spirit",
  colors: ["yellow"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["yellow"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
} as const;

/** 離脱する自分の CB 系統スピリット。 */
const cbSpirit = {
  ...baseSpirit,
  cardNo: "TEST-P3164-CB",
  name: "テストCBスピリット",
  tribe: "CB",
} as CardDefinition;

/** 場から「自分のスピリットが破壊されたとき」に反応する任意効果を持つ聴取スピリット。 */
const listener = {
  ...baseSpirit,
  cardNo: "TEST-P3164-LISTENER",
  name: "テスト聴取スピリット",
  effects: [
    {
      timing: { kind: "game_event", player: "self", event: "destroy" },
      executionMode: "optional",
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    },
  ],
} as unknown as CardDefinition;

/** 反応を持たず、無関係な離脱の対象にだけ使う相手のスピリット。 */
const plainSpirit = {
  ...baseSpirit,
  cardNo: "TEST-P3164-PLAIN",
  name: "テスト無関係スピリット",
} as CardDefinition;

const allCards = [...ALL_CARDS, cbSpirit, listener, plainSpirit];
const definitions = new Map<string, CardDefinition>(
  allCards.map((card) => [card.cardNo, card])
);
const getDef = (id: string) => definitions.get(id);
const getRegisteredTriggeredEffectActions =
  buildTriggeredEffectLookup(allCards);
const getRegisteredBurstActions = buildBurstEffectLookup(allCards);

type CardPlacement = {
  instanceId: string;
  cardNo: string;
  ownerPlayerId: string;
  zone: "field" | "hand" | "trash";
};

function makeState(placements: CardPlacement[]): GameState {
  const cardInstances = placements.map((placement) =>
    createCardInstance(definitions.get(placement.cardNo)!, {
      instanceId: placement.instanceId,
      ownerPlayerId: placement.ownerPlayerId,
      controllerPlayerId: placement.ownerPlayerId,
      zone: placement.zone,
      normalCoreCount: placement.zone === "field" ? 1 : 0,
    } as never)
  );
  return {
    ...createEmptyGameState({ cardInstances }),
    activePlayerId: B,
    step: "main" as never,
    turnNumber: 3,
  };
}

/** 相手の効果で `leaverIds` が破壊待ちに入り、離脱前反応が積まれた状態を作る。 */
function withQueuedLeaves(before: GameState, leaverIds: string[]): GameState {
  let waiting = before;
  for (const instanceId of leaverIds) {
    waiting = queuePendingLeave({
      state: waiting,
      instanceId,
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: B,
      chainId: "p3164-chain",
    });
  }
  return collectAndQueueTriggerReactions({
    chainId: "p3164-chain",
    beforeState: before,
    afterState: waiting,
    source: "action_resolution",
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
  });
}

function restore(state: GameState) {
  return restoreSnapshot(createGameSnapshot(state), getDef, {
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
  });
}

/** 発揮元が手札/場から外れた、保存後にカード状況が変わった状態を模擬する。 */
function moveToTrash(state: GameState, instanceId: string): GameState {
  return {
    ...state,
    cardInstances: state.cardInstances.map((card) =>
      card.instanceId === instanceId
        ? { ...card, zone: "trash" as never }
        : card
    ),
  };
}

const card = (state: GameState, instanceId: string) =>
  state.cardInstances.find((c) => c.instanceId === instanceId)!;

describe("復元で取り下げた離脱前反応が止めていた離脱を確定する", () => {
  it("private 宣言が発揮元を失って取り下げられると、破壊待ちのスピリットは場から離れる", () => {
    const queued = withQueuedLeaves(
      makeState([
        {
          instanceId: "cb-1",
          cardNo: cbSpirit.cardNo,
          ownerPlayerId: A,
          zone: "field",
        },
        {
          instanceId: "x07",
          cardNo: "BSLH01-X07",
          ownerPlayerId: A,
          zone: "hand",
        },
      ]),
      ["cb-1"]
    );
    // 前提: private 宣言が離脱を止めている。
    expect(queued.pendingPrivateDeclarations).toHaveLength(1);
    expect(queued.pendingLeaveEntities.map((p) => p.instanceId)).toEqual([
      "cb-1",
    ]);

    const { state, warnings } = restore(moveToTrash(queued, "x07"));

    expect(warnings.join("\n")).toContain("orphan pendingPrivateDeclarations");
    expect(state.pendingPrivateDeclarations).toEqual([]);
    expect(card(state, "cb-1").pendingLeaveKind).toBeNull();
    expect(card(state, "cb-1").zone).not.toBe("field");
    expect(state.pendingLeaveEntities).toEqual([]);
  });

  it("対照: private 宣言が有効なまま復元しても、離脱は宣言の判断を待って保留される", () => {
    const queued = withQueuedLeaves(
      makeState([
        {
          instanceId: "cb-1",
          cardNo: cbSpirit.cardNo,
          ownerPlayerId: A,
          zone: "field",
        },
        {
          instanceId: "x07",
          cardNo: "BSLH01-X07",
          ownerPlayerId: A,
          zone: "hand",
        },
      ]),
      ["cb-1"]
    );

    const { state, warnings } = restore(queued);

    expect(warnings.join("\n")).not.toContain("orphan");
    expect(state.pendingPrivateDeclarations).toHaveLength(1);
    expect(card(state, "cb-1").zone).toBe("field");
    expect(card(state, "cb-1").pendingLeaveKind).toBe("destroy");
    expect(state.pendingLeaveEntities.map((p) => p.instanceId)).toEqual([
      "cb-1",
    ]);
  });

  it("公開の離脱前反応が発揮元を失って取り下げられても、破壊待ちのスピリットは場から離れる", () => {
    const queued = withQueuedLeaves(
      makeState([
        {
          instanceId: "cb-1",
          cardNo: cbSpirit.cardNo,
          ownerPlayerId: A,
          zone: "field",
        },
        {
          instanceId: "listener-1",
          cardNo: listener.cardNo,
          ownerPlayerId: A,
          zone: "field",
        },
      ]),
      ["cb-1"]
    );
    expect(queued.pendingTriggeredEffects.map((p) => p.eventKind)).toContain(
      "destroy"
    );
    expect(queued.pendingLeaveEntities.map((p) => p.instanceId)).toEqual([
      "cb-1",
    ]);

    const { state, warnings } = restore(moveToTrash(queued, "listener-1"));

    expect(warnings.join("\n")).toContain("orphan pendingTriggeredEffects");
    expect(state.pendingTriggeredEffects).toEqual([]);
    expect(card(state, "cb-1").pendingLeaveKind).toBeNull();
    expect(card(state, "cb-1").zone).not.toBe("field");
    expect(state.pendingLeaveEntities).toEqual([]);
  });

  // 復元が確定するのは「取り下げた反応が止めていた離脱」だけ。plain-1 は反応を持たない別の待機で、
  // 復元の対象外 (一般の待機の確定は復元の責務ではない) なので、触らないことをここで固定する。
  it("取り下げた反応と無関係な離脱は触らず、待機のまま残す", () => {
    const queued = withQueuedLeaves(
      makeState([
        {
          instanceId: "cb-1",
          cardNo: cbSpirit.cardNo,
          ownerPlayerId: A,
          zone: "field",
        },
        {
          instanceId: "x07",
          cardNo: "BSLH01-X07",
          ownerPlayerId: A,
          zone: "hand",
        },
        {
          instanceId: "plain-1",
          cardNo: plainSpirit.cardNo,
          ownerPlayerId: B,
          zone: "field",
        },
      ]),
      ["cb-1", "plain-1"]
    );
    expect(queued.pendingLeaveEntities.map((p) => p.instanceId).sort()).toEqual(
      ["cb-1", "plain-1"]
    );

    const { state } = restore(moveToTrash(queued, "x07"));

    expect(card(state, "cb-1").pendingLeaveKind).toBeNull();
    expect(card(state, "plain-1").zone).toBe("field");
    expect(card(state, "plain-1").pendingLeaveKind).toBe("destroy");
    expect(state.pendingLeaveEntities.map((p) => p.instanceId)).toEqual([
      "plain-1",
    ]);
  });
});
