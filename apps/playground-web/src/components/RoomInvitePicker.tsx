import { useEffect, useRef, useState } from "react";
import { useInvitationRequest } from "../hooks/useInvitationRequest";
import type { InvitationProfile as Profile } from "../roomInvitations";
import { userFacingError } from "../utils/user-facing-error";
import { InvitationProfile } from "./InvitationProfile";
import "../room-invitations.css";

export function RoomInvitePicker({ roomId }: { roomId: string }) {
  const request = useInvitationRequest();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [users, setUsers] = useState<Profile[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      void request<{ users: Profile[]; hasMore: boolean }>(
        `/users?q=${encodeURIComponent(search)}&offset=${offset}`,
        { signal: controller.signal }
      )
        .then((data) => {
          if (!controller.signal.aborted) {
            setUsers(data.users);
            setHasMore(data.hasMore);
          }
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted)
            setError(userFacingError(e, "ユーザーを取得できませんでした"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, search, offset, revision, request]);
  const send = async () => {
    if (!selected || busy.current) return;
    busy.current = true;
    setSending(true);
    setError("");
    setNotice("");
    try {
      await request("", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, recipientId: selected.userId }),
      });
      setSent((ids) => [...ids, selected.userId]);
      setNotice(`${selected.displayName}さんに招待を送りました`);
      setSelected(null);
    } catch (e) {
      setError(userFacingError(e, "招待を送信できませんでした"));
    } finally {
      busy.current = false;
      setSending(false);
    }
  };
  return (
    <section className="room-invite-picker" aria-label="ユーザーを招待">
      <button
        className="invite-expand"
        type="button"
        aria-expanded={open}
        disabled={sending}
        onClick={() => setOpen(!open)}
      >
        <span>{open ? "ユーザー選択を閉じる" : "ユーザーを招待"}</span>
        <span aria-hidden="true">{open ? "−" : "＋"}</span>
      </button>
      {open && (
        <div className="invite-picker-body">
          <h3>招待するユーザーを選択</h3>
          <label>
            表示名で検索
            <input
              placeholder="ユーザーの表示名"
              value={search}
              maxLength={30}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
                setSelected(null);
              }}
              disabled={sending}
            />
          </label>
          {loading ? (
            <p role="status">ユーザーを読み込み中...</p>
          ) : (
            <>
              <ul className="invitation-list">
                {users.map((user) => (
                  <li key={user.userId}>
                    <button
                      type="button"
                      aria-pressed={selected?.userId === user.userId}
                      disabled={sending || sent.includes(user.userId)}
                      onClick={() => setSelected(user)}
                    >
                      <InvitationProfile profile={user} />
                      <span
                        className={
                          sent.includes(user.userId)
                            ? "invite-sent"
                            : "invite-choice"
                        }
                        aria-hidden="true"
                      >
                        {sent.includes(user.userId)
                          ? "招待済み"
                          : selected?.userId === user.userId
                            ? "✓"
                            : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {!error && users.length === 0 && (
                <p>該当するユーザーはいません。</p>
              )}
              <div className="invitation-actions">
                {offset > 0 && (
                  <button
                    disabled={sending}
                    onClick={() => {
                      setOffset(offset - 30);
                      setSelected(null);
                    }}
                  >
                    前のページ
                  </button>
                )}
                {hasMore && (
                  <button
                    disabled={sending}
                    onClick={() => {
                      setOffset(offset + 30);
                      setSelected(null);
                    }}
                  >
                    次のページ
                  </button>
                )}
              </div>
            </>
          )}
          <div className="invite-send-footer">
            <p>
              {selected
                ? `${selected.displayName}さんを招待`
                : "相手を選んで招待を送信"}
            </p>
            <button
              className="ui-primary"
              type="button"
              disabled={!selected || sending || loading}
              onClick={() => void send()}
            >
              {sending ? "送信中..." : "招待を送る"}
            </button>
          </div>
          {error && (
            <>
              <p role="alert">{error}</p>
              <button
                disabled={sending}
                onClick={() => setRevision(revision + 1)}
              >
                一覧を再取得
              </button>
            </>
          )}
        </div>
      )}
      {notice && (
        <p className="invite-feedback" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
