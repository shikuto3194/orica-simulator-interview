/**
 * engine-magic-trash-use-permission: BSDB01-R03「ファイナルフラッシュ」effects[0]
 * 「手札/トラッシュにあるこのカードは、自分の『ベジータ』がアタックしている間、
 * コスト3になり、トラッシュからも使用できる。」の2機構を単離検証する。
 *
 * (a) 継続 cost_modify 自己上書き（BSSL01-X03 と同型パターン）が手札/トラッシュ双方で効く。
 * (b) applicability.zone:"trash" 宣言つき registration のみ、条件成立中に限り
 *     getAvailableMagicLegalActions がトラッシュのカードもソースとして候補に出す
 *     (generateMagicRegistrations の zone skip 緩和 + isRegisteredMagicSourceZoneAllowed)。
 *
 * 実カード (BSDB01-R03) は reductionSymbols/grant_effect が絡み検証が複雑になるため、
 * ここでは同型の DSL を持つ専用テストカードで挙動を単離検証する
 * (bsaz03-m01-use-cost-discard-discount.test.ts の手法と同型)。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildMagicLookup,
  collectContinuousEffectInvariantIssues,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import { recomputeAndRebuildContinuousEffectsForSources } from "../src/effect/continuous-effect-rebuild";
import { executeEffect } from "../src/effect/effect-interpreter";
import type {
  BattleEntity,
  CardDefinition,
  GameState,
  GameStateInvariantIssue,
} from "../src";

const ALICE = "alice";
const BOB = "bob";

const TEST_MAGIC: CardDefinition = {
  cardNo: "TEST-TRASH-MAGIC",
  name: "テストトラッシュマジック",
  printedCategory: "magic",
  colors: ["red"],
  cost: 7,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    // [0] 継続コスト固定: 自分の「アンカー」がアタックしている間コスト3に上書き。
    {
      applicability: { zone: ["hand", "trash"] },
      timing: { kind: "continuous" },
      condition: [
        {
          kind: "field_has",
          player: "self",
          category: ["spirit"],
          cardNames: [{ contains: "アンカー" }],
          battleState: "attacking",
        },
      ],
      steps: [
        {
          action: {
            kind: "cost_modify",
            target: { kind: "self" },
            modifier: { override: 3 },
          },
        },
      ],
      textRef: [0],
    },
    // 手札/手元からは常時使用可能 (applicability 未指定 = 既定ゾーン)。
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [],
      textRef: [0],
    },
    // トラッシュからは条件成立中のみ使用可能。
    {
      applicability: { zone: ["trash"] },
      condition: [
        {
          kind: "field_has",
          player: "self",
          category: ["spirit"],
          cardNames: [{ contains: "アンカー" }],
          battleState: "attacking",
        },
      ],
      timing: { kind: "activated", mode: "flash" },
      steps: [],
      textRef: [0],
    },
  ],
};

const ANCHOR: CardDefinition = {
  cardNo: "TEST-TRASH-ANCHOR",
  name: "アンカー要塞",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 3000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const TRASH_ONLY_COST_MAGIC: CardDefinition = {
  cardNo: "TEST-TRASH-ONLY-COST-MAGIC",
  name: "テストトラッシュ限定コストマジック",
  printedCategory: "magic",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      applicability: { zone: ["trash"] },
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "cost_modify",
            target: { kind: "self" },
            modifier: { override: 2 },
          },
        },
      ],
    },
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [],
    },
  ],
};

const cardMap = new Map<string, CardDefinition>(
  [TEST_MAGIC, ANCHOR, TRASH_ONLY_COST_MAGIC].map((c) => [c.cardNo, c])
);
const getDef = (id: string) => cardMap.get(id);
const magicLookup = buildMagicLookup([
  TEST_MAGIC,
  ANCHOR,
  TRASH_ONLY_COST_MAGIC,
]);

function buildState(options: {
  magicZone: "hand" | "trash";
  anchorAttacking: boolean;
}): GameState {
  const magic = createCardInstance(TEST_MAGIC, {
    instanceId: "trash-magic-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: options.magicZone,
  });
  const anchor = createCardInstance(ANCHOR, {
    instanceId: "anchor-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
  });
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [magic, anchor],
    playerOverrides: [{ reserveNormalCoreCount: 7 }, {}],
  });
  const attacking: BattleEntity | undefined = options.anchorAttacking
    ? {
        entityId: "battle-anchor-1",
        memberInstanceIds: ["anchor-1"],
        resolvedBp: 3000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      }
    : undefined;
  const state: GameState = {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    window: "main_step",
    battleEntities: attacking ? [attacking] : [],
  };
  // 継続 cost_modify (effects[0]) を実行して CE を登録する（continuous 効果は
  // recomputeContinuousEffects 相当の再評価スイープを経由するため、テストでは
  // BSDB01-C07 の battleState CE テストと同様に明示的に一度実行する）。
  return executeEffect({
    chainId: "test:engine-magic-trash-use-permission:199",
    state,
    effect: TEST_MAGIC.effects![0]!,
    sourceInstanceId: "trash-magic-1",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

function getMagicActions(state: GameState) {
  return getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredMagicActions: magicLookup,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  }).filter(
    (a): a is Extract<typeof a, { kind: "use_magic" }> =>
      a.kind === "use_magic" && a.sourceInstanceId === "trash-magic-1"
  );
}

describe("engine-magic-trash-use-permission", () => {
  it("手札 + アンカー非アタック中: 通常コスト7で使用可能、上書きコストは無い", () => {
    const state = buildState({ magicZone: "hand", anchorAttacking: false });
    const actions = getMagicActions(state);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some((a) => a.costMode === "override")).toBe(false);
    expect(actions.every((a) => a.finalCost === 7)).toBe(true);
  });

  it("手札 + アンカーがアタック中: コスト3の上書き版が併存する", () => {
    const state = buildState({ magicZone: "hand", anchorAttacking: true });
    const actions = getMagicActions(state);
    const overridden = actions.find((a) => a.costMode === "override");
    expect(overridden).toBeDefined();
    expect(overridden?.finalCost).toBe(3);
  });

  it("トラッシュ + アンカー非アタック中: use_magic は一切候補に出ない", () => {
    const state = buildState({ magicZone: "trash", anchorAttacking: false });
    const actions = getMagicActions(state);
    expect(actions).toHaveLength(0);
  });

  it("トラッシュ + アンカーがアタック中: コスト3でトラッシュから使用でき、解決後もトラッシュに留まる", () => {
    const state = buildState({ magicZone: "trash", anchorAttacking: true });
    const actions = getMagicActions(state);
    const overridden = actions.find((a) => a.costMode === "override");
    expect(overridden).toBeDefined();
    expect(overridden?.finalCost).toBe(3);

    const result = applyLegalAction({
      state,
      action: overridden!,
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).state;

    // スタック窓があれば双方 pass で閉じる。
    let current = result;
    let guard = 0;
    while (current.stackWindow && guard++ < 10) {
      const responderId = current.stackWindow.priorityPlayerId;
      const passActions = getLegalActions({
        state: current,
        actingPlayerId: responderId,
        getCardDefinitionById: getDef,
        getRegisteredMagicActions: magicLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredBurstActions: () => undefined,
      });
      const pass = passActions.find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: pass!,
        getCardDefinitionById: getDef,
        getRegisteredMagicActions: magicLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredBurstActions: () => undefined,
      }).state;
    }

    // トラッシュから使用しコスト3を支払っても、解決後は (元々トラッシュにいたカードなので)
    // そのままトラッシュへ戻る。in_use への一時遷移が誤って手札扱い等にならないことの確認。
    expect(
      current.cardInstances.find((c) => c.instanceId === "trash-magic-1")?.zone
    ).toBe("trash");
  });

  it("手札から使用してトラッシュへ移動したカードのトラッシュ限定 cost_override CE を再登録する", () => {
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [
          createCardInstance(TRASH_ONLY_COST_MAGIC, {
            instanceId: "trash-only-cost-magic",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "hand",
          }),
        ],
      }),
      activePlayerId: ALICE,
      step: "main",
      window: "main_step",
    };
    expect(state.activeContinuousEffects).toHaveLength(0);

    const useAction = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).find(
      (action): action is Extract<typeof action, { kind: "use_magic" }> =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === "trash-only-cost-magic"
    );
    expect(useAction).toBeDefined();

    let current = applyLegalAction({
      state,
      action: useAction!,
      paymentSources: [],
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).state;

    const pass = getLegalActions({
      state: current,
      actingPlayerId: current.stackWindow!.priorityPlayerId,
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).find((action) => action.kind === "pass_stack");
    expect(pass).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      getCardDefinitionById: getDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).state;

    expect(
      current.cardInstances.find(
        (card) => card.instanceId === "trash-only-cost-magic"
      )?.zone
    ).toBe("trash");
    expect(
      current.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "trash-only-cost-magic" &&
          ce.provenance?.effectIndex === 0 &&
          ce.modifierTag === "cost_override"
      ),
      JSON.stringify(
        {
          activeContinuousEffects: current.activeContinuousEffects,
          log: current.log,
        },
        null,
        2
      )
    ).toBe(true);

    current = recomputeAndRebuildContinuousEffectsForSources(current, getDef, [
      "unrelated-drawn-card",
    ]);
    expect(
      current.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "trash-only-cost-magic" &&
          ce.provenance?.effectIndex === 0 &&
          ce.modifierTag === "cost_override"
      ),
      JSON.stringify(
        {
          activeContinuousEffects: current.activeContinuousEffects,
          log: current.log,
        },
        null,
        2
      )
    ).toBe(true);

    const issues: GameStateInvariantIssue[] = [];
    collectContinuousEffectInvariantIssues({
      state: current,
      issues,
      getCardDefinitionById: getDef,
    });
    expect(
      issues.filter((issue) => issue.code === "missing_continuous_effect")
    ).toHaveLength(0);
  });

  it("トラッシュ許可を宣言していない registration (effectIndex=1) の action をトラッシュのカードへ再送しても apply 時に拒否される（実行層の再ゲート、adversarial verifier round1 指摘反映）", () => {
    // 手札状態で「手札/手元専用」registration の action を取得（applicability 未宣言 =
    // effectIndex 1）。
    const handState = buildState({ magicZone: "hand", anchorAttacking: false });
    const handOnlyAction = getMagicActions(handState).find(
      (a) => a.effectIndex === 1
    );
    expect(handOnlyAction).toBeDefined();

    // 同じ action オブジェクトを、同じ instanceId のカードがトラッシュに存在し、かつ
    // トラッシュ使用条件 (アンカー攻撃中) が満たされている state に対して再送する
    // (stale action replay / 偽装 effectIndex を想定)。availability 層は経由しない。
    const trashState = buildState({
      magicZone: "trash",
      anchorAttacking: true,
    });
    expect(
      trashState.cardInstances.find((c) => c.instanceId === "trash-magic-1")
        ?.zone
    ).toBe("trash");

    expect(() =>
      applyLegalAction({
        state: trashState,
        action: handOnlyAction!,
        paymentSources: [{ kind: "reserve", amount: 7 }],
        getCardDefinitionById: getDef,
        getRegisteredMagicActions: magicLookup,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredBurstActions: () => undefined,
      })
    ).toThrow();
  });
});
