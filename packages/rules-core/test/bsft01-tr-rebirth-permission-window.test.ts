/**
 * BSFT01 TR系 鍵ブレイヴ【転醒:自分のライフ1以上】許可窓の実装検証
 * (bsft01-tr-rebirth-permission-window)。
 *
 * 原文（全13枚共通パターン）: 「このカードのフラッシュ/スタック/メイン効果が使用されたとき、
 * 効果発揮後、このカードを自分のスピリットに合体させるか、裏返せる。このとき、自分の
 * フィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。」
 *
 * 実装方針: 対象 flash/stack/main 効果の steps 末尾に
 * connector:"after_triggers" で派生効果を待ち、ライフ条件を満たすと許可窓を開く。
 * 本文対象が0でも使用は成立するため、本文ステップの実行/成功を条件にしない。
 * executionMode:"optional" な rebirth の内包コア選択で任意コア配置を行う。
 *
 * 『合体させるか』の合体分岐 (ENGINE-bsft01-tr-rebirth-brave-combine-branch) は
 * brave_combine_effect (effect step から発揮する合体 primitive) で実装済み。
 * rebirth_window (裏返す) が不発だったときのみ combine_window (合体) を独立した
 * 相互排他の optional ステップとして提示する（rebirth 分岐は本ファイルで検証、
 * combine 分岐は bsft01-cards.test.ts の各カード側で構造検証する）。
 */
import { describe, expect, it } from "vitest";
import { applyLegalAction, getLegalActions } from "../src";
import {
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "../src/effect/structured-effect-registrations";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition } from "../src/model";

function buildLookups() {
  const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
  const map = new Map(expanded.map((d) => [d.cardNo, d]));
  return {
    getCardDefinitionById: (id: string) => map.get(id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(expanded),
  };
}

/** effects[1] (merged flash/stack/main + rebirth window) を取得する。 */
function getMergedEffect(def: CardDefinition) {
  const effect = (def.effects ?? [])[1];
  if (!effect) throw new Error(`${def.cardNo} effects[1] not found`);
  return effect;
}

describe("BSFT01 TR系【転醒】許可窓 (bsft01-tr-rebirth-permission-window)", () => {
  it("TR02(A) effects[1] は rebirth_window と combine_window (合体分岐) の両方を持つ", () => {
    const lookups = buildLookups();
    const front = lookups.getCardDefinitionById("BSFT01-TR02(A)")!;
    const effect = getMergedEffect(front);
    expect(effect.stub).toBeUndefined();
    expect(effect.steps.some((s) => s.action.kind === "rebirth")).toBe(true);
    expect(
      effect.steps.some((s) => s.action.kind === "brave_combine_effect")
    ).toBe(true);
  });

  it("TR01(A) effects[1] はフラッシュ本体(grant_effect_source_prevention_immunity)に加え rebirth_window/combine_window を持つ", () => {
    const lookups = buildLookups();
    const front = lookups.getCardDefinitionById("BSFT01-TR01(A)")!;
    const effect = getMergedEffect(front);
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(effect.steps[0]!.action).toEqual({
      kind: "grant_effect_source_prevention_immunity",
      player: "self",
      sourceScope: { tribes: ["星霊", "鍵"] },
      appliesTo: ["stack_negate", "prevention"],
      preventionBypass: {
        kind: "preventing_effect_filter",
        filter: { categories: ["nexus", "ultimate"] },
      },
      duration: { scope: "turn" },
    });
    expect(effect.steps.some((s) => s.action.kind === "rebirth")).toBe(true);
    expect(
      effect.steps.some((s) => s.action.kind === "brave_combine_effect")
    ).toBe(true);
  });

  it("TR04(A): rebirth 許可窓を直接 execute → 裏返り + 任意コア配置 pending が立つ", () => {
    const lookups = buildLookups();
    const front = lookups.getCardDefinitionById("BSFT01-TR04(A)")!;
    const effect = getMergedEffect(front);

    const brave = createCardInstance(front, {
      instanceId: "tr04",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 2,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
      cardInstances: [brave],
    });

    const afterBody = executeEffect({
      chainId: "test:bsft01-tr-rebirth-permission-window:101",
      state,
      effect,
      sourceInstanceId: "tr04",
      actingPlayerId: "alice",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });

    // rebirth 許可窓 (executionMode:optional) の pendingStepOptionalChoice が立つ。
    const pending = afterBody.pendingStepOptionalChoice;
    expect(pending).not.toBeNull();
    expect(pending!.sourceInstanceId).toBe("tr04");

    const afterExecute = applyLegalAction({
      state: afterBody,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending!.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: pending!.actingPlayerId,
        pendingId: pending!.pendingId,
        sourceInstanceId: pending!.sourceInstanceId,
        effectIndex: pending!.effectIndex,
        stepIndex: pending!.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    }).state;

    // 直後の「このとき」コア配置が確定するまで、実カードは A 面のまま。
    const virtual = afterExecute.cardInstances.find(
      (c) => c.instanceId === "tr04"
    )!;
    expect(virtual.definitionId).toBe("BSFT01-TR04(A)");
    expect(afterExecute.players.find((p) => p.id === "alice")!.countValue).toBe(
      0
    );

    // 任意コア配置 pending (field_and_reserve, 単一対象=自身) が立つ。
    const corePending = afterExecute.pendingCoreDistribution;
    expect(corePending).not.toBeNull();
    expect(corePending!.fromKind).toBe("any_movable");
    expect(corePending!.candidates.map((c) => c.instanceId)).toEqual(["tr04"]);
    expect(corePending!.sourceAvailable?.["reserve"]).toBe(3);

    const resolveAction = getLegalActions({
      state: afterExecute,
      actingPlayerId: "alice",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(resolveAction).toBeDefined();

    const resolved = applyLegalAction({
      state: afterExecute,
      action: resolveAction!,
      getCardDefinitionById: lookups.getCardDefinitionById,
      coreDistributionAllocations: { tr04: 3 },
      coreDistributionSourceAllocations: { reserve: 3 },
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    });

    expect(resolved.state.pendingCoreDistribution).toBeNull();
    expect(
      resolved.state.cardInstances.find((c) => c.instanceId === "tr04")!
        .definitionId
    ).toBe("BSFT01-TR04(B)");
    expect(
      resolved.state.players.find((p) => p.id === "alice")!.countValue
    ).toBe(1);
    expect(
      resolved.state.cardInstances.find((c) => c.instanceId === "tr04")!
        .normalCoreCount
    ).toBe(2 + 3);
    expect(
      resolved.state.players.find((p) => p.id === "alice")!
        .reserveNormalCoreCount
    ).toBe(0);
  });

  it("TR04(A): rebirth 許可窓を decline → 裏返らず、任意コア配置 pending も立たない", () => {
    const lookups = buildLookups();
    const front = lookups.getCardDefinitionById("BSFT01-TR04(A)")!;
    const effect = getMergedEffect(front);

    const brave = createCardInstance(front, {
      instanceId: "tr04",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [brave],
    });

    const afterBody = executeEffect({
      chainId: "test:bsft01-tr-rebirth-permission-window:205",
      state,
      effect,
      sourceInstanceId: "tr04",
      actingPlayerId: "alice",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const pending = afterBody.pendingStepOptionalChoice!;

    const afterDecline = applyLegalAction({
      state: afterBody,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    }).state;

    const stillFront = afterDecline.cardInstances.find(
      (c) => c.instanceId === "tr04"
    )!;
    expect(stillFront.definitionId).toBe("BSFT01-TR04(A)");
    expect(afterDecline.pendingCoreDistribution).toBeNull();
  });

  it("TR04(A): rebirth 許可窓を decline → コアが利用可能でも任意コア配置 pending は立たない (ref_succeeded gate の実証)", () => {
    const lookups = buildLookups();
    const front = lookups.getCardDefinitionById("BSFT01-TR04(A)")!;
    const effect = getMergedEffect(front);

    const brave = createCardInstance(front, {
      instanceId: "tr04",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    // コアは十分にある状態で decline する。charge ステップが「コアが0だから何もしない」
    // のではなく、rebirth_window の ref_succeeded gate 自体で止まっていることを示す。
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
      cardInstances: [brave],
    });

    const afterBody = executeEffect({
      chainId: "test:bsft01-tr-rebirth-permission-window:262",
      state,
      effect,
      sourceInstanceId: "tr04",
      actingPlayerId: "alice",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const pending = afterBody.pendingStepOptionalChoice!;

    const afterDecline = applyLegalAction({
      state: afterBody,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    }).state;

    expect(
      afterDecline.cardInstances.find((c) => c.instanceId === "tr04")!
        .definitionId
    ).toBe("BSFT01-TR04(A)");
    expect(afterDecline.pendingCoreDistribution).toBeNull();
    // コアはリザーブに残ったまま (charge ステップが動いていない証拠)。
    expect(
      afterDecline.players.find((p) => p.id === "alice")!.reserveNormalCoreCount
    ).toBe(5);
  });

  it("TR04(A): 対象効果本体が0対象でも使用後の許可窓は開く", () => {
    const lookups = buildLookups();
    const front = lookups.getCardDefinitionById("BSFT01-TR04(A)")!;
    const effect = getMergedEffect(front);

    // 相手のネクサスが0体 (destroy count:{min:0,max:3} が0対象で不発) でも、
    // flash_body (core_move, 創界神ネクサス0体で影響0) の実行自体は行われる。
    const brave = createCardInstance(front, {
      instanceId: "tr04",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [brave],
    });

    const afterBody = executeEffect({
      chainId: "test:bsft01-tr-rebirth-permission-window:322",
      state,
      effect,
      sourceInstanceId: "tr04",
      actingPlayerId: "alice",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });

    // 相手ネクサスが存在しないため destroy/core_move はどちらも無影響だが、
    // 「フラッシュ効果が使用された」ため、本文の処理件数によらず許可窓は開く。
    const pending = afterBody.pendingStepOptionalChoice;
    expect(pending).not.toBeNull();
    expect(pending!.sourceInstanceId).toBe("tr04");
  });

  it("TR04(A): 合体中のブレイヴが転醒しても、任意コア配置の対象は合体先ホストではなく発動元ブレイヴ自身 (source_card)", () => {
    const lookups = buildLookups();
    const front = lookups.getCardDefinitionById("BSFT01-TR04(A)")!;
    const effect = getMergedEffect(front);
    const lucy = lookups.getCardDefinitionById("BSFT01-CX01")!;

    const host = createCardInstance(lucy, {
      instanceId: "host-lucy",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const brave = createCardInstance(front, {
      instanceId: "tr04",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 2,
      attachedToInstanceId: "host-lucy",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
      cardInstances: [host, brave],
    });

    const afterBody = executeEffect({
      chainId: "test:bsft01-tr-rebirth-permission-window:367",
      state,
      effect,
      sourceInstanceId: "tr04",
      actingPlayerId: "alice",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const pending = afterBody.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
      state: afterBody,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    }).state;

    // この時点では仮想転醒 pending 中なので、合体状態の A 面のまま。
    const virtual = afterExecute.cardInstances.find(
      (c) => c.instanceId === "tr04"
    )!;
    expect(virtual.definitionId).toBe("BSFT01-TR04(A)");
    expect(virtual.attachedToInstanceId).toBe("host-lucy");

    // 任意コア配置 pending の対象は合体先ホスト (host-lucy) ではなく、
    // 転醒した発動元ブレイヴ自身 (tr04)。to:{kind:"source_card"} が
    // resolveSelfReferenceCard の host redirect を経由しないことの実証。
    const corePending = afterExecute.pendingCoreDistribution;
    expect(corePending).not.toBeNull();
    expect(corePending!.candidates.map((c) => c.instanceId)).toEqual(["tr04"]);
  });

  it("field_and_reserve_self: フィールドの他カードのコアもソース候補に含まれる", () => {
    const lookups = buildLookups();
    const front = lookups.getCardDefinitionById("BSFT01-TR04(A)")!;
    const effect = getMergedEffect(front);
    const lucy = lookups.getCardDefinitionById("BSFT01-CX01")!;

    const brave = createCardInstance(front, {
      instanceId: "tr04",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      // TR04(B) Lv1 requiredCores:1 を満たす最低限のコアを持たせる (0 だと
      // executeRebirth が lv-deficit で flip を中断してしまう)。
      normalCoreCount: 1,
    });
    const fieldSource = createCardInstance(lucy, {
      instanceId: "field-source",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 4,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 2 }, {}],
      cardInstances: [brave, fieldSource],
    });

    const afterBody = executeEffect({
      chainId: "test:bsft01-tr-rebirth-permission-window:440",
      state,
      effect,
      sourceInstanceId: "tr04",
      actingPlayerId: "alice",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const pending = afterBody.pendingStepOptionalChoice!;
    const afterExecute = applyLegalAction({
      state: afterBody,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: pending.actingPlayerId,
        pendingId: pending.pendingId,
        sourceInstanceId: pending.sourceInstanceId,
        effectIndex: pending.effectIndex,
        stepIndex: pending.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    }).state;

    const corePending = afterExecute.pendingCoreDistribution!;
    expect(corePending.sourceAvailable?.["reserve"]).toBe(2);
    expect(corePending.sourceAvailable?.["field:field-source"]).toBe(4);
    expect(corePending.totalNormalCores).toBe(6);

    const resolved = applyLegalAction({
      state: afterExecute,
      action: getLegalActions({
        state: afterExecute,
        actingPlayerId: "alice",
        getCardDefinitionById: lookups.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          lookups.getRegisteredTriggeredEffectActions,
      }).find((a) => a.kind === "resolve_pending_core_distribution")!,
      getCardDefinitionById: lookups.getCardDefinitionById,
      coreDistributionAllocations: { tr04: 4 },
      coreDistributionSourceAllocations: {
        reserve: 1,
        "field:field-source": 3,
      },
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    });

    expect(
      resolved.state.cardInstances.find((c) => c.instanceId === "tr04")!
        .normalCoreCount
      // 転醒で維持した1個 + 分配された4個 = 5個。
    ).toBe(1 + 4);
    expect(
      resolved.state.cardInstances.find((c) => c.instanceId === "field-source")!
        .normalCoreCount
    ).toBe(1);
    expect(
      resolved.state.players.find((p) => p.id === "alice")!
        .reserveNormalCoreCount
    ).toBe(1);
  });

  it("TR04(A): rebirth 許可窓を decline → combine_window (合体) が独立した optional として開き、合体先ホストへ合体できる", () => {
    const lookups = buildLookups();
    const front = lookups.getCardDefinitionById("BSFT01-TR04(A)")!;
    const effect = getMergedEffect(front);
    const lucy = lookups.getCardDefinitionById("BSFT01-CX01")!;

    const brave = createCardInstance(front, {
      instanceId: "tr04",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 2,
    });
    const host = createCardInstance(lucy, {
      instanceId: "host-lucy",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
      cardInstances: [brave, host],
    });

    const afterBody = executeEffect({
      chainId: "test:bsft01-tr-rebirth-permission-window:535",
      state,
      effect,
      sourceInstanceId: "tr04",
      actingPlayerId: "alice",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const rebirthPending = afterBody.pendingStepOptionalChoice!;
    expect(rebirthPending.sourceInstanceId).toBe("tr04");

    const afterDeclineRebirth = applyLegalAction({
      state: afterBody,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${rebirthPending.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: rebirthPending.actingPlayerId,
        pendingId: rebirthPending.pendingId,
        sourceInstanceId: rebirthPending.sourceInstanceId,
        effectIndex: rebirthPending.effectIndex,
        stepIndex: rebirthPending.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    }).state;

    // rebirth_window を decline した直後、combine_window の pendingStepOptionalChoice が独立して開く。
    const combinePending = afterDeclineRebirth.pendingStepOptionalChoice!;
    expect(combinePending).not.toBeNull();
    expect(combinePending.sourceInstanceId).toBe("tr04");

    const afterExecuteCombine = applyLegalAction({
      state: afterDeclineRebirth,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${combinePending.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: combinePending.actingPlayerId,
        pendingId: combinePending.pendingId,
        sourceInstanceId: combinePending.sourceInstanceId,
        effectIndex: combinePending.effectIndex,
        stepIndex: combinePending.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    }).state;

    // 合体成立: ブレイヴは裏返らず (definitionId 不変)、ホストへ attach。
    const combinedBrave = afterExecuteCombine.cardInstances.find(
      (c) => c.instanceId === "tr04"
    )!;
    expect(combinedBrave.definitionId).toBe("BSFT01-TR04(A)");
    expect(combinedBrave.attachedToInstanceId).toBe("host-lucy");
    expect(combinedBrave.normalCoreCount).toBe(0);
    const combinedHost = afterExecuteCombine.cardInstances.find(
      (c) => c.instanceId === "host-lucy"
    )!;
    expect(combinedHost.attachedChildrenIds).toContain("tr04");
    // ブレイヴのコア (2個) はホストへ移る (executeBraveCombine の SSOT)。
    expect(combinedHost.normalCoreCount).toBe(1 + 2);

    // 合体分岐は、原文「この転醒後スピリットに置く」ではないため任意コア配置 pending を開かない。
    expect(afterExecuteCombine.pendingCoreDistribution).toBeNull();
  });

  it("TR04(A): 合体先候補は braveCondition (「ルーシィ・ハートフィリア」名) を満たすスピリットに限る", () => {
    const lookups = buildLookups();
    const front = lookups.getCardDefinitionById("BSFT01-TR04(A)")!;
    const effect = getMergedEffect(front);
    // ルーシィ以外の自分のスピリット (braveCondition 不一致)。
    const otherSpiritDef = lookups.getCardDefinitionById("BSFT01-TR04(B)")!;

    const brave = createCardInstance(front, {
      instanceId: "tr04",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
    });
    const otherSpirit = createCardInstance(otherSpiritDef, {
      instanceId: "other-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "spirit",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [brave, otherSpirit],
    });

    const afterBody = executeEffect({
      chainId: "test:bsft01-tr-rebirth-permission-window:635",
      state,
      effect,
      sourceInstanceId: "tr04",
      actingPlayerId: "alice",
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const rebirthPending = afterBody.pendingStepOptionalChoice!;
    const afterDeclineRebirth = applyLegalAction({
      state: afterBody,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${rebirthPending.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: rebirthPending.actingPlayerId,
        pendingId: rebirthPending.pendingId,
        sourceInstanceId: rebirthPending.sourceInstanceId,
        effectIndex: rebirthPending.effectIndex,
        stepIndex: rebirthPending.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById: lookups.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        lookups.getRegisteredTriggeredEffectActions,
    }).state;

    // combine_window 自体は開く (executionMode:optional の条件は満たす) が、
    // 候補 (「ルーシィ・ハートフィリア」名一致) が居ないため execute できない。
    const combinePending = afterDeclineRebirth.pendingStepOptionalChoice;
    expect(combinePending).not.toBeNull();
    expect(combinePending!.canExecute).toBe(false);
  });
});
