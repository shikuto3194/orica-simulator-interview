import { describe, expect, it, vi } from "vitest";
import { readPendingMutation } from "../src/roomMutationJournal";
import {
  isRoomMutationAcknowledgement,
  isRoomMutationRequest,
  isRoomVersion,
  isSequentialRoomPatch,
  parseRoomMutationId,
} from "../shared/room-protocol";

describe("room wire metadata", () => {
  it("rejects a persisted null mutation ID before recovery can send it", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () =>
        JSON.stringify({
          path: "step",
          id: null,
          version: 0,
          payload: {},
          retryAt: 0,
        }),
    });
    try {
      expect(readPendingMutation("journal")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it.each([-1, 0.5, "1", null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid version %s",
    (value) => {
      expect(isRoomVersion(value)).toBe(false);
      expect(isRoomMutationRequest({ expectedVersion: value })).toBe(false);
      expect(isRoomMutationAcknowledgement({ version: value }, "id")).toBe(
        false
      );
    }
  );
  it("retains legacy missing metadata and normalizes the existing ID boundary", () => {
    expect(isRoomMutationRequest({})).toBe(true);
    expect(isRoomMutationAcknowledgement({ version: 0 }, "id")).toBe(true);
    expect(
      isRoomMutationAcknowledgement({ version: 1, syncUnavailable: true }, "id")
    ).toBe(true);
    expect(parseRoomMutationId(" id ")).toBe("id");
    expect(parseRoomMutationId(" ")).toBeNull();
    expect(parseRoomMutationId("a".repeat(161))).toBeNull();
    expect(isRoomMutationRequest({ clientMutationId: 1 })).toBe(false);
    expect(
      isRoomMutationAcknowledgement(
        { version: 1, clientMutationId: "other" },
        "id"
      )
    ).toBe(false);
  });
  it("only applies an adjacent patch on its exact confirmed base", () => {
    expect(isSequentialRoomPatch(2, 1, 1)).toBe(true);
    expect(isSequentialRoomPatch(3, 1, 1)).toBe(false);
    expect(isSequentialRoomPatch(2, 0, 1)).toBe(false);
  });
});
