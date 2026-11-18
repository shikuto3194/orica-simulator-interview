/**
 * マジック使用: 効果対象選択はスタック窓クローズ後 (解決時) に行う。
 *
 * ルール正源:
 * - 03a_cost-payment.md 標準パイプライン: 2.コスト支払い → 3.対象の選択。
 * - 02_turn-flow-and-timing.md / 08_stack-window-and-priority-loop.md:
 *   「コスト支払い完了後に窓が開く」。
 * → スタック窓はコスト支払い後・対象選択前に開く。よって対象は窓クローズ後の
 *   解決時に、その時点の盤面から選ぶ。
 *
 * 旧実装は宣言時 (窓を開く前) に対象を確定していた。本テストは GUI 経路
 * (use_magic を対象なしで dispatch) で、窓クローズ後に pendingEffectTargetSelection が
 * 立ち、現在の盤面から候補が算出されることを検証する。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildBurstEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const flashDestroyMagic: CardDefinition = {
  cardNo: "TEST-FLASH-DESTROY",
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

const bobSpirit: CardDefinition = {
  cardNo: "TEST-BOB-SPIRIT",
  name: "ボブスピリット",
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

// bob の応答用: 自分のスピリット1体を手札に戻す (回避) スタックマジック。
// 相手 (alice) の使用に割り込んで応答するため mode:"stack" (スタック効果)。
// フラッシュ効果はスタック効果ではない (公式Q&A Q5) ため、スタック窓での応答には使えない。
const bobBounceMagic: CardDefinition = {
  cardNo: "TEST-BOB-BOUNCE",
  name: "テスト・自スピリット回収",
  printedCategory: "magic",
  colors: ["blue"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: ["スタック", "自分のスピリット1体を手札に戻す。"],
  keywordTags: [],
  effects: [
    {
      timing: { kind: "activated", mode: "stack" },
      steps: [
        {
          action: {
            kind: "bounce",
            target: {
              kind: "filter",
              player: "self",
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

// bob の応答用スタック破壊マジック (カスケードテスト用)。相手スピリット1体を破壊する。
// alice のフラッシュ使用に割り込む応答なので mode:"stack"。
const bobStackDestroyMagic: CardDefinition = {
  cardNo: "TEST-BOB-STACK-DESTROY",
  name: "テスト・スタック破壊",
  printedCategory: "magic",
  colors: ["blue"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: ["スタック", "相手のスピリット1体を破壊する。"],
  keywordTags: [],
  effects: [
    {
      timing: { kind: "activated", mode: "stack" },
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

// フィールド起動効果 (use_field_card_effect) 版: 場のスピリットの活性化フラッシュ効果で
// 相手スピリット1体を破壊する。対象選択は窓クローズ後 (種別非依存延期) であることを検証する。
const fieldEffectSpirit: CardDefinition = {
  cardNo: "TEST-FIELD-EFFECT",
  name: "テスト・フィールド起動",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["red"],
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

const defs = [
  flashDestroyMagic,
  bobSpirit,
  bobBounceMagic,
  bobStackDestroyMagic,
  fieldEffectSpirit,
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
};

function baseState(): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    activePlayerId: "alice",
    step: "main",
    cardInstances: [
      createCardInstance(flashDestroyMagic, {
        instanceId: "magic-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(bobSpirit, {
        instanceId: "bob-a",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(bobSpirit, {
        instanceId: "bob-b",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
  };
}

describe("効果対象選択はスタック窓の後 (種別非依存)", () => {
  it("対象なしで use_magic → 窓が開く → bob パス後に対象選択 pending が立つ → 解決で破壊", () => {
    const state = baseState();

    // alice: 対象を渡さずにフラッシュマジックを使用する (GUI 経路)。
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
      // targetInstanceIds は渡さない (窓クローズ後に選ぶ)
    }).state;

    // コスト支払い後にスタック窓が開く。対象はまだ確定していない。
    expect(afterUse.stackWindow).not.toBeNull();
    expect(afterUse.pendingEffectTargetSelection).toBeNull();

    // bob がスタック窓をパス → 窓クローズ → 解決時に対象選択 pending が立つ。
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

    expect(afterPass.stackWindow).toBeNull();
    const pending = afterPass.pendingEffectTargetSelection;
    expect(pending).not.toBeNull();
    expect(pending!.actingPlayerId).toBe("alice");
    expect(pending!.requiredTargetCount).toBe(1);
    // 候補は窓クローズ後の現在の盤面 (bob の場のスピリット2体) から算出される。
    expect([...pending!.candidateInstanceIds].sort()).toEqual([
      "bob-a",
      "bob-b",
    ]);

    // alice が対象を選んで解決 → bob-a が破壊される。
    const resolveActions = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...lookups,
    });
    const resolve = resolveActions.find(
      (a) => a.kind === "resolve_pending_effect_target"
    );
    expect(resolve).toBeDefined();

    const resolved = applyLegalAction({
      state: afterPass,
      action: resolve!,
      targetInstanceIds: ["bob-a"],
      ...lookups,
    }).state;

    expect(resolved.pendingEffectTargetSelection).toBeNull();
    const bobA = resolved.cardInstances.find((c) => c.instanceId === "bob-a");
    // 破壊されてフィールドを離れている (トラッシュ or 場から消滅)。
    expect(bobA?.zone === "field").toBe(false);
    // 選ばなかった bob-b は場に残る。
    const bobB = resolved.cardInstances.find((c) => c.instanceId === "bob-b");
    expect(bobB?.zone).toBe("field");
    // マジックはトラッシュへ。
    const magic = resolved.cardInstances.find(
      (c) => c.instanceId === "magic-1"
    );
    expect(magic?.zone).toBe("trash");
  });

  it("後方互換: 宣言時に対象を渡せば従来どおり (対象選択 pending を立てない)", () => {
    const state = baseState();
    const useMagic = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "use_magic" && a.sourceInstanceId === "magic-1");

    const afterUse = applyLegalAction({
      state,
      action: useMagic!,
      targetInstanceIds: ["bob-a"],
      ...lookups,
    }).state;
    // bob パス → 解決。宣言時対象があるので pending は立たず即解決する。
    const pass = getLegalActions({
      state: afterUse,
      actingPlayerId: "bob",
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    const resolved = applyLegalAction({
      state: afterUse,
      action: pass!,
      ...lookups,
    }).state;

    expect(resolved.pendingEffectTargetSelection).toBeNull();
    const bobA = resolved.cardInstances.find((c) => c.instanceId === "bob-a");
    expect(bobA?.zone === "field").toBe(false);
  });

  it("リオーダーの本旨: 窓内で bob が bob-a を手札に戻すと、対象候補は窓クローズ後の盤面 (bob-b のみ) になる", () => {
    // 旧実装 (宣言時に対象確定) なら alice が bob-a を選んだ後に bob が回避でき、
    // magic は不発 (fizzle) になっていた。新実装は窓クローズ後に bob-b から選び直せる。
    const state: GameState = {
      ...baseState(),
      cardInstances: [
        ...baseState().cardInstances,
        createCardInstance(bobBounceMagic, {
          instanceId: "bob-bounce",
          ownerPlayerId: "bob",
          zone: "hand",
        }),
      ],
    };

    // alice: 対象なしでフラッシュ破壊マジックを使用 → スタック窓 (bob 優先権)。
    const useMagic = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "use_magic" && a.sourceInstanceId === "magic-1");
    const afterUse = applyLegalAction({
      state,
      action: useMagic!,
      ...lookups,
    }).state;
    expect(afterUse.stackWindow).not.toBeNull();

    // bob: 窓内で自分のフラッシュマジックを使い、bob-a を手札に戻す (回避)。
    // bob 側は宣言時に対象を渡す (テスト経路) ので即焼き込みで解決する。
    const bobBounce = getLegalActions({
      state: afterUse,
      actingPlayerId: "bob",
      ...lookups,
    }).find(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "bob-bounce"
    );
    expect(bobBounce).toBeDefined();
    const afterBobBounce = applyLegalAction({
      state: afterUse,
      action: bobBounce!,
      targetInstanceIds: ["bob-a"],
      ...lookups,
    }).state;

    // bob の応答に対する alice のサブ窓 → alice パスでカスケード解決。
    const alicePass = getLegalActions({
      state: afterBobBounce,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    expect(alicePass).toBeDefined();
    let afterAlicePass = applyLegalAction({
      state: afterBobBounce,
      action: alicePass!,
      ...lookups,
    }).state;

    // bob にまだ優先権 (外側 alice magic 窓) が残る場合はパスして窓を閉じる。
    const bobPass = getLegalActions({
      state: afterAlicePass,
      actingPlayerId: "bob",
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    if (bobPass) {
      afterAlicePass = applyLegalAction({
        state: afterAlicePass,
        action: bobPass,
        ...lookups,
      }).state;
    }

    // bob-a は手札に戻っている。alice magic の対象選択 pending の候補は bob-b のみ。
    const bobA = afterAlicePass.cardInstances.find(
      (c) => c.instanceId === "bob-a"
    );
    expect(bobA?.zone).toBe("hand");
    const pending = afterAlicePass.pendingEffectTargetSelection;
    expect(pending).not.toBeNull();
    expect(pending!.candidateInstanceIds).toEqual(["bob-b"]);
  });

  it("カスケード resumable: 多段 (両者とも対象なし) で各スタックを順に窓後選択し remainingStacks で継続", () => {
    // alice magic A (bob を対象) → bob が応答 magic B (alice を対象) → 両者対象なし dispatch。
    // カスケード [B, A] を、B→A の順に各自の窓後対象選択で解決する (resumable, remainingStacks)。
    const aliceSpirit = createCardInstance(bobSpirit, {
      instanceId: "alice-a",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const bobMagic = createCardInstance(bobStackDestroyMagic, {
      instanceId: "magic-2",
      ownerPlayerId: "bob",
      zone: "hand",
    });
    const state: GameState = {
      ...baseState(),
      cardInstances: [...baseState().cardInstances, aliceSpirit, bobMagic],
    };

    // 1) alice: magic A を対象なしで使用 → スタック窓 (bob 優先)。
    const aMagic = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "use_magic" && a.sourceInstanceId === "magic-1");
    const afterA = applyLegalAction({
      state,
      action: aMagic!,
      ...lookups,
    }).state;

    // 2) bob: 応答で magic B を対象なしで使用 → サブ窓 (alice 優先)。
    const bMagic = getLegalActions({
      state: afterA,
      actingPlayerId: "bob",
      ...lookups,
    }).find((a) => a.kind === "use_magic" && a.sourceInstanceId === "magic-2");
    expect(bMagic).toBeDefined();
    const afterB = applyLegalAction({
      state: afterA,
      action: bMagic!,
      ...lookups,
    }).state;

    // 3) alice パス → カスケード [B, A]。B (bob の magic) がまず対象選択待ちで中断。
    const alicePass = getLegalActions({
      state: afterB,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    const afterAlicePass = applyLegalAction({
      state: afterB,
      action: alicePass!,
      ...lookups,
    }).state;
    const pendingB = afterAlicePass.pendingEffectTargetSelection;
    expect(pendingB).not.toBeNull();
    expect(pendingB!.actingPlayerId).toBe("bob");
    // 残カスケード (A) が退避されている。
    expect(pendingB!.remainingStacks).toHaveLength(1);

    // 4) bob が B の対象 (alice-a) を選択 → B 解決 → 残 A が対象選択待ちで再中断。
    const bobResolve = getLegalActions({
      state: afterAlicePass,
      actingPlayerId: "bob",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    const afterBResolve = applyLegalAction({
      state: afterAlicePass,
      action: bobResolve!,
      targetInstanceIds: ["alice-a"],
      ...lookups,
    }).state;
    // alice-a は B により破壊。次は A の対象選択 (alice 宛)。
    expect(
      afterBResolve.cardInstances.find((c) => c.instanceId === "alice-a")
        ?.zone === "field"
    ).toBe(false);
    const pendingA = afterBResolve.pendingEffectTargetSelection;
    expect(pendingA).not.toBeNull();
    expect(pendingA!.actingPlayerId).toBe("alice");

    // 5) alice が A の対象 (bob-a) を選択 → A 解決。カスケード完了。
    const aliceResolve = getLegalActions({
      state: afterBResolve,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    const final = applyLegalAction({
      state: afterBResolve,
      action: aliceResolve!,
      targetInstanceIds: ["bob-a"],
      ...lookups,
    }).state;
    expect(final.pendingEffectTargetSelection).toBeNull();
    expect(
      final.cardInstances.find((c) => c.instanceId === "bob-a")?.zone ===
        "field"
    ).toBe(false);
    // 選ばれなかった bob-b は残る。
    expect(
      final.cardInstances.find((c) => c.instanceId === "bob-b")?.zone
    ).toBe("field");
  });

  it("種別汎用: フィールド起動効果 (use_field_card_effect) も窓後に対象選択する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(fieldEffectSpirit, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(bobSpirit, {
          instanceId: "bob-a",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(bobSpirit, {
          instanceId: "bob-b",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    // alice: フィールド起動効果を対象なしで発揮 → スタック窓。
    const fieldAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (a) =>
        a.kind === "use_field_card_effect" && a.sourceInstanceId === "src-1"
    );
    expect(fieldAction).toBeDefined();
    const afterUse = applyLegalAction({
      state,
      action: fieldAction!,
      ...lookups,
    }).state;
    expect(afterUse.stackWindow).not.toBeNull();
    expect(afterUse.pendingEffectTargetSelection).toBeNull();

    // bob パス → 窓クローズ → 窓後に対象選択 pending。
    const pass = getLegalActions({
      state: afterUse,
      actingPlayerId: "bob",
      ...lookups,
    }).find((a) => a.kind === "pass_stack");
    const afterPass = applyLegalAction({
      state: afterUse,
      action: pass!,
      ...lookups,
    }).state;
    const pending = afterPass.pendingEffectTargetSelection;
    expect(pending).not.toBeNull();
    expect(pending!.actingPlayerId).toBe("alice");
    expect([...pending!.candidateInstanceIds].sort()).toEqual([
      "bob-a",
      "bob-b",
    ]);

    // alice が対象 (bob-a) を選択 → 破壊。
    const resolve = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...lookups,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    const resolved = applyLegalAction({
      state: afterPass,
      action: resolve!,
      targetInstanceIds: ["bob-a"],
      ...lookups,
    }).state;
    expect(resolved.pendingEffectTargetSelection).toBeNull();
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "bob-a")?.zone ===
        "field"
    ).toBe(false);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "bob-b")?.zone
    ).toBe("field");
  });
});
