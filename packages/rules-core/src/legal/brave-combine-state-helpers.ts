import { recordSemanticTriggerEvent } from "../effect/semantic-trigger-events";
/**
 * ブレイヴ合体/分離で盤面が変わったあとの状態再構築ヘルパ。
 * P3-100 鍵ブレイヴ実装で合体/分離ハンドラと pending 解決から共有する。
 * continuous effect 再構築と維持コア補填を legal ドメインに閉じて提供する
 * (main の play-card-resolution.ts ローカル版と同一ロジックの SSOT 化)。
 */
import type { CardDefinition, CardInstance, GameState } from "../model";
import { getCardById } from "../card/card-lookup";
import {
  isSoulCoreOn,
  moveCardZone,
  moveNormalCores,
  moveSoulCore,
  updateCard,
  updatePlayer,
} from "../core/core-system";
import { getDefaultZoneRoleName } from "../factories";
import { canMoveNormalCoresFrom } from "../core/core-movability";
import { recomputeAndRebuildContinuousEffects } from "../effect/continuous-effect-rebuild";
import { synthesizeBackFaceDefinition } from "../effect/structured-effect-registrations";
import { hasCannotCombineRestriction } from "../mechanics/act-as-spirit";
import { runStateBasedActions } from "../state-based-actions";
import { removeBattleEntityMembersAndRecompute } from "../battle/battle-shared";
import { isEligibleBraveCombineHost } from "./legal-actions-shared";

function resolveCardDefinitionForInstance(
  card: CardInstance | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): CardDefinition | undefined {
  if (!card) return undefined;
  const direct = getCardDefinitionById(card.definitionId);
  if (direct) return direct;
  const original = getCardDefinitionById(card.originalDefinitionId);
  if (!original?.backFace) return undefined;
  const backDef = synthesizeBackFaceDefinition(original, original.backFace);
  return backDef.cardNo === card.definitionId ? backDef : undefined;
}

/**
 * continuous effect 再構築 → SBA → 再構築 を盤面が安定するまで反復する。
 * 合体/分離で BP・シンボル・維持コアが変わり SBA が連鎖する場合に使う。
 */
export function rebuildContinuousAndApplyStateBasedActions(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  let current = state;
  let previousSignature: string | null = null;

  for (let pass = 0; pass < state.cardInstances.length + 2; pass++) {
    const rebuilt = recomputeAndRebuildContinuousEffects(
      current,
      getCardDefinitionById
    );
    const afterSba = runStateBasedActions(rebuilt, getCardDefinitionById).state;
    const next = recomputeAndRebuildContinuousEffects(
      afterSba,
      getCardDefinitionById
    );
    const signature = JSON.stringify({
      cards: next.cardInstances.map((card) => ({
        id: card.instanceId,
        zone: card.zone,
        attachedTo: card.attachedToInstanceId,
        children: card.attachedChildrenIds,
        normalCores: card.normalCoreCount,
        pendingLeaveKind: card.pendingLeaveKind,
        exhaustState: card.exhaustState,
      })),
      activeContinuousEffects: next.activeContinuousEffects.map((ce) => ({
        tag: ce.modifierTag,
        source: ce.sourceInstanceId,
        target: ce.targetInstanceId,
        metadata: ce.metadata,
      })),
      pendingLeaveEntities: next.pendingLeaveEntities.map((entry) => ({
        id: entry.instanceId,
        kind: entry.kind,
        chainId: entry.chainId,
      })),
    });
    if (signature === previousSignature) {
      return next;
    }
    previousSignature = signature;
    current = next;
  }

  return current;
}

export function moveBraveCombineCoresToHost(
  state: GameState,
  actingPlayerId: string,
  braveInstanceId: string,
  hostInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState | null {
  const braveCard = getCardById(state, braveInstanceId);
  if (!braveCard) return null;

  let current = state;
  const braveCores = braveCard.normalCoreCount;
  const braveSoul = isSoulCoreOn(state, braveInstanceId);

  if (braveCores > 0) {
    current = moveNormalCores(
      current,
      { kind: "card", instanceId: braveInstanceId },
      { kind: "card", instanceId: hostInstanceId },
      braveCores,
      getCardDefinitionById
    );
  }
  if (braveSoul) {
    current = moveSoulCore(
      current,
      actingPlayerId,
      { kind: "card", instanceId: braveInstanceId },
      { kind: "card", instanceId: hostInstanceId },
      1,
      getCardDefinitionById
    );
  }

  const afterBrave = getCardById(current, braveInstanceId);
  if (!afterBrave) return null;
  if (
    afterBrave.normalCoreCount > 0 ||
    isSoulCoreOn(current, braveInstanceId)
  ) {
    return null;
  }
  return current;
}

/**
 * ブレイヴ分離時の維持コア補填を reserve → フィールドのカード上の順で行う。
 * reserve で足りなければ、移動可能な自軍フィールドカード上のコアから補う。
 */
export function moveNormalCoresForBraveSeparation(
  state: GameState,
  actingPlayerId: string,
  braveId: string,
  needed: number,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  let current = state;
  let remaining = needed;
  const player = current.players.find((p) => p.id === actingPlayerId);
  const fromReserve = Math.min(remaining, player?.reserveNormalCoreCount ?? 0);
  if (fromReserve > 0) {
    current = moveNormalCores(
      current,
      { kind: "reserve", playerId: actingPlayerId },
      { kind: "card", instanceId: braveId },
      fromReserve,
      getCardDefinitionById
    );
    remaining -= fromReserve;
  }

  for (const source of current.cardInstances) {
    if (remaining <= 0) break;
    if (source.zone !== "field") continue;
    if (source.controllerPlayerId !== actingPlayerId) continue;
    if (source.instanceId === braveId) continue;
    if (source.normalCoreCount <= 0) continue;
    const sourceDefinition = getCardDefinitionById(source.definitionId);
    if (!canMoveNormalCoresFrom(current, source, sourceDefinition)) continue;
    const moved = Math.min(remaining, source.normalCoreCount);
    current = moveNormalCores(
      current,
      { kind: "card", instanceId: source.instanceId },
      { kind: "card", instanceId: braveId },
      moved,
      getCardDefinitionById
    );
    remaining -= moved;
  }

  if (remaining > 0) {
    throw new Error(
      `Not enough cores to separate brave: brave=${braveId} needed=${needed} remaining=${remaining}`
    );
  }

  return current;
}

/**
 * ブレイヴをホストへ直接合体させる中核処理（コア移動 + attach + 疲労合流 + CE 再構築）。
 * main フェーズの player action `brave_combine`（legal-actions-apply.ts）と、効果ステップ内
 * 合体 `brave_combine_effect`（ENGINE-bsft01-tr-rebirth-brave-combine-branch,
 * native-action-registry.ts）の両方が呼ぶ SSOT。ログ行のフォーマットは呼び出し側の文脈
 * （プレイヤー操作 / 効果解決）で意味が異なるため、ログ push は呼び出し側の責務のまま残す。
 */
export function executeBraveCombine(
  state: GameState,
  actingPlayerId: string,
  braveInstanceId: string,
  targetInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const braveCard = getCardById(state, braveInstanceId);
  const hostCard = getCardById(state, targetInstanceId);
  const braveDef = resolveCardDefinitionForInstance(
    braveCard,
    getCardDefinitionById
  );
  const hostDef = resolveCardDefinitionForInstance(
    hostCard,
    getCardDefinitionById
  );
  if (!braveCard || !hostCard || !braveDef || !hostDef) {
    return state;
  }
  if (hasCannotCombineRestriction(state, braveInstanceId, braveDef)) {
    return state;
  }
  if (
    hostCard.pendingLeaveKind !== null ||
    !isEligibleBraveCombineHost({
      state,
      host: hostCard,
      hostDefinition: hostDef,
      incomingBraveCondition: braveDef.braveCondition,
      incomingBrave: braveCard,
      incomingBraveDef: braveDef,
      getCardDefinitionById,
    })
  ) {
    return state;
  }
  const combinedExhausted =
    braveCard?.exhaustState !== undefined &&
    braveCard.exhaustState !== "recovered"
      ? true
      : hostCard?.exhaustState !== undefined &&
        hostCard.exhaustState !== "recovered";

  let combinedState = moveBraveCombineCoresToHost(
    state,
    actingPlayerId,
    braveInstanceId,
    targetInstanceId,
    getCardDefinitionById
  );
  if (combinedState === null) return state;

  combinedState = moveCardZone(
    combinedState,
    braveInstanceId,
    "field",
    getDefaultZoneRoleName(braveDef, "field")
  );
  // 既に他ホストへ合体済みのブレイヴを別ホストへ強制的に再合体させる語法
  // (BSES01-T01 forced-token 等、通常の分離を経ない直接付け替え)。旧ホストの
  // attachedChildrenIds を解除しないと、同じブレイヴが2ホストの attachedChildrenIds に
  // 同時出現する二重参照が残る (P3-138 再現テストで実測)。10_rules/05
  // 「分離」節どおり、旧ホストへ移動済みのコアはクローバックしない (分離後のブレイヴは
  // 新規にコア補填される前提と同じ扱い)。
  const previousHostId = braveCard.attachedToInstanceId;
  if (previousHostId !== null && previousHostId !== targetInstanceId) {
    combinedState = updateCard(combinedState, previousHostId, (c) => ({
      ...c,
      attachedChildrenIds: c.attachedChildrenIds.filter(
        (id) => id !== braveInstanceId
      ),
    }));
  }
  combinedState = updateCard(combinedState, braveInstanceId, (c) => ({
    ...c,
    attachedToInstanceId: targetInstanceId,
  }));
  combinedState = updateCard(combinedState, targetInstanceId, (c) => ({
    ...c,
    attachedChildrenIds: [...c.attachedChildrenIds, braveInstanceId],
    exhaustState: combinedExhausted ? "exhausted" : c.exhaustState,
  }));

  // 魂状態のカードを合体元にする語法 (BSAZ01-CX01 等, engine-brave-combine-soul-state-source)。
  // 合体後のブレイヴは attachedToInstanceId 経由でホストの一部として扱われ、独立した
  // 「魂状態」の対象ではなくなる。soulStateInstanceIds に残したままだと getAvailableLinkAidLegalActions /
  // getAvailableContractCombineLegalActions の魂状態フィルタ (attachedToInstanceId 非考慮) が
  // 合体済みブレイヴを誤って魂状態カードとして拾い続けるため、contract-combine-system.ts の
  // 魂状態ホスト離脱処理と同型にここでクリアする。攻撃合体済みブレイヴは
  // state-based-actions.ts のコア欠損消滅判定対象外 (attachedToInstanceId !== null で除外) のため
  // コア充填 (chargeCores) は不要。
  const braveOwnerInSoulState = combinedState.players.find((p) =>
    p.soulStateInstanceIds.includes(braveInstanceId)
  );
  if (braveOwnerInSoulState) {
    combinedState = updatePlayer(
      combinedState,
      braveOwnerInSoulState.id,
      (p) => ({
        ...p,
        soulStateInstanceIds: p.soulStateInstanceIds.filter(
          (id) => id !== braveInstanceId
        ),
      })
    );
  }

  // A spirit-state brave can already own an idle battle entity. Once it
  // becomes attached, that entity must no longer retain the brave: the host
  // entity will derive the attached brave through recomputeBattleEntityBp.
  // Leaving the old entity in place makes the same card a member of both
  // entities after the host attacks (EDH-0005-00-state-invariant).
  combinedState = removeBattleEntityMembersAndRecompute(
    combinedState,
    [braveInstanceId],
    getCardDefinitionById
  );

  return rebuildContinuousAndApplyStateBasedActions(
    previousHostId === targetInstanceId
      ? combinedState
      : recordSemanticTriggerEvent(combinedState, {
          eventKind: "brave_combined",
          relatedInstanceId: braveInstanceId,
          triggerRelatedCombinedHostInstanceId: targetInstanceId,
        }),
    getCardDefinitionById
  );
}

/**
 * 異魔神ブレイヴ（`imaginBraveData` 保有、10_rules/08c §7）を右合体スロットで
 * 第2ホストへ合体させる。左合体スロット（`executeBraveCombine` による既存の汎用
 * 単一合体、`attachedToInstanceId`/host 側 `attachedChildrenIds`）はそのまま維持し、
 * `CardInstance.imaginRightCombinedWith` にのみ第2ホストを記録する（右ホスト側の
 * `attachedChildrenIds` へは意図的に追加しない。P3-16 多重合体の相互整合性 invariant
 * と衝突させないための非対称設計）。
 *
 * 呼び出し時点でブレイヴのコアは通常すでに第1合体時に左ホストへ移動済みのため、
 * ここでのコア移動・疲労合流は行わない。シンボル個別加算・片方離脱時のクリンナップ・
 * 「疲労しない」特記ルールは未配線（engine-imagin-brave-dual-combine スコープ外、
 * 後続 cluster）。legal-actions-availability.ts の `getAvailableBraveCombineLegalActions`
 * が候補を列挙し、legal-actions-apply.ts の `brave_combine` ハンドラが
 * ブレイヴが既に左合体済み (`attachedToInstanceId !== null`) の場合にこちらへ分岐する。
 */
export function executeImaginBraveSecondCombine(
  state: GameState,
  braveInstanceId: string,
  targetInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const combinedState = updateCard(state, braveInstanceId, (c) => ({
    ...c,
    imaginRightCombinedWith: targetInstanceId,
  }));

  return rebuildContinuousAndApplyStateBasedActions(
    getCardById(state, braveInstanceId)?.imaginRightCombinedWith ===
      targetInstanceId
      ? combinedState
      : recordSemanticTriggerEvent(combinedState, {
          eventKind: "brave_combined",
          relatedInstanceId: braveInstanceId,
          triggerRelatedCombinedHostInstanceId: targetInstanceId,
        }),
    getCardDefinitionById
  );
}
