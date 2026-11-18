import { useState } from "react";
import { useOperationNotices } from "../hooks/useOperationNotices";
import { noticeDate } from "../operationNotices";
import "../room-invitations.css";

export function OperationNotices({ onExit }: { onExit: () => void }) {
  const { notices, readDays, unreadCount, loading, error, refresh } =
    useOperationNotices({ markAllRead: true });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const current = notices.find((notice) => notice.day === selectedDay);
  return (
    <section className="message-inbox" aria-label="運営通知">
      <header className="message-header">
        <div>
          <p className="home-eyebrow gensou-wordmark">幻想符</p>
          <h2>運営通知</h2>
        </div>
        <button className="invite-text-button" onClick={onExit}>
          ‹ ホームに戻る
        </button>
      </header>
      <div className="message-toolbar">
        <span>
          更新のお知らせ{" "}
          {unreadCount > 0 && <b className="invite-unread">{unreadCount}</b>}
        </span>
        <button
          className="invite-text-button"
          onClick={refresh}
          disabled={loading}
        >
          更新
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">運営通知を読み込み中...</p>}
      {current ? (
        <article className="invitation-detail operation-notice-detail">
          <p className="home-eyebrow">{noticeDate(current.day)}</p>
          <h3>{current.title}</h3>
          <p className="invite-detail-copy">{current.introduction}</p>
          <ul className="operation-notice-items">
            {current.items.map((item, index) => (
              <li key={index}>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </li>
            ))}
          </ul>
          <button
            className="invite-text-button"
            onClick={() => setSelectedDay(null)}
          >
            一覧に戻る
          </button>
        </article>
      ) : (
        <>
          {selectedDay && !loading && !error && (
            <p className="invite-detail-copy">この通知は掲載を終了しました。</p>
          )}
          {!loading && !error && notices.length === 0 && (
            <div className="invite-empty">
              <p>運営通知はありません。</p>
              <small>更新のお知らせが、ここに表示されます。</small>
            </div>
          )}
          <ul className="invitation-list">
            {notices.map((notice) => (
              <li key={notice.day}>
                <button
                  className={`message-row operation-notice-row${!readDays.includes(notice.day) ? " is-unread" : ""}`}
                  onClick={() => setSelectedDay(notice.day)}
                  aria-label={`${notice.title}を開く`}
                >
                  <span className="invitation-profile">
                    <span>
                      <strong>{notice.title}</strong>
                    </span>
                  </span>
                  <span className="message-row-subject">
                    {notice.introduction}
                    <span aria-hidden="true">›</span>
                  </span>
                  <small className="message-row-time">
                    {!readDays.includes(notice.day) && (
                      <span className="invite-unread">未読</span>
                    )}
                    {noticeDate(notice.day)}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
