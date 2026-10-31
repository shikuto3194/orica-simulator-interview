import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import {
  parsePushSubscription,
  pushConfiguration,
  sendRoomPush,
  validPushEndpoint,
} from "../server/room-push";

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test",
  keys: {
    p256dh: Buffer.alloc(65, 1).toString("base64url"),
    auth: Buffer.alloc(16, 2).toString("base64url"),
  },
};
afterEach(() => vi.unstubAllEnvs());
it("accepts only known HTTPS browser push services, never private URLs or lookalike domains", () => {
  for (const endpoint of [
    subscription.endpoint,
    "https://updates.push.services.mozilla.com/wpush/v2/test",
    "https://web.push.apple.com/test",
    "https://wns1.notify.windows.com/test",
  ])
    expect(validPushEndpoint(endpoint)).toBe(true);
  for (const endpoint of [
    "http://fcm.googleapis.com/test",
    "https://localhost/test",
    "https://127.0.0.1/test",
    "https://fcm.googleapis.com.evil.test/",
    "https://web.push.apple.com@evil.test/",
    "https://fcm.googleapis.com:8443/test",
    "https://example.com/test",
    "https://fcm.googleapis.com/test#fragment",
  ])
    expect(validPushEndpoint(endpoint)).toBe(false);
});
it("requires a full subscription with valid-size encryption keys", () => {
  expect(parsePushSubscription(subscription)).toEqual(subscription);
  expect(
    parsePushSubscription({
      ...subscription,
      keys: { auth: "invalid", p256dh: subscription.keys.p256dh },
    })
  ).toBeNull();
  expect(parsePushSubscription(null)).toBeNull();
});
it("keeps disabled push inert and does not expose the private key as a public config", () => {
  vi.stubEnv("WEB_PUSH_PRIVATE_KEY", "");
  expect(pushConfiguration()).toBeNull();
});
it.each([201, 410, 503])(
  "sends only to the recipient and handles push-service status %s",
  async (status) => {
    vi.stubEnv("WEB_PUSH_PUBLIC_KEY", "public");
    vi.stubEnv("WEB_PUSH_PRIVATE_KEY", "private");
    vi.stubEnv("WEB_PUSH_SUBJECT", "https://example.com");
    const userFilters: string[] = [];
    const removed: string[] = [];
    const db = {
      from: () => ({
        select: () => ({
          eq: (_column: string, userId: string) => {
            userFilters.push(userId);
            return Promise.resolve({
              data: [{ endpoint: subscription.endpoint, ...subscription.keys }],
              error: null,
            });
          },
        }),
        delete: () => ({
          eq: (_column: string, endpoint: string) => ({
            eq: async (_owner: string, userId: string) => {
              removed.push(endpoint);
              userFilters.push(userId);
              return { error: null };
            },
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const send = vi.fn().mockImplementation(async () => {
      if (status !== 201) throw { statusCode: status };
      return { statusCode: status };
    });
    const result = await sendRoomPush(
      db,
      { id: "00000000-0000-4000-8000-000000000010", recipient_id: "bob" },
      send
    );
    expect(result).toBe(status !== 503);
    expect(send.mock.calls[0]![0]).toEqual(subscription);
    expect(JSON.parse(send.mock.calls[0]![1])).toEqual({
      invitationId: "00000000-0000-4000-8000-000000000010",
    });
    expect(userFilters.every((id) => id === "bob")).toBe(true);
    expect(removed).toEqual(status === 410 ? [subscription.endpoint] : []);
  }
);

it.each([0, 1, 2, 3])(
  "tries PWA → app → browser and stops after success (failures %s)",
  async (failures) => {
    vi.stubEnv("WEB_PUSH_PUBLIC_KEY", "public");
    vi.stubEnv("WEB_PUSH_PRIVATE_KEY", "private");
    vi.stubEnv("WEB_PUSH_SUBJECT", "https://example.com");
    const rows = ["browser", "pwa", "app"].map((channel) => ({
      ...subscription.keys,
      endpoint: `${subscription.endpoint}/${channel}`,
      delivery_channel: channel,
    }));
    const db = {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    } as unknown as SupabaseClient;
    const send = vi.fn().mockImplementation(async () => {
      if (send.mock.calls.length <= failures)
        throw Object.assign(new Error("Unavailable"), { statusCode: 503 });
      return { statusCode: 201 };
    });
    expect(
      await sendRoomPush(
        db,
        { id: "00000000-0000-4000-8000-000000000010", recipient_id: "bob" },
        send
      )
    ).toBe(failures < 3);
    expect(
      send.mock.calls.map((call) => call[0].endpoint.split("/").at(-1))
    ).toEqual(["pwa", "app", "browser"].slice(0, Math.min(failures + 1, 3)));
  }
);
