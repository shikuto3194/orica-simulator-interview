/**
 * P3-99 grant_effect プリミティブ — 誘発 variant の注入点テスト（§3）。
 *
 * foundation（登録 / lifecycle）の上に、被付与カード（grantee）のイベントで付与効果を
 * 発火させる「注入点」を検証する:
 *  - 検出: grantee の起こしたイベントが付与効果 trigger に一致したとき mechanic pending を積む。
 *  - 解決: 受諾で付与効果の steps を grantee を source として実行（盤面変化）。
 *  - 発揮元/付与元境界: 発揮元のイベントでは不発、CE 消失（source 離脱）では検出しない。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type { Effect } from "../src/dsl-types";
import type { CardDefinition, ContinuousEffect, GameState } from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

function spiritDef(
  cardNo: string,
  name: string,
  tribe: string
): CardDefinition {
  return {
    cardNo,
    name,
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 4,
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    textLines: [],
    images: {},
    tribe,
    colors: ["red"],
  } as CardDefinition;
}

const SOURCE_DEF = spiritDef("GRANT-SOURCE", "グラント源", "魔人");
const TARGET_DEF = spiritDef("GRANT-TARGET", "ベジータ", "サイヤ人");
const LOW_COST_TRIGGER_DEF = spiritDef(
  "GRANT-LOW-COST-TRIGGER",
  "実効コスト化対象",
  "導魔"
);
const COST_THREE_BRAVE_DEF: CardDefinition = {
  ...spiritDef("GRANT-COST-THREE-BRAVE", "合体コスト3ブレイヴ", "導魔"),
  printedCategory: "brave",
};

const DEFS: Record<string, CardDefinition> = {
  "GRANT-SOURCE": SOURCE_DEF,
  "GRANT-TARGET": TARGET_DEF,
  "GRANT-LOW-COST-TRIGGER": LOW_COST_TRIGGER_DEF,
  "GRANT-COST-THREE-BRAVE": COST_THREE_BRAVE_DEF,
};
const getDef = (id: string): CardDefinition | undefined => DEFS[id];

/** grantee のアタック時に相手のライフコア1個を相手ボイドへ（BSDB01-R03 想定の縮約版）。 */
const NESTED_GRANTED_EFFECT: Effect = {
  timing: { kind: "card_event", event: "attack" },
  steps: [
    {
      action: {
        kind: "core_move",
        from: { kind: "life", player: "opponent" },
        to: { kind: "void", player: "opponent" },
        amount: 1,
      },
    },
  ],
} as unknown as Effect;

function grantEffect(opts?: {
  duration?: { scope: "while_on_field" } | { scope: "turn" };
}): Effect {
  return {
    timing: { kind: "activated", mode: "flash" },
    steps: [
      {
        action: {
          kind: "grant_effect",
          target: {
            kind: "filter",
            player: "self",
            count: "all",
            filter: { category: ["spirit"], tribes: ["サイヤ人"] },
          },
          grantedEffect: NESTED_GRANTED_EFFECT,
          ...(opts?.duration ? { duration: opts.duration } : {}),
        },
      },
    ],
  } as unknown as Effect;
}

/** grant 源 1 体 + サイヤ人スピリット 2 体（被付与）を場に並べ、付与 CE を登録した state。 */
function registeredState(): GameState {
  const source = createCardInstance(SOURCE_DEF, {
    instanceId: "source-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const targets = [0, 1].map((i) =>
    createCardInstance(TARGET_DEF, {
      instanceId: `target-${i}`,
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    })
  );
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const state: GameState = {
    ...base,
    activePlayerId: ALICE,
    cardInstances: [source, ...targets],
    activeContinuousEffects: [],
  };
  return executeEffect({
    chainId: "test:grant-effect-injection:126",
    state,
    effect: grantEffect(),
    sourceInstanceId: "source-1",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  });
}

function grantedPendings(state: GameState) {
  return state.pendingTriggeredEffects.filter(
    (p) => p.mechanic?.kind === "granted_effect"
  );
}

function attackEvent(instanceId: string) {
  return {
    chainId: "test:grant-effect-injection:142",
    eventKind: "attack",
    relatedInstanceId: instanceId,
    relatedPlayerId: ALICE,
  };
}

/** mechanic pending を受諾解決し、スタック窓を相手パスで閉じて deferred 解決まで進める。 */
function resolveMechanicPending(
  state: GameState,
  pendingId: string
): GameState {
  const actions = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  });
  const action = actions.find(
    (a) =>
      a.kind === "resolve_pending_triggered_effect" && a.pendingId === pendingId
  );
  expect(action, `resolve action for ${pendingId}`).toBeDefined();
  const applied = (
    applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: getDef,
    }) as { state: GameState }
  ).state;
  // 受諾はスタック窓を開く（02:186 / P3-34）。相手パスで閉じて deferred 解決へ。
  let current = applied;
  let guard = 0;
  while (current.stackWindow && guard++ < 10) {
    const responderId = current.stackWindow.priorityPlayerId;
    const passActions = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => [],
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const pass = passActions.find((a) => a.kind === "pass_stack");
    expect(pass, `pass_stack for ${responderId}`).toBeDefined();
    current = (
      applyLegalAction({
        state: current,
        action: pass!,
        getCardDefinitionById: getDef,
      }) as { state: GameState }
    ).state;
  }
  return current;
}

function bobLife(state: GameState): number {
  return state.players.find((p) => p.id === BOB)!.lifeNormalCoreCount;
}

describe("P3-99 grant_effect: 誘発検出（注入点 §3）", () => {
  it("grantee のイベントが付与効果 trigger に一致すると mechanic pending を積む", () => {
    const state = registeredState();
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [attackEvent("target-0")],
      getDef
    );
    const pendings = grantedPendings(next);
    expect(pendings).toHaveLength(1);
    expect(pendings[0]!.actingPlayerId).toBe(ALICE);
    expect(pendings[0]!.relatedInstanceId).toBe("target-0");
    const mech = pendings[0]!.mechanic!;
    expect(mech.kind).toBe("granted_effect");
    if (mech.kind === "granted_effect") {
      expect(mech.granteeInstanceId).toBe("target-0");
    }
  });

  it("複数 grantee が各自のイベントを起こすと各 grantee に pending を積む", () => {
    const state = registeredState();
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [attackEvent("target-0"), attackEvent("target-1")],
      getDef
    );
    const grantees = grantedPendings(next)
      .map((p) => p.relatedInstanceId)
      .sort();
    expect(grantees).toEqual(["target-0", "target-1"]);
  });

  it("trigger と異なるイベント種別では発火しない", () => {
    const state = registeredState();
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [
        {
          chainId: "test:grant-effect-injection:236",
          eventKind: "summon",
          relatedInstanceId: "target-0",
          relatedPlayerId: ALICE,
        },
      ],
      getDef
    );
    expect(grantedPendings(next)).toHaveLength(0);
  });

  it("発揮元（grant 源）自身のイベントでは発火しない（付与は被付与カードの効果）", () => {
    const state = registeredState();
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [attackEvent("source-1")],
      getDef
    );
    expect(grantedPendings(next)).toHaveLength(0);
  });

  it("発揮元離脱で CE が消えると（while_on_field 停止）検出しない（04 一般化）", () => {
    const registered = registeredState();
    const afterLeave: GameState = {
      ...registered,
      cardInstances: registered.cardInstances.map((c) =>
        c.instanceId === "source-1" ? { ...c, zone: "trash" } : c
      ),
    };
    const recomputed = recomputeContinuousEffects(afterLeave);
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      recomputed,
      [attackEvent("target-0")],
      getDef
    );
    expect(grantedPendings(next)).toHaveLength(0);
  });

  it("動的 targetFilter の maxCores は grantee 発火判定で通常+ソウルのコア数を参照する", () => {
    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "source-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const lowCore = createCardInstance(TARGET_DEF, {
      instanceId: "target-low-core",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const highCore = createCardInstance(TARGET_DEF, {
      instanceId: "target-high-core",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const dynamicGrantCe: ContinuousEffect = {
      effectId: "grant-dynamic-max-cores",
      sourceInstanceId: "source-1",
      sourceDefinitionId: "GRANT-SOURCE",
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "granted_effect",
      targetFilter: {
        player: "self",
        category: ["spirit"],
        maxCores: 1,
      },
      metadata: {
        grantedEffect: NESTED_GRANTED_EFFECT,
        grantPlayerRef: "self",
      },
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      cardInstances: [source, lowCore, highCore],
      activeContinuousEffects: [dynamicGrantCe],
    };

    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [attackEvent("target-low-core"), attackEvent("target-high-core")],
      getDef
    );
    expect(grantedPendings(queued).map((p) => p.relatedInstanceId)).toEqual([
      "target-low-core",
    ]);
  });

  it("動的 targetFilter は同時に複数 grantee が発火しても各イベントごとに pending を積む", () => {
    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "source-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const first = createCardInstance(TARGET_DEF, {
      instanceId: "target-dynamic-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const second = createCardInstance(TARGET_DEF, {
      instanceId: "target-dynamic-2",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const dynamicGrantCe: ContinuousEffect = {
      effectId: "grant-dynamic-multi",
      sourceInstanceId: "source-1",
      sourceDefinitionId: "GRANT-SOURCE",
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "granted_effect",
      targetFilter: {
        player: "self",
        category: ["spirit"],
        maxCores: 1,
      },
      metadata: {
        grantedEffect: NESTED_GRANTED_EFFECT,
        grantPlayerRef: "self",
      },
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      cardInstances: [source, first, second],
      activeContinuousEffects: [dynamicGrantCe],
    };

    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [attackEvent("target-dynamic-1"), attackEvent("target-dynamic-2")],
      getDef
    );
    expect(grantedPendings(queued).map((p) => p.relatedInstanceId)).toEqual([
      "target-dynamic-1",
      "target-dynamic-2",
    ]);
  });

  it("game_event triggerFilter の minCost は override_properties の実効コストを見る", () => {
    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "source-effective-cost",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const grantee = createCardInstance(TARGET_DEF, {
      instanceId: "target-effective-cost-grantee",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const triggerCard = createCardInstance(LOW_COST_TRIGGER_DEF, {
      instanceId: "trigger-printed-cost-four",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const grantCe: ContinuousEffect = {
      effectId: "grant-effective-cost-filter",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "granted_effect",
      targetInstanceId: grantee.instanceId,
      metadata: {
        grantedEffect: {
          timing: {
            kind: "game_event",
            event: "summon",
            player: "self",
            triggerFilter: {
              category: ["spirit"],
              minCost: 5,
            },
          },
          steps: [],
        } as unknown as Effect,
        grantPlayerRef: "self",
      },
    };
    const costOverrideCe: ContinuousEffect = {
      effectId: "override-trigger-cost-five",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "override_properties",
      targetInstanceId: triggerCard.instanceId,
      metadata: { properties: { cost: 5 } },
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      cardInstances: [source, grantee, triggerCard],
      activeContinuousEffects: [grantCe, costOverrideCe],
    };

    const summonEvent = {
      chainId: "test:grant-effect-injection:451",
      eventKind: "summon",
      relatedInstanceId: triggerCard.instanceId,
      relatedPlayerId: ALICE,
    };
    const printedOnly = queueGrantedEffectTriggersFromTriggerEvents(
      { ...state, activeContinuousEffects: [grantCe] },
      [summonEvent],
      getDef
    );
    expect(grantedPendings(printedOnly)).toHaveLength(0);

    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [summonEvent],
      getDef
    );
    expect(grantedPendings(queued).map((p) => p.relatedInstanceId)).toEqual([
      grantee.instanceId,
    ]);
  });

  it("dynamic targetFilter の minCost は override_properties の実効コストを見る", () => {
    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "source-target-filter-cost",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const grantee = createCardInstance(LOW_COST_TRIGGER_DEF, {
      instanceId: "target-filter-printed-cost-four",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const grantCe: ContinuousEffect = {
      effectId: "grant-dynamic-target-filter-cost",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "granted_effect",
      targetFilter: {
        player: "self",
        category: ["spirit"],
        minCost: 5,
      },
      metadata: {
        grantedEffect: NESTED_GRANTED_EFFECT,
        grantPlayerRef: "self",
      },
    };
    const costOverrideCe: ContinuousEffect = {
      effectId: "override-grantee-cost-five",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "override_properties",
      targetInstanceId: grantee.instanceId,
      metadata: { properties: { cost: 5 } },
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      cardInstances: [source, grantee],
      activeContinuousEffects: [grantCe, costOverrideCe],
    };

    const printedOnly = queueGrantedEffectTriggersFromTriggerEvents(
      { ...state, activeContinuousEffects: [grantCe] },
      [attackEvent(grantee.instanceId)],
      getDef
    );
    expect(grantedPendings(printedOnly)).toHaveLength(0);

    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [attackEvent(grantee.instanceId)],
      getDef
    );
    expect(grantedPendings(queued).map((p) => p.relatedInstanceId)).toEqual([
      grantee.instanceId,
    ]);
  });

  it("dynamic targetFilter の maxCost は合体中 host の additional_cost をユニット代替コストとして見る", () => {
    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "source-target-filter-combined-cost",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const grantee = createCardInstance(LOW_COST_TRIGGER_DEF, {
      instanceId: "target-filter-combined-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
      attachedChildrenIds: ["target-filter-attached-brave"],
    });
    const attachedBrave = createCardInstance(COST_THREE_BRAVE_DEF, {
      instanceId: "target-filter-attached-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: grantee.instanceId,
      normalCoreCount: 1,
    });
    const grantCe: ContinuousEffect = {
      effectId: "grant-dynamic-target-filter-max-cost",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "granted_effect",
      targetFilter: {
        player: "self",
        category: ["spirit"],
        maxCost: 5,
      },
      metadata: {
        grantedEffect: NESTED_GRANTED_EFFECT,
        grantPlayerRef: "self",
      },
    };
    const hostAdditionalCostCe: ContinuousEffect = {
      effectId: "additional-host-cost-five",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "additional_cost",
      modifierAmount: 5,
      targetInstanceId: grantee.instanceId,
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      cardInstances: [source, grantee, attachedBrave],
      activeContinuousEffects: [grantCe, hostAdditionalCostCe],
    };

    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [attackEvent(grantee.instanceId)],
      getDef
    );
    expect(grantedPendings(queued).map((p) => p.relatedInstanceId)).toEqual([
      grantee.instanceId,
    ]);
  });

  it("dynamic targetFilter は attached brave 側 additional_cost を合体単位で拾う", () => {
    const source = createCardInstance(SOURCE_DEF, {
      instanceId: "source-target-filter-brave-additional",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const grantee = createCardInstance(LOW_COST_TRIGGER_DEF, {
      instanceId: "target-filter-brave-additional-host",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
      attachedChildrenIds: ["target-filter-additional-brave"],
    });
    const attachedBrave = createCardInstance(COST_THREE_BRAVE_DEF, {
      instanceId: "target-filter-additional-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: grantee.instanceId,
      normalCoreCount: 1,
    });
    const grantCe: ContinuousEffect = {
      effectId: "grant-dynamic-target-filter-min-combined-cost",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "granted_effect",
      targetFilter: {
        player: "self",
        category: ["spirit"],
        minCost: 8,
      },
      metadata: {
        grantedEffect: NESTED_GRANTED_EFFECT,
        grantPlayerRef: "self",
      },
    };
    const braveAdditionalCostCe: ContinuousEffect = {
      effectId: "additional-brave-cost-four",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: SOURCE_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "additional_cost",
      modifierAmount: 4,
      targetInstanceId: attachedBrave.instanceId,
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: [ALICE, BOB] }),
      activePlayerId: ALICE,
      cardInstances: [source, grantee, attachedBrave],
      activeContinuousEffects: [grantCe, braveAdditionalCostCe],
    };

    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [attackEvent(grantee.instanceId)],
      getDef
    );
    expect(grantedPendings(queued).map((p) => p.relatedInstanceId)).toEqual([
      grantee.instanceId,
    ]);
  });
});

describe("P3-99 grant_effect: 誘発解決（注入点 §3）", () => {
  it("受諾で付与効果の steps が grantee を source として実行され盤面が変わる", () => {
    const state = registeredState();
    expect(bobLife(state)).toBe(5);
    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [attackEvent("target-0")],
      getDef
    );
    const pendingId = grantedPendings(queued)[0]!.pendingId;
    const resolved = resolveMechanicPending(queued, pendingId);
    // 付与効果（相手ライフコア1個→相手ボイド）が発火し BOB のライフが 5→4。
    expect(bobLife(resolved)).toBe(4);
    expect(grantedPendings(resolved)).toHaveLength(0);
  });
});
