/** 作戦の常時使用許可と、通常マジック使用で発揮する本文の検証。 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, GameState } from "../src";

function makeCardDef(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

const c11 = ALL_CARDS.find((c) => c.cardNo === "BSAZ01-C11")!;
const flashEffect = c11.effects!.find(
  (e) => e.timing.kind === "activated" && e.timing.mode === "flash"
)!;

const braveDef = makeCardDef("TEST-C11-BRAVE", { printedCategory: "brave" });
const hostDef = makeCardDef("TEST-C11-HOST", {
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
});
const enemyDef = makeCardDef("TEST-C11-ENEMY", {
  levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
});

const cardNoMap = new Map<string, CardDefinition>([
  ...ALL_CARDS.map((c): [string, CardDefinition] => [c.cardNo, c]),
  [braveDef.cardNo, braveDef],
  [hostDef.cardNo, hostDef],
  [enemyDef.cardNo, enemyDef],
]);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
    ...ALL_CARDS,
    braveDef,
    hostDef,
    enemyDef,
  ]),
};

function zoneOf(state: GameState, instanceId: string): string | undefined {
  return state.cardInstances.find((c) => c.instanceId === instanceId)?.zone;
}

describe("BSAZ01-C11 effects[2]: 第三者ブレイヴ合体+BP+4000+予算制破壊", () => {
  it("合体→BP+4000→予算内破壊が一連で成立する (host 3000+4000+brave3000=10000 予算, enemy 5000)", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [
        createCardInstance(c11, {
          instanceId: "c11-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(braveDef, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          zoneRoleName: "brave",
          normalCoreCount: 1,
        }),
        createCardInstance(hostDef, {
          instanceId: "host-1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(enemyDef, {
          instanceId: "enemy-1",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };

    const pendingState = executeEffect({
      chainId: "test:bsaz01-c11-field-flash-budget-destroy:116",
      state,
      effect: flashEffect,
      effectIndex: 2,
      sourceInstanceId: "c11-1",
      actingPlayerId: "alice",
      ...lookups,
    });

    // select_brave (候補1件: brave-1) / combine_host (候補1件: host-1) とも
    // 候補=必要数=1 で選択余地なし → 両方自動解決され、budget_destroy の pending が直接立つ。
    const afterCombine = pendingState;
    const brave = afterCombine.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    )!;
    expect(brave.attachedToInstanceId).toBe("host-1");

    const destroyPending = afterCombine.pendingStepOptionalTargetSelection!;
    expect(destroyPending.targetStepId).toBe("budget_destroy");
    expect(destroyPending.requiredTargetCount).toBe(0);
    // 予算 = host-1(3000+bp_modify4000=7000) + 合体ブレイヴ brave-1 の BP+(3000、10_rules/05
    // 合体スピリットはブレイヴのBP+加算込みで扱う、getCombinedUnitBp) = 10000。
    expect(destroyPending.bpBudgetAmount).toBe(10000);
    expect(destroyPending.candidateInstanceIds).toEqual(["enemy-1"]);

    // 予算10000、enemy-1のBP5000 <= 10000 なので破壊できる。
    const resolved = applyLegalAction({
      state: afterCombine,
      action: {
        kind: "resolve_pending_step_optional_target_selection",
        actionId: `psots-${destroyPending.pendingId}`,
        can: true,
        reason: "test",
        actingPlayerId: destroyPending.actingPlayerId,
        pendingId: destroyPending.pendingId,
        sourceInstanceId: destroyPending.sourceInstanceId,
        sourceDefinitionId: destroyPending.sourceDefinitionId,
        effectIndex: destroyPending.effectIndex,
        stepIndex: destroyPending.stepIndex,
        requiredTargetCount: destroyPending.requiredTargetCount,
        maxTargetCount: destroyPending.maxTargetCount,
        candidateTargetInstanceIds: destroyPending.candidateInstanceIds,
      },
      targetInstanceIds: ["enemy-1"],
      ...lookups,
    }).state;
    expect(resolved.pendingStepOptionalTargetSelection).toBeNull();
    expect(zoneOf(resolved, "enemy-1")).toBe("trash");
  });

  it("ブレイヴ不在なら合体はスキップされるが、BP+4000と破壊は成立する", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [
        createCardInstance(c11, {
          instanceId: "c11-2",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(hostDef, {
          instanceId: "host-2",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(enemyDef, {
          instanceId: "enemy-2",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };

    const pendingState = executeEffect({
      chainId: "test:bsaz01-c11-field-flash-budget-destroy:195",
      state,
      effect: flashEffect,
      effectIndex: 2,
      sourceInstanceId: "c11-2",
      actingPlayerId: "alice",
      ...lookups,
    });

    // select_brave / combine_host とも候補0件で自動 no-op、budget_destroy の pending が直接立つ。
    const destroyPending = pendingState.pendingStepOptionalTargetSelection!;
    expect(destroyPending.targetStepId).toBe("budget_destroy");
    // 合体していない host-2 でも BP+4000 は適用済み (3000+4000=7000)。
    expect(destroyPending.bpBudgetAmount).toBe(7000);
  });

  it("ブレイヴ不在+合体先候補2体以上でも combine_host の無意味な選択窓は開かない (adversarial verifier round1 refute)", () => {
    // ブレイヴ候補0件でも合体先(自分のスピリット)候補が複数あると、
    // stepCondition:ref_succeeded 無しでは combine_host が誤って選択pendingを開いてしまう
    // (select_brave 不成立を見ずに独自候補を返すバグ)。host候補2体で再現する。
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [
        createCardInstance(c11, {
          instanceId: "c11-3",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(hostDef, {
          instanceId: "host-3a",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(hostDef, {
          instanceId: "host-3b",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(enemyDef, {
          instanceId: "enemy-3",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };

    const pendingState = executeEffect({
      chainId: "test:bsaz01-c11-field-flash-budget-destroy:250",
      state,
      effect: flashEffect,
      effectIndex: 2,
      sourceInstanceId: "c11-3",
      actingPlayerId: "alice",
      ...lookups,
    });

    // combine_host の選択窓が開かず、budget_destroy まで直接進む。
    const destroyPending = pendingState.pendingStepOptionalTargetSelection!;
    expect(destroyPending.targetStepId).toBe("budget_destroy");
    // host-3a/3b どちらも合体していない (BP+4000 のみ、それぞれ 3000+4000=7000)。
    expect(destroyPending.bpBudgetAmount).toBe(14000);
  });
});
