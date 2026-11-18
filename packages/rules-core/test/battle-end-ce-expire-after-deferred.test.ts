/**
 * ENGINE-battle-end-ce-expire-after-deferred:
 * scope:"battle" CE は `fireBattleEndDeferrals` (deferTo:battle_end 効果の解決) より
 * 後に失効する。
 *
 * ルール正源: manual/ai-reference/10_rules/02_turn-flow-and-timing.md L167
 *   「バトル終了時 に誘発する効果を先に解決し、バトル中のみ有効な効果が
 *    失効してからバトル終了。」
 *
 * 旧実装は `resetBattleEntitiesAfterResolution` 内で
 * `removeExpiredContinuousEffects(battle_end)` を呼び、その後 `fireBattleEndDeferrals` を
 * 呼んでいた。結果として scope:"battle" CE (effect_immunity duration:battle 等) が
 * deferred 解決前に消えるバグ。
 *
 * 本テストは『alice の attacker に effect_immunity scope:battle が登録されている状況で、
 * battle_end deferred として bob の destroy 効果が alice の attacker を狙う』scenario を
 * 直接実行し、新旧実装で観測される最終盤面の差で engine ordering 修正を行動レベルに証明する:
 *
 * - **旧実装**: reset で CE を即除去 → fireBattleEndDeferrals で destroy 評価時に immunity 不在 →
 *   atk-1 が destroy 成立 (pendingLeaveKind:"destroy" or trash 入り)。
 * - **新実装**: fireBattleEndDeferrals 中は CE alive → resolveTargetCards.dropImmune で
 *   atk-1 が候補から外れる → destroy 不発で atk-1 残存 → finalize で CE 失効。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  executeEffect,
} from "../src/index";
import type {
  ActiveAttack,
  CardDefinition,
  GameState,
  PendingBattleEndDeferral,
} from "../src/index";

function makeAttackerDef(): CardDefinition {
  // alice の attacker。effects[0] = 自分への effect_immunity duration:battle
  // (executeEffect 経由で正しい形の CE を生成する)。
  return {
    cardNo: "TEST-ATK",
    name: "テスト攻撃者",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "battle" },
            },
          },
        ],
        textRef: [0],
      },
    ],
  };
}

function makeOpponentSourceDef(): CardDefinition {
  // bob の効果ソース。effects[0] = 相手の spirit 1 体を destroy。
  // pendingBattleEndDeferrals 経由で fireBattleEndDeferrals 中に実行される。
  return {
    cardNo: "TEST-OPP",
    name: "テスト相手効果ソース",
    printedCategory: "spirit",
    colors: ["blue"],
    cost: 1,
    reductionSymbols: ["blue"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["blue"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
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
        textRef: [0],
      },
    ],
  };
}

describe("ENGINE-battle-end-ce-expire-after-deferred", () => {
  it("scope:'battle' effect_immunity は fireBattleEndDeferrals 中も alive で、deferred destroy を弾く (旧実装では弾けず destroy 成立)", () => {
    const attackerDef = makeAttackerDef();
    const oppSourceDef = makeOpponentSourceDef();
    const defs = new Map<string, CardDefinition>([
      [attackerDef.cardNo, attackerDef],
      [oppSourceDef.cardNo, oppSourceDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);

    const attacker = createCardInstance(attackerDef, {
      instanceId: "atk-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const oppSource = createCardInstance(oppSourceDef, {
      instanceId: "opp-src-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });

    const attackId = "attack:be-atk:1";
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "be-atk",
      participantEntityIds: ["be-atk"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "be-atk", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-atk"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };

    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [attacker, oppSource],
    });
    const midBattle: GameState = {
      ...baseState,
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      battleEntities: [
        {
          entityId: "be-atk",
          memberInstanceIds: ["atk-1"],
          resolvedBp: 4000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack,
    };

    // 1. alice の attacker のアタック時 effect_immunity を実 effect 経由で発揮 (CE 生成)。
    const afterImmunity = executeEffect({
      chainId: "test:battle-end-ce-expire-after-deferred:176",
      state: midBattle,
      effect: attackerDef.effects![0]!,
      sourceInstanceId: "atk-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      effectIndex: 0,
    });
    // CE が `defense_immune` として登録されたことを sanity check。
    const ceForAttacker = afterImmunity.activeContinuousEffects.find(
      (ce) =>
        ce.targetInstanceId === "atk-1" &&
        ce.modifierTag === "defense_immune" &&
        ce.duration.scope === "battle"
    );
    expect(ceForAttacker).toBeDefined();

    // 2. bob の deferred destroy 効果を発揮 (deferredTo:battle_end で pending に積まれる)。
    const afterDeferralQueue = executeEffect({
      chainId: "test:battle-end-ce-expire-after-deferred:195",
      state: afterImmunity,
      effect: oppSourceDef.effects![0]!,
      sourceInstanceId: "opp-src-1",
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      effectIndex: 0,
    });
    const queuedDeferral = afterDeferralQueue.pendingBattleEndDeferrals.find(
      (d) => d.sourceInstanceId === "opp-src-1"
    );
    expect(queuedDeferral).toBeDefined();
    expect((queuedDeferral as PendingBattleEndDeferral).actingPlayerId).toBe(
      "bob"
    );

    // 3. executeBattleResolution → reset → fireBattleEndDeferrals (deferred destroy 実行) → finalize。
    const resolved = executeBattleResolution({
      state: afterDeferralQueue,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    // 4. 行動証拠: deferral は消費。log に fire 記録。
    expect(resolved.state.pendingBattleEndDeferrals).toHaveLength(0);
    const log = resolved.state.log.join("\n");
    expect(log).toContain(`battle:end-deferral:fire:${attackId}:opp-src-1:0`);

    // 5. 行動証拠 (engine ordering 修正の本丸):
    //    immunity 由来で deferred destroy は **弾かれる**。alice attacker は zone:'field' のまま、
    //    pendingLeaveKind は null。旧実装では CE 先消えるため destroy が成立し
    //    pendingLeaveKind === "destroy" あるいは zone !== "field" になる。
    const survivor = resolved.state.cardInstances.find(
      (c) => c.instanceId === "atk-1"
    );
    expect(survivor).toBeDefined();
    expect(survivor!.zone).toBe("field");
    expect(survivor!.pendingLeaveKind).toBeNull();

    // 6. finalize で scope:'battle' CE は失効。
    expect(
      resolved.state.activeContinuousEffects.find(
        (ce) =>
          ce.targetInstanceId === "atk-1" &&
          ce.modifierTag === "defense_immune" &&
          ce.duration.scope === "battle"
      )
    ).toBeUndefined();
  });
});
