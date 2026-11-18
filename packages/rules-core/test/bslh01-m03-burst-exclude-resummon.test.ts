import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
/**
 * BSLH01-M03「[碧の軌跡]ヨシュア・ブライト」effects[0]
 * 【バースト：相手のスピリット/アルティメットのアタック後】:
 * 「このカードをコストを支払わずに召喚するか、自分の魂状態の対象にコストを支払わずに
 * セットする。その後、スピリット/アルティメット2体までを除外する。この効果発揮後、
 * 除外した対象を持ち主のフィールドに疲労状態でコストを支払わずに召喚する。」
 *
 * BSLH01-M04effects[0] (choice: summon(self,free) / quartz_set(self,free)) と同型パターン。
 * 「除外→持ち主のフィールドに疲労状態で再召喚」は summon target.kind:"ref"
 * (engine-exclude-owner-resummon-exhausted 新設 primitive、toOwnerField/entersExhausted) で表現。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";
import { resumeStackCascadeIfReady } from "../src/legal/stack-resolution-core";
import { getBlockDeclarationBlockReason } from "../src/battle/battle-availability";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noLookup = () => [];

const ALICE = "alice";
const BOB = "bob";

const M03 = card("BSLH01-M03");

function alice(state: GameState) {
  return state.players.find((p) => p.id === ALICE)!;
}
function bob(state: GameState) {
  return state.players.find((p) => p.id === BOB)!;
}

const testSpiritDef: CardDefinition = {
  cardNo: "TEST-M03-SPIRIT",
  name: "テストスピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const defs = new Map<string, CardDefinition>([
  [testSpiritDef.cardNo, testSpiritDef],
]);
const getCardDefinitionById = (id: string) => defs.get(id) ?? getDef(id);

function buildState(): GameState {
  const m03 = createCardInstance(M03, {
    instanceId: "m03-self",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  // normalCoreCount:0 で開始する（除外時に持ち主のリザーブへ戻るコアが0のため、
  // 再召喚時の維持コア充当がリザーブ増減に素直に現れる。1個のせて開始すると
  // 「除外で+1戻る→再召喚で-1充当」のネットゼロと相殺してテストの意図が読めなくなる）。
  const aliceSpirit = createCardInstance(testSpiritDef, {
    instanceId: "alice-spirit",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  const bobSpirit = createCardInstance(testSpiritDef, {
    instanceId: "bob-spirit",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "field",
    normalCoreCount: 0,
  });
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [m03, aliceSpirit, bobSpirit],
    playerOverrides: [
      { reserveNormalCoreCount: 5 },
      { reserveNormalCoreCount: 5 },
    ],
  });
}

describe("BSLH01-M03 effects[0]: burst choice(summon/quartz_set free) + exclude up to 2 -> resummon to owner field exhausted", () => {
  it("stub フィールドが解消されている", () => {
    expect(M03.effects![0]!.stub).toBeUndefined();
  });

  it("burst trigger は「相手のスピリット/アルティメットのアタック後」を表す構造化 trigger", () => {
    expect(M03.effects![0]!.timing).toEqual({
      kind: "burst",
      trigger: { kind: "attack_finished", player: "opponent" },
    });
  });

  it("[board] choiceIndex 1: 魂状態の対象へのクォーツセットは countCost 2 を支払わない", () => {
    const source = createCardInstance(M03, {
      instanceId: "m03-free-quartz-set",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const host = createCardInstance(card("BSLH01-CX01"), {
      instanceId: "m03-free-quartz-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [source, host],
      playerOverrides: [{ countValue: 2, reserveNormalCoreCount: 5 }, {}],
    });
    const state: GameState = {
      ...base,
      players: base.players.map((player) =>
        player.id === ALICE
          ? { ...player, soulStateInstanceIds: [host.instanceId] }
          : player
      ),
    };
    const countBefore = alice(state).countValue;
    const reserveBefore = alice(state).reserveNormalCoreCount;
    const after = executeEffect({
      chainId: "test:bslh01-m03-burst-exclude-resummon:140",
      state,
      effect: { ...M03.effects![0]!, steps: [M03.effects![0]!.steps[0]!] },
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noLookup,
      choiceIndex: 1,
    });

    const sourceAfter = after.cardInstances.find(
      (candidate) => candidate.instanceId === source.instanceId
    )!;
    expect(sourceAfter.zoneRoleName).toBe("quartz");
    expect(
      after.quartzSetStates.some(
        (entry) =>
          entry.quartzInstanceId === source.instanceId &&
          entry.hostInstanceId === host.instanceId
      )
    ).toBe(true);
    expect(alice(after).countValue).toBe(countBefore);
    expect(alice(after).reserveNormalCoreCount).toBe(reserveBefore);
  });

  it("[board] choiceIndex 0: コストなし召喚→自分/相手のスピリットを除外→両者とも持ち主のフィールドへ疲労状態で再召喚", () => {
    const state = buildState();
    const aliceReserveBefore = alice(state).reserveNormalCoreCount;
    const bobReserveBefore = bob(state).reserveNormalCoreCount;

    const finalized = finalizeEffectResolution({
      chainId: "test:bslh01-m03-burst-exclude-resummon:171",
      beforeState: state,
      endLogs: [],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredBurstActions: noLookup,
      state: executeEffectWithChosenMinimumCores({
        chainId: "test:bslh01-m03-burst-exclude-resummon:171",
        state,
        effect: M03.effects![0]!,
        sourceInstanceId: "m03-self",
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noLookup,
        choiceIndex: 0,
        // 「2体まで」は任意選択(count:{min:0,max:2})のため、非対話経路では auto-resolve が
        // min(0) を選び unit test から確認できない。明示 targetInstanceIds + targetStepId で
        // プレイヤーが2体とも選んだ場合を再現する（bsaz01-cards.test.ts 等の precedent と同型）。
        targetInstanceIds: ["alice-spirit", "bob-spirit"],
        targetStepId: "exclude-targets",
        targetSelectionResolved: true,
      }),
    });

    const after = resumeStackCascadeIfReady(finalized, {
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noLookup,
      getRegisteredBurstActions: noLookup,
    });
    const m03After = after.cardInstances.find(
      (c) => c.instanceId === "m03-self"
    )!;
    expect(m03After.zone).toBe("field");

    const aliceSpiritAfter = after.cardInstances.find(
      (c) => c.instanceId === "alice-spirit"
    )!;
    const bobSpiritAfter = after.cardInstances.find(
      (c) => c.instanceId === "bob-spirit"
    )!;

    // 除外→持ち主のフィールドへ疲労状態で再召喚（持ち主が誰であっても、その持ち主自身の
    // フィールド/コントロールへ戻る。actingPlayerId=ALICE のフィールドへ誤って集約されない
    // ことを toOwnerField:true の正当性として確認する）。
    expect(aliceSpiritAfter.zone).toBe("field");
    expect(aliceSpiritAfter.controllerPlayerId).toBe(ALICE);
    expect(aliceSpiritAfter.exhaustState).toBe("exhausted");
    expect(aliceSpiritAfter.normalCoreCount).toBe(1);

    expect(bobSpiritAfter.zone).toBe("field");
    expect(bobSpiritAfter.controllerPlayerId).toBe(BOB);
    expect(bobSpiritAfter.exhaustState).toBe("exhausted");
    expect(bobSpiritAfter.normalCoreCount).toBe(1);

    // 維持コアはそれぞれの持ち主自身のリザーブから充当される（コストは支払わない=0）。
    // alice はさらに m03 自身の自己召喚 (minCores=1) 分も自分のリザーブから消費するため -2。
    expect(alice(after).reserveNormalCoreCount).toBe(aliceReserveBefore - 2);
    expect(bob(after).reserveNormalCoreCount).toBe(bobReserveBefore - 1);
  });

  it("[board] Lv2 アタック時、回復はターンに1回だが各アタックのブロック不可は登録される", () => {
    const source = createCardInstance(M03, {
      instanceId: "m03-attack-once",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    });
    const blocker = createCardInstance(testSpiritDef, {
      instanceId: "m03-attack-blocker",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "recovered",
    });
    const initial: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, blocker],
      }),
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_attack",
      activeAttack: {
        attackId: "m03-attack-1",
        primaryEntityId: "m03-attack-entity",
        participantEntityIds: ["m03-attack-entity"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [
          {
            participantEntityId: "m03-attack-entity",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["m03-attack-entity"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      battleEntities: [
        {
          entityId: "m03-attack-entity",
          memberInstanceIds: [source.instanceId],
          resolvedBp: 3000,
          resolvedSymbols: ["green"],
          attackState: "attacking",
        },
      ],
    };
    const firstPending = executeEffect({
      chainId: "test:bslh01-m03-burst-exclude-resummon:272",
      state: initial,
      effect: M03.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noLookup,
    });
    const executeFirst = getLegalActions({
      state: firstPending,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find(
      (action) =>
        action.kind === "resolve_pending_step_optional_choice" &&
        action.choice === "execute"
    );
    expect(executeFirst).toBeDefined();
    const first = applyLegalAction({
      state: firstPending,
      action: executeFirst!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noLookup,
    }).state;
    const afterFirst = first.cardInstances.find(
      (candidate) => candidate.instanceId === source.instanceId
    )!;
    expect(afterFirst.exhaustState).toBe("recovered");
    expect(
      first.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "unblockable" &&
          ce.targetInstanceId === source.instanceId &&
          ce.duration.scope === "attack" &&
          ce.createdAtAttackId === "m03-attack-1"
      )
    ).toBe(true);

    const exhaustedAgain: GameState = {
      ...first,
      cardInstances: first.cardInstances.map((candidate) =>
        candidate.instanceId === source.instanceId
          ? { ...candidate, exhaustState: "exhausted" as const }
          : candidate
      ),
      activeAttack: {
        ...first.activeAttack!,
        attackId: "m03-attack-2",
      },
    };
    const second = executeEffect({
      chainId: "test:bslh01-m03-burst-exclude-resummon:323",
      state: exhaustedAgain,
      effect: M03.effects![1]!,
      effectIndex: 1,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noLookup,
    });
    const afterSecond = second.cardInstances.find(
      (candidate) => candidate.instanceId === source.instanceId
    )!;
    expect(afterSecond.exhaustState).toBe("exhausted");
    expect(second.log).toContain(
      "effect:step-usage-exhausted:m03-attack-once:1:1"
    );
    expect(
      second.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "unblockable" &&
          ce.targetInstanceId === source.instanceId &&
          ce.duration.scope === "attack" &&
          ce.createdAtAttackId === "m03-attack-2"
      )
    ).toBe(true);
    expect(
      getBlockDeclarationBlockReason({
        state: second,
        actingPlayerId: BOB,
        sourceInstanceId: blocker.instanceId,
        participantEntityId: "m03-attack-entity",
        getCardDefinitionById,
      })
    ).toBe("attacker_unblockable");
  });
});
