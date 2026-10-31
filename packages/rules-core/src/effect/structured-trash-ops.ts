// Trash-ops クラスタ (P2-12): structured-effect-interpreter.ts から抽出。
// トラッシュ送り連動効果の検出・処理と遅延任意追加の具現化。

import { getCardById } from "../card/card-lookup";
import { putCardOnField } from "../card/put-card-on-field";
import { moveCardZone } from "../core/core-system";
import { recordHandEntries } from "../zone/hand-increase";
import { queueCardEventBonusSteps } from "./card-event-bonus-steps";
import { isCardUseRestricted } from "../legal/legal-actions-shared";
import type { CardDefinition, GameState, RevealedDisposition } from "../model";
import { evaluateCondition } from "./structured-condition-eval";
import { recomputeAndRebuildContinuousEffectsForSources } from "./continuous-effect-rebuild";
import type { TriggerContext } from "./structured-effect-interpreter";
import {
  buildRevealedChoicePending,
  resolveCardEventDisposition,
} from "./structured-effect-interpreter";

/**
 * カード定義の effects から revealed 自動効果を検索する。
 * triggerContext: オープンを引き起こした効果の色・元ゾーン等を含むコンテキスト。
 * steps を解析して disposition（カードの処理種別）を返す。
 */
export function findRevealedEffect(
  state: GameState,
  cardInstanceId: string,
  cardDef: CardDefinition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  triggerContext: TriggerContext
):
  | {
      executionMode: "mandatory" | "optional";
      disposition: RevealedDisposition;
      noDuplicateKey?: string;
    }
  | undefined {
  if (!cardDef.effects) return undefined;
  const card = getCardById(state, cardInstanceId);
  if (!card) return undefined;

  for (const [effectIndex, effect] of cardDef.effects.entries()) {
    const timing = effect.timing;
    if (timing.kind !== "card_event") continue;
    const events = Array.isArray(timing.event) ? timing.event : [timing.event];
    if (!events.includes("revealed")) continue;

    // 全条件を汎用評価（trigger_colors, trigger_from_zone 等すべて対応）
    if (effect.condition && effect.condition.length > 0) {
      if (
        !evaluateCondition(
          state,
          effect.condition,
          cardInstanceId,
          card.ownerPlayerId,
          getCardDefinitionById,
          triggerContext
        )
      )
        continue;
    }

    const disp = resolveCardEventDisposition(effect);
    // CardEventDisposition → RevealedDisposition 変換（remove_from_game は revealed では steps_only 扱い）
    const disposition: RevealedDisposition =
      disp.kind === "remove_from_game"
        ? { kind: "steps_only" }
        : (disp as RevealedDisposition);
    return {
      executionMode: effect.executionMode ?? "optional",
      disposition,
      ...((Array.isArray(effect.usageLimit)
        ? effect.usageLimit
        : [effect.usageLimit]
      ).some((limit) => limit?.kind === "no_duplicate")
        ? {
            noDuplicateKey: JSON.stringify([
              card.ownerPlayerId,
              cardDef.name,
              effectIndex,
            ]),
          }
        : {}),
    };
  }
  return undefined;
}

/**
 * カード定義の effects から moved_to_trash 自動効果を検索する。
 * 全 ConditionClause を evaluateCondition で評価する（trigger_colors, trigger_from_zone 含む）。
 */
export function findMovedToTrashAutoEffect(
  state: GameState,
  cardInstanceId: string,
  cardDef: CardDefinition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  triggerContext: TriggerContext
):
  | {
      executionMode: "mandatory" | "optional";
      kind:
        | "add_to_hand"
        | "remove_from_game"
        | "swap"
        | "move_to_field"
        | "move_to_set_aside"
        | "set_as_mirage"
        | "blocked";
      /** disposition 以外の追加ステップ（core_move 等のボーナス処理用） */
      bonusSteps: ReadonlyArray<import("../dsl-types").EffectStep>;
    }
  | undefined {
  if (!cardDef.effects) return undefined;
  const card = getCardById(state, cardInstanceId);
  if (!card) return undefined;
  if (
    isCardUseRestricted(
      state,
      card.ownerPlayerId,
      card,
      cardDef,
      getCardDefinitionById
    )
  ) {
    return undefined;
  }

  for (const effect of cardDef.effects) {
    const timing = effect.timing;
    if (timing.kind !== "card_event") continue;
    const events = Array.isArray(timing.event) ? timing.event : [timing.event];
    if (!events.includes("moved_to_trash")) continue;

    // 全条件を汎用評価（trigger_colors, trigger_from_zone, field_has 等すべて対応）
    if (effect.condition && effect.condition.length > 0) {
      if (
        !evaluateCondition(
          state,
          effect.condition,
          cardInstanceId,
          card.ownerPlayerId,
          getCardDefinitionById,
          triggerContext
        )
      )
        continue;
    }

    // cardEventDisposition を優先、なければ steps から推論
    const disp = resolveCardEventDisposition(effect);
    const kind:
      | "add_to_hand"
      | "remove_from_game"
      | "swap"
      | "move_to_field"
      | "set_as_mirage"
      | "move_to_set_aside"
      | "blocked" =
      disp.kind === "remove_from_game"
        ? "remove_from_game"
        : disp.kind === "blocked"
          ? "blocked"
          : disp.kind === "swap"
            ? "swap"
            : disp.kind === "move" && disp.destination === "field"
              ? "move_to_field"
              : disp.kind === "move" && disp.destination === "set_aside"
                ? "move_to_set_aside"
                : disp.kind === "set_as_mirage"
                  ? "set_as_mirage"
                  : "add_to_hand";

    // disposition 以外のステップを bonus として抽出
    const bonusSteps = effect.steps.filter(
      (s) =>
        s.action.kind !== "move_self" && s.action.kind !== "remove_from_game"
    );

    return {
      executionMode: effect.executionMode ?? "mandatory",
      kind,
      bonusSteps,
    };
  }
  return undefined;
}

/**
 * トラッシュに移動したカード群に対して moved_to_trash 自動効果を適用する。
 * - add_to_hand: trash → hand に移動 + handCount++ + ボーナスコア
 * - remove_from_game: trash → removed_from_game に移動
 *
 * @param triggerContext.sourceColors 効果を引き起こしたカードの色（trigger_colors 評価用）
 * @param triggerContext.fromZone 論理上のイベント起点（trigger_from_zone 評価用）
 * @param beforeMoveState 実移動前の state。渡された場合は physicalFromZone を導出し、
 *   trigger_physical_from_zone でだけ評価する。
 */
export function processMovedToTrashEffects(
  state: GameState,
  movedToTrashIds: string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  triggerContext: TriggerContext,
  beforeMoveState?: GameState
): GameState {
  if (movedToTrashIds.length === 0) return state;

  // 移動先で有効になる常時効果は、移動時誘発や後続 step の候補判定より先に
  // 登録する。デッキ上で受けた移動は止めず、到着後の回収にはトラッシュ耐性を適用する。
  state = recomputeAndRebuildContinuousEffectsForSources(
    state,
    getCardDefinitionById,
    movedToTrashIds
  );

  // 各カードの moved_to_trash 効果をマッチング。
  // mandatory（「加える」「ゲームから除外する」等）は即時適用、
  // optional（「加えられる」= 任意）は revealed_choice pending を生成してプレイヤーに可否を問う。
  const matched: Array<{
    instanceId: string;
    kind:
      | "add_to_hand"
      | "remove_from_game"
      | "move_to_field"
      | "move_to_set_aside";
    bonusSteps: ReadonlyArray<import("../dsl-types").EffectStep>;
  }> = [];
  const optionalAddIds: string[] = [];
  const optionalDispositionByInstanceId: Record<string, RevealedDisposition> =
    {};
  // swap 型（「手札1枚と入れ替えられる」）候補。常に任意（可能形語尾）。
  const optionalSwapIds: string[] = [];
  // 任意受理候補のボーナスステップ（core_move 等）。手札へ実際に受理された候補にのみ
  // resolve_pending_deck_reveal_pick 側で実行する（engine-trash-optional-bonus-steps）。
  const optionalBonusStepsByInstanceId: Record<
    string,
    ReadonlyArray<import("../dsl-types").EffectStep>
  > = {};

  for (const instanceId of movedToTrashIds) {
    const card = getCardById(state, instanceId);
    if (!card || card.zone !== "trash") continue;
    const def = getCardDefinitionById(card.definitionId);
    if (!def) continue;
    const physicalFromZone = beforeMoveState
      ? getCardById(beforeMoveState, instanceId)?.zone
      : (triggerContext.physicalFromZone ?? triggerContext.fromZone);
    const contextWithPhysicalFromZone =
      physicalFromZone !== undefined
        ? { ...triggerContext, physicalFromZone }
        : triggerContext;
    const match = findMovedToTrashAutoEffect(
      state,
      instanceId,
      def,
      getCardDefinitionById,
      contextWithPhysicalFromZone
    );
    if (!match) continue;
    if (match.kind === "blocked") {
      continue;
    }
    if (match.kind === "swap") {
      // 「手札1枚と入れ替えられる」= 任意。プレイヤー選択へ委ねる（trash 据え置きも選べる）。
      optionalAddIds.push(instanceId);
      optionalSwapIds.push(instanceId);
      optionalDispositionByInstanceId[instanceId] = { kind: "swap" };
      continue;
    }
    if (match.kind === "set_as_mirage") {
      if (match.executionMode !== "optional") {
        throw new Error(
          "set_as_mirage card_event disposition must be optional"
        );
      }
      optionalAddIds.push(instanceId);
      optionalDispositionByInstanceId[instanceId] = { kind: "set_as_mirage" };
      continue;
    }
    if (
      match.executionMode === "optional" &&
      (match.kind === "add_to_hand" ||
        match.kind === "move_to_field" ||
        match.kind === "move_to_set_aside")
    ) {
      // 任意の受理効果はプレイヤー選択へ委ねる（trash 据え置きも選べる）。
      // ボーナスステップ（core_move 等）は resolve_pending_deck_reveal_pick が
      // 実際に手札へ受理した候補にのみ適用する（BSTH02-R11/BSTH03-C11/C12 型）。
      if (match.bonusSteps.length > 0) {
        optionalBonusStepsByInstanceId[instanceId] = match.bonusSteps;
      }
      optionalAddIds.push(instanceId);
      optionalDispositionByInstanceId[instanceId] =
        match.kind === "move_to_field"
          ? { kind: "move", destination: "field" }
          : match.kind === "move_to_set_aside"
            ? { kind: "move", destination: "set_aside" }
            : { kind: "move", destination: "hand" };
      continue;
    }
    matched.push({
      instanceId,
      kind: match.kind,
      bonusSteps: match.bonusSteps,
    });
  }

  if (matched.length === 0 && optionalAddIds.length === 0) return state;

  let result = state;

  // ゾーン変更: moveCardZone で handCount も自動更新
  for (const { instanceId, kind } of matched) {
    const card = getCardById(result, instanceId);
    const def = card ? getCardDefinitionById(card.definitionId) : undefined;
    if (kind === "add_to_hand") {
      result = recordHandEntries(
        result,
        moveCardZone(result, instanceId, "hand"),
        () => ({
          playerId: card!.ownerPlayerId,
          sourceInstanceId: instanceId,
          sourceDefinitionId: card!.definitionId,
        })
      );
      result.log.push(
        `moved_to_trash:add_to_hand:${card?.ownerPlayerId}:${def?.name ?? instanceId}`
      );
    } else if (kind === "move_to_field") {
      // engine-field-magic-self-placement: タイプ:作戦 の強制フィールド残置
      // (「フラッシュ効果使用後以外でトラッシュに置かれたこのカードはフィールドに置く」)。
      result = putCardOnField(result, instanceId, getCardDefinitionById);
      if (getCardById(result, instanceId)?.zone !== "field") continue;
      result.log.push(
        `moved_to_trash:move_to_field:${card?.ownerPlayerId}:${def?.name ?? instanceId}`
      );
    } else if (kind === "move_to_set_aside") {
      result = moveCardZone(result, instanceId, "set_aside");
      result.log.push(
        `moved_to_trash:move_to_set_aside:${card?.ownerPlayerId}:${def?.name ?? instanceId}`
      );
    } else {
      result = moveCardZone(result, instanceId, "removed_from_game");
      result.log.push(
        `moved_to_trash:remove_from_game:${card?.ownerPlayerId}:${def?.name ?? instanceId}`
      );
    }
  }

  // ボーナスステップ処理: core_move 等の DSL アクションを実行
  for (const { instanceId, bonusSteps } of matched) {
    result = queueCardEventBonusSteps(
      result,
      instanceId,
      bonusSteps,
      getCardDefinitionById
    );
  }

  // 任意手札追加: ここでは即座に pending を立てず、発火待ちキューに退避する。
  // 「トラッシュに置かれたとき手札に加えられる」は誘発効果のため、ソース効果（例: R05 アクセルの
  // コア取得ステップ）が完全に解決した後に発揮される。mid-effect で pendingDeckReveal を立てると
  // ステップループが中断しソース効果の後続ステップが飛ぶため、安定点で materialize する。
  if (optionalAddIds.length > 0) {
    const owner = getCardById(result, optionalAddIds[0]!)?.ownerPlayerId ?? "";
    result.log.push(
      `moved_to_trash:optional_deferred:${owner}:${optionalAddIds.length}`
    );
    return {
      ...result,
      pendingTrashOptionalAdds: [
        ...result.pendingTrashOptionalAdds,
        {
          actingPlayerId: owner,
          instanceIds: [...optionalAddIds],
          ...(optionalSwapIds.length > 0
            ? { swapInstanceIds: [...optionalSwapIds] }
            : {}),
          ...(Object.keys(optionalDispositionByInstanceId).length > 0
            ? {
                dispositionByInstanceId: {
                  ...optionalDispositionByInstanceId,
                },
              }
            : {}),
          ...(Object.keys(optionalBonusStepsByInstanceId).length > 0
            ? {
                bonusStepsByInstanceId: {
                  ...optionalBonusStepsByInstanceId,
                },
              }
            : {}),
        },
      ],
    };
  }

  return result;
}

/**
 * 発火待ちの moved_to_trash 任意手札追加 (`pendingTrashOptionalAdds`) を、
 * 他の pending が無い安定点で `pendingDeckReveal`(origin="trash", revealed_choice) に変換する。
 *
 * - ソース効果（とその pending: コア配分・ゾーン選択等）が全て解決し、誘発キューも空のときだけ発火。
 *   = 「置いた効果の解決後に誘発効果が発揮される」BS タイミングを近似する。
 * - 一度に 1 エントリだけ materialize する（複数エントリは現在の choice 解決後に順次処理）。
 * - 既にトラッシュを離れた候補は除外する（mandatory 処理等で動いた場合の保険）。
 *
 * `applyLegalAction` と `advanceStep` の安定化ポイントから呼ばれる。
 */
export function materializeDeferredTrashOptionalAdds(
  state: GameState
): GameState {
  if (state.pendingTrashOptionalAdds.length === 0) return state;
  // 他の対話的 pending / 解決中キューがあるうちは発火させない。
  if (
    state.pendingDeckReveal !== null ||
    state.pendingZoneSelection !== null ||
    state.pendingStepOptionalChoice !== null ||
    state.pendingStepChoice !== null ||
    state.pendingStepOptionalTargetSelection !== null ||
    state.pendingCoreShootSelection !== null ||
    state.pendingAsIfSoulCoreChoice !== null ||
    state.pendingEffectOptionalRepeatChoice !== null ||
    state.pendingEffectOptionalRepeatCountSelection !== null ||
    state.pendingCoreSplitSelection !== null ||
    state.pendingCoreDistribution !== null ||
    state.pendingChangeCleanupChoice !== null ||
    state.pendingCoreSourceAllocation !== null ||
    state.pendingLinkAidCostSourceChoice !== null ||
    state.pendingEffectSummonCostPayment !== null ||
    state.pendingEnterFieldPlacement !== null ||
    state.pendingBraveCombineChoice !== null ||
    state.pendingMultiPlacement !== null ||
    state.pendingSoulStateReplacement !== null ||
    state.pendingBraveLeaveChoice !== null ||
    state.pendingBraveAttackContinuation !== null ||
    state.pendingTargetRedirects.length > 0 ||
    state.pendingTriggeredEffects.length > 0 ||
    state.pendingDeferredTriggeredEffects.length > 0 ||
    state.pendingBurstChecks.length > 0 ||
    state.pendingLeaveEntities.length > 0 ||
    (state.pendingAccelCleanups ?? []).length > 0 ||
    state.pendingSetAsideExitReplacementChoice !== null ||
    state.stackWindow !== null
  ) {
    return state;
  }

  const [entry, ...rest] = state.pendingTrashOptionalAdds;
  if (!entry) return state;

  // まだトラッシュに残っている候補だけを対象にする。
  const validIds = entry.instanceIds.filter(
    (id) => getCardById(state, id)?.zone === "trash"
  );
  if (validIds.length === 0) {
    // 候補が消えていればエントリを破棄して次へ。
    return materializeDeferredTrashOptionalAdds({
      ...state,
      pendingTrashOptionalAdds: rest,
    });
  }

  const swapSet = new Set(entry.swapInstanceIds ?? []);
  const revealedDispositionMap: Record<
    string,
    import("../model").RevealedDisposition
  > = {};
  for (const id of validIds) {
    revealedDispositionMap[id] =
      entry.dispositionByInstanceId?.[id] ??
      (swapSet.has(id)
        ? { kind: "swap" }
        : { kind: "move", destination: "hand" });
  }

  return {
    ...state,
    pendingTrashOptionalAdds: rest,
    log: [
      ...state.log,
      `moved_to_trash:optional_choice:${entry.actingPlayerId}:${validIds.length}`,
    ],
    pendingDeckReveal: buildRevealedChoicePending({
      actingPlayerId: entry.actingPlayerId,
      sourceInstanceId: "dsl-trash-optional",
      sourceDefinitionId: "dsl-trash-optional",
      revealedCardInstanceIds: [...validIds],
      picks: [],
      remainder: "trash",
      phase: "revealed_choice",
      origin: "trash",
      optionalCandidateIds: [...validIds],
      revealedDispositionMap,
      ...(entry.bonusStepsByInstanceId
        ? { bonusStepsByInstanceId: entry.bonusStepsByInstanceId }
        : {}),
      priorStateSnapshot: state,
    }),
  };
}
