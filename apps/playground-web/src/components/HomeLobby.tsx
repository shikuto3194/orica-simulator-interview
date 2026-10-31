import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AVATARS, avatarSrc } from "../avatars";
import { HomeAvatarPicker } from "./HomeAvatarPicker";
import { useInvitationInbox } from "../hooks/useInvitationInbox";
import { useOperationNotices } from "../hooks/useOperationNotices";
import { useAppReloadBoundary } from "../hooks/useAppReloadBoundary";

interface HomeLobbyProps {
  displayName: string;
  avatarId: string | null | undefined;
  cardCount: number;
  savedDeckCount: number;
  onNavigate: (screen: string) => void;
  onDeckTab: () => void;
  onSavedTab: () => void;
  canAutoUpdate?: boolean;
  children?: ReactNode;
}

function LobbyIcon({
  kind,
}: {
  kind: "mail" | "bell" | "solo" | "room" | "deck";
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "mail" && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 6 9 7 9-7" />
        </>
      )}
      {kind === "bell" && (
        <>
          <path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 21h4M12 2v2" />
        </>
      )}
      {kind === "solo" && (
        <>
          <path d="m5 3 13 13-2 2L3 5V3zM13 19l6-6M16 18l4 4M19 3 5 17M3 14l7 7" />
        </>
      )}
      {kind === "room" && (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 6" />
        </>
      )}
      {kind === "deck" && (
        <>
          <rect x="8" y="3" width="12" height="16" rx="2" />
          <path d="M5 6H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h11M14 7l3 4-3 4-3-4z" />
        </>
      )}
    </svg>
  );
}

/** プロフィール・デッキ件数・招待の未読件数を表示。 */
export function HomeLobby({
  displayName,
  avatarId,
  cardCount,
  savedDeckCount,
  onNavigate,
  onDeckTab,
  onSavedTab,
  canAutoUpdate = false,
  children,
}: HomeLobbyProps) {
  const lobbyRef = useRef<HTMLElement>(null);
  const { unreadCount, error: inboxError } = useInvitationInbox();
  const { unreadCount: noticeUnreadCount, error: noticeError } =
    useOperationNotices();
  const [editingAvatar, setEditingAvatar] = useState(false);
  useAppReloadBoundary(canAutoUpdate && !editingAvatar);
  useLayoutEffect(() => {
    const lobby = lobbyRef.current;
    if (!lobby) return;
    const controls = document.querySelector(".gensou-bgm");
    const columns = lobby.querySelectorAll<HTMLElement>(
      ".home-sidebar, .home-avatar, .home-actions"
    );
    // The figure includes empty space beside its centered contents in both
    // modes. Reserve only the space its visible footer items need.
    const measure = () => {
      const player = controls?.getBoundingClientRect();
      for (const column of columns) {
        const bounds = column.getBoundingClientRect();
        const overlaps = (rect: DOMRect) =>
          player &&
          rect.width > 0 &&
          rect.right > player.left - 8 &&
          rect.left < player.right + 8;
        let clearance = 12;
        if (player && column.matches(".home-avatar")) {
          const baseline = lobby.getBoundingClientRect().bottom - 12;
          for (const item of column.querySelectorAll<HTMLElement>(
            "figcaption > :not(.home-avatar-toolbar), .home-avatar-toolbar > button"
          )) {
            const rect = item.getBoundingClientRect();
            if (overlaps(rect))
              clearance = Math.max(
                clearance,
                baseline - (bounds.bottom - rect.bottom) - player.top + 24
              );
          }
        } else if (player && overlaps(bounds)) {
          clearance = window.innerHeight - player.top + 12;
        }
        const value = `${Math.ceil(clearance)}px`;
        if (column.style.getPropertyValue("--home-player-clearance") !== value)
          column.style.setProperty("--home-player-clearance", value);
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(lobby);
    const caption = lobby.querySelector(".home-avatar figcaption");
    if (caption) observer.observe(caption);
    if (controls) observer.observe(controls);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [editingAvatar, avatarId]);
  const avatar = AVATARS.find((entry) => entry.id === avatarId) ?? AVATARS[0]!;
  return (
    <main
      ref={lobbyRef}
      className={`home-lobby${editingAvatar ? " home-lobby--editing" : ""}`}
      aria-label="ホーム"
    >
      <section className="home-sidebar">
        <div className="home-brand">
          <span className="home-eyebrow">GENSOUFU</span>
          <h1 className="gensou-wordmark">幻想符</h1>
          <p>バトルスピリッツ シミュレーター</p>
        </div>
        <button
          type="button"
          className="home-profile home-glass"
          data-testid="btn-mypage"
          onClick={() => onNavigate("mypage")}
        >
          <img src={avatarSrc(avatar.id)} alt="" />
          <span>
            <strong>{displayName}</strong>
            <small>
              マイページ <span aria-hidden="true">›</span>
            </small>
          </span>
        </button>
        <button
          type="button"
          className="home-library home-glass"
          onClick={onSavedTab}
        >
          <LobbyIcon kind="deck" />
          <span>
            保存デッキ<small>{savedDeckCount} 件</small>
          </span>
          <span aria-hidden="true">›</span>
        </button>
        <div className="home-support">
          <p className="home-card-count">カード {cardCount} 枚収録</p>
          {children}
          <button
            type="button"
            className="home-title-link"
            data-testid="btn-back-to-title"
            onClick={() => onNavigate("title")}
          >
            ‹ タイトルに戻る
          </button>
        </div>
      </section>

      <HomeAvatarPicker
        avatarId={avatarId}
        editing={editingAvatar}
        onEditingChange={setEditingAvatar}
      />

      <section className="home-actions" aria-label="メニュー">
        <div className="home-utilities">
          <button
            type="button"
            className="home-message-button"
            aria-label={
              unreadCount ? `メッセージ（未読${unreadCount}件）` : "メッセージ"
            }
            onClick={() => onNavigate("messages")}
            title={inboxError || "メッセージ"}
          >
            <LobbyIcon kind="mail" />
            <span>
              メッセージ
              <small aria-live="polite">
                {inboxError
                  ? "取得を再試行"
                  : unreadCount
                    ? `未読 ${unreadCount}件`
                    : "招待を確認"}
              </small>
            </span>
            {unreadCount > 0 && (
              <b className="home-unread-badge" aria-hidden="true">
                {unreadCount > 99 ? "99+" : unreadCount}
              </b>
            )}
          </button>
          <button
            type="button"
            className="home-message-button"
            aria-label={
              noticeUnreadCount
                ? `運営通知（未読${noticeUnreadCount}件）`
                : "運営通知"
            }
            onClick={() => onNavigate("notices")}
            title={noticeError || "運営通知"}
          >
            <LobbyIcon kind="bell" />
            <span>
              運営通知
              <small aria-live="polite">
                {noticeError
                  ? "取得を再試行"
                  : noticeUnreadCount
                    ? `未読 ${noticeUnreadCount}件`
                    : "更新を確認"}
              </small>
            </span>
            {noticeUnreadCount > 0 && (
              <b className="home-unread-badge" aria-hidden="true">
                {noticeUnreadCount}
              </b>
            )}
          </button>
        </div>
        <div className="home-action-list">
          <span className="home-eyebrow home-menu-caption">
            今日の一戦を、ここから。
          </span>
          <button
            type="button"
            className="home-action home-action-primary"
            aria-label="1人バトル"
            onClick={() => onNavigate("battle_setup")}
          >
            <LobbyIcon kind="solo" />
            <span>
              <strong>1人バトル</strong>
              <small>デッキを選んで対戦</small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
          <button
            type="button"
            className="home-action home-glass"
            onClick={() => onNavigate("room_lobby")}
            aria-label="対戦ルーム"
          >
            <LobbyIcon kind="room" />
            <span>
              <strong>対戦ルーム</strong>
              <small>ルームを作成・参加</small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
          <button
            type="button"
            className="home-action home-glass"
            onClick={onDeckTab}
          >
            <LobbyIcon kind="deck" />
            <span>
              <strong>作成中デッキ</strong>
              <small>カードを選んで編成</small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </section>
    </main>
  );
}
