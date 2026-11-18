// P2-14 inc1: effect-interpreter god-file 分解。星霊衣 under-card 操作 (place/swap, P3-100) を
// effect-interpreter から兄弟ファイルへ抽出。親ローカル依存ゼロの leaf handler のため
// 一方向 import (親 → 本モジュール) で barrel/振る舞い不変。

import { replaceCardInstances } from "../zone/card-instance-state";
import { getCardById } from "../card/card-lookup";
import { getDefaultZoneRoleName } from "../factories";
import {
  hasOpenTextRoleUnderCardSlot,
  hasStarGarmentCannotBeUnderTag,
} from "../mechanics/star-garment-utils";
import type { CardDefinition, GameState } from "../model";
import type { DSL } from "../dsl-types";

// --- place_star_garment / swap_star_garment: 星霊衣 under-card 操作 (P3-100) ---

/**
 * host の合体ブレイヴ1つを分離し、その B面を表向きで host の下 (text_role アンダーカード)
 * へ置く。07b §6。離脱破棄 / host 効果集約 / 入替は別スライス (S2-S4)。
 *
 * 候補源は host (sourceInstanceId) の合体ブレイヴ (attachedChildrenIds)。`resolvedTargetIds`
 * が host の合体ブレイヴを含む場合だけ実行する。対象指定ありで解決不能/非合体対象なら、
 * 本文の「このスピリットのブレイヴ1つ」を満たさないため no-op にする。
 */
export function executePlaceStarGarment(
  action: DSL.PlaceStarGarmentAction,
  state: GameState,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  resolvedTargetIds?: string[]
): GameState {
  const host = getCardById(state, sourceInstanceId);
  if (!host || host.zone !== "field") {
    state.log.push(
      `effect:place_star_garment:${sourceInstanceId}:host-not-on-field`
    );
    return state;
  }
  const roleTag = action.roleTag ?? "星霊衣";
  if (!hasOpenTextRoleUnderCardSlot(host, roleTag, 1)) {
    state.log.push(
      `effect:place_star_garment:${sourceInstanceId}:slot-full:${roleTag}`
    );
    return state;
  }

  let braveCandidates = host.attachedChildrenIds.filter((id) => {
    const child = getCardById(state, id);
    return child?.pendingLeaveKind === null;
  });
  if (resolvedTargetIds === undefined || resolvedTargetIds.length === 0) {
    state.log.push(
      `effect:place_star_garment:${sourceInstanceId}:target-not-resolved`
    );
    return state;
  }
  {
    const set = new Set(resolvedTargetIds);
    const filtered = braveCandidates.filter((id) => set.has(id));
    if (filtered.length === 0) {
      state.log.push(
        `effect:place_star_garment:${sourceInstanceId}:target-not-attached`
      );
      return state;
    }
    braveCandidates = filtered;
  }

  const braveId = braveCandidates[0];
  if (!braveId) {
    state.log.push(`effect:place_star_garment:${sourceInstanceId}:no-brave`);
    return state;
  }

  const brave = getCardById(state, braveId);
  const braveDef = brave && getCardDefinitionById(brave.definitionId);
  // B面 (backFace) を持たないカードは星霊衣で置けない (07b §6)
  if (!brave || !braveDef || !braveDef.isDoubleSided || !braveDef.backFace) {
    state.log.push(`effect:place_star_garment:${braveId}:no-back-face`);
    return state;
  }
  if (hasStarGarmentCannotBeUnderTag(braveDef)) {
    state.log.push(`effect:place_star_garment:${braveId}:cannot-be-under`);
    return state;
  }

  const backDefId = braveDef.backFace.cardNo ?? `${braveDef.cardNo}_back`;
  state.log.push(
    `effect:place_star_garment:${braveId}:under:${sourceInstanceId}:flip_to:${backDefId}:role:${roleTag}`
  );

  return replaceCardInstances(
    {
      ...state,
    },
    state.cardInstances.map((c) => {
      if (c.instanceId === braveId) {
        return {
          ...c,
          definitionId: backDefId,
          normalCoreCount: 0,
          attachedToInstanceId: sourceInstanceId,
          zoneRoleName: "star-garment",
          faceDown: false,
        };
      }
      if (c.instanceId === sourceInstanceId) {
        return {
          ...c,
          attachedChildrenIds: c.attachedChildrenIds.filter(
            (id) => id !== braveId
          ),
          underCards: [
            ...c.underCards,
            { cardInstanceId: braveId, role: "text_role" as const, roleTag },
          ],
        };
      }
      return c;
    })
  );
}

// --- swap_star_garment: 星霊衣 S4 入替 (P3-100) ---

/**
 * host 下の星霊衣カード1枚を A面の合体ブレイヴとして表に出し、host の合体ブレイヴ1つを
 * B面の星霊衣アンダーカードとして下へ入れる。07b §6。
 */
export function executeSwapStarGarment(
  action: DSL.SwapStarGarmentAction,
  state: GameState,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  resolvedTargetIds?: string[]
): GameState {
  const host = getCardById(state, sourceInstanceId);
  if (!host || host.zone !== "field") {
    state.log.push(
      `effect:swap_star_garment:${sourceInstanceId}:host-not-on-field`
    );
    return state;
  }

  const roleTag = action.roleTag ?? "星霊衣";
  const outgoingEntry = host.underCards.find(
    (entry) => entry.role === "text_role" && entry.roleTag === roleTag
  );
  if (!outgoingEntry) {
    state.log.push(
      `effect:swap_star_garment:${sourceInstanceId}:no-under:${roleTag}`
    );
    return state;
  }

  const outgoing = getCardById(state, outgoingEntry.cardInstanceId);
  const outgoingFrontDef =
    outgoing && getCardDefinitionById(outgoing.originalDefinitionId);
  if (
    !outgoing ||
    outgoing.zone !== "field" ||
    outgoing.attachedToInstanceId !== sourceInstanceId ||
    !outgoingFrontDef
  ) {
    state.log.push(
      `effect:swap_star_garment:${outgoingEntry.cardInstanceId}:under-missing`
    );
    return state;
  }
  if (outgoingFrontDef.printedCategory !== "brave") {
    state.log.push(
      `effect:swap_star_garment:${outgoing.instanceId}:front-not-brave`
    );
    return state;
  }

  let incomingCandidates = host.attachedChildrenIds.filter((id) => {
    if (id === outgoing.instanceId) return false;
    const child = getCardById(state, id);
    return child?.pendingLeaveKind === null;
  });
  if (resolvedTargetIds === undefined) {
    state.log.push(
      `effect:swap_star_garment:${sourceInstanceId}:target-not-resolved`
    );
    return state;
  }
  if (resolvedTargetIds !== undefined) {
    if (resolvedTargetIds.length === 0) {
      state.log.push(
        `effect:swap_star_garment:${sourceInstanceId}:target-not-resolved`
      );
      return state;
    }
    const set = new Set(resolvedTargetIds);
    const filtered = incomingCandidates.filter((id) => set.has(id));
    if (filtered.length === 0) {
      state.log.push(
        `effect:swap_star_garment:${sourceInstanceId}:target-not-attached`
      );
      return state;
    }
    incomingCandidates = filtered;
  }

  const incomingId = incomingCandidates[0];
  if (!incomingId) {
    state.log.push(`effect:swap_star_garment:${sourceInstanceId}:no-brave`);
    return state;
  }

  const incoming = getCardById(state, incomingId);
  const incomingDef = incoming && getCardDefinitionById(incoming.definitionId);
  if (
    !incoming ||
    incoming.zone !== "field" ||
    !incomingDef ||
    !incomingDef.isDoubleSided ||
    !incomingDef.backFace
  ) {
    state.log.push(`effect:swap_star_garment:${incomingId}:no-back-face`);
    return state;
  }
  if (hasStarGarmentCannotBeUnderTag(incomingDef)) {
    state.log.push(`effect:swap_star_garment:${incomingId}:cannot-be-under`);
    return state;
  }

  const incomingBackDefId =
    incomingDef.backFace.cardNo ?? `${incomingDef.cardNo}_back`;
  state.log.push(
    `effect:swap_star_garment:${outgoing.instanceId}<->${incomingId}:host:${sourceInstanceId}:role:${roleTag}`
  );

  return replaceCardInstances(
    {
      ...state,
    },
    state.cardInstances.map((card) => {
      if (card.instanceId === outgoing.instanceId) {
        return {
          ...card,
          definitionId: card.originalDefinitionId,
          attachedToInstanceId: sourceInstanceId,
          zoneRoleName: getDefaultZoneRoleName(outgoingFrontDef, "field"),
          faceDown: false,
        };
      }
      if (card.instanceId === incomingId) {
        return {
          ...card,
          definitionId: incomingBackDefId,
          normalCoreCount: 0,
          attachedToInstanceId: sourceInstanceId,
          zoneRoleName: "star-garment",
          faceDown: false,
        };
      }
      if (card.instanceId === sourceInstanceId) {
        return {
          ...card,
          attachedChildrenIds: [
            ...card.attachedChildrenIds.filter((id) => id !== incomingId),
            outgoing.instanceId,
          ],
          underCards: [
            ...card.underCards.filter(
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
      return card;
    })
  );
}
