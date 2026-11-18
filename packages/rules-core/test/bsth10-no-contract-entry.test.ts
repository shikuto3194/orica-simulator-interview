import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildHandActivatedEffectLookup,
  createCardInstance,
  createEmptyGameState,
  evaluateCondition,
  getLegalActions,
  type GameState,
  type Zone,
} from "../src";
import { finishCoreChoices } from "./helpers/core-choice-driver";
import { useAttackAsAction } from "../src/battle/battle-actions";

const entryCards = [
  "BSTH10-C01",
  "BSTH10-M01",
  "BSTH10-M02",
  "BSTH10-R01",
  "BSTH10-R02",
  "BSTH10-X02",
  "BSTH10-X05",
];
const lookup = (id: string) => ALL_CARDS.find((card) => card.cardNo === id);
const registries = {
  getCardDefinitionById: lookup,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(ALL_CARDS),
};
const make = (
  no: string,
  id: string,
  zone: Zone,
  owner = "player-1",
  cores = 0
) =>
  createCardInstance(lookup(no)!, {
    instanceId: id,
    ownerPlayerId: owner,
    zone,
    normalCoreCount: cores,
  });
function board(no: string, contractZone?: Zone, owner = "player-1"): GameState {
  return {
    ...createEmptyGameState({
      cardInstances: [
        make(no, "entry", "hand"),
        ...(contractZone
          ? [make("BSRK01-CX01", "contract", contractZone, owner)]
          : []),
      ],
      playerOverrides: [
        { reserveNormalCoreCount: 20, reserveSoulCoreCount: 1, handCount: 1 },
        {},
      ],
    }),
    step: "main",
    turnNumber: 3,
  };
}
const actions = (state: GameState, actor = "player-1") =>
  getLegalActions({ state, actingPlayerId: actor, ...registries });
const entrySummon = (state: GameState) =>
  actions(state).find(
    (action) => action.kind === "summon" && action.sourceInstanceId === "entry"
  );
function passStack(state: GameState): GameState {
  const pass = actions(state, "player-2").find(
    (action) =>
      action.kind ===
      (state.activeAttack?.flashWindowState?.pendingStackAction
        ? "pass_battle_flash"
        : "pass_stack")
  );
  expect(pass).toBeDefined();
  state = applyLegalAction({ state, action: pass!, ...registries }).state;
  const placement = actions(state).find(
    (action) => action.kind === "resolve_pending_enter_field_placement"
  );
  if (placement)
    state = applyLegalAction({
      state,
      action: placement,
      ...registries,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    }).state;
  return finishCoreChoices(state, lookup, registries);
}
function genkaiBoard(contractZone?: Zone, owner = "player-1"): GameState {
  const state = board("BSTH10-X05", contractZone, owner);
  let attacked = useAttackAsAction({
    state: {
      ...state,
      activePlayerId: "player-2",
      step: "attack",
      cardInstances: [
        ...state.cardInstances,
        make("BSTH10-X03", "target", "field", "player-1", 2),
        make("BSTH10-C04", "attacker", "field", "player-2", 1),
      ],
    },
    actingPlayerId: "player-2",
    sourceInstanceId: "attacker",
    ...registries,
  });
  for (let round = 0; round < 4; round++) {
    const pass = actions(attacked).find(
      (action) =>
        action.kind === "pass_stack" ||
        action.kind === "pass_pre_declaration_stack"
    );
    if (!pass) break;
    attacked = applyLegalAction({
      state: attacked,
      action: pass,
      ...registries,
    }).state;
  }
  const flash = actions(attacked, "player-2").find(
    (action) => action.kind === "open_battle_flash"
  );
  expect(flash).toBeDefined();
  attacked = applyLegalAction({
    state: attacked,
    action: flash!,
    ...registries,
  }).state;
  return attacked;
}
const genkaiAction = (state: GameState) =>
  actions(state).find(
    (action) =>
      action.kind === "use_hand_card_effect" &&
      action.sourceInstanceId === "entry"
  );

describe("BSTH10 召喚／現界条件のデッキ採用レベル判定", () => {
  it("BSTH10 の7枚は契約未採用なら通常召喚をスタック解決して場に出せる", () => {
    for (const no of entryCards) {
      const before = board(no);
      const summon = entrySummon(before);
      expect(summon, no).toBeDefined();
      let state = applyLegalAction({
        state: before,
        action: summon!,
        ...registries,
        paymentSources: [{ kind: "reserve", amount: lookup(no)!.cost }],
      }).state;
      state = finishCoreChoices(state, lookup, registries);
      expect(state.window, no).toBe("stack");
      expect(
        state.cardInstances.find((card) => card.instanceId === "entry")?.zone,
        no
      ).not.toBe("field");
      state = passStack(state);
      expect(
        state.cardInstances.find((card) => card.instanceId === "entry"),
        no
      ).toMatchObject({ zone: "field", normalCoreCount: 1 });
      expect(state.players[0]!.handCount, no).toBe(0);
      expect(state.players[0]!.reserveNormalCoreCount, no).toBe(
        19 - lookup(no)!.cost
      );
      expect(state.players[0]!.trashNormalCoreCount, no).toBe(lookup(no)!.cost);
      expect(state.activeStack, no).toBeFalsy();
    }
  });

  it("BSTH10 の7枚は未提示の契約を採用していればゾーンに関係なく召喚できない", () => {
    for (const no of entryCards)
      for (const zone of [
        "deck",
        "hand",
        "trash",
        "removed_from_game",
        "field",
      ] as const) {
        const state = board(no, zone);
        expect(state.players[0]!.contractCardNo).toBeNull();
        expect(entrySummon(state), `${no}:${zone}`).toBeUndefined();
        expect(
          state.cardInstances.find((card) => card.instanceId === "entry")?.zone
        ).toBe("hand");
        expect(state.players[0]!.reserveNormalCoreCount).toBe(20);
      }
  });

  it("相手の契約採用は自分の7枚の召喚を妨げず、所有者の契約採用はコントロール変更後も残る", () => {
    for (const no of entryCards) {
      expect(entrySummon(board(no, "deck", "player-2")), no).toBeDefined();
      const state = board(no, "field");
      state.cardInstances.find(
        (card) => card.instanceId === "contract"
      )!.controllerPlayerId = "player-2";
      expect(entrySummon(state), no).toBeUndefined();
      expect(
        evaluateCondition(
          state,
          [{ kind: "no_contract_card", player: "opponent", negate: true }],
          "entry",
          "player-2",
          lookup
        )
      ).toBe(true);
    }
  });

  it("契約カードの面が変わってもoriginalDefinitionIdの採用契約を参照する", () => {
    const state = board("BSTH10-C01", "field");
    const contract = state.cardInstances.find(
      (card) => card.instanceId === "contract"
    )!;
    contract.originalDefinitionId = "BSRK01-CX01";
    contract.definitionId = "BSTH01-C01";
    expect(entrySummon(state)).toBeUndefined();
  });

  it("BSTH10-X05 は契約未採用なら現界を宣言し、窓後にソウルコア支払いと場入りを完了する", () => {
    const before = genkaiBoard();
    const action = genkaiAction(before);
    expect(action).toBeDefined();
    const declared = applyLegalAction({
      state: before,
      action: action!,
      ...registries,
    }).state;
    expect(
      declared.activeAttack?.flashWindowState?.pendingStackAction
    ).toMatchObject({ actionKind: "hand_card_effect" });
    expect(declared.players[0]!.reserveSoulCoreCount).toBe(1);
    const state = passStack(declared);
    expect(
      state.cardInstances.find((card) => card.instanceId === "entry")
    ).toMatchObject({ zone: "field", normalCoreCount: 1 });
    expect(state.players[0]!).toMatchObject({
      reserveSoulCoreCount: 0,
      trashSoulCoreCount: 1,
      reserveNormalCoreCount: 19,
      handCount: 0,
    });
    expect(state.pendingTriggeredEffects).toEqual([]);
    expect(state.activeStack).toBeFalsy();
  });

  it("BSTH10-X05 の現界は未提示の自分の契約採用だけで禁止され、相手の採用では禁止されない", () => {
    for (const zone of ["deck", "trash", "removed_from_game"] as const) {
      const state = genkaiBoard(zone);
      expect(genkaiAction(state), zone).toBeUndefined();
      expect(state.players[0]!).toMatchObject({
        reserveSoulCoreCount: 1,
        reserveNormalCoreCount: 20,
      });
      expect(
        state.cardInstances.find((card) => card.instanceId === "entry")?.zone
      ).toBe("hand");
    }
    expect(genkaiAction(genkaiBoard("deck", "player-2"))).toBeDefined();
  });
});
