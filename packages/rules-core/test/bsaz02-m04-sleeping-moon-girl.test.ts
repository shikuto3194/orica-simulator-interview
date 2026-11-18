import { collectAfterPhysicalLeave } from "./physical-leave-test-helper";
/**
 * BSAZ02-M04「眠れる月の少女」effects[0,1] 検証。
 *
 * 原文 (textLines[0,2,3]):
 *   〔ターンに1回：同名〕トラッシュにあるこのカードは、系統：「火星」を持つ自分のネクサスが
 *   フィールドを離れたとき、手札に戻せる。
 *   フラッシュ
 *   〔ターンに1回：同名〕トラッシュにある系統：「火星」を持つネクサスカード2枚までを
 *   コストを支払わずに配置する。この効果で配置したとき、フィールド/リザーブのコア1個を
 *   自分のライフに置ける。
 *
 * 検証点:
 *  - effects[0]: BSAZ03-M01 effects[0] と同型のトラッシュ常駐第三者観測
 *    (applicability.zone:"trash" + game_event leave_field)。原文に「相手によって」の限定が
 *    無いため cause 未指定 (=全 cause で誘発)。自分自身の効果による離脱でも誘発候補に入ることを
 *    確認し、cause 限定の BSAZ03-M01 との違いを明示する。move_card で手札へ戻ることを実行系で検証。
 *  - effects[1]: from_zone summon (count:{min:0,max:2}, costModifier:"free") で明示選択した
 *    火星ネクサス2枚がフィールドへ配置される (ENGINE-summon-from-zone-range-count-preselected-ids
 *    と同型の targetInstanceIds + targetSelectionResolved 呼び出し)。conditional_result 接続の
 *    core_move(from:field+includeReserve, to:life, amount:1) が、配置成功時のみ
 *    (drainOptionalStepsWithExecute で optional pending を消化) フィールド/リザーブのコアを
 *    ライフへ移すことを確認する。対象0枚選択時は succeeded=false のためコア移動も不発。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { getAvailableTriggeredEffectSourceChoices } from "../src/effect/trigger-system";
import { queuePendingLeave } from "../src/state-based-actions";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import type { CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const M04 = card("BSAZ02-M04");

const ALICE = "player-1";
const BOB = "player-2";
const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

function marsNexusDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `テスト火星ネクサス ${cardNo}`,
    printedCategory: "nexus",
    colors: ["white"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "火星",
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function coreHolderDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `テストコア保持ネクサス ${cardNo}`,
    printedCategory: "nexus",
    colors: ["white"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "紅魔",
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

const NEXUS1 = marsNexusDef("TEST-MARS-NEXUS-1");
const NEXUS2 = marsNexusDef("TEST-MARS-NEXUS-2");
const CORE_HOLDER = coreHolderDef("TEST-CORE-HOLDER");

const testDefRegistry = new Map<string, CardDefinition>([
  [M04.cardNo, M04],
  [NEXUS1.cardNo, NEXUS1],
  [NEXUS2.cardNo, NEXUS2],
  [CORE_HOLDER.cardNo, CORE_HOLDER],
]);
const getDef = (id: string): CardDefinition | undefined =>
  testDefRegistry.get(id);

function drainOptionalStepsWithExecute(state: GameState): GameState {
  let s = state;
  for (let guard = 0; guard < 20; guard++) {
    if (s.pendingMultiPlacement !== null) {
      const action = getLegalActions({
        state: s,
        actingPlayerId: s.pendingMultiPlacement.actingPlayerId,
        getCardDefinitionById: getDef,
      }).find(
        (candidate) => candidate.kind === "resolve_pending_multi_placement"
      );
      expect(action).toBeDefined();
      s = applyLegalAction({
        state: s,
        action: action!,
        multiPlacementAllocations:
          action!.kind === "resolve_pending_multi_placement"
            ? action!.targets.map((target) => ({
                destinationInstanceId: target.instanceId,
                placements: [],
              }))
            : [],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
      continue;
    }
    if (s.pendingStepOptionalChoice === null) break;
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

describe("BSAZ02-M04 effects[0]: トラッシュ常駐の自己回収 (自分の火星ネクサスが場を離れたとき)", () => {
  const effect = M04.effects![0]!;

  it("effect 定義: applicability.zone:trash + game_event(leave_field, category:nexus, tribes:火星)、cause 未指定", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability).toEqual({ zone: ["trash"] });
    expect(effect.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "leave_field",
      exactEventKind: true,
      triggerFilter: { category: ["nexus"], tribes: ["火星"] },
    });
    expect(effect.executionMode).toBe("optional");
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
  });

  function setup() {
    const nexus = createCardInstance(NEXUS1, {
      instanceId: "mars-nexus-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const trashCard = createCardInstance(M04, {
      instanceId: "m04-trash-1",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [nexus, trashCard],
    });
    const lookup = buildTriggeredEffectLookup([M04, NEXUS1]);
    return { before, nexus, trashCard, lookup };
  }

  it("自分自身の効果による離脱でも誘発候補に含まれる (cause 未指定＝全cause許容、BSAZ03-M01の相手限定と対照)", () => {
    const ctx = setup();
    const chainId = "m04-self-leave-chain";
    const withPendingLeave = queuePendingLeave({
      state: ctx.before,
      instanceId: ctx.nexus.instanceId,
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: ALICE,
      chainId,
    });
    const queued = collectAfterPhysicalLeave({
      beforeState: ctx.before,
      afterState: withPendingLeave,
      source: "action_resolution",
      chainId,
      attackId: null,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
      getRegisteredBurstActions: undefined,
    });
    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.relatedInstanceId === ctx.nexus.instanceId
    );
    expect(pending).toBeDefined();
    const choices = getAvailableTriggeredEffectSourceChoices({
      state: queued,
      pendingEffect: pending!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: ctx.lookup,
    });
    expect(
      choices.find((c) => c.sourceCard.instanceId === ctx.trashCard.instanceId)
    ).toBeDefined();
  });

  it("実行: move_card でトラッシュのこのカードが手札に戻る", () => {
    const ctx = setup();
    const result = executeEffect({
      chainId: "test:bsaz02-m04-sleeping-moon-girl:226",
      state: ctx.before,
      effect,
      sourceInstanceId: ctx.trashCard.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const moved = result.cardInstances.find(
      (c) => c.instanceId === ctx.trashCard.instanceId
    )!;
    expect(moved.zone).toBe("hand");
  });
});

describe("BSAZ02-M04 effects[1]: フラッシュ〔ターンに1回：同名〕トラッシュの火星ネクサス2枚までコスト不要配置 + 配置成功時フィールド/リザーブのコア1個をライフへ", () => {
  const effect = M04.effects![1]!;

  it("effect 定義: summon(from_zone, count:{min:0,max:2}, costModifier:free) → conditional_result core_move(field+includeReserve→life, amount:1)", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    const summonStep = effect.steps[0]!.action;
    expect(summonStep.kind).toBe("summon");
    if (summonStep.kind === "summon") {
      expect(summonStep.costModifier).toBe("free");
      expect(summonStep.target).toEqual({
        kind: "from_zone",
        zone: "trash",
        filter: { category: ["nexus"], tribes: ["火星"] },
        count: { min: 0, max: 2 },
      });
    }
    const coreStep = effect.steps[1]!;
    expect(coreStep.connector).toBe("conditional_result");
    expect(coreStep.executionMode).toBe("optional");
    const move = coreStep.action;
    expect(move.kind).toBe("core_move");
    if (move.kind === "core_move") {
      expect(move.from).toEqual({
        kind: "field",
        player: "self",
        includeReserve: true,
      });
      expect(move.to).toEqual({ kind: "life", player: "self" });
      expect(move.amount).toBe(1);
    }
  });

  function setup() {
    const m04Src = createCardInstance(M04, {
      instanceId: "m04-src",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const nexus1 = createCardInstance(NEXUS1, {
      instanceId: "trash-nexus-1",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const nexus2 = createCardInstance(NEXUS2, {
      instanceId: "trash-nexus-2",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const coreHolder = createCardInstance(CORE_HOLDER, {
      instanceId: "core-holder",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [m04Src, nexus1, nexus2, coreHolder],
      playerOverrides: [
        { lifeNormalCoreCount: 3, reserveNormalCoreCount: 0 },
        {},
      ],
    });
    return { before, m04Src, nexus1, nexus2, coreHolder };
  }

  it("[board] 2枚を明示選択 → 両方フィールドへ配置され、フィールドのコア1個がライフへ移る", () => {
    const ctx = setup();
    const executed = executeEffect({
      chainId: "test:bsaz02-m04-sleeping-moon-girl:312",
      state: ctx.before,
      effect,
      sourceInstanceId: ctx.m04Src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [ctx.nexus1.instanceId, ctx.nexus2.instanceId],
      targetSelectionResolved: true,
    });
    const after = drainOptionalStepsWithExecute(executed);

    const n1 = after.cardInstances.find(
      (c) => c.instanceId === ctx.nexus1.instanceId
    )!;
    const n2 = after.cardInstances.find(
      (c) => c.instanceId === ctx.nexus2.instanceId
    )!;
    expect(n1.zone).toBe("field");
    expect(n2.zone).toBe("field");

    const holder = after.cardInstances.find(
      (c) => c.instanceId === ctx.coreHolder.instanceId
    )!;
    expect(holder.normalCoreCount).toBe(0);
    expect(alice(after).lifeNormalCoreCount).toBe(4);
  });

  it("[board] 対象0枚選択 → 配置が起きないため conditional_result のコア移動も不発", () => {
    const ctx = setup();
    const executed = executeEffect({
      chainId: "test:bsaz02-m04-sleeping-moon-girl:342",
      state: ctx.before,
      effect,
      sourceInstanceId: ctx.m04Src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [],
      targetSelectionResolved: true,
    });
    expect(executed.pendingMultiPlacement).toBeNull();
    expect(executed.pendingStepOptionalChoice).toBeNull();
    expect(executed.pendingCoreShootSelection).toBeNull();
    const after = drainOptionalStepsWithExecute(executed);

    const n1 = after.cardInstances.find(
      (c) => c.instanceId === ctx.nexus1.instanceId
    )!;
    const n2 = after.cardInstances.find(
      (c) => c.instanceId === ctx.nexus2.instanceId
    )!;
    expect(n1.zone).toBe("trash");
    expect(n2.zone).toBe("trash");

    const holder = after.cardInstances.find(
      (c) => c.instanceId === ctx.coreHolder.instanceId
    )!;
    expect(holder.normalCoreCount).toBe(1);
    expect(alice(after).lifeNormalCoreCount).toBe(3);
  });

  function placeOneWithBothCoreSources() {
    const ctx = setup();
    alice(ctx.before).reserveNormalCoreCount = 1;
    let state = executeEffect({
      chainId: "test:m04-one-placement",
      state: ctx.before,
      effect,
      sourceInstanceId: ctx.m04Src.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: [ctx.nexus1.instanceId],
      targetSelectionResolved: true,
    });
    if (state.pendingMultiPlacement) {
      const action = getLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      }).find((a) => a.kind === "resolve_pending_multi_placement");
      if (!action || action.kind !== "resolve_pending_multi_placement")
        throw new Error("missing placement action");
      state = applyLegalAction({
        state,
        action,
        multiPlacementAllocations: action.targets.map((target) => ({
          destinationInstanceId: target.instanceId,
          placements: [],
        })),
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
    }
    expect(
      state.cardInstances.find((c) => c.instanceId === ctx.nexus1.instanceId)
        ?.zone
    ).toBe("field");
    expect(
      state.cardInstances.find((c) => c.instanceId === ctx.nexus2.instanceId)
        ?.zone
    ).toBe("trash");
    expect(state.pendingStepOptionalChoice).not.toBeNull();
    return state;
  }

  function chooseOptional(state: GameState, choice: "execute" | "decline") {
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).filter(
      (a) => a.kind === "resolve_pending_step_optional_choice" && a.can
    );
    expect(actions.map((a) => a.choice).sort()).toEqual(["decline", "execute"]);
    return applyLegalAction({
      state,
      action: actions.find((a) => a.choice === choice)!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
  }

  it("[board] 1枚配置後はexecute/declineの2択で、declineなら両コア源とライフを維持する", () => {
    const after = chooseOptional(placeOneWithBothCoreSources(), "decline");
    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "core-holder")
        ?.normalCoreCount
    ).toBe(1);
    expect(alice(after).reserveNormalCoreCount).toBe(1);
    expect(alice(after).lifeNormalCoreCount).toBe(3);
  });

  it.each([
    {
      source: "core-holder",
      title: "[board] 両コア源を候補に含み、core-holderから1個だけライフへ移す",
    },
    {
      source: `reserve:${ALICE}`,
      title:
        "[board] 両コア源を候補に含み、reserve:player-1から1個だけライフへ移す",
    },
  ])("$title", ({ source }) => {
    const state = chooseOptional(placeOneWithBothCoreSources(), "execute");
    expect(
      state.pendingCoreShootSelection?.candidates
        .map((c) => c.instanceId)
        .sort()
    ).toEqual(["core-holder", `reserve:${ALICE}`]);
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((a) => a.kind === "resolve_pending_core_shoot" && a.can);
    expect(action).toBeDefined();
    const after = applyLegalAction({
      state,
      action: action!,
      coreShootDistribution: { [source]: 1 },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(after.pendingCoreShootSelection).toBeNull();
    expect(after.pendingStepOptionalChoice).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "core-holder")
        ?.normalCoreCount
    ).toBe(source === "core-holder" ? 0 : 1);
    expect(alice(after).reserveNormalCoreCount).toBe(
      source.startsWith("reserve:") ? 0 : 1
    );
    expect(alice(after).lifeNormalCoreCount).toBe(4);
  });
});
