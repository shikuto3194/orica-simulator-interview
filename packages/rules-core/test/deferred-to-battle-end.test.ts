import { describe, expect, it } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeBattleResolution,
  executeEffect,
} from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import type { CardDefinition, GameState, ActiveAttack } from "../src/index";
import { BSTH01_CARDS } from "../../card-data/src/cards/BSTH01";

/**
 * BSTH01-R12 幻象「ルナクロック」フラッシュ:
 *   「このバトル終了時、自分の創界神/導界者ネクサスがなければ、アタックステップを終了する。」
 *
 * ルール正源: 10_rules/02_turn-flow-and-timing.md「バトル終了時 に誘発する効果を先に解決し」。
 * 発揮即終了ではなく当該バトル終了時へ予約する (timing.deferredTo === "battle_end")。
 */
describe("deferredTo:battle_end — R12 ルナクロックはバトル終了時へ予約してアタックステップ終了", () => {
  const cardDefs: CardDefinition[] = BSTH01_CARDS;
  const getCardDefinitionById = (id: string) =>
    cardDefs.find((d) => d.cardNo === id);
  const triggeredLookup = buildTriggeredEffectLookup(cardDefs);
  const r12 = cardDefs.find((d) => d.cardNo === "BSTH01-R12")!;
  // effects[1] = フラッシュ activated, deferredTo: "battle_end", steps: end_attack_step
  const flashEffect = r12.effects[1]!;

  function buildMidBattleState(): GameState {
    const r12Instance = createCardInstance(r12, {
      instanceId: "luna-1",
      ownerPlayerId: "bob",
      zone: "trash",
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack:be-1:1",
      primaryEntityId: "be-1",
      participantEntityIds: ["be-1"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "be-1", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-1"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [r12Instance],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "be-1",
          resolvedBp: 5000,
          attackState: "attacking",
          resolvedSymbols: ["red"],
          memberInstanceIds: ["be-1"],
        },
      ],
    };
  }

  it("発揮時は即アタックステップ終了せず pendingBattleEndDeferrals に予約する", () => {
    const state = buildMidBattleState();
    const after = executeEffect({
      chainId: "test:deferred-to-battle-end:72",
      state,
      effect: flashEffect,
      sourceInstanceId: "luna-1",
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: 1,
    });

    // 即終了していない
    expect(after.step).toBe("attack");
    expect(after.activeAttack).not.toBeNull();
    // 予約が積まれている
    expect(after.pendingBattleEndDeferrals).toHaveLength(1);
    expect(after.pendingBattleEndDeferrals[0]).toEqual(
      expect.objectContaining({
        attackId: "attack:be-1:1",
        actingPlayerId: "bob",
        sourceInstanceId: "luna-1",
        sourceDefinitionId: "BSTH01-R12",
        effectIndex: 1,
      })
    );
  });

  it("バトル終了時 (executeBattleResolution 完了) に予約が発火しアタックステップが終了する", () => {
    const queued = executeEffect({
      chainId: "test:deferred-to-battle-end:99",
      state: buildMidBattleState(),
      effect: flashEffect,
      sourceInstanceId: "luna-1",
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: 1,
    });
    expect(queued.step).toBe("attack");

    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });

    // バトルが解決し終えた後にアタックステップが終了している
    expect(resolved.state.step).toBe("end");
    // 予約は消費済み
    expect(resolved.state.pendingBattleEndDeferrals).toHaveLength(0);
  });

  it("バトル外 (activeAttack なし) で発揮しても予約せず不発 (このバトルが指す対象が無い)", () => {
    // ユーザー裁定 2026-05-31: メインステップ等で打っても、続くアタックステップの
    // 最初のバトルでアタックステップが終了したりしない。
    const base = buildMidBattleState();
    const mainStepState: GameState = {
      ...base,
      step: "main",
      window: "none",
      activeAttack: null,
      battleEntities: [],
    };
    const after = executeEffect({
      chainId: "test:deferred-to-battle-end:134",
      state: mainStepState,
      effect: flashEffect,
      sourceInstanceId: "luna-1",
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: 1,
    });

    expect(after.pendingBattleEndDeferrals).toHaveLength(0);
    expect(after.step).toBe("main");
  });

  it("bob に創界神/導界者ネクサスがある場合は発火時条件未達で終了しない", () => {
    // 導界者ネクサスを bob のフィールドに置く (条件 field_lacks が偽になる)。
    const dokaisha = cardDefs.find(
      (d) =>
        d.printedCategory === "nexus" &&
        (d.tribe?.includes("導界者") || d.tribe?.includes("創界神"))
    );
    if (!dokaisha) {
      // データに存在しなければこのケースはスキップ (環境依存)。
      return;
    }
    const base = buildMidBattleState();
    const nexus = createCardInstance(dokaisha, {
      instanceId: "nexus-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const queued = executeEffect({
      chainId: "test:deferred-to-battle-end:166",
      state: { ...base, cardInstances: [...base.cardInstances, nexus] },
      effect: flashEffect,
      sourceInstanceId: "luna-1",
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      effectIndex: 1,
    });
    const resolved = executeBattleResolution({
      state: queued,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });

    // 条件未達 → アタックステップは終了しない (attack のまま)
    expect(resolved.state.step).toBe("attack");
    expect(resolved.state.pendingBattleEndDeferrals).toHaveLength(0);
  });
});
