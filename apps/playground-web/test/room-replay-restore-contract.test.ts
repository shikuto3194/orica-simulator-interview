import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_API = readFileSync(
  resolve(__dirname, "../server/game-api.ts"),
  "utf8"
);
const MIGRATION_010 = readFileSync(
  resolve(
    __dirname,
    "../../../supabase/migrations/010_add_replay_restore_checkpoint.sql"
  ),
  "utf8"
);

describe("room replay restore generation contract", () => {
  it("restore は次 version の checkpoint event として原子的に commit する", () => {
    expect(GAME_API).toContain('"repair_room_state_from_replay"');
    expect(GAME_API).toContain("expectedRoomVersion: currentVersion");
    expect(GAME_API).toContain("replayedToVersion: toVersion");
    expect(GAME_API).toContain("committedVersion = restoreCommit.version");
    expect(GAME_API).not.toContain("state_version: currentVersion");
    expect(MIGRATION_010).toContain("'replay-restore'");
    expect(MIGRATION_010).toContain(
      "CREATE OR REPLACE FUNCTION public.repair_room_state_from_replay"
    );
    expect(MIGRATION_010).toContain("FOR UPDATE");
    expect(MIGRATION_010).toContain("v_event_version <> p_replayed_to_version");
    expect(MIGRATION_010).toContain(
      "v_new_version INTEGER := p_replayed_to_version + 1"
    );
  });

  it("event log が rooms.state より先でも head を再検証して M+1 へ復旧する", () => {
    expect(GAME_API).toContain("if (toVersion < currentVersion)");
    expect(GAME_API).not.toContain("if (toVersion !== currentVersion)");
    expect(GAME_API).toContain("Failed to fetch replay head");
    expect(GAME_API).toContain("Math.max(room.state_version, replayHead)");
    expect(MIGRATION_010).toContain(
      "v_current_version <> p_expected_room_version"
    );
    expect(MIGRATION_010).toContain("MAX(re.state_version)");
    expect(MIGRATION_010).toContain("state_version = v_new_version");
    expect(MIGRATION_010).toContain(
      "GRANT EXECUTE ON FUNCTION public.repair_room_state_from_replay"
    );
  });

  it("埋め込み state は endpoint に依存せず viewer ごとに sanitize する", () => {
    expect(GAME_API).toContain("sanitizeReplayEventForViewer");
    expect(GAME_API).toContain('["state", "stateOverrides"] as const');
    expect(GAME_API).toContain(
      "sanitizeReplayEventForViewer(event, auth.viewerPlayerId)"
    );
    expect(GAME_API).toContain('mode: "viewer_audit"');
    expect(GAME_API).toContain("engineReplayable: false");
    expect(GAME_API).toContain("payloadRedacted: true");
    expect(GAME_API).toContain("serverReplayPath:");
  });

  it("commit は運用者 token と同一 room の server snapshot に限定する", () => {
    expect(GAME_API).toContain("ROOM_REPLAY_RESTORE_TOKEN");
    expect(GAME_API).toContain('req.headers["x-orica-replay-restore-token"]');
    expect(GAME_API).toContain('"Replay restore commit is operator-only."');
    expect(GAME_API).toContain("if (commit && baseStateInput)");
    expect(GAME_API).toContain(
      "if (data.room_id != null && data.room_id !== roomId)"
    );
    expect(GAME_API).toContain(
      "if (commit && data.is_server_checkpoint !== true)"
    );
    expect(GAME_API).toContain(
      "state = normalizePersistedState(checkpointRoom.state)"
    );
    expect(GAME_API).toContain("is_server_checkpoint: isServerCheckpoint");
    expect(GAME_API).toContain("state: null");
    expect(MIGRATION_010).toContain("is_server_checkpoint");
  });

  it("dry-runでも別roomに紐づくsnapshotのraw stateを拒否する", () => {
    expect(GAME_API).not.toContain("if (commit && data.room_id !== roomId)");
    expect(GAME_API).toMatch(
      /if \(data\.room_id != null && data\.room_id !== roomId\)[\s\S]*?Replay restore snapshot must belong to this room/
    );
  });

  it("engine replay は dry-run も含めて room member だけに許可する", () => {
    expect(GAME_API).toContain(
      "engine replay は commit の有無を問わず認証済み room member 限定"
    );
    expect(GAME_API).toMatch(
      /subPath === "\/replay\/restore"[\s\S]*?requireRoomMember\(room, authenticatedUserId\)/
    );
  });

  it("replay失敗のraw payloadをresponseへ含めずcheckpointにも乱数traceを付ける", () => {
    expect(GAME_API).toContain(
      "`replay failed at version ${ev.state_version} (${ev.endpoint}).`"
    );
    expect(GAME_API).not.toContain("(${ev.endpoint}): ${msg}");
    expect(GAME_API).toContain(
      "...roomMutationRandomTrace(createRoomMutationRandomContext())"
    );
  });

  it("mutation path は未使用 raw patch cache を計算しない", () => {
    expect(GAME_API).not.toContain("computeAndCachePatch");
    expect(GAME_API).not.toContain("roomPatchCache");
  });
});
