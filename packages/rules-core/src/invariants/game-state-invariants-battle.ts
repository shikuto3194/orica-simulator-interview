import {
  appendDuplicateIssue,
  appendMissingReferenceIssue,
} from "./game-state-invariant-helpers";
import type { GameStateInvariantIssue } from "./game-state-invariant-types";
import type {
  ActiveStack,
  BattleEntity,
  CardInstance,
  GameState,
  BattleImmediateEffect,
  BattleResolutionGroup,
} from "../model";

function collectBattleEntityIssues(
  state: GameState,
  issues: GameStateInvariantIssue[],
  cardById: Map<string, CardInstance>
): void {
  const seenEntityIds = new Set<string>();
  const seenMemberIds = new Set<string>();

  for (const [index, battleEntity] of state.battleEntities.entries()) {
    collectSingleBattleEntityIssues(
      battleEntity,
      index,
      issues,
      cardById,
      seenEntityIds,
      seenMemberIds
    );
  }
}

function collectSingleBattleEntityIssues(
  battleEntity: BattleEntity,
  index: number,
  issues: GameStateInvariantIssue[],
  cardById: Map<string, CardInstance>,
  seenEntityIds: Set<string>,
  seenMemberIds: Set<string>
): void {
  if (seenEntityIds.has(battleEntity.entityId)) {
    appendDuplicateIssue(
      issues,
      `battleEntities[${index}].entityId`,
      "duplicate_battle_entity_id",
      battleEntity.entityId
    );
  }

  seenEntityIds.add(battleEntity.entityId);

  const localMemberIds = new Set<string>();

  for (const [
    memberIndex,
    memberInstanceId,
  ] of battleEntity.memberInstanceIds.entries()) {
    if (localMemberIds.has(memberInstanceId)) {
      appendDuplicateIssue(
        issues,
        `battleEntities[${index}].memberInstanceIds[${memberIndex}]`,
        "duplicate_battle_entity_member",
        memberInstanceId
      );
    }

    localMemberIds.add(memberInstanceId);

    const memberCard = cardById.get(memberInstanceId);

    if (!memberCard) {
      appendMissingReferenceIssue(
        issues,
        `battleEntities[${index}].memberInstanceIds[${memberIndex}]`,
        "missing_battle_entity_member",
        memberInstanceId
      );
      continue;
    }

    if (memberCard.zone !== "field") {
      issues.push({
        code: "battle_entity_member_not_on_field",
        path: `battleEntities[${index}].memberInstanceIds[${memberIndex}]`,
        message: `Battle entity member ${memberInstanceId} must be on the field`,
      });
    }

    if (seenMemberIds.has(memberInstanceId)) {
      appendDuplicateIssue(
        issues,
        `battleEntities[${index}].memberInstanceIds[${memberIndex}]`,
        "card_in_multiple_battle_entities",
        memberInstanceId
      );
    }

    seenMemberIds.add(memberInstanceId);
  }
}

function collectActiveAttackIssues(
  state: GameState,
  issues: GameStateInvariantIssue[]
): void {
  const battleEntityById = new Map(
    state.battleEntities.map((battleEntity) => [
      battleEntity.entityId,
      battleEntity,
    ])
  );
  const cardById = new Map(
    state.cardInstances.map((card) => [card.instanceId, card])
  );
  const playerIds = new Set(state.players.map((player) => player.id));
  const activeAttack = state.activeAttack;

  if (activeAttack === null) {
    for (const [index, battleEntity] of state.battleEntities.entries()) {
      if (
        battleEntity.attackState === "attacking" ||
        battleEntity.attackState === "blocking"
      ) {
        issues.push({
          code:
            battleEntity.attackState === "attacking"
              ? "attacking_battle_entity_without_active_attack"
              : "blocking_battle_entity_without_active_attack",
          path: `battleEntities[${index}].attackState`,
          message:
            "Battle entities marked as attacking or blocking must belong to activeAttack",
        });
      }
    }

    return;
  }

  if (activeAttack.participantEntityIds.length === 0) {
    issues.push({
      code: "active_attack_without_participants",
      path: "activeAttack.participantEntityIds",
      message: "activeAttack must contain at least one participant entity",
    });
  }

  if (
    !activeAttack.participantEntityIds.includes(activeAttack.primaryEntityId)
  ) {
    issues.push({
      code: "active_attack_primary_not_participant",
      path: "activeAttack.primaryEntityId",
      message: "activeAttack.primaryEntityId must be included in participants",
    });
  }

  if (
    activeAttack.groupMode === "single" &&
    activeAttack.participantEntityIds.length !== 1
  ) {
    issues.push({
      code: "active_attack_single_mode_mismatch",
      path: "activeAttack.groupMode",
      message: "single-mode activeAttack must contain exactly one participant",
    });
  }

  if (
    activeAttack.groupMode === "simultaneous" &&
    activeAttack.participantEntityIds.length < 2
  ) {
    issues.push({
      code: "active_attack_simultaneous_mode_mismatch",
      path: "activeAttack.groupMode",
      message:
        "simultaneous-mode activeAttack must contain at least two participants",
    });
  }

  const activeAttackTarget = activeAttack.target;

  if (activeAttackTarget.kind === "player") {
    if (
      !state.players.some((player) => player.id === activeAttackTarget.playerId)
    ) {
      appendMissingReferenceIssue(
        issues,
        "activeAttack.target.playerId",
        "missing_active_attack_target_player",
        activeAttackTarget.playerId
      );
    }
  } else if (!battleEntityById.has(activeAttackTarget.entityId)) {
    appendMissingReferenceIssue(
      issues,
      "activeAttack.target.entityId",
      "missing_active_attack_target_battle_entity",
      activeAttackTarget.entityId
    );
  }

  const seenParticipantEntityIds = new Set<string>();

  for (const [
    participantIndex,
    participantEntityId,
  ] of activeAttack.participantEntityIds.entries()) {
    if (seenParticipantEntityIds.has(participantEntityId)) {
      appendDuplicateIssue(
        issues,
        `activeAttack.participantEntityIds[${participantIndex}]`,
        "duplicate_active_attack_participant",
        participantEntityId
      );
      continue;
    }

    seenParticipantEntityIds.add(participantEntityId);

    const battleEntity = battleEntityById.get(participantEntityId);

    if (!battleEntity) {
      appendMissingReferenceIssue(
        issues,
        `activeAttack.participantEntityIds[${participantIndex}]`,
        "missing_active_attack_battle_entity",
        participantEntityId
      );
      continue;
    }

    if (battleEntity.attackState !== "attacking") {
      issues.push({
        code: "active_attack_participant_not_attacking",
        path: `activeAttack.participantEntityIds[${participantIndex}]`,
        message: `Battle entity ${participantEntityId} must be marked as attacking while it participates in activeAttack`,
      });
    }
  }

  if (
    activeAttack.symbolResolutionOrder.length !==
    activeAttack.participantEntityIds.length
  ) {
    issues.push({
      code: "active_attack_symbol_resolution_order_length_mismatch",
      path: "activeAttack.symbolResolutionOrder",
      message:
        "activeAttack.symbolResolutionOrder must include each participant exactly once",
    });
  }

  const seenSymbolResolutionEntityIds = new Set<string>();

  for (const [
    resolutionIndex,
    participantEntityId,
  ] of activeAttack.symbolResolutionOrder.entries()) {
    if (!activeAttack.participantEntityIds.includes(participantEntityId)) {
      issues.push({
        code: "active_attack_symbol_resolution_unknown_participant",
        path: `activeAttack.symbolResolutionOrder[${resolutionIndex}]`,
        message: `Symbol resolution entry ${participantEntityId} is not part of activeAttack participants`,
      });
      continue;
    }

    if (seenSymbolResolutionEntityIds.has(participantEntityId)) {
      appendDuplicateIssue(
        issues,
        `activeAttack.symbolResolutionOrder[${resolutionIndex}]`,
        "duplicate_active_attack_symbol_resolution_participant",
        participantEntityId
      );
      continue;
    }

    seenSymbolResolutionEntityIds.add(participantEntityId);
  }

  if (
    activeAttack.blockAssignments.length !==
    activeAttack.participantEntityIds.length
  ) {
    issues.push({
      code: "active_attack_block_assignment_length_mismatch",
      path: "activeAttack.blockAssignments",
      message:
        "activeAttack.blockAssignments must include each participant exactly once",
    });
  }

  const seenBlockAssignmentParticipants = new Set<string>();

  for (const [
    assignmentIndex,
    assignment,
  ] of activeAttack.blockAssignments.entries()) {
    if (
      !activeAttack.participantEntityIds.includes(
        assignment.participantEntityId
      )
    ) {
      issues.push({
        code: "active_attack_block_assignment_unknown_participant",
        path: `activeAttack.blockAssignments[${assignmentIndex}].participantEntityId`,
        message: `Block assignment participant ${assignment.participantEntityId} is not part of activeAttack participants`,
      });
      continue;
    }

    if (seenBlockAssignmentParticipants.has(assignment.participantEntityId)) {
      appendDuplicateIssue(
        issues,
        `activeAttack.blockAssignments[${assignmentIndex}].participantEntityId`,
        "duplicate_active_attack_block_assignment_participant",
        assignment.participantEntityId
      );
      continue;
    }

    seenBlockAssignmentParticipants.add(assignment.participantEntityId);

    let hasMissingBlockerReference = false;
    for (const blockerEntityId of assignment.blockedByEntityIds) {
      if (!battleEntityById.has(blockerEntityId)) {
        appendMissingReferenceIssue(
          issues,
          `activeAttack.blockAssignments[${assignmentIndex}].blockedByEntityIds`,
          "missing_active_attack_blocker_battle_entity",
          blockerEntityId
        );
        hasMissingBlockerReference = true;
        continue;
      }

      const blockerBattleEntity = battleEntityById.get(blockerEntityId);

      if (blockerBattleEntity?.attackState !== "blocking") {
        issues.push({
          code: "active_attack_blocker_not_blocking",
          path: `activeAttack.blockAssignments[${assignmentIndex}].blockedByEntityIds`,
          message: `Blocker battle entity ${blockerEntityId} must be marked as blocking while assigned`,
        });
      }
    }
    if (hasMissingBlockerReference) {
      continue;
    }
  }

  if (
    activeAttack.flashWindowState === null &&
    (state.window === "flash_before_block" ||
      state.window === "flash_after_block" ||
      state.window === "stack_before_block" ||
      state.window === "stack_after_block")
  ) {
    issues.push({
      code: "flash_window_without_active_attack_state",
      path: "activeAttack.flashWindowState",
      message:
        "flash window requires activeAttack.flashWindowState to be present",
    });
  }

  if (activeAttack.flashWindowState !== null) {
    const expectedWindow =
      activeAttack.flashWindowState.pendingStackAction !== null
        ? activeAttack.flashWindowState.kind === "before_block"
          ? "stack_before_block"
          : "stack_after_block"
        : activeAttack.flashWindowState.kind === "before_block"
          ? "flash_before_block"
          : "flash_after_block";

    if (state.window !== expectedWindow) {
      issues.push({
        code: "active_attack_flash_window_state_window_mismatch",
        path: "activeAttack.flashWindowState.kind",
        message:
          "activeAttack.flashWindowState.kind must match the current flash window",
      });
    }

    if (
      !state.players.some(
        (player) =>
          player.id === activeAttack.flashWindowState?.priorityPlayerId
      )
    ) {
      appendMissingReferenceIssue(
        issues,
        "activeAttack.flashWindowState.priorityPlayerId",
        "missing_active_attack_flash_priority_player",
        activeAttack.flashWindowState.priorityPlayerId
      );
    }

    if (
      activeAttack.flashWindowState.stackResponseSourcePlayerId !== null &&
      !state.players.some(
        (player) =>
          player.id ===
          activeAttack.flashWindowState?.stackResponseSourcePlayerId
      )
    ) {
      appendMissingReferenceIssue(
        issues,
        "activeAttack.flashWindowState.stackResponseSourcePlayerId",
        "missing_active_attack_flash_stack_response_source_player",
        activeAttack.flashWindowState.stackResponseSourcePlayerId
      );
    }

    // Battle flash 本体は 2-pass ループ (passCount 0 or 1)。
    // ただし内側 stack サブ窓 (pendingStackAction !== null) はスタック窓扱いで 1-pass クローズ
    // のため passCount は常に 0 でなければならない (2026-03-31 rule)。
    const flashPassCount = activeAttack.flashWindowState.consecutivePassCount;
    const hasPendingSubStack =
      activeAttack.flashWindowState.pendingStackAction !== null;
    if (hasPendingSubStack) {
      if (flashPassCount !== 0) {
        issues.push({
          code: "active_attack_flash_window_pass_count_out_of_range",
          path: "activeAttack.flashWindowState.consecutivePassCount",
          message:
            "flashWindowState.consecutivePassCount must be 0 when a stack sub-window is pending (1-pass close rule)",
        });
      }
    } else if (flashPassCount < 0 || flashPassCount > 1) {
      issues.push({
        code: "active_attack_flash_window_pass_count_out_of_range",
        path: "activeAttack.flashWindowState.consecutivePassCount",
        message:
          "activeAttack.flashWindowState.consecutivePassCount must stay between 0 and 1",
      });
    }

    collectPendingStackChainIssues({
      pendingStack: activeAttack.flashWindowState.pendingStackAction,
      basePath: "activeAttack.flashWindowState.pendingStackAction",
      issues,
      playerIds,
      cardById,
    });
  }
}

function collectPendingStackChainIssues(options: {
  pendingStack: ActiveStack | null | undefined;
  basePath: string;
  issues: GameStateInvariantIssue[];
  playerIds: Set<string>;
  cardById: Map<string, CardInstance>;
  requireCardReferenceOnly?: boolean;
}): void {
  const seenStackIds = new Set<string>();
  let current = options.pendingStack;
  let currentPath = options.basePath;

  while (current != null) {
    if (seenStackIds.has(current.stackId)) {
      options.issues.push({
        code: "pending_stack_cycle_detected",
        path: `${currentPath}.stackId`,
        message: `Pending stack chain must not contain cycles: ${current.stackId}`,
      });
      return;
    }

    seenStackIds.add(current.stackId);

    if (!options.playerIds.has(current.actingPlayerId)) {
      appendMissingReferenceIssue(
        options.issues,
        `${currentPath}.actingPlayerId`,
        "missing_player_reference",
        current.actingPlayerId
      );
    }

    if (
      current.previousResponseSourcePlayerId !== null &&
      !options.playerIds.has(current.previousResponseSourcePlayerId)
    ) {
      appendMissingReferenceIssue(
        options.issues,
        `${currentPath}.previousResponseSourcePlayerId`,
        "missing_player_reference",
        current.previousResponseSourcePlayerId
      );
    }

    const pendingCard = options.cardById.get(current.cardInstanceId);
    if (!pendingCard) {
      appendMissingReferenceIssue(
        options.issues,
        `${currentPath}.cardInstanceId`,
        "missing_card_reference",
        current.cardInstanceId
      );
    } else if (!options.requireCardReferenceOnly) {
      if (current.actionKind === "magic" && pendingCard.zone !== "in_use") {
        options.issues.push({
          code: "active_attack_flash_pending_magic_card_not_in_use",
          path: `${currentPath}.cardInstanceId`,
          message: `Magic card referenced by pending stack must be in in_use zone: ${current.cardInstanceId}`,
        });
      }

      // 【タイプ：作戦】は場のマジックを「使用する」ため、field_card_effect であっても
      // 宣言後は magic と同じ in_use ライフサイクルに入る。applicabilityEvaluationZone
      // はこの経路だけが宣言時の field を保持するため、一般の field effect を緩めずに
      // 正当な operation magic stack を許可できる。
      const isOperationMagicFieldUseInProgress =
        current.actionKind === "field_card_effect" &&
        current.fieldEffectSourceKind === "magic" &&
        current.applicabilityEvaluationZone === "field" &&
        pendingCard.zone === "in_use";
      // 【セット中】の起動効果は field_card_effect の宣言/スタック/解決経路を通るが、
      // 発揮元はミラージュゾーンに残る。宣言時 snapshot が mirage のものだけを
      // 許可し、通常の field effect を場外へ緩めない。
      const isMirageSetFieldEffectInProgress =
        current.actionKind === "field_card_effect" &&
        current.sourceActivationZone === "mirage" &&
        pendingCard.zone === "mirage";
      if (
        current.actionKind === "field_card_effect" &&
        pendingCard.zone !== "field" &&
        !isOperationMagicFieldUseInProgress &&
        !isMirageSetFieldEffectInProgress
      ) {
        options.issues.push({
          code: "active_attack_flash_pending_field_effect_card_not_on_field",
          path: `${currentPath}.cardInstanceId`,
          message: `Field effect card referenced by pending stack must be on field: ${current.cardInstanceId}`,
        });
      }
    }

    current = current.previousPendingStackAction;
    currentPath = `${currentPath}.previousPendingStackAction`;
  }
}

function collectBattleImmediateEffectIssues(
  state: GameState,
  issues: GameStateInvariantIssue[],
  playerIds: Set<string>,
  cardById: Map<string, CardInstance>
): void {
  const activeAttack = state.activeAttack;
  const seenPromptIds = new Set<string>();

  for (const [index, prompt] of state.battleImmediateEffects.entries()) {
    collectSingleBattleImmediateEffectIssues(
      state,
      issues,
      playerIds,
      cardById,
      activeAttack,
      seenPromptIds,
      prompt,
      index
    );
  }
}

function collectSingleBattleImmediateEffectIssues(
  state: GameState,
  issues: GameStateInvariantIssue[],
  playerIds: Set<string>,
  cardById: Map<string, CardInstance>,
  activeAttack: GameState["activeAttack"],
  seenPromptIds: Set<string>,
  prompt: BattleImmediateEffect,
  index: number
): void {
  if (seenPromptIds.has(prompt.promptId)) {
    appendDuplicateIssue(
      issues,
      `battleImmediateEffects[${index}].promptId`,
      "duplicate_battle_immediate_effect_prompt_id",
      prompt.promptId
    );
  }

  seenPromptIds.add(prompt.promptId);

  if (!playerIds.has(prompt.actingPlayerId)) {
    appendMissingReferenceIssue(
      issues,
      `battleImmediateEffects[${index}].actingPlayerId`,
      "missing_battle_immediate_effect_player",
      prompt.actingPlayerId
    );
  }

  const sourceCard = cardById.get(prompt.sourceInstanceId);

  if (!sourceCard) {
    appendMissingReferenceIssue(
      issues,
      `battleImmediateEffects[${index}].sourceInstanceId`,
      "missing_battle_immediate_effect_source_card",
      prompt.sourceInstanceId
    );
    return;
  }

  if (sourceCard.definitionId !== prompt.sourceDefinitionId) {
    issues.push({
      code: "battle_immediate_effect_source_definition_mismatch",
      path: `battleImmediateEffects[${index}].sourceDefinitionId`,
      message: `Battle immediate effect prompt ${prompt.promptId} does not match source card definition`,
    });
  }

  if (activeAttack === null) {
    issues.push({
      code: "battle_immediate_effect_without_active_attack",
      path: `battleImmediateEffects[${index}].attackId`,
      message:
        "Battle immediate effect prompts must belong to an active attack",
    });
    return;
  }

  if (prompt.attackId !== activeAttack.attackId) {
    issues.push({
      code: "battle_immediate_effect_attack_id_mismatch",
      path: `battleImmediateEffects[${index}].attackId`,
      message: `Battle immediate effect prompt ${prompt.promptId} does not match activeAttack.attackId`,
    });
  }

  if (!activeAttack.participantEntityIds.includes(prompt.participantEntityId)) {
    appendMissingReferenceIssue(
      issues,
      `battleImmediateEffects[${index}].participantEntityId`,
      "missing_battle_immediate_effect_participant",
      prompt.participantEntityId
    );
  }

  if (state.step !== "attack") {
    issues.push({
      code: "battle_immediate_effect_outside_attack_step",
      path: `battleImmediateEffects[${index}]`,
      message:
        "Battle immediate effect prompts are only valid during attack step",
    });
  }
}

function collectBattleResolutionGroupIssues(
  state: GameState,
  issues: GameStateInvariantIssue[]
): void {
  const battleResolutionGroup = state.battleResolutionGroup;

  if (battleResolutionGroup === null) {
    return;
  }

  const activeAttack = state.activeAttack;

  if (activeAttack === null) {
    issues.push({
      code: "battle_resolution_group_without_active_attack",
      path: "battleResolutionGroup",
      message:
        "battleResolutionGroup must belong to an activeAttack while it exists",
    });
    return;
  }

  if (state.window !== "battle_resolution") {
    issues.push({
      code: "battle_resolution_group_outside_battle_resolution_window",
      path: "battleResolutionGroup",
      message:
        "battleResolutionGroup is only valid while window=battle_resolution",
    });
  }

  collectSingleBattleResolutionGroupIssues(
    battleResolutionGroup,
    activeAttack,
    issues
  );
}

function collectSingleBattleResolutionGroupIssues(
  battleResolutionGroup: BattleResolutionGroup,
  activeAttack: NonNullable<GameState["activeAttack"]>,
  issues: GameStateInvariantIssue[]
): void {
  if (battleResolutionGroup.attackId !== activeAttack.attackId) {
    issues.push({
      code: "battle_resolution_group_attack_id_mismatch",
      path: "battleResolutionGroup.attackId",
      message:
        "battleResolutionGroup.attackId must match activeAttack.attackId",
    });
  }

  if (
    battleResolutionGroup.participantSnapshots.length !==
    activeAttack.participantEntityIds.length
  ) {
    issues.push({
      code: "battle_resolution_group_participant_length_mismatch",
      path: "battleResolutionGroup.participantSnapshots",
      message:
        "battleResolutionGroup.participantSnapshots must include each participant exactly once",
    });
  }

  const snapshotEntityIds = battleResolutionGroup.participantSnapshots.map(
    (snapshot) => snapshot.entityId
  );

  for (const participantEntityId of activeAttack.participantEntityIds) {
    if (!snapshotEntityIds.includes(participantEntityId)) {
      appendMissingReferenceIssue(
        issues,
        "battleResolutionGroup.participantSnapshots",
        "missing_battle_resolution_group_participant",
        participantEntityId
      );
    }
  }
}

function collectPreDeclarationStackWindowIssues(
  state: GameState,
  issues: GameStateInvariantIssue[],
  playerIds: Set<string>,
  cardById: Map<string, CardInstance>
): void {
  const win = state.preDeclarationStackWindow;

  if (win === null) {
    return;
  }

  if (!playerIds.has(win.actingPlayerId)) {
    appendMissingReferenceIssue(
      issues,
      "preDeclarationStackWindow.actingPlayerId",
      "missing_player_reference",
      win.actingPlayerId
    );
  }

  if (!playerIds.has(win.priorityPlayerId)) {
    appendMissingReferenceIssue(
      issues,
      "preDeclarationStackWindow.priorityPlayerId",
      "missing_player_reference",
      win.priorityPlayerId
    );
  }

  const sourceCard = cardById.get(win.sourceInstanceId);

  if (!sourceCard) {
    appendMissingReferenceIssue(
      issues,
      "preDeclarationStackWindow.sourceInstanceId",
      "missing_card_reference",
      win.sourceInstanceId
    );
  }

  if (!playerIds.has(win.stackResponseSourcePlayerId)) {
    appendMissingReferenceIssue(
      issues,
      "preDeclarationStackWindow.stackResponseSourcePlayerId",
      "missing_player_reference",
      win.stackResponseSourcePlayerId
    );
  }

  collectPendingStackChainIssues({
    pendingStack: win.pendingStackAction,
    basePath: "preDeclarationStackWindow.pendingStackAction",
    issues,
    playerIds,
    cardById,
    requireCardReferenceOnly: true,
  });
}

export function collectBattleGameStateInvariantIssues(options: {
  state: GameState;
  issues: GameStateInvariantIssue[];
  playerIds: Set<string>;
  cardById: Map<string, CardInstance>;
}): void {
  collectBattleEntityIssues(options.state, options.issues, options.cardById);
  collectActiveAttackIssues(options.state, options.issues);
  collectBattleImmediateEffectIssues(
    options.state,
    options.issues,
    options.playerIds,
    options.cardById
  );
  collectBattleResolutionGroupIssues(options.state, options.issues);
  collectPreDeclarationStackWindowIssues(
    options.state,
    options.issues,
    options.playerIds,
    options.cardById
  );
}
