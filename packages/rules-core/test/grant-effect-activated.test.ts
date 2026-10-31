/**
 * P3-99 grant_effect プリミティブ — 起動権 variant（§3 起動権）。
 *
 * grant_effect で付与された「起動効果」(grantedEffect.timing.kind === "activated") を、
 * 被付与カード（grantee）の能動的な legal action として列挙・発揮できることを検証する。
 * 正源カード: BSTH002-転醒R01(B) 現世「自分のスピリット1体は、このターン中に1回、
 * フラッシュタイミングで回復できる」。
 *
 * 検証点:
 *  - 列挙: 被付与カードが exhausted でも、付与された flash 起動効果が legal action に出る。
 *  - 発揮: スタック窓を開き、相手パスで閉じて解決すると grantee が recover する。
 *  - usageLimit: ターンに1回。1 回発揮後は再列挙されない（CE スコープ消費）。
 *  - 即時型持続: duration:turn の付与は付与元（grant 源）が場を離れても当ターン中は残る。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type { Effect } from "../src/dsl-types";
import type {
  ActiveStack,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

function spiritDef(cardNo: string, name: string): CardDefinition {
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
    tribe: "封魔",
    colors: ["red"],
  } as CardDefinition;
}

const GRANTER_DEF = spiritDef("GRANT-SRC", "現世(grant源)");
const GRANTEE_DEF: CardDefinition = {
  ...spiritDef("GRANT-TGT", "被付与スピリット"),
  tribe: "サイヤ人",
};

const DEFS: Record<string, CardDefinition> = {
  "GRANT-SRC": GRANTER_DEF,
  "GRANT-TGT": GRANTEE_DEF,
};
const getDef = (id: string): CardDefinition | undefined => DEFS[id];

/** 被付与カード自身を回復する flash 起動効果（ターンに1回）。 */
const GRANTED_ACTIVATED_EFFECT: Effect = {
  timing: { kind: "activated", mode: "flash" },
  executionMode: "optional",
  usageLimit: { kind: "per_instance", duration: "turn" },
  steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
} as unknown as Effect;

/** 同一 grant 本文内の同名対象で共有する flash 起動効果。 */
const GRANTED_PER_CARD_NAME_EFFECT: Effect = {
  ...GRANTED_ACTIVATED_EFFECT,
  usageLimit: {
    kind: "per_card_name",
    duration: "turn",
    maxCount: 1,
  },
} as unknown as Effect;

/** 本文で flash 窓を使えるが、見出しフラッシュ効果ではない起動効果。 */
const GRANTED_FLASH_WINDOW_NON_FLASH_EFFECT: Effect = {
  ...GRANTED_ACTIVATED_EFFECT,
  activationLabel: "none",
} as unknown as Effect;

/** 被付与カード自身を回復する stack 起動効果（ターンに1回）。 */
const GRANTED_STACK_EFFECT: Effect = {
  ...GRANTED_ACTIVATED_EFFECT,
  timing: { kind: "activated", mode: "stack" },
} as unknown as Effect;

/** 自分のスピリット全体へ起動効果を付与する外側 effect（duration:turn = 即時型持続）。 */
const GRANT_OUTER_EFFECT: Effect = {
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
        duration: { scope: "turn" },
        grantedEffect: GRANTED_ACTIVATED_EFFECT,
      },
    },
  ],
} as unknown as Effect;

const GRANT_STACK_OUTER_EFFECT: Effect = {
  ...GRANT_OUTER_EFFECT,
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
        duration: { scope: "turn" },
        grantedEffect: GRANTED_STACK_EFFECT,
      },
    },
  ],
} as unknown as Effect;

const GRANT_FLASH_WINDOW_NON_FLASH_OUTER_EFFECT: Effect = {
  ...GRANT_OUTER_EFFECT,
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
        duration: { scope: "turn" },
        grantedEffect: GRANTED_FLASH_WINDOW_NON_FLASH_EFFECT,
      },
    },
  ],
} as unknown as Effect;

const OPPONENT_PENDING_STACK: ActiveStack = {
  stackId: "stack:bob-field",
  actionKind: "field_card_effect",
  chainId: "chain:bob-field",
  actingPlayerId: BOB,
  cardInstanceId: "granter-1",
  cardDefinitionId: GRANTER_DEF.cardNo,
  targetInstanceIds: [],
  targetEffectFilterTags: ["general"],
  chosenTiming: "stack",
  previousResponseSourcePlayerId: null,
  previousPendingStackAction: null,
};

/** ALICE のメインステップ。grant 源 + exhausted な被付与スピリットを場に並べ、付与 CE を登録。 */
function registeredState(
  outerEffect: Effect = GRANT_OUTER_EFFECT,
  overrides?: Partial<Pick<GameState, "step" | "window" | "stackWindow">>
): GameState {
  const granter = createCardInstance(GRANTER_DEF, {
    instanceId: "granter-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const grantee = createCardInstance(GRANTEE_DEF, {
    instanceId: "grantee-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  // 被付与スピリットは exhausted（回復対象）。tribe「サイヤ人」で filter に乗る。
  const granteeExhausted = { ...grantee, exhaustState: "exhausted" as const };
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const state: GameState = {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    ...overrides,
    cardInstances: [granter, granteeExhausted],
    activeContinuousEffects: [],
  };
  return executeEffect({
    chainId: "test:grant-effect-activated:192",
    state,
    effect: outerEffect,
    sourceInstanceId: "granter-1",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
  });
}

function registeredStackWindowState(): GameState {
  return registeredState(GRANT_STACK_OUTER_EFFECT, {
    step: "attack",
    window: "stack",
    stackWindow: {
      priorityPlayerId: ALICE,
      consecutivePassCount: 0,
      actingPlayerId: BOB,
      previousWindow: "none",
      stackResponseSourcePlayerId: BOB,
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: OPPONENT_PENDING_STACK,
    },
  });
}

function grantedActions(state: GameState) {
  return getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredFieldCardEffectActions: () => [],
  } as unknown as Parameters<typeof getLegalActions>[0]).filter(
    (a) =>
      a.kind === "use_field_card_effect" &&
      (a as { grantedEffectCeId?: string }).grantedEffectCeId !== undefined
  );
}

/** 起動を宣言し、スタック窓を相手パスで閉じて deferred 解決まで進める。 */
function activateAndResolve(state: GameState, actionId: string): GameState {
  const actions = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredFieldCardEffectActions: () => [],
  } as unknown as Parameters<typeof getLegalActions>[0]);
  const action = actions.find((a) => a.actionId === actionId);
  expect(action, `granted activated action ${actionId}`).toBeDefined();
  let current = (
    applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: getDef,
    }) as { state: GameState }
  ).state;
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

function passPriority(state: GameState): GameState {
  const responderId = state.stackWindow!.priorityPlayerId;
  const pass = getLegalActions({
    state,
    actingPlayerId: responderId,
    getCardDefinitionById: getDef,
    getRegisteredFieldCardEffectActions: () => [],
  } as unknown as Parameters<typeof getLegalActions>[0]).find(
    (action) => action.kind === "pass_stack"
  );
  expect(pass, `pass_stack for ${responderId}`).toBeDefined();
  return (
    applyLegalAction({
      state,
      action: pass!,
      getCardDefinitionById: getDef,
    }) as { state: GameState }
  ).state;
}

function findGrantedStack(stack: ActiveStack): ActiveStack {
  let current: ActiveStack | null = stack;
  while (current) {
    if (current.grantedEffectCeId !== undefined) return current;
    current = current.previousPendingStackAction;
  }
  throw new Error("granted stack not found");
}

function granteeExhaust(state: GameState): string | undefined {
  return state.cardInstances.find((c) => c.instanceId === "grantee-1")
    ?.exhaustState;
}

describe("P3-99 grant_effect: 起動権 variant（§3）", () => {
  it("付与 CE を登録する（granted_effect / duration:turn）", () => {
    const state = registeredState();
    const ces = state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "granted_effect"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]!.targetInstanceId).toBe("grantee-1");
    expect(ces[0]!.duration.scope).toBe("turn");
  });

  it("被付与スピリットの flash 起動効果が legal action に列挙される", () => {
    const state = registeredState();
    const actions = grantedActions(state);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.sourceInstanceId).toBe("grantee-1");
  });

  it("field フラッシュ使用禁止中は被付与スピリットの flash 起動効果を列挙しない", () => {
    const state = registeredState();
    const restrictAliceFieldFlash: ContinuousEffect = {
      effectId: "ce:restrict-flash-field:alice",
      sourceInstanceId: "granter-1",
      sourceDefinitionId: GRANTER_DEF.cardNo,
      actingPlayerId: BOB,
      duration: { scope: "turn" },
      createdAtTurn: state.turnNumber,
      modifierTag: "restrict_flash_field",
      targetInstanceId: ALICE,
      metadata: { restrictedZones: ["field"] },
    };
    const restricted: GameState = {
      ...state,
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        restrictAliceFieldFlash,
      ],
    };

    expect(grantedActions(restricted)).toHaveLength(0);
  });

  it("発揮するとスタック窓を開き、解決で grantee が回復する", () => {
    const state = registeredState();
    expect(granteeExhaust(state)).toBe("exhausted");
    const actionId = grantedActions(state)[0]!.actionId;
    const resolved = activateAndResolve(state, actionId);
    expect(granteeExhaust(resolved)).toBe("recovered");
  });

  it("usageLimit: ターンに1回。発揮後は再列挙されない", () => {
    const state = registeredState();
    const actionId = grantedActions(state)[0]!.actionId;
    const resolved = activateAndResolve(state, actionId);
    expect(grantedActions(resolved)).toHaveLength(0);
  });

  it("[board] 同一 grant 源の同名対象は使用枠を共有し、別 grant 源は独立する", () => {
    const granterA = createCardInstance(GRANTER_DEF, {
      instanceId: "granter-a",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const granterB = createCardInstance(GRANTER_DEF, {
      instanceId: "granter-b",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const granteeA1 = createCardInstance(GRANTEE_DEF, {
      instanceId: "grantee-a-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const granteeA2 = createCardInstance(GRANTEE_DEF, {
      instanceId: "grantee-a-2",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const granteeB1 = createCardInstance(GRANTEE_DEF, {
      instanceId: "grantee-b-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
    const grantCe = (
      effectId: string,
      grantSourceInstanceId: string,
      targetInstanceId: string
    ): ContinuousEffect => ({
      effectId,
      sourceInstanceId: grantSourceInstanceId,
      sourceDefinitionId: GRANTER_DEF.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: base.turnNumber,
      createdAtAttackId: null,
      modifierTag: "granted_effect",
      targetInstanceId,
      metadata: { grantedEffect: GRANTED_PER_CARD_NAME_EFFECT },
      provenance: {
        effectIndex: 0,
        stepIndex: 0,
        effectSourceInstanceId: grantSourceInstanceId,
        effectSourceDefinitionId: GRANTER_DEF.cardNo,
      },
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [granterA, granterB, granteeA1, granteeA2, granteeB1],
      activeContinuousEffects: [
        grantCe("ce:grant-a:target-1", "granter-a", "grantee-a-1"),
        grantCe("ce:grant-a:target-2", "granter-a", "grantee-a-2"),
        grantCe("ce:grant-b:target-1", "granter-b", "grantee-b-1"),
      ],
    };

    const before = grantedActions(state);
    expect(before.map((action) => action.sourceInstanceId).sort()).toEqual([
      "grantee-a-1",
      "grantee-a-2",
      "grantee-b-1",
    ]);

    const afterA = activateAndResolve(
      state,
      before.find((action) => action.sourceInstanceId === "grantee-a-1")!
        .actionId
    );
    const afterAActions = grantedActions(afterA);
    expect(afterAActions.map((action) => action.sourceInstanceId)).toEqual([
      "grantee-b-1",
    ]);

    const afterB = activateAndResolve(afterA, afterAActions[0]!.actionId);
    expect(grantedActions(afterB)).toHaveLength(0);
  });

  it("即時型持続: 付与元が場を離れても当ターン中は付与 CE が残る", () => {
    const state = registeredState();
    // grant 源（granter-1）を場から除去し CE 再計算。
    const withoutGranter: GameState = {
      ...state,
      cardInstances: state.cardInstances.filter(
        (c) => c.instanceId !== "granter-1"
      ),
    };
    const recomputed = recomputeContinuousEffects(withoutGranter, getDef);
    const ces = recomputed.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "granted_effect"
    );
    expect(ces).toHaveLength(1);
    // 被付与スピリットは依然として起動効果を列挙できる。
    expect(grantedActions(recomputed)).toHaveLength(1);
  });

  it("stack 起動効果の granted action は chosenTiming を stack のまま保持する", () => {
    const state = registeredStackWindowState();
    const actions = grantedActions(state);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.timing).toBe("stack");

    const declared = (
      applyLegalAction({
        state,
        action: actions[0]!,
        getCardDefinitionById: getDef,
      }) as { state: GameState }
    ).state;

    expect(declared.stackWindow?.pendingStackAction?.chosenTiming).toBe(
      "stack"
    );
  });

  it("本文 flash 窓の非フラッシュ granted action は activationLabel none を保持する", () => {
    const state = registeredState(GRANT_FLASH_WINDOW_NON_FLASH_OUTER_EFFECT);
    const actions = grantedActions(state);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.timing).toBe("flash");
    expect(actions[0]!.activationLabel).toBe("none");

    const declared = (
      applyLegalAction({
        state,
        action: actions[0]!,
        getCardDefinitionById: getDef,
      }) as { state: GameState }
    ).state;

    const stack = declared.stackWindow?.pendingStackAction;
    expect(stack?.chosenTiming).toBe("flash");
    expect(stack?.activationLabel).toBe("none");
  });

  it("無効化された stack 起動効果の granted action は解決時に実行されない", () => {
    const state = registeredStackWindowState();
    const action = grantedActions(state)[0]!;
    const declared = (
      applyLegalAction({
        state,
        action,
        getCardDefinitionById: getDef,
      }) as { state: GameState }
    ).state;
    const pending = {
      ...findGrantedStack(declared.stackWindow!.pendingStackAction!),
      isNullified: true,
    };
    const nullified: GameState = {
      ...declared,
      stackWindow: {
        ...declared.stackWindow!,
        pendingStackAction: pending,
      },
    };

    let resolved = nullified;
    for (let guard = 0; resolved.stackWindow && guard < 4; guard++) {
      if (
        resolved.log.includes(`effect:nullified:${pending.chainId}:grantee-1`)
      ) {
        break;
      }
      resolved = passPriority(resolved);
    }

    expect(granteeExhaust(resolved)).toBe("exhausted");
    expect(resolved.log).toContain(
      `effect:nullified:${pending.chainId}:grantee-1`
    );
  });
});
