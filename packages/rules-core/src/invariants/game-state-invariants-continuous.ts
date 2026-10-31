// ============================================================
// 継続効果 (activeContinuousEffects) の状態整合性チェック。
//
// 検出するもの:
// - missing_continuous_effect: フィールド/ミラージュ/バースト上のカードが
//   continuous 効果を持つのに、対応する CE が登録されていない。
// - stale_continuous_effect: provenance を持つ CE が、存在しない
//   sourceInstanceId / definitionId / effects[effectIndex] を指している。
//
// 設計詳細: manual/ai-reference/20_design/13_continuous-effect-state-integrity.md
// ============================================================

import {
  isActiveExternalContinuousEffectSource,
  rebuildContinuousEffectsFromField,
} from "../effect/continuous-effect-rebuild";
import type { GameStateInvariantIssue } from "./game-state-invariant-types";
import type { CardDefinition, GameState } from "../model";
import { resolveDefinitionEffect } from "../effect/definition-effect-reference";

interface CollectContinuousEffectInvariantOptions {
  state: GameState;
  issues: GameStateInvariantIssue[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}

/**
 * フィールド/ミラージュ/バースト上のカードと activeContinuousEffects の
 * 整合性を検査する。getCardDefinitionById が無いと判定できないため、
 * 呼び出し側はカード定義ルックアップを必須で渡す。
 *
 * 副作用なし — リビルダ呼び出しは新規 state を返すが、捨てるだけで
 * 入力 state を破壊しない。
 */
export function collectContinuousEffectInvariantIssues(
  options: CollectContinuousEffectInvariantOptions
): void {
  const { state, issues, getCardDefinitionById } = options;

  // --- stale 検出 ---
  // provenance を持つ CE は元の (sourceInstanceId, effectIndex) を辿れる
  for (const ce of state.activeContinuousEffects) {
    // retrigger CE は retriggerEffectIndex / retriggerStepIndex で別管理されているため除外
    if (ce.modifierTag === "retrigger") continue;
    if (!ce.provenance) continue;

    const source = state.cardInstances.find(
      (c) => c.instanceId === ce.sourceInstanceId
    );
    if (!source) {
      issues.push({
        code: "stale_continuous_effect",
        path: `activeContinuousEffects[${ce.effectId}]`,
        message: `source card instance "${ce.sourceInstanceId}" not found`,
      });
      continue;
    }

    const hasExternalEffectSource =
      ce.provenance.effectSourceInstanceId !== undefined &&
      ce.provenance.effectSourceInstanceId !== ce.sourceInstanceId;
    let effectSourceCurrentDefinitionId: string | undefined;
    if (ce.provenance.effectSourceInstanceId !== undefined) {
      const effectSource = state.cardInstances.find(
        (c) => c.instanceId === ce.provenance?.effectSourceInstanceId
      );
      if (!effectSource) {
        issues.push({
          code: "stale_continuous_effect",
          path: `activeContinuousEffects[${ce.effectId}]`,
          message: `effect source card instance "${ce.provenance.effectSourceInstanceId}" not found`,
        });
        continue;
      }
      effectSourceCurrentDefinitionId = effectSource.definitionId;
    }

    const definitionId =
      ce.provenance.effectSourceDefinitionId ??
      (hasExternalEffectSource
        ? effectSourceCurrentDefinitionId
        : ce.sourceDefinitionId);
    if (definitionId === undefined) {
      issues.push({
        code: "stale_continuous_effect",
        path: `activeContinuousEffects[${ce.effectId}]`,
        message: `effect source definition for "${ce.sourceInstanceId}" not found`,
      });
      continue;
    }
    const def = getCardDefinitionById(definitionId);
    if (!def) {
      issues.push({
        code: "stale_continuous_effect",
        path: `activeContinuousEffects[${ce.effectId}]`,
        message: `card definition "${definitionId}" not found`,
      });
      continue;
    }

    if (ce.provenance.definitionPath === null) continue;
    const effect = resolveDefinitionEffect(
      def,
      ce.provenance.effectIndex,
      ce.provenance.definitionPath
    );
    if (!effect) {
      issues.push({
        code: "stale_continuous_effect",
        path: `activeContinuousEffects[${ce.effectId}]`,
        message: `effects[${ce.provenance.effectIndex}] does not exist on definition "${definitionId}"`,
      });
      continue;
    }
    // 外部カードの発揮元が現在も有効であることは、そのカード自身の continuous
    // 効果を host に集約する場合だけの前提。card_event / flash 等が既に発揮して
    // 作った時間指定 CE は、その後発揮元が離場しても duration に従って残る。
    if (hasExternalEffectSource && effect.timing.kind === "continuous") {
      const sourceDefinition = getCardDefinitionById(source.definitionId);
      if (
        !sourceDefinition ||
        !isActiveExternalContinuousEffectSource({
          state,
          hostCard: source,
          hostDefinition: sourceDefinition,
          effectSourceInstanceId: ce.provenance.effectSourceInstanceId!,
          ...(ce.provenance.effectSourceDefinitionId !== undefined
            ? {
                effectSourceDefinitionId:
                  ce.provenance.effectSourceDefinitionId,
              }
            : {}),
        })
      ) {
        issues.push({
          code: "stale_continuous_effect",
          path: `activeContinuousEffects[${ce.effectId}]`,
          message: `effect source card instance "${ce.provenance.effectSourceInstanceId}" is not an active external continuous effect source for "${ce.sourceInstanceId}"`,
        });
        continue;
      }
    }
    if (
      !hasExternalEffectSource &&
      effect.timing.kind === "continuous" &&
      source.definitionId !== ce.sourceDefinitionId
    ) {
      issues.push({
        code: "stale_continuous_effect",
        path: `activeContinuousEffects[${ce.effectId}]`,
        message:
          `source definition changed from "${ce.sourceDefinitionId}" to ` +
          `"${source.definitionId}" for continuous effect effects[${ce.provenance.effectIndex}]`,
      });
    }
  }

  // --- missing 検出 ---
  // リビルダを実行し、新規追加される CE があれば「未登録」として扱う。
  // 入力 state は破壊せず、戻り値の差分だけ見る。
  // 結果を捨てる用途なので、createdAtTurn / createdAtAttackId 汚染を気にせず
  // unsafeAllowDuringBattle で安全ガードをバイパスする。
  // 離脱待機中の field カードは待機前からの CE だけ継続し、新規 CE は登録しない。
  const rebuilt = rebuildContinuousEffectsFromField(
    state,
    getCardDefinitionById,
    {
      unsafeAllowDuringBattle: true,
      skipNewFieldEffectsFromPendingLeave: true,
    }
  );
  if (
    rebuilt.activeContinuousEffects.length >
    state.activeContinuousEffects.length
  ) {
    const existingIds = new Set(
      state.activeContinuousEffects.map((c) => c.effectId)
    );
    for (const ce of rebuilt.activeContinuousEffects) {
      if (existingIds.has(ce.effectId)) continue;
      const effectIndex = ce.provenance?.effectIndex ?? -1;
      issues.push({
        code: "missing_continuous_effect",
        path: `activeContinuousEffects[${ce.sourceInstanceId}:${effectIndex}]`,
        message: `expected CE for source="${ce.sourceInstanceId}" effectIndex=${effectIndex} (modifierTag=${ce.modifierTag}) not registered`,
      });
    }
  }
}
