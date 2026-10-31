/**
 * grant_effect 誘発の「収集時ゲート」スコープ条件（ENGINE-grant-effect サブギャップ）。
 *
 * 『このスピリットのアタック時』バトル終了時型の付与誘発（BSDB01-R03 [2,3] 想定）を検証する。
 * scope 条件（in_battle:attacking）はバトル reset で transient state が消えるため、
 *  - 検出（reset 前）: in_battle を評価し、満たさないなら pending を積まない。
 *  - 解決（reset 後）: 検出時ゲート済みの scope 条件は再評価から除外し、effect を適用する。
 * value 条件（count_value 等）は従来どおり解決時に評価する（P3-62「のとき」条件）。
 * 正源: 10_rules/05 §バトル終了時（X08 と同じ収集時ゲート）。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { queueGrantedEffectTriggersFromTriggerEvents } from "../src/mechanics/grant-effect-system";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type { Effect } from "../src/dsl-types";
import type { BattleEntity, CardDefinition, GameState } from "../src/model";

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
const DEFS: Record<string, CardDefinition> = {
  "GRANT-SOURCE": SOURCE_DEF,
  "GRANT-TARGET": TARGET_DEF,
};
const getDef = (id: string): CardDefinition | undefined => DEFS[id];

/**
 * grantee の『アタック時』バトル終了時に相手ライフコア1個を相手ボイドへ。
 * scope = in_battle:attacking、任意で value 条件 count_value を付ける。
 */
function nestedGrantedEffect(opts?: { minCount?: number }): Effect {
  return {
    timing: { kind: "card_event", event: "battle_end" },
    condition: [
      { kind: "in_battle", state: "attacking" },
      ...(opts?.minCount !== undefined
        ? [{ kind: "count_value", player: "self", min: opts.minCount }]
        : []),
    ],
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
}

function grantEffect(opts?: { minCount?: number }): Effect {
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
          grantedEffect: nestedGrantedEffect(opts),
          duration: { scope: "turn" },
        },
      },
    ],
  } as unknown as Effect;
}

function attackingEntity(instanceId: string): BattleEntity {
  return {
    entityId: `battle-${instanceId}`,
    memberInstanceIds: [instanceId],
    resolvedBp: 5000,
    resolvedSymbols: ["red"],
    attackState: "attacking",
  };
}

/** grant 源 + サイヤ人 grantee 1 体を場に並べ、付与 CE を登録した state。 */
function registeredState(opts?: {
  minCount?: number;
  countValue?: number;
  attacking?: boolean;
}): GameState {
  const source = createCardInstance(SOURCE_DEF, {
    instanceId: "source-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const grantee = createCardInstance(TARGET_DEF, {
    instanceId: "target-0",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const state: GameState = {
    ...base,
    activePlayerId: ALICE,
    cardInstances: [source, grantee],
    activeContinuousEffects: [],
    battleEntities:
      opts?.attacking === false ? [] : [attackingEntity("target-0")],
    players: base.players.map((p) =>
      p.id === ALICE && opts?.countValue !== undefined
        ? { ...p, countValue: opts.countValue }
        : p
    ),
  };
  return executeEffect({
    chainId: "test:grant-effect-scope-condition:142",
    state,
    effect: grantEffect(opts),
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

function battleEndEvent(instanceId: string) {
  return {
    chainId: "test:grant-effect-scope-condition:158",
    eventKind: "battle_end",
    relatedInstanceId: instanceId,
    relatedPlayerId: ALICE,
  };
}

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

function bobLife(state: GameState): number {
  return state.players.find((p) => p.id === BOB)!.lifeNormalCoreCount;
}

/** バトル reset を模す: battleEntities を空にする。 */
function afterBattleReset(state: GameState): GameState {
  return { ...state, battleEntities: [] };
}

describe("grant_effect 収集時ゲート: scope 条件（in_battle:attacking）", () => {
  it("grantee がアタック中なら battle_end で pending を積む（検出時 reset 前に in_battle=true）", () => {
    const state = registeredState({ attacking: true });
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [battleEndEvent("target-0")],
      getDef
    );
    expect(grantedPendings(next)).toHaveLength(1);
  });

  it("grantee がアタックしていなければ pending を積まない（scope ゲート不成立）", () => {
    const state = registeredState({ attacking: false });
    const next = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [battleEndEvent("target-0")],
      getDef
    );
    expect(grantedPendings(next)).toHaveLength(0);
  });

  it("解決が reset 後でも scope 条件は除外され effect が適用される", () => {
    const state = registeredState({ attacking: true });
    expect(bobLife(state)).toBe(5);
    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [battleEndEvent("target-0")],
      getDef
    );
    const pendingId = grantedPendings(queued)[0]!.pendingId;
    // バトル reset 後（battleEntities が空）でも適用される。
    const resolved = resolveMechanicPending(
      afterBattleReset(queued),
      pendingId
    );
    expect(bobLife(resolved)).toBe(4);
  });

  it("value 条件は解決時に評価される: count 不足なら適用されない", () => {
    const state = registeredState({
      attacking: true,
      minCount: 9,
      countValue: 0,
    });
    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [battleEndEvent("target-0")],
      getDef
    );
    // scope は満たすので検出はされる。
    expect(grantedPendings(queued)).toHaveLength(1);
    const pendingId = grantedPendings(queued)[0]!.pendingId;
    const resolved = resolveMechanicPending(
      afterBattleReset(queued),
      pendingId
    );
    // count_value(min 9) が解決時 false → effect 不発（ライフ不変）。
    expect(bobLife(resolved)).toBe(5);
  });

  it("value 条件は解決時に評価される: count 充足なら適用される", () => {
    const state = registeredState({
      attacking: true,
      minCount: 9,
      countValue: 9,
    });
    const queued = queueGrantedEffectTriggersFromTriggerEvents(
      state,
      [battleEndEvent("target-0")],
      getDef
    );
    const pendingId = grantedPendings(queued)[0]!.pendingId;
    const resolved = resolveMechanicPending(
      afterBattleReset(queued),
      pendingId
    );
    expect(bobLife(resolved)).toBe(4);
  });
});
