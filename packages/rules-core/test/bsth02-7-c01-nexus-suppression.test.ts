/**
 * BSTH02.7-C01「戦操「ドールズウォー」」 effects[0] 実行検証。
 *
 * 原文 (メインステップ終了時に使用):
 * 「自分のネクサスが黄1色のみで2つ以上のとき、このステップの間、相手のネクサス/創界神
 * ネクサス/創界石ネクサス/ミラージュの効果は発揮されない。メインステップ終了時に使用して
 * いたとき、「このターンの間」に変更できる。その後、「ステップの間」で発揮したとき、自分
 * はデッキの下から1枚ドローできる。」
 *
 * 使用タイミングは常に main-step-end (timingScope subPhase:"end") に固定されるため、
 * 「メインステップ終了時に使用していたとき」は常に真になり、[4]/[5] は「このステップの間
 * (既定) → このターンの間へ変更できる」の単一 choice に折り込める
 * (choiceIndex:0=既定=ステップの間+デッキ下ドロー可、choiceIndex:1=このターンの間へ変更、
 * ドロー無し)。抑制対象「ネクサス/創界神ネクサス/創界石ネクサス」は filterOr 3枝、
 * 「ミラージュ」はカテゴリ不問の別軸のため zone:"mirage" の独立 suppress_effect で表現する。
 *
 * suppress_effect の target が kind:"filter" + count:"all" のとき、登録時に instanceId へ
 * snapshot せず targetInstanceId 未設定のグローバル動的フィルタ CE として登録される
 * (ENGINE-dynamic-filter-suppress)。この動的経路は従来 zone==="field" 固定だったため、
 * 「ミラージュ」(zone:"mirage") 対象は素通りしてしまっていた。本カード実装に合わせ、
 * suppressTargetZone metadata (target.zone 由来、省略時は従来通り ["field"]) を新設し、
 * legal-actions-shared.ts の動的 effect_suppression 判定を zone リスト対応に一般化した
 * (effect_immunity の targetFilter.zone と同型パターンの適用、ENGINE-effect-immunity-hand-zone-scope)。
 *
 * さらに、timingScope.subPhase:"end" を持つ effect から生成された CE が
 * getGlobalCEs/getCEsForTarget (ce-lookup.ts) から常に除外される engine gap を発見・修正した。
 * 消費側 filterByScope は isCEActiveForScope 呼び出し時に currentSubPhase を渡していなかった
 * ため既定値 "start" 固定になり、subPhase:"end" の CE が常に非アクティブ判定されていた
 * (legal-actions-availability.ts の宣言時判定は window==="step_end" を正しく渡すのに対し、
 * CE 消費側だけ配線漏れだった、engine-hand-self-card-main-end-activation-timing の残課題)。
 * ScopeContext に window を追加し window==="step_end" のときだけ "end" を渡すよう一般化した。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import { runReevaluationAtTiming } from "../src/legal/legal-actions-shared";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import {
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
} from "../src/effect/continuous-effect-rebuild";
import { advanceStep } from "../src/turn-system";

function drainOptionalStepsWithExecute(
  state: GameState,
  getDef: (id: string) => CardDefinition | undefined
): GameState {
  let s = state;
  while (s.pendingStepOptionalChoice !== null) {
    const psoc = s.pendingStepOptionalChoice;
    s = applyLegalAction({
      state: s,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${psoc.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: psoc.actingPlayerId,
        pendingId: psoc.pendingId,
        sourceInstanceId: psoc.sourceInstanceId,
        effectIndex: psoc.effectIndex,
        stepIndex: psoc.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
  }
  return s;
}

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);

// 創界石ネクサス（grandstoneData の有無のみで isGrandstoneNexus が判定するため最小構成）。
const grandstoneNexusDef: CardDefinition = {
  cardNo: "TEST-GRANDSTONE-NEXUS",
  name: "テスト創界石ネクサス",
  printedCategory: "nexus",
  colors: ["red"],
  cost: 3,
  reductionSymbols: ["red"],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  grandstoneData: {
    unsealConditions: [],
    rebirthCoreThreshold: 3,
  },
  tribe: "創界石",
  sourceUrls: [],
  sourceConfidence: "A",
};

const allDefs = new Map<string, CardDefinition>([
  ...cardNoMap,
  [grandstoneNexusDef.cardNo, grandstoneNexusDef],
]);
const getCardDefinitionById = (id: string) => allDefs.get(id);

const card = cardNoMap.get("BSTH02.7-C01")!;
const plainNexusDef = cardNoMap.get("BSFT01-C03")!; // printedCategory "nexus" (非創界神・非創界石)
const grandwalkerNexusDef = cardNoMap.get("BSTH01-XX01")!; // 導界者ネクサス (targetsGrandwalker 対象)
const mirageCardDef = cardNoMap.get("BSFT01-C01")!; // カテゴリ不問、zone:"mirage" で運用
const opponentSpiritDef = cardNoMap.get("BSFT01-X01")!; // 抑止対象外（スピリット, field）
const selfYellowNexusDef = cardNoMap.get("BSTH02.7-CX01")!; // colors:["yellow"] の単色ネクサス
const conditionalOpponentNexusDef: CardDefinition = {
  ...plainNexusDef,
  cardNo: "TEST-CONDITIONAL-OPPONENT-NEXUS",
  name: "テスト条件付きネクサス",
  effects: [
    {
      timing: { kind: "continuous" },
      // 常時発揮ではないため effect_suppression の対象になる。
      applicability: { combined: false, soulState: false },
      steps: [
        {
          action: {
            kind: "cost_modify",
            player: "self",
            cardFilter: { category: ["magic"] },
            modifier: "free",
            duration: { scope: "permanent" },
          },
        },
      ],
    },
  ],
};
const mainStepConditionalOpponentNexusDef: CardDefinition = {
  ...conditionalOpponentNexusDef,
  cardNo: "TEST-MAIN-STEP-CONDITIONAL-OPPONENT-NEXUS",
  name: "テストメインステップ条件付きネクサス",
  effects: [
    {
      ...conditionalOpponentNexusDef.effects![0]!,
      // Alice の main 中は Bob（source）にとって opponent step なので成立するが、
      // end へ遷移した後には成立しない。
      condition: [{ kind: "step_phase", step: "main", whose: "opponent" }],
    },
  ],
};
allDefs.set(conditionalOpponentNexusDef.cardNo, conditionalOpponentNexusDef);
allDefs.set(
  mainStepConditionalOpponentNexusDef.cardNo,
  mainStepConditionalOpponentNexusDef
);

function buildState(): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const src = createCardInstance(card, {
    instanceId: "dollswar-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
  });
  // 効果の condition (黄1色ネクサス2つ以上) を満たすための自分側ネクサス。
  const selfYellowNexuses = ["1", "2"].map((suffix) =>
    createCardInstance(selfYellowNexusDef, {
      instanceId: `alice-nexus-${suffix}`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    })
  );
  const deckCards = ["top-1", "bottom-1"].map((id) =>
    createCardInstance(card, {
      instanceId: `deck-${id}`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    })
  );
  const bobPlainNexus = createCardInstance(plainNexusDef, {
    instanceId: "bob-nexus-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
  });
  const bobGrandwalkerNexus = createCardInstance(grandwalkerNexusDef, {
    instanceId: "bob-grandwalker-nexus-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
  });
  const bobGrandstoneNexus = createCardInstance(grandstoneNexusDef, {
    instanceId: "bob-grandstone-nexus-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
  });
  const bobMirageCard = createCardInstance(mirageCardDef, {
    instanceId: "bob-mirage-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "mirage",
  });
  const bobSpirit = createCardInstance(opponentSpiritDef, {
    instanceId: "bob-spirit-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
  });
  return {
    ...base,
    step: "main",
    window: "step_end",
    activePlayerId: "alice",
    cardInstances: [
      src,
      ...selfYellowNexuses,
      ...deckCards,
      bobPlainNexus,
      bobGrandwalkerNexus,
      bobGrandstoneNexus,
      bobMirageCard,
      bobSpirit,
    ],
  };
}

const summonRegistration = {
  reevaluationPoints: [
    {
      timing: "after_sba" as const,
      checks: ["effect_suppression" as const],
      failurePolicy: "abort_remaining" as const,
    },
  ],
};

function isSuppressed(state: GameState, sourceInstanceId: string): boolean {
  const reeval = runReevaluationAtTiming({
    state,
    registration: summonRegistration,
    timing: "after_sba",
    sourceInstanceId,
    targetInstanceIds: [],
    getCardDefinitionById,
  });
  return !reeval.passed;
}

describe("BSTH02.7-C01 effects[0] shape", () => {
  const e0 = card.effects![0]!;

  it("stub が消えており、main-step-end timingScope + 黄1色ネクサス2つ以上 condition を持つ", () => {
    expect(e0.stub).toBeUndefined();
    expect(e0.timing).toEqual({ kind: "activated", mode: "main" });
    expect(e0.timingScope).toEqual({
      player: "self",
      period: "main",
      subPhase: "end",
    });
    expect(e0.condition?.slice(0, 1)).toEqual([
      {
        kind: "field_has",
        player: "self",
        category: ["nexus"],
        colors: ["yellow"],
        colorCount: "mono",
        minCount: 2,
      },
    ]);
    expect(e0.steps).toHaveLength(4);
  });
});

describe("BSTH02.7-C01 effects[0] 実行: choiceIndex 0 (既定=ステップの間、ドロー有り)", () => {
  it("相手のネクサス/創界神ネクサス/創界石ネクサス/ミラージュ は効果を発揮できず、相手のスピリットは対象外。デッキ下から1枚ドローする", () => {
    const state = buildState();
    const executed = executeEffect({
      chainId: "test:bsth02-7-c01-nexus-suppression:279",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "dollswar-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      choiceIndex: 0,
    });
    // ドローステップは executionMode:"optional" のため pendingStepOptionalChoice で
    // 中断する（「できる」= 任意）。テストでは execute 側を選んで解消する。
    const after = drainOptionalStepsWithExecute(
      executed,
      getCardDefinitionById
    );

    for (const id of [
      "bob-nexus-1",
      "bob-grandwalker-nexus-1",
      "bob-grandstone-nexus-1",
      "bob-mirage-1",
    ]) {
      expect(isSuppressed(after, id), `expected ${id} to be suppressed`).toBe(
        true
      );
    }
    expect(isSuppressed(after, "bob-spirit-1")).toBe(false);

    const suppressionCes = after.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "effect_suppression"
    );
    expect(suppressionCes.length).toBeGreaterThan(0);
    for (const ce of suppressionCes) {
      expect(ce.duration.scope).toBe("step");
    }

    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-bottom-1")?.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-top-1")?.zone
    ).toBe("deck");
  });

  it("main 終了時に step scope suppress が失効すると、抑止された相手ネクサスの条件付き CE を直ちに復元する", () => {
    const base = buildState();
    const target = createCardInstance(conditionalOpponentNexusDef, {
      instanceId: "bob-conditional-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const withTargetCe = rebuildContinuousEffectsFromField(
      { ...base, cardInstances: [...base.cardInstances, target] },
      getCardDefinitionById
    );
    const executed = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bsth02-7-c01-nexus-suppression:335",
        state: withTargetCe,
        effect: card.effects![0]!,
        sourceInstanceId: "dollswar-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
        choiceIndex: 0,
      }),
      getCardDefinitionById
    );
    const suppressed = recomputeAndRebuildContinuousEffects(
      executed,
      getCardDefinitionById
    );

    expect(
      suppressed.activeContinuousEffects.some(
        (ce) => ce.sourceInstanceId === target.instanceId
      )
    ).toBe(false);

    const afterMain = advanceStep(
      {
        ...suppressed,
        window: "step_end",
        // choiceIndex:0 の任意ドローが作る burst check は、この回帰の step scope
        // 失効・CE 復元とは独立なので drain 済み相当の空キューにして遷移を検証する。
        pendingBurstChecks: [],
      },
      getCardDefinitionById,
      () => []
    );

    expect(afterMain.step).toBe("end");
    expect(
      afterMain.activeContinuousEffects.some(
        (ce) => ce.sourceInstanceId === target.instanceId
      )
    ).toBe(true);
    expect(
      afterMain.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "effect_suppression"
      )
    ).toBe(false);
  });

  it("step 遷移後に不成立になる CE は、step scope suppress の解除で残留しない", () => {
    const base = buildState();
    const target = createCardInstance(mainStepConditionalOpponentNexusDef, {
      instanceId: "bob-main-step-conditional-nexus",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const withTargetCe = rebuildContinuousEffectsFromField(
      { ...base, cardInstances: [...base.cardInstances, target] },
      getCardDefinitionById
    );
    expect(
      withTargetCe.activeContinuousEffects.some(
        (ce) => ce.sourceInstanceId === target.instanceId
      )
    ).toBe(true);

    const executed = drainOptionalStepsWithExecute(
      executeEffect({
        chainId: "test:bsth02-7-c01-nexus-suppression:400",
        state: withTargetCe,
        effect: card.effects![0]!,
        sourceInstanceId: "dollswar-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
        choiceIndex: 0,
      }),
      getCardDefinitionById
    );
    const suppressed = recomputeAndRebuildContinuousEffects(
      executed,
      getCardDefinitionById
    );
    expect(
      suppressed.activeContinuousEffects.some(
        (ce) => ce.sourceInstanceId === target.instanceId
      )
    ).toBe(false);

    const afterMain = advanceStep(
      { ...suppressed, window: "step_end", pendingBurstChecks: [] },
      getCardDefinitionById,
      () => []
    );

    expect(afterMain.step).toBe("end");
    expect(
      afterMain.activeContinuousEffects.some(
        (ce) => ce.sourceInstanceId === target.instanceId
      )
    ).toBe(false);
  });
});

describe("BSTH02.7-C01 effects[0] 実行: choiceIndex 1 (このターンの間へ変更、ドロー無し)", () => {
  it("抑止CEの duration が turn になり、デッキ下からのドローは発生しない", () => {
    const state = buildState();
    const after = executeEffect({
      chainId: "test:bsth02-7-c01-nexus-suppression:438",
      state,
      effect: card.effects![0]!,
      sourceInstanceId: "dollswar-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      choiceIndex: 1,
    });

    expect(isSuppressed(after, "bob-mirage-1")).toBe(true);

    const suppressionCes = after.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "effect_suppression"
    );
    expect(suppressionCes.length).toBeGreaterThan(0);
    for (const ce of suppressionCes) {
      expect(ce.duration.scope).toBe("turn");
    }

    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-bottom-1")?.zone
    ).toBe("deck");
  });
});
