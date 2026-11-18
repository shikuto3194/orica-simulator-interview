#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  advanceStageAfterClean,
  adaptiveHarvestTimeout,
  behaviorArtifactKey,
  behaviorFingerprintFromGit,
  capHarvestTimeoutForRun,
  classifyMctsStress,
  classifyStressHarvestFailure,
  currentStagePlan,
  effectDebugExperimentId,
  effectDebugHarvestArgs,
  effectDebugNodeArgs,
  elapsedRetryBudgetMs,
  evaluateCoverageSaturation,
  isIgnorableDirtyStatusLine,
  loopConfig,
  normalizeStageGames,
  normalizeStageState,
  parsePostSaturationSoakGames,
  parseStageGames,
  policyShadowArgs,
  policyCheckpointIdentityError,
  recordParentTimeout,
  resetStageState,
  runEffectDebugLoop,
  runShadowTraining,
  selectStressSeed,
  stressHarvestTimeout,
  stressPriorObservedTickets,
  stopConditions,
  upsertStressCohort,
} from "./effect-debug-loop.mjs";
import {
  coverageGateFromMetrics,
  analyzePersistedFrames,
  coverageFromPersistedFrames,
  frameStatsFromFrames,
  normalizeTriageOptions,
  shouldDeferCleanMinimums,
  ticketSignature,
} from "./effect-debug-triage.mjs";
import {
  buildFuzzSeedPlan,
  reserveFuzzSeedRange,
} from "./fuzz-seed-ledger.mjs";

// Runtime output isolation is exercised with real Git by test-supervisor-handoff.mjs.

assert.deepEqual(effectDebugNodeArgs("harvest.mjs", ["--games", "1"], 8192), [
  "--max-old-space-size=8192",
  "harvest.mjs",
  "--games",
  "1",
]);
assert.throws(
  () => effectDebugNodeArgs("harvest.mjs", [], 0),
  /positive integer/
);
const harvestArgs = effectDebugHarvestArgs({
  games: 10,
  maxSteps: 4000,
  maxForcedTransitions: 1000,
  maxRepeatedStateTransitions: 4,
  maxGameDurationMs: 60_000,
  maxGameDurationRetries: 2,
  maxGameDurationMultiplier: 2,
  maxGameDurationCeilingMs: 240_000,
  maxReplacementGames: 5,
  seed: 123,
  maxGeneratedChoices: 1024,
  deckSize: 40,
  deckStrategy: "coverage_guided",
  focusCardCount: 7,
  skipPreGame: false,
  agentA: "policy",
  agentB: "random",
  wideChoiceThreshold: 128,
  experimentId: "harvest-args-test",
  outDir: "harvest-out",
  checkpointFile: "harvest-checkpoint.json",
  policyCheckpointPath: null,
});
const deckStrategyIndex = harvestArgs.indexOf("--deckStrategy");
assert.deepEqual(harvestArgs.slice(deckStrategyIndex, deckStrategyIndex + 4), [
  "--deckStrategy",
  "coverage_guided",
  "--focusCardCount",
  "7",
]);
assert.equal(
  classifyMctsStress(
    { qualifyingGames: 0, coverage: { coverageEligible: true } },
    1
  ),
  "performance"
);
assert.equal(
  classifyMctsStress(
    { qualifyingGames: 1, coverage: { coverageEligible: false } },
    1
  ),
  "invalid"
);
assert.equal(
  classifyMctsStress(
    { qualifyingGames: 1, coverage: { coverageEligible: true } },
    1
  ),
  "clean"
);
assert.notEqual(
  behaviorArtifactKey("sha256-aaaaaaaaaaaa1111"),
  behaviorArtifactKey("sha256-bbbbbbbbbbbb2222")
);
const fingerprintRepo = mkdtempSync(
  join(tmpdir(), "orica-behavior-fingerprint-")
);
const gitInFingerprintRepo = (args) => {
  const result = spawnSync("git", args, {
    cwd: fingerprintRepo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(
    result.status,
    0,
    "git " + args.join(" ") + " failed: " + result.stderr
  );
};
try {
  gitInFingerprintRepo(["init", "-q"]);
  mkdirSync(join(fingerprintRepo, "scripts"), { recursive: true });
  const harvestEntrypoint = join(
    fingerprintRepo,
    "scripts",
    "effect-debug-harvest.mjs"
  );
  writeFileSync(
    harvestEntrypoint,
    'console.log("v1");' + String.fromCharCode(10)
  );
  gitInFingerprintRepo(["add", "scripts/effect-debug-harvest.mjs"]);
  gitInFingerprintRepo([
    "-c",
    "user.name=Orica Test",
    "-c",
    "user.email=orica-test@example.invalid",
    "commit",
    "-q",
    "-m",
    "v1",
  ]);
  const firstEntrypointFingerprint =
    behaviorFingerprintFromGit(fingerprintRepo);
  writeFileSync(
    harvestEntrypoint,
    'console.log("v2");' + String.fromCharCode(10)
  );
  gitInFingerprintRepo(["add", "scripts/effect-debug-harvest.mjs"]);
  gitInFingerprintRepo([
    "-c",
    "user.name=Orica Test",
    "-c",
    "user.email=orica-test@example.invalid",
    "commit",
    "-q",
    "-m",
    "v2",
  ]);
  assert.notEqual(
    behaviorFingerprintFromGit(fingerprintRepo),
    firstEntrypointFingerprint,
    "harvest entrypoint-only changes must invalidate behavior evidence"
  );

  mkdirSync(join(fingerprintRepo, "apps", "playground-web", "test"), {
    recursive: true,
  });
  const additionalBehaviorInputs = [
    "scripts/policy-bootstrap.mjs",
    "scripts/run-fuzz.mjs",
    "scripts/fuzz-seed-ledger.mjs",
    "apps/playground-web/test/selfplay-fuzz.test.ts",
  ];
  for (const relativePath of additionalBehaviorInputs) {
    const inputPath = join(fingerprintRepo, ...relativePath.split("/"));
    writeFileSync(inputPath, 'export const version = "v1";\n');
    gitInFingerprintRepo(["add", relativePath]);
    gitInFingerprintRepo([
      "-c",
      "user.name=Orica Test",
      "-c",
      "user.email=orica-test@example.invalid",
      "commit",
      "-q",
      "-m",
      "add " + relativePath,
    ]);
    const beforeInputChange = behaviorFingerprintFromGit(fingerprintRepo);
    writeFileSync(inputPath, 'export const version = "v2";\n');
    gitInFingerprintRepo(["add", relativePath]);
    gitInFingerprintRepo([
      "-c",
      "user.name=Orica Test",
      "-c",
      "user.email=orica-test@example.invalid",
      "commit",
      "-q",
      "-m",
      "change " + relativePath,
    ]);
    assert.notEqual(
      behaviorFingerprintFromGit(fingerprintRepo),
      beforeInputChange,
      relativePath + " changes must invalidate behavior evidence"
    );
  }
} finally {
  rmSync(fingerprintRepo, { recursive: true, force: true });
}
assert.notEqual(
  effectDebugExperimentId({
    behaviorFingerprint: "sha256-aaaaaaaaaaaa1111",
    head: "111111111111",
    games: 10,
    stageIndex: 0,
    seed: 123,
  }),
  effectDebugExperimentId({
    behaviorFingerprint: "sha256-aaaaaaaaaaaa1111",
    head: "222222222222",
    games: 10,
    stageIndex: 0,
    seed: 123,
  }),
  "same-behavior HEADs must use different artifact namespaces"
);
const policyIdentityDir = mkdtempSync(join(tmpdir(), "orica-policy-identity-"));
try {
  const policyFile = join(policyIdentityDir, "policy.json");
  writeFileSync(policyFile, "policy-v1");
  const policySha256 = createHash("sha256")
    .update(readFileSync(policyFile))
    .digest("hex");
  const identityConfig = {
    agentA: "policy",
    agentB: "random",
    policyCheckpointPath: policyFile,
    policyCheckpointSha256: policySha256,
  };
  assert.equal(policyCheckpointIdentityError(identityConfig), null);
  writeFileSync(policyFile, "policy-v2");
  assert.match(
    policyCheckpointIdentityError(identityConfig),
    /policy checkpoint SHA-256 changed/
  );
  assert.equal(
    policyCheckpointIdentityError({
      ...identityConfig,
      agentA: "random",
      policyCheckpointPath: null,
      policyCheckpointSha256: null,
    }),
    null,
    "unused policy checkpoints do not participate in cohort identity"
  );
} finally {
  rmSync(policyIdentityDir, { recursive: true, force: true });
}

assert.equal(
  classifyStressHarvestFailure({
    timedOut: true,
    completedGames: 1,
    priorCompletedGames: null,
  }),
  "checkpointed-timeout"
);
assert.equal(
  classifyStressHarvestFailure({
    timedOut: true,
    completedGames: 2,
    priorCompletedGames: 1,
  }),
  "checkpointed-timeout"
);
assert.equal(
  classifyStressHarvestFailure({
    timedOut: true,
    completedGames: 2,
    priorCompletedGames: 2,
  }),
  "checkpoint-stalled"
);
assert.equal(
  selectStressSeed({
    coverageSeed: 100,
    games: 1,
    usedGameSeeds: [777],
    priorSeed: 777,
  }),
  777,
  "a checkpointed stress cohort must resume its original seed even though it is in history"
);
const shadowOptions = {
  games: 4,
  maxSteps: 4000,
  seed: 123,
  maxGeneratedChoices: 1024,
  deckSize: 40,
  skipPreGame: false,
  hiddenDim: 64,
  batchSize: 512,
  maxChoices: 256,
  learningRate: 0.001,
  epochs: 1,
  gradientClipNorm: 5,
  explorationRate: 0.15,
  experimentId: "shadow-test",
  outDir: "shadow-out",
  checkpointIn: "prior-checkpoint.json",
  checkpointOut: "next-checkpoint.json",
};
const shadowArgs = policyShadowArgs(shadowOptions);
assert.deepEqual(shadowArgs.slice(-4), [
  "--checkpointOut",
  "next-checkpoint.json",
  "--checkpointIn",
  "prior-checkpoint.json",
]);
assert.ok(shadowArgs.includes("--dryRun"));
assert.ok(shadowArgs.includes("--learningRate"));
assert.ok(shadowArgs.includes("--explorationRate"));
assert.deepEqual(
  shadowArgs.slice(
    shadowArgs.indexOf("--restartIncompatibleCheckpoint"),
    shadowArgs.indexOf("--restartIncompatibleCheckpoint") + 2
  ),
  ["--restartIncompatibleCheckpoint", "true"],
  "policy shadow training must discard only incompatible checkpoint inputs"
);
assert.equal(
  shadowArgs.includes("--deckStrategy"),
  false,
  "policy bootstrap must receive only supported deck options"
);
assert.equal(shadowArgs.includes("--focusCardCount"), false);

// Exercise the real child-process/metrics/checkpoint path without generating
// games or running a learner. Saving a checkpoint alone must not report work.
const shadowDir = mkdtempSync(join(tmpdir(), "orica-shadow-report-"));
try {
  const script = join(shadowDir, "policy-fixture.mjs");
  const config = {
    repoRoot: shadowDir,
    worktreeRoot: shadowDir,
    policyScript: script,
    seed: 123,
    state: { head: "fixture" },
    shadowTraining: { timeoutMs: 10000 },
  };
  function fixtureMetrics(change = {}) {
    return {
      profile: "policy-bootstrap",
      dryRun: false,
      checkpoint: { written: true, trainingStep: 7 },
      training: {
        learningRate: 0.001,
        appliedUpdates: 0,
        initialTrainingStep: 7,
        finalTrainingStep: 7,
      },
      replayBuffer: { sampleCount: 3 },
      loss: { sampleCount: 2, valueUsableSampleCount: 1 },
      ...change,
    };
  }
  function runFixture(metrics, afterWrite = "") {
    writeFileSync(
      script,
      `
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];
const metrics=${JSON.stringify(metrics)};
const file=arg('--checkpointOut');
const bytes=JSON.stringify({network:{trainingStep:metrics.checkpoint.trainingStep}});
writeFileSync(file,bytes);
metrics.checkpoint.file=file;
metrics.checkpoint.sha256=createHash('sha256').update(bytes).digest('hex');
${afterWrite}
writeFileSync(join(arg('--out'),'metrics.json'),JSON.stringify(metrics));
`
    );
    return runShadowTraining(config);
  }
  const noUpdate = runFixture(fixtureMetrics());
  assert.equal(
    noUpdate.status,
    "no_update",
    "a saved checkpoint and usable data with zero updates are not trained"
  );
  assert.equal(noUpdate.scope, "debug-shadow");
  assert.equal(noUpdate.trainingStepDelta, 0);
  assert.equal(
    noUpdate.trainingStep,
    7,
    "historical updates are retained separately from the current delta"
  );
  const noData = runFixture(
    fixtureMetrics({ loss: { sampleCount: 2, valueUsableSampleCount: 0 } })
  );
  assert.equal(
    noData.status,
    "no_data",
    "nonterminal replay rows are not usable result samples"
  );
  assert.equal(noData.sampleCount, 3);
  assert.equal(noData.appliedUpdates, 0);
  const updatedMetrics = fixtureMetrics({
    checkpoint: { written: true, trainingStep: 9 },
    training: {
      learningRate: 0.001,
      appliedUpdates: 2,
      initialTrainingStep: 7,
      finalTrainingStep: 9,
    },
  });
  const updated = runFixture(updatedMetrics);
  assert.equal(updated.status, "trained");
  assert.equal(updated.appliedUpdates, 2);
  assert.equal(updated.trainingStepDelta, 2);
  const zeroRate = runFixture({
    ...updatedMetrics,
    training: { ...updatedMetrics.training, learningRate: 0 },
  });
  assert.equal(
    zeroRate.status,
    "failed",
    "zero learning rate metrics violate the real producer's positive-rate contract"
  );
  // Exercise the default producer's actual argument validation, separately
  // from fabricated metrics. Zero is rejected before any game or update.
  const rejectedInput = runShadowTraining({
    ...config,
    worktreeRoot: resolve(import.meta.dirname, ".."),
    policyScript: resolve(import.meta.dirname, "policy-bootstrap.mjs"),
    shadowTraining: {
      ...shadowOptions,
      learningRate: 0,
      timeoutMs: 180000,
    },
  });
  assert.equal(rejectedInput.status, "failed");
  assert.equal(rejectedInput.timedOut, false, rejectedInput.detail);
  assert.match(
    rejectedInput.detail,
    /learningRate must be a positive finite number/
  );
  assert.equal(existsSync(join(rejectedInput.outDir, "metrics.json")), false);
  assert.equal(
    existsSync(join(rejectedInput.outDir, "checkpoint.json")),
    false
  );
  for (const training of [
    null,
    {
      learningRate: 0.001,
      appliedUpdates: -1,
      initialTrainingStep: 8,
      finalTrainingStep: 7,
    },
    {
      learningRate: 0.001,
      appliedUpdates: 0.5,
      initialTrainingStep: 7,
      finalTrainingStep: 7.5,
    },
    {
      learningRate: 0.001,
      appliedUpdates: 1,
      initialTrainingStep: 7,
      finalTrainingStep: 7,
    },
    {
      learningRate: 0.001,
      appliedUpdates: 1,
      initialTrainingStep: 7,
      finalTrainingStep: 8,
    },
  ]) {
    assert.equal(
      runFixture(fixtureMetrics({ training })).status,
      "failed",
      "missing, malformed or contradictory update evidence fails closed"
    );
  }
  assert.equal(
    runFixture({
      ...updatedMetrics,
      loss: { sampleCount: 2, valueUsableSampleCount: 0 },
    }).status,
    "failed"
  );
  assert.equal(
    runFixture(
      fixtureMetrics({ loss: { sampleCount: 2, valueUsableSampleCount: 3 } })
    ).status,
    "failed"
  );
  assert.equal(
    runFixture(fixtureMetrics({ replayBuffer: { sampleCount: 0 } })).status,
    "failed"
  );
  assert.equal(runFixture(fixtureMetrics({ loss: {} })).status, "failed");
  assert.equal(
    runFixture(updatedMetrics, "metrics.checkpoint.sha256='incorrect';").status,
    "failed",
    "the checkpoint hash must match the actual saved bytes"
  );
  assert.equal(
    runFixture(
      updatedMetrics,
      "writeFileSync(file,JSON.stringify({network:{trainingStep:7}}));metrics.checkpoint.sha256=createHash('sha256').update(JSON.stringify({network:{trainingStep:7}})).digest('hex');"
    ).status,
    "failed",
    "matching hash cannot rescue a checkpoint with the wrong step"
  );

  // Real loop dispatch must keep the old policy, persist the failed attempt,
  // report the counters and stop before any additional harvest is generated.
  for (const args of [
    ["init", "-q"],
    [
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "fixture",
    ],
  ]) {
    const git = spawnSync("git", args, { cwd: shadowDir, encoding: "utf8" });
    assert.equal(git.status, 0, git.stderr);
  }
  writeFileSync(join(shadowDir, ".gitignore"), "*\n");
  const reportScript = join(shadowDir, "report.mjs");
  writeFileSync(
    reportScript,
    `import {readFileSync,writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(shadowDir, "report.txt"))},readFileSync(0));`
  );
  const stateFile = join(shadowDir, "state.json");
  const priorCheckpoint = join(shadowDir, "prior.json");
  writeFileSync(priorCheckpoint, "prior immutable checkpoint");
  const prior = {
    checkpointFile: priorCheckpoint,
    checkpointSha256: "prior",
    trainingStep: 7,
  };
  const variables = {
    ORICA_EFFECT_DEBUG_LOOP: "1",
    ORICA_EFFECT_DEBUG_HUB_ROOT: shadowDir,
    ORICA_EFFECT_DEBUG_WORKTREE: shadowDir,
    ORICA_EFFECT_DEBUG_STATE: stateFile,
    ORICA_CLUSTER_REGISTRY: join(shadowDir, "missing-registry.json"),
    ORICA_POLICY_SHADOW_TRAINING: "1",
    ORICA_POLICY_SHADOW_SCRIPT: script,
    ORICA_EFFECT_DEBUG_REPORT: reportScript,
    ORICA_EFFECT_DEBUG_HARVEST: join(shadowDir, "must-not-run.mjs"),
  };
  const oldEnv = Object.fromEntries(
    Object.keys(variables).map((key) => [key, process.env[key]])
  );
  try {
    Object.assign(process.env, variables);
    for (const [metrics, status] of [
      [fixtureMetrics(), "no_update"],
      [
        fixtureMetrics({ loss: { sampleCount: 2, valueUsableSampleCount: 0 } }),
        "no_data",
      ],
    ]) {
      runFixture(metrics);
      writeFileSync(
        stateFile,
        JSON.stringify({ schemaVersion: 5, policyTraining: prior })
      );
      const result = await runEffectDebugLoop();
      assert.equal(result.action, "policy-training-no-progress");
      assert.equal(result.skipWorker, false);
      assert.equal(result.training.status, status);
      const saved = JSON.parse(readFileSync(stateFile, "utf8"));
      assert.deepEqual(
        saved.policyTraining,
        prior,
        "no-progress attempts never replace the prior model"
      );
      assert.equal(saved.lastPolicyTrainingAttempt.status, status);
      assert.equal(
        saved.lastPolicyTrainingAttempt.trainingStepDelta,
        metrics.training.appliedUpdates
      );
      assert.equal(saved.activeBatch, null);
      assert.equal(saved.cleanGames, 0);
      assert.equal(
        readFileSync(priorCheckpoint, "utf8"),
        "prior immutable checkpoint"
      );
      assert.ok(
        readFileSync(join(shadowDir, "report.txt"), "utf8").includes(
          `appliedUpdates=${metrics.training.appliedUpdates} trainingStepDelta=${metrics.training.appliedUpdates}`
        )
      );
    }
  } finally {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
} finally {
  rmSync(shadowDir, { recursive: true, force: true });
}

const stressPrior = stressPriorObservedTickets(
  {
    coverageCohorts: [{ observedTickets: [{ signature: "prior", seed: 1 }] }],
    ineligibleCohorts: [],
    stressCohorts: [],
  },
  [{ signature: "current", seed: 2 }]
);
assert.deepEqual(
  stressPrior.map((ticket) => ticket.signature),
  ["prior", "current"],
  "MCTS stress triage must include the same-tick coverage evidence"
);

const invariantTicket = (issue, sourceCardNo = "unknown") => ({
  kind: "state_invariant",
  title: "final state invariant",
  suspect: {
    sourceCardNo,
    actionKind: "decline_block",
    nodeKind: "legal_action",
  },
  details: { issues: [issue] },
});
assert.notEqual(
  ticketSignature(
    invariantTicket({
      code: "missing_continuous_effect",
      path: "activeContinuousEffects[card-20:2]",
      message: "restrict_symbol_addition not registered",
    })
  ),
  ticketSignature(
    invariantTicket({
      code: "missing_continuous_effect",
      path: "activeContinuousEffects[card-21:1]",
      message: "additional_cost not registered",
    })
  ),
  "unknown-source invariants must retain normalized invariant detail in their cluster signature"
);
assert.notEqual(
  ticketSignature(
    invariantTicket(
      { code: "same_invariant", message: "same failure" },
      "BSTH02.5-X01"
    )
  ),
  ticketSignature(
    invariantTicket(
      { code: "same_invariant", message: "same failure" },
      "BSTH02.7-X01"
    )
  ),
  "known source cardNos must remain distinct even when their numeric segments differ"
);
assert.notEqual(
  ticketSignature(
    invariantTicket(
      {
        code: "missing_continuous_effect",
        path: "activeContinuousEffects[card-20:2]",
        message: "restrict_symbol_addition not registered",
      },
      ""
    )
  ),
  ticketSignature(
    invariantTicket(
      {
        code: "missing_continuous_effect",
        path: "activeContinuousEffects[card-21:1]",
        message: "additional_cost not registered",
      },
      ""
    )
  ),
  "empty sourceCardNo must be treated as unknown and retain invariant detail"
);

function cleanGate(games) {
  return {
    requestedGames: games,
    totalDecisionFrames: games * 10,
    effectDecisionFrames: games,
    uniqueSourceCardNos: ["TEST-001"],
  };
}

function coverageMetrics({
  unattributedActionFrames = 0,
  unattributedEffectRefs = 0,
  unattributedDslStepRefs = 0,
} = {}) {
  return {
    aggregate: {
      coverage: {
        schemaVersion: 1,
        semantic: {
          cards: { "TEST-001": 1 },
          effects: { "TEST-001#effectIndex:0": 1 },
          dslSteps: { "TEST-001#effectIndex:0/stepIndex:0": 1 },
          actions: { use_magic: 1 },
          executedActionFrames: 1,
          unattributedActionFrames,
          unattributedEffectRefs,
          unattributedDslStepRefs,
        },
        choiceSurface: {
          decisionFrames: 1,
          cappedGameCount: 0,
          truncatedDecisionFrames: 0,
        },
      },
    },
  };
}

const offeredButUnselected = frameStatsFromFrames([
  {
    node: {
      choices: [
        {
          choiceId: "offered-effect",
          action: { kind: "use_magic", sourceCardNo: "OFFERED-001" },
        },
        { choiceId: "selected-system", action: { kind: "pass" } },
      ],
    },
    selected: { choiceId: "selected-system" },
  },
]);
assert.deepEqual(offeredButUnselected, {
  totalFrames: 1,
  effectDecisionFrames: 0,
  uniqueSourceCardNos: [],
});

const streamedFrames = [
  {
    node: {
      choices: [
        {
          choiceId: "stream-effect",
          action: {
            kind: "use_magic",
            sourceCardNo: "STREAM-001",
            effectIndex: 0,
            stepIndex: 0,
          },
        },
      ],
    },
    selected: { choiceId: "stream-effect", choiceCount: 2 },
  },
  {
    node: {
      choices: [
        {
          choiceId: "stream-wide",
          action: { kind: "pass", sourceCardNo: "STREAM-002" },
        },
      ],
    },
    selected: { choiceId: "stream-wide", choiceCount: 17, truncated: true },
  },
];
const instanceOnlyProvenanceFrame = {
  observation: {
    cards: [
      {
        instanceId: "card-from-observation",
        cardNoOrUnknown: "INSTANCE-001",
        identityVisibility: "known",
      },
    ],
  },
  node: {
    choices: [
      {
        choiceId: "instance-only-effect",
        action: {
          kind: "resolve_pending_step_optional_choice",
          sourceInstanceId: "card-from-observation",
          effectIndex: 2,
          stepIndex: 3,
        },
      },
    ],
  },
  selected: { choiceId: "instance-only-effect", choiceCount: 2 },
};
const instanceOnlyCoverage = coverageFromPersistedFrames([
  instanceOnlyProvenanceFrame,
]);
assert.deepEqual(instanceOnlyCoverage.semantic, {
  cards: { "INSTANCE-001": 1 },
  effects: { "INSTANCE-001#effectIndex:2": 1 },
  dslSteps: { "INSTANCE-001#effectIndex:2/stepIndex:3": 1 },
  actions: { resolve_pending_step_optional_choice: 1 },
  executedActionFrames: 1,
  unattributedActionFrames: 0,
  unattributedEffectRefs: 0,
  unattributedDslStepRefs: 0,
});
assert.deepEqual(frameStatsFromFrames([instanceOnlyProvenanceFrame]), {
  totalFrames: 1,
  effectDecisionFrames: 1,
  uniqueSourceCardNos: ["INSTANCE-001"],
});
const unobservedInstanceCoverage = coverageFromPersistedFrames([
  {
    observation: {
      cards: [
        {
          instanceId: "hidden-source",
          cardNoOrUnknown: "UNK_CARD",
          identityVisibility: "unknown",
        },
      ],
    },
    node: {
      choices: [
        {
          choiceId: "hidden-instance-only-effect",
          action: {
            kind: "resolve_pending_step_optional_choice",
            sourceInstanceId: "hidden-source",
            effectIndex: 2,
            stepIndex: 3,
          },
        },
      ],
    },
    selected: { choiceId: "hidden-instance-only-effect", choiceCount: 2 },
  },
  {
    observation: { cards: [] },
    node: {
      choices: [
        {
          choiceId: "missing-instance-only-effect",
          action: {
            kind: "resolve_pending_step_optional_choice",
            sourceInstanceId: "missing-source",
            effectIndex: 2,
            stepIndex: 3,
          },
        },
      ],
    },
    selected: { choiceId: "missing-instance-only-effect", choiceCount: 2 },
  },
]);
assert.deepEqual(unobservedInstanceCoverage.semantic, {
  cards: {},
  effects: {},
  dslSteps: {},
  actions: { resolve_pending_step_optional_choice: 2 },
  executedActionFrames: 2,
  unattributedActionFrames: 0,
  unattributedEffectRefs: 2,
  unattributedDslStepRefs: 2,
});
const streamedFramesDir = mkdtempSync(join(tmpdir(), "orica-effect-debug-"));
try {
  const streamedFramesPath = join(streamedFramesDir, "frames.jsonl");
  writeFileSync(
    streamedFramesPath,
    streamedFrames.map((frame) => JSON.stringify(frame)).join("\n")
  );
  const streamed = await analyzePersistedFrames(streamedFramesPath, {
    wideChoiceThreshold: 8,
    cappedGameCount: 1,
    chunkSize: 17,
  });
  assert.deepEqual(
    streamed.coverage,
    coverageFromPersistedFrames(streamedFrames, {
      wideChoiceThreshold: 8,
      cappedGameCount: 1,
    })
  );
  assert.deepEqual(streamed.stats, frameStatsFromFrames(streamedFrames));
  const indexedFrames = streamedFrames.map((frame, gameIndex) => ({
    ...frame,
    gameIndex,
  }));
  writeFileSync(
    streamedFramesPath,
    indexedFrames.map((frame) => JSON.stringify(frame)).join("\n")
  );
  const cleanStreamed = await analyzePersistedFrames(streamedFramesPath, {
    wideChoiceThreshold: 8,
    cappedGameCount: 1,
    cleanGameIndexes: new Set([0]),
  });
  assert.deepEqual(
    cleanStreamed.cleanCoverage,
    coverageFromPersistedFrames([indexedFrames[0]], { wideChoiceThreshold: 8 })
  );
  assert.deepEqual(
    cleanStreamed.cleanStats,
    frameStatsFromFrames([indexedFrames[0]])
  );
  writeFileSync(
    streamedFramesPath,
    `\r\n${streamedFrames.map((frame) => JSON.stringify(frame)).join("\r\n")}\r\n\r\n`
  );
  assert.deepEqual(
    (
      await analyzePersistedFrames(streamedFramesPath, {
        wideChoiceThreshold: 8,
        cappedGameCount: 1,
        chunkSize: 1,
      })
    ).coverage,
    coverageFromPersistedFrames(streamedFrames, {
      wideChoiceThreshold: 8,
      cappedGameCount: 1,
    })
  );
  writeFileSync(
    streamedFramesPath,
    `${JSON.stringify(streamedFrames[0])}\r\n\r\n${JSON.stringify(streamedFrames[1])}`
  );
  await assert.rejects(
    () =>
      analyzePersistedFrames(streamedFramesPath, {
        chunkSize: 1,
      }),
    /blank line between records/
  );
  writeFileSync(
    streamedFramesPath,
    `${JSON.stringify({ oversized: "x".repeat(128) })}\n`
  );
  await assert.rejects(
    () =>
      analyzePersistedFrames(streamedFramesPath, {
        chunkSize: 17,
        maxRecordBytes: 64,
      }),
    /JSONL record exceeds 64 bytes/
  );
} finally {
  rmSync(streamedFramesDir, { recursive: true, force: true });
}

assert.equal(coverageGateFromMetrics(coverageMetrics()).coverageEligible, true);
assert.equal(
  shouldDeferCleanMinimums({
    allowIncompleteElapsed: true,
    qualifyingGames: 8,
    requestedGames: 10,
  }),
  true
);
assert.equal(
  shouldDeferCleanMinimums({
    allowIncompleteElapsed: true,
    qualifyingGames: 10,
    requestedGames: 10,
  }),
  false
);
assert.equal(
  shouldDeferCleanMinimums({
    allowIncompleteElapsed: false,
    qualifyingGames: 8,
    requestedGames: 10,
  }),
  false
);
const replacementCoverageMetrics = coverageMetrics();
replacementCoverageMetrics.aggregate.cleanCoverage = JSON.parse(
  JSON.stringify(replacementCoverageMetrics.aggregate.coverage)
);
replacementCoverageMetrics.aggregate.coverage.choiceSurface.cappedGameCount = 1;
assert.equal(
  coverageGateFromMetrics(replacementCoverageMetrics).coverageEligible,
  true,
  "elapsed-time replacement must gate on cleanCoverage while preserving raw cap evidence"
);
const missingProvenanceCoverage = coverageGateFromMetrics(
  coverageMetrics({
    unattributedEffectRefs: 1,
    unattributedDslStepRefs: 1,
  })
);
assert.equal(missingProvenanceCoverage.valid, true);
assert.equal(missingProvenanceCoverage.coverageEligible, false);
assert.equal(
  coverageGateFromMetrics(coverageMetrics({ unattributedActionFrames: 1 }))
    .coverageEligible,
  false
);

const stageGames = [10, 50, 3000];
const harvestGameSeedStride = 0x9e3779b9;

assert.equal(isIgnorableDirtyStatusLine("?? .verifier-prompt.md"), true);
assert.equal(isIgnorableDirtyStatusLine(" M .verifier-result.json"), true);
assert.equal(
  isIgnorableDirtyStatusLine("?? nested/.verifier-prompt.md"),
  false
);
assert.equal(isIgnorableDirtyStatusLine("?? src/.verifier-related.ts"), false);
assert.equal(isIgnorableDirtyStatusLine("?? real-change.md"), false);
assert.equal(
  isIgnorableDirtyStatusLine("R  old-name.md -> .verifier-result.json"),
  false
);
assert.equal(
  isIgnorableDirtyStatusLine("R  .verifier-old.json -> .verifier-result.json"),
  true
);

function withEnv(name, value, fn) {
  const hadValue = Object.prototype.hasOwnProperty.call(process.env, name);
  const previous = process.env[name];
  try {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    return fn();
  } finally {
    if (hadValue) process.env[name] = previous;
    else delete process.env[name];
  }
}

function withEnvValues(values, fn) {
  const entries = Object.entries(values);
  const visit = (index) =>
    index === entries.length
      ? fn()
      : withEnv(entries[index][0], entries[index][1], () => visit(index + 1));
  return visit(0);
}

assert.throws(() => parseStageGames("10, 50, bad, 3000"), /invalid stage/);
assert.throws(() => parseStageGames("10,,3000"), /invalid stage/);
assert.deepEqual(parseStageGames("10, 50, 3000"), stageGames);
assert.throws(() => parseStageGames(""), /invalid stage/);
withEnv("ORICA_EFFECT_DEBUG_STAGE_GAMES", "", () => {
  assert.throws(() => loopConfig(), /invalid stage/);
});
withEnv("ORICA_EFFECT_DEBUG_STAGE_GAMES", "   ", () => {
  assert.throws(() => loopConfig(), /invalid stage/);
});
withEnv("ORICA_EFFECT_DEBUG_STAGE_GAMES", "10,50,3000", () => {
  withEnv("ORICA_EFFECT_DEBUG_WORKTREE", process.cwd(), () => {
    withEnv("ORICA_EFFECT_DEBUG_HUB_ROOT", process.cwd(), () => {
      withEnv(
        "ORICA_EFFECT_DEBUG_STATE",
        join(process.cwd(), "logs", "test-effect-debug-loop-state.json"),
        () => {
          withEnv(
            "ORICA_EFFECT_DEBUG_HARVEST",
            join(process.cwd(), "scripts", "effect-debug-harvest.mjs"),
            () => {
              withEnv(
                "ORICA_EFFECT_DEBUG_REPORT",
                join(process.cwd(), "scripts", "supervisor-report.mjs"),
                () => {
                  withEnv("ORICA_CLUSTER_REGISTRY", undefined, () => {
                    const config = loopConfig();
                    const root = resolve(process.cwd());
                    assert.equal(config.worktreeRoot, root);
                    assert.equal(config.repoRoot, root);
                    assert.equal(
                      config.harvestScript,
                      join(root, "scripts", "effect-debug-harvest.mjs")
                    );
                    assert.equal(
                      config.policyScript,
                      join(root, "scripts", "policy-bootstrap.mjs")
                    );
                    assert.equal(config.shadowTrainingEnabled, true);
                    assert.equal(config.agentA, "policy");
                    assert.equal(config.agentB, "random");
                    assert.equal(config.stressAgentB, "mcts");
                    assert.equal(config.deckStrategy, "coverage_guided");
                    assert.equal(config.maxGameDurationRetries, 2);
                    assert.equal(config.maxGameDurationCeilingMs, 240_000);
                    assert.equal(config.maxReplacementGames, 5);
                    assert.equal(config.stressGames, 1);
                    assert.equal(config.stopOnFinalClean, true);
                    assert.deepEqual(
                      config.stageGames,
                      [10, 50, 3000, 5000, 10000]
                    );
                    assert.equal(config.baselineStageGames, 3000);
                    assert.deepEqual(config.soakStages, [5000, 10000]);
                    assert.equal(config.finalStageGames, 10000);
                    assert.equal(config.runBudgetMs, 45 * 60 * 1000);
                    assert.ok(config.timeoutMs <= config.runBudgetMs);
                    assert.equal(
                      config.reportScript,
                      join(root, "scripts", "supervisor-report.mjs")
                    );
                    assert.equal(
                      config.clusterRegistry,
                      join(root, "autorun-queue", "cluster-registry.json")
                    );
                    assert.equal(
                      config.stateFile,
                      join(root, "logs", "test-effect-debug-loop-state.json")
                    );
                    assert.ok(
                      config.outDir.startsWith(
                        join(root, "artifacts", "effect-debug")
                      )
                    );
                  });
                }
              );
            }
          );
        }
      );
    });
  });
});
const activeConfigDir = mkdtempSync(join(tmpdir(), "orica-active-config-"));
try {
  const activeStateFile = join(activeConfigDir, "state.json");
  const activeOutDir = join(activeConfigDir, "artifacts");
  const activeCheckpointFile = join(activeOutDir, "checkpoint.json");
  const initialConfig = withEnvValues(
    {
      ORICA_EFFECT_DEBUG_STATE: activeStateFile,
      ORICA_EFFECT_DEBUG_STAGE_GAMES: "10",
      ORICA_EFFECT_DEBUG_FINAL_STAGE_GAMES: "10",
      ORICA_EFFECT_DEBUG_POST_SATURATION_SOAK_GAMES: "5000",
    },
    () => loopConfig()
  );
  writeFileSync(
    activeStateFile,
    JSON.stringify({
      ...initialConfig.state,
      activeBatch: {
        stageIndex: initialConfig.stagePlan.stageIndex,
        games: initialConfig.games,
        seed: 2468,
        experimentId: "frozen-active-batch",
        outDir: activeOutDir,
        checkpointFile: activeCheckpointFile,
        policyCheckpointPath: null,
        policyCheckpointSha256: null,
        policyTrainingStep: null,
        maxSteps: 111,
        maxForcedTransitions: 112,
        maxRepeatedStateTransitions: 3,
        maxGameDurationMs: 1000,
        maxGameDurationRetries: 1,
        maxGameDurationMultiplier: 2,
        maxGameDurationCeilingMs: 4000,
        maxReplacementGames: 2,
        maxGeneratedChoices: 113,
        deckSize: 12,
        deckStrategy: "random",
        focusCardCount: 4,
        skipPreGame: true,
        agentA: "heuristic",
        agentB: "random",
        wideChoiceThreshold: 7,
        policyExplorationRate: 0.25,
        stressGames: 2,
        stressAgentB: "mcts",
        lastCheckpointCompletedGames: 0,
        noProgressTimeoutCount: 0,
        startedAt: "2026-09-07T00:00:00.000Z",
      },
    })
  );

  const resumedConfig = withEnvValues(
    {
      ORICA_EFFECT_DEBUG_STATE: activeStateFile,
      ORICA_EFFECT_DEBUG_STAGE_GAMES: "10",
      ORICA_EFFECT_DEBUG_FINAL_STAGE_GAMES: "10",
      ORICA_EFFECT_DEBUG_POST_SATURATION_SOAK_GAMES: "5000",
      ORICA_EFFECT_DEBUG_MAX_STEPS: "999",
      ORICA_EFFECT_DEBUG_MAX_FORCED_TRANSITIONS: "998",
      ORICA_EFFECT_DEBUG_MAX_REPEATED_STATE_TRANSITIONS: "9",
      ORICA_EFFECT_DEBUG_MAX_GAME_DURATION_MS: "9999",
      ORICA_EFFECT_DEBUG_MAX_GAME_DURATION_RETRIES: "9",
      ORICA_EFFECT_DEBUG_MAX_GAME_DURATION_MULTIPLIER: "3",
      ORICA_EFFECT_DEBUG_MAX_GAME_DURATION_CEILING_MS: "9999",
      ORICA_EFFECT_DEBUG_MAX_REPLACEMENT_GAMES: "9",
      ORICA_EFFECT_DEBUG_MAX_CHOICES: "999",
      ORICA_EFFECT_DEBUG_DECK_SIZE: "30",
      ORICA_EFFECT_DEBUG_DECK_STRATEGY: "coverage_guided",
      ORICA_EFFECT_DEBUG_FOCUS_CARD_COUNT: "9",
      ORICA_EFFECT_DEBUG_SKIP_PREGAME: "false",
      ORICA_EFFECT_DEBUG_AGENT_A: "random",
      ORICA_EFFECT_DEBUG_AGENT_B: "mcts",
      ORICA_EFFECT_DEBUG_STRESS_AGENT_B: "heuristic",
      ORICA_EFFECT_DEBUG_STRESS_MAX_GAMES: "9",
      ORICA_EFFECT_DEBUG_WIDE_THRESHOLD: "99",
      ORICA_EFFECT_DEBUG_POLICY_EXPLORATION_RATE: "0.9",
    },
    () => loopConfig()
  );
  assert.deepEqual(
    {
      maxSteps: resumedConfig.maxSteps,
      maxForcedTransitions: resumedConfig.maxForcedTransitions,
      maxRepeatedStateTransitions: resumedConfig.maxRepeatedStateTransitions,
      maxGameDurationMs: resumedConfig.maxGameDurationMs,
      maxGameDurationRetries: resumedConfig.maxGameDurationRetries,
      maxGameDurationMultiplier: resumedConfig.maxGameDurationMultiplier,
      maxGameDurationCeilingMs: resumedConfig.maxGameDurationCeilingMs,
      maxReplacementGames: resumedConfig.maxReplacementGames,
      maxGeneratedChoices: resumedConfig.maxGeneratedChoices,
      deckSize: resumedConfig.deckSize,
      deckStrategy: resumedConfig.deckStrategy,
      focusCardCount: resumedConfig.focusCardCount,
      skipPreGame: resumedConfig.skipPreGame,
      agentA: resumedConfig.agentA,
      agentB: resumedConfig.agentB,
      wideChoiceThreshold: resumedConfig.wideChoiceThreshold,
      policyExplorationRate: resumedConfig.policyExplorationRate,
      stressGames: resumedConfig.stressGames,
      stressAgentB: resumedConfig.stressAgentB,
    },
    {
      maxSteps: 111,
      maxForcedTransitions: 112,
      maxRepeatedStateTransitions: 3,
      maxGameDurationMs: 1000,
      maxGameDurationRetries: 1,
      maxGameDurationMultiplier: 2,
      maxGameDurationCeilingMs: 4000,
      maxReplacementGames: 2,
      maxGeneratedChoices: 113,
      deckSize: 12,
      deckStrategy: "random",
      focusCardCount: 4,
      skipPreGame: true,
      agentA: "heuristic",
      agentB: "random",
      wideChoiceThreshold: 7,
      policyExplorationRate: 0.25,
      stressGames: 2,
      stressAgentB: "mcts",
    },
    "an active cohort must keep its complete coverage and stress checkpoint identity"
  );
} finally {
  rmSync(activeConfigDir, { recursive: true, force: true });
}

withEnv("ORICA_EFFECT_DEBUG_STAGE_GAMES", "3000", () => {
  withEnv("ORICA_EFFECT_DEBUG_FINAL_STAGE_GAMES", "3000", () => {
    withEnv("ORICA_EFFECT_DEBUG_POST_SATURATION_SOAK_GAMES", undefined, () => {
      withEnv("ORICA_EFFECT_DEBUG_RUN_BUDGET_MS", "1000", () => {
        withEnv(
          "ORICA_EFFECT_DEBUG_STATE",
          join(process.cwd(), "logs", "test-effect-debug-large-stage.json"),
          () => {
            const config = loopConfig();
            assert.equal(config.games, 3000);
            assert.deepEqual(config.stageGames, [3000, 5000, 10000]);
            assert.ok(config.requiredBatchTimeoutMs > config.runBudgetMs);
            assert.equal(config.timeoutMs, 1000);
            assert.equal(config.checkpointsAcrossRuns, true);
          }
        );
      });
    });
  });
});
withEnv("ORICA_CLUSTER_REGISTRY", undefined, () => {
  const hubRoot = resolve(process.cwd(), "hub-root");
  const worktreeRoot = resolve(process.cwd(), "lane-worktree");
  const options = normalizeTriageOptions({ repoRoot: hubRoot, worktreeRoot });
  assert.equal(options.repoRoot, hubRoot);
  assert.equal(options.worktreeRoot, worktreeRoot);
  assert.equal(
    options.clusterRegistry,
    join(hubRoot, "autorun-queue", "cluster-registry.json")
  );
  assert.equal(
    options.clusterClaimScript,
    join(worktreeRoot, "scripts", "cluster-claim.mjs")
  );
});
assert.deepEqual(
  normalizeStageGames([10, 50, 100, 200, 1000, 3000], 1000),
  [10, 50, 100, 200, 1000]
);
assert.deepEqual(normalizeStageGames([10, 50, 100], 3000), [10, 50, 100, 3000]);
assert.throws(
  () => normalizeStageGames([100, 10, 3000], 3000),
  /strictly increasing/
);
assert.throws(
  () => normalizeStageGames([10, 10, 3000], 3000),
  /strictly increasing/
);
assert.throws(
  () => normalizeStageGames([10, 3000, 50], 3000),
  /strictly increasing/
);
assert.deepEqual(normalizeStageGames([10, 5000, 6000], 3000), [10, 3000]);
assert.deepEqual(parsePostSaturationSoakGames(undefined), [5000, 10000]);
assert.deepEqual(parsePostSaturationSoakGames(""), [5000, 10000]);
assert.deepEqual(parsePostSaturationSoakGames(undefined, 5000), [10000]);
assert.deepEqual(parsePostSaturationSoakGames("5000,10000"), [5000, 10000]);
assert.throws(
  () => parsePostSaturationSoakGames("3000,5000"),
  /exceed baseline/
);

let state = normalizeStageState(null, { head: "abc123", stageGames });
assert.equal(state.stageIndex, 0);
assert.equal(currentStagePlan(state, stageGames).games, 10);
assert.equal(stopConditions(state, stageGames, 0).ready, false);

state = advanceStageAfterClean(state, stageGames, cleanGate(10), {
  artifactDir: "artifacts/effect-debug/a",
  seed: 100,
});
assert.equal(state.stageIndex, 1);
assert.equal(state.cleanGames, 10);
assert.equal(currentStagePlan(state, stageGames).games, 50);

state = advanceStageAfterClean(state, stageGames, cleanGate(50), {
  artifactDir: "artifacts/effect-debug/b",
  seed: 200,
});
assert.equal(state.stageIndex, 2);
assert.equal(state.cleanGames, 60);
assert.equal(currentStagePlan(state, stageGames).games, 3000);

state = advanceStageAfterClean(state, stageGames, cleanGate(3000), {
  artifactDir: "artifacts/effect-debug/c",
  seed: 300,
});
assert.equal(state.stageIndex, 3);
assert.equal(state.cleanGames, 3060);
assert.equal(state.stopReady, true);
assert.equal(currentStagePlan(state, stageGames).stopReady, true);
assert.deepEqual(stopConditions(state, stageGames, 0), {
  openClustersZero: true,
  headStable: true,
  noInvalidSinceReset: true,
  noPromotedSinceReset: true,
  allBatchesSeeded: true,
  uniqueSeeds: true,
  allGameSeedsUnique: true,
  noCrossBatchCappedRepeats: true,
  allStageBatchesClean: true,
  finalStageClean: true,
  noActiveBatch: true,
  ready: true,
});

const saturatedCoverage = evaluateCoverageSaturation(
  [{ coverage: { semanticKeys: ["action:summon", "card:TEST-001"] } }],
  {
    semanticKeys: ["action:summon", "card:TEST-001"],
    coverageEligible: true,
  },
  {
    minCohorts: 2,
    maxNovelSemanticKeys: 0,
    maxNovelSemanticRate: 0,
  }
);
assert.equal(saturatedCoverage.saturated, true);
assert.equal(saturatedCoverage.novelSemanticKeys, 0);
assert.equal(
  evaluateCoverageSaturation([], {
    semanticKeys: ["action:summon"],
    coverageEligible: false,
  }).saturated,
  false
);

assert.deepEqual(
  adaptiveHarvestTimeout({
    games: 5,
    checkpoint: {
      completedGames: 2,
      totalGameDurationMs: 1000,
      maxGameDurationMs: 600,
      lastGameDurationMs: 400,
    },
    fallbackPerGameMs: 100,
    startupGraceMs: 50,
  }),
  {
    completedGames: 2,
    remainingGames: 3,
    observedMaxMs: 600,
    observedAverageMs: 500,
    perGameTimeoutMs: 2000,
    parentPerGameBudgetMs: 2000,
    startupGraceMs: 50,
    timeoutMs: 6050,
  }
);
assert.ok(
  adaptiveHarvestTimeout({ games: 50 }).timeoutMs > 20 * 60 * 1000,
  "g50 must not be limited by the legacy fixed 20-minute parent timeout"
);
const retrySequenceBudgetMs = elapsedRetryBudgetMs({
  initialMaxGameDurationMs: 60_000,
  maxGameDurationRetries: 2,
  maxGameDurationMultiplier: 2,
  maxGameDurationCeilingMs: 240_000,
});
assert.equal(
  retrySequenceBudgetMs,
  420_000,
  "the parent must reserve the whole 60s -> 120s -> 240s retry ladder"
);
const completedCoverageTimeout = adaptiveHarvestTimeout({
  games: 1000,
  checkpoint: {
    completedGames: 1000,
    totalGameDurationMs: 60_000,
    maxGameDurationMs: 60_000,
    lastGameDurationMs: 60_000,
  },
  fallbackPerGameMs: 60_000,
  startupGraceMs: 120_000,
  minimumPerGameBudgetMs: retrySequenceBudgetMs,
});
const resumedStressTimeout = stressHarvestTimeout({
  games: 10,
  checkpoint: {
    completedGames: 6,
    totalGameDurationMs: 6 * 360_000,
    maxGameDurationMs: 360_000,
    lastGameDurationMs: 360_000,
  },
  historicalStressCohorts: [],
  fallbackPerGameMs: 60_000,
  startupGraceMs: 120_000,
  minimumPerGameBudgetMs: retrySequenceBudgetMs,
  minimumTimeoutMs: 0,
  runBudgetMs: 45 * 60 * 1000,
});
assert.equal(completedCoverageTimeout.timeoutMs, 120_000);
assert.equal(resumedStressTimeout.adaptiveTimeout.completedGames, 6);
assert.equal(resumedStressTimeout.adaptiveTimeout.remainingGames, 4);
assert.ok(
  resumedStressTimeout.requiredTimeoutMs > resumedStressTimeout.timeoutMs,
  "the resumed stress requirement may exceed one supervisor run budget"
);
assert.equal(resumedStressTimeout.timeoutMs, 45 * 60 * 1000);
assert.ok(
  resumedStressTimeout.timeoutMs > completedCoverageTimeout.timeoutMs,
  "completed coverage must not donate its startup-only timeout to unfinished stress"
);
assert.equal(capHarvestTimeoutForRun(10_000, 2_000), 2_000);
assert.equal(capHarvestTimeoutForRun(1_000, 2_000), 1_000);
assert.throws(() => capHarvestTimeoutForRun(1_000, 0), /positive integer/);

const progressedTimeout = recordParentTimeout(
  {
    experimentId: "cumulative-cohort",
    lastCheckpointCompletedGames: 3,
    noProgressTimeoutCount: 2,
    parentTimeoutStalledAt: "2026-08-30T00:00:00.000Z",
  },
  4,
  "2026-08-30T01:00:00.000Z"
);
assert.equal(progressedTimeout.madeProgress, true);
assert.equal(progressedTimeout.previousCompletedGames, 3);
assert.equal(progressedTimeout.noProgressTimeoutCount, 0);
assert.equal(progressedTimeout.activeBatch.lastCheckpointCompletedGames, 4);
assert.equal(progressedTimeout.activeBatch.parentTimeoutStalledAt, null);
assert.equal(progressedTimeout.activeBatch.experimentId, "cumulative-cohort");

const stalledTimeout = recordParentTimeout(
  progressedTimeout.activeBatch,
  4,
  "2026-08-30T02:00:00.000Z"
);
assert.equal(stalledTimeout.madeProgress, false);
assert.equal(stalledTimeout.previousCompletedGames, 4);
assert.equal(stalledTimeout.noProgressTimeoutCount, 1);
assert.equal(
  stalledTimeout.activeBatch.parentTimeoutStalledAt,
  "2026-08-30T02:00:00.000Z"
);

const repeatedStalledTimeout = recordParentTimeout(
  stalledTimeout.activeBatch,
  4,
  "2026-08-30T03:00:00.000Z"
);
assert.equal(repeatedStalledTimeout.noProgressTimeoutCount, 2);
assert.equal(
  repeatedStalledTimeout.activeBatch.parentTimeoutStalledAt,
  "2026-08-30T02:00:00.000Z"
);

const duplicateSeedState = {
  ...state,
  cleanBatches: state.cleanBatches.map((batch, index) => ({
    ...batch,
    seed: index === 2 ? 100 : batch.seed,
  })),
  coverageCohorts: state.coverageCohorts.map((batch, index) => ({
    ...batch,
    seed: index === 2 ? 100 : batch.seed,
  })),
};
assert.equal(stopConditions(duplicateSeedState, stageGames, 0).ready, false);
assert.equal(stopConditions(state, stageGames, 1).openClustersZero, false);

const collidingGameSeedState = {
  ...state,
  cleanBatches: state.cleanBatches.map((batch, index) =>
    index === 1
      ? { ...batch, seed: (100 + harvestGameSeedStride) >>> 0 }
      : batch
  ),
  coverageCohorts: state.coverageCohorts.map((batch, index) =>
    index === 1
      ? {
          ...batch,
          seed: (100 + harvestGameSeedStride) >>> 0,
          gameSeeds: Array.from(
            { length: batch.games },
            (_, gameIndex) =>
              (100 +
                harvestGameSeedStride +
                Math.imul(gameIndex, harvestGameSeedStride)) >>>
              0
          ),
          qualifyingGameSeeds: Array.from(
            { length: batch.games },
            (_, gameIndex) =>
              (100 +
                harvestGameSeedStride +
                Math.imul(gameIndex, harvestGameSeedStride)) >>>
              0
          ),
        }
      : batch
  ),
};
assert.equal(
  stopConditions(collidingGameSeedState, stageGames, 0).allGameSeedsUnique,
  false
);
assert.equal(
  stopConditions(collidingGameSeedState, stageGames, 0).ready,
  false
);

const repeatedAttemptSeedState = {
  ...state,
  coverageCohorts: state.coverageCohorts.map((batch, index) =>
    index === 0
      ? {
          ...batch,
          gameSeeds: [
            ...batch.qualifyingGameSeeds,
            batch.qualifyingGameSeeds[0],
          ],
        }
      : batch
  ),
};
assert.equal(
  stopConditions(repeatedAttemptSeedState, stageGames, 0).allGameSeedsUnique,
  false
);
assert.equal(
  stopConditions(repeatedAttemptSeedState, stageGames, 0).ready,
  false
);

const repeatedCappedState = {
  ...state,
  cleanBatches: state.cleanBatches.map((batch, index) => ({
    ...batch,
    observedTickets:
      index < 2
        ? [
            {
              kind: "capped",
              signature: "capped|same-signature",
              seed: batch.seed,
            },
          ]
        : [],
  })),
  coverageCohorts: state.coverageCohorts.map((batch, index) => ({
    ...batch,
    observedTickets:
      index < 2
        ? [
            {
              kind: "capped",
              signature: "capped|same-signature",
              seed: batch.seed,
            },
          ]
        : [],
  })),
};
assert.equal(
  stopConditions(repeatedCappedState, stageGames, 0).noCrossBatchCappedRepeats,
  false
);
assert.equal(stopConditions(repeatedCappedState, stageGames, 0).ready, false);

const repeatedCappedIneligibleState = normalizeStageState(
  {
    ...state,
    ineligibleCohorts: [
      {
        stageIndex: 2,
        games: 3000,
        seed: 400,
        observedTickets: [
          {
            kind: "capped",
            signature: "capped|ineligible-signature",
            seed: 400,
          },
        ],
      },
      {
        stageIndex: 2,
        games: 3000,
        seed: 500,
        observedTickets: [
          {
            kind: "capped",
            signature: "capped|ineligible-signature",
            seed: 500,
          },
        ],
      },
    ],
  },
  { head: "abc123", stageGames }
);
assert.equal(repeatedCappedIneligibleState.ineligibleCohorts.length, 2);
assert.equal(
  stopConditions(repeatedCappedIneligibleState, stageGames, 0)
    .noCrossBatchCappedRepeats,
  false
);

const missingSeedState = {
  ...state,
  cleanBatches: state.cleanBatches.map((batch, index) =>
    index === 1 ? { ...batch, seed: undefined } : batch
  ),
  coverageCohorts: state.coverageCohorts.map((batch, index) =>
    index === 1 ? { ...batch, seed: undefined } : batch
  ),
};
assert.equal(stopConditions(missingSeedState, stageGames, 0).ready, false);
assert.equal(
  stopConditions(missingSeedState, stageGames, 0).allBatchesSeeded,
  false
);

const missingHistoricalSeedsState = normalizeStageState(
  {
    ...state,
    ineligibleCohorts: [
      {
        stageIndex: 1,
        games: 50,
        artifactDir: "missing-ineligible-seed",
      },
    ],
    stressCohorts: [
      {
        stageIndex: 2,
        games: 1,
        artifactDir: "missing-stress-seed",
      },
    ],
  },
  {
    head: "abc123",
    stageGames,
    behaviorFingerprint: state.behaviorFingerprint,
  }
);
assert.equal(missingHistoricalSeedsState.ineligibleCohorts.length, 1);
assert.equal(missingHistoricalSeedsState.stressCohorts.length, 1);
assert.equal(
  stopConditions(missingHistoricalSeedsState, stageGames, 0).allBatchesSeeded,
  false,
  "missing historical seeds must remain visible and block stop-ready"
);
assert.equal(
  stopConditions(missingHistoricalSeedsState, stageGames, 0).ready,
  false
);

const duplicateHistoricalSeedState = {
  ...state,
  ineligibleCohorts: [
    {
      stageIndex: 0,
      games: 1,
      seed: state.coverageCohorts[0].seed,
      gameSeeds: [0xfffffff0],
    },
  ],
  stressCohorts: [
    {
      stageIndex: 0,
      games: 1,
      seed: state.coverageCohorts[1].seed,
      gameSeeds: [0xfffffff1],
      artifactDir: "duplicate-stress-seed",
    },
  ],
};
assert.equal(
  stopConditions(duplicateHistoricalSeedState, stageGames, 0).uniqueSeeds,
  false,
  "coverage, ineligible, and stress cohorts share one seed namespace"
);
assert.equal(
  stopConditions(duplicateHistoricalSeedState, stageGames, 0).ready,
  false
);
const incompleteReady = normalizeStageState(
  {
    schemaVersion: 5,
    head: "abc123",
    stageKey: stageGames.join(","),
    stageIndex: stageGames.length,
    cleanBatches: [state.cleanBatches[0]],
    stopReady: true,
  },
  { head: "abc123", stageGames }
);
assert.equal(incompleteReady.stopReady, false);

const headChanged = normalizeStageState(
  {
    ...state,
    policyTraining: {
      checkpointFile: "checkpoint.json",
      checkpointSha256: "abc123",
      trainingStep: 7,
    },
  },
  {
    head: "def456",
    stageGames,
  }
);
assert.equal(headChanged.stageIndex, 0);
assert.equal(headChanged.cleanGames, 0);
assert.equal(headChanged.resetReason, "behavior");
assert.equal(headChanged.policyTraining.trainingStep, 7);

const metadataOnlyHeadChanged = normalizeStageState(state, {
  head: "metadata-only-head",
  stageGames,
  behaviorFingerprint: state.behaviorFingerprint,
});
assert.equal(metadataOnlyHeadChanged.stageIndex, state.stageIndex);
assert.equal(metadataOnlyHeadChanged.cleanGames, state.cleanGames);
assert.equal(metadataOnlyHeadChanged.activeBatch, null);
assert.equal(metadataOnlyHeadChanged.resetReason, null);
const deduplicatedStressState = normalizeStageState(
  {
    ...metadataOnlyHeadChanged,
    head: "metadata-only-head",
    stressCohorts: [
      {
        stageIndex: 0,
        games: 1,
        seed: 900,
        artifactDir: "same-stress-artifact",
        status: "checkpointed-timeout",
      },
      {
        stageIndex: 0,
        games: 1,
        seed: 900,
        artifactDir: "same-stress-artifact",
        status: "clean",
      },
    ],
  },
  {
    head: "metadata-only-head",
    stageGames,
    behaviorFingerprint: state.behaviorFingerprint,
  }
);
assert.deepEqual(deduplicatedStressState.stressCohorts, [
  {
    stageIndex: 0,
    games: 1,
    seed: 900,
    artifactDir: "same-stress-artifact",
    status: "clean",
  },
]);
assert.deepEqual(
  upsertStressCohort(deduplicatedStressState.stressCohorts, {
    stageIndex: 0,
    games: 1,
    seed: 900,
    artifactDir: "same-stress-artifact",
    status: "performance-observed",
  }),
  [
    {
      stageIndex: 0,
      games: 1,
      seed: 900,
      artifactDir: "same-stress-artifact",
      status: "performance-observed",
    },
  ]
);

const resetEvidenceState = resetStageState(
  {
    ...state,
    ineligibleCohorts: [{ experimentId: "old-ineligible" }],
    coverageCohorts: [{ experimentId: "coverage-before-reset" }],
    stressCohorts: [{ experimentId: "stress-before-reset" }],
  },
  { reason: "stress-invalid", invalid: true }
);
assert.deepEqual(resetEvidenceState.cleanBatches, []);
assert.deepEqual(resetEvidenceState.coverageCohorts, []);
assert.deepEqual(
  resetEvidenceState.ineligibleCohorts.map((cohort) => cohort.experimentId),
  ["old-ineligible", "coverage-before-reset"]
);
assert.deepEqual(
  resetEvidenceState.stressCohorts.map((cohort) => cohort.experimentId),
  ["stress-before-reset"]
);

const clusterRegistryDir = mkdtempSync(
  join(tmpdir(), "orica-cluster-multi-evidence-")
);
try {
  const clusterRegistry = join(clusterRegistryDir, "cluster-registry.json");
  writeFileSync(
    clusterRegistry,
    JSON.stringify({ schemaVersion: 1, updated: "2026-09-07", clusters: [] })
  );
  const queueRefs = ["ticket-coverage.md", "ticket-mcts.md"];
  const proposed = spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), "scripts", "cluster-claim.mjs"),
      "propose",
      "--id",
      "edh-capped-multi-evidence",
      "--lane",
      "codex",
      "--scope",
      "multi evidence",
      "--queue-refs-b64",
      Buffer.from(JSON.stringify(queueRefs), "utf8").toString("base64"),
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ORICA_CLUSTER_REGISTRY: clusterRegistry },
    }
  );
  assert.equal(proposed.status, 0, proposed.stderr);
  assert.deepEqual(
    JSON.parse(readFileSync(clusterRegistry, "utf8")).clusters[0].queueRefs,
    queueRefs
  );

  const additionalQueueRefs = ["ticket-mcts.md", "ticket-third.md"];
  const updated = spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), "scripts", "cluster-claim.mjs"),
      "propose",
      "--id",
      "edh-capped-multi-evidence",
      "--lane",
      "codex",
      "--scope",
      "updated multi evidence",
      "--queue-refs-b64",
      Buffer.from(JSON.stringify(additionalQueueRefs), "utf8").toString(
        "base64"
      ),
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ORICA_CLUSTER_REGISTRY: clusterRegistry },
    }
  );
  assert.equal(updated.status, 0, updated.stderr);
  const updatedCluster = JSON.parse(readFileSync(clusterRegistry, "utf8"))
    .clusters[0];
  assert.deepEqual(updatedCluster.queueRefs, [
    "ticket-coverage.md",
    "ticket-mcts.md",
    "ticket-third.md",
  ]);
  assert.equal(updatedCluster.scope, "updated multi evidence");

  const done = spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), "scripts", "cluster-claim.mjs"),
      "done",
      "--id",
      "edh-capped-multi-evidence",
      "--commit",
      "test-commit",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ORICA_CLUSTER_REGISTRY: clusterRegistry },
    }
  );
  assert.equal(done.status, 0, done.stderr);

  const recurred = spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), "scripts", "cluster-claim.mjs"),
      "propose",
      "--id",
      "edh-capped-multi-evidence",
      "--lane",
      "codex",
      "--scope",
      "recurred with identical evidence",
      "--queue-refs-b64",
      Buffer.from(JSON.stringify(updatedCluster.queueRefs), "utf8").toString(
        "base64"
      ),
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ORICA_CLUSTER_REGISTRY: clusterRegistry },
    }
  );
  assert.equal(recurred.status, 0, recurred.stderr);
  assert.equal(JSON.parse(recurred.stdout).status, "reopened");
  const reopenedCluster = JSON.parse(readFileSync(clusterRegistry, "utf8"))
    .clusters[0];
  assert.equal(reopenedCluster.status, "open");
  assert.equal(reopenedCluster.scope, "recurred with identical evidence");
  assert.equal(reopenedCluster.resolvedCommit, undefined);
  assert.equal(reopenedCluster.reopenedFrom.resolvedCommit, "test-commit");
  assert.match(reopenedCluster.reopenedFrom.resolvedAt, /^\d{4}-\d{2}-\d{2}$/);
} finally {
  rmSync(clusterRegistryDir, { recursive: true, force: true });
}

const seedPlan = buildFuzzSeedPlan({
  games: 8,
  rotatingSeedBase: 100,
  regressionSeeds: [1, 2, 3],
});
assert.deepEqual(seedPlan.seeds, [1, 2, 3, 100, 101, 102, 103, 104]);
const fuzzLedgerDir = mkdtempSync(join(tmpdir(), "orica-fuzz-ledger-"));
try {
  const fuzzLedger = join(fuzzLedgerDir, "ledger.json");
  const first = reserveFuzzSeedRange({
    stateFile: fuzzLedger,
    games: 10,
    head: "abc",
  });
  const second = reserveFuzzSeedRange({
    stateFile: fuzzLedger,
    games: 10,
    head: "abc",
  });
  assert.ok(second > first + 10);
  assert.equal(JSON.parse(readFileSync(fuzzLedger, "utf8")).history.length, 2);
  writeFileSync(
    fuzzLedger,
    JSON.stringify({ schemaVersion: 2, nextSeedBase: 123, history: [] }),
    "utf8"
  );
  assert.throws(
    () =>
      reserveFuzzSeedRange({ stateFile: fuzzLedger, games: 1, head: "abc" }),
    /invalid fuzz seed ledger/,
    "an invalid ledger schema must fail closed instead of reissuing seeds"
  );
  assert.throws(() => readFileSync(fuzzLedger + ".lock", "utf8"), /ENOENT/);
  writeFileSync(fuzzLedger, "{broken-json", "utf8");
  assert.throws(
    () =>
      reserveFuzzSeedRange({ stateFile: fuzzLedger, games: 1, head: "abc" }),
    SyntaxError,
    "a corrupt seed ledger must fail closed instead of reissuing seeds"
  );
  assert.throws(
    () => readFileSync(fuzzLedger + ".lock", "utf8"),
    /ENOENT/,
    "a failed reservation must release its lock"
  );
  const foreignLock = fuzzLedger + ".lock";
  writeFileSync(foreignLock, "foreign-owner", "utf8");
  assert.throws(
    () =>
      reserveFuzzSeedRange({ stateFile: fuzzLedger, games: 1, head: "abc" }),
    /EEXIST/
  );
  assert.equal(readFileSync(foreignLock, "utf8"), "foreign-owner");
} finally {
  rmSync(fuzzLedgerDir, { recursive: true, force: true });
}

console.log("[test-effect-debug-loop-state] passed");
