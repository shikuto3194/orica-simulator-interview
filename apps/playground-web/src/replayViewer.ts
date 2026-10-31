import {
  ReplayDeltaDecoder,
  REPLAY_DELTA_CODEC,
} from "../../../packages/replay-codec/replay-delta.mjs";
import {
  parseGameSnapshot,
  restoreSnapshot,
  type CardDefinition,
  type GameState,
  type TriggeredEffectActionRegistrationLookup,
} from "@orica/rules-core";

export interface ReplayFrame {
  state?: GameState;
  encodedFrame?: string;
  label?: string;
  step?: number;
  nodeKind?: string;
  choiceId?: string;
  actionKind?: string;
  actionId?: string;
  actingPlayerId?: string;
  systemActionKind?: string;
  preGamePhase?: string;
}

export interface ParsedReplay {
  title: string;
  frames: ReplayFrame[];
  warnings: string[];
}

interface ParseReplayOptions {
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions?: TriggeredEffectActionRegistrationLookup;
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGameStateLike(value: unknown): value is GameState {
  if (!isRecord(value)) return false;
  return (
    typeof value.turnNumber === "number" &&
    typeof value.activePlayerId === "string" &&
    typeof value.step === "string" &&
    Array.isArray(value.players) &&
    Array.isArray(value.cardInstances)
  );
}

function stringValue(record: RecordValue, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function numberValue(record: RecordValue, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function candidateFrames(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (!isRecord(input)) {
    throw new Error("棋譜 JSON は object または array である必要があります");
  }
  const frames = input.frames ?? input.states ?? input.snapshots;
  if (Array.isArray(frames)) return frames;
  if (isGameStateLike(input) || parseGameSnapshot(input).ok) return [input];
  throw new Error("棋譜 JSON に frames / states / snapshots がありません");
}

function replayTitle(input: unknown): string {
  if (!isRecord(input)) return "棋譜";
  return stringValue(input, "title") ?? stringValue(input, "label") ?? "棋譜";
}

function restoreSnapshotFrame(
  value: unknown,
  opts: ParseReplayOptions
): { state: GameState; warnings: string[] } | null {
  const parsed = parseGameSnapshot(value);
  if (!parsed.ok) return null;
  const restored = restoreSnapshot(
    parsed.snapshot,
    opts.getCardDefinitionById,
    opts.getRegisteredTriggeredEffectActions
      ? {
          getRegisteredTriggeredEffectActions:
            opts.getRegisteredTriggeredEffectActions,
        }
      : undefined
  );
  return restored;
}

function frameMetadata(
  source: unknown,
  index: number
): Omit<ReplayFrame, "state"> {
  if (!isRecord(source)) return { step: index };
  const trace = isRecord(source.traceEntry)
    ? source.traceEntry
    : isRecord(source.decision)
      ? source.decision
      : source;
  const metadata: Omit<ReplayFrame, "state"> = {
    step: numberValue(trace, "step") ?? numberValue(source, "step") ?? index,
  };
  const label = stringValue(source, "label");
  if (label !== undefined) metadata.label = label;
  const nodeKind = stringValue(trace, "nodeKind");
  if (nodeKind !== undefined) metadata.nodeKind = nodeKind;
  const choiceId = stringValue(trace, "choiceId");
  if (choiceId !== undefined) metadata.choiceId = choiceId;
  const actionKind = stringValue(trace, "actionKind");
  if (actionKind !== undefined) metadata.actionKind = actionKind;
  const actionId = stringValue(trace, "actionId");
  if (actionId !== undefined) metadata.actionId = actionId;
  const actingPlayerId = stringValue(trace, "actingPlayerId");
  if (actingPlayerId !== undefined) metadata.actingPlayerId = actingPlayerId;
  const systemActionKind = stringValue(trace, "systemActionKind");
  if (systemActionKind !== undefined)
    metadata.systemActionKind = systemActionKind;
  const preGamePhase = stringValue(trace, "preGamePhase");
  if (preGamePhase !== undefined) metadata.preGamePhase = preGamePhase;
  return metadata;
}

function parseFrame(
  source: unknown,
  index: number,
  opts: ParseReplayOptions
): { frame: ReplayFrame; warnings: string[] } {
  const directSnapshot = restoreSnapshotFrame(source, opts);
  if (directSnapshot) {
    return {
      frame: { ...frameMetadata(source, index), state: directSnapshot.state },
      warnings: directSnapshot.warnings,
    };
  }

  if (isRecord(source)) {
    const nestedSnapshotInput = source.snapshot;
    if (nestedSnapshotInput !== undefined) {
      const nestedSnapshot = restoreSnapshotFrame(nestedSnapshotInput, opts);
      if (!nestedSnapshot) {
        throw new Error(
          `frame[${index}].snapshot は GameSnapshot 形式ではありません`
        );
      }
      return {
        frame: { ...frameMetadata(source, index), state: nestedSnapshot.state },
        warnings: nestedSnapshot.warnings,
      };
    }

    if (isGameStateLike(source.state)) {
      return {
        frame: { ...frameMetadata(source, index), state: source.state },
        warnings: [],
      };
    }
  }

  if (isGameStateLike(source)) {
    return {
      frame: { ...frameMetadata(source, index), state: source },
      warnings: [],
    };
  }

  throw new Error(`frame[${index}] から GameState を読み取れません`);
}

export function parseReplayJson(
  input: unknown,
  opts: ParseReplayOptions
): ParsedReplay {
  const frames = candidateFrames(input);
  if (frames.length === 0) {
    throw new Error("棋譜に frame がありません");
  }
  const parsedFrames: ReplayFrame[] = [];
  const warnings: string[] = [];
  frames.forEach((frameInput, index) => {
    const parsed = parseFrame(frameInput, index, opts);
    parsedFrames.push(parsed.frame);
    warnings.push(
      ...parsed.warnings.map((warning) => `frame[${index}]: ${warning}`)
    );
  });
  return {
    title: replayTitle(input),
    frames: parsedFrames,
    warnings,
  };
}

function isReplayJsonlMetadata(
  value: unknown
): value is { title?: string; label?: string; codec?: unknown } {
  return (
    isRecord(value) &&
    (typeof value.title === "string" || typeof value.label === "string") &&
    value.state === undefined &&
    value.snapshot === undefined &&
    !isGameStateLike(value)
  );
}

async function parseReplayJsonlFile(
  file: File,
  opts: ParseReplayOptions
): Promise<ParsedReplay> {
  const frames: ReplayFrame[] = [];
  const decoder = new TextDecoder();
  const stream = file.name.endsWith(".gz")
    ? file.stream().pipeThrough(new DecompressionStream("gzip"))
    : file.stream();
  const reader = stream.getReader();
  let replayDecoder: ReplayDeltaDecoder | null = null;
  const warnings: string[] = [];
  let buffer = "";
  let lineNumber = 0;
  let title = "棋譜";

  const processLine = (line: string) => {
    if (line.trim().length === 0) return;
    const value: unknown = JSON.parse(line);
    if (lineNumber === 0 && isReplayJsonlMetadata(value)) {
      title = value.title ?? value.label ?? title;
      if (value.codec !== undefined) {
        if (value.codec !== REPLAY_DELTA_CODEC)
          throw new Error("未対応の棋譜圧縮形式です");
        replayDecoder = new ReplayDeltaDecoder();
      }
    } else if (replayDecoder) {
      const parsed = parseFrame(
        replayDecoder.append(value),
        frames.length,
        opts
      );
      frames.push(parsed.frame);
      warnings.push(...parsed.warnings);
    } else {
      frames.push({
        ...frameMetadata(value, frames.length),
        encodedFrame: line,
      });
    }
    lineNumber += 1;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      processLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  processLine(buffer);

  if (frames.length === 0) {
    throw new Error("棋譜に frame がありません");
  }
  return { title, frames, warnings };
}

export async function parseReplayFile(
  file: File,
  opts: ParseReplayOptions
): Promise<ParsedReplay> {
  if (/\.jsonl(?:\.gz)?$/.test(file.name))
    return parseReplayJsonlFile(file, opts);
  const text = file.name.endsWith(".gz")
    ? await new Response(
        file.stream().pipeThrough(new DecompressionStream("gzip"))
      ).text()
    : await file.text();
  const json = JSON.parse(text) as unknown;
  return parseReplayJson(json, opts);
}

export function resolveReplayFrameState(
  frame: ReplayFrame,
  opts: ParseReplayOptions
): { state: GameState; warnings: string[] } {
  if (frame.state) return { state: frame.state, warnings: [] };
  if (frame.encodedFrame === undefined) {
    throw new Error("replay frame has no state");
  }
  const parsed = parseFrame(
    JSON.parse(frame.encodedFrame),
    frame.step ?? 0,
    opts
  );
  Object.assign(frame, parsed.frame);
  return { state: parsed.frame.state!, warnings: parsed.warnings };
}
