// ============================================================
// 継続効果リビルダ — フィールド/ミラージュ/バースト上のカードから
// 継続効果 (timing.kind === "continuous") を走査し、未登録の CE を
// activeContinuousEffects に追加する。
//
// 想定用途:
// - シナリオ直接配置 (inst()) の補正
// - セーブデータ復元時の補正
// - テストファクトリの補正
//
// 通常の play_card_action 経由の召喚で既に登録された CE は
// (sourceInstanceId, effectIndex) の provenance ペアで重複検出して
// スキップする。provenance を持たない旧 CE / 外部経由 CE のためのみ
// modifierTag による緩いフォールバックを残す。
// ============================================================

import { evaluateApplicability, executeEffect } from "./effect-interpreter";
import {
  resolveDefinitionEffect,
  sameDefinitionEffectPath,
} from "./definition-effect-reference";
import { materializeGrantedEffects } from "./granted-effect-materialization";
import {
  executeReevaluationCheck,
  getBraveSelfReferenceRewriteStatus,
  getDynamicEffectSuppressionTargetIds,
  recomputeContinuousEffects,
} from "../legal/legal-actions-shared";
import { getCardById } from "../card/card-lookup";
import { getEffectDescriptorSourceKindForPrintedCategory } from "../source-kinds";
import {
  deriveSuppressionEffectDescriptor,
  isHandSummonPermissionEffect,
} from "./structured-effect-registrations";
import { evaluateCondition } from "./structured-effect-interpreter";
import { normalizeEffectResistanceTag } from "./effect-resistance-tags";
import {
  recomputeBattleEntityBp,
  removeStateInvalidBattleEntityMembersAndRecompute,
} from "../battle/battle-shared";
import { isStubRebirthEffect } from "../dsl-types";
import { hasContractAdventEligibilityGrant } from "../mechanics/advent-variant";
import { resolveTreatAsTargetInstanceId } from "./structured-cost-gate";
import type { Effect } from "../dsl-types";
import {
  isTextRoleUnderActiveSpiritHost,
  isActiveTextRoleUnderEffectSource,
  isTextRoleUnderTextEffect,
  textRoleUnderRequiredRoleTagForTextLines,
  underCardRoleTagsEqual,
} from "../mechanics/star-garment-utils";
import {
  isActiveQuartzInheritedEffectSource,
  isQuartzInstanceInheritedByActiveHost,
  isQuartzSetHeaderLine,
} from "../mechanics/quartz-system";
import {
  getQuartzSetStatesByHost,
  isCardInSetState,
  isTextRoleUnderCard,
  isAdventSourceUnderCard,
  normalizeUnderCardRoleTag,
  type CardDefinition,
  type CardInstance,
  type Condition,
  type ContinuousEffect,
  type GameState,
  type TimingScope,
  type Zone,
} from "../model";

/**
 * リビルダオプション。
 */
export interface RebuildContinuousEffectsOptions {
  /**
   * バトル中・効果解決中のセーフティガードをバイパスする。
   *
   * **本番コードでは渡してはならない。** invariant collector のように
   * 結果を破棄して差分だけ見るチェック用途、もしくは異常系のテスト用途のみで使用する。
   */
  unsafeAllowDuringBattle?: boolean;
  /**
   * 離脱待機中の field カードから、新規 continuous effect を登録しない。
   * 待機前からある CE は activeContinuousEffects 側に残して継続させる。
   */
  skipNewFieldEffectsFromPendingLeave?: boolean;
  /**
   * 指定した source instance だけを新規登録対象にする。
   * deck→hand 直後など、全盤面を再構築せず移動したカード由来の extra-zone CE だけを
   * 補う用途で使う。
   */
  sourceInstanceIds?: ReadonlySet<string> | readonly string[];
  /**
   * sourceInstanceIds 指定時に、時限 CE の全体 sweep を避ける。
   */
  skipTimingScopeStaleRemoval?: boolean;
}

function shouldSkipNewFieldContinuousEffectSource(
  card: CardInstance,
  options?: RebuildContinuousEffectsOptions
): boolean {
  return (
    options?.skipNewFieldEffectsFromPendingLeave === true &&
    card.zone === "field" &&
    card.pendingLeaveKind !== null
  );
}

function shouldSkipNewExternalContinuousEffectSource(
  state: GameState,
  entry: ContinuousEffectSourceEntry,
  skipNewFieldEffectsFromPendingLeave: boolean
): boolean {
  if (!skipNewFieldEffectsFromPendingLeave) return false;
  const effectSourceInstanceId = entry.effectSourceInstanceId;
  if (effectSourceInstanceId === undefined) return false;
  const effectSourceCard = getCardById(state, effectSourceInstanceId);
  return (
    effectSourceCard?.zone === "field" &&
    effectSourceCard.pendingLeaveKind !== null
  );
}

/**
 * リビルダを安全に呼び出せる state かどうか判定する。
 *
 * 安全条件:
 * - `activeAttack === null` (バトル進行中でない)
 * - `stackWindow === null && preDeclarationStackWindow === null` (フラッシュ窓未開放)
 * - `battleResolutionGroup === null` (バトル解決中でない)
 * - `effectQueueEntries.length === 0` (効果キュー空)
 * - `pendingTriggeredEffects.length === 0` (誘発効果待機なし)
 * - `pendingDeferredTriggeredEffects.length === 0` (同時誘発の宣言完了待ち分)
 * - `pendingPrivateDeclarations.length === 0` (非公開ゾーン誘発の宣言待ち)
 * - `pendingBurstChecks.length === 0` (バーストチェック待ち)
 * - `pendingLeaveEntities.length === 0` (離脱待機なし)
 * - `pendingChangeCleanupChoice === null` (チェンジ後処理選択待ちなし)
 * - `pendingAccelCleanups.length === 0` (アクセル/チェンジ cleanup 待ちなし)
 * - `battleImmediateEffects.length === 0` (バトル時 / アタック時 / ブロック時の即時発揮待ち)
 *
 * これらが満たされない状態で呼ぶと、新規 CE の `createdAtTurn` /
 * `createdAtAttackId` が現在の進行中バトルの値で上書きされ、
 * duration 解決時 (battle / turn / step スコープ) で意図しない期限になる。
 */
export function isSafeStateForContinuousRebuild(state: GameState): boolean {
  return (
    state.activeAttack === null &&
    state.stackWindow === null &&
    state.preDeclarationStackWindow === null &&
    state.battleResolutionGroup === null &&
    state.effectQueueEntries.length === 0 &&
    state.pendingTriggeredEffects.length === 0 &&
    state.pendingDeferredTriggeredEffects.length === 0 &&
    state.pendingPrivateDeclarations.length === 0 &&
    state.pendingBurstChecks.length === 0 &&
    state.pendingLeaveEntities.length === 0 &&
    state.pendingChangeCleanupChoice === null &&
    (state.pendingAccelCleanups ?? []).length === 0 &&
    state.battleImmediateEffects.length === 0
  );
}

/**
 * 安全でない state の理由を 1 行で返す。エラーメッセージ用。
 */
function describeUnsafeState(state: GameState): string {
  if (state.activeAttack !== null) return "activeAttack is not null";
  if (state.stackWindow !== null) return "stackWindow is open";
  if (state.preDeclarationStackWindow !== null) {
    return "preDeclarationStackWindow is open";
  }
  if (state.battleResolutionGroup !== null) {
    return "battleResolutionGroup is in progress";
  }
  if (state.effectQueueEntries.length > 0) {
    return `effectQueueEntries has ${state.effectQueueEntries.length} pending entries`;
  }
  if (state.pendingTriggeredEffects.length > 0) {
    return `pendingTriggeredEffects has ${state.pendingTriggeredEffects.length} entries`;
  }
  if (state.pendingDeferredTriggeredEffects.length > 0) {
    return `pendingDeferredTriggeredEffects has ${state.pendingDeferredTriggeredEffects.length} entries`;
  }
  if (state.pendingPrivateDeclarations.length > 0) {
    return `pendingPrivateDeclarations has ${state.pendingPrivateDeclarations.length} entries`;
  }
  if (state.pendingBurstChecks.length > 0) {
    return `pendingBurstChecks has ${state.pendingBurstChecks.length} entries`;
  }
  if (state.pendingLeaveEntities.length > 0) {
    return `pendingLeaveEntities has ${state.pendingLeaveEntities.length} entries`;
  }
  if (state.pendingChangeCleanupChoice !== null) {
    return "pendingChangeCleanupChoice is open";
  }
  if ((state.pendingAccelCleanups ?? []).length > 0) {
    return `pendingAccelCleanups has ${(state.pendingAccelCleanups ?? []).length} entries`;
  }
  if (state.battleImmediateEffects.length > 0) {
    return `battleImmediateEffects has ${state.battleImmediateEffects.length} entries`;
  }
  return "unknown unsafe condition";
}

/**
 * リビルダの対象ゾーン。フィールド・ミラージュ・バーストの 3 種を見る。
 * （デッキ/未登録のカードは継続効果を発揮しない）
 *
 * トラッシュ/手札/手元(set_aside)/使用中(in_use) は原則対象外だが、`applicability.zone` に
 * 該当ゾーンを含む continuous 効果 (「トラッシュ/手札/手元/使用中にあるこのカードは
 * 効果を受けない」型のゾーン束縛常時耐性、BSGE01-C16 / BSLH01 / BSTH08.5-X04 等) のみは
 * [appliesInExtraZone] で個別に許可する。それ以外の continuous 効果は
 * 登録しない (REBUILD_ZONES にこれらを入れない＝既存挙動を保つ)。
 */
const REBUILD_ZONES = new Set(["field", "mirage", "burst"]);

/**
 * REBUILD_ZONES 外だが、`applicability.zone` 個別許可の対象になり得るゾーン。
 * ここに無いゾーン (deck 等) のカードは継続効果を一切発揮しない。
 *
 * `legal-actions-shared.ts` の `recomputeContinuousEffects` (targetInstanceId が
 * field 不在なら除去するチェック) も同じ集合を参照する (ENGINE-set-aside-exit-replacement-choice、
 * adversarial verifier 2026-07-25 round2 指摘: 自己対象の手元 (set_aside) 常駐効果が
 * targetInstanceId=自分自身のとき、そちらのチェックが zone!=="field" のみで除去してしまい
 * recompute のたびに expire→re-register を繰り返していた)。
 *
 * `revealed` (デッキオープン中の一時ゾーン) は ENGINE-revealed-zone-continuous-effect-applicability
 * で追加。「デッキからオープンされたこのカードは系統：「X」を持つ」型の一時的系統付与
 * (BSTH07.8-X02) を有効化する。duration.scope:"while_revealed" と対で使う
 * (`recomputeContinuousEffects` 側の while_revealed 専用ゾーン判定を参照)。
 */
export const EXTRA_APPLICABILITY_ZONES = new Set([
  "trash",
  "hand",
  "set_aside",
  "in_use",
  "revealed",
]);

/**
 * 継続効果の発揮源として走査・保持対象にできる runtime zone の SSOT。
 *
 * `REBUILD_ZONES` は通常の発揮源、`EXTRA_APPLICABILITY_ZONES` は
 * `applicability.zone` で明示した追加発揮源を表す。自己対象の zone-bound CE を
 * 再計算で保持するときも、この和集合だけを許可する。
 */
export function isContinuousEffectSourceZone(zone: Zone): boolean {
  return REBUILD_ZONES.has(zone) || EXTRA_APPLICABILITY_ZONES.has(zone);
}

/**
 * effect の applicability が指定ゾーンを対象に含むか判定する。
 * トラッシュ/手札/手元滞在中に発揮される continuous 効果のみリビルダ対象にするためのガード。
 */
function appliesInExtraZone(
  effect: { applicability?: { zone?: string | readonly string[] } | undefined },
  zone: string
): boolean {
  const effectZone = effect.applicability?.zone;
  if (!effectZone) return false;
  return Array.isArray(effectZone)
    ? effectZone.includes(zone)
    : effectZone === zone;
}

function canRegisterContinuousEffectFromExtraZone(
  effect: Effect,
  zone: string
): boolean {
  if (!appliesInExtraZone(effect, zone)) return false;
  if (zone !== "in_use") return true;
  // in_use から effect 全体を executeEffect するため、混在 step はカード側で分割する。
  return (
    effect.steps.length > 0 &&
    effect.steps.every(
      (step) =>
        step.action.kind === "effect_immunity" &&
        step.action.target.kind === "self"
    )
  );
}

/**
 * バースト/ミラージュは set 中であっても、印字が常時効果であるだけでは発揮源にしない。
 * zone applicability / `while_set` / 自己カード treat_as のいずれかでセット中の
 * 発揮を明示した効果だけを登録する。
 */
function canRegisterContinuousEffectFromSetZone(
  state: GameState,
  effect: Effect,
  sourceCard: CardInstance
): boolean {
  const requiredZone =
    sourceCard.zone === "burst"
      ? "burst_set"
      : sourceCard.zone === "mirage"
        ? "mirage_set"
        : undefined;
  if (requiredZone === undefined) return true;

  const effectZone = effect.applicability?.zone;
  const declaresSetZoneApplicability =
    effectZone !== undefined &&
    (Array.isArray(effectZone)
      ? effectZone.includes(requiredZone)
      : effectZone === requiredZone);
  const hasSetScopedContinuousAction = effect.steps.some(({ action }) => {
    if ("duration" in action && action.duration?.scope === "while_set") {
      return true;
    }
    // 「このカードのシンボル/軽減シンボル」を扱う treat_as は、カード自身が
    // バースト/ミラージュにセット中でも参照される card-state effect である。
    // cardStateOnly は CE を作らないため対象外。
    return (
      action.kind === "treat_as" &&
      action.appliesToCard === true &&
      action.cardStateOnly !== true
    );
  });
  if (!declaresSetZoneApplicability && !hasSetScopedContinuousAction) {
    return false;
  }

  return sourceCard.zone !== "burst" || isCardInSetState(state, sourceCard);
}

/**
 * grant_effect 集約 variant (`grantedEffectSource` 指定、BSSL01-X02 等) の宣言かどうか。
 * 集約 CE 群は生成時に呼び出し元 (host 自身の集約継続効果) と同じ `provenance` を共有する
 * ため、通常の `isAlreadyRegistered` ホスト単位早期 skip をかけると初回登録後に新しい
 * 煌臨元カードが追加されても再展開されない (issues/P3-99 §残留懸念)。集約宣言だけは
 * 毎 rebuild サイクル `executeEffect` を再実行し、子 CE 単位の dedup
 * (`executeRegisterGrantedEffectFromSource` 内 `grantedEffectChildKey`) に委ねる。
 * host 失効判定 (OC 条件不成立時の一括除去) は provenance ベースのまま変更しない。
 */
function isGrantEffectAggregatorDeclaration(effect: Effect): boolean {
  return effect.steps.some(
    (step) =>
      step.action.kind === "grant_effect" &&
      step.action.grantedEffectSource?.kind === "advent_source_effects"
  );
}

/**
 * 既に同じソース + 同じ effectIndex の CE が登録されているか判定する。
 * 通常パスでは provenance が必ず付くので、provenance ペアでの一致で検出する。
 * provenance が無い旧 CE のために modifierTag フォールバックも持つ。
 */
function isAlreadyRegistered(
  state: GameState,
  sourceInstanceId: string,
  sourceDefinitionId: string,
  effectIndex: number,
  modifierTagsFromEffect: ReadonlySet<string>,
  effectTimingScope: TimingScope | undefined,
  provenanceSource?: Pick<
    NonNullable<ContinuousEffect["provenance"]>,
    "effectSourceInstanceId" | "effectSourceDefinitionId"
  >
): boolean {
  for (const ce of state.activeContinuousEffects) {
    if (ce.sourceInstanceId !== sourceInstanceId) continue;

    if (ce.provenance) {
      if (!sameDefinitionEffectPath(ce.provenance.definitionPath)) continue;
      if (ce.provenance.effectIndex === effectIndex) {
        const hasExternalEffectSource =
          provenanceSource?.effectSourceInstanceId !== undefined ||
          provenanceSource?.effectSourceDefinitionId !== undefined;
        if (
          !hasExternalEffectSource &&
          ce.sourceDefinitionId !== sourceDefinitionId
        ) {
          continue;
        }
        const sameEffectSourceInstance =
          (ce.provenance.effectSourceInstanceId ?? undefined) ===
          provenanceSource?.effectSourceInstanceId;
        const sameEffectSourceDefinition =
          (ce.provenance.effectSourceDefinitionId ?? undefined) ===
          provenanceSource?.effectSourceDefinitionId;
        if (sameEffectSourceInstance && sameEffectSourceDefinition) {
          return true;
        }
      }
      continue;
    }

    if (provenanceSource !== undefined) continue;

    // 旧 CE (provenance 無し): modifierTag が effect から推定したタグと一致するなら同一とみなす
    if (
      modifierTagsFromEffect.has(ce.modifierTag) &&
      timingScopeEquals(ce.timingScope, effectTimingScope)
    ) {
      return true;
    }
  }
  return false;
}

interface ContinuousEffectSourceEntry {
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  effectSourceDefinition: CardDefinition;
  effectSourceInstanceId?: string;
  effectSourceDefinitionId?: string;
  effectSourceRoleTag?: string;
}

/**
 * text_role アンダーカード（星霊衣/バレットエディット役割カード等）が
 * host に与える継続効果 source entry を列挙する。host 自身の定義ではなく
 * アンダーカードの定義 (effectSourceDefinition) の continuous 効果を host を
 * sourceCard として実行させることで「アンダーカードがホストに効果を与える」を表現する。
 */
function textRoleUnderEffectEntries(options: {
  state: GameState;
  hostCard: CardInstance;
  hostDefinition: CardDefinition;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): ContinuousEffectSourceEntry[] {
  if (!isTextRoleUnderActiveSpiritHost(options)) {
    return [];
  }

  const entries: ContinuousEffectSourceEntry[] = [];
  for (const underEntry of options.hostCard.underCards ?? []) {
    if (underEntry.role !== "text_role") continue;
    const underId = underEntry.cardInstanceId;
    if (
      !isActiveTextRoleUnderEffectSource({
        ...options,
        effectSourceInstanceId: underId,
      })
    )
      continue;
    const underCard = getCardById(options.state, underId);
    if (!underCard) continue;
    if (underCard.attachedToInstanceId !== options.hostCard.instanceId) {
      continue;
    }
    if (underCard.zone !== "field" || underCard.faceDown) continue;

    const underDefinition = options.getCardDefinitionById(
      underCard.definitionId
    );
    if (!underDefinition) continue;

    entries.push({
      sourceCard: options.hostCard,
      sourceDefinition: options.hostDefinition,
      effectSourceDefinition: underDefinition,
      effectSourceInstanceId: underCard.instanceId,
      effectSourceDefinitionId: underDefinition.cardNo,
      ...(underEntry.roleTag !== undefined
        ? { effectSourceRoleTag: normalizeUnderCardRoleTag(underEntry.roleTag) }
        : {}),
    });
  }

  return entries;
}

/**
 * クォーツ host 継承発揮 (ENGINE-quartz-host-identity-propagation、qa-030) の continuous 版
 * source entry 列挙。host にセット中のクォーツ各々の定義を effectSourceDefinition として host を
 * sourceCard に紐付ける (textRoleUnderEffectEntries の quartz 版、star-garment-utils.ts
 * isActiveQuartzInheritedEffectSource が解決時再検証を担う対)。
 * text_role_under と異なり host の category 制限は行わない (ENIGMA は brave/魂状態専用カードで
 * 印字上の category が spirit ではないため、同じ category ゲートを課すと恒久的に空になる)。
 */
function quartzInheritedContinuousEffectEntries(options: {
  state: GameState;
  hostCard: CardInstance;
  hostDefinition: CardDefinition;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): ContinuousEffectSourceEntry[] {
  if (
    options.hostDefinition.quartzHostData?.inheritsSetQuartzEffects !== true
  ) {
    return [];
  }

  const entries: ContinuousEffectSourceEntry[] = [];
  for (const setState of getQuartzSetStatesByHost(
    options.state,
    options.hostCard.instanceId
  )) {
    const quartzCard = getCardById(options.state, setState.quartzInstanceId);
    if (!quartzCard) continue;
    if (quartzCard.zone !== "field" || quartzCard.faceDown) continue;

    const quartzDefinition = options.getCardDefinitionById(
      quartzCard.definitionId
    );
    if (!quartzDefinition) continue;

    entries.push({
      sourceCard: options.hostCard,
      sourceDefinition: options.hostDefinition,
      effectSourceDefinition: quartzDefinition,
      effectSourceInstanceId: quartzCard.instanceId,
      effectSourceDefinitionId: quartzDefinition.cardNo,
    });
  }

  return entries;
}

function continuousEffectCanApplyFromAdventSource(effect: Effect): boolean {
  const zone = effect.applicability?.zone;
  if (!zone) return false;
  return Array.isArray(zone)
    ? zone.includes("advent_source")
    : zone === "advent_source";
}

/**
 * クォーツ host 継承発揮の「【クォーツ：...】」ヘッダー系 effect かどうか
 * (ENGINE-quartz-host-identity-propagation、isTextRoleUnderTextEffect の quartz 版)。
 */
function isQuartzSetTextEffect(
  definition: CardDefinition,
  effect: Effect
): boolean {
  return (
    effect.textRef?.some((lineIndex) => {
      const line = definition.textLines?.[lineIndex];
      return line !== undefined && isQuartzSetHeaderLine(line);
    }) ?? false
  );
}

/**
 * 外部 source entry (text_role_under アンダーカード or quartz host 継承) 経由でのみ
 * 発揮を許可する continuous effect かどうかの SSOT。両判別を1箇所に集約し、
 * 呼び出し側 (ビルド/解決の各経路) が同じ列挙を並行して持たないようにする。
 */
function isExternalContinuousSourceHeaderEffect(
  definition: CardDefinition,
  effect: Effect
): boolean {
  return (
    isTextRoleUnderTextEffect(definition, effect) ||
    isQuartzSetTextEffect(definition, effect)
  );
}

function requiredTextRoleUnderRoleTagForEffect(
  definition: CardDefinition,
  effect: Effect
): string | undefined {
  const referencedLines = effect.textRef
    ?.map((lineIndex) => definition.textLines[lineIndex])
    .filter((line): line is string => line !== undefined);
  return textRoleUnderRequiredRoleTagForTextLines(referencedLines);
}

function continuousEffectSourceEntries(options: {
  state: GameState;
  card: CardInstance;
  definition: CardDefinition;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): ContinuousEffectSourceEntry[] {
  const nativeEntries: ContinuousEffectSourceEntry[] = isTextRoleUnderCard(
    options.state,
    options.card
  )
    ? []
    : [
        {
          sourceCard: options.card,
          sourceDefinition: options.definition,
          effectSourceDefinition: options.definition,
        },
      ];

  return [
    ...nativeEntries,
    ...textRoleUnderEffectEntries({
      state: options.state,
      hostCard: options.card,
      hostDefinition: options.definition,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
    ...quartzInheritedContinuousEffectEntries({
      state: options.state,
      hostCard: options.card,
      hostDefinition: options.definition,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
  ];
}

function isNativeTextRoleUnderHeaderEffect(
  entry: ContinuousEffectSourceEntry,
  effect: Effect
): boolean {
  return (
    entry.effectSourceInstanceId === undefined &&
    isTextRoleUnderTextEffect(entry.effectSourceDefinition, effect)
  );
}

export function isActiveTextRoleUnderCardContinuousProvider(options: {
  state: GameState;
  hostCard: CardInstance;
  hostDefinition: CardDefinition;
  effectSourceInstanceId: string;
  effectSourceDefinitionId?: string;
}): boolean {
  return isActiveTextRoleUnderEffectSource(options);
}

export function isActiveExternalContinuousEffectSource(options: {
  state: GameState;
  hostCard: CardInstance;
  hostDefinition: CardDefinition;
  effectSourceInstanceId: string;
  effectSourceDefinitionId?: string;
}): boolean {
  return (
    isActiveTextRoleUnderCardContinuousProvider(options) ||
    isActiveQuartzInheritedEffectSource(options)
  );
}

function hasExternalContinuousEffectSource(ce: ContinuousEffect): boolean {
  return (
    ce.provenance?.effectSourceInstanceId !== undefined &&
    ce.provenance.effectSourceInstanceId !== ce.sourceInstanceId
  );
}

export function resolveProvenanceEffectForTiming(options: {
  state: GameState;
  ce: ContinuousEffect;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): Effect | undefined {
  const { ce } = options;
  if (!ce.provenance) return undefined;
  const hasExternalEffectSource = hasExternalContinuousEffectSource(ce);
  const externalEffectSourceInstanceId = hasExternalEffectSource
    ? ce.provenance.effectSourceInstanceId
    : undefined;
  const definitionId =
    ce.provenance.effectSourceDefinitionId ??
    (externalEffectSourceInstanceId !== undefined
      ? getCardById(options.state, externalEffectSourceInstanceId)?.definitionId
      : ce.sourceDefinitionId);
  if (definitionId === undefined) return undefined;
  return resolveDefinitionEffect(
    options.getCardDefinitionById(definitionId),
    ce.provenance.effectIndex,
    ce.provenance.definitionPath
  );
}

function resolveContinuousProvenanceEffect(options: {
  state: GameState;
  ce: ContinuousEffect;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): {
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  effectSourceDefinition: CardDefinition;
  effect: Effect;
  effectIndex: number;
} | null {
  const { ce } = options;
  if (!ce.provenance) return null;
  const sourceCard = getCardById(options.state, ce.sourceInstanceId);
  if (!sourceCard) return null;
  const sourceDefinition = options.getCardDefinitionById(
    sourceCard.definitionId
  );
  if (!sourceDefinition) return null;

  let effectSourceDefinition = sourceDefinition;
  const hasExternalEffectSource = hasExternalContinuousEffectSource(ce);
  if (hasExternalEffectSource) {
    const effectSourceInstanceId = ce.provenance.effectSourceInstanceId;
    if (effectSourceInstanceId === undefined) return null;
    if (
      !isActiveExternalContinuousEffectSource({
        state: options.state,
        hostCard: sourceCard,
        hostDefinition: sourceDefinition,
        effectSourceInstanceId,
        ...(ce.provenance.effectSourceDefinitionId !== undefined
          ? {
              effectSourceDefinitionId: ce.provenance.effectSourceDefinitionId,
            }
          : {}),
      }) &&
      !isActiveQuartzInheritedEffectSource({
        state: options.state,
        hostCard: sourceCard,
        hostDefinition: sourceDefinition,
        effectSourceInstanceId,
        ...(ce.provenance.effectSourceDefinitionId !== undefined
          ? {
              effectSourceDefinitionId: ce.provenance.effectSourceDefinitionId,
            }
          : {}),
      })
    ) {
      return null;
    }
    if (ce.provenance.effectSourceDefinitionId !== undefined) {
      const providerDefinition = options.getCardDefinitionById(
        ce.provenance.effectSourceDefinitionId
      );
      if (!providerDefinition) return null;
      effectSourceDefinition = providerDefinition;
    }
  }

  const effect = resolveDefinitionEffect(
    effectSourceDefinition,
    ce.provenance.effectIndex,
    ce.provenance.definitionPath
  );
  if (!effect) return null;
  if (!hasExternalEffectSource && effect.timing.kind !== "continuous") {
    return null;
  }
  if (
    hasExternalEffectSource &&
    !isExternalContinuousSourceHeaderEffect(effectSourceDefinition, effect)
  ) {
    return null;
  }
  if (hasExternalEffectSource) {
    const requiredRoleTag = requiredTextRoleUnderRoleTagForEffect(
      effectSourceDefinition,
      effect
    );
    if (requiredRoleTag !== undefined) {
      const underEntry = sourceCard.underCards?.find(
        (entry) =>
          entry.role === "text_role" &&
          entry.cardInstanceId === ce.provenance?.effectSourceInstanceId
      );
      if (!underCardRoleTagsEqual(underEntry?.roleTag, requiredRoleTag)) {
        return null;
      }
    }
  }
  if (hasExternalEffectSource && effect.stub) {
    return null;
  }

  return {
    sourceCard,
    sourceDefinition,
    effectSourceDefinition,
    effect,
    effectIndex: ce.provenance.effectIndex,
  };
}

/**
 * effect の steps からこの effect が生成しうる modifierTag の集合を抽出する。
 * 旧 CE フォールバック時の重複検出に使用。
 *
 * 厳密ではない（汎用的に列挙しているだけ）が、シナリオ初期化用途では十分。
 */
function inferModifierTagsFromEffect(effect: {
  steps: readonly {
    action: {
      kind: string;
      resistsOutcome?: unknown;
      resistType?: unknown;
      scope?: unknown;
    };
  }[];
}): Set<string> {
  const tags = new Set<string>();
  for (const step of effect.steps) {
    switch (step.action.kind) {
      case "cost_modify":
        tags.add("cost_override");
        tags.add("additional_cost");
        break;
      case "bp_modify":
        tags.add("bp_modifier");
        break;
      case "symbol_addition":
        tags.add("symbol_addition");
        break;
      case "treat_as":
        tags.add("treat_as_color");
        tags.add("treat_as_symbol");
        tags.add("treat_as_color_and_symbol");
        tags.add("treat_as_reduction_symbol");
        tags.add("treat_as_symbol_and_reduction");
        break;
      case "effect_immunity":
        tags.add("defense_immune");
        break;
      case "effect_resistance": {
        const outcomes =
          step.action.resistsOutcome !== undefined
            ? Array.isArray(step.action.resistsOutcome)
              ? step.action.resistsOutcome
              : [step.action.resistsOutcome]
            : step.action.resistType !== undefined
              ? [step.action.resistType]
              : [];
        for (const outcome of outcomes) {
          const tag = normalizeEffectResistanceTag(outcome);
          if (tag) tags.add(tag);
        }
        if (outcomes.length > 0) break;
        tags.add("defense_immune");
        tags.add("defense_suppress");
        tags.add("effect_suppression");
        tags.add("cannot_leave_field");
        tags.add("cannot_be_destroyed");
        tags.add("cannot_be_bounced");
        tags.add("cannot_be_sent_to_deck");
        tags.add("cannot_be_vanished");
        tags.add("cannot_be_removed_from_game");
        tags.add("cannot_be_exhausted");
        tags.add("cannot_reduce_cores_below");
        tags.add("cannot_be_targeted");
        tags.add("cannot_include");
        break;
      }
      case "unblockable":
        tags.add("unblockable");
        break;
      case "allow_block_while_exhausted":
        tags.add("allow_block_while_exhausted");
        break;
      case "allow_attack_while_exhausted":
        tags.add("allow_attack_while_exhausted");
        break;
      case "allow_tapless_battle_declare":
        tags.add("allow_tapless_battle_declare");
        break;
      case "block_unblockable":
        tags.add("block_unblockable");
        break;
      case "allow_simultaneous_attack":
        tags.add("allow_simultaneous_attack");
        break;
      case "allow_mid_battle_join":
        tags.add("allow_mid_battle_join");
        break;
      case "allow_ignore_summon_condition":
        tags.add("allow_ignore_summon_condition");
        break;
      case "grant_game_loss_immunity":
        tags.add("immune_to_game_loss");
        break;
      case "grant_declared_summon_alt_cost":
        tags.add("grant_declared_summon_alt_cost");
        break;
      case "grant_summon_trash_core_placement":
        tags.add("grant_summon_trash_core_placement");
        break;
      case "grant_link_aid_cost_override":
        tags.add("grant_link_aid_cost_override");
        break;
      case "grant_optional_deck_reveal_count_boost":
        tags.add("grant_optional_deck_reveal_count_boost");
        break;
      case "require_multi_block":
        tags.add("require_multi_block");
        break;
      case "offer_magic_pre_cost_trigger":
        tags.add("offer_magic_pre_cost_trigger");
        break;
      case "force_attack_step_end_after_first_battle":
        tags.add("force_attack_step_end_after_first_battle");
        break;
      case "prevent_battle":
        tags.add("prevent_battle_attack");
        tags.add("prevent_battle_block");
        tags.add("prevent_battle_both");
        break;
      case "prevent_normal_core_move":
        tags.add("prevent_normal_core_move");
        break;
      case "require_battle_cost":
        tags.add("battle_cost_gate_attack");
        tags.add("battle_cost_gate_block");
        tags.add("battle_cost_gate_both");
        break;
      case "require_attack_exhaust_cost":
        tags.add("attack_exhaust_cost_gate");
        break;
      case "require_battle_destroy_cost":
        tags.add("battle_destroy_cost_gate_attack");
        tags.add("battle_destroy_cost_gate_block");
        tags.add("battle_destroy_cost_gate_both");
        break;
      case "prevent_life_damage":
        tags.add("prevent_life_damage");
        break;
      case "require_hand_gain_cost":
        tags.add("hand_gain_cost_gate");
        break;
      case "hand_gain_prevention":
        tags.add("hand_gain_prevention");
        break;
      case "draw_modify":
        tags.add("draw_modify");
        break;
      case "restrict_flash":
        tags.add("restrict_flash_hand");
        tags.add("restrict_flash_field");
        tags.add("restrict_flash_any");
        break;
      case "restrict_stack":
        tags.add("restrict_stack");
        break;
      case "restrict_burst_activation":
        tags.add("cannot_activate_opponent_burst");
        break;
      case "restrict_advent":
        tags.add("restrict_advent");
        break;
      case "restrict_recovery":
        tags.add("prevent_recovery");
        break;
      case "restrict_reserve_cost_payment":
        tags.add("restrict_reserve_cost_payment");
        break;
      case "restrict_field_cost_payment":
        tags.add("restrict_field_cost_payment");
        break;
      case "suppress_stack_source":
        tags.add("suppress_stack_source");
        break;
      case "gate_flash_stack_core":
        tags.add("gate_flash_stack_core");
        break;
      case "grant_deck_hand_access":
        tags.add("deck_hand_access");
        break;
      case "grant_magic_use":
        tags.add("magic_use_permission");
        break;
      case "require_effect_cost":
        tags.add("required_effect_cost");
        break;
      case "gate_flash_stack_hand_discard":
        tags.add("gate_flash_stack_hand_discard");
        break;
      case "prevent_hand_discard":
        tags.add("prevent_hand_discard");
        break;
      case "prevent_deck_discard":
        tags.add("prevent_deck_discard");
        break;
      case "redirect_deck_discard_to_exclude":
        tags.add("redirect_deck_discard_to_exclude");
        break;
      case "restrict_core_placement":
        tags.add(
          step.action.scope === "from_void_self"
            ? "restrict_core_placement_void"
            : "restrict_core_placement_life"
        );
        break;
      case "life_gain_replacement":
        tags.add("life_gain_replacement");
        break;
      case "life_gain_prevention":
        tags.add("life_gain_prevention");
        break;
      case "core_move_destination_replacement":
        tags.add("core_move_destination_replacement");
        break;
      case "restrict_end_attack_step":
        tags.add("restrict_end_attack_step");
        break;
      case "restrict_end_battle":
        tags.add("restrict_end_battle");
        break;
      case "restrict_end_step":
        tags.add("restrict_end_step");
        break;
      case "restrict_end_turn":
        tags.add("restrict_end_turn");
        break;
      case "rebirth":
        tags.add("replace_field_exit");
        break;
      case "suppress_effect":
        tags.add("effect_suppression");
        break;
      case "override_properties":
        tags.add("override_properties");
        break;
      case "restrict_use":
        tags.add("restrict_use");
        break;
      case "prevent_cost_reduction":
        tags.add("prevent_cost_reduction");
        break;
      case "limit_cost_reduction":
        tags.add("limit_cost_reduction");
        break;
      case "extend_field_symbol_source":
        tags.add("extend_field_symbol_source");
        break;
      case "field_name_uniqueness":
        tags.add("field_name_uniqueness");
        break;
      case "count_as_multiple":
        tags.add("count_as_multiple");
        break;
      case "restrict_manifest":
        tags.add("restrict_manifest");
        break;
      case "register_act_as_spirit":
        tags.add("act_as_spirit");
        break;
      case "register_redirect_effect_target":
        tags.add("redirect_effect_target");
        break;
      case "grant_effect":
        tags.add("granted_effect");
        break;
      case "under_card_role_grant":
        tags.add("under_card_role");
        break;
      case "negate":
        // 常駐無効化 (while_on_field の negate CE)。provenance ベースで dedup されるが、
        // provenance 無し旧 CE フォールバック用に negate 系タグを列挙する。
        tags.add("negate_summon");
        tags.add("negate_place");
        tags.add("negate_use_magic");
        tags.add("negate_effect");
        tags.add("negate_opponent_burst");
        break;
      case "count_gain_modifier":
        tags.add("count_gain_modifier");
        break;
      case "core_move_amount_modifier":
        tags.add("core_move_amount_modifier");
        break;
      case "effect_param_modify":
        tags.add("effect_param_override");
        break;
      case "duration_override":
        tags.add("duration_override");
        break;
      default:
        break;
    }
  }
  return tags;
}

function isContinuousEffectSuppressed(options: {
  state: GameState;
  sourceCard: GameState["cardInstances"][number];
  sourceDefinition: CardDefinition;
  effectSourceDefinition: CardDefinition;
  effect: Effect;
  effectIndex: number;
  candidateModifierTags?: ReadonlySet<string>;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): boolean {
  // A combined brave's self reference needs an active host carrier both when
  // registering and when retaining its CE. Optional rewrite permission alone
  // is not consent to apply a continuous effect automatically.
  const rewriteStatus = getBraveSelfReferenceRewriteStatus({
    ...options,
    sourceEffectDefinition: options.effectSourceDefinition,
  });
  if (rewriteStatus === "blocked" || rewriteStatus === "allowed_optional") {
    return true;
  }
  // Ver.17.0 rule: a continuous effect with no activation location/condition
  // is always active and is not disabled by "cannot exert effects".
  // timingScope only narrows the active period; it is not an activation
  // location or condition.
  if (
    !options.effect.applicability &&
    (!options.effect.condition || options.effect.condition.length === 0)
  ) {
    return false;
  }

  const suppressionEffectDescriptor = deriveSuppressionEffectDescriptor(
    options.effect,
    {
      sourceDefinitionId: options.effectSourceDefinition.cardNo,
      sourceKind: getEffectDescriptorSourceKindForPrintedCategory(
        options.effectSourceDefinition.printedCategory
      ),
      effectIndex: options.effectIndex,
      sourceTextLines: options.effectSourceDefinition.textLines,
    }
  );
  const checkSuppressed = (state: GameState): boolean =>
    !executeReevaluationCheck({
      state,
      checkKind: "effect_suppression",
      sourceInstanceId: options.sourceCard.instanceId,
      targetInstanceIds: [],
      sourcePreventionLevel: options.effect.preventionLevel ?? "none",
      suppressionEffectDescriptor,
      getCardDefinitionById: options.getCardDefinitionById,
    });

  if (
    options.candidateModifierTags !== undefined &&
    (options.candidateModifierTags.has("defense_immune") ||
      options.candidateModifierTags.has("defense_suppress")) &&
    options.state.activeContinuousEffects.some(isTargetAffectGateSuppressionCe)
  ) {
    const stateWithoutTargetGateSuppressions: GameState = {
      ...options.state,
      activeContinuousEffects: options.state.activeContinuousEffects.filter(
        (ce) => !isTargetAffectGateSuppressionCe(ce)
      ),
    };
    if (!checkSuppressed(stateWithoutTargetGateSuppressions)) {
      return false;
    }
  }

  return checkSuppressed(options.state);
}

function isTargetAffectGateSuppressionCe(ce: ContinuousEffect): boolean {
  return (
    ce.modifierTag === "effect_suppression" &&
    ce.metadata?.targetAffectGate === "blocked_by_source_immunity"
  );
}

function removeSuppressedContinuousEffects(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const removed: ContinuousEffect[] = [];
  const stillActive: ContinuousEffect[] = [];

  for (const ce of state.activeContinuousEffects) {
    if (!ce.provenance) {
      stillActive.push(ce);
      continue;
    }
    if (ce.modifierTag === "retrigger") {
      stillActive.push(ce);
      continue;
    }
    const provenanceEffect = resolveProvenanceEffectForTiming({
      state,
      ce,
      getCardDefinitionById,
    });
    if (provenanceEffect && provenanceEffect.timing.kind !== "continuous") {
      stillActive.push(ce);
      continue;
    }

    const resolved = resolveContinuousProvenanceEffect({
      state,
      ce,
      getCardDefinitionById,
    });
    if (!resolved) {
      if (hasExternalContinuousEffectSource(ce)) {
        removed.push(ce);
      } else {
        stillActive.push(ce);
      }
      continue;
    }

    if (
      isContinuousEffectSuppressed({
        state,
        sourceCard: resolved.sourceCard,
        sourceDefinition: resolved.sourceDefinition,
        effectSourceDefinition: resolved.effectSourceDefinition,
        effect: resolved.effect,
        effectIndex: resolved.effectIndex,
        candidateModifierTags: new Set([ce.modifierTag]),
        getCardDefinitionById,
      })
    ) {
      removed.push(ce);
    } else {
      stillActive.push(ce);
    }
  }

  if (removed.length === 0) return state;
  return {
    ...state,
    activeContinuousEffects: stillActive,
    log: [
      ...state.log,
      ...removed.map(
        (ce) => `continuous-effect:suppressed:${ce.effectId}:${ce.modifierTag}`
      ),
    ],
  };
}

/**
 * 動的フィルタ型 effect_suppression が実際に対象に取った source を CE metadata に残す。
 * 対象 source 自身の override_properties 等が filter 一致に寄与していると、抑止でその
 * CE が消えた後は現在の盤面だけから対象を逆算できない。そのため battle/attack scope
 * 抑止の失効時に正しく再登録できるよう、既存の source CE がある時点で履歴化する。
 */
export function recordDynamicEffectSuppressionTargetHistory(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const sourceIdsWithContinuousEffects = new Set(
    state.activeContinuousEffects
      .filter(
        (ce) => ce.provenance !== undefined && ce.modifierTag !== "retrigger"
      )
      .map((ce) => ce.sourceInstanceId)
  );
  if (sourceIdsWithContinuousEffects.size === 0) return state;

  const additionsBySuppressorId = new Map<string, Set<string>>();
  for (const ce of state.activeContinuousEffects) {
    if (
      ce.modifierTag !== "effect_suppression" ||
      ce.targetInstanceId !== undefined ||
      ce.metadata?.suppressTargetFilter === undefined
    ) {
      continue;
    }
    const matchingSourceIds = getDynamicEffectSuppressionTargetIds(
      state,
      ce,
      getCardDefinitionById
    );
    const suppressedSourceIds = new Set(
      [...matchingSourceIds].filter((id) =>
        sourceIdsWithContinuousEffects.has(id)
      )
    );
    if (suppressedSourceIds.size > 0) {
      additionsBySuppressorId.set(ce.effectId, suppressedSourceIds);
    }
  }
  if (additionsBySuppressorId.size === 0) return state;

  let changed = false;
  const activeContinuousEffects = state.activeContinuousEffects.map((ce) => {
    const additions = additionsBySuppressorId.get(ce.effectId);
    if (!additions) return ce;
    const recorded = Array.isArray(ce.metadata?.suppressedSourceInstanceIds)
      ? ce.metadata.suppressedSourceInstanceIds.filter(
          (id): id is string => typeof id === "string"
        )
      : [];
    const next = [...new Set([...recorded, ...additions])];
    if (next.length === recorded.length) return ce;
    changed = true;
    return {
      ...ce,
      metadata: { ...ce.metadata, suppressedSourceInstanceIds: next },
    };
  });
  return changed ? { ...state, activeContinuousEffects } : state;
}

function removeTimingScopeStaleContinuousEffects(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const removed: ContinuousEffect[] = [];
  const stillActive: ContinuousEffect[] = [];

  for (const ce of state.activeContinuousEffects) {
    if (ce.modifierTag === "retrigger") {
      stillActive.push(ce);
      continue;
    }
    if (!ce.provenance) {
      if (
        isLegacyContinuousEffectTimingScopeStale({
          state,
          ce,
          getCardDefinitionById,
        })
      ) {
        removed.push(ce);
      } else {
        stillActive.push(ce);
      }
      continue;
    }

    const provenanceEffect = resolveProvenanceEffectForTiming({
      state,
      ce,
      getCardDefinitionById,
    });
    if (provenanceEffect && provenanceEffect.timing.kind !== "continuous") {
      stillActive.push(ce);
      continue;
    }

    const resolved = resolveContinuousProvenanceEffect({
      state,
      ce,
      getCardDefinitionById,
    });
    if (
      resolved !== null &&
      !timingScopeEquals(ce.timingScope, resolved.effect.timingScope)
    ) {
      removed.push(ce);
    } else {
      stillActive.push(ce);
    }
  }

  if (removed.length === 0) return state;
  return {
    ...state,
    activeContinuousEffects: stillActive,
    log: [
      ...state.log,
      ...removed.map(
        (ce) =>
          `continuous-effect:timing-scope-stale:${ce.effectId}:${ce.modifierTag}`
      ),
    ],
  };
}

function isLegacyContinuousEffectTimingScopeStale(options: {
  state: GameState;
  ce: ContinuousEffect;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): boolean {
  const sourceCard = options.state.cardInstances.find(
    (card) => card.instanceId === options.ce.sourceInstanceId
  );
  if (!sourceCard) return false;

  const sourceDefinition = options.getCardDefinitionById(
    sourceCard.definitionId
  );
  if (!sourceDefinition) return false;

  let sawMatchingCurrentEffect = false;
  for (const entry of continuousEffectSourceEntries({
    state: options.state,
    card: sourceCard,
    definition: sourceDefinition,
    getCardDefinitionById: options.getCardDefinitionById,
  })) {
    for (const effect of entry.effectSourceDefinition.effects ?? []) {
      if (effect.timing.kind !== "continuous") continue;
      if (!inferModifierTagsFromEffect(effect).has(options.ce.modifierTag)) {
        continue;
      }
      sawMatchingCurrentEffect = true;
      if (timingScopeEquals(options.ce.timingScope, effect.timingScope)) {
        return false;
      }
    }
  }

  return sawMatchingCurrentEffect;
}

function finalizeContinuousEffectRebuild(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const current = removeSuppressedContinuousEffects(
    recordDynamicEffectSuppressionTargetHistory(state, getCardDefinitionById),
    getCardDefinitionById
  );
  // 現在の実効値の同期は再構築側で完了する。解決時snapshotには触れない。
  return recomputeBattleEntityBp(current, getCardDefinitionById);
}

/**
 * フィールド/ミラージュ/バースト上のカードから continuous 効果を走査し、
 * 未登録の CE を activeContinuousEffects に追加する。
 *
 * - 通常パスの CE は provenance を native に保持しているため、
 *   (sourceInstanceId, effectIndex) で重複検出される
 * - 旧 CE (provenance 無し) との重複は modifierTag フォールバックで検出
 * - condition / applicability の評価は executeEffect が行うので不要な CE は登録されない
 * - 冪等: 2 回呼んでも結果は変わらない
 *
 * 想定呼び出しタイミング: シナリオ初期化直後・セーブ復元直後。
 * バトル中・フェーズ進行中の呼び出しは禁止 (createdAtTurn / createdAtAttackId が
 * 現在の state に依存するため、意図しない値で CE が作られる)。
 *
 * @throws state が安全でないとき (バトル中/スタック窓開放中/効果キュー残あり等)。
 *         `options.unsafeAllowDuringBattle: true` を渡すと例外をバイパスできるが、
 *         これは invariant collector のような「結果を捨てて差分だけ見る」用途に限る。
 */
export function rebuildContinuousEffectsFromField(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  options?: RebuildContinuousEffectsOptions
): GameState {
  if (
    !options?.unsafeAllowDuringBattle &&
    !isSafeStateForContinuousRebuild(state)
  ) {
    throw new Error(
      `rebuildContinuousEffectsFromField: cannot run during active gameplay (${describeUnsafeState(state)}). ` +
        "Call only at scenario initialization or save data restoration. " +
        "Pass { unsafeAllowDuringBattle: true } only for invariant inspection that discards the result."
    );
  }

  let current = recordDynamicEffectSuppressionTargetHistory(
    state,
    getCardDefinitionById
  );
  if (options?.skipTimingScopeStaleRemoval !== true) {
    current = removeTimingScopeStaleContinuousEffects(
      current,
      getCardDefinitionById
    );
  }
  const sourceInstanceIds =
    options?.sourceInstanceIds === undefined
      ? undefined
      : options.sourceInstanceIds instanceof Set
        ? options.sourceInstanceIds
        : new Set(options.sourceInstanceIds);

  for (const card of state.cardInstances) {
    if (
      sourceInstanceIds !== undefined &&
      !sourceInstanceIds.has(card.instanceId)
    )
      continue;
    const isExtraZoneCard = EXTRA_APPLICABILITY_ZONES.has(card.zone);
    if (!REBUILD_ZONES.has(card.zone) && !isExtraZoneCard) continue;
    // P3-69: フィールド上の裏向きカードは印字の能力を持たない (素性なし)。
    // 付与された identity (act_as_spirit 等) は付与元カード由来の CE として別途登録される。
    if (card.zone === "field" && card.faceDown) continue;
    if (shouldSkipNewFieldContinuousEffectSource(card, options)) continue;

    const def = getCardDefinitionById(card.definitionId);
    if (!def) continue;

    for (const entry of continuousEffectSourceEntries({
      state: current,
      card,
      definition: def,
      getCardDefinitionById,
    })) {
      if (
        shouldSkipNewExternalContinuousEffectSource(
          current,
          entry,
          options?.skipNewFieldEffectsFromPendingLeave === true
        )
      ) {
        continue;
      }

      const effects = entry.effectSourceDefinition.effects ?? [];
      for (let effectIndex = 0; effectIndex < effects.length; effectIndex++) {
        const effect = effects[effectIndex]!;
        if (effect.timing.kind !== "continuous") continue;
        if (
          !canRegisterContinuousEffectFromSetZone(
            current,
            effect,
            entry.sourceCard
          )
        ) {
          continue;
        }
        if (isNativeTextRoleUnderHeaderEffect(entry, effect)) {
          continue;
        }
        if (
          entry.effectSourceInstanceId === undefined &&
          isAdventSourceUnderCard(current, entry.sourceCard) &&
          !continuousEffectCanApplyFromAdventSource(effect)
        ) {
          continue;
        }
        if (
          entry.effectSourceInstanceId === undefined &&
          isQuartzSetTextEffect(entry.effectSourceDefinition, effect) &&
          isQuartzInstanceInheritedByActiveHost(
            current,
            entry.sourceCard.instanceId,
            getCardDefinitionById
          )
        ) {
          // このカード自身がクォーツとして host にセット中で、host が発揮を継承する場合は
          // host 側の外部 entry (quartzInheritedContinuousEffectEntries) からのみ発揮する
          // (二重登録防止、qa-030)。
          continue;
        }
        if (
          entry.effectSourceInstanceId !== undefined &&
          !isExternalContinuousSourceHeaderEffect(
            entry.effectSourceDefinition,
            effect
          )
        ) {
          continue;
        }
        if (entry.effectSourceInstanceId !== undefined) {
          const requiredRoleTag = requiredTextRoleUnderRoleTagForEffect(
            entry.effectSourceDefinition,
            effect
          );
          if (
            requiredRoleTag !== undefined &&
            !underCardRoleTagsEqual(entry.effectSourceRoleTag, requiredRoleTag)
          ) {
            continue;
          }
        }
        if (entry.effectSourceInstanceId !== undefined && effect.stub) {
          continue;
        }
        if (isStubRebirthEffect(effect)) {
          continue;
        }
        // Q54 型は「通常行動を許可する」宣言用の常時効果であり、steps の summon を
        // 効果解決として実行するものではない。legal action 列挙だけがこの宣言を消費する。
        if (isHandSummonPermissionEffect(effect)) {
          continue;
        }
        // トラッシュ/手札/手元/使用中カードは「そのゾーン滞在中に発揮される」continuous 効果
        // (applicability.zone に該当ゾーンを含む) のみ登録する。
        if (
          isExtraZoneCard &&
          !canRegisterContinuousEffectFromExtraZone(effect, card.zone)
        )
          continue;

        const tagsFromEffect = inferModifierTagsFromEffect(effect);
        if (
          isContinuousEffectSuppressed({
            state: current,
            sourceCard: entry.sourceCard,
            sourceDefinition: entry.sourceDefinition,
            effectSourceDefinition: entry.effectSourceDefinition,
            effect,
            effectIndex,
            candidateModifierTags: tagsFromEffect,
            getCardDefinitionById,
          })
        ) {
          continue;
        }
        if (
          !isGrantEffectAggregatorDeclaration(effect) &&
          isAlreadyRegistered(
            current,
            entry.sourceCard.instanceId,
            entry.effectSourceDefinition.cardNo,
            effectIndex,
            tagsFromEffect,
            effect.timingScope,
            entry.effectSourceInstanceId !== undefined ||
              entry.effectSourceDefinitionId !== undefined
              ? {
                  ...(entry.effectSourceInstanceId !== undefined
                    ? { effectSourceInstanceId: entry.effectSourceInstanceId }
                    : {}),
                  ...(entry.effectSourceDefinitionId !== undefined
                    ? {
                        effectSourceDefinitionId:
                          entry.effectSourceDefinitionId,
                      }
                    : {}),
                }
              : undefined
          )
        ) {
          continue;
        }

        // 〔重複不可〕(no_duplicate) の dedup は executeEffect 内 (effect-interpreter.ts)
        // の continuous no_duplicate チェックが SSOT。ここでは個別ガードを置かない。
        // grant_effect 集約宣言 (isGrantEffectAggregatorDeclaration) だけは host 単位の
        // 早期 skip をバイパスし毎サイクル executeEffect を再実行する (直上コメント参照)。

        current = executeEffect({
          state: current,
          chainId: `continuous:${entry.sourceCard.instanceId}:${effectIndex}`,
          effect,
          effectIndex,
          sourceInstanceId: entry.sourceCard.instanceId,
          actingPlayerId: entry.sourceCard.controllerPlayerId,
          getCardDefinitionById,
          ...(entry.effectSourceInstanceId !== undefined
            ? { effectSourceInstanceId: entry.effectSourceInstanceId }
            : {}),
          ...(entry.effectSourceDefinitionId !== undefined
            ? { effectSourceDefinitionId: entry.effectSourceDefinitionId }
            : {}),
          // P3-39: continuous effect rebuild は after_triggers connector を踏まないため
          // 空 lookup を渡して問題ない (queue は実行されない)。
          getRegisteredTriggeredEffectActions: () => [],
        });
      }
    }
  }

  current = materializeGrantedEffects(
    current,
    getCardDefinitionById,
    executeEffect
  );
  // 役割・契約煌臨資格の付与より先に走査した下カードも同じ再構築で有効にする。
  const previousRoleIds = new Set(
    state.activeContinuousEffects
      .filter((ce) => ce.modifierTag === "under_card_role")
      .map((ce) => ce.effectId)
  );
  if (
    current.cardInstances.some(
      (card) =>
        hasContractAdventEligibilityGrant(current, card.instanceId) &&
        !hasContractAdventEligibilityGrant(state, card.instanceId)
    ) ||
    current.activeContinuousEffects.some(
      (ce) =>
        ce.modifierTag === "under_card_role" &&
        !previousRoleIds.has(ce.effectId)
    )
  ) {
    return rebuildContinuousEffectsFromField(
      current,
      getCardDefinitionById,
      options
    );
  }
  return finalizeContinuousEffectRebuild(current, getCardDefinitionById);
}

export function recomputeAndRebuildContinuousEffectsForSources(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceIds: ReadonlySet<string> | readonly string[]
): GameState {
  const narrowedSourceIds =
    sourceInstanceIds instanceof Set
      ? sourceInstanceIds
      : new Set(sourceInstanceIds);
  if (narrowedSourceIds.size === 0) {
    return finalizeContinuousEffectRebuild(
      recomputeContinuousEffects(
        recordDynamicEffectSuppressionTargetHistory(
          state,
          getCardDefinitionById
        ),
        getCardDefinitionById
      ),
      getCardDefinitionById
    );
  }
  let current = recordDynamicEffectSuppressionTargetHistory(
    state,
    getCardDefinitionById
  );
  current = recomputeContinuousEffects(current, getCardDefinitionById);
  return rebuildContinuousEffectsFromField(current, getCardDefinitionById, {
    unsafeAllowDuringBattle: true,
    skipNewFieldEffectsFromPendingLeave: true,
    sourceInstanceIds: narrowedSourceIds,
    skipTimingScopeStaleRemoval: true,
  });
}

/**
 * 継続効果の動的再評価 (P3-20 ギャップ B 対応)。
 *
 * `recomputeContinuousEffects` (duration / zone / target ベースの除去) に加えて、
 * 盤面状態変化による condition / applicability の再評価を行う。
 *
 * 1. 既登録 CE のうち、provenance を持ち、対応する元 effect が見つかるものについて
 *    condition + applicability を再評価し、満たさなくなった CE を除去する。
 * 2. フィールド/ミラージュ/バースト上のカードを走査し、未登録の continuous effect で
 *    condition + applicability + no_duplicate を満たすものを `executeEffect` で再登録する。
 *
 * 想定呼び出しタイミング: SBA 直後・誘発効果解決直後 (effect-resolution / trigger-system /
 * effect-interpreter `after_triggers`)。バトル進行中でも安全に呼べるよう、
 * `rebuildContinuousEffectsFromField` の安全チェックはバイパスする。
 *
 * 通常の continuous 効果は `while_on_field` / `permanent` duration を使うため、
 * 再登録時の `createdAtTurn` / `createdAtAttackId` 値による期限ずれは生じない。
 */
export function recomputeAndRebuildContinuousEffects(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  let current = recordDynamicEffectSuppressionTargetHistory(
    state,
    getCardDefinitionById
  );
  current = recomputeContinuousEffects(current, getCardDefinitionById);

  // --- 登録パス: 未登録だが condition を満たすようになった CE を再登録 ---
  current = rebuildContinuousEffectsFromField(current, getCardDefinitionById, {
    unsafeAllowDuringBattle: true,
    skipNewFieldEffectsFromPendingLeave: true,
  });
  return finalizeContinuousEffectRebuild(
    removeStateInvalidBattleEntityMembersAndRecompute(
      current,
      getCardDefinitionById
    ),
    getCardDefinitionById
  );
}

function continuousEffectDependsOnBattleState(
  effect: NonNullable<CardDefinition["effects"]>[number]
): boolean {
  const dependsOnBattleState = (condition: Condition): boolean =>
    condition.some((clause) =>
      clause.kind === "any_of"
        ? clause.groups.some(dependsOnBattleState)
        : clause.kind === "in_battle" ||
          clause.kind === "completed_battle_count" ||
          (clause.kind === "attack_occurred" &&
            clause.currentBattleOrdinal !== undefined) ||
          ((clause.kind === "field_has" || clause.kind === "self_state") &&
            clause.battleState !== undefined)
    );
  return (
    effect.timing.kind === "continuous" &&
    dependsOnBattleState(effect.condition ?? [])
  );
}

/**
 * 攻撃/ブロック宣言確定で battleState が変わった直後にだけ使う限定再評価。
 * 通常の full rebuild をここで走らせると、シナリオが意図的に未登録にしている
 * battleState 非依存 CE まで登録してしまうため、battleState 条件を持つ continuous に絞る。
 */
export function recomputeAndRebuildBattleStateContinuousEffects(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  let current = recordDynamicEffectSuppressionTargetHistory(
    state,
    getCardDefinitionById
  );
  current = recomputeContinuousEffects(current, getCardDefinitionById);

  const removed: ContinuousEffect[] = [];
  const stillActive: ContinuousEffect[] = [];
  for (const ce of current.activeContinuousEffects) {
    if (
      continuousEffectInstanceDependsOnBattleState(
        current,
        ce,
        getCardDefinitionById
      ) &&
      !isContinuousEffectStillValid(current, ce, getCardDefinitionById)
    ) {
      removed.push(ce);
    } else {
      stillActive.push(ce);
    }
  }

  if (removed.length > 0) {
    current = {
      ...current,
      activeContinuousEffects: stillActive,
      log: [
        ...current.log,
        ...removed.map(
          (ce) =>
            `continuous-effect:battle-state-unmet:${ce.effectId}:${ce.modifierTag}`
        ),
      ],
    };
  }

  for (const card of state.cardInstances) {
    const isExtraZoneCard = EXTRA_APPLICABILITY_ZONES.has(card.zone);
    if (!REBUILD_ZONES.has(card.zone) && !isExtraZoneCard) continue;
    if (card.zone === "field" && card.faceDown) continue;
    if (card.zone === "field" && card.pendingLeaveKind !== null) continue;

    const def = getCardDefinitionById(card.definitionId);
    if (!def) continue;

    for (const entry of continuousEffectSourceEntries({
      state: current,
      card,
      definition: def,
      getCardDefinitionById,
    })) {
      if (shouldSkipNewExternalContinuousEffectSource(current, entry, true)) {
        continue;
      }

      const effects = entry.effectSourceDefinition.effects ?? [];
      for (let effectIndex = 0; effectIndex < effects.length; effectIndex++) {
        const effect = effects[effectIndex]!;
        if (effect.timing.kind !== "continuous") continue;
        if (
          !canRegisterContinuousEffectFromSetZone(
            current,
            effect,
            entry.sourceCard
          )
        ) {
          continue;
        }
        if (isNativeTextRoleUnderHeaderEffect(entry, effect)) {
          continue;
        }
        if (
          entry.effectSourceInstanceId === undefined &&
          isAdventSourceUnderCard(current, entry.sourceCard) &&
          !continuousEffectCanApplyFromAdventSource(effect)
        ) {
          continue;
        }
        if (
          entry.effectSourceInstanceId === undefined &&
          isQuartzSetTextEffect(entry.effectSourceDefinition, effect) &&
          isQuartzInstanceInheritedByActiveHost(
            current,
            entry.sourceCard.instanceId,
            getCardDefinitionById
          )
        ) {
          continue;
        }
        if (
          entry.effectSourceInstanceId !== undefined &&
          !isExternalContinuousSourceHeaderEffect(
            entry.effectSourceDefinition,
            effect
          )
        ) {
          continue;
        }
        if (entry.effectSourceInstanceId !== undefined) {
          const requiredRoleTag = requiredTextRoleUnderRoleTagForEffect(
            entry.effectSourceDefinition,
            effect
          );
          if (
            requiredRoleTag !== undefined &&
            !underCardRoleTagsEqual(entry.effectSourceRoleTag, requiredRoleTag)
          ) {
            continue;
          }
        }
        if (entry.effectSourceInstanceId !== undefined && effect.stub) {
          continue;
        }
        if (!continuousEffectDependsOnBattleState(effect)) continue;
        if (
          isExtraZoneCard &&
          !canRegisterContinuousEffectFromExtraZone(effect, card.zone)
        )
          continue;

        const tagsFromEffect = inferModifierTagsFromEffect(effect);
        if (
          isContinuousEffectSuppressed({
            state: current,
            sourceCard: entry.sourceCard,
            sourceDefinition: entry.sourceDefinition,
            effectSourceDefinition: entry.effectSourceDefinition,
            effect,
            effectIndex,
            candidateModifierTags: tagsFromEffect,
            getCardDefinitionById,
          })
        ) {
          continue;
        }
        if (
          isAlreadyRegistered(
            current,
            entry.sourceCard.instanceId,
            entry.effectSourceDefinition.cardNo,
            effectIndex,
            tagsFromEffect,
            effect.timingScope,
            entry.effectSourceInstanceId !== undefined ||
              entry.effectSourceDefinitionId !== undefined
              ? {
                  ...(entry.effectSourceInstanceId !== undefined
                    ? { effectSourceInstanceId: entry.effectSourceInstanceId }
                    : {}),
                  ...(entry.effectSourceDefinitionId !== undefined
                    ? {
                        effectSourceDefinitionId:
                          entry.effectSourceDefinitionId,
                      }
                    : {}),
                }
              : undefined
          )
        ) {
          continue;
        }

        current = executeEffect({
          state: current,
          effect,
          effectIndex,
          chainId: `continuous:${entry.sourceCard.instanceId}:${effectIndex}`,
          sourceInstanceId: entry.sourceCard.instanceId,
          actingPlayerId: entry.sourceCard.controllerPlayerId,
          getCardDefinitionById,
          ...(entry.effectSourceInstanceId !== undefined
            ? { effectSourceInstanceId: entry.effectSourceInstanceId }
            : {}),
          ...(entry.effectSourceDefinitionId !== undefined
            ? { effectSourceDefinitionId: entry.effectSourceDefinitionId }
            : {}),
          getRegisteredTriggeredEffectActions: () => [],
        });
      }
    }
  }

  // 下カード等から取得した常時効果にも、宣言/終了による戦闘条件の変化を反映する。
  current = materializeGrantedEffects(
    current,
    getCardDefinitionById,
    executeEffect
  );
  return finalizeContinuousEffectRebuild(current, getCardDefinitionById);
}

function continuousEffectInstanceDependsOnBattleState(
  state: GameState,
  ce: ContinuousEffect,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  if (!ce.provenance) return false;
  if (ce.modifierTag === "retrigger") return false;

  const resolved = resolveContinuousProvenanceEffect({
    state,
    ce,
    getCardDefinitionById,
  });
  return (
    resolved !== null && continuousEffectDependsOnBattleState(resolved.effect)
  );
}

function timingScopeEquals(
  a: TimingScope | undefined,
  b: TimingScope | undefined
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.player === b.player && a.period === b.period && a.subPhase === b.subPhase
  );
}

const selfExcludedStateCache = new WeakMap<
  readonly ContinuousEffect[],
  Map<string, ContinuousEffect[]>
>();

function stateWithoutContinuousEffect(
  state: GameState,
  effectId: string
): GameState {
  let byEffectId = selfExcludedStateCache.get(state.activeContinuousEffects);
  if (!byEffectId) {
    byEffectId = new Map();
    selfExcludedStateCache.set(state.activeContinuousEffects, byEffectId);
  }
  let activeContinuousEffects = byEffectId.get(effectId);
  if (!activeContinuousEffects) {
    activeContinuousEffects = state.activeContinuousEffects.filter(
      (active) => active.effectId !== effectId
    );
    byEffectId.set(effectId, activeContinuousEffects);
  }
  if (activeContinuousEffects.length === state.activeContinuousEffects.length) {
    return state;
  }
  return {
    ...state,
    activeContinuousEffects,
  };
}

function isNativeContinuousEffectFaceStale(
  state: GameState,
  ce: ContinuousEffect,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  if (!ce.provenance) return false;
  if (hasExternalContinuousEffectSource(ce)) return false;
  const sourceCard = getCardById(state, ce.sourceInstanceId);
  if (!sourceCard) return false;
  if (sourceCard.definitionId === ce.sourceDefinitionId) return false;
  const sourceDefinition = getCardDefinitionById(ce.sourceDefinitionId);
  const effect = resolveDefinitionEffect(
    sourceDefinition,
    ce.provenance.effectIndex,
    ce.provenance.definitionPath
  );
  return effect?.timing.kind === "continuous";
}

/**
 * 既登録 CE が現在の盤面状態でも condition / applicability を満たすか判定する。
 * provenance を持たない CE / retrigger CE は対象外 (常に true)。
 * 定義外の合成効果は期間指定に従う。元定義が判明する常時効果は発揮元も要求する。
 */
export function isContinuousEffectStillValid(
  state: GameState,
  ce: ContinuousEffect,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  if (!ce.provenance) return true;
  if (ce.provenance.definitionPath === null) return true;
  if (ce.modifierTag === "retrigger") return true;
  const provenanceEffect = resolveProvenanceEffectForTiming({
    state,
    ce,
    getCardDefinitionById,
  });
  // Activated / triggered effects can create turn/battle scoped CEs. Their
  // activation conditions are already paid and must not become CE upkeep gates.
  if (provenanceEffect && provenanceEffect.timing.kind !== "continuous") {
    return true;
  }
  // 転醒などで見えている面が変わった場合、発揮時の面に印字された自己 continuous は
  // 期間指定効果ではないため引き継がない。turn/battle 等の activated CE は直上で保持済み。
  if (isNativeContinuousEffectFaceStale(state, ce, getCardDefinitionById)) {
    return false;
  }

  const resolved = resolveContinuousProvenanceEffect({
    state,
    ce,
    getCardDefinitionById,
  });
  if (!resolved) {
    return (
      provenanceEffect?.timing.kind !== "continuous" &&
      !hasExternalContinuousEffectSource(ce)
    );
  }
  const {
    sourceCard,
    sourceDefinition,
    effectSourceDefinition,
    effect,
    effectIndex,
  } = resolved;
  const action = effect.steps[ce.provenance.stepIndex]?.action;
  if (
    action?.kind === "treat_as" &&
    ce.targetInstanceId !==
      resolveTreatAsTargetInstanceId(state, action, sourceCard.instanceId)
  ) {
    return false;
  }
  if (
    !hasExternalContinuousEffectSource(ce) &&
    isTextRoleUnderTextEffect(effectSourceDefinition, effect)
  ) {
    return false;
  }
  if (!timingScopeEquals(ce.timingScope, effect.timingScope)) {
    return false;
  }
  if (!canRegisterContinuousEffectFromSetZone(state, effect, sourceCard)) {
    return false;
  }

  // 登録時と同じ発揮源資格を保持時にも使う。duration や CE 種別に
  // 発揮ゾーンを再定義しない（煌臨元・手札等でも同じ評価器へ進む）。
  if (!isContinuousEffectSourceZone(sourceCard.zone)) return false;
  if (
    EXTRA_APPLICABILITY_ZONES.has(sourceCard.zone) &&
    !canRegisterContinuousEffectFromExtraZone(effect, sourceCard.zone)
  )
    return false;
  if (
    !hasExternalContinuousEffectSource(ce) &&
    isAdventSourceUnderCard(state, sourceCard) &&
    !continuousEffectCanApplyFromAdventSource(effect)
  )
    return false;
  // P3-69: ソースがフィールドで裏向きになったら、その印字由来 CE は失効させる。
  // (付与 identity の CE は付与元カード=表向き由来なのでここでは除去されない)
  if (sourceCard.zone === "field" && sourceCard.faceDown) return false;

  if (
    isContinuousEffectSuppressed({
      state,
      sourceCard,
      sourceDefinition,
      effectSourceDefinition,
      effect,
      effectIndex,
      candidateModifierTags: new Set([ce.modifierTag]),
      getCardDefinitionById,
    })
  ) {
    return false;
  }

  // 自身の CE が与えた実効値で、自身の成立条件/適用条件を満たしたり壊したりしない。
  // 例: 「導シンボルがないとき、このスピリットに導シンボルを追加する」は、
  // 登録済み symbol_addition CE を含めて field_lacks(guide) を見ると自壊して再登録を繰り返す。
  const selfExcludedState = stateWithoutContinuousEffect(state, ce.effectId);

  if (effect.applicability) {
    if (
      !evaluateApplicability(
        selfExcludedState,
        effect.applicability,
        sourceCard.instanceId,
        getCardDefinitionById
      )
    ) {
      return false;
    }
  }

  if (effect.condition && effect.condition.length > 0) {
    if (
      !evaluateCondition(
        selfExcludedState,
        effect.condition,
        sourceCard.instanceId,
        ce.actingPlayerId,
        getCardDefinitionById
      )
    ) {
      return false;
    }
  }

  return true;
}
