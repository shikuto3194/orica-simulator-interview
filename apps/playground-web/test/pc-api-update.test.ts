import { describe, expect, it, vi } from "vitest";
import {
  replaceRelease,
  prepareRelease,
} from "../../../deploy/local-pc/update-api.mjs";

const oldRelease = { revision: "old", directory: "releases/old" };
const newRelease = { revision: "new", directory: "releases/new" };
function operations() {
  const events: string[] = [];
  return {
    events,
    prepare: vi.fn(async () => {
      events.push("build+smoke");
      return newRelease;
    }),
    stop: vi.fn(async () => {
      events.push("stop");
    }),
    start: vi.fn(async (release: typeof oldRelease) => {
      events.push("start+health:" + release.revision);
    }),
    save: vi.fn(async () => {
      events.push("save");
    }),
  };
}
describe("PC API automatic update", () => {
  it("leaves the current server running while building, then restarts and records the healthy release", async () => {
    const ops = operations();
    expect(await replaceRelease(oldRelease, "new", ops)).toEqual(newRelease);
    expect(ops.events).toEqual([
      "build+smoke",
      "stop",
      "start+health:new",
      "save",
    ]);
  });
  it("does not build/restart an unchanged revision", async () => {
    const ops = operations();
    expect(await replaceRelease(oldRelease, "old", ops)).toBe(oldRelease);
    expect(ops.events).toEqual([]);
  });
  it("does not stop the server when build or smoke verification fails", async () => {
    const ops = operations();
    ops.prepare.mockRejectedValue(new Error("build failed"));
    await expect(replaceRelease(oldRelease, "new", ops)).rejects.toThrow(
      "build failed"
    );
    expect(ops.stop).not.toHaveBeenCalled();
    expect(ops.save).not.toHaveBeenCalled();
  });
  it("restarts the previous release when the candidate fails its health check", async () => {
    const ops = operations();
    ops.start.mockImplementationOnce(async () => {
      throw new Error("health failed");
    });
    await expect(replaceRelease(oldRelease, "new", ops)).rejects.toThrow(
      "health failed"
    );
    expect(ops.start.mock.calls).toEqual([[newRelease], [oldRelease]]);
    expect(ops.stop).toHaveBeenCalledTimes(2);
    expect(ops.save).not.toHaveBeenCalled();
  });
  it("rolls back if the restart pointer could not be saved", async () => {
    const ops = operations();
    ops.save.mockRejectedValue(new Error("disk full"));
    await expect(replaceRelease(oldRelease, "new", ops)).rejects.toThrow(
      "disk full"
    );
    expect(ops.start.mock.calls).toEqual([[newRelease], [oldRelease]]);
  });
  it("rejects a path-like revision before any filesystem operation", async () => {
    await expect(prepareRelease(".", "../../outside")).rejects.toThrow(
      "Invalid release revision"
    );
  });
});

it("keeps the old API alive if candidate schema readiness fails", async () => {
  const ops = {
    ...operations(),
    preflight: vi.fn(async () => {
      throw new Error("schema unavailable");
    }),
  };
  await expect(replaceRelease(oldRelease, "new", ops)).rejects.toThrow(
    "schema unavailable"
  );
  expect(ops.stop).not.toHaveBeenCalled();
  expect(ops.start).not.toHaveBeenCalled();
});
