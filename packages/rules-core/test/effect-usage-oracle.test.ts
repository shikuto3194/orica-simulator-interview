/**
 * P3-170 V10 (I09): 神託/導託の回数制限の使用枠。予約と消費の区別。
 *
 * 実カードで検査する。
 *  - BSLH01-X01 (召喚/煌臨での導託はステップに1回 = oracleTriggerUsageLimit: per_instance / step)
 *  - BSTH02.7-CX01 (配置時神託は〔ターンに1回:同名〕= placementOracle.usageLimit: per_card_name / turn)
 *
 * 契約 (issues/archive/P3-170/contract.md「消費・予約・取消」):
 *  - 候補の列挙・任意効果の辞退では消費しない。
 *  - 未宣言候補の「予約」は実際の保留処理(未解決の誘発・スタック)だけに紐付き、使用枠には書かない。
 *  - 受諾して実際に神託を行った時点で初めて消費する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, TriggeredMechanic } from "../src";
import {
  checkAndQueueOracleChoices,
  checkAndQueuePlacementOracle,
  resolvePlacementOracleMechanic,
} from "../src/mechanics/oracle-system";
import { listEffectUsage } from "./helpers/effect-usage-fixture";
import {
  oracleTriggerUsage,
  placementOracleUsage,
  seedOracleTriggerUsage,
} from "./helpers/oracle-usage-fixture";

const ALICE = "player-1";
const BOB = "player-2";

const REAL = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);

function baseState(cardInstances: ReturnType<typeof createCardInstance>[]) {
  return {
    ...createEmptyGameState({
      cardInstances,
      playerOverrides: [
        { reserveNormalCoreCount: 10, voidNormalCoreCount: 100 },
        { reserveNormalCoreCount: 10, voidNormalCoreCount: 100 },
      ],
    }),
    step: "main" as const,
    window: "none" as const,
  };
}

/** 保留中の神託(mechanic 付き誘発)を、受諾/辞退の合法手で解決する。受諾はスタックを閉じるまで進める。 */
function resolvePending(
  state: GameState,
  getDef: (id: string) => CardDefinition | undefined,
  pendingId: string,
  accept: boolean
): GameState {
  const action = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  }).find(
    (a) =>
      a.kind === "resolve_pending_triggered_effect" && a.pendingId === pendingId
  );
  expect(action, `resolve action for ${pendingId}`).toBeDefined();
  let current = (
    applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: getDef,
      ...(accept ? {} : { skipOptionalEffect: true }),
    }) as { state: GameState }
  ).state;
  if (!accept) {
    expect(current.stackWindow).toBeNull();
    return current;
  }
  expect(current.stackWindow).not.toBeNull();
  for (let guard = 0; current.stackWindow && guard < 10; guard++) {
    const pass = getLegalActions({
      state: current,
      actingPlayerId: current.stackWindow.priorityPlayerId,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]).find(
      (a) => a.kind === "pass_stack"
    );
    expect(pass).toBeDefined();
    current = (
      applyLegalAction({
        state: current,
        action: pass!,
        getCardDefinitionById: getDef,
      }) as { state: GameState }
    ).state;
  }
  expect(current.stackWindow).toBeNull();
  return current;
}

function pendingsOf<K extends TriggeredMechanic["kind"]>(
  state: GameState,
  kind: K,
  grandwalkerInstanceId?: string
) {
  return state.pendingTriggeredEffects.filter(
    (pending) =>
      pending.mechanic?.kind === kind &&
      (grandwalkerInstanceId === undefined ||
        (pending.mechanic as { grandwalkerInstanceId?: string })
          .grandwalkerInstanceId === grandwalkerInstanceId)
  );
}

describe("V10 I09: 召喚/煌臨の神託(BSLH01-X01 ステップに1回)", () => {
  const x01 = REAL.get("BSLH01-X01")!;
  const condition = x01.grandwalkerData!.oracleConditions[0]!;
  // oracleConditions[0] に一致するスピリット(召喚されたカード側)。
  const matching: CardDefinition = {
    cardNo: "TM-I09-MATCH",
    name: "神託一致スピリット",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: Math.max(condition.minCost ?? 1, 3),
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    tribe: condition.tribes?.[0] ?? "CB",
    sourceUrls: [],
    sourceConfidence: "A",
  } as CardDefinition;
  const getDef = (id: string) =>
    id === matching.cardNo ? matching : REAL.get(id);

  function scenario() {
    const field = (definition: CardDefinition, instanceId: string) =>
      createCardInstance(definition, {
        instanceId,
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });
    return baseState([
      field(x01, "x01"),
      field(matching, "sp-a"),
      field(matching, "sp-b"),
    ]);
  }
  const queue = (state: GameState, summoned: string, chain: string) =>
    checkAndQueueOracleChoices(state, summoned, "summon", getDef, chain);

  it("候補の列挙では消費せず、使用枠は空のまま(辞退も同じ)", () => {
    const before = scenario();
    const queued = queue(before, "sp-a", "test:i09:enumerate");
    expect(pendingsOf(queued, "oracle", "x01")).toHaveLength(1);
    // 使用枠の状態(buckets/operations)は一切変わらない。
    expect(queued.effectAccounting).toEqual(before.effectAccounting);
    expect(oracleTriggerUsage(queued, "x01", "summon", getDef)).toMatchObject({
      used: 0,
      allowed: true,
    });

    const pendingId = pendingsOf(queued, "oracle", "x01")[0]!.pendingId;
    const declined = resolvePending(queued, getDef, pendingId, false);
    expect(pendingsOf(declined, "oracle", "x01")).toHaveLength(0);
    expect(declined.effectAccounting).toEqual(before.effectAccounting);
    expect(oracleTriggerUsage(declined, "x01", "summon", getDef)).toMatchObject(
      {
        used: 0,
        allowed: true,
      }
    );
  });

  it("予約は実際の保留処理に紐付く: 未解決の間は重ねて積まず、辞退で予約が解除される(消費は起きない)", () => {
    const first = queue(scenario(), "sp-a", "test:i09:reserve-1");
    const second = queue(first, "sp-b", "test:i09:reserve-2");
    const reserved = pendingsOf(second, "oracle", "x01");
    expect(reserved).toHaveLength(1);
    expect(reserved[0]!.mechanic).toMatchObject({
      triggerCardInstanceId: "sp-a",
    });
    // 予約は使用枠に現れない。
    expect(second.effectAccounting).toEqual(scenario().effectAccounting);

    const declined = resolvePending(
      second,
      getDef,
      reserved[0]!.pendingId,
      false
    );
    const requeued = queue(declined, "sp-b", "test:i09:reserve-3");
    const next = pendingsOf(requeued, "oracle", "x01");
    expect(next).toHaveLength(1);
    expect(next[0]!.mechanic).toMatchObject({ triggerCardInstanceId: "sp-b" });
  });

  it("受諾して神託を行った時点で消費し、同じステップでは候補を積まず、ステップが変われば再び行える", () => {
    const queued = queue(scenario(), "sp-a", "test:i09:accept");
    const pendingId = pendingsOf(queued, "oracle", "x01")[0]!.pendingId;
    const accepted = resolvePending(queued, getDef, pendingId, true);
    // 神託を行った結果(コア+1)と消費は同時。
    expect(
      accepted.cardInstances.find((card) => card.instanceId === "x01")
        ?.normalCoreCount
    ).toBe(1);
    expect(oracleTriggerUsage(accepted, "x01", "summon", getDef)).toEqual({
      limit: 1,
      used: 1,
      remaining: 0,
      allowed: false,
    });
    expect(listEffectUsage(accepted)).toContainEqual(
      expect.objectContaining({
        share: "instance",
        period: "step",
        sourceInstanceId: "x01",
        playerId: ALICE,
        amount: 1,
      })
    );
    // 同じステップでは新しい召喚でも候補を積まない。
    expect(
      pendingsOf(queue(accepted, "sp-b", "test:i09:accept-2"), "oracle", "x01")
    ).toHaveLength(0);

    // 期間IDは進行文脈(ステップ序数)から決まる。ステップが変われば別の枠で、再び神託を行える。
    const nextStep: GameState = {
      ...accepted,
      stepOrdinalThisTurn: accepted.stepOrdinalThisTurn + 1,
    };
    expect(oracleTriggerUsage(nextStep, "x01", "summon", getDef)).toMatchObject(
      {
        used: 0,
        allowed: true,
      }
    );
    expect(
      pendingsOf(queue(nextStep, "sp-b", "test:i09:accept-3"), "oracle", "x01")
    ).toHaveLength(1);
  });

  it("枠は発揮元の個体ごとで、召喚/煌臨以外のトリガーには適用しない", () => {
    const state = baseState([
      createCardInstance(x01, {
        instanceId: "x01-a",
        ownerPlayerId: ALICE,
        zone: "field",
      }),
      createCardInstance(x01, {
        instanceId: "x01-b",
        ownerPlayerId: ALICE,
        zone: "field",
      }),
    ]);
    const usedA = seedOracleTriggerUsage(state, "x01-a", "summon", getDef);
    expect(oracleTriggerUsage(usedA, "x01-a", "advent", getDef)).toMatchObject({
      used: 1,
      allowed: false,
    });
    expect(oracleTriggerUsage(usedA, "x01-b", "summon", getDef)).toMatchObject({
      used: 0,
      allowed: true,
    });
    expect(oracleTriggerUsage(usedA, "x01-a", "place", getDef)).toBeUndefined();
  });
});

describe("V10 I09: 配置時神託(BSTH02.7-CX01 ターンに1回:同名)", () => {
  const cx01 = REAL.get("BSTH02.7-CX01")!;
  const filler = REAL.get("BSES01-C04")!;
  const getDef = (id: string) => REAL.get(id);

  function scenario(options: { sameNameCopies?: boolean } = {}) {
    const nexus = (instanceId: string, owner = ALICE) =>
      createCardInstance(cx01, {
        instanceId,
        ownerPlayerId: owner,
        zone: "field",
      });
    const deck = (owner: string) =>
      Array.from({ length: 4 }, (_, index) =>
        createCardInstance(filler, {
          instanceId: `${owner}-deck-${index}`,
          ownerPlayerId: owner,
          zone: "deck",
        })
      );
    const state = baseState([
      nexus("cx01-a"),
      ...(options.sameNameCopies ? [nexus("cx01-b")] : []),
      nexus("bob-cx01", BOB),
      ...deck(ALICE),
      ...deck(BOB),
    ]);
    return {
      ...state,
      players: state.players.map((player) => ({ ...player, deckCount: 4 })),
    };
  }
  const queue = (state: GameState, id: string, chain: string) =>
    checkAndQueuePlacementOracle(state, id, getDef, chain);

  it("候補の列挙では消費せず、辞退でも消費しない(デッキも温存される)", () => {
    const before = scenario();
    const queued = queue(before, "cx01-a", "test:i09:placement-enumerate");
    expect(pendingsOf(queued, "placement_oracle", "cx01-a")).toHaveLength(1);
    expect(queued.effectAccounting).toEqual(before.effectAccounting);
    expect(placementOracleUsage(queued, "cx01-a", getDef)).toMatchObject({
      used: 0,
      allowed: true,
    });

    const declined = resolvePending(
      queued,
      getDef,
      pendingsOf(queued, "placement_oracle", "cx01-a")[0]!.pendingId,
      false
    );
    expect(declined.effectAccounting).toEqual(before.effectAccounting);
    expect(
      declined.cardInstances.filter(
        (card) => card.zone === "deck" && card.ownerPlayerId === ALICE
      )
    ).toHaveLength(4);
    expect(placementOracleUsage(declined, "cx01-a", getDef)).toMatchObject({
      used: 0,
      allowed: true,
    });
  });

  it("予約は未解決の同名の配置時神託に紐付き、使用枠には現れない。辞退で解除されると同名の別個体が積める", () => {
    const first = queue(
      scenario({ sameNameCopies: true }),
      "cx01-a",
      "test:i09:placement-reserve-1"
    );
    const second = queue(first, "cx01-b", "test:i09:placement-reserve-2");
    expect(pendingsOf(second, "placement_oracle")).toHaveLength(1);
    expect(second.effectAccounting).toEqual(
      scenario({ sameNameCopies: true }).effectAccounting
    );

    const declined = resolvePending(
      second,
      getDef,
      pendingsOf(second, "placement_oracle")[0]!.pendingId,
      false
    );
    const requeued = queue(declined, "cx01-b", "test:i09:placement-reserve-3");
    expect(pendingsOf(requeued, "placement_oracle", "cx01-b")).toHaveLength(1);
  });

  it("解決(デッキ上をトラッシュへ置く)の時点で消費し、同名の別個体と通常/復活の再配置は同じ枠を共有する", () => {
    const queued = queue(
      scenario({ sameNameCopies: true }),
      "cx01-a",
      "test:i09:placement-consume"
    );
    const resolved = resolvePlacementOracleMechanic(
      queued,
      { kind: "placement_oracle", grandwalkerInstanceId: "cx01-a" },
      getDef
    );
    expect(
      resolved.cardInstances.filter(
        (card) => card.zone === "deck" && card.ownerPlayerId === ALICE
      )
    ).toHaveLength(1);
    expect(placementOracleUsage(resolved, "cx01-a", getDef)).toEqual({
      limit: 1,
      used: 1,
      remaining: 0,
      allowed: false,
    });
    expect(listEffectUsage(resolved)).toContainEqual(
      expect.objectContaining({
        share: "card_name",
        period: "turn",
        nameKey: cx01.name,
        playerId: ALICE,
        amount: 1,
      })
    );
    // 同名の別個体(通常配置・復活配置どちらでも)は同じ枠を使い切っているので候補を積まない。
    const again = queue(
      { ...resolved, pendingTriggeredEffects: [] },
      "cx01-b",
      "test:i09:placement-consume-2"
    );
    expect(pendingsOf(again, "placement_oracle")).toHaveLength(0);
    expect(placementOracleUsage(again, "cx01-b", getDef)).toMatchObject({
      used: 1,
      allowed: false,
    });
    // 既に積まれていた候補を後から解決しても二重に消費せず、デッキも置かない。
    const stale = resolvePlacementOracleMechanic(
      resolved,
      { kind: "placement_oracle", grandwalkerInstanceId: "cx01-b" },
      getDef
    );
    expect(placementOracleUsage(stale, "cx01-b", getDef)).toMatchObject({
      used: 1,
    });
    expect(
      stale.cardInstances.filter(
        (card) => card.zone === "deck" && card.ownerPlayerId === ALICE
      )
    ).toHaveLength(1);
  });

  it("枠は使用者ごとに独立し、次のターンには再び使える(時計だけで期限が決まる)", () => {
    const resolved = resolvePlacementOracleMechanic(
      queue(scenario(), "cx01-a", "test:i09:placement-owner"),
      { kind: "placement_oracle", grandwalkerInstanceId: "cx01-a" },
      getDef
    );
    expect(placementOracleUsage(resolved, "bob-cx01", getDef)).toMatchObject({
      used: 0,
      allowed: true,
    });
    expect(
      pendingsOf(
        queue(resolved, "bob-cx01", "test:i09:placement-owner-2"),
        "placement_oracle",
        "bob-cx01"
      )
    ).toHaveLength(1);
    expect(
      placementOracleUsage(
        { ...resolved, turnNumber: resolved.turnNumber + 1 },
        "cx01-a",
        getDef
      )
    ).toMatchObject({ used: 0, allowed: true });
  });
});
