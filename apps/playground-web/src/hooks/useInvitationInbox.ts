import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import { useInvitationRequest } from "./useInvitationRequest";
import type { InvitationInbox } from "../roomInvitations";
import { userFacingError } from "../utils/user-facing-error";

export function useInvitationInbox() {
  const { user } = useAuth();
  const request = useInvitationRequest();
  const [inbox, setInbox] = useState<InvitationInbox>({
    invitations: [],
    unreadCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    setLoading(true);
    const fetchInbox = async () => {
      if (!user || pending || controller.signal.aborted) {
        setLoading(false);
        return;
      }
      pending = true;
      try {
        const data = await request<InvitationInbox>("", {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setInbox(data);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(userFacingError(e, "メッセージを取得できませんでした"));
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void fetchInbox();
    const timer = window.setInterval(() => {
      if (!document.hidden) void fetchInbox();
    }, 10_000);
    const focus = () => {
      void fetchInbox();
    };
    window.addEventListener("focus", focus);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [user, request, revision]);
  return { ...inbox, loading, error, refresh };
}
