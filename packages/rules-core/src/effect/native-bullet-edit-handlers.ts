// P3-116 SSOT是正: bullet_edit/swap_bullet_edit 専用 LegalAction kind + 専用 executor
// (bulletEditData 独自パイプライン) を廃止し、place_star_garment/swap_star_garment と
// 同型の DSL Action + use_field_card_effect 汎用経路へ移行する。親ローカル依存ゼロの
// leaf handler のため一方向 import (親 → 本モジュール) で振る舞い不変。

import { replaceCardInstances } from "../zone/card-instance-state";
import { getCardById } from "../card/card-lookup";
import { getDefaultZoneRoleName } from "../factories";
import {
  BULLET_EDIT_ROLE_TAG,
  hasOpenTextRoleUnderCardSlot,
  underCardRoleTagsEqual,
} from "../mechanics/star-garment-utils";
import type { CardDefinition, GameState } from "../model";
import type { DSL } from "../dsl-types";

// --- bullet_edit: 【バレットエディット】手札1枚を host の下に置く (P3-111 S7) ---

/**
 * host (sourceInstanceId) の自分の手札1枚を host の下 (text_role アンダーカード、
 * roleTag既定"バレットエディット") へ表向きで置く。候補は `resolvedTargetIds`（自分の手札から解決済み）。
 * ドロー等の後続効果は呼び出し側 (card-data の後続 step) が `ref_succeeded` で本 step の
 * 成否を参照して表現する。
 */
export function executeBulletEdit(
  action: DSL.BulletEditAction,
  state: GameState,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  resolvedTargetIds?: string[]
): GameState {
  const host = getCardById(state, sourceInstanceId);
  if (!host || host.zone !== "field") {
    state.log.push(`effect:bullet_edit:${sourceInstanceId}:host-not-on-field`);
    return state;
  }
  const roleTag = action.roleTag ?? BULLET_EDIT_ROLE_TAG;
  if (!hasOpenTextRoleUnderCardSlot(host, roleTag, 1)) {
    state.log.push(
      `effect:bullet_edit:${sourceInstanceId}:slot-full:${roleTag}`
    );
    return state;
  }

  if (resolvedTargetIds === undefined || resolvedTargetIds.length === 0) {
    state.log.push(
      `effect:bullet_edit:${sourceInstanceId}:target-not-resolved`
    );
    return state;
  }
  const handCardId = resolvedTargetIds[0]!;
  const handCard = getCardById(state, handCardId);
  if (
    !handCard ||
    handCard.zone !== "hand" ||
    handCard.controllerPlayerId !== host.controllerPlayerId
  ) {
    state.log.push(`effect:bullet_edit:${handCardId}:not-in-hand`);
    return state;
  }

  state.log.push(
    `effect:bullet_edit:${handCardId}:under:${sourceInstanceId}:role:${roleTag}`
  );

  return replaceCardInstances(
    {
      ...state,
      players: state.players.map((p) =>
        p.id === host.controllerPlayerId ? { ...p } : p
      ),
    },
    state.cardInstances.map((c) => {
      if (c.instanceId === handCardId) {
        return {
          ...c,
          zone: "field" as const,
          attachedToInstanceId: sourceInstanceId,
          zoneRoleName: "bullet-edit",
          faceDown: false,
        };
      }
      if (c.instanceId === sourceInstanceId) {
        return {
          ...c,
          underCards: [
            ...c.underCards,
            { cardInstanceId: handCardId, role: "text_role" as const, roleTag },
          ],
        };
      }
      return c;
    })
  );
}

// --- swap_bullet_edit: 【バレットエディット】入替 (P3-111 S11) ---

/**
 * host (sourceInstanceId) 下の既存 text_role アンダーカード (roleTag既定"バレットエディット") を
 * 手札へ戻し、代わりに `resolvedTargetIds`（自分の手札から解決済み）の1枚を同じ役割で
 * 下に置く。出入りとも zone 直変更 (召喚/離脱トリガーパイプラインを経由しない、
 * swap_star_garment と同型)。使用制限/ドローは無い独立操作。
 */
export function executeSwapBulletEdit(
  action: DSL.SwapBulletEditAction,
  state: GameState,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  resolvedTargetIds?: string[]
): GameState {
  const host = getCardById(state, sourceInstanceId);
  if (!host || host.zone !== "field") {
    state.log.push(
      `effect:swap_bullet_edit:${sourceInstanceId}:host-not-on-field`
    );
    return state;
  }

  const roleTag = action.roleTag ?? BULLET_EDIT_ROLE_TAG;
  const outgoingEntry = host.underCards.find(
    (entry) =>
      entry.role === "text_role" &&
      underCardRoleTagsEqual(entry.roleTag, roleTag)
  );
  if (!outgoingEntry) {
    state.log.push(
      `effect:swap_bullet_edit:${sourceInstanceId}:no-under:${roleTag}`
    );
    return state;
  }

  const outgoing = getCardById(state, outgoingEntry.cardInstanceId);
  if (
    !outgoing ||
    outgoing.zone !== "field" ||
    outgoing.attachedToInstanceId !== sourceInstanceId
  ) {
    state.log.push(
      `effect:swap_bullet_edit:${outgoingEntry.cardInstanceId}:under-missing`
    );
    return state;
  }
  const outgoingDef = getCardDefinitionById(outgoing.definitionId);
  if (!outgoingDef) {
    state.log.push(
      `effect:swap_bullet_edit:${outgoing.instanceId}:no-definition`
    );
    return state;
  }

  if (resolvedTargetIds === undefined || resolvedTargetIds.length === 0) {
    state.log.push(
      `effect:swap_bullet_edit:${sourceInstanceId}:target-not-resolved`
    );
    return state;
  }
  const incomingId = resolvedTargetIds[0]!;
  const incoming = getCardById(state, incomingId);
  if (
    !incoming ||
    incoming.zone !== "hand" ||
    incoming.controllerPlayerId !== host.controllerPlayerId
  ) {
    state.log.push(`effect:swap_bullet_edit:${incomingId}:not-in-hand`);
    return state;
  }

  state.log.push(
    `effect:swap_bullet_edit:${outgoing.instanceId}<->${incomingId}:host:${sourceInstanceId}:role:${roleTag}`
  );

  return replaceCardInstances(
    {
      ...state,
    },
    state.cardInstances.map((c) => {
      if (c.instanceId === incomingId) {
        return {
          ...c,
          zone: "field" as const,
          attachedToInstanceId: sourceInstanceId,
          zoneRoleName: "bullet-edit",
          faceDown: false,
        };
      }
      if (c.instanceId === outgoing.instanceId) {
        return {
          ...c,
          zone: "hand" as const,
          attachedToInstanceId: null,
          zoneRoleName: getDefaultZoneRoleName(outgoingDef, "hand"),
          faceDown: false,
        };
      }
      if (c.instanceId === sourceInstanceId) {
        return {
          ...c,
          underCards: [
            ...c.underCards.filter(
              (entry) => entry.cardInstanceId !== outgoing.instanceId
            ),
            {
              cardInstanceId: incomingId,
              role: "text_role" as const,
              roleTag,
            },
          ],
        };
      }
      return c;
    })
  );
}
