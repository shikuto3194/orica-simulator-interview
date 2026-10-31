import { describe, it, expect, beforeEach } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  executeMatchingRetriggers,
  isRetriggerCE,
} from "../src/effect/retrigger-system";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { removeExpiredContinuousEffects } from "../src/legal/legal-actions-shared";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  RetriggerEffect,
} from "../src/model";

// ============================================================
// テスト用ヘルパー
// ============================================================

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "テストスピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "星竜",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

function makeInstance(
  def: CardDefinition,
  overrides: Partial<CardInstance> = {}
): CardInstance {
  const base = createCardInstance(def, {
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  return { ...base, ...overrides };
}

function makeState(cards: CardInstance[]): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
    startingLife: 5,
  });
}

function getRetriggerCEs(state: GameState): RetriggerEffect[] {
  return state.activeContinuousEffects.filter(isRetriggerCE);
}

const defRegistry = new Map<string, CardDefinition>();
function getDef(id: string): CardDefinition | undefined {
  return defRegistry.get(id);
}

function registerDef(def: CardDefinition): void {
  defRegistry.set(def.cardNo, def);
}

// ============================================================
// retrigger 登録テスト
// ============================================================

describe("retrigger system", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  describe("retrigger 登録（effect-interpreter）", () => {
    it("retrigger 付きステップはアクションを実行せず retrigger CE を登録する", () => {
      const magicDef = makeDef({
        cardNo: "MAGIC-001",
        name: "テストマジック",
        printedCategory: "magic",
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [
              {
                action: {
                  kind: "bp_modify",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: { category: ["spirit"] },
                    count: "all",
                  },
                  amount: -2000,
                  duration: { scope: "turn" },
                },
                retrigger: {
                  event: "attack",
                  triggerPlayer: "self",
                  triggerFilter: {
                    category: ["spirit"],
                    tribesRequired: ["幻想"],
                    tribes: ["導魔", "楽族"],
                  },
                  maxCount: 6,
                  duration: { scope: "turn" },
                },
              },
            ],
          },
        ],
      });
      registerDef(magicDef);
      const magicCard = makeInstance(magicDef, {
        instanceId: "magic-1",
        zone: "hand",
      });
      const state = makeState([magicCard]);

      const result = executeEffect({
        chainId: "test:retrigger-system:127",
        state,
        effect: magicDef.effects![0]!,
        sourceInstanceId: "magic-1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      // retrigger CE が登録された（bp_modify は CE を生成しない = 合計 1 つ）
      expect(result.activeContinuousEffects).toHaveLength(1);
      const retriggerCEs = getRetriggerCEs(result);
      expect(retriggerCEs).toHaveLength(1);
      const rt = retriggerCEs[0]!;
      expect(rt.modifierTag).toBe("retrigger");
      expect(rt.retriggerEvent).toBe("attack");
      expect(rt.retriggerPlayer).toBe("self");
      expect(rt.retriggerMaxCount).toBe(6);
      expect(rt.retriggerFireCount).toBe(0);
      expect(rt.retriggerFilter).toEqual({
        category: ["spirit"],
        tribesRequired: ["幻想"],
        tribes: ["導魔", "楽族"],
      });

      // ログに登録メッセージ
      const regLogs = result.log.filter((l) =>
        l.includes("retrigger:registered")
      );
      expect(regLogs).toHaveLength(1);
    });

    // P3-15 問題6 回帰テスト (2026-04-17):
    // バトル中 (state.activeAttack が存在) に retrigger を登録した場合、
    // createdAtAttackId が activeAttack.attackId から伝搬され、
    // battle_end で正しく除去されることを検証する。
    it("バトル中に登録された scope=battle retrigger は createdAtAttackId が設定され battle_end で除去される", () => {
      const magicDef = makeDef({
        cardNo: "MAGIC-BATTLE-SCOPE",
        name: "テストマジック バトル中",
        printedCategory: "magic",
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [
              {
                retrigger: {
                  event: "attack",
                  triggerPlayer: "self",
                  duration: { scope: "battle" },
                },
              },
            ],
          },
        ],
      });
      registerDef(magicDef);
      const magicCard = makeInstance(magicDef, {
        instanceId: "magic-b1",
        zone: "hand",
      });
      const state: GameState = {
        ...makeState([magicCard]),
        activeAttack: {
          attackId: "atk-X",
          primaryEntityId: "some-entity",
          participantEntityIds: [],
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: [],
          symbolResolutionOrder: [],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
      };

      const afterRegister = executeEffect({
        chainId: "test:retrigger-system:203",
        state,
        effect: magicDef.effects![0]!,
        sourceInstanceId: "magic-b1",
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
      });

      const retriggerCEs = getRetriggerCEs(afterRegister);
      expect(retriggerCEs).toHaveLength(1);
      expect(retriggerCEs[0]!.createdAtAttackId).toBe("atk-X");
      expect(retriggerCEs[0]!.duration.scope).toBe("battle");

      // battle_end で除去される（attackId 一致）
      const afterBattleEnd = removeExpiredContinuousEffects(afterRegister, {
        kind: "battle_end",
        attackId: "atk-X",
      });
      expect(
        afterBattleEnd.filter((ce) => ce.modifierTag === "retrigger")
      ).toHaveLength(0);

      // 別 attackId の battle_end では除去されない（残留）
      const afterOtherBattleEnd = removeExpiredContinuousEffects(
        afterRegister,
        {
          kind: "battle_end",
          attackId: "atk-OTHER",
        }
      );
      expect(
        afterOtherBattleEnd.filter((ce) => ce.modifierTag === "retrigger")
      ).toHaveLength(1);
    });
  });

  describe("retrigger マッチング・実行（executeMatchingRetriggers）", () => {
    function makeRetriggerCE(
      overrides: Partial<RetriggerEffect> & {
        sourceDefinitionId: string;
        createdAtTurn: number;
      }
    ): RetriggerEffect {
      return {
        effectId: "rt-test-1",
        sourceInstanceId: "magic-1",
        actingPlayerId: "alice",
        modifierTag: "retrigger",
        duration: { scope: "turn" },
        createdAtAttackId: null,
        retriggerEvent: "attack",
        retriggerPlayer: "self",
        retriggerEffectIndex: 0,
        retriggerStepIndex: 0,
        retriggerFireCount: 0,
        ...overrides,
      };
    }

    it("マッチするアタック時に再発火する", () => {
      const magicDef = makeDef({
        cardNo: "MAGIC-001",
        printedCategory: "magic",
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [
              {
                action: {
                  kind: "bp_modify",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: { category: ["spirit"] },
                    count: "all",
                  },
                  amount: -2000,
                  duration: { scope: "turn" },
                },
                retrigger: {
                  event: "attack",
                  triggerPlayer: "self",
                  triggerFilter: { category: ["spirit"] },
                  maxCount: 3,
                },
              },
            ],
          },
        ],
      });
      registerDef(magicDef);

      const attackerDef = makeDef({ cardNo: "ATK-001", tribe: "星竜" });
      registerDef(attackerDef);
      const attackerCard = makeInstance(attackerDef, { instanceId: "atk-1" });

      // 相手スピリット（BP修正の対象）
      const opponentDef = makeDef({ cardNo: "OPP-001" });
      registerDef(opponentDef);
      const opponentCard = makeInstance(opponentDef, {
        instanceId: "opp-1",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
      });

      const state = makeState([attackerCard, opponentCard]);

      // retrigger を手動登録
      const rt = makeRetriggerCE({
        sourceDefinitionId: "MAGIC-001",
        retriggerFilter: { category: ["spirit"] },
        createdAtTurn: state.turnNumber,
        retriggerMaxCount: 3,
      });
      const stateWithRt: GameState = {
        ...state,
        activeContinuousEffects: [rt],
      };

      const result = executeMatchingRetriggers({
        state: stateWithRt,
        event: "attack",
        triggerCard: attackerCard,
        triggerCardDefinition: attackerDef,
        getCardDefinitionById: getDef,
      });

      // retriggerFireCount がインクリメントされた
      const retriggerCEs = getRetriggerCEs(result);
      expect(retriggerCEs[0]!.retriggerFireCount).toBe(1);

      // 発火ログが出力された
      const fireLogs = result.log.filter((l) => l.includes("retrigger:fire"));
      expect(fireLogs).toHaveLength(1);
    });

    // ENGINE-borrow-retrigger-optional-step-no-resume: 再発火先 step が
    // executionMode:"optional" でも、executeMatchingRetriggers が
    // autoResumePendingOptionalSteps 経由で常に execute 側を選んで自動 resume し、
    // action 本体 (draw) が実際に発揮されることを検証する
    // (修正前は pendingStepOptionalChoice が誰にも resume されず draw が起きなかった)。
    it("再発火先 step が executionMode:optional でも自動 resume され action 本体が発揮される", () => {
      const magicDef = makeDef({
        cardNo: "MAGIC-OPTIONAL",
        printedCategory: "magic",
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [
              {
                action: { kind: "draw", player: "self", count: 1 },
                executionMode: "optional",
                retrigger: {
                  event: "attack",
                  triggerPlayer: "self",
                  maxCount: 3,
                },
              },
            ],
          },
        ],
      });
      registerDef(magicDef);

      const attackerDef = makeDef({ cardNo: "ATK-001", tribe: "星竜" });
      registerDef(attackerDef);
      const attackerCard = makeInstance(attackerDef, { instanceId: "atk-1" });

      const state = makeState([attackerCard]);
      const before = state.players.find((p) => p.id === "alice")!.handCount;

      const rt = makeRetriggerCE({
        sourceDefinitionId: "MAGIC-OPTIONAL",
        createdAtTurn: state.turnNumber,
        retriggerMaxCount: 3,
      });
      const stateWithRt: GameState = {
        ...state,
        activeContinuousEffects: [rt],
      };

      const result = executeMatchingRetriggers({
        state: stateWithRt,
        event: "attack",
        triggerCard: attackerCard,
        triggerCardDefinition: attackerDef,
        getCardDefinitionById: getDef,
      });

      const alice = result.players.find((p) => p.id === "alice")!;
      expect(alice.handCount).toBe(before + 1); // draw 本体が実際に発揮された
      expect(result.pendingStepOptionalChoice).toBeNull();
      const retriggerCEs = getRetriggerCEs(result);
      expect(retriggerCEs[0]!.retriggerFireCount).toBe(1);
    });

    it("autoResolveOptional:false の retrigger は自動解決 retrigger を遮らない", () => {
      const optionalMagicDef = makeDef({
        cardNo: "MAGIC-OPTIONAL-PENDING",
        printedCategory: "magic",
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [
              {
                action: { kind: "draw", player: "self", count: 1 },
                executionMode: "optional",
                retrigger: {
                  event: "attack",
                  triggerPlayer: "self",
                  maxCount: 3,
                  autoResolveOptional: false,
                },
              },
            ],
          },
        ],
      });
      const mandatoryMagicDef = makeDef({
        cardNo: "MAGIC-MANDATORY-SAME-EVENT",
        printedCategory: "magic",
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
          },
        ],
      });
      registerDef(optionalMagicDef);
      registerDef(mandatoryMagicDef);

      const attackerDef = makeDef({ cardNo: "ATK-OPTIONAL-PENDING" });
      registerDef(attackerDef);
      const optionalMagicCard = makeInstance(optionalMagicDef, {
        instanceId: "magic-1",
        zone: "hand",
      });
      const mandatoryMagicCard = makeInstance(mandatoryMagicDef, {
        instanceId: "magic-2",
        zone: "hand",
      });
      const attackerCard = makeInstance(attackerDef, { instanceId: "atk-1" });
      const state = makeState([
        optionalMagicCard,
        mandatoryMagicCard,
        attackerCard,
      ]);
      const rt1 = makeRetriggerCE({
        effectId: "rt-pending-1",
        sourceInstanceId: "magic-1",
        sourceDefinitionId: "MAGIC-OPTIONAL-PENDING",
        createdAtTurn: state.turnNumber,
        retriggerMaxCount: 3,
        retriggerAutoResolveOptional: false,
      });
      const rt2 = makeRetriggerCE({
        effectId: "rt-mandatory-2",
        sourceInstanceId: "magic-2",
        sourceDefinitionId: "MAGIC-MANDATORY-SAME-EVENT",
        createdAtTurn: state.turnNumber,
        retriggerMaxCount: 3,
      });
      const stateWithRt: GameState = {
        ...state,
        activeContinuousEffects: [rt1, rt2],
      };

      const result = executeMatchingRetriggers({
        state: stateWithRt,
        event: "attack",
        triggerCard: attackerCard,
        triggerCardDefinition: attackerDef,
        getCardDefinitionById: getDef,
      });

      expect(result.pendingStepOptionalChoice).not.toBeNull();
      expect(
        result.log.filter((line) => line.includes("retrigger:fire"))
      ).toHaveLength(2);
      const retriggerCEs = getRetriggerCEs(result);
      expect(
        retriggerCEs.find((ce) => ce.effectId === "rt-pending-1")
          ?.retriggerFireCount
      ).toBe(1);
      expect(
        retriggerCEs.find((ce) => ce.effectId === "rt-mandatory-2")
          ?.retriggerFireCount
      ).toBe(1);
    });

    it("autoResolveOptional:false の retrigger が複数一致しても optional 解決後に残りを再開する", () => {
      const optionalMagicDef = makeDef({
        cardNo: "MAGIC-OPTIONAL-MULTI",
        printedCategory: "magic",
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [
              {
                action: { kind: "draw", player: "self", count: 1 },
                executionMode: "optional",
                retrigger: {
                  event: "attack",
                  triggerPlayer: "self",
                  maxCount: 3,
                  autoResolveOptional: false,
                },
              },
            ],
          },
        ],
      });
      registerDef(optionalMagicDef);

      const attackerDef = makeDef({ cardNo: "ATK-OPTIONAL-MULTI" });
      registerDef(attackerDef);
      const magicCard1 = makeInstance(optionalMagicDef, {
        instanceId: "magic-1",
        zone: "hand",
      });
      const magicCard2 = makeInstance(optionalMagicDef, {
        instanceId: "magic-2",
        zone: "hand",
      });
      const attackerCard = makeInstance(attackerDef, { instanceId: "atk-1" });
      const state = makeState([magicCard1, magicCard2, attackerCard]);
      const stateWithRt: GameState = {
        ...state,
        activeContinuousEffects: [
          makeRetriggerCE({
            effectId: "rt-pending-1",
            sourceInstanceId: "magic-1",
            sourceDefinitionId: "MAGIC-OPTIONAL-MULTI",
            createdAtTurn: state.turnNumber,
            retriggerMaxCount: 3,
            retriggerAutoResolveOptional: false,
          }),
          makeRetriggerCE({
            effectId: "rt-pending-2",
            sourceInstanceId: "magic-2",
            sourceDefinitionId: "MAGIC-OPTIONAL-MULTI",
            createdAtTurn: state.turnNumber,
            retriggerMaxCount: 3,
            retriggerAutoResolveOptional: false,
          }),
        ],
      };

      const afterFirstPending = executeMatchingRetriggers({
        state: stateWithRt,
        event: "attack",
        triggerCard: attackerCard,
        triggerCardDefinition: attackerDef,
        getCardDefinitionById: getDef,
      });

      expect(afterFirstPending.pendingStepOptionalChoice).not.toBeNull();
      expect(afterFirstPending.pendingRetriggerContinuations).toHaveLength(1);
      expect(
        afterFirstPending.pendingRetriggerContinuations[0]!.remainingEffectIds
      ).toEqual(["rt-pending-2"]);
      expect(
        afterFirstPending.log.filter((line) => line.includes("retrigger:fire"))
      ).toHaveLength(1);
      expect(
        getRetriggerCEs(afterFirstPending).find(
          (ce) => ce.effectId === "rt-pending-1"
        )?.retriggerFireCount
      ).toBe(1);
      expect(
        getRetriggerCEs(afterFirstPending).find(
          (ce) => ce.effectId === "rt-pending-2"
        )?.retriggerFireCount
      ).toBe(0);

      const pending = afterFirstPending.pendingStepOptionalChoice!;
      const afterDecline = applyLegalAction({
        state: afterFirstPending,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${pending.pendingId}:decline`,
          can: true,
          reason: "test",
          actingPlayerId: pending.choosingPlayerId,
          pendingId: pending.pendingId,
          sourceInstanceId: pending.sourceInstanceId,
          effectIndex: pending.effectIndex,
          stepIndex: pending.stepIndex,
          choice: "decline",
        },
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;

      expect(afterDecline.pendingStepOptionalChoice).not.toBeNull();
      expect(afterDecline.pendingRetriggerContinuations).toHaveLength(0);
      expect(
        afterDecline.log.filter((line) => line.includes("retrigger:fire"))
      ).toHaveLength(2);
      expect(
        getRetriggerCEs(afterDecline).find(
          (ce) => ce.effectId === "rt-pending-2"
        )?.retriggerFireCount
      ).toBe(1);
    });

    it("autoResolveOptional:false の retrigger は optional target selection 後も合成 effect で再開する", () => {
      const optionalTargetMagicDef = makeDef({
        cardNo: "MAGIC-OPTIONAL-TARGET-RETRIGGER",
        printedCategory: "magic",
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [
              {
                id: "original-prefix-draw",
                action: { kind: "draw", player: "self", count: 1 },
              },
              {
                id: "retrigger-optional-destroy",
                action: {
                  kind: "destroy",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: { category: ["spirit"] },
                    count: 1,
                  },
                },
                executionMode: "optional",
                retrigger: {
                  event: "attack",
                  triggerPlayer: "self",
                  maxCount: 3,
                  autoResolveOptional: false,
                },
              },
            ],
          },
        ],
      });
      registerDef(optionalTargetMagicDef);

      const attackerDef = makeDef({ cardNo: "ATK-OPTIONAL-TARGET" });
      const targetDef = makeDef({ cardNo: "TARGET-OPTIONAL-TARGET" });
      registerDef(attackerDef);
      registerDef(targetDef);
      const magicCard = makeInstance(optionalTargetMagicDef, {
        instanceId: "magic-1",
        zone: "hand",
      });
      const attackerCard = makeInstance(attackerDef, {
        instanceId: "atk-1",
      });
      const targetCard1 = makeInstance(targetDef, {
        instanceId: "target-1",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
      });
      const targetCard2 = makeInstance(targetDef, {
        instanceId: "target-2",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
      });
      const state = makeState([
        magicCard,
        attackerCard,
        targetCard1,
        targetCard2,
      ]);
      const stateWithRt: GameState = {
        ...state,
        activeContinuousEffects: [
          makeRetriggerCE({
            effectId: "rt-optional-target",
            sourceInstanceId: "magic-1",
            sourceDefinitionId: "MAGIC-OPTIONAL-TARGET-RETRIGGER",
            createdAtTurn: state.turnNumber,
            retriggerStepIndex: 1,
            retriggerMaxCount: 3,
            retriggerAutoResolveOptional: false,
          }),
        ],
      };
      const beforeHandCount = stateWithRt.players.find(
        (player) => player.id === "alice"
      )!.handCount;

      const afterRetrigger = executeMatchingRetriggers({
        state: stateWithRt,
        event: "attack",
        triggerCard: attackerCard,
        triggerCardDefinition: attackerDef,
        getCardDefinitionById: getDef,
      });
      const optionalPending = afterRetrigger.pendingStepOptionalChoice!;
      const afterExecuteChoice = applyLegalAction({
        state: afterRetrigger,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${optionalPending.pendingId}:execute`,
          can: true,
          reason: "test",
          actingPlayerId: optionalPending.choosingPlayerId,
          pendingId: optionalPending.pendingId,
          sourceInstanceId: optionalPending.sourceInstanceId,
          effectIndex: optionalPending.effectIndex,
          stepIndex: optionalPending.stepIndex,
          choice: "execute",
        },
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;

      const targetPending =
        afterExecuteChoice.pendingStepOptionalTargetSelection!;
      expect(targetPending.targetStepId).toBe("retrigger-optional-destroy");
      const afterTargetSelection = applyLegalAction({
        state: afterExecuteChoice,
        action: {
          kind: "resolve_pending_step_optional_target_selection",
          actionId: `psots-${targetPending.pendingId}`,
          can: true,
          reason: "test",
          actingPlayerId: targetPending.choosingPlayerId,
          pendingId: targetPending.pendingId,
          sourceInstanceId: targetPending.sourceInstanceId,
          sourceDefinitionId: targetPending.sourceDefinitionId,
          effectIndex: targetPending.effectIndex,
          stepIndex: targetPending.stepIndex,
          requiredTargetCount: targetPending.requiredTargetCount,
          maxTargetCount: targetPending.maxTargetCount,
          candidateTargetInstanceIds: targetPending.candidateInstanceIds,
        },
        targetInstanceIds: ["target-2"],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;

      expect(afterTargetSelection.pendingStepOptionalChoice).toBeNull();
      expect(
        afterTargetSelection.pendingStepOptionalTargetSelection
      ).toBeNull();
      expect(
        afterTargetSelection.players.find((player) => player.id === "alice")!
          .handCount
      ).toBe(beforeHandCount);
      expect(
        afterTargetSelection.cardInstances.find(
          (card) => card.instanceId === "target-2"
        )?.zone
      ).toBe("trash");
      expect(
        afterTargetSelection.cardInstances.find(
          (card) => card.instanceId === "target-1"
        )?.zone
      ).toBe("field");
    });

    it("フィルタに合致しないカードではマッチしない", () => {
      const magicDef = makeDef({
        cardNo: "MAGIC-001",
        printedCategory: "magic",
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [
              {
                action: {
                  kind: "bp_modify",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: { category: ["spirit"] },
                    count: "all",
                  },
                  amount: -2000,
                  duration: { scope: "turn" },
                },
                retrigger: {
                  event: "attack",
                  triggerPlayer: "self",
                  triggerFilter: {
                    category: ["spirit"],
                    tribesRequired: ["幻想"],
                  },
                  maxCount: 6,
                },
              },
            ],
          },
        ],
      });
      registerDef(magicDef);

      // tribe が 幻想 ではないスピリット
      const attackerDef = makeDef({ cardNo: "ATK-001", tribe: "星竜" });
      registerDef(attackerDef);
      const attackerCard = makeInstance(attackerDef, { instanceId: "atk-1" });

      const state = makeState([attackerCard]);
      const rt = makeRetriggerCE({
        sourceDefinitionId: "MAGIC-001",
        retriggerFilter: { category: ["spirit"], tribesRequired: ["幻想"] },
        createdAtTurn: state.turnNumber,
        retriggerMaxCount: 6,
      });
      const stateWithRt: GameState = {
        ...state,
        activeContinuousEffects: [rt],
      };

      const result = executeMatchingRetriggers({
        state: stateWithRt,
        event: "attack",
        triggerCard: attackerCard,
        triggerCardDefinition: attackerDef,
        getCardDefinitionById: getDef,
      });

      // マッチしないので retriggerFireCount は 0 のまま
      const retriggerCEs = getRetriggerCEs(result);
      expect(retriggerCEs[0]!.retriggerFireCount).toBe(0);
    });

    it("retrigger triggerFilter は実効系統で判定する", () => {
      const magicDef = makeDef({
        cardNo: "MAGIC-EFFECTIVE-TRIBE",
        printedCategory: "magic",
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [
              {
                action: { kind: "draw", player: "self", count: 1 },
                retrigger: {
                  event: "attack",
                  triggerPlayer: "self",
                  triggerFilter: {
                    category: ["spirit"],
                    tribesRequired: ["幻想"],
                    tribes: ["導魔", "楽族"],
                  },
                },
              },
            ],
          },
        ],
      });
      registerDef(magicDef);

      const attackerDef = makeDef({ cardNo: "ATK-EFFECTIVE-TRIBE" });
      registerDef(attackerDef);
      const magicCard = makeInstance(magicDef, {
        instanceId: "magic-1",
        zone: "hand",
      });
      const attackerCard = makeInstance(attackerDef, {
        instanceId: "atk-effective-tribe",
      });
      const state = makeState([magicCard, attackerCard]);
      const rt = makeRetriggerCE({
        sourceDefinitionId: "MAGIC-EFFECTIVE-TRIBE",
        retriggerFilter: {
          category: ["spirit"],
          tribesRequired: ["幻想"],
          tribes: ["導魔", "楽族"],
        },
        createdAtTurn: state.turnNumber,
      });
      const addTribeCE: GameState["activeContinuousEffects"][number] = {
        effectId: "ce-add-effective-tribes",
        sourceInstanceId: "tribe-source",
        sourceDefinitionId: "TRIBE-SOURCE",
        actingPlayerId: "alice",
        duration: { scope: "permanent" },
        createdAtTurn: state.turnNumber,
        createdAtAttackId: null,
        modifierTag: "override_properties",
        targetInstanceId: "atk-effective-tribe",
        metadata: { properties: { addTribes: ["幻想", "導魔"] } },
      };
      const stateWithRt: GameState = {
        ...state,
        activeContinuousEffects: [addTribeCE, rt],
      };

      const result = executeMatchingRetriggers({
        state: stateWithRt,
        event: "attack",
        triggerCard: attackerCard,
        triggerCardDefinition: attackerDef,
        getCardDefinitionById: getDef,
      });

      const retriggerCEs = getRetriggerCEs(result);
      expect(retriggerCEs[0]!.retriggerFireCount).toBe(1);
      expect(result.log.some((l) => l.includes("retrigger:fire"))).toBe(true);
    });

    it("maxCount に達したら retrigger が除去される", () => {
      const magicDef = makeDef({
        cardNo: "MAGIC-001",
        printedCategory: "magic",
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [
              {
                action: {
                  kind: "bp_modify",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: { category: ["spirit"] },
                    count: "all",
                  },
                  amount: -1000,
                  duration: { scope: "turn" },
                },
                retrigger: {
                  event: "attack",
                  triggerPlayer: "self",
                  maxCount: 1,
                },
              },
            ],
          },
        ],
      });
      registerDef(magicDef);

      const attackerDef = makeDef({ cardNo: "ATK-001" });
      registerDef(attackerDef);
      const attackerCard = makeInstance(attackerDef, { instanceId: "atk-1" });
      const state = makeState([attackerCard]);

      // retriggerFireCount が retriggerMaxCount - 1 の状態
      const rt = makeRetriggerCE({
        sourceDefinitionId: "MAGIC-001",
        createdAtTurn: state.turnNumber,
        retriggerMaxCount: 1,
      });
      const stateWithRt: GameState = {
        ...state,
        activeContinuousEffects: [rt],
      };

      const result = executeMatchingRetriggers({
        state: stateWithRt,
        event: "attack",
        triggerCard: attackerCard,
        triggerCardDefinition: attackerDef,
        getCardDefinitionById: getDef,
      });

      // maxCount 到達で除去（retrigger CE が 0 件）
      expect(getRetriggerCEs(result)).toHaveLength(0);
      const exhaustedLogs = result.log.filter((l) =>
        l.includes("retrigger:exhausted")
      );
      expect(exhaustedLogs).toHaveLength(1);
    });

    it("相手のアタックでは triggerPlayer=self の retrigger はマッチしない", () => {
      const magicDef = makeDef({
        cardNo: "MAGIC-001",
        printedCategory: "magic",
        effects: [
          {
            timing: { kind: "activated", mode: "flash" },
            steps: [
              {
                action: {
                  kind: "bp_modify",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: { category: ["spirit"] },
                    count: "all",
                  },
                  amount: -2000,
                  duration: { scope: "turn" },
                },
                retrigger: {
                  event: "attack",
                  triggerPlayer: "self",
                  maxCount: 6,
                },
              },
            ],
          },
        ],
      });
      registerDef(magicDef);

      // 相手のスピリットがアタック
      const opponentDef = makeDef({ cardNo: "OPP-ATK" });
      registerDef(opponentDef);
      const opponentCard = makeInstance(opponentDef, {
        instanceId: "opp-atk-1",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
      });

      const state = makeState([opponentCard]);
      const rt = makeRetriggerCE({
        sourceDefinitionId: "MAGIC-001",
        createdAtTurn: state.turnNumber,
        retriggerMaxCount: 6,
      });
      const stateWithRt: GameState = {
        ...state,
        activeContinuousEffects: [rt],
      };

      const result = executeMatchingRetriggers({
        state: stateWithRt,
        event: "attack",
        triggerCard: opponentCard,
        triggerCardDefinition: opponentDef,
        getCardDefinitionById: getDef,
      });

      // マッチしない
      const retriggerCEs = getRetriggerCEs(result);
      expect(retriggerCEs[0]!.retriggerFireCount).toBe(0);
    });
  });

  describe("retrigger 期限切れ除去", () => {
    // P3-15 問題6 対応後: retrigger CE は removeExpiredContinuousEffects に統合された。
    function makeRetriggerCEForExpiry(
      duration: RetriggerEffect["duration"],
      createdAtTurn: number
    ): RetriggerEffect {
      return {
        effectId: "rt-1",
        sourceInstanceId: "magic-1",
        sourceDefinitionId: "MAGIC-001",
        actingPlayerId: "alice",
        modifierTag: "retrigger",
        duration,
        createdAtTurn,
        createdAtAttackId: null,
        retriggerEvent: "attack",
        retriggerPlayer: "self",
        retriggerEffectIndex: 0,
        retriggerStepIndex: 0,
        retriggerFireCount: 0,
      };
    }

    it("turn_end で scope=turn の retrigger が除去される", () => {
      const rt = makeRetriggerCEForExpiry({ scope: "turn" }, 1);
      const state = makeState([]);
      state.activeContinuousEffects = [rt];

      const result = removeExpiredContinuousEffects(state, {
        kind: "turn_end",
      });
      expect(
        result.filter((ce) => ce.modifierTag === "retrigger")
      ).toHaveLength(0);
    });

    it("turn_end で scope=permanent の retrigger は残る", () => {
      const rt = makeRetriggerCEForExpiry({ scope: "permanent" }, 1);
      const state = makeState([]);
      state.activeContinuousEffects = [rt];

      const result = removeExpiredContinuousEffects(state, {
        kind: "turn_end",
      });
      expect(
        result.filter((ce) => ce.modifierTag === "retrigger")
      ).toHaveLength(1);
    });

    it("battle_end で scope=battle の retrigger が除去される", () => {
      const rt: RetriggerEffect = {
        ...makeRetriggerCEForExpiry({ scope: "battle" }, 1),
        createdAtAttackId: "atk-1",
      };
      const state = makeState([]);
      state.activeContinuousEffects = [rt];

      const result = removeExpiredContinuousEffects(state, {
        kind: "battle_end",
        attackId: "atk-1",
      });
      expect(
        result.filter((ce) => ce.modifierTag === "retrigger")
      ).toHaveLength(0);
    });

    // P3-14 D-4: turns / next 拡張
    describe("D-4 turns / next 拡張", () => {
      it("turns=2: 作成ターンの turn_end では消滅せず、次ターンの turn_end で消滅", () => {
        const rt = makeRetriggerCEForExpiry({ scope: "turn", turns: 2 }, 5);
        const state = makeState([]);
        state.activeContinuousEffects = [rt];

        // 作成ターン (turn 5) の turn_end: 残る
        state.turnNumber = 5;
        let result = removeExpiredContinuousEffects(state, {
          kind: "turn_end",
        });
        expect(
          result.filter((ce) => ce.modifierTag === "retrigger")
        ).toHaveLength(1);

        // 次ターン (turn 6) の turn_end: 消滅
        state.turnNumber = 6;
        state.activeContinuousEffects = result;
        result = removeExpiredContinuousEffects(state, { kind: "turn_end" });
        expect(
          result.filter((ce) => ce.modifierTag === "retrigger")
        ).toHaveLength(0);
      });

      it("turns=3: 3 回の turn_end を生き延びる", () => {
        const rt = makeRetriggerCEForExpiry({ scope: "turn", turns: 3 }, 1);
        const state = makeState([]);
        state.activeContinuousEffects = [rt];

        // turn 1: 残る
        state.turnNumber = 1;
        let result = removeExpiredContinuousEffects(state, {
          kind: "turn_end",
        });
        expect(
          result.filter((ce) => ce.modifierTag === "retrigger")
        ).toHaveLength(1);

        // turn 2: 残る
        state.turnNumber = 2;
        state.activeContinuousEffects = result;
        result = removeExpiredContinuousEffects(state, { kind: "turn_end" });
        expect(
          result.filter((ce) => ce.modifierTag === "retrigger")
        ).toHaveLength(1);

        // turn 3: 消滅
        state.turnNumber = 3;
        state.activeContinuousEffects = result;
        result = removeExpiredContinuousEffects(state, { kind: "turn_end" });
        expect(
          result.filter((ce) => ce.modifierTag === "retrigger")
        ).toHaveLength(0);
      });

      it("next=true: 作成ターンを生き延び、次ターンの turn_end で消滅", () => {
        const rt = makeRetriggerCEForExpiry({ scope: "turn", next: true }, 5);
        const state = makeState([]);
        state.activeContinuousEffects = [rt];

        // 作成ターン (turn 5): 残る
        state.turnNumber = 5;
        let result = removeExpiredContinuousEffects(state, {
          kind: "turn_end",
        });
        expect(
          result.filter((ce) => ce.modifierTag === "retrigger")
        ).toHaveLength(1);

        // 次ターン (turn 6): 消滅
        state.turnNumber = 6;
        state.activeContinuousEffects = result;
        result = removeExpiredContinuousEffects(state, { kind: "turn_end" });
        expect(
          result.filter((ce) => ce.modifierTag === "retrigger")
        ).toHaveLength(0);
      });

      it("next=true + turns=2: 合計 3 ターン分の turn_end を生き延びる", () => {
        const rt = makeRetriggerCEForExpiry(
          { scope: "turn", next: true, turns: 2 },
          1
        );
        const state = makeState([]);
        state.activeContinuousEffects = [rt];

        for (const turn of [1, 2]) {
          state.turnNumber = turn;
          const result = removeExpiredContinuousEffects(state, {
            kind: "turn_end",
          });
          expect(
            result.filter((ce) => ce.modifierTag === "retrigger")
          ).toHaveLength(1);
          state.activeContinuousEffects = result;
        }
        state.turnNumber = 3;
        const finalResult = removeExpiredContinuousEffects(state, {
          kind: "turn_end",
        });
        expect(
          finalResult.filter((ce) => ce.modifierTag === "retrigger")
        ).toHaveLength(0);
      });
    });
  });
});
