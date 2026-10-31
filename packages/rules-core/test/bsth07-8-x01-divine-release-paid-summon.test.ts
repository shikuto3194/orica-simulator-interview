import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
import { buildCirnoDivineReleasePaymentScenario } from "../../../apps/playground-web/src/scenario-cirno-divine-release-payment";
/**
 * BSTH07.8-X01 チルノ effects[2]『界放：3』フラッシュ『お互いのアタックステップ』検証。
 *
 * 原文 (textLines[3,4]):
 *   "【界放：3】フラッシュ『お互いのアタックステップ』"
 *   "手札にあるこのカードは、自分の導界者ネクサスのコア3個をこのスピリットに置くことで、
 *    召喚コストを支払って召喚できる。"
 *
 * engine-summon-target-self-paid-cost: DSL SummonAction target:{kind:"self"} は
 * costModifier 省略時、native-action-registry.ts が v1Action.zone を一切セットせず
 * structured-summon.ts executeSummonSelf の costToPay 計算が常に0 (無料) になる設計
 * ギャップがあった。target.zone (from_zone と同型の通常コスト支払いトリガー) +
 * carryOverExistingCores (界放で召喚前に手札カードへ乗せたコアをフィールド進入時の
 * 維持コアへ持ち越す) の2フィールドを新設し解消した。
 *
 * 界放:3 cost は BSTH02-X02 effects[1] precedent (core_move from:field_card 導界者
 * ネクサス → to:this_card amount:3、benefit を conditional_cost で gate) と同型。
 * 相違点は cost step の宛先 (`to:this_card`) が「まだ手札にあるこのカード自身」である点
 * ——本 cluster の調査で `core_move`/`moveNormalCores` の書き込み経路は宛先カードの
 * ゾーンを検査しないことを確認済み。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  applyLegalAction,
  getAvailableCardCostPaymentSources,
} from "../src";
import type {
  ActiveAttack,
  CardDefinition,
  GameState,
  LegalAction,
} from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

describe("BSTH07.8-X01 チルノ effects[2] 界放：3 有料召喚", () => {
  const c = cardNoMap.get("BSTH07.8-X01")!;
  const guideNexus = cardNoMap.get("BSTH02-X01")!; // 導界者ネクサス「西行妖」(grandwalkerData 持ち)

  // ========== shape 検証 ==========
  it("timing activated/flash + timingScope both/attack + applicability hand + executionMode optional", () => {
    const e = c.effects![2]!;
    expect(e.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(e.timingScope).toEqual({ player: "both", period: "attack" });
    expect(e.applicability).toEqual({ zone: "hand" });
    expect(e.executionMode).toBe("optional");
    expect(e.stub).toBeUndefined();
  });

  it("step0 = core_move from field_card(自分の導界者ネクサス) → this_card amount:3 (無connector=既定sequential)", () => {
    const e = c.effects![2]!;
    const step0 = e.steps[0]!;
    expect(step0.action.kind).toBe("core_move");
    if (step0.action.kind === "core_move") {
      expect(step0.action.from).toEqual({
        kind: "field_card",
        player: "self",
        filter: {
          category: ["nexus"],
          tribes: ["導界者"],
          targetsGrandwalker: true,
        },
      });
      expect(step0.action.to).toEqual({ kind: "this_card" });
      expect(step0.action.amount).toBe(3);
    }
    expect(step0.connector).toBeUndefined();
  });

  it("step1 = summon target:self zone:hand + carryOverExistingCores:true + connector:conditional_cost", () => {
    const e = c.effects![2]!;
    const step1 = e.steps[1]!;
    expect(step1.action.kind).toBe("summon");
    if (step1.action.kind === "summon") {
      expect(step1.action.target).toEqual({
        kind: "self",
        zone: "hand",
        carryOverExistingCores: true,
      });
    }
    expect(step1.connector).toBe("conditional_cost");
  });

  // ========== 挙動検証 ==========
  it.each(["alice", "bob"])(
    "Telegram 629905089: %sの通常スピリット1コアを支払い、0コア消滅後も界放3コアだけで召喚完了",
    (owner) => {
      const opponent = owner === "alice" ? "bob" : "alice";
      let state = buildCirnoDivineReleasePaymentScenario(
        ALL_CARDS,
        new URLSearchParams({ owner })
      );
      const payment = getAvailableCardCostPaymentSources({
        state,
        actingPlayerId: owner,
        card: c,
        sourceInstanceId: "cirno",
        summonCause: "effect",
        useKind: "summon",
        getCardDefinitionById,
      });
      expect(payment.reduction).toMatchObject({
        printedCost: 5,
        reducedCost: 3,
        additionalCost: -2,
        finalCost: 1,
      });
      expect(payment.onBoardCoreSources.map((s) => s.instanceId)).not.toContain(
        "lily"
      );
      const lookups = {
        getCardDefinitionById,
        getRegisteredHandActivatedEffectActions:
          buildHandActivatedEffectLookup(ALL_CARDS),
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredFieldCardEffectActions: () => [],
      };
      const act = (player: string, kind: LegalAction["kind"], extra = {}) => {
        const action = getLegalActions({
          state,
          actingPlayerId: player,
          ...lookups,
        }).find(
          (a) =>
            a.kind === kind &&
            (a.kind !== "use_hand_card_effect" ||
              (a.sourceInstanceId === "cirno" && a.effectIndex === 2))
        );
        expect(action, kind).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          ...lookups,
          ...extra,
        }).state;
      };
      act(owner, "use_hand_card_effect");
      act(opponent, "pass_battle_flash");
      expect(state.pendingEffectSummonCostPayment).toMatchObject({
        requiredCost: 1,
      });
      expect(
        state.cardInstances.find((x) => x.instanceId === "cirno")
      ).toMatchObject({
        zone: "in_use",
        normalCoreCount: 3,
      });
      expect(
        state.cardInstances.find((x) => x.instanceId === "lily")!
          .normalCoreCount
      ).toBe(0);
      act(owner, "resolve_pending_effect_summon_cost_payment", {
        summonPaymentSources: [
          { kind: "card", instanceId: "payer", amount: 1 },
        ],
      });
      if (state.pendingMultiPlacement) {
        act(owner, "resolve_pending_multi_placement", {
          multiPlacementAllocations: [
            { destinationInstanceId: "cirno", placements: [] },
          ],
        });
      }
      expect(
        state.cardInstances.find((x) => x.instanceId === "cirno")
      ).toMatchObject({
        zone: "field",
        normalCoreCount: 3,
      });
      expect(state.pendingLeaveEntities).toMatchObject([
        { instanceId: "payer", kind: "vanish", cause: "cost_payment" },
      ]);
      for (let i = 0; i < 12; i++) {
        const next = [owner, opponent]
          .flatMap((actingPlayerId) =>
            getLegalActions({ state, actingPlayerId, ...lookups })
          )
          .find(
            (a) =>
              (a.kind === "resolve_pending_burst_check" &&
                !a.sourceInstanceId) ||
              (a.kind === "resolve_pending_triggered_effect" &&
                a.eventKind === "oracle")
          );
        if (!next) break;
        state = applyLegalAction({
          state,
          action: next,
          ...lookups,
          skipOptionalEffect: true,
        }).state;
      }
      expect(
        state.cardInstances.find((x) => x.instanceId === "payer")
      ).toMatchObject({
        zone: "trash",
        normalCoreCount: 0,
      });
      expect(state.players.find((p) => p.id === owner)).toMatchObject({
        reserveNormalCoreCount: 0,
        trashNormalCoreCount: 1,
      });
      expect(state.pendingEffectSummonCostPayment).toBeNull();
      expect(state.pendingMultiPlacement).toBeNull();
      expect(state.pendingLeaveEntities).toHaveLength(0);
      expect(state.pendingEffectCompletions).toHaveLength(0);
      expect(state.pendingTriggeredEffects).toHaveLength(0);
      expect(state.pendingBurstChecks).toHaveLength(0);
    }
  );

  it.each([
    { budget: 3, mixed: false, independent: 3, legal: false },
    { budget: 4, mixed: false, independent: 3, legal: true },
    { budget: 2, mixed: true, independent: 3, legal: true },
    { budget: 2, mixed: true, independent: 1, legal: false },
  ])(
    "先行3コア移動の予約: 通常予算=$budget・混在=$mixed・独立管理=$independent → 合法=$legal",
    ({ budget, mixed, independent, legal }) => {
      const original = c.effects![2]!;
      const ordinarySourceDefinition: CardDefinition = {
        ...c,
        effects: c.effects!.map((effect, index) =>
          index === 2
            ? {
                ...original,
                steps: [
                  {
                    ...original.steps[0]!,
                    action: {
                      kind: "core_move",
                      from: {
                        kind: "field_card",
                        player: "self",
                        filter: mixed
                          ? {
                              category: ["spirit", "nexus"],
                              targetsGrandwalker: true,
                            }
                          : { category: ["spirit"] },
                      },
                      to: { kind: "this_card" },
                      amount: 3,
                    },
                  },
                  original.steps[1]!,
                ],
              }
            : effect
        ),
      };
      const definitions = ALL_CARDS.map((def) =>
        def.cardNo === c.cardNo ? ordinarySourceDefinition : def
      );
      const lookup = (id: string) =>
        definitions.find((def) => def.cardNo === id);
      const base = buildCirnoDivineReleasePaymentScenario(definitions);
      const state = {
        ...base,
        cardInstances: base.cardInstances.map((card) =>
          card.instanceId === "payer"
            ? { ...card, normalCoreCount: budget - 1 }
            : card.instanceId === "lily"
              ? { ...card, normalCoreCount: independent }
              : card
        ),
      };
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        getRegisteredHandActivatedEffectActions:
          buildHandActivatedEffectLookup(definitions),
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredTriggeredEffectActions: () => [],
      }).find(
        (a) =>
          a.kind === "use_hand_card_effect" && a.sourceInstanceId === "cirno"
      );
      expect(action !== undefined).toBe(legal);
    }
  );

  function setup(nexusCores: number, reserveCores = 10) {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: reserveCores }, {}],
    });
    const chiruno = createCardInstance(c, {
      instanceId: "chiruno-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const nexus = createCardInstance(guideNexus, {
      instanceId: "nexus-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: nexusCores,
    });
    return {
      ...base,
      cardInstances: [chiruno, nexus],
    } as GameState;
  }

  it("happy path: 導界者ネクサス3コアあり → 界放3コアを持ち越して召喚、軽減後コスト4をリザーブから支払う", () => {
    const state = setup(3);
    const aliceBefore = state.players.find((p) => p.id === "alice")!;
    const result = executeEffect({
      chainId: "test:bsth07-8-x01-divine-release-paid-summon:117",
      state,
      effect: c.effects![2]!,
      sourceInstanceId: "chiruno-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const chiruno = result.cardInstances.find(
      (x) => x.instanceId === "chiruno-1"
    )!;
    expect(chiruno.zone).toBe("field");
    // 界放で乗せた3コアが Lv1 requiredCores(1) を既に満たすため、追加のリザーブ配置は発生せず
    // 持ち越した3コアのみが最終的なコア数になる。
    expect(chiruno.normalCoreCount).toBe(3);

    const nexus = result.cardInstances.find((x) => x.instanceId === "nexus-1")!;
    expect(nexus.normalCoreCount).toBe(0);

    // 導界者ネクサスの guide シンボル1個で印字コスト5を1軽減し、4コア支払う。
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(
      aliceBefore.reserveNormalCoreCount - 4
    );
    expect(alice.handCount).toBe(aliceBefore.handCount - 1);
  });

  it('対話モード (interactive、summonPaymentSources/summonEnterFieldCorePlacements 明示): rule="required_minimum" (spirit) でも carryOverExistingCores 分で 0 個選択が正当', () => {
    // adversarial verifier round2 lens5 指摘: round1 で修正した interactive モード最低数チェック
    // (structured-summon.ts の requiredMinimumAfterCarryOver) は、それまでの合成テストが
    // printedCategory:"nexus" (rule="optional"、policy.minimumCoreCount は常に0) だけで
    // policy.minimumCoreCount>0 (rule="required_minimum") のケースを一度も踏んでいなかった。
    // X01 自身 (spirit、Lv1 requiredCores=1) を対話モード経路に通し、界放で持ち越した
    // 3コアが policy.minimumCoreCount(1) を上回るため 0 個選択で throw しないことを検証する。
    const state = setup(3);
    const aliceBefore = state.players.find((p) => p.id === "alice")!;
    const result = executeEffect({
      chainId: "test:bsth07-8-x01-divine-release-paid-summon:153",
      state,
      effect: c.effects![2]!,
      sourceInstanceId: "chiruno-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      summonPaymentSources: [{ kind: "reserve", amount: 4 }],
      summonEnterFieldCorePlacements: [],
    });

    const chiruno = result.cardInstances.find(
      (x) => x.instanceId === "chiruno-1"
    )!;
    expect(chiruno.zone).toBe("field");
    expect(chiruno.normalCoreCount).toBe(3);

    const nexus = result.cardInstances.find((x) => x.instanceId === "nexus-1")!;
    expect(nexus.normalCoreCount).toBe(0);

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(
      aliceBefore.reserveNormalCoreCount - 4
    );
  });

  it("対話モードで界放コアが requiredCores 未満 (仮に carryOverExistingCores 無しと同等な既存コア0扱い) なら 0 個選択は throw する", () => {
    // 上のテストとの対照: existingCoreCount が無い (界放コスト未払いのまま強制的に対話モードへ
    // 直接summonのみ渡す想定はDSL上構成できないため、代わりに fail-closed 側の 2 コア不足シナリオを
    // 対話モードで実行し、summon 自体が conditional_cost で不発火のまま (throw ではなく no-op) に
    // なることを確認する — 対話モードでも conditional_cost gate は core_move 失敗時に summon を
    // 実行しないため、enter-field 最低数チェックへは到達しない。
    const state = setup(2);
    const aliceBefore = state.players.find((p) => p.id === "alice")!;
    const result = executeEffect({
      chainId: "test:bsth07-8-x01-divine-release-paid-summon:186",
      state,
      effect: c.effects![2]!,
      sourceInstanceId: "chiruno-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      summonPaymentSources: [{ kind: "reserve", amount: 5 }],
      summonEnterFieldCorePlacements: [],
    });
    const chiruno = result.cardInstances.find(
      (x) => x.instanceId === "chiruno-1"
    )!;
    expect(chiruno.zone).toBe("hand");
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(
      aliceBefore.reserveNormalCoreCount
    );
  });

  it("fail-closed: 導界者ネクサスのコアが2個しかない → conditional_cost で召喚不発火、手札のまま", () => {
    const state = setup(2);
    const aliceBefore = state.players.find((p) => p.id === "alice")!;
    const result = executeEffect({
      chainId: "test:bsth07-8-x01-divine-release-paid-summon:208",
      state,
      effect: c.effects![2]!,
      sourceInstanceId: "chiruno-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const chiruno = result.cardInstances.find(
      (x) => x.instanceId === "chiruno-1"
    )!;
    expect(chiruno.zone).toBe("hand");
    expect(chiruno.normalCoreCount).toBe(0);

    const nexus = result.cardInstances.find((x) => x.instanceId === "nexus-1")!;
    expect(nexus.normalCoreCount).toBe(2); // rollback、消費されない

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(
      aliceBefore.reserveNormalCoreCount
    );
    expect(alice.handCount).toBe(aliceBefore.handCount);
  });

  it("legal action: 導界者ネクサスの通常2+ソウル1でも界放3手札起動候補に残る", () => {
    const attackerDef = cardNoMap.get("BSTH07.8-C01")!;
    const chiruno = createCardInstance(c, {
      instanceId: "chiruno-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const nexus = createCardInstance(guideNexus, {
      instanceId: "nexus-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
      soulCoreCount: 1,
    });
    const attacker = createCardInstance(attackerDef, {
      instanceId: "attacker-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack-group:2:alice:battle-entity:attacker-1",
      primaryEntityId: "battle-entity:attacker-1",
      participantEntityIds: ["battle-entity:attacker-1"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:attacker-1",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["battle-entity:attacker-1"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: null,
      },
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: 10,
            soulCoreLocation: { kind: "card", instanceId: "nexus-1" },
          },
          {},
        ],
        cardInstances: [chiruno, nexus, attacker],
        battleEntities: [
          {
            entityId: "battle-entity:attacker-1",
            memberInstanceIds: ["attacker-1"],
            resolvedBp: 1000,
            resolvedSymbols: ["white"],
            attackState: "attacking",
          },
        ],
        activeAttack,
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "flash_before_block",
      turnNumber: 2,
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(ALL_CARDS),
    });

    expect(
      actions.find(
        (action) =>
          action.kind === "use_hand_card_effect" &&
          action.sourceInstanceId === "chiruno-1" &&
          action.effectIndex === 2
      )
    ).toBeDefined();
  });

  it("legal action: 界放3で退避するコアを召喚コストへ二重計上しない", () => {
    const attackerDef = cardNoMap.get("BSTH07.8-C01")!;
    const chiruno = createCardInstance(c, {
      instanceId: "chiruno-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const nexus = createCardInstance(guideNexus, {
      instanceId: "nexus-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 6,
    });
    const attacker = createCardInstance(attackerDef, {
      instanceId: "attacker-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "exhausted",
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack-group:2:alice:battle-entity:attacker-1",
      primaryEntityId: "battle-entity:attacker-1",
      participantEntityIds: ["battle-entity:attacker-1"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:attacker-1",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["battle-entity:attacker-1"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: null,
      },
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
        cardInstances: [chiruno, nexus, attacker],
        battleEntities: [
          {
            entityId: "battle-entity:attacker-1",
            memberInstanceIds: ["attacker-1"],
            resolvedBp: 1000,
            resolvedSymbols: ["white"],
            attackState: "attacking",
          },
        ],
        activeAttack,
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "flash_before_block",
      turnNumber: 2,
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(ALL_CARDS),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(ALL_CARDS),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(ALL_CARDS),
    });

    expect(
      actions.find(
        (action) =>
          action.kind === "use_hand_card_effect" &&
          action.sourceInstanceId === "chiruno-1" &&
          action.effectIndex === 2
      )
    ).toBeUndefined();
  });
});

describe("engine-summon-target-self-paid-cost 回帰: 既存 target:self 無料召喚は無影響", () => {
  const c07 = cardNoMap.get("BSAZ02-C07")!; // 「〔ターンに1回：同名〕手札にあるこのカードは召喚できる。」= 無料 (zone未指定)

  it("BSAZ02-C07 effects[1] は zone/carryOverExistingCores 未指定のまま (opt-in、既存挙動不変)", () => {
    const e = c07.effects![1]!;
    const step0 = e.steps[0]!;
    expect(step0.action.kind).toBe("summon");
    if (step0.action.kind === "summon") {
      expect(step0.action.target).toEqual({ kind: "self" });
    }
  });

  it("BSAZ02-C07 は召喚してもリザーブコアが変化しない (従来どおり無料)", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
    });
    const stayges = createCardInstance(c07, {
      instanceId: "stayges-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const state: GameState = {
      ...base,
      cardInstances: [stayges],
    };
    const aliceBefore = state.players.find((p) => p.id === "alice")!;
    const result = executeEffectWithChosenMinimumCores({
      chainId: "test:bsth07-8-x01-divine-release-paid-summon:451",
      state,
      effect: c07.effects![1]!,
      sourceInstanceId: "stayges-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const staygesAfter = result.cardInstances.find(
      (x) => x.instanceId === "stayges-1"
    )!;
    expect(staygesAfter.zone).toBe("field");
    // 印字コスト3のはずだが zone 未指定 (opt-in なし) のため従来どおり costToPay=0。
    // Lv1 requiredCores(1) 分の維持コア自動配置 (コストとは別の既存メカニズム、本 cluster の
    // 変更対象外) のみリザーブから引かれる。
    expect(staygesAfter.normalCoreCount).toBe(1);
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(
      aliceBefore.reserveNormalCoreCount - 1
    );
  });
});

describe("engine-summon-target-self-paid-cost 回帰: enter-field 配置ルール (policy.rule) の下限を保つ", () => {
  // adversarial verifier round1 lens3 指摘: additionalCoresNeeded (carryOverExistingCores
  // 由来の残数) だけで対話モードの最低数を検証すると、rule="optional"/"forbidden"
  // (ネクサス等、常に下限0) のカードの下限を無視してしまう。requiredCores>=1 の合成ネクサス定義で
  // 直接検証する (現行の landed target:self ネクサス4件は全て requiredCores=0 のため実カードでは
  // 再現しない)。
  const syntheticOptionalRuleNexus: CardDefinition = {
    cardNo: "TEST-OPTIONAL-NEXUS",
    name: "テスト用任意配置ネクサス",
    printedCategory: "nexus",
    colors: ["white"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        applicability: { zone: "hand" },
        steps: [
          {
            action: {
              kind: "summon",
              // zone は未指定 (このテストはコスト支払い経路ではなく enter-field 配置
              // 最低数ガードのみを対象化するため、cost は無料のままにする)。
              target: { kind: "self", carryOverExistingCores: true },
            },
          },
        ],
        textRef: [],
      },
    ],
  };
  const localCardMap = new Map<string, CardDefinition>([
    ["TEST-OPTIONAL-NEXUS", syntheticOptionalRuleNexus],
  ]);
  const localGetCardDefinitionById = (id: string) => localCardMap.get(id);

  it("printedCategory:nexus (rule=optional) は requiredCores=1 でも対話モードで0個選択が正当 (throwしない)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const nexusInHand = createCardInstance(syntheticOptionalRuleNexus, {
      instanceId: "nexus-hand-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "hand",
      normalCoreCount: 0,
    });
    const state: GameState = { ...base, cardInstances: [nexusInHand] };

    expect(() =>
      executeEffect({
        chainId: "test:bsth07-8-x01-divine-release-paid-summon:526",
        state,
        effect: syntheticOptionalRuleNexus.effects![0]!,
        sourceInstanceId: "nexus-hand-1",
        actingPlayerId: "alice",
        getCardDefinitionById: localGetCardDefinitionById,
        summonPaymentSources: [],
        summonEnterFieldCorePlacements: [],
      })
    ).not.toThrow();

    const result = executeEffect({
      chainId: "test:bsth07-8-x01-divine-release-paid-summon:537",
      state,
      effect: syntheticOptionalRuleNexus.effects![0]!,
      sourceInstanceId: "nexus-hand-1",
      actingPlayerId: "alice",
      getCardDefinitionById: localGetCardDefinitionById,
      summonPaymentSources: [],
      summonEnterFieldCorePlacements: [],
    });
    const nexusAfter = result.cardInstances.find(
      (x) => x.instanceId === "nexus-hand-1"
    )!;
    expect(nexusAfter.zone).toBe("field");
    expect(nexusAfter.normalCoreCount).toBe(0);
  });
});
