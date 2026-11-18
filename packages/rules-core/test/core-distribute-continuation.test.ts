/**
 * P3-47 Phase 2-2: core_distribute mode="player_choice" の continuation テスト。
 *
 * Phase 2-1 の単独 step 解決に加え、後続ステップを再実行する
 * `CoreDistributionContinuation` 機構と、フランドール【フォーオブアカインド】
 * effects[1] の end-to-end 動作を検証する。
 *
 * ケース:
 * 1. 単独 core_distribute step (Phase 2-1) では continuation が attach されない (regression)
 * 2. core_distribute + 後続 step では continuation が attach され、resolve 後に後続が実行される
 * 3. resolve 前は後続 step (= 後続 register_act_as_spirit 等) が走らない
 * 4. フランドール effects[1] end-to-end:
 *    - デッキ上 3 枚が裏向きで自分フィールドに置かれる
 *    - core_distribute pending が立つ
 *    - resolve 後、各 token に act_as_spirit CE + redirect_effect_target CE 登録
 * 5. デッキ < 3 枚なら effect.condition で発動不可 (executeEffect 早期 return)
 */
import { describe, it, expect } from "vitest";
import { BSTH01_CARDS } from "../../card-data/src/cards/BSTH01";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  GameState,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "player-1";
const BOB = "player-2";

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "Test",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "紅魔",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

function makeInstance(
  def: CardDefinition,
  overrides: Partial<CardInstance> = {}
): CardInstance {
  const base = createCardInstance(def, {
    ownerPlayerId: ALICE,
    zone: "field",
    cores: 0,
  });
  return { ...base, ...overrides };
}

function makeState(
  cards: CardInstance[],
  aliceReserve = 0,
  aliceDeckCount = 40
): GameState {
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: cards,
    startingLife: 5,
  });
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === ALICE
        ? {
            ...p,
            reserveNormalCoreCount: aliceReserve,
            deckCount: aliceDeckCount,
          }
        : p
    ),
  };
}

const defRegistry = new Map<string, CardDefinition>();
function getDef(id: string): CardDefinition | undefined {
  return defRegistry.get(id);
}
function registerDef(def: CardDefinition): void {
  defRegistry.set(def.cardNo, def);
}

function additionalCostDeltaCE(
  sourceInstanceId: string,
  actingPlayerId: string,
  amount: number,
  filter: NonNullable<ContinuousEffect["targetFilter"]>
): ContinuousEffect {
  return {
    effectId: `ce-additional-cost-${sourceInstanceId}`,
    sourceInstanceId,
    sourceDefinitionId: "ENGINE-COST-TAX",
    actingPlayerId,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "additional_cost",
    modifierAmount: amount,
    targetFilter: filter,
  };
}

describe("P3-47 Phase 2-2: core_distribute continuation", () => {
  it("単独 core_distribute step (Phase 2-1) では continuation が attach されない", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = makeState([host, t1], 3);
    const effect: Effect = {
      timing: { kind: "phase", step: "main", subPhase: "start" },
      steps: [
        {
          action: {
            kind: "core_distribute",
            from: { kind: "reserve", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { tribes: ["token"] },
              count: "all",
            },
            amount: "all",
            mode: "player_choice",
            minTotal: 1,
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:core-distribute-continuation:149",
      state,
      effect,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).not.toBeNull();
    expect(result.pendingCoreDistribution?.continuation).toBeUndefined();
  });

  it("core_distribute + 後続 step では continuation が attach される", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST_MULTI" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    // 2 ステップ effect を host の effects[0] として登録 (continuation で再 lookup)
    const stepEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "distribute",
          action: {
            kind: "core_distribute",
            from: { kind: "reserve", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { tribes: ["token"] },
              count: "all",
            },
            amount: "all",
            mode: "player_choice",
            minTotal: 1,
          },
        },
        {
          id: "log_step",
          action: {
            kind: "draw",
            count: 1,
          },
        },
      ],
    };
    hostDef.effects = [stepEffect];

    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const t2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const state = makeState([host, t1, t2], 3);

    const result = executeEffect({
      chainId: "test:core-distribute-continuation:203",
      state,
      effect: stepEffect,
      effectIndex: 0,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution).not.toBeNull();
    const pending = result.pendingCoreDistribution!;
    expect(pending.continuation).toBeDefined();
    expect(pending.continuation?.sourceDefinitionId).toBe("HOST_MULTI");
    expect(pending.continuation?.effectIndex).toBe(0);
    expect(pending.continuation?.resumeStepIndex).toBe(1); // 次ステップ
    expect(pending.continuation?.sourceInstanceId).toBe("host");
    // この時点では後続 draw 未実行: handCount が初期化値のまま
    const aliceBeforeBase = state.players.find((p) => p.id === ALICE)!;
    const aliceBefore = result.players.find((p) => p.id === ALICE)!;
    expect(aliceBefore.handCount).toBe(aliceBeforeBase.handCount);
  });

  it("resolve 後、後続 step が再実行される (draw が走る)", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST_MULTI2" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const stepEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "distribute",
          action: {
            kind: "core_distribute",
            from: { kind: "reserve", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { tribes: ["token"] },
              count: "all",
            },
            amount: "all",
            mode: "player_choice",
            minTotal: 1,
          },
        },
        {
          id: "log_step",
          action: {
            kind: "draw",
            count: 1,
          },
        },
      ],
    };
    hostDef.effects = [stepEffect];

    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = makeState([host, t1], 3, 5);

    const result = executeEffect({
      chainId: "test:core-distribute-continuation:265",
      state,
      effect: stepEffect,
      effectIndex: 0,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const actions = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      coreDistributionAllocations: { tok1: 1 },
    });

    expect(applied.state.pendingCoreDistribution).toBeNull();
    const tok1After = applied.state.cardInstances.find(
      (c) => c.instanceId === "tok1"
    )!;
    expect(tok1After.normalCoreCount).toBe(1);
    // 後続 draw が実行された (handCount +1, deckCount -1)
    const aliceBefore = state.players.find((p) => p.id === ALICE)!;
    const aliceAfter = applied.state.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.handCount).toBe(aliceBefore.handCount + 1);
    expect(aliceAfter.deckCount).toBe(aliceBefore.deckCount - 1);
  });

  it("core_distribute resume preserves burst effectActionKind for following from_zone on_step summon", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST_BURST_CORE_DISTRIBUTE" });
    const holderDef = makeDef({ cardNo: "CORE_HOLDER", tribe: "token" });
    const taxedSpiritDef = makeDef({
      cardNo: "ON_STEP_TAXED_SPIRIT",
      cost: 0,
      printedCategory: "spirit",
    });
    const untaxedUltimateDef = makeDef({
      cardNo: "ON_STEP_UNTAXED_ULTIMATE",
      cost: 0,
      printedCategory: "ultimate",
    });
    for (const def of [
      hostDef,
      holderDef,
      taxedSpiritDef,
      untaxedUltimateDef,
    ]) {
      registerDef(def);
    }
    const stepEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "distribute",
          action: {
            kind: "core_distribute",
            from: { kind: "reserve", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { tribes: ["token"] },
              count: "all",
            },
            amount: "all",
            mode: "player_choice",
            minTotal: 1,
          },
        },
        {
          id: "on-step-summon-after-distribute",
          targetSelectionTiming: "on_step",
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: "trash",
              filter: { category: ["spirit", "ultimate"] },
              count: { min: 0, max: 2 },
            },
          },
        },
      ],
    };
    hostDef.effects = [stepEffect];

    const state: GameState = {
      ...makeState(
        [
          makeInstance(hostDef, { instanceId: "host" }),
          makeInstance(holderDef, { instanceId: "holder" }),
          makeInstance(taxedSpiritDef, {
            instanceId: "taxed-spirit",
            definitionId: taxedSpiritDef.cardNo,
            zone: "trash",
          }),
          makeInstance(untaxedUltimateDef, {
            instanceId: "untaxed-ultimate",
            definitionId: untaxedUltimateDef.cardNo,
            zone: "trash",
          }),
        ],
        3
      ),
      activeContinuousEffects: [
        additionalCostDeltaCE("bob-tax", BOB, 3, {
          player: "opponent",
          category: ["spirit"],
          summonCause: ["effect"],
        }),
      ],
    };

    const result = executeEffect({
      chainId: "test:core-distribute-continuation:388",
      state,
      effect: stepEffect,
      effectIndex: 0,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      effectActionKind: "burst_activation",
    });
    expect(result.pendingCoreDistribution).not.toBeNull();
    expect(result.pendingCoreDistribution!.continuation?.effectActionKind).toBe(
      "burst_activation"
    );

    const actions = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;
    const afterDistribution = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      coreDistributionAllocations: { holder: 1 },
    }).state;

    expect(afterDistribution.pendingCoreDistribution).toBeNull();
    expect(
      afterDistribution.pendingStepOptionalTargetSelection?.candidateInstanceIds
    ).toEqual(["taxed-spirit", "untaxed-ultimate"]);
  });

  it("continuation 解決時、後続 step が前 step の affectedCardInstanceIds を ref で参照できる", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST_REF" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    // step1 = core_distribute (id="distribute"), step2 = bp_modify ref distribute
    const stepEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "distribute",
          action: {
            kind: "core_distribute",
            from: { kind: "reserve", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { tribes: ["token"] },
              count: "all",
            },
            amount: "all",
            mode: "player_choice",
            minTotal: 1,
          },
        },
        {
          id: "log_after",
          action: {
            kind: "draw",
            count: 1,
          },
        },
      ],
    };
    hostDef.effects = [stepEffect];

    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const t2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const state = makeState([host, t1, t2], 3, 5);

    const result = executeEffect({
      chainId: "test:core-distribute-continuation:467",
      state,
      effect: stepEffect,
      effectIndex: 0,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    expect(result.pendingCoreDistribution!.continuation).toBeDefined();
    // stepContext は前 step (distribute) の affected を保持 (ref 参照可能性)
    const stepContextSerialized =
      result.pendingCoreDistribution!.continuation!.stepContext;
    const distributeResult = stepContextSerialized.results["distribute"];
    expect(distributeResult).toBeDefined();
    expect(distributeResult!.succeeded).toBe(true);
    // affected = pending の candidate (tok1, tok2)
    expect([...distributeResult!.affectedCardInstanceIds].sort()).toEqual([
      "tok1",
      "tok2",
    ]);
  });

  // ENGINE-core-distribute-actual-placement-count (BSDB01-C08「1個以上置いたとき」型):
  // player_choice 配分は解決時まで実配置数が確定しないため、construction 時点では
  // distribute step 自身の StepResult を記録できない。resume 直前に注入した StepResult を
  // 後続 step の ref_count が正しく参照できることを固定する。
  it("実配置数 0 のとき ref_count(min:1) gated 後続 step は実行されない", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST_GATE_ZERO" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const stepEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "distribute",
          action: {
            kind: "core_distribute",
            from: { kind: "reserve", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { tribes: ["token"] },
              count: "all",
            },
            amount: "all",
            mode: "player_choice",
            minTotal: 0,
          },
        },
        {
          id: "gated_draw",
          stepCondition: { kind: "ref_count", stepId: "distribute", min: 1 },
          action: { kind: "draw", count: 1 },
        },
      ],
    };
    hostDef.effects = [stepEffect];

    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = makeState([host, t1], 3, 5);

    const result = executeEffect({
      chainId: "test:core-distribute-continuation:532",
      state,
      effect: stepEffect,
      effectIndex: 0,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const actions = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      coreDistributionAllocations: {},
    });

    expect(applied.state.pendingCoreDistribution).toBeNull();
    const aliceBefore = state.players.find((p) => p.id === ALICE)!;
    const aliceAfter = applied.state.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.handCount).toBe(aliceBefore.handCount);
    expect(aliceAfter.deckCount).toBe(aliceBefore.deckCount);
  });

  it("実配置数 1 以上のとき ref_count(min:1) gated 後続 step が実行される", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST_GATE_ONE" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const stepEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "distribute",
          action: {
            kind: "core_distribute",
            from: { kind: "reserve", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { tribes: ["token"] },
              count: "all",
            },
            amount: "all",
            mode: "player_choice",
            minTotal: 0,
          },
        },
        {
          id: "gated_draw",
          stepCondition: { kind: "ref_count", stepId: "distribute", min: 1 },
          action: { kind: "draw", count: 1 },
        },
      ],
    };
    hostDef.effects = [stepEffect];

    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = makeState([host, t1], 3, 5);

    const result = executeEffect({
      chainId: "test:core-distribute-continuation:603",
      state,
      effect: stepEffect,
      effectIndex: 0,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const actions = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      coreDistributionAllocations: { tok1: 1 },
    });

    expect(applied.state.pendingCoreDistribution).toBeNull();
    const aliceBefore = state.players.find((p) => p.id === ALICE)!;
    const aliceAfter = applied.state.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.handCount).toBe(aliceBefore.handCount + 1);
    expect(aliceAfter.deckCount).toBe(aliceBefore.deckCount - 1);
  });

  it("ref_count(result:'numeric_amount') は同一カードへの複数コア配置数を参照する", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST_GATE_NUMERIC" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const stepEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "distribute",
          action: {
            kind: "core_distribute",
            from: { kind: "reserve", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { tribes: ["token"] },
              count: "all",
            },
            amount: "all",
            mode: "player_choice",
            minTotal: 0,
          },
        },
        {
          id: "gated_draw",
          stepCondition: {
            kind: "ref_count",
            stepId: "distribute",
            result: "numeric_amount",
            min: 2,
          },
          action: { kind: "draw", count: 1 },
        },
      ],
    };
    hostDef.effects = [stepEffect];

    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const state = makeState([host, t1], 3, 5);

    const result = executeEffect({
      chainId: "test:core-distribute-continuation:679",
      state,
      effect: stepEffect,
      effectIndex: 0,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const cdAction = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;

    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      coreDistributionAllocations: { tok1: 2 },
    });

    const aliceBefore = state.players.find((p) => p.id === ALICE)!;
    const aliceAfter = applied.state.players.find((p) => p.id === ALICE)!;
    expect(aliceAfter.handCount).toBe(aliceBefore.handCount + 1);
    expect(aliceAfter.deckCount).toBe(aliceBefore.deckCount - 1);
  });

  // 候補 (= 配分対象カード) は 2 枚あるが実際に配分したのは 1 枚だけの場合、
  // ref_count(min:2) は「候補数」ではなく「実際に配分を受けたカード数」で判定する必要がある。
  // pending 構築時点の recordStepResult (effect-interpreter.ts newCoreDistributionPending) は
  // affectedCardInstanceIds=候補全件・succeeded=true を無条件記録するため、この構築時点の
  // StepResult だけでは「候補2枚」と「実配置1枚」を区別できない。resume 直前に注入する
  // 実配置ベースの StepResult が上書きすることで初めて正しく判定できる
  // (これを欠くと min:2 gate が候補数2で誤って満たされ、後続 step が誤発火する)。
  it("候補2枚のうち1枚にのみ配置したとき ref_count(min:2) gated 後続 step は実行されない", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST_GATE_PARTIAL" });
    const tokenDef = makeDef({ cardNo: "TOK", tribe: "token" });
    registerDef(hostDef);
    registerDef(tokenDef);
    const stepEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "distribute",
          action: {
            kind: "core_distribute",
            from: { kind: "reserve", player: "self" },
            to: {
              kind: "filter",
              player: "self",
              filter: { tribes: ["token"] },
              count: "all",
            },
            amount: "all",
            mode: "player_choice",
            minTotal: 0,
          },
        },
        {
          id: "gated_draw",
          stepCondition: { kind: "ref_count", stepId: "distribute", min: 2 },
          action: { kind: "draw", count: 1 },
        },
      ],
    };
    hostDef.effects = [stepEffect];

    const host = makeInstance(hostDef, { instanceId: "host" });
    const t1 = makeInstance(tokenDef, { instanceId: "tok1" });
    const t2 = makeInstance(tokenDef, { instanceId: "tok2" });
    const state = makeState([host, t1, t2], 3, 5);

    const result = executeEffect({
      chainId: "test:core-distribute-continuation:753",
      state,
      effect: stepEffect,
      effectIndex: 0,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    // pending 構築時点では候補2枚 (tok1, tok2) を保持する
    expect(result.pendingCoreDistribution!.candidates).toHaveLength(2);

    const actions = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    // tok1 にのみ 1 個配分 (tok2 には配分しない) = 実配置数 1
    const applied = applyLegalAction({
      state: result,
      action: cdAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      coreDistributionAllocations: { tok1: 1 },
    });

    expect(applied.state.pendingCoreDistribution).toBeNull();
    const aliceBefore = state.players.find((p) => p.id === ALICE)!;
    const aliceAfter = applied.state.players.find((p) => p.id === ALICE)!;
    // 実配置数 1 < min:2 のため gated_draw は実行されない
    expect(aliceAfter.handCount).toBe(aliceBefore.handCount);
    expect(aliceAfter.deckCount).toBe(aliceBefore.deckCount);
  });
});

describe("P3-47 Phase 2-2: フランドール【フォーオブアカインド】 effects[1] end-to-end", () => {
  const FRANDOLLE_CARD = BSTH01_CARDS.find((c) => c.cardNo === "BSTH01-X04")!;
  const fillerDef = makeDef({ cardNo: "FILLER", name: "Filler" });

  function makeFrandolleScene(opts: {
    deckCardCount: number;
    hostCores: number;
    aliceReserveCores: number;
  }): {
    state: GameState;
    getCardDef: (id: string) => CardDefinition | undefined;
  } {
    defRegistry.clear();
    registerDef(FRANDOLLE_CARD);
    registerDef(fillerDef);

    const host = createCardInstance(FRANDOLLE_CARD, {
      ownerPlayerId: ALICE,
      zone: "field",
      cores: opts.hostCores,
    });
    const deckCards: CardInstance[] = [];
    for (let i = 0; i < opts.deckCardCount; i++) {
      deckCards.push(
        createCardInstance(fillerDef, {
          ownerPlayerId: ALICE,
          zone: "deck",
          cores: 0,
        })
      );
    }
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [host, ...deckCards],
      startingLife: 5,
    });
    const state: GameState = {
      ...baseState,
      activePlayerId: ALICE,
      players: baseState.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              reserveNormalCoreCount: opts.aliceReserveCores,
              deckCount: opts.deckCardCount,
            }
          : p
      ),
    };
    return {
      state,
      getCardDef: getDef,
    };
  }

  it("発動成功: デッキ上 3 枚が face-down で field に置かれ、core_distribute pending が立つ", () => {
    const { state, getCardDef } = makeFrandolleScene({
      deckCardCount: 5,
      hostCores: 3, // Lv2
      aliceReserveCores: 2,
    });
    const host = state.cardInstances.find(
      (c) => c.definitionId === "BSTH01-X04"
    )!;

    const result = executeEffect({
      chainId: "test:core-distribute-continuation:856",
      state,
      effect: FRANDOLLE_CARD.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });

    // 3 枚が field 裏向きに移動
    const aliceFieldFaceDown = result.cardInstances.filter(
      (c) =>
        c.ownerPlayerId === ALICE && c.zone === "field" && c.faceDown === true
    );
    expect(aliceFieldFaceDown).toHaveLength(3);
    // デッキは 5-3=2 枚
    const alice = result.players.find((p) => p.id === ALICE)!;
    expect(alice.deckCount).toBe(2);
    // pending core distribution が立つ
    expect(result.pendingCoreDistribution).not.toBeNull();
    const pending = result.pendingCoreDistribution!;
    // P3-47 F-5: フランドール step2 が any_movable_self に切り替わったため、
    // fromKind は "any_movable" になり allowedSources / sourceAvailable が付く。
    expect(pending.fromKind).toBe("any_movable");
    expect(pending.allowedSources).toBeDefined();
    expect(pending.minTotal).toBe(1);
    expect(pending.candidates).toHaveLength(3);
    expect(pending.continuation).toBeDefined();
    expect(pending.continuation?.resumeStepIndex).toBe(2); // step3 (register_act_as_spirit)
    expect(pending.continuation?.sourceDefinitionId).toBe("BSTH01-X04");
  });

  it("resolve 後、各 token に act_as_spirit + 本体に redirect_effect_target CE が登録される", () => {
    const { state, getCardDef } = makeFrandolleScene({
      deckCardCount: 5,
      hostCores: 3, // Lv2
      aliceReserveCores: 3,
    });
    const host = state.cardInstances.find(
      (c) => c.definitionId === "BSTH01-X04"
    )!;

    const afterEffect = executeEffect({
      chainId: "test:core-distribute-continuation:898",
      state,
      effect: FRANDOLLE_CARD.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    const pending = afterEffect.pendingCoreDistribution!;
    // 1 個ずつ各 token に分配
    const allocations: Record<string, number> = {};
    for (const c of pending.candidates) {
      allocations[c.instanceId] = 1;
    }

    const actions = getLegalActions({
      state: afterEffect,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    // P3-47 F-5: any_movable_self の sourceAllocations を渡す (reserve から 3 個)
    const applied = applyLegalAction({
      state: afterEffect,
      action: cdAction,
      getCardDefinitionById: getCardDef,
      getRegisteredTriggeredEffectActions: () => [],
      coreDistributionAllocations: allocations,
      coreDistributionSourceAllocations: { reserve: pending.candidates.length },
    });

    // pending クリア
    expect(applied.state.pendingCoreDistribution).toBeNull();
    // 各 token に 1 コア
    for (const c of pending.candidates) {
      const tok = applied.state.cardInstances.find(
        (ci) => ci.instanceId === c.instanceId
      )!;
      expect(tok.normalCoreCount).toBe(1);
    }
    // act_as_spirit CE が 3 件 (host=フランドール, target=各 token)
    const actAsSpiritCEs = applied.state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "act_as_spirit"
    );
    expect(actAsSpiritCEs).toHaveLength(3);
    for (const ce of actAsSpiritCEs) {
      expect(ce.sourceInstanceId).toBe(host.instanceId);
      expect(ce.duration).toEqual({ scope: "while_on_field" });
    }
    // redirect_effect_target CE が 1 件 (host=フランドール)
    const redirectCEs = applied.state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "redirect_effect_target"
    );
    expect(redirectCEs).toHaveLength(1);
    expect(redirectCEs[0]!.sourceInstanceId).toBe(host.instanceId);
  });

  it("P3-47 F-6: コアを置かれなかった 0 コア分身はコア不足消滅する (continuation finalization 回帰)", () => {
    // 旧バグ: applyPendingCoreDistributionAction の continuation resume が executeEffect 後に
    // finalization (SBA / pending-leave flush) を通さず即 return していたため、step3 で
    // act_as_spirit CE が付いた 0 コア分身がコア不足消滅せず field に残っていた。
    const { state, getCardDef } = makeFrandolleScene({
      deckCardCount: 5,
      hostCores: 3, // Lv2
      aliceReserveCores: 3,
    });
    const host = state.cardInstances.find(
      (c) => c.definitionId === "BSTH01-X04"
    )!;

    const afterEffect = executeEffect({
      chainId: "test:core-distribute-continuation:971",
      state,
      effect: FRANDOLLE_CARD.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    const pending = afterEffect.pendingCoreDistribution!;
    expect(pending.candidates).toHaveLength(3);

    // 3 分身のうち先頭 2 枚にだけ 1 コアずつ置き、3 枚目は 0 コアのまま完了する。
    const zeroCoreTokenId = pending.candidates[2]!.instanceId;
    const allocations: Record<string, number> = {
      [pending.candidates[0]!.instanceId]: 1,
      [pending.candidates[1]!.instanceId]: 1,
    };

    const actions = getLegalActions({
      state: afterEffect,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;

    const applied = applyLegalAction({
      state: afterEffect,
      action: cdAction,
      getCardDefinitionById: getCardDef,
      getRegisteredTriggeredEffectActions: () => [],
      coreDistributionAllocations: allocations,
      coreDistributionSourceAllocations: { reserve: 2 },
    });

    expect(applied.state.pendingCoreDistribution).toBeNull();
    // 0 コア分身はコア不足消滅し、フィールドを離れてトラッシュへ移動している。
    const zeroToken = applied.state.cardInstances.find(
      (c) => c.instanceId === zeroCoreTokenId
    )!;
    expect(zeroToken.zone).toBe("trash");
    expect(zeroToken.pendingLeaveKind).toBeNull();
    // フィールドを離れた裏向き分身は表向きに戻る (通常カード化)。
    expect(zeroToken.faceDown).toBe(false);

    // コアを置かれた 2 枚は分身として field に残存する。
    for (const id of [
      pending.candidates[0]!.instanceId,
      pending.candidates[1]!.instanceId,
    ]) {
      const tok = applied.state.cardInstances.find((c) => c.instanceId === id)!;
      expect(tok.zone).toBe("field");
      expect(tok.normalCoreCount).toBe(1);
    }
  });

  it("デッキ < 3 枚なら effect.condition で発動不可 (executeEffect 早期 return)", () => {
    const { state, getCardDef } = makeFrandolleScene({
      deckCardCount: 2,
      hostCores: 3,
      aliceReserveCores: 2,
    });
    const host = state.cardInstances.find(
      (c) => c.definitionId === "BSTH01-X04"
    )!;

    const result = executeEffect({
      chainId: "test:core-distribute-continuation:1038",
      state,
      effect: FRANDOLLE_CARD.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });

    // 効果発動せず: pending 立たず、face-down も置かれず
    expect(result.pendingCoreDistribution).toBeNull();
    const faceDownCount = result.cardInstances.filter(
      (c) => c.zone === "field" && c.faceDown
    ).length;
    expect(faceDownCount).toBe(0);
    expect(result.log.some((l) => l.includes("condition-unmet"))).toBe(true);
  });
});
