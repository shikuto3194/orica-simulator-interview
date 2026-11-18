/**
 * BSDB01 契約煌臨カードの「カウントN以上」宣言ゲート (AdventData.declareCondition) 検証。
 *
 * BSDB01-M01/R01/R02/TX01(A)/X01/X02 の6枚は原文が
 * 【契約煌臨：「X」＆カウントN以上『...』】であり、名前条件 (AdventCondition.cardNames) と
 * 宣言する側 (プレイヤー) のカウント資源しきい値 (AdventData.declareCondition) は独立した
 * field で、両方が同時に満たされて初めて declare_advent が legal action として出現する。
 *
 * このテストは getLegalActions → declare_advent の production 経路で、
 * declareCondition (count_value) がカウント未達時に declare_advent を除外し、
 * カウント達成時に declare_advent を出現させることを BSDB01-R01 (min:2) で確認する。
 * host は BSDB01-C01「孫悟空」を使用する（AdventCondition.cardNames:[{contains:"孫悟空"}]
 * を満たす必要があるため、無関係の名前を持つホストでは declare_advent 自体が出現しない）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
};

const ADVENT_NO = "BSDB01-R01"; // 超サイヤ人2 孫悟空 (契約煌臨, main_and_flash, declareCondition count_value min:2)
const HOST_NO = "BSDB01-C01"; // 孫悟空 (spirit, 煌臨先, cardNames:[{contains:"孫悟空"}] 適合)
const NON_MATCHING_HOST_NO = "BSDB01-C05"; // クリリン (spirit だが名前条件不適合)

function buildState(countValue: number, hostNo: string = HOST_NO): GameState {
  const host = createCardInstance(card(hostNo), {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 2,
  });
  const advent = createCardInstance(card(ADVENT_NO), {
    instanceId: "advent-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [
      { handCount: 1, soulCoreLocation: { kind: "reserve" }, countValue },
      {},
    ],
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    window: "none",
    cardInstances: [host, advent],
  };
}

function findAdventDeclaration(
  state: GameState
): Extract<LegalAction, { kind: "declare_advent" }> | undefined {
  const actions = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    ...effectLookups,
  });
  return actions.find(
    (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
      a.kind === "declare_advent" && a.sourceInstanceId === "advent-1"
  );
}

describe("BSDB01-R01 契約煌臨: カウントN以上の宣言ゲート (declareCondition)", () => {
  it("adventData.declareCondition が count_value min:2 で配線されている", () => {
    const c = card(ADVENT_NO);
    expect(c.adventData?.declareCondition).toEqual([
      { kind: "count_value", player: "self", min: 2 },
    ]);
  });

  it("カウントが閾値未満 (1) なら declare_advent は legal action に出ない", () => {
    const state = buildState(1);
    expect(findAdventDeclaration(state)).toBeUndefined();
  });

  it("カウントが閾値以上 (2) なら declare_advent が legal action に出る", () => {
    const state = buildState(2);
    const decl = findAdventDeclaration(state);
    expect(decl).toBeDefined();
    expect(decl!.candidateTargetInstanceIds).toContain("host-1");
  });

  it("カウント閾値を満たしても名前条件不一致のホストは candidateTargetInstanceIds に出ない", () => {
    // AdventCondition.cardNames:[{contains:"孫悟空"}] は declareCondition (count_value) とは
    // 独立した field。カウント閾値を満たしても、対象ホストの印字名が「孫悟空」を含まなければ
    // 契約煌臨の対象にならない（クリリンは無関係の spirit）。
    const state = buildState(2, NON_MATCHING_HOST_NO);
    const decl = findAdventDeclaration(state);
    if (decl) {
      expect(decl.candidateTargetInstanceIds).not.toContain("host-1");
    } else {
      expect(decl).toBeUndefined();
    }
  });
});
