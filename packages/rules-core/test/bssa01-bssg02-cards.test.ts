import { acceptOptionalSteps } from "./crossover-fidelity-test-helpers";
/**
 * BSSA01 (SAO アリシゼーション 公理協会編) + BSSG02 (シンフォギア追加) カードの
 * effects 検証テスト。
 * 夜錆/転醒/創界神(カーディナル)/装者 中心。
 * 転醒トリガー(自カード flip 外の発火)・多色 treat_as・聖詠(入れ替え)・コア数連動 prevent_battle・
 * 神技4(外部転醒。BSSA01-XX01 divineSkills[1].effects + 転醒対象 A 面の
 * postRebirthChoice 継承)は配線済み。
 * 配置時 BP-debuff→BP0破壊 / 召喚時 deck_reveal+コア配置 / 神技2 ドロー択一 等は DSL 変換済み。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  queuePendingReactionsFromTriggerEvents,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import {
  expandCardDefinitionsWithBackFaces,
  generateDivineSkillTargetRegistration,
} from "../src/effect/structured-effect-registrations";

const expandedCardDefinitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

function declinePendingBurstChecks(
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined,
  triggeredLookup: NonNullable<
    Parameters<typeof getLegalActions>[0]["getRegisteredTriggeredEffectActions"]
  >
): GameState {
  let current = state;
  while (current.pendingBurstChecks.length > 0) {
    const check = current.pendingBurstChecks[0]!;
    current = applyLegalAction({
      state: current,
      action: {
        chainId: "test:bssa01-bssg02-cards:54",
        kind: "decline_pending_burst_check",
        actionId: `decline:${check.checkId}`,
        can: true,
        reason: "test",
        actingPlayerId: check.actingPlayerId,
        checkId: check.checkId,
        eventKind: check.eventKind,
        relatedPlayerId: check.relatedPlayerId,
      },
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
  }
  return current;
}

describe("BSSG02-C01 マリア・カデンツァヴナ・イヴ", () => {
  const c = card("BSSG02-C01");

  it("召喚時: ボイド→リザーブ コア1 + deck_reveal3(装者) / 自身耐性+アタックブロック不可", () => {
    const summon = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "summon"
    )!;
    expect(summon.steps[0]!.action.kind).toBe("core_move");
    const reveal = summon.steps[1]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(3);
      expect(reveal.picks[0]!.filter).toEqual({ tribes: ["装者"] });
      expect(reveal.remainder).toBe("bottom");
    }
    // 耐性 + アタック/ブロック不可（継続）。
    const cont = c.effects!.find(
      (e) =>
        e.timing.kind === "continuous" &&
        e.steps.some((s) => s.action.kind === "effect_immunity")
    )!;
    expect(cont.steps.map((s) => s.action.kind)).toEqual([
      "effect_immunity",
      "prevent_battle",
    ]);
    const pb = cont.steps[1]!.action;
    if (pb.kind === "prevent_battle") {
      expect(pb.restriction).toEqual(["attack", "block"]);
    }
    // 同名フィールド唯一性と聖詠入替は実装済み。
    expect(c.effects![0]!.stub).toBeUndefined();
    expect(c.effects![0]!.steps[0]!.action.kind).toBe("field_name_uniqueness");
    const song = c.effects!.find((e) => e.textRef?.includes(9))!;
    expect(song.stub).toBeUndefined();
    expect(song.timing).toEqual({
      kind: "phase",
      step: "attack",
      subPhase: "start",
      whose: "either",
    });
    expect(song.executionMode).toBe("optional");
    expect(song.steps[0]!.action).toEqual({
      kind: "queue_field_hand_swap",
      effectScope: "shouei",
      incomingFilter: {
        category: ["spirit"],
        cardName: "self",
        minCost: 4,
        maxCost: 5,
      },
      enterRecovered: true,
    });
    expect(c.effects!.filter((e) => e.stub).length).toBe(0);
  });

  it("召喚時実行: ボイドのコア1個がリザーブへ移動する（盤面変化）", () => {
    const self = createCardInstance(c, {
      instanceId: "maria-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { voidNormalCoreCount: 3, reserveNormalCoreCount: 0 },
        ],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self],
    };
    const summon = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "summon"
    )!;
    const result = acceptOptionalSteps(
      executeEffect({
        chainId: "test:bssa01-bssg02-cards:149",
        state,
        effect: summon,
        sourceInstanceId: "maria-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
      }),
      getCardDefinitionById
    );
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(alice.voidNormalCoreCount).toBe(2);
  });

  it("聖詠: 手札のコスト4/5同名だけを候補にし、回復状態でフィールド⇔手札を入れ替える", () => {
    const song = c.effects!.find((e) => e.textRef?.includes(9))!;
    const mariaLv4: CardDefinition = {
      ...c,
      cardNo: "BSSG02-C01-LV4-TEST",
      cost: 4,
    };
    const mariaLv6: CardDefinition = {
      ...c,
      cardNo: "BSSG02-C01-LV6-TEST",
      cost: 6,
    };
    const getDef = (id: string): CardDefinition | undefined =>
      id === mariaLv4.cardNo
        ? mariaLv4
        : id === mariaLv6.cardNo
          ? mariaLv6
          : getCardDefinitionById(id);
    const fieldMaria = createCardInstance(c, {
      instanceId: "maria-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
      exhaustState: "exhausted",
    });
    const handLv4 = createCardInstance(mariaLv4, {
      instanceId: "maria-hand-4",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      exhaustState: "exhausted",
    });
    const handLv6 = createCardInstance(mariaLv6, {
      instanceId: "maria-hand-6",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ reserveNormalCoreCount: 0 }],
      }),
      activePlayerId: "bob",
      step: "attack",
      window: "step_start",
      cardInstances: [fieldMaria, handLv4, handLv6],
    };
    const queued = executeEffect({
      chainId: "test:bssa01-bssg02-cards:212",
      state,
      effect: song,
      sourceInstanceId: "maria-field",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(queued.pendingFieldHandSwapChoice).not.toBeNull();
    expect(
      queued.pendingFieldHandSwapChoice!.incomingCandidateInstanceIds
    ).toEqual(["maria-hand-4"]);

    const actions = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    expect(actions.filter((a) => a.kind === "swap_field_hand")).toHaveLength(1);
    expect(
      actions.filter((a) => a.kind === "decline_field_hand_swap")
    ).toHaveLength(0);

    const result = applyLegalAction({
      state: queued,
      action: {
        kind: "swap_field_hand",
        actionId: "test:swap-field-hand",
        can: true,
        reason: "test",
        actingPlayerId: "alice",
        pendingId: queued.pendingFieldHandSwapChoice!.pendingId,
        sourceInstanceId: "maria-field",
        sourceCardNo: c.cardNo,
        incomingCardInstanceId: "maria-hand-4",
        incomingCardNo: mariaLv4.cardNo,
      },
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => undefined,
    });

    const after = result.state;
    expect(after.pendingFieldHandSwapChoice).toBeNull();
    expect(
      after.cardInstances.find((x) => x.instanceId === "maria-field")!.zone
    ).toBe("hand");
    const incoming = after.cardInstances.find(
      (x) => x.instanceId === "maria-hand-4"
    )!;
    expect(incoming.zone).toBe("field");
    expect(incoming.exhaustState).toBe("recovered");
    expect(incoming.normalCoreCount).toBe(2);
    expect(
      after.players.find((p) => p.id === "alice")!.reserveNormalCoreCount
    ).toBe(0);
    expect(after.log).toContain("swap_field_hand:maria-field<->maria-hand-4");
  });
});

describe("BSSA01-C02 ユージオ", () => {
  const c = card("BSSA01-C02");

  it("召喚時: 外側は任意発揮、内側の各「できる」も step optional として保持する", () => {
    const summon = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "summon"
    )!;
    expect(summon.executionMode).toBe("optional");
    expect(summon.steps.map((step) => step.executionMode)).toEqual([
      "optional",
      "optional",
      "optional",
    ]);

    const eugeo = createCardInstance(c, {
      instanceId: "eugeo-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [eugeo],
      }),
      activePlayerId: "bob",
      step: "main",
      pendingTriggeredEffects: [
        {
          pendingId: "pending:eugeo-summon",
          eventKind: "summon",
          actingPlayerId: "bob",
          source: "action_resolution",
          chainId: "chain:eugeo-summon",
          attackId: null,
          relatedPlayerId: "bob",
          relatedInstanceId: "eugeo-1",
          amount: null,
          step: "main",
          window: "default",
          resolvedSourceInstanceIds: [],
        },
      ],
    };
    const triggeredLookup = buildTriggeredEffectLookup(expandedCardDefinitions);

    const actions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    const resolveActions = actions.filter(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "eugeo-1"
    );
    expect(resolveActions).toHaveLength(1);
    expect(resolveActions[0]).toMatchObject({
      executionMode: "optional",
      targetMode: "none",
      requiredTargetCount: 0,
    });
  });
});

describe("BSSA01-転醒X01(A) 悪魔の樹 ギガスシダー", () => {
  const c = card("BSSA01-転醒X01(A)");
  const back = c.backFace!;
  const getBssaX01BackDefinitionById = (
    id: string
  ): CardDefinition | undefined =>
    id === back.cardNo ? back : getCardDefinitionById(id);
  it("配置時 draw1 / 多色treat_as 実装 / コア数prevent 実装 / 転醒トリガー2系統(夜錆ally召喚煌臨+leave_field)+合体/コア1個スピリット状態化 post-choice を実装", () => {
    const place = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "place"
    )!;
    expect(place.steps[0]!.action.kind).toBe("draw");
    // [2] 転醒トリガー1: 系統「夜錆」を持つ自分のスピリット召喚/煌臨 (game_event)。
    const allyTrigger = c.effects!.find((e) => e.timing.kind === "game_event")!;
    expect(allyTrigger.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: ["summon", "advent"],
      triggerFilter: { category: ["spirit"], tribes: ["夜錆"] },
    });
    expect(allyTrigger.executionMode).toBe("optional");
    expect(allyTrigger.condition).toEqual([
      { kind: "count_value", player: "self", max: 5 },
    ]);
    expect(allyTrigger.stub).toBeUndefined();
    // [2] 転醒トリガー2: このネクサスが相手によってフィールドを離れるとき (card_event:leave_field)。
    const leaveTrigger = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "leave_field"
    )!;
    expect(leaveTrigger.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: "opponent_effect",
    });
    expect(leaveTrigger.executionMode).toBe("optional");
    expect(leaveTrigger.condition).toEqual([
      { kind: "count_value", player: "self", max: 5 },
    ]);
    expect(leaveTrigger.stub).toBeUndefined();
    // 両トリガーとも rebirth(maxCount5) に、A面【転醒】本文の「このとき」を
    // postRebirthChoice として内蔵する。B面 card_event:"rebirth" へは分離しない。
    for (const trig of [allyTrigger, leaveTrigger]) {
      expect(trig.steps).toHaveLength(1);
      const r = trig.steps[0]!.action;
      expect(r.kind).toBe("rebirth");
      if (r.kind === "rebirth") {
        expect(r.maxCount).toBe(5);
        expect(r.postRebirthChoice).toEqual({
          kind: "brave_combine_or_core",
          coreCount: 1,
        });
      }
    }
    expect(
      (c.backFace!.effects ?? []).some(
        (e) => e.timing.kind === "card_event" && e.timing.event === "rebirth"
      )
    ).toBe(false);
    // [0] 多色 treat_as(白/黄) は engine batch2-1 で実装済 (stub でない)。
    const treat = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    expect(treat.stub).toBeUndefined();
    const t = treat.steps[0]!.action;
    if (t.kind === "treat_as") {
      expect([...(t.asColor as string[])].sort()).toEqual(["white", "yellow"]);
    }
    // [7] コア1個以下の相手スピリットのアタック禁止は動的フィルタ prevent_battle で実装済
    //   （core-count-prevent-battle.test.ts）。
    const preventEff = c.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "prevent_battle")
    )!;
    expect(preventEff.stub).toBeUndefined();
    // 前面 (A) の stub は全解消済み（背面 (B) の合体中効果は別 textRef で stub 残置）。
    expect(c.effects!.filter((e) => e.stub).length).toBe(0);
  });

  it.each([1, 2])(
    "記憶開放術: %d体の同時消滅でも1回だけ誘発",
    (victimCount) => {
      const trigger = back.effects!.find((e) => e.textRef?.includes(7))!;
      expect(trigger.stub).toBeUndefined();
      expect(trigger.timing).toEqual({
        kind: "game_event",
        player: "opponent",
        event: "vanish",
        triggerFilter: { category: ["spirit"] },
        cause: ["opponent_effect"],
        sourceWhose: "either",
      });
      expect(trigger.timingScope).toEqual({
        player: "self",
        period: "attack",
      });
      expect(trigger.condition).toEqual([
        { kind: "combined" },
        {
          kind: "combined_host_card_name",
          cardNames: [{ contains: "キリト" }],
        },
        { kind: "trigger_source_is_combined_host" },
        { kind: "in_battle", state: "attacking" },
        { kind: "count_value", player: "self", min: 3 },
      ]);

      const host = createCardInstance(card("BSSA01-X01"), {
        instanceId: "kirito-host",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      host.attachedChildrenIds = ["night-sword"];
      const nightSword = {
        ...createCardInstance(back, {
          instanceId: "night-sword",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        attachedToInstanceId: "kirito-host",
      };
      const victim = createCardInstance(card("BSSA01-C01"), {
        instanceId: "bob-spirit",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 0,
        pendingLeaveKind: "vanish",
      });
      const stateBeforeBattle = rebuildContinuousEffectsFromField(
        {
          ...createEmptyGameState({
            playerIds: ["alice", "bob"],
            playerOverrides: [{ countValue: 3 }, { reserveNormalCoreCount: 0 }],
          }),
          activePlayerId: "alice",
          step: "attack",
          cardInstances: [
            host,
            nightSword,
            victim,
            ...(victimCount === 2
              ? [{ ...victim, instanceId: "bob-spirit-2" }]
              : []),
          ],
        },
        getBssaX01BackDefinitionById
      );
      const state: GameState = {
        ...stateBeforeBattle,
        battleEntities: [
          {
            entityId: "battle-entity:kirito-host",
            memberInstanceIds: ["kirito-host", "night-sword"],
            resolvedBp: 10000,
            resolvedSymbols: ["purple"],
            attackState: "attacking",
          },
        ],
        activeAttack: {
          attackId: "attack-1",
          primaryEntityId: "battle-entity:kirito-host",
          participantEntityIds: ["battle-entity:kirito-host"],
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: [
            {
              participantEntityId: "battle-entity:kirito-host",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-entity:kirito-host"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
      };
      const lookup = buildTriggeredEffectLookup(expandedCardDefinitions);
      const queuedWithBurstChecks = queuePendingReactionsFromTriggerEvents(
        state,
        Array.from({ length: victimCount }, (_, index) => ({
          actingPlayerId: "alice",
          eventKind: "vanish" as const,
          source: "action_resolution" as const,
          chainId: "chain-night-sword",
          attackId: "attack-1",
          relatedPlayerId: "bob",
          relatedInstanceId: index === 0 ? "bob-spirit" : "bob-spirit-2",
          amount: null,
          cause: "opponent_effect" as const,
          effectSourceInstanceId: "kirito-host",
          effectSourceInstanceIds: ["kirito-host"],
        })),
        undefined,
        {
          getCardDefinitionById: getBssaX01BackDefinitionById,
          getRegisteredTriggeredEffectActions: lookup,
        }
      );
      const queued = declinePendingBurstChecks(
        queuedWithBurstChecks,
        getBssaX01BackDefinitionById,
        lookup
      );

      const nightSwordPendings = queued.pendingTriggeredEffects.filter(
        (pending) =>
          Object.keys(
            pending.relatedInstanceIdsBySourceRegistrationKey ?? {}
          ).some((key) => key.startsWith("night-sword#"))
      );
      expect(nightSwordPendings).toHaveLength(1);
      const nightSwordPending = nightSwordPendings[0]!;
      expect(nightSwordPending.relatedInstanceIds).toHaveLength(victimCount);
      const action = getLegalActions({
        state: queued,
        actingPlayerId: "alice",
        getCardDefinitionById: getBssaX01BackDefinitionById,
        getRegisteredTriggeredEffectActions: lookup,
      }).find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.pendingId === nightSwordPending?.pendingId
      );
      expect(action).toBeDefined();

      const lookupOpts = {
        getCardDefinitionById: getBssaX01BackDefinitionById,
        getRegisteredTriggeredEffectActions: lookup,
        getRegisteredFieldCardEffectActions: () => undefined,
      };
      let resolved = applyLegalAction({
        state: queued,
        action: action!,
        ...lookupOpts,
      }).state;
      let safety = 10;
      while (resolved.stackWindow && safety-- > 0) {
        const pass = getLegalActions({
          state: resolved,
          actingPlayerId: resolved.stackWindow.priorityPlayerId,
          ...lookupOpts,
        }).find((a) => a.kind === "pass_stack");
        expect(pass).toBeDefined();
        resolved = applyLegalAction({
          state: resolved,
          action: pass!,
          ...lookupOpts,
        }).state;
      }
      const bob = resolved.players.find((p) => p.id === "bob")!;
      expect(bob.lifeNormalCoreCount).toBe(3);
      expect(bob.reserveNormalCoreCount).toBe(2);

      const outOfScopeQueued = queuePendingReactionsFromTriggerEvents(
        { ...state, step: "main", battleEntities: [], activeAttack: null },
        [
          {
            actingPlayerId: "alice",
            eventKind: "vanish",
            source: "action_resolution",
            chainId: "chain-night-sword-main",
            attackId: null,
            relatedPlayerId: "bob",
            relatedInstanceId: "bob-spirit",
            amount: null,
            cause: "opponent_effect",
            effectSourceInstanceId: "kirito-host",
            effectSourceInstanceIds: ["kirito-host"],
          },
        ],
        undefined,
        {
          getCardDefinitionById: getBssaX01BackDefinitionById,
          getRegisteredTriggeredEffectActions: lookup,
        }
      );
      expect(
        outOfScopeQueued.pendingTriggeredEffects.some((pending) =>
          Object.keys(
            pending.relatedInstanceIdsBySourceRegistrationKey ?? {}
          ).some((key) => key.startsWith("night-sword#"))
        )
      ).toBe(false);
    }
  );

  it("BSSA01-転醒X01(B) 記憶開放術: 別個体のキリト効果で消滅した場合は誘発しない", () => {
    const host = createCardInstance(card("BSSA01-X01"), {
      instanceId: "kirito-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    host.attachedChildrenIds = ["night-sword"];
    const otherKirito = createCardInstance(card("BSSA01-X01"), {
      instanceId: "other-kirito",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const nightSword = {
      ...createCardInstance(back, {
        instanceId: "night-sword",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedToInstanceId: "kirito-host",
    };
    const victim = createCardInstance(card("BSSA01-C01"), {
      instanceId: "bob-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      pendingLeaveKind: "vanish",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 3 }, {}],
      }),
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [host, otherKirito, nightSword, victim],
      battleEntities: [
        {
          entityId: "battle-entity:kirito-host",
          memberInstanceIds: ["kirito-host", "night-sword"],
          resolvedBp: 10000,
          resolvedSymbols: ["purple"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "attack-1",
        primaryEntityId: "battle-entity:kirito-host",
        participantEntityIds: ["battle-entity:kirito-host"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:kirito-host",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:kirito-host"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
    };
    const lookup = buildTriggeredEffectLookup(expandedCardDefinitions);
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [
        {
          actingPlayerId: "alice",
          eventKind: "vanish",
          source: "action_resolution",
          chainId: "chain-other-kirito",
          attackId: "attack-1",
          relatedPlayerId: "bob",
          relatedInstanceId: "bob-spirit",
          amount: null,
          cause: "opponent_effect",
          effectSourceInstanceId: "other-kirito",
          effectSourceInstanceIds: ["other-kirito"],
        },
      ],
      undefined,
      {
        getCardDefinitionById: getBssaX01BackDefinitionById,
        getRegisteredTriggeredEffectActions: lookup,
      }
    );

    expect(
      queued.pendingTriggeredEffects.some((pending) =>
        Object.keys(
          pending.relatedInstanceIdsBySourceRegistrationKey ?? {}
        ).some((key) => key.startsWith("night-sword#"))
      )
    ).toBe(false);
  });

  it("BSSA01-転醒X01(B) 記憶開放術: ターンに1回のため同一ターン2回目は誘発しない", () => {
    const host = createCardInstance(card("BSSA01-X01"), {
      instanceId: "kirito-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    host.attachedChildrenIds = ["night-sword"];
    const nightSword = {
      ...createCardInstance(back, {
        instanceId: "night-sword",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedToInstanceId: "kirito-host",
    };
    const firstVictim = createCardInstance(card("BSSA01-C01"), {
      instanceId: "bob-spirit-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
      pendingLeaveKind: "vanish",
    });
    const secondVictim = createCardInstance(card("BSSA01-C02"), {
      instanceId: "bob-spirit-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 0,
      pendingLeaveKind: "vanish",
    });
    const baseStateBeforeBattle = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [{ countValue: 3 }, { reserveNormalCoreCount: 0 }],
        }),
        activePlayerId: "alice",
        step: "attack",
        cardInstances: [host, nightSword, firstVictim, secondVictim],
      },
      getBssaX01BackDefinitionById
    );
    const baseState: GameState = {
      ...baseStateBeforeBattle,
      battleEntities: [
        {
          entityId: "battle-entity:kirito-host",
          memberInstanceIds: ["kirito-host", "night-sword"],
          resolvedBp: 10000,
          resolvedSymbols: ["purple"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "attack-1",
        primaryEntityId: "battle-entity:kirito-host",
        participantEntityIds: ["battle-entity:kirito-host"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:kirito-host",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:kirito-host"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
    };
    const lookup = buildTriggeredEffectLookup(expandedCardDefinitions);
    const lookupOpts = {
      getCardDefinitionById: getBssaX01BackDefinitionById,
      getRegisteredTriggeredEffectActions: lookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };
    const queueVanish = (state: GameState, relatedInstanceId: string) =>
      declinePendingBurstChecks(
        queuePendingReactionsFromTriggerEvents(
          state,
          [
            {
              actingPlayerId: "alice",
              eventKind: "vanish",
              source: "action_resolution",
              chainId: `chain-${relatedInstanceId}`,
              attackId: "attack-1",
              relatedPlayerId: "bob",
              relatedInstanceId,
              amount: null,
              cause: "opponent_effect",
              effectSourceInstanceId: "kirito-host",
              effectSourceInstanceIds: ["kirito-host"],
            },
          ],
          undefined,
          {
            getCardDefinitionById: getBssaX01BackDefinitionById,
            getRegisteredTriggeredEffectActions: lookup,
          }
        ),
        getBssaX01BackDefinitionById,
        lookup
      );
    const findNightSwordAction = (state: GameState) => {
      const pending = state.pendingTriggeredEffects.find((candidate) =>
        Object.keys(
          candidate.relatedInstanceIdsBySourceRegistrationKey ?? {}
        ).some((key) => key.startsWith("night-sword#"))
      );
      if (!pending) return undefined;
      return getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: getBssaX01BackDefinitionById,
        getRegisteredTriggeredEffectActions: lookup,
      }).find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.pendingId === pending.pendingId &&
          a.skipOnly !== true
      );
    };

    let current = queueVanish(baseState, "bob-spirit-1");
    const firstAction = findNightSwordAction(current);
    expect(firstAction).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: firstAction!,
      ...lookupOpts,
    }).state;
    let safety = 10;
    while (current.stackWindow && safety-- > 0) {
      const pass = getLegalActions({
        state: current,
        actingPlayerId: current.stackWindow.priorityPlayerId,
        ...lookupOpts,
      }).find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      current = applyLegalAction({
        state: current,
        action: pass!,
        ...lookupOpts,
      }).state;
    }
    const afterFirst = current.players.find((p) => p.id === "bob")!;
    expect(afterFirst.lifeNormalCoreCount).toBe(3);
    expect(afterFirst.reserveNormalCoreCount).toBe(2);

    current = queueVanish(current, "bob-spirit-2");
    expect(findNightSwordAction(current)).toBeUndefined();
    const afterSecond = current.players.find((p) => p.id === "bob")!;
    expect(afterSecond.lifeNormalCoreCount).toBe(3);
    expect(afterSecond.reserveNormalCoreCount).toBe(2);
  });

  it("配置時実行: alice が1枚ドローする（盤面変化）", () => {
    const self = createCardInstance(c, {
      instanceId: "giga-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const deck = [0, 1, 2, 3].map((i) =>
      createCardInstance(card("BSSA01-C01"), {
        instanceId: `deck-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 2 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, ...deck],
    };
    const place = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "place"
    )!;
    const result = executeEffect({
      chainId: "test:bssa01-bssg02-cards:923",
      state,
      effect: place,
      sourceInstanceId: "giga-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const handCount = result.cardInstances.filter(
      (x) => x.zone === "hand" && x.controllerPlayerId === "alice"
    ).length;
    expect(handCount).toBe(1);
  });

  it("夜錆スピリット召喚/煌臨トリガー実行: コア1個配置ルート確定で flip 成立 → 転醒後ブレイヴ自身にコアが乗る（盤面変化）", () => {
    const self = createCardInstance(c, {
      instanceId: "giga-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self],
    };
    const allyTrigger = c.effects!.find((e) => e.timing.kind === "game_event")!;

    // 1) 自トリガー: 「このとき」選択が確定するまで A 面のまま pending を開く。
    const pendingChoiceState = executeEffect({
      chainId: "test:bssa01-bssg02-cards:956",
      state,
      effect: allyTrigger,
      sourceInstanceId: "giga-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const virtualOnly = pendingChoiceState.cardInstances.find(
      (x) => x.instanceId === "giga-1"
    )!;
    expect(virtualOnly.definitionId).toBe("BSSA01-転醒X01(A)");
    expect(pendingChoiceState.pendingStoneFlipCombine).toMatchObject({
      braveInstanceId: "giga-1",
      braveDefinitionId: "BSSA01-転醒X01(B)",
    });

    // 2) コア配置分岐を選ぶと、まだ裏返さず core_distribution pending へ進む。
    const coreRouteAction = getLegalActions({
      state: pendingChoiceState,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).find(
      (a) =>
        a.kind === "resolve_brave_combine_choice" &&
        a.chosenHostInstanceId === null
    );
    expect(coreRouteAction).toBeDefined();
    const afterBody = applyLegalAction({
      state: pendingChoiceState,
      action: coreRouteAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    // choice(コア1個配置)の pendingCoreDistribution が対象=転醒後ブレイヴ自身(giga-1)で開く。
    const virtual = afterBody.cardInstances.find(
      (x) => x.instanceId === "giga-1"
    )!;
    expect(virtual.definitionId).toBe("BSSA01-転醒X01(A)");
    const corePending = afterBody.pendingCoreDistribution!;
    expect(corePending).not.toBeNull();
    expect(corePending.candidates.map((x) => x.instanceId)).toEqual(["giga-1"]);

    const resolveAction = getLegalActions({
      state: afterBody,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    const resolved = applyLegalAction({
      state: afterBody,
      action: resolveAction,
      getCardDefinitionById,
      coreDistributionAllocations: { "giga-1": 1 },
      coreDistributionSourceAllocations: { reserve: 1 },
      getRegisteredTriggeredEffectActions: () => [],
    });

    // 最終盤面: 裏面(夜空の剣)へflip済み・コア1個がリザーブから転醒後ブレイヴへ移動。
    expect(resolved.state.pendingCoreDistribution).toBeNull();
    const finalCard = resolved.state.cardInstances.find(
      (x) => x.instanceId === "giga-1"
    )!;
    expect(finalCard.definitionId).toBe("BSSA01-転醒X01(B)");
    expect(finalCard.normalCoreCount).toBe(2);
    expect(
      resolved.state.players.find((p) => p.id === "alice")!
        .reserveNormalCoreCount
    ).toBe(1);
  });

  it("夜錆スピリット召喚/煌臨トリガー実行: 合体ルート確定で flip 成立 → 自分のスピリットに合体する（盤面変化）", () => {
    const self = createCardInstance(c, {
      instanceId: "giga-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const host = createCardInstance(card("BSSA01-X01"), {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 1 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, host],
    };
    const allyTrigger = c.effects!.find((e) => e.timing.kind === "game_event")!;

    const pendingChoiceState = executeEffect({
      chainId: "test:bssa01-bssg02-cards:1055",
      state,
      effect: allyTrigger,
      sourceInstanceId: "giga-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const combineAction = getLegalActions({
      state: pendingChoiceState,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).find(
      (a) =>
        a.kind === "resolve_brave_combine_choice" &&
        a.chosenHostInstanceId === "host-1"
    );
    expect(combineAction).toBeDefined();
    const afterBody = applyLegalAction({
      state: pendingChoiceState,
      action: combineAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    // 合体成立: flip後の転醒後ブレイヴが host-1 へ attach する（choice[0] のコア配置分岐は不発）。
    const combinedBrave = afterBody.cardInstances.find(
      (x) => x.instanceId === "giga-1"
    )!;
    expect(combinedBrave.definitionId).toBe("BSSA01-転醒X01(B)");
    expect(combinedBrave.attachedToInstanceId).toBe("host-1");
    const combinedHost = afterBody.cardInstances.find(
      (x) => x.instanceId === "host-1"
    )!;
    expect(combinedHost.attachedChildrenIds).toContain("giga-1");
    expect(afterBody.pendingCoreDistribution).toBeNull();
  });

  it("0コアのネクサスが仮想転醒 pending 中に消滅せず、転醒後カウント2で合体条件C2を満たせる", () => {
    const self = createCardInstance(c, {
      instanceId: "giga-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const host = createCardInstance(card("BSSA01-X01"), {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const summonedAlly = createCardInstance(card("BSSA01-C03"), {
      instanceId: "ally-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 1, reserveNormalCoreCount: 1 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, host, summonedAlly],
    };
    const triggeredLookup = buildTriggeredEffectLookup(expandedCardDefinitions);
    const lookupOpts = {
      getCardDefinitionById: getBssaX01BackDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };
    const passAllStackWindows = (input: GameState): GameState => {
      let current = input;
      let safety = 10;
      while (current.stackWindow && safety-- > 0) {
        const pass = getLegalActions({
          state: current,
          actingPlayerId: current.stackWindow.priorityPlayerId,
          ...lookupOpts,
        }).find((a) => a.kind === "pass_stack");
        expect(pass).toBeDefined();
        current = applyLegalAction({
          state: current,
          action: pass!,
          ...lookupOpts,
        }).state;
      }
      expect(safety).toBeGreaterThan(0);
      return current;
    };

    const queued = declinePendingBurstChecks(
      queuePendingReactionsFromTriggerEvents(
        state,
        [
          {
            actingPlayerId: "alice",
            eventKind: "summon",
            source: "action_resolution",
            chainId: "chain:ally-summon",
            attackId: null,
            relatedPlayerId: "alice",
            relatedInstanceId: "ally-1",
            amount: null,
          },
        ],
        undefined,
        {
          getCardDefinitionById: getBssaX01BackDefinitionById,
          getRegisteredTriggeredEffectActions: triggeredLookup,
        }
      ),
      getBssaX01BackDefinitionById,
      triggeredLookup
    );
    const rebirthAction = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "giga-1"
    );
    expect(rebirthAction).toBeDefined();

    const afterRebirth = passAllStackWindows(
      applyLegalAction({
        state: queued,
        action: rebirthAction!,
        ...lookupOpts,
      }).state
    );

    const virtual = afterRebirth.cardInstances.find(
      (card) => card.instanceId === "giga-1"
    )!;
    expect(virtual.zone).toBe("field");
    expect(virtual.definitionId).toBe("BSSA01-転醒X01(A)");
    expect(virtual.normalCoreCount).toBe(0);
    expect(
      afterRebirth.players.find((player) => player.id === "alice")!.countValue
    ).toBe(1);
    expect(
      afterRebirth.pendingLeaveEntities.some(
        (pending) => pending.instanceId === "giga-1"
      )
    ).toBe(false);

    const combineChoiceAction = getLegalActions({
      state: afterRebirth,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find(
      (a) =>
        a.kind === "resolve_brave_combine_choice" &&
        a.chosenHostInstanceId === "host-1"
    );
    expect(combineChoiceAction).toBeDefined();
    const afterPostChoice = applyLegalAction({
      state: afterRebirth,
      action: combineChoiceAction!,
      ...lookupOpts,
    }).state;
    const combinedBrave = afterPostChoice.cardInstances.find(
      (card) => card.instanceId === "giga-1"
    )!;
    expect(combinedBrave.definitionId).toBe("BSSA01-転醒X01(B)");
    expect(combinedBrave.zone).toBe("field");
    expect(combinedBrave.attachedToInstanceId).toBe("host-1");
    expect(
      afterPostChoice.players.find((player) => player.id === "alice")!
        .countValue
    ).toBe(2);
  });
});

describe("BSSA01-転醒X02(A) 青薔薇の剣 (brave)", () => {
  const c = card("BSSA01-転醒X02(A)");
  it("treat_as / [4,5] prevent_block+blanket suppress (engine batch2-1) / rebirth(maxCount5) を保持", () => {
    const rebirth = c.effects!.find((e) =>
      e.steps.some((s) => s.action.kind === "rebirth")
    )!;
    const r = rebirth.steps[0]!.action;
    if (r.kind === "rebirth") expect(r.maxCount).toBe(5);
    expect(rebirth.condition).toContainEqual({ kind: "combined" });
    // [0] 多色 treat_as(黄/紫 軽減) は engine batch2-1 で実装済。
    const treat = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    expect(treat.stub).toBeUndefined();
    // [4,5] 武装完全支配術: prevent_battle(block) + blanket suppress_effect(ref) で実装済（stub 解消）。
    const lock = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "prevent_battle"
    )!;
    expect(lock.stub).toBeUndefined();
    expect(lock.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: "attack",
      triggerFilter: {
        category: ["spirit"],
        combined: true,
        tribes: ["夜錆"],
      },
    });
    expect(lock.condition).toEqual([{ kind: "combined" }]);
    const pa = lock.steps[0]!.action;
    if (pa.kind === "prevent_battle") {
      expect(pa.restriction).toEqual(["block"]);
      if ("filter" in pa.target) expect(pa.target.filter.maxCost).toBe(7);
    }
    const sup = lock.steps[1]!.action;
    expect(sup.kind).toBe("suppress_effect");
    if (sup.kind === "suppress_effect") {
      expect(sup.target).toEqual({ kind: "ref", stepId: "lock" });
      expect(sup.effectFilter).toBeUndefined(); // blanket
    }
    // 転醒トリガー（host「ユージオ」離脱時の煌臨元追加+分離+裏返し）は stub 解消済み
    // (engine-claude claude-explore, transmute-fold-advent-source.test.ts で回帰検証)。
    expect(rebirth.stub).toBeUndefined();
    // [7,8] 記憶開放術: 自分のカウント3以上のとき【武装完全支配術】の maxCost 閾値(7→9)を
    // 書き換えるメタ修飾。effect_param_modify(cost_prevent_battle) で実装済（stub 解消）。
    const memoryRelease = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "effect_param_modify"
    )!;
    expect(memoryRelease.stub).toBeUndefined();
    expect(memoryRelease.condition).toContainEqual({
      kind: "count_value",
      player: "self",
      min: 3,
    });
    const mod = memoryRelease.steps[0]!.action;
    if (mod.kind === "effect_param_modify") {
      expect(mod.effectClass).toBe("cost_prevent_battle");
      expect(mod.scope).toBe("self");
      expect(mod.addLimitAmount).toBe(2);
    }
    // 前面 (A) の未実装 effects は 0 件（背面 (B) の転醒時合体連動/代償自壊 stub は別残課題）。
    expect(c.effects!.filter((e) => e.stub).length).toBe(0);
  });

  it("武装完全支配術 queue は第三者の夜錆合体スピリットがアタックしたときだけ出る", () => {
    const makeHostDef = (tribe: string): CardDefinition => ({
      cardNo: `TEST-HOST-${tribe}`,
      name: `TestHost-${tribe}`,
      printedCategory: "spirit",
      colors: ["white"],
      cost: 7,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      symbolColors: ["white"],
      textLines: [],
      tribe,
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    });

    const attackerBraveDef: CardDefinition = {
      cardNo: "TEST-ATTACKER-BRAVE",
      name: "TestAttackerBrave",
      printedCategory: "brave",
      colors: ["white"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["white"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const sourceHostDef = makeHostDef("剣刃");

    const queuedPromptCount = (attackerDef: CardDefinition): number => {
      const sourceHost = {
        ...createCardInstance(sourceHostDef, {
          instanceId: "source-host",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        attachedChildrenIds: ["blue-rose-1"],
      };
      const brave = {
        ...createCardInstance(c, {
          instanceId: "blue-rose-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        attachedToInstanceId: "source-host",
      };
      const attacker = {
        ...createCardInstance(attackerDef, {
          instanceId: "attacker-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        attachedChildrenIds: ["attacker-brave-1"],
      };
      const attackerBrave = {
        ...createCardInstance(attackerBraveDef, {
          instanceId: "attacker-brave-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        attachedToInstanceId: "attacker-1",
      };
      const lookupCard = (id: string): CardDefinition | undefined =>
        id === sourceHostDef.cardNo
          ? sourceHostDef
          : id === attackerDef.cardNo
            ? attackerDef
            : id === attackerBraveDef.cardNo
              ? attackerBraveDef
              : cardNoMap.get(id);
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [sourceHost, brave, attacker, attackerBrave],
        }),
        activePlayerId: "alice",
        step: "attack",
        turnNumber: 2,
      };
      const triggeredLookup = buildTriggeredEffectLookup([
        sourceHostDef,
        attackerDef,
        attackerBraveDef,
        c,
      ]);
      const queued = queuePendingReactionsFromTriggerEvents(
        state,
        [
          {
            actingPlayerId: "alice",
            eventKind: "attack",
            source: "action_resolution",
            chainId: "test:bssa01-bssg02-cards:1400",
            attackId: "attack-1",
            relatedPlayerId: "alice",
            relatedInstanceId: "attacker-1",
            amount: null,
            step: "attack",
          },
        ],
        undefined,
        {
          getCardDefinitionById: lookupCard,
          getRegisteredTriggeredEffectActions: triggeredLookup,
          getRegisteredBurstActions: undefined,
        }
      );
      return getLegalActions({
        state: queued,
        actingPlayerId: "alice",
        getCardDefinitionById: lookupCard,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).filter(
        (action) =>
          action.kind === "resolve_pending_triggered_effect" &&
          action.sourceInstanceId === "source-host" &&
          action.sourceEffectInstanceId === "blue-rose-1" &&
          action.sourceCardNo === "BSSA01-転醒X02(A)"
      ).length;
    };

    expect(queuedPromptCount(makeHostDef("夜錆"))).toBe(1);
    expect(queuedPromptCount(makeHostDef("剣刃"))).toBe(0);
  });

  it("記憶開放術 実行: カウント3以上で本来コスト8の相手スピリットも【武装完全支配術】の対象になる（盤面変化）", async () => {
    const { rebuildContinuousEffectsFromField } = await import("../src");

    const hostDef: CardDefinition = {
      cardNo: "TEST-HOST-YASABI",
      name: "TestHost",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      symbolColors: ["white"],
      textLines: [],
      tribe: "夜錆",
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    // 本来のコスト8: 記憶開放術なし(maxCost7)では対象外、あり(maxCost9)では対象内。
    const victimDef: CardDefinition = {
      cardNo: "TEST-VICTIM-COST8",
      name: "TestVictim",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 8,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 9000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const lookupCard = (id: string): CardDefinition | undefined =>
      id === hostDef.cardNo
        ? hostDef
        : id === victimDef.cardNo
          ? victimDef
          : cardNoMap.get(id);

    function buildState(countValue: number): GameState {
      const base = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue }, {}],
      });
      return {
        ...base,
        activePlayerId: "alice",
        step: "attack",
        cardInstances: [
          {
            ...createCardInstance(hostDef, {
              instanceId: "host-1",
              ownerPlayerId: "alice",
              zone: "field",
              cores: 1,
            }),
            attachedChildrenIds: ["brave-1"],
          },
          {
            ...createCardInstance(c, {
              instanceId: "brave-1",
              ownerPlayerId: "alice",
              zone: "field",
              cores: 1,
            }),
            attachedToInstanceId: "host-1",
          },
          createCardInstance(victimDef, {
            instanceId: "victim-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      };
    }

    const lockEffect = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "prevent_battle"
    )!;
    const lockEffectIndex = c.effects!.indexOf(lockEffect);
    const isVictimLocked = (state: GameState): boolean =>
      state.activeContinuousEffects.some(
        (ce) =>
          ce.targetInstanceId === "victim-1" &&
          ce.modifierTag === "prevent_battle_block"
      );

    // countValue 2: 記憶開放術は不成立 → maxCost 7 のまま → コスト8 は対象外。
    let state = buildState(2);
    state = rebuildContinuousEffectsFromField(state, lookupCard);
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "effect_param_override"
      )
    ).toBe(false);
    let next = executeEffect({
      chainId: "test:bssa01-bssg02-cards:1534",
      state,
      effect: lockEffect,
      sourceInstanceId: "brave-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookupCard,
      getRegisteredTriggeredEffectActions: () => [],
      effectIndex: lockEffectIndex,
    });
    expect(isVictimLocked(next)).toBe(false);

    // countValue 3: 記憶開放術が成立 → maxCost 9 に拡張 → コスト8 が対象内になりロックされる。
    state = buildState(3);
    state = rebuildContinuousEffectsFromField(state, lookupCard);
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "effect_param_override"
      )
    ).toBe(true);
    next = executeEffect({
      chainId: "test:bssa01-bssg02-cards:1553",
      state,
      effect: lockEffect,
      sourceInstanceId: "brave-1",
      actingPlayerId: "alice",
      getCardDefinitionById: lookupCard,
      getRegisteredTriggeredEffectActions: () => [],
      effectIndex: lockEffectIndex,
    });
    expect(isVictimLocked(next)).toBe(true);
  });

  it("記憶開放術 候補列挙: getLegalActions の resolve_pending_triggered_effect でも本来コスト8の相手スピリットがカウント3以上時のみ候補に出る（GUI経路）", async () => {
    const { rebuildContinuousEffectsFromField } = await import("../src");

    const hostDef: CardDefinition = {
      cardNo: "TEST-HOST-YASABI-2",
      name: "TestHost2",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      symbolColors: ["white"],
      textLines: [],
      tribe: "夜錆",
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const victimDef: CardDefinition = {
      cardNo: "TEST-VICTIM-COST8-2",
      name: "TestVictim2",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 8,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 9000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const lookupCard = (id: string): CardDefinition | undefined =>
      id === hostDef.cardNo
        ? hostDef
        : id === victimDef.cardNo
          ? victimDef
          : cardNoMap.get(id);
    const triggeredLookup = buildTriggeredEffectLookup([c, hostDef, victimDef]);

    function buildState(countValue: number): GameState {
      const base = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue }, {}],
      });
      // 継続効果 (effect_param_override) の rebuild は非戦闘時 (activeAttack:null) 限定の
      // ガードがあるため、先に非戦闘状態で rebuild してから battle 関連フィールドを付与する。
      let state: GameState = {
        ...base,
        activePlayerId: "alice",
        cardInstances: [
          {
            ...createCardInstance(hostDef, {
              instanceId: "host-2",
              ownerPlayerId: "alice",
              zone: "field",
              cores: 1,
            }),
            attachedChildrenIds: ["brave-2"],
          },
          {
            ...createCardInstance(c, {
              instanceId: "brave-2",
              ownerPlayerId: "alice",
              zone: "field",
              cores: 1,
            }),
            attachedToInstanceId: "host-2",
          },
          createCardInstance(victimDef, {
            instanceId: "victim-2",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      };
      state = rebuildContinuousEffectsFromField(state, lookupCard);
      return {
        ...state,
        step: "attack",
        window: "flash_before_block",
        turnNumber: 2,
        battleEntities: [
          {
            entityId: "battle-entity:host-2",
            memberInstanceIds: ["host-2", "brave-2"],
            resolvedBp: 5000,
            resolvedSymbols: ["white"],
            attackState: "attacking",
          },
        ],
        activeAttack: {
          attackId: "attack-group:1:alice:battle-entity:host-2",
          primaryEntityId: "battle-entity:host-2",
          participantEntityIds: ["battle-entity:host-2"],
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: [
            {
              participantEntityId: "battle-entity:host-2",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-entity:host-2"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: {
            kind: "before_block",
            priorityPlayerId: "alice",
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: "alice",
            pendingStackAction: null,
          },
        },
      };
    }

    const getCandidates = (state: GameState): string[] => {
      const queued = queuePendingReactionsFromTriggerEvents(
        state,
        [
          {
            actingPlayerId: "alice",
            eventKind: "attack",
            source: "action_resolution",
            chainId: "test:bssa01-bssg02-cards:1687",
            attackId: "attack-group:1:alice:battle-entity:host-2",
            relatedPlayerId: "alice",
            relatedInstanceId: "host-2",
            amount: null,
            step: "attack",
          },
        ],
        undefined,
        {
          getCardDefinitionById: lookupCard,
          getRegisteredTriggeredEffectActions: triggeredLookup,
          getRegisteredBurstActions: undefined,
        }
      );
      const actions = getLegalActions({
        state: queued,
        actingPlayerId: "alice",
        getCardDefinitionById: lookupCard,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      });
      const triggered = actions.find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "host-2" &&
          a.sourceEffectInstanceId === "brave-2"
      ) as { candidateTargetInstanceIds?: string[] } | undefined;
      expect(
        triggered,
        "resolve_pending_triggered_effect legal action が出ない"
      ).toBeDefined();
      return triggered?.candidateTargetInstanceIds ?? [];
    };

    // countValue 2: 記憶開放術不成立 → maxCost 7 のまま → コスト8 は候補に出ない。
    expect(getCandidates(buildState(2))).not.toContain("victim-2");
    // countValue 3: 記憶開放術成立 → maxCost 9 に拡張 → コスト8 が候補に出る。
    expect(getCandidates(buildState(3))).toContain("victim-2");
  });
});

describe("BSSA01-転醒X03(A) 修剣士ユージオ", () => {
  const c = card("BSSA01-転醒X03(A)");
  it("召喚時 void→field コア3 + 青薔薇の剣 free召喚 / rebirth / フラッシュ recover", () => {
    const summon = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "summon"
    )!;
    expect(summon.steps[0]!.action.kind).toBe("core_move");
    const s = summon.steps[1]!.action;
    expect(s.kind).toBe("summon");
    if (s.kind === "summon" && s.target.kind === "from_zone") {
      expect(s.target.filter).toEqual({
        category: ["spirit", "ultimate", "brave"],
        cardName: { contains: "青薔薇の剣" },
      });
      expect(s.costModifier).toBe("free");
    }
    const flash = c.effects!.find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "flash"
    )!;
    expect(flash.steps[0]!.action.kind).toBe("recover");
    expect(flash.condition).toContainEqual({ kind: "min_level", value: 2 });
  });

  it("召喚時実行: ボイドからコア3個が自分フィールドへ（盤面変化）", () => {
    const self = createCardInstance(c, {
      instanceId: "eugeo-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ voidNormalCoreCount: 5 }],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self],
    };
    const summon = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "summon"
    )!;
    // コア移動ステップのみ実行（free召喚は手札に対象が無いため除外）。
    const result = executeEffect({
      chainId: "test:bssa01-bssg02-cards:1777",
      state,
      effect: { ...summon, steps: [summon.steps[0]!] },
      sourceInstanceId: "eugeo-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    // 「自分のスピリットに置く」= void→field_card(spirit filter)。候補が自身1体のみなので
    // 自動配置され、ボイド3個が eugeo-1 に乗る（盤面変化を直接検証）。
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.voidNormalCoreCount).toBe(2);
    const updated = result.cardInstances.find(
      (x) => x.instanceId === "eugeo-1"
    )!;
    expect(updated.normalCoreCount).toBe(4);
  });
});

describe("BSSA01-転醒X04(A) 最古の金木犀", () => {
  const c = card("BSSA01-転醒X04(A)");
  const back = c.backFace!;
  const getBssaX04BackDefinitionById = (
    id: string
  ): CardDefinition | undefined =>
    id === back.cardNo ? back : getCardDefinitionById(id);

  it("配置時 BP-6000→BP0破壊 / 6色treat_as 実装 / 転醒トリガー2系統(「アリス」ally召喚煌臨+leave_field)+合体/コア1個スピリット状態化 post-choice を実装", () => {
    const place = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "place"
    )!;
    const bp = place.steps[0]!.action;
    expect(bp.kind).toBe("bp_modify");
    if (bp.kind === "bp_modify") expect(bp.amount).toBe(-6000);
    expect(place.steps[1]!.action.kind).toBe("destroy");
    // [2] 転醒トリガー1: 自分の「アリス」召喚/煌臨 (game_event, カード名部分一致)。
    const allyTrigger = c.effects!.find((e) => e.timing.kind === "game_event")!;
    expect(allyTrigger.timing).toEqual({
      kind: "game_event",
      player: "self",
      event: ["summon", "advent"],
      triggerFilter: { cardName: { contains: "アリス" } },
    });
    expect(allyTrigger.executionMode).toBe("optional");
    expect(allyTrigger.condition).toEqual([
      { kind: "count_value", player: "self", max: 5 },
    ]);
    expect(allyTrigger.stub).toBeUndefined();
    // [2] 転醒トリガー2: このネクサスが相手によってフィールドを離れるとき (card_event:leave_field)。
    const leaveTrigger = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "leave_field"
    )!;
    expect(leaveTrigger.timing).toEqual({
      kind: "card_event",
      event: "leave_field",
      cause: "opponent_effect",
    });
    expect(leaveTrigger.executionMode).toBe("optional");
    expect(leaveTrigger.stub).toBeUndefined();
    // 両トリガーとも rebirth(maxCount5) に、A面【転醒】本文の「このとき」を
    // postRebirthChoice として内蔵する。BSSA01-転醒X01(A) と同型。
    for (const trig of [allyTrigger, leaveTrigger]) {
      expect(trig.steps).toHaveLength(1);
      const r = trig.steps[0]!.action;
      expect(r.kind).toBe("rebirth");
      if (r.kind === "rebirth") {
        expect(r.maxCount).toBe(5);
        expect(r.postRebirthChoice).toEqual({
          kind: "brave_combine_or_core",
          coreCount: 1,
        });
      }
    }
    expect(
      (c.backFace!.effects ?? []).some(
        (e) => e.timing.kind === "card_event" && e.timing.event === "rebirth"
      )
    ).toBe(false);
    // [0] 6色 treat_as は engine batch2-1 で実装済 (stub でない)。
    const treat = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    expect(treat.stub).toBeUndefined();
    const t = treat.steps[0]!.action;
    if (t.kind === "treat_as") {
      expect((t.asColor as string[]).length).toBe(6);
    }
    expect(c.effects!.filter((e) => e.stub).length).toBe(0);
  });

  it("0コアのネクサスが仮想転醒 pending 中に消滅せず、転醒後カウント2で合体条件C2/コスト7を満たせる", () => {
    const self = createCardInstance(c, {
      instanceId: "kinmokusei-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const aliceHost = createCardInstance(card("BSSA01-X02"), {
      instanceId: "alice-host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 1, reserveNormalCoreCount: 1 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, aliceHost],
    };
    const triggeredLookup = buildTriggeredEffectLookup(expandedCardDefinitions);
    const lookupOpts = {
      getCardDefinitionById: getBssaX04BackDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
    };
    const passAllStackWindows = (input: GameState): GameState => {
      let current = input;
      let safety = 10;
      while (current.stackWindow && safety-- > 0) {
        const pass = getLegalActions({
          state: current,
          actingPlayerId: current.stackWindow.priorityPlayerId,
          ...lookupOpts,
        }).find((a) => a.kind === "pass_stack");
        expect(pass).toBeDefined();
        current = applyLegalAction({
          state: current,
          action: pass!,
          ...lookupOpts,
        }).state;
      }
      expect(safety).toBeGreaterThan(0);
      return current;
    };

    const queued = declinePendingBurstChecks(
      queuePendingReactionsFromTriggerEvents(
        state,
        [
          {
            actingPlayerId: "alice",
            eventKind: "summon",
            source: "action_resolution",
            chainId: "chain:alice-summon",
            attackId: null,
            relatedPlayerId: "alice",
            relatedInstanceId: "alice-host",
            amount: null,
          },
        ],
        undefined,
        {
          getCardDefinitionById: getBssaX04BackDefinitionById,
          getRegisteredTriggeredEffectActions: triggeredLookup,
        }
      ),
      getBssaX04BackDefinitionById,
      triggeredLookup
    );
    const rebirthAction = getLegalActions({
      state: queued,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "kinmokusei-1"
    );
    expect(rebirthAction).toBeDefined();

    const afterRebirth = passAllStackWindows(
      applyLegalAction({
        state: queued,
        action: rebirthAction!,
        ...lookupOpts,
      }).state
    );
    const virtual = afterRebirth.cardInstances.find(
      (card) => card.instanceId === "kinmokusei-1"
    )!;
    expect(virtual.zone).toBe("field");
    expect(virtual.definitionId).toBe("BSSA01-転醒X04(A)");
    expect(
      afterRebirth.players.find((player) => player.id === "alice")!.countValue
    ).toBe(1);
    expect(
      afterRebirth.pendingLeaveEntities.some(
        (pending) => pending.instanceId === "kinmokusei-1"
      )
    ).toBe(false);

    const combineChoiceAction = getLegalActions({
      state: afterRebirth,
      actingPlayerId: "alice",
      ...lookupOpts,
    }).find(
      (a) =>
        a.kind === "resolve_brave_combine_choice" &&
        a.chosenHostInstanceId === "alice-host"
    );
    expect(combineChoiceAction).toBeDefined();
    const afterPostChoice = applyLegalAction({
      state: afterRebirth,
      action: combineChoiceAction!,
      ...lookupOpts,
    }).state;
    const combinedBrave = afterPostChoice.cardInstances.find(
      (card) => card.instanceId === "kinmokusei-1"
    )!;
    expect(combinedBrave.definitionId).toBe("BSSA01-転醒X04(B)");
    expect(combinedBrave.zone).toBe("field");
    expect(combinedBrave.attachedToInstanceId).toBe("alice-host");
    expect(
      afterPostChoice.players.find((player) => player.id === "alice")!
        .countValue
    ).toBe(2);
    expect(
      afterPostChoice.cardInstances.find(
        (card) => card.instanceId === "alice-host"
      )?.attachedChildrenIds
    ).toContain("kinmokusei-1");
  });

  it("BSSA01-転醒X04(B) 武装完全支配術: 回復状態の合体先アリスを重疲労させるコストで相手2体をアタック禁止にする", () => {
    const back = c.backFace!;
    expect(back.cardNo).toBe("BSSA01-転醒X04(B)");
    const lookupWithBackFace = (id: string): CardDefinition | undefined =>
      id === back.cardNo ? back : getCardDefinitionById(id);
    const fieldLookups = {
      getCardDefinitionById: lookupWithBackFace,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([back]),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([back]),
    };
    const effect = back.effects!.find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "stack"
    )!;
    expect(effect.stub).toBeUndefined();
    expect(effect.condition).toEqual([
      { kind: "combined" },
      {
        kind: "self_name",
        reference: "self",
        names: [{ contains: "アリス" }],
      },
      { kind: "self_state", reference: "self", state: "recovered" },
    ]);
    expect(effect.steps[0]!.action).toEqual({
      kind: "set_exhaust_state",
      target: { kind: "self" },
      state: "heavily_exhausted",
    });
    expect(effect.steps[1]!.connector).toBe("conditional_cost");
    const lock = effect.steps[1]!.action;
    expect(lock.kind).toBe("prevent_battle");
    if (lock.kind === "prevent_battle") {
      expect(lock.restriction).toEqual(["attack"]);
      expect(lock.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: { min: 0, max: 2 },
      });
    }

    const host = {
      ...createCardInstance(card("BSSA01-X02"), {
        instanceId: "alice-host",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "recovered",
      }),
      attachedChildrenIds: ["golden-sword"],
    };
    const brave = {
      ...createCardInstance(back, {
        instanceId: "golden-sword",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "recovered",
      }),
      attachedToInstanceId: "alice-host",
    };
    const enemy1 = createCardInstance(card("BSSA01-C02"), {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy2 = createCardInstance(card("BSSA01-C03"), {
      instanceId: "enemy-2",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 2 }, {}],
      }),
      activePlayerId: "bob",
      step: "attack",
      window: "flash_before_block",
      activeAttack: {
        attackId: "attack-bob-1",
        primaryEntityId: "battle-entity:enemy-1",
        participantEntityIds: ["battle-entity:enemy-1"],
        groupMode: "single",
        target: { kind: "player", playerId: "alice" },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "bob",
          pendingStackAction: null,
        },
      },
      cardInstances: [host, brave, enemy1, enemy2],
    };

    const useAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...fieldLookups,
    }).find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceCardNo === "BSSA01-転醒X04(B)" &&
        a.sourceInstanceId === "alice-host" &&
        a.sourceEffectInstanceId === "golden-sword"
    );
    expect(useAction).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: useAction!,
      ...fieldLookups,
    }).state;
    const pass = getLegalActions({
      state: declared,
      actingPlayerId: "bob",
      ...fieldLookups,
    }).find((a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash");
    expect(pass).toBeDefined();
    const afterPass = applyLegalAction({
      state: declared,
      action: pass!,
      ...fieldLookups,
    }).state;
    expect(afterPass.pendingEffectTargetSelection).not.toBeNull();
    expect(
      afterPass.pendingEffectTargetSelection!.candidateInstanceIds.sort()
    ).toEqual(["enemy-1", "enemy-2"]);

    const resolveTarget = getLegalActions({
      state: afterPass,
      actingPlayerId: "alice",
      ...fieldLookups,
    }).find((a) => a.kind === "resolve_pending_effect_target");
    expect(resolveTarget).toBeDefined();
    const result = applyLegalAction({
      state: afterPass,
      action: resolveTarget!,
      targetInstanceIds: ["enemy-1", "enemy-2"],
      ...fieldLookups,
    }).state;

    expect(result.pendingEffectTargetSelection).toBeNull();

    expect(
      result.cardInstances.find((x) => x.instanceId === "alice-host")
        ?.exhaustState
    ).toBe("heavily_exhausted");
    // 合体スピリットの疲労状態はホストが正源で、ブレイヴも同じ重疲労になる。
    expect(
      result.cardInstances.find((x) => x.instanceId === "golden-sword")
        ?.exhaustState
    ).toBe("heavily_exhausted");
    expect(
      result.activeContinuousEffects
        .filter((ce) => ce.modifierTag === "prevent_battle_attack")
        .map((ce) => ce.targetInstanceId)
        .sort()
    ).toEqual(["enemy-1", "enemy-2"]);
  });

  it("BSSA01-転醒X04(B) 武装完全支配術: 合体先アリスが疲労状態ならブレイヴ自身が回復状態でも発揮できない", () => {
    const back = c.backFace!;
    expect(back.cardNo).toBe("BSSA01-転醒X04(B)");
    const lookupWithBackFace = (id: string): CardDefinition | undefined =>
      id === back.cardNo ? back : getCardDefinitionById(id);
    const fieldLookups = {
      getCardDefinitionById: lookupWithBackFace,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([back]),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([back]),
    };
    const host = {
      ...createCardInstance(card("BSSA01-X02"), {
        instanceId: "alice-host",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "exhausted",
      }),
      attachedChildrenIds: ["golden-sword"],
    };
    const brave = {
      ...createCardInstance(back, {
        instanceId: "golden-sword",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "recovered",
      }),
      attachedToInstanceId: "alice-host",
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 2 }, {}],
      }),
      activePlayerId: "bob",
      step: "attack",
      window: "flash_before_block",
      cardInstances: [host, brave],
    };

    const useAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...fieldLookups,
    }).find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceCardNo === "BSSA01-転醒X04(B)" &&
        a.sourceInstanceId === "alice-host" &&
        a.sourceEffectInstanceId === "golden-sword"
    );
    expect(useAction).toBeUndefined();
  });

  it("BSSA01-転醒X04(B) 武装完全支配術: 非アリス合体先では発揮できない", () => {
    const back = c.backFace!;
    expect(back.cardNo).toBe("BSSA01-転醒X04(B)");
    const lookupWithBackFace = (id: string): CardDefinition | undefined =>
      id === back.cardNo ? back : getCardDefinitionById(id);
    const fieldLookups = {
      getCardDefinitionById: lookupWithBackFace,
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([back]),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([back]),
    };
    const host = {
      ...createCardInstance(card("BSSA01-C02"), {
        instanceId: "eugeo-host",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "recovered",
      }),
      attachedChildrenIds: ["golden-sword"],
    };
    const brave = {
      ...createCardInstance(back, {
        instanceId: "golden-sword",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "recovered",
      }),
      attachedToInstanceId: "eugeo-host",
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 2 }, {}],
      }),
      activePlayerId: "bob",
      step: "attack",
      window: "flash_before_block",
      cardInstances: [host, brave],
    };

    const useAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...fieldLookups,
    }).find(
      (a) =>
        a.kind === "use_field_card_effect" &&
        a.sourceCardNo === "BSSA01-転醒X04(B)" &&
        a.sourceInstanceId === "eugeo-host" &&
        a.sourceEffectInstanceId === "golden-sword"
    );
    expect(useAction).toBeUndefined();
  });

  it("BSSA01-転醒X04(B) 武装完全支配術: 0体選択では重疲労コストを払い戻してアタック禁止を登録しない", () => {
    const back = c.backFace!;
    expect(back.cardNo).toBe("BSSA01-転醒X04(B)");
    const lookupWithBackFace = (id: string): CardDefinition | undefined =>
      id === back.cardNo ? back : getCardDefinitionById(id);
    const effect = back.effects!.find(
      (e) => e.timing.kind === "activated" && e.timing.mode === "stack"
    )!;
    const host = {
      ...createCardInstance(card("BSSA01-X02"), {
        instanceId: "alice-host",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "recovered",
      }),
      attachedChildrenIds: ["golden-sword"],
    };
    const brave = {
      ...createCardInstance(back, {
        instanceId: "golden-sword",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "recovered",
      }),
      attachedToInstanceId: "alice-host",
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "bob",
      step: "attack",
      cardInstances: [host, brave],
    };

    const result = executeEffect({
      chainId: "test:bssa01-bssg02-cards:2328",
      state,
      effect,
      sourceInstanceId: "golden-sword",
      actingPlayerId: "alice",
      getCardDefinitionById: lookupWithBackFace,
      targetInstanceIds: [],
      targetSelectionResolved: true,
    });

    expect(
      result.cardInstances.find((x) => x.instanceId === "alice-host")
        ?.exhaustState
    ).toBe("recovered");
    expect(
      result.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "prevent_battle_attack"
      )
    ).toBe(false);
    expect(
      result.log.some((line) =>
        line.startsWith("effect:conditional-cost-effect-failed:")
      )
    ).toBe(true);
  });

  it("配置時実行: BP1000の相手スピリットが BP-6000→BP0破壊される（盤面変化）", () => {
    const self = createCardInstance(c, {
      instanceId: "kinmokusei-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    // BP1000 の相手スピリット（BSSG02-C01 Lv1 = 1000）。
    const enemy = createCardInstance(card("BSSG02-C01"), {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1, // Lv1 = BP1000
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, enemy],
    };
    const place = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "place"
    )!;
    const result = executeEffect({
      chainId: "test:bssa01-bssg02-cards:2378",
      state,
      effect: place,
      sourceInstanceId: "kinmokusei-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    // BP1000 - 6000 = 0 → 破壊が enemy-1 を対象に発火し pending-leave(destroy) に積まれる
    // （ゾーン移動は flush で確定。BSAZ01-C01 と同じ BP-debuff→BP0破壊方式）。
    expect(
      result.log.some((l) => l.includes("bp_modify:registered:enemy-1:-6000"))
    ).toBe(true);
    expect(
      result.pendingLeaveEntities.some(
        (e) => e.instanceId === "enemy-1" && e.kind === "destroy"
      )
    ).toBe(true);
  });

  it("相手による離脱トリガー実行: 合体ルート確定でflip成立 → pendingLeaveが解除されフィールドに残り、自分のスピリットに合体する（盤面変化）", () => {
    const self = createCardInstance(c, {
      instanceId: "kinmokusei-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    self.pendingLeaveKind = "destroy";
    self.pendingLeaveCause = "effect_resolution";
    self.pendingLeaveChainId = "chain-x04";
    const host = createCardInstance(card("BSSA01-X02"), {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ countValue: 1 }, {}],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, host],
    };
    state.pendingLeaveEntities = [
      {
        instanceId: "kinmokusei-1",
        kind: "destroy",
        cause: "effect_resolution",
        causePlayerId: "bob",
        chainId: "chain-x04",
        deferZoneMoveUntilChainEnd: false,
      },
    ];
    const leaveTrigger = c.effects!.find(
      (e) => e.timing.kind === "card_event" && e.timing.event === "leave_field"
    )!;

    const pendingChoiceState = executeEffect({
      chainId: "test:bssa01-bssg02-cards:2439",
      state,
      effect: leaveTrigger,
      sourceInstanceId: "kinmokusei-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const combineAction = getLegalActions({
      state: pendingChoiceState,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).find(
      (a) =>
        a.kind === "resolve_brave_combine_choice" &&
        a.chosenHostInstanceId === "host-1"
    );
    expect(combineAction).toBeDefined();
    const afterBody = applyLegalAction({
      state: pendingChoiceState,
      action: combineAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    // flip成立 + pendingLeave解除でフィールドに残る（08a:83 + 04:14 離脱待機状態での置換）。
    const flipped = afterBody.cardInstances.find(
      (x) => x.instanceId === "kinmokusei-1"
    )!;
    expect(flipped.definitionId).toBe("BSSA01-転醒X04(B)");
    expect(flipped.pendingLeaveKind).toBeNull();
    expect(
      afterBody.pendingLeaveEntities.some(
        (e) => e.instanceId === "kinmokusei-1"
      )
    ).toBe(false);
    // 合体成立: 転醒後ブレイヴが host-1 へ attach する。
    expect(flipped.attachedToInstanceId).toBe("host-1");
    const combinedHost = afterBody.cardInstances.find(
      (x) => x.instanceId === "host-1"
    )!;
    expect(combinedHost.attachedChildrenIds).toContain("kinmokusei-1");
  });
});

describe("BSSA01-XX01 [創界神]カーディナル", () => {
  const c = card("BSSA01-XX01");
  it("grandwalkerData(grandwalker) + 神技2/神技4 effect 配線 + 多色treat_as を実装", () => {
    expect(c.grandwalkerData?.kind).toBe("grandwalker");
    const skills = c.grandwalkerData!.divineSkills!;
    expect(skills).toHaveLength(2);
    // 神技2 に effects（ドロー択一）が配線されている。
    const skill2 = skills[0]!;
    expect(skill2.coreCost).toBe(2);
    expect(skill2.effects).toBeDefined();
    const step = skill2.effects![0]!.steps[0]!;
    expect(step.action.kind).toBe("draw");
    expect(step.choice![0]!.action.kind).toBe("core_move");
    // 神技4: 外部転醒 primitive (rebirth.target + forceTriggerCondition + hasMechanic:
    //   ["rebirth"] filter) が divineSkills[1].effects に配線済み（ENGINE-transcendence-
    //   flip-external-post-choice で対象 A 面の postRebirthChoice を継承する）。
    const skill4 = skills[1]!;
    expect(skill4.coreCost).toBe(4);
    expect(skill4.effects).toHaveLength(1);
    const skill4Step = skill4.effects![0]!.steps[0]!;
    const skill4Action = skill4Step.action;
    expect(skill4Action.kind).toBe("rebirth");
    if (skill4Action.kind === "rebirth") {
      expect(skill4Action.forceTriggerCondition).toBe(true);
      expect(skill4Action.target).toBeDefined();
      if (skill4Action.target?.kind === "filter") {
        expect(skill4Action.target.filter.tribes).toEqual(["夜錆"]);
        expect(skill4Action.target.filter.hasMechanic).toEqual(["rebirth"]);
      }
    }
    // [6] 多色 treat_as(紫/白/黄) は engine batch2-1 で実装済。
    const treat = c.effects!.find(
      (e) => e.steps[0]?.action.kind === "treat_as"
    )!;
    expect(treat.stub).toBeUndefined();
    // 神技4 の DSL effect は divineSkills 側が正源(神技2 と同型)。card-level effects には
    // 重複させないため textRef:[12] の stub は残らない。
    expect(c.effects!.filter((e) => e.stub)).toHaveLength(0);
  });

  it("神技4 実行: 外部転醒でBSSA01-転醒X01(A)を対象にし、対象A面の postRebirthChoice を開く", () => {
    const cardinal = createCardInstance(c, {
      instanceId: "cardinal-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const target = createCardInstance(card("BSSA01-転醒X01(A)"), {
      instanceId: "yoru-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [cardinal, target],
      players: [
        {
          ...createEmptyGameState({ playerIds: ["alice", "bob"] }).players[0]!,
          countValue: 7, // BSSA01-転醒X01(A) 自身の maxCount:5 を超過 → forceTriggerCondition が無いと flip 不可
        },
        createEmptyGameState({ playerIds: ["alice", "bob"] }).players[1]!,
      ],
    };
    const skill4 = c.grandwalkerData!.divineSkills![1]!;
    const skill4Effect = skill4.effects![0]!;

    const flippedState = executeEffect({
      chainId: "test:bssa01-bssg02-cards:2556",
      state,
      effect: skill4Effect,
      sourceInstanceId: "cardinal-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["yoru-1"],
      targetSelectionResolved: true,
    });
    const virtual = flippedState.cardInstances.find(
      (x) => x.instanceId === "yoru-1"
    )!;
    // 神技4 の forceTriggerCondition で countValue=7 (> maxCount:5) でも仮想転醒 pending が開く。
    expect(virtual.definitionId).toBe("BSSA01-転醒X01(A)");
    expect(flippedState.pendingStoneFlipCombine).toMatchObject({
      braveInstanceId: "yoru-1",
      braveDefinitionId: "BSSA01-転醒X01(B)",
    });

    const coreRouteAction = getLegalActions({
      state: flippedState,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).find(
      (a) =>
        a.kind === "resolve_brave_combine_choice" &&
        a.chosenHostInstanceId === null
    );
    expect(coreRouteAction).toBeDefined();
    const afterChoice = applyLegalAction({
      state: flippedState,
      action: coreRouteAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    const corePending = afterChoice.pendingCoreDistribution!;
    expect(corePending).not.toBeNull();
    expect(corePending.candidates.map((x) => x.instanceId)).toEqual(["yoru-1"]);
  });

  it("外部転醒 primitive: rebirth.target を持つ probe Effect から divineSkill registration が requiredTargetCount=1 + hasMechanic:rebirth filter を生成", () => {
    // BSSA01-XX01 神技4 への card-data 配線は divineSkills[1].effects に着地済み(上のテスト参照)。
    // 本テストは primitive が divine_skill registration 経路に正しく載ることを
    // 単体カードに依らず probe Effect で確認する: rebirth.target → FIELD_TARGETING_ACTION_KINDS +
    // getActionTarget(case "rebirth") → extractFieldTargetingFromAction → meta 生成。
    // この経路が無いと target-resolution が pool.slice(0,1) で自動先頭選択し、プレイヤー選択が消える。
    const probeEffect = {
      timing: { kind: "activated" as const, mode: "flash" as const },
      executionMode: "optional" as const,
      steps: [
        {
          action: {
            kind: "rebirth" as const,
            maxCount: 5,
            target: {
              kind: "filter" as const,
              player: "self" as const,
              filter: {
                category: [
                  "spirit" as const,
                  "brave" as const,
                  "nexus" as const,
                ],
                tribes: ["夜錆"],
                hasMechanic: ["rebirth" as const],
              },
              count: 1,
            },
            forceTriggerCondition: true,
          },
        },
      ],
    };
    const meta = generateDivineSkillTargetRegistration([probeEffect]);
    expect(meta).not.toBeNull();
    expect(meta!.requiredTargetCount).toBe(1);
    // P3-52: target.player "self" → candidateTargetPlayerScope "acting_player"
    expect(meta!.candidateTargetPlayerScope).toBe("acting_player");
    expect(meta!.targetCardFilter).toBeDefined();
    if (meta!.targetCardFilter) {
      expect(meta!.targetCardFilter.hasMechanic).toEqual(["rebirth"]);
    }
  });

  it("外部転醒 primitive: forceTriggerCondition で対象カードの maxCount チェックを skip し flip 成立", () => {
    // BSSA01-転醒X01(A) (maxCount:5) を countValue=7 (条件 NG) でも flip できる。
    // primitive 単体検証（神技4 card-data 配線は divineSkills[1].effects に着地済み。上のテスト参照）。
    const cardinal = createCardInstance(c, {
      instanceId: "cardinal-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const target = createCardInstance(card("BSSA01-転醒X01(A)"), {
      instanceId: "yoru-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [cardinal, target],
      players: [
        {
          ...createEmptyGameState({ playerIds: ["alice", "bob"] }).players[0]!,
          countValue: 7,
          reserveNormalCoreCount: 1,
        },
        createEmptyGameState({ playerIds: ["alice", "bob"] }).players[1]!,
      ],
    };
    const probeEffect = {
      timing: { kind: "activated" as const, mode: "flash" as const },
      executionMode: "optional" as const,
      steps: [
        {
          action: {
            kind: "rebirth" as const,
            maxCount: 5,
            target: {
              kind: "filter" as const,
              player: "self" as const,
              filter: {
                category: [
                  "spirit" as const,
                  "brave" as const,
                  "nexus" as const,
                ],
                tribes: ["夜錆"],
                hasMechanic: ["rebirth" as const],
              },
              count: 1,
            },
            forceTriggerCondition: true,
          },
        },
      ],
    };
    const result = executeEffect({
      chainId: "test:bssa01-bssg02-cards:2699",
      state,
      effect: probeEffect,
      sourceInstanceId: "cardinal-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["yoru-1"],
      targetSelectionResolved: true,
    });
    const virtual = result.cardInstances.find((c) => c.instanceId === "yoru-1");
    expect(virtual?.definitionId).toBe("BSSA01-転醒X01(A)");
    expect(result.players[0]!.countValue).toBe(7);
    expect(result.pendingStoneFlipCombine).toMatchObject({
      braveInstanceId: "yoru-1",
      braveDefinitionId: "BSSA01-転醒X01(B)",
    });

    const coreRouteAction = getLegalActions({
      state: result,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).find(
      (a) =>
        a.kind === "resolve_brave_combine_choice" &&
        a.chosenHostInstanceId === null
    );
    expect(coreRouteAction).toBeDefined();
    const afterChoice = applyLegalAction({
      state: result,
      action: coreRouteAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    const coreAction = getLegalActions({
      state: afterChoice,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(coreAction).toBeDefined();
    const resolved = applyLegalAction({
      state: afterChoice,
      action: coreAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      coreDistributionAllocations: { "yoru-1": 1 },
      coreDistributionSourceAllocations: { reserve: 1 },
    }).state;
    const flipped = resolved.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "yoru-1"
    );
    expect(flipped?.definitionId).toBe("BSSA01-転醒X01(B)");
    expect(resolved.players[0]!.countValue).toBeGreaterThan(7);
  });

  it("外部転醒 primitive (negative): forceTriggerCondition 無しなら maxCount:5 を countValue=7 で flip しない（count-over）", () => {
    // forceTriggerCondition の意味を厳密に検証するための negative case。
    // maxCount:5 + countValue:7 → 通常の count-over で flip しない (executeRebirth が早期 return)。
    const cardinal = createCardInstance(c, {
      instanceId: "cardinal-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const target = createCardInstance(card("BSSA01-転醒X01(A)"), {
      instanceId: "yoru-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [cardinal, target],
      players: [
        {
          ...createEmptyGameState({ playerIds: ["alice", "bob"] }).players[0]!,
          countValue: 7,
        },
        createEmptyGameState({ playerIds: ["alice", "bob"] }).players[1]!,
      ],
    };
    const probeEffect = {
      timing: { kind: "activated" as const, mode: "flash" as const },
      executionMode: "optional" as const,
      steps: [
        {
          action: {
            kind: "rebirth" as const,
            maxCount: 5,
            target: {
              kind: "filter" as const,
              player: "self" as const,
              filter: {
                category: [
                  "spirit" as const,
                  "brave" as const,
                  "nexus" as const,
                ],
                tribes: ["夜錆"],
                hasMechanic: ["rebirth" as const],
              },
              count: 1,
            },
            // forceTriggerCondition 未指定 → maxCount チェックが効く。
          },
        },
      ],
    };
    const result = executeEffect({
      chainId: "test:bssa01-bssg02-cards:2812",
      state,
      effect: probeEffect,
      sourceInstanceId: "cardinal-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["yoru-1"],
      targetSelectionResolved: true,
    });
    // count-over で flip しない → definitionId は表面のまま。
    const after = result.cardInstances.find((c) => c.instanceId === "yoru-1");
    expect(after?.definitionId).toBe("BSSA01-転醒X01(A)");
    expect(result.players[0]!.countValue).toBe(7);
  });

  it("外部転醒 primitive: 既に転醒後の instance は flip 候補から除外（silent skip）", () => {
    const cardinal = createCardInstance(c, {
      instanceId: "cardinal-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const target = createCardInstance(card("BSSA01-転醒X01(A)"), {
      instanceId: "yoru-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const flippedTarget = {
      ...target,
      definitionId: "BSSA01-転醒X01(B)",
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [cardinal, flippedTarget],
    };
    const probeEffect = {
      timing: { kind: "activated" as const, mode: "flash" as const },
      executionMode: "optional" as const,
      steps: [
        {
          action: {
            kind: "rebirth" as const,
            maxCount: 5,
            target: {
              kind: "filter" as const,
              player: "self" as const,
              filter: {
                category: [
                  "spirit" as const,
                  "brave" as const,
                  "nexus" as const,
                ],
                tribes: ["夜錆"],
                hasMechanic: ["rebirth" as const],
              },
              count: 1,
            },
            forceTriggerCondition: true,
          },
        },
      ],
    };
    const result = executeEffect({
      chainId: "test:bssa01-bssg02-cards:2879",
      state,
      effect: probeEffect,
      sourceInstanceId: "cardinal-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["yoru-1"],
      targetSelectionResolved: true,
    });
    const after = result.cardInstances.find((c) => c.instanceId === "yoru-1");
    expect(after?.definitionId).toBe("BSSA01-転醒X01(B)");
    expect(result.players[0]!.countValue).toBe(0);
  });

  it("神技2 実行: choiceIndex=0 でドロー（盤面変化）", () => {
    const self = createCardInstance(c, {
      instanceId: "cardinal-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 4,
    });
    const deck = [0, 1].map((i) =>
      createCardInstance(card("BSSA01-C01"), {
        instanceId: `deck-${i}`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "deck",
      })
    );
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, ...deck],
    };
    const skill2 = c.grandwalkerData!.divineSkills![0]!;
    const result = executeEffect({
      chainId: "test:bssa01-bssg02-cards:2916",
      state,
      effect: skill2.effects![0]!,
      sourceInstanceId: "cardinal-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      choiceIndex: 0,
    });
    const handCount = result.cardInstances.filter(
      (x) => x.zone === "hand" && x.controllerPlayerId === "alice"
    ).length;
    expect(handCount).toBe(1);
  });

  it("神技2 実プレイ経路: 発揮→スタック窓→ドロー/コアブ選択", () => {
    const self = createCardInstance(c, {
      instanceId: "cardinal-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const deck = createCardInstance(card("BSSA01-C01"), {
      instanceId: "deck-0",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "deck",
    });
    let state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, deck],
    };
    const actionOptions = {
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    };

    const divineActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...actionOptions,
    }).filter((a) => a.kind === "use_divine_skill" && a.skillIndex === 0);
    expect(divineActions).toHaveLength(1);

    state = applyLegalAction({
      state,
      action: divineActions[0]!,
      ...actionOptions,
    }).state;
    expect(state.stackWindow).not.toBeNull();

    let safety = 10;
    while (state.stackWindow && safety-- > 0) {
      const pass = getLegalActions({
        state,
        actingPlayerId: state.stackWindow.priorityPlayerId,
        ...actionOptions,
      }).find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      state = applyLegalAction({
        state,
        action: pass!,
        ...actionOptions,
      }).state;
    }

    expect(state.pendingStepChoice).toMatchObject({
      sourceInstanceId: "cardinal-1",
      stepIndex: 0,
    });
    expect(
      state.cardInstances.find((card) => card.instanceId === "cardinal-1")
        ?.normalCoreCount
    ).toBe(1);

    const choiceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...actionOptions,
    }).filter((a) => a.kind === "resolve_pending_step_choice");
    expect(choiceActions.map((a) => a.choiceLabel)).toEqual([
      "ドロー",
      "コア移動",
    ]);

    const reserveBeforeChoice =
      state.players.find((p) => p.id === "alice")?.reserveNormalCoreCount ?? 0;
    const coreBoost = choiceActions.find((a) => a.choiceIndex === 1)!;
    state = applyLegalAction({
      state,
      action: coreBoost,
      ...actionOptions,
    }).state;

    expect(state.pendingStepChoice).toBeNull();
    expect(
      state.players.find((p) => p.id === "alice")?.reserveNormalCoreCount
    ).toBe(reserveBeforeChoice + 1);
    expect(
      state.cardInstances.filter(
        (card) => card.zone === "hand" && card.controllerPlayerId === "alice"
      )
    ).toHaveLength(0);

    // 原文「〔ターンに1回〕」は choice を選んだ後も同一個体の神技全体を
    // 制限する。cardinal 自身のコア2個を支払った結果と、ボイド→リザーブの
    // 盤面変化を確定してから、二度目の宣言候補が出ないことを確認する。
    expect(
      getLegalActions({
        state,
        actingPlayerId: "alice",
        ...actionOptions,
      }).filter(
        (action) =>
          action.kind === "use_divine_skill" &&
          action.sourceInstanceId === "cardinal-1" &&
          action.skillIndex === 0
      )
    ).toHaveLength(0);
  });
});

describe("BSAZ03 マジック", () => {
  it("BSAZ03-C01 [2,3]: 界塚伊奈帆がいる自分アタックステップ中、終了禁止 + battle_end 効果抑止を登録", () => {
    const c = card("BSAZ03-C01");
    const field = c.effects!.find((e) => e.textRef?.includes(2))!;
    expect(field.stub).toBeUndefined();
    expect(field.timingScope).toEqual({ player: "self", period: "attack" });
    expect(field.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        cardNames: [{ contains: "界塚伊奈帆" }],
      },
    ]);
    expect(field.steps.map((s) => s.action.kind)).toEqual([
      "restrict_end_attack_step",
      "suppress_effect",
    ]);

    const source = createCardInstance(c, {
      instanceId: "again-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const inahoDef: CardDefinition = {
      ...c,
      cardNo: "BSAZ03-INAHO-TEST",
      name: "界塚伊奈帆",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["yellow"],
    };
    const opponentDef: CardDefinition = {
      ...c,
      cardNo: "BSAZ03-OPP-TEST",
      name: "相手テストスピリット",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
    };
    const localDef = (id: string) =>
      id === inahoDef.cardNo
        ? inahoDef
        : id === opponentDef.cardNo
          ? opponentDef
          : getCardDefinitionById(id);
    const inaho = createCardInstance(inahoDef, {
      instanceId: "inaho",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const opponent = createCardInstance(opponentDef, {
      instanceId: "opponent-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const result = executeEffect({
      chainId: "test:bssa01-bssg02-cards:3102",
      state: {
        ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
        activePlayerId: "alice",
        step: "attack",
        cardInstances: [source, inaho, opponent],
      },
      effect: field,
      sourceInstanceId: "again-field",
      actingPlayerId: "alice",
      getCardDefinitionById: localDef,
    });

    expect(
      result.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "restrict_end_attack_step"
      )
    ).toBe(true);
    const suppress = result.activeContinuousEffects.find(
      (ce) => ce.modifierTag === "effect_suppression"
    );
    expect(suppress?.metadata?.effectFilter).toEqual({
      triggerPhrase: "バトル終了",
    });
    expect(suppress?.metadata?.suppressTargetFilter).toEqual({
      category: ["spirit", "ultimate", "nexus", "brave", "magic"],
    });
  });

  it("BSAZ03-M01: effects[0]/[1]/[2,3] すべて実装済み (stub なし)", () => {
    const no = "BSAZ03-M01";
    const c = card(no);
    expect(c.effects).toBeDefined();
    // effects[0] (トラッシュ常駐の自己回収) は実装済み。詳細:
    // bsaz03-m01-trash-recovery.test.ts
    const recovery = c.effects!.find(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 0
    )!;
    expect(recovery.stub).toBeUndefined();
    // effects[1a]/[1b] (使用時軽減シンボル供給・手札破棄コスト軽減) は実装済み。詳細:
    // bsaz03-m01-cost-reduction-symbol.test.ts / bsaz03-m01-use-cost-discard-discount.test.ts
    const costEffects = c.effects!.filter(
      (e) => Array.isArray(e.textRef) && e.textRef[0] === 1
    );
    expect(costEffects.length).toBeGreaterThan(0);
    expect(costEffects.every((e) => e.stub === undefined)).toBe(true);
    // effects[2,3] (他マジック効果借用発揮 + フィールド残置) は実装済み。詳細:
    // bsaz03-m01-effect-borrowing.test.ts
    const borrowEffects = c.effects!.filter(
      (e) => Array.isArray(e.textRef) && e.textRef.includes(3)
    );
    expect(borrowEffects.length).toBe(2); // flash 発動 + stack 発動
    expect(borrowEffects.every((e) => e.stub === undefined)).toBe(true);
    expect(
      borrowEffects.every(
        (e) =>
          e.timing.kind === "activated" &&
          e.steps[0]?.action.kind === "borrow_magic_effect"
      )
    ).toBe(true);
  });
});
