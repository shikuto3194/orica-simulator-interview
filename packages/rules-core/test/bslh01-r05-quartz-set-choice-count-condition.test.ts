import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
/**
 * BSLH01-R05「[碧の軌跡]エステル・ブライト」effects[0]
 * 【バースト：相手の『このスピリットの召喚/煌臨時』発揮後】:
 * 「このカードをコストを支払わずに召喚するか、自分の魂状態の対象にコストを支払わずに
 * セットする。その後、相手のスピリット1体を破壊する。破壊したとき、自分はデッキの上から
 * 2枚ドローでき、自分の魂状態の「ENIGMA」があるとき、自分のカウント+2できる。」
 *
 * choiceIndex 0 (デフォルト) = 召喚(free)、choice[0] = quartz_set(target:self, free:true)。
 * quartz_set.free は BSLH01-R05 が初出（`useQuartzSetAsEffect` の countCost 支払い省略経路）。
 * カウント+2 の「ENIGMA があるとき」は既存 ConditionClause.field_has(soulStateOnly +
 * cardNames) で表現する（新規プリミティブ不要）。cluster-135 (quartz set-effect host identity)
 * の host-identity 非依存スコープ。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { flushPendingLeaves } from "../src/state-based-actions";
import {
  applyLegalAction,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noLookup = () => [];

const ALICE = "alice";
const BOB = "bob";

const R05 = card("BSLH01-R05");

function alice(state: GameState) {
  return state.players.find((p) => p.id === ALICE)!;
}

/** クォーツ host（ENIGMA 相当、合成）。名前に "ENIGMA" を含む＝ field_has cardNames 一致対象。 */
const hostDef: CardDefinition = {
  cardNo: "TEST-R05-ENIGMA-HOST",
  name: "ENIGMA[戦術オーブメント]テスト",
  printedCategory: "brave",
  colors: ["blue"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  quartzHostData: { slots: { left: 3, center: 1, right: 3 } },
};

const opponentSpirit: CardDefinition = {
  cardNo: "TEST-R05-OPPONENT-SPIRIT",
  name: "テスト相手スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = new Map<string, CardDefinition>([
  [hostDef.cardNo, hostDef],
  [opponentSpirit.cardNo, opponentSpirit],
]);
const getCardDefinitionById = (id: string) => defs.get(id) ?? getDef(id);

// count_increase step は effects[0].steps の index 3 (summon/quartz_set choice, destroy, draw, count_increase)。
const COUNT_STEP_INDEX = 3;
function resolveAndFlush(
  state: GameState,
  getDef: typeof getCardDefinitionById,
  declineSteps: number[] = []
) {
  let result = state;
  for (let guard = 0; result.pendingStepOptionalChoice && guard < 10; guard++) {
    const actions = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: noLookup,
    });
    const choice = declineSteps.includes(
      result.pendingStepOptionalChoice!.stepIndex
    )
      ? "decline"
      : "execute";
    const action = actions.find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" && a.choice === choice
    );
    if (!action) throw new Error("optional execute missing");
    result = applyLegalAction({
      state: result,
      action,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noLookup,
    }).state;
  }
  return flushPendingLeaves(result, getDef);
}

function buildState(options: {
  withEnigmaSoulState: boolean;
  countValue: number;
}): GameState {
  const r05 = createCardInstance(R05, {
    instanceId: "r05-self",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const oppSpirit = createCardInstance(opponentSpirit, {
    instanceId: "opp-spirit",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 1,
  });
  // draw の succeeded 判定は実体 CardInstance の zone 差分（deck→hand）で検出される
  // （deckCount のみの抽象デッキでは detectAffectedCards が affected=0 を返し、
  // 後続 conditional_result 連結が succeeded=false でスキップされてしまう）。
  const deckTop1 = createCardInstance(opponentSpirit, {
    instanceId: "deck-top-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "deck",
  });
  const deckTop2 = createCardInstance(opponentSpirit, {
    instanceId: "deck-top-2",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "deck",
  });
  const cardInstances = [r05, oppSpirit, deckTop1, deckTop2];
  const soulStateInstanceIds: string[] = [];
  if (options.withEnigmaSoulState) {
    const host = createCardInstance(hostDef, {
      instanceId: "r05-host",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    cardInstances.push(host);
    soulStateInstanceIds.push("r05-host");
  }
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances,
    playerOverrides: [{ countValue: options.countValue, deckCount: 2 }, {}],
  });
  return {
    ...base,
    players: base.players.map((p) =>
      p.id === ALICE ? { ...p, soulStateInstanceIds } : p
    ),
  };
}

describe("BSLH01-R05 effects[0]: burst choice(summon/quartz_set free) + destroy + draw + ENIGMA-gated count", () => {
  it("破壊後のドローを辞退しても、ENIGMA があればカウント+2を選べる", () => {
    const state = buildState({ withEnigmaSoulState: true, countValue: 5 });
    const after = resolveAndFlush(
      executeEffectWithChosenMinimumCores({
        chainId: "test:bslh01-r05-quartz-set-choice-count-condition:180",
        state,
        effect: R05.effects![0]!,
        sourceInstanceId: "r05-self",
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noLookup,
        choiceIndex: 0,
      }),
      getCardDefinitionById,
      [2]
    );
    expect(alice(after).countValue).toBe(7);
    expect(alice(after).deckCount).toBe(alice(state).deckCount);
    expect(
      after.cardInstances.find((c) => c.instanceId === "opp-spirit")?.zone
    ).toBe("trash");
  });
  it("stub フィールドが解消されている", () => {
    expect(R05.effects![0]!.stub).toBeUndefined();
  });

  it("[board] choiceIndex 0: コストなし召喚→相手スピリット破壊→デッキ2ドロー", () => {
    const state = buildState({ withEnigmaSoulState: false, countValue: 5 });
    const deckBefore = alice(state).deckCount;

    const after = resolveAndFlush(
      executeEffectWithChosenMinimumCores({
        chainId: "test:bslh01-r05-quartz-set-choice-count-condition:207",
        state,
        effect: R05.effects![0]!,
        sourceInstanceId: "r05-self",
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noLookup,
        choiceIndex: 0,
      }),
      getCardDefinitionById
    );

    const r05After = after.cardInstances.find(
      (c) => c.instanceId === "r05-self"
    )!;
    expect(r05After.zone).toBe("field");
    const oppAfter = after.cardInstances.find(
      (c) => c.instanceId === "opp-spirit"
    )!;
    expect(oppAfter.zone).toBe("trash");
    expect(alice(after).deckCount).toBe(deckBefore - 2);
  });

  it("[board] choiceIndex 0 + 魂状態に ENIGMA が無い: カウント+2 の選択肢自体が発生しない（countValue 不変）", () => {
    const state = buildState({ withEnigmaSoulState: false, countValue: 5 });

    const after = resolveAndFlush(
      executeEffect({
        chainId: "test:bslh01-r05-quartz-set-choice-count-condition:234",
        state,
        effect: R05.effects![0]!,
        sourceInstanceId: "r05-self",
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noLookup,
        choiceIndex: 0,
        // optional な count_increase を強制実行 resume しても、ENIGMA 不在なら
        // ステップレベル condition (field_has) で到達前に skip される。
        optionalExecuteResumeStepIndex: COUNT_STEP_INDEX,
      }),
      getCardDefinitionById
    );

    expect(alice(after).countValue).toBe(5);
  });

  it("[board] choiceIndex 0 + 魂状態に ENIGMA がある: カウント+2 を発揮できる", () => {
    const state = buildState({ withEnigmaSoulState: true, countValue: 5 });

    const after = resolveAndFlush(
      executeEffectWithChosenMinimumCores({
        chainId: "test:bslh01-r05-quartz-set-choice-count-condition:256",
        state,
        effect: R05.effects![0]!,
        sourceInstanceId: "r05-self",
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noLookup,
        choiceIndex: 0,
        optionalExecuteResumeStepIndex: COUNT_STEP_INDEX,
      }),
      getCardDefinitionById
    );

    expect(alice(after).countValue).toBe(7);
  });

  it("[board] choiceIndex 1: 魂状態の対象にコストを支払わずにクォーツセットする（countValue 不足でも成立）", () => {
    // countValue:0 は quartzData.countCost(=1) を通常なら支払えない盤面。free:true が
    // 支払いを完全にスキップすることを、この不足状態自体で証明する。
    const state = buildState({ withEnigmaSoulState: true, countValue: 0 });

    const after = resolveAndFlush(
      executeEffect({
        chainId: "test:bslh01-r05-quartz-set-choice-count-condition:278",
        state,
        effect: R05.effects![0]!,
        sourceInstanceId: "r05-self",
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noLookup,
        choiceIndex: 1,
      }),
      getCardDefinitionById,
      [COUNT_STEP_INDEX]
    );

    const r05After = after.cardInstances.find(
      (c) => c.instanceId === "r05-self"
    )!;
    expect(r05After.zone).toBe("field");
    expect(r05After.zoneRoleName).toBe("quartz");
    expect(
      after.quartzSetStates.some(
        (q) =>
          q.quartzInstanceId === "r05-self" && q.hostInstanceId === "r05-host"
      )
    ).toBe(true);
    expect(alice(after).soulStateInstanceIds).toContain("r05-self");
    // free:true のため countCost(=1) は支払われず 0 のまま。
    expect(alice(after).countValue).toBe(0);

    // choice で quartz_set を選んでも、後続の destroy/draw は独立に成立する。
    const oppAfter = after.cardInstances.find(
      (c) => c.instanceId === "opp-spirit"
    )!;
    expect(oppAfter.zone).toBe("trash");
  });
});
