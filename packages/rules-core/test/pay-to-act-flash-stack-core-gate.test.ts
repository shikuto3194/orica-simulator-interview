/**
 * pay-to-act フラッシュ/スタック効果コアゲート (gate_flash_stack_core / BSTS01-M03)
 *
 * ルール正源: manual/ai-reference/10_rules/03c_effect-text-interpretation.md
 *   §「○○しなければ△△を発揮できない」
 *
 * 「相手は[ゾーン]のコア1個をトラッシュに置かなければ、フラッシュ/スタック効果を
 * 発揮できない」型は **追加コスト(pay-to-act)ではなく、発揮の前提として相手にコア除去
 * (移動)を課す継続効果**。コスト経路でなく core_move/除去プリミティブで表現する
 * (耐性が効く)。
 *
 * 検証:
 *  (a) 相手のフラッシュ/スタック効果が解決される直前 (対象選択前) にコア1個を
 *      トラッシュへ強制移動する。
 *  (b) 効果保持カードが耐性を持つ / 移動可能なコアが無いなら、ゲート不成立で
 *      効果はそのまま解決する (no-core は decline 同様の不発)。
 *  (c) スタックパスは常に提示される (ゲート保留中も応答側に resolve アクション)。
 *  (d) 粒度＝発揮1回ごとにコア1個 (〔重複不可〕は同名抑止のみ)。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildBurstEffectLookup,
  buildHandActivatedEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type {
  ActiveStack,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import { computePayToActCoreGate } from "../src/legal/pay-to-act-core-gate";
import type { Effect } from "../src/dsl-types";

// alice (gated 側) のフラッシュマジック: 相手のスピリット1体を破壊する。
const flashDestroyMagic: CardDefinition = {
  cardNo: "TEST-PTA-FLASH-DESTROY",
  name: "テスト・フラッシュ破壊",
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

const nonFlashLabelMagic: CardDefinition = {
  cardNo: "TEST-PTA-NON-FLASH-LABEL-MAGIC",
  name: "テスト・窓だけフラッシュマジック",
  printedCategory: "magic",
  colors: ["green"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: ["フラッシュタイミングで、自分はデッキから1枚ドローする。"],
  keywordTags: [],
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      activationLabel: "none",
      steps: [{ action: { kind: "draw", count: 1 } }],
      textRef: [0],
    },
  ],
  sourceUrls: [],
  sourceConfidence: "C",
};

// ゲート発揮元 (bob が場に持つスピリット)。実体の効果は CE 登録で代用する。
const gateSpirit: CardDefinition = {
  cardNo: "TEST-PTA-GATE",
  name: "テスト・コアゲート",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  tribe: "暴嵐",
  sourceUrls: [],
  sourceConfidence: "C",
};

const plainSpirit: CardDefinition = {
  cardNo: "TEST-PTA-SPIRIT",
  name: "テスト・スピリット",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

// 耐性①-b(「創界神ネクサスを含む」opt-in が無いゲートの構造的除外)検証用。
const grandwalkerFieldNexus: CardDefinition = {
  cardNo: "TEST-PTA-GRANDWALKER",
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

const nonFlashTimingSpirit: CardDefinition = {
  cardNo: "TEST-PTA-NON-FLASH-TIMING",
  name: "テスト・窓だけフラッシュ",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["green"],
  textLines: [
    "ターンに1回、フラッシュタイミングで、自分はデッキから1枚ドローする。",
  ],
  keywordTags: [],
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      activationLabel: "none",
      executionMode: "optional",
      steps: [{ action: { kind: "draw", count: 1 } }],
      textRef: [0],
    },
  ],
  sourceUrls: [],
  sourceConfidence: "C",
};

const mainTimingSpirit: CardDefinition = {
  cardNo: "TEST-PTA-MAIN-TIMING",
  name: "テスト・メイン効果",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: ["メイン", "自分はデッキから1枚ドローする。"],
  keywordTags: [],
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      activationLabel: "main",
      steps: [{ action: { kind: "draw", count: 1 } }],
      textRef: [0, 1],
    },
  ],
  sourceUrls: [],
  sourceConfidence: "C",
};

const handMainTimingSpirit: CardDefinition = {
  cardNo: "TEST-PTA-HAND-MAIN-TIMING",
  name: "テスト・手札メイン効果",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [
    "手札にあるこのカードは、メインステップに自分はデッキから1枚ドローできる。",
  ],
  keywordTags: [],
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      activationLabel: "main",
      applicability: { zone: "hand" },
      executionMode: "optional",
      steps: [{ action: { kind: "draw", count: 1 } }],
      textRef: [0],
    },
  ],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = [
  flashDestroyMagic,
  nonFlashLabelMagic,
  gateSpirit,
  plainSpirit,
  grandwalkerFieldNexus,
  nonFlashTimingSpirit,
  mainTimingSpirit,
  handMainTimingSpirit,
];
const map = new Map(defs.map((d) => [d.cardNo, d]));
const lookups = {
  getCardDefinitionById: (id: string) => map.get(id),
  getRegisteredMagicActions: buildMagicLookup(defs),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(defs),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  getRegisteredBurstActions: buildBurstEffectLookup(defs),
  getRegisteredHandActivatedEffectActions: buildHandActivatedEffectLookup(defs),
};

// メカニズム検証用 (timingScope なしで常時アクティブにし、フラッシュタイミング使用で
// ゲートを確実に発火させる)。timingScope『自分のアタックステップ』の honoring は
// CE 登録テスト + isCEActiveForScope のユニットロジックで別途担保する。
const registerGateEffect: Effect = {
  timing: { kind: "card_event", event: "attack" },
  steps: [
    {
      action: {
        kind: "gate_flash_stack_core",
        player: "opponent",
        source: ["field", "reserve"],
        duration: { scope: "while_on_field" },
      },
    },
  ],
};

/**
 * alice (アクティブ・メインステップ) が自分の手札のフラッシュマジックを発揮する。
 * bob は gate CE 発揮元スピリットを 1 体場に持ち、gated 側 = alice。
 * alice の場には破壊対象のスピリットと、コアを乗せたスピリットがいる。
 * フラッシュタイミング使用 (chosenTiming = flash) なのでゲートが発火する。
 */
function baseState(opts: { aliceReserveCores?: number } = {}): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  let state: GameState = {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [
      createCardInstance(flashDestroyMagic, {
        instanceId: "magic-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      // alice のスピリット (破壊対象 + コア源候補)
      createCardInstance(plainSpirit, {
        instanceId: "alice-spirit",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 2,
      }),
      // bob のゲート発揮元
      createCardInstance(gateSpirit, {
        instanceId: "gate-1",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
  };
  if (opts.aliceReserveCores !== undefined) {
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice"
          ? { ...p, reserveNormalCoreCount: opts.aliceReserveCores! }
          : p
      ),
    };
  }
  // bob のゲート CE を登録する (発揮元 gate-1, gated = alice)。
  state = executeEffect({
    chainId: "test:pay-to-act-flash-stack-core-gate:310",
    state,
    effect: registerGateEffect,
    sourceInstanceId: "gate-1",
    actingPlayerId: "bob",
    getCardDefinitionById: lookups.getCardDefinitionById,
  });
  return state;
}

function stateWithNonFlashTimingSource(): GameState {
  const state = baseState();
  return {
    ...state,
    cardInstances: [
      ...state.cardInstances,
      createCardInstance(nonFlashTimingSpirit, {
        instanceId: "non-flash-source",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
    ],
  };
}

function stateWithMainTimingSource(): GameState {
  const state = baseState();
  return {
    ...state,
    cardInstances: [
      ...state.cardInstances,
      createCardInstance(mainTimingSpirit, {
        instanceId: "main-source",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
    ],
  };
}

function stateWithNonFlashLabelMagic(): GameState {
  const state = baseState();
  return {
    ...state,
    cardInstances: [
      ...state.cardInstances,
      createCardInstance(nonFlashLabelMagic, {
        instanceId: "magic-non-flash-label",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
  };
}

function stateWithHandMainTimingSource(): GameState {
  const state = baseState();
  return {
    ...state,
    cardInstances: [
      ...state.cardInstances,
      createCardInstance(handMainTimingSpirit, {
        instanceId: "hand-main-source",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
  };
}

function aliceUsesFlashMagic(state: GameState): GameState {
  const aliceActions = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  });
  const useMagic = aliceActions.find(
    (a) => a.kind === "use_magic" && a.sourceInstanceId === "magic-1"
  );
  expect(useMagic).toBeDefined();
  const afterUse = applyLegalAction({
    state,
    action: useMagic!,
    ...lookups,
  }).state;
  // bob がスタック窓をパス → 窓クローズ → 解決へ進む。
  const bobActions = getLegalActions({
    state: afterUse,
    actingPlayerId: "bob",
    ...lookups,
  });
  const pass = bobActions.find((a) => a.kind === "pass_stack");
  expect(pass).toBeDefined();
  return applyLegalAction({ state: afterUse, action: pass!, ...lookups }).state;
}

describe("gate_flash_stack_core: CE 登録", () => {
  it("gate_flash_stack_core アクションで gated player を対象に CE が登録される", () => {
    const state = baseState();
    const ces = state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "gate_flash_stack_core"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]!.targetInstanceId).toBe("alice"); // opponent of bob
    expect(ces[0]!.metadata?.["coreSourceZones"]).toEqual(["field", "reserve"]);
  });

  it("対象プレイヤーIDを保持するため、再計算を跨いでも失効しない", () => {
    const recomputed = recomputeContinuousEffects(baseState());
    const gate = recomputed.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "gate_flash_stack_core"
    );

    expect(gate).toBeDefined();
    expect(gate?.targetInstanceId).toBe("alice");
  });
});

describe("gate_flash_stack_core: 解決直前のコア除去 (a)", () => {
  it.each(["reserve", "alice-spirit", "protected"])(
    "持ち主が%sのソウルを選んで発揮前提を満たす",
    (sourceKind) => {
      const source = sourceKind === "protected" ? "alice-spirit" : sourceKind;
      let state = baseState({ aliceReserveCores: 2 });
      if (sourceKind === "protected")
        state = {
          ...state,
          activeContinuousEffects: [
            ...state.activeContinuousEffects,
            {
              effectId: "protect-normal",
              sourceInstanceId: source,
              sourceDefinitionId: state.cardInstances.find(
                (c) => c.instanceId === source
              )!.definitionId,
              actingPlayerId: "alice",
              targetInstanceId: source,
              modifierTag: "prevent_normal_core_move",
              duration: { scope: "turn" },
              createdAtTurn: state.turnNumber,
              createdAtAttackId: null,
            },
          ],
        };
      state.players = state.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              reserveSoulCoreCount: source === "reserve" ? 1 : 0,
              soulCoreLocation:
                source === "reserve"
                  ? { kind: "reserve" }
                  : { kind: "card", instanceId: source },
            }
          : p
      );
      if (source !== "reserve")
        state.cardInstances = state.cardInstances.map((c) =>
          c.instanceId === source ? { ...c, soulCoreCount: 1 } : c
        );
      const pending = aliceUsesFlashMagic(state);
      const action = getLegalActions({
        state: pending,
        actingPlayerId: "alice",
        ...lookups,
      }).find((a) => a.kind === "resolve_pay_to_act_core_gate")!;
      if (sourceKind === "protected") {
        expect(
          pending.pendingPayToActCoreGate!.candidates.find(
            (c) => c.containerId === source
          )
        ).toMatchObject({ normalAvailable: 0, soulAvailable: 1 });
        expect(() =>
          applyLegalAction({
            state: pending,
            action,
            payToActCoreSourceContainerId: source,
            payToActCoreKind: "normal",
            ...lookups,
          })
        ).toThrow(/not available/);
      }
      const after = applyLegalAction({
        state: pending,
        action,
        payToActCoreSourceContainerId: source,
        payToActCoreKind: "soul",
        ...lookups,
      }).state;
      expect(after.players.find((p) => p.id === "alice")).toMatchObject({
        trashSoulCoreCount: 1,
        trashNormalCoreCount: 0,
        reserveNormalCoreCount: 2,
      });
      expect(
        after.cardInstances.find((c) => c.instanceId === "alice-spirit")
          ?.normalCoreCount
      ).toBe(2);
      expect(after.pendingPayToActCoreGate).toBeNull();
    }
  );
  it("相手フラッシュ効果の解決直前にコアゲート pending が立ち、コア1個をトラッシュへ送る", () => {
    const state = baseState();
    const afterPass = aliceUsesFlashMagic(state);

    // 対象選択前にコアゲート pending が立つ。
    expect(afterPass.pendingPayToActCoreGate).not.toBeNull();
    expect(afterPass.pendingEffectTargetSelection).toBeNull();
    const gate = afterPass.pendingPayToActCoreGate!;
    expect(gate.actingPlayerId).toBe("alice");
    expect(gate.remainingCount).toBe(1);
    // 候補は alice の field カード (alice-spirit) のみ (reserve は 0)。
    expect(gate.candidates.map((c) => c.containerId)).toContain("alice-spirit");

    // alice が field カードからコア1個を選んでトラッシュへ。
    const aliceActions = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...lookups,
    });
    const resolve = aliceActions.find(
      (a) => a.kind === "resolve_pay_to_act_core_gate"
    );
    expect(resolve).toBeDefined();

    const afterPay = applyLegalAction({
      state: afterPass,
      action: resolve!,
      payToActCoreSourceContainerId: "alice-spirit",
      ...lookups,
    }).state;

    // コアがトラッシュへ移動した。
    const aliceSpirit = afterPay.cardInstances.find(
      (c) => c.instanceId === "alice-spirit"
    )!;
    expect(aliceSpirit.normalCoreCount).toBe(1); // 2 → 1
    const alice = afterPay.players.find((p) => p.id === "alice")!;
    expect(alice.trashNormalCoreCount).toBe(1);

    // ゲート支払い後にフラッシュ効果が解決へ進む (gate pending 解消)。
    expect(afterPay.pendingPayToActCoreGate).toBeNull();
  });

  it("本文『フラッシュタイミングで』型の非フラッシュ効果にはコアゲート pending を立てない", () => {
    const state = stateWithNonFlashTimingSource();
    const aliceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    });
    const useField = aliceActions.find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "non-flash-source"
    );
    expect(useField).toBeDefined();
    const afterUse = applyLegalAction({
      state,
      action: useField!,
      ...lookups,
    }).state;
    const bobActions = getLegalActions({
      state: afterUse,
      actingPlayerId: "bob",
      ...lookups,
    });
    const pass = bobActions.find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();

    const afterPass = applyLegalAction({
      state: afterUse,
      action: pass!,
      ...lookups,
    }).state;

    expect(afterPass.pendingPayToActCoreGate).toBeNull();
    expect(
      afterPass.log.some((entry) =>
        entry.includes("effect:gate_flash_stack_core:pending")
      )
    ).toBe(false);
  });

  it("メイン効果にはコアゲート pending を立てない", () => {
    const state = stateWithMainTimingSource();
    const aliceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    });
    const useField = aliceActions.find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceInstanceId === "main-source"
    );
    expect(useField).toBeDefined();

    const afterUse = applyLegalAction({
      state,
      action: useField!,
      ...lookups,
    }).state;
    const bobActions = getLegalActions({
      state: afterUse,
      actingPlayerId: "bob",
      ...lookups,
    });
    const pass = bobActions.find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();

    const afterPass = applyLegalAction({
      state: afterUse,
      action: pass!,
      ...lookups,
    }).state;

    expect(afterPass.pendingPayToActCoreGate).toBeNull();
    expect(
      afterPass.log.some((entry) =>
        entry.includes("effect:gate_flash_stack_core:pending")
      )
    ).toBe(false);
  });

  it("手札のメイン起動効果にはコアゲート pending を立てない", () => {
    const state = stateWithHandMainTimingSource();
    const aliceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    });
    const useHand = aliceActions.find(
      (a) =>
        a.kind === "use_hand_card_effect" &&
        a.sourceInstanceId === "hand-main-source"
    );
    expect(useHand).toBeDefined();
    expect(
      useHand && useHand.kind === "use_hand_card_effect" && useHand.chosenTiming
    ).toBe("main");

    const afterUse = applyLegalAction({
      state,
      action: useHand!,
      ...lookups,
    }).state;
    const bobActions = getLegalActions({
      state: afterUse,
      actingPlayerId: "bob",
      ...lookups,
    });
    const pass = bobActions.find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();

    const afterPass = applyLegalAction({
      state: afterUse,
      action: pass!,
      ...lookups,
    }).state;

    expect(afterPass.pendingPayToActCoreGate).toBeNull();
    expect(
      afterPass.log.some((entry) =>
        entry.includes("effect:gate_flash_stack_core:pending")
      )
    ).toBe(false);
  });

  it("magic でも activationLabel=none の flash 窓効果にはコアゲート pending を立てない", () => {
    const state = stateWithNonFlashLabelMagic();
    const aliceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    });
    const useMagic = aliceActions.find(
      (a) =>
        a.kind === "use_magic" && a.sourceInstanceId === "magic-non-flash-label"
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

    const afterPass = applyLegalAction({
      state: afterUse,
      action: pass!,
      ...lookups,
    }).state;

    expect(afterPass.pendingPayToActCoreGate).toBeNull();
    expect(
      afterPass.log.some((entry) =>
        entry.includes("effect:gate_flash_stack_core:pending")
      )
    ).toBe(false);
  });
});

describe("gate_flash_stack_core: 移動可能なコアが無い (b)", () => {
  it("gated 側に取れるコアが無ければゲート不成立で効果はそのまま解決する", () => {
    // alice の field スピリットからコアを抜き、reserve も 0 にする。
    let state = baseState({ aliceReserveCores: 0 });
    state = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === "alice-spirit" ? { ...c, normalCoreCount: 0 } : c
      ),
    };
    const afterPass = aliceUsesFlashMagic(state);

    // 候補ゼロ → 「置かなければ発揮できない」を満たせず効果は不発 (空撃ち)。
    // decline 用 pending は挟まず即不発になり、マジックはトラッシュへ送られる。
    expect(afterPass.pendingPayToActCoreGate).toBeNull();
    expect(afterPass.pendingEffectTargetSelection).toBeNull();
    const magic = afterPass.cardInstances.find(
      (c) => c.instanceId === "magic-1"
    )!;
    expect(magic.zone).toBe("trash");
  });
});

/**
 * 耐性①(発揮するカード自身)は「コアを置かねば発揮できない」の拘束力(不発の要否)だけを
 * 左右する。要求自体(コア除去 pending)は耐性の有無を問わず変わらず提示され、拒否/
 * 候補0でも不発にならない(ユーザー確認 2026-08-02、gate_flash_stack_hand_discard と同型)。
 */
describe("gate_flash_stack_core: 効果保持カードが耐性 (b')", () => {
  it("フラッシュ効果の保持カードが相手(bob)の効果に耐性を持つなら、要求は提示されるが拒否/候補0でも不発にならない", () => {
    let state = baseState();
    // alice の magic-1 (効果保持カード) を bob の効果に耐性化する defense_immune CE。
    const immunity: ContinuousEffect = {
      effectId: "di-magic-1",
      sourceInstanceId: "magic-1",
      sourceDefinitionId: "TEST-PTA-FLASH-DESTROY",
      actingPlayerId: "bob", // bob 起因の効果に耐性 (gate CE の actingPlayerId と一致)
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "defense_immune",
      targetInstanceId: "magic-1",
    };
    state = {
      ...state,
      activeContinuousEffects: [...state.activeContinuousEffects, immunity],
    };
    const afterPass = aliceUsesFlashMagic(state);

    // 耐性①-a(defense_immune)は非拘束(declineFizzles=false)だが、要求自体は提示される。
    expect(afterPass.pendingPayToActCoreGate).not.toBeNull();
    expect(afterPass.pendingPayToActCoreGate!.declineFizzles).toBe(false);

    // 拒否してもコアは移動せず、かつ不発にもならず対象選択(相手スピリット破壊)へ進む。
    const aliceActions = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...lookups,
    });
    const resolve = aliceActions.find(
      (a) => a.kind === "resolve_pay_to_act_core_gate"
    );
    expect(resolve).toBeDefined();
    const afterDecline = applyLegalAction({
      state: afterPass,
      action: resolve!,
      payToActCoreGateDecline: true,
      ...lookups,
    }).state;

    expect(afterDecline.pendingPayToActCoreGate).toBeNull();
    const aliceSpirit = afterDecline.cardInstances.find(
      (c) => c.instanceId === "alice-spirit"
    )!;
    expect(aliceSpirit.normalCoreCount).toBe(2);
    expect(afterDecline.pendingEffectTargetSelection).not.toBeNull();
  });

  it("創界神ネクサス(フィールド上)は「創界神ネクサスを含む」opt-inが無いゲートの対象外(declineFizzles=false)", () => {
    const state = baseState();
    const withGrandwalker: GameState = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(grandwalkerFieldNexus, {
          instanceId: "alice-grandwalker",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        }),
      ],
    };
    const stack: ActiveStack = {
      stackId: "s1",
      chainId: "c1",
      actionKind: "field_card_effect",
      actingPlayerId: "alice",
      cardInstanceId: "alice-grandwalker",
      cardDefinitionId: "TEST-PTA-GRANDWALKER",
      targetInstanceIds: [],
      targetEffectFilterTags: [],
      chosenTiming: "flash",
      activationLabel: "flash",
    };

    const pending = computePayToActCoreGate(
      withGrandwalker,
      stack,
      lookups.getCardDefinitionById
    );

    expect(pending).not.toBeNull();
    expect(pending!.declineFizzles).toBe(false);
    // 対照: grandwalkerData を持たない通常スピリット(alice-spirit)は拘束される。
    const plainStack: ActiveStack = {
      ...stack,
      cardInstanceId: "alice-spirit",
      cardDefinitionId: "TEST-PTA-SPIRIT",
    };
    const plainPending = computePayToActCoreGate(
      withGrandwalker,
      plainStack,
      lookups.getCardDefinitionById
    );
    expect(plainPending).not.toBeNull();
    expect(plainPending!.declineFizzles).toBe(true);
  });
});

/**
 * ②コア源候補自体の耐性: 創界神/導界者/創界石ネクサス(独立コア管理・「含む」opt-in
 * 無しの構造的除外)や defense_immune 持ちのフィールドカードは、コア除去候補から
 * 除外される(10_rules/03d.md 「②除去不可な場所からは移動不可」、
 * gate_flash_stack_hand_discard の candidateCardsForGateSlot と同型)。
 */
describe("gate_flash_stack_core: コア源候補自体の耐性 (b'')", () => {
  it("gated側の唯一のコア源が創界神ネクサスなら候補から除外され、他に候補が無ければ即不発", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 0 }],
    });
    let state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(flashDestroyMagic, {
          instanceId: "magic-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(grandwalkerFieldNexus, {
          instanceId: "alice-grandwalker",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 3,
        }),
        createCardInstance(gateSpirit, {
          instanceId: "gate-1",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    state = executeEffect({
      chainId: "test:pay-to-act-flash-stack-core-gate:806",
      state,
      effect: registerGateEffect,
      sourceInstanceId: "gate-1",
      actingPlayerId: "bob",
      getCardDefinitionById: lookups.getCardDefinitionById,
    });

    const afterPass = aliceUsesFlashMagic(state);

    // 創界神ネクサスのコアは候補から除外され、他に候補(通常スピリット/リザーブ)が
    // 無いため即不発(空撃ち)。holder(magic-1)自体は非免除(bindingRequiredCount>0)。
    expect(afterPass.pendingPayToActCoreGate).toBeNull();
    expect(afterPass.pendingEffectTargetSelection).toBeNull();
    const magic = afterPass.cardInstances.find(
      (c) => c.instanceId === "magic-1"
    )!;
    expect(magic.zone).toBe("trash");
    // 創界神ネクサスのコアは移動していない。
    const grandwalker = afterPass.cardInstances.find(
      (c) => c.instanceId === "alice-grandwalker"
    )!;
    expect(grandwalker.normalCoreCount).toBe(3);
  });

  it("創界神ネクサスと通常スピリットが両方ある場合、候補には通常スピリットだけが挙がる", () => {
    let state = baseState();
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(grandwalkerFieldNexus, {
          instanceId: "alice-grandwalker",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 3,
        }),
      ],
    };
    const afterPass = aliceUsesFlashMagic(state);

    expect(afterPass.pendingPayToActCoreGate).not.toBeNull();
    const gate = afterPass.pendingPayToActCoreGate!;
    const containerIds = gate.candidates.map((c) => c.containerId);
    expect(containerIds).toContain("alice-spirit");
    expect(containerIds).not.toContain("alice-grandwalker");
  });

  it("available は通常 core_move と同じくコア最低残存数耐性 (cannot_reduce_cores_below) を差し引く", () => {
    // alice-spirit はコア2個。「コアが1個より少なくならない」耐性で取れるのは1個だけ。
    let state = baseState();
    const coreMinimumCe: ContinuousEffect = {
      effectId: "ce-core-minimum-alice-spirit",
      sourceInstanceId: "alice-spirit",
      sourceDefinitionId: "TEST-PTA-SPIRIT",
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cannot_reduce_cores_below",
      targetInstanceId: "alice-spirit",
      metadata: { coreMinimum: 1 },
    };
    state = {
      ...state,
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        coreMinimumCe,
      ],
    };
    const afterPass = aliceUsesFlashMagic(state);

    expect(afterPass.pendingPayToActCoreGate).not.toBeNull();
    const candidate = afterPass.pendingPayToActCoreGate!.candidates.find(
      (c) => c.containerId === "alice-spirit"
    );
    // 旧実装は raw normalCoreCount(=2) を渡しており耐性を無視していた。
    expect(candidate?.available).toBe(1);
  });

  it("コア最低残存数耐性で1個も取れないカードは候補から除外される", () => {
    let state = baseState({ aliceReserveCores: 0 });
    const coreMinimumCe: ContinuousEffect = {
      effectId: "ce-core-minimum-full-alice-spirit",
      sourceInstanceId: "alice-spirit",
      sourceDefinitionId: "TEST-PTA-SPIRIT",
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cannot_reduce_cores_below",
      targetInstanceId: "alice-spirit",
      // alice-spirit のコアは2個なので、下限2 = 1個も取れない。
      metadata: { coreMinimum: 2 },
    };
    state = {
      ...state,
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        coreMinimumCe,
      ],
    };
    const afterPass = aliceUsesFlashMagic(state);

    // 候補ゼロ → 「置かなければ発揮できない」を満たせず不発 (空撃ち)。
    expect(afterPass.pendingPayToActCoreGate).toBeNull();
    expect(
      afterPass.cardInstances.find((c) => c.instanceId === "alice-spirit")
        ?.normalCoreCount
    ).toBe(2);
    expect(
      afterPass.cardInstances.find((c) => c.instanceId === "magic-1")?.zone
    ).toBe("trash");
  });

  it("対象ロック (cannot_be_targeted) 持ちは候補から除外される（コア奪取＝コアのある場所＝カード対象）", () => {
    // 「コア奪取 → コアのある場所対象」。コアのある場所がカードならカード対象なので、
    // 「対象にされない」耐性が効く（ユーザー確認 2026-08-02）。
    let state = baseState({ aliceReserveCores: 0 });
    const cannotBeTargeted: ContinuousEffect = {
      effectId: "ce-cannot-be-targeted-alice-spirit",
      sourceInstanceId: "alice-spirit",
      sourceDefinitionId: "TEST-PTA-SPIRIT",
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cannot_be_targeted",
      targetInstanceId: "alice-spirit",
    };
    state = {
      ...state,
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        cannotBeTargeted,
      ],
    };
    const afterPass = aliceUsesFlashMagic(state);

    // 唯一のコア源が対象ロック持ち → 候補ゼロ → 不発。コアは動かない。
    expect(afterPass.pendingPayToActCoreGate).toBeNull();
    expect(
      afterPass.cardInstances.find((c) => c.instanceId === "alice-spirit")
        ?.normalCoreCount
    ).toBe(2);
  });
});

describe("gate_flash_stack_core: スタックパスは常に提示 (c)", () => {
  it("コアゲート pending 中も応答側 (alice) に resolve アクションが提示される", () => {
    const state = baseState();
    const afterPass = aliceUsesFlashMagic(state);
    expect(afterPass.pendingPayToActCoreGate).not.toBeNull();

    const aliceActions = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(
      aliceActions.some((a) => a.kind === "resolve_pay_to_act_core_gate")
    ).toBe(true);
  });

  it("decline でゲートを支払わないと、そのフラッシュ効果は不発 (空撃ち) になる", () => {
    const state = baseState();
    const afterPass = aliceUsesFlashMagic(state);
    expect(afterPass.pendingPayToActCoreGate).not.toBeNull();

    const aliceActions = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...lookups,
    });
    const resolve = aliceActions.find(
      (a) => a.kind === "resolve_pay_to_act_core_gate"
    );
    const afterDecline = applyLegalAction({
      state: afterPass,
      action: resolve!,
      payToActCoreGateDecline: true,
      ...lookups,
    }).state;

    // pending 解消。コアは移動していない (alice-spirit は 2 のまま)。
    expect(afterDecline.pendingPayToActCoreGate).toBeNull();
    const aliceSpirit = afterDecline.cardInstances.find(
      (c) => c.instanceId === "alice-spirit"
    )!;
    expect(aliceSpirit.normalCoreCount).toBe(2);
  });
});

describe("gate_flash_stack_core: 〔重複不可〕は同名のみ抑止 (d)", () => {
  it("同名ゲートを2回登録しても CE は1つ (no_duplicate)", () => {
    let state = baseState();
    // 同じ発揮元・同名でもう一度登録を試みる (no_duplicate により増えない想定だが、
    // ここでは executeEffect が usageLimit を見ないため CE 自体は複数になりうる。
    // computePayToActCoreGate 側が sourceDefinitionId 重複を 1 件に集約することを検証する)。
    state = executeEffect({
      chainId: "test:pay-to-act-flash-stack-core-gate:1006",
      state,
      effect: registerGateEffect,
      sourceInstanceId: "gate-1",
      actingPlayerId: "bob",
      getCardDefinitionById: lookups.getCardDefinitionById,
    });
    const afterPass = aliceUsesFlashMagic(state);
    // 同名 (同 sourceDefinitionId) ゲートは 1 件に集約 → remainingCount は 1。
    expect(afterPass.pendingPayToActCoreGate).not.toBeNull();
    expect(afterPass.pendingPayToActCoreGate!.remainingCount).toBe(1);
  });
});
