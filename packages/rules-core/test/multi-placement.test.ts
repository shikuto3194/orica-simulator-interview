/**
 * P3-49 placement_multi: 複数体同時召喚の per-target 配置選択。
 *
 * ケース:
 * 1. count >= 2 + paymentSources で executeSummon が pendingMultiPlacement を生成
 * 2. resolve_pending_multi_placement で per-target 配置を適用
 * 3. min cores 不足は throw
 * 4. abort で priorStateSnapshot に巻き戻す
 * 5. continuation: 後続 step が resolve 後に走る
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  executeEndAttackStep,
  finalizePendingAttackStepEndFinalizations,
} from "../src/effect/structured-effect-interpreter";
import { collectTriggerEventsFromStateDelta } from "../src/effect/trigger-system";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { resumeStackCascadeIfReady } from "../src/legal/stack-resolution-core";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { applyCardCostPayments } from "../src/core/payment-system";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "player-1";
const BOB = "player-2";

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-001",
    name: "Test",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "テスト",
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
    ownerPlayerId: ALICE,
    zone: "trash",
    cores: 0,
  });
  return { ...base, ...overrides };
}

function makeState(cards: CardInstance[], aliceReserve = 0): GameState {
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: cards,
    startingLife: 5,
  });
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === ALICE ? { ...p, reserveNormalCoreCount: aliceReserve } : p
    ),
  };
}

const defRegistry = new Map<string, CardDefinition>();
function getDef(id: string): CardDefinition | undefined {
  return defRegistry.get(id);
}
function registerDef(def: CardDefinition): void {
  defRegistry.set(def.cardNo, def);
}

describe("P3-49 placement_multi", () => {
  it("count=2 + paymentSources で pendingMultiPlacement を生成 (cards=field cores=0, cost 支払い済)", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST" });
    const summonedDef = makeDef({
      cardNo: "SUMMONED",
      cost: 2,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    });
    registerDef(hostDef);
    registerDef(summonedDef);

    const host = makeInstance(hostDef, {
      instanceId: "host",
      zone: "field",
    });
    const a = makeInstance(summonedDef, { instanceId: "a", zone: "trash" });
    const b = makeInstance(summonedDef, { instanceId: "b", zone: "trash" });
    const state = makeState([host, a, b], 6);

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: "trash",
              filter: { category: ["spirit"] },
              count: 2,
            },
            costModifier: { fixedPayment: 1 }, // 各 1 cost、合計 2
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:multi-placement:121",
      state,
      effect,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      summonPaymentSources: [{ kind: "reserve", amount: 2 }],
    });

    expect(result.pendingMultiPlacement).not.toBeNull();
    const pending = result.pendingMultiPlacement!;
    expect(pending.targets.length).toBe(2);
    expect(pending.targets.map((t) => t.instanceId).sort()).toEqual(["a", "b"]);
    // 各 target は min=1 (levelDefs[0].requiredCores)
    for (const t of pending.targets) {
      expect(t.minimumCoreCount).toBe(1);
    }
    // 各 card は field cores=0 で配置済
    const aAfter = result.cardInstances.find((c) => c.instanceId === "a")!;
    const bAfter = result.cardInstances.find((c) => c.instanceId === "b")!;
    expect(aAfter.zone).toBe("field");
    expect(aAfter.normalCoreCount).toBe(0);
    expect(bAfter.zone).toBe("field");
    expect(bAfter.normalCoreCount).toBe(0);
    // cost 支払い済: reserve 6 - 2 = 4
    const alice = result.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(4);
  });

  it("costModifier=free の複数体効果召喚は paymentSources 未指定でも pendingMultiPlacement を生成する", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST_FREE_MULTI" });
    const summonedDef = makeDef({
      cardNo: "SUMMONED_FREE_MULTI",
      cost: 2,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    });
    registerDef(hostDef);
    registerDef(summonedDef);
    const triggeredLookup = buildTriggeredEffectLookup([hostDef, summonedDef]);

    const host = makeInstance(hostDef, {
      instanceId: "host",
      zone: "field",
      normalCoreCount: 1,
    });
    const a = makeInstance(summonedDef, { instanceId: "a", zone: "hand" });
    const b = makeInstance(summonedDef, { instanceId: "b", zone: "hand" });
    const state = makeState([host, a, b], 2);

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: "hand",
              filter: { category: ["spirit"] },
              count: 2,
            },
            costModifier: "free",
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:multi-placement:189",
      state,
      effect,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(result.pendingMultiPlacement).not.toBeNull();
    expect(
      result.pendingMultiPlacement?.targets.map((t) => t.instanceId)
    ).toEqual(["a", "b"]);
    expect(result.cardInstances.find((c) => c.instanceId === "a")?.zone).toBe(
      "field"
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "a")?.normalCoreCount
    ).toBe(0);
    expect(result.cardInstances.find((c) => c.instanceId === "b")?.zone).toBe(
      "field"
    );
    expect(
      result.cardInstances.find((c) => c.instanceId === "b")?.normalCoreCount
    ).toBe(0);
    expect(
      result.cardInstances.find((c) => c.instanceId === "host")?.normalCoreCount
    ).toBe(1);
    expect(
      result.players.find((p) => p.id === ALICE)?.reserveNormalCoreCount
    ).toBe(2);
  });

  it("単体の効果召喚も自動配置せず pendingMultiPlacement を生成する", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST_SINGLE" });
    const summonedDef = makeDef({
      cardNo: "SUMMONED_SINGLE",
      cost: 2,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    });
    registerDef(hostDef);
    registerDef(summonedDef);
    const triggeredLookup = buildTriggeredEffectLookup([hostDef, summonedDef]);

    const host = makeInstance(hostDef, {
      instanceId: "host",
      zone: "field",
      normalCoreCount: 1,
    });
    const summoned = makeInstance(summonedDef, {
      instanceId: "summoned",
      zone: "hand",
    });
    const state = makeState([host, summoned], 2);
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: "hand",
              filter: { category: ["spirit"] },
              count: 1,
            },
            costModifier: "free",
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:multi-placement:262",
      state,
      effect,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    expect(result.pendingMultiPlacement).not.toBeNull();
    expect(result.pendingMultiPlacement?.targets).toEqual([
      expect.objectContaining({
        instanceId: "summoned",
        minimumCoreCount: 1,
        enterFieldEventKind: "summon",
      }),
    ]);
    expect(
      result.cardInstances.find((c) => c.instanceId === "summoned")
        ?.normalCoreCount
    ).toBe(0);

    const action = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((act) => act.kind === "resolve_pending_multi_placement");
    expect(action).toBeDefined();

    const applied = applyLegalAction({
      state: result,
      action: action!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      multiPlacementAllocations: [
        {
          destinationInstanceId: "summoned",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    }).state;
    const events = collectTriggerEventsFromStateDelta({
      beforeState: state,
      afterState: applied,
      source: "action_resolution",
    });
    expect(
      events.find(
        (event) =>
          event.relatedInstanceId === "summoned" && event.eventKind === "summon"
      )
    ).toBeDefined();
  });

  it("通常ネクサスを効果で場に出す場合は summon ではなく place の配置選択を出す", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST_NEXUS" });
    const nexusDef = makeDef({
      cardNo: "NORMAL_NEXUS",
      printedCategory: "nexus",
      cost: 2,
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
    });
    registerDef(hostDef);
    registerDef(nexusDef);
    const triggeredLookup = buildTriggeredEffectLookup([hostDef, nexusDef]);

    const host = makeInstance(hostDef, {
      instanceId: "host",
      zone: "field",
      normalCoreCount: 1,
    });
    const nexus = makeInstance(nexusDef, {
      instanceId: "nexus",
      zone: "hand",
    });
    const state = makeState([host, nexus], 2);
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: "hand",
              filter: { category: ["nexus"] },
              count: 1,
            },
            costModifier: "free",
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:multi-placement:357",
      state,
      effect,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(result.pendingMultiPlacement).not.toBeNull();
    expect(result.pendingMultiPlacement?.targets).toEqual([
      expect.objectContaining({
        instanceId: "nexus",
        minimumCoreCount: 0,
        maximumCoreCount: null,
        enterFieldEventKind: "place",
      }),
    ]);

    const action = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((act) => act.kind === "resolve_pending_multi_placement");
    expect(action).toBeDefined();

    const applied = applyLegalAction({
      state: result,
      action: action!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      multiPlacementAllocations: [],
    }).state;
    const events = collectTriggerEventsFromStateDelta({
      beforeState: state,
      afterState: applied,
      source: "action_resolution",
    });
    expect(
      events.find(
        (event) =>
          event.relatedInstanceId === "nexus" && event.eventKind === "place"
      )
    ).toBeDefined();
    expect(
      events.find(
        (event) =>
          event.relatedInstanceId === "nexus" && event.eventKind === "summon"
      )
    ).toBeUndefined();
  });

  it("card_event(put)+effectScope:genkai は通常の put を拾わず scoped put だけ拾う", () => {
    const runPutEffect = (effectScope?: "genkai"): GameState => {
      defRegistry.clear();
      const hostDef = makeDef({ cardNo: `HOST_PUT_${effectScope ?? "plain"}` });
      const targetDef = makeDef({
        cardNo: `TARGET_PUT_${effectScope ?? "plain"}`,
        effects: [
          {
            timing: {
              kind: "card_event",
              event: "put",
              effectScope: "genkai",
            },
            executionMode: "optional",
            steps: [
              {
                action: { kind: "count_increase", player: "self", amount: 1 },
              },
            ],
          },
        ],
      });
      registerDef(hostDef);
      registerDef(targetDef);
      const triggeredLookup = buildTriggeredEffectLookup([hostDef, targetDef]);
      const host = makeInstance(hostDef, {
        instanceId: `host-${effectScope ?? "plain"}`,
        zone: "field",
        normalCoreCount: 1,
      });
      const target = makeInstance(targetDef, {
        instanceId: `target-${effectScope ?? "plain"}`,
        zone: "hand",
      });
      const state = makeState([host, target], 2);
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "put",
              target: {
                kind: "from_zone",
                zone: "hand",
                filter: { category: ["spirit"] },
                count: 1,
              },
              costModifier: "free",
              ...(effectScope !== undefined ? { effectScope } : {}),
            },
          },
        ],
      };

      const pendingPlacementState = executeEffect({
        chainId: "test:multi-placement:464",
        state,
        effect,
        sourceInstanceId: host.instanceId,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      });
      const action = getLegalActions({
        state: pendingPlacementState,
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      }).find((act) => act.kind === "resolve_pending_multi_placement");
      expect(action).toBeDefined();

      return applyLegalAction({
        state: pendingPlacementState,
        action: action!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        multiPlacementAllocations: [
          {
            destinationInstanceId: target.instanceId,
            placements: [{ kind: "reserve_normal", amount: 1 }],
          },
        ],
      }).state;
    };

    const plainPut = runPutEffect();
    expect(
      plainPut.publicDisclosures
        ?.flatMap((entry) => entry.results)
        .filter(
          (result) =>
            result.instanceId === "target-plain" && result.kind === "card_move"
        )
    ).toEqual([expect.objectContaining({ actionLabel: "put", to: "field" })]);
    expect(
      plainPut.pendingTriggeredEffects.find(
        (pending) =>
          pending.relatedInstanceId === "target-plain" &&
          pending.eventKind === "put"
      )
    ).toBeUndefined();

    const genkaiPut = runPutEffect("genkai");
    expect(
      genkaiPut.publicDisclosures
        ?.flatMap((entry) => entry.results)
        .filter(
          (result) =>
            result.instanceId === "target-genkai" && result.kind === "card_move"
        )
    ).toEqual([
      expect.objectContaining({ actionLabel: "genkai", to: "field" }),
    ]);
    const pending = genkaiPut.pendingTriggeredEffects.find(
      (candidate) =>
        candidate.relatedInstanceId === "target-genkai" &&
        candidate.eventKind === "put"
    );
    expect(pending).toBeDefined();
    expect(pending!.effectScope).toBe("genkai");
    expect(pending!.event?.effectScope).toBe("genkai");
  });

  it("payment-mismatch で pending を立てずに log のみ残す", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST" });
    const summonedDef = makeDef({ cardNo: "SUMMONED", cost: 2 });
    registerDef(hostDef);
    registerDef(summonedDef);

    const host = makeInstance(hostDef, {
      instanceId: "host",
      zone: "field",
    });
    const a = makeInstance(summonedDef, { instanceId: "a", zone: "trash" });
    const b = makeInstance(summonedDef, { instanceId: "b", zone: "trash" });
    const state = makeState([host, a, b], 6);

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: "trash",
              filter: { category: ["spirit"] },
              count: 2,
            },
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:multi-placement:564",
      state,
      effect,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      summonPaymentSources: [{ kind: "reserve", amount: 1 }], // 期待 4 だが 1 しか払わない
    });

    expect(result.pendingMultiPlacement).toBeNull();
    expect(result.log.some((l) => l.includes("payment-mismatch"))).toBe(true);
  });

  it("resolve_pending_multi_placement で per-target 配置を適用", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST" });
    const summonedDef = makeDef({
      cardNo: "SUMMONED",
      cost: 2,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    });
    registerDef(hostDef);
    registerDef(summonedDef);

    const host = makeInstance(hostDef, {
      instanceId: "host",
      zone: "field",
    });
    const a = makeInstance(summonedDef, { instanceId: "a", zone: "trash" });
    const b = makeInstance(summonedDef, { instanceId: "b", zone: "trash" });
    const state = makeState([host, a, b], 6);

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: "trash",
              filter: { category: ["spirit"] },
              count: 2,
            },
            costModifier: { fixedPayment: 1 },
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:multi-placement:614",
      state,
      effect,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      summonPaymentSources: [{ kind: "reserve", amount: 2 }],
    });

    const actions = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const resolveAction = actions.find(
      (act) => act.kind === "resolve_pending_multi_placement"
    )!;
    expect(resolveAction).toBeDefined();

    const applied = applyLegalAction({
      state: result,
      action: resolveAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      multiPlacementAllocations: [
        {
          destinationInstanceId: "a",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
        {
          destinationInstanceId: "b",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    });

    expect(applied.state.pendingMultiPlacement).toBeNull();
    const aAfter = applied.state.cardInstances.find(
      (c) => c.instanceId === "a"
    )!;
    const bAfter = applied.state.cardInstances.find(
      (c) => c.instanceId === "b"
    )!;
    expect(aAfter.normalCoreCount).toBe(1);
    expect(bAfter.normalCoreCount).toBe(1);
    // reserve 4 (cost 後) - 2 (placement) = 2
    const alice = applied.state.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(2);
  });

  it("効果による複数体同時召喚は配置解決後に各 summon 誘発へ self_effect cause を付ける", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST" });
    const summonedDef = makeDef({
      cardNo: "SUMMONED",
      cost: 2,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      effects: [
        {
          timing: {
            kind: "card_event",
            event: "summon",
            cause: ["self_effect"],
          },
          executionMode: "optional",
          steps: [
            {
              action: { kind: "count_increase", player: "self", amount: 1 },
            },
          ],
        },
      ],
    });
    registerDef(hostDef);
    registerDef(summonedDef);
    const triggeredLookup = buildTriggeredEffectLookup([hostDef, summonedDef]);

    const host = makeInstance(hostDef, {
      instanceId: "host",
      zone: "field",
    });
    const a = makeInstance(summonedDef, { instanceId: "a", zone: "trash" });
    const b = makeInstance(summonedDef, { instanceId: "b", zone: "trash" });
    const state = makeState([host, a, b], 6);

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: "trash",
              filter: { category: ["spirit"] },
              count: 2,
            },
            costModifier: { fixedPayment: 1 },
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:multi-placement:717",
      state,
      effect,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      summonPaymentSources: [{ kind: "reserve", amount: 2 }],
    });

    const resolveAction = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).find((act) => act.kind === "resolve_pending_multi_placement");
    expect(resolveAction).toBeDefined();

    const applied = applyLegalAction({
      state: result,
      action: resolveAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      multiPlacementAllocations: [
        {
          destinationInstanceId: "a",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
        {
          destinationInstanceId: "b",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    }).state;

    const summonPendings = applied.pendingTriggeredEffects
      .filter((pending) => pending.eventKind === "summon")
      .sort((left, right) =>
        (left.relatedInstanceId ?? "").localeCompare(
          right.relatedInstanceId ?? ""
        )
      );
    expect(summonPendings).toHaveLength(2);
    expect(summonPendings.map((pending) => pending.relatedInstanceId)).toEqual([
      "a",
      "b",
    ]);
    expect(summonPendings.map((pending) => pending.cause)).toEqual([
      "self_effect",
      "self_effect",
    ]);
  });

  it("min を満たさない placement は throw", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST" });
    const summonedDef = makeDef({
      cardNo: "SUMMONED",
      cost: 2,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    });
    registerDef(hostDef);
    registerDef(summonedDef);

    const host = makeInstance(hostDef, {
      instanceId: "host",
      zone: "field",
    });
    const a = makeInstance(summonedDef, { instanceId: "a", zone: "trash" });
    const b = makeInstance(summonedDef, { instanceId: "b", zone: "trash" });
    const state = makeState([host, a, b], 6);

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: "trash",
              filter: { category: ["spirit"] },
              count: 2,
            },
            costModifier: { fixedPayment: 1 },
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:multi-placement:807",
      state,
      effect,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      summonPaymentSources: [{ kind: "reserve", amount: 2 }],
    });

    const actions = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const resolveAction = actions.find(
      (act) => act.kind === "resolve_pending_multi_placement"
    )!;

    // a に 1 コア (min 満たす) / b に未割り当て (min=1 不足) → throw
    expect(() =>
      applyLegalAction({
        state: result,
        action: resolveAction,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
        multiPlacementAllocations: [
          {
            destinationInstanceId: "a",
            placements: [{ kind: "reserve_normal", amount: 1 }],
          },
        ],
      })
    ).toThrow(/below minimum|requires at least/);
  });

  it("abort_pending_multi_placement で priorStateSnapshot に巻き戻す", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST" });
    const summonedDef = makeDef({
      cardNo: "SUMMONED",
      cost: 2,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    });
    registerDef(hostDef);
    registerDef(summonedDef);

    const host = makeInstance(hostDef, {
      instanceId: "host",
      zone: "field",
    });
    const a = makeInstance(summonedDef, { instanceId: "a", zone: "trash" });
    const b = makeInstance(summonedDef, { instanceId: "b", zone: "trash" });
    const state = makeState([host, a, b], 6);

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: "trash",
              filter: { category: ["spirit"] },
              count: 2,
            },
            costModifier: { fixedPayment: 1 },
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:multi-placement:879",
      state,
      effect,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      summonPaymentSources: [{ kind: "reserve", amount: 2 }],
    });

    const actions = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const abortAction = actions.find(
      (act) => act.kind === "abort_pending_multi_placement"
    )!;
    expect(abortAction).toBeDefined();

    const applied = applyLegalAction({
      state: result,
      action: abortAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    });

    expect(applied.state.pendingMultiPlacement).toBeNull();
    // 巻き戻り: card は trash に戻り、cores=0、reserve は元の 6
    const aAfter = applied.state.cardInstances.find(
      (c) => c.instanceId === "a"
    )!;
    const bAfter = applied.state.cardInstances.find(
      (c) => c.instanceId === "b"
    )!;
    expect(aAfter.zone).toBe("trash");
    expect(bAfter.zone).toBe("trash");
    const alice = applied.state.players.find((p) => p.id === ALICE)!;
    expect(alice.reserveNormalCoreCount).toBe(6);
    expect(applied.state.log.some((l) => l.includes("aborted"))).toBe(true);
  });

  it("abort は snapshot より後に積まれたバースト cascade を保持する", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST_ABORT_CASCADE" });
    const summonedDef = makeDef({
      cardNo: "SUMMONED_ABORT_CASCADE",
      cost: 2,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    });
    const burstDef = makeDef({
      cardNo: "BURST_ABORT_CASCADE",
      effects: [{ timing: { kind: "burst" }, steps: [] }],
    });
    registerDef(hostDef);
    registerDef(summonedDef);
    registerDef(burstDef);

    const host = makeInstance(hostDef, {
      instanceId: "host-abort-cascade",
      zone: "field",
      normalCoreCount: 1,
    });
    const summonedA = makeInstance(summonedDef, {
      instanceId: "summoned-abort-cascade-a",
      zone: "trash",
    });
    const summonedB = makeInstance(summonedDef, {
      instanceId: "summoned-abort-cascade-b",
      zone: "trash",
    });
    const burst = makeInstance(burstDef, {
      instanceId: "burst-abort-cascade",
      zone: "burst",
    });
    const initial = makeState([host, summonedA, summonedB, burst], 6);
    const generated = executeEffect({
      chainId: "test:multi-placement:954",
      state: initial,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "trash",
                filter: { category: ["spirit"] },
                count: 2,
              },
              costModifier: { fixedPayment: 1 },
            },
          },
        ],
      },
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      summonPaymentSources: [{ kind: "reserve", amount: 2 }],
    });
    const pending = generated.pendingMultiPlacement;
    expect(pending?.priorStateSnapshot).toBeDefined();

    const burstCheck = {
      checkId: "burst-check-after-abortable-placement",
      actingPlayerId: ALICE,
      eventKind: "hand_increase" as const,
      event: {
        family: "hand_increase" as const,
        validationMode: "snapshot_only" as const,
      },
      source: "action_resolution" as const,
      chainId: "chain:burst-check-after-abortable-placement",
      relatedPlayerId: BOB,
      amount: 2,
      step: "attack" as const,
      window: "declare_attack" as const,
      resolvedBurstCardInstanceIds: [],
      activationSelected: true,
    };
    const delayedBurstStack = {
      stackId: "stack:burst-after-abortable-placement",
      actionKind: "burst_activation" as const,
      chainId: "chain:burst-after-abortable-placement",
      actingPlayerId: ALICE,
      cardInstanceId: burst.instanceId,
      cardDefinitionId: burstDef.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: [],
      burstCheckId: burstCheck.checkId,
      burstPendingSnapshot: burstCheck,
      burstSourceKind: "spirit" as const,
      burstRegistrationIndex: 0,
      burstEffectDeclarationPending: true,
      burstEffectDeclarationPreviousWindow: "none" as const,
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    const getRegisteredBurstActions: NonNullable<
      Parameters<typeof applyLegalAction>[0]["getRegisteredBurstActions"]
    > = (cardNo) =>
      cardNo === burstDef.cardNo
        ? [{ sourceKind: "spirit", eventKind: "hand_increase" }]
        : [];
    const getHandWrittenEffectResolver: NonNullable<
      Parameters<typeof applyLegalAction>[0]["getHandWrittenEffectResolver"]
    > = (cardNo) =>
      cardNo === burstDef.cardNo
        ? (state) => ({
            ...state,
            log: [...state.log, "burst-abort-cascade:resolved"],
          })
        : undefined;
    const waitingState: GameState = {
      ...generated,
      pendingBurstChecks: [burstCheck],
      revealedBurstStates: [
        {
          playerId: ALICE,
          cardInstanceId: burst.instanceId,
          checkId: burstCheck.checkId,
        },
      ],
      pendingStackCascade: {
        remainingStacks: [delayedBurstStack],
        waitForTriggeredEffects: true,
      },
      pendingStackCascadeFlushGuardStacks: [delayedBurstStack],
      pendingMultiPlacement: {
        ...pending!,
        priorStateSnapshot: {
          ...pending!.priorStateSnapshot!,
          pendingBurstChecks: [burstCheck],
          revealedBurstStates: [
            {
              playerId: ALICE,
              cardInstanceId: burst.instanceId,
              checkId: burstCheck.checkId,
            },
          ],
          pendingStackCascade: null,
          pendingStackCascadeFlushGuardStacks: [delayedBurstStack],
        },
      },
    };

    // multi placement の入力完了前に burst の effect declaration を開くと、後続 abort の
    // snapshot restore がその stack window を捨て、selected burst check を孤立させる。
    // cascade は input を blocker として保持し、abort 完了後にだけ再開しなければならない。
    const blockedByMultiPlacement = resumeStackCascadeIfReady(waitingState, {
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    });
    expect(blockedByMultiPlacement.stackWindow).toBeNull();
    expect(
      blockedByMultiPlacement.pendingStackCascade?.remainingStacks
    ).toEqual([
      expect.objectContaining({
        actionKind: "burst_activation",
        burstEffectDeclarationPending: true,
        burstCheckId: burstCheck.checkId,
      }),
    ]);

    const abortAction = getLegalActions({
      state: blockedByMultiPlacement,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "abort_pending_multi_placement");
    expect(abortAction).toBeDefined();

    const aborted = applyLegalAction({
      state: blockedByMultiPlacement,
      action: abortAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    }).state;

    expect(aborted.pendingMultiPlacement).toBeNull();
    expect(aborted.stackWindow?.burstWindowKind).toBe("effect_declaration");
    expect(aborted.pendingStackCascade).toBeNull();
    expect(aborted.pendingStackCascadeFlushGuardStacks).toBeUndefined();

    let resolved = aborted;
    for (
      let guard = 0;
      guard < 4 && resolved.stackWindow !== null;
      guard += 1
    ) {
      const actingPlayerId = resolved.stackWindow.priorityPlayerId;
      const passAction = getLegalActions({
        state: resolved,
        actingPlayerId,
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredBurstActions,
      }).find((action) => action.kind === "pass_stack");
      expect(passAction).toBeDefined();
      resolved = applyLegalAction({
        state: resolved,
        action: passAction!,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions,
        getHandWrittenEffectResolver,
      }).state;
    }

    expect(resolved.stackWindow).toBeNull();
    expect(resolved.pendingBurstChecks).toHaveLength(0);
    expect(resolved.log).toContain("burst-abort-cascade:resolved");
    expect(
      resolved.cardInstances.find(
        (card) => card.instanceId === burst.instanceId
      )?.zone
    ).toBe("trash");
  });

  it("abort 後にコスト払いの離脱を flush し、deferred な任意トラッシュ追加を prompt 化する", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST_ABORT_STABLE_POINT" });
    const summonedDef = makeDef({
      cardNo: "SUMMONED_ABORT_STABLE_POINT",
      cost: 2,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    });
    const leaverDef = makeDef({
      cardNo: "LEAVER_ABORT_STABLE_POINT",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    });
    const optionalDef = makeDef({ cardNo: "OPTIONAL_ABORT_STABLE_POINT" });
    for (const definition of [hostDef, summonedDef, leaverDef, optionalDef]) {
      registerDef(definition);
    }

    const host = makeInstance(hostDef, {
      instanceId: "host-abort-stable-point",
      zone: "field",
      normalCoreCount: 1,
    });
    const summonedA = makeInstance(summonedDef, {
      instanceId: "summoned-abort-stable-point-a",
      zone: "trash",
    });
    const summonedB = makeInstance(summonedDef, {
      instanceId: "summoned-abort-stable-point-b",
      zone: "trash",
    });
    const leaver = makeInstance(leaverDef, {
      instanceId: "leaver-abort-stable-point",
      zone: "field",
      normalCoreCount: 1,
    });
    const optional = makeInstance(optionalDef, {
      instanceId: "optional-abort-stable-point",
      zone: "trash",
    });
    const initial = makeState(
      [host, summonedA, summonedB, leaver, optional],
      6
    );
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: "trash",
              filter: { category: ["spirit"] },
              count: 2,
            },
            costModifier: { fixedPayment: 1 },
          },
        },
      ],
    };
    const generated = executeEffect({
      chainId: "test:multi-placement:1200",
      state: initial,
      effect,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      summonPaymentSources: [{ kind: "reserve", amount: 2 }],
    });
    const pending = generated.pendingMultiPlacement!;
    const snapshotWithPendingLeave = applyCardCostPayments({
      state: pending.priorStateSnapshot!,
      actingPlayerId: ALICE,
      chainId: "outer:abort-stable-point",
      paymentSources: [
        { kind: "card", instanceId: leaver.instanceId, amount: 1 },
      ],
      getCardDefinitionById: getDef,
    });
    expect(snapshotWithPendingLeave.pendingLeaveEntities).toEqual([
      expect.objectContaining({
        instanceId: leaver.instanceId,
        kind: "vanish",
        cause: "cost_payment",
        deferZoneMoveUntilChainEnd: true,
      }),
    ]);
    const stranded: GameState = {
      ...generated,
      pendingMultiPlacement: {
        ...pending,
        priorStateSnapshot: {
          ...snapshotWithPendingLeave,
          pendingTrashOptionalAdds: [
            {
              actingPlayerId: ALICE,
              instanceIds: [optional.instanceId],
            },
          ],
        },
      },
    };

    const abortAction = getLegalActions({
      state: stranded,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "abort_pending_multi_placement");
    expect(abortAction).toBeDefined();

    const aborted = applyLegalAction({
      state: stranded,
      action: abortAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    expect(aborted.pendingMultiPlacement).toBeNull();
    expect(aborted.pendingLeaveEntities).toHaveLength(0);
    expect(
      aborted.cardInstances.find(
        (card) => card.instanceId === leaver.instanceId
      )?.zone
    ).toBe("trash");
    expect(aborted.pendingTrashOptionalAdds).toHaveLength(0);
    expect(aborted.pendingDeckReveal?.origin).toBe("trash");
    expect(aborted.pendingDeckReveal?.revealedAutoAddCandidateIds).toContain(
      optional.instanceId
    );
  });

  it("abort は snapshot 内の解決中 queue を復元せず、後続のアタックステップ終了を確定できる", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST_ABORT_QUEUE" });
    const summonedDef = makeDef({
      cardNo: "SUMMONED_ABORT_QUEUE",
      cost: 2,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    });
    registerDef(hostDef);
    registerDef(summonedDef);

    const host = makeInstance(hostDef, {
      instanceId: "host-abort-queue",
      zone: "field",
      normalCoreCount: 1,
    });
    const summonedA = makeInstance(summonedDef, {
      instanceId: "summoned-abort-queue-a",
      zone: "trash",
    });
    const summonedB = makeInstance(summonedDef, {
      instanceId: "summoned-abort-queue-b",
      zone: "trash",
    });
    const initial = makeState([host, summonedA, summonedB], 6);
    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: "trash",
              filter: { category: ["spirit"] },
              count: 2,
            },
            costModifier: { fixedPayment: 1 },
          },
        },
      ],
    };
    const generated = executeEffect({
      chainId: "test:multi-placement:1312",
      state: initial,
      effect,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      summonPaymentSources: [{ kind: "reserve", amount: 2 }],
    });
    const pending = generated.pendingMultiPlacement;
    expect(pending?.priorStateSnapshot).toBeDefined();

    const chainId = "hand-effect:host-abort-queue:0";
    const stateWithResolvingChain: GameState = {
      ...generated,
      pendingMultiPlacement: {
        ...pending!,
        priorStateSnapshot: {
          ...pending!.priorStateSnapshot!,
          effectQueueEntries: [
            {
              kind: "resolve",
              scope: "chain",
              stage: "main",
              chainId,
            },
          ],
          effectQueueSummary: [`resolve[chain:${chainId}]:main`],
        },
      },
    };
    const abortAction = getLegalActions({
      state: stateWithResolvingChain,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((action) => action.kind === "abort_pending_multi_placement");
    expect(abortAction).toBeDefined();

    const aborted = applyLegalAction({
      state: stateWithResolvingChain,
      action: abortAction!,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;

    expect(aborted.effectQueueEntries).toHaveLength(0);
    const finalized = finalizePendingAttackStepEndFinalizations(
      executeEndAttackStep({ ...aborted, step: "attack" }, ALICE),
      getDef
    );
    expect(finalized.step).toBe("end");
    expect(finalized.pendingAttackStepEndFinalizations).toHaveLength(0);
  });

  it("continuation: 後続 step (draw) が resolve 後に走る", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST_MULTI" });
    const summonedDef = makeDef({
      cardNo: "SUMMONED2",
      cost: 0,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    });
    registerDef(hostDef);
    registerDef(summonedDef);

    // 2 step effect: summon (count=2) + draw
    const stepEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "summon",
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: "trash",
              filter: { category: ["spirit"] },
              count: 2,
            },
            costModifier: "free",
          },
        },
        {
          id: "draw",
          action: { kind: "draw", count: 1 },
        },
      ],
    };
    hostDef.effects = [stepEffect];

    const host = makeInstance(hostDef, {
      instanceId: "host",
      zone: "field",
    });
    const a = makeInstance(summonedDef, { instanceId: "a", zone: "trash" });
    const b = makeInstance(summonedDef, { instanceId: "b", zone: "trash" });
    const state0 = makeState([host, a, b], 6);
    // deckCount を 5 にしておく
    const state: GameState = {
      ...state0,
      players: state0.players.map((p) =>
        p.id === ALICE ? { ...p, deckCount: 5 } : p
      ),
    };

    const result = executeEffect({
      chainId: "test:multi-placement:1416",
      state,
      effect: stepEffect,
      effectIndex: 0,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      summonPaymentSources: [{ kind: "reserve", amount: 0 }],
    });

    expect(result.pendingMultiPlacement).not.toBeNull();
    expect(result.pendingMultiPlacement?.continuation).toBeDefined();
    expect(result.pendingMultiPlacement?.continuation?.resumeStepIndex).toBe(1);

    const aliceBefore = state.players.find((p) => p.id === ALICE)!;
    // この時点では draw 未実行
    const aliceAfterPending = result.players.find((p) => p.id === ALICE)!;
    expect(aliceAfterPending.handCount).toBe(aliceBefore.handCount);

    const actions = getLegalActions({
      state: result,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const resolveAction = actions.find(
      (act) => act.kind === "resolve_pending_multi_placement"
    )!;

    const applied = applyLegalAction({
      state: result,
      action: resolveAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      multiPlacementAllocations: [
        {
          destinationInstanceId: "a",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
        {
          destinationInstanceId: "b",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    });

    expect(applied.state.pendingMultiPlacement).toBeNull();
    const aliceAfter = applied.state.players.find((p) => p.id === ALICE)!;
    // draw が走った (handCount +1, deckCount -1)
    expect(aliceAfter.handCount).toBe(aliceBefore.handCount + 1);
    expect(aliceAfter.deckCount).toBe(aliceBefore.deckCount - 1);
  });

  it("continuation: after_triggers は multi-placement 親 chainId を引き継ぐ", () => {
    defRegistry.clear();
    const hostDef = makeDef({ cardNo: "HOST_MULTI_AFTER" });
    const summonedDef = makeDef({
      cardNo: "SUMMONED_AFTER",
      cost: 0,
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    });
    registerDef(hostDef);
    registerDef(summonedDef);

    const stepEffect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "summon",
          action: {
            kind: "summon",
            target: {
              kind: "from_zone",
              zone: "trash",
              filter: { category: ["spirit"] },
              count: 2,
            },
            costModifier: "free",
          },
        },
        {
          id: "after",
          connector: "after_triggers",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    };
    hostDef.effects = [stepEffect];

    const host = makeInstance(hostDef, {
      instanceId: "host",
      zone: "field",
    });
    const a = makeInstance(summonedDef, { instanceId: "a", zone: "trash" });
    const b = makeInstance(summonedDef, { instanceId: "b", zone: "trash" });
    const state = makeState([host, a, b], 6);

    const pendingState = executeEffect({
      chainId: "test:multi-placement:1512",
      state,
      effect: stepEffect,
      effectIndex: 0,
      sourceInstanceId: "host",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      summonPaymentSources: [{ kind: "reserve", amount: 0 }],
    });
    const pendingId = pendingState.pendingMultiPlacement?.pendingId;
    expect(pendingId).toBeDefined();
    const resolveAction = getLegalActions({
      state: pendingState,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    }).find((act) => act.kind === "resolve_pending_multi_placement")!;

    const applied = applyLegalAction({
      state: pendingState,
      action: resolveAction,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        hostDef,
        summonedDef,
      ]),
      multiPlacementAllocations: [
        {
          destinationInstanceId: "a",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
        {
          destinationInstanceId: "b",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    });

    expect(applied.state.log).toContain(
      `effect:after_triggers:flushed:${pendingState.pendingMultiPlacement!.continuation!.chainId}:after_triggers:1`
    );
  });
});
