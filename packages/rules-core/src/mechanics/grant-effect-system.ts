/**
 * grant-effect-system.ts — 効果付与（grant_effect）誘発の検出（P3-99 §3 誘発 variant）
 *
 * grant_effect プリミティブの「注入点」前半。被付与カード（grantee）が起こしたイベントが
 * 付与効果（CE.metadata.grantedEffect）の trigger に一致したとき、誘発任意効果として
 * mechanic 付き PendingTriggeredEffect をキューに積む。解決（grantedEffect.steps の実行）は
 * legal-actions-apply の resolveGrantedEffectMechanic が行う。
 *
 * 登録（CE 本体）は effect-interpreter.executeRegisterGrantedEffect。lifecycle（発揮元離脱で
 * 即停止 / turn 満了）は continuous-effect-rebuild が吸収する。本ファイルは検出のみ。
 *
 * SSOT: 専用 pending を作らず mechanic variant に統合する
 * （[[project_mechanic_triggered_unification]]）。検出は unseal / stone_rebirth と同じく
 * collectAndQueueTriggerReactions のトリガーイベント走査に相乗りする（trigger-system.ts）。
 */
import { isCausedReactionNegated } from "../effect/caused-reaction-negation";
import { requireTriggerChainId } from "../chain-id";
import {
  createMechanicPendingTriggeredEffect,
  type CardDefinition,
  type CardInstance,
  type Condition,
  type ConditionClause,
  type ContinuousEffect,
  type GameState,
  type TriggerEventCause,
} from "../model";
import type { Effect } from "../dsl-types";
import { evaluateCondition } from "../effect/structured-effect-interpreter";
import { getCardById } from "../card/card-lookup";
import { isCEActiveForScope } from "../card/ce-lookup";
import {
  matchesCardFilter,
  matchesCardReferenceFilter,
} from "../card/card-filter";
import {
  canUseEffectByUsageLimit,
  executeReevaluationCheck,
  getCombinedUnitCostFilterOptions,
  getEffectiveColors,
  getEffectiveTribes,
} from "../legal/legal-actions-shared";
import {
  getCombinedUnitSymbolCount,
  getEffectiveLevel,
} from "../battle/battle-shared";
import { matchesDeclaredCardEventKind } from "../zone/leave-field-event-matching";
import { triggerCauseListMatches } from "../effect/trigger-cause-match";
import { getEffectiveSoulStateIds } from "./magic-compatible-soul-state";
import { getTotalCoresOnCardById } from "../core/core-system";
import {
  deriveSuppressionEffectDescriptor,
  resolveTriggerEvents,
} from "../effect/structured-effect-registrations";
import { evaluateApplicability } from "../effect/effect-applicability";
import { getEffectDescriptorSourceKindForPrintedCategory } from "../source-kinds";
import { canExecuteRebirthEffectNow } from "../effect/structured-card-replacement";

let grantedEffectPendingSequence = 0;

/**
 * 同じ grant_effect の対象ごとに生成された CE は effectId が異なる。しかし、被付与効果の
 * 〔ターンに1回:同名〕は同名の被付与カード間で共有するため、usage label を CE 個体へ
 * 分裂させてはいけない。一方、別々のカード・インスタンスが同じ本文をそれぞれ発揮して
 * 付与した権利は独立する。したがって grant 元インスタンスと本文上の effect/step を
 * stable identity にする。
 *
 * `grantedEffectSource` 集約 variant は同じ host step から複数の donor 効果を展開する。
 * その子 key がある場合は donor effect ごとに区別し、異なる取得効果の回数制限を
 * 誤って共有させない。provenance のない旧 CE だけは互換のため effectId にフォールバックする。
 */
export function getGrantedEffectUsageLabel(
  ce: ContinuousEffect,
  variant: "activated" | "triggered"
): string {
  const childKey = ce.metadata?.grantedEffectChildKey as
    | { advSourceInstanceId?: unknown; sourceEffectIndex?: unknown }
    | undefined;
  if (
    typeof childKey?.advSourceInstanceId === "string" &&
    Number.isInteger(childKey.sourceEffectIndex)
  ) {
    return `granted_${variant}:child:${childKey.advSourceInstanceId}:${childKey.sourceEffectIndex}`;
  }
  const provenance = ce.provenance;
  if (
    Number.isInteger(provenance?.effectIndex) &&
    Number.isInteger(provenance?.stepIndex)
  ) {
    const effectSourceDefinitionId =
      provenance?.effectSourceDefinitionId ?? ce.sourceDefinitionId;
    const effectSourceInstanceId =
      provenance?.effectSourceInstanceId ?? ce.sourceInstanceId;
    return `granted_${variant}:effect:${effectSourceInstanceId}:${effectSourceDefinitionId}:${provenance!.effectIndex}:${provenance!.stepIndex}`;
  }
  return `granted_${variant}:legacy-ce:${ce.effectId}`;
}

/** 取得した誘発効果も、元の本文が指定する共有グループを使用する。 */
export function getGrantedTriggeredUsageOptions(
  state: GameState,
  ce: ContinuousEffect,
  grantee: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
) {
  const effect = ce.metadata?.grantedEffect as Effect | undefined;
  return {
    state,
    sourceInstanceId: grantee.instanceId,
    sourceDefinitionId: grantee.definitionId,
    playerId: grantee.controllerPlayerId,
    effectLabel: getGrantedEffectUsageLabel(ce, "triggered"),
    usageLimit: effect?.usageLimit,
    ...(effect?.limitGroupId ? { groupId: effect.limitGroupId } : {}),
    getCardDefinitionById,
  };
}

export function isGrantedTriggeredUsageAvailable(
  ...args: Parameters<typeof getGrantedTriggeredUsageOptions>
): boolean {
  const options = getGrantedTriggeredUsageOptions(...args);
  return (
    canActivateGrantedEffect(...args) &&
    (!options.usageLimit ||
      canUseEffectByUsageLimit({ ...options, usageLimit: options.usageLimit }))
  );
}

/** 付与効果は被付与カードの効果として抑止する（付与元の耐性は引き継がない）。 */
export function canActivateGrantedEffect(
  state: GameState,
  ce: ContinuousEffect,
  grantee: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const effect = ce.metadata?.grantedEffect as Effect | undefined;
  const definition = getCardDefinitionById(grantee.definitionId);
  if (!effect || !definition) return false;
  // 取得した転醒も被付与カード自身の面・カウント・同時転醒制限で判定する。
  // B面に裏面が無い場合、宣言して不発を繰り返す候補にはしない。
  if (
    !canExecuteRebirthEffectNow(
      state,
      grantee.controllerPlayerId,
      effect,
      grantee.instanceId,
      getCardDefinitionById
    )
  )
    return false;
  return executeReevaluationCheck({
    state,
    sourceInstanceId: grantee.instanceId,
    checkKind: "effect_suppression",
    targetInstanceIds: [],
    getCardDefinitionById,
    suppressionEffectDescriptor: deriveSuppressionEffectDescriptor(effect, {
      sourceDefinitionId: grantee.definitionId,
      sourceKind: getEffectDescriptorSourceKindForPrintedCategory(
        definition.printedCategory
      ),
    }),
  });
}

/**
 * 誘発 pending の actingPlayerId を、CE.metadata.grantPlayerRef (grantee 視点の相対参照、
 * 既定 "self") から解決する。"self" → grantee のコントローラ (従来挙動)、"opponent" →
 * grantee の相手 (= grant_effect 発揮元のコントローラ)。ENGINE-grant-effect-player-ref-wiring。
 *
 * "either" (両者が解決可能) は本関数の対象外: PendingTriggeredEffect.actingPlayerId は
 * 単一プレイヤーのみを保持でき、"either" を表現するには model.ts の
 * PreventDeckDiscardAction/RestrictCorePlacementAction 同様、両プレイヤー分の pending を
 * 個別生成する設計が別途必要 (未実装、verifier 2026-07-15 round3 指摘)。現状 "either" は
 * 未定義動作として "self" と同じ既定 (grantee のコントローラ) にフォールバックする
 * （どのカードもまだ "either" を使っていないため無害だが、"either" を使うカードが来たら
 * 先に上記の複製 pending 機構を実装すること）。
 */
function resolveGrantPendingActingPlayerId(
  state: GameState,
  ce: ContinuousEffect,
  grantee: CardInstance
): string {
  const grantPlayerRef =
    (ce.metadata?.grantPlayerRef as
      | "self"
      | "opponent"
      | "either"
      | undefined) ?? "self";
  if (grantPlayerRef !== "opponent") {
    return grantee.controllerPlayerId;
  }
  return (
    state.playerOrder.find((id) => id !== grantee.controllerPlayerId) ??
    grantee.controllerPlayerId
  );
}

function dynamicGrantedEffectGranteeForEvent(
  state: GameState,
  ce: ContinuousEffect,
  event: {
    relatedInstanceId: string | null;
  },
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): CardInstance | undefined {
  if (!ce.targetFilter || !event.relatedInstanceId) return undefined;
  const grantee = getCardById(state, event.relatedInstanceId);
  if (!grantee || grantee.zone !== "field") return undefined;
  const filter = ce.targetFilter;
  const opponentId = state.players.find((p) => p.id !== ce.actingPlayerId)?.id;
  const expectedPlayerId =
    filter.player === "self"
      ? ce.actingPlayerId
      : filter.player === "opponent"
        ? opponentId
        : undefined;
  if (expectedPlayerId && grantee.controllerPlayerId !== expectedPlayerId) {
    return undefined;
  }
  const def = getCardDefinitionById(grantee.definitionId);
  if (!def) return undefined;
  const { player: _player, ...cardFilter } = filter;
  void _player;
  const effectiveTribes = getEffectiveTribes(
    state,
    grantee,
    def,
    getCardDefinitionById
  );
  const coreCount = getTotalCoresOnCardById(state, grantee.instanceId);
  return matchesCardFilter(grantee, def, cardFilter, {
    state,
    effectiveTribes,
    coreCount,
    ...getCombinedUnitCostFilterOptions(
      state,
      grantee,
      def,
      getCardDefinitionById
    ),
    effectiveLevel: getEffectiveLevel(
      state,
      grantee,
      def,
      getCardDefinitionById
    ),
  })
    ? grantee
    : undefined;
}

/**
 * 付与された誘発効果の condition のうち「収集時（誘発検出時）にゲートすべき」スコープ条件の kind。
 *
 * これらはバトル reset 等で transient state が消えるため、解決時（post-reset）の再評価では
 * false になってしまう。誘発収集は reset 前に走る（trigger-system → 本ファイル）ので、検出時に
 * 評価してキュー可否を決め、解決時の executeEffect 再評価からは除外する。
 *
 * 正源: 10_rules/05 §『このスピリットのアタック時』...バトル終了時（BSTH01-X08 と同じ収集時ゲート。
 * 「誘発収集はバトル reset 前(in_battle=true)に走るため、解決が reset 後でも gate は成立する」）。
 * value 系（count_value / field_has 等）は従来どおり解決時に評価する（P3-62「のとき」条件）。
 */
export const COLLECTION_GATED_CONDITION_KINDS: ReadonlySet<string> = new Set([
  "in_battle",
]);

/**
 * condition を「収集時ゲート（スコープ）」節と「解決時評価（value）」節に分割する。
 * SSOT: kind 判別は COLLECTION_GATED_CONDITION_KINDS 一箇所のみ（grant-effect-system 検出・
 * legal-actions-apply 解決の双方がこのヘルパを使う）。
 */
export function splitCollectionGatedCondition(
  condition: Condition | undefined
): {
  scope: Condition;
  rest: Condition;
} {
  const scope: ConditionClause[] = [];
  const rest: ConditionClause[] = [];
  for (const clause of condition ?? []) {
    if (COLLECTION_GATED_CONDITION_KINDS.has(clause.kind)) scope.push(clause);
    else rest.push(clause);
  }
  return { scope, rest };
}

/** 付与効果の trigger 種別（CardEventType 文字列）を配列で返す。 */
function declaredTriggerEvents(effect: Effect): readonly string[] {
  if (
    effect.timing.kind === "card_event" ||
    effect.timing.kind === "game_event"
  ) {
    return Array.isArray(effect.timing.event)
      ? effect.timing.event
      : [effect.timing.event];
  }
  return resolveTriggerEvents(effect.timing);
}

/**
 * 付与効果 grantedEffect が、被付与カード grantee の起こしたイベント event に反応するか。
 *
 * - card_event: grantee 自身のイベント（relatedInstanceId === grantee）かつ宣言イベント一致。
 *   timing.cause 指定時は離脱原因 (ENGINE-grant-effect-leave-field-trigger 残スコープ) も
 *   trigger-system.ts matchesTriggerEvent の matcher.cause と同じ集合包含 + fail-closed で絞る
 *   （「相手によって」以外の離脱で誤発火する gap を解消。BSFT01-TR05(A) 用途）。
 * - game_event: 通常 trigger-system（trigger-system.ts §1290-1510）と同等のスコープ判定を適用する。
 *   grantee（=リスナー）を sourceCard 相当として扱い、timing.player / triggerFilter /
 *   excludeTriggerSelf / requireTriggerSelf を評価する。count_increase 等 player 値イベント
 *   (model.ts L1990-1991) は relatedInstanceId を持たない SSOT のため、card_event と同じ
 *   relatedInstanceId === grantee 必須化はできない（gap: ENGINE-grant-effect-game-event-player-scope）。
 */
function grantedEffectMatchesEvent(
  grantedEffect: Effect,
  grantee: CardInstance,
  event: {
    eventKind: string;
    relatedInstanceId: string | null;
    relatedPlayerId: string | null;
    cause?: TriggerEventCause;
    causedByPlayerId?: string;
    step?: string;
    subPhase?: "start" | "end";
  },
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const timing = grantedEffect.timing;
  if (typeof timing !== "object" || timing === null) return false;

  const declared = declaredTriggerEvents(grantedEffect);

  if (timing.kind === "phase") {
    if (!declared.includes(event.eventKind)) return false;
    if (timing.step && timing.step !== (event.step ?? state.step)) return false;
    if ((timing.subPhase ?? "start") !== (event.subPhase ?? "start"))
      return false;
    const ownerTurn =
      (event.relatedPlayerId ?? state.activePlayerId) ===
      grantee.controllerPlayerId;
    if (timing.whose === "self" && !ownerTurn) return false;
    if (timing.whose === "opponent" && ownerTurn) return false;
    return true;
  }

  if (timing.kind === "card_event") {
    // leave_field umbrella (trigger-system.ts と SSOT): 宣言 leave_field は
    // pre-flush destroy/vanish/bounce にも一致させる。
    if (!matchesDeclaredCardEventKind(declared, event.eventKind)) return false;
    if (event.relatedInstanceId !== grantee.instanceId) return false;
    // cause フィルタ: 指定時はイベントの cause が集合に含まれる場合のみ一致
    // (trigger-system.ts matchesTriggerEvent と同じ fail-closed。cause 未指定イベントでは不一致)。
    if (timing.cause !== undefined) {
      const allowedCauses = Array.isArray(timing.cause)
        ? timing.cause
        : [timing.cause];
      if (
        event.cause === undefined ||
        !triggerCauseListMatches(allowedCauses, event.cause)
      ) {
        return false;
      }
    }
    return true;
  }

  if (timing.kind !== "game_event") return false;
  if (!declared.includes(event.eventKind)) return false;
  if (timing.afterPhysicalLeave && event.eventKind !== "leave_field")
    return false;

  // cause フィルタ: card_event 分岐と同じ SSOT (trigger-system.ts matchesTriggerEvent、
  // fail-closed。cause 未指定イベントでは不一致)。engine-player-scoped-turn-reservation
  // (BSKB01-R04「相手によって」) で初めて game_event variant の cause 絞り込みが必要になり
  // 追加 (それまでは card_event 分岐のみ実装されていた既存 gap)。
  if (timing.cause !== undefined) {
    const allowedCauses = Array.isArray(timing.cause)
      ? timing.cause
      : [timing.cause];
    if (
      event.cause === undefined ||
      !triggerCauseListMatches(allowedCauses, event.cause)
    ) {
      return false;
    }
  }

  // cause が battle のように行為種別だけを表す場合でも、「相手によって」を実際の
  // 加害者で判定する。原因未伝播イベントは fail-closed。BS48 Q22983: 自分の
  // スピリットのアタックで自分のライフを減らした場合は発揮できない。
  if (timing.triggerCausedBy !== undefined) {
    if (event.causedByPlayerId === undefined) return false;
    const isSelfCaused = event.causedByPlayerId === grantee.controllerPlayerId;
    if (
      (timing.triggerCausedBy === "self" && !isSelfCaused) ||
      (timing.triggerCausedBy === "opponent" && isSelfCaused)
    ) {
      return false;
    }
  }

  // 召喚 responder のカテゴリースコープ (trigger-system.ts summonResponderMatchesCategoryScope と SSOT)。
  // 汎用「召喚されたとき」(triggerFilter.category 未明示) はスピリット召喚にのみ反応する。
  // ブレイヴ/アルティメット自身の「召喚時」は card_event:summon 経路で別途発火。
  // 同 helper の place 分岐 (relatedInstanceId が nexus 以外なら不反応) も再現する。
  if (event.eventKind === "place" && event.relatedInstanceId !== null) {
    const role = getCardById(state, event.relatedInstanceId)?.zoneRoleName;
    if (role !== undefined && role !== "nexus") return false;
  } else if (event.eventKind === "summon" && event.relatedInstanceId !== null) {
    const role = getCardById(state, event.relatedInstanceId)?.zoneRoleName;
    if (role !== "spirit") {
      const categoryExplicit =
        timing.triggerFilter?.category !== undefined &&
        timing.triggerFilter.category.length > 0;
      if (!categoryExplicit) return false;
    }
  }

  // P3-27: player フィルタ ("self" / "opponent" / "either")
  if (timing.player !== undefined && timing.player !== "either") {
    if (event.relatedPlayerId === null) {
      // 文脈 (relatedPlayerId) がない → 評価不能 → fail-closed
      return false;
    }
    const isOwnEvent = event.relatedPlayerId === grantee.controllerPlayerId;
    if (timing.player === "self" && !isOwnEvent) return false;
    if (timing.player === "opponent" && isOwnEvent) return false;
  }

  // 「このスピリットの召喚以外で」型の自己除外
  if (
    timing.excludeTriggerSelf === true &&
    event.relatedInstanceId === grantee.instanceId
  ) {
    return false;
  }
  // 「このスピリットの効果で〜したとき」型の自己ソース絞り
  if (
    timing.requireTriggerSelf === true &&
    event.relatedInstanceId !== grantee.instanceId
  ) {
    return false;
  }

  // P3-27: triggerFilter — 召喚されたカード等が指定 filter にマッチするか
  if (timing.triggerFilter !== undefined) {
    if (event.relatedInstanceId === null) {
      // triggerFilter が指定されているが対象カードが特定できない → fail-closed
      return false;
    }
    const triggerCard = getCardById(state, event.relatedInstanceId);
    if (!triggerCard) return false;
    const triggerDef = getCardDefinitionById(triggerCard.definitionId);
    if (!triggerDef) return false;
    const granteeDef = getCardDefinitionById(grantee.definitionId);
    if (!granteeDef) return false;
    if (
      !matchesCardReferenceFilter(
        triggerCard,
        triggerDef,
        timing.triggerFilter,
        {
          soulStateIds: getEffectiveSoulStateIds(state, getCardDefinitionById),
          sourceDefinition: granteeDef,
          effectiveColors: getEffectiveColors(state, triggerCard, triggerDef),
          ...getCombinedUnitCostFilterOptions(
            state,
            triggerCard,
            triggerDef,
            getCardDefinitionById
          ),
          effectiveLevel:
            triggerCard.zone === "field"
              ? getEffectiveLevel(
                  state,
                  triggerCard,
                  triggerDef,
                  getCardDefinitionById
                )
              : undefined,
          effectiveSymbolCount:
            triggerCard.zone === "field"
              ? getCombinedUnitSymbolCount(
                  state,
                  triggerCard,
                  triggerDef,
                  getCardDefinitionById
                )
              : undefined,
          state,
        }
      )
    ) {
      return false;
    }
  }

  return true;
}

/**
 * P3-99 §3: 付与された誘発効果の発火を検出して mechanic 付き pending をキューする。
 *
 * 早期 return: active な granted_effect CE が無ければ何もしない（fuzz hot-path 保護）。
 */
export function queueGrantedEffectTriggersFromTriggerEvents(
  state: GameState,
  events: ReadonlyArray<{
    eventKind: string;
    relatedInstanceId: string | null;
    relatedPlayerId: string | null;
    chainId?: string | null;
    cause?: TriggerEventCause;
    causedByPlayerId?: string;
    amount?: number | null;
    preFlushLeaveEvent?: boolean;
    step?: string;
    subPhase?: "start" | "end";
  }>,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const grantedEffectCes = state.activeContinuousEffects.filter(
    (ce) => ce.modifierTag === "granted_effect"
  );
  if (grantedEffectCes.length === 0) return state;

  const newPendings = [];
  const queuedKeys = new Set(
    state.pendingTriggeredEffects
      .filter((pending) => pending.mechanic?.kind === "granted_effect")
      .map((pending) =>
        pending.mechanic?.kind === "granted_effect"
          ? [
              pending.mechanic.grantCeEffectId,
              pending.mechanic.granteeInstanceId,
              pending.chainId ?? "",
              pending.relatedInstanceId ?? "",
            ].join("\u0000")
          : ""
      )
  );
  for (const ce of grantedEffectCes) {
    const grantedEffect = ce.metadata?.grantedEffect as Effect | undefined;
    if (!grantedEffect) continue;
    // 付与効果に trigger が無い（起動権 variant 等）は誘発検出の対象外。
    if (declaredTriggerEvents(grantedEffect).length === 0) continue;
    // timingScope (「自分のアタックステップ」等) の窓外なら誘発検出しない。
    // 他 CE 消費経路 (legal-actions-shared / stack-resolution-core / pay-to-act-*-gate)
    // と同じ isCEActiveForScope SSOT (BSTH09-X02 で新規配線)。
    if (!isCEActiveForScope(ce, state.step, state.activePlayerId)) continue;

    const matches: Array<{
      event: (typeof events)[number];
      grantee: CardInstance;
    }> = [];
    if (ce.targetInstanceId) {
      const grantee = getCardById(state, ce.targetInstanceId);
      const isTurnReservation = ce.metadata?.turnReservation === true;
      if (!grantee || (!isTurnReservation && grantee.zone !== "field"))
        continue;
      const matchedEvent = events.find((event) =>
        grantedEffectMatchesEvent(
          grantedEffect,
          grantee,
          event,
          state,
          getCardDefinitionById
        )
      );
      if (matchedEvent) matches.push({ event: matchedEvent, grantee });
    } else {
      for (const event of events) {
        const grantee = dynamicGrantedEffectGranteeForEvent(
          state,
          ce,
          event,
          getCardDefinitionById
        );
        if (
          grantee &&
          grantedEffectMatchesEvent(
            grantedEffect,
            grantee,
            event,
            state,
            getCardDefinitionById
          )
        ) {
          matches.push({ event, grantee });
        }
      }
    }

    for (const { event: matchedEvent, grantee } of matches) {
      if (
        isCausedReactionNegated(
          state,
          matchedEvent.chainId,
          resolveGrantPendingActingPlayerId(state, ce, grantee),
          "effect"
        )
      )
        continue;
      if (
        grantedEffect.applicability &&
        !evaluateApplicability(
          state,
          grantedEffect.applicability,
          grantee.instanceId,
          getCardDefinitionById
        )
      )
        continue;
      if (
        !isGrantedTriggeredUsageAvailable(
          state,
          ce,
          grantee,
          getCardDefinitionById
        )
      )
        continue;
      const granteeInstanceId = grantee.instanceId;
      const pendingKey = [
        ce.effectId,
        granteeInstanceId,
        matchedEvent.chainId ?? "",
        matchedEvent.relatedInstanceId ?? "",
      ].join("\u0000");
      const leave = state.pendingLeaveEntities.find(
        (entry) => entry.instanceId === matchedEvent.relatedInstanceId
      );
      const leaveSourceKey = `granted:${ce.effectId}:${granteeInstanceId}`;
      if (
        queuedKeys.has(pendingKey) ||
        (matchedEvent.preFlushLeaveEvent &&
          leave?.resolvedSourceRegistrationKeys?.includes(leaveSourceKey))
      ) {
        continue;
      }

      // 収集時ゲート: スコープ条件（in_battle 等）はバトル reset 前の今ここで評価する。
      // 解決時（post-reset）の executeEffect では transient state が消えて false になるため、
      // ここで満たさないなら pending を積まない（10_rules/05 X08 と同じ）。value 系条件は
      // 解決時に評価するのでここでは見ない。
      const { scope } = splitCollectionGatedCondition(grantedEffect.condition);
      if (
        scope.length > 0 &&
        !evaluateCondition(
          state,
          scope,
          granteeInstanceId,
          grantee.controllerPlayerId,
          getCardDefinitionById
        )
      ) {
        continue;
      }

      newPendings.push({
        ...createMechanicPendingTriggeredEffect({
          state,
          pendingId: `granted-effect-${ce.effectId}-${granteeInstanceId}-${grantedEffectPendingSequence++}`,
          // 「できる」＝被付与カードの持ち主が発揮を選択する（grantPlayerRef:self 既定）。
          // grantPlayerRef:"opponent" (RegisterGrantedEffectAction.grantPlayerRef、
          // grantee 視点の相対参照) 指定時は被付与カードの相手 (=付与元のコントローラ) が
          // 発揮を選択する。「被付与カードに、付与元コントローラ視点の効果を持たせる」型
          // (BSAZ02-C09「相手は相手の創界神ネクサス1つを指定できる」二重『相手』) 用。
          actingPlayerId: resolveGrantPendingActingPlayerId(state, ce, grantee),
          relatedInstanceId: granteeInstanceId,
          // ENGINE-grant-effect-pre-flush-window: 発火元イベントの chainId を継承する。
          // leave_field 系 (destroy/vanish/bounce) 付与効果では、これにより
          // canFlushPendingLeaveEntity の離脱者自身への pending 反応チェックが本 pending を
          // 検出でき、stay_on_field 等の解決窓が物理 flush より前に確保される。
          chainId: requireTriggerChainId(matchedEvent.chainId),
          // P3-14 C-5 と同型: `DynamicCount.event_amount` (「減った数1につき」等) の解決元に
          // イベント量を転写する (engine-player-scoped-turn-reservation、BSKB01-R04 初出)。
          amount: matchedEvent.amount ?? null,
          mechanic: {
            kind: "granted_effect",
            grantCeEffectId: ce.effectId,
            granteeInstanceId,
          },
        }),
        ...(matchedEvent.preFlushLeaveEvent
          ? { preFlushLeaveEvent: true }
          : {}),
      });
      queuedKeys.add(pendingKey);
      if (matchedEvent.preFlushLeaveEvent && leave) {
        state = {
          ...state,
          pendingLeaveEntities: state.pendingLeaveEntities.map((entry) =>
            entry === leave
              ? {
                  ...entry,
                  resolvedSourceRegistrationKeys: [
                    ...new Set([
                      ...(entry.resolvedSourceRegistrationKeys ?? []),
                      leaveSourceKey,
                    ]),
                  ],
                }
              : entry
          ),
        };
      }
    }
  }

  if (newPendings.length === 0) return state;

  return {
    ...state,
    pendingTriggeredEffects: [...state.pendingTriggeredEffects, ...newPendings],
  };
}
