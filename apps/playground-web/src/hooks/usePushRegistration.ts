import { useEffect } from "react";
import { useAuth } from "../AuthContext";
import { currentPushSubscription, pushOwner } from "../pushSubscription";
import {
  currentPushChannel,
  isPushChannel,
  pushChannelPriority,
} from "../pushDelivery";
import { useInvitationRequest } from "./useInvitationRequest";

/** An existing opt-in follows the installed app without prompting or enabling notifications anew. */
export function usePushRegistration() {
  const { user } = useAuth();
  const request = useInvitationRequest();
  useEffect(() => {
    if (!user || pushOwner() !== user.id || currentPushChannel() === "browser")
      return;
    let cancelled = false;
    const promote = async () => {
      const subscription = await currentPushSubscription();
      if (!subscription || cancelled) return;
      const config = await request<{ subscribed: boolean; channel: unknown }>(
        `/push?endpoint=${encodeURIComponent(subscription.endpoint)}`
      );
      const channel = currentPushChannel();
      if (
        cancelled ||
        !config.subscribed ||
        (isPushChannel(config.channel) &&
          pushChannelPriority[config.channel] >= pushChannelPriority[channel])
      )
        return;
      await request("/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...subscription.toJSON(), channel }),
      });
    };
    void promote().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, request]);
}
