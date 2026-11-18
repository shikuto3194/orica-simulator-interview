import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  flushPendingLeaves,
  getLegalActions,
  queuePendingLeave,
  executeAdvent,
  type GameState,
  type PendingLeaveKind,
  type Zone,
  buildTriggeredEffectLookup,
  buildBurstEffectLookup,
  collectGameStateInvariantIssues,
  attachAsAdventSource,
} from "../src";
import { getEffectiveSoulStateIds } from "../src/mechanics/magic-compatible-soul-state";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getDef = (id: string) => definitions.get(id);
const lookups = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
};
const card = (state: GameState, id: string) =>
  state.cardInstances.find((instance) => instance.instanceId === id)!;

function rimuruState(contractCount = 1): GameState {
  const initial = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(getDef("BSTS01-C01")!, {
        instanceId: "rimuru-top",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      ...Array.from({ length: contractCount }, (_, index) =>
        createCardInstance(getDef("BSTS01-CX01")!, {
          instanceId: `rimuru-contract-${index}`,
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: index === 0 ? 3 : 0,
          ...(index > 0 ? { zoneRoleName: "advent-source" } : {}),
        })
      ),
    ],
    playerOverrides: [
      {
        contractCardNo: "BSTS01-CX01",
        handCount: 1,
        deckCount: 0,
        soulCoreLocation: { kind: "reserve" },
      },
      { handCount: 0, deckCount: 0 },
    ],
  });
  card(initial, "rimuru-contract-0").underCards = Array.from(
    { length: contractCount - 1 },
    (_, extra) => ({
      cardInstanceId: `rimuru-contract-${extra + 1}`,
      role: "advent_source" as const,
    })
  );
  const state = executeAdvent(
    initial,
    "alice",
    {
      adventCardInstanceId: "rimuru-top",
      targetInstanceId: "rimuru-contract-0",
      adventData: getDef("BSTS01-C01")!.adventData!,
      isContractAdvent: true,
    },
    getDef
  );
  expect(card(state, "rimuru-top").underCards).toHaveLength(contractCount);
  return state;
}

function leaveRimuru(
  state: GameState,
  kind: PendingLeaveKind = "destroy",
  zone?: Zone,
  causePlayerId = "bob"
) {
  return flushPendingLeaves(
    queuePendingLeave({
      state,
      instanceId: "rimuru-top",
      kind,
      cause: "effect_resolution",
      causePlayerId,
      chainId: "leave-rimuru",
      ...(zone ? { leaveDestination: { zone } } : {}),
    }),
    getDef
  );
}

function chooseSoul(state: GameState, keep: boolean) {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
  }).find(
    (candidate) =>
      candidate.kind === "resolve_soul_state_replacement" &&
      candidate.choice === (keep ? "keep" : "decline")
  );
  expect(action).toBeDefined();
  return applyLegalAction({ ...lookups, state, action: action! }).state;
}

describe("煌臨中のリムルの離脱（公式 Q1505/Q1506）", () => {
  it.each([
    ["destroy", "trash"],
    ["vanish", "trash"],
    ["bounce", "hand"],
    ["bounce", "deck"],
    ["remove_from_game", "removed_from_game"],
  ] as const)("%s → %s: 煌臨元だけ魂状態で残す／辞退する", (kind, zone) => {
    for (const keep of [true, false]) {
      const before = rimuruState();
      const waiting = leaveRimuru(before, kind, zone);
      expect(waiting.pendingSoulStateReplacement).toMatchObject({
        cardInstanceId: "rimuru-contract-0",
        leavingCardInstanceId: "rimuru-top",
      });
      expect(card(waiting, "rimuru-top").zone).toBe("field");
      const after = chooseSoul(waiting, keep);
      expect(card(after, "rimuru-top")).toMatchObject({
        zone,
        normalCoreCount: 0,
        underCards: [],
      });
      expect(card(after, "rimuru-contract-0")).toMatchObject({
        zone: keep ? "field" : zone,
        normalCoreCount: 0,
        attachedToInstanceId: null,
      });
      if (keep)
        expect(card(after, "rimuru-contract-0").zoneRoleName).toBe("spirit");
      expect(after.players[0]!.soulStateInstanceIds).toEqual(
        keep ? ["rimuru-contract-0"] : []
      );
      expect(after.players[0]!.reserveNormalCoreCount).toBe(
        before.players[0]!.reserveNormalCoreCount + 3
      );
      expect(after.pendingLeaveEntities).toEqual([]);
      expect(after.pendingSoulStateReplacement).toBeNull();
      expect(collectGameStateInvariantIssues(after)).toEqual([]);
    }
  });

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])("複数の契約煌臨元: %s / %s を個別に選べる", (first, second) => {
    const waiting = leaveRimuru(rimuruState(2));
    const firstId = waiting.pendingSoulStateReplacement!.cardInstanceId;
    const middle = chooseSoul(waiting, first!);
    expect(card(middle, "rimuru-top").zone).toBe("field");
    expect(middle.players[0]!.soulStateInstanceIds).toEqual([]);
    const secondId = middle.pendingSoulStateReplacement!.cardInstanceId;
    expect(secondId).not.toBe(firstId);
    const after = chooseSoul(middle, second!);
    expect(card(after, firstId).zone).toBe(first ? "field" : "trash");
    expect(card(after, secondId).zone).toBe(second ? "field" : "trash");
    expect(card(after, "rimuru-top").zone).toBe("trash");
    expect(after.pendingLeaveEntities).toEqual([]);
  });

  it("自分の効果による離脱では煌臨元にも魂状態の選択を出さない", () => {
    const after = leaveRimuru(rimuruState(), "destroy", undefined, "alice");
    expect(after.pendingSoulStateReplacement).toBeNull();
    expect(card(after, "rimuru-contract-0").zone).toBe("trash");
  });

  it("共有煌臨元は残存する別の煌臨スピリットがある間は魂状態化も移動もしない", () => {
    const initial = rimuruState();
    initial.cardInstances.push({
      ...card(initial, "rimuru-top"),
      instanceId: "other-top",
    });
    const after = leaveRimuru(initial);
    expect(after.pendingSoulStateReplacement).toBeNull();
    expect(card(after, "rimuru-contract-0").zone).toBe("field");
    expect(after.players[0]!.soulStateInstanceIds).toEqual([]);
    expect(card(after, "other-top").underCards).toHaveLength(1);
  });

  it.each([true, false])(
    "共有煌臨元の両方が離れるときは一度だけ選択する: %s",
    (keep) => {
      const initial = rimuruState();
      initial.cardInstances.push({
        ...card(initial, "rimuru-top"),
        instanceId: "other-top",
        normalCoreCount: 1,
      });
      const queued = queuePendingLeave({
        state: initial,
        instanceId: "other-top",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: "bob",
        chainId: "leave-rimuru",
      });
      const after = chooseSoul(leaveRimuru(queued), keep);
      expect(card(after, "rimuru-top").zone).toBe("trash");
      expect(card(after, "other-top").zone).toBe("trash");
      expect(card(after, "rimuru-contract-0").zone).toBe(
        keep ? "field" : "trash"
      );
      expect(after.pendingSoulStateReplacement).toBeNull();
      expect(after.pendingLeaveEntities).toEqual([]);
      expect(collectGameStateInvariantIssues(after)).toEqual([]);
    }
  );

  it("別々の重なりが同時離脱しても残る契約カードの選択を失わない", () => {
    const initial = rimuruState();
    initial.cardInstances.push(
      {
        ...card(initial, "rimuru-top"),
        instanceId: "other-top",
        underCards: [
          { cardInstanceId: "other-contract", role: "advent_source" },
        ],
        normalCoreCount: 1,
      },
      { ...card(initial, "rimuru-contract-0"), instanceId: "other-contract" }
    );
    const queued = queuePendingLeave({
      state: initial,
      instanceId: "other-top",
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: "bob",
      chainId: "other-chain",
    });
    const middle = chooseSoul(leaveRimuru(queued), true);
    expect(middle.pendingSoulStateReplacement).not.toBeNull();
    const after = chooseSoul(middle, true);
    expect(after.players[0]!.soulStateInstanceIds.sort()).toEqual([
      "other-contract",
      "rimuru-contract-0",
    ]);
    expect(after.pendingLeaveEntities).toEqual([]);
  });

  it("一番上の契約カードを残しても契約ではない煌臨元は指定先へ移動する", () => {
    const initial = rimuruState();
    card(initial, "rimuru-top").definitionId = "BSTS01-CX01";
    card(initial, "rimuru-top").originalDefinitionId = "BSTS01-CX01";
    card(initial, "rimuru-contract-0").definitionId = "BSTS01-C01";
    card(initial, "rimuru-contract-0").originalDefinitionId = "BSTS01-C01";
    const after = chooseSoul(leaveRimuru(initial), true);
    expect(card(after, "rimuru-top")).toMatchObject({
      zone: "field",
      underCards: [],
    });
    expect(card(after, "rimuru-contract-0").zone).toBe("trash");
    expect(after.pendingLeaveEntities).toEqual([]);
  });
});

// 2026-09-15 添付 snapshot の card-45 / card-46 の重なりを再現する。
function bulletState() {
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(getDef("BSGE01-CX01")!, {
        instanceId: "host",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(getDef("BSGE01-R03")!, {
        instanceId: "bullet",
        ownerPlayerId: "bob",
        zone: "field",
        zoneRoleName: "bullet-edit",
        attachedToInstanceId: "host",
      }),
    ],
    playerOverrides: [{}, { contractCardNo: "BSGE01-CX01" }],
  });
  card(state, "host").underCards = [
    {
      cardInstanceId: "bullet",
      role: "text_role",
      roleTag: "バレットエディット",
    },
  ];
  return state;
}

describe("重なったカードと契約カードの魂状態化", () => {
  it.each([true, false])(
    "鍵ブレイヴの継承確定後は再提示せず、契約煌臨元の保持=%sを処理する",
    (keepSource) => {
      let state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(getDef("BSFT01-CX01")!, {
            instanceId: "host",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 2,
            attachedChildrenIds: ["key"],
          }),
          createCardInstance(getDef("BSFT01-TR01(A)")!, {
            instanceId: "key",
            ownerPlayerId: "alice",
            zone: "field",
            attachedToInstanceId: "host",
          }),
          createCardInstance(getDef("BSFT01-CX01")!, {
            instanceId: "under",
            ownerPlayerId: "alice",
            zone: "field",
          }),
        ],
        playerOverrides: [
          { contractCardNo: "BSFT01-CX01", handCount: 0, deckCount: 0 },
          { handCount: 0, deckCount: 0 },
        ],
      });
      state = attachAsAdventSource(state, "under", "host");
      const reserveBefore = state.players[0]!.reserveNormalCoreCount;
      state = flushPendingLeaves(
        queuePendingLeave({
          state,
          instanceId: "host",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "leave-key-host",
        }),
        getDef
      );
      const inherit = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      }).find(
        (action) =>
          action.kind === "resolve_brave_leave_choice" &&
          action.choice === "inherit_soul_state"
      );
      expect(inherit).toBeDefined();
      state = applyLegalAction({ ...lookups, state, action: inherit! }).state;
      state = chooseSoul(state, true);
      expect(state.pendingBraveLeaveChoice).toBeNull();
      expect(state.pendingSoulStateReplacement?.cardInstanceId).toBe("under");
      state = chooseSoul(state, keepSource);
      expect(state.pendingBraveLeaveChoice).toBeNull();
      expect(state.pendingSoulStateReplacement).toBeNull();
      expect(state.pendingLeaveEntities).toEqual([]);
      expect(state.players[0]!.soulStateInstanceIds.sort()).toEqual(
        keepSource ? ["host", "under"] : ["host"]
      );
      expect([...getEffectiveSoulStateIds(state, getDef)].sort()).toEqual(
        keepSource ? ["host", "key", "under"] : ["host", "key"]
      );
      expect(card(state, "host")).toMatchObject({
        zone: "field",
        normalCoreCount: 0,
        underCards: [],
        attachedChildrenIds: ["key"],
      });
      expect(card(state, "key")).toMatchObject({
        zone: "field",
        attachedToInstanceId: "host",
      });
      expect(card(state, "under").zone).toBe(keepSource ? "field" : "trash");
      expect(state.players[0]!.reserveNormalCoreCount).toBe(reserveBefore + 2);
      expect(collectGameStateInvariantIssues(state)).toEqual([]);
    }
  );

  it.each(["destroy", "bounce"] as const)(
    "%s: バレットエディットを保持して魂状態で残る",
    (kind) => {
      const state = flushPendingLeaves(
        queuePendingLeave({
          state: bulletState(),
          instanceId: "host",
          kind,
          cause: "effect_resolution",
          causePlayerId: "alice",
          chainId: "leave",
        }),
        getDef
      );
      const action = getLegalActions({
        state,
        actingPlayerId: "bob",
        getCardDefinitionById: getDef,
      }).find(
        (candidate) =>
          candidate.kind === "resolve_soul_state_replacement" &&
          candidate.choice === "keep"
      );
      expect(action).toBeDefined();
      expect(card(state, "host").underCards).toHaveLength(1);
      const after = applyLegalAction({
        state,
        action: action!,
        getCardDefinitionById: getDef,
      }).state;
      expect(after.players[1]!.soulStateInstanceIds).toContain("host");
      expect(card(after, "host")).toMatchObject({
        zone: "field",
        normalCoreCount: 0,
        underCards: card(state, "host").underCards,
      });
      expect(card(after, "bullet")).toMatchObject({
        zone: "field",
        attachedToInstanceId: "host",
        pendingLeaveKind: null,
      });
      expect(after.pendingLeaveEntities).toEqual([]);
    }
  );
});
