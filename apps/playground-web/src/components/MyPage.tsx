import { useState } from "react";
import { useAuth, type UserProfile } from "../AuthContext";
import { supabase } from "../supabaseClient";
import { AccountLinkSettings } from "./AccountLinkSettings";
import { INPUT_LIMITS, limitInputText } from "../input-validation";

interface MyPageProps {
  initialProfile: UserProfile;
  onBack: () => void;
}
interface Feedback {
  text: string;
  error?: boolean;
}
function Status({
  value,
  testId,
}: {
  value: Feedback | null;
  testId?: string;
}) {
  return (
    value && (
      <p
        className={`mp-message ${value.error ? "error" : "success"}`}
        role={value.error ? "alert" : "status"}
        data-testid={testId}
      >
        {value.text}
      </p>
    )
  );
}
function failure(cause: unknown): Feedback {
  return {
    text: `保存に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`,
    error: true,
  };
}

/** 表示名とアカウント設定。アバターの編集・保存はホームで行う。 */
export function MyPage({ initialProfile, onBack }: MyPageProps) {
  // All three interview sites share one Auth account; interview users cannot change its credentials from MyPage.
  const credentialChangesAllowed = false;
  const { user, profile, updateProfile, signOut } = useAuth();
  const [adminPage, setAdminPage] = useState<"menu" | "accounts" | null>(null);
  const [displayName, setDisplayName] = useState(
    initialProfile.display_name ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Feedback | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMessage, setPwMessage] = useState<Feedback | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMessage, setEmailMessage] = useState<Feedback | null>(null);

  if (!user)
    return (
      <div className="mp-root">
        <div className="mp-card">
          <p>ログインが必要です。</p>
          <button onClick={onBack} className="mp-btn-secondary">
            戻る
          </button>
        </div>
      </div>
    );

  if (profile?.role === "admin" && adminPage)
    return (
      <div className="mp-root">
        <div className="mp-card">
          {adminPage === "accounts" ? (
            <AccountLinkSettings onBack={() => setAdminPage("menu")} />
          ) : (
            <>
              <button
                className="mp-btn-secondary"
                onClick={() => setAdminPage(null)}
              >
                マイページ
              </button>
              <h2>運営メニュー</h2>
              <button
                className="mp-btn-primary"
                onClick={() => setAdminPage("accounts")}
              >
                アカウント・デッキ連携
              </button>
            </>
          )}
        </div>
      </div>
    );

  const handleSaveProfile = async () => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await updateProfile({ display_name: displayName });
      setMessage({ text: "保存しました" });
    } catch (cause) {
      setMessage(failure(cause));
    } finally {
      setSaving(false);
    }
  };
  const handleChangeEmail = async () => {
    if (!credentialChangesAllowed) {
      setEmailMessage({
        text: "面接用の共通アカウントでは、この画面からメールアドレスを変更できません",
        error: true,
      });
      return;
    }
    if (emailSaving) return;
    if (newEmail === user.email) {
      setEmailMessage({ text: "現在と同じメールアドレスです", error: true });
      return;
    }
    setEmailSaving(true);
    setEmailMessage(null);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) throw error;
      setEmailMessage({
        text: "確認メールを送信しました。新しいメールアドレスのリンクをクリックして変更を完了してください。",
      });
      setNewEmail("");
    } catch (cause) {
      setEmailMessage(failure(cause));
    } finally {
      setEmailSaving(false);
    }
  };
  const handleChangePassword = async () => {
    if (!credentialChangesAllowed) {
      setPwMessage({
        text: "面接用の共通アカウントでは、この画面からパスワードを変更できません",
        error: true,
      });
      return;
    }
    if (pwSaving) return;
    if (newPassword !== confirmPassword) {
      setPwMessage({ text: "パスワードが一致しません", error: true });
      return;
    }
    setPwSaving(true);
    setPwMessage(null);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;
      setPwMessage({ text: "パスワードを変更しました" });
      setNewPassword("");
      setConfirmPassword("");
    } catch (cause) {
      setPwMessage(failure(cause));
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <main className="mp-root" aria-label="マイページ">
      <div className="mp-settings">
        <header className="mp-header">
          <h2 className="mp-title">マイページ</h2>
          <button
            type="button"
            onClick={onBack}
            className="mp-back-btn ui-link"
          >
            ‹ ホームに戻る
          </button>
        </header>
        <section
          className="mp-settings-panel"
          aria-labelledby="mp-profile-heading"
        >
          <h3 id="mp-profile-heading" className="mp-section-title">
            プロフィール
          </h3>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveProfile();
            }}
          >
            <div className="mp-setting-row">
              <label className="mp-label" htmlFor="mp-display-name">
                表示名
              </label>
              <input
                id="mp-display-name"
                type="text"
                value={displayName}
                onChange={(event) =>
                  setDisplayName(
                    limitInputText(event.target.value, INPUT_LIMITS.displayName)
                  )
                }
                placeholder="表示名を入力"
                className="mp-input"
                disabled={saving}
                data-testid="mypage-display-name"
                aria-describedby="mp-display-name-hint"
              />
              <button
                type="submit"
                disabled={saving}
                className="mp-btn-primary"
                data-testid="mypage-save-profile"
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
            <p className="mp-hint" id="mp-display-name-hint">
              対戦相手に表示される名前です（{INPUT_LIMITS.displayName}文字以内）
            </p>
            <Status value={message} testId="mypage-save-message" />
          </form>
        </section>
        <section
          className="mp-settings-panel"
          aria-labelledby="mp-account-heading"
        >
          <h3 id="mp-account-heading" className="mp-section-title">
            アカウント設定
          </h3>
          <p role="note">
            面接用Authアカウントは3サイトで共通です。メールアドレスとパスワードの変更は管理者に依頼してください。
          </p>
          <div className="mp-account-setting">
            <div className="mp-setting-row">
              <span className="mp-setting-label">メールアドレス</span>
              <span className="mp-current-value">{user.email}</span>
              <button
                type="button"
                className="mp-btn-secondary"
                aria-label={
                  emailOpen
                    ? "メールアドレスの変更を閉じる"
                    : "メールアドレスを変更"
                }
                aria-expanded={emailOpen}
                aria-controls="mp-email-form"
                disabled={!credentialChangesAllowed || emailSaving}
                onClick={() => setEmailOpen(!emailOpen)}
              >
                {emailOpen ? "閉じる" : "変更"}
              </button>
            </div>
            <form
              id="mp-email-form"
              className="mp-setting-form"
              hidden={!emailOpen}
              onSubmit={(event) => {
                event.preventDefault();
                void handleChangeEmail();
              }}
            >
              <label className="mp-label" htmlFor="mp-new-email">
                新しいメールアドレス
              </label>
              <input
                id="mp-new-email"
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                placeholder="新しいメールアドレス"
                className="mp-input"
                autoComplete="email"
                required
                disabled={!credentialChangesAllowed || emailSaving}
              />
              <button
                type="submit"
                className="mp-btn-primary"
                disabled={emailSaving}
              >
                {emailSaving ? "送信中…" : "確認メールを送る"}
              </button>
              <Status value={emailMessage} />
            </form>
          </div>
          <div className="mp-account-setting">
            <div className="mp-setting-row">
              <span className="mp-setting-label">パスワード</span>
              <span
                className="mp-current-value"
                aria-label="パスワードは非表示"
              >
                ••••••••
              </span>
              <button
                type="button"
                className="mp-btn-secondary"
                aria-label={
                  passwordOpen ? "パスワードの変更を閉じる" : "パスワードを変更"
                }
                aria-expanded={passwordOpen}
                aria-controls="mp-password-form"
                disabled={!credentialChangesAllowed || pwSaving}
                onClick={() => setPasswordOpen(!passwordOpen)}
              >
                {passwordOpen ? "閉じる" : "変更"}
              </button>
            </div>
            <form
              id="mp-password-form"
              className="mp-setting-form"
              hidden={!passwordOpen}
              onSubmit={(event) => {
                event.preventDefault();
                void handleChangePassword();
              }}
            >
              <label className="mp-label" htmlFor="mp-new-password">
                新しいパスワード
              </label>
              <input
                id="mp-new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="6文字以上"
                autoComplete="new-password"
                className="mp-input"
                required
                minLength={6}
                disabled={!credentialChangesAllowed || pwSaving}
              />
              <label className="mp-label" htmlFor="mp-confirm-password">
                新しいパスワードの確認
              </label>
              <input
                id="mp-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="もう一度入力"
                autoComplete="new-password"
                className="mp-input"
                required
                minLength={6}
                disabled={!credentialChangesAllowed || pwSaving}
              />
              <button
                type="submit"
                className="mp-btn-primary"
                disabled={!credentialChangesAllowed || pwSaving}
              >
                {pwSaving ? "変更中…" : "パスワードを保存"}
              </button>
              <Status value={pwMessage} />
            </form>
          </div>
        </section>
        <footer className="mp-settings-footer">
          {profile?.role === "admin" && (
            <button
              type="button"
              className="mp-footer-link ui-link"
              onClick={() => setAdminPage("menu")}
            >
              運営メニュー
            </button>
          )}
          <button
            type="button"
            className="mp-footer-link mp-signout ui-link"
            data-testid="mypage-signout"
            onClick={async () => {
              try {
                await signOut();
                onBack();
              } catch (cause) {
                setMessage(failure(cause));
              }
            }}
          >
            ログアウト
          </button>
        </footer>
      </div>
    </main>
  );
}
