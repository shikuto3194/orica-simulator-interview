/**
 * pay-to-act フラッシュ/スタック効果手札破棄ゲート
 * (gate_flash_stack_hand_discard / BSSA01-X01 / BSTH03-R02 / BSTH09-R02)。
 *
 * ルール正源: manual/ai-reference/10_rules/03d_effect-target-and-prerequisite-gates.md
 * §「○○しなければ△△を発揮できない」。
 *
 * 手札破棄型も追加コストではなく、発揮直前・対象選択前の prerequisite gate。
 * 対象は見出しラベルの「フラッシュ」/「スタック」効果で、使用窓とは分離する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type {
  ActiveStack,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src";
import type { Effect } from "../src/dsl-types";
import { computePayToActHandDiscardGate } from "../src/legal/pay-to-act-hand-discard-gate";

const flashDestroyMagic: CardDefinition = {
  cardNo: "TEST-PTA-HAND-FLASH-DESTROY",
  name: "テスト・手札ゲート用フラッシュ破壊",
  printedCategory: "magic",
  colors: ["purple"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: ["フラッシュ", "相手のスピリット1体を破壊する。"],
  keywordTags: [],
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      activationLabel: "flash",
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
      ],
    },
  ],
  sourceUrls: [],
  sourceConfidence: "C",
};

const grandwalkerFlashNexus: CardDefinition = {
  cardNo: "TEST-PTA-HAND-GRANDWALKER-FLASH",
  name: "テスト・創界神ネクサス",
  printedCategory: "nexus",
  colors: ["purple"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  grandwalkerData: {
    kind: "grandwalker",
    oracleTriggerKinds: ["summon"] as const,
    oracleConditions: [],
  },
  sourceUrls: [],
  sourceConfidence: "C",
};

// 耐性①-b(「ミラージュを含む」opt-in が無いゲートの構造的除外、10_rules/08c:94)検証用。
const mirageFlashMagic: CardDefinition = {
  cardNo: "TEST-PTA-HAND-MIRAGE-FLASH",
  name: "テスト・ミラージュ",
  printedCategory: "magic",
  colors: ["purple"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  mirageData: { cost: 2, reduction: [] },
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = [
  ...ALL_CARDS,
  flashDestroyMagic,
  grandwalkerFlashNexus,
  mirageFlashMagic,
];
const cardNoMap = new Map<string, CardDefinition>(
  defs.map((c) => [c.cardNo, c])
);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const lookups = {
  getCardDefinitionById,
  getRegisteredMagicActions: buildMagicLookup(defs),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(defs),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  getRegisteredBurstActions: buildBurstEffectLookup(defs),
  getRegisteredHandActivatedEffectActions: buildHandActivatedEffectLookup(defs),
};

const bssa01StyleGate: Effect = {
  timing: { kind: "card_event", event: "attack" },
  steps: [
    {
      action: {
        kind: "gate_flash_stack_hand_discard",
        player: "opponent",
        count: 1,
        targetEffectLabels: ["flash", "stack"],
        duration: { scope: "while_on_field" },
      },
    },
  ],
};

function baseLegalFlowState(): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const state: GameState = {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [
      createCardInstance(flashDestroyMagic, {
        instanceId: "alice-magic",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(card("BSTH09-C01"), {
        instanceId: "alice-payment-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(card("BSTH09-C02"), {
        instanceId: "alice-payment-2",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(card("BSTH09-C03"), {
        instanceId: "bob-target",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(card("BSSA01-X01"), {
        instanceId: "bssa-gate",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  };
  return executeEffect({
    chainId: "test:pay-to-act-hand-discard-gate:183",
    state,
    effect: bssa01StyleGate,
    sourceInstanceId: "bssa-gate",
    actingPlayerId: "bob",
    getCardDefinitionById,
  });
}

function aliceUsesMagicThenBobPasses(state: GameState): GameState {
  const aliceActions = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  });
  const useMagic = aliceActions.find(
    (a) => a.kind === "use_magic" && a.sourceInstanceId === "alice-magic"
  );
  expect(useMagic).toBeDefined();
  const afterUse = applyLegalAction({
    state,
    action: useMagic!,
    ...lookups,
  }).state;

  const bobActions = getLegalActions({
    state: afterUse,
    actingPlayerId: "bob",
    ...lookups,
  });
  const pass = bobActions.find((a) => a.kind === "pass_stack");
  expect(pass).toBeDefined();
  return applyLegalAction({ state: afterUse, action: pass!, ...lookups }).state;
}

function stack(overrides: Partial<ActiveStack> = {}): ActiveStack {
  return {
    stackId: "stack-1",
    chainId: "chain-1",
    actionKind: "magic",
    actingPlayerId: "alice",
    cardInstanceId: "alice-magic",
    cardDefinitionId: "TEST-PTA-HAND-FLASH-DESTROY",
    targetInstanceIds: [],
    targetEffectFilterTags: [],
    chosenTiming: "flash",
    activationLabel: "flash",
    sourceActivationZone: "hand",
    ...overrides,
  };
}

function bsth09BaseState(): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    activePlayerId: "bob",
    step: "attack",
    cardInstances: [
      createCardInstance(card("BSTH09-R02"), {
        instanceId: "yatsuhashi",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 2,
      }),
      createCardInstance(card("BSTH09-R01"), {
        instanceId: "benben",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(card("BSTH09-X01"), {
        instanceId: "shinmyoumaru",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(card("BSTH09-X02"), {
        instanceId: "seija",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(flashDestroyMagic, {
        instanceId: "alice-magic",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(card("BSTH09-C01"), {
        instanceId: "alice-payment-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(card("BSTH09-C02"), {
        instanceId: "alice-payment-2",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
  };
}

function baseComputeState(
  sourceCardNo: string,
  sourceInstanceId: string
): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    activePlayerId: "bob",
    step: "attack",
    cardInstances: [
      createCardInstance(card(sourceCardNo), {
        instanceId: sourceInstanceId,
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "trash",
      }),
      createCardInstance(flashDestroyMagic, {
        instanceId: "alice-magic",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(card("BSTH09-C01"), {
        instanceId: "alice-payment-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
  };
}

function actualBssaGateEffect(): Effect {
  const effect = card("BSSA01-X01").effects?.find((candidate) =>
    candidate.steps.some(
      (step) => step.action.kind === "gate_flash_stack_hand_discard"
    )
  );
  expect(effect).toBeDefined();
  return effect!;
}

function actualBssaComputeState(options: {
  activePlayerId: string;
  step: GameState["step"];
}): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const state: GameState = {
    ...base,
    activePlayerId: options.activePlayerId,
    step: options.step,
    cardInstances: [
      createCardInstance(card("BSSA01-X01"), {
        instanceId: "bssa-gate",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(flashDestroyMagic, {
        instanceId: "alice-magic",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(card("BSTH09-C01"), {
        instanceId: "alice-payment-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
  };
  return executeEffect({
    chainId: "test:pay-to-act-hand-discard-gate:358",
    state,
    effect: actualBssaGateEffect(),
    sourceInstanceId: "bssa-gate",
    actingPlayerId: "bob",
    getCardDefinitionById,
  });
}

function expectBssaPending(
  state: GameState,
  overrides: Partial<ActiveStack>
): void {
  const pending = computePayToActHandDiscardGate(
    state,
    stack({
      cardInstanceId: "alice-magic",
      cardDefinitionId: "TEST-PTA-HAND-FLASH-DESTROY",
      activationLabel: "flash",
      ...overrides,
    }),
    getCardDefinitionById
  );
  expect(pending).not.toBeNull();
  expect(pending!.requiredCount).toBe(1);
  expect(pending!.candidateCardInstanceIds).toContain("alice-payment-1");
}

describe("gate_flash_stack_hand_discard: legal flow", () => {
  it("BSSA01-X01 型: 対象選択前に手札破棄 pending が立ち、選んだ手札をトラッシュへ送ってから解決へ進む", () => {
    const afterPass = aliceUsesMagicThenBobPasses(baseLegalFlowState());

    expect(afterPass.pendingPayToActHandDiscardGate).not.toBeNull();
    expect(afterPass.pendingEffectTargetSelection).toBeNull();
    const gate = afterPass.pendingPayToActHandDiscardGate!;
    expect(gate.actingPlayerId).toBe("alice");
    expect(gate.requiredCount).toBe(1);
    expect(gate.candidateCardInstanceIds).toContain("alice-payment-1");
    // holder(alice-magic)は耐性を持たないため、拒否は不発に直結する(耐性①非該当)。
    expect(gate.declineFizzles).toBe(true);
    expect(gate.candidateSlots[0]!.holderImmune).toBe(false);

    const resolve = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pay_to_act_hand_discard_gate");
    expect(resolve).toBeDefined();

    const afterPay = applyLegalAction({
      state: afterPass,
      action: resolve!,
      payToActHandDiscardCardInstanceIds: ["alice-payment-1"],
      ...lookups,
    }).state;

    expect(afterPay.pendingPayToActHandDiscardGate).toBeNull();
    expect(
      afterPay.cardInstances.find((c) => c.instanceId === "alice-payment-1")
        ?.zone
    ).toBe("trash");
    expect(afterPay.pendingEffectTargetSelection).not.toBeNull();
  });

  it("BSSA01-X01 型: 手札破棄を拒否すると対象効果だけが不発になり、手札は残る", () => {
    const afterPass = aliceUsesMagicThenBobPasses(baseLegalFlowState());
    const resolve = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pay_to_act_hand_discard_gate");
    expect(resolve).toBeDefined();

    const afterDecline = applyLegalAction({
      state: afterPass,
      action: resolve!,
      payToActHandDiscardGateDecline: true,
      ...lookups,
    }).state;

    expect(afterDecline.pendingPayToActHandDiscardGate).toBeNull();
    expect(afterDecline.pendingEffectTargetSelection).toBeNull();
    expect(
      afterDecline.cardInstances.find((c) => c.instanceId === "alice-payment-1")
        ?.zone
    ).toBe("hand");
    expect(
      afterDecline.cardInstances.find((c) => c.instanceId === "alice-magic")
        ?.zone
    ).toBe("trash");
  });
});

describe("gate_flash_stack_hand_discard: BSSA01-X01 timing scope and flash-label declarations", () => {
  it("BSSA01-X01 は自分のアタックステップ中だけ相手のフラッシュ見出し効果を拘束する", () => {
    const ownAttack = actualBssaComputeState({
      activePlayerId: "bob",
      step: "attack",
    });
    expectBssaPending(ownAttack, {
      actionKind: "declare_advent",
      sourceActivationZone: "hand",
    });

    const ownMain = actualBssaComputeState({
      activePlayerId: "bob",
      step: "main",
    });
    expect(
      computePayToActHandDiscardGate(
        ownMain,
        stack({
          actionKind: "declare_advent",
          cardInstanceId: "alice-magic",
          cardDefinitionId: "TEST-PTA-HAND-FLASH-DESTROY",
          activationLabel: "flash",
          sourceActivationZone: "hand",
        }),
        getCardDefinitionById
      )
    ).toBeNull();

    const opponentAttack = actualBssaComputeState({
      activePlayerId: "alice",
      step: "attack",
    });
    expect(
      computePayToActHandDiscardGate(
        opponentAttack,
        stack({
          actionKind: "declare_advent",
          cardInstanceId: "alice-magic",
          cardDefinitionId: "TEST-PTA-HAND-FLASH-DESTROY",
          activationLabel: "flash",
          sourceActivationZone: "hand",
        }),
        getCardDefinitionById
      )
    ).toBeNull();
  });

  it("BSSA01-X01 は使用窓ではなく見出しラベルでフラッシュ効果を判定する", () => {
    const state = actualBssaComputeState({
      activePlayerId: "bob",
      step: "attack",
    });

    expectBssaPending(state, {
      actionKind: "magic",
      activationLabel: "flash",
      chosenTiming: "main",
      sourceActivationZone: "hand",
    });
    expect(
      computePayToActHandDiscardGate(
        state,
        stack({
          actionKind: "magic",
          cardInstanceId: "alice-magic",
          cardDefinitionId: "TEST-PTA-HAND-FLASH-DESTROY",
          activationLabel: "none",
          chosenTiming: "flash",
          sourceActivationZone: "hand",
        }),
        getCardDefinitionById
      )
    ).toBeNull();
  });

  it("BSSA01-X01 はフラッシュ見出しのキーワード発揮宣言を zone に関係なく見る", () => {
    const state = actualBssaComputeState({
      activePlayerId: "bob",
      step: "attack",
    });
    const keywordDeclarations: Array<Partial<ActiveStack>> = [
      { actionKind: "declare_advent", sourceActivationZone: "hand" },
      { actionKind: "declare_advent", sourceActivationZone: "trash" },
      { actionKind: "declare_host_dual_advent", sourceActivationZone: "field" },
      { actionKind: "declare_dual_host_advent", sourceActivationZone: "hand" },
      { actionKind: "declare_manifest", sourceActivationZone: "hand" },
      { actionKind: "contract_combine", sourceActivationZone: "hand" },
      { actionKind: "link_aid", sourceActivationZone: "field" },
    ];

    for (const declaration of keywordDeclarations) {
      expectBssaPending(state, declaration);
    }
  });

  it("BSSA01-X01 は手札/手元/トラッシュ由来のフラッシュ効果も source zone で落とさない", () => {
    const state = actualBssaComputeState({
      activePlayerId: "bob",
      step: "attack",
    });
    const sourceZones: Array<Partial<ActiveStack>> = [
      { actionKind: "magic", sourceActivationZone: "hand" },
      { actionKind: "magic", sourceActivationZone: "set_aside" },
      { actionKind: "magic", sourceActivationZone: "trash" },
      { actionKind: "hand_card_effect", sourceActivationZone: "hand" },
      { actionKind: "hand_card_effect", sourceActivationZone: "set_aside" },
      { actionKind: "hand_card_effect", sourceActivationZone: "trash" },
    ];

    for (const sourceZone of sourceZones) {
      expectBssaPending(state, sourceZone);
    }
  });
});

/**
 * 耐性①(発揮するカード自身の耐性、例: BSKB01-R04/BSES01-C04「効果発揮後まで相手の効果を
 * 受けない」)は、10_rules/03d.md の「○○しなければ△△を発揮できない」型に対し、
 * 「破棄しなければ発揮できない」という要求自体は変わらず提示するが、拒否/候補0でも
 * 不発にしないというかたちで効く(ユーザー確認 2026-08-02)。BSKB01-R04 の宣言時自己耐性
 * (defense_immune CE、bskb01-cards.test.ts 同型)を直接注入し、alice-magic をその holder
 * として扱う。
 */
describe("gate_flash_stack_hand_discard: holder-side resistance (耐性①)", () => {
  function baseLegalFlowStateWithImmuneHolder(): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const selfImmunityCe: ContinuousEffect = {
      effectId: "alice-magic-self-immunity",
      sourceInstanceId: "alice-magic",
      sourceDefinitionId: "TEST-PTA-HAND-FLASH-DESTROY",
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "defense_immune",
      targetInstanceId: "alice-magic",
    };
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(flashDestroyMagic, {
          instanceId: "alice-magic",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(card("BSTH09-C01"), {
          instanceId: "alice-payment-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(card("BSTH09-C03"), {
          instanceId: "bob-target",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(card("BSSA01-X01"), {
          instanceId: "bssa-gate",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      activeContinuousEffects: [selfImmunityCe],
    };
    return executeEffect({
      chainId: "test:pay-to-act-hand-discard-gate:621",
      state,
      effect: bssa01StyleGate,
      sourceInstanceId: "bssa-gate",
      actingPlayerId: "bob",
      getCardDefinitionById,
    });
  }

  it("耐性①(defense_immune)を持つholderでも破棄pendingは提示される(declineFizzles=false)", () => {
    const afterPass = aliceUsesMagicThenBobPasses(
      baseLegalFlowStateWithImmuneHolder()
    );

    expect(afterPass.pendingPayToActHandDiscardGate).not.toBeNull();
    const gate = afterPass.pendingPayToActHandDiscardGate!;
    expect(gate.requiredCount).toBe(1);
    expect(gate.candidateCardInstanceIds).toContain("alice-payment-1");
    expect(gate.declineFizzles).toBe(false);
    expect(gate.candidateSlots).toHaveLength(1);
    expect(gate.candidateSlots[0]!.holderImmune).toBe(true);
  });

  it("耐性①を持つholderは、破棄を拒否しても不発にならず対象選択へ進み、手札は残る", () => {
    const afterPass = aliceUsesMagicThenBobPasses(
      baseLegalFlowStateWithImmuneHolder()
    );
    const resolve = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pay_to_act_hand_discard_gate");
    expect(resolve).toBeDefined();

    const afterDecline = applyLegalAction({
      state: afterPass,
      action: resolve!,
      payToActHandDiscardGateDecline: true,
      ...lookups,
    }).state;

    expect(afterDecline.pendingPayToActHandDiscardGate).toBeNull();
    // 不発なら pendingEffectTargetSelection は立たず alice-magic は trash へ送られる
    // (上の非耐性テスト参照)。耐性①持ちはそのまま対象選択へ進む。
    expect(afterDecline.pendingEffectTargetSelection).not.toBeNull();
    expect(
      afterDecline.cardInstances.find((c) => c.instanceId === "alice-payment-1")
        ?.zone
    ).toBe("hand");
    expect(
      afterDecline.cardInstances.find((c) => c.instanceId === "alice-magic")
        ?.zone
    ).not.toBe("trash");
  });
});

/**
 * 耐性①-b: 創界神ネクサス/魂状態のように、効果文中に明示の「○○を含む」opt-in が無い
 * 限り対象に含まれない構造的除外(card-filter.ts の既定除外)。Kirito のゲート action には
 * targetsGrandwalker/soulState 等の opt-in が無いため、これらの holder は耐性①相当として
 * 扱う(ユーザー確認 2026-08-02、「含む」の意味)。
 */
describe("gate_flash_stack_hand_discard: 「○○を含む」opt-in が無いカテゴリの構造的除外 (耐性①-b)", () => {
  it("創界神ネクサス(フィールド上)は「創界神ネクサスを含む」opt-inが無いゲートの対象外(declineFizzles=false)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state = executeEffect({
      chainId: "test:pay-to-act-hand-discard-gate:686",
      state: {
        ...base,
        activePlayerId: "bob",
        step: "attack",
        cardInstances: [
          createCardInstance(grandwalkerFlashNexus, {
            instanceId: "alice-grandwalker",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
          }),
          createCardInstance(card("BSTH09-C01"), {
            instanceId: "alice-payment-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(card("BSSA01-X01"), {
            instanceId: "bssa-gate",
            ownerPlayerId: "bob",
            controllerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      },
      effect: bssa01StyleGate,
      sourceInstanceId: "bssa-gate",
      actingPlayerId: "bob",
      getCardDefinitionById,
    });

    const pending = computePayToActHandDiscardGate(
      state,
      stack({
        actionKind: "field_card_effect",
        cardInstanceId: "alice-grandwalker",
        cardDefinitionId: "TEST-PTA-HAND-GRANDWALKER-FLASH",
        actingPlayerId: "alice",
        sourceActivationZone: "field",
      }),
      getCardDefinitionById
    );

    expect(pending).not.toBeNull();
    expect(pending!.requiredCount).toBe(1);
    expect(pending!.declineFizzles).toBe(false);
    expect(pending!.candidateSlots[0]!.holderImmune).toBe(true);
    expect(pending!.candidateCardInstanceIds).toContain("alice-payment-1");
  });

  it("魂状態カードは「魂状態を含む」opt-inが無いゲートの対象外(declineFizzles=false)", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(card("BSSL01-CX01"), {
          instanceId: "alice-soul",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(card("BSTH09-C01"), {
          instanceId: "alice-payment-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(card("BSSA01-X01"), {
          instanceId: "bssa-gate",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
      playerOverrides: [{ soulStateInstanceIds: ["alice-soul"] }],
    });
    const state = executeEffect({
      chainId: "test:pay-to-act-hand-discard-gate:762",
      state: { ...base, activePlayerId: "bob", step: "attack" },
      effect: bssa01StyleGate,
      sourceInstanceId: "bssa-gate",
      actingPlayerId: "bob",
      getCardDefinitionById,
    });

    const pending = computePayToActHandDiscardGate(
      state,
      stack({
        actionKind: "field_card_effect",
        cardInstanceId: "alice-soul",
        cardDefinitionId: "BSSL01-CX01",
        actingPlayerId: "alice",
        sourceActivationZone: "field",
      }),
      getCardDefinitionById
    );

    expect(pending).not.toBeNull();
    expect(pending!.requiredCount).toBe(1);
    expect(pending!.declineFizzles).toBe(false);
    expect(pending!.candidateSlots[0]!.holderImmune).toBe(true);
    expect(pending!.candidateCardInstanceIds).toContain("alice-payment-1");
  });

  it("ミラージュ(セット中)は「ミラージュを含む」opt-inが無いゲートの対象外(declineFizzles=false)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state = executeEffect({
      chainId: "test:pay-to-act-hand-discard-gate:791",
      state: {
        ...base,
        activePlayerId: "bob",
        step: "attack",
        cardInstances: [
          createCardInstance(mirageFlashMagic, {
            instanceId: "alice-mirage",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "mirage",
          }),
          createCardInstance(card("BSTH09-C01"), {
            instanceId: "alice-payment-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(card("BSSA01-X01"), {
            instanceId: "bssa-gate",
            ownerPlayerId: "bob",
            controllerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      },
      effect: bssa01StyleGate,
      sourceInstanceId: "bssa-gate",
      actingPlayerId: "bob",
      getCardDefinitionById,
    });

    const pending = computePayToActHandDiscardGate(
      state,
      stack({
        actionKind: "field_card_effect",
        cardInstanceId: "alice-mirage",
        cardDefinitionId: "TEST-PTA-HAND-MIRAGE-FLASH",
        actingPlayerId: "alice",
        sourceActivationZone: "field",
      }),
      getCardDefinitionById
    );

    expect(pending).not.toBeNull();
    expect(pending!.requiredCount).toBe(1);
    expect(pending!.declineFizzles).toBe(false);
    expect(pending!.candidateSlots[0]!.holderImmune).toBe(true);
    expect(pending!.candidateCardInstanceIds).toContain("alice-payment-1");
  });
});

describe("gate_flash_stack_hand_discard: card-specific matching", () => {
  it("BSTH03-R02 card-data はスタック効果内コスト後に flash 限定 gate を登録する", () => {
    const phoenix = card("BSTH03-R02");
    const stackEffect = phoenix.effects![2]!;
    expect(stackEffect.stub).toBeUndefined();
    expect(stackEffect.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(stackEffect.steps[0]!.action).toEqual({
      kind: "pay_cost",
      amount: 1,
    });
    expect(stackEffect.steps[1]!.connector).toBe("conditional_cost");
    expect(stackEffect.steps[1]!.action).toEqual({
      kind: "gate_flash_stack_hand_discard",
      player: "opponent",
      count: 1,
      targetEffectLabels: ["flash"],
      duration: { scope: "battle" },
    });
  });

  it("BSTH03-R02 は相手フラッシュだけを対象にし、スタック効果自身は gate 対象外", () => {
    const action = card("BSTH03-R02").effects![2]!.steps[1]!.action;
    const state = executeEffect({
      chainId: "test:pay-to-act-hand-discard-gate:865",
      state: baseComputeState("BSTH03-R02", "bsth03-source"),
      effect: {
        timing: { kind: "card_event", event: "attack" },
        steps: [{ action }],
      },
      sourceInstanceId: "bsth03-source",
      actingPlayerId: "bob",
      getCardDefinitionById,
    });

    expect(
      computePayToActHandDiscardGate(
        state,
        stack({ activationLabel: "flash", chosenTiming: "flash" }),
        getCardDefinitionById
      )
    ).not.toBeNull();
    expect(
      computePayToActHandDiscardGate(
        state,
        stack({ activationLabel: "stack", chosenTiming: "stack" }),
        getCardDefinitionById
      )
    ).toBeNull();
  });

  it("BSTH09-R02 は宣言時 zone が手札/手元の効果だけを対象にし、DynamicCount を compute 時に再評価する", () => {
    const yatsuhashi = card("BSTH09-R02");
    const state = executeEffect({
      chainId: "test:pay-to-act-hand-discard-gate:894",
      state: bsth09BaseState(),
      effect: yatsuhashi.effects![1]!,
      sourceInstanceId: "yatsuhashi",
      actingPlayerId: "bob",
      getCardDefinitionById,
    });

    const fromHand = computePayToActHandDiscardGate(
      state,
      stack({ sourceActivationZone: "hand" }),
      getCardDefinitionById
    );
    expect(fromHand).not.toBeNull();
    // 八橋 + 弁々 + 少名針妙丸 + 正邪 = 条件に合うスピリット4体、2つにつき1枚。
    expect(fromHand!.requiredCount).toBe(2);

    const fromField = computePayToActHandDiscardGate(
      state,
      stack({ sourceActivationZone: "field" }),
      getCardDefinitionById
    );
    expect(fromField).toBeNull();
  });
});
