/**
 * BSTH05-X04 御社宮神 effects[2] 検証:
 *   Lv3『このスピリットのアタック時』
 *   「バトル終了時、このスピリットのアタックで相手のライフが減っていないとき、
 *    ターンに1回、相手のライフのコア2個を相手のリザーブに置く。」
 *
 * 表現:
 *   - timing: card_event/attack + deferredTo:"battle_end" (即時実行されず
 *     pendingBattleEndDeferrals へ予約される)。
 *   - condition: min_level:3 + 新設 ConditionClause kind:"battle_life_reduced"
 *     (negate:true = 「減っていないとき」)。`fireBattleEndDeferrals` が
 *     `executeBattleResolution` で算出した appliedLifeDamage(>0か) を
 *     `TriggerContext.battleLifeReduced` 経由で運ぶ。
 *   - steps: core_move(life:opponent → reserve:opponent, amount:2)。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  executeEffect,
} from "../src/index";
import type { ActiveAttack, CardDefinition, GameState } from "../src/index";
import { ALL_CARDS } from "../../card-data/src/generated-index";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const ojiya = cardNoMap.get("BSTH05-X04")!;
// effects[2] = Lv3『アタック時』バトル終了時、相手のライフが減っていないとき、
// 相手のライフのコア2個をリザーブへ。
const LIFE_CAP_EFFECT_INDEX = 2;
const lifeCapEffect = ojiya.effects[LIFE_CAP_EFFECT_INDEX]!;

const ALICE = "alice";
const BOB = "bob";

function buildMidBattleState(options: { blocked: boolean }): GameState {
  const { blocked } = options;
  const ojiyaInstance = createCardInstance(ojiya, {
    instanceId: "ojiya-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 4, // Lv3 (requiredCores:4)
  });
  // normalCoreCount:0 — 破壊時にコアがリザーブへ放出される副作用を避け、
  // このテストの主眼 (battle_life_reduced condition) の core_move だけを計測する。
  const blockerInstance = createCardInstance(
    getCardDefinitionById("BSDB01-C05")!,
    {
      instanceId: "blocker-1",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 0,
    }
  );
  const activeAttack: ActiveAttack = {
    attackId: "attack:be-ojiya:1",
    primaryEntityId: "be-ojiya",
    participantEntityIds: ["be-ojiya"],
    groupMode: "single",
    target: { kind: "player", playerId: BOB },
    blockAssignments: [
      {
        participantEntityId: "be-ojiya",
        blockedByEntityIds: blocked ? ["be-blocker"] : [],
      },
    ],
    symbolResolutionOrder: ["be-ojiya"],
    flashBeforeBlockCompleted: true,
    flashAfterBlockCompleted: true,
    flashWindowState: null,
  };
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: blocked
        ? [ojiyaInstance, blockerInstance]
        : [ojiyaInstance],
    }),
    turnNumber: 2,
    activePlayerId: ALICE,
    step: "attack",
    window: "declare_attack",
    activeAttack,
    battleEntities: blocked
      ? [
          {
            entityId: "be-ojiya",
            resolvedBp: 18000,
            attackState: "attacking",
            resolvedSymbols: ["green"],
            memberInstanceIds: ["ojiya-1"],
          },
          {
            entityId: "be-blocker",
            resolvedBp: 2000,
            attackState: "blocking",
            resolvedSymbols: [],
            memberInstanceIds: ["blocker-1"],
          },
        ]
      : [
          {
            entityId: "be-ojiya",
            resolvedBp: 18000,
            attackState: "attacking",
            resolvedSymbols: ["green"],
            memberInstanceIds: ["ojiya-1"],
          },
        ],
  };
}

describe("BSTH05-X04 effects[2]（バトル終了時、相手のライフが減っていないとき相手のライフのコア2個をリザーブへ）", () => {
  it("stub が外れている / textRef [6,7]", () => {
    expect(lifeCapEffect.stub).toBeUndefined();
    expect(lifeCapEffect.textRef).toEqual([6, 7]);
  });

  it("DSL shape: condition に battle_life_reduced(negate:true) を含む", () => {
    expect(lifeCapEffect.timing).toMatchObject({
      kind: "card_event",
      event: "attack",
      deferredTo: "battle_end",
    });
    const hasClause = (lifeCapEffect.condition ?? []).some(
      (c) => c.kind === "battle_life_reduced" && c.negate === true
    );
    expect(hasClause).toBe(true);
  });

  it("ブロックされ相手ライフが減らなかった → battle_life_reduced 不成立(negate) → 相手ライフのコア2個をリザーブへ", () => {
    const queued = executeEffect({
      chainId: "test:bsth05-x04-life-not-reduced-battle-end:135",
      state: buildMidBattleState({ blocked: true }),
      effect: lifeCapEffect,
      sourceInstanceId: "ojiya-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      effectIndex: LIFE_CAP_EFFECT_INDEX,
    });
    expect(queued.pendingBattleEndDeferrals).toHaveLength(1);

    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    const bob = resolved.state.players.find((p) => p.id === BOB)!;
    // ブロックされているためバトル自体のライフダメージは 0。
    expect(bob.lifeNormalCoreCount).toBe(3); // 5 - 2 (効果の core_move のみ)
    expect(bob.reserveNormalCoreCount).toBe(6); // 4(初期) + 2(効果の core_move)
    expect(resolved.state.pendingBattleEndDeferrals).toHaveLength(0);
  });

  it("ブロックされず相手ライフが減った → battle_life_reduced 成立(negate で不成立) → 発動しない", () => {
    const queued = executeEffect({
      chainId: "test:bsth05-x04-life-not-reduced-battle-end:161",
      state: buildMidBattleState({ blocked: false }),
      effect: lifeCapEffect,
      sourceInstanceId: "ojiya-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      effectIndex: LIFE_CAP_EFFECT_INDEX,
    });
    expect(queued.pendingBattleEndDeferrals).toHaveLength(1);

    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    const bob = resolved.state.players.find((p) => p.id === BOB)!;
    // このスピリットのアタックのシンボル(green 1つ)分バトル自体のライフダメージが発生し
    // (5-1=4)、そのライフのコアはバトルの通常処理でリザーブへ置かれる (4+1=5)。
    // battle_life_reduced 成立 → negate 条件不成立 → 効果自体の core_move は追加発生しない。
    expect(bob.lifeNormalCoreCount).toBe(4);
    expect(bob.reserveNormalCoreCount).toBe(5);
    expect(resolved.state.pendingBattleEndDeferrals).toHaveLength(0);
  });

  it("同時アタック (groupMode:simultaneous): このスピリット自身はブロックされ、共同攻撃側だけブロックされずライフが減った場合でも『このスピリットのアタックで』は寄与ゼロとして発動する (adversarial verifier round1 lens1 指摘の回帰)", () => {
    const ojiyaInstance = createCardInstance(ojiya, {
      instanceId: "ojiya-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4, // Lv3
    });
    const allyInstance = createCardInstance(ojiya, {
      instanceId: "ally-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    const blockerInstance = createCardInstance(
      getCardDefinitionById("BSDB01-C05")!,
      {
        instanceId: "blocker-1",
        ownerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 0,
      }
    );
    const activeAttack: ActiveAttack = {
      attackId: "attack:be-ojiya:1",
      primaryEntityId: "be-ojiya",
      participantEntityIds: ["be-ojiya", "be-ally"],
      groupMode: "simultaneous",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        // 自分自身 (be-ojiya) はブロックされている → このスピリットの寄与はゼロ。
        {
          participantEntityId: "be-ojiya",
          blockedByEntityIds: ["be-blocker"],
        },
        // 共同アタック側 (be-ally) はブロックされず、ライフを減らす。
        { participantEntityId: "be-ally", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-ojiya", "be-ally"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: true,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [ojiyaInstance, allyInstance, blockerInstance],
      }),
      turnNumber: 2,
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "be-ojiya",
          resolvedBp: 18000,
          attackState: "attacking",
          resolvedSymbols: ["green"],
          memberInstanceIds: ["ojiya-1"],
        },
        {
          entityId: "be-ally",
          resolvedBp: 18000,
          attackState: "attacking",
          resolvedSymbols: ["green"],
          memberInstanceIds: ["ally-1"],
        },
        {
          entityId: "be-blocker",
          resolvedBp: 2000,
          attackState: "blocking",
          resolvedSymbols: [],
          memberInstanceIds: ["blocker-1"],
        },
      ],
    };

    const queued = executeEffect({
      chainId: "test:bsth05-x04-life-not-reduced-battle-end:265",
      state,
      effect: lifeCapEffect,
      sourceInstanceId: "ojiya-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      effectIndex: LIFE_CAP_EFFECT_INDEX,
    });
    expect(queued.pendingBattleEndDeferrals).toHaveLength(1);

    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    const bob = resolved.state.players.find((p) => p.id === BOB)!;
    // be-ally (green 1つ) 分バトル自体のライフダメージが発生 (5-1=4)。
    // be-ojiya 自身はブロックされているため battle_life_reduced=false (寄与ゼロ) →
    // negate 条件成立 → 効果の core_move (2個) が追加発生する。
    expect(bob.lifeNormalCoreCount).toBe(2); // 5 - 1(バトル) - 2(効果)
    expect(bob.reserveNormalCoreCount).toBe(7); // 4(初期) + 1(バトル) + 2(効果)
    expect(resolved.state.pendingBattleEndDeferrals).toHaveLength(0);
  });

  it("同時アタック (groupMode:simultaneous): このスピリット自身はブロックされていないがシンボル0で寄与ゼロ、共同攻撃側のシンボルだけでライフが減った場合でも『このスピリットのアタックで』は寄与ゼロとして発動する (adversarial verifier round2 lens3 指摘の回帰)", () => {
    const ojiyaInstance = createCardInstance(ojiya, {
      instanceId: "ojiya-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4, // Lv3
    });
    const allyInstance = createCardInstance(ojiya, {
      instanceId: "ally-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack:be-ojiya:2",
      primaryEntityId: "be-ojiya",
      participantEntityIds: ["be-ojiya", "be-ally"],
      groupMode: "simultaneous",
      target: { kind: "player", playerId: BOB },
      blockAssignments: [
        // 自分自身 (be-ojiya) はブロックされていないが、シンボル0で寄与ゼロ。
        { participantEntityId: "be-ojiya", blockedByEntityIds: [] },
        // 共同アタック側 (be-ally) はブロックされず、シンボル1つ分ライフを減らす。
        { participantEntityId: "be-ally", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-ojiya", "be-ally"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: true,
      flashWindowState: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [ojiyaInstance, allyInstance],
      }),
      turnNumber: 2,
      activePlayerId: ALICE,
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "be-ojiya",
          resolvedBp: 18000,
          attackState: "attacking",
          resolvedSymbols: [], // 自身の寄与はゼロ (シンボル0)
          memberInstanceIds: ["ojiya-1"],
        },
        {
          entityId: "be-ally",
          resolvedBp: 18000,
          attackState: "attacking",
          resolvedSymbols: ["green"],
          memberInstanceIds: ["ally-1"],
        },
      ],
    };

    const queued = executeEffect({
      chainId: "test:bsth05-x04-life-not-reduced-battle-end:350",
      state,
      effect: lifeCapEffect,
      sourceInstanceId: "ojiya-1",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      effectIndex: LIFE_CAP_EFFECT_INDEX,
    });
    expect(queued.pendingBattleEndDeferrals).toHaveLength(1);

    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    const bob = resolved.state.players.find((p) => p.id === BOB)!;
    // be-ally (green 1つ) 分バトル自体のライフダメージが発生 (5-1=4)。
    // be-ojiya 自身はブロックされていないが resolvedSymbols=[] で寄与ゼロのため
    // battle_life_reduced=false (寄与ゼロ) → negate 条件成立 →
    // 効果の core_move (2個) が追加発生する。
    expect(bob.lifeNormalCoreCount).toBe(2); // 5 - 1(バトル) - 2(効果)
    expect(bob.reserveNormalCoreCount).toBe(7); // 4(初期) + 1(バトル) + 2(効果)
    expect(resolved.state.pendingBattleEndDeferrals).toHaveLength(0);
  });
});
