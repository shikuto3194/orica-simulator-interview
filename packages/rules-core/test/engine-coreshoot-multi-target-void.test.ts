/**
 * 複数対象コアシュート: `core_move.target` の count>1「Nつまで」型で複数体を選び、
 * `from: { kind: "target_card" }` で複数対象を選んだとき、選んだ各対象カードの
 * コアをそれぞれ個別に動かす (単一対象前提の resolvedTargetIds[0] 固定を一般化)。
 *
 * cluster: engine-coreshoot-multi-target-void (autorun-queue/cluster-registry.json)。
 * BSRK01-R02『相手の創界神ネクサス2つまで…ネクサス2つのコアすべてをボイドに置く』の
 * うちコアシュート multi-target 化のみを検証する (turn_player/preventionLevel/destroy
 * count は本テストの範囲外、別途 card-data 作業)。
 *
 * 既存単一対象呼び出し (BSSL01-C05 等) への非破壊は single-target-coreshoot.test.ts で
 * 別途カバーされる。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/index";
import type {
  CardDefinition,
  GameState,
  RecordedEffectUsage,
} from "../src/model";
import type { Effect } from "../src/dsl-types";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";

const ALICE = "alice";
const BOB = "bob";

const SOURCE_DEF: CardDefinition = {
  cardNo: "TEST-SRC",
  name: "テスト源",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const TARGET_DEF: CardDefinition = {
  cardNo: "TEST-TGT",
  name: "テスト対象",
  printedCategory: "nexus",
  colors: ["white"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
  symbolColors: ["white"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

/** 相手ネクサス2つまでを選び、選んだ各対象のコアすべてをボイドに置く。 */
function multiTargetCoreshootAllToVoid(): Effect {
  return {
    timing: { kind: "card_event", event: "attack" },
    steps: [
      {
        action: {
          kind: "core_move",
          target: {
            kind: "filter",
            player: "opponent",
            filter: { category: ["nexus"] },
            count: { min: 0, max: 2 },
          },
          from: { kind: "target_card" },
          to: { kind: "void", player: "opponent" },
          amount: "all",
        },
      },
    ],
  };
}

function stateWith(): GameState {
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [
      createCardInstance(SOURCE_DEF, {
        instanceId: "alice-src",
        ownerPlayerId: ALICE,
        zone: "field",
        cores: 1,
      }),
      createCardInstance(TARGET_DEF, {
        instanceId: "bob-tgt-1",
        ownerPlayerId: BOB,
        zone: "field",
        cores: 2,
      }),
      createCardInstance(TARGET_DEF, {
        instanceId: "bob-tgt-2",
        ownerPlayerId: BOB,
        zone: "field",
        cores: 3,
      }),
      // 対象外 (フィルタ非一致想定外だが選択されない3体目) の非破壊確認用。
      createCardInstance(TARGET_DEF, {
        instanceId: "bob-tgt-3",
        ownerPlayerId: BOB,
        zone: "field",
        cores: 4,
      }),
    ],
    playerOverrides: [
      {},
      { reserveNormalCoreCount: 0, voidNormalCoreCount: 0 },
    ],
  });
}

function run(targetInstanceIds: string[]): GameState {
  return executeEffect({
    chainId: "test:engine-coreshoot-multi-target-void:122",
    state: stateWith(),
    effect: multiTargetCoreshootAllToVoid(),
    sourceInstanceId: "alice-src",
    actingPlayerId: ALICE,
    getCardDefinitionById: (id) =>
      id === SOURCE_DEF.cardNo
        ? SOURCE_DEF
        : id === TARGET_DEF.cardNo
          ? TARGET_DEF
          : undefined,
    targetInstanceIds,
  });
}

describe("複数対象コアシュート (core_move.target count>1 + from: target_card + amount: all)", () => {
  it("選んだ2体それぞれのコアが全てボイドへ移り、選ばれなかった3体目は不変", () => {
    const after = run(["bob-tgt-1", "bob-tgt-2"]);
    const tgt1 = after.cardInstances.find((c) => c.instanceId === "bob-tgt-1")!;
    const tgt2 = after.cardInstances.find((c) => c.instanceId === "bob-tgt-2")!;
    const tgt3 = after.cardInstances.find((c) => c.instanceId === "bob-tgt-3")!;
    expect(tgt1.normalCoreCount).toBe(0);
    expect(tgt2.normalCoreCount).toBe(0);
    expect(tgt3.normalCoreCount).toBe(4);
    const bobPlayer = after.players.find((p) => p.id === BOB)!;
    expect(bobPlayer.voidNormalCoreCount).toBe(2 + 3);
  });

  it("1体だけ選んだとき (resolvedTargetIds.length===1) は従来の単一対象経路のまま", () => {
    const after = run(["bob-tgt-1"]);
    const tgt1 = after.cardInstances.find((c) => c.instanceId === "bob-tgt-1")!;
    const tgt2 = after.cardInstances.find((c) => c.instanceId === "bob-tgt-2")!;
    expect(tgt1.normalCoreCount).toBe(0);
    expect(tgt2.normalCoreCount).toBe(3);
    const bobPlayer = after.players.find((p) => p.id === BOB)!;
    expect(bobPlayer.voidNormalCoreCount).toBe(2);
  });

  it("固定数 amount:1 でも選んだ各対象から1個ずつ動かす", () => {
    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "core_move",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["nexus"] },
              count: { min: 0, max: 2 },
            },
            from: { kind: "target_card" },
            to: { kind: "reserve", player: "opponent" },
            amount: 1,
          },
        },
      ],
    };
    const after = executeEffect({
      chainId: "test:engine-coreshoot-multi-target-void:180",
      state: stateWith(),
      effect,
      sourceInstanceId: "alice-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === SOURCE_DEF.cardNo
          ? SOURCE_DEF
          : id === TARGET_DEF.cardNo
            ? TARGET_DEF
            : undefined,
      targetInstanceIds: ["bob-tgt-1", "bob-tgt-2"],
    });

    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-tgt-1")!
        .normalCoreCount
    ).toBe(1);
    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-tgt-2")!
        .normalCoreCount
    ).toBe(2);
    expect(
      after.cardInstances.find((c) => c.instanceId === "bob-tgt-3")!
        .normalCoreCount
    ).toBe(4);
    expect(
      after.players.find((p) => p.id === BOB)!.reserveNormalCoreCount
    ).toBe(2);
  });

  it("固定数 amount:1 の途中で pendingLifeCoreSelection が出ても、resume は選択済み残り対象だけ処理する", () => {
    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "core_move",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["nexus"] },
              count: { min: 0, max: 2 },
            },
            from: { kind: "target_card" },
            to: { kind: "reserve", player: "opponent" },
            amount: 1,
          },
        },
      ],
    };
    const definitionEffect = multiTargetCoreshootAllToVoid();
    const sourceDefWithEffect: CardDefinition = {
      ...SOURCE_DEF,
      effects: [definitionEffect],
    };
    const recordedUsage: RecordedEffectUsage = {
      sourceInstanceId: "alice-src",
      effectLabel: "effect:0",
      usageLimit: { kind: "per_instance", duration: "turn" },
    };
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(sourceDefWithEffect, {
          instanceId: "alice-src",
          ownerPlayerId: ALICE,
          zone: "field",
          cores: 1,
        }),
        createCardInstance(TARGET_DEF, {
          instanceId: "bob-tgt-1",
          ownerPlayerId: BOB,
          zone: "field",
          cores: 1,
        }),
        createCardInstance(TARGET_DEF, {
          instanceId: "bob-tgt-2",
          ownerPlayerId: BOB,
          zone: "field",
          cores: 3,
        }),
        createCardInstance(TARGET_DEF, {
          instanceId: "bob-tgt-3",
          ownerPlayerId: BOB,
          zone: "field",
          cores: 4,
        }),
      ],
      playerOverrides: [
        {},
        {
          reserveNormalCoreCount: 0,
          reserveSoulCoreCount: 0,
          soulCoreLocation: { kind: "card", instanceId: "bob-tgt-1" },
        },
      ],
    });
    let current = executeEffect({
      chainId: "test:engine-coreshoot-multi-target-void:278",
      state,
      effect,
      sourceInstanceId: "alice-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === SOURCE_DEF.cardNo
          ? sourceDefWithEffect
          : id === TARGET_DEF.cardNo
            ? TARGET_DEF
            : undefined,
      targetInstanceIds: ["bob-tgt-1", "bob-tgt-2"],
      effectIndex: 0,
      divineSkillIndex: 0,
      recordedUsage,
      rangeAutoResolveStrategy: "max",
    });

    expect(current.pendingLifeCoreSelection?.continuation).toMatchObject({
      divineSkillIndex: 0,
      recordedUsage,
      rangeAutoResolveStrategy: "max",
      targetInstanceIds: ["bob-tgt-2"],
      targetStepId: "__step_0",
      targetSelectionResolved: true,
    });
    expect(
      current.pendingLifeCoreSelection?.continuation?.resumeEffectOverride
    ).toBe(effect);

    const action = getLegalActions({
      state: current,
      actingPlayerId: BOB,
      getCardDefinitionById: (id) =>
        id === SOURCE_DEF.cardNo
          ? sourceDefWithEffect
          : id === TARGET_DEF.cardNo
            ? TARGET_DEF
            : undefined,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_life_core_selection"
    );
    expect(action).toBeDefined();

    current = applyLegalAction({
      state: current,
      action: action!,
      getCardDefinitionById: (id) =>
        id === SOURCE_DEF.cardNo
          ? sourceDefWithEffect
          : id === TARGET_DEF.cardNo
            ? TARGET_DEF
            : undefined,
      lifeCorePartitionChoice: { normalChosen: 0, soulChosen: 1 },
    }).state;

    expect(current.pendingLifeCoreSelection).toBeNull();
    expect(
      current.cardInstances.find((c) => c.instanceId === "bob-tgt-1")!
        .normalCoreCount
    ).toBe(1);
    expect(
      current.cardInstances.find((c) => c.instanceId === "bob-tgt-2")!
        .normalCoreCount
    ).toBe(2);
    expect(
      current.cardInstances.find((c) => c.instanceId === "bob-tgt-3")!
        .normalCoreCount
    ).toBe(4);
    const bobPlayer = current.players.find((p) => p.id === BOB)!;
    expect(bobPlayer.reserveNormalCoreCount).toBe(1);
    expect(bobPlayer.reserveSoulCoreCount).toBe(1);
    expect(bobPlayer.soulCoreLocation).toEqual({ kind: "reserve" });
  });

  it("multi-target resume 後に残り1体で再度 pending になっても、後続 cards_from_ref は両方の処理済み対象を数える", () => {
    const spiritTargetDef: CardDefinition = {
      ...TARGET_DEF,
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    };
    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          id: "drain",
          action: {
            kind: "core_move",
            target: {
              kind: "filter",
              player: "either",
              filter: { category: ["spirit"] },
              count: { min: 0, max: 2 },
              excludeSelf: true,
            },
            from: { kind: "target_card" },
            toTargetController: { kind: "reserve" },
            amount: 1,
          },
        },
        {
          id: "count-vanished",
          connector: "after_triggers",
          action: {
            kind: "count_increase",
            player: "self",
            amount: {
              source: {
                kind: "cards_from_ref",
                stepId: "drain",
              },
            },
          },
        },
      ],
    };
    const sourceDefWithEffect: CardDefinition = {
      ...SOURCE_DEF,
      effects: [effect],
    };
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(sourceDefWithEffect, {
          instanceId: "alice-src",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(spiritTargetDef, {
          instanceId: "alice-soul-target",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(spiritTargetDef, {
          instanceId: "bob-soul-target",
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      playerOverrides: [
        {
          soulCoreLocation: {
            kind: "card",
            instanceId: "alice-soul-target",
          },
        },
        {
          soulCoreLocation: {
            kind: "card",
            instanceId: "bob-soul-target",
          },
        },
      ],
    });
    const getDef = (id: string) =>
      id === SOURCE_DEF.cardNo
        ? sourceDefWithEffect
        : id === TARGET_DEF.cardNo
          ? spiritTargetDef
          : undefined;

    let current = executeEffect({
      chainId: "test:engine-coreshoot-multi-target-void:445",
      state,
      effect,
      effectIndex: 0,
      sourceInstanceId: "alice-src",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      targetInstanceIds: ["alice-soul-target", "bob-soul-target"],
    });
    expect(current.pendingLifeCoreSelection?.actingPlayerId).toBe(ALICE);
    expect(
      current.pendingLifeCoreSelection?.continuation?.initialStepResults?.[0]
        ?.affectedCardInstanceIds
    ).toEqual(["alice-soul-target"]);

    const firstAction = getLegalActions({
      state: current,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_life_core_selection"
    );
    expect(firstAction).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: firstAction!,
      getCardDefinitionById: getDef,
      lifeCorePartitionChoice: { normalChosen: 0, soulChosen: 1 },
    }).state;

    expect(current.pendingLifeCoreSelection?.actingPlayerId).toBe(BOB);
    expect(
      current.pendingLifeCoreSelection?.continuation?.initialStepResults?.[0]
        ?.affectedCardInstanceIds
    ).toEqual(["bob-soul-target"]);

    const secondAction = getLegalActions({
      state: current,
      actingPlayerId: BOB,
      getCardDefinitionById: getDef,
    }).find(
      (candidate) => candidate.kind === "resolve_pending_life_core_selection"
    );
    expect(secondAction).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: secondAction!,
      getCardDefinitionById: getDef,
      lifeCorePartitionChoice: { normalChosen: 0, soulChosen: 1 },
    }).state;

    expect(current.pendingLifeCoreSelection).toBeNull();
    expect(current.players.find((p) => p.id === ALICE)!.countValue).toBe(2);
    expect(
      current.cardInstances.find((c) => c.instanceId === "alice-soul-target")!
        .zone
    ).toBe("field");
    expect(
      current.cardInstances.find((c) => c.instanceId === "bob-soul-target")!
        .zone
    ).toBe("field");
  });
});
