// engine-aldnoah-drive-under-card-keyword: 汎用 text_role アンダーカード配置。
// place_star_garment/bullet_edit と同型の直接状態変更だが、host (下に置かれる側) は
// 発動元カード自身ではなく `hostTarget` で別途解決する非対称パターン (【アルドノアドライブ】等
// 「自分の他カードが召喚/配置/転醒したとき、手札/フィールドのこのカードをそのカードの下に
// 置ける」型の第三者観測トリガー)。親ローカル依存ゼロの leaf handler のため一方向 import
// (親 → 本モジュール) で barrel/振る舞い不変。

import { replaceCardInstances } from "../zone/card-instance-state";
import { getCardById } from "../card/card-lookup";
import { matchesCardName } from "../card/card-filter";
import { matchesHostCardFilter } from "./native-action-shared";
import {
  getEffectiveUnderCardSlotCap,
  hasOpenTextRoleUnderCardSlot,
} from "../mechanics/star-garment-utils";
import { resolveTargetSpec } from "./target-resolution";
import type { CardDefinition, GameState } from "../model";
import type { DSL } from "../dsl-types";
import type { StepExecutionContext } from "../step-execution-context";

/**
 * `hostTarget` で解決した host の下 (text_role アンダーカード、`action.roleTag`) へ、
 * 発動元カード自身 (sourceInstanceId、手札/フィールドいずれか) を表向きで置く。
 * host 側の枠上限は host 定義の `underCardSlots`（roleTag 一致の maxCount）を優先し、
 * 宣言が無ければ `action.fallbackMaxCount`（省略時1）にフォールバックする。
 */
export function executePlaceTextRoleUnderCard(
  action: DSL.PlaceTextRoleUnderCardAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  stepCtx: StepExecutionContext
): GameState {
  const hostCandidates = resolveTargetSpec({
    targetSpec: action.hostTarget,
    state,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById,
    stepContext: stepCtx,
  });
  const host = hostCandidates[0];
  if (!host || host.zone !== "field") {
    state.log.push(
      `effect:place_text_role_under_card:${sourceInstanceId}:host-not-resolved`
    );
    return state;
  }

  const hostDef = getCardDefinitionById(host.definitionId);
  const effectiveCap = hostDef
    ? getEffectiveUnderCardSlotCap(
        state,
        host,
        hostDef,
        action.roleTag,
        getCardDefinitionById
      )
    : undefined;
  const maxCount = effectiveCap ?? action.fallbackMaxCount ?? 1;
  if (
    !hasOpenTextRoleUnderCardSlot(
      host,
      action.roleTag,
      maxCount,
      state,
      getCardDefinitionById
    )
  ) {
    state.log.push(
      `effect:place_text_role_under_card:${host.instanceId}:slot-full:${action.roleTag}`
    );
    return state;
  }

  let placedId: string;
  let oldHostInstanceId: string | undefined;
  if (action.moveFrom === "self_under_card") {
    const sourceCard = getCardById(state, sourceInstanceId);
    const existingEntry = sourceCard?.underCards.find(
      (uc) => uc.role === "text_role" && uc.roleTag === action.roleTag
    );
    if (!sourceCard || !existingEntry) {
      state.log.push(
        `effect:place_text_role_under_card:${sourceInstanceId}:no-existing-under-card:${action.roleTag}`
      );
      return state;
    }
    placedId = existingEntry.cardInstanceId;
    oldHostInstanceId = sourceCard.instanceId;
  } else if (action.moveFrom === "trash_by_card_name") {
    // トラッシュのプレイヤー帰属は ownerPlayerId が SSOT (structured-zone-ops.ts)。
    // controllerPlayerId はフィールド上のコントロール移転を保持したまま zone だけ trash に
    // 変わる経路があるため使えない。「自分の」の基準点も host 側の代理値ではなく、関数へ
    // 明示的に渡されている actingPlayerId を直接使う。cardName は「X」部分一致規約
    // ([[project_card_name_reference_matching]]) に従い CardNameMatch 経由で照合する。
    const candidate = state.cardInstances.find((c) => {
      if (c.zone !== "trash" || c.ownerPlayerId !== actingPlayerId)
        return false;
      const def = getCardDefinitionById(c.definitionId);
      return (
        !!def && !!action.cardName && matchesCardName(def.name, action.cardName)
      );
    });
    if (!candidate) {
      state.log.push(
        `effect:place_text_role_under_card:${host.instanceId}:no-trash-card-named:${JSON.stringify(action.cardName)}`
      );
      return state;
    }
    placedId = candidate.instanceId;
  } else if (action.moveFrom === "field_or_trash_host") {
    // ENGINE-x03-cross-zone-aldnoah-drive-transfer: sourceHostFilter に一致する自分の場の
    // host (現存、underCards 経由) を優先し、無ければ detachedUnderCardOrigin マーカーを
    // 保持したままトラッシュに単独で残るカード (かつて別 host から detach された child) を探す。
    const sourceHostFilter = action.sourceHostFilter;
    if (!sourceHostFilter) {
      state.log.push(
        `effect:place_text_role_under_card:${host.instanceId}:no-source-host-filter`
      );
      return state;
    }
    const fieldHostCandidate = state.cardInstances.find((c) => {
      if (
        c.zone !== "field" ||
        c.attachedToInstanceId !== null ||
        c.instanceId === host.instanceId ||
        // 発動元カード自身は候補から除外する。BSAZ02-X03 のように「host に既にアンダー
        // カードがあること」が召喚条件そのものである場合、発動元 (sourceInstanceId) は常に
        // 有効な source host としてマッチしてしまい、自身を発火条件にした自己参照的な奪い合い
        // (生成した token が自分の生みの親から即座に奪う) を招くため。
        c.instanceId === sourceInstanceId
      ) {
        return false;
      }
      const def = getCardDefinitionById(c.definitionId);
      if (!def) return false;
      if (
        !matchesHostCardFilter(
          state,
          c,
          def,
          sourceHostFilter,
          getCardDefinitionById
        )
      ) {
        return false;
      }
      return c.underCards.some(
        (uc) => uc.role === "text_role" && uc.roleTag === action.roleTag
      );
    });
    if (fieldHostCandidate) {
      const entry = fieldHostCandidate.underCards.find(
        (uc) => uc.role === "text_role" && uc.roleTag === action.roleTag
      )!;
      placedId = entry.cardInstanceId;
      oldHostInstanceId = fieldHostCandidate.instanceId;
    } else {
      const detachedCandidate = state.cardInstances.find(
        (c) =>
          c.zone === "trash" &&
          c.attachedToInstanceId === null &&
          c.detachedUnderCardOrigin !== null &&
          c.detachedUnderCardOrigin.roleTag === action.roleTag &&
          sourceHostFilter.cardNameEffective !== undefined &&
          matchesCardName(
            c.detachedUnderCardOrigin.hostCardNameEffective,
            sourceHostFilter.cardNameEffective
          )
      );
      if (!detachedCandidate) {
        state.log.push(
          `effect:place_text_role_under_card:${host.instanceId}:no-source-host-match:${action.roleTag}`
        );
        return state;
      }
      placedId = detachedCandidate.instanceId;
    }
  } else {
    placedId = sourceInstanceId;
  }

  const placedCard = getCardById(state, placedId);
  if (action.moveFrom === "self_under_card") {
    if (
      !placedCard ||
      placedCard.zone !== "field" ||
      placedCard.attachedToInstanceId !== oldHostInstanceId ||
      placedCard.instanceId === host.instanceId
    ) {
      state.log.push(
        `effect:place_text_role_under_card:${placedId}:not-eligible`
      );
      return state;
    }
  } else if (action.moveFrom === "trash_by_card_name") {
    if (!placedCard || placedCard.zone !== "trash") {
      state.log.push(
        `effect:place_text_role_under_card:${placedId}:not-eligible`
      );
      return state;
    }
  } else if (action.moveFrom === "field_or_trash_host") {
    const eligible =
      !!placedCard &&
      placedCard.instanceId !== host.instanceId &&
      (oldHostInstanceId !== undefined
        ? placedCard.zone === "field" &&
          placedCard.attachedToInstanceId === oldHostInstanceId
        : placedCard.zone === "trash" &&
          placedCard.attachedToInstanceId === null);
    if (!eligible) {
      state.log.push(
        `effect:place_text_role_under_card:${placedId}:not-eligible`
      );
      return state;
    }
  } else if (
    !placedCard ||
    (placedCard.zone !== "hand" && placedCard.zone !== "field") ||
    placedCard.controllerPlayerId !== host.controllerPlayerId ||
    placedCard.attachedToInstanceId !== null ||
    placedCard.instanceId === host.instanceId
  ) {
    state.log.push(
      `effect:place_text_role_under_card:${placedId}:not-eligible`
    );
    return state;
  }

  const fromHand =
    action.moveFrom !== "self_under_card" && placedCard.zone === "hand";
  state.log.push(
    `effect:place_text_role_under_card:${placedId}:under:${host.instanceId}:role:${action.roleTag}`
  );

  return replaceCardInstances(
    {
      ...state,
      players: fromHand
        ? state.players.map((p) =>
            p.id === host.controllerPlayerId ? { ...p } : p
          )
        : state.players,
    },
    state.cardInstances.map((c) => {
      if (c.instanceId === placedId) {
        return {
          ...c,
          zone: "field" as const,
          attachedToInstanceId: host.instanceId,
          zoneRoleName: "aldnoah-drive",
          faceDown: action.placeFaceDown === true,
          // 再アタッチ完了により由来マーカーは不要 (stale 化して別文脈で誤マッチしないよう
          // クリアする。他の moveFrom variant では常に null のまま = no-op)。
          detachedUnderCardOrigin: null,
        };
      }
      if (c.instanceId === host.instanceId) {
        return {
          ...c,
          underCards: [
            ...c.underCards,
            {
              cardInstanceId: placedId,
              role: "text_role" as const,
              roleTag: action.roleTag,
            },
          ],
        };
      }
      if (
        oldHostInstanceId !== undefined &&
        c.instanceId === oldHostInstanceId
      ) {
        return {
          ...c,
          underCards: c.underCards.filter(
            (uc) => uc.cardInstanceId !== placedId
          ),
        };
      }
      return c;
    })
  );
}
