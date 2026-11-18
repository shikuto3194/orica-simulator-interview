export function resolveJsonlSource(directory: string, name: string): string;
export function readArtifactText(path: string): Promise<string>;
export function readJsonRecords(
  path: string,
  options?: { chunkSize?: number; maxRecordBytes?: number }
): AsyncGenerator<unknown>;
export function readReplayArtifact(path: string): Promise<unknown>;
