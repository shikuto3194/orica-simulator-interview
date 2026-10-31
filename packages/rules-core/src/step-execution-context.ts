// ============================================================
// StepExecutionContext — EffectStep 間のクロスステップ参照
// ============================================================

import type {
  EffectActivationSourceZone,
  EffectActivationTiming,
  EffectUsageLimit,
  GameState,
  PendingLeaveKind,
  RebirthCountBonusMode,
} from "./model";

export type ActivationZone = EffectActivationSourceZone;

/**
 * 1 ステップの実行結果。
 * 後続ステップから stepId で参照される。
 */
export interface StepResult {
  stepId: string;
  /** このステップで影響を受けたカードインスタンスID */
  affectedCardInstanceIds: string[];
  /**
   * bp_modify step で実効 BP が >0 から 0 へ遷移したカード。
   * 「BP0になった」後続処理の対象を、現在 BP0 の状態再スキャンと分離する。
   */
  bpBecameZeroCardInstanceIds?: string[];
  /**
   * deck_reveal step で実際に手札へ加わったカードインスタンスID。
   * pick 候補が複数あり pendingDeckReveal 経由の非同期選択になる場合、この値は
   * pending 解決完了時点で該当 StepResult を事後更新して確定させる
   * (ENGINE-deck-reveal-hand-added-tracking)。「手札に加えなかったとき」を
   * ゲートする後続 `ref_count(result:"hand_added")` から参照される。
   */
  handAddedCardInstanceIds?: string[];
  /**
   * deck_reveal step でオープンされたカード全体の instanceId（pick/remainder の行き先に
   * 関係なく revealCount 分すべて）。「その中の X カード1枚につき」型 (BSLH01-C14) の
   * `DynamicCountSource.cards_from_ref(result:"revealed")` から参照される。
   * `affectedCardInstanceIds`(=hand-added。`ref` TargetSpec 等の既存解決が依存) とは
   * 独立に保持する。pending 解決完了時点で該当 StepResult へ事後設定される点は
   * handAddedCardInstanceIds と同型 (ENGINE-deck-reveal-hand-added-tracking)。
   */
  revealedCardInstanceIds?: string[];
  /**
   * after_triggers の SBA/flush 前に、affectedCardInstanceIds のうち
   * pending leave 化したカードの離脱種別を記録する。
   * flush 後の stepCondition で「この効果で消滅したとき」等を原因別に参照するために使う。
   */
  leftFieldKindsByCardId?: Record<string, PendingLeaveKind>;
  /** 誘発・残留・実移動に先立って成立した結果。発揮元自身の結果も含む。 */
  establishedLeaveKindsByCardId?: Record<string, PendingLeaveKind>;
  /** ステップが成功したか（1 枚以上処理された等） */
  succeeded: boolean;
  /**
   * ステップ action body が実際に走ったか（log/state 変化を残した）。
   * succeeded と異なり「処理対象が耐性等で結果ゼロでも、動作はした」場合に true となる。
   * `ref_executed` StepCondition から参照される。記録時点で log/state 変化を検出し、
   * 行わなかった step (early return / unsupported / pre-execute skip) では false。
   */
  executed?: boolean;
  /**
   * この step が相手効果由来の終了妨害 (`restrict_end_*`) を受けて不成立になったか。
   * 「相手の効果を受けたとき、この効果をもう一度だけ発揮できる」型の後続 optional
   * step が、単なる対象不足/非アタックステップ不成立と区別して参照する。
   */
  blockedByOpponentEffect?: boolean;
  /**
   * 選択されたチョイスインデックス。
   * step.choice が存在し、かつ実行時に choiceIndex が確定した場合のみ設定。
   * 0 = デフォルト action、1+ = choice[N-1]。
   * step.choice なしのステップでは undefined。
   */
  chosenChoiceIndex?: number;
  /** conditional_cost ロールバック用のスナップショット */
  stateSnapshot?: GameState;
  /**
   * `allowPostRebirthCorePlacementForLvDeficit` 型の rebirth step は、直後の
   * core_distribute が最低 Lv コアを満たすまで count+1 / 転醒時誘発を完了させない。
   */
  rebirthDefersCompletion?: boolean;
  /** 完了保留中 rebirth の B 面定型 count 処理。 */
  rebirthCountBonusMode?: RebirthCountBonusMode;
  /**
   * `count_decrease`/`count_increase` step で実際に解決された数量。
   * `DynamicCountSource.step_numeric_amount` から stepId で参照される
   * (ENGINE-cost-modify-additional-cost-value-dynamic-amount、「減らしたカウント1につき」型)。
   * 対象外の action kind では未設定。
   */
  numericAmount?: number;
}

export interface PendingConditionalCostRollback {
  /** conditional_cost のコスト側 step 実行前 snapshot。 */
  originalState: GameState;
  /** rollback log / usage refund の対象になる発揮元。 */
  sourceInstanceId: string;
  /** この中の step が 1 つでも成功すれば rollback を取り消す。 */
  alternativeStepIds: string[];
  /** 最終的に rollback するときに元の失敗理由 log を復元する。 */
  failureLogEntries: string[];
}

/**
 * Effect 内のステップ実行中に蓄積されるコンテキスト。
 * ステップ間参照（TargetSpec.ref / StepCondition / DynamicCount.cards_from_ref）で使用。
 */
export interface StepExecutionContext {
  /** 対話解決の入力待ちを、全種類のpending継続で保持する。未指定は既存の自動解決。 */
  promptUnresolvedChoice?: boolean;
  /** バーストの実効後処理ポリシーを、交換位置の入力継続まで保持する。 */
  burstPostResolutionDestination?: "burst" | "trash";
  /** この発揮より前の開示履歴を、現在の候補の閲覧権限へ流用しないための境界。 */
  disclosureStartSequence?: number;
  /** 発揮時のイベント文脈を、後続stepと任意選択の再開まで保持する。 */
  triggerContext?: import("./effect/structured-effect-interpreter").TriggerContext;
  reportedActionKinds?: import("./dsl-types").Action["kind"][];
  results: Map<string, StepResult>;
  consumedUsageGroups?: string[];
  /** 選択された DSL action を途中の選択をまたいで1発揮分集約する。 */
  resolvedActionKinds?: import("./dsl-types").Action["kind"][];
  /** 未収集の解決区間の開始状態。after_triggers で消費し、途中の選択再開には持ち越す。 */
  resolutionSegmentBeforeState?: GameState;
  /** conditional_cost ロールバック用の元状態 */
  originalState: GameState;
  /**
   * conditional_cost 用 snapshot を取った時点で、すでに前段 step が成功していたか。
   * true の場合、任意サブコスト失敗で主効果まで「未発揮」扱いに戻さない。
   */
  conditionalCostSnapshotHadPriorSuccess?: boolean;
  /**
   * `conditional_cost` 効果側失敗の rollback を、後続 optional/alternative payload の
   * 成否が確定するまで保留する。pendingStepOptionalChoice をまたぐ必要があるため
   * serialize/deserialize 対象に含める。
   */
  pendingConditionalCostRollback?: PendingConditionalCostRollback;
  /** ライフダメージインターセプション等で使用するイベント量 */
  eventAmount?: number;
  /**
   * この効果の使用コストとして実際に支払われたコア数。
   * アクセル / マジック / チェンジ等の reduction.finalCost を伝播させ、
   * DynamicCount.cost_paid_this_effect から参照される。
   * 「リザーブに置ける数は、この効果の使用コストでトラッシュに置かれたコアの数まで」等のキャップ表現に使用。
   */
  costPaidThisEffect?: number;
  /**
   * 効果発動元カードの instanceId。発動元盤面状態に依存する DynamicCountSource
   * (`braves_on_source` 等) の解決に使う。主解決パスで設定される
   * (deferred / continuous 修飾の stateless 経路では未設定 = 当該 source は 0)。
   */
  sourceInstanceId?: string;
  /**
   * pending target selection / direct executeEffect から渡された対象 ID。
   * 「対象を選んだ回数に応じてコストを支払う」型の DynamicCountSource が参照する。
   */
  selectedTargetInstanceIds?: readonly string[];
  selectedTargetStepId?: string;
  /**
   * targetGroups 経由で渡された対象 ID を stepId 別に保持する。
   * DynamicCount.selected_targets(stepId) が、非コスト group を含む全体数ではなく
   * 該当 step の対象数だけを参照するために使う。
   */
  selectedTargetInstanceIdsByStepId?: Readonly<
    Record<string, readonly string[]>
  >;
  /**
   * 反復回数を先に支払う `on_step` 対象選択で、前段コストが参照する選択総数。
   * 実際の対象 instanceId を先取りせず、件数だけを保持する。
   */
  selectedTargetCountOverrides?: Readonly<Record<string, number>>;
  /**
   * 解決中の誘発 pending の `relatedInstanceId` (主語 Y)。`TargetSpec` の
   * `trigger_related_instance` variant が参照する。三者観測の `game_event` 効果で、
   * 観測されたイベントの主語自身を 1 体だけ対象に取りたいケースで使う
   * (BSTH05-X02『自分の風神/アシハラ…バトル終了時…回復できる』等)。
   * 主解決パスで設定される。`continuous` / `deferred` 修飾の stateless 経路では未設定。
   */
  triggerRelatedInstanceId?: string;
  /**
   * brave_combined event 時点の合体先 host instanceId。
   * `TargetSpec.trigger_related_combined_host` が「そのスピリット」を、解決時点の
   * related brave の現在 attachment ではなくイベント時点の host として参照する。
   */
  triggerRelatedCombinedHostInstanceId?: string;
  /**
   * 同一 triggered pending で集約された複数の主語 Y。`TargetSpec.trigger_related_instances`
   * と `DynamicCount.trigger_related_instances` が参照する。
   */
  triggerRelatedInstanceIds?: readonly string[];
  /**
   * 離脱トリガーが保持する煌臨元 instanceId スナップショット。`TargetSpec` を経由せず
   * `SummonAction.from_zone.restrictToTriggerLeaveAdventSource` が直接参照する
   * (BSSG01-C08 Lv2、engine-advent-source-leave-summon)。
   */
  triggerAdventSourceInstanceIds?: readonly string[];
  /**
   * ことで構文 (`connector: "conditional_cost"`) の `pay_cost` コストを、宣言時(窓前)でなく
   * 解決時(窓後)にコア源選択させるため、`pay_cost` ハンドラが配分曖昧時に
   * `pendingCoreSourceAllocation` を生成してよいか。インタラクティブな deferred 解決経路
   * (resolveDeferredStackAction) でのみ true。直接 executeEffect (テスト/AI) は false で
   * 同じ合法候補から決定的に支払う。10_rules/02:204 ことで構文の窓後解決順。
   */
  allowPendingPayCostSourceAllocation?: boolean;
  /**
   * 「転醒は同時に使えない」の同一タイミング窓 ID。
   * battle immediate / pending triggered の同時解決群では legal action boundary を
   * またいでも同じ ID を保持し、既転醒 marker を参照する。
   */
  rebirthTimingWindowId?: string;
  /**
   * この効果が発動したタイミング (main/flash/stack)。`resolveTargets` の
   * `effect_immunity.sourceScope.activatedTimings` 照合 (「スタックの効果を受けない」等)
   * に使う。executeEffect options.effectActivationTiming から転写される
   * (ENGINE-immunity-source-activation-timing)。
   */
  effectActivationTiming?: EffectActivationTiming;
  /**
   * この効果 (マジック/フラッシュ) が宣言時に発動されたゾーン (手札/手元/トラッシュ)。
   * `StepCondition.kind === "activation_zone"` の解決元として使う
   * (ENGINE-magic-activation-source-zone-condition)。executeEffect options.activationZone
   * から転写される。マジック以外の発動経路では未設定。
   */
  activationZone?: ActivationZone;
  /**
   * ENGINE-target-count-expand-modifier Step3: expand_effect_target_count CE の
   * bonus 適用 (target-resolution.ts resolveTargetSpec の auto-resolve count 解決部)
   * に寄与した CE の usageLimit 消費予約。真の実行時 (effect-interpreter.ts の step
   * ループ、native action 実行が実際に完了した直後) にのみ drain され
   * recordEffectUsageIfLimited で消費記録される。CE 登録ハンドラ等の他の
   * resolveTargetSpec 呼び出し経路 (createStepExecutionContext を都度新規生成し drain
   * されない) では push されても消費記録に至らない — regression ではなく Step2 時点の
   * 読み取り専用ゲート挙動のまま (over-apply の既知範囲、Step4 以降の課題)。
   * シリアライズ境界を跨がない前提 (同一 step 内で push→drain が同期完結) のため
   * serializeStepContext/deserializeStepContext では扱わない。
   */
  pendingExpandTargetCountUsage?: Array<{
    effectId: string;
    sourceInstanceId: string;
    sourceDefinitionId: string;
    usageLimit: EffectUsageLimit;
  }>;
}

/**
 * GameState に保存可能なシリアライズ形式。
 * pending state 経由でのステップ再開時に使用。
 */
export interface SerializedStepContext {
  /** Server-only pre-cost state; a pending input must not make the cost irreversible. */
  conditionalCostOriginalState?: GameState;
  promptUnresolvedChoice?: boolean;
  burstPostResolutionDestination?: "burst" | "trash";
  disclosureStartSequence?: number;
  triggerContext?: import("./effect/structured-effect-interpreter").TriggerContext;
  reportedActionKinds?: import("./dsl-types").Action["kind"][];
  consumedUsageGroups?: string[];
  resolvedActionKinds?: import("./dsl-types").Action["kind"][];
  results: Record<string, StepResult>;
  resolutionSegmentBeforeState?: GameState;
  conditionalCostSnapshotHadPriorSuccess?: boolean;
  pendingConditionalCostRollback?: PendingConditionalCostRollback;
  selectedTargetInstanceIds?: string[];
  selectedTargetStepId?: string;
  selectedTargetInstanceIdsByStepId?: Record<string, string[]>;
  selectedTargetCountOverrides?: Record<string, number>;
  /**
   * 解決中の誘発 pending の `relatedInstanceId`。`TargetSpec.trigger_related_instance` が
   * targeted disclosure 等で中断・再開される場合に Y 参照を保持するため pending state に
   * シリアライズする (verifier 2026-06-22 round 8/12 lens 4 補正)。
   */
  triggerRelatedInstanceId?: string;
  /** brave_combined event 時点の合体先 host snapshot。 */
  triggerRelatedCombinedHostInstanceId?: string;
  triggerRelatedInstanceIds?: string[];
  /**
   * 離脱トリガーが保持する煌臨元 instanceId スナップショット。`SummonAction.from_zone.
   * restrictToTriggerLeaveAdventSource` が召喚候補の絞り込みに参照する
   * (BSSG01-C08 Lv2、engine-advent-source-leave-summon)。
   */
  triggerAdventSourceInstanceIds?: string[];
  /** activationZone を pending 再開後も保持する (ENGINE-magic-activation-source-zone-condition)。 */
  activationZone?: ActivationZone;
  /** rebirthTimingWindowId を pending 再開後も保持する。 */
  rebirthTimingWindowId?: string;
}

// ============================================================
// Factory / Utility
// ============================================================

export function createStepExecutionContext(
  originalState: GameState
): StepExecutionContext {
  return {
    results: new Map(),
    originalState,
  };
}

export function recordStepResult(
  ctx: StepExecutionContext,
  result: StepResult
): void {
  if (result.stepId) {
    const existing = ctx.results.get(result.stepId);
    ctx.results.set(
      result.stepId,
      existing ? mergeStepResults(existing, result) : result
    );
  }
}

function mergeUnique(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): string[] | undefined {
  if (left === undefined && right === undefined) return undefined;
  const merged: string[] = [];
  for (const id of [...(left ?? []), ...(right ?? [])]) {
    if (!merged.includes(id)) merged.push(id);
  }
  return merged;
}

function mergeNumeric(
  left: number | undefined,
  right: number | undefined
): number | undefined {
  if (left === undefined && right === undefined) return undefined;
  return (left ?? 0) + (right ?? 0);
}

function mergeStepResults(existing: StepResult, next: StepResult): StepResult {
  const bpBecameZeroCardInstanceIds = mergeUnique(
    existing.bpBecameZeroCardInstanceIds,
    next.bpBecameZeroCardInstanceIds
  );
  const handAddedCardInstanceIds = mergeUnique(
    existing.handAddedCardInstanceIds,
    next.handAddedCardInstanceIds
  );
  const revealedCardInstanceIds = mergeUnique(
    existing.revealedCardInstanceIds,
    next.revealedCardInstanceIds
  );
  const leftFieldKindsByCardId = {
    ...(existing.leftFieldKindsByCardId ?? {}),
    ...(next.leftFieldKindsByCardId ?? {}),
  };
  const establishedLeaveKindsByCardId = {
    ...(existing.establishedLeaveKindsByCardId ?? {}),
    ...(next.establishedLeaveKindsByCardId ?? {}),
  };
  const numericAmount = mergeNumeric(
    existing.numericAmount,
    next.numericAmount
  );
  const merged: StepResult = {
    ...existing,
    ...next,
    affectedCardInstanceIds:
      mergeUnique(
        existing.affectedCardInstanceIds,
        next.affectedCardInstanceIds
      ) ?? [],
    ...(bpBecameZeroCardInstanceIds !== undefined
      ? { bpBecameZeroCardInstanceIds }
      : {}),
    ...(handAddedCardInstanceIds !== undefined
      ? { handAddedCardInstanceIds }
      : {}),
    ...(revealedCardInstanceIds !== undefined
      ? { revealedCardInstanceIds }
      : {}),
    ...(Object.keys(leftFieldKindsByCardId).length > 0
      ? { leftFieldKindsByCardId }
      : {}),
    ...(Object.keys(establishedLeaveKindsByCardId).length > 0
      ? { establishedLeaveKindsByCardId }
      : {}),
    succeeded: existing.succeeded || next.succeeded,
    executed: existing.executed === true || next.executed === true,
    blockedByOpponentEffect:
      existing.blockedByOpponentEffect === true ||
      next.blockedByOpponentEffect === true,
  };
  const chosenChoiceIndex =
    next.chosenChoiceIndex ?? existing.chosenChoiceIndex;
  if (chosenChoiceIndex !== undefined) {
    merged.chosenChoiceIndex = chosenChoiceIndex;
  }
  const stateSnapshot = next.stateSnapshot ?? existing.stateSnapshot;
  if (stateSnapshot !== undefined) {
    merged.stateSnapshot = stateSnapshot;
  }
  if (numericAmount !== undefined) {
    merged.numericAmount = numericAmount;
  }
  return merged;
}

export function getStepResult(
  ctx: StepExecutionContext,
  stepId: string
): StepResult | undefined {
  return ctx.results.get(stepId);
}

// ============================================================
// シリアライズ / デシリアライズ
// ============================================================

export function serializeStepContext(
  ctx: StepExecutionContext
): SerializedStepContext {
  const results: Record<string, StepResult> = {};
  for (const [key, value] of ctx.results) {
    // stateSnapshot は大きいため省略（ロールバックは同一ターン内のみ）
    const { stateSnapshot: _, ...rest } = value;
    results[key] = rest;
  }
  return {
    results,
    ...(ctx.conditionalCostSnapshotHadPriorSuccess !== undefined
      ? { conditionalCostOriginalState: ctx.originalState }
      : {}),
    ...(ctx.promptUnresolvedChoice !== undefined
      ? { promptUnresolvedChoice: ctx.promptUnresolvedChoice }
      : {}),
    ...(ctx.burstPostResolutionDestination !== undefined
      ? { burstPostResolutionDestination: ctx.burstPostResolutionDestination }
      : {}),
    ...(ctx.disclosureStartSequence !== undefined
      ? { disclosureStartSequence: ctx.disclosureStartSequence }
      : {}),
    ...(ctx.triggerContext
      ? { triggerContext: { ...ctx.triggerContext } }
      : {}),
    ...(ctx.consumedUsageGroups
      ? { consumedUsageGroups: [...ctx.consumedUsageGroups] }
      : {}),
    ...(ctx.reportedActionKinds
      ? { reportedActionKinds: [...ctx.reportedActionKinds] }
      : {}),
    ...(ctx.resolvedActionKinds
      ? { resolvedActionKinds: [...ctx.resolvedActionKinds] }
      : {}),
    ...(ctx.resolutionSegmentBeforeState !== undefined
      ? { resolutionSegmentBeforeState: ctx.resolutionSegmentBeforeState }
      : {}),
    ...(ctx.conditionalCostSnapshotHadPriorSuccess !== undefined
      ? {
          conditionalCostSnapshotHadPriorSuccess:
            ctx.conditionalCostSnapshotHadPriorSuccess,
        }
      : {}),
    ...(ctx.pendingConditionalCostRollback !== undefined
      ? {
          pendingConditionalCostRollback: {
            originalState: ctx.pendingConditionalCostRollback.originalState,
            sourceInstanceId:
              ctx.pendingConditionalCostRollback.sourceInstanceId,
            alternativeStepIds: [
              ...ctx.pendingConditionalCostRollback.alternativeStepIds,
            ],
            failureLogEntries: [
              ...ctx.pendingConditionalCostRollback.failureLogEntries,
            ],
          },
        }
      : {}),
    ...(ctx.selectedTargetInstanceIds !== undefined
      ? { selectedTargetInstanceIds: [...ctx.selectedTargetInstanceIds] }
      : {}),
    ...(ctx.selectedTargetStepId !== undefined
      ? { selectedTargetStepId: ctx.selectedTargetStepId }
      : {}),
    ...(ctx.selectedTargetInstanceIdsByStepId !== undefined
      ? {
          selectedTargetInstanceIdsByStepId: Object.fromEntries(
            Object.entries(ctx.selectedTargetInstanceIdsByStepId).map(
              ([stepId, ids]) => [stepId, [...ids]]
            )
          ),
        }
      : {}),
    ...(ctx.selectedTargetCountOverrides !== undefined
      ? {
          selectedTargetCountOverrides: {
            ...ctx.selectedTargetCountOverrides,
          },
        }
      : {}),
    ...(ctx.triggerRelatedInstanceId !== undefined
      ? { triggerRelatedInstanceId: ctx.triggerRelatedInstanceId }
      : {}),
    ...(ctx.triggerRelatedCombinedHostInstanceId !== undefined
      ? {
          triggerRelatedCombinedHostInstanceId:
            ctx.triggerRelatedCombinedHostInstanceId,
        }
      : {}),
    ...(ctx.triggerRelatedInstanceIds !== undefined
      ? { triggerRelatedInstanceIds: [...ctx.triggerRelatedInstanceIds] }
      : {}),
    ...(ctx.triggerAdventSourceInstanceIds !== undefined
      ? {
          triggerAdventSourceInstanceIds: [
            ...ctx.triggerAdventSourceInstanceIds,
          ],
        }
      : {}),
    ...(ctx.activationZone !== undefined
      ? { activationZone: ctx.activationZone }
      : {}),
    ...(ctx.rebirthTimingWindowId !== undefined
      ? { rebirthTimingWindowId: ctx.rebirthTimingWindowId }
      : {}),
  };
}

export function deserializeStepContext(
  serialized: SerializedStepContext,
  originalState: GameState
): StepExecutionContext {
  const ctx = createStepExecutionContext(originalState);
  if (serialized.conditionalCostOriginalState !== undefined) {
    ctx.originalState = serialized.conditionalCostOriginalState;
  }
  if (serialized.promptUnresolvedChoice !== undefined)
    ctx.promptUnresolvedChoice = serialized.promptUnresolvedChoice;
  if (serialized.burstPostResolutionDestination !== undefined)
    ctx.burstPostResolutionDestination =
      serialized.burstPostResolutionDestination;
  if (serialized.disclosureStartSequence !== undefined)
    ctx.disclosureStartSequence = serialized.disclosureStartSequence;
  if (serialized.triggerContext)
    ctx.triggerContext = { ...serialized.triggerContext };
  if (serialized.reportedActionKinds) {
    ctx.reportedActionKinds = [...serialized.reportedActionKinds];
  }
  if (serialized.consumedUsageGroups) {
    ctx.consumedUsageGroups = [...serialized.consumedUsageGroups];
  }
  if (serialized.resolvedActionKinds) {
    ctx.resolvedActionKinds = [...serialized.resolvedActionKinds];
  }
  if (serialized.resolutionSegmentBeforeState !== undefined) {
    ctx.resolutionSegmentBeforeState = serialized.resolutionSegmentBeforeState;
  }
  for (const [key, value] of Object.entries(serialized.results)) {
    ctx.results.set(key, value);
  }
  if (serialized.conditionalCostSnapshotHadPriorSuccess !== undefined) {
    ctx.conditionalCostSnapshotHadPriorSuccess =
      serialized.conditionalCostSnapshotHadPriorSuccess;
  }
  if (serialized.pendingConditionalCostRollback !== undefined) {
    ctx.pendingConditionalCostRollback = {
      originalState: serialized.pendingConditionalCostRollback.originalState,
      sourceInstanceId:
        serialized.pendingConditionalCostRollback.sourceInstanceId,
      alternativeStepIds: [
        ...serialized.pendingConditionalCostRollback.alternativeStepIds,
      ],
      failureLogEntries: [
        ...serialized.pendingConditionalCostRollback.failureLogEntries,
      ],
    };
  }
  if (serialized.triggerRelatedInstanceId !== undefined) {
    ctx.triggerRelatedInstanceId = serialized.triggerRelatedInstanceId;
  }
  if (serialized.triggerRelatedCombinedHostInstanceId !== undefined) {
    ctx.triggerRelatedCombinedHostInstanceId =
      serialized.triggerRelatedCombinedHostInstanceId;
  }
  if (serialized.selectedTargetInstanceIds !== undefined) {
    ctx.selectedTargetInstanceIds = [...serialized.selectedTargetInstanceIds];
  }
  if (serialized.selectedTargetStepId !== undefined) {
    ctx.selectedTargetStepId = serialized.selectedTargetStepId;
  }
  if (serialized.selectedTargetInstanceIdsByStepId !== undefined) {
    const byStepId: Record<string, string[]> = {};
    for (const [stepId, ids] of Object.entries(
      serialized.selectedTargetInstanceIdsByStepId
    )) {
      byStepId[stepId] = [...ids];
    }
    ctx.selectedTargetInstanceIdsByStepId = byStepId;
  }
  if (serialized.selectedTargetCountOverrides !== undefined) {
    ctx.selectedTargetCountOverrides = {
      ...serialized.selectedTargetCountOverrides,
    };
  }
  if (serialized.triggerRelatedInstanceIds !== undefined) {
    ctx.triggerRelatedInstanceIds = [...serialized.triggerRelatedInstanceIds];
  }
  if (serialized.triggerAdventSourceInstanceIds !== undefined) {
    ctx.triggerAdventSourceInstanceIds = [
      ...serialized.triggerAdventSourceInstanceIds,
    ];
  }
  if (serialized.activationZone !== undefined) {
    ctx.activationZone = serialized.activationZone;
  }
  if (serialized.rebirthTimingWindowId !== undefined) {
    ctx.rebirthTimingWindowId = serialized.rebirthTimingWindowId;
  }
  return ctx;
}
