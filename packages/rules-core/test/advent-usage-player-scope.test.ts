/**
 * 煌臨の回数枠は使用者(煌臨を行うプレイヤー)ごとに独立する (P3-170 H1)。
 *
 * 旧実装は `usedAlternateCostAdventKeysThisTurn` に `name:{名前}` だけを積んでいたため、
 * Alice が擬制で煌臨するとプレイヤーの区別なく Bob の同名の許可(BSDB01-CX01)も使用済みになっていた。
 * 10_rules/03e の同名=同じプレイヤー内、08a5 の同名制限(許可元の printed name で共有・成立後だけ記録)に従い、
 * 枠は使用者ごとに独立する。
 *
 * 実カード: 両者が BSDB01-CX01 を場に置き、BSDB01-C03(both_attack_step の契約煌臨)を手札に持つ。
 * Bob は実ソウルコアが無く、擬制(許可元の常時効果)だけが宣言手段になる盤面。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type {
  CardDefinition,
  GameState,
  LegalAction,
  LegalActionKind,
} from "../src";
import { adventFlashPosition } from "./advent-flash-position";
import {
  canUseAdventUsageForTest,
  listAdventUsage,
  seedAdventUsage,
  withoutAdventUsage,
} from "./helpers/advent-usage-fixture";

const ALICE = "alice";
const BOB = "bob";
const HOST_NO = "BSDB01-CX01";
const ADVENT_NO = "BSDB01-C03";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const card = (cardNo: string): CardDefinition => definitions.get(cardNo)!;
const getCardDefinitionById = (id: string) => definitions.get(id);
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
};

function legal(state: GameState, actingPlayerId: string): LegalAction[] {
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    ...effectLookups,
  });
}
function act(
  state: GameState,
  action: LegalAction,
  targetInstanceIds?: string[]
): GameState {
  return applyLegalAction({
    state,
    action,
    getCardDefinitionById,
    ...effectLookups,
    ...(targetInstanceIds ? { targetInstanceIds } : {}),
  }).state;
}
function find(
  state: GameState,
  actingPlayerId: string,
  kind: LegalActionKind,
  predicate: (action: LegalAction) => boolean = () => true
): LegalAction {
  const action = legal(state, actingPlayerId).find(
    (candidate) => candidate.kind === kind && predicate(candidate)
  );
  expect(action, `${actingPlayerId} の ${kind}`).toBeDefined();
  return action!;
}
function declaresFor(
  state: GameState,
  actingPlayerId: string,
  sourceId: string
) {
  return legal(state, actingPlayerId).filter(
    (action) =>
      action.kind === "declare_advent" && action.sourceInstanceId === sourceId
  );
}

/** スタック窓/戦闘フラッシュ窓を、応答が尽きるまで両者パスで閉じる。 */
function passUntilQuiet(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 12; i++) {
    if (current.stackWindow) {
      current = act(
        current,
        find(current, current.stackWindow.priorityPlayerId, "pass_stack")
      );
      continue;
    }
    if (current.activeAttack?.flashWindowState?.pendingStackAction) {
      current = act(
        current,
        find(
          current,
          current.activeAttack.flashWindowState.priorityPlayerId,
          "pass_battle_flash"
        )
      );
      continue;
    }
    break;
  }
  return current;
}

function instance(
  cardNo: string,
  instanceId: string,
  ownerPlayerId: string,
  zone: "field" | "hand"
) {
  return createCardInstance(card(cardNo), {
    instanceId,
    ownerPlayerId,
    controllerPlayerId: ownerPlayerId,
    zone,
    ...(zone === "field" ? { normalCoreCount: 1 } : {}),
  });
}

/** 両者が CX01 を場に、C03 を手札に持つ攻撃フラッシュ窓。Bob は実ソウルコア無し。 */
function position(): GameState {
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      instance(HOST_NO, "a-host", ALICE, "field"),
      instance(HOST_NO, "b-host", BOB, "field"),
      instance(ADVENT_NO, "a-goku", ALICE, "hand"),
      instance(ADVENT_NO, "b-goku", BOB, "hand"),
    ],
    playerOverrides: [
      {
        handCount: 1,
        soulCoreLocation: { kind: "reserve" },
        reserveNormalCoreCount: 2,
        contractCardNo: HOST_NO,
        countValue: 0,
      },
      {
        handCount: 1,
        soulCoreLocation: { kind: "void" },
        reserveNormalCoreCount: 2,
        contractCardNo: HOST_NO,
        countValue: 0,
      },
    ],
  });
  return adventFlashPosition(
    { ...base, step: "attack", window: "none", turnNumber: 2 },
    ALICE
  );
}

/** 戦闘フラッシュの優先権を指定プレイヤーへ移す(Alice の応答待ちを閉じた後の列挙用)。 */
function withFlashPriority(state: GameState, priorityPlayerId: string) {
  const attack = state.activeAttack!;
  return {
    ...state,
    activeAttack: {
      ...attack,
      flashWindowState: {
        ...attack.flashWindowState!,
        priorityPlayerId,
        stackResponseSourcePlayerId: priorityPlayerId,
        pendingStackAction: null,
      },
    },
  };
}

/** Alice が擬制で煌臨を成立させる。 */
function aliceAdvents(state: GameState): GameState {
  const declared = act(state, declaresFor(state, ALICE, "a-goku")[0]!);
  const afterWindow = passUntilQuiet(declared);
  // 実ソウルコアを持つ Alice には、窓後に通常/擬制の選択が出る。擬制を選ぶ。
  const alternate = find(
    afterWindow,
    ALICE,
    "resolve_pending_as_if_soul_core_choice",
    (action) =>
      action.kind === "resolve_pending_as_if_soul_core_choice" &&
      /alternate/.test(action.choiceId)
  );
  const targeting = act(afterWindow, alternate);
  return act(
    targeting,
    find(targeting, ALICE, "resolve_pending_effect_target"),
    ["a-host"]
  );
}

/**
 * Alice の煌臨時誘発(C03)を通常の行動で解決し(任意の追加効果は辞退)、待機を空にする。
 * 誘発の中身は本テストの対象外(枠は煌臨成立時に確定済み)。
 */
function settleAliceTrigger(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 10; i++) {
    const next = legal(current, ALICE).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" ||
        (action.kind === "resolve_pending_step_optional_choice" &&
          action.choice === "decline")
    );
    if (!next) break;
    current = passUntilQuiet(act(current, next));
  }
  expect(current.pendingTriggeredEffects).toEqual([]);
  expect(current.pendingStepOptionalChoice).toBeNull();
  expect(current.stackWindow).toBeNull();
  return current;
}

describe("煌臨の回数枠は使用者ごとに独立する (P3-170 H1, 実カード BSDB01-CX01 / C03)", () => {
  it("Alice が擬制煌臨しても、Bob の同名許可は使用可能なまま宣言できる", () => {
    const start = position();
    // 基準: Bob は(優先権があれば)C03 を擬制で宣言できる盤面。
    expect(
      declaresFor(withFlashPriority(start, BOB), BOB, "b-goku")
    ).toHaveLength(1);

    const afterAlice = aliceAdvents(start);
    expect(
      afterAlice.cardInstances.find((c) => c.instanceId === "a-goku")?.zone
    ).toBe("field");

    // Alice の枠だけが記録される: 許可元(CX01)の名前で共有、使用者は alice、1 回。
    expect(listAdventUsage(afterAlice)).toEqual([
      expect.objectContaining({
        kind: "alternate_cost",
        share: "card_name",
        period: "turn",
        playerId: ALICE,
        nameKey: card(HOST_NO).name,
        amount: 1,
      }),
    ]);

    // 枠の照会: Alice は使用済み、Bob は未使用(旧実装は Bob も使用済みだった)。
    const slot = (actingPlayerId: string, instanceId: string) => ({
      kind: "alternate_cost" as const,
      actingPlayerId,
      instanceId,
      definition: card(HOST_NO),
      getCardDefinitionById,
    });
    expect(canUseAdventUsageForTest(afterAlice, slot(ALICE, "a-host"))).toBe(
      false
    );
    expect(canUseAdventUsageForTest(afterAlice, slot(BOB, "b-host"))).toBe(
      true
    );

    // Alice の煌臨時誘発を解決し終えた状態で、優先権が Bob にあるとき、Bob の宣言が列挙される。
    const quiet = withFlashPriority(settleAliceTrigger(afterAlice), BOB);
    const bobDeclares = declaresFor(quiet, BOB, "b-goku");
    expect(bobDeclares).toHaveLength(1);
    expect(bobDeclares[0]).toMatchObject({
      candidateTargetInstanceIds: ["b-host"],
    });

    // 対照: Bob 自身の枠が使用済みなら宣言できない(枠が原因で消えることを確認し、上の列挙が空虚でないと示す)。
    const bobUsed = seedAdventUsage(quiet, slot(BOB, "b-host"));
    expect(declaresFor(bobUsed, BOB, "b-goku")).toHaveLength(0);
    // 対照2: Alice の枠だけを外しても Bob の列挙は変わらない(Alice の枠は Bob に影響しない)。
    expect(declaresFor(withoutAdventUsage(quiet), BOB, "b-goku")).toHaveLength(
      1
    );
  });

  it("Bob も擬制で煌臨すると、両者の枠が別々に 1 件ずつ記録される", () => {
    const afterAlice = aliceAdvents(position());
    const quiet = withFlashPriority(settleAliceTrigger(afterAlice), BOB);
    const declared = act(quiet, declaresFor(quiet, BOB, "b-goku")[0]!);
    const afterWindow = passUntilQuiet(declared);
    // Bob は実ソウルコアが無いので選択なしで擬制になる。
    expect(afterWindow.pendingAsIfSoulCoreChoice).toBeNull();
    const resolved = act(
      afterWindow,
      find(afterWindow, BOB, "resolve_pending_effect_target"),
      ["b-host"]
    );
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "b-goku")?.zone
    ).toBe("field");
    const usage = listAdventUsage(resolved);
    expect(usage).toHaveLength(2);
    expect(usage.map((entry) => entry.playerId).sort()).toEqual([ALICE, BOB]);
    for (const entry of usage)
      expect(entry).toMatchObject({
        kind: "alternate_cost",
        share: "card_name",
        period: "turn",
        nameKey: card(HOST_NO).name,
        amount: 1,
      });
  });
});
