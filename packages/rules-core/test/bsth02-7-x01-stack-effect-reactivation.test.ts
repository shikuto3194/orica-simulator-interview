/**
 * BSTH02.7-X01 ゴリアテ人形 effects[2] 配線検証。
 *
 * 原文 textLines[2,3]:
 *   "Lv1-Lv2-Lv3『自分のアタックステップ』
 *    相手がスタック効果を発揮したとき、このスピリットの『このスピリットのアタック時』
 *    効果をLvと〔ターンに1回:同名〕を無視して発揮できる。"
 *
 * 従来 needs-dsl.audit.jsonl は「host非依存の任意効果発揮観測トリガーがengineに0件」の
 * design-flaw として park していたが、再調査の結果、既存 flash_use (P3-73/咲夜BSTH01-X05)
 * と同型の「他プレイヤーの特定タイミング効果使用を見る game_event」primitive を
 * ENGINE-stack-activation-reactivation-trigger として新設すれば表現可能と判明した。
 * flash_use と異なり「マジックのスタック効果が完全解決した後」に発火する
 * (10_rules/08c 導域 magic_stack_domain と同じ裁定)。
 *
 * 効果本体は BSSA01-C04 型の reactivation pattern: 『このスピリットのアタック時』効果
 * (effects[3]) の steps を複製し、applicability/usageLimit を省略することで
 * 「Lvと〔ターンに1回:同名〕を無視」を表現する（カウント1以上条件のみ残す）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { applyLegalAction, getLegalActions } from "../src";
import {
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  type TriggeredEffectActionRegistrationLookup,
} from "../src/effect/structured-effect-registrations";
import { queueStackEffectUsedTriggers } from "../src/effect/trigger-system";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { recordEffectUsage } from "../src/legal/legal-actions-shared";
import { resolveDeferredMagicStack } from "../src/mechanics/magic-system";
import type { ActiveStack, CardDefinition, GameState } from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const X01 = cardNoMap.get("BSTH02.7-X01")!;

const ALICE = "alice";
const BOB = "bob";

function makeMagicDef(): CardDefinition {
  return {
    cardNo: "TEST-BSTH02-7-X01-STACK-MAGIC",
    name: "テストスタックマジック",
    printedCategory: "magic",
    colors: ["blue"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [],
    textLines: ["【スタック】何もしない。"],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "activated", mode: "stack" },
        steps: [],
        textRef: [0],
      },
    ],
  } as CardDefinition;
}

function makeDoutakuSpiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `テスト動玩 ${cardNo}`,
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    tribe: "動玩",
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

describe("BSTH02.7-X01 effects[2]: 相手スタック効果発揮時のアタック時効果再発揮(Lv/回数無視)", () => {
  const effect = X01.effects!.find(
    (e) => e.timing.kind === "game_event" && e.timing.event === "stack"
  )!;

  it("timing: game_event(player:opponent, event:stack) / condition: step_phase(attack,self)+count_value≥1 / usageLimit無し", () => {
    expect(effect.timing).toEqual({
      kind: "game_event",
      player: "opponent",
      event: "stack",
    });
    expect(effect.condition).toEqual([
      { kind: "step_phase", step: "attack", whose: "self" },
      { kind: "count_value", player: "self", min: 1 },
    ]);
    expect(effect.executionMode).toBe("optional");
    expect(effect.usageLimit).toBeUndefined();
    expect(effect.applicability).toBeUndefined();
  });

  it("steps: effects[3](アタック時)と同一 summon free / from [hand,set_aside,trash] / tribes 動玩 / 0..2", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.steps).toHaveLength(1);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("summon");
    if (action.kind === "summon") {
      expect(action.costModifier).toBe("free");
      expect(action.target.kind).toBe("from_zone");
      if (action.target.kind === "from_zone") {
        expect(action.target.zone).toEqual(["hand", "set_aside", "trash"]);
        expect(action.target.filter?.tribes).toEqual(["動玩"]);
        expect(action.target.count).toEqual({ min: 0, max: 2 });
      }
    }
    expect(effect.textRef).toEqual([2, 3]);
  });

  it("相手がスタック(マジック)効果を解決完了したとき、自分のアタックステップ中ならX01がpublic pending triggered effect候補に含まれる(フィールド上=公開情報のためprivateではない)", () => {
    const magicDef = makeMagicDef();
    const magic = createCardInstance(magicDef, {
      instanceId: "magic-1",
      ownerPlayerId: BOB,
      zone: "trash", // 完全解決後は既にトラッシュへ移動済み
    });
    const x01Field = createCardInstance(X01, {
      instanceId: "x01-field-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1, // Lv1 (X01 effects[3] の min_level:2 を満たさない状態)
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [magic, x01Field],
      playerOverrides: [{ countValue: 1 }, {}],
    });
    const withStepScope: GameState = {
      ...state,
      step: "attack",
      activePlayerId: ALICE,
    };
    const getDef = (id: string) =>
      id === X01.cardNo ? X01 : id === magicDef.cardNo ? magicDef : undefined;
    const lookup: TriggeredEffectActionRegistrationLookup =
      buildTriggeredEffectLookup([X01, magicDef]);

    const normalAttackEffectIndex = X01.effects!.findIndex(
      (candidate) =>
        candidate.timing.kind === "card_event" &&
        candidate.timing.event === "attack"
    );
    const usedNormalAttack: GameState = {
      ...withStepScope,
      effectUsageRecords: recordEffectUsage({
        state: withStepScope,
        sourceInstanceId: x01Field.instanceId,
        sourceDefinitionId: X01.cardNo,
        effectLabel: `effect:${normalAttackEffectIndex}`,
        duration: "turn",
      }),
    };

    const queued = queueStackEffectUsedTriggers({
      chainId: "test:bsth02-7-x01-stack-effect-reactivation:167",
      state: usedNormalAttack,
      stackSourceInstanceId: magic.instanceId,
      userPlayerId: BOB,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    const pending = queued.pendingTriggeredEffects.find(
      (p) =>
        p.resolvedSourceInstanceIds.length === 0 &&
        p.eventKind === "stack" &&
        p.actingPlayerId === ALICE
    );
    expect(pending).toBeDefined();
  });

  it("自分自身がスタック効果を使用したとき (player:opponent不一致) は declaration が queue されない", () => {
    const magicDef = makeMagicDef();
    const magic = createCardInstance(magicDef, {
      instanceId: "magic-2",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const x01Field = createCardInstance(X01, {
      instanceId: "x01-field-2",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [magic, x01Field],
      playerOverrides: [{ countValue: 1 }, {}],
    });
    const withStepScope: GameState = {
      ...state,
      step: "attack",
      activePlayerId: ALICE,
    };
    const getDef = (id: string) =>
      id === X01.cardNo ? X01 : id === magicDef.cardNo ? magicDef : undefined;
    const lookup: TriggeredEffectActionRegistrationLookup =
      buildTriggeredEffectLookup([X01, magicDef]);

    const queued = queueStackEffectUsedTriggers({
      chainId: "test:bsth02-7-x01-stack-effect-reactivation:213",
      state: withStepScope,
      stackSourceInstanceId: magic.instanceId,
      userPlayerId: ALICE, // 自分自身が使用 (相手ではない)
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: undefined,
    });

    const pending = queued.pendingTriggeredEffects.find(
      (p) => p.eventKind === "stack"
    );
    expect(pending).toBeUndefined();
  });

  it("[board] Lv1かつ通常アタック時を使用済みでも、相手の見出し付きスタックマジック解決から通常のpending対象選択を経て手札/トラッシュの動玩2枚を無償召喚する", () => {
    const magicDef = makeMagicDef();
    const handDef = makeDoutakuSpiritDef("TEST-BSTH02-7-X01-HAND");
    const trashDef = makeDoutakuSpiritDef("TEST-BSTH02-7-X01-TRASH");
    const magic = createCardInstance(magicDef, {
      instanceId: "opponent-stack-magic",
      ownerPlayerId: BOB,
      zone: "in_use",
    });
    const source = createCardInstance(X01, {
      instanceId: "x01-field-board",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1, // Lv1: reactivation は本文どおり Lv を無視する。
    });
    const handTarget = createCardInstance(handDef, {
      instanceId: "doutaku-hand",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const trashTarget = createCardInstance(trashDef, {
      instanceId: "doutaku-trash",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{ countValue: 1 }, {}],
      cardInstances: [magic, source, handTarget, trashTarget],
    });
    const normalAttackEffectIndex = X01.effects!.findIndex(
      (candidate) =>
        candidate.timing.kind === "card_event" &&
        candidate.timing.event === "attack"
    );
    const usedNormalAttack: GameState = {
      ...base,
      effectUsageRecords: recordEffectUsage({
        state: { ...base, turnNumber: 2 },
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: X01.cardNo,
        effectLabel: `effect:${normalAttackEffectIndex}`,
        duration: "turn",
      }),
    };

    const getDef = (id: string) =>
      id === X01.cardNo
        ? X01
        : id === magicDef.cardNo
          ? magicDef
          : id === handDef.cardNo
            ? handDef
            : id === trashDef.cardNo
              ? trashDef
              : undefined;
    const definitions = [X01, magicDef, handDef, trashDef];
    const lookup = buildTriggeredEffectLookup(definitions);
    const legalLookups = {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(definitions),
      getRegisteredMagicActions: buildMagicLookup(definitions),
    };
    const afterOpponentStack = resolveDeferredMagicStack({
      state: {
        ...usedNormalAttack,
        step: "attack",
        activePlayerId: ALICE,
        turnNumber: 2,
      },
      activeStack: {
        stackId: "stack:opponent-magic",
        actionKind: "magic",
        chainId: "chain:opponent-magic",
        actingPlayerId: BOB,
        cardInstanceId: magic.instanceId,
        cardDefinitionId: magicDef.cardNo,
        targetInstanceIds: [],
        targetEffectFilterTags: ["general"],
        chosenTiming: "stack",
        activationLabel: "stack",
        magicEffectIndex: 0,
        previousResponseSourcePlayerId: null,
        previousPendingStackAction: null,
      } as ActiveStack,
      ...legalLookups,
    });

    expect(
      afterOpponentStack.cardInstances.find(
        (card) => card.instanceId === magic.instanceId
      )?.zone
    ).toBe("trash");
    const pending = afterOpponentStack.pendingTriggeredEffects.find(
      (entry) => entry.eventKind === "stack" && entry.actingPlayerId === ALICE
    );
    expect(
      pending,
      JSON.stringify(afterOpponentStack.pendingTriggeredEffects)
    ).toBeDefined();

    const declaration = getLegalActions({
      state: afterOpponentStack,
      actingPlayerId: ALICE,
      ...legalLookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.pendingId === pending!.pendingId
    );
    expect(declaration).toBeDefined();
    let current = applyLegalAction({
      state: afterOpponentStack,
      action: declaration!,
      ...legalLookups,
    }).state;

    let choseTargets = false;
    for (let i = 0; i < 12 && !choseTargets; i++) {
      const playerId = current.stackWindow?.priorityPlayerId ?? ALICE;
      const actions = getLegalActions({
        state: current,
        actingPlayerId: playerId,
        ...legalLookups,
      });
      const selectTargets = actions.find(
        (action) => action.kind === "resolve_pending_effect_target"
      );
      if (selectTargets) {
        expect(selectTargets.candidateTargetInstanceIds).toEqual(
          expect.arrayContaining([
            handTarget.instanceId,
            trashTarget.instanceId,
          ])
        );
        current = applyLegalAction({
          state: current,
          action: selectTargets,
          targetInstanceIds: [handTarget.instanceId, trashTarget.instanceId],
          ...legalLookups,
        }).state;
        choseTargets = true;
        continue;
      }
      const pass = actions.find((action) => action.kind === "pass_stack");
      if (!pass) break;
      current = applyLegalAction({
        state: current,
        action: pass,
        ...legalLookups,
      }).state;
    }
    expect(choseTargets).toBe(true);

    expect(
      current.cardInstances
        .filter((card) =>
          [handTarget.instanceId, trashTarget.instanceId].includes(
            card.instanceId
          )
        )
        .map((card) => card.zone)
    ).toEqual(["field", "field"]);
    expect(current.pendingCoreSourceAllocation).toBeNull();
  });
});
