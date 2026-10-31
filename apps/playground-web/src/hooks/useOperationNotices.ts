import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import { supabase } from "../supabaseClient";
import type { OperationNotice } from "../operationNotices";

export function useOperationNotices({ markAllRead = false } = {}) {
  const { user } = useAuth();
  const userId = user?.id;
  const [inbox, setInbox] = useState<{
    owner: string | undefined;
    notices: OperationNotice[];
    readDays: string[];
  }>({ owner: undefined, notices: [], readDays: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    setLoading(true);
    const fetchInbox = async () => {
      if (!userId || pending || controller.signal.aborted) {
        if (!userId) setLoading(false);
        return;
      }
      pending = true;
      let failureMessage =
        "運営通知を取得できませんでした。再試行してください。";
      try {
        const [notices, reads] = await Promise.all([
          supabase
            .from("operation_notices")
            .select("day,title,introduction,items,published_at")
            .order("day", { ascending: false })
            .limit(10)
            .abortSignal(controller.signal),
          supabase
            .from("operation_notice_reads")
            .select("notice_day")
            .eq("user_id", userId)
            .abortSignal(controller.signal),
        ]);
        if (notices.error || reads.error) throw new Error("fetch failed");
        if (controller.signal.aborted) return;
        const nextInbox = {
          owner: userId,
          notices: notices.data as OperationNotice[],
          readDays: reads.data.map((row) => row.notice_day as string),
        };
        setInbox(nextInbox);
        setError("");
        const unread = nextInbox.notices.filter(
          (notice) => !nextInbox.readDays.includes(notice.day)
        );
        if (markAllRead && unread.length > 0) {
          failureMessage =
            "既読にできませんでした。「更新」で再試行してください。";
          const { error: readError } = await supabase
            .from("operation_notice_reads")
            .upsert(
              unread.map((notice) => ({
                user_id: userId,
                notice_day: notice.day,
              })),
              { onConflict: "user_id,notice_day", ignoreDuplicates: true }
            )
            .abortSignal(controller.signal);
          if (readError) throw readError;
          if (!controller.signal.aborted) {
            setInbox({
              ...nextInbox,
              readDays: [
                ...nextInbox.readDays,
                ...unread.map((notice) => notice.day),
              ],
            });
          }
        }
      } catch {
        if (!controller.signal.aborted) setError(failureMessage);
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void fetchInbox();
    const timer = window.setInterval(() => {
      if (!document.hidden) void fetchInbox();
    }, 30_000);
    const focus = () => {
      void fetchInbox();
    };
    window.addEventListener("focus", focus);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [userId, revision, markAllRead]);
  const notices = inbox.owner === userId ? inbox.notices : [];
  const readDays = inbox.owner === userId ? inbox.readDays : [];
  return {
    notices,
    readDays,
    unreadCount: notices.filter((notice) => !readDays.includes(notice.day))
      .length,
    loading,
    error,
    refresh,
  };
}
