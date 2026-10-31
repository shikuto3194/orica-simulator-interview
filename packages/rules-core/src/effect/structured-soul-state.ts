import { replaceCardInstances } from "../zone/card-instance-state";
import { advanceSoulStateGeneration } from "./effect-usage-lifecycle";
import { resetCardBattleStatus } from "../card/card-state-reset";
// Soul-state クラスタ (P2-12): structured-effect-interpreter.ts から抽出。
// スピリットのソウル化 (enter soul state) 実行。

import { moveCardZone, withSoulCoreLocation } from "../core/core-system";
import type { CardDefinition, EffectTarget, GameState } from "../model";
import {
  resolvePlayerRef,
  resolveTargetCards,
} from "./structured-effect-interpreter";
import type { TargetLockBypassProfile } from "./target-affect-gate";

export function executeEnterSoulState(
  state: GameState,
  actingPlayerId: string,
  action: { target: EffectTarget },
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  preSelectedIds?: string[],
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile
): GameState {
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  // self 対象は zone 非依存で解決する。ENIGMA「手札/手元にあるこのカードは…魂状態に
  // できる」のように field 外（手札/手元）から魂状態化する契約カードを許容するため
  // (collectTargetCardCandidates の selfCard は field 必須で手札カードを取れない)。
  const targets =
    action.target.selfCard && sourceInstanceId
      ? state.cardInstances.filter(
          (c) =>
            c.instanceId === sourceInstanceId && c.pendingLeaveKind === null
        )
      : resolveTargetCards(
          state,
          targetPlayerId,
          action.target,
          getCardDefinitionById,
          sourceInstanceId ?? "dsl-unknown",
          preSelectedIds,
          actingPlayerId,
          sourcePreventionLevel,
          sourceTargetLockBypass,
          true
        );
  if (targets.length === 0) return state;

  const enterIds = targets.map((c) => c.instanceId);
  const enterIdSet = new Set(enterIds);

  // field 外（手札/手元）のカードは field へ移動してから魂状態化する。role は印字
  // カテゴリ（ENIGMA=brave）。handCount 等の調整は moveCardZone が行う。
  let working = state;
  for (const t of targets) {
    if (t.zone !== "field") {
      const role = getCardDefinitionById(t.definitionId)?.printedCategory;
      working = moveCardZone(working, t.instanceId, "field", role);
    }
  }

  let totalCoresReturned = 0;

  // 魂状態化: コアをリザーブに移動し、魂状態リストに追加
  const updatedCards = working.cardInstances.map((c) => {
    if (!enterIdSet.has(c.instanceId)) return c;
    totalCoresReturned += c.normalCoreCount;
    // 魂状態に疲労状態は存在しない。スピリットへ戻る際にも引き継がせない。
    return { ...resetCardBattleStatus(c), normalCoreCount: 0 };
  });

  // 魂状態化対象カードに乗っていたソウルコアは reserve に戻す
  const soulCoreDisplacedOwnerIds = new Set(
    working.players
      .filter(
        (p) =>
          p.soulCoreLocation?.kind === "card" &&
          enterIdSet.has(p.soulCoreLocation.instanceId)
      )
      .map((p) => p.id)
  );

  working.log.push(`effect:enter_soul_state:${enterIds.join(",")}`);

  const result = replaceCardInstances(
    {
      ...working,
      players: working.players.map((p) => {
        if (p.id !== targetPlayerId) return p;
        const newSoulIds = [
          ...p.soulStateInstanceIds,
          ...enterIds.filter((id) => !p.soulStateInstanceIds.includes(id)),
        ];
        return {
          ...p,
          soulStateInstanceIds: newSoulIds,
          reserveNormalCoreCount: p.reserveNormalCoreCount + totalCoresReturned,
        };
      }),
    },
    updatedCards
  );
  return Array.from(soulCoreDisplacedOwnerIds).reduce(
    (acc, ownerId) => withSoulCoreLocation(acc, ownerId, { kind: "reserve" }),
    advanceSoulStateGeneration(state, result, getCardDefinitionById)
  );
}
