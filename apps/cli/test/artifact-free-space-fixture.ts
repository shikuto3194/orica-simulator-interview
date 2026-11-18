import { beforeEach, vi } from "vitest";

const { statfsMock } = vi.hoisted(() => ({ statfsMock: vi.fn() }));

// Keep real artifact I/O and production quotas; only the host's free-space
// measurement is a deterministic dependency of these temporary-output tests.
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  statfsSync: statfsMock,
}));

export function setArtifactFreeBytes(bytes: number): void {
  statfsMock.mockReturnValue({
    type: 0,
    bsize: 1,
    blocks: bytes,
    bfree: bytes,
    bavail: bytes,
    files: 0,
    ffree: 0,
  });
}

beforeEach(() => setArtifactFreeBytes(200 * 1024 ** 3));
