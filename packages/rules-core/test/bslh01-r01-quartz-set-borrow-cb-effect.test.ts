/**
 * BSLH01-R01「[碧の軌跡]ロイド・バニングス」effects[1] Lv2-Lv3 フラッシュ:
 * 「ターンに1回、このスピリットを疲労させることで、自分の手札/トラッシュにある
 * 【クォーツ】を持つカード1枚までを魂状態の対象にセットする。その後、セットした
 * 系統：「CB」を持つカードの『このスピリットの召喚時』/『このスピリットのアタック時』
 * 効果1つをLvを無視して発揮する。」
 *
 * 新設プリミティブ: `quartz_set`（効果駆動クォーツセット。host/スロット自動解決、
 * qa-035 に従い countCost を自動支払い）+ `borrow_card_event_effect.ignoreLevelCondition`
 * （借用先 condition から min_level を除外）+ `.requiredTribes`（借用元 tribe 限定、
 * BSLH01-R01 は "CB" 限定）。ENGINE-quartz-set-effect-driven-primitive 初出。
 * quartz_set の対象は `targetSelectionTiming:"on_step"` の pendingStepOptionalTargetSelection
 * 経由で解決する（`resolve_pending_effect_target` legal action、count:{min:0,max:1}）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  setQuartz,
} from "../src";
import type { CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const R01 = cardNoMap.get("BSLH01-R01")!;
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const ALICE = "alice";
const BOB = "bob";

const hostDef: CardDefinition = {
  cardNo: "TEST-R01-ENIGMA-HOST",
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

/** Lv2 条件付き『召喚時』card_event 効果を持つ CB 系統のクォーツカード（合成）。 */
const cbQuartzWithLevelGatedSummon: CardDefinition = {
  cardNo: "TEST-R01-CB-QUARTZ",
  name: "テストCBクォーツ",
  printedCategory: "spirit",
  colors: ["black"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  textLines: ["Lv2『このスピリットの召喚時』", "カウント+3する。"],
  keywordTags: [],
  tribe: "CB・S.S.S",
  sourceUrls: [],
  sourceConfidence: "C",
  quartzData: {
    quartzName: "テスト駆動",
    cost: 0,
    reduction: [],
    countCost: 1,
    attributeValues: {},
  },
  effects: [
    {
      timing: { kind: "card_event", event: "summon" },
      condition: [{ kind: "min_level", value: 2 }],
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 3 } },
      ],
      textRef: [0, 1],
    },
  ],
};

/** Lv条件なし『アタック時』card_event 効果 (target:self の即時 recover) を持つ CB 系統のクォーツカード（合成）。 */
const cbQuartzWithSelfTargetAttack: CardDefinition = {
  ...cbQuartzWithLevelGatedSummon,
  cardNo: "TEST-R01-CB-QUARTZ-SELF-ATTACK",
  textLines: [
    "Lv1『このスピリットのアタック時』",
    "このスピリットは回復する。",
  ],
  effects: [
    {
      timing: { kind: "card_event", event: "attack" },
      steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
      textRef: [0, 1],
    },
  ],
};

/** 系統「CB」を持たないクォーツカード（tribe 不一致検証用、合成）。 */
const nonCbQuartz: CardDefinition = {
  ...cbQuartzWithLevelGatedSummon,
  cardNo: "TEST-R01-NONCB-QUARTZ",
  tribe: "幻想・夜族",
};

const defs = new Map<string, CardDefinition>([
  [hostDef.cardNo, hostDef],
  [cbQuartzWithLevelGatedSummon.cardNo, cbQuartzWithLevelGatedSummon],
  [cbQuartzWithSelfTargetAttack.cardNo, cbQuartzWithSelfTargetAttack],
  [nonCbQuartz.cardNo, nonCbQuartz],
]);
const getDef = (id: string) => defs.get(id) ?? getCardDefinitionById(id);
const getRegisteredTriggeredEffectActions = () => undefined;
const getRegisteredFieldCardEffectActions = () => undefined;

function buildState(options: {
  quartzCandidate: CardDefinition;
  quartzCandidateZone?: "hand" | "trash";
  quartzCandidateExhaustState?: "recovered" | "exhausted";
}): GameState {
  const host = createCardInstance(hostDef, {
    instanceId: "r01-host",
    ownerPlayerId: ALICE,
    zone: "field",
  });
  const r01 = createCardInstance(R01, {
    instanceId: "r01-self",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 2,
  });
  const quartzCandidate = createCardInstance(options.quartzCandidate, {
    instanceId: "r01-quartz-candidate",
    ownerPlayerId: ALICE,
    zone: options.quartzCandidateZone ?? "hand",
    ...(options.quartzCandidateExhaustState
      ? { exhaustState: options.quartzCandidateExhaustState }
      : {}),
  });
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [host, r01, quartzCandidate],
    playerOverrides: [{ countValue: 5 }, {}],
  });
  return {
    ...base,
    players: base.players.map((p) =>
      p.id === ALICE ? { ...p, soulStateInstanceIds: ["r01-host"] } : p
    ),
  };
}

/** exhaust(0) → quartz_set(1, on_step pending) の続きを、対象選択で解決する。 */
function resolveQuartzSetPending(
  declaredState: GameState,
  targetInstanceIds: string[]
): GameState {
  const resolveAction = getLegalActions({
    state: declaredState,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions,
    getRegisteredFieldCardEffectActions,
  }).find((a) => a.kind === "resolve_pending_step_optional_target_selection");
  expect(resolveAction).toBeDefined();
  let result = applyLegalAction({
    state: declaredState,
    action: resolveAction!,
    targetInstanceIds,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions,
  }).state;
  if (result.pendingStepChoice) {
    const placement = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_choice" && a.choiceLabel.includes("右")
    );
    expect(placement).toBeDefined();
    result = applyLegalAction({
      state: result,
      action: placement!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions,
      getRegisteredFieldCardEffectActions,
    }).state;
  }
  return result;
}

describe("BSLH01-R01 effects[1]: quartz_set + borrow_card_event_effect(ignoreLevelCondition + requiredTribes)", () => {
  it("stub フィールドが解消されている", () => {
    expect(R01.effects![1]!.stub).toBeUndefined();
  });

  it("[board] CB系統クォーツをセットし、Lv2条件付きの召喚時効果をLv無視で発揮する（カウント+3）", () => {
    const state = buildState({ quartzCandidate: cbQuartzWithLevelGatedSummon });
    const aliceBefore = state.players.find((p) => p.id === ALICE)!;
    expect(aliceBefore.countValue).toBe(5);

    const declared = executeEffect({
      chainId: "test:bslh01-r01-quartz-set-borrow-cb-effect:190",
      state,
      effect: R01.effects![1]!,
      sourceInstanceId: "r01-self",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    expect(declared.pendingStepOptionalTargetSelection).toMatchObject({
      requiredTargetCount: 0,
      maxTargetCount: 1,
    });

    const result = resolveQuartzSetPending(declared, ["r01-quartz-candidate"]);

    // quartz_set: 手札→field(quartz role)、host に紐づき、countCost(=1)分カウント減少。
    const quartzCard = result.cardInstances.find(
      (c) => c.instanceId === "r01-quartz-candidate"
    )!;
    expect(quartzCard.zone).toBe("field");
    expect(quartzCard.zoneRoleName).toBe("quartz");
    expect(
      result.quartzSetStates.some(
        (q) =>
          q.quartzInstanceId === "r01-quartz-candidate" &&
          q.hostInstanceId === "r01-host"
      )
    ).toBe(true);

    // borrow_card_event_effect: Lv2条件を無視して「カウント+3」が実行されている
    // （countCost -1 の後、+3 で純増+2）。
    const aliceAfter = result.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.countValue).toBe(aliceBefore.countValue + 2);
    expect(result.log).toContain(
      `borrow_card_event_effect:executed:${cbQuartzWithLevelGatedSummon.cardNo}:0:as:r01-self`
    );
  });

  it("[board] トラッシュのCB系統クォーツもコストを払いセットして借用効果を発揮する", () => {
    const state = buildState({
      quartzCandidate: cbQuartzWithLevelGatedSummon,
      quartzCandidateZone: "trash",
    });
    const countBefore = state.players.find((p) => p.id === ALICE)!.countValue;
    const declared = executeEffect({
      chainId: "test:bslh01-r01-quartz-set-borrow-cb-effect:233",
      state,
      effect: R01.effects![1]!,
      sourceInstanceId: "r01-self",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const result = resolveQuartzSetPending(declared, ["r01-quartz-candidate"]);

    const quartzCard = result.cardInstances.find(
      (card) => card.instanceId === "r01-quartz-candidate"
    )!;
    expect(quartzCard.zone).toBe("field");
    expect(
      result.quartzSetStates.some(
        (setState) =>
          setState.quartzInstanceId === "r01-quartz-candidate" &&
          setState.hostInstanceId === "r01-host"
      )
    ).toBe(true);
    // countCost -1 と借用した召喚時効果の +3 により純増 +2。
    expect(result.players.find((p) => p.id === ALICE)!.countValue).toBe(
      countBefore + 2
    );
    expect(result.log).toContain(
      `borrow_card_event_effect:executed:${cbQuartzWithLevelGatedSummon.cardNo}:0:as:r01-self`
    );
  });

  it("[board] 借用先効果内の target:self は、R01自身ではなくセットしたCBカードに解決される（attributeToBorrowedCard）", () => {
    const state = buildState({
      quartzCandidate: cbQuartzWithSelfTargetAttack,
      quartzCandidateExhaustState: "exhausted",
    });
    const declared = executeEffect({
      chainId: "test:bslh01-r01-quartz-set-borrow-cb-effect:267",
      state,
      effect: R01.effects![1]!,
      sourceInstanceId: "r01-self",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const result = resolveQuartzSetPending(declared, ["r01-quartz-candidate"]);

    expect(result.log).toContain(
      `borrow_card_event_effect:executed:${cbQuartzWithSelfTargetAttack.cardNo}:0:as:r01-self`
    );
    // 「このスピリットは回復する」の target:self は、セットしたCBカード自身
    // (r01-quartz-candidate) に解決されるべき。R01自身 (r01-self) に誤帰属すると、
    // R01が自らのコスト(疲労)で払った疲労状態がこの借用効果で回復してしまう
    // (verifier round1 refute対象)。
    const r01After = result.cardInstances.find(
      (c) => c.instanceId === "r01-self"
    )!;
    const quartzCandidateAfter = result.cardInstances.find(
      (c) => c.instanceId === "r01-quartz-candidate"
    )!;
    expect(r01After.exhaustState).toBe("exhausted");
    expect(quartzCandidateAfter.exhaustState).toBe("recovered");
  });

  it("[board] 系統「CB」を持たないクォーツをセットした場合は借用が不発（tribe_mismatch）", () => {
    const state = buildState({ quartzCandidate: nonCbQuartz });
    const declared = executeEffect({
      chainId: "test:bslh01-r01-quartz-set-borrow-cb-effect:295",
      state,
      effect: R01.effects![1]!,
      sourceInstanceId: "r01-self",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const result = resolveQuartzSetPending(declared, ["r01-quartz-candidate"]);

    // quartz_set 自体は成立する（セット対象は CB 限定ではない）。
    expect(
      result.quartzSetStates.some(
        (q) => q.quartzInstanceId === "r01-quartz-candidate"
      )
    ).toBe(true);
    expect(result.log).toContain(
      `borrow_card_event_effect:tribe_mismatch:${nonCbQuartz.cardNo}`
    );
  });

  it("[board] 手札/トラッシュに【クォーツ】カードが無ければ 0 選択で quartz_set は 不成立（疲労の対価も払わない）", () => {
    const host = createCardInstance(hostDef, {
      instanceId: "r01-host",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const r01 = createCardInstance(R01, {
      instanceId: "r01-self",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, r01],
      playerOverrides: [{ countValue: 5 }, {}],
    });
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, soulStateInstanceIds: ["r01-host"] } : p
      ),
    };

    const declared = executeEffect({
      chainId: "test:bslh01-r01-quartz-set-borrow-cb-effect:340",
      state,
      effect: R01.effects![1]!,
      sourceInstanceId: "r01-self",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const r01Declared = declared.cardInstances.find(
      (c) => c.instanceId === "r01-self"
    )!;
    expect(r01Declared.exhaustState).toBe("recovered");

    // 候補0件のため resolve_pending_effect_target は 0 選択でのみ legal。
    const result = declared.pendingStepOptionalTargetSelection
      ? resolveQuartzSetPending(declared, [])
      : declared;

    expect(result.quartzSetStates).toHaveLength(0);
    expect(result.players.find((p) => p.id === ALICE)!.countValue).toBe(5);
  });

  it("[board] host の同名クォーツと入れ替え、コスト支払い後に借用効果を発揮する（qa-029）", () => {
    const base = buildState({ quartzCandidate: cbQuartzWithLevelGatedSummon });
    const alreadySetCopy = createCardInstance(cbQuartzWithLevelGatedSummon, {
      instanceId: "r01-quartz-already-set",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const withExisting: GameState = {
      ...base,
      cardInstances: [...base.cardInstances, alreadySetCopy],
    };
    const state = setQuartz(
      withExisting,
      {
        quartzInstanceId: "r01-quartz-already-set",
        hostInstanceId: "r01-host",
        ownerPlayerId: ALICE,
        slot: "center",
      },
      getDef
    )!;
    expect(state.quartzSetStates).toHaveLength(1);
    const aliceBefore = state.players.find((p) => p.id === ALICE)!;

    const declared = executeEffect({
      chainId: "test:bslh01-r01-quartz-set-borrow-cb-effect:385",
      state,
      effect: R01.effects![1]!,
      sourceInstanceId: "r01-self",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const result = resolveQuartzSetPending(declared, ["r01-quartz-candidate"]);
    expect(result.quartzSetStates).toHaveLength(1);
    expect(
      result.quartzSetStates[0]!.quartzInstanceId,
      JSON.stringify({
        log: result.log,
        choice: result.pendingStepChoice,
        target: result.pendingStepOptionalTargetSelection,
      })
    ).toBe("r01-quartz-candidate");
    expect(
      result.cardInstances.find((c) => c.instanceId === "r01-quartz-candidate")!
        .zone
    ).toBe("field");
    expect(
      result.cardInstances.find(
        (c) => c.instanceId === "r01-quartz-already-set"
      )!.zone
    ).toBe("hand");
    expect(result.players.find((p) => p.id === ALICE)!.countValue).toBe(
      aliceBefore.countValue - 1 + 3
    );
  });
});
