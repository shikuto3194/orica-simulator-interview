import type { IncomingMessage, ServerResponse } from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvitationProfile, RoomInvitation } from "../src/roomInvitations";
import { isPushChannel } from "../src/pushDelivery";
import {
  parsePushSubscription,
  pushConfiguration,
  validPushEndpoint,
} from "./room-push";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const profileColumns = "user_id, display_name, avatar_id";
interface ProfileRow {
  user_id: string;
  display_name: string | null;
  avatar_id: string | null;
}
const profile = (row: ProfileRow): InvitationProfile => ({
  userId: row.user_id,
  displayName: row.display_name || "プレイヤー",
  avatarId: row.avatar_id,
});

export function invitationReply(
  res: ServerResponse,
  data: unknown,
  status = 200
) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "private, no-store");
  res.end(JSON.stringify(data));
}

export async function joinRoomAtomically(
  db: SupabaseClient,
  roomId: string,
  userId: string,
  invitationId?: string
) {
  const { data, error } = await db.rpc("join_room", {
    p_room_id: roomId,
    p_user_id: userId,
    ...(invitationId ? { p_invitation_id: invitationId } : {}),
  });
  if (error)
    throw new Error("ルームへの参加に失敗しました。再試行してください");
  return data as {
    roomId: string;
    role: "alice" | "bob";
    reconnected: boolean;
    error?: string;
    status?: number;
  };
}

/** Identity comes only from the verified JWT; the service client never reaches the browser. */
export async function handleRoomInvitations(
  req: IncomingMessage,
  res: ServerResponse,
  db: SupabaseClient,
  authenticate: (req: IncomingMessage) => Promise<string | null>,
  readBody: (req: IncomingMessage, maxBytes?: number) => Promise<string>
): Promise<void> {
  const reply = (data: unknown, status = 200) =>
    invitationReply(res, data, status);
  try {
    const userId = await authenticate(req);
    if (!userId) return reply({ error: "ログインしてください" }, 401);
    const url = new URL(req.url!, "http://localhost");
    const path = url.pathname.slice("/api/room-invitations".length);
    if (path === "/push" && req.method === "GET") {
      const endpoint = url.searchParams.get("endpoint");
      let subscribed = false;
      let channel: string | null = null;
      if (endpoint) {
        if (!validPushEndpoint(endpoint))
          return reply({ error: "通知先が不正です" }, 400);
        const { data, error } = await db
          .from("room_push_subscriptions")
          .select("endpoint, delivery_channel")
          .eq("endpoint", endpoint)
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw error;
        subscribed = !!data;
        channel = data?.delivery_channel ?? null;
      }
      return reply({
        publicKey: pushConfiguration()?.publicKey ?? null,
        subscribed,
        channel,
      });
    }
    if (
      path === "/push" &&
      (req.method === "POST" || req.method === "DELETE")
    ) {
      const body = JSON.parse((await readBody(req, 8192)) || "{}");
      if (req.method === "DELETE") {
        if (!validPushEndpoint(body?.endpoint))
          return reply({ error: "通知先が不正です" }, 400);
        const { error } = await db
          .from("room_push_subscriptions")
          .delete()
          .eq("endpoint", body.endpoint)
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        if (!pushConfiguration())
          return reply({ error: "端末通知は現在利用できません" }, 503);
        const subscription = parsePushSubscription(body);
        if (!subscription)
          return reply({ error: "通知の登録情報が不正です" }, 400);
        if (!isPushChannel(body.channel))
          return reply({ error: "通知経路が不正です" }, 400);
        const { error } = await db.from("room_push_subscriptions").upsert(
          {
            endpoint: subscription.endpoint,
            user_id: userId,
            ...subscription.keys,
            delivery_channel: body.channel,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "endpoint" }
        );
        if (error) throw error;
      }
      return reply({ ok: true });
    }
    if (path === "/users" && req.method === "GET") {
      const search = (url.searchParams.get("q") ?? "").trim();
      if (search.length > 30)
        return reply({ error: "検索は30文字以内で入力してください" }, 400);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000)
        return reply({ error: "ページが不正です" }, 400);
      let query = db
        .from("profiles")
        .select(profileColumns)
        .neq("user_id", userId);
      if (search)
        query = query.ilike(
          "display_name",
          `%${search.replace(/[\\%_]/g, "\\$&")}%`
        );
      const { data, error } = await query
        .order("display_name")
        .order("user_id")
        .range(offset, offset + 29);
      if (error) throw error;
      return reply({
        users: (data ?? []).map(profile),
        hasMore: data?.length === 30,
      });
    }
    const detailId = uuid.test(path.slice(1)) ? path.slice(1) : null;
    if ((path === "" || detailId) && req.method === "GET") {
      let query = db
        .from("room_invitations")
        .select(
          "id, room_id, sender_id, created_at, expires_at, read_at, accepted_at, rooms(players, state_version)"
        )
        .eq("recipient_id", userId)
        .order("read_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: false })
        .limit(100);
      if (detailId) query = query.eq("id", detailId);
      const { data, error } = await query;
      if (error) throw error;
      const rows = data ?? [];
      const senderIds = [
        ...new Set(rows.map((row) => row.sender_id as string)),
      ];
      const senders = new Map<string, InvitationProfile>();
      if (senderIds.length) {
        const { data: profiles, error: profileError } = await db
          .from("profiles")
          .select(profileColumns)
          .in("user_id", senderIds);
        if (profileError) throw profileError;
        for (const row of profiles ?? [])
          senders.set(row.user_id, profile(row));
      }
      const invitations: RoomInvitation[] = rows.map((row) => {
        const room = row.rooms as unknown as {
          players: Array<{ supabaseUserId: string }>;
          state_version: number;
        } | null;
        return {
          id: row.id,
          roomId: row.room_id,
          sender: senders.get(row.sender_id) ?? {
            userId: row.sender_id,
            displayName: "プレイヤー",
            avatarId: null,
          },
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          readAt: row.read_at,
          acceptedAt: row.accepted_at,
          available:
            !!room &&
            (!!row.accepted_at || Date.parse(row.expires_at) > Date.now()) &&
            (room.players.some((p) => p.supabaseUserId === userId) ||
              (room.players.length < 2 && room.state_version === 0)),
        };
      });
      const { count, error: countError } = await db
        .from("room_invitations")
        .select("id", { head: true, count: "exact" })
        .eq("recipient_id", userId)
        .is("read_at", null);
      if (countError) throw countError;
      return reply({ invitations, unreadCount: count ?? 0 });
    }
    if (path === "" && req.method === "POST") {
      const body: unknown = JSON.parse((await readBody(req, 4096)) || "{}");
      const { roomId, recipientId } = (body ?? {}) as Record<string, unknown>;
      if (
        typeof roomId !== "string" ||
        !/^[a-z0-9]{4,10}$/.test(roomId) ||
        typeof recipientId !== "string" ||
        !uuid.test(recipientId)
      )
        return reply({ error: "ルームと招待先を確認してください" }, 400);
      const { data, error } = await db.rpc("send_room_invitation", {
        p_room_id: roomId,
        p_sender_id: userId,
        p_recipient_id: recipientId,
      });
      if (error) throw error;
      return reply(data, data.status ?? 200);
    }
    const action = path.match(/^\/([0-9a-f-]+)\/(read|accept)$/i);
    if (action && uuid.test(action[1]!) && req.method === "POST") {
      const { data: invitation, error } = await db
        .from("room_invitations")
        .select("id, room_id, read_at")
        .eq("id", action[1]!)
        .eq("recipient_id", userId)
        .maybeSingle();
      if (error) throw error;
      if (!invitation) return reply({ error: "招待が見つかりません" }, 404);
      if (action[2] === "read") {
        if (!invitation.read_at) {
          const { error: updateError } = await db
            .from("room_invitations")
            .update({ read_at: new Date().toISOString() })
            .eq("id", invitation.id)
            .eq("recipient_id", userId)
            .is("read_at", null);
          if (updateError) throw updateError;
        }
        return reply({ ok: true });
      }
      const result = await joinRoomAtomically(
        db,
        invitation.room_id,
        userId,
        invitation.id
      );
      return reply(result, result.status ?? 200);
    }
    return reply({ error: "指定の操作が見つかりません" }, 404);
  } catch (error) {
    return reply(
      {
        error:
          error instanceof SyntaxError
            ? "送信内容が不正です"
            : "メッセージの処理に失敗しました。再試行してください",
      },
      error instanceof SyntaxError ? 400 : 500
    );
  }
}
