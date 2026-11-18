import { collectTriggerEventsFromStateDelta } from "../src/effect/trigger-system";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  confirmAttackDeclarationAsAction,
  useAttackAsAction,
  usePassPreDeclarationStackAsAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  refreshExhaustStates,
  runStateBasedActions,
} from "../src";
import { synchronizeBraveExhaustion } from "../src/mechanics/brave-spirit-state-recovery";
import type { Action, ExhaustState, GameState } from "../src";

const definitions = new Map(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((card) => [
    card.cardNo,
    card,
  ])
);
const lookup = (id: string) => definitions.get(id);
const hostDefinition = lookup("BSSA01-転醒X03(A)")!;
const braveDefinition = lookup("BSSA01-転醒X02(A)")!;

function combinedState(exhaustState: ExhaustState): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(hostDefinition, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 4,
          exhaustState,
          attachedChildrenIds: ["brave"],
        }),
        createCardInstance(braveDefinition, {
          instanceId: "brave",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
          exhaustState,
          attachedToInstanceId: "host",
        }),
      ],
    }),
    step: "attack",
    turnNumber: 4,
    activePlayerId: "alice",
  };
}

function states(state: GameState) {
  return state.cardInstances.map((card) => card.exhaustState);
}

describe("合体スピリットの疲労状態", () => {
  it("ユージオの実カードの回復効果で青薔薇の剣も回復する（保存盤面の再現）", () => {
    const before = combinedState("exhausted");
    const after = executeEffect({
      chainId: "test:combined-exhaust-state:64",
      state: before,
      effect: hostDefinition.effects![3]!,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
    });
    expect(states(after)).toEqual(["recovered", "recovered"]);
    expect(states(before)).toEqual(["exhausted", "exhausted"]);
  });

  it.each([
    ["recovered", { kind: "exhaust", target: { kind: "self" } }, "exhausted"],
    [
      "exhausted",
      {
        kind: "set_exhaust_state",
        target: { kind: "self" },
        state: "heavily_exhausted",
      },
      "heavily_exhausted",
    ],
    [
      "heavily_exhausted",
      {
        kind: "set_exhaust_state",
        target: { kind: "self" },
        state: "recovered",
      },
      "recovered",
    ],
  ] as const)("%s から %j で両方が %s になる", (before, action, after) => {
    const result = executeEffect({
      chainId: "test:combined-exhaust-state:96",
      state: combinedState(before),
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [{ action: action as Action }],
      },
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
    });
    expect(states(result)).toEqual([after, after]);
  });

  it("本体のリフレッシュ回復が禁止されている間はブレイヴだけ回復しない", () => {
    const before = combinedState("exhausted");
    before.cardInstances[0]!.skipNextRefreshRecovery = true;
    const blocked = refreshExhaustStates(before, "alice", lookup);
    expect(states(blocked)).toEqual(["exhausted", "exhausted"]);
    expect(states(refreshExhaustStates(blocked, "alice", lookup))).toEqual([
      "recovered",
      "recovered",
    ]);
  });

  it("保存データの疲労不一致は本体を正源にSBAで修復する", () => {
    const before = combinedState("exhausted");
    before.cardInstances[0]!.exhaustState = "recovered";
    expect(states(runStateBasedActions(before, lookup).state)).toEqual([
      "recovered",
      "recovered",
    ]);
  });
});

describe("合体疲労同期の例外と範囲", () => {
  it.each([
    ["allow_tapless_battle_declare", "recovered", "recovered"],
    ["allow_attack_while_exhausted", "exhausted", "heavily_exhausted"],
  ] as const)(
    "%s のアタック宣言でブレイヴも同じ状態になる",
    (kind, before, after) => {
      const granted = executeEffect({
        chainId: "test:combined-exhaust-state:137",
        state: combinedState(before),
        effect: {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind,
                target: { kind: "self" },
                duration: { scope: "turn" },
              },
            },
          ],
        },
        sourceInstanceId: "host",
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
      });
      const tentative = useAttackAsAction({
        state: granted,
        actingPlayerId: "alice",
        sourceInstanceId: "host",
        getCardDefinitionById: lookup,
      });
      const passed = usePassPreDeclarationStackAsAction({
        state: tentative,
        actingPlayerId: "bob",
      });
      const declared = confirmAttackDeclarationAsAction(
        passed.closedWindow!,
        passed.state,
        { getCardDefinitionById: lookup }
      );
      expect(states(declared.state)).toEqual([after, after]);
    }
  );

  it("異魔神は疲労せず、左右のホストは独立する", () => {
    const state = combinedState("heavily_exhausted");
    const imagin = lookup("BSTH001-転醒R01(B)")!;
    state.cardInstances[1] = {
      ...createCardInstance(imagin, {
        instanceId: "brave",
        ownerPlayerId: "alice",
        zone: "field",
        attachedToInstanceId: "host",
      }),
      imaginRightCombinedWith: "right-host",
    };
    state.cardInstances.push(
      createCardInstance(hostDefinition, {
        instanceId: "right-host",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 3,
        exhaustState: "exhausted",
        attachedChildrenIds: ["brave"],
      })
    );
    const synced = synchronizeBraveExhaustion(state, lookup);
    expect(states(synced)).toEqual([
      "heavily_exhausted",
      "recovered",
      "exhausted",
    ]);
    expect(synchronizeBraveExhaustion(synced, lookup)).toBe(synced);
  });

  it("親側キャッシュが古くても複数のブレイヴへ反映し、バレットエディットカードは変更しない", () => {
    const state = combinedState("recovered");
    state.cardInstances[0]!.attachedChildrenIds = [];
    state.cardInstances[0]!.exhaustState = "heavily_exhausted";
    state.cardInstances[0]!.exhaustedByUnpreventableEffect = true;
    state.cardInstances.push(
      { ...state.cardInstances[1]!, instanceId: "second-brave" },
      createCardInstance(lookup("BSGE01-R01")!, {
        instanceId: "bullet",
        ownerPlayerId: "alice",
        zone: "field",
        attachedToInstanceId: "host",
      })
    );
    const synced = synchronizeBraveExhaustion(state, lookup);
    expect(states(synced)).toEqual([
      "heavily_exhausted",
      "heavily_exhausted",
      "heavily_exhausted",
      "recovered",
    ]);
    expect(synced.cardInstances[1]!.exhaustedByUnpreventableEffect).toBe(true);
    expect(synced.cardInstances[2]!.exhaustedByUnpreventableEffect).toBe(true);
    expect(synced.cardInstances[3]).toBe(state.cardInstances[3]);
    expect(states(state)).toEqual([
      "heavily_exhausted",
      "recovered",
      "recovered",
      "recovered",
    ]);
  });
});

it("合体中の同期による疲労・回復を別個体のイベントとして二重発火しない", () => {
  for (const [before, after, eventKind] of [
    ["exhausted", "recovered", "recover"],
    ["recovered", "exhausted", "exhaust"],
  ] as const) {
    const beforeState = combinedState(before);
    const afterState = synchronizeBraveExhaustion(
      {
        ...beforeState,
        cardInstances: beforeState.cardInstances.map((card) =>
          card.instanceId === "host" ? { ...card, exhaustState: after } : card
        ),
      },
      lookup
    );
    const events = collectTriggerEventsFromStateDelta({
      beforeState,
      afterState,
      source: "effect_resolution",
    });
    expect(
      events
        .filter((event) => event.eventKind === eventKind)
        .map((event) => event.relatedInstanceId)
    ).toEqual(["host"]);
  }
});
