import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  useAttackAsAction,
} from "../src";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import { recomputeAndRebuildContinuousEffects } from "../src/effect/continuous-effect-rebuild";
import type { ActiveStack, GameState } from "../src/model";

const defs = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const getDef = (id: string) => defs.find((card) => card.cardNo === id);
const lookups = {
  getCardDefinitionById: getDef,
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  getRegisteredMagicActions: buildMagicLookup(defs),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
};
const instance = (no: string, id: string, player: string, cores: number) =>
  createCardInstance(getDef(no)!, {
    instanceId: id,
    ownerPlayerId: player,
    controllerPlayerId: player,
    zone: "field",
    normalCoreCount: cores,
  });

function declaration(lock: string): GameState {
  const robot = instance("BSAZ02-TX01(A)", "robot", "bob", 3);
  robot.underCards = [
    {
      cardInstanceId: "drive",
      role: "text_role",
      roleTag: "アルドノアドライブ",
    },
  ];
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        instance(lock, "lock", "alice", 1),
        instance("BSTH04-C01", "attacker", "alice", 1),
        instance("BSTH11-X01", "okina", "bob", 6),
        robot,
        {
          ...instance("BSAZ02-M01", "drive", "bob", 0),
          attachedToInstanceId: "robot",
        },
        { ...instance("BSRK01-C03", "magic", "alice", 0), zone: "hand" },
      ],
      playerOverrides: [
        { reserveNormalCoreCount: 20 },
        { reserveNormalCoreCount: 20 },
      ],
    }),
    step: "attack",
    window: "none",
    turnNumber: 3,
    activePlayerId: "alice",
  };
  return useAttackAsAction({
    state: recomputeAndRebuildContinuousEffects(state, getDef),
    sourceInstanceId: "attacker",
    actingPlayerId: "alice",
    ...lookups,
  });
}
const actions = (state: GameState) =>
  getLegalActions({ state, actingPlayerId: "bob", ...lookups });
const divineActions = (state: GameState) =>
  actions(state).filter(
    (action) =>
      action.kind === "use_divine_skill" && action.sourceInstanceId === "okina"
  );

function battleWindow(
  state: GameState,
  stack: boolean,
  phase: "before_block" | "after_block" = "before_block"
): GameState {
  const pass = actions(state).find(
    (action) => action.kind === "pass_pre_declaration_stack"
  );
  expect(pass).toBeDefined();
  const active = applyLegalAction({ state, action: pass!, ...lookups }).state;
  expect(active.activeAttack).not.toBeNull();
  const pending: ActiveStack = {
    stackId: "magic-response",
    chainId: "magic-response",
    actionKind: "magic",
    actingPlayerId: "alice",
    cardInstanceId: "magic",
    cardDefinitionId: "BSRK01-C03",
    targetInstanceIds: [],
    targetEffectFilterTags: [],
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  return {
    ...active,
    window: stack ? `stack_${phase}` : `flash_${phase}`,
    activeAttack: {
      ...active.activeAttack!,
      flashWindowState: {
        kind: phase,
        priorityPlayerId: "bob",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: stack ? "alice" : "bob",
        pendingStackAction: stack ? pending : null,
      },
    },
  };
}

describe("隠岐奈の神技: 太陽の畑と星霊王のスタック禁止", () => {
  it.each([
    ["BSTH04-転醒R02(A)", true],
    ["BSFT01-X01", false],
  ] as const)("%s: 宣言応答では神技の可否が%s", (lock, allowed) => {
    const state = declaration(lock);
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "restrict_stack"
      )
    ).toBe(true);
    expect(divineActions(state).length > 0).toBe(allowed);
  });

  it.each([
    ["BSTH04-転醒R02(A)", true, "before_block"],
    ["BSTH04-転醒R02(A)", true, "after_block"],
    ["BSFT01-X01", false, "before_block"],
    ["BSFT01-X01", false, "after_block"],
  ] as const)(
    "%s: バトル中のスタック応答でも神技の可否が%s (%s)",
    (lock, allowed, phase) => {
      const state = battleWindow(declaration(lock), true, phase);
      expect(divineActions(state).length > 0).toBe(allowed);
      state.activeContinuousEffects = [
        ...state.activeContinuousEffects,
        {
          effectId: "okina-immune",
          modifierTag: "defense_immune",
          sourceInstanceId: "okina",
          sourceDefinitionId: "BSTH11-X01",
          actingPlayerId: "bob",
          targetInstanceId: "okina",
          duration: { scope: "turn" },
          createdAtTurn: 3,
          createdAtAttackId: null,
        },
      ];
      expect(divineActions(state).length > 0).toBe(allowed);
    }
  );

  it.each(["BSTH04-転醒R02(A)", "BSFT01-X01"])(
    "%s: 通常フラッシュでは神技を発揮できる",
    (lock) => {
      expect(
        divineActions(battleWindow(declaration(lock), false))
      ).not.toHaveLength(0);
    }
  );

  it("星霊王でもラベルなしの本文スタックタイミング転醒は発揮できる", () => {
    const available = actions(declaration("BSFT01-X01"));
    expect(
      available.some(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceInstanceId === "robot"
      )
    ).toBe(true);
  });
});
