import {
  appendDuplicateIssue,
  appendMissingReferenceIssue,
  appendNonNegativeIntegerIssue,
} from "./game-state-invariant-helpers";
import type { GameStateInvariantIssue } from "./game-state-invariant-types";
import type { CardInstance, GameState, PendingLeaveEntity } from "../model";

function collectPlayerIssues(
  state: GameState,
  issues: GameStateInvariantIssue[],
  playerIds: Set<string>,
  cardIds: Set<string>
): void {
  const seenPlayerIds = new Set<string>();

  for (const [index, player] of state.players.entries()) {
    if (seenPlayerIds.has(player.id)) {
      appendDuplicateIssue(
        issues,
        `players[${index}].id`,
        "duplicate_player_id",
        player.id
      );
    }

    seenPlayerIds.add(player.id);
    playerIds.add(player.id);

    appendNonNegativeIntegerIssue(
      issues,
      player.deckCount,
      `players[${index}].deckCount`,
      "invalid_player_deck_count"
    );
    appendNonNegativeIntegerIssue(
      issues,
      player.handCount,
      `players[${index}].handCount`,
      "invalid_player_hand_count"
    );
    appendNonNegativeIntegerIssue(
      issues,
      player.lifeNormalCoreCount,
      `players[${index}].lifeNormalCoreCount`,
      "invalid_player_life_normal_core_count"
    );
    appendNonNegativeIntegerIssue(
      issues,
      player.reserveNormalCoreCount,
      `players[${index}].reserveNormalCoreCount`,
      "invalid_player_reserve_normal_core_count"
    );
    appendNonNegativeIntegerIssue(
      issues,
      player.trashNormalCoreCount,
      `players[${index}].trashNormalCoreCount`,
      "invalid_player_trash_normal_core_count"
    );
    appendNonNegativeIntegerIssue(
      issues,
      player.voidNormalCoreCount,
      `players[${index}].voidNormalCoreCount`,
      "invalid_player_void_normal_core_count"
    );
    // ソウルコア複数個対応 S1 (P3-101): ロケーション別カウントの well-formedness。
    // ボイド不可の硬制約は型設計上 void 相当のフィールドが存在しないことで担保する。
    appendNonNegativeIntegerIssue(
      issues,
      player.reserveSoulCoreCount,
      `players[${index}].reserveSoulCoreCount`,
      "invalid_player_reserve_soul_core_count"
    );
    appendNonNegativeIntegerIssue(
      issues,
      player.trashSoulCoreCount,
      `players[${index}].trashSoulCoreCount`,
      "invalid_player_trash_soul_core_count"
    );
    appendNonNegativeIntegerIssue(
      issues,
      player.lifeSoulCoreCount,
      `players[${index}].lifeSoulCoreCount`,
      "invalid_player_life_soul_core_count"
    );

    // 実対戦はデッキ0枚でも照合する。実体を省略するfixtureは明示的に区別する。
    const actualHandCount = state.cardInstances.filter(
      (c) => c.ownerPlayerId === player.id && c.zone === "hand"
    ).length;
    const actualDeckCount = state.cardInstances.filter(
      (c) => c.ownerPlayerId === player.id && c.zone === "deck"
    ).length;
    if (state.zoneCountMode !== "abstract") {
      if (player.handCount !== actualHandCount) {
        issues.push({
          code: "hand_count_mismatch",
          path: `players[${index}].handCount`,
          message: `handCount (${player.handCount}) does not match actual hand cards (${actualHandCount})`,
        });
      }
      if (player.deckCount !== actualDeckCount) {
        issues.push({
          code: "deck_count_mismatch",
          path: `players[${index}].deckCount`,
          message: `deckCount (${player.deckCount}) does not match actual deck cards (${actualDeckCount})`,
        });
      }
    }

    const soulCoreLocation = player.soulCoreLocation;

    if (
      soulCoreLocation?.kind === "card" &&
      !cardIds.has(soulCoreLocation.instanceId)
    ) {
      appendMissingReferenceIssue(
        issues,
        `players[${index}].soulCoreLocation.instanceId`,
        "missing_soul_core_card_reference",
        soulCoreLocation.instanceId
      );
    }
  }
}

function collectPlayerOrderIssues(
  state: GameState,
  issues: GameStateInvariantIssue[],
  playerIds: Set<string>
): void {
  const seenOrderedPlayerIds = new Set<string>();

  for (const [index, playerId] of state.playerOrder.entries()) {
    if (!playerIds.has(playerId)) {
      appendMissingReferenceIssue(
        issues,
        `playerOrder[${index}]`,
        "missing_player_order_player",
        playerId
      );
    }

    if (seenOrderedPlayerIds.has(playerId)) {
      appendDuplicateIssue(
        issues,
        `playerOrder[${index}]`,
        "duplicate_player_order_player",
        playerId
      );
    }

    seenOrderedPlayerIds.add(playerId);
  }

  for (const playerId of playerIds) {
    if (!seenOrderedPlayerIds.has(playerId)) {
      appendMissingReferenceIssue(
        issues,
        "playerOrder",
        "player_missing_from_order",
        playerId
      );
    }
  }

  if (!playerIds.has(state.activePlayerId)) {
    appendMissingReferenceIssue(
      issues,
      "activePlayerId",
      "missing_active_player",
      state.activePlayerId
    );
  }
}

function collectCardIssues(
  state: GameState,
  issues: GameStateInvariantIssue[],
  playerIds: Set<string>,
  cardById: Map<string, CardInstance>
): void {
  const seenCardIds = new Set<string>();

  for (const [index, card] of state.cardInstances.entries()) {
    if (seenCardIds.has(card.instanceId)) {
      appendDuplicateIssue(
        issues,
        `cardInstances[${index}].instanceId`,
        "duplicate_card_instance_id",
        card.instanceId
      );
    }

    seenCardIds.add(card.instanceId);
    cardById.set(card.instanceId, card);

    if (!playerIds.has(card.ownerPlayerId)) {
      appendMissingReferenceIssue(
        issues,
        `cardInstances[${index}].ownerPlayerId`,
        "missing_card_owner",
        card.ownerPlayerId
      );
    }

    if (!playerIds.has(card.controllerPlayerId)) {
      appendMissingReferenceIssue(
        issues,
        `cardInstances[${index}].controllerPlayerId`,
        "missing_card_controller",
        card.controllerPlayerId
      );
    }

    appendNonNegativeIntegerIssue(
      issues,
      card.normalCoreCount,
      `cardInstances[${index}].normalCoreCount`,
      "invalid_card_normal_core_count"
    );
    appendNonNegativeIntegerIssue(
      issues,
      card.soulCoreCount,
      `cardInstances[${index}].soulCoreCount`,
      "invalid_card_soul_core_count"
    );
    appendNonNegativeIntegerIssue(
      issues,
      card.minimumRequiredCores,
      `cardInstances[${index}].minimumRequiredCores`,
      "invalid_card_minimum_required_cores"
    );

    if (card.pendingLeaveKind !== null && card.zone !== "field") {
      issues.push({
        code: "pending_leave_card_not_on_field",
        path: `cardInstances[${index}].pendingLeaveKind`,
        message: `Card ${card.instanceId} is pending leave but not on the field`,
      });
    }
  }

  for (const [index, card] of state.cardInstances.entries()) {
    if (card.attachedToInstanceId !== null) {
      const attachedParent = cardById.get(card.attachedToInstanceId);

      if (card.zone !== "field") {
        issues.push({
          code: "attached_card_not_on_field",
          path: `cardInstances[${index}].attachedToInstanceId`,
          message: `Attached card ${card.instanceId} is in ${card.zone} instead of field`,
        });
      }

      if (!attachedParent) {
        appendMissingReferenceIssue(
          issues,
          `cardInstances[${index}].attachedToInstanceId`,
          "missing_attached_parent",
          card.attachedToInstanceId
        );
      } else if (attachedParent.zone !== "field") {
        issues.push({
          code: "attached_parent_not_on_field",
          path: `cardInstances[${index}].attachedToInstanceId`,
          message: `Parent card ${attachedParent.instanceId} is in ${attachedParent.zone} instead of field`,
        });
      } else if (
        !attachedParent.attachedChildrenIds.includes(card.instanceId) &&
        !attachedParent.underCards.some(
          (entry) => entry.cardInstanceId === card.instanceId
        )
      ) {
        issues.push({
          code: "attached_parent_child_mismatch",
          path: `cardInstances[${index}].attachedToInstanceId`,
          message: `Parent card ${attachedParent.instanceId} does not list child/under-card ${card.instanceId}`,
        });
      }
    }

    // 異魔神ブレイヴ (10_rules/08c §7) の右合体スロット参照整合性。左スロット
    // (attachedToInstanceId) と異なり右ホスト側 attachedChildrenIds には反映しない
    // 非対称設計のため、参照先カードの存在のみを検査する（相互参照チェックはしない）。
    if (card.imaginRightCombinedWith !== null) {
      const rightHost = cardById.get(card.imaginRightCombinedWith);
      if (!rightHost) {
        appendMissingReferenceIssue(
          issues,
          `cardInstances[${index}].imaginRightCombinedWith`,
          "missing_imagin_right_host",
          card.imaginRightCombinedWith
        );
      }
    }

    const seenChildIds = new Set<string>();
    const seenUnderCardIds = new Set<string>();

    for (const [underIndex, entry] of card.underCards.entries()) {
      const underPath = `cardInstances[${index}].underCards[${underIndex}].cardInstanceId`;
      if (seenUnderCardIds.has(entry.cardInstanceId)) {
        appendDuplicateIssue(
          issues,
          underPath,
          "duplicate_under_card_id",
          entry.cardInstanceId
        );
      }
      seenUnderCardIds.add(entry.cardInstanceId);

      const underCard = cardById.get(entry.cardInstanceId);
      if (!underCard) {
        appendMissingReferenceIssue(
          issues,
          underPath,
          "missing_under_card",
          entry.cardInstanceId
        );
        continue;
      }

      if (underCard.zone !== "field") {
        issues.push({
          code: "under_card_not_on_field",
          path: underPath,
          message: `Under-card ${entry.cardInstanceId} is in ${underCard.zone} instead of field`,
        });
      }

      if (
        entry.role === "text_role" &&
        underCard.attachedToInstanceId !== card.instanceId
      ) {
        issues.push({
          code: "under_card_parent_mismatch",
          path: underPath,
          message: `Under-card ${entry.cardInstanceId} points to ${underCard.attachedToInstanceId ?? "null"} instead of ${card.instanceId}`,
        });
      }
    }

    for (const [childIndex, childId] of card.attachedChildrenIds.entries()) {
      if (seenChildIds.has(childId)) {
        appendDuplicateIssue(
          issues,
          `cardInstances[${index}].attachedChildrenIds[${childIndex}]`,
          "duplicate_attached_child_id",
          childId
        );
      }

      seenChildIds.add(childId);

      const childCard = cardById.get(childId);

      if (!childCard) {
        appendMissingReferenceIssue(
          issues,
          `cardInstances[${index}].attachedChildrenIds[${childIndex}]`,
          "missing_attached_child",
          childId
        );
        continue;
      }

      if (childCard.zone !== "field") {
        issues.push({
          code: "attached_child_not_on_field",
          path: `cardInstances[${index}].attachedChildrenIds[${childIndex}]`,
          message: `Attached child card ${childId} is in ${childCard.zone} instead of field`,
        });
      }

      if (childCard.attachedToInstanceId !== card.instanceId) {
        issues.push({
          code: "attached_child_parent_mismatch",
          path: `cardInstances[${index}].attachedChildrenIds[${childIndex}]`,
          message: `Child card ${childId} points to ${childCard.attachedToInstanceId ?? "null"} instead of ${card.instanceId}`,
        });
      }
    }
  }
}

function collectSoulCoreIssues(
  state: GameState,
  issues: GameStateInvariantIssue[],
  cardById: Map<string, CardInstance>
): void {
  const cardIdsReferencedBySoulCore = new Set<string>();

  for (const [playerIndex, player] of state.players.entries()) {
    if (player.soulCoreLocation?.kind !== "card") {
      continue;
    }

    const targetCard = cardById.get(player.soulCoreLocation.instanceId);

    if (!targetCard) {
      continue;
    }

    if (targetCard.zone !== "field") {
      issues.push({
        code: "soul_core_location_card_not_on_field",
        path: `players[${playerIndex}].soulCoreLocation`,
        message: `Player soul core points to ${targetCard.instanceId} but the card is not on the field`,
      });
    }

    if (cardIdsReferencedBySoulCore.has(targetCard.instanceId)) {
      appendDuplicateIssue(
        issues,
        `players[${playerIndex}].soulCoreLocation.instanceId`,
        "duplicate_soul_core_card_reference",
        targetCard.instanceId
      );
    }

    cardIdsReferencedBySoulCore.add(targetCard.instanceId);
  }
}

/**
 * P3-101 S2: 旧 SSOT (player.soulCoreLocation) と新カウントフィールド
 * (reserveSoulCoreCount/trashSoulCoreCount/lifeSoulCoreCount/CardInstance.soulCoreCount)
 * の dual-write 整合性（保存則）を検査する。moveSoulCore の書き込み漏れ/二重計上を
 * 機械的に検知する。removed_from_game はカウントフィールド未新設のため対象外。
 *
 * 下限チェック (`<`) のみ: `generateSoulCoreOutsideGame` や明示ソウルコア移動により、
 * ポインタが指さない「追加ソウル」がロケーション別カウントにのみ計上されうるため
 * (裁定 2026-06-14、[[project_soul_core_future_multiple]])。ポインタの追跡対象分が
 * カウントに反映されていない (書き込み漏れ) ケースだけを検知する。
 */
function collectSoulCoreCountConsistencyIssues(
  state: GameState,
  issues: GameStateInvariantIssue[],
  cardById: Map<string, CardInstance>
): void {
  for (const [playerIndex, player] of state.players.entries()) {
    const location = player.soulCoreLocation;

    const expectedReserve = location?.kind === "reserve" ? 1 : 0;
    const expectedTrash = location?.kind === "trash" ? 1 : 0;
    const expectedLife = location?.kind === "life" ? 1 : 0;

    if (player.reserveSoulCoreCount < expectedReserve) {
      issues.push({
        code: "soul_core_count_location_mismatch",
        path: `players[${playerIndex}].reserveSoulCoreCount`,
        message: `reserveSoulCoreCount=${player.reserveSoulCoreCount} does not match soulCoreLocation=${JSON.stringify(location)}`,
      });
    }

    if (player.trashSoulCoreCount < expectedTrash) {
      issues.push({
        code: "soul_core_count_location_mismatch",
        path: `players[${playerIndex}].trashSoulCoreCount`,
        message: `trashSoulCoreCount=${player.trashSoulCoreCount} does not match soulCoreLocation=${JSON.stringify(location)}`,
      });
    }

    if (player.lifeSoulCoreCount < expectedLife) {
      issues.push({
        code: "soul_core_count_location_mismatch",
        path: `players[${playerIndex}].lifeSoulCoreCount`,
        message: `lifeSoulCoreCount=${player.lifeSoulCoreCount} does not match soulCoreLocation=${JSON.stringify(location)}`,
      });
    }

    if (location?.kind === "card") {
      const targetCard = cardById.get(location.instanceId);

      if (targetCard) {
        if (targetCard.soulCoreCount < 1) {
          issues.push({
            code: "soul_core_count_location_mismatch",
            path: `cardInstances[${targetCard.instanceId}].soulCoreCount`,
            message: `Card ${targetCard.instanceId} referenced by players[${playerIndex}].soulCoreLocation but soulCoreCount=${targetCard.soulCoreCount}`,
          });
        }
      }
    }
  }
}

function collectPendingLeaveIssues(
  state: GameState,
  issues: GameStateInvariantIssue[],
  cardById: Map<string, CardInstance>
): void {
  const pendingLeaveByInstanceId = new Map<string, PendingLeaveEntity>();

  for (const [index, pendingLeave] of state.pendingLeaveEntities.entries()) {
    if (pendingLeaveByInstanceId.has(pendingLeave.instanceId)) {
      appendDuplicateIssue(
        issues,
        `pendingLeaveEntities[${index}].instanceId`,
        "duplicate_pending_leave_instance",
        pendingLeave.instanceId
      );
    }

    pendingLeaveByInstanceId.set(pendingLeave.instanceId, pendingLeave);

    const card = cardById.get(pendingLeave.instanceId);

    if (!card) {
      appendMissingReferenceIssue(
        issues,
        `pendingLeaveEntities[${index}].instanceId`,
        "missing_pending_leave_card",
        pendingLeave.instanceId
      );
      continue;
    }

    if (card.zone !== "field") {
      issues.push({
        code: "pending_leave_card_not_on_field",
        path: `pendingLeaveEntities[${index}].instanceId`,
        message: `Pending leave card ${card.instanceId} must stay on the field until flush`,
      });
    }

    // blockedByResistance is a judgment marker, not a physical pending leave.
    // It deliberately keeps the card on the field with no card-side pending
    // fields until the resistance expires or the marker is flushed.  Do not
    // compare its cause/chain to a normal leave, but do reject a hybrid where
    // the marker and card-side pending state coexist.
    const blockedMarkerHasCardPendingState =
      pendingLeave.blockedByResistance === true &&
      (card.pendingLeaveKind !== null ||
        card.pendingLeaveCause !== null ||
        card.pendingLeaveChainId !== null ||
        card.deferZoneMoveUntilChainEnd);
    if (
      blockedMarkerHasCardPendingState ||
      (!pendingLeave.blockedByResistance &&
        (card.pendingLeaveKind !== pendingLeave.kind ||
          card.pendingLeaveCause !== pendingLeave.cause ||
          card.pendingLeaveChainId !== pendingLeave.chainId ||
          card.deferZoneMoveUntilChainEnd !==
            pendingLeave.deferZoneMoveUntilChainEnd))
    ) {
      issues.push({
        code: "pending_leave_card_state_mismatch",
        path: `pendingLeaveEntities[${index}]`,
        message: `Pending leave entity for ${pendingLeave.instanceId} does not match card state`,
      });
    }
  }

  for (const [index, card] of state.cardInstances.entries()) {
    if (card.pendingLeaveKind === null) {
      continue;
    }

    const pendingLeave = pendingLeaveByInstanceId.get(card.instanceId);

    if (!pendingLeave) {
      issues.push({
        code: "card_pending_leave_without_entity",
        path: `cardInstances[${index}].pendingLeaveKind`,
        message: `Card ${card.instanceId} is pending leave but pendingLeaveEntities has no matching entry`,
      });
      continue;
    }

    if (card.pendingLeaveCause === null || card.pendingLeaveChainId === null) {
      issues.push({
        code: "incomplete_card_pending_leave_state",
        path: `cardInstances[${index}]`,
        message: `Card ${card.instanceId} is pending leave but cause or chainId is missing`,
      });
    }
  }
}

function collectBurstSetIssues(
  state: GameState,
  issues: GameStateInvariantIssue[],
  playerIds: Set<string>,
  cardById: Map<string, CardInstance>
): void {
  const seenBurstSetPlayerIdsThisTurn = new Set<string>();
  const seenBurstCardInstanceIds = new Set<string>();

  for (const [index, playerId] of state.burstSetPlayerIdsThisTurn.entries()) {
    if (!playerIds.has(playerId)) {
      appendMissingReferenceIssue(
        issues,
        `burstSetPlayerIdsThisTurn[${index}]`,
        "missing_burst_set_this_turn_player",
        playerId
      );
    }

    if (seenBurstSetPlayerIdsThisTurn.has(playerId)) {
      appendDuplicateIssue(
        issues,
        `burstSetPlayerIdsThisTurn[${index}]`,
        "duplicate_burst_set_this_turn_player",
        playerId
      );
    }

    seenBurstSetPlayerIdsThisTurn.add(playerId);
  }

  for (const [index, setBurstState] of state.setBurstStates.entries()) {
    if (!playerIds.has(setBurstState.playerId)) {
      appendMissingReferenceIssue(
        issues,
        `setBurstStates[${index}].playerId`,
        "missing_burst_set_player",
        setBurstState.playerId
      );
    }

    if (seenBurstCardInstanceIds.has(setBurstState.cardInstanceId)) {
      appendDuplicateIssue(
        issues,
        `setBurstStates[${index}].cardInstanceId`,
        "duplicate_burst_set_card_instance",
        setBurstState.cardInstanceId
      );
    }

    seenBurstCardInstanceIds.add(setBurstState.cardInstanceId);

    const burstCard = cardById.get(setBurstState.cardInstanceId);

    if (!burstCard) {
      appendMissingReferenceIssue(
        issues,
        `setBurstStates[${index}].cardInstanceId`,
        "missing_burst_set_card",
        setBurstState.cardInstanceId
      );
      continue;
    }

    if (burstCard.zone !== "burst") {
      issues.push({
        code: "burst_set_card_not_in_burst_zone",
        path: `setBurstStates[${index}].cardInstanceId`,
        message: `Burst card ${burstCard.instanceId} must stay in the burst zone while set`,
      });
    }

    if (burstCard.controllerPlayerId !== setBurstState.playerId) {
      issues.push({
        code: "burst_set_card_player_mismatch",
        path: `setBurstStates[${index}]`,
        message: `Burst card ${burstCard.instanceId} does not belong to player ${setBurstState.playerId}`,
      });
    }
  }

  const seenRevealedBurstCardInstanceIds = new Set<string>();

  for (const [
    index,
    revealedBurstState,
  ] of state.revealedBurstStates.entries()) {
    if (!playerIds.has(revealedBurstState.playerId)) {
      appendMissingReferenceIssue(
        issues,
        `revealedBurstStates[${index}].playerId`,
        "missing_revealed_burst_player",
        revealedBurstState.playerId
      );
    }

    if (
      seenRevealedBurstCardInstanceIds.has(revealedBurstState.cardInstanceId)
    ) {
      appendDuplicateIssue(
        issues,
        `revealedBurstStates[${index}].cardInstanceId`,
        "duplicate_revealed_burst_card_instance",
        revealedBurstState.cardInstanceId
      );
    }

    seenRevealedBurstCardInstanceIds.add(revealedBurstState.cardInstanceId);

    const revealedBurstCard = cardById.get(revealedBurstState.cardInstanceId);

    if (!revealedBurstCard) {
      appendMissingReferenceIssue(
        issues,
        `revealedBurstStates[${index}].cardInstanceId`,
        "missing_revealed_burst_card",
        revealedBurstState.cardInstanceId
      );
      continue;
    }

    if (revealedBurstCard.zone !== "burst") {
      issues.push({
        code: "revealed_burst_card_not_in_burst_zone",
        path: `revealedBurstStates[${index}].cardInstanceId`,
        message: `Revealed burst card ${revealedBurstCard.instanceId} must stay in the burst zone until post-resolution move`,
      });
    }

    if (revealedBurstCard.controllerPlayerId !== revealedBurstState.playerId) {
      issues.push({
        code: "revealed_burst_card_player_mismatch",
        path: `revealedBurstStates[${index}]`,
        message: `Revealed burst card ${revealedBurstCard.instanceId} does not belong to player ${revealedBurstState.playerId}`,
      });
    }
  }
}

function collectMirageSetIssues(
  state: GameState,
  issues: GameStateInvariantIssue[],
  playerIds: Set<string>,
  cardById: Map<string, CardInstance>
): void {
  const seenMirageSetPlayerIdsThisTurn = new Set<string>();

  for (const [index, playerId] of state.mirageSetPlayerIdsThisTurn.entries()) {
    if (!playerIds.has(playerId)) {
      appendMissingReferenceIssue(
        issues,
        `mirageSetPlayerIdsThisTurn[${index}]`,
        "missing_mirage_set_this_turn_player",
        playerId
      );
    }

    if (seenMirageSetPlayerIdsThisTurn.has(playerId)) {
      appendDuplicateIssue(
        issues,
        `mirageSetPlayerIdsThisTurn[${index}]`,
        "duplicate_mirage_set_this_turn_player",
        playerId
      );
    }

    seenMirageSetPlayerIdsThisTurn.add(playerId);
  }

  const seenExemptions = new Set<string>();
  for (const [index, entry] of state.mirageSetCountExemptionsUsed.entries()) {
    const path = `mirageSetCountExemptionsUsed[${index}]`;
    if (!playerIds.has(entry.playerId)) {
      appendMissingReferenceIssue(
        issues,
        path,
        "missing_mirage_set_count_exemption_used_player",
        entry.playerId
      );
    }
    if (typeof entry.cardNo !== "string" || entry.cardNo.length === 0) {
      issues.push({
        code: "invalid_mirage_set_count_exemption_card_no",
        path,
        message: "Mirage exemption requires a shared cardNo",
      });
    }
    const key = JSON.stringify([entry.playerId, entry.cardNo]);
    if (seenExemptions.has(key)) {
      appendDuplicateIssue(
        issues,
        path,
        "duplicate_mirage_set_count_exemption_used_player",
        key
      );
    }
    seenExemptions.add(key);
  }

  const seenMirageCardInstanceIds = new Set<string>();

  for (const [index, mirageState] of state.mirageSetStates.entries()) {
    if (!playerIds.has(mirageState.playerId)) {
      appendMissingReferenceIssue(
        issues,
        `mirageSetStates[${index}].playerId`,
        "missing_mirage_set_player",
        mirageState.playerId
      );
    }

    if (seenMirageCardInstanceIds.has(mirageState.cardInstanceId)) {
      appendDuplicateIssue(
        issues,
        `mirageSetStates[${index}].cardInstanceId`,
        "duplicate_mirage_set_card_instance",
        mirageState.cardInstanceId
      );
    }

    seenMirageCardInstanceIds.add(mirageState.cardInstanceId);

    const mirageCard = cardById.get(mirageState.cardInstanceId);

    if (!mirageCard) {
      appendMissingReferenceIssue(
        issues,
        `mirageSetStates[${index}].cardInstanceId`,
        "missing_mirage_set_card",
        mirageState.cardInstanceId
      );
      continue;
    }

    if (mirageCard.zone !== "mirage") {
      issues.push({
        code: "mirage_set_card_not_in_mirage_zone",
        path: `mirageSetStates[${index}].cardInstanceId`,
        message: `Mirage card ${mirageCard.instanceId} must stay in the mirage zone while set`,
      });
    }

    if (mirageCard.controllerPlayerId !== mirageState.playerId) {
      issues.push({
        code: "mirage_set_card_player_mismatch",
        path: `mirageSetStates[${index}]`,
        message: `Mirage card ${mirageCard.instanceId} does not belong to player ${mirageState.playerId}`,
      });
    }
  }

  // P2-07 H-2: クォーツセット状態の整合性チェック
  const seenQuartzInstanceIds = new Set<string>();

  for (const [index, quartzState] of state.quartzSetStates.entries()) {
    if (!playerIds.has(quartzState.ownerPlayerId)) {
      appendMissingReferenceIssue(
        issues,
        `quartzSetStates[${index}].ownerPlayerId`,
        "missing_quartz_owner",
        quartzState.ownerPlayerId
      );
    }

    if (seenQuartzInstanceIds.has(quartzState.quartzInstanceId)) {
      appendDuplicateIssue(
        issues,
        `quartzSetStates[${index}].quartzInstanceId`,
        "duplicate_quartz_set_card_instance",
        quartzState.quartzInstanceId
      );
    }

    seenQuartzInstanceIds.add(quartzState.quartzInstanceId);

    const quartzCard = cardById.get(quartzState.quartzInstanceId);
    const hostCard = cardById.get(quartzState.hostInstanceId);

    if (!quartzCard) {
      appendMissingReferenceIssue(
        issues,
        `quartzSetStates[${index}].quartzInstanceId`,
        "missing_quartz_set_card",
        quartzState.quartzInstanceId
      );
      continue;
    }

    if (!hostCard) {
      appendMissingReferenceIssue(
        issues,
        `quartzSetStates[${index}].hostInstanceId`,
        "missing_quartz_host_card",
        quartzState.hostInstanceId
      );
      continue;
    }
  }
}

export interface CoreInvariantContext {
  playerIds: Set<string>;
  cardById: Map<string, CardInstance>;
}

export function collectCoreGameStateInvariantIssues(
  state: GameState,
  issues: GameStateInvariantIssue[]
): CoreInvariantContext {
  const playerIds = new Set<string>();
  const cardById = new Map<string, CardInstance>();

  collectPlayerIssues(
    state,
    issues,
    playerIds,
    new Set(state.cardInstances.map((card) => card.instanceId))
  );
  collectPlayerOrderIssues(state, issues, playerIds);
  collectCardIssues(state, issues, playerIds, cardById);
  collectSoulCoreIssues(state, issues, cardById);
  collectSoulCoreCountConsistencyIssues(state, issues, cardById);
  collectPendingLeaveIssues(state, issues, cardById);
  collectBurstSetIssues(state, issues, playerIds, cardById);
  collectMirageSetIssues(state, issues, playerIds, cardById);

  return {
    playerIds,
    cardById,
  };
}
