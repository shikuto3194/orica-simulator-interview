/**
 * P3-47 F-4: redirect_effect_target ContinuousEffect
 *
 * 「相手の効果が指定対象を取ったとき、対象を別カードに変更できる」継続効果。
 * 既存 `redirect_target` action は state.activeAttack のみ対象差し替え可能だが、
 * 本 CE は target-resolution で解決された効果対象集合に介入して redirect する。
 *
 * 主用途: フランドール・スカーレット【フォーオブアカインド】の
 *   「このスピリットが相手の効果の対象になったとき、その効果の対象を
 *    それらのスピリットに変更できる」
 *
 * 登録規約 (Step 4 register_redirect_effect_target action 経由):
 * - modifierTag: "redirect_effect_target"
 * - sourceInstanceId: 効果発揮元 (フランドール本体)
 * - targetInstanceId: 保護対象 (= triggerCondition.targetFilter が "self" の場合は本体)
 * - duration: { scope: "while_on_field" } を原則とする (host 離脱で自動消滅)
 * - metadata: RedirectEffectTargetMetadata
 */
import { getCEsForTarget } from "../card/ce-lookup";
import {
  matchesCardFilter,
  matchesCardFilterByDef,
  matchesCardReferenceFilter,
} from "../card/card-filter";
import { getEffectiveLevel } from "../battle/battle-shared";
import { getEffectiveCategory } from "../mechanics/act-as-spirit";
import {
  filterTargetsByPreventionLevel,
  canUseEffectByUsageLimit,
  getEffectiveColors,
  getEffectiveTribes,
} from "../legal/legal-actions-shared";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  EffectPreventionLevel,
  EffectPlayerRef,
  EffectUsageLimit,
  GameState,
  TargetRedirectReplacementMode,
} from "../model";
import type { CardFilter, TargetSpec } from "../dsl-types";
import type { TargetLockBypassProfile } from "./target-affect-gate";
import { resolveTargetSpec } from "./target-resolution";
import {
  createStepExecutionContext,
  type StepExecutionContext,
} from "../step-execution-context";

/**
 * 効果対象リダイレクトのトリガー条件。
 * - sourcePlayerRef: 発動元プレイヤー (相手効果のみ反応する場合は "opponent")
 * - sourceFilter: 発動元カードの種別条件 (例: BSLH01-R02「相手の**スピリット**の効果」)。
 *   省略時は発動元カードの種別を問わない (フランドール既定挙動)。効果発揮元
 *   (findApplicableTargetRedirects の effectSource) が解決できないときはフェイルクローズ
 *   で redirect 不発とする。
 * - protectedTargetKind:
 *   - "self": 本 CE の sourceInstanceId (= ownerInstanceId) が対象に含まれていれば発動
 *   - "instances": 明示的な instanceId 集合のいずれかが対象に含まれていれば発動
 */
export type RedirectTriggerCondition =
  | {
      sourcePlayerRef: "opponent" | "any";
      sourceFilter?: CardFilter;
      protectedTargetKind: "self";
    }
  | {
      sourcePlayerRef: "opponent" | "any";
      sourceFilter?: CardFilter;
      protectedTargetKind: "instances";
      protectedInstanceIds: string[];
    }
  | {
      sourcePlayerRef: "opponent" | "any";
      sourceFilter?: CardFilter;
      protectedTargetKind: "owned_filter";
      /** CE の actingPlayerId が管理するカードのうち filter に一致するもの全て (matchtime 動的評価)。 */
      filter: CardFilter;
    };

/**
 * redirect_effect_target CE の metadata 構造。
 * `ContinuousEffect.metadata` (Record<string, unknown>) に格納する。
 */
export interface RedirectEffectTargetMetadata {
  triggerCondition: RedirectTriggerCondition;
  /**
   * 差し替え先候補 instanceId 集合の取得方法。
   * - "explicit": redirectCandidateInstanceIds に列挙されたものをそのまま候補とする
   * - "associated_act_as_spirit": 同じ sourceInstanceId を持つ act_as_spirit CE の
   *   targetInstanceId 群を動的に候補とする (フランドール本体 → token 集合)
   */
  redirectCandidateSource:
    | { kind: "explicit"; instanceIds: string[] }
    | { kind: "associated_act_as_spirit" }
    | {
        kind: "owned_filter";
        filter: CardFilter;
        playerRef?: "self" | "opponent";
        preserveOriginalTargetSpec?: { playerRef: EffectPlayerRef };
      };
  /** redirect prompt を受けるプレイヤー。省略時 "self" (= CE owner)。 */
  promptedPlayerRef?: "self" | "opponent";
  /** redirect 先候補を選ぶプレイヤー。省略時 promptedPlayerRef と同じ。 */
  candidateChooserPlayerRef?: "self" | "opponent";
  /** "できる" 表記 = 任意発動 (現状は常に true)。 */
  optional: boolean;
  /**
   * redirect 自体の発動回数制限 (例:「ターンに1回」)。設定時は
   * canUseEffectByUsageLimit(sourceInstanceId, effectLabel:"redirect_effect_target") で
   * ゲートし、実際に redirect が confirm されたときのみ recordEffectUsageIfLimited で
   * 消費する (decline / candidate 0件時は消費しない)。
   */
  usageLimit?: EffectUsageLimit;
}

/**
 * 指定 CE の metadata を取り出す。kind が一致しない / 未設定なら undefined。
 */
export function getRedirectEffectTargetMetadata(
  ce: ContinuousEffect
): RedirectEffectTargetMetadata | undefined {
  if (ce.modifierTag !== "redirect_effect_target") return undefined;
  const meta = ce.metadata;
  if (!meta || typeof meta !== "object") return undefined;
  const m = meta as Record<string, unknown>;
  if (!m.triggerCondition || !m.redirectCandidateSource) return undefined;
  return meta as unknown as RedirectEffectTargetMetadata;
}

/**
 * 指定カード (instanceId) を保護する redirect_effect_target CE を全て返す。
 * targetInstanceId が一致するか、metadata.triggerCondition.protectedTargetKind="self" で
 * sourceInstanceId が一致する場合、または protectedTargetKind="owned_filter" で
 * controller 一致 + filter 一致の場合に保護対象とみなす (matchtime 動的評価。
 * findApplicableTargetRedirects と同じ判定を SSOT で共有する)。
 */
export function getRedirectEffectTargetsProtecting(
  state: GameState,
  protectedInstanceId: string,
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined
): ContinuousEffect[] {
  const direct = getCEsForTarget(state, protectedInstanceId).filter(
    (ce) => ce.modifierTag === "redirect_effect_target"
  );
  // sourceInstanceId-based ("self" kind, no targetInstanceId) も拾う
  const selfBased = state.activeContinuousEffects.filter((ce) => {
    if (ce.modifierTag !== "redirect_effect_target") return false;
    if (ce.targetInstanceId === protectedInstanceId) return false; // 既に direct で拾ってる
    if (ce.sourceInstanceId !== protectedInstanceId) return false;
    const meta = getRedirectEffectTargetMetadata(ce);
    if (!meta) return false;
    return meta.triggerCondition.protectedTargetKind === "self";
  });
  // owned_filter-based: targetInstanceId 未設定 + controller 一致 + filter 一致を動的評価
  // (findApplicableTargetRedirects の owned_filter 分岐と同じ判定。BSLH01-R02)。
  const ownedFilterBased = getCardDefinitionById
    ? state.activeContinuousEffects.filter((ce) => {
        if (ce.modifierTag !== "redirect_effect_target") return false;
        if (ce.targetInstanceId !== undefined) return false; // 既に direct で拾ってる
        const meta = getRedirectEffectTargetMetadata(ce);
        if (
          !meta ||
          meta.triggerCondition.protectedTargetKind !== "owned_filter"
        ) {
          return false;
        }
        const card = state.cardInstances.find(
          (c) => c.instanceId === protectedInstanceId
        );
        return card !== undefined
          ? matchesOwnedFilterRedirectCard(
              state,
              ce.actingPlayerId,
              card,
              meta.triggerCondition.filter,
              getCardDefinitionById
            )
          : false;
      })
    : [];
  return [...direct, ...selfBased, ...ownedFilterBased];
}

/**
 * CE と現在状態から候補 token instanceId 集合を解決する。
 * 集合は対象差し替え時の選択肢として GUI / pending に渡される。
 */
export function resolveRedirectCandidateInstanceIds(
  state: GameState,
  ce: ContinuousEffect,
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined
): string[] {
  const meta = getRedirectEffectTargetMetadata(ce);
  if (!meta) return [];
  const src = meta.redirectCandidateSource;
  if (src.kind === "explicit") return [...src.instanceIds];
  if (src.kind === "owned_filter") {
    if (!getCardDefinitionById) return [];
    const ownerPlayerId = resolveRedirectRelativePlayerId(
      state,
      ce.actingPlayerId,
      src.playerRef ?? "self"
    );
    if (!ownerPlayerId) return [];
    return state.cardInstances
      .filter((card) => {
        return matchesOwnedFilterRedirectCard(
          state,
          ownerPlayerId,
          card,
          src.filter,
          getCardDefinitionById
        );
      })
      .map((card) => card.instanceId);
  }
  // associated_act_as_spirit: 同じ host (sourceInstanceId) で発行された act_as_spirit CE 群
  return state.activeContinuousEffects
    .filter(
      (other) =>
        other.modifierTag === "act_as_spirit" &&
        other.sourceInstanceId === ce.sourceInstanceId &&
        typeof other.targetInstanceId === "string"
    )
    .map((other) => other.targetInstanceId as string);
}

function resolveRedirectRelativePlayerId(
  state: GameState,
  ownerPlayerId: string,
  ref: "self" | "opponent"
): string | undefined {
  if (ref === "self") return ownerPlayerId;
  return state.players.find((player) => player.id !== ownerPlayerId)?.id;
}

// ────────────────────────────────────────────────────────────
// Step 2: target-resolution 介入用 detection helper
// ────────────────────────────────────────────────────────────

/**
 * 効果対象解決後に「どの redirect_effect_target CE が発火条件を満たすか」を計算する。
 *
 * 入力:
 * - state: activeContinuousEffects + 防御 CE 探索のための GameState。
 * - resolvedInstanceIds: target-resolution が返した対象集合の instanceId 列。
 * - actingPlayerId: 元効果を発動したプレイヤー (sourcePlayerRef="opponent" の判定軸)。
 * - sourcePreventionLevel: 元効果の preventionLevel (P3-47 F-4 案 (a))。
 *   候補から「効果を受けない」(defense_immune 等) 持ちを除外する判定に使う。
 *   省略時は "none" 扱い。
 *
 * 出力: 発火する redirect 群 (1 CE につき 1 match)。Step 3 でこの結果を用いて
 * pendingTargetRedirects[] を構築する。
 *
 * 処理:
 * 1. modifierTag が `redirect_effect_target` でなければ skip。
 * 2. metadata 不正 → skip。
 * 3. sourcePlayerRef="opponent" のとき、actingPlayerId === ce.actingPlayerId なら skip
 *    (= 自分自身の効果は本 CE で redirect しない)。"any" は常に通る。
 * 4. 保護対象 (self / instances / owned_filter) が resolved 集合に含まれていなければ skip。
 * 5. 候補集合を解決 + 裁定 #7 ガード (resolved 集合と共通な候補は除外) +
 *    案 (a) ガード (sourcePreventionLevel で貫通できない defense_immune/suppress を除外)。
 *    残り候補 0 件なら redirect 不可なので skip。
 * 6. match を返す。
 *
 * BS69 Q26982 / CB13 Q14170 / Q26984 / Q14172: 同一 target slice 内で同時指定された
 * フィールド上の Spirit/Ultimate/Brave/Nexus を replacement 1 体へ collapse する。
 * 手札/手元/デッキ/トラッシュ/バースト対象は変更しない。
 *
 * 案 (a) (P3-47 F-4 / 2026-05-05 確定): 「効果を受けない」状態の token は
 * candidate 集合から除外する。redirect 自体を不可とすることで、選択肢段階で
 * 違法な redirect を提示しない。「防げない」(unpreventable) 効果は
 * canEffectPenetrateDefense 経由で defense_immune を貫通するため、source の
 * preventionLevel が "unpreventable" のときは defense_immune token も candidate
 * に残る。
 */
export interface TargetRedirectMatch {
  /** マッチした redirect_effect_target CE の effectId。 */
  redirectEffectId: string;
  /** redirect 権を持つプレイヤー (= CE owner)。GUI prompt 宛先。 */
  promptedPlayerId: string;
  /** replacement 候補を選ぶプレイヤー。省略時は promptedPlayerId と同じ扱い。 */
  candidateChooserPlayerId: string;
  /** CE の sourceInstanceId (host = 本体)。デバッグ・ログ用。 */
  hostInstanceId: string;
  /** 元集合の中で差し替え対象となる代表 instanceId (既存 UI/ログ互換用)。 */
  protectedInstanceId: string;
  /** 元集合の中で発火条件に一致した保護対象 instanceId。 */
  protectedInstanceIds: string[];
  /** 元集合の中で同じ replacement へ差し替える全 instanceId。 */
  redirectableInstanceIds: string[];
  /** 対象変更の置換方式。 */
  replacementMode: TargetRedirectReplacementMode;
  /** 差し替え候補 instanceId 集合 (resolved に既出のものは除外済み)。 */
  candidateTokenInstanceIds: string[];
}

function uniquePreserveOrder(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function matchesOwnedFilterRedirectCard(
  state: GameState,
  ownerPlayerId: string,
  card: CardInstance,
  filter: CardFilter,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): boolean {
  if (card.controllerPlayerId !== ownerPlayerId) return false;
  // owned_filter は「管理する場のカード」だけを対象にする。quartz スロットは
  // zone:"field" でも実体のある場カードとして扱わない。
  if (card.zone !== "field" || card.zoneRoleName === "quartz") return false;
  const def = getCardDefinitionById(card.definitionId);
  if (!def) return false;
  return matchesCardFilter(card, def, filter, {
    state,
    cardZone: card.zone,
    fieldCategoryContext: true,
    getCardDefinitionById,
    effectiveColors: getEffectiveColors(state, card, def),
    effectiveTribes: getEffectiveTribes(
      state,
      card,
      def,
      getCardDefinitionById
    ),
    effectiveLevel: getEffectiveLevel(state, card, def, getCardDefinitionById),
  });
}

export interface RedirectOriginalTargetContext {
  targetSpec: TargetSpec;
  sourceInstanceId: string;
  stepContext?: StepExecutionContext;
}

const FIELD_REDIRECTABLE_CATEGORIES = new Set([
  "spirit",
  "ultimate",
  "brave",
  "nexus",
]);

function getFieldRedirectableTargetIds(
  state: GameState,
  resolvedInstanceIds: readonly string[],
  matchedProtectedIds: readonly string[],
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined
): string[] {
  const cardInstances = state.cardInstances ?? [];
  const fieldIds = uniquePreserveOrder(
    resolvedInstanceIds.filter((id) => {
      const card = cardInstances.find((c) => c.instanceId === id);
      if (!card || card.zone !== "field") return false;
      if (!getCardDefinitionById) return true;
      const def = getCardDefinitionById(card.definitionId);
      if (!def) return false;
      const effectiveCategory = getEffectiveCategory(state, card, def);
      return (
        effectiveCategory !== undefined &&
        FIELD_REDIRECTABLE_CATEGORIES.has(effectiveCategory)
      );
    })
  );
  return fieldIds;
}

export function findApplicableTargetRedirects(
  state: GameState,
  resolvedInstanceIds: readonly string[],
  actingPlayerId: string,
  sourcePreventionLevel: EffectPreventionLevel = "none",
  effectSource?: {
    instance?: CardInstance | undefined;
    definition?: CardDefinition | undefined;
  },
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined,
  sourcePreventionBypass?: TargetLockBypassProfile,
  originalTargetContext?: RedirectOriginalTargetContext
): TargetRedirectMatch[] {
  const resolvedSet = new Set(resolvedInstanceIds);
  const matches: TargetRedirectMatch[] = [];

  for (const ce of state.activeContinuousEffects) {
    if (ce.modifierTag !== "redirect_effect_target") continue;
    const meta = getRedirectEffectTargetMetadata(ce);
    if (!meta) continue;

    if (meta.triggerCondition.sourcePlayerRef === "opponent") {
      if (actingPlayerId === ce.actingPlayerId) continue;
    }

    if (meta.triggerCondition.sourceFilter) {
      // フェイルクローズ: 発揮元カード情報が無ければ種別を確認できないため不発とする
      // (BSLH01-R02「相手の**スピリット**の効果」のように発動元カード種別を限定する場合)。
      if (!effectSource?.definition) continue;
      const matchesSource = effectSource.instance
        ? matchesCardReferenceFilter(
            effectSource.instance,
            effectSource.definition,
            meta.triggerCondition.sourceFilter,
            {
              state,
              cardZone: effectSource.instance.zone,
              ...(effectSource.instance.zone === "field"
                ? {
                    fieldCategoryContext: true,
                    ...(getCardDefinitionById ? { getCardDefinitionById } : {}),
                  }
                : {
                    effectiveCategory: getEffectiveCategory(
                      state,
                      effectSource.instance,
                      effectSource.definition
                    ),
                  }),
              effectiveColors: getEffectiveColors(
                state,
                effectSource.instance,
                effectSource.definition
              ),
              effectiveTribes: getEffectiveTribes(
                state,
                effectSource.instance,
                effectSource.definition,
                getCardDefinitionById
              ),
              effectiveLevel:
                effectSource.instance.zone === "field"
                  ? getEffectiveLevel(
                      state,
                      effectSource.instance,
                      effectSource.definition,
                      getCardDefinitionById
                    )
                  : undefined,
            }
          )
        : matchesCardFilterByDef(
            effectSource.definition,
            meta.triggerCondition.sourceFilter
          );
      if (!matchesSource) continue;
    }

    let matchedProtectedIds: string[];
    if (meta.triggerCondition.protectedTargetKind === "self") {
      matchedProtectedIds = resolvedSet.has(ce.sourceInstanceId)
        ? [ce.sourceInstanceId]
        : [];
    } else if (meta.triggerCondition.protectedTargetKind === "owned_filter") {
      // matchtime 動的評価: 登録時点の固定リストではなく、resolved 集合の中から
      // 「CE owner が管理し filter に一致する」カードを都度探す (召喚/離脱による
      // 保護対象集合の増減に追従する。BSLH01-R02)。
      const filter = meta.triggerCondition.filter;
      matchedProtectedIds = getCardDefinitionById
        ? uniquePreserveOrder(
            resolvedInstanceIds.filter((id) => {
              const card = state.cardInstances.find((c) => c.instanceId === id);
              return card !== undefined
                ? matchesOwnedFilterRedirectCard(
                    state,
                    ce.actingPlayerId,
                    card,
                    filter,
                    getCardDefinitionById
                  )
                : false;
            })
          )
        : [];
    } else {
      const protectedSet = new Set(meta.triggerCondition.protectedInstanceIds);
      matchedProtectedIds = uniquePreserveOrder(
        resolvedInstanceIds.filter((id) => protectedSet.has(id))
      );
    }
    if (matchedProtectedIds.length === 0) continue;
    const matchedProtectedSet = new Set(matchedProtectedIds);
    const redirectableInstanceIds = getFieldRedirectableTargetIds(
      state,
      resolvedInstanceIds,
      matchedProtectedIds,
      getCardDefinitionById
    );
    if (redirectableInstanceIds.length === 0) continue;

    if (
      meta.usageLimit &&
      !canUseEffectByUsageLimit({
        sourceEffect: getCardDefinitionById?.(ce.sourceDefinitionId)?.effects?.[
          ce.provenance?.effectIndex ?? -1
        ],
        state,
        sourceInstanceId: ce.sourceInstanceId,
        sourceDefinitionId: ce.sourceDefinitionId,
        getCardDefinitionById,
        effectLabel: "redirect_effect_target",
        usageLimit: meta.usageLimit,
      })
    ) {
      continue;
    }

    const candidateSource = meta.redirectCandidateSource;
    const replacementMode: TargetRedirectReplacementMode =
      candidateSource.kind === "owned_filter" &&
      candidateSource.preserveOriginalTargetSpec !== undefined
        ? "reselect"
        : "collapse";
    const rawCandidates = resolveRedirectCandidateInstanceIds(
      state,
      ce,
      getCardDefinitionById
    ).filter((id) => !resolvedSet.has(id) && !matchedProtectedSet.has(id));
    const originalTargetFilteredCandidates =
      candidateSource.kind === "owned_filter" &&
      candidateSource.preserveOriginalTargetSpec !== undefined
        ? filterCandidatesByOriginalTargetSpec({
            state,
            candidateIds: rawCandidates,
            actingPlayerId,
            getCardDefinitionById,
            preservePlayerRef:
              candidateSource.preserveOriginalTargetSpec.playerRef,
            originalTargetContext,
          })
        : rawCandidates;
    const candidates = filterTargetsByPreventionLevel(
      state,
      originalTargetFilteredCandidates,
      sourcePreventionLevel,
      effectSource !== undefined ||
        getCardDefinitionById !== undefined ||
        sourcePreventionBypass !== undefined
        ? {
            actingPlayerId,
            ...(effectSource !== undefined ? { effectSource } : {}),
            ...(getCardDefinitionById !== undefined
              ? { getCardDefinitionById }
              : {}),
            ...(sourcePreventionBypass !== undefined
              ? { sourcePreventionBypass }
              : {}),
          }
        : undefined
    );
    if (candidates.length === 0) continue;
    if (
      replacementMode === "reselect" &&
      candidates.length < redirectableInstanceIds.length
    ) {
      continue;
    }

    const promptedPlayerId =
      resolveRedirectRelativePlayerId(
        state,
        ce.actingPlayerId,
        meta.promptedPlayerRef ?? "self"
      ) ?? ce.actingPlayerId;
    const candidateChooserPlayerId =
      resolveRedirectRelativePlayerId(
        state,
        ce.actingPlayerId,
        meta.candidateChooserPlayerRef ?? meta.promptedPlayerRef ?? "self"
      ) ?? promptedPlayerId;
    matches.push({
      redirectEffectId: ce.effectId,
      promptedPlayerId,
      candidateChooserPlayerId,
      hostInstanceId: ce.sourceInstanceId,
      protectedInstanceId: matchedProtectedIds[0]!,
      protectedInstanceIds: matchedProtectedIds,
      redirectableInstanceIds,
      replacementMode,
      candidateTokenInstanceIds: candidates,
    });
  }

  return matches;
}

function filterCandidatesByOriginalTargetSpec(options: {
  state: GameState;
  candidateIds: readonly string[];
  actingPlayerId: string;
  getCardDefinitionById:
    | ((definitionId: string) => CardDefinition | undefined)
    | undefined;
  preservePlayerRef: EffectPlayerRef;
  originalTargetContext: RedirectOriginalTargetContext | undefined;
}): string[] {
  const {
    state,
    candidateIds,
    actingPlayerId,
    getCardDefinitionById,
    preservePlayerRef,
    originalTargetContext,
  } = options;
  if (!getCardDefinitionById || !originalTargetContext) return [];
  if (originalTargetContext.targetSpec.kind !== "filter") return [];
  const targetSpec: TargetSpec = {
    ...originalTargetContext.targetSpec,
    player: preservePlayerRef,
    count: "all",
  };
  const validCandidateIds = new Set(
    resolveTargetSpec({
      state,
      targetSpec,
      actingPlayerId,
      sourceInstanceId: originalTargetContext.sourceInstanceId,
      getCardDefinitionById,
      stepContext:
        originalTargetContext.stepContext ?? createStepExecutionContext(state),
    }).map((card) => card.instanceId)
  );
  return candidateIds.filter((id) => validCandidateIds.has(id));
}

/**
 * confirm_target_redirect の解決時に対象集合を実際に書き換える純粋関数。
 *
 * - protectedInstanceId(s) に一致する要素を withInstanceId に置換する。
 * - 元の順序を保持。
 * - BS69 Q26982 / CB13 Q14170: 複数対象を同じ replacement へ変更した場合は
 *   replacement 1 体だけに collapse する。
 *
 * caller 側で `withInstanceId ∈ candidateTokenInstanceIds` を保証することを前提とする
 * (本関数は無検証で置換のみを行う)。
 */
export function applyRedirectToResolvedTargets(
  resolvedInstanceIds: readonly string[],
  protectedInstanceId: string | readonly string[],
  withInstanceId: string
): string[] {
  const protectedSet = new Set(
    typeof protectedInstanceId === "string"
      ? [protectedInstanceId]
      : protectedInstanceId
  );
  return uniquePreserveOrder(
    resolvedInstanceIds.map((id) =>
      protectedSet.has(id) ? withInstanceId : id
    )
  );
}

export function applyRedirectReselectionToResolvedTargets(
  resolvedInstanceIds: readonly string[],
  protectedInstanceIds: readonly string[],
  withInstanceIds: readonly string[]
): string[] {
  const protectedSet = new Set(protectedInstanceIds);
  let replacementIndex = 0;
  return resolvedInstanceIds.map((id) =>
    protectedSet.has(id) ? (withInstanceIds[replacementIndex++] ?? id) : id
  );
}
