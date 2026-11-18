import { useEffect } from "react";
import { invitationDestination } from "../invitationLaunch";
import { currentPushChannel, pushChannelPriority } from "../pushDelivery";

export function useInvitationLaunch(
  canOpen: () => boolean,
  open: (id?: string) => void
) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const receive = (event: MessageEvent) => {
      const available = canOpen();
      if (event.data?.type === "INVITATION_TARGET") {
        event.ports[0]?.postMessage({
          available,
          priority: pushChannelPriority[currentPushChannel()],
        });
      } else if (available && event.data?.type === "OPEN_INVITATION") {
        let url: URL;
        try {
          url = new URL(event.data.url);
        } catch {
          return;
        }
        if (url.origin !== window.location.origin) return;
        const destination = invitationDestination(
          url.searchParams.get("invitation"),
          url.origin
        );
        history.replaceState(null, "", destination);
        open(new URL(destination).searchParams.get("invitation") ?? undefined);
      }
    };
    navigator.serviceWorker.addEventListener("message", receive);
    return () =>
      navigator.serviceWorker.removeEventListener("message", receive);
  }, [canOpen, open]);
}
