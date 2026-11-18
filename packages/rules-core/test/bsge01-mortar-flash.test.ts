import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "../src";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";

const enemy: CardDefinition = {
  ...ALL_CARDS.find((card) => card.cardNo === "BSTH01-C01")!,
  cardNo: "MORTAR-DESTROY-LISTENER",
  effects: [
    {
      timing: { kind: "card_event", event: "destroy" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    },
  ],
};
const countObserver: CardDefinition = {
  ...enemy,
  cardNo: "MORTAR-COUNT-LISTENER",
  effects: [
    {
      timing: { kind: "game_event", event: "count_decrease", player: "self" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    },
  ],
};
const defs = expandCardDefinitionsWithBackFaces([
  ...ALL_CARDS.filter((card) =>
    ["BSGE01-CX01", "BSGE01-TX01(A)", "BSGE01-R02", "BSGE01-R04"].includes(
      card.cardNo
    )
  ),
  enemy,
  countObserver,
]);
const getDef = (id: string) => defs.find((card) => card.cardNo === id);
const lookups = {
  getCardDefinitionById: getDef,
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
};

function makeState(
  underNos: string[],
  countValue = 7,
  resistant = false
): GameState {
  const host = createCardInstance(getDef("BSGE01-CX01")!, {
    instanceId: "host",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
    attachedChildrenIds: ["brave"],
  });
  const underCards = underNos.map((no) =>
    createCardInstance(getDef(no)!, {
      instanceId: no,
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
      attachedToInstanceId: "host",
      zoneRoleName: "bullet-edit",
    })
  );
  host.underCards = underCards.map((card) => ({
    cardInstanceId: card.instanceId,
    role: "text_role",
    roleTag: "バレットエディット",
  }));
  const brave = createCardInstance(getDef("BSGE01-TX01(B)")!, {
    instanceId: "brave",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 0,
    attachedToInstanceId: "host",
    zoneRoleName: "brave",
  });
  const target = createCardInstance(enemy, {
    instanceId: "enemy",
    ownerPlayerId: "bob",
    zone: "field",
    cores: 1,
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [host, brave, ...underCards, target],
    playerOverrides: [
      { countValue, protectedCounts: { 神喰: countValue } },
      {},
    ],
  });
  const state: GameState = {
    ...rebuildContinuousEffectsFromField(base, getDef),
    turnNumber: 6,
    step: "attack",
    window: "flash_before_block",
    activePlayerId: "alice",
    battleEntities: [
      {
        entityId: "host",
        memberInstanceIds: ["host", "brave"],
        attackState: "attacking",
        resolvedBp: 10000,
        resolvedSymbols: ["red"],
      },
    ],
    activeAttack: {
      attackId: "mortar-attack",
      primaryEntityId: "host",
      participantEntityIds: ["host"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [],
      symbolResolutionOrder: [],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: null,
      },
    },
  };
  const rebuilt = state;
  if (resistant)
    return {
      ...rebuilt,
      activeContinuousEffects: [
        ...rebuilt.activeContinuousEffects,
        {
          effectId: "enemy-resistance",
          sourceInstanceId: "test-source",
          sourceDefinitionId: "test",
          actingPlayerId: "bob",
          duration: { scope: "permanent" },
          createdAtTurn: 0,
          createdAtAttackId: null,
          modifierTag: "cannot_be_destroyed",
          targetInstanceId: "enemy",
          metadata: { source: "opponent_effect" },
        },
      ],
    };
  return rebuilt;
}

function actions(state: GameState, player = "alice") {
  return getLegalActions({ state, actingPlayerId: player, ...lookups });
}
function apply(
  state: GameState,
  action: LegalAction | undefined,
  targetInstanceIds?: string[]
) {
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    ...lookups,
    ...(targetInstanceIds ? { targetInstanceIds } : {}),
  }).state;
}
function declareAndPass(state: GameState) {
  const declared = apply(
    state,
    actions(state).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceEffectInstanceId === "brave" &&
        action.requiredTargetCount > 0
    )
  );
  expect(declared.pendingStepChoice).toBeNull();
  expect(declared.players[0].countValue).toBe(state.players[0].countValue);
  return apply(
    declared,
    actions(declared, "bob").find(
      (action) =>
        action.kind === "pass_stack" || action.kind === "pass_battle_flash"
    )
  );
}
function choose(state: GameState, choiceIndex: number) {
  return apply(
    state,
    actions(state).find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === choiceIndex
    )
  );
}
function destroy(state: GameState) {
  return apply(
    state,
    actions(state).find(
      (action) => action.kind === "resolve_pending_effect_target"
    ),
    ["enemy"]
  );
}

describe("BSGE01 モルターと TX01(B) 合体中フラッシュ", () => {
  it.each([0, 1])(
    "R02: 支払い選択 %i で破壊時効果の抑制と合計カウント消費が変わる",
    (choiceIndex) => {
      const pending = declareAndPass(makeState(["BSGE01-R02"]));
      expect(pending.pendingStepChoice).toMatchObject({
        sourceDefinitionId: "BSGE01-R02",
        paidEffectModifierChoice: { kind: "paid_leave_suppression" },
      });
      expect(pending.pendingEffectTargetSelection).toBeNull();
      const resolved = destroy(choose(pending, choiceIndex));
      expect(resolved.players[0].countValue).toBe(6 - choiceIndex);
      const reactions = resolved.pendingTriggeredEffects.filter(
        (effect) => effect.eventKind === "destroy"
      );
      expect(reactions.length > 0).toBe(choiceIndex === 0);
      if (choiceIndex === 1)
        expect(
          resolved.cardInstances.find((card) => card.instanceId === "enemy")
            ?.zone
        ).toBe("trash");
    }
  );

  it.each([0, 1])("R04: 支払い選択 %i で破壊耐性を貫通する", (choiceIndex) => {
    const pending = declareAndPass(makeState(["BSGE01-R04"], 7, true));
    expect(pending.pendingStepChoice).toMatchObject({
      sourceDefinitionId: "BSGE01-R04",
      paidEffectModifierChoice: { kind: "paid_prevention_immunity" },
    });
    const resolved = destroy(choose(pending, choiceIndex));
    expect(
      resolved.pendingTriggeredEffects.some(
        (effect) => effect.eventKind === "destroy"
      )
    ).toBe(choiceIndex === 1);
    if (choiceIndex === 0)
      expect(
        resolved.cardInstances.find((card) => card.instanceId === "enemy")?.zone
      ).toBe("field");
  });

  it("R02/R04 を両方選び、カウントを各1と本体1支払い、耐性と破壊時効果を抑える", () => {
    let state = declareAndPass(
      makeState(["BSGE01-R02", "BSGE01-R04"], 7, true)
    );
    state = choose(state, 1);
    expect(state.pendingStepChoice?.sourceDefinitionId).toBe("BSGE01-R02");
    state = destroy(choose(state, 1));
    expect(state.players[0].countValue).toBe(4);
    expect(
      state.pendingTriggeredEffects.filter(
        (effect) => effect.eventKind === "destroy"
      )
    ).toHaveLength(0);
    expect(
      state.cardInstances.find((card) => card.instanceId === "enemy")?.zone
    ).toBe("trash");
  });
  it("モルターが無い場合は選択を挟まず、本体のカウント1だけを支払う", () => {
    const pending = declareAndPass(makeState([]));
    expect(pending.pendingStepChoice).toBeNull();
    const resolved = destroy(pending);
    expect(resolved.players[0].countValue).toBe(6);
  });

  it.each(["BSGE01-R02", "BSGE01-R04"])(
    "%s の支払いによるカウント減少誘発は本体解決後に発生する",
    (underNo) => {
      const initial = makeState([underNo]);
      const observer = createCardInstance(countObserver, {
        instanceId: "count-observer",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      });
      const pending = declareAndPass({
        ...initial,
        cardInstances: [...initial.cardInstances, observer],
      });
      const paid = choose(pending, 1);
      expect(
        paid.pendingTriggeredEffects.some(
          (effect) => effect.eventKind === "count_decrease"
        )
      ).toBe(false);
      const resolved = destroy(paid);
      expect(resolved.pendingTriggeredEffects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventKind: "count_decrease",
            relatedInstanceId: underNo,
            amount: 1,
          }),
        ])
      );
      expect(resolved.players[0].countValue).toBe(5);
    }
  );
});
