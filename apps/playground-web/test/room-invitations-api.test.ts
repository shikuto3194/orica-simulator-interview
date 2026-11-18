import { createServer, type Server } from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleRoomInvitations } from "../server/room-invitations";

const sender = "00000000-0000-4000-8000-000000000001";
const recipient = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000010";
const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
let row: Record<string, unknown> | null;
const rpc = vi.fn();
const from = vi.fn((table: string) => {
  const methods = [
    "select",
    "eq",
    "is",
    "in",
    "neq",
    "ilike",
    "order",
    "limit",
    "range",
    "update",
    "upsert",
    "delete",
    "maybeSingle",
  ];
  let single = false;
  let count = false;
  const chain: Record<string, unknown> = {};
  for (const method of methods)
    chain[method] = (...args: unknown[]) => {
      calls.push({ table, method, args });
      if (method === "maybeSingle") single = true;
      if (method === "select" && args[1]) count = true;
      return chain;
    };
  chain.then = (resolve: (value: unknown) => void) =>
    resolve({
      data:
        table === "profiles"
          ? [{ user_id: sender, display_name: "霊夢", avatar_id: "reimu" }]
          : single
            ? row
            : row
              ? [row]
              : [],
      error: null,
      count: count ? 1 : null,
    });
  return chain;
});
let server: Server;
let base: string;
beforeEach(async () => {
  calls.length = 0;
  from.mockClear();
  rpc.mockReset();
  row = {
    id,
    room_id: "room01",
    sender_id: sender,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    read_at: null,
    accepted_at: null,
    rooms: { players: [{ supabaseUserId: sender }], state_version: 0 },
  };
  server = createServer((req, res) => {
    void handleRoomInvitations(
      req,
      res,
      { from, rpc } as unknown as SupabaseClient,
      async (request) =>
        request.headers.authorization === "Bearer valid" ? recipient : null,
      async (request) => {
        let body = "";
        for await (const chunk of request) body += chunk;
        return body;
      }
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/room-invitations`;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const call = (path = "", body?: object) =>
  fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer valid",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

it("requires a verified identity before any read or mutation", async () => {
  for (const path of ["", "/users", `/${id}/read`, `/${id}/accept`]) {
    expect(
      (await fetch(base + path, { method: path.includes(id) ? "POST" : "GET" }))
        .status
    ).toBe(401);
  }
  expect(from).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
it("inbox reads filter by recipient and return only public sender profile fields", async () => {
  const response = await call();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const data = await response.json();
  expect(data.unreadCount).toBe(1);
  expect(data.invitations[0].sender).toEqual({
    userId: sender,
    displayName: "霊夢",
    avatarId: "reimu",
  });
  expect(data.invitations[0].available).toBe(true);
  expect(calls.filter((c) => c.method === "eq")).toEqual([
    {
      table: "room_invitations",
      method: "eq",
      args: ["recipient_id", recipient],
    },
    {
      table: "room_invitations",
      method: "eq",
      args: ["recipient_id", recipient],
    },
  ]);
  expect(
    calls.find((c) => c.table === "profiles" && c.method === "select")?.args
  ).toEqual(["user_id, display_name, avatar_id"]);
});
it("uses the JWT identity even when the send body forges a sender", async () => {
  rpc.mockResolvedValue({ data: { id }, error: null });
  expect(
    (
      await call("", {
        roomId: "room01",
        recipientId: sender,
        senderId: sender,
      })
    ).status
  ).toBe(200);
  expect(rpc).toHaveBeenCalledWith("send_room_invitation", {
    p_room_id: "room01",
    p_sender_id: recipient,
    p_recipient_id: sender,
  });
});
it("opening a message only marks the recipient's row and never joins", async () => {
  expect((await call(`/${id}/read`, {})).status).toBe(200);
  expect(
    calls.filter((c) => c.method === "eq" && c.args[0] === "recipient_id")
  ).toHaveLength(2);
  expect(calls.some((c) => c.method === "update")).toBe(true);
  expect(rpc).not.toHaveBeenCalled();
});
it("missing or foreign invitations cannot be read or accepted", async () => {
  row = null;
  for (const action of ["read", "accept"])
    expect((await call(`/${id}/${action}`, {})).status).toBe(404);
  expect(rpc).not.toHaveBeenCalled();
  expect(calls.some((c) => c.method === "update")).toBe(false);
});
it("acceptance takes the room from the stored invitation and propagates full-room errors", async () => {
  rpc.mockResolvedValue({
    data: { error: "このルームは参加を締め切りました", status: 409 },
    error: null,
  });
  expect(
    (await call(`/${id}/accept`, { roomId: "forged", userId: sender })).status
  ).toBe(409);
  expect(rpc).toHaveBeenCalledWith("join_room", {
    p_room_id: "room01",
    p_user_id: recipient,
    p_invitation_id: id,
  });
});
it("profile search excludes self and constrains pagination", async () => {
  expect((await call("/users?q=%25&offset=30")).status).toBe(200);
  expect(calls).toContainEqual({
    table: "profiles",
    method: "neq",
    args: ["user_id", recipient],
  });
  expect(calls).toContainEqual({
    table: "profiles",
    method: "ilike",
    args: ["display_name", "%\\%%"],
  });
  expect((await call("/users?offset=-1")).status).toBe(400);
});

it("push registration uses the verified owner and rejects unknown delivery channels", async () => {
  vi.stubEnv("WEB_PUSH_PUBLIC_KEY", "public");
  vi.stubEnv("WEB_PUSH_PRIVATE_KEY", "private");
  vi.stubEnv("WEB_PUSH_SUBJECT", "https://example.com");
  const body = {
    endpoint: "https://fcm.googleapis.com/fcm/send/test",
    keys: {
      p256dh: Buffer.alloc(65, 1).toString("base64url"),
      auth: Buffer.alloc(16, 2).toString("base64url"),
    },
    channel: "pwa",
    userId: sender,
  };
  expect((await call("/push", body)).status).toBe(200);
  expect(calls.find((c) => c.method === "upsert")?.args[0]).toMatchObject({
    user_id: recipient,
    delivery_channel: "pwa",
  });
  expect((await call("/push", { ...body, channel: "unknown" })).status).toBe(
    400
  );
  const response = await call(
    `/push?endpoint=${encodeURIComponent(body.endpoint)}`
  );
  expect(await response.json()).toMatchObject({
    publicKey: "public",
    subscribed: true,
  });
  expect(calls).toContainEqual({
    table: "room_push_subscriptions",
    method: "eq",
    args: ["user_id", recipient],
  });
  const deleted = await fetch(`${base}/push`, {
    method: "DELETE",
    headers: {
      Authorization: "Bearer valid",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  expect(deleted.status).toBe(200);
  expect(calls.at(-1)).toEqual({
    table: "room_push_subscriptions",
    method: "eq",
    args: ["user_id", recipient],
  });
});
