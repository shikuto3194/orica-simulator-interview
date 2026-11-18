/**
 * 離脱→魂状態化 (非契約カード): FieldExitReplacement の soul_state 変種。
 *
 * 検証対象: 「相手によってフィールドを離れたこのスピリットは魂状態にできる」(BSGE01-R01..R05)。
 *   契約カードはルールで自動付与される魂状態化 (08a L171) を、明示テキストを持つ非契約スピリットへ
 *   `effect_resistance` の `replacement: { kind: "soul_state" }` CE で付与する。
 *   - 08a L158-159「相手によって フィールドを離れるとき、魂状態で残す選択可」
 *     「魂状態化時、上のコアは全てリザーブへ移動」。
 *
 * 機構: checkSoulStateReplacement (flushPendingLeaves 内) が契約カードに加え、
 *   replace_field_exit CE で metadata.replacement.kind === "soul_state" を持つカードも
 *   適格と判定し pendingSoulStateReplacement を立てる。解決は契約カードと共通の
 *   resolveSoulStateReplacement / legal-action resolve_soul_state_replacement 経路。
 */
import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  flushPendingLeaves,
  getLegalActions,
} from "../src";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  GameState,
  PendingLeaveEntity,
} from "../src";

const ALICE = "player-1";
const BOB = "player-2";
const GE_NO = "TEST-GE-LINKAID";

// 非契約の GE スピリット定義 (契約カードでないことが本テストの肝)。
function geDef(): CardDefinition {
  return {
    cardNo: GE_NO,
    name: "GE スピリット",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 2,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 3000 },
      { level: 2, requiredCores: 2, bp: 5000 },
    ],
    textLines: [],
    images: {},
    tribe: "神喰・GE",
    keywordTags: ["soul_state"],
  } as CardDefinition;
}

const GE_DEF = geDef();
const defMap = new Map<string, CardDefinition>([[GE_NO, GE_DEF]]);
const getDef = (id: string): CardDefinition | undefined => defMap.get(id);
const noLookups = { getCardDefinitionById: getDef } as const;

function geCard(instanceId: string, cores = 2): CardInstance {
  return createCardInstance(GE_DEF, {
    instanceId,
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
    pendingLeaveKind: "destroy",
    pendingLeaveCause: "effect_resolution",
    pendingLeaveChainId: `chain-${instanceId}`,
  });
}

function pendingDestroy(
  instanceId: string,
  causePlayerId: string | null = BOB
): PendingLeaveEntity {
  return {
    instanceId,
    kind: "destroy",
    cause: "effect_resolution",
    causePlayerId,
    chainId: `chain-${instanceId}`,
    deferZoneMoveUntilChainEnd: false,
    leaveFieldCoreDestinationOverride: null,
  };
}

// executeEffectResistance が production で生成する CE と同形 (per-target snapshot 経路、
// replace_field_exit は常に snapshot)。
function soulStateReplacementCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `ce-soul-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: GE_NO,
    actingPlayerId: ALICE,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "replace_field_exit",
    targetInstanceId,
    metadata: {
      trigger: "leave_field",
      source: "opponent_effect",
      replacement: { kind: "soul_state" },
    },
  } as ContinuousEffect;
}

const getCard = (s: GameState, id: string): CardInstance =>
  s.cardInstances.find((c) => c.instanceId === id)!;
const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

function withGePending(cores = 2): GameState {
  const card = geCard("ge", cores);
  const state = createEmptyGameState({
    cardInstances: [card],
    // contractCardNo を持たない = 非契約。
    playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
  });
  state.activeContinuousEffects = [soulStateReplacementCE("ge")];
  state.pendingLeaveEntities = [pendingDestroy("ge", BOB)];
  const afterFlush = flushPendingLeaves(state, getDef, ["red"]);
  return afterFlush;
}

describe("離脱→魂状態化 (非契約 soul_state 置換 CE)", () => {
  it("(1) 相手起因離脱で pending を立て、選択プレイヤーに keep / decline が提示される", () => {
    const state = withGePending(2);
    expect(state.pendingSoulStateReplacement).not.toBeNull();
    expect(state.pendingSoulStateReplacement!.cardInstanceId).toBe("ge");
    expect(state.pendingSoulStateReplacement!.choosingPlayerId).toBe(ALICE);
    // カードはまだフィールド (フラッシュ保留)。
    expect(getCard(state, "ge").zone).toBe("field");

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...noLookups,
    });
    const resolveActions = actions.filter(
      (a) => a.kind === "resolve_soul_state_replacement"
    );
    expect(resolveActions).toHaveLength(2);
  });

  it("(2) choice=keep で魂状態化 (コア→リザーブ)、フィールド残留", () => {
    const state = withGePending(2);
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...noLookups,
    });
    const keepAction = actions.find(
      (a) =>
        a.kind === "resolve_soul_state_replacement" &&
        (a as { choice?: string }).choice === "keep"
    )!;
    const applied = applyLegalAction({
      state,
      action: keepAction,
      ...noLookups,
    });

    expect(applied.state.pendingSoulStateReplacement).toBeNull();
    const cardAfter = getCard(applied.state, "ge");
    // 魂状態としてフィールドに残留 (トラッシュへ行かない)。
    expect(cardAfter.zone).toBe("field");
    // 08a L159: 上のコアは全てリザーブへ。
    expect(cardAfter.normalCoreCount).toBe(0);
    expect(alice(applied.state).reserveNormalCoreCount).toBe(2);
    expect(alice(applied.state).soulStateInstanceIds).toContain("ge");
    expect(cardAfter.pendingLeaveKind).toBeNull();
  });

  it("(3) choice=decline で通常離脱", () => {
    const state = withGePending(2);
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...noLookups,
    });
    const declineAction = actions.find(
      (a) =>
        a.kind === "resolve_soul_state_replacement" &&
        (a as { choice?: string }).choice === "decline"
    )!;
    const applied = applyLegalAction({
      state,
      action: declineAction,
      ...noLookups,
    });

    expect(applied.state.pendingSoulStateReplacement).toBeNull();
    expect(alice(applied.state).soulStateInstanceIds).not.toContain("ge");
    expect(
      applied.state.pendingLeaveEntities.find((pl) => pl.instanceId === "ge")
    ).toBeUndefined();
    expect(getCard(applied.state, "ge").zone).toBe("trash");
  });

  it("(4) 自分起因離脱 (causePlayerId=自分) では魂状態化 pending を立てない", () => {
    const card = geCard("ge", 2);
    const state = createEmptyGameState({
      cardInstances: [card],
      playerOverrides: [{ reserveNormalCoreCount: 0 }, {}],
    });
    state.activeContinuousEffects = [soulStateReplacementCE("ge")];
    // 自分 (ALICE) 起因の離脱 = source: "opponent_effect" にマッチしない。
    state.pendingLeaveEntities = [pendingDestroy("ge", ALICE)];
    const afterFlush = flushPendingLeaves(state, getDef, ["red"]);
    expect(afterFlush.pendingSoulStateReplacement).toBeNull();
    // 通常通りトラッシュへ。
    expect(getCard(afterFlush, "ge").zone).toBe("trash");
  });
});
