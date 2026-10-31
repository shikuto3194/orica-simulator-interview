// ============================================================
// P3-14 D-2 Phase 2 — chooser (相手の選択) 最小実装
// ============================================================
//
// EffectStep.chooser: PlayerRef を、対象選択を行うプレイヤーの指定として扱う。
// - chooser="opponent" の effect step は、効果オーナー (actingPlayerId) は据え置きで
//   prompt 相手のみ反転される。
// - registration → legal action 経路で chooserPlayerId が伝搬する。
// - getAvailablePendingTriggeredEffectLegalActions が呼び出し側 player を
//   chooser に応じてフィルタする。
//
// このテストでは pending triggered effect 経路のみカバーする。
// (battle immediate / field card / magic 等は段階分けにより別タスク)

import { describe, it, expect } from "vitest";
import { generateTriggeredEffectRegistrations } from "../src/effect/structured-effect-registrations";
import { getAvailablePendingTriggeredEffectLegalActions } from "../src/legal/legal-actions-availability";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type {
  CardDefinition,
  GameState,
  PendingTriggeredEffect,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

// ============================================================
// テスト用ヘルパー
// ============================================================

function makeDef(cardNo: string, effects: Effect[]): CardDefinition {
  return {
    cardNo,
    name: `テスト用 ${cardNo}`,
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
    effects,
  };
}

function makePendingTriggered(
  overrides: Partial<PendingTriggeredEffect> & {
    pendingId: string;
    actingPlayerId: string;
    sourceCardNo: string;
  }
): PendingTriggeredEffect {
  return {
    pendingId: overrides.pendingId,
    id: overrides.pendingId,
    actingPlayerId: overrides.actingPlayerId,
    eventKind: overrides.eventKind ?? "summon",
    source: overrides.source ?? "action_resolution",
    chainId: overrides.chainId ?? "test:chooser-targeting",
    attackId: overrides.attackId ?? null,
    relatedPlayerId: overrides.relatedPlayerId ?? null,
    relatedInstanceId: overrides.relatedInstanceId ?? null,
    amount: overrides.amount ?? null,
    resolvedSourceInstanceIds: overrides.resolvedSourceInstanceIds ?? [],
    simultaneousGroupId: overrides.simultaneousGroupId ?? null,
    sourceCardNo: overrides.sourceCardNo,
  } as PendingTriggeredEffect;
}

// ============================================================
// Part 1: registration への chooser 伝搬
// ============================================================

describe("D-2 Phase 2 chooser: registration generation", () => {
  it("step.chooser='opponent' は registration に伝搬する", () => {
    const def = makeDef("TEST-CHOOSE-001", [
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            chooser: "opponent",
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
      },
    ]);
    const regs = generateTriggeredEffectRegistrations(def);
    expect(regs.length).toBe(1);
    expect(regs[0]!.chooser).toBe("opponent");
  });

  it("chooser 未指定 → registration の chooser は undefined", () => {
    const def = makeDef("TEST-CHOOSE-002", [
      {
        timing: { kind: "card_event", event: "summon" },
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
      },
    ]);
    const regs = generateTriggeredEffectRegistrations(def);
    expect(regs.length).toBe(1);
    expect(regs[0]!.chooser).toBeUndefined();
  });

  it("chooser='self' は明示的に self として伝搬", () => {
    const def = makeDef("TEST-CHOOSE-003", [
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            chooser: "self",
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
      },
    ]);
    const regs = generateTriggeredEffectRegistrations(def);
    expect(regs[0]!.chooser).toBe("self");
  });

  it("choice ステップの各 entry の chooser が独立に伝搬する", () => {
    const def = makeDef("TEST-CHOOSE-004", [
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            // デフォルト: 自分が選ぶ
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
            choice: [
              {
                // 別選択肢: 相手が選ぶ
                chooser: "opponent",
                action: {
                  kind: "bounce",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: { category: ["spirit"] },
                    count: 1,
                  },
                },
              },
            ],
          },
        ],
      },
    ]);
    const regs = generateTriggeredEffectRegistrations(def);
    // P3-24 Phase 2: 1 effect = 1 registration。choice 変種は registration.choices[] に集約。
    expect(regs.length).toBe(1);
    const choices = regs[0]!.choices;
    expect(choices).toBeDefined();
    expect(choices!.length).toBe(2);
    expect(choices![0]!.chooser).toBeUndefined(); // デフォルト action
    expect(choices![1]!.chooser).toBe("opponent"); // choice entry
  });
});

// ============================================================
// Part 2: getAvailablePendingTriggeredEffectLegalActions chooser 反転
// ============================================================

describe("D-2 Phase 2 chooser: pending triggered effect prompt routing", () => {
  function setupChooserScenario(chooserMode: "self" | "opponent" | undefined): {
    state: GameState;
    def: CardDefinition;
    sourceCardId: string;
    targetCardId: string;
    ownerPlayerId: string;
    opponentPlayerId: string;
  } {
    const ownerPlayerId = "alice";
    const opponentPlayerId = "bob";

    const stepBase = {
      action: {
        kind: "destroy" as const,
        target: {
          kind: "filter" as const,
          player: "opponent" as const,
          filter: { category: ["spirit" as const] },
          count: 1,
        },
      },
    };

    const def = makeDef("TEST-CHOOSE-PROMPT-001", [
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [chooserMode ? { ...stepBase, chooser: chooserMode } : stepBase],
      },
    ]);

    // 効果のソース (alice の場札) と、destroy 対象 (bob の場札) を用意
    const sourceCard = createCardInstance(def, {
      instanceId: "src-card",
      ownerPlayerId,
      zone: "field",
      normalCoreCount: 1,
    });
    const targetDef: CardDefinition = {
      ...def,
      cardNo: "TEST-CHOOSE-TARGET-001",
      name: "対象スピリット",
    };
    const targetCard = createCardInstance(targetDef, {
      instanceId: "tgt-card",
      ownerPlayerId: opponentPlayerId,
      zone: "field",
      normalCoreCount: 1,
    });

    const state = createEmptyGameState({
      playerIds: [ownerPlayerId, opponentPlayerId],
      cardInstances: [sourceCard, targetCard],
    });

    // pending triggered effect を仕込む（actingPlayerId = effect owner = alice）
    state.pendingTriggeredEffects = [
      makePendingTriggered({
        chainId: "test:chooser-targeting:258",
        pendingId: "pte-001",
        actingPlayerId: ownerPlayerId,
        eventKind: "summon",
        sourceCardNo: def.cardNo,
        relatedInstanceId: sourceCard.instanceId,
      }),
    ];

    return {
      state,
      def,
      sourceCardId: sourceCard.instanceId,
      targetCardId: targetCard.instanceId,
      ownerPlayerId,
      opponentPlayerId,
    };
  }

  function makeOptions(
    state: GameState,
    actingPlayerId: string,
    def: CardDefinition
  ) {
    const regs = generateTriggeredEffectRegistrations(def);
    return {
      state,
      actingPlayerId,
      getCardDefinitionById: (id: string) =>
        id === def.cardNo ? def : undefined,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: (cardNo: string) =>
        cardNo === def.cardNo ? regs : undefined,
    };
  }

  it("chooser 未指定: effect owner (alice) のみ legal action を取得できる", () => {
    const { state, def, ownerPlayerId, opponentPlayerId } =
      setupChooserScenario(undefined);

    const aliceActions = getAvailablePendingTriggeredEffectLegalActions(
      makeOptions(state, ownerPlayerId, def)
    );
    expect(aliceActions.length).toBeGreaterThan(0);
    expect(aliceActions[0]!.actingPlayerId).toBe(ownerPlayerId);
    expect(aliceActions[0]!.chooserPlayerId).toBeUndefined();

    const bobActions = getAvailablePendingTriggeredEffectLegalActions(
      makeOptions(state, opponentPlayerId, def)
    );
    expect(bobActions.length).toBe(0);
  });

  it("chooser='self': 既存挙動と同じ (effect owner のみ)", () => {
    const { state, def, ownerPlayerId, opponentPlayerId } =
      setupChooserScenario("self");

    const aliceActions = getAvailablePendingTriggeredEffectLegalActions(
      makeOptions(state, ownerPlayerId, def)
    );
    expect(aliceActions.length).toBeGreaterThan(0);
    // chooser=self のとき chooserPlayerId は出力しない (省略)
    expect(aliceActions[0]!.chooserPlayerId).toBeUndefined();

    const bobActions = getAvailablePendingTriggeredEffectLegalActions(
      makeOptions(state, opponentPlayerId, def)
    );
    expect(bobActions.length).toBe(0);
  });

  it("chooser='opponent': bob のみ legal action を取得できる (alice は取得できない)", () => {
    const { state, def, ownerPlayerId, opponentPlayerId } =
      setupChooserScenario("opponent");

    const aliceActions = getAvailablePendingTriggeredEffectLegalActions(
      makeOptions(state, ownerPlayerId, def)
    );
    expect(aliceActions.length).toBe(0);

    const bobActions = getAvailablePendingTriggeredEffectLegalActions(
      makeOptions(state, opponentPlayerId, def)
    );
    expect(bobActions.length).toBeGreaterThan(0);
    // 効果オーナー (actingPlayerId) は据え置き、chooserPlayerId のみが opponent
    expect(bobActions[0]!.actingPlayerId).toBe(ownerPlayerId);
    expect(bobActions[0]!.chooserPlayerId).toBe(opponentPlayerId);
  });

  it("chooser='opponent' でも pendingId は据え置き", () => {
    const { state, def, opponentPlayerId } = setupChooserScenario("opponent");
    const bobActions = getAvailablePendingTriggeredEffectLegalActions(
      makeOptions(state, opponentPlayerId, def)
    );
    expect(bobActions[0]!.pendingId).toBe("pte-001");
  });
});
