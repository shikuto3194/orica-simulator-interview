/**
 * ENGINE-target-count-expand-modifier: expand_effect_target_count CE 消費側。
 *
 * 「自分が[sourceFilter]の効果で相手の[targetFilter]を対象にするとき、[bonusAmount]する」
 * (BSLH01-TR02(A)【クォーツ：範囲】) を検知し bonus を加算する。
 *
 * 実行時 (候補プールが手に入る) 消費: `getExpandEffectTargetCountBonus`
 * - native-target-resolution.ts の applyActionTargetCount。resolveTargets() (destroy/
 *   bp_modify 等、標準アクションの対象解決) が実際の対象数を確定する唯一の chokepoint
 *   (resolveTargets は filter-kind target を常に returnFullPool:true で resolveTargetSpec
 *   に渡すため、target-resolution.ts 側の resolveCount 分岐には到達しない — Step2 時点は
 *   この事実を見落としており、標準アクション経由では bonus が一切適用されていなかった。
 *   ENGINE-target-count-expand-modifier iteration3 で発見・修正)。
 * - target-resolution.ts resolveTargetSpec の count 解決部 (auto-resolve 経路)。CE 登録
 *   ハンドラ等、resolveTargets を経由せず resolveTargetSpec を直接呼ぶ限定的な経路向け。
 * - target-resolution.ts resolveTargetSpec の preSelectedIds 分岐 (Step4、手動選択の実行時
 *   確定)。選択数自体は GUI 側で既に確定しているため戻り値の bonus は使わないが、
 *   usageLimit の消費予約 push (副作用) のためだけに同じ関数を呼ぶ (auto-resolve 経路と
 *   同じ「評価したら1回消費」の意味論を manual 経路にも揃える)。
 *
 * GUI 候補数上限 (実行前、候補プールがまだ確定できない) 見積り: `getExpandEffectTargetCountBonusDeclarative`
 * - legal-actions-availability.ts の getResolvedMaxTargetCount と
 *   legal/stack-target-resolution.ts の getStackTargetSelection (Step4)。
 *   `RegisteredTargetedEffectActionBase.targetCardFilter`/`candidateTargetPlayerScope`
 *   (登録時に確定済みの宣言的フィルタ) だけを使い、実候補列挙 (getCandidateTargetInstanceIds、
 *   呼び出し元ごとに引数が異なり 7+ call site に及ぶため候補プールをここで再現するのは
 *   非現実的) を経由せず楽観的な上限を返す。カテゴリ/player方向が「重なりうる」なら bonus を
 *   加算する (未指定側は無制限扱い＝常に overlap)。実際の対象数は実行時の
 *   getExpandEffectTargetCountBonus (候補プースベース) が最終判定する SSOT であり、
 *   本関数は GUI が「+1 選択できる」ことを示すための上限見積り専用 (usageLimit 消費はしない、
 *   読み取りゲートのみ)。
 *
 * usageLimit は canUseEffectByUsageLimit で読み取り専用ゲートを行い、実際の消費記録
 * (recordEffectUsageIfLimited) は真の実行確定時にのみ行う。呼び出し元から渡された
 * `stepContext.pendingExpandTargetCountUsage` (side-channel、step-execution-context.ts)
 * へ消費予約を push し、effect-interpreter.ts の step ループが native action 実行完了
 * 直後に drain して記録する。
 * resolveTargetSpec/resolveTargets の呼び出し元を全数調査した結果 (iteration3 研究)、
 * count 解決に到達する呼び出しは全て実行系路 (native-*-handlers.ts の実効果解決) であり、
 * legal-action 列挙等の speculative 経路は returnFullPool:true を使うため到達しない
 * (二重消費の懸念は無い)。stepContext を都度新規生成する一部の CE 登録ハンドラ経路は
 * drain されないため push しても消費記録に至らないが、読み取り専用ゲートと同じ挙動の
 * まま (regression なし)。
 * `targetPlayer` (player 方向、"相手の"/"自分の"/無指定) は targetFilter (カード種別)
 * とは独立した軸として candidatePool の controller と actingPlayerId を比較して判定する
 * (adversarial verifier 2026-07-20 round1 で「自分対象効果にも bonus が漏れる」scope leak
 * を検出、修正)。
 */
import {
  matchesCardReferenceFilter,
  matchesCardFilterByDef,
} from "../card/card-filter";
import { canUseEffectByUsageLimit } from "../legal/legal-actions-shared";
import type {
  CardDefinition,
  CardInstance,
  EffectUsageLimit,
  GameState,
} from "../model";
import type { CardFilter, PlayerRef } from "../dsl-types";
import type { StepExecutionContext } from "../step-execution-context";

/** register_expand_effect_target_count CE の metadata 構造。 */
export interface ExpandEffectTargetCountMetadata {
  sourceFilter: CardFilter;
  targetFilter: CardFilter;
  /** 拡張対象になる TargetSpec 自体の player 方向 ("相手の"/"自分の"/無指定)。 */
  targetPlayer: PlayerRef;
  bonusAmount: number;
  usageLimit?: EffectUsageLimit;
}

/**
 * 指定 CE の metadata を取り出す。kind が一致しない/未設定なら undefined。
 */
function getExpandEffectTargetCountMetadata(
  metadata: unknown
): ExpandEffectTargetCountMetadata | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const m = metadata as Record<string, unknown>;
  if (!m.sourceFilter || !m.targetFilter || !m.targetPlayer) return undefined;
  return metadata as unknown as ExpandEffectTargetCountMetadata;
}

/**
 * 現在解決中の効果 (sourceInstanceId / actingPlayerId) と、確定済み候補プール
 * (matchesCardFilter 済みの pool) に対して有効な expand_effect_target_count CE の
 * bonus 合計を返す。マッチしなければ 0。
 *
 * 判定 (裁定不要・原文の構文どおり):
 * 1. CE.targetInstanceId === actingPlayerId (「自分が」= CE 登録者と今解決中の効果の
 *    発動者が一致)。
 * 2. sourceFilter が発動元カード定義 (sourceInstanceId) に一致 (「[sourceFilter]の効果で」)。
 * 3. targetFilter が候補プールの少なくとも1体に一致 (「相手の[targetFilter]を対象にする
 *    とき」— 対象種別が一致する効果かどうかの判定)、かつその候補の controllerPlayerId が
 *    meta.targetPlayer ("opponent"/"self") の方向と一致する (「相手の」/「自分の」の
 *    player 方向。呼び出し元の TargetSpec.player だけでは pool の controller までは
 *    保証されないため、ここで candidatePool の controllerPlayerId を直接検査する)。
 * 4. usageLimit があれば canUseEffectByUsageLimit で読み取り専用ゲート
 *    (「ターンにN回」)。`stepContext` が渡された場合、ゲート通過分の消費予約を
 *    `stepContext.pendingExpandTargetCountUsage` へ push する (Step3、実際の記録は
 *    effect-interpreter.ts の step ループが drain して行う)。
 */
export function getExpandEffectTargetCountBonus(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  candidatePool: readonly CardInstance[];
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /** Step3: 渡された場合のみ usageLimit 消費予約を push する (省略時は Step2 同様 読み取り専用)。 */
  stepContext?: StepExecutionContext;
}): number {
  const {
    state,
    actingPlayerId,
    sourceInstanceId,
    candidatePool,
    getCardDefinitionById,
    stepContext,
  } = options;
  if (candidatePool.length === 0) return 0;

  const sourceCard = state.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  const sourceDef = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  if (!sourceDef) return 0; // フェイルクローズ (redirect_effect_target と同方針)

  let bonus = 0;
  for (const ce of state.activeContinuousEffects) {
    if (ce.modifierTag !== "expand_effect_target_count") continue;
    if (ce.targetInstanceId !== actingPlayerId) continue;
    const meta = getExpandEffectTargetCountMetadata(ce.metadata);
    if (!meta) continue;

    if (!matchesCardFilterByDef(sourceDef, meta.sourceFilter)) continue;

    const targetMatches = candidatePool.some((card) => {
      if (
        meta.targetPlayer === "opponent" &&
        card.controllerPlayerId === actingPlayerId
      )
        return false;
      if (
        meta.targetPlayer === "self" &&
        card.controllerPlayerId !== actingPlayerId
      )
        return false;
      const def = getCardDefinitionById(card.definitionId);
      if (!def) return false;
      // 元の効果が選べる候補プールを参照して枚数補正を判定する。
      return matchesCardReferenceFilter(card, def, meta.targetFilter);
    });
    if (!targetMatches) continue;

    if (
      meta.usageLimit &&
      !canUseEffectByUsageLimit({
        sourceEffect: getCardDefinitionById(ce.sourceDefinitionId)?.effects?.[
          ce.provenance?.effectIndex ?? -1
        ],
        state,
        sourceInstanceId: ce.sourceInstanceId,
        sourceDefinitionId: ce.sourceDefinitionId,
        getCardDefinitionById,
        effectLabel: "expand_effect_target_count",
        usageLimit: meta.usageLimit,
      })
    ) {
      continue;
    }

    bonus += meta.bonusAmount;
    if (meta.usageLimit && stepContext) {
      const pending = stepContext.pendingExpandTargetCountUsage ?? [];
      if (!pending.some((p) => p.effectId === ce.effectId)) {
        stepContext.pendingExpandTargetCountUsage = [
          ...pending,
          {
            effectId: ce.effectId,
            sourceInstanceId: ce.sourceInstanceId,
            sourceDefinitionId: ce.sourceDefinitionId,
            usageLimit: meta.usageLimit,
          },
        ];
      }
    }
  }
  return bonus;
}

/**
 * `getResolvedMaxTargetCount`/`getStackTargetSelection` (Step4、GUI 候補数上限) が使う
 * 登録済み action の宣言的フィルタ部分集合。実インスタンスに依存しない。
 */
export interface ExpandEffectTargetCountRegistrationLike {
  targetCardFilter?: CardFilter;
  candidateTargetPlayerScope?: "any" | "acting_player" | "opponent";
}

/** 未指定側は無制限（常に overlap しうる）として楽観的に判定する。 */
function categoryFiltersCouldOverlap(
  metaCategory: CardFilter["category"],
  registrationCategory: CardFilter["category"]
): boolean {
  if (!metaCategory || !registrationCategory) return true;
  return metaCategory.some((category) =>
    registrationCategory.includes(category)
  );
}

/** scope 未確定 ("any"/undefined) は楽観的に一致扱い。 */
function targetPlayerScopeCouldMatch(
  scope: "any" | "acting_player" | "opponent" | undefined,
  targetPlayer: PlayerRef
): boolean {
  if (scope === undefined || scope === "any") return true;
  if (scope === "opponent") return targetPlayer !== "self";
  return targetPlayer !== "opponent"; // "acting_player"
}

/**
 * 実候補プールを使わない楽観的上限見積り版 (Step4)。GUI 候補数上限算出専用。
 * 実際の対象数決定は `getExpandEffectTargetCountBonus` (候補プースベース) が SSOT。
 * usageLimit は読み取りゲートのみ行い消費は記録しない (実消費は実行時の
 * `getExpandEffectTargetCountBonus` 呼び出しに委ねる)。
 */
export function getExpandEffectTargetCountBonusDeclarative(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  registration: ExpandEffectTargetCountRegistrationLike;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): number {
  const {
    state,
    actingPlayerId,
    sourceInstanceId,
    registration,
    getCardDefinitionById,
  } = options;

  const sourceCard = state.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  const sourceDef = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  if (!sourceDef) return 0;

  let bonus = 0;
  for (const ce of state.activeContinuousEffects) {
    if (ce.modifierTag !== "expand_effect_target_count") continue;
    if (ce.targetInstanceId !== actingPlayerId) continue;
    const meta = getExpandEffectTargetCountMetadata(ce.metadata);
    if (!meta) continue;

    if (!matchesCardFilterByDef(sourceDef, meta.sourceFilter)) continue;
    if (
      !categoryFiltersCouldOverlap(
        meta.targetFilter.category,
        registration.targetCardFilter?.category
      )
    )
      continue;
    if (
      !targetPlayerScopeCouldMatch(
        registration.candidateTargetPlayerScope,
        meta.targetPlayer
      )
    )
      continue;

    if (
      meta.usageLimit &&
      !canUseEffectByUsageLimit({
        sourceEffect: getCardDefinitionById(ce.sourceDefinitionId)?.effects?.[
          ce.provenance?.effectIndex ?? -1
        ],
        state,
        sourceInstanceId: ce.sourceInstanceId,
        sourceDefinitionId: ce.sourceDefinitionId,
        getCardDefinitionById,
        effectLabel: "expand_effect_target_count",
        usageLimit: meta.usageLimit,
      })
    ) {
      continue;
    }

    bonus += meta.bonusAmount;
  }
  return bonus;
}
