/**
 * ENGINE-divine-skill-nested-effect-continuation:
 * 神技/導技 (`grandwalkerData.divineSkills[].effects[]`) の効果本体が
 * `executionMode:"optional"` step で中断した場合、解決側 (`applyPendingStepOptionalChoiceAction`)
 * が top-level `def.effects[]` ではなく divineSkills 側の nested effects を再開先として
 * 正しく解決できるかを検証する（BSLH01-X01「導技：2」実装中に adversarial verifier round2 が
 * 発見: `ZoneSelectionContinuation.divineSkillIndex` は deck_reveal/zone_selection/
 * count_selection のみに配線され、`StepOptionalContinuation` / `PendingAfterTriggersContinuation`
 * には配線されていなかった。resumeEffectOverride が無条件では立たない main choice 経路
 * (effect-interpreter.ts の pendingStepOptionalChoice 構築) では、divineSkillIndex 無しだと
 * top-level `def.effects[effectIndex]` へ silent に誤爆する）。
 *
 * テストカードは意図的に「top-level effects[0]」に全く別の (decoy) 効果を置き、
 * 誤解決した場合に区別できるようにする。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const ALICE = "alice";
const BOB = "bob";
const noTriggeredLookup = () => [];

const NEXUS: CardDefinition = {
  cardNo: "TEST-DIVINE-SKILL-OPTIONAL-NEXUS",
  name: "テスト創界神",
  printedCategory: "nexus",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  // top-level effects[0] は divineSkills とは無関係の decoy。誤解決した場合ここが実行される。
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 999 } },
      ],
    },
  ],
  grandwalkerData: {
    kind: "grandwalker",
    oracleTriggerKinds: ["summon"] as const,
    oracleConditions: [],
    divineSkills: [
      {
        label: "divine_skill",
        coreCost: 1,
        timing: "main",
        effects: [
          {
            timing: { kind: "activated", mode: "main" },
            steps: [
              {
                id: "mandatory-step",
                action: { kind: "count_increase", player: "self", amount: 1 },
              },
              {
                id: "optional-step",
                action: { kind: "count_increase", player: "self", amount: 5 },
                executionMode: "optional",
              },
            ],
          },
        ],
      },
    ],
  },
};

const getCardDefinitionById = (id: string) =>
  id === NEXUS.cardNo ? NEXUS : undefined;

function baseState(): GameState {
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const nexus = createCardInstance(NEXUS, {
    instanceId: "nexus-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    cardInstances: [nexus],
  };
}

describe("ENGINE-divine-skill-nested-effect-continuation: divineSkills effects の optional step 中断/再開", () => {
  it("実行: mandatory step(+1) 後、optional step の pendingStepOptionalChoice が divineSkillIndex 付きで立つ", () => {
    const state = baseState();
    const afterDeclare = executeEffect({
      chainId: "test:engine-divine-skill-nested-effect-continuation:104",
      state,
      effect: NEXUS.grandwalkerData!.divineSkills![0]!.effects![0]!,
      effectIndex: 0,
      divineSkillIndex: 0,
      sourceInstanceId: "nexus-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    });
    expect(afterDeclare.pendingStepOptionalChoice).not.toBeNull();
    expect(
      afterDeclare.pendingStepOptionalChoice!.continuation.divineSkillIndex
    ).toBe(0);
    expect(
      afterDeclare.pendingStepOptionalChoice!.continuation.effectIndex
    ).toBe(0);
    expect(afterDeclare.players.find((p) => p.id === ALICE)!.countValue).toBe(
      1
    );
  });

  it("execute を選ぶと nested effects の optional step(+5) が再開される（decoy の top-level effects[0](+999) ではない）", () => {
    const state = baseState();
    const afterDeclare = executeEffect({
      chainId: "test:engine-divine-skill-nested-effect-continuation:128",
      state,
      effect: NEXUS.grandwalkerData!.divineSkills![0]!.effects![0]!,
      effectIndex: 0,
      divineSkillIndex: 0,
      sourceInstanceId: "nexus-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    });
    const pending = afterDeclare.pendingStepOptionalChoice!;
    const after = applyLegalAction({
      state: afterDeclare,
      action: {
        kind: "resolve_pending_step_optional_choice",
        choice: "execute",
        pendingId: pending.pendingId,
        actingPlayerId: pending.choosingPlayerId,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    }).state;

    expect(after.pendingStepOptionalChoice ?? null).toBeNull();
    // +1 (mandatory) + 5 (optional executed) = 6。誤解決なら 999 になる、または throw する。
    expect(after.players.find((p) => p.id === ALICE)!.countValue).toBe(6);
  });

  it("decline を選ぶと optional step(+5) は発揮されず、mandatory 分の +1 のみ残る", () => {
    const state = baseState();
    const afterDeclare = executeEffect({
      chainId: "test:engine-divine-skill-nested-effect-continuation:158",
      state,
      effect: NEXUS.grandwalkerData!.divineSkills![0]!.effects![0]!,
      effectIndex: 0,
      divineSkillIndex: 0,
      sourceInstanceId: "nexus-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    });
    const pending = afterDeclare.pendingStepOptionalChoice!;
    const after = applyLegalAction({
      state: afterDeclare,
      action: {
        kind: "resolve_pending_step_optional_choice",
        choice: "decline",
        pendingId: pending.pendingId,
        actingPlayerId: pending.choosingPlayerId,
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    }).state;

    expect(after.pendingStepOptionalChoice ?? null).toBeNull();
    expect(after.players.find((p) => p.id === ALICE)!.countValue).toBe(1);
  });
});

/**
 * 6 継続型汎用化 (2026-07-27 engine-claude deep mode, round3 park の再挑戦):
 * StepOptionalContinuation 等 3 型は divineSkillIndex 配線済みだったが、
 * CoreDistributionContinuation / CoreSourceAllocationContinuation /
 * LifeCoreSelectionContinuation / MultiPlacementContinuation /
 * RedirectActionContinuation / TargetedDisclosureContinuation の 6 型は
 * 生成側 (options.divineSkillIndex → continuation への転写) が未配線で、
 * かつ解決側も resolveContinuationEffect を経由せず bespoke な
 * `def?.effects?.[cont.effectIndex]` 直読みだった (round3 は型フィールド追加のみで
 * 生成側が伴わず反証された)。
 *
 * ここでは core_distribute(mode="player_choice") が生成する
 * CoreDistributionContinuation で代表検証する。top-level effects[0] に
 * steps を1つしか持たない decoy を置き、divineSkills 側の 2 step 目
 * (count_increase +1) が正しく再開されることを確認する。誤解決した場合、
 * decoy の 1 step 目 (steps.length=1) には resumeStepIndex=1 が存在しないため
 * 後続 step が silent に実行されず countValue が 0 のまま止まる。
 */
describe("ENGINE-divine-skill-nested-effect-continuation: CoreDistributionContinuation の divineSkills 経路", () => {
  const HOST: CardDefinition = {
    cardNo: "TEST-DIVINE-SKILL-CORE-DISTRIBUTE-NEXUS",
    name: "テスト創界神2",
    printedCategory: "nexus",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    // top-level effects[0] は divineSkills とは無関係の decoy。
    // steps が1つしかないため、resumeStepIndex=1 で誤解決すると後続 step が存在せず無視される。
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 999 } },
        ],
      },
    ],
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: ["summon"] as const,
      oracleConditions: [],
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 1,
          timing: "main",
          effects: [
            {
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
                  id: "post-distribute",
                  action: { kind: "count_increase", player: "self", amount: 1 },
                },
              ],
            },
          ],
        },
      ],
    },
  };
  const TOKEN: CardDefinition = {
    cardNo: "TEST-DIVINE-SKILL-CORE-DISTRIBUTE-TOKEN",
    name: "テストトークン",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    tribe: "token",
    sourceUrls: [],
    sourceConfidence: "C",
  };

  const getCardDefinitionById = (id: string) =>
    id === HOST.cardNo ? HOST : id === TOKEN.cardNo ? TOKEN : undefined;

  function baseState(): GameState {
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const nexus = createCardInstance(HOST, {
      instanceId: "nexus-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const token = createCardInstance(TOKEN, {
      instanceId: "token-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    return {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [nexus, token],
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, reserveNormalCoreCount: 2 } : p
      ),
    };
  }

  it("core_distribute(player_choice) 実行で pendingCoreDistribution.continuation.divineSkillIndex=0 が立つ", () => {
    const state = baseState();
    const afterDeclare = executeEffect({
      chainId: "test:engine-divine-skill-nested-effect-continuation:315",
      state,
      effect: HOST.grandwalkerData!.divineSkills![0]!.effects![0]!,
      effectIndex: 0,
      divineSkillIndex: 0,
      sourceInstanceId: "nexus-2",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    });
    expect(afterDeclare.pendingCoreDistribution).not.toBeNull();
    const continuation = afterDeclare.pendingCoreDistribution!.continuation!;
    expect(continuation).toBeDefined();
    expect(continuation.divineSkillIndex).toBe(0);
    expect(continuation.effectIndex).toBe(0);
    expect(continuation.resumeStepIndex).toBe(1);
  });

  it("配分解決後、divineSkills 側の post-distribute step(+1) が再開される（decoy の top-level(+999) ではない）", () => {
    const state = baseState();
    const afterDeclare = executeEffect({
      chainId: "test:engine-divine-skill-nested-effect-continuation:335",
      state,
      effect: HOST.grandwalkerData!.divineSkills![0]!.effects![0]!,
      effectIndex: 0,
      divineSkillIndex: 0,
      sourceInstanceId: "nexus-2",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
    });
    const actions = getLegalActions({
      state: afterDeclare,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const cdAction = actions.find(
      (a) => a.kind === "resolve_pending_core_distribution"
    )!;
    expect(cdAction).toBeDefined();

    const after = applyLegalAction({
      state: afterDeclare,
      action: cdAction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggeredLookup,
      coreDistributionAllocations: { "token-1": 1 },
    }).state;

    expect(after.pendingCoreDistribution).toBeNull();
    const tokenAfter = after.cardInstances.find(
      (c) => c.instanceId === "token-1"
    )!;
    expect(tokenAfter.normalCoreCount).toBe(1);
    // 誤解決 (decoy の top-level effects[0], steps.length=1) なら resumeStepIndex=1 は
    // 存在せず post-distribute step が実行されないため countValue は 0 のまま止まる。
    // 正しく divineSkills[0].effects[0] へ解決されれば +1 が実行され countValue=1。
    expect(after.players.find((p) => p.id === ALICE)!.countValue).toBe(1);
  });
});
