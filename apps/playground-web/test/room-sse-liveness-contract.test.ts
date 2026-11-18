/**
 * Room SSE liveness regression guard.
 *
 * 相手画面の反映速度は通常 SSE state_update で決まるが、古い接続を
 * connected のまま扱うと fallback polling が 60 秒間隔になり応答が遅れる。
 * ping / stale / fast reconnect の契約を source-level で固定する。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  isRoomSSEAudienceAccepted,
  shouldAcceptRoomSyncVersion,
  shouldApplyRoomSSEStateUpdate,
  shouldRecoverRoomSSESnapshot,
} from "../src/hooks/useRoomSync";
import { shouldDeliverSSESnapshot } from "../server/game-api";

const __dirname = dirname(fileURLToPath(import.meta.url));
const USE_ROOM_SYNC = readFileSync(
  resolve(__dirname, "../src/hooks/useRoomSync.ts"),
  "utf8"
);
const GAME_API = readFileSync(
  resolve(__dirname, "../server/game-api.ts"),
  "utf8"
);

describe("room SSE liveness contract", () => {
  it("server ping を受けたら connected 鮮度を更新する", () => {
    expect(USE_ROOM_SYNC).toContain(
      'export type SSEStatus = "disconnected" | "connecting" | "connected" | "stale"'
    );
    expect(USE_ROOM_SYNC).toContain('eventName === "ping"');
    expect(USE_ROOM_SYNC).toContain("markSSEActivity()");
    expect(GAME_API).toContain("event: ping");
    expect(GAME_API).toContain("serverTime: Date.now()");
    expect(GAME_API).toContain('"Cache-Control": "no-cache, no-transform"');
    expect(GAME_API).toContain('"X-Accel-Buffering": "no"');
    expect(GAME_API).toContain("res.flushHeaders?.()");
  });

  it("stale SSE は abort して短い backoff で再接続する", () => {
    expect(USE_ROOM_SYNC).toContain("const SSE_STALE_AFTER_MS = 10_000");
    expect(USE_ROOM_SYNC).toContain("const SSE_RECONNECT_BASE_DELAY_MS = 250");
    expect(USE_ROOM_SYNC).toContain('setSSEStatus("stale")');
    expect(USE_ROOM_SYNC).toContain("ctrl.abort()");
    // Fast fallback polling is exercised through the GUI in e2e/room-sync-errors.spec.ts.
  });

  it("state_update は単調増加する version だけを適用する", () => {
    expect(shouldApplyRoomSSEStateUpdate({ version: 8 }, 7)).toBe(true);
    expect(shouldApplyRoomSSEStateUpdate({ version: 7 }, 7)).toBe(false);
    expect(shouldApplyRoomSSEStateUpdate({ version: 6 }, 7)).toBe(false);
    expect(shouldApplyRoomSSEStateUpdate({}, 7)).toBe(false);
    expect(GAME_API).not.toContain("authoritativeReplacement");
  });

  it("HTTP/fetch も古い version を破棄し、同 version までだけ受理する", () => {
    expect(shouldAcceptRoomSyncVersion(8, 7)).toBe(true);
    expect(shouldAcceptRoomSyncVersion(7, 7)).toBe(true);
    expect(shouldAcceptRoomSyncVersion(6, 7)).toBe(false);
    expect(shouldAcceptRoomSyncVersion(7, 7, false)).toBe(false);
    expect(USE_ROOM_SYNC).toContain("data.version < lastKnownVersion.current");
    expect(USE_ROOM_SYNC).toContain("acceptAuthoritativeState(");
    expect(USE_ROOM_SYNC).toContain("return lastKnownState.current");
  });

  it("member は spectator SSE audience を拒否し、回復失敗中は stale を維持する", () => {
    expect(isRoomSSEAudienceAccepted(true, false)).toBe(true);
    expect(isRoomSSEAudienceAccepted(true, true)).toBe(false);
    expect(isRoomSSEAudienceAccepted(false, true)).toBe(true);
    expect(USE_ROOM_SYNC).toContain("audienceAccepted = false");
    expect(USE_ROOM_SYNC).toContain("rejectSSEConnection()");
    expect(USE_ROOM_SYNC).toContain("SSE_RECOVERY_MAX_ATTEMPTS = 3");
    expect(USE_ROOM_SYNC).toContain("newState = await recoverSSEState");
  });

  it("再接続時は最新 room の viewer-safe snapshot を通常の version 更新として送る", () => {
    const registerIndex = GAME_API.indexOf("const entry = addSSEConnection(");
    const refreshIndex = GAME_API.indexOf(
      "streamRoom = await getRoom(roomId)",
      registerIndex
    );
    const closeListenerIndex = GAME_API.indexOf(
      'req.on("close", () => {',
      registerIndex
    );
    expect(registerIndex).toBeGreaterThan(-1);
    expect(closeListenerIndex).toBeGreaterThan(registerIndex);
    expect(refreshIndex).toBeGreaterThan(closeListenerIndex);
    expect(refreshIndex).toBeGreaterThan(registerIndex);
    expect(GAME_API).toContain("streamRoom = await getRoom(roomId)");
    expect(GAME_API).toContain(
      "prepareRoomViewerState(streamRoom.state, viewerPlayerId)"
    );
    expect(GAME_API).toMatch(
      /deliverSSEStateFrame\(\s*roomId,\s*entry,\s*streamRoom\.state_version,\s*fullStateSSEFrame\(\s*streamRoom\.state_version,\s*prepareRoomViewerState\(streamRoom\.state, viewerPlayerId\)\s*\)\s*\)/
    );
    expect(shouldDeliverSSESnapshot(8, 7)).toBe(true);
    expect(shouldDeliverSSESnapshot(8, 8)).toBe(false);
    expect(shouldDeliverSSESnapshot(8, 9)).toBe(false);
  });

  it("duplicate 再送と post-commit sanitize 失敗から同期を回復できる", () => {
    expect(GAME_API).toContain("duplicateRequirements");
    expect(GAME_API).toContain("committedRoomMutationSuccessPayload(");
    expect(GAME_API).toContain("syncUnavailable: true");
    expect(GAME_API).toContain("prepareViewerStateSyncPayloadsSafely(");
    expect(GAME_API).toContain("getSSEViewerSyncRequirements(");
    expect(GAME_API).toContain("if (!latestRoom?.state)");
    expect(GAME_API).not.toContain(
      "const latestState = latestRoom?.state ?? input.previousState"
    );
  });

  it("connected が先行しても短い猶予後に不足版だけ snapshot 回復する", () => {
    expect(shouldRecoverRoomSSESnapshot(8, 7)).toBe(true);
    expect(shouldRecoverRoomSSESnapshot(7, 7)).toBe(false);
    expect(shouldRecoverRoomSSESnapshot(undefined, 7)).toBe(false);
    expect(USE_ROOM_SYNC).toContain(
      "const SSE_CONNECTED_SNAPSHOT_GRACE_MS = 250"
    );
    expect(USE_ROOM_SYNC).toContain("connectedSnapshotTimer = setTimeout");
    expect(USE_ROOM_SYNC).toContain("await recoverSSEState(targetVersion)");
  });
});
