// P2-14 inc2-3: effect-interpreter god-file 分解。継続効果(CE)登録系 native handler 群
// (act_as_spirit/grant/redirect 登録・使用制限・対象リダイレクト・効果抑制/プロパティ上書き)
// を兄弟ファイルへ抽出。共有 helper nextDslCeId は native-action-shared から一方向 import
// (P2-14 inc5 で循環解消)。barrel/振る舞い不変。

import { nextDslCeId } from "./native-action-shared";
import { sameDefinitionEffectPath } from "./definition-effect-reference";
import {
  EXTRA_APPLICABILITY_ZONES,
  recordDynamicEffectSuppressionTargetHistory,
} from "./continuous-effect-rebuild";
import { getCardById } from "../card/card-lookup";
import { getCEsForTarget } from "../card/ce-lookup";
import { resolveAmount, resolveTargetSpec } from "./target-resolution";
import { createStepExecutionContext } from "../step-execution-context";
import { resolvePlayerRef } from "./structured-effect-interpreter";
import {
  resolvePlayerAffect,
  resolveCardImmunityAffect,
} from "./effect-affect-adapter";
import { getEffectiveCategory } from "../mechanics/act-as-spirit";
import {
  getEffectiveBp,
  getCombinedUnitSymbolBundles,
} from "../battle/battle-shared";
import { adventSourceIdsOf } from "../model";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  ContinuousEffectTag,
  EffectPreventionLevel,
  EffectPlayerRef,
  GameState,
} from "../model";
import type { CardFilter, DSL, Effect, TargetSpec } from "../dsl-types";
import type { StepExecutionContext } from "../step-execution-context";
import type { TargetLockBypassProfile } from "./target-affect-gate";
import { snapshotTargetedDisclosureTargetZones } from "./targeted-disclosure-target-snapshot";

// --- register_act_as_spirit: act_as_spirit CE 登録 (P3-47 F-2 Step 6) ---

/**
 * 任意のカードに act_as_spirit ContinuousEffect を登録する。
 *
 * lifecycle 規約 (act-as-spirit.ts):
 * - duration: 既定 `{ scope: "while_on_field" }` (host または target の
 *   フィールド離脱で recomputeContinuousEffects が CE を自動削除)
 * - sourceInstanceId: 効果の発動元 (host)
 * - targetInstanceId: target spec で解決した各カード
 *
 * statBlueprint:
 * - `live_copy_from_source` → metadata では `live_copy_from` に変換し
 *   `sourceInstanceId` に host (=本効果の sourceInstanceId) を埋める
 * - `static_copy` → snapshot をそのまま metadata に埋める
 */
export function executeRegisterActAsSpirit(
  action: DSL.RegisterActAsSpiritAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  effect: Effect,
  resolvedTargetIds?: string[],
  provenance?: ContinuousEffect["provenance"]
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const targets =
    resolvedTargetIds && resolvedTargetIds.length > 0
      ? resolvedTargetIds
      : resolveTargetSpec({
          targetSpec: action.target,
          state,
          actingPlayerId,
          sourceInstanceId,
          getCardDefinitionById,
          stepContext: createStepExecutionContext(state),
        }).map((c) => c.instanceId);

  if (targets.length === 0) return state;

  const blueprint =
    action.statBlueprint.kind === "live_copy_from_source"
      ? {
          kind: "live_copy_from" as const,
          sourceInstanceId,
          aspects: action.statBlueprint.aspects,
        }
      : action.statBlueprint;

  const duration = action.duration ?? { scope: "while_on_field" as const };

  const newEffects: ContinuousEffect[] = targets.map((targetId) => ({
    effectId: nextDslCeId("act_as_spirit"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "act_as_spirit" as ContinuousEffectTag,
    targetInstanceId: targetId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      statBlueprint: blueprint,
      ...(action.overrides ? { overrides: action.overrides } : {}),
    },
  }));

  state.log.push(`effect:register_act_as_spirit:${targets.length}targets`);
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
}

// --- grant_effect: 効果付与 CE 登録 (P3-99 §1-2) ---

function dynamicTargetFilterFromTargetSpec(
  target: TargetSpec
): ContinuousEffect["targetFilter"] | null {
  if (target.kind !== "filter" || target.count !== "all") return null;
  if (target.zone !== undefined) return null;
  if (target.excludeSelf === true) return null;
  // CardFilter 全体を素のスプレッドで渡す (guard-audit-card-filter-projection、
  // 2026-08-05 subset-type-unification)。旧実装はフィールド別 allowlist コピーで、
  // maxCost 等の新フィールドが黙って脱落していた。
  return {
    player: target.player,
    ...target.filter,
  };
}

/**
 * 「効果そのもの」を被付与カードへ一時付与する ContinuousEffect を登録する。
 *
 * act_as_spirit / redirect_effect_target と同じ登録パターン:
 * - sourceInstanceId: 発揮元 (grant 源)
 * - targetInstanceId: 被付与カード (複数解決時は各 instance に CE 1 件)
 * - metadata: { grantedEffect, grantPlayerRef }
 *
 * lifecycle 規約: duration 既定 `{ scope: "while_on_field" }` — 発揮元の離脱で
 * 付与は即座に停止する (04 §合体ブレイヴ単体破壊の一般化、recomputeContinuousEffects)。
 *
 * 注: grantedEffect を被付与カードのイベントで誘発/起動として発火させる「注入点」は
 * 本関数では行わない (P3-99 §3 で別イテレーション配線)。本関数は CE 登録のみ。
 */
export function executeRegisterGrantedEffect(
  action: DSL.RegisterGrantedEffectAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  effect: Effect,
  resolvedTargetIds?: string[],
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  if (action.grantedEffectSource?.kind === "advent_source_effects") {
    return executeRegisterGrantedEffectFromSource(
      action.grantedEffectSource,
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
      provenance
    );
  }
  const grantedEffect = action.grantedEffect;
  if (!grantedEffect && !action.grantedEffectSource) return state;

  const sourceCard = getCardById(state, sourceInstanceId);
  const duration = action.duration ?? { scope: "while_on_field" as const };
  const grantPlayerRef = action.grantPlayerRef ?? "self";
  // ENGINE-grant-effect-player-ref-wiring: grantPlayerRef の実行時解決は誘発 variant
  // (grantedEffect.timing.kind: card_event/game_event) のみ配線済み (grant-effect-system.ts
  // resolveGrantPendingActingPlayerId)。起動権 variant (timing.kind:"activated") は
  // legal-actions-availability.ts が grantee.controllerPlayerId 固定で未配線のため、
  // grantPlayerRef!=="self" との組み合わせは意図通り動作しない (verifier 2026-07-15 round3
  // 指摘)。fail-closed: 未対応組み合わせは登録自体を no-op にする
  // (structured-summon.ts hasUnsupportedTokenEnterCoreSourceMix と同型の前例)。
  if (grantPlayerRef !== "self" && grantedEffect?.timing.kind === "activated") {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:grant_effect:unsupported-player-ref-with-activated-variant:${grantPlayerRef}`,
      ],
    };
  }
  const dynamicTargetFilter =
    grantedEffect?.timing.kind === "card_event" &&
    action.target.kind === "filter" &&
    (action.target.filter.noTribes === true ||
      !!action.target.filter.filterOr?.length ||
      action.target.filter.hasBurstEffect !== undefined)
      ? dynamicTargetFilterFromTargetSpec(action.target)
      : null;
  if (dynamicTargetFilter) {
    const newEffect: ContinuousEffect = {
      effectId: nextDslCeId("granted_effect"),
      sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      actingPlayerId,
      duration,
      createdAtTurn: state.turnNumber,
      createdAtAttackId: state.activeAttack?.attackId ?? null,
      modifierTag: "granted_effect" as ContinuousEffectTag,
      targetFilter: dynamicTargetFilter,
      // timingScope による誘発発火ゲート (grant-effect-system.ts isCEActiveForScope) は
      // 「常時見直される継続効果」由来の grant のみに意味を持つ。timing.kind:"activated"
      // (スタック/フラッシュ等) は宣言時点で timingScope を既に満たしている一回限りの登録のため、
      // ここで timingScope を運ばない (BSFT01-TR05(A) 回帰: スタック宣言後に付与された CE が
      // 後続 leave_field で誤って再ゲートされていた)。
      ...(effect.timingScope && effect.timing.kind === "continuous"
        ? { timingScope: effect.timingScope }
        : {}),
      ...(provenance ? { provenance } : {}),
      metadata: {
        grantedEffect,
        grantPlayerRef,
      },
    };
    state.log.push(`effect:grant_effect:dynamic`);
    return {
      ...state,
      activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
    };
  }

  // engine-player-scoped-turn-reservation: 通常の `target:{kind:"self"}` 解決
  // (resolveTargetSpec) は zone==="field" を要求するため、使用後トラッシュへ行くマジック
  // 自身への自己付与 (turnReservation:true) では解決できない。sourceInstanceId は既知のため
  // ゾーン非依存で直接使う（BSKB01-R04 初出）。
  const targets =
    resolvedTargetIds && resolvedTargetIds.length > 0
      ? resolvedTargetIds
      : action.turnReservation && action.target.kind === "self"
        ? [sourceInstanceId]
        : resolveTargetSpec({
            targetSpec: action.target,
            state,
            actingPlayerId,
            sourceInstanceId,
            getCardDefinitionById,
            stepContext: createStepExecutionContext(state),
          }).map((c) => c.instanceId);

  if (targets.length === 0) return state;

  const newEffects: ContinuousEffect[] = targets.map((targetId) => ({
    effectId: nextDslCeId("granted_effect"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "granted_effect" as ContinuousEffectTag,
    targetInstanceId: targetId,
    // timingScope による誘発発火ゲートは continuous 由来の grant のみ (上記 dynamicTargetFilter
    // 分岐と同じ理由、BSFT01-TR05(A) 回帰対応)。
    ...(effect.timingScope && effect.timing.kind === "continuous"
      ? { timingScope: effect.timingScope }
      : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      grantedEffect,
      ...(action.grantedEffectSource
        ? { grantedEffectSource: action.grantedEffectSource }
        : {}),
      grantPlayerRef,
      ...(action.turnReservation ? { turnReservation: true } : {}),
    },
  }));

  state.log.push(`effect:grant_effect:${targets.length}targets`);
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
}

/**
 * P3-99 集約 variant: `grantedEffectSource` 指定時、target（通常 `{ kind: "self" }`）の
 * 煌臨元カード群（`adventSourceIdsOf`。多重煌臨で旧ホストも flat に含む、model.ts 参照）を
 * 走査し、`nameFilter` に一致する定義を名前で dedupe（同名は先勝ち1件、順序は
 * underCards 配列順）した上で、各定義の `effects[]` を1件ずつ通常の grantedEffect 登録
 * （既存パターン）に展開する。
 *
 * 1 回の呼び出しから複数の granted_effect CE が生成されるが、全 CE が呼び出し元
 * （このスピリット自身の集約継続効果）と同じ `provenance` を共有するため、
 * continuous-effect-rebuild.ts の isContinuousEffectStillValid がそのまま失効判定に使える
 * （OC 条件が外れれば集約 CE 群も一括失効。新規並行モデル不要 = SSOT）。
 *
 * `timing.kind === "continuous"` の候補効果は誘発 (queueGrantedEffectTriggersFromTriggerEvents
 * の declaredTriggerEvents 早期 return) にも起動権 variant (legal-actions-availability の
 * `timing.kind !== "activated"` ガード) にも注入点が無く登録しても永久に無反応の CE が残るだけ
 * のため、ここで除外する（継続効果の grant 伝播は P3-99 の別スコープ）。
 *
 * dedup 粒度 (issues/P3-99_grant-effect-primitive.md §残留懸念、解消): host 失効判定
 * (OC 条件不成立時の一括除去) は host provenance を SSOT のまま維持しつつ、本関数は
 * (advSourceInstanceId, sourceEffectIndex) 単位の子キー (`grantedEffectChildKey`, 各生成
 * CE の metadata に埋め込む) で「この (host effect宣言, target) 組み合わせで既に登録済みの
 * 子」を判定し、新規組み合わせのみ CE を追加する。呼び出し元
 * (continuous-effect-rebuild.ts の `isGrantEffectAggregatorDeclaration`) は
 * host 単位の早期 skip をバイパスし本関数を毎 rebuild サイクル再実行するため、初回登録後に
 * 新しい煌臨元カードが追加されても次サイクルで新規子 CE として展開される。
 */
function executeRegisterGrantedEffectFromSource(
  source: Extract<
    DSL.GrantedEffectSourceSpec,
    { kind: "advent_source_effects" }
  >,
  action: DSL.RegisterGrantedEffectAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  effect: Effect,
  resolvedTargetIds: string[] | undefined,
  provenance?: ContinuousEffect["provenance"]
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const duration = action.duration ?? { scope: "while_on_field" as const };
  const grantPlayerRef = action.grantPlayerRef ?? "self";

  const targets =
    resolvedTargetIds && resolvedTargetIds.length > 0
      ? resolvedTargetIds
      : resolveTargetSpec({
          targetSpec: action.target,
          state,
          actingPlayerId,
          sourceInstanceId,
          getCardDefinitionById,
          stepContext: createStepExecutionContext(state),
        }).map((c) => c.instanceId);

  if (targets.length === 0) return state;

  const newEffects: ContinuousEffect[] = [];
  for (const targetId of targets) {
    const hostCard = getCardById(state, targetId);
    if (!hostCard) continue;

    // (advSourceInstanceId, sourceEffectIndex) 単位で既に登録済みの子 CE を収集する
    // (同じ host effect宣言 + target の組み合わせに限定)。rebuild サイクル毎に本関数を
    // 再実行しても既存の子は再生成しない。
    const existingChildKeys = new Set<string>();
    for (const ce of state.activeContinuousEffects) {
      if (ce.modifierTag !== "granted_effect") continue;
      if (ce.sourceInstanceId !== sourceInstanceId) continue;
      if (ce.targetInstanceId !== targetId) continue;
      if (
        provenance !== undefined &&
        (ce.provenance?.effectIndex !== provenance.effectIndex ||
          !sameDefinitionEffectPath(
            ce.provenance.definitionPath,
            provenance.definitionPath
          ))
      ) {
        continue;
      }
      const childKey = ce.metadata?.grantedEffectChildKey as
        | { advSourceInstanceId: string; sourceEffectIndex: number }
        | undefined;
      if (childKey) {
        existingChildKeys.add(
          `${childKey.advSourceInstanceId}:${childKey.sourceEffectIndex}`
        );
      }
    }

    const seenNames = new Set<string>();
    for (const advSourceId of adventSourceIdsOf(hostCard)) {
      const advSourceCard = getCardById(state, advSourceId);
      if (!advSourceCard) continue;
      const advSourceDef = getCardDefinitionById(advSourceCard.definitionId);
      if (!advSourceDef) continue;
      if (!advSourceDef.name.includes(source.nameFilter.contains)) continue;
      if (seenNames.has(advSourceDef.name)) continue;
      seenNames.add(advSourceDef.name);

      const sourceEffects = advSourceDef.effects ?? [];
      for (
        let sourceEffectIndex = 0;
        sourceEffectIndex < sourceEffects.length;
        sourceEffectIndex++
      ) {
        const sourceEffect = sourceEffects[sourceEffectIndex]!;
        if (sourceEffect.timing.kind === "continuous") continue;
        // ENGINE-grant-effect-player-ref-wiring: 起動権 variant は grantPlayerRef 未配線
        // (executeRegisterGrantedEffect と同じ fail-closed 理由)。
        if (
          grantPlayerRef !== "self" &&
          sourceEffect.timing.kind === "activated"
        ) {
          continue;
        }
        if (existingChildKeys.has(`${advSourceId}:${sourceEffectIndex}`)) {
          continue;
        }
        newEffects.push({
          effectId: nextDslCeId("granted_effect"),
          sourceInstanceId,
          sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
          actingPlayerId,
          duration,
          createdAtTurn: state.turnNumber,
          createdAtAttackId: state.activeAttack?.attackId ?? null,
          modifierTag: "granted_effect" as ContinuousEffectTag,
          targetInstanceId: targetId,
          // 同上 (BSFT01-TR05(A) 回帰対応): continuous 由来の grant のみ timingScope を運ぶ。
          ...(effect.timingScope && effect.timing.kind === "continuous"
            ? { timingScope: effect.timingScope }
            : {}),
          ...(provenance ? { provenance } : {}),
          metadata: {
            grantedEffect: sourceEffect,
            grantPlayerRef,
            grantedEffectChildKey: {
              advSourceInstanceId: advSourceId,
              sourceEffectIndex,
            },
          },
        });
      }
    }
  }

  if (newEffects.length === 0) return state;

  state.log.push(`effect:grant_effect:aggregated:${newEffects.length}`);
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
}

export function executeUnderCardRoleGrant(
  action: DSL.UnderCardRoleGrantAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  resolvedTargetIds?: string[],
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const source = getCardById(state, sourceInstanceId);
  const filter = dynamicTargetFilterFromTargetSpec(action.target);
  const targets = filter
    ? [undefined]
    : (resolvedTargetIds ?? [sourceInstanceId]);
  const additions: ContinuousEffect[] = targets.map((targetInstanceId) => ({
    effectId: nextDslCeId("under_card_role"),
    sourceInstanceId,
    sourceDefinitionId: source?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    modifierTag: "under_card_role",
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    ...(targetInstanceId ? { targetInstanceId } : {}),
    ...(filter ? { targetFilter: filter } : {}),
    ...(provenance ? { provenance } : {}),
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    metadata: {
      roleTag: action.roleTag,
      faceDownCards: action.faceDownCards,
      virtualCount: action.virtualCount,
    },
  }));
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...additions],
  };
}

// --- grant_paid_prevention_immunity: 対価支払いで防止不可化する権利の CE 登録
//     (ENGINE-bsge01-r04-paid-prevention-immunity, BSGE01-R02/R04) ---

/**
 * 「host が効果を発揮するとき、対価を支払うことでその効果は相手の効果で防げなくなる」
 * 権利を CE として登録する。act_as_spirit と同じ単純な単一 CE/target 登録パターン。
 *
 * 本 CE は「権利がある」ことのみを表す。count cost は stack 窓後・対象選択前の
 * pendingStepChoice で支払い、resource:"card" の scoped variant だけ既存の
 * 宣言時 legal action 経路で扱う。
 */
export function executeGrantPaidPreventionImmunity(
  action: DSL.GrantPaidPreventionImmunityAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  effect: Effect,
  resolvedTargetIds?: string[],
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const targets =
    resolvedTargetIds && resolvedTargetIds.length > 0
      ? resolvedTargetIds
      : resolveTargetSpec({
          targetSpec: action.target,
          state,
          actingPlayerId,
          sourceInstanceId,
          getCardDefinitionById,
          stepContext: createStepExecutionContext(state),
        }).map((c) => c.instanceId);

  if (targets.length === 0) return state;

  const newEffects: ContinuousEffect[] = targets.map((targetId) => ({
    effectId: nextDslCeId("paid_prevention_immunity_offer"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "paid_prevention_immunity_offer" as ContinuousEffectTag,
    targetInstanceId: targetId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      cost: action.cost,
      ...(action.scope ? { scope: action.scope } : {}),
    },
  }));

  state.log.push(
    `effect:grant_paid_prevention_immunity:${targets.length}targets:cost=${action.cost.amount}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
}

// --- grant_paid_leave_suppression_immunity: 対価支払いで離脱誘発を抑制する権利の
//     CE 登録 (engine-generic-effect-activation-causal-trigger cluster, BSGE01-R02) ---

/**
 * 「host が効果を発揮するとき、対価を支払うことで、それによってフィールドを
 * 離れるカードの効果は発揮されない」権利を CE として登録する。
 * grant_paid_prevention_immunity と同じ単純な単一 CE/target 登録パターン。
 *
 * 本 CE は「権利がある」ことのみを表し、実際の対価支払い判定・適用は
 * stack 窓後・対象選択前の pendingStepChoice と triggered effect 解決側が行う。
 */
export function executeGrantPaidLeaveSuppressionImmunity(
  action: DSL.GrantPaidLeaveSuppressionImmunityAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  effect: Effect,
  resolvedTargetIds?: string[],
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const targets =
    resolvedTargetIds && resolvedTargetIds.length > 0
      ? resolvedTargetIds
      : resolveTargetSpec({
          targetSpec: action.target,
          state,
          actingPlayerId,
          sourceInstanceId,
          getCardDefinitionById,
          stepContext: createStepExecutionContext(state),
        }).map((c) => c.instanceId);

  if (targets.length === 0) return state;

  const newEffects: ContinuousEffect[] = targets.map((targetId) => ({
    effectId: nextDslCeId("paid_leave_suppression_immunity_offer"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "paid_leave_suppression_immunity_offer" as ContinuousEffectTag,
    targetInstanceId: targetId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: { cost: action.cost },
  }));

  state.log.push(
    `effect:grant_paid_leave_suppression_immunity:${targets.length}targets:cost=${action.cost.amount}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
}

// --- register_redirect_effect_target: redirect CE 登録 (P3-47 F-4 Step 4) ---

/**
 * 効果対象リダイレクト ContinuousEffect を登録する。
 *
 * lifecycle 規約 (redirect-effect-target.ts):
 * - duration: 既定 `{ scope: "while_on_field" }` (host 離脱で自動消滅)
 * - sourceInstanceId: 効果発揮元 (host = フランドール本体)
 * - targetInstanceId: 保護対象 (protectedTarget.kind="self" は省略 + self trigger 形式で
 *   sourceInstanceId による保護判定に乗せる)
 *
 * protectedTarget:
 * - `kind: "self"` → metadata.triggerCondition.protectedTargetKind="self"
 *   (CE.targetInstanceId は省略。getRedirectEffectTargetsProtecting が
 *    sourceInstanceId-based で拾う。)
 * - `kind: "target"` → target spec を解決し、各 instanceId を
 *   metadata.triggerCondition.protectedInstanceIds に格納
 *
 * redirectCandidate:
 * - `kind: "associated_act_as_spirit"` → 同 host で発行された act_as_spirit CE 群を
 *   実行時に動的解決 (resolveRedirectCandidateInstanceIds)
 * - `kind: "explicit"` → target spec を解決した instanceId 列を凍結
 */
export function executeRegisterRedirectEffectTarget(
  action: DSL.RegisterRedirectEffectTargetAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const stepCtx = createStepExecutionContext(state);

  // 保護対象 instanceId 群を解決
  // "owned_filter" は "self" と同様に CE 1 件で登録し、matchtime (findApplicableTargetRedirects)
  // で毎回 filter を再評価する (登録時点の固定リストにしない。BSLH01-R02 のように保護対象が
  // 召喚/離脱で増減する集合のため)。
  let protectedKind: "self" | "instances" | "owned_filter";
  let protectedInstanceIds: string[];
  if (action.protectedTarget.kind === "self") {
    protectedKind = "self";
    protectedInstanceIds = [];
  } else if (action.protectedTarget.kind === "owned_filter") {
    protectedKind = "owned_filter";
    protectedInstanceIds = [];
  } else {
    protectedKind = "instances";
    protectedInstanceIds = resolveTargetSpec({
      targetSpec: action.protectedTarget.target,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepContext: stepCtx,
    }).map((c) => c.instanceId);
    if (protectedInstanceIds.length === 0) return state;
  }

  // 候補集合の凍結 / 動的解決方式を構築
  const sourcePlayerRef: "opponent" | "any" =
    action.sourcePlayerRef ?? "opponent";
  const candidateSource =
    action.redirectCandidate.kind === "associated_act_as_spirit"
      ? { kind: "associated_act_as_spirit" as const }
      : action.redirectCandidate.kind === "owned_filter"
        ? {
            kind: "owned_filter" as const,
            filter: action.redirectCandidate.filter,
            ...(action.redirectCandidate.player !== undefined
              ? { playerRef: action.redirectCandidate.player }
              : {}),
            ...(action.redirectCandidate.preserveOriginalTargetSpec !==
            undefined
              ? {
                  preserveOriginalTargetSpec: {
                    playerRef:
                      action.redirectCandidate.preserveOriginalTargetSpec
                        .player,
                  },
                }
              : {}),
          }
        : {
            kind: "explicit" as const,
            instanceIds: resolveTargetSpec({
              targetSpec: action.redirectCandidate.target,
              state,
              actingPlayerId,
              sourceInstanceId,
              getCardDefinitionById,
              stepContext: stepCtx,
            }).map((c) => c.instanceId),
          };

  const triggerCondition =
    protectedKind === "self"
      ? {
          sourcePlayerRef,
          ...(action.sourceFilter ? { sourceFilter: action.sourceFilter } : {}),
          protectedTargetKind: "self" as const,
        }
      : protectedKind === "owned_filter"
        ? {
            sourcePlayerRef,
            ...(action.sourceFilter
              ? { sourceFilter: action.sourceFilter }
              : {}),
            protectedTargetKind: "owned_filter" as const,
            filter: (action.protectedTarget as { filter: CardFilter }).filter,
          }
        : {
            sourcePlayerRef,
            ...(action.sourceFilter
              ? { sourceFilter: action.sourceFilter }
              : {}),
            protectedTargetKind: "instances" as const,
            protectedInstanceIds,
          };

  const duration = action.duration ?? { scope: "while_on_field" as const };

  // protectedTargetKind="self"/"owned_filter" は CE 1 件、"instances" は対象ごとに CE 1 件
  const targetIdsForCE: (string | undefined)[] =
    protectedKind === "instances" ? protectedInstanceIds : [undefined];

  const newEffects: ContinuousEffect[] = targetIdsForCE.map((targetId) => ({
    effectId: nextDslCeId("redirect_effect_target"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "redirect_effect_target" as ContinuousEffectTag,
    ...(targetId !== undefined ? { targetInstanceId: targetId } : {}),
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      triggerCondition,
      redirectCandidateSource: candidateSource,
      optional: action.optional ?? true,
      ...(action.promptedPlayerRef !== undefined
        ? { promptedPlayerRef: action.promptedPlayerRef }
        : {}),
      ...(action.candidateChooserPlayerRef !== undefined
        ? { candidateChooserPlayerRef: action.candidateChooserPlayerRef }
        : {}),
      ...(action.usageLimit ? { usageLimit: action.usageLimit } : {}),
    },
  }));

  state.log.push(
    `effect:register_redirect_effect_target:${newEffects.length}ce`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
}

// --- restrict_use: カード使用制限 CE 登録 ---

export function executeRestrictUse(
  action: DSL.RestrictUseAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const targetScope = action.targetScope ?? "player";
  // P3-77 節②: player target の場合、対象プレイヤーが「相手の効果を受けない」状態なら no-op。
  if (
    targetScope === "player" &&
    resolvePlayerAffect(state, targetPlayerId, actingPlayerId).kind !==
      "allowed"
  ) {
    state.log.push(`effect:restrict_use:player-immune:skip:${targetPlayerId}`);
    return state;
  }
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("restrict_use"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "restrict_use" as ContinuousEffectTag,
    ...(targetScope === "player" ? { targetInstanceId: targetPlayerId } : {}),
    targetFilter: {
      player: action.player as EffectPlayerRef,
      ...action.filter,
    },
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      filter: action.filter,
      ...(targetScope !== "player" ? { targetScope } : {}),
      ...(action.restrictedKinds
        ? { restrictedKinds: action.restrictedKinds }
        : {}),
      ...(action.onlyNormalUse ? { onlyNormalUse: true } : {}),
    },
  };

  state.log.push(`effect:restrict_use:player=${action.player}`);
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- prevent_cost_reduction: 軽減シンボルによるコスト軽減無効化 CE 登録 ---

export function executePreventCostReduction(
  action: DSL.PreventCostReductionAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  // P3-77 節②: 対象プレイヤーが「相手の効果を受けない」状態なら no-op。
  if (
    resolvePlayerAffect(state, targetPlayerId, actingPlayerId).kind !==
    "allowed"
  ) {
    state.log.push(
      `effect:prevent_cost_reduction:player-immune:skip:${targetPlayerId}`
    );
    return state;
  }
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("prevent_cost_reduction"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "prevent_cost_reduction" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    targetFilter: {
      player: action.player as EffectPlayerRef,
      ...action.filter,
    },
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      filter: action.filter,
      ...(action.restrictedKinds
        ? { restrictedKinds: action.restrictedKinds }
        : {}),
    },
  };

  state.log.push(`effect:prevent_cost_reduction:player=${action.player}`);
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- limit_cost_reduction: 軽減シンボル供給源単位の使用可能マッチ数上限 CE 登録 ---

export function executeLimitCostReduction(
  action: DSL.LimitCostReductionAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const restrictedPlayerIds =
    action.player === "either"
      ? state.players.map((p) => p.id)
      : [resolvePlayerRef(actingPlayerId, action.player, state)];

  let nextState = state;
  for (const targetPlayerId of restrictedPlayerIds) {
    // P3-77 節②: 対象プレイヤーが「相手の効果を受けない」状態なら no-op。
    if (
      resolvePlayerAffect(nextState, targetPlayerId, actingPlayerId).kind !==
      "allowed"
    ) {
      nextState = {
        ...nextState,
        log: [
          ...nextState.log,
          `effect:limit_cost_reduction:player-immune:skip:${targetPlayerId}`,
        ],
      };
      continue;
    }

    const newEffect: ContinuousEffect = {
      effectId: nextDslCeId("limit_cost_reduction"),
      sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      actingPlayerId,
      duration: action.duration,
      createdAtTurn: nextState.turnNumber,
      createdAtAttackId: nextState.activeAttack?.attackId ?? null,
      modifierTag: "limit_cost_reduction" as ContinuousEffectTag,
      targetInstanceId: targetPlayerId,
      ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
      ...(provenance ? { provenance } : {}),
      metadata: {
        sourceFilter: action.sourceFilter,
        maxSymbols: action.maxSymbols,
        ...(action.restrictedKinds
          ? { restrictedKinds: action.restrictedKinds }
          : {}),
      },
    };

    nextState = {
      ...nextState,
      activeContinuousEffects: [
        ...nextState.activeContinuousEffects,
        newEffect,
      ],
      log: [
        ...nextState.log,
        `effect:limit_cost_reduction:player=${targetPlayerId}:max=${action.maxSymbols}`,
      ],
    };
  }
  return nextState;
}

// --- extend_field_symbol_source: 特定ゾーンのカードを軽減シンボル供給源として
//     フィールドにあるものとして扱う CE 登録 (BSTH08.5-C20) ---

export function executeExtendFieldSymbolSource(
  action: DSL.ExtendFieldSymbolSourceAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  // P3-77 節②: 対象プレイヤーが「相手の効果を受けない」状態なら no-op。
  if (
    resolvePlayerAffect(state, targetPlayerId, actingPlayerId).kind !==
    "allowed"
  ) {
    state.log.push(
      `effect:extend_field_symbol_source:player-immune:skip:${targetPlayerId}`
    );
    return state;
  }
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("extend_field_symbol_source"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "extend_field_symbol_source" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    targetFilter: {
      player: action.player as EffectPlayerRef,
      ...action.filter,
    },
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      zone: action.zone,
      filter: action.filter,
      targetScope: action.targetScope ?? "player",
      ...(effect.applicability?.zone !== undefined
        ? { sourceApplicabilityZone: effect.applicability.zone }
        : {}),
    },
  };

  state.log.push(
    `effect:extend_field_symbol_source:player=${action.player}:zone=${action.zone}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- force_attack_step_end_after_first_battle:
//     ターン最初のバトル終了時アタックステップ強制終了 CE 登録 (P2-05 Phase 4b) ---

export function executeForceAttackStepEndAfterFirstBattle(
  action: DSL.ForceAttackStepEndAfterFirstBattleAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("force_attack_step_end_after_first_battle"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag:
      "force_attack_step_end_after_first_battle" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(
    `effect:force_attack_step_end_after_first_battle:player=${action.player}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- allow_simultaneous_attack: 複数体同時アタック許可 CE 登録 (P2-05) ---

export function executeAllowSimultaneousAttack(
  action: DSL.AllowSimultaneousAttackAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  // 許可型 CE（restrict_use の対概念）。通常 player は "self"（自分への付与）。
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("allow_simultaneous_attack"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "allow_simultaneous_attack" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      filter: action.filter,
      maxCount: action.maxCount,
      blockerCapacity: action.blockerCapacity ?? 1,
    },
  };

  state.log.push(
    `effect:allow_simultaneous_attack:player=${action.player}:max=${action.maxCount}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- allow_mid_battle_join: 召喚した個体の途中合流許可 CE 登録 (P2-05 Phase 5) ---

export function executeAllowMidBattleJoin(
  action: DSL.AllowMidBattleJoinAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("allow_mid_battle_join"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "allow_mid_battle_join" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      filter: action.filter,
    },
  };

  state.log.push(`effect:allow_mid_battle_join:player=${action.player}`);
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- allow_ignore_summon_condition: 召喚条件無視許可 CE 登録 (BSAZ02-C11【アルティメット合体中】) ---

export function executeAllowIgnoreSummonCondition(
  action: DSL.AllowIgnoreSummonConditionAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("allow_ignore_summon_condition"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "allow_ignore_summon_condition" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      filter: action.filter,
    },
  };

  state.log.push(
    `effect:allow_ignore_summon_condition:player=${action.player}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- grant_game_loss_immunity: ゲーム敗北免除 CE 登録 (BSTH05.5-XX01【神域】) ---

export function executeGrantGameLossImmunity(
  action: DSL.GrantGameLossImmunityAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("immune_to_game_loss"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "immune_to_game_loss" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(`effect:grant_game_loss_immunity:player=${action.player}`);
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- grant_declared_summon_alt_cost: 発揮元疲労で召喚条件無視/軽減全充足を選べる CE 登録 (BSAZ02-C08【月面基地】) ---

export function executeGrantDeclaredSummonAltCost(
  action: DSL.GrantDeclaredSummonAltCostAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);

  // sourceInstanceId (この CE の発揮元＝ネクサス自身) が疲労対象。消費側
  // (getDeclaredSummonAltCostGrant) は ce.sourceInstanceId をそのまま「疲労させて
  // 選べる代替コストの対象カード」として読む（allow_ignore_summon_condition と異なり
  // per-summon 任意コストのゲートが必要なため sourceInstanceId を疲労状態の参照先にする）。
  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("grant_declared_summon_alt_cost"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "grant_declared_summon_alt_cost" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      filter: action.filter,
      benefits: action.benefits,
    },
  };

  state.log.push(
    `effect:grant_declared_summon_alt_cost:player=${action.player}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- grant_summon_trash_core_placement: 召喚時トラッシュコア配置許可 CE 登録 (BSLH01-T13「メルティライズ」) ---

export function executeGrantSummonTrashCorePlacement(
  action: DSL.GrantSummonTrashCorePlacementAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);

  // BSLH01-T13: effect.timingScope ({player:"both", period:"attack"}、T07 系アーツ共通
  // テンプレの「アタックステップに使用できる」) はこの CE を発揮する flash 起動自体の窓を
  // 絞るためのものであり、grant_declared_summon_alt_cost 等の precedent と異なり付与された
  // CE 自体の消費窓には転写しない。原文「次の自分のスタートステップまで」は
  // action.duration の scope:"step" が独立に管理する、活動窓を跨ぐ延命付与のため
  // (effect.timingScope を CE にも複写すると isCEActiveForScope 経由でメインステップの
  // 通常召喚時に grant が常に無効化され、原文の趣旨を失う)。
  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("grant_summon_trash_core_placement"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "grant_summon_trash_core_placement" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(provenance ? { provenance } : {}),
    metadata: {
      filter: action.filter,
      amount: action.amount,
    },
  };

  state.log.push(
    `effect:grant_summon_trash_core_placement:player=${action.player}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- grant_flash_consecutive_use: フラッシュ連続使用回数拡張 CE 登録 (BSLH01-T15「カラミティクロウ」) ---

/**
 * 「このターンの間、自分は、フラッシュタイミングを[limit]回ずつまで続けて行える」を登録する。
 * player-scoped CE を登録するのみで、消費側 (getFlashConsecutiveUseLimitGrant,
 * legal-actions-shared.ts) を battle-actions.ts usePassBattleFlashAsAction の能動使用
 * カスケード解決分岐が参照し、優先権移譲を limit 回まで保留する。
 */
export function executeGrantFlashConsecutiveUse(
  action: DSL.GrantFlashConsecutiveUseAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("grant_flash_consecutive_use"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "grant_flash_consecutive_use" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    // effect.timingScope ({player:"both",period:"attack"}、T13 系アーツ共通テンプレの
    // 「アタックステップに使用できる」) はこの CE を発揮する flash 起動自体の窓を絞るための
    // ものであり、grant_summon_trash_core_placement (T13) と同じ理由で付与された CE 自体の
    // 消費窓には転写しない。原文「このターンの間」はアタックステップに限定されない。
    ...(provenance ? { provenance } : {}),
    metadata: {
      limit: action.limit,
    },
  };

  state.log.push(
    `effect:grant_flash_consecutive_use:player=${action.player}:limit=${action.limit}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- grant_link_aid_cost_override: 【リンクエイド】起動コスト源/charge先の拡張 CE 登録 (BSGE01-C03「ディソレイト」) ---

/**
 * 「このターンの間、自分の魂状態のカードすべての【リンクエイド】を『フィールド/リザーブ
 * から1コスト支払って、フィールド/リザーブのコアを好きなだけ置いてスピリット状態にする』
 * に変更する」。player-scoped CE を登録するのみで、消費側 (mechanics/link-aid-system.ts
 * の isLinkAidCostOverrideActive) が getAvailableLinkAidLegalActions / deferred 解決の
 * 両方でこの CE を検知して起動コスト源・charge の sourceScope を拡張する。
 */
export function executeGrantLinkAidCostOverride(
  action: DSL.GrantLinkAidCostOverrideAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("grant_link_aid_cost_override"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "grant_link_aid_cost_override" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(`effect:grant_link_aid_cost_override:player=${action.player}`);
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- restrict_draw_to_top: 「このターンの間、自分はデッキの上からしかドロー/オープンできない」CE 登録 (BSTH09-C05) ---

/**
 * 「このターンの間、自分はデッキの上からしかドロー/オープンできない」自己制約を登録する。
 * 消費側 (native-action-registry.ts の draw ハンドラ、`isRestrictedToTopOnlyDraw`) が
 * position:"bottom" 指定を検知時に "top" へ強制上書きする。
 */
export function executeRestrictDrawToTop(
  action: DSL.RestrictDrawToTopAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("restrict_draw_to_top"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "restrict_draw_to_top" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(`effect:restrict_draw_to_top:player=${action.player}`);
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/** `restrict_draw_to_top` CE が playerId に対して有効か（draw ハンドラの消費側）。 */
export function isRestrictedToTopOnlyDraw(
  state: GameState,
  playerId: string
): boolean {
  return getCEsForTarget(state, playerId).some(
    (ce) => ce.modifierTag === "restrict_draw_to_top"
  );
}

// --- grant_optional_deck_reveal_count_boost: デッキreveal/破棄+1選択許可 CE 登録 (BSLH01-X09【クォーツ：練刃】) ---

/**
 * ENGINE-optional-deck-reveal-count-boost Step1: この CE 自体は登録のみを担う。
 * deck_reveal 実行時に本 CE を検知して pending choice を挿入する消費側は Step2 で配線済み
 * (effect-interpreter.ts の handleDeckRevealCountBoostChoice / applyDeckRevealCountBoostResumeBonus、
 * pending-action-handlers.ts の applyPendingDeckRevealCountBoostChoiceAction)。
 */
export function executeGrantOptionalDeckRevealCountBoost(
  action: DSL.GrantOptionalDeckRevealCountBoostAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("grant_optional_deck_reveal_count_boost"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag:
      "grant_optional_deck_reveal_count_boost" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      sourceFilter: action.sourceFilter,
      bonusAmount: action.bonusAmount ?? 1,
    },
  };

  state.log.push(
    `effect:grant_optional_deck_reveal_count_boost:player=${action.player}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- register_expand_effect_target_count: 対象数拡張 CE 登録 (BSLH01-TR02(A)【クォーツ：範囲】) ---

/**
 * ENGINE-target-count-expand-modifier: この関数は CE 登録のみを担う。
 * 消費側 (auto-resolve 経路の対象数+N、usageLimit 実消費記録) は
 * expand-effect-target-count.ts / native-target-resolution.ts の applyActionTargetCount へ
 * Step3 で配線済み。GUI 候補数上限・手動対象選択経路は Step4 以降 (engine-deep-ledger 参照)。
 */
export function executeRegisterExpandEffectTargetCount(
  action: DSL.RegisterExpandEffectTargetCountAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("expand_effect_target_count"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "expand_effect_target_count" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      sourceFilter: action.sourceFilter,
      targetFilter: action.targetFilter,
      targetPlayer: action.targetPlayer,
      bonusAmount: action.bonusAmount ?? 1,
      ...(action.usageLimit ? { usageLimit: action.usageLimit } : {}),
    },
  };

  state.log.push(
    `effect:register_expand_effect_target_count:player=${action.player}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- require_multi_block: 複数体ブロック強制 CE 登録 (P2-05 Phase 5, BSFT01-TR06(B)) ---

export function executeRequireMultiBlock(
  action: DSL.RequireMultiBlockAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("require_multi_block"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "require_multi_block" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      filter: action.filter,
      requiredBlockerCount: action.requiredBlockerCount,
    },
  };

  state.log.push(
    `effect:require_multi_block:player=${action.player}:count=${action.requiredBlockerCount}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- require_block_if_able: 可能ならブロック強制 CE 登録 (BSDB01-C01 超・激突) ---

export function executeRequireBlockIfAble(
  action: DSL.RequireBlockIfAbleAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  sourcePreventionLevel?: EffectPreventionLevel,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("require_block_if_able"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "require_block_if_able" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      ...(action.attackerFilter
        ? { attackerFilter: action.attackerFilter }
        : {}),
      ...(action.blockerFilter ? { blockerFilter: action.blockerFilter } : {}),
      ...(sourcePreventionLevel && sourcePreventionLevel !== "none"
        ? { preventionLevel: sourcePreventionLevel }
        : {}),
    },
  };

  state.log.push(`effect:require_block_if_able:player=${action.player}`);
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- offer_magic_pre_cost_trigger: cross-card pre-cost 発揮権 CE 登録
//     (engine-magic-field-pre-cost-payment-trigger, BSAZ01-C12「戦力投入」) ---

export function executeOfferMagicPreCostTrigger(
  action: DSL.OfferMagicPreCostTriggerAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("offer_magic_pre_cost_trigger"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "offer_magic_pre_cost_trigger" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      tribeFilter: action.tribeFilter,
      triggerEffectIndex: action.triggerEffectIndex,
    },
  };

  state.log.push(`effect:offer_magic_pre_cost_trigger:player=${action.player}`);
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- restrict_manifest: 顕現制限 CE 登録 ---

export function executeRestrictManifest(
  action: DSL.RestrictManifestAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  // P3-77 節②: 対象プレイヤーが「相手の効果を受けない」状態なら相手起因制限は no-op。
  if (
    resolvePlayerAffect(state, targetPlayerId, actingPlayerId).kind !==
    "allowed"
  ) {
    state.log.push(
      `effect:restrict_manifest:player-immune:skip:${targetPlayerId}`
    );
    return state;
  }
  const sourceCard = getCardById(state, sourceInstanceId);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("restrict_manifest"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "restrict_manifest" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    // CardFilter 全体を素のスプレッドで渡す (guard-audit-card-filter-projection、
    // 2026-08-05 subset-type-unification)。旧実装はフィールド別 allowlist コピーで、
    // 新フィールドが黙って脱落していた。
    targetFilter: {
      player: action.player as EffectPlayerRef,
      ...action.filter,
    },
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      filter: action.filter,
      ...(action.effectFilter ? { effectFilter: action.effectFilter } : {}),
    },
  };

  state.log.push(`effect:restrict_manifest:player=${action.player}`);
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- field_name_uniqueness: フィールド同名唯一性制限 CE 登録 ---

export function executeFieldNameUniqueness(
  action: DSL.FieldNameUniquenessAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance: { effectIndex: number; stepIndex: number } | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  // names="self" は発揮元自身のカード名（「同名」テキスト）に解決する。
  // filter ベース（系統 AND 等）のときは names を省略可。
  let restrictedNames: string[];
  if (action.names === "self") {
    const def = sourceCard
      ? getCardDefinitionById(sourceCard.definitionId)
      : undefined;
    restrictedNames = def ? [def.name] : [];
  } else {
    restrictedNames = action.names ?? [];
  }

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("field_name_uniqueness"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "field_name_uniqueness" as ContinuousEffectTag,
    // 「自分の」フィールドに紐付く（getCEsForTarget(state, controllerPlayerId) で消費）。
    targetInstanceId: actingPlayerId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      restrictedNames,
      ...(action.filter ? { restrictFilter: action.filter } : {}),
      ...(action.maxCount !== undefined ? { maxCount: action.maxCount } : {}),
      ...(action.boostCondition
        ? { boostCondition: action.boostCondition }
        : {}),
      ...(action.boostedMaxCount !== undefined
        ? { boostedMaxCount: action.boostedMaxCount }
        : {}),
    },
  };

  state.log.push(
    `effect:field_name_uniqueness:names=${restrictedNames.join("/")}` +
      (action.filter ? `:filter` : "")
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- count_as_multiple: 名前参照カウント倍率 CE 登録 ---

export function executeCountAsMultiple(
  action: DSL.CountAsMultipleAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const multiplier = Math.floor(action.multiplier);
  if (multiplier <= 1) return state;

  const sourceCard = getCardById(state, sourceInstanceId);
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("count_as_multiple"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "count_as_multiple" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      filter: action.filter,
      multiplier,
      ...(action.optionalCount ? { optionalCount: true } : {}),
    },
  };

  state.log.push(`effect:count_as_multiple:${targetPlayerId}:x${multiplier}`);
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- redirect_target: 対象変更 ---

export function executeRedirectTarget(
  action: DSL.RedirectTargetAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  stepCtx: StepExecutionContext,
  _resolvedTargetIds?: string[]
): GameState {
  // 対象変更: from の対象を to の対象に変更する
  // 主にアタック対象 / targeted disclosure 中の元効果対象変更に使用
  const fromTargets = resolveTargetSpec({
    targetSpec: action.from,
    state,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById,
    stepContext: stepCtx,
  }).map((c) => c.instanceId);
  const toTargets = resolveTargetSpec({
    targetSpec: action.to,
    state,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById,
    stepContext: stepCtx,
  }).map((c) => c.instanceId);

  if (fromTargets.length === 0 || toTargets.length === 0) return state;

  let currentState = state;
  const mode = action.mode ?? "matching";

  if (state.pendingTargetedDisclosureContinuation !== null) {
    const continuation = state.pendingTargetedDisclosureContinuation;
    const fromSet = new Set(fromTargets);
    const targetCandidateSet =
      continuation.targetCandidateInstanceIds !== undefined
        ? new Set(continuation.targetCandidateInstanceIds)
        : null;
    const wasNotFieldCardAtDisclosure = (id: string): boolean => {
      if (continuation.effectResolutionBeforeState === undefined) {
        return false;
      }
      const beforeCard =
        continuation.effectResolutionBeforeState?.cardInstances.find(
          (card) => card.instanceId === id
        );
      return beforeCard?.zone !== "field";
    };
    const legalToTargets =
      targetCandidateSet === null
        ? toTargets
        : toTargets.filter(
            (id) =>
              targetCandidateSet.has(id) || wasNotFieldCardAtDisclosure(id)
          );
    const isRedirectableFieldEffectTarget = (id: string): boolean => {
      const card = getCardById(currentState, id);
      if (!card || card.zone !== "field") return false;
      const def = getCardDefinitionById(card.definitionId);
      if (!def) return false;
      const category = getEffectiveCategory(currentState, card, def);
      return (
        category === "spirit" ||
        category === "ultimate" ||
        category === "brave" ||
        category === "nexus"
      );
    };
    const replaceCurrentTargets = (
      ids: readonly string[],
      preserveNonMatching: boolean
    ): string[] => {
      if (legalToTargets.length === 0) return [...ids];
      if (!preserveNonMatching) {
        if (!ids.some((id) => fromSet.has(id))) return [...ids];
        const result: string[] = [];
        let replacedFieldTargets = false;
        for (const id of ids) {
          if (isRedirectableFieldEffectTarget(id)) {
            if (!replacedFieldTargets) {
              result.push(...legalToTargets);
              replacedFieldTargets = true;
            }
          } else {
            result.push(id);
          }
        }
        return replacedFieldTargets ? result : [...ids];
      }
      const result: string[] = [];
      let replaced = false;
      for (const id of ids) {
        if (fromSet.has(id)) {
          result.push(...legalToTargets);
          replaced = true;
        } else {
          result.push(id);
        }
      }
      return replaced ? result : [...ids];
    };
    const nextTargetIds = replaceCurrentTargets(
      continuation.targetInstanceIds,
      mode !== "all_current_effect_targets"
    );
    const changed =
      nextTargetIds.length !== continuation.targetInstanceIds.length ||
      nextTargetIds.some(
        (id, index) => id !== continuation.targetInstanceIds[index]
      );
    if (changed) {
      const {
        targetGroups: _targetGroups,
        sequentialTargetConsumption: _sequentialTargetConsumption,
        ...continuationWithoutGroupedTargets
      } = continuation;
      // targeted disclosure の zone snapshot は「対象が確定した時点」の値である。
      // redirect 後も残る既存 TargetRef を currentState の zone で上書きすると、
      // 応答中に field を離れた対象を元効果が処理できてしまう。追加された redirect
      // 先だけを現在 zone で初期化し、legacy continuation（snapshot 未導入）は
      // 互換のため未定義のまま保つ。
      const nextTargetZonesByInstanceId =
        continuation.targetZonesByInstanceId === undefined
          ? undefined
          : Object.fromEntries(
              nextTargetIds.flatMap((instanceId) => {
                const previousZone =
                  continuation.targetZonesByInstanceId?.[instanceId];
                if (previousZone !== undefined) {
                  return [[instanceId, previousZone] as const];
                }
                const snapshot = snapshotTargetedDisclosureTargetZones(
                  currentState,
                  [instanceId]
                );
                const addedTargetZone = snapshot[instanceId];
                return addedTargetZone === undefined
                  ? []
                  : [[instanceId, addedTargetZone] as const];
              })
            );
      currentState = {
        ...currentState,
        pendingTargetedDisclosureContinuation: {
          ...continuationWithoutGroupedTargets,
          targetInstanceIds: nextTargetIds,
          ...(nextTargetZonesByInstanceId !== undefined
            ? { targetZonesByInstanceId: nextTargetZonesByInstanceId }
            : {}),
        },
        log: [
          ...currentState.log,
          `effect:redirect_target:targeted-disclosure:${continuation.targetInstanceIds.join(",")}->${nextTargetIds.join(",")}`,
        ],
      };
    }
  }

  // アクティブアタックの対象がfromに含まれる場合、toに変更
  if (
    currentState.activeAttack &&
    currentState.activeAttack.target.kind === "battle_entity"
  ) {
    const fromSet = new Set(fromTargets);
    const currentTargetEntityId = currentState.activeAttack.target.entityId;
    if (fromSet.has(currentTargetEntityId) && toTargets[0]) {
      return {
        ...currentState,
        activeAttack: {
          ...currentState.activeAttack,
          target: { kind: "battle_entity", entityId: toTargets[0] },
        },
        log: [
          ...currentState.log,
          `effect:redirect_target:${currentTargetEntityId}->${toTargets[0]}`,
        ],
      };
    }
  }

  if (currentState !== state) return currentState;
  return {
    ...state,
    log: [...state.log, `effect:redirect_target:no-active-target`],
  };
}

// --- suppress_effect: 効果抑制 CE 登録 ---

export function executeSuppressEffect(
  action: DSL.SuppressEffectAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  effect: Effect,
  resolvedTargetIds?: string[],
  provenance?: NonNullable<ContinuousEffect["provenance"]>,
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourcePreventionBypass?: import("./target-affect-gate").TargetLockBypassProfile
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const sourceDefinition = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  const matchesTargetAffectGate = (targetCard: CardInstance): boolean => {
    if (action.targetAffectGate !== "blocked_by_source_immunity") return true;
    return (
      resolveCardImmunityAffect(
        state,
        targetCard,
        actingPlayerId,
        "none",
        {
          instance: sourceCard,
          ...(sourceDefinition ? { definition: sourceDefinition } : {}),
        },
        getCardDefinitionById
      ).kind === "blocked"
    );
  };

  // 動的フィルタ continuous suppress（「相手のフィールドの<フィルタ>カードの効果は
  // 発揮されない」型）。target が filter かつ count:"all" のとき、登録時に instanceId へ
  // snapshot せず、CardFilter + player を持つ **単一のグローバル CE**（targetInstanceId
  // 未設定）として登録する。これにより登録後に場へ出たカードも消費側で動的に再評価される
  // （getGlobalCEs + matchesCardFilter SSOT、BSTH04-転醒R01(B) 金龍 / ENGINE-dynamic-filter-suppress）。
  if (action.target.kind === "filter" && action.target.count === "all") {
    const dynamicCe: ContinuousEffect = {
      effectId: nextDslCeId("suppress_effect"),
      sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      actingPlayerId,
      duration: action.duration ?? { scope: "permanent" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: state.activeAttack?.attackId ?? null,
      modifierTag: "effect_suppression" as ContinuousEffectTag,
      // targetInstanceId 未設定 = グローバル（動的フィルタ）CE。
      ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
      ...(provenance ? { provenance } : {}),
      metadata: {
        ...(action.effectFilter ? { effectFilter: action.effectFilter } : {}),
        ...(action.scope ? { scope: action.scope } : {}),
        ...(action.modifierTarget
          ? { modifierTarget: action.modifierTarget }
          : {}),
        ...(action.targetAffectGate
          ? { targetAffectGate: action.targetAffectGate }
          : {}),
        ...(sourcePreventionLevel && sourcePreventionLevel !== "none"
          ? { preventionLevel: sourcePreventionLevel }
          : {}),
        // 消費側 (legal-actions-shared effect_suppression) が matchesCardFilter で
        // 動的マッチングするためのフィルタ + player（SSOT card-filter 評価器を再利用）。
        suppressTargetFilter: action.target.filter,
        suppressTargetPlayer: action.target.player,
        // 対象ゾーン（省略時は従来どおり "field" 限定）。「相手のミラージュの効果は
        // 発揮されない」等、非 field ゾーンのカード群を動的に対象化する
        // (ENGINE-effect-immunity-hand-zone-scope の targetFilter.zone と同型の一般化、
        // BSTH02.7-C01 effects[0] が初出)。
        ...(action.target.zone
          ? {
              suppressTargetZone: Array.isArray(action.target.zone)
                ? action.target.zone
                : [action.target.zone],
            }
          : {}),
      },
    };
    state.log.push(
      `effect:suppress_effect:dynamic_filter:${action.target.player}:${action.scope ?? "entire"}`
    );
    return recordDynamicEffectSuppressionTargetHistory(
      {
        ...state,
        activeContinuousEffects: [...state.activeContinuousEffects, dynamicCe],
      },
      getCardDefinitionById
    );
  }

  // ターゲットカードに effect_suppression CE を登録
  const targets =
    resolvedTargetIds && resolvedTargetIds.length > 0
      ? resolvedTargetIds
      : resolveTargetSpec({
          targetSpec: action.target,
          state,
          actingPlayerId,
          sourceInstanceId,
          getCardDefinitionById,
          stepContext: createStepExecutionContext(state),
        }).map((c) => c.instanceId);

  if (targets.length === 0) return state;

  const affectedTargets = targets.filter((targetId) => {
    const targetCard = getCardById(state, targetId);
    if (!targetCard) return false;
    if (!matchesTargetAffectGate(targetCard)) return false;
    return (
      resolveCardImmunityAffect(
        state,
        targetCard,
        actingPlayerId,
        sourcePreventionLevel,
        {
          instance: sourceCard,
          ...(sourceDefinition ? { definition: sourceDefinition } : {}),
        },
        getCardDefinitionById,
        sourcePreventionBypass
      ).kind === "allowed"
    );
  });

  if (affectedTargets.length === 0) return state;

  const newEffects: ContinuousEffect[] = affectedTargets.map((targetId) => ({
    effectId: nextDslCeId("suppress_effect"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration ?? { scope: "permanent" },
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "effect_suppression" as ContinuousEffectTag,
    targetInstanceId: targetId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      ...(action.effectFilter ? { effectFilter: action.effectFilter } : {}),
      ...(action.scope ? { scope: action.scope } : {}),
      ...(action.modifierTarget
        ? { modifierTarget: action.modifierTarget }
        : {}),
      ...(action.targetAffectGate
        ? { targetAffectGate: action.targetAffectGate }
        : {}),
      ...(sourcePreventionLevel && sourcePreventionLevel !== "none"
        ? { preventionLevel: sourcePreventionLevel }
        : {}),
    },
  }));

  state.log.push(
    `effect:suppress_effect:${affectedTargets.length}targets:${action.scope ?? "entire"}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
}

// --- override_properties: カード属性上書き CE 登録 ---

/**
 * `{ copy_from: TargetSpec }` を判定するヘルパー。
 */
function isCopyFromSpec(value: unknown): value is DSL.CopyFromTargetSpec {
  return (
    typeof value === "object" &&
    value !== null &&
    "copy_from" in (value as Record<string, unknown>)
  );
}

/**
 * override_properties.properties 内の `copy_from` をスナップショット解決して
 * リテラル値に置き換えた新しい properties を返す。
 *
 * - `cardName` / `cost` / `tribes`: 定義値 (override 込み) を読む
 * - `symbols`: getCombinedUnitSymbolBundles で合体ブレイヴ込みの実効値を取得
 * - `bp`: getEffectiveBp でモディファイア込みの実効 BP を取得し
 *         { lv1, lv2, lv3 } 全レベル一律として保存
 * - 解決失敗 (対象が見つからない等) の場合は当該プロパティを undefined にして除外
 */
function resolveCopyFromInProperties(
  properties: DSL.OverridePropertiesAction["properties"],
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): DSL.OverridePropertiesAction["properties"] {
  let containsCopyFrom = false;
  const keys: (keyof DSL.OverridePropertiesAction["properties"])[] = [
    "cardName",
    "cost",
    "symbols",
    "tribes",
    "bp",
  ];
  for (const key of keys) {
    if (isCopyFromSpec(properties[key])) {
      containsCopyFrom = true;
      break;
    }
  }
  if (!containsCopyFrom) return properties;

  const resolveSource = (
    spec: DSL.CopyFromTargetSpec
  ): {
    card: CardInstance;
    def: CardDefinition;
  } | null => {
    const cards = resolveTargetSpec({
      targetSpec: spec.copy_from,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepContext: createStepExecutionContext(state),
    });
    if (cards.length === 0) return null;
    const card = cards[0]!;
    const def = getCardDefinitionById(card.definitionId);
    if (!def) return null;
    return { card, def };
  };

  // properties は in-place 更新せずコピーして加工する
  const resolved: Record<string, unknown> = { ...properties };

  if (isCopyFromSpec(properties.cardName)) {
    const src = resolveSource(properties.cardName);
    resolved.cardName = src ? src.def.name : undefined;
  }
  if (isCopyFromSpec(properties.cost)) {
    const src = resolveSource(properties.cost);
    resolved.cost = src ? src.def.cost : undefined;
  }
  if (isCopyFromSpec(properties.symbols)) {
    const src = resolveSource(properties.symbols);
    const bundles = src
      ? getCombinedUnitSymbolBundles(
          state,
          src.card,
          src.def,
          getCardDefinitionById
        )
      : undefined;
    // 内部snapshotで物理シンボルごとの色を保持する。多色1個を複数個へ変換しない。
    const entries = bundles?.flatMap((bundle) =>
      Array.from({ length: bundle.count }, () => [...bundle.colors])
    );
    resolved.symbols = entries?.flat();
    resolved.symbolColorEntries = entries;
  }
  if (isCopyFromSpec(properties.tribes)) {
    const src = resolveSource(properties.tribes);
    resolved.tribes = src?.def.tribe ? src.def.tribe.split("・") : undefined;
  }
  if (isCopyFromSpec(properties.bp)) {
    const src = resolveSource(properties.bp);
    if (src) {
      const snapshotBp = getEffectiveBp(
        state,
        src.card,
        src.def,
        getCardDefinitionById
      );
      resolved.bp = { lv1: snapshotBp, lv2: snapshotBp, lv3: snapshotBp };
    } else {
      resolved.bp = undefined;
    }
  }

  // undefined になったキーは除外
  for (const key of Object.keys(resolved)) {
    if (resolved[key] === undefined) delete resolved[key];
  }
  return resolved as DSL.OverridePropertiesAction["properties"];
}

const DYNAMIC_OVERRIDE_PROPERTIES_FILTER_KEYS = new Set([
  "category",
  "colors",
  "colorsLogic",
  "excludeColors",
  "tribes",
  "tribesLogic",
  "tribesRequired",
  "excludeTribeSubstring",
  "noTribes",
  "isToken",
  "combined",
  "maxCores",
  "minCores",
  "minLevel",
  "maxLevel",
  "cardName",
  "printedSymbolCount",
  "printedMinSymbolCount",
  "hasMechanic",
  "filterOr",
  "exclude",
  "colorCount",
  "isContract",
  "hasEffectText",
  "hasActivatedEffectMode",
  "hasBurstEffect",
  "declaresUnderCardSlot",
  "hasUnderCardRoleTag",
  "targetsGrandwalker",
  "targetsGrandstone",
  "grandwalkerKind",
  "everHadCorePlaced",
  "battleState",
  "exhaustState",
  "lv1RequiredCores",
  "minCost",
  "maxCost",
  "costBasis",
]);

const DYNAMIC_SYMBOL_OVERRIDE_PROPERTIES_FILTER_KEYS = new Set([
  ...DYNAMIC_OVERRIDE_PROPERTIES_FILTER_KEYS,
]);

function canEvaluateDynamicOverridePropertiesFilter(
  filter: CardFilter
): boolean {
  for (const key of Object.keys(filter)) {
    if (!DYNAMIC_OVERRIDE_PROPERTIES_FILTER_KEYS.has(key)) return false;
  }
  const filterOrSupported =
    filter.filterOr?.every(canEvaluateDynamicOverridePropertiesFilter) ?? true;
  const excludeSupported = filter.exclude
    ? canEvaluateDynamicOverridePropertiesFilter(filter.exclude)
    : true;
  return filterOrSupported && excludeSupported;
}

function canEvaluateDynamicSymbolOverridePropertiesFilter(
  filter: CardFilter
): boolean {
  for (const key of Object.keys(filter)) {
    if (!DYNAMIC_SYMBOL_OVERRIDE_PROPERTIES_FILTER_KEYS.has(key)) return false;
  }
  const filterOrSupported =
    filter.filterOr?.every(canEvaluateDynamicSymbolOverridePropertiesFilter) ??
    true;
  const excludeSupported = filter.exclude
    ? canEvaluateDynamicSymbolOverridePropertiesFilter(filter.exclude)
    : true;
  return filterOrSupported && excludeSupported;
}

export function executeOverrideProperties(
  action: DSL.OverridePropertiesAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  effect: Effect,
  resolvedTargetIds?: string[],
  provenance?: NonNullable<ContinuousEffect["provenance"]>,
  sourcePreventionLevel?: EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectSourceInstanceId?: string,
  effectSourceDefinitionId?: string,
  forceSnapshotContinuousTargets = false
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);

  // copy_from を CE 登録時にスナップショット解決
  const copyFromResolvedProperties = resolveCopyFromInProperties(
    action.properties,
    state,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById
  );

  // levelCostDelta が DynamicCount（「自分のカウント2につき+1」等）のときも CE 登録時に
  // 発動時点の数値へスナップショット解決する（duration 中は再評価しない）。
  const resolvedProperties: DSL.OverridePropertiesAction["properties"] =
    typeof copyFromResolvedProperties.levelCostDelta === "number" ||
    copyFromResolvedProperties.levelCostDelta === undefined
      ? copyFromResolvedProperties
      : {
          ...copyFromResolvedProperties,
          levelCostDelta: resolveAmount(
            copyFromResolvedProperties.levelCostDelta,
            state,
            actingPlayerId,
            createStepExecutionContext(state),
            getCardDefinitionById
          ),
        };

  // filter target かつ addTribes / Lvコスト系 / symbols のみの場合は動的メンバーシップ
  // （アタック/召喚直後に新規参加した対象も自動的にマッチさせる）として
  // 1 つの global CE を登録する。targetFilter で実消費時にマッチ判定。
  const isFilterTarget =
    typeof action.target === "object" &&
    action.target !== null &&
    "kind" in action.target &&
    action.target.kind === "filter";
  // count: "all"（「すべて」）の filter target は動的メンバーシップとみなす。
  // count が数値（「1つ」等）の場合は対象選択を要するため per-instance 経路へ流す。
  // excludeSelf（発生源カード自身の自己参照除外、BSTH02.7-CX01「自分の契約ネクサス以外」）は
  // targetExcludeSelf として CE に伝搬し matchesGlobalCETargetFilterInternal
  // (ce.sourceInstanceId 比較) で動的にも除外できる。onlyAddTribes/onlyLevelCost/onlyLevel は
  // 常時 dynamic global CE 化されるためこの経路で安全。ただし onlyLevelCostDelta/onlySymbols の
  // while_on_field aura 経路は、フィルタが0件マッチした瞬間に発生源自身へ誤って累積してしまう
  // エッジケース（BSAZ02-C02 で発見）の再検証が済んでいないため、excludeSelf 指定時は従来通り
  // per-instance 経路 (resolveTargetSpec の excludeInstanceId 機構) へ流す。
  const isAllScopeFilter =
    isFilterTarget &&
    (action.target as Extract<TargetSpec, { kind: "filter" }>).count === "all";
  const filterTargetExcludeSelf = isFilterTarget
    ? ((action.target as Extract<TargetSpec, { kind: "filter" }>).excludeSelf ??
      false)
    : false;
  // addTribes は加算修飾かつ実効系統フィルタの動的メンバーシップが主用途なので、
  // count:"all" filter target では従来どおり 1 つの global CE にする。
  //
  // levelCost は count:"all" かつ登録時候補0件なら dynamic global CE として保持する。
  // levelCostDelta は原則「指定した対象」への snapshot per-instance CE に寄せるが、
  // continuous + while_on_field の aura（例: BSSL01-X03）は後から場に入った対象にも
  // 常時適用されるため、dynamic global CE として保持する。消費側で immunity / target
  // acquisition gate を再評価するため、発揮元の prevention metadata も保存する。
  const onlyAddTribes =
    Array.isArray(resolvedProperties.addTribes) &&
    resolvedProperties.addTribes.length > 0 &&
    Object.keys(resolvedProperties).every((k) => k === "addTribes");
  const onlyLevelCostDelta =
    typeof resolvedProperties.levelCostDelta === "number" &&
    Object.keys(resolvedProperties).every((k) => k === "levelCostDelta");
  const onlyLevelCost =
    resolvedProperties.levelCost !== undefined &&
    Object.keys(resolvedProperties).every((k) => k === "levelCost");
  const onlyLevel =
    resolvedProperties.level === "max" &&
    Object.keys(resolvedProperties).every((k) => k === "level");
  const propertyKeys = Object.keys(resolvedProperties);
  const onlySymbols =
    resolvedProperties.symbols !== undefined &&
    propertyKeys.every(
      (k) =>
        k === "symbols" ||
        k === "symbolCountFixed" ||
        k === "symbolColorEntries"
    );
  const isContinuousWhileOnFieldAura =
    effect.timing.kind === "continuous" &&
    action.duration.scope === "while_on_field";

  if (
    !forceSnapshotContinuousTargets &&
    isAllScopeFilter &&
    (onlySymbols
      ? canEvaluateDynamicSymbolOverridePropertiesFilter(
          (action.target as Extract<TargetSpec, { kind: "filter" }>).filter
        )
      : canEvaluateDynamicOverridePropertiesFilter(
          (action.target as Extract<TargetSpec, { kind: "filter" }>).filter
        )) &&
    (onlyAddTribes ||
      onlyLevelCost ||
      onlyLevel ||
      ((onlyLevelCostDelta || onlySymbols) &&
        isContinuousWhileOnFieldAura &&
        !filterTargetExcludeSelf))
  ) {
    const filterTarget = action.target as Extract<
      TargetSpec,
      { kind: "filter" }
    >;
    const filter = filterTarget.filter;
    const newEffect: ContinuousEffect = {
      effectId: nextDslCeId("override_properties"),
      sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      actingPlayerId,
      duration: action.duration,
      createdAtTurn: state.turnNumber,
      createdAtAttackId: state.activeAttack?.attackId ?? null,
      modifierTag: "override_properties" as ContinuousEffectTag,
      targetFilter: {
        player: filterTarget.player as EffectPlayerRef,
        ...filter,
      },
      ...(filterTargetExcludeSelf ? { targetExcludeSelf: true } : {}),
      ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
      ...(provenance ? { provenance } : {}),
      metadata: {
        properties: resolvedProperties,
        ...(action.restrictions ? { restrictions: action.restrictions } : {}),
        overridePropertiesSourcePreventionLevel:
          sourcePreventionLevel ?? "none",
        overridePropertiesSourceTargetLockBypass: sourceTargetLockBypass ?? {
          kind: "none",
        },
        overridePropertiesSourcePreventionBypass: sourcePreventionBypass ?? {
          kind: "none",
        },
        overridePropertiesEffectSourceInstanceId:
          effectSourceInstanceId ?? provenance?.effectSourceInstanceId,
        overridePropertiesEffectSourceDefinitionId:
          effectSourceDefinitionId ?? provenance?.effectSourceDefinitionId,
      },
    };
    state.log.push(`effect:override_properties:filter-target`);
    return {
      ...state,
      activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
    };
  }

  // self 対象 + ソースが extra zone (trash/hand/set_aside/in_use/revealed) 滞在中は、
  // resolveTargetSpec の "self" 分岐 (zone==="field" 必須) では解決できない。
  // effect_immunity の self+extra-zone bypass (structured-continuous-effects.ts) と同型
  // (ENGINE-revealed-zone-continuous-effect-applicability: BSTH07.8-X02
  // 「デッキからオープンされたこのカードは系統：「妖精」を持つ」)。
  const srcInExtraZone =
    sourceCard !== undefined && EXTRA_APPLICABILITY_ZONES.has(sourceCard.zone);
  const targets =
    resolvedTargetIds !== undefined
      ? resolvedTargetIds
      : action.target.kind === "self" && srcInExtraZone && sourceCard
        ? [sourceCard.instanceId]
        : resolveTargetSpec({
            targetSpec: action.target,
            state,
            actingPlayerId,
            sourceInstanceId,
            getCardDefinitionById,
            stepContext: createStepExecutionContext(state),
          }).map((c) => c.instanceId);

  if (targets.length === 0) return state;

  const newEffects: ContinuousEffect[] = targets.map((targetId) => ({
    effectId: nextDslCeId("override_properties"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "override_properties" as ContinuousEffectTag,
    targetInstanceId: targetId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      properties: resolvedProperties,
      ...(action.restrictions ? { restrictions: action.restrictions } : {}),
    },
  }));

  state.log.push(`effect:override_properties:${targets.length}targets`);
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
}
