import type { SupabaseClient } from "@supabase/supabase-js";
import webpush, { type PushSubscription } from "web-push";
import { isPushChannel, pushChannelPriority } from "../src/pushDelivery";

export function pushConfiguration() {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT;
  return publicKey && privateKey && subject
    ? { publicKey, privateKey, subject }
    : null;
}

/** Client-supplied endpoints must never become arbitrary server-side requests. */
export function validPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    const host = url.hostname;
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!url.port || url.port === "443") &&
      (host === "fcm.googleapis.com" ||
        host === "updates.push.services.mozilla.com" ||
        host.endsWith(".push.services.mozilla.com") ||
        host === "web.push.apple.com" ||
        host.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}
export function parsePushSubscription(value: unknown): PushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PushSubscription>;
  const key = (input: unknown, bytes: number) =>
    typeof input === "string" &&
    /^[A-Za-z0-9_-]+={0,2}$/.test(input) &&
    Buffer.from(input, "base64url").length === bytes;
  if (
    !validPushEndpoint(candidate.endpoint) ||
    !key(candidate.keys?.p256dh, 65) ||
    !key(candidate.keys?.auth, 16)
  )
    return null;
  return {
    endpoint: candidate.endpoint,
    keys: { p256dh: candidate.keys!.p256dh, auth: candidate.keys!.auth },
  };
}

export async function sendRoomPush(
  db: SupabaseClient,
  invitation: { id: string; recipient_id: string },
  send: typeof webpush.sendNotification = webpush.sendNotification
): Promise<boolean> {
  const config = pushConfiguration();
  if (!config) return false;
  const { data, error } = await db
    .from("room_push_subscriptions")
    .select("endpoint, p256dh, auth, delivery_channel, updated_at")
    .eq("user_id", invitation.recipient_id);
  if (error) throw error;
  const rows = [...(data ?? [])].sort(
    (a, b) =>
      pushChannelPriority[
        isPushChannel(b.delivery_channel) ? b.delivery_channel : "browser"
      ] -
        pushChannelPriority[
          isPushChannel(a.delivery_channel) ? a.delivery_channel : "browser"
        ] || String(b.updated_at).localeCompare(String(a.updated_at))
  );
  let retry = false;
  for (const row of rows) {
    const subscription = parsePushSubscription({
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    });
    if (!subscription) {
      retry = true;
      continue;
    }
    try {
      await send(
        subscription,
        JSON.stringify({ invitationId: invitation.id }),
        {
          vapidDetails: config,
          TTL: 86400,
          timeout: 5000,
          urgency: "normal",
          topic: invitation.id.replaceAll("-", ""),
        }
      );
      return true;
    } catch (cause) {
      const status = (cause as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        const { error: removeError } = await db
          .from("room_push_subscriptions")
          .delete()
          .eq("endpoint", row.endpoint)
          .eq("user_id", invitation.recipient_id);
        if (removeError) throw removeError;
        continue;
      }
      retry = true;
    }
  }
  return !retry;
}

/** Persisted retry state survives restarts; compare-and-set claims prevent competing workers. */
export function startRoomPushDelivery(db: SupabaseClient) {
  let busy = false;
  const tick = async () => {
    if (busy || !pushConfiguration()) return;
    busy = true;
    try {
      const now = new Date().toISOString();
      const { data, error } = await db
        .from("room_invitations")
        .select("id, recipient_id, push_attempts")
        .is("push_processed_at", null)
        .is("accepted_at", null)
        .gt("expires_at", now)
        .lt("push_attempts", 5)
        .lte("next_push_attempt_at", now)
        .order("next_push_attempt_at")
        .limit(10);
      if (error) throw error;
      for (const invitation of data ?? []) {
        const attempt = invitation.push_attempts + 1;
        const { data: claim, error: claimError } = await db
          .from("room_invitations")
          .update({
            push_attempts: attempt,
            next_push_attempt_at: new Date(
              Date.now() + 30_000 * 2 ** attempt
            ).toISOString(),
          })
          .eq("id", invitation.id)
          .eq("push_attempts", invitation.push_attempts)
          .is("push_processed_at", null)
          .select("id")
          .maybeSingle();
        if (claimError) throw claimError;
        if (!claim) continue;
        if (await sendRoomPush(db, invitation)) {
          const { error: completeError } = await db
            .from("room_invitations")
            .update({ push_processed_at: new Date().toISOString() })
            .eq("id", invitation.id)
            .eq("push_attempts", attempt);
          if (completeError) throw completeError;
        }
      }
    } catch {
      console.warn(
        "[room-push] delivery deferred; will retry without exposing subscription data"
      );
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 5_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
