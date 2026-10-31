/**
 * engine-generic-effect-activation-causal-trigger cluster (a) Step2:
 * causal-tracking 層 — host 自身の効果解決 (destroy/vanish) が引き起こした
 * pending leave を、明示 stepId 参照 (`{kind:"ref"}`) 無しで追跡・選択的に
 * 抑制できるようにする primitive。
 *
 * 既存 `suppress_pending_leave_effects` action の `target:{kind:"ref",stepId}` は
 * 同一 effect 内の「特定 1 step が解決した対象」しか指せない (BSTH02.7.ts:2246-2254
 * destroy_bp0 の実例)。本 primitive は PendingLeaveEntity に
 * `causedByEffectSourceInstanceId` (destroy/vanish 実行時の sourceInstanceId) を
 * 記録し、新設 TargetSpec `{kind:"pending_leave_caused_by_effect_source"}` で
 * 「現在解決中の効果 (自分自身) が引き起こした pending leave すべて」を、
 * 複数 step / 複数対象にまたがっても一括で拾えるようにする
 * (着地確認カード: BSGE01-R02 【毒牙：モルター】effects[3])。
 *
 * BSGE01-R02/BSTH02.7-X01 の card-data 配線・GUI/legal-actions 側の支払い選択
 * (「自分のカウント-1することで」) は後続ステップで行う。本ステップは
 * データ層 (causal tag) + 汎用 target 解決 + 既存 suppress action との
 * 配線までを primitive として確立する。
 */
import { describe, it, expect } from "vitest";
import {
  createCardInstance,
  createEmptyGameState,
  executeDestroy,
  executeVanish,
  executeRemoveFromGame,
  executeEffect,
} from "../src";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { resolveTargetSpec } from "../src/effect/target-resolution";
import { createStepExecutionContext } from "../src/step-execution-context";
import { queuePendingLeave } from "../src/state-based-actions";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "alice";
const BOB = "bob";

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "テストスピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "星竜",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

function makeInstance(
  def: CardDefinition,
  overrides: Partial<CardInstance> = {}
): CardInstance {
  const base = createCardInstance(def, {
    ownerPlayerId: overrides.ownerPlayerId ?? ALICE,
    zone: "field",
    cores: 1,
  });
  return { ...base, ...overrides };
}

function makeState(cards: CardInstance[]): GameState {
  return createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: cards,
    startingLife: 5,
  });
}

const defRegistry = new Map<string, CardDefinition>();
function getDef(id: string): CardDefinition | undefined {
  return defRegistry.get(id);
}
function registerDef(def: CardDefinition): void {
  defRegistry.set(def.cardNo, def);
}

describe("PendingLeaveEntity.causedByEffectSourceInstanceId (causal tag)", () => {
  it("executeDestroy: sourceInstanceId を causedByEffectSourceInstanceId としてタグ付けする", () => {
    registerDef(makeDef({ cardNo: "TGT-001" }));
    const target = makeInstance(getDef("TGT-001")!, {
      instanceId: "tgt-1",
      ownerPlayerId: BOB,
    });
    const state = makeState([target]);

    const result = executeDestroy(
      state,
      ALICE,
      { player: "opponent", filter: { category: ["spirit"] }, count: -1 },
      getDef,
      "host-src-1"
    );

    const pendingLeave = result.pendingLeaveEntities.find(
      (p) => p.instanceId === "tgt-1"
    );
    expect(pendingLeave?.causedByEffectSourceInstanceId).toBe("host-src-1");
  });

  it("executeDestroy: sourceInstanceId 省略時は null のまま (非効果経路の fail-closed)", () => {
    registerDef(makeDef({ cardNo: "TGT-002" }));
    const target = makeInstance(getDef("TGT-002")!, {
      instanceId: "tgt-2",
      ownerPlayerId: BOB,
    });
    const state = makeState([target]);

    const result = executeDestroy(
      state,
      ALICE,
      {
        player: "opponent",
        filter: { category: ["spirit"] },
        count: -1,
      },
      getDef
    );

    const pendingLeave = result.pendingLeaveEntities.find(
      (p) => p.instanceId === "tgt-2"
    );
    expect(pendingLeave?.causedByEffectSourceInstanceId ?? null).toBeNull();
  });

  it("executeVanish: sourceInstanceId を causedByEffectSourceInstanceId としてタグ付けする", () => {
    registerDef(makeDef({ cardNo: "TGT-003" }));
    const target = makeInstance(getDef("TGT-003")!, {
      instanceId: "tgt-3",
      ownerPlayerId: BOB,
    });
    const state = makeState([target]);

    const result = executeVanish(
      state,
      ALICE,
      { player: "opponent", filter: { category: ["spirit"] }, count: -1 },
      getDef,
      "host-src-2"
    );

    const pendingLeave = result.pendingLeaveEntities.find(
      (p) => p.instanceId === "tgt-3"
    );
    expect(pendingLeave?.causedByEffectSourceInstanceId).toBe("host-src-2");
  });

  it("executeRemoveFromGame: sourceInstanceId を causedByEffectSourceInstanceId としてタグ付けする", () => {
    registerDef(makeDef({ cardNo: "TGT-005" }));
    const target = makeInstance(getDef("TGT-005")!, {
      instanceId: "tgt-5",
      ownerPlayerId: BOB,
    });
    const state = makeState([target]);

    const result = executeRemoveFromGame(
      state,
      ALICE,
      {
        kind: "remove_from_game",
        target: {
          player: "opponent",
          filter: { category: ["spirit"] },
          count: -1,
        },
      },
      getDef,
      "host-src-4"
    );

    const pendingLeave = result.pendingLeaveEntities.find(
      (p) => p.instanceId === "tgt-5"
    );
    expect(pendingLeave?.causedByEffectSourceInstanceId).toBe("host-src-4");
  });

  it("実バトル source は effect causal tag と分離して保持する", () => {
    registerDef(makeDef({ cardNo: "TGT-BATTLE-001" }));
    const target = makeInstance(getDef("TGT-BATTLE-001")!, {
      instanceId: "tgt-battle-1",
      ownerPlayerId: BOB,
    });
    const state = makeState([target]);

    const result = queuePendingLeave({
      state,
      instanceId: "tgt-battle-1",
      kind: "destroy",
      cause: "battle",
      causePlayerId: ALICE,
      chainId: "battle-chain-1",
      causedByBattleSourceInstanceId: "battle-source-1",
    });

    const pendingLeave = result.pendingLeaveEntities.find(
      (p) => p.instanceId === "tgt-battle-1"
    );
    expect(pendingLeave?.causedByBattleSourceInstanceId).toBe(
      "battle-source-1"
    );
    expect(pendingLeave?.causedByBattleSourceInstanceIds).toEqual([
      "battle-source-1",
    ]);
    expect(pendingLeave?.causedByEffectSourceInstanceId ?? null).toBeNull();
  });
});

describe("TargetSpec kind:pending_leave_caused_by_effect_source (target 解決)", () => {
  it("同一 sourceInstanceId が引き起こした pending leave のみ解決し、別 host 由来は除外する", () => {
    registerDef(makeDef({ cardNo: "TGT-004" }));
    const causedByHost = makeInstance(getDef("TGT-004")!, {
      instanceId: "tgt-caused",
      ownerPlayerId: BOB,
      pendingLeaveKind: "destroy",
    });
    const causedByOther = makeInstance(getDef("TGT-004")!, {
      instanceId: "tgt-other",
      ownerPlayerId: BOB,
      pendingLeaveKind: "destroy",
    });
    let state = makeState([causedByHost, causedByOther]);
    state = {
      ...state,
      pendingLeaveEntities: [
        {
          instanceId: "tgt-caused",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: ALICE,
          chainId: "chain-1",
          deferZoneMoveUntilChainEnd: false,
          causedByEffectSourceInstanceId: "host-src-3",
        },
        {
          instanceId: "tgt-other",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: ALICE,
          chainId: "chain-2",
          deferZoneMoveUntilChainEnd: false,
          causedByEffectSourceInstanceId: "some-other-host",
        },
      ],
    };

    const stepCtx = createStepExecutionContext();
    const resolved = resolveTargetSpec({
      state,
      targetSpec: { kind: "pending_leave_caused_by_effect_source" },
      actingPlayerId: ALICE,
      sourceInstanceId: "host-src-3",
      getCardDefinitionById: getDef,
      stepContext: stepCtx,
    });

    expect(resolved.map((c) => c.instanceId)).toEqual(["tgt-caused"]);
  });

  it("該当する pending leave が無ければ空配列を返す", () => {
    const state = makeState([]);
    const stepCtx = createStepExecutionContext();
    const resolved = resolveTargetSpec({
      state,
      targetSpec: { kind: "pending_leave_caused_by_effect_source" },
      actingPlayerId: ALICE,
      sourceInstanceId: "host-src-none",
      getCardDefinitionById: getDef,
      stepContext: stepCtx,
    });
    expect(resolved).toEqual([]);
  });
});

describe("suppress_pending_leave_effects + pending_leave_caused_by_effect_source (end-to-end)", () => {
  it("複数 destroy step にまたがる離脱を、明示 stepId 参照無しで一括抑制する (ref の同一 step 限定を超える)", () => {
    const sourceDef = makeDef({ cardNo: "SRC-CAUSAL-001" });
    const targetDef = makeDef({
      cardNo: "TGT-CAUSAL-001",
      colors: ["blue"],
      symbolColors: ["blue"],
    });
    registerDef(sourceDef);
    registerDef(targetDef);
    const source = makeInstance(sourceDef, {
      instanceId: "src-causal-1",
      ownerPlayerId: ALICE,
    });
    const targetA = makeInstance(targetDef, {
      instanceId: "tgt-causal-a",
      ownerPlayerId: BOB,
    });
    const targetB = makeInstance(targetDef, {
      instanceId: "tgt-causal-b",
      ownerPlayerId: BOB,
    });
    const state = makeState([source, targetA, targetB]);

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
              zone: "field",
            },
          },
        },
        {
          connector: "simultaneous",
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
              zone: "field",
            },
          },
        },
        {
          connector: "simultaneous",
          action: {
            kind: "suppress_pending_leave_effects",
            target: { kind: "pending_leave_caused_by_effect_source" },
            suppressDestroyedEffects: "destroyed_only",
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:pending-leave-causal-source-tracking:346",
      state,
      effect,
      sourceInstanceId: "src-causal-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const suppressedA = result.pendingLeaveEntities.find(
      (p) => p.instanceId === "tgt-causal-a"
    );
    const suppressedB = result.pendingLeaveEntities.find(
      (p) => p.instanceId === "tgt-causal-b"
    );
    expect(suppressedA?.suppressDestroyedEffects).toBe("destroyed_only");
    expect(suppressedB?.suppressDestroyedEffects).toBe("destroyed_only");
  });

  it("自分の効果解決由来の離脱に紐づく leave_field 誘発効果を、after_triggers flush 後も発揮させない", () => {
    const sourceDef = makeDef({ cardNo: "SRC-CAUSAL-002" });
    const targetDef = makeDef({
      cardNo: "TGT-CAUSAL-002",
      colors: ["blue"],
      symbolColors: ["blue"],
      effects: [
        {
          timing: { kind: "card_event", event: "leave_field" },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 3 } },
          ],
        },
      ],
    });
    registerDef(sourceDef);
    registerDef(targetDef);
    const source = makeInstance(sourceDef, {
      instanceId: "src-causal-2",
      ownerPlayerId: ALICE,
    });
    const target = makeInstance(targetDef, {
      instanceId: "tgt-causal-2",
      ownerPlayerId: BOB,
    });
    const state = makeState([source, target]);

    const pendingBefore = state.pendingTriggeredEffects.length;

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              count: 1,
              filter: { category: ["spirit"] },
            },
          },
        },
        {
          connector: "simultaneous",
          action: {
            kind: "suppress_pending_leave_effects",
            target: { kind: "pending_leave_caused_by_effect_source" },
            suppressDestroyedEffects: "destroyed_only",
          },
        },
        {
          connector: "after_triggers",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:pending-leave-causal-source-tracking:422",
      state,
      effect,
      sourceInstanceId: "src-causal-2",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        sourceDef,
        targetDef,
      ]),
    });

    // 抑制無しの baseline (after-triggers-connector.test.ts 同型ケース) では
    // pendingTriggeredEffects が増えるが、本ケースは事前抑制済のため増えない。
    expect(result.pendingTriggeredEffects.length).toBe(pendingBefore);
  });
});

describe("pay_cost 経由のコスト支払い消滅の causal tag (Step3)", () => {
  it("pay_cost action で自分のフィールドカードから支払い、コア不足消滅した対象に causedByEffectSourceInstanceId を付与する", () => {
    const sourceDef = makeDef({ cardNo: "SRC-PAYCOST-001" });
    const victimDef = makeDef({
      cardNo: "TGT-PAYCOST-001",
      colors: ["blue"],
      symbolColors: ["blue"],
    });
    registerDef(sourceDef);
    registerDef(victimDef);
    const source = makeInstance(sourceDef, {
      instanceId: "src-paycost-1",
      ownerPlayerId: ALICE,
    });
    // levelDefs[0].requiredCores=1 → minimumRequiredCores=1、cores:1 で丁度最低値。
    const victim = makeInstance(victimDef, {
      instanceId: "tgt-paycost-1",
      ownerPlayerId: ALICE,
    });
    const state = makeState([source, victim]);

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [{ action: { kind: "pay_cost", amount: 1 } }],
    };

    const result = executeEffect({
      chainId: "test:pending-leave-causal-source-tracking:466",
      state,
      effect,
      sourceInstanceId: "src-paycost-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      payCostPaymentSources: [
        { kind: "card", instanceId: "tgt-paycost-1", amount: 1 },
      ],
    });

    const victimPendingLeave = result.pendingLeaveEntities.find(
      (p) => p.instanceId === "tgt-paycost-1"
    );
    expect(victimPendingLeave?.kind).toBe("vanish");
    expect(victimPendingLeave?.cause).toBe("cost_payment");
    expect(victimPendingLeave?.causedByEffectSourceInstanceId).toBe(
      "src-paycost-1"
    );
  });

  it("HUDの支払い待ちは盤面を変えず、選択後の支払い消滅にも効果の発揮元を記録する", () => {
    const sourceDef = makeDef({
      cardNo: "SRC-PAYCOST-002",
      levelDefs: [{ level: 1, requiredCores: 0, bp: 3000 }],
    });
    const victimDef = makeDef({ cardNo: "TGT-PAYCOST-002" });
    registerDef(sourceDef);
    registerDef(victimDef);
    const source = makeInstance(sourceDef, {
      instanceId: "src-paycost-2",
      ownerPlayerId: ALICE,
      normalCoreCount: 0,
    });
    const victim = makeInstance(victimDef, {
      instanceId: "tgt-paycost-2",
      ownerPlayerId: ALICE,
    });
    const base = makeState([source, victim]);
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === ALICE ? { ...p, reserveNormalCoreCount: 1 } : p
      ),
    };
    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [{ action: { kind: "pay_cost", amount: 1 } }],
    };
    const options = {
      chainId: "test:pay-cost-source-allocation",
      state,
      effect,
      sourceInstanceId: source.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      allowPendingPayCostSourceAllocation: true,
    };
    const waiting = executeEffect(options);
    expect(waiting.pendingCoreSourceAllocation?.requiredTotal).toBe(1);
    expect(
      waiting.cardInstances.find((c) => c.instanceId === victim.instanceId)
        ?.normalCoreCount
    ).toBe(1);
    expect(waiting.pendingLeaveEntities).toHaveLength(0);

    // 配分選択後に再実行されるpay_costプリミティブを、finalize前の状態で検証する。
    const paid = executeEffect({
      chainId: "test:pending-leave-causal-source-tracking:532",
      ...options,
      coreSourceAllocations: { [victim.instanceId]: 1 },
    });
    expect(
      paid.cardInstances.find((c) => c.instanceId === victim.instanceId)
        ?.normalCoreCount
    ).toBe(0);
    expect(
      paid.pendingLeaveEntities.find((p) => p.instanceId === victim.instanceId)
    ).toMatchObject({
      kind: "vanish",
      cause: "cost_payment",
      causedByEffectSourceInstanceId: source.instanceId,
    });
  });
});
