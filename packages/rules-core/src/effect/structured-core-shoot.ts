// Core-shoot クラスタ (P2-12): structured-effect-interpreter.ts から抽出。
// コアシュート候補解析とその補助関数。

import {
  getCombinedUnitSymbolCount,
  getCombinedUnitBp,
  getEffectiveLevel,
} from "../battle/battle-shared";
import {
  matchesCardFilter,
  type MatchCardFilterOptions,
} from "../card/card-filter";
import { getTotalCoresOnCardById } from "../core/core-system";
import {
  hasEnterFieldOnlyCorePlacementRestriction,
  hasIndependentCoreManagement,
} from "../model";
import {
  getCardDefinitionForEffectiveFieldCard,
  getCombinedUnitCostFilterOptions,
  getEffectiveColors,
  getEffectiveTribes,
} from "../legal/legal-actions-shared";
import type {
  CardDefinition,
  CardInstance,
  EffectCoreLocation,
  EffectPlayerRef,
  GameState,
} from "../model";
import { resolveCardImmunityAffect } from "./effect-affect-adapter";
import { getCoreMinimumProtectedByResistance } from "./effect-resistance-check";
import { getEffectiveSoulStateIds } from "../mechanics/magic-compatible-soul-state";
import type {
  CoreShootCandidate,
  PendingCoreShoot,
} from "./structured-effect-interpreter";
import {
  applyCardTargetAcquisitionGate,
  effectSourceContext,
  resolveLocationPlayer,
  resolvePlayerRef,
} from "./structured-effect-interpreter";
import type { TargetLockBypassProfile } from "./target-affect-gate";

/** フィールド/リザーブ横断コア除去のリザーブ擬似候補 instanceId。 */
export function reserveCoreShootSentinelId(playerId: string): string {
  return `reserve:${playerId}`;
}

/** instanceId がリザーブ擬似候補 sentinel なら所属 playerId を返す。 */
export function parseReserveCoreShootSentinelId(
  instanceId: string
): string | null {
  return instanceId.startsWith("reserve:")
    ? instanceId.slice("reserve:".length)
    : null;
}

/** Field/reserve source identifier for the player's soul core. */
export function getCoreShootSoulSourceId(
  player: GameState["players"][number] | undefined
): string | undefined {
  const location = player?.soulCoreLocation;
  return location?.kind === "card"
    ? location.instanceId
    : location?.kind === "reserve" && player
      ? reserveCoreShootSentinelId(player.id)
      : undefined;
}

/**
 * coreshoot (from:field) で「ソウル可」と判定する行き先 (analyzeCoreShootCandidates の
 * 候補に soul 載りカードを含めるか / 自動 fallback で soul を掴むか / pending 適用時に soul を
 * 移すか) の SSOT 述語。soulCoreLocationForZone (本ファイル後段) が generic な soul 行き先と
 * して認める kind を一本化された正源とし、本関数はその真偽射影。
 * 10_rules/06 §41-42・§54・§71 (2026-06-09 検証で「ライフ generic 不可」を撤回):
 *   ライフ / リザーブ / トラッシュは generic 可。ボイドのみ硬制約 (常に不可)。
 *   創界神 / 創界石は generic では不可、explicit 指定 ([ソウルコア]…) でのみ可で、
 *   coreshoot 経路 (本関数の利用先) には到達しない設計。
 *   field / field_card / card_instance (= 特定カード上) は soulCoreLocation:{kind:"card"}
 *   への配置を候補として認める (ENGINE-coreshoot-soul-destination-include-field-card)。
 *   実際に置ける単一カードを解決できるかは呼び出し側 (resolveCoreShootCardDestinationId)
 *   が別途判定し、cross-player destination では ENGINE-core-move-soul-cross-player-
 *   destination option (b) の fromPlayerId===toPlayerId 同一プレイヤー制約が適用される
 *   (呼び出し元 analyzeCoreShootCandidates の soulCardId 判定に既存配線済)。
 */
export function coreShootSoulDestinationAllowed(toKind: string): boolean {
  if (
    toKind === "field" ||
    toKind === "field_card" ||
    toKind === "card_instance"
  ) {
    return true;
  }
  return genericSoulDestination(toKind) !== null;
}

/**
 * generic な「soul の行き先」一覧の SSOT。10_rules/06 §41-42 §54 §71 で generic 可と
 * 明示されている kind のみ non-null を返す。ボイド (常に不可) は null。
 * field / field_card / card_instance (= 特定カード上) は `destinationCardInstanceId` が
 * 解決済みのときのみ `{kind:"card", instanceId}` を返す (未解決なら null、専用経路
 * resolveCoreShootCardDestinationId が単一候補時のみ解決する)。
 * 旧 `soulCoreLocationForZone(default→reserve)` の pre-existing 互換 fallback は本関数では
 * 排除し、coreShootSoulDestinationAllowed と完全同期させる。
 */
export function genericSoulDestination(
  toKind: string,
  destinationCardInstanceId?: string
): import("../model").PlayerScopedSoulCoreLocation | null {
  switch (toKind) {
    case "reserve":
      return { kind: "reserve" };
    case "trash":
      return { kind: "trash" };
    case "life":
      return { kind: "life" };
    case "field":
    case "field_card":
    case "card_instance":
      return destinationCardInstanceId
        ? { kind: "card", instanceId: destinationCardInstanceId }
        : null;
    default:
      return null;
  }
}

/**
 * コアシュートの対象カードを `from.filter` (CardFilter) で限定する述語。
 * SSOT: 対象限定は `matchesCardFilter` 一本に委譲し、battleState/maxCost/category/
 * maxCores 等を target-resolution と同一規約で評価する。opts は本ファイル L583 の
 * 共有パターン（battleEntities + 場のカード向け effectiveColors/effectiveBp/coreCount）
 * に揃える。`filter` 未指定なら常に true（従来挙動：controller/zone のみ）。
 */
export function coreShootCardMatchesFilter(
  state: GameState,
  card: CardInstance,
  filter: import("../dsl-types").CardFilter | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  filterOptions: FieldCoreSourceFilterOptions = {}
): boolean {
  if (!filter) return true;
  const def = getCardDefinitionById
    ? getCardDefinitionForEffectiveFieldCard(card, getCardDefinitionById, {
        state,
        filter,
      })
    : undefined;
  if (!def) return false;
  return matchesCardFilter(card, def, filter, {
    ...filterOptions,
    state,
    battleEntities: state.battleEntities,
    // 魂状態カードは「魂状態を含む」opt-in が無い限り対象外 (card-filter.ts の既定除外)。
    // opts に soulStateIds を渡さないと当該ブロックが丸ごと skip されるため必須。
    ...(getCardDefinitionById
      ? { soulStateIds: getEffectiveSoulStateIds(state, getCardDefinitionById) }
      : {}),
    fieldCategoryContext: true,
    ...(getCardDefinitionById ? { getCardDefinitionById } : {}),
    effectiveColors: getEffectiveColors(state, card, def),
    effectiveTribes: getEffectiveTribes(
      state,
      card,
      def,
      getCardDefinitionById
    ),
    ...getCombinedUnitCostFilterOptions(
      state,
      card,
      def,
      getCardDefinitionById
    ),
    effectiveBp:
      card.zone === "field"
        ? getCombinedUnitBp(state, card, def, getCardDefinitionById)
        : undefined,
    coreCount:
      card.zone === "field"
        ? getTotalCoresOnCardById(state, card.instanceId)
        : undefined,
    effectiveLevel:
      card.zone === "field"
        ? getEffectiveLevel(state, card, def, getCardDefinitionById)
        : undefined,
    effectiveSymbolCount:
      card.zone === "field"
        ? getCombinedUnitSymbolCount(state, card, def, getCardDefinitionById)
        : undefined,
  });
}

function isCoreShootPlacementRestrictedDestination(
  card: CardInstance,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): boolean {
  const def = getCardDefinitionById?.(card.definitionId);
  return !!def && hasEnterFieldOnlyCorePlacementRestriction(def);
}

export function resolveFieldCoreSourceMinRemaining(
  state: GameState,
  card: CardInstance,
  from: Extract<EffectCoreLocation, { kind: "field" }>,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  filterOptions: FieldCoreSourceFilterOptions = {}
): number {
  let minRemaining = Math.max(0, from.minRemainingPerCandidate ?? 0);
  for (const rule of from.minRemainingPerCandidateByFilter ?? []) {
    if (
      coreShootCardMatchesFilter(
        state,
        card,
        rule.filter,
        getCardDefinitionById,
        filterOptions
      )
    ) {
      minRemaining = Math.max(0, minRemaining, rule.minRemaining);
    }
  }
  return minRemaining;
}

export type FieldCoreSourceFilterOptions = Pick<
  MatchCardFilterOptions,
  "evaluateCondition" | "evaluateApplicability"
>;

export interface FieldCoreSourceOptions {
  /** 「コアをN個残す」効果側の下限 (`from.minRemainingPerCandidate`)。 */
  minRemaining?: number;
  /**
   * このカードに物理的に載っているソウルコア数 (コア最低残存数の総数に算入)。
   * ソウルコアは将来的に複数個化しうるため boolean ではなく個数で受ける
   * (P3-101。`soulCoreCount` が 2 のカードを 1 に丸めると保護下限の計算がずれる)。
   */
  soulCoresOnCard?: number;
  /** そのうち行き先へ実際に動かせる個数 (取れる数に算入)。 */
  soulCoresMovable?: number;
  sourcePreventionLevel?: import("../model").EffectPreventionLevel;
  /** 発生源スコープ付き「相手の効果を受けない」照合用。 */
  effectSource?: { instance?: CardInstance; definition?: CardDefinition };
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
  sourcePreventionBypass?: TargetLockBypassProfile;
  /** 対象限定 CardFilter。`{}` を渡すと「含む」opt-in 無しの既定除外だけが効く。 */
  filter?: import("../dsl-types").CardFilter | undefined;
  /** CardFilter.hasCardEventEffect 等の条件付き印字効果フィルタ評価用。 */
  filterOptions?: FieldCoreSourceFilterOptions | undefined;
  /** 対象ロック CE (`cannot_be_targeted`/`cannot_include`) 照合用の発揮元 instanceId。 */
  sourceInstanceId?: string | undefined;
  /** 対象ロック貫通プロファイル。 */
  sourceTargetLockBypass?: TargetLockBypassProfile | undefined;
}

/**
 * **フィールドカードからコアを取れる数** の SSOT。コア移動元候補を列挙する経路は
 * 必ずこの関数を通す (0 なら候補にしない、正なら `available` としてそのまま使う)。
 *
 * 判定は5層。いずれも「コアを動かす効果」である限り、どの from.kind か・どの
 * ギミック経由かを問わず一律に適用する:
 * 1. **独立コア管理** (`canMoveCoresFrom`): 創界神/導界者/創界石ネクサスのコアは
 *    汎用コア移動の対象外。ただし `filter.targetsGrandwalker`/`targetsGrandstone` で
 *    **明示的に**それらを狙った効果は例外 (escape hatch)。
 * 2. **対象ロック** (`applyCardTargetAcquisitionGate` → `cannot_be_targeted` /
 *    `cannot_include`): 「コア奪取＝コアのある場所を対象にする効果」であり、コアのある
 *    場所がカードならそれは**カード対象**なので、対象にされない耐性が効く
 *    (10_rules/03d 人称判定、ユーザー確認 2026-08-02)。
 * 3. **効果免疫** (`resolveCardImmunityAffect`): 「相手の効果を受けない」カードからは取れない。
 * 4. **対象限定** (`coreShootCardMatchesFilter` → `matchesCardFilter`): CardFilter による
 *    絞り込み。`{}` (opt-in 無し) でも魂状態等の**既定除外**が効く。
 * 5. **コア最低残存数耐性** (`getCoreMinimumProtectedByResistance`): 「コアがN個より
 *    少なくならない」を差し引いた残りだけが取れる。
 *
 * **この関数を経由せず候補列挙を自作しないこと。** 発揮前提コア除去ゲート
 * (`gate_flash_stack_core`, pay-to-act-core-gate.ts) は当初これを通さず
 * `normalCoreCount > 0` だけで候補を組んでいたため、免疫もコア最低残存数耐性も一切
 * 効かないまま長期未検知だった (同じ「コア除去」規則の並行実装が別々に育った SSOT
 * ドリフトの実例)。コア移動を伴う新規ギミックも同様にここへ合流させる。
 */
export function getFieldCoreSourceTakeableCount(
  state: GameState,
  card: CardInstance,
  actingPlayerId: string,
  options: FieldCoreSourceOptions = {}
): number {
  const {
    minRemaining = 0,
    soulCoresOnCard = 0,
    soulCoresMovable = 0,
    sourcePreventionLevel = "none",
    effectSource,
    getCardDefinitionById,
    sourcePreventionBypass,
    filter,
    filterOptions,
    sourceInstanceId,
    sourceTargetLockBypass,
  } = options;
  if (card.zone !== "field") return 0;

  // 1. 独立コア管理 (創界神/導界者/創界石)。明示指定 filter は escape hatch。
  //    定義未解決時は判定不能のため skip する (def なしテスト状態の従来挙動を保つ)。
  //    `canMoveCoresFrom` ではなく `hasIndependentCoreManagement` を直接見る:
  //    前者はコア保有チェック (`isSoulCoreOn` = card.soulCoreCount) も含むが、
  //    コアシュート経路のソウルコアは player.soulCoreLocation で追跡されるため
  //    soul-only スピリットを誤って除外してしまう (soul の二重表現、P3-101)。
  //    コア保有数は下記 5. の totalCores/movableCores 側で正しく数える。
  const definition = getCardDefinitionById?.(card.definitionId);
  const explicitlyTargetsIndependentCore =
    filter?.targetsGrandwalker !== undefined ||
    filter?.targetsGrandstone === true;
  if (
    definition !== undefined &&
    !explicitlyTargetsIndependentCore &&
    hasIndependentCoreManagement(definition)
  ) {
    return 0;
  }

  // 2. 対象ロック (cannot_be_targeted / cannot_include)。
  if (
    applyCardTargetAcquisitionGate(
      state,
      [card],
      effectSourceContext(
        actingPlayerId,
        sourceInstanceId,
        sourcePreventionLevel,
        sourceTargetLockBypass
      ),
      "auto",
      getCardDefinitionById ?? (() => undefined)
    ).length !== 1
  ) {
    return 0;
  }

  // 3. 効果免疫。
  if (
    resolveCardImmunityAffect(
      state,
      card,
      actingPlayerId,
      sourcePreventionLevel,
      effectSource,
      getCardDefinitionById,
      sourcePreventionBypass
    ).kind !== "allowed"
  ) {
    return 0;
  }

  // 4. CardFilter 対象限定。
  if (
    !coreShootCardMatchesFilter(
      state,
      card,
      filter,
      getCardDefinitionById,
      filterOptions
    )
  ) {
    return 0;
  }

  // 5. コア最低残存数耐性。保護は「カード上の全コア」から引き、取れる数は
  //    「実際に動かせるコア」で頭打ちにする。
  const totalCores = card.normalCoreCount + Math.max(0, soulCoresOnCard);
  const movableCores = card.normalCoreCount + Math.max(0, soulCoresMovable);
  const protectedMinimum = Math.max(
    minRemaining,
    getCoreMinimumProtectedByResistance(
      state,
      card,
      actingPlayerId,
      getCardDefinitionById,
      sourcePreventionLevel,
      sourcePreventionBypass
    )
  );
  return Math.max(0, Math.min(movableCores, totalCores - protectedMinimum));
}

/**
 * coreshoot (from:field) の移動先が field/field_card/card_instance のとき、コアを実際に
 * 置く単一カードの instanceId を解決する。card_instance は既に解決済みなのでそのまま返す。
 * field/field_card は toPlayerId 配下のフィールドカードを `to.filter` (field_card のみ) で
 * 絞り込み、候補がちょうど1枚のときだけ auto-resolve する。0枚 or 複数枚のときは undefined
 * (行き先選択 pending は未実装。ENGINE-coreshoot-soul-destination-include-field-card 残
 * スコープとして park。呼び出し側は undefined のとき既存の partial-impl fallback に委ねる)。
 * フィルタ判定は coreShootCardMatchesFilter に委譲し SSOT を保つ。
 * target-lock CE (applyCardTargetAcquisitionGate) は from.kind==="field_card" のソース側
 * 候補解決 (本ファイル後段 L3506 付近) と同じゲートを destination 候補にも適用する
 * (verifier 2026-07-02 round 1 lens 4 指摘: target-lock されたカードが唯一の残存候補として
 * 誤って auto-resolve されるのを防ぐ)。
 */
export function resolveCoreShootCardDestinationId(
  state: GameState,
  to: EffectCoreLocation,
  toPlayerId: string,
  actingPlayerId: string,
  sourceInstanceId: string | undefined,
  sourcePreventionLevel: import("../model").EffectPreventionLevel | undefined,
  sourceTargetLockBypass: TargetLockBypassProfile | undefined,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): string | undefined {
  if (to.kind === "card_instance") {
    const destinationCard = state.cardInstances.find(
      (c) => c.instanceId === to.instanceId
    );
    return destinationCard &&
      isCoreShootPlacementRestrictedDestination(
        destinationCard,
        getCardDefinitionById
      )
      ? undefined
      : to.instanceId;
  }
  if (to.kind !== "field" && to.kind !== "field_card") return undefined;
  const destFilter = to.kind === "field_card" ? to.filter : undefined;
  const candidatesBeforeGates = state.cardInstances.filter(
    (c) =>
      c.controllerPlayerId === toPlayerId &&
      c.zone === "field" &&
      c.pendingLeaveKind === null &&
      !isCoreShootPlacementRestrictedDestination(c, getCardDefinitionById) &&
      coreShootCardMatchesFilter(state, c, destFilter, getCardDefinitionById)
  );
  const candidates = applyCardTargetAcquisitionGate(
    state,
    candidatesBeforeGates,
    effectSourceContext(
      actingPlayerId,
      sourceInstanceId,
      sourcePreventionLevel,
      sourceTargetLockBypass
    ),
    "auto",
    getCardDefinitionById ?? (() => undefined)
  );
  return candidates.length === 1 ? candidates[0]!.instanceId : undefined;
}

export function analyzeCoreShootCandidates(
  state: GameState,
  actingPlayerId: string,
  from: EffectCoreLocation,
  to: EffectCoreLocation,
  amount: number,
  sourcePreventionLevel: import("../model").EffectPreventionLevel = "none",
  /** P3-88: 「N個まで」最低取得数。amount 未満なら under-selection (0〜amount のプレイヤー選択)。 */
  minTotal?: number,
  /** CardFilter (battleState/maxCost/category 等) 評価に必要。filter 指定時は必須。 */
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  /** 発生源スコープ付き「相手の効果を受けない」照合用の発生源カード（実効値照合のため instance も渡す）。 */
  effectSource?: { instance?: CardInstance; definition?: CardDefinition },
  /**
   * to.kind が field/field_card のとき destination 候補へ target-lock CE ゲート
   * (applyCardTargetAcquisitionGate) を適用するための発生源情報。
   * resolveCoreShootCardDestinationId へそのまま委譲する。
   */
  sourceInstanceId?: string,
  sourceTargetLockBypass?: TargetLockBypassProfile,
  sourcePreventionBypass?: TargetLockBypassProfile,
  baseAmount = amount
): PendingCoreShoot | null {
  if (from.kind !== "field") return null;
  const filter = from.filter;
  const fromPlayerId = resolvePlayerRef(
    actingPlayerId,
    (from as { player: EffectPlayerRef }).player,
    state
  );
  const toPlayerId = resolveLocationPlayer(actingPlayerId, to, state);
  // destination を先に解決し、from 側 source 候補プールから除外する (verifier 2026-07-02
  // round 2 lens 3 指摘: 同一カードが source かつ destination になったとき take と
  // movedTotal 加算が相殺され、コアが一切動かない silent no-op になる自己参照バグを防ぐ)。
  // soulCoreLocation は数値カウントではなく代入で扱うため destination と source が
  // 一致しても正しく no-op になる (別バグではない、対象外)。
  const toCardInstanceId = resolveCoreShootCardDestinationId(
    state,
    to,
    toPlayerId,
    actingPlayerId,
    sourceInstanceId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    getCardDefinitionById
  );
  // fromPlayer のソウルコアがフィールドカード上にあり、かつ移動先がソウルコア可なら
  // そのスピリットも候補に含め、ソウルコア1個分を掴める扱いにする。
  // cross-player destination (fromPlayerId !== toPlayerId) では soul ownership 移転が
  // 未モデル化 (per-player soulCoreLocation) のため soul 候補から除外する
  // (ENGINE-core-move-soul-cross-player-destination option b)。
  const fromPlayer = state.players.find((p) => p.id === fromPlayerId);
  const soulCardId =
    coreShootSoulDestinationAllowed(to.kind) &&
    fromPlayerId === toPlayerId &&
    fromPlayer?.soulCoreLocation?.kind === "card"
      ? fromPlayer.soulCoreLocation.instanceId
      : undefined;
  // 独立コア管理 / 対象ロック / 免疫 / CardFilter / コア最低残存数耐性 をまとめた SSOT
  // (getFieldCoreSourceTakeableCount)。候補列挙も availableCores も同じ値を使う。
  // soulCardId は「行き先が soul 可 かつ 同一プレイヤー」まで解決済みなので、
  // 物理所在 (soulCoreOnCard) と移動可否 (soulCoreMovable) の両方に同じ値を渡す。
  const takeableCoreCount = (c: CardInstance) =>
    getFieldCoreSourceTakeableCount(state, c, actingPlayerId, {
      minRemaining: resolveFieldCoreSourceMinRemaining(
        state,
        c,
        from,
        getCardDefinitionById
      ),
      soulCoresOnCard: c.instanceId === soulCardId ? 1 : 0,
      soulCoresMovable: c.instanceId === soulCardId ? 1 : 0,
      sourcePreventionLevel,
      ...(effectSource ? { effectSource } : {}),
      getCardDefinitionById,
      ...(sourcePreventionBypass ? { sourcePreventionBypass } : {}),
      filter,
      sourceInstanceId,
      sourceTargetLockBypass,
    });
  const fieldCards = state.cardInstances.filter(
    (c) =>
      c.controllerPlayerId === fromPlayerId &&
      c.zone === "field" &&
      // destination カード自身は通常コアの source 候補から除外 (自己参照 no-op 防止、
      // 上記コメント参照)。
      c.instanceId !== toCardInstanceId &&
      (c.normalCoreCount > 0 || c.instanceId === soulCardId) &&
      // 残数下限・免疫・CardFilter を通って取れるコアが残るカードのみ
      // （BSTH04-転醒R02(B) 他）。
      takeableCoreCount(c) > 0
  );
  // フィールド/リザーブ横断（BSTH001-X01）: リザーブ通常コアも擬似候補に含める。
  // 移動先がボイド等ソウルコア不可ゾーンなら soul は対象外なので通常コアのみ数える。
  // sentinel instanceId で表し、apply 側がリザーブコア減算として扱う。
  // ソウルコア分は primary ポインタ判定を維持する (adversarial verifier round2:
  // apply 側 (effect-target-handlers.ts の reserveTaken 消費) が reserveNormalCoreCount
  // しか減算せず reserveSoulCoreCount/ポインタ側を一切更新しないため、count ベース化すると
  // 追加ソウル分が「無から生成」される conservation 違反になる。primary ポインタ限定なら
  // 元の挙動 (pre-existing、本 primitive の範囲外) を変えない)。
  const reserveTakeable =
    from.includeReserve === true
      ? (fromPlayer?.reserveNormalCoreCount ?? 0) +
        (coreShootSoulDestinationAllowed(to.kind) &&
        fromPlayerId === toPlayerId &&
        fromPlayer?.soulCoreLocation?.kind === "reserve"
          ? 1
          : 0)
      : 0;
  const reserveCandidate: CoreShootCandidate | null =
    from.includeReserve === true && reserveTakeable > 0
      ? {
          instanceId: reserveCoreShootSentinelId(fromPlayerId),
          definitionId: "reserve",
          availableCores: reserveTakeable,
          isReserve: true,
        }
      : null;
  const totalAvailable =
    fieldCards.reduce((sum, c) => sum + takeableCoreCount(c), 0) +
    reserveTakeable;
  // 候補が0なら自動解決（何も取れない）。
  if (fieldCards.length === 0 && reserveCandidate === null) return null;
  // P3-88: under-selection（minTotal < amount = 「まで」）なら候補1つ・少数でも
  // プレイヤーに 0〜amount を選ばせるため pending を生成する。
  // exact（minTotal 省略 or = amount）は従来どおり候補≤1 / 合計≤amount で自動解決。
  const candidateCount = fieldCards.length + (reserveCandidate ? 1 : 0);
  const underSelection = minTotal !== undefined && minTotal < amount;
  if (
    !from.eachZone &&
    !underSelection &&
    (candidateCount <= 1 || totalAvailable <= amount)
  ) {
    return null;
  }

  const fieldAvailable = totalAvailable - reserveTakeable;
  const sourceGroupMinimums = from.eachZone
    ? [
        {
          instanceIds: fieldCards.map((c) => c.instanceId),
          min: Math.min(baseAmount, fieldAvailable),
        },
        ...(from.includeReserve
          ? [
              {
                instanceIds: [reserveCoreShootSentinelId(fromPlayerId)],
                min: Math.min(baseAmount, reserveTakeable),
              },
            ]
          : []),
      ]
    : undefined;
  const cappedTotal = Math.min(
    totalAvailable,
    sourceGroupMinimums
      ? sourceGroupMinimums.reduce((sum, g) => sum + g.min, 0) +
          Math.max(0, amount - baseAmount)
      : amount
  );
  const fieldCandidates: CoreShootCandidate[] = fieldCards.map((c) => ({
    instanceId: c.instanceId,
    definitionId: c.definitionId,
    // availableCores は「取れるコア数」(残数下限を反映)。apply 側の per-candidate
    // 検証 (amount > available) がそのまま残数下限ガードとして機能する。
    availableCores: takeableCoreCount(c),
  }));
  return {
    candidates: reserveCandidate
      ? [...fieldCandidates, reserveCandidate]
      : fieldCandidates,
    totalAmount: cappedTotal,
    ...(sourceGroupMinimums ? { sourceGroupMinimums } : {}),
    ...(minTotal !== undefined
      ? { minTotal: Math.min(minTotal, cappedTotal) }
      : {}),
    toKind: to.kind,
    toPlayerId,
    ...(toCardInstanceId !== undefined ? { toCardInstanceId } : {}),
  };
}
