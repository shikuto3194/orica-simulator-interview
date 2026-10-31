export const REPLAY_DELTA_CODEC: "orica-replay-delta-v1";
export class ReplayDeltaEncoder {
  append(frame: unknown): {
    index: number;
    base: number | null;
    patch: unknown;
  };
}
export class ReplayDeltaDecoder {
  append(record: unknown): Record<string, unknown>;
}
