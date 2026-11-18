import { useEffect, useRef, useState } from "react";
import { useInvitationInbox } from "../hooks/useInvitationInbox";
import { useInvitationRequest } from "../hooks/useInvitationRequest";
import type { InvitationInbox, RoomInvitation } from "../roomInvitations";
import { PushNotificationSettings } from "./PushNotificationSettings";
import { userFacingError } from "../utils/user-facing-error";
import { InvitationProfile } from "./InvitationProfile";
import "../room-invitations.css";

export function MessageInbox({
  onJoin,
  onExit,
  initialInvitationId,
}: {
  onJoin: (room: { roomId: string; role: "alice" | "bob" }) => void;
  onExit: () => void;
  initialInvitationId?: string;
}) {
  const { invitations, unreadCount, loading, error, refresh } =
    useInvitationInbox();
  const request = useInvitationRequest();
  const [selected, setSelected] = useState<RoomInvitation | null>(null);
  const [actionError, setActionError] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    if (!initialInvitationId) return;
    const controller = new AbortController();
    busy.current = true;
    setPending(true);
    void request<InvitationInbox>(`/${initialInvitationId}`, {
      signal: controller.signal,
    })
      .then(async (data) => {
        if (controller.signal.aborted) return;
        const invitation = data.invitations[0];
        if (!invitation) throw new Error("この招待は削除されています");
        setSelected(invitation);
        await request(`/${invitation.id}/read`, {
          method: "POST",
          signal: controller.signal,
        });
        if (!controller.signal.aborted) refresh();
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setActionError(userFacingError(e, "招待を開けませんでした"));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          busy.current = false;
          setPending(false);
        }
      });
    return () => controller.abort();
  }, [initialInvitationId, request, refresh]);
  const open = async (invitation: RoomInvitation) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setActionError("");
    setSelected(invitation);
    try {
      await request(`/${invitation.id}/read`, { method: "POST" });
      refresh();
    } catch (e) {
      setActionError(
        userFacingError(
          e,
          "既読にできませんでした。開き直して再試行してください"
        )
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const join = async () => {
    if (!selected || busy.current) return;
    busy.current = true;
    setPending(true);
    setActionError("");
    try {
      onJoin(
        await request<{ roomId: string; role: "alice" | "bob" }>(
          `/${selected.id}/accept`,
          { method: "POST" }
        )
      );
    } catch (e) {
      setActionError(userFacingError(e, "参加できませんでした"));
      refresh();
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const current =
    selected &&
    (invitations.find((item) => item.id === selected.id) ?? selected);
  return (
    <section className="message-inbox" aria-label="メッセージ">
      <header className="message-header">
        <div>
          <p className="home-eyebrow gensou-wordmark">幻想符</p>
          <h2>メッセージ</h2>
        </div>
        <button
          className="invite-text-button"
          onClick={onExit}
          disabled={pending}
        >
          ‹ ホームに戻る
        </button>
      </header>
      <div className="message-toolbar">
        <span>
          受信した招待{" "}
          {unreadCount > 0 && <b className="invite-unread">{unreadCount}</b>}
        </span>
        <button
          className="invite-text-button"
          onClick={refresh}
          disabled={loading || pending}
        >
          更新
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">メッセージを読み込み中...</p>}
      {current ? (
        <article className="invitation-detail">
          <p className="home-eyebrow">ルームへのお誘い</p>
          <h3>対戦ルームへの招待</h3>
          <InvitationProfile profile={current.sender} />
          <p className="invite-detail-copy">
            一緒に対戦しませんか？
            <br />
            参加するとデッキ選択へ進みます。
          </p>
          <dl className="invite-room-meta">
            <div>
              <dt>ルームID</dt>
              <dd>{current.roomId}</dd>
            </div>
            <div>
              <dt>有効期限</dt>
              <dd>{new Date(current.expiresAt).toLocaleString("ja-JP")}</dd>
            </div>
          </dl>
          {current.acceptedAt && <p>参加済みの招待です。</p>}
          {!current.available && (
            <p>この招待では参加できません（満員・開始済み・期限切れ）。</p>
          )}
          <div className="invitation-actions invite-detail-footer">
            <button
              className="ui-primary"
              onClick={() => void join()}
              disabled={pending || !current.available}
            >
              {pending
                ? "処理中..."
                : current.acceptedAt
                  ? "ルームに戻る"
                  : "参加する"}
            </button>
            <button
              onClick={() => {
                setSelected(null);
                setActionError("");
              }}
              disabled={pending}
              className="invite-text-button"
            >
              一覧に戻る
            </button>
          </div>
        </article>
      ) : (
        <>
          {!loading && !error && invitations.length === 0 && (
            <div className="invite-empty">
              <span aria-hidden="true">✉</span>
              <p>メッセージはありません。</p>
              <small>届いた対戦の招待が、ここに表示されます。</small>
            </div>
          )}
          <ul className="invitation-list">
            {invitations.map((invitation) => (
              <li key={invitation.id}>
                <button
                  className={
                    !invitation.readAt ? "message-row is-unread" : "message-row"
                  }
                  onClick={() => void open(invitation)}
                  disabled={pending}
                  aria-label={`${invitation.sender.displayName}さんからの招待を開く`}
                >
                  <InvitationProfile profile={invitation.sender} />
                  <span className="message-row-subject">
                    対戦ルームへの招待 <span aria-hidden="true">›</span>
                  </span>
                  <small className="message-row-time">
                    {!invitation.readAt && (
                      <span className="invite-unread">未読</span>
                    )}
                    {new Date(invitation.createdAt).toLocaleString("ja-JP")}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {invitations.length === 100 && (
            <p>未読を優先して100件まで表示しています。</p>
          )}
        </>
      )}
      {actionError && <p role="alert">{actionError}</p>}
      <PushNotificationSettings />
    </section>
  );
}
