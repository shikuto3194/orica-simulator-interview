import { useId, useState, type FormEvent } from "react";
import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { useAuth } from "../AuthContext";

function loginErrorMessage(error: unknown): string {
  if (isAuthError(error)) {
    if (error.status === 429 || error.code === "over_request_rate_limit") {
      return "ログインの試行回数が多すぎます。少し待ってから再試行してください";
    }
    if (
      (error.status && error.status >= 500) ||
      error.code === "request_timeout" ||
      error.code === "unexpected_failure"
    ) {
      return "認証サーバーで障害が発生しています。少し待ってから再試行してください";
    }
    switch (error.code) {
      case "invalid_credentials":
        return "メールアドレスまたはパスワードが間違っています";
      case "email_not_confirmed":
        return "メールアドレスの確認が完了していません。確認メールのリンクを開いてください";
    }
  }
  if (isAuthRetryableFetchError(error) || error instanceof TypeError) {
    return "認証サーバーに接続できません。通信環境を確認し、少し待ってから再試行してください";
  }
  return "ログインできませんでした。少し待ってから再試行してください";
}

interface LoginPageProps {
  onSkip?: () => void;
  embedded?: boolean;
}

export function LoginPage({ onSkip, embedded = false }: LoginPageProps) {
  const id = useId();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const loginEmail = email.trim();
    if (!loginEmail || !password) {
      setError("メールアドレスとパスワードを入力してください");
      return;
    }
    setSubmitting(true);
    try {
      const { error: signInError } = await signIn(loginEmail, password);
      if (signInError) {
        setError(loginErrorMessage(signInError));
      }
    } catch (signInError) {
      setError(loginErrorMessage(signInError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={
        embedded
          ? { display: "contents" }
          : {
              minHeight: "100vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              padding: "1em",
            }
      }
    >
      <form
        onSubmit={handleSubmit}
        className={embedded ? "title-login-form" : "login-panel"}
        aria-label="ログイン"
        style={
          embedded
            ? undefined
            : {
                background: "rgba(22, 33, 62, 0.85)",
                backdropFilter: "blur(8px)",
                padding: "2em",
                borderRadius: 12,
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                width: "100%",
                maxWidth: 360,
                color: "#e0e0e0",
              }
        }
      >
        {!embedded && (
          <h2
            className="gensou-wordmark"
            style={{ textAlign: "center", marginBottom: "1em", color: "#fff" }}
          >
            幻想符
          </h2>
        )}
        <p
          style={
            embedded
              ? undefined
              : {
                  textAlign: "center",
                  fontSize: "0.85em",
                  color: "#aaa",
                  marginBottom: "1.5em",
                }
          }
        >
          TCGマネージャー アカウントでログイン
        </p>

        <label
          htmlFor={id + "-email"}
          style={embedded ? undefined : { fontSize: "0.9em", color: "#aaa" }}
        >
          メールアドレス
        </label>
        <input
          id={id + "-email"}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="example@mail.com"
          autoComplete="email"
          style={embedded ? undefined : inputStyle}
        />

        <label
          htmlFor={id + "-password"}
          style={embedded ? undefined : { fontSize: "0.9em", color: "#aaa" }}
        >
          パスワード
        </label>
        <input
          id={id + "-password"}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワード"
          autoComplete="current-password"
          style={embedded ? undefined : inputStyle}
        />

        <button
          type="submit"
          disabled={submitting}
          style={
            embedded
              ? undefined
              : {
                  width: "100%",
                  background: submitting ? "#555" : "#e94560",
                  color: "#fff",
                  fontWeight: "bold",
                  fontSize: "1.1em",
                  border: "none",
                  borderRadius: 6,
                  padding: "0.7em",
                  cursor: submitting ? "default" : "pointer",
                  marginTop: "0.5em",
                }
          }
        >
          {submitting ? "処理中..." : "ログイン"}
        </button>

        {error && (
          <div
            role="alert"
            style={{
              color: "#ff6b6b",
              marginTop: "0.7em",
              textAlign: "center",
              fontSize: "0.9em",
            }}
          >
            {error}
          </div>
        )}

        {onSkip && (
          <div style={{ textAlign: "center", marginTop: "1.2em" }}>
            <button
              type="button"
              onClick={onSkip}
              className="ui-link"
              style={{
                background: "none",
                border: "none",
                color: "#666",
                cursor: "pointer",
                fontSize: "0.85em",
              }}
            >
              ログインせずに使う
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: "1em",
  padding: "0.5em",
  borderRadius: 6,
  border: "1px solid #333",
  background: "#0f3460",
  color: "#fff",
  marginBottom: "1em",
  marginTop: "0.3em",
  boxSizing: "border-box",
};
