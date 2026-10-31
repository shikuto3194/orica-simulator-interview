import type { GameState } from "@orica/rules-core";
import { IS_INTERVIEW_BUILD } from "./interview-mode";
import {
  REPLAY_DELTA_CODEC,
  ReplayDeltaEncoder,
} from "../../../packages/replay-codec/replay-delta.mjs";

/** Records existing state frames only. Playback gestures are derived after loading. */
export class BattleReplayRecorder {
  private encoder = new ReplayDeltaEncoder();
  private lines: string[] = [];
  private previousJson: string | null = null;
  private ended = false;
  private roomGameNumber = 0;

  append(state: GameState): void {
    const json = JSON.stringify(state);
    if (json === this.previousJson) return;
    // A server rematch starts a new recording, including on the other client.
    const roomGameNumber = state.roomReset?.gameNumber ?? 0;
    if (
      (this.ended && !state.gameResult) ||
      roomGameNumber !== this.roomGameNumber
    )
      this.clear();
    this.roomGameNumber = roomGameNumber;
    this.lines.push(JSON.stringify(this.encoder.append({ state })) + "\n");
    this.previousJson = json;
    this.ended = state.gameResult != null;
  }

  clear(): void {
    this.encoder = new ReplayDeltaEncoder();
    this.lines = [];
    this.previousJson = null;
    this.ended = false;
    this.roomGameNumber = 0;
  }

  get frameCount(): number {
    return this.lines.length;
  }

  async file(title: string): Promise<File> {
    const source = new Blob(
      [
        JSON.stringify({ schemaVersion: 1, title, codec: REPLAY_DELTA_CODEC }) +
          "\n",
        ...this.lines,
      ],
      { type: "application/x-ndjson" }
    );
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (typeof CompressionStream === "undefined") {
      return new File([source], `orica-replay-${stamp}.jsonl`, {
        type: source.type,
      });
    }
    const compressed = await new Response(
      source.stream().pipeThrough(new CompressionStream("gzip"))
    ).blob();
    return new File([compressed], `orica-replay-${stamp}.jsonl.gz`, {
      type: "application/gzip",
    });
  }
}

export function downloadReplay(file: File): void {
  if (IS_INTERVIEW_BUILD) return;
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
