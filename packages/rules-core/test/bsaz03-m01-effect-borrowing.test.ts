import { resumeStackCascadeIfReady } from "../src/legal/stack-resolution-core";
/**
 * BSAZ03-M01「雨の断章」effects[2,3] (textLines[3,4]):
 * 「フラッシュ／スタック〔ターンに1回:同名〕自分のトラッシュにあるコスト6以下の
 * 系統:「地球」/「火星」を持つマジックカードの、フラッシュタイミングならメイン／
 * フラッシュ効果1つを、スタックタイミングならスタック効果1つを発揮する。その効果発揮後、
 * そのカードをフィールドに置く。」
 *
 * 初のカード横断効果借用 primitive (`borrow_magic_effect`, effect-borrowing.ts)。
 * 借用元候補の絞り込みは `CardFilter.hasActivatedEffectMode` に委譲する
 * (`cardHasPrintedEffectText` と同じ「印字属性・実装状態非依存」原則 — stub の
 * 借用元も legal target になるが、実行すると steps:[] の安全な no-op になる)。
 *
 * ここでは `executeEffect` を直接呼び、対象解決 (target resolution) → 借用効果実行 →
 * フィールド残置、の一連を単離検証する (BSGE01-C01 テストと同型の低レベル呼び出し。
 * use_magic 宣言 → スタック窓クローズ → pendingEffectTargetSelection という対象選択の
 * deferred 経路 [project_magic_target_after_stack_window] はここでは経由しない)。
 */
import { describe, expect, it } from "vitest";
import { applyLegalAction } from "../src";
import { getLegalActions } from "../src/legal/legal-actions";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect as executeEffectBody,
  flushPendingLeaves,
  generateMagicRegistrations,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const M01 = cardNoMap.get("BSAZ03-M01")!;

const ALICE = "alice";
const BOB = "bob";

function donorDef(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: `テスト借用元 ${cardNo}`,
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "地球",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
        textRef: [0],
      },
    ],
    ...overrides,
  } as CardDefinition;
}

// 適格: cost<=6, tribe 地球, 非stub flash 効果 (draw 1)
const DONOR_ELIGIBLE = donorDef("TEST-BORROW-DONOR-ELIGIBLE");
// 系統不一致 → 対象外
const DONOR_WRONG_TRIBE = donorDef("TEST-BORROW-DONOR-WRONG-TRIBE", {
  tribe: "闘神",
});
// コスト超過 → 対象外
const DONOR_TOO_EXPENSIVE = donorDef("TEST-BORROW-DONOR-EXPENSIVE", {
  cost: 7,
});
// flash 効果はあるが stub (steps:[]) → 対象「には」なるが実行は no-op
const DONOR_STUB_ONLY = donorDef("TEST-BORROW-DONOR-STUB", {
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [],
      stub: "test stub",
      textRef: [0],
    },
  ],
});
// activated 効果を一切持たない (continuous のみ) → 対象外
const DONOR_NO_ACTIVATED = donorDef("TEST-BORROW-DONOR-NO-ACTIVATED", {
  effects: [{ timing: { kind: "continuous" }, steps: [], textRef: [0] }],
});
// step 自身が executionMode:"optional" (EffectStep レベル、Effect レベルの
// executionMode とは別フィールド。dsl-types.ts:2586 vs :2730) を持つ flash 効果。
// ENGINE-borrow-retrigger-optional-step-no-resume の実際の再現条件はこちらであり、
// Effect.executionMode:"optional" (BSAZ02-C15 のような「手札トリガー使用可否」表現) は
// pendingStepOptionalChoice の生成トリガーにならない (effect-interpreter.ts:1956 の
// ゲートは step.executionMode のみを見る)。
const DONOR_OPTIONAL_STEP = donorDef("TEST-BORROW-DONOR-OPTIONAL-STEP", {
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: { kind: "draw", player: "self", count: 1 },
          executionMode: "optional",
        },
      ],
      textRef: [0],
    },
  ],
});
const DONOR_OPTIONAL_EMPTY_MOVE_STEP = donorDef(
  "TEST-BORROW-DONOR-OPTIONAL-EMPTY-MOVE",
  {
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: "hand", player: "opponent" },
              to: { zone: "trash", player: "opponent" },
              count: 1,
              unseen: true,
            },
            executionMode: "optional",
            usageLimit: { kind: "per_card_name", duration: "turn" },
          },
        ],
        textRef: [0],
      },
    ],
  }
);
// 借用時に新設した effect usage record が、conditional_cost の支払い失敗で払い戻されるかを
// 確認するための合成借用元。初期 state は reserve 0 のため pay_cost:1 が不成立になる。
const DONOR_USAGE_LIMITED_CONDITIONAL_COST = donorDef(
  "TEST-BORROW-DONOR-USAGE-CONDITIONAL-COST",
  {
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        limitGroupId: "test-borrow-conditional-cost",
        steps: [
          { action: { kind: "pay_cost", amount: 1 } },
          {
            connector: "conditional_cost",
            action: { kind: "draw", player: "self", count: 1 },
          },
        ],
        textRef: [0],
      },
    ],
  }
);

const ALL_DONORS = [
  DONOR_ELIGIBLE,
  DONOR_WRONG_TRIBE,
  DONOR_TOO_EXPENSIVE,
  DONOR_STUB_ONLY,
  DONOR_NO_ACTIVATED,
  DONOR_OPTIONAL_STEP,
  DONOR_OPTIONAL_EMPTY_MOVE_STEP,
  DONOR_USAGE_LIMITED_CONDITIONAL_COST,
];
const testDefs = new Map<string, CardDefinition>(
  ALL_DONORS.map((d) => [d.cardNo, d])
);
const getCardDefinitionById = (id: string) =>
  cardNoMap.get(id) ?? testDefs.get(id);

function stateWithDonorsInTrash(donors: CardDefinition[]): GameState {
  const m01Instance = createCardInstance(M01, {
    instanceId: "alice-m01",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "in_use",
  });
  const donorInstances = donors.map((d, i) =>
    createCardInstance(d, {
      instanceId: `donor-${i}-${d.cardNo}`,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    })
  );
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [m01Instance, ...donorInstances],
  });
}

function flashBorrowEffect() {
  return M01.effects!.find(
    (e) =>
      e.timing.kind === "activated" &&
      e.timing.mode === "flash" &&
      e.steps.some((s) => s.action.kind === "borrow_magic_effect")
  )!;
}

it("BSAZ03-M01 は借用先の派生効果とその発揮後が終わるまで配置を待つ", () => {
  const watcher: CardDefinition = {
    ...DONOR_ELIGIBLE,
    cardNo: "TEST-BORROW-AFTER-WATCHER",
    name: "借用順序の観測者",
    printedCategory: "spirit",
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    effects: [
      {
        timing: {
          kind: "game_event",
          event: "increase_hand",
          player: "opponent",
        },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
          {
            connector: "after_triggers",
            action: {
              kind: "move_card",
              from: { zone: "trash", player: "opponent" },
              to: { zone: "hand" },
              count: 1,
              target: {
                kind: "filter",
                zone: "trash",
                player: "opponent",
                filter: { cardName: [{ exact: DONOR_ELIGIBLE.name }] },
                count: 1,
              },
            },
          },
        ],
      },
    ],
  };
  const defs = [M01, DONOR_ELIGIBLE, watcher];
  const deps = {
    getCardDefinitionById: (id: string) => defs.find((d) => d.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredBurstActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
  };
  let state = stateWithDonorsInTrash([DONOR_ELIGIBLE]);
  state.cardInstances.push(
    createCardInstance(watcher, {
      instanceId: "watcher",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    })
  );
  const donorId = `donor-0-${DONOR_ELIGIBLE.cardNo}`;
  state = executeEffect({
    state,
    effect: flashBorrowEffect(),
    sourceInstanceId: "alice-m01",
    actingPlayerId: ALICE,
    chainId: "outer-borrow",
    targetInstanceIds: [donorId],
    ...deps,
  });
  expect(state.cardInstances.find((c) => c.instanceId === donorId)?.zone).toBe(
    "trash"
  );
  expect(state.pendingAfterTriggersContinuations).toHaveLength(1);
  for (
    let guard = 0;
    guard < 12 &&
    (state.pendingTriggeredEffects.length ||
      state.stackWindow ||
      state.pendingEffectTargetSelection);
    guard++
  ) {
    const actions = [ALICE, BOB].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...deps })
    );
    const action =
      actions.find((a) => a.kind === "pass_stack") ??
      actions.find(
        (a) => a.kind === "resolve_pending_triggered_effect" && !a.skipOnly
      ) ??
      actions.find((a) => a.kind === "resolve_pending_effect_target") ??
      actions.find((a) => a.kind === "select_pending_to_resolve");
    expect(action, JSON.stringify(actions)).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      ...(action?.kind === "resolve_pending_effect_target"
        ? { targetInstanceIds: [donorId] }
        : {}),
      ...deps,
    }).state;
  }
  // 最初のドローと、内側の回収による手札増加の2回。2回目は回収対象なしでも空撃ちする。
  expect(state.players.find((p) => p.id === BOB)?.countValue).toBe(2);
  // 内側の発揮後でトラッシュから回収したので、外側の配置はそれを上書きしない。
  expect(state.cardInstances.find((c) => c.instanceId === donorId)?.zone).toBe(
    "hand"
  );
  expect(state.pendingAfterTriggersContinuations).toHaveLength(0);
});

function stackBorrowEffect() {
  return M01.effects!.find(
    (e) =>
      e.timing.kind === "activated" &&
      e.timing.mode === "stack" &&
      e.steps.some((s) => s.action.kind === "borrow_magic_effect")
  )!;
}

function flashBorrowEffectWithoutThenMove() {
  const effect = flashBorrowEffect();
  return {
    ...effect,
    steps: effect.steps.map((step) => {
      if (step.action.kind !== "borrow_magic_effect") return step;
      const { thenMove: _thenMove, ...actionWithoutThenMove } = step.action;
      return { ...step, action: actionWithoutThenMove };
    }),
  };
}

describe("BSAZ03-M01 effects[2,3]: 効果借用 (borrow_magic_effect)", () => {
  it("card-data: flash/stack 双方が非stub・同一 limitGroupId・per_card_name/turn を持つ", () => {
    const flash = flashBorrowEffect();
    const stack = stackBorrowEffect();
    expect(flash.stub).toBeUndefined();
    expect(stack.stub).toBeUndefined();
    expect(flash.limitGroupId).toBe("bsaz03-m01-borrow");
    expect(stack.limitGroupId).toBe(flash.limitGroupId);
    expect(flash.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(stack.usageLimit).toEqual(flash.usageLimit);

    const flashAction = flash.steps[0]!.action;
    expect(flashAction.kind).toBe("borrow_magic_effect");
    if (flashAction.kind !== "borrow_magic_effect")
      throw new Error("unreachable");
    expect(flashAction.borrowModes).toEqual(["main", "flash"]);
    expect(flashAction.thenMove).toEqual({
      zone: "field",
      player: "self",
      afterTriggers: true,
    });
    expect(flashAction.target).toEqual({
      kind: "filter",
      player: "self",
      zone: "trash",
      filter: {
        category: ["magic"],
        maxCost: 6,
        tribes: ["地球", "火星"],
        tribesLogic: "or",
        hasActivatedEffectMode: ["main", "flash"],
      },
      count: 1,
    });

    const stackAction = stack.steps[0]!.action;
    if (stackAction.kind !== "borrow_magic_effect")
      throw new Error("unreachable");
    expect(stackAction.borrowModes).toEqual(["stack"]);
  });

  it("registrations: generateMagicRegistrations が flash と stack の両タイミングを生成する", () => {
    const regs = generateMagicRegistrations(M01);
    const timings = regs.map((r) => r.timing);
    expect(timings).toContain("flash");
    expect(timings).toContain("stack");
  });

  it("実行: 適格な借用元 (非stub flash) を選ぶと、その効果 (draw 1) が実際に発揮され、借用元はフィールドに残る", () => {
    const state = stateWithDonorsInTrash([DONOR_ELIGIBLE, DONOR_WRONG_TRIBE]);
    const donorId = "donor-0-TEST-BORROW-DONOR-ELIGIBLE";
    const before = state.players.find((p) => p.id === ALICE)!.handCount;

    const after = executeEffect({
      chainId: "test:bsaz03-m01-effect-borrowing:388",
      state,
      effect: flashBorrowEffect(),
      sourceInstanceId: "alice-m01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [donorId],
    });

    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.handCount).toBe(before + 1); // 借用した draw 1 が実行された
    const donor = after.cardInstances.find((c) => c.instanceId === donorId)!;
    expect(donor.zone).toBe("field"); // 効果発揮後、フィールドに残置
  });

  it("実行: 借用元が stub (steps:[]) でも legal target になり、実行は no-op だがフィールドには残る", () => {
    const state = stateWithDonorsInTrash([DONOR_STUB_ONLY]);
    const donorId = "donor-0-TEST-BORROW-DONOR-STUB";
    const before = state.players.find((p) => p.id === ALICE)!.handCount;

    const after = executeEffect({
      chainId: "test:bsaz03-m01-effect-borrowing:409",
      state,
      effect: flashBorrowEffect(),
      sourceInstanceId: "alice-m01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [donorId],
    });

    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.handCount).toBe(before); // stub 効果は steps:[] なので盤面変化なし
    const donor = after.cardInstances.find((c) => c.instanceId === donorId)!;
    expect(donor.zone).toBe("field"); // それでも借用元はフィールドに残置される
  });

  it("EDH-0000: 同名借用は元の magic usage record を引き継ぎ、再帰せず不発になる", () => {
    const state = stateWithDonorsInTrash([M01]);
    const donorId = `donor-0-${M01.cardNo}`;
    // 実際の use_magic 宣言と同じ magic + limitGroupId の record を先に置く。
    // 借用先も同名 M01 のため、〔ターンに1回:同名〕により二度目の発揮はできない。
    const stateAfterOriginalM01Use: GameState = {
      ...state,
      effectUsageRecords: [
        {
          sourceInstanceId: "alice-m01",
          sourceDefinitionId: M01.cardNo,
          playerId: ALICE,
          effectLabel: "magic",
          turnNumber: state.turnNumber,
          step: state.step,
          duration: "turn",
          count: 1,
          groupId: "bsaz03-m01-borrow",
        },
      ],
    };

    const after = executeEffect({
      chainId: "test:bsaz03-m01-effect-borrowing:447",
      state: stateAfterOriginalM01Use,
      effect: flashBorrowEffect(),
      sourceInstanceId: "alice-m01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [donorId],
    });

    expect(after.log).toContain(
      "borrow_magic_effect:usage_limit_exhausted:BSAZ03-M01:3"
    );
    expect(
      after.cardInstances.find((card) => card.instanceId === donorId)?.zone
    ).toBe("trash");
    expect(after.effectUsageRecords).toHaveLength(1);
  });

  it("EDH-0000: 初回借用で usage record を作成し、同一ターンの再借用を拒否する", () => {
    const state = stateWithDonorsInTrash([M01]);
    const donorId = `donor-0-${M01.cardNo}`;
    const first = executeEffect({
      chainId: "test:bsaz03-m01-effect-borrowing:469",
      state,
      effect: flashBorrowEffectWithoutThenMove(),
      sourceInstanceId: "alice-m01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [donorId],
    });

    expect(
      first.cardInstances.find((card) => card.instanceId === donorId)?.zone
    ).toBe("trash");
    expect(first.effectUsageRecords).toMatchObject([
      {
        sourceInstanceId: donorId,
        sourceDefinitionId: M01.cardNo,
        effectLabel: "magic",
        duration: "turn",
        count: 1,
        groupId: "bsaz03-m01-borrow",
      },
    ]);

    const second = executeEffect({
      chainId: "test:bsaz03-m01-effect-borrowing:493",
      state: first,
      effect: flashBorrowEffectWithoutThenMove(),
      sourceInstanceId: "alice-m01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [donorId],
    });

    expect(second.log).toContain(
      "borrow_magic_effect:usage_limit_exhausted:BSAZ03-M01:3"
    );
    expect(second.effectUsageRecords).toEqual(first.effectUsageRecords);
  });

  it("EDH-0000: conditional_cost の不発では新規 borrowed magic usage record を払い戻す", () => {
    const state = stateWithDonorsInTrash([
      DONOR_USAGE_LIMITED_CONDITIONAL_COST,
    ]);
    const donorId = `donor-0-${DONOR_USAGE_LIMITED_CONDITIONAL_COST.cardNo}`;

    const after = executeEffect({
      chainId: "test:bsaz03-m01-effect-borrowing:515",
      state,
      effect: flashBorrowEffectWithoutThenMove(),
      sourceInstanceId: "alice-m01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [donorId],
    });

    expect(after.log).toContain(
      `effect:conditional-cost-effect-failed:${donorId}`
    );
    expect(after.effectUsageRecords).toHaveLength(0);
    expect(
      after.cardInstances.find((card) => card.instanceId === donorId)?.zone
    ).toBe("trash");
  });

  it("対象フィルタ: 系統不一致/コスト超過/activated効果なしのカードは候補から除外される", () => {
    const state = stateWithDonorsInTrash([
      DONOR_WRONG_TRIBE,
      DONOR_TOO_EXPENSIVE,
      DONOR_NO_ACTIVATED,
      DONOR_ELIGIBLE,
    ]);
    // preSelectedIds を渡さず自動解決させ、唯一の適格候補が選ばれることを確認する
    // (resolveTargetCards は candidateFilter 通過後 fallback で count 分を自動選択)。
    const after = executeEffect({
      chainId: "test:bsaz03-m01-effect-borrowing:543",
      state,
      effect: flashBorrowEffect(),
      sourceInstanceId: "alice-m01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const eligibleDonor = after.cardInstances.find(
      (c) => c.instanceId === "donor-3-TEST-BORROW-DONOR-ELIGIBLE"
    )!;
    expect(eligibleDonor.zone).toBe("field");
    for (const excludedId of [
      "donor-0-TEST-BORROW-DONOR-WRONG-TRIBE",
      "donor-1-TEST-BORROW-DONOR-EXPENSIVE",
      "donor-2-TEST-BORROW-DONOR-NO-ACTIVATED",
    ]) {
      const excluded = after.cardInstances.find(
        (c) => c.instanceId === excludedId
      )!;
      expect(excluded.zone).toBe("trash"); // 対象にならず、トラッシュに残ったまま
    }
  });

  it("実在カード統合: BSAZ02-C15 (非stub flash) を借用元に選ぶと borrow_magic_effect:executed ログが記録され、no_eligible_effect (stubケースと同じ経路) にはならない。send_to_deck 本体も実際に発揮される", () => {
    // BSAZ02-C15 は cost:6・tribe:"火星" で借用元フィルタを通過する実在の非stubカード
    // (flash 効果本体 send_to_deck は実装済み)。ここでは
    // findBorrowableEffect が実際に非stub effect を発見し executeEffect へ橋渡しした
    // ことを `borrow_magic_effect:executed:${cardNo}` ログで確認する
    // (「自身の効果は stub」という誤ったコード注釈の反証を受けた検証、コメント修正と対)。
    //
    // NOTE (adversarial verifier round1 lens1 refute 対応): BSAZ02-C15 の
    // `executionMode:"optional"` は Effect レベル (dsl-types.ts:2730、手札トリガー
    // 使用可否の表現) であり、pendingStepOptionalChoice を生成する
    // EffectStep.executionMode (dsl-types.ts:2586、effect-interpreter.ts:1956 のゲート)
    // とは別フィールド。このカードの step 自体には executionMode が付いていないため、
    // send_to_deck は元々 optional gate を経由せず通常実行される
    // (ENGINE-borrow-retrigger-optional-step-no-resume の再現条件ではない)。
    // 真の再現条件 (EffectStep.executionMode:"optional") の検証は次の test
    // ("借用先 step 自身が executionMode:optional でも自動 resume され...") を参照。
    const donor = cardNoMap.get("BSAZ02-C15")!;
    const opponentDef = donorDef("TEST-BORROW-BSAZ02-C15-OPP-TARGET", {
      printedCategory: "spirit",
      cost: 3,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      effects: [],
    });
    const getCardDefinitionByIdWithOpponent = (id: string) =>
      cardNoMap.get(id) ??
      testDefs.get(id) ??
      (id === opponentDef.cardNo ? opponentDef : undefined);
    const state = stateWithDonorsInTrash([donor as CardDefinition]);
    const opponentInstance = createCardInstance(opponentDef, {
      instanceId: "bob-opp-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const stateWithOpponent: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, opponentInstance],
    };
    const donorId = `donor-0-${donor.cardNo}`;

    const afterResolved = executeEffect({
      chainId: "test:bsaz03-m01-effect-borrowing:607",
      state: stateWithOpponent,
      effect: flashBorrowEffect(),
      sourceInstanceId: "alice-m01",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDefinitionByIdWithOpponent,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [donorId],
    });

    expect(
      afterResolved.log.some(
        (l) => l === "borrow_magic_effect:executed:BSAZ02-C15"
      )
    ).toBe(true);
    expect(
      afterResolved.log.some((l) =>
        l.startsWith("borrow_magic_effect:no_eligible_effect:")
      )
    ).toBe(false);
    expect(afterResolved.pendingStepOptionalChoice).toBeNull();
    const after = flushPendingLeaves(
      afterResolved,
      getCardDefinitionByIdWithOpponent
    );
    const donorAfter = after.cardInstances.find(
      (c) => c.instanceId === donorId
    )!;
    expect(donorAfter.zone).toBe("field"); // 借用元自身は効果発揮後フィールドに残置
    const opponentAfter = after.cardInstances.find(
      (c) => c.instanceId === "bob-opp-target"
    )!;
    expect(opponentAfter.zone).toBe("deck"); // send_to_deck 本体が実際に発揮された
  });

  it.each(["execute", "decline"] as const)(
    "借用先の任意ドローを %s し終えてから、借用したカードをフィールドへ置く",
    (choice) => {
      // DONOR_OPTIONAL_STEP は EffectStep.executionMode:"optional" を持つ合成カード
      // (BSAZ02-C15 とは異なり、真に pendingStepOptionalChoice を生成する)。
      // 借用を選んだことと、本文内の任意ドローを選ぶことは別の判断。
      const state = stateWithDonorsInTrash([DONOR_OPTIONAL_STEP]);
      const donorId = `donor-0-${DONOR_OPTIONAL_STEP.cardNo}`;
      const before = state.players.find((p) => p.id === ALICE)!.handCount;

      const pending = executeEffect({
        chainId: "test:bsaz03-m01-effect-borrowing:652",
        state,
        effect: flashBorrowEffect(),
        sourceInstanceId: "alice-m01",
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
        targetInstanceIds: [donorId],
      });

      expect(pending.pendingStepOptionalChoice).not.toBeNull();
      expect(
        pending.cardInstances.find((c) => c.instanceId === donorId)?.zone
      ).toBe("trash");
      const after = applyLegalAction({
        state: pending,
        action: {
          kind: "resolve_pending_step_optional_choice",
          pendingId: pending.pendingStepOptionalChoice!.pendingId,
          actingPlayerId: ALICE,
          choice,
        },
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;

      const alice = after.players.find((p) => p.id === ALICE)!;
      expect(alice.handCount).toBe(before + (choice === "execute" ? 1 : 0));
      expect(after.pendingStepOptionalChoice).toBeNull();
      expect(
        after.log.some(
          (l) =>
            l.includes(":step-optional-execute:") && l.includes("auto-resume")
        )
      ).toBe(false);
      const donorAfter = after.cardInstances.find(
        (c) => c.instanceId === donorId
      )!;
      expect(donorAfter.zone).toBe("field"); // 借用元自身は効果発揮後フィールドに残置
    }
  );

  it("借用先の任意移動が候補なしなら辞退でき、step usage を消費しない", () => {
    const state = stateWithDonorsInTrash([DONOR_OPTIONAL_EMPTY_MOVE_STEP]);
    const donorId = `donor-0-${DONOR_OPTIONAL_EMPTY_MOVE_STEP.cardNo}`;
    const before = state.players.find((p) => p.id === ALICE)!.handCount;

    const pending = executeEffect({
      chainId: "test:bsaz03-m01-effect-borrowing:699",
      state,
      effect: flashBorrowEffect(),
      sourceInstanceId: "alice-m01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [donorId],
    });

    expect(pending.pendingStepOptionalChoice?.canExecute).toBe(false);
    const after = applyLegalAction({
      state: pending,
      action: {
        kind: "resolve_pending_step_optional_choice",
        pendingId: pending.pendingStepOptionalChoice!.pendingId,
        actingPlayerId: ALICE,
        choice: "decline",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(before);
    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(
      after.log.some(
        (l) =>
          l.includes(":step-optional-decline:") && l.includes("auto-resume")
      )
    ).toBe(false);
    expect(
      after.log.some(
        (l) =>
          l.includes(":step-optional-execute:") && l.includes("auto-resume")
      )
    ).toBe(false);
    expect(
      after.effectUsageRecords.filter(
        (record) =>
          record.effectLabel ===
          `__step:${DONOR_OPTIONAL_EMPTY_MOVE_STEP.cardNo}:0:0`
      )
    ).toHaveLength(0);
    const donorAfter = after.cardInstances.find(
      (c) => c.instanceId === donorId
    )!;
    expect(donorAfter.zone).toBe("field");
  });

  it("ENGINE-retrigger-range-count-target-fallback: 借用先効果の対象が count:{min,max} の「まで」型でも preSelectedIds 無し自動解決で無音no-opにならない (rangeAutoResolveStrategy:max)", () => {
    // range ターゲットの自動解決だけを単離検証する専用の借用元カードを用意する
    // (executionMode 無し、count:{min,max} target のみを持つ)。
    const opponentEligible1 = donorDef("TEST-RANGE-OPP-ELIGIBLE-1", {
      printedCategory: "spirit",
      cost: 3,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      effects: [],
    });
    const opponentEligible2 = donorDef("TEST-RANGE-OPP-ELIGIBLE-2", {
      printedCategory: "spirit",
      cost: 5,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      effects: [],
    });
    const opponentIneligible = donorDef("TEST-RANGE-OPP-TOO-EXPENSIVE", {
      printedCategory: "spirit",
      cost: 7,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      effects: [],
    });
    // 借用元: 「本来コスト6以下の相手のスピリット3体まで(count:{min:0,max:3})をデッキの下に戻す」
    // 非optional flash (BSAZ02-C15 と同じ send_to_deck target 形状、executionMode 無し)。
    const rangeDonor = donorDef("TEST-BORROW-DONOR-RANGE-TARGET", {
      cost: 3,
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "send_to_deck",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["spirit", "ultimate"],
                    maxCost: 6,
                    costBasis: "printed",
                  },
                  count: { min: 0, max: 3 },
                },
                position: "bottom",
              },
            },
          ],
          textRef: [0],
        },
      ],
    });
    const opponentDefs = new Map<string, CardDefinition>(
      [
        opponentEligible1,
        opponentEligible2,
        opponentIneligible,
        rangeDonor,
      ].map((d) => [d.cardNo, d])
    );
    const getCardDefinitionByIdWithOpponents = (id: string) =>
      cardNoMap.get(id) ?? testDefs.get(id) ?? opponentDefs.get(id);

    const m01Instance = createCardInstance(M01, {
      instanceId: "alice-m01",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "in_use",
    });
    const donorInstance = createCardInstance(rangeDonor, {
      instanceId: `donor-0-${rangeDonor.cardNo}`,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const opp1 = createCardInstance(opponentEligible1, {
      instanceId: "bob-opp-eligible-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const opp2 = createCardInstance(opponentEligible2, {
      instanceId: "bob-opp-eligible-2",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const opp3 = createCardInstance(opponentIneligible, {
      instanceId: "bob-opp-too-expensive",
      normalCoreCount: 1,
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [m01Instance, donorInstance, opp1, opp2, opp3],
    });
    const donorId = donorInstance.instanceId;

    const afterResolved = executeEffect({
      chainId: "test:bsaz03-m01-effect-borrowing:847",
      state,
      effect: flashBorrowEffect(),
      sourceInstanceId: "alice-m01",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDefinitionByIdWithOpponents,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [donorId],
    });

    expect(
      afterResolved.log.some(
        (l) =>
          l === "borrow_magic_effect:executed:TEST-BORROW-DONOR-RANGE-TARGET"
      )
    ).toBe(true);
    const after = flushPendingLeaves(
      afterResolved,
      getCardDefinitionByIdWithOpponents
    );

    // count:{min:0,max:3} の自動解決が max 採用 (候補2件でキャップ) になり、
    // 適格な相手スピリット2体は両方デッキの下へ送られる
    // (rangeAutoResolveStrategy 未配線時は静的min=0で常に0件の無音no-opだった)。
    const eligible1After = after.cardInstances.find(
      (c) => c.instanceId === "bob-opp-eligible-1"
    )!;
    const eligible2After = after.cardInstances.find(
      (c) => c.instanceId === "bob-opp-eligible-2"
    )!;
    expect(eligible1After.zone).toBe("deck");
    expect(eligible2After.zone).toBe("deck");
    // コスト超過の相手スピリットはフィルタ対象外のまま場に残る。
    const ineligibleAfter = after.cardInstances.find(
      (c) => c.instanceId === "bob-opp-too-expensive"
    )!;
    expect(ineligibleAfter.zone).toBe("field");
  });

  it("借用先が無い (候補0件) ときは何も起きない", () => {
    const state = stateWithDonorsInTrash([DONOR_WRONG_TRIBE]);
    const before = state.players.find((p) => p.id === ALICE)!.handCount;
    const after = executeEffect({
      chainId: "test:bsaz03-m01-effect-borrowing:889",
      state,
      effect: flashBorrowEffect(),
      sourceInstanceId: "alice-m01",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.handCount).toBe(before);
    const donor = after.cardInstances.find(
      (c) => c.instanceId === "donor-0-TEST-BORROW-DONOR-WRONG-TRIBE"
    )!;
    expect(donor.zone).toBe("trash");
  });
});

// 単体実行後も、効果発揮後の継続を本番と同じ安定点まで進める。
function executeEffect(
  options: Parameters<typeof executeEffectBody>[0]
): GameState {
  const state = executeEffectBody(options);
  return resumeStackCascadeIfReady(state, {
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions ?? (() => []),
    getRegisteredBurstActions: options.getRegisteredBurstActions ?? (() => []),
  });
}
