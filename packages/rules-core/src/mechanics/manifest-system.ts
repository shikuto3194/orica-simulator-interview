/**
 * 顕現システム。
 * 公式エターナル版キーワード効果「顕現」(battlespirits.com ルールマニュアル §特殊な効果):
 * 手札のカードを、自分のソウルコア(トラッシュへ)+対象で指定されたネクサスのコア1個を
 * 召喚コストとして支払う(合計支払いはこの1個のみ)ことで手札から召喚する。
 * 煌臨(advent)とは異なり、フィールドカードへの重ねではなく通常の場入りを行う召喚の一種。
 * 「召喚時」効果はそのまま発火する（advent_source アンダーカード無しの場入りは
 * trigger-system.ts の enterFieldEventKind 分岐が自動的に "summon" と判定するため、
 * card_event:["summon", ...] 側の追加配線は不要）。
 */
import type {
  ActiveStack,
  CardDefinition,
  CardInstance,
  GameState,
  ManifestData,
} from "../model";
import { collectUnderCardScopeIds } from "../model";
import { collectAndQueueTriggerReactions } from "../effect/trigger-system";
import { buildChargeCoresPendingCoreDistribution } from "./core-charge-distribution";
import type { DeferredStackResolverOptions } from "../legal/stack-resolution-types";
import { getCardById } from "../card/card-lookup";
import { matchesCardFilter } from "../card/card-filter";
import { getDefaultZoneRoleName } from "../factories";
import { getTotalCoresOnCardById, moveCardZone } from "../core/core-system";
import { isInHandForOwnEffect } from "../effect/card-access-rules";
import { applyCardCostPayments } from "../core/payment-system";
import { consumeSoulCore, hasSoulCoreAvailable } from "./advent-system";
import { getEffectiveLevel } from "../battle/battle-shared";
import { evaluateCondition } from "../effect/structured-condition-eval";
import { isCardUseRestricted } from "../legal/legal-actions-shared";

/**
 * フィールドカードが顕現の対象条件 (ManifestData.targetFilter) を満たすか判定する。
 * AdventCondition のような専用評価器は持たず、CardFilter を matchesCardFilter で直接
 * 評価する (SSOT)。minCores 判定には場のカードのコア数注入が必要 (card-filter.ts SSOT)。
 */
export function matchesManifestCondition(
  state: GameState,
  targetCard: CardInstance,
  targetDef: CardDefinition,
  manifestData: ManifestData,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): boolean {
  const coreCount = getTotalCoresOnCardById(state, targetCard.instanceId);
  return matchesCardFilter(targetCard, targetDef, manifestData.targetFilter, {
    state,
    ...(getCardDefinitionById ? { getCardDefinitionById } : {}),
    underCardIds: collectUnderCardScopeIds(state),
    soulStateIds: new Set(
      state.players.flatMap((player) => player.soulStateInstanceIds)
    ),
    coreCount,
    effectiveLevel: getEffectiveLevel(
      state,
      targetCard,
      targetDef,
      getCardDefinitionById
    ),
  });
}

/**
 * 顕現可能なフィールドカードをリストアップする。
 * 対象は自分がコントロールする場のカードで manifestData.targetFilter に一致するもの。
 */
export function getManifestTargets(
  state: GameState,
  actingPlayerId: string,
  manifestData: ManifestData,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): CardInstance[] {
  return state.cardInstances.filter((card) => {
    if (card.zone !== "field") return false;
    if (card.controllerPlayerId !== actingPlayerId) return false;
    if (getTotalCoresOnCardById(state, card.instanceId) < 1) return false;
    const def = getCardDefinitionById(card.definitionId);
    if (!def) return false;
    return matchesManifestCondition(
      state,
      card,
      def,
      manifestData,
      getCardDefinitionById
    );
  });
}

export interface ManifestParams {
  /** 顕現するカード（手札）の instanceId */
  manifestCardInstanceId: string;
  /** 顕現対象（フィールドのネクサス）の instanceId */
  targetInstanceId: string;
  /** 顕現カードの ManifestData */
  manifestData: ManifestData;
}

/**
 * 顕現を実行する。
 *
 * 処理手順:
 * 1. 手札から公開 → 対象確認 (targetFilter 一致)
 * 2. ソウルコア消費（自分のライフ/フィールド/リザーブ → トラッシュ、代替コスト）
 * 3. 対象ネクサスのコア1個で召喚コストを1コスト支払う（合計支払いはこの1個のみ、行き先はtrash。
 *    創界神/導界者ネクサス上のコアは通常のコスト支払い原資にはならないが (payment-system.ts
 *    canMoveCoresFrom 除外)、顕現は「対象効果」として明示された例外経路なので
 *    getAvailableOnBoardCorePaymentSources を経由せず applyCardCostPayments を直接呼ぶ）
 * 4. 手札から場へ（通常召喚と同じ zoneRoleName、コア0個で場入り。以後の任意コア配置は
 *    deferred 解決側で buildChargeCoresPendingCoreDistribution を使う）
 * 5. 「召喚時」効果はトリガーシステムが before/after 差分から自動検出して発火する
 *
 * @returns 更新後の GameState。顕現不可能な場合は元の state を返す。
 */
export function executeManifest(
  state: GameState,
  actingPlayerId: string,
  params: ManifestParams,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const { manifestCardInstanceId, targetInstanceId, manifestData } = params;

  const manifestCard = getCardById(state, manifestCardInstanceId);
  if (!manifestCard) {
    state.log.push(`manifest:${manifestCardInstanceId}:card-not-found`);
    return state;
  }
  if (
    !isInHandForOwnEffect(
      state,
      manifestCard,
      actingPlayerId,
      getCardDefinitionById
    )
  ) {
    state.log.push(
      `manifest:${manifestCardInstanceId}:not-in-hand:${manifestCard.zone}`
    );
    return state;
  }

  const targetCard = getCardById(state, targetInstanceId);
  if (!targetCard || targetCard.zone !== "field") {
    state.log.push(`manifest:${manifestCardInstanceId}:target-not-on-field`);
    return state;
  }
  if (targetCard.controllerPlayerId !== actingPlayerId) {
    state.log.push(`manifest:${manifestCardInstanceId}:target-not-controlled`);
    return state;
  }

  const manifestDef = getCardDefinitionById(manifestCard.definitionId);
  const targetDef = getCardDefinitionById(targetCard.definitionId);
  if (!manifestDef || !targetDef) {
    state.log.push(`manifest:${manifestCardInstanceId}:definition-not-found`);
    return state;
  }

  if (
    !evaluateCondition(
      state,
      manifestData.condition ?? [],
      manifestCardInstanceId,
      actingPlayerId,
      getCardDefinitionById
    ) ||
    !matchesManifestCondition(
      state,
      targetCard,
      targetDef,
      manifestData,
      getCardDefinitionById
    )
  ) {
    state.log.push(`manifest:${manifestCardInstanceId}:condition-not-met`);
    return state;
  }

  if (!hasSoulCoreAvailable(state, actingPlayerId)) {
    state.log.push(`manifest:${manifestCardInstanceId}:no-soul-core`);
    return state;
  }

  if (
    isCardUseRestricted(
      state,
      actingPlayerId,
      manifestCard,
      manifestDef,
      getCardDefinitionById,
      "summon",
      { byEffect: true, effectiveCost: 1 }
    )
  ) {
    state.log.push(`manifest:${manifestCardInstanceId}:summon-restricted`);
    return state;
  }

  // --- ソウルコア消費（代替コスト） ---
  let newState = consumeSoulCore(
    state,
    actingPlayerId,
    manifestData.soulCoreDest,
    manifestCardInstanceId
  );

  // 対象のコアが1個未満だと支払えない (ソウルコア消費が対象上のソウルコアを消費した場合を
  // 含めて、支払い直前の newState で再確認する)。
  if (getTotalCoresOnCardById(newState, targetInstanceId) < 1) {
    newState.log.push(`manifest:${manifestCardInstanceId}:target-no-core`);
    return state;
  }

  // --- 対象ネクサスのコア1個で召喚コストを支払う（公式ルール: 支払いはこの1個のみ） ---
  newState = applyCardCostPayments({
    state: newState,
    actingPlayerId,
    chainId: `manifest:${manifestCardInstanceId}`,
    getCardDefinitionById,
    onBoardCoreSourceFilter: manifestData.targetFilter,
    paymentSources: [
      {
        kind: "card",
        instanceId: targetInstanceId,
        amount: 1,
        destination: "trash",
      },
    ],
  });

  // --- 手札から場へ（通常召喚と同じ zoneRoleName。moveCardZone が handCount を自動減算） ---
  newState = moveCardZone(
    newState,
    manifestCardInstanceId,
    "field",
    getDefaultZoneRoleName(manifestDef, "field")
  );

  newState.log.push(
    `manifest:${manifestCardInstanceId}:on-target:${targetInstanceId}` +
      `:soul_core_to:${manifestData.soulCoreDest}`
  );

  return newState;
}

/**
 * 顕現の deferred 解決（発揮宣言→スタック窓クローズ後、declare_advent と同型 P3-112 パターン）。
 * 顕現は「常時以外の効果発揮」につき発揮宣言でスタック窓を開き、ソウルコア消費・コスト支払い・
 * 場入りはいずれも効果文内につき窓クローズ後の deferred 解決で行う。
 *
 * executeManifest は公開→条件確認→ソウルコア消費→支払い→場入りを事前検証込みで実行するため、
 * 窓中に対象/条件（手札ゾーン・対象在席・条件一致・ソウルコア有無）が失われた場合は
 * 自然に不発（state 不変）になる。
 */
export function resolveDeferredManifestStack(
  state: GameState,
  resolvedStack: ActiveStack,
  options: DeferredStackResolverOptions
): GameState {
  if (resolvedStack.isNullified) return state;

  const sourceInstanceId = resolvedStack.cardInstanceId;
  const targetInstanceId = resolvedStack.targetInstanceIds[0];
  const actingPlayerId = resolvedStack.actingPlayerId;

  const manifestDef = options.getCardDefinitionById(
    resolvedStack.cardDefinitionId
  );
  if (!manifestDef?.manifestData || targetInstanceId === undefined) {
    return {
      ...state,
      log: [
        ...state.log,
        `[Manifest] 顕現データ不整合のため不発: ${sourceInstanceId}`,
      ],
    };
  }
  const manifestData = manifestDef.manifestData;

  const beforeState = state;
  const afterManifest = executeManifest(
    beforeState,
    actingPlayerId,
    {
      manifestCardInstanceId: sourceInstanceId,
      targetInstanceId,
      manifestData,
    },
    options.getCardDefinitionById
  );

  // executeManifest は事前検証失敗時に beforeState をそのまま返す（不発）。
  if (afterManifest === beforeState) return afterManifest;

  // 顕現時 / 召喚時 等の誘発を before/after 差分から検出してキューに積む。
  const stateWithTriggers = collectAndQueueTriggerReactions({
    beforeState,
    afterState: afterManifest,
    source: "action_resolution",
    chainId: resolvedStack.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedByPlayerId: actingPlayerId,
    causedBySourceInstanceId: sourceInstanceId,
  });

  // 顕現後、フィールド/リザーブのコアを好きなだけ顕現カードへ置ける
  // (公式ルール「通常召喚同様コアを自由配置」。BSAZ01 chargeCoresOnAdvent と同じ SSOT を流用)。
  if (stateWithTriggers.pendingCoreDistribution === null) {
    const chargePending = buildChargeCoresPendingCoreDistribution(
      stateWithTriggers,
      actingPlayerId,
      sourceInstanceId,
      resolvedStack.cardDefinitionId,
      options.getCardDefinitionById,
      "manifest-charge"
    );
    if (chargePending) {
      return { ...stateWithTriggers, pendingCoreDistribution: chargePending };
    }
  }

  return stateWithTriggers;
}
