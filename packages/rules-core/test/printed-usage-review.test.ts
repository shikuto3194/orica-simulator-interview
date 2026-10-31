import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type GameState,
  type Zone,
} from "../src/runtime";
import { finishCoreChoices } from "./helpers/core-choice-driver";

const lookup = (id: string) => ALL_CARDS.find((card) => card.cardNo === id);
const fieldLookup = buildFieldCardEffectLookup(ALL_CARDS);
const context = {
  getCardDefinitionById: lookup,
  getRegisteredFieldCardEffectActions: fieldLookup,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};
const make = (
  no: string,
  id: string,
  owner = "alice",
  zone: Zone = "field",
  cores = 1
) =>
  createCardInstance(lookup(no)!, {
    instanceId: id,
    ownerPlayerId: owner,
    zone,
    normalCoreCount: zone === "field" ? cores : 0,
  });
const legal = (state: GameState, actor = "alice") =>
  getLegalActions({ ...context, state, actingPlayerId: actor });
const zoneOf = (state: GameState, id: string) =>
  state.cardInstances.find((card) => card.instanceId === id)!.zone;

function fieldActions(
  state: GameState,
  no: string,
  effectIndex: number,
  actor = "alice"
) {
  const index = fieldLookup(no)!.findIndex(
    (registration) => registration.effectIndex === effectIndex
  );
  expect(index).toBeGreaterThanOrEqual(0);
  return legal(state, actor).filter(
    (action) =>
      action.kind === "use_field_card_effect" &&
      action.sourceCardNo === no &&
      action.registrationIndex === index
  );
}

function closeStack(state: GameState): GameState {
  for (let i = 0; state.stackWindow && i < 10; i++) {
    const pass = legal(state, state.stackWindow.priorityPlayerId).find(
      (action) => action.kind === "pass_stack"
    );
    expect(pass).toBeDefined();
    state = applyLegalAction({ ...context, state, action: pass! }).state;
  }
  expect(state.stackWindow).toBeNull();
  return state;
}

describe("未着手の印字回数制限レビュー: 宣言から最終盤面まで", () => {
  it.each(["BSTH11-C01", "BSTH11-C02"])(
    "%s の手札/手元の両分岐は同名ターン枠を共有し、相手側は独立",
    (no) => {
      for (const [choiceIndex, destination] of [
        [0, "hand"],
        [1, "set_aside"],
      ] as const) {
        let state: GameState = {
          ...createEmptyGameState({
            playerIds: ["alice", "bob"],
            cardInstances: [
              make(no, "source"),
              make(no, "same-name"),
              make(no, "opponent", "bob"),
              make("BSTH11-R02", "target"),
              make("BSTH11-R02", "other-target"),
              make("BSTH11-R02", "opponent-target", "bob"),
            ],
          }),
          activePlayerId: "alice",
          step: "main",
          turnNumber: 3,
        };
        const declaration = fieldActions(state, no, 2).find(
          (action) => action.sourceInstanceId === "source"
        );
        expect(declaration).toBeDefined();
        state = applyLegalAction({
          ...context,
          state,
          action: declaration!,
        }).state;
        expect(state.stackWindow).not.toBeNull();
        expect(zoneOf(state, "target")).toBe("field");
        state = closeStack(state);
        const branch = legal(state).find(
          (action) =>
            action.kind === "resolve_pending_step_choice" &&
            action.choiceIndex === choiceIndex
        );
        expect(branch).toBeDefined();
        state = applyLegalAction({ ...context, state, action: branch! }).state;
        const target = legal(state).find(
          (action) => action.kind === "resolve_pending_effect_target"
        );
        expect(target).toBeDefined();
        state = applyLegalAction({
          ...context,
          state,
          action: target!,
          targetInstanceIds: ["target"],
        }).state;
        expect(zoneOf(state, "target")).toBe(destination);
        expect(zoneOf(state, "source")).toBe("field");
        expect(zoneOf(state, "other-target")).toBe("field");
        expect(state.pendingStepChoice).toBeNull();
        expect(
          legal(state).some(
            (action) => action.kind === "resolve_pending_effect_target"
          )
        ).toBe(false);
        expect(fieldActions(state, no, 2)).toHaveLength(0);
        expect(
          fieldActions({ ...state, activePlayerId: "bob" }, no, 2, "bob").map(
            (action) => action.sourceInstanceId
          )
        ).toContain("opponent");
        expect(
          fieldActions({ ...state, turnNumber: 5 }, no, 2).map(
            (action) => action.sourceInstanceId
          )
        ).toContain("same-name");
      }
    }
  );

  it("BSTH11-R01 は回復を消費しても前段の2枚除外を再実行し、別個体の回復は独立", () => {
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          {
            ...make("BSTH11-R01", "source", "alice", "field", 4),
            exhaustState: "exhausted",
          },
          {
            ...make("BSTH11-R01", "same-name", "alice", "field", 4),
            exhaustState: "exhausted",
          },
          ...Array.from({ length: 6 }, (_, i) =>
            make("BSTH11-C01", `trash-${i}`, "bob", "trash")
          ),
        ],
      }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 3,
    };
    for (const [round, sourceInstanceId] of [
      "source",
      "source",
      "same-name",
    ].entries()) {
      state = {
        ...state,
        cardInstances: state.cardInstances.map((card) =>
          card.instanceId === sourceInstanceId
            ? { ...card, exhaustState: "exhausted" }
            : card
        ),
      };
      state = executeEffect({
        ...context,
        state,
        chainId: `review:r01:${round}`,
        effect: lookup("BSTH11-R01")!.effects![3]!,
        effectIndex: 3,
        sourceInstanceId,
        actingPlayerId: "alice",
      });
      if (state.pendingZoneSelection) {
        const select = legal(state).find(
          (action) => action.kind === "resolve_pending_zone_selection"
        );
        expect(select).toBeDefined();
        state = applyLegalAction({
          ...context,
          state,
          action: select!,
          selectedZoneCardIds: [`trash-${round * 2}`, `trash-${round * 2 + 1}`],
        }).state;
      }
      if (round !== 1) {
        const recover = legal(state).find(
          (action) =>
            action.kind === "resolve_pending_step_optional_choice" &&
            action.choice === "execute"
        );
        expect(recover).toBeDefined();
        state = applyLegalAction({ ...context, state, action: recover! }).state;
      } else {
        expect(state.pendingStepOptionalChoice).toBeNull();
      }
      expect(
        state.cardInstances.filter((card) => card.zone === "removed_from_game")
      ).toHaveLength((round + 1) * 2);
      expect(
        state.cardInstances.find(
          (card) => card.instanceId === sourceInstanceId
        )!.exhaustState
      ).toBe(round === 1 ? "exhausted" : "recovered");
      expect(state.pendingZoneSelection).toBeNull();
      expect(state.pendingStepOptionalChoice).toBeNull();
    }
  });

  it("BSTS01-C01 の確定裁定は同名ターン1回 AND 個体ゲーム1回で無料配置する", () => {
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          make("BSTS01-C01", "source"),
          make("BSTS01-C01", "same-name"),
          make("BSTS01-C01", "opponent", "bob"),
          make("BSFT01-C03", "nexus-0", "alice", "trash"),
          make("BSFT01-C03", "nexus-1", "alice", "trash"),
          make("BSFT01-C03", "opponent-nexus", "bob", "trash"),
        ],
        playerOverrides: [
          { countValue: 4, reserveNormalCoreCount: 4 },
          { countValue: 4, reserveNormalCoreCount: 4 },
        ],
      }),
      activePlayerId: "alice",
      step: "main",
      turnNumber: 3,
    };
    for (const [round, sourceInstanceId] of ["source", "same-name"].entries()) {
      const declaration = fieldActions(state, "BSTS01-C01", 1).find(
        (action) => action.sourceInstanceId === sourceInstanceId
      );
      expect(declaration).toBeDefined();
      state = applyLegalAction({
        ...context,
        state,
        action: declaration!,
      }).state;
      expect(zoneOf(state, `nexus-${round}`)).toBe("trash");
      state = closeStack(state);
      if (state.pendingEffectTargetSelection) {
        const target = legal(state).find(
          (action) => action.kind === "resolve_pending_effect_target"
        );
        expect(target).toBeDefined();
        state = applyLegalAction({
          ...context,
          state,
          action: target!,
          targetInstanceIds: [`nexus-${round}`],
        }).state;
      }
      if (state.pendingZoneSelection) {
        const select = legal(state).find(
          (action) => action.kind === "resolve_pending_zone_selection"
        );
        expect(select).toBeDefined();
        state = applyLegalAction({
          ...context,
          state,
          action: select!,
          selectedZoneCardIds: [`nexus-${round}`],
        }).state;
      }
      state = finishCoreChoices(state, lookup, context);
      expect(zoneOf(state, `nexus-${round}`)).toBe("field");
      expect(state.players[0]!.reserveNormalCoreCount).toBe(4);
      expect(state.players[0]!.trashNormalCoreCount).toBe(0);
      expect(state.pendingZoneSelection).toBeNull();
      expect(state.pendingMultiPlacement).toBeNull();
      expect(fieldActions(state, "BSTS01-C01", 1)).toHaveLength(0);
      if (round === 0) {
        expect(
          fieldActions(
            { ...state, activePlayerId: "bob" },
            "BSTS01-C01",
            1,
            "bob"
          ).map((action) => action.sourceInstanceId)
        ).toContain("opponent");
        state = { ...state, turnNumber: 5 };
        expect(
          fieldActions(state, "BSTS01-C01", 1).map(
            (action) => action.sourceInstanceId
          )
        ).toEqual(["same-name"]);
      }
    }
  });
});
