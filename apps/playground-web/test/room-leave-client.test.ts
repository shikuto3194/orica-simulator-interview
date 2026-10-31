import { afterEach, expect, it, vi } from "vitest";
import { notifyRoomLeave } from "../src/roomLeave";

afterEach(() => vi.unstubAllGlobals());
it("starts an authenticated keepalive request synchronously without putting credentials in the URL/body", async () => {
  const send = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", send);
  const result = notifyRoomLeave("room1", "alice", "private-token");
  expect(send).toHaveBeenCalledTimes(1);
  const [url, options] = send.mock.calls[0];
  expect(url).toBe("/api/room/room1/leave");
  expect(options.keepalive).toBe(true);
  expect(options.credentials).toBe("omit");
  expect(options.headers.Authorization).toBe("Bearer private-token");
  expect(JSON.parse(options.body)).toEqual({ userId: "alice" });
  expect(await result).toBe(true);
});
it("never falls back to an unauthenticated request on missing session or network failure", async () => {
  const send = vi.fn().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", send);
  expect(await notifyRoomLeave("room1", "alice", null)).toBe(false);
  expect(send).not.toHaveBeenCalled();
  expect(await notifyRoomLeave("room1", "alice", "token")).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);
});
