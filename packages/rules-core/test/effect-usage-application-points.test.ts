/**
 * P3-170 V10: 専用の使用記録だった枠 (I05 count gain / I06 tapless / I07 宣言ギミック / I10 useCostGate) が
 * 共通の使用会計へ移ったあとも、定義した commitPoint「だけ」で消費されること。
 *
 * - 候補の列挙・照会・辞退・窓キャンセルでは消費しない。
 * - 適用 / 宣言の確定 / 支払い確定の地点で消費する (宣言消費に変えない)。
 * - 暦ターンが替われば枠が戻る。別個体 / 別プレイヤーの枠とは独立。
 * - I07: CE の再構築 (Lv2→Lv1→Lv2) で CE の effectId が変わっても使用済みが消えない (H6)。
 * - I10: 「この方法で使用した」事実は使用回数のリセットと独立。
 *
 * 実カード: BSTS01-C03 (count gain) / BSTH09-C03 (tapless) / BSLH01-C12 (宣言ギミック) /
 * BSLH01-M05 (useCostGate)。ルールの根拠は 10_rules/08a (count gain)・03e (期間と共有範囲)。
 * BSTH09-C03 / BSLH01-C12 / BSLH01-M05 は 10_rules に節が無く、カード本文のみが根拠 (信頼度 C)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  confirmAttackDeclarationAsAction,
  confirmBlockDeclarationAsAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
  useAttackAsAction,
  useBlockAsAction,
  usePassPreDeclarationStackAsAction,
} from "../src/index";
import type { ActiveAttack, CardDefinition, GameState } from "../src/index";
import {
  getPlayerLifeCoreCount,
  resolveLifeDamage,
  resolvePendingLifeDamageDiscardChoice,
} from "../src/core/core-system";
import { executeCountIncrease } from "../src/effect/structured-effect-interpreter";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import { evaluateCondition } from "../src/effect/structured-condition-eval";
import { gimmickDeclarationCount } from "./helpers/quantity-usage-fixture";
import {
  canUseEffectUsage,
  refundEffectUsageForTest,
} from "./helpers/effect-usage-fixture";
import {
  isCountGainModifierConsumed,
  isTaplessBattleDeclareUsed,
  isUseCostGatePaid,
  markTaplessBattleDeclareUsed,
  markUseCostGatePaid,
  withNextTurnClock,
} from "./helpers/dedicated-usage-fixture";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const lookup = buildTriggeredEffectLookup(ALL_CARDS);

// ============================================================
// I05 count_gain_modifier (BSTS01-C03)
// ============================================================

describe("I05 count_gain_modifier: 適用した時点で消費する (BSTS01-C03)", () => {
  const RIGURUDO = "BSTS01-C03";
  const PLAYER = "player-1";
  const OPP = "player-2";
  const modifier = (instanceId: string) => ({
    sourceInstanceId: instanceId,
    sourceDefinitionId: RIGURUDO,
  });

  function board(instanceIds: string[]): GameState {
    const cards = instanceIds.map((id) =>
      createCardInstance(card(RIGURUDO), {
        ownerPlayerId: PLAYER,
        zone: "field",
        instanceId: id,
      })
    );
    return rebuildContinuousEffectsFromField(
      createEmptyGameState({ playerIds: [PLAYER, OPP], cardInstances: cards }),
      getDef
    );
  }
  const countOf = (s: GameState, pid: string) =>
    s.players.find((p) => p.id === pid)!.countValue;

  it("修飾の登録 (CE 構築) と照会だけでは消費せず、最初の count+ の適用で消費する", () => {
    const registered = board(["rig-1"]);
    expect(
      registered.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "count_gain_modifier"
      )
    ).toBe(true);
    expect(
      isCountGainModifierConsumed(registered, modifier("rig-1"), PLAYER)
    ).toBe(false);

    const applied = executeCountIncrease(registered, PLAYER, "self", 2);
    expect(countOf(applied, PLAYER)).toBe(3);
    expect(
      isCountGainModifierConsumed(applied, modifier("rig-1"), PLAYER)
    ).toBe(true);
  });

  it("実増加が0 (ボイドのコア不足) でも適用点で消費する (宣言消費に変えていない)", () => {
    const registered = board(["rig-1"]);
    const emptyVoid: GameState = {
      ...registered,
      players: registered.players.map((p) =>
        p.id === PLAYER ? { ...p, voidNormalCoreCount: 0 } : p
      ),
    };
    const applied = executeCountIncrease(emptyVoid, PLAYER, "self", 0);
    expect(countOf(applied, PLAYER)).toBe(0);
    expect(
      isCountGainModifierConsumed(applied, modifier("rig-1"), PLAYER)
    ).toBe(true);
    // 消費済みなので、同ターンに2件目が来ても +1 は乗らない (ボイドにコアを戻して確認)。
    const refilled: GameState = {
      ...applied,
      players: applied.players.map((p) =>
        p.id === PLAYER ? { ...p, voidNormalCoreCount: 5 } : p
      ),
    };
    const second = executeCountIncrease(refilled, PLAYER, "self", 1);
    expect(countOf(second, PLAYER)).toBe(1);
  });

  it("相手の count+ は受益者ではないため消費しない / 同名の複数コピーは1枠を共有する", () => {
    const registered = board(["rig-1", "rig-2"]);
    const oppApplied = executeCountIncrease(registered, OPP, "self", 1);
    expect(countOf(oppApplied, OPP)).toBe(1);
    expect(
      isCountGainModifierConsumed(oppApplied, modifier("rig-1"), PLAYER)
    ).toBe(false);

    const applied = executeCountIncrease(oppApplied, PLAYER, "self", 0);
    expect(countOf(applied, PLAYER)).toBe(1); // 2体いても +1 は1回分
    expect(
      isCountGainModifierConsumed(applied, modifier("rig-2"), PLAYER)
    ).toBe(true);
  });

  it("再適用: ターンが替わると枠が戻り、最初の count+ に再び +1 が乗る", () => {
    let state = executeCountIncrease(board(["rig-1"]), PLAYER, "self", 0);
    expect(isCountGainModifierConsumed(state, modifier("rig-1"), PLAYER)).toBe(
      true
    );
    state = withNextTurnClock(state);
    expect(isCountGainModifierConsumed(state, modifier("rig-1"), PLAYER)).toBe(
      false
    );
    state = executeCountIncrease(state, PLAYER, "self", 0);
    expect(countOf(state, PLAYER)).toBe(2);
  });
});

// ============================================================
// I06 allow_tapless_battle_declare (BSTH09-C03)
// ============================================================

describe("I06 allow_tapless_battle_declare: 宣言の確定時にだけ消費し、アタック/ブロックで1予算を共有する (BSTH09-C03)", () => {
  const TAPLESS = "BSTH09-C03";

  function attackBoard(): GameState {
    const attacker = createCardInstance(card(TAPLESS), {
      instanceId: "attacker-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
      exhaustState: "recovered",
    });
    const other = createCardInstance(card(TAPLESS), {
      instanceId: "attacker-2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
      exhaustState: "recovered",
    });
    return rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [attacker, other],
        }),
        activePlayerId: "alice",
        step: "attack",
        window: "none",
        activeAttack: null,
      },
      getDef
    );
  }

  function startAttack(state: GameState, sourceInstanceId: string): GameState {
    return useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
  }

  function confirmAttack(tentative: GameState): GameState {
    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentative,
      actingPlayerId: "bob",
    });
    return confirmAttackDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById: getDef }
    ).state;
  }

  const exhaustOf = (s: GameState, id: string) =>
    s.cardInstances.find((c) => c.instanceId === id)?.exhaustState;

  it("宣言の開始 (確定前の事前スタック窓) と合法手の列挙では消費しない。確定時に消費する", () => {
    const state = attackBoard();
    // 合法手の列挙は消費しない。
    getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    });
    expect(isTaplessBattleDeclareUsed(state, "attacker-1")).toBe(false);

    // 宣言を始めただけ (相手の応答待ち) では未消費。
    const tentative = startAttack(state, "attacker-1");
    expect(isTaplessBattleDeclareUsed(tentative, "attacker-1")).toBe(false);

    // 確定で消費し、疲労遷移はスキップされる。
    const confirmed = confirmAttack(tentative);
    expect(isTaplessBattleDeclareUsed(confirmed, "attacker-1")).toBe(true);
    expect(exhaustOf(confirmed, "attacker-1")).toBe("recovered");
    // 別個体の予算は独立。
    expect(isTaplessBattleDeclareUsed(confirmed, "attacker-2")).toBe(false);
  });

  it("再適用: 同ターン2回目の宣言は通常どおり疲労し、ターンが替わると予算が戻る", () => {
    const first = confirmAttack(startAttack(attackBoard(), "attacker-1"));
    const secondDeclared = confirmAttack(
      startAttack(
        { ...first, activeAttack: null, window: "none" },
        "attacker-1"
      )
    );
    expect(exhaustOf(secondDeclared, "attacker-1")).toBe("exhausted");

    const nextTurn = withNextTurnClock(first);
    expect(isTaplessBattleDeclareUsed(nextTurn, "attacker-1")).toBe(false);
  });

  it("アタックとブロックは同じ予算を消費する (予算を使い切った個体はブロックでも通常どおり疲労する)", () => {
    const attacker = createCardInstance(card("BSDB01-C05"), {
      instanceId: "attacker-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
      exhaustState: "exhausted",
    });
    const blocker = createCardInstance(card(TAPLESS), {
      instanceId: "blocker-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
      exhaustState: "recovered",
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
    const blockBoard = (budgetAlreadyUsed: boolean): GameState => {
      let s = rebuildContinuousEffectsFromField(
        {
          ...createEmptyGameState({
            playerIds: ["alice", "bob"],
            cardInstances: [attacker, blocker],
          }),
          turnNumber: 2,
          activePlayerId: "alice",
          step: "attack",
        },
        getDef
      );
      s = {
        ...s,
        window: "declare_attack",
        activeAttack,
        battleEntities: [
          {
            entityId: "be-1",
            resolvedBp: 3000,
            attackState: "attacking",
            resolvedSymbols: ["red"],
            memberInstanceIds: ["attacker-1"],
          },
        ],
      };
      return budgetAlreadyUsed
        ? markTaplessBattleDeclareUsed(s, "blocker-1")
        : s;
    };
    const confirmBlock = (state: GameState): GameState => {
      const tentative = useBlockAsAction({
        state,
        actingPlayerId: "bob",
        sourceInstanceId: "blocker-1",
        participantEntityId: "be-1",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: undefined,
      });
      // 宣言の開始だけでは消費しない。
      expect(isTaplessBattleDeclareUsed(tentative, "blocker-1")).toBe(
        isTaplessBattleDeclareUsed(state, "blocker-1")
      );
      const afterPass = usePassPreDeclarationStackAsAction({
        state: tentative,
        actingPlayerId: "alice",
      });
      return confirmBlockDeclarationAsAction(
        afterPass.closedWindow!,
        afterPass.state,
        { getCardDefinitionById: getDef }
      ).state;
    };

    const fresh = confirmBlock(blockBoard(false));
    expect(exhaustOf(fresh, "blocker-1")).toBe("recovered");
    expect(isTaplessBattleDeclareUsed(fresh, "blocker-1")).toBe(true);

    // 同じ個体の予算が (アタック側などで) 消費済みなら、ブロックは通常どおり疲労する。
    const spent = confirmBlock(blockBoard(true));
    expect(exhaustOf(spent, "blocker-1")).toBe("exhausted");
  });
});

// ============================================================
// I07 declareGimmickGate (BSLH01-C12)
// ============================================================

describe("I07 declareGimmickGate: 支払い確定時にだけ消費し、CE 再構築でも使用済みが消えない (BSLH01-C12)", () => {
  const ALICE = "player-1";
  const BOB = "player-2";

  function c12Board(): GameState {
    const src = createCardInstance(card("BSLH01-C12"), {
      instanceId: "src-c12",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1, // Lv2
    });
    return rebuildContinuousEffectsFromField(
      createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [src],
        playerOverrides: [
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        ],
      }),
      getDef
    );
  }
  const damage = (state: GameState, playerId: string): GameState =>
    resolveLifeDamage(
      state,
      playerId,
      1,
      [],
      { cause: "battle", actingPlayerId: playerId === ALICE ? BOB : ALICE },
      getDef
    );
  const lifeOf = (s: GameState, pid: string) =>
    getPlayerLifeCoreCount(s.players.find((p) => p.id === pid)!);
  const withLevel = (state: GameState, normalCoreCount: number): GameState =>
    recomputeAndRebuildContinuousEffects(
      {
        ...state,
        cardInstances: state.cardInstances.map((c) =>
          c.instanceId === "src-c12" ? { ...c, normalCoreCount } : c
        ),
      },
      getDef
    );
  const interceptionEffectIds = (state: GameState): string[] =>
    state.activeContinuousEffects
      .filter((ce) => ce.modifierTag === "life_damage_interception")
      .map((ce) => ce.effectId)
      .sort();

  it("候補の列挙 (宣言ゲートの提示) と辞退では消費せず、支払い確定で消費する", () => {
    const base = c12Board();
    const pending = damage(base, ALICE);
    expect(pending.pendingLifeDamageDiscardChoice).not.toBeNull();

    // 辞退: 通常どおりライフが減り、枠は消費されないので次のダメージでも再び提示される。
    const declined = resolvePendingLifeDamageDiscardChoice(pending, "decline");
    expect(lifeOf(declined, ALICE)).toBe(4);
    expect(
      damage(declined, ALICE).pendingLifeDamageDiscardChoice
    ).not.toBeNull();

    // 支払い確定: 消費される。同ターンの2回目はゲートなしで通常解決する。
    const paid = resolvePendingLifeDamageDiscardChoice(pending, "pay");
    expect(gimmickDeclarationCount(paid, ALICE)).toBe(1);
    expect(
      damage(paid, ALICE).pendingLifeDamageDiscardChoice ?? null
    ).toBeNull();
  });

  it("使用者ごとに独立 (お互いターンに1回ずつ): 自分が使っても相手の枠は残り、ターンが替われば戻る", () => {
    const paid = resolvePendingLifeDamageDiscardChoice(
      damage(c12Board(), ALICE),
      "pay"
    );
    expect(
      damage(paid, ALICE).pendingLifeDamageDiscardChoice ?? null
    ).toBeNull();
    // 相手側の宣言ゲートは別枠 (effects[2] の step1)。
    expect(damage(paid, BOB).pendingLifeDamageDiscardChoice).not.toBeNull();

    const nextTurn = withNextTurnClock(paid);
    expect(
      damage(nextTurn, ALICE).pendingLifeDamageDiscardChoice
    ).not.toBeNull();
  });

  it("H6: Lv2→Lv1→Lv2 で CE が再構築され effectId が変わっても、使用済みは消えない", () => {
    const base = c12Board();
    const paid = resolvePendingLifeDamageDiscardChoice(
      damage(base, ALICE),
      "pay"
    );
    const idsBefore = interceptionEffectIds(paid);
    expect(idsBefore.length).toBeGreaterThan(0);

    const lv1 = withLevel(paid, 0);
    expect(interceptionEffectIds(lv1)).toEqual([]);
    const lv2Again = withLevel(lv1, 1);
    const idsAfter = interceptionEffectIds(lv2Again);
    expect(idsAfter.length).toBe(idsBefore.length);
    // 再構築で CE の識別子は新しくなっている (旧実装はこの id をキーにして使用済みを失った)。
    expect(idsAfter).not.toEqual(idsBefore);

    // 使用済みなので、同ターンの再ダメージで宣言ゲートは再提示されない。
    expect(
      damage(lv2Again, ALICE).pendingLifeDamageDiscardChoice ?? null
    ).toBeNull();
    // 未使用側 (相手) は再構築後も提示される。
    expect(damage(lv2Again, BOB).pendingLifeDamageDiscardChoice).not.toBeNull();
  });

  it("H6 対照: 未使用のまま Lv2→Lv1→Lv2 を経ても、ゲートは提示される (再構築で使用済み扱いにならない)", () => {
    const lv2Again = withLevel(withLevel(c12Board(), 0), 1);
    expect(
      damage(lv2Again, ALICE).pendingLifeDamageDiscardChoice
    ).not.toBeNull();
  });
});

// ============================================================
// I10 useCostGate (BSLH01-M05): 「この方法で使用した」事実
// ============================================================

describe("I10 useCostGate: 使用回数ではなく『この方法で使用した』事実を記録する (BSLH01-M05)", () => {
  const ALICE = "player-1";
  const BOB = "player-2";

  function m05InHand(): GameState {
    const src = createCardInstance(card("BSLH01-M05"), {
      instanceId: "lh01-m05",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    return {
      ...createEmptyGameState({
        cardInstances: [src],
        startingVoidNormalCoreCount: 0,
        playerOverrides: [
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        ],
      }),
      step: "attack",
    };
  }
  function pendingChoice(state: GameState): GameState {
    return resolveLifeDamage(
      state,
      ALICE,
      1,
      [],
      { cause: "opponent_effect", actingPlayerId: BOB },
      getDef
    );
  }
  function resolveChoice(
    state: GameState,
    choice: "pay" | "decline"
  ): GameState {
    const action = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
    }).find((a) => a.kind === "resolve_pending_life_damage_discard_choice");
    return applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: lookup,
      lifeDamageDiscardChoice: choice,
    }).state;
  }

  it("使用コストゲートの提示 (候補) と辞退では事実を記録せず、支払い確定で記録する", () => {
    const pending = pendingChoice(m05InHand());
    expect(pending.pendingLifeDamageDiscardChoice).not.toBeNull();
    expect(isUseCostGatePaid(pending, ALICE, "lh01-m05")).toBe(false);

    const declined = resolveChoice(pending, "decline");
    expect(isUseCostGatePaid(declined, ALICE, "lh01-m05")).toBe(false);

    const paid = resolveChoice(pending, "pay");
    expect(isUseCostGatePaid(paid, ALICE, "lh01-m05")).toBe(true);
    // 事実の主体は支払ったプレイヤー。相手の照会には成立しない。
    expect(isUseCostGatePaid(paid, BOB, "lh01-m05")).toBe(false);
  });

  it("使用回数 (magic の使用制限) が後で戻されても、『この方法で使用した』事実は消えない", () => {
    const m05 = card("BSLH01-M05");
    const pending = pendingChoice(m05InHand());
    const paid = resolveChoice(pending, "pay");
    const magicUsage = {
      sourceInstanceId: "lh01-m05",
      effectLabel: "magic",
      usageLimit: m05.effects![2]!.usageLimit,
    } as const;
    // pay で magic の使用回数が消費されている。
    expect(canUseEffectUsage(paid, magicUsage)).toBe(false);

    // 使用回数だけを戻す (取消)。事実は別の記録なので残る。
    const reset = refundEffectUsageForTest(paid, magicUsage);
    expect(canUseEffectUsage(reset, magicUsage)).toBe(true);
    expect(isUseCostGatePaid(reset, ALICE, "lh01-m05")).toBe(true);
  });

  it("後続条件は事実を照会する: 支払い済みの個体だけ成立し、別個体・ターン経過では成立しない", () => {
    const m05 = card("BSLH01-M05");
    // 自分の場にスピリットがいる (field_lacks は不成立) 盤面で、事実の有無だけが条件を決める。
    const spirit = createCardInstance(card("BSLH01-C01"), {
      instanceId: "spirit-on-field",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const paidCard = createCardInstance(m05, {
      instanceId: "lh01-m05-paid",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const otherCopy = createCardInstance(m05, {
      instanceId: "lh01-m05-other",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const base = createEmptyGameState({
      cardInstances: [spirit, paidCard, otherCopy],
      startingVoidNormalCoreCount: 0,
    });
    const condition = m05.effects![2]!.condition!;
    const evaluate = (state: GameState, instanceId: string) =>
      evaluateCondition(state, condition, instanceId, ALICE, getDef);

    expect(evaluate(base, "lh01-m05-paid")).toBe(false);
    const paid = markUseCostGatePaid(base, ALICE, "lh01-m05-paid");
    expect(evaluate(paid, "lh01-m05-paid")).toBe(true);
    expect(evaluate(paid, "lh01-m05-other")).toBe(false);
    expect(evaluate(withNextTurnClock(paid), "lh01-m05-paid")).toBe(false);
  });
});
