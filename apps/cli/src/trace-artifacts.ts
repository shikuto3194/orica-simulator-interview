import {
  readArtifactText,
  readJsonRecords,
  readReplayArtifact,
  resolveJsonlSource,
} from "../../../scripts/lib/artifact-io.mjs";
import { join, resolve } from "node:path";

import {
  assertTrainingArtifactValid,
  validateTrainingReplaySampleRecord,
  validateTrainingTraceReplayArtifact,
  validateTrainingTraceSmokeFrameRecord,
  validateTrainingTraceSmokeSummaryArtifact,
  type TrainingArtifactValidationIssue,
} from "@orica/rules-core";

export interface TraceSmokeOutputValidationSummary {
  schemaVersion: 1;
  outputDir: string;
  frameCount: number;
  traceCount: number;
  replayCount: number;
  replaySampleCount: number;
  issueCount: number;
  issues: TrainingArtifactValidationIssue[];
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `${path}: invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
}

async function collectRecords(path: string): Promise<unknown[]> {
  const records: unknown[] = [];
  for await (const record of readJsonRecords(path)) records.push(record);
  return records;
}

function replayFilesFromMetrics(metrics: unknown): string[] {
  if (
    typeof metrics !== "object" ||
    metrics === null ||
    !("games" in metrics) ||
    !Array.isArray(metrics.games)
  ) {
    return [];
  }
  return metrics.games.flatMap((game) => {
    if (
      typeof game === "object" &&
      game !== null &&
      "replayFile" in game &&
      typeof game.replayFile === "string"
    ) {
      return [game.replayFile];
    }
    return [];
  });
}

function replayBufferFileFromMetrics(metrics: unknown): string | null {
  if (
    typeof metrics !== "object" ||
    metrics === null ||
    !("replayBuffer" in metrics) ||
    typeof metrics.replayBuffer !== "object" ||
    metrics.replayBuffer === null ||
    !("file" in metrics.replayBuffer) ||
    typeof metrics.replayBuffer.file !== "string"
  ) {
    return null;
  }
  return metrics.replayBuffer.file;
}

function replayBufferSampleCountFromMetrics(metrics: unknown): number | null {
  if (
    typeof metrics !== "object" ||
    metrics === null ||
    !("replayBuffer" in metrics) ||
    typeof metrics.replayBuffer !== "object" ||
    metrics.replayBuffer === null ||
    !("sampleCount" in metrics.replayBuffer) ||
    typeof metrics.replayBuffer.sampleCount !== "number"
  ) {
    return null;
  }
  return metrics.replayBuffer.sampleCount;
}

export async function validateTraceSmokeOutput(
  outDir: string
): Promise<TraceSmokeOutputValidationSummary> {
  const outputDir = resolve(outDir);
  const metricsPath = join(outputDir, "metrics.json");
  const framesPath = resolveJsonlSource(outputDir, "frames");
  const tracePath = resolveJsonlSource(outputDir, "trace");
  const metrics = parseJson(await readArtifactText(metricsPath), metricsPath);
  const frames = await collectRecords(framesPath);
  const trace = await collectRecords(tracePath);

  const issues: TrainingArtifactValidationIssue[] = [];
  issues.push(
    ...validateTrainingTraceSmokeSummaryArtifact(metrics, metricsPath).issues
  );
  for (const [index, frame] of frames.entries()) {
    issues.push(
      ...validateTrainingTraceSmokeFrameRecord(
        frame,
        `${framesPath}:${index + 1}`
      ).issues
    );
  }

  let replayCount = 0;
  for (const replayFile of replayFilesFromMetrics(metrics)) {
    replayCount += 1;
    const replay = await readReplayArtifact(replayFile);
    issues.push(
      ...validateTrainingTraceReplayArtifact(replay, replayFile).issues
    );
  }
  const replayBufferFile = replayBufferFileFromMetrics(metrics);
  const expectedReplaySampleCount = replayBufferSampleCountFromMetrics(metrics);
  const replaySamples =
    replayBufferFile === null ? [] : await collectRecords(replayBufferFile);
  if (replayBufferFile === null) {
    issues.push({
      path: `${metricsPath}.replayBuffer.file`,
      message: "must point to replay-buffer.jsonl",
    });
  }
  if (expectedReplaySampleCount === null) {
    issues.push({
      path: `${metricsPath}.replayBuffer.sampleCount`,
      message: "must be a number",
    });
  }
  for (const [index, sample] of replaySamples.entries()) {
    issues.push(
      ...validateTrainingReplaySampleRecord(
        sample,
        `${replayBufferFile}:${index + 1}`
      ).issues
    );
  }
  if (
    expectedReplaySampleCount !== null &&
    expectedReplaySampleCount !== replaySamples.length
  ) {
    issues.push({
      path: `${metricsPath}.replayBuffer.sampleCount`,
      message: "must match replay-buffer.jsonl line count",
    });
  }

  return {
    schemaVersion: 1,
    outputDir,
    frameCount: frames.length,
    traceCount: trace.length,
    replayCount,
    replaySampleCount: replaySamples.length,
    issueCount: issues.length,
    issues,
  };
}

export function assertTraceSmokeOutputValid(
  summary: TraceSmokeOutputValidationSummary
): void {
  assertTrainingArtifactValid({
    ok: summary.issueCount === 0,
    issues: summary.issues,
  });
}
