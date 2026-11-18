import { AI_OBSERVATION_SCHEMA_VERSION } from "./ai-observation";
import { PLAYER_DECISION_NODE_KINDS } from "./player-decision-contract";
import { TRAINING_REPLAY_SAMPLE_SCHEMA_VERSION } from "./training-replay-buffer";

export interface TrainingArtifactValidationIssue {
  path: string;
  message: string;
}

export interface TrainingArtifactValidationResult {
  ok: boolean;
  issues: TrainingArtifactValidationIssue[];
}

function issue(path: string, message: string): TrainingArtifactValidationIssue {
  return { path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushStringIssue(
  issues: TrainingArtifactValidationIssue[],
  path: string,
  value: unknown
): void {
  if (typeof value !== "string") {
    issues.push(issue(path, "must be a string"));
  }
}

function pushNumberIssue(
  issues: TrainingArtifactValidationIssue[],
  path: string,
  value: unknown
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(issue(path, "must be a finite number"));
  }
}

function pushIntegerIssue(
  issues: TrainingArtifactValidationIssue[],
  path: string,
  value: unknown
): void {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    issues.push(issue(path, "must be an integer"));
  }
}

function pushBooleanIssue(
  issues: TrainingArtifactValidationIssue[],
  path: string,
  value: unknown
): void {
  if (typeof value !== "boolean") {
    issues.push(issue(path, "must be a boolean"));
  }
}

function pushStringOrNullIssue(
  issues: TrainingArtifactValidationIssue[],
  path: string,
  value: unknown
): void {
  if (typeof value !== "string" && value !== null) {
    issues.push(issue(path, "must be a string or null"));
  }
}

function pushArrayIssue(
  issues: TrainingArtifactValidationIssue[],
  path: string,
  value: unknown
): value is unknown[] {
  if (!Array.isArray(value)) {
    issues.push(issue(path, "must be an array"));
    return false;
  }
  return true;
}

function pushRecordIssue(
  issues: TrainingArtifactValidationIssue[],
  path: string,
  value: unknown
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    issues.push(issue(path, "must be an object"));
    return false;
  }
  return true;
}

function validateTraceEntry(
  value: unknown,
  path: string,
  issues: TrainingArtifactValidationIssue[]
): void {
  if (!pushRecordIssue(issues, path, value)) return;
  pushNumberIssue(issues, `${path}.step`, value.step);
  pushStringIssue(issues, `${path}.nodeKind`, value.nodeKind);
  if (
    typeof value.nodeKind === "string" &&
    !PLAYER_DECISION_NODE_KINDS.includes(
      value.nodeKind as (typeof PLAYER_DECISION_NODE_KINDS)[number]
    )
  ) {
    issues.push(issue(`${path}.nodeKind`, "is not a known decision node kind"));
  }
  pushStringIssue(issues, `${path}.actingPlayerId`, value.actingPlayerId);
  pushStringIssue(issues, `${path}.choiceId`, value.choiceId);
  pushNumberIssue(issues, `${path}.choiceCount`, value.choiceCount);
  if (!pushArrayIssue(issues, `${path}.fields`, value.fields)) return;
  for (const [index, field] of value.fields.entries()) {
    pushStringIssue(issues, `${path}.fields[${index}]`, field);
  }
}

function validateDecisionNode(
  value: unknown,
  path: string,
  issues: TrainingArtifactValidationIssue[]
): void {
  if (!pushRecordIssue(issues, path, value)) return;
  pushStringIssue(issues, `${path}.nodeId`, value.nodeId);
  pushStringIssue(issues, `${path}.kind`, value.kind);
  if (
    typeof value.kind === "string" &&
    !PLAYER_DECISION_NODE_KINDS.includes(
      value.kind as (typeof PLAYER_DECISION_NODE_KINDS)[number]
    )
  ) {
    issues.push(issue(`${path}.kind`, "is not a known decision node kind"));
  }
  pushStringIssue(issues, `${path}.actingPlayerId`, value.actingPlayerId);
  pushArrayIssue(issues, `${path}.fields`, value.fields);
  if (pushArrayIssue(issues, `${path}.choices`, value.choices)) {
    if (value.choices.length === 0) {
      issues.push(issue(`${path}.choices`, "must not be empty"));
    }
    for (const [index, choice] of value.choices.entries()) {
      if (!pushRecordIssue(issues, `${path}.choices[${index}]`, choice)) {
        continue;
      }
      pushStringIssue(
        issues,
        `${path}.choices[${index}].choiceId`,
        choice.choiceId
      );
      pushStringIssue(issues, `${path}.choices[${index}].label`, choice.label);
    }
  }
}

function validateObservation(
  value: unknown,
  path: string,
  issues: TrainingArtifactValidationIssue[]
): void {
  if (!pushRecordIssue(issues, path, value)) return;
  if (value.schemaVersion !== AI_OBSERVATION_SCHEMA_VERSION) {
    issues.push(
      issue(`${path}.schemaVersion`, `must be ${AI_OBSERVATION_SCHEMA_VERSION}`)
    );
  }
  pushStringIssue(issues, `${path}.mode`, value.mode);
  pushStringIssue(issues, `${path}.viewpointPlayerId`, value.viewpointPlayerId);
  pushRecordIssue(issues, `${path}.global`, value.global);
  pushArrayIssue(issues, `${path}.players`, value.players);
  pushArrayIssue(issues, `${path}.cards`, value.cards);
  pushRecordIssue(issues, `${path}.publicMemory`, value.publicMemory);
  pushArrayIssue(issues, `${path}.knownDeck`, value.knownDeck);
  pushRecordIssue(issues, `${path}.pending`, value.pending);
}

export function validateTrainingTraceSmokeFrameRecord(
  value: unknown,
  path = "frame"
): TrainingArtifactValidationResult {
  const issues: TrainingArtifactValidationIssue[] = [];
  if (!pushRecordIssue(issues, path, value)) return { ok: false, issues };
  if ("state" in value) {
    issues.push(issue(`${path}.state`, "must be omitted from frames.jsonl"));
  }
  pushNumberIssue(issues, `${path}.gameIndex`, value.gameIndex);
  pushNumberIssue(issues, `${path}.frameIndex`, value.frameIndex);
  pushStringIssue(issues, `${path}.stateHash`, value.stateHash);
  pushStringIssue(issues, `${path}.observationHash`, value.observationHash);
  validateObservation(value.observation, `${path}.observation`, issues);
  validateDecisionNode(value.node, `${path}.node`, issues);
  validateTraceEntry(value.selected, `${path}.selected`, issues);
  return { ok: issues.length === 0, issues };
}

export function validateTrainingTraceReplayArtifact(
  value: unknown,
  path = "replay"
): TrainingArtifactValidationResult {
  const issues: TrainingArtifactValidationIssue[] = [];
  if (!pushRecordIssue(issues, path, value)) return { ok: false, issues };
  if (value.schemaVersion !== 1) {
    issues.push(issue(`${path}.schemaVersion`, "must be 1"));
  }
  pushStringIssue(issues, `${path}.title`, value.title);
  if (pushArrayIssue(issues, `${path}.frames`, value.frames)) {
    if (value.frames.length === 0) {
      issues.push(issue(`${path}.frames`, "must not be empty"));
    }
    for (const [index, frame] of value.frames.entries()) {
      if (!pushRecordIssue(issues, `${path}.frames[${index}]`, frame)) {
        continue;
      }
      pushRecordIssue(issues, `${path}.frames[${index}].state`, frame.state);
      pushStringIssue(issues, `${path}.frames[${index}].label`, frame.label);
      if (frame.traceEntry !== undefined) {
        validateTraceEntry(
          frame.traceEntry,
          `${path}.frames[${index}].traceEntry`,
          issues
        );
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export function validateTrainingTraceSmokeSummaryArtifact(
  value: unknown,
  path = "metrics"
): TrainingArtifactValidationResult {
  const issues: TrainingArtifactValidationIssue[] = [];
  if (!pushRecordIssue(issues, path, value)) return { ok: false, issues };
  if (value.schemaVersion !== 1) {
    issues.push(issue(`${path}.schemaVersion`, "must be 1"));
  }
  pushStringIssue(issues, `${path}.experimentId`, value.experimentId);
  pushStringIssue(issues, `${path}.createdAt`, value.createdAt);
  pushStringIssue(issues, `${path}.outputDir`, value.outputDir);
  pushRecordIssue(issues, `${path}.config`, value.config);
  pushRecordIssue(issues, `${path}.aggregate`, value.aggregate);
  if (pushArrayIssue(issues, `${path}.games`, value.games)) {
    for (const [index, game] of value.games.entries()) {
      if (!pushRecordIssue(issues, `${path}.games[${index}]`, game)) {
        continue;
      }
      pushNumberIssue(
        issues,
        `${path}.games[${index}].gameIndex`,
        game.gameIndex
      );
      pushNumberIssue(issues, `${path}.games[${index}].seed`, game.seed);
      pushStringIssue(issues, `${path}.games[${index}].outcome`, game.outcome);
      pushNumberIssue(issues, `${path}.games[${index}].steps`, game.steps);
      pushNumberIssue(
        issues,
        `${path}.games[${index}].decisionFrames`,
        game.decisionFrames
      );
      pushStringIssue(
        issues,
        `${path}.games[${index}].replayFile`,
        game.replayFile
      );
    }
  }
  return { ok: issues.length === 0, issues };
}

function validateTrainingReplayPolicyTarget(
  value: unknown,
  node: unknown,
  path: string,
  issues: TrainingArtifactValidationIssue[]
): void {
  if (!pushRecordIssue(issues, path, value)) return;
  pushStringIssue(issues, `${path}.selectedChoiceId`, value.selectedChoiceId);
  pushIntegerIssue(
    issues,
    `${path}.selectedChoiceIndex`,
    value.selectedChoiceIndex
  );
  pushIntegerIssue(issues, `${path}.choiceCount`, value.choiceCount);
  if (pushArrayIssue(issues, `${path}.distribution`, value.distribution)) {
    for (const [index, probability] of value.distribution.entries()) {
      pushNumberIssue(issues, `${path}.distribution[${index}]`, probability);
    }
    if (
      typeof value.choiceCount === "number" &&
      value.distribution.length !== value.choiceCount
    ) {
      issues.push(
        issue(`${path}.distribution`, "length must match choiceCount")
      );
    }
  }

  if (
    isRecord(node) &&
    Array.isArray(node.choices) &&
    typeof value.selectedChoiceIndex === "number" &&
    Number.isInteger(value.selectedChoiceIndex)
  ) {
    const choice = node.choices[value.selectedChoiceIndex];
    if (!isRecord(choice)) {
      issues.push(issue(`${path}.selectedChoiceIndex`, "is out of range"));
    } else if (
      typeof value.selectedChoiceId === "string" &&
      choice.choiceId !== value.selectedChoiceId
    ) {
      issues.push(
        issue(
          `${path}.selectedChoiceId`,
          "must match node.choices[selectedChoiceIndex].choiceId"
        )
      );
    }
    if (
      typeof value.choiceCount === "number" &&
      node.choices.length !== value.choiceCount
    ) {
      issues.push(issue(`${path}.choiceCount`, "must match node choices"));
    }
  }
}

function validateTrainingReplayValueTarget(
  value: unknown,
  path: string,
  issues: TrainingArtifactValidationIssue[]
): void {
  if (!pushRecordIssue(issues, path, value)) return;
  pushStringIssue(issues, `${path}.outcome`, value.outcome);
  pushStringOrNullIssue(issues, `${path}.winner`, value.winner);
  pushStringIssue(issues, `${path}.result`, value.result);
  if (
    typeof value.result === "string" &&
    !["win", "loss", "draw", "unresolved"].includes(value.result)
  ) {
    issues.push(issue(`${path}.result`, "is not a known value result"));
  }
  pushNumberIssue(issues, `${path}.value`, value.value);
  if (
    typeof value.value === "number" &&
    (value.value < -1 || value.value > 1)
  ) {
    issues.push(issue(`${path}.value`, "must be between -1 and 1"));
  }
  pushBooleanIssue(
    issues,
    `${path}.terminalOutcomeKnown`,
    value.terminalOutcomeKnown
  );
}

function validateTrainingReplayWeights(
  value: unknown,
  path: string,
  issues: TrainingArtifactValidationIssue[]
): void {
  if (!pushRecordIssue(issues, path, value)) return;
  pushNumberIssue(issues, `${path}.policy`, value.policy);
  pushNumberIssue(issues, `${path}.value`, value.value);
}

export function validateTrainingReplaySampleRecord(
  value: unknown,
  path = "sample"
): TrainingArtifactValidationResult {
  const issues: TrainingArtifactValidationIssue[] = [];
  if (!pushRecordIssue(issues, path, value)) return { ok: false, issues };
  if ("state" in value) {
    issues.push(issue(`${path}.state`, "must be omitted from replay samples"));
  }
  if (value.schemaVersion !== TRAINING_REPLAY_SAMPLE_SCHEMA_VERSION) {
    issues.push(
      issue(
        `${path}.schemaVersion`,
        `must be ${TRAINING_REPLAY_SAMPLE_SCHEMA_VERSION}`
      )
    );
  }
  pushStringIssue(issues, `${path}.sampleId`, value.sampleId);
  pushStringIssue(issues, `${path}.gameId`, value.gameId);
  pushIntegerIssue(issues, `${path}.gameIndex`, value.gameIndex);
  pushIntegerIssue(issues, `${path}.seed`, value.seed);
  pushIntegerIssue(issues, `${path}.frameIndex`, value.frameIndex);
  pushIntegerIssue(issues, `${path}.step`, value.step);
  pushStringIssue(issues, `${path}.stateHash`, value.stateHash);
  pushStringIssue(issues, `${path}.observationHash`, value.observationHash);
  pushStringIssue(issues, `${path}.actingPlayerId`, value.actingPlayerId);
  pushStringIssue(issues, `${path}.nodeKind`, value.nodeKind);
  if (
    typeof value.nodeKind === "string" &&
    !PLAYER_DECISION_NODE_KINDS.includes(
      value.nodeKind as (typeof PLAYER_DECISION_NODE_KINDS)[number]
    )
  ) {
    issues.push(issue(`${path}.nodeKind`, "is not a known decision node kind"));
  }
  if (value.actionKind !== undefined) {
    pushStringIssue(issues, `${path}.actionKind`, value.actionKind);
  }
  if (value.systemActionKind !== undefined) {
    pushStringIssue(issues, `${path}.systemActionKind`, value.systemActionKind);
  }
  if (pushArrayIssue(issues, `${path}.fields`, value.fields)) {
    for (const [index, field] of value.fields.entries()) {
      pushStringIssue(issues, `${path}.fields[${index}]`, field);
    }
  }
  pushBooleanIssue(issues, `${path}.truncated`, value.truncated);
  validateObservation(value.observation, `${path}.observation`, issues);
  validateDecisionNode(value.node, `${path}.node`, issues);
  validateTraceEntry(value.selected, `${path}.selected`, issues);
  validateTrainingReplayPolicyTarget(
    value.policyTarget,
    value.node,
    `${path}.policyTarget`,
    issues
  );
  validateTrainingReplayValueTarget(
    value.valueTarget,
    `${path}.valueTarget`,
    issues
  );
  validateTrainingReplayWeights(value.weights, `${path}.weights`, issues);

  if (
    isRecord(value.selected) &&
    typeof value.nodeKind === "string" &&
    value.selected.nodeKind !== value.nodeKind
  ) {
    issues.push(issue(`${path}.nodeKind`, "must match selected.nodeKind"));
  }
  if (
    isRecord(value.selected) &&
    typeof value.actingPlayerId === "string" &&
    value.selected.actingPlayerId !== value.actingPlayerId
  ) {
    issues.push(
      issue(`${path}.actingPlayerId`, "must match selected.actingPlayerId")
    );
  }
  return { ok: issues.length === 0, issues };
}

export function assertTrainingArtifactValid(
  result: TrainingArtifactValidationResult
): void {
  if (result.ok) return;
  const detail = result.issues
    .map(
      (validationIssue) => `${validationIssue.path}: ${validationIssue.message}`
    )
    .join("\n");
  throw new Error(`Training artifact validation failed:\n${detail}`);
}
