/**
 * ENGINE-battle-end-pending-triggered-vs-scope-battle-ce:
 * `queueBattleEndTriggers` (card_event:battle_end, deferredTo 無し) で積まれた
 * pendingTriggeredEffects は fireBattleEndDeferrals と異なり同一 executeBattleResolution
 * 呼び出し内では解決されず、後続の別アクション (useResolvePendingTriggeredEffectAsAction) で
 * 解決される。旧実装は `finalizeBattleEndScopeExpirations` (scope:"battle" CE 失効) を
 * executeBattleResolution 内で無条件に呼んでいたため、pendingTriggeredEffects が未解決の
 * まま scope:"battle" effect_immunity が消え、後続の resolve でその耐性が効かなくなる
 * silent gap があった (10_rules/02 L167 違反)。
 *
 * ルール正源: manual/ai-reference/10_rules/02_turn-flow-and-timing.md L167
 *   「バトル終了時 に誘発する効果を先に解決し、バトル中のみ有効な効果が
 *    失効してからバトル終了。」
 *
 * 本テストは alice の attacker に effect_immunity scope:battle が登録されている状況で、
 * bob の card_event:battle_end (pendingTriggeredEffects 経由) の destroy が alice の attacker を
 * 狙う scenario を実行し、
 *
 * - executeBattleResolution 直後: pendingTriggeredEffects が残るため scope:battle CE は
 *   まだ alive (pendingBattleEndFinalizeAttackIds に予約)。
 * - useResolvePendingTriggeredEffectAsAction で pending を解決: destroy 評価時も immunity alive
 *   のため destroy は不発、alice attacker は残存。
 * - 解決完了後: pendingTriggeredEffects が尽きたため scope:battle CE がここで初めて失効。
 *
 * ことを行動レベルで証明する。
 */
import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  executeEffect,
  useResolvePendingTriggeredEffectAsAction,
} from "../src/index";
import { generateTriggeredEffectRegistrations } from "../src/effect/structured-effect-registrations";
import type { ActiveAttack, CardDefinition, GameState } from "../src/index";

function makeAttackerDef(): CardDefinition {
  // alice の attacker。effects[0] = 自分への effect_immunity duration:battle。
  return {
    cardNo: "TEST-PT-ATK",
    name: "テスト攻撃者(pending trigger)",
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
  // bob の効果ソース (バトル不参加、第三者観測)。effects[0] = 第三者
  // game_event:battle_end 観測 (player:"opponent" = 相手 = alice のスピリットが
  // アタック側で参加したバトル終了時。BSTH001-C04 と同型) で相手の spirit 1 体を destroy。
  // deferredTo 無しなので pendingTriggeredEffects に積まれ、明示 resolve アクションが
  // 無いと解決されない (fireBattleEndDeferrals では拾われない)。
  return {
    cardNo: "TEST-PT-OPP",
    name: "テスト相手効果ソース(pending trigger)",
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
          kind: "game_event",
          player: "opponent",
          event: "battle_end",
          action: "attack",
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

describe("ENGINE-battle-end-pending-triggered-vs-scope-battle-ce", () => {
  it("scope:'battle' effect_immunity は battle_end pendingTriggeredEffects の resolve 完了まで alive で、pending destroy を弾く", () => {
    const attackerDef = makeAttackerDef();
    const oppSourceDef = makeOpponentSourceDef();
    const defs = new Map<string, CardDefinition>([
      [attackerDef.cardNo, attackerDef],
      [oppSourceDef.cardNo, oppSourceDef],
    ]);
    const getCardDefinitionById = (id: string) => defs.get(id);
    const registrationsByCardNo = new Map(
      [attackerDef, oppSourceDef].map((def) => [
        def.cardNo,
        generateTriggeredEffectRegistrations(def),
      ])
    );
    const getRegisteredTriggeredEffectActions = (cardNo: string) =>
      registrationsByCardNo.get(cardNo) ?? [];

    const attacker = createCardInstance(attackerDef, {
      instanceId: "pt-atk-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    // bob 側も参加カード (blocker) にして card_event:battle_end の source 判定を通す。
    const oppSource = createCardInstance(oppSourceDef, {
      instanceId: "pt-opp-src-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });

    const attackId = "attack:pt-be-atk:1";
    const activeAttack: ActiveAttack = {
      attackId,
      primaryEntityId: "pt-be-atk",
      participantEntityIds: ["pt-be-atk"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "pt-be-atk", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["pt-be-atk"],
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
          entityId: "pt-be-atk",
          memberInstanceIds: ["pt-atk-1"],
          resolvedBp: 4000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack,
    };

    // 1. alice の attacker のアタック時 effect_immunity を実 effect 経由で発揮 (CE 生成)。
    const afterImmunity = executeEffect({
      chainId: "test:battle-end-pending-triggered-vs-scope-battle-ce:188",
      state: midBattle,
      effect: attackerDef.effects![0]!,
      sourceInstanceId: "pt-atk-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      effectIndex: 0,
    });
    const ceForAttacker = afterImmunity.activeContinuousEffects.find(
      (ce) =>
        ce.targetInstanceId === "pt-atk-1" &&
        ce.modifierTag === "defense_immune" &&
        ce.duration.scope === "battle"
    );
    expect(ceForAttacker).toBeDefined();

    // 2. executeBattleResolution: queueBattleEndTriggers で bob の card_event:battle_end が
    //    pendingTriggeredEffects に積まれる (deferredTo 無しなので fireBattleEndDeferrals では
    //    解決されない)。
    const resolved = executeBattleResolution({
      state: afterImmunity,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });

    const pendingForBob = resolved.state.pendingTriggeredEffects.find(
      (p) =>
        p.attackId === attackId &&
        p.eventKind === "battle_end" &&
        p.actingPlayerId === "bob"
    );
    expect(pendingForBob).toBeDefined();

    // 3. 行動証拠 (engine ordering 修正の本丸その1): pendingTriggeredEffects が残るため
    //    finalize は pendingBattleEndFinalizeAttackIds に予約され、scope:'battle' CE はまだ alive。
    expect(resolved.state.pendingBattleEndFinalizeAttackIds).toContain(
      attackId
    );
    expect(
      resolved.state.activeContinuousEffects.find(
        (ce) =>
          ce.targetInstanceId === "pt-atk-1" &&
          ce.modifierTag === "defense_immune" &&
          ce.duration.scope === "battle"
      )
    ).toBeDefined();

    // 4. bob の pending を解決 (destroy 実行)。resolve 時点でも immunity CE が alive のため
    //    destroy は不発、alice attacker は残存する。
    const resolveResult = useResolvePendingTriggeredEffectAsAction({
      state: resolved.state,
      actingPlayerId: "bob",
      pendingId: pendingForBob!.pendingId,
      resolveEffect: (state) =>
        executeEffect({
          chainId: "test:battle-end-pending-triggered-vs-scope-battle-ce:244",
          state,
          effect: oppSourceDef.effects![0]!,
          sourceInstanceId: "pt-opp-src-1",
          actingPlayerId: "bob",
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions,
          effectIndex: 0,
          targetInstanceIds: ["pt-atk-1"],
        }),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: undefined,
    });

    // 5. 行動証拠 (engine ordering 修正の本丸その2): immunity 由来で destroy は弾かれる。
    //    alice attacker は zone:'field' のまま、pendingLeaveKind は null。
    const survivor = resolveResult.state.cardInstances.find(
      (c) => c.instanceId === "pt-atk-1"
    );
    expect(survivor).toBeDefined();
    expect(survivor!.zone).toBe("field");
    expect(survivor!.pendingLeaveKind).toBeNull();

    // 6. pending drain 完了により scope:'battle' CE はここで失効し、
    //    pendingBattleEndFinalizeAttackIds からも除去される。
    expect(resolveResult.state.pendingBattleEndFinalizeAttackIds).not.toContain(
      attackId
    );
    expect(
      resolveResult.state.activeContinuousEffects.find(
        (ce) =>
          ce.targetInstanceId === "pt-atk-1" &&
          ce.modifierTag === "defense_immune" &&
          ce.duration.scope === "battle"
      )
    ).toBeUndefined();
  });
});
