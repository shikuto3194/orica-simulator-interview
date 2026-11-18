import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export const TRAINING_RUN_CONFIG_SCHEMA_VERSION = 1;

export const TRAINING_RUN_PROFILES = [
  "trace-smoke",
  "rollout-baseline",
  "effect-debug-harvest",
  "policy-bootstrap",
  "position-bias-diagnose",
] as const;

export const TRAINING_RUN_AGENTS = [
  "random",
  "heuristic",
  "mcts",
  "policy",
] as const;
export const TRAINING_DECK_SELECTION_SETS = [
  "bootstrapSmoke",
  "policyBootstrap",
  "gauntletCore",
  "gauntletExtended",
  "robustnessOnly",
] as const;

export type TrainingRunProfile = (typeof TRAINING_RUN_PROFILES)[number];
export type TrainingRunAgentName = (typeof TRAINING_RUN_AGENTS)[number];
export type TrainingDeckSelectionSetName =
  (typeof TRAINING_DECK_SELECTION_SETS)[number];

export interface TrainingRunConfig {
  schemaVersion: typeof TRAINING_RUN_CONFIG_SCHEMA_VERSION;
  profile: TrainingRunProfile;
  experimentId?: string;
  seed?: number;
  games?: number;
  maxSteps?: number;
  maxForcedTransitions?: number;
  maxRepeatedStateTransitions?: number;
  maxGameDurationMs?: number;
  maxGameDurationRetries?: number;
  maxGameDurationMultiplier?: number;
  maxGameDurationCeilingMs?: number;
  maxReplacementGames?: number;
  maxGeneratedChoices?: number;
  deckSize?: number;
  deckStrategy?: "random" | "coverage_guided";
  focusCardCount?: number;
  skipPreGame?: boolean;
  outDir?: string;
  wideChoiceThreshold?: number;
  dryRun?: boolean;
  hiddenDim?: number;
  batchSize?: number;
  maxCards?: number;
  maxKnownDeckEntries?: number;
  maxChoices?: number;
  deckSelectionPath?: string;
  deckSet?: TrainingDeckSelectionSetName;
  checkpointIn?: string;
  checkpointOut?: string;
  policyCheckpointPath?: string;
  learningRate?: number;
  epochs?: number;
  gradientClipNorm?: number;
  explorationRate?: number;
  policyExplorationRate?: number;
  writeTrace?: boolean;
  agents?: {
    agentA?: TrainingRunAgentName;
    agentB?: TrainingRunAgentName;
  };
}

export interface LoadedTrainingRunConfig {
  configPath: string;
  configDir: string;
  config: TrainingRunConfig;
}

export interface TrainingRunArtifactConfigBase {
  profile: TrainingRunProfile;
  configPath: string | null;
  commitHash: string;
  games: number;
  maxSteps: number;
  maxForcedTransitions: number;
  maxRepeatedStateTransitions: number;
  seed: number;
  maxGeneratedChoices: number;
  deckSize: number;
  skipPreGame: boolean;
}

type OptionRecord = Record<string, unknown>;

const CONFIG_KEYS = new Set([
  "schemaVersion",
  "profile",
  "experimentId",
  "seed",
  "games",
  "maxSteps",
  "maxForcedTransitions",
  "maxRepeatedStateTransitions",
  "maxGameDurationMs",
  "maxGameDurationRetries",
  "maxGameDurationMultiplier",
  "maxGameDurationCeilingMs",
  "maxReplacementGames",
  "maxGeneratedChoices",
  "deckSize",
  "deckStrategy",
  "focusCardCount",
  "skipPreGame",
  "outDir",
  "wideChoiceThreshold",
  "dryRun",
  "hiddenDim",
  "batchSize",
  "maxCards",
  "maxKnownDeckEntries",
  "maxChoices",
  "deckSelectionPath",
  "deckSet",
  "checkpointIn",
  "checkpointOut",
  "policyCheckpointPath",
  "learningRate",
  "epochs",
  "gradientClipNorm",
  "explorationRate",
  "policyExplorationRate",
  "writeTrace",
  "agents",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string, path: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `${path}: invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
  if (!isRecord(value)) {
    throw new Error(`${path}: config must be a JSON object`);
  }
  return value;
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  path: string
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${path}.${key} must be a string`);
  }
  return value;
}

function requireNumber(
  record: Record<string, unknown>,
  key: string,
  path: string
): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path}.${key} must be a finite number`);
  }
  return value;
}

function requireBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string
): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`${path}.${key} must be a boolean`);
  }
  return value;
}

function parseProfile(value: unknown, path: string): TrainingRunProfile {
  if (
    typeof value === "string" &&
    TRAINING_RUN_PROFILES.includes(value as TrainingRunProfile)
  ) {
    return value as TrainingRunProfile;
  }
  throw new Error(
    `${path}.profile must be one of ${TRAINING_RUN_PROFILES.join(", ")}`
  );
}

function parseAgent(value: unknown, path: string): TrainingRunAgentName {
  if (
    typeof value === "string" &&
    TRAINING_RUN_AGENTS.includes(value as TrainingRunAgentName)
  ) {
    return value as TrainingRunAgentName;
  }
  throw new Error(`${path} must be one of ${TRAINING_RUN_AGENTS.join(", ")}`);
}

function parseDeckSet(
  value: unknown,
  path: string
): TrainingDeckSelectionSetName {
  if (
    typeof value === "string" &&
    TRAINING_DECK_SELECTION_SETS.includes(value as TrainingDeckSelectionSetName)
  ) {
    return value as TrainingDeckSelectionSetName;
  }
  throw new Error(
    `${path} must be one of ${TRAINING_DECK_SELECTION_SETS.join(", ")}`
  );
}

function parseAgents(
  record: Record<string, unknown>,
  path: string
): TrainingRunConfig["agents"] | undefined {
  const value = record.agents;
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${path}.agents must be an object`);
  const agents: NonNullable<TrainingRunConfig["agents"]> = {};
  if (value.agentA !== undefined) {
    agents.agentA = parseAgent(value.agentA, `${path}.agents.agentA`);
  }
  if (value.agentB !== undefined) {
    agents.agentB = parseAgent(value.agentB, `${path}.agents.agentB`);
  }
  return agents;
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  path: string
): void {
  for (const key of Object.keys(record)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(`${path}.${key} is not a supported config key`);
    }
  }
}

function parseTrainingRunConfig(
  record: Record<string, unknown>,
  path: string
): TrainingRunConfig {
  rejectUnknownKeys(record, path);
  if (record.schemaVersion !== TRAINING_RUN_CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `${path}.schemaVersion must be ${TRAINING_RUN_CONFIG_SCHEMA_VERSION}`
    );
  }
  const config: TrainingRunConfig = {
    schemaVersion: TRAINING_RUN_CONFIG_SCHEMA_VERSION,
    profile: parseProfile(record.profile, path),
  };
  assignIfDefined(
    config,
    "experimentId",
    requireString(record, "experimentId", path)
  );
  assignIfDefined(config, "seed", requireNumber(record, "seed", path));
  assignIfDefined(config, "games", requireNumber(record, "games", path));
  assignIfDefined(config, "maxSteps", requireNumber(record, "maxSteps", path));
  assignIfDefined(
    config,
    "maxForcedTransitions",
    requireNumber(record, "maxForcedTransitions", path)
  );
  assignIfDefined(
    config,
    "maxRepeatedStateTransitions",
    requireNumber(record, "maxRepeatedStateTransitions", path)
  );
  assignIfDefined(
    config,
    "maxGameDurationMs",
    requireNumber(record, "maxGameDurationMs", path)
  );
  assignIfDefined(
    config,
    "maxGameDurationRetries",
    requireNumber(record, "maxGameDurationRetries", path)
  );
  assignIfDefined(
    config,
    "maxGameDurationMultiplier",
    requireNumber(record, "maxGameDurationMultiplier", path)
  );
  assignIfDefined(
    config,
    "maxGameDurationCeilingMs",
    requireNumber(record, "maxGameDurationCeilingMs", path)
  );
  assignIfDefined(
    config,
    "maxReplacementGames",
    requireNumber(record, "maxReplacementGames", path)
  );
  assignIfDefined(
    config,
    "maxGeneratedChoices",
    requireNumber(record, "maxGeneratedChoices", path)
  );
  assignIfDefined(config, "deckSize", requireNumber(record, "deckSize", path));
  if (record.deckStrategy !== undefined) {
    const deckStrategy = requireString(record, "deckStrategy", path);
    if (deckStrategy !== "random" && deckStrategy !== "coverage_guided") {
      throw new Error(`${path}.deckStrategy must be random or coverage_guided`);
    }
    config.deckStrategy = deckStrategy;
  }
  assignIfDefined(
    config,
    "focusCardCount",
    requireNumber(record, "focusCardCount", path)
  );
  assignIfDefined(
    config,
    "skipPreGame",
    requireBoolean(record, "skipPreGame", path)
  );
  assignIfDefined(config, "outDir", requireString(record, "outDir", path));
  assignIfDefined(
    config,
    "wideChoiceThreshold",
    requireNumber(record, "wideChoiceThreshold", path)
  );
  assignIfDefined(config, "dryRun", requireBoolean(record, "dryRun", path));
  assignIfDefined(
    config,
    "hiddenDim",
    requireNumber(record, "hiddenDim", path)
  );
  assignIfDefined(
    config,
    "batchSize",
    requireNumber(record, "batchSize", path)
  );
  assignIfDefined(config, "maxCards", requireNumber(record, "maxCards", path));
  assignIfDefined(
    config,
    "maxKnownDeckEntries",
    requireNumber(record, "maxKnownDeckEntries", path)
  );
  assignIfDefined(
    config,
    "maxChoices",
    requireNumber(record, "maxChoices", path)
  );
  assignIfDefined(
    config,
    "deckSelectionPath",
    requireString(record, "deckSelectionPath", path)
  );
  if (record.deckSet !== undefined) {
    config.deckSet = parseDeckSet(record.deckSet, `${path}.deckSet`);
  }
  assignIfDefined(
    config,
    "checkpointIn",
    requireString(record, "checkpointIn", path)
  );
  assignIfDefined(
    config,
    "checkpointOut",
    requireString(record, "checkpointOut", path)
  );
  assignIfDefined(
    config,
    "policyCheckpointPath",
    requireString(record, "policyCheckpointPath", path)
  );
  assignIfDefined(
    config,
    "learningRate",
    requireNumber(record, "learningRate", path)
  );
  assignIfDefined(config, "epochs", requireNumber(record, "epochs", path));
  assignIfDefined(
    config,
    "gradientClipNorm",
    requireNumber(record, "gradientClipNorm", path)
  );
  assignIfDefined(
    config,
    "explorationRate",
    requireNumber(record, "explorationRate", path)
  );
  assignIfDefined(
    config,
    "policyExplorationRate",
    requireNumber(record, "policyExplorationRate", path)
  );
  assignIfDefined(
    config,
    "writeTrace",
    requireBoolean(record, "writeTrace", path)
  );
  assignIfDefined(config, "agents", parseAgents(record, path));
  return config;
}

export async function loadTrainingRunConfig(
  configPath: string
): Promise<LoadedTrainingRunConfig> {
  const resolved = resolve(configPath);
  const config = parseTrainingRunConfig(
    parseJsonObject(await readFile(resolved, "utf8"), resolved),
    resolved
  );
  return {
    configPath: resolved,
    configDir: dirname(resolved),
    config,
  };
}

export function requireTrainingRunProfile(
  loaded: LoadedTrainingRunConfig,
  expected: TrainingRunProfile
): void {
  if (loaded.config.profile !== expected) {
    throw new Error(
      `${loaded.configPath}: profile must be ${expected}, got ${loaded.config.profile}`
    );
  }
}

export function trainingRunConfigToTraceSmokeOptions(
  loaded: LoadedTrainingRunConfig
): OptionRecord {
  const options: OptionRecord = {};
  copySharedConfigOptions(options, loaded);
  return options;
}

export function trainingRunConfigToRolloutBaselineOptions(
  loaded: LoadedTrainingRunConfig
): OptionRecord {
  const options: OptionRecord = {};
  copySharedConfigOptions(options, loaded);
  assignIfDefined(options, "agentA", loaded.config.agents?.agentA);
  assignIfDefined(options, "agentB", loaded.config.agents?.agentB);
  return options;
}

export function trainingRunConfigToEffectDebugHarvestOptions(
  loaded: LoadedTrainingRunConfig
): OptionRecord {
  const options: OptionRecord = {};
  copySharedConfigOptions(options, loaded);
  assignIfDefined(options, "agentA", loaded.config.agents?.agentA);
  assignIfDefined(options, "agentB", loaded.config.agents?.agentB);
  assignIfDefined(
    options,
    "wideChoiceThreshold",
    loaded.config.wideChoiceThreshold
  );
  assignIfDefined(
    options,
    "maxGameDurationRetries",
    loaded.config.maxGameDurationRetries
  );
  assignIfDefined(
    options,
    "maxGameDurationMultiplier",
    loaded.config.maxGameDurationMultiplier
  );
  assignIfDefined(
    options,
    "maxGameDurationCeilingMs",
    loaded.config.maxGameDurationCeilingMs
  );
  assignIfDefined(
    options,
    "maxReplacementGames",
    loaded.config.maxReplacementGames
  );
  assignIfDefined(options, "deckStrategy", loaded.config.deckStrategy);
  assignIfDefined(options, "focusCardCount", loaded.config.focusCardCount);
  if (loaded.config.policyCheckpointPath !== undefined) {
    options.policyCheckpointPath = resolveConfigRelativePath(
      loaded.configDir,
      loaded.config.policyCheckpointPath
    );
  }
  assignIfDefined(
    options,
    "policyExplorationRate",
    loaded.config.policyExplorationRate
  );
  return options;
}

export function trainingRunConfigToPolicyBootstrapOptions(
  loaded: LoadedTrainingRunConfig
): OptionRecord {
  const options: OptionRecord = {};
  copySharedConfigOptions(options, loaded);
  copyDeckSelectionConfigOptions(options, loaded);
  assignIfDefined(options, "dryRun", loaded.config.dryRun);
  assignIfDefined(options, "hiddenDim", loaded.config.hiddenDim);
  assignIfDefined(options, "batchSize", loaded.config.batchSize);
  assignIfDefined(options, "maxCards", loaded.config.maxCards);
  assignIfDefined(
    options,
    "maxKnownDeckEntries",
    loaded.config.maxKnownDeckEntries
  );
  assignIfDefined(options, "maxChoices", loaded.config.maxChoices);
  if (loaded.config.checkpointIn !== undefined) {
    options.checkpointIn = resolveConfigRelativePath(
      loaded.configDir,
      loaded.config.checkpointIn
    );
  }
  if (loaded.config.checkpointOut !== undefined) {
    options.checkpointOut = resolveConfigRelativePath(
      loaded.configDir,
      loaded.config.checkpointOut
    );
  }
  assignIfDefined(options, "learningRate", loaded.config.learningRate);
  assignIfDefined(options, "epochs", loaded.config.epochs);
  assignIfDefined(options, "gradientClipNorm", loaded.config.gradientClipNorm);
  assignIfDefined(options, "explorationRate", loaded.config.explorationRate);
  return options;
}

export function trainingRunConfigToPositionBiasOptions(
  loaded: LoadedTrainingRunConfig
): OptionRecord {
  const options: OptionRecord = {};
  copySharedConfigOptions(options, loaded);
  copyDeckSelectionConfigOptions(options, loaded);
  assignIfDefined(options, "agent", loaded.config.agents?.agentA);
  assignIfDefined(options, "writeTrace", loaded.config.writeTrace);
  return options;
}

export function mergeDefinedOptions<T extends OptionRecord>(
  base: T,
  overrides: object
): T {
  const merged: OptionRecord = { ...base };
  for (const [key, value] of Object.entries(
    overrides as Record<string, unknown>
  )) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as T;
}

export function currentGitCommitHash(cwd = process.cwd()): string {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

export function resolveConfigRelativePath(
  configDir: string,
  maybePath: string
): string {
  return isAbsolute(maybePath) ? maybePath : resolve(configDir, maybePath);
}

function copySharedConfigOptions(
  target: OptionRecord,
  loaded: LoadedTrainingRunConfig
): void {
  const { config } = loaded;
  assignIfDefined(target, "experimentId", config.experimentId);
  assignIfDefined(target, "seed", config.seed);
  assignIfDefined(target, "games", config.games);
  assignIfDefined(target, "maxSteps", config.maxSteps);
  assignIfDefined(target, "maxForcedTransitions", config.maxForcedTransitions);
  assignIfDefined(
    target,
    "maxRepeatedStateTransitions",
    config.maxRepeatedStateTransitions
  );
  assignIfDefined(target, "maxGameDurationMs", config.maxGameDurationMs);
  assignIfDefined(target, "maxGeneratedChoices", config.maxGeneratedChoices);
  assignIfDefined(target, "deckSize", config.deckSize);
  assignIfDefined(target, "skipPreGame", config.skipPreGame);
  if (config.outDir !== undefined) {
    target.outDir = resolveConfigRelativePath(loaded.configDir, config.outDir);
  }
  target.configPath = loaded.configPath;
}

function copyDeckSelectionConfigOptions(
  target: OptionRecord,
  loaded: LoadedTrainingRunConfig
): void {
  if (loaded.config.deckSelectionPath !== undefined) {
    target.deckSelectionPath = resolveConfigRelativePath(
      loaded.configDir,
      loaded.config.deckSelectionPath
    );
  }
  assignIfDefined(target, "deckSet", loaded.config.deckSet);
}

function assignIfDefined<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined
): void {
  if (value !== undefined) target[key] = value;
}
