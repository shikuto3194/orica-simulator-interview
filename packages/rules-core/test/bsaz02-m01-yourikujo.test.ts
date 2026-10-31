import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
/**
 * BSAZ02-M01「揚陸城」effects[0,1,2] 検証。
 *
 * 原文 (textLines[0,1,3,5,6]):
 *   フラッシュ『お互いのアタックステップ』
 *   手札にあるこのカードは配置でき、そうしたとき、スピリットすべてを疲労させる。
 *   【アルドノアドライブ：1】
 *   Lv1-Lv2【弾幕：コスト5以下】
 *   このネクサスは、コスト5以下の相手の効果を受けない。
 *
 * 検証点:
 *  - effects[0]: 自己フラッシュ配置の手札起動効果。use_hand_card_effect 適法手が
 *    『お互いのアタックステップ』窓で生成される。
 *  - effects[1]: 「そうしたとき」の全体疲労 (card_event:summon → exhaust
 *    player:"either"+category:spirit+count:"all")。
 *  - effects[2]: 【弾幕：コスト5以下】= effect_immunity sourceScope.maxCost:5、
 *    アルドノアドライブが無ければ不成立 (self_under_card_count ゲート)。
 *
 * effects[3]: Lv2『お互いのアタックステップ』系統「火星」アルティメットがちょうど1体の間、
 * 自分のライフは0にならない (textLines[8,9])。life_damage_interception(cause:"any",
 * mode:"floor", floor:1) + field_has(category:ultimate, tribes:火星, minCount:1,
 * maxCount:1) dynamic gate。
 *
 * effects[4] (textLines[8,10]、「自分のライフが1のとき相手が指定アタックした、その
 * 相手のターン終了時アルドノアドライブすべてを破棄」) は timing:{kind:"phase",step:"end",
 * whose:"opponent"} + attack_occurred{scope:"turn",targetFilter,
 * targetControllerLifeAtDeclaration} + move_card(from.hostFilter+hostUnderCardRoleTag)
 * の組み合わせで実装済み。
 *
 * ruling 確定 (needs-ruling.jsonl:BSAZ02-M01, resolution A, 2026-07-17): 「そうした」は
 * 指定アタックが成立したという行為自体のみを指す。宣言時にライフ1で指定アタックが成立
 * すれば、その後ライフが変化してもターン終了時の破棄は発生する。よって判定は宣言時点の
 * スナップショット (AttackDeclarationLogEntry.designatedTargetControllerLifeAtDeclaration、
 * attack_occurred.targetControllerLifeAtDeclaration で照合) のみを使い、発火時点(相手
 * ターン終了時)で現在のライフを再チェックする life_value gate は撤去済み。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildHandActivatedEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { flushPendingLeaves } from "../src/state-based-actions";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import {
  resolveLifeDamage,
  getPlayerLifeCoreCount,
} from "../src/core/core-system";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggerLookup = () => [];

const ALICE = "player-1";
const BOB = "player-2";
const M01 = card("BSAZ02-M01");

function srcM01(cores: number) {
  const src = createCardInstance(M01, {
    instanceId: "src-m01",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
  });
  return {
    ...src,
    underCards: [
      {
        cardInstanceId: "under-drive",
        role: "text_role" as const,
        roleTag: "アルドノアドライブ",
      },
    ],
  };
}

function underFiller() {
  return createCardInstance(M01, {
    instanceId: "under-drive",
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: "src-m01",
  });
}

function makeSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function player(state: GameState, id: string) {
  return state.players.find((p) => p.id === id)!;
}

function makeMarsUltimate(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "ultimate",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["ultimate_symbol"],
    textLines: [],
    keywordTags: [],
    tribe: "火星",
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

describe("BSAZ02-M01 effects[0]（フラッシュ『お互いのアタックステップ』手札にあるこのカードは配置できる）", () => {
  it("DSL構造: activated+mode:flash+timingScope(both/attack)+zone:hand の単独 summon step", () => {
    const effect0 = M01.effects[0]!;
    expect(effect0.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(effect0.timingScope).toEqual({ player: "both", period: "attack" });
    expect(effect0.applicability).toEqual({ zone: ["hand"] });
    expect(effect0.steps.length).toBe(2);
    expect(effect0.steps[0]!.action.kind).toBe("summon");
  });

  it("『お互いのアタックステップ』フラッシュ窓で手札起動効果が生成される", () => {
    const effectLookups = {
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(ALL_CARDS),
    };
    const attacker = makeSpirit("TEST-M01-ATTACKER");
    const getCardDefinitionById = (id: string): CardDefinition | undefined =>
      getDef(id) ?? (id === attacker.cardNo ? attacker : undefined);

    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(attacker, {
          instanceId: "alice-attacker",
          ownerPlayerId: ALICE,
          zone: "field",
          cores: 1,
          exhaustState: "exhausted",
        }),
        createCardInstance(M01, {
          instanceId: "alice-m01",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
      battleEntities: [
        {
          entityId: "battle-entity:alice-attacker",
          memberInstanceIds: ["alice-attacker"],
          resolvedBp: 2000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "attack-group:2:alice:battle-entity:alice-attacker",
        primaryEntityId: "battle-entity:alice-attacker",
        participantEntityIds: ["battle-entity:alice-attacker"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:alice-attacker",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:alice-attacker"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: ALICE,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: ALICE,
          pendingStackAction: null,
        },
      },
    });
    const state: GameState = {
      ...base,
      step: "attack",
      window: "flash_before_block",
      activePlayerId: ALICE,
      turnNumber: 2,
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      ...effectLookups,
    });

    const handEffects = actions.filter(
      (a) =>
        a.kind === "use_hand_card_effect" && a.sourceInstanceId === "alice-m01"
    );
    expect(handEffects).toHaveLength(1);
    expect(handEffects[0]).toMatchObject({
      effectIndex: 0,
      chosenTiming: "flash",
      sourceActivationZone: "hand",
    });

    // メインステップでは（フラッシュ窓外）提示されない。
    const mainState: GameState = {
      ...base,
      step: "main",
      window: null,
      activeAttack: null,
    };
    const mainActions = getLegalActions({
      state: mainState,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      ...effectLookups,
    });
    expect(
      mainActions.some(
        (a) =>
          a.kind === "use_hand_card_effect" &&
          a.sourceInstanceId === "alice-m01"
      )
    ).toBe(false);
    // 適用: applyLegalAction が拒否しない (import 経路の型整合のみ確認)。
    expect(applyLegalAction).toBeTypeOf("function");
  });
});

describe("BSAZ02-M01 手札フラッシュ配置の後続", () => {
  it("通常の配置時誘発ではなく、自己配置が成立したときだけ双方のスピリットを疲労させる", () => {
    expect(
      M01.effects.some(
        (e) => e.timing.kind === "card_event" && e.timing.event === "summon"
      )
    ).toBe(false);
    const src = createCardInstance(M01, {
      instanceId: "src-m01",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const spirit = createCardInstance(card("BSAZ01-C01"), {
      instanceId: "opp",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, spirit],
      playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
    });
    const after = executeEffectWithChosenMinimumCores({
      chainId: "test:bsaz02-m01-yourikujo:289",
      state,
      effect: M01.effects[0]!,
      sourceInstanceId: "src-m01",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "src-m01")?.zone
    ).toBe("field");
    expect(
      after.cardInstances.find((c) => c.instanceId === "opp")?.exhaustState
    ).toBe("exhausted");
  });
});

describe("BSAZ02-M01 effects[1]（Lv1-2【弾幕：コスト5以下】: このネクサスは、コスト5以下の相手の効果を受けない）", () => {
  it("DSL構造: effect_immunity(sourceScope.maxCost:5) + アルドノアドライブゲート", () => {
    const effect2 = M01.effects[1]!;
    expect(effect2.applicability).toEqual({ level: { min: 1, max: 2 } });
    expect(effect2.condition).toEqual([
      {
        kind: "self_under_card_count",
        roleTag: "アルドノアドライブ",
        minCount: 1,
      },
    ]);
    const action = effect2.steps[0]!.action;
    expect(action.kind).toBe("effect_immunity");
    if (action.kind === "effect_immunity") {
      expect(action.sourceScope).toEqual({ maxCost: 5 });
    }
  });

  it("コスト5以下の発生源には免疫が成立し、コスト6以上には成立しない", () => {
    const src = srcM01(1); // Lv1
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
    });
    const after = executeEffect({
      chainId: "test:bsaz02-m01-yourikujo:329",
      state,
      effect: M01.effects[1]!,
      effectIndex: 1,
      sourceInstanceId: "src-m01",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const target = after.cardInstances.find((c) => c.instanceId === "src-m01")!;

    const cheapSource: CardDefinition = { ...card("BSDB01-C05"), cost: 5 };
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: cheapSource,
      })
    ).toBe(true);

    const expensiveSource: CardDefinition = { ...card("BSDB01-C05"), cost: 6 };
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: expensiveSource,
      })
    ).toBe(false);
  });

  it("アルドノアドライブが無ければ免疫は成立しない", () => {
    const src = createCardInstance(M01, {
      instanceId: "src-m01",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
    });
    const after = executeEffect({
      chainId: "test:bsaz02-m01-yourikujo:366",
      state,
      effect: M01.effects[1]!,
      effectIndex: 1,
      sourceInstanceId: "src-m01",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const target = after.cardInstances.find((c) => c.instanceId === "src-m01")!;
    const cheapSource: CardDefinition = { ...card("BSDB01-C05"), cost: 5 };
    expect(
      isCardImmuneToOpponentEffect(after, target, BOB, "none", {
        definition: cheapSource,
      })
    ).toBe(false);
  });
});

describe("BSAZ02-M01 effects[2]（Lv2: 系統「火星」アルティメットが1体の間、自分のライフは0にならない）", () => {
  it("DSL構造: field_has(category:ultimate, tribes:火星, min:1, max:1) + life_damage_interception(cause:any, floor:1)", () => {
    const effect3 = M01.effects[2]!;
    expect(effect3.stub).toBeUndefined();
    expect(effect3.applicability).toEqual({ level: { min: 2, max: 2 } });
    expect(effect3.condition).toEqual([
      {
        kind: "self_under_card_count",
        roleTag: "アルドノアドライブ",
        minCount: 1,
      },
      {
        kind: "field_has",
        player: "self",
        category: ["ultimate"],
        tribes: ["火星"],
        minCount: 1,
        maxCount: 1,
      },
    ]);
    const action = effect3.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.cause).toBe("any");
      expect(action.mode).toBe("floor");
      expect(action.floor).toBe(1);
      expect(action.duration).toEqual({ scope: "permanent" });
    }
  });

  function runEffect3(
    state: GameState,
    getCardDefinitionById = getDef
  ): GameState {
    return executeEffect({
      chainId: "test:bsaz02-m01-yourikujo:419",
      state: { ...state, step: "attack" },
      effect: M01.effects[2]!,
      effectIndex: 2,
      sourceInstanceId: "src-m01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
  }

  it("系統「火星」アルティメットがちょうど1体のとき、ライフは0にならず1でクランプされる", () => {
    const marsUltimate = makeMarsUltimate("TEST-M01-MARS-ULTIMATE");
    const getCardDefinitionById = (id: string): CardDefinition | undefined =>
      id === marsUltimate.cardNo ? marsUltimate : getDef(id);
    const src = srcM01(2); // Lv2
    let state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        src,
        underFiller(),
        createCardInstance(marsUltimate, {
          instanceId: "alice-mars-ultimate",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      playerOverrides: [{ lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 }],
    });
    state = runEffect3(state, getCardDefinitionById);
    const after = resolveLifeDamage(state, ALICE, 5, [], {
      cause: "battle",
      actingPlayerId: BOB,
    });
    expect(getPlayerLifeCoreCount(player(after, ALICE))).toBe(1);
  });

  it("系統「火星」アルティメットが0体/2体以上のときは floor が成立せずライフは0になる", () => {
    const marsUltimate = makeMarsUltimate("TEST-M01-MARS-ULTIMATE");
    const getCardDefinitionById = (id: string): CardDefinition | undefined =>
      id === marsUltimate.cardNo ? marsUltimate : getDef(id);
    const src = srcM01(2); // Lv2

    // 0体
    let stateZero = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, underFiller()],
      playerOverrides: [{ lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 }],
    });
    stateZero = runEffect3(stateZero, getCardDefinitionById);
    const afterZero = resolveLifeDamage(stateZero, ALICE, 5, [], {
      cause: "battle",
      actingPlayerId: BOB,
    });
    expect(getPlayerLifeCoreCount(player(afterZero, ALICE))).toBe(0);

    // 2体
    let stateTwo = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        src,
        underFiller(),
        createCardInstance(marsUltimate, {
          instanceId: "alice-mars-ultimate-1",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(marsUltimate, {
          instanceId: "alice-mars-ultimate-2",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      playerOverrides: [{ lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 }],
    });
    stateTwo = runEffect3(stateTwo, getCardDefinitionById);
    const afterTwo = resolveLifeDamage(stateTwo, ALICE, 5, [], {
      cause: "battle",
      actingPlayerId: BOB,
    });
    expect(getPlayerLifeCoreCount(player(afterTwo, ALICE))).toBe(0);
  });

  it("アルドノアドライブが無ければ火星アルティメット1体でも floor は成立しない", () => {
    const marsUltimate = makeMarsUltimate("TEST-M01-MARS-ULTIMATE");
    const getCardDefinitionById = (id: string): CardDefinition | undefined =>
      id === marsUltimate.cardNo ? marsUltimate : getDef(id);
    const src = createCardInstance(M01, {
      instanceId: "src-m01",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2, // Lv2 (no underCards → no アルドノアドライブ)
    });
    let state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        src,
        createCardInstance(marsUltimate, {
          instanceId: "alice-mars-ultimate",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      playerOverrides: [{ lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 }],
    });
    state = runEffect3(state, getCardDefinitionById);
    const after = resolveLifeDamage(state, ALICE, 5, [], {
      cause: "battle",
      actingPlayerId: BOB,
    });
    expect(getPlayerLifeCoreCount(player(after, ALICE))).toBe(0);
  });
});

describe("BSAZ02-M01 effects[3]（Lv2: 相手が系統「火星」アルティメットに指定アタックした、その相手のターン終了時にアルドノアドライブすべてを破棄）", () => {
  it("DSL構造: phase(step:end,whose:opponent) + attack_occurred(scope:turn,targetFilter,targetControllerLifeAtDeclaration) ゲート + move_card(hostFilter横断→trash)", () => {
    const effect4 = M01.effects[3]!;
    expect(effect4.stub).toBeUndefined();
    expect(effect4.timing).toEqual({
      kind: "phase",
      step: "end",
      whose: "opponent",
    });
    expect(effect4.applicability).toEqual({ level: { min: 2, max: 2 } });
    expect(effect4.condition).toEqual([
      {
        kind: "self_under_card_count",
        roleTag: "アルドノアドライブ",
        minCount: 1,
      },
      {
        kind: "attack_occurred",
        scope: "turn",
        player: "opponent",
        targetFilter: { category: ["ultimate"], tribes: ["火星"] },
        targetControllerLifeAtDeclaration: { min: 1, max: 1 },
      },
    ]);
    expect(effect4.steps[0]!.action).toEqual({
      kind: "move_card",
      from: {
        zone: "field",
        player: "self",
        hostFilter: { cardName: { contains: "揚陸城" } },
        hostUnderCardRoleTag: "アルドノアドライブ",
      },
      to: { zone: "trash" },
      count: -1,
    });
  });

  function runEffect4(
    state: GameState,
    getCardDefinitionById = getDef
  ): GameState {
    return flushPendingLeaves(
      executeEffect({
        chainId: "test:bsaz02-m01-yourikujo:579",
        state,
        effect: M01.effects[3]!,
        effectIndex: 3,
        sourceInstanceId: "src-m01",
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      }),
      getCardDefinitionById
    );
  }

  it("このターン相手が自分の系統「火星」アルティメットに指定アタックしていて、かつ自分のライフが1のとき、揚陸城下のアルドノアドライブを破棄する", () => {
    const marsUltimate = makeMarsUltimate("TEST-M01-MARS-ULTIMATE-4");
    const getCardDefinitionById = (id: string): CardDefinition | undefined =>
      id === marsUltimate.cardNo ? marsUltimate : getDef(id);
    const src = srcM01(2); // Lv2
    const target = createCardInstance(marsUltimate, {
      instanceId: "alice-mars-ultimate",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, underFiller(), target],
        playerOverrides: [{ lifeNormalCoreCount: 1 }, {}],
      }),
      attackDeclarationLog: [
        {
          playerId: BOB,
          cardInstanceId: "bob-attacker",
          cardDefinitionId: "FILLER-ATTACKER",
          turnNumber: 1,
          step: "attack",
          attackId: null,
          designatedTargetInstanceId: target.instanceId,
          designatedTargetDefinitionId: target.definitionId,
          designatedTargetControllerLifeAtDeclaration: 1,
        },
      ],
    };
    state = runEffect4(state, getCardDefinitionById);
    const underCard = state.cardInstances.find(
      (c) => c.instanceId === "under-drive"
    )!;
    expect(underCard.zone).toBe("trash");
    expect(underCard.attachedToInstanceId).toBeNull();
    const hostAfter = state.cardInstances.find(
      (c) => c.instanceId === "src-m01"
    )!;
    expect(hostAfter.underCards).toHaveLength(0);
  });

  it("ruling resolution A: 宣言時点でライフ1だった指定アタックが成立していれば、発火時点(相手ターン終了時)でライフが変化していても破棄される", () => {
    const marsUltimate = makeMarsUltimate("TEST-M01-MARS-ULTIMATE-4C");
    const getCardDefinitionById = (id: string): CardDefinition | undefined =>
      id === marsUltimate.cardNo ? marsUltimate : getDef(id);
    const src = srcM01(2); // Lv2
    const target = createCardInstance(marsUltimate, {
      instanceId: "alice-mars-ultimate-c",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, underFiller(), target],
        // 発火時点(現在)のライフは2 (宣言時点の1から変化済み)。
        playerOverrides: [{ lifeNormalCoreCount: 2 }, {}],
      }),
      attackDeclarationLog: [
        {
          playerId: BOB,
          cardInstanceId: "bob-attacker",
          cardDefinitionId: "FILLER-ATTACKER",
          turnNumber: 1,
          step: "attack",
          attackId: null,
          designatedTargetInstanceId: target.instanceId,
          designatedTargetDefinitionId: target.definitionId,
          // 宣言時点のスナップショットはライフ1。
          designatedTargetControllerLifeAtDeclaration: 1,
        },
      ],
    };
    state = runEffect4(state, getCardDefinitionById);
    const underCard = state.cardInstances.find(
      (c) => c.instanceId === "under-drive"
    )!;
    expect(underCard.zone).toBe("trash");
  });

  it("このターン指定アタックが無ければ condition unmet でアルドノアドライブは破棄されない", () => {
    const src = srcM01(2); // Lv2
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, underFiller()],
        playerOverrides: [{ lifeNormalCoreCount: 1 }, {}],
      }),
      attackDeclarationLog: [],
    };
    state = runEffect4(state);
    const underCard = state.cardInstances.find(
      (c) => c.instanceId === "under-drive"
    )!;
    expect(underCard.zone).toBe("field");
    expect(state.log.at(-1)).toBe("effect:condition-unmet:src-m01");
  });

  it("指定アタック宣言時点のライフが1でなければ (targetControllerLifeAtDeclaration 不一致) 破棄されない、発火時点の現在ライフが1でも判定は変わらない", () => {
    const marsUltimate = makeMarsUltimate("TEST-M01-MARS-ULTIMATE-4B");
    const getCardDefinitionById = (id: string): CardDefinition | undefined =>
      id === marsUltimate.cardNo ? marsUltimate : getDef(id);
    const src = srcM01(2); // Lv2
    const target = createCardInstance(marsUltimate, {
      instanceId: "alice-mars-ultimate-b",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, underFiller(), target],
        // 発火時点(現在)のライフは1だが、これは判定に使わない (宣言時点スナップショットのみ参照)。
        playerOverrides: [{ lifeNormalCoreCount: 1 }, {}],
      }),
      attackDeclarationLog: [
        {
          playerId: BOB,
          cardInstanceId: "bob-attacker",
          cardDefinitionId: "FILLER-ATTACKER",
          turnNumber: 1,
          step: "attack",
          attackId: null,
          designatedTargetInstanceId: target.instanceId,
          designatedTargetDefinitionId: target.definitionId,
          // 宣言時点のスナップショットは2 (1 ではない) → targetControllerLifeAtDeclaration
          // (min:1,max:1) 不一致で不成立。
          designatedTargetControllerLifeAtDeclaration: 2,
        },
      ],
    };
    state = runEffect4(state, getCardDefinitionById);
    const underCard = state.cardInstances.find(
      (c) => c.instanceId === "under-drive"
    )!;
    expect(underCard.zone).toBe("field");
    expect(state.log.at(-1)).toBe("effect:condition-unmet:src-m01");
  });

  it("指定アタックの対象が系統「火星」アルティメットでなければ targetFilter 不一致で破棄されない", () => {
    const otherSpirit = makeSpirit("TEST-M01-OTHER-SPIRIT-4");
    const getCardDefinitionById = (id: string): CardDefinition | undefined =>
      id === otherSpirit.cardNo ? otherSpirit : getDef(id);
    const src = srcM01(2); // Lv2
    const target = createCardInstance(otherSpirit, {
      instanceId: "alice-other-spirit",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src, underFiller(), target],
        playerOverrides: [{ lifeNormalCoreCount: 1 }, {}],
      }),
      attackDeclarationLog: [
        {
          playerId: BOB,
          cardInstanceId: "bob-attacker",
          cardDefinitionId: "FILLER-ATTACKER",
          turnNumber: 1,
          step: "attack",
          attackId: null,
          designatedTargetInstanceId: target.instanceId,
          designatedTargetDefinitionId: target.definitionId,
          designatedTargetControllerLifeAtDeclaration: 1,
        },
      ],
    };
    state = runEffect4(state, getCardDefinitionById);
    const underCard = state.cardInstances.find(
      (c) => c.instanceId === "under-drive"
    )!;
    expect(underCard.zone).toBe("field");
  });
});
