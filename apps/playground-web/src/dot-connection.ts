import { supabase } from "./supabaseClient";

/** Optional, loopback-only handoff from the application's normal login flow. */
export function installDotConnection() {
  if (window.location.hostname !== "127.0.0.1") return;
  const connection = new URLSearchParams(window.location.hash.slice(1)).get(
    "dot"
  );
  if (!connection || !/^[a-f0-9]{64}$/.test(connection)) return;

  const panel = document.createElement("aside");
  panel.setAttribute("aria-label", "dotの対戦接続");
  panel.style.cssText =
    "position:fixed;right:16px;top:16px;z-index:20000;max-width:340px;padding:16px;border:1px solid #777;border-radius:12px;background:#151725;color:#fff;font:14px sans-serif;box-shadow:0 6px 24px #0008";
  const title = document.createElement("strong");
  title.textContent = "dotの対戦接続";
  const status = document.createElement("p");
  status.textContent = "通常の画面で相手用アカウントにログインしてください。";
  const button = document.createElement("button");
  button.textContent = "このアカウントでdotに接続";
  button.style.cssText = "padding:8px 12px;cursor:pointer";
  const detail = document.createElement("p");
  detail.textContent =
    "接続先はこのPC内です。dotはこのアカウントで招待参加・保存デッキ選択・自分の席の対戦操作を行えます。接続補助はセッションを一時メモリだけで保持し、失効・切断・終了で破棄します。";
  const disconnect = document.createElement("button");
  disconnect.textContent = "dotを切断";
  disconnect.hidden = true;
  disconnect.addEventListener("click", async () => {
    const response = await fetch("/dot/disconnect", {
      method: "POST",
      headers: { "X-Dot-Connection": connection },
    });
    if (response.ok) {
      status.textContent = "dotを切断しました。";
      disconnect.hidden = true;
      button.disabled = false;
    }
  });
  panel.append(title, status, detail, button, disconnect);
  document.body.append(panel);

  const update = async () => {
    const { data } = await supabase.auth.getSession();
    button.disabled = !data.session;
    status.textContent = data.session
      ? `${data.session.user.email ?? "ログイン済み"} をdotの相手席として使います。`
      : "通常の画面で相手用アカウントにログインしてください。";
  };
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session)
        throw new Error("ログインを確認してください。");
      // Only the application's own access session is handed off. No refresh token
      // or password is sent; the helper keeps this token in memory until expiry.
      const response = await fetch("/dot/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dot-Connection": connection,
        },
        body: JSON.stringify({ accessToken: data.session.access_token }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "接続に失敗しました。");
      status.textContent =
        "dotに接続しました。招待と保存デッキを確認できます。";
      disconnect.hidden = false;
    } catch {
      status.textContent =
        "接続できませんでした。アカウントと接続補助の起動を確認してください。";
      button.disabled = false;
    }
  });
  supabase.auth.onAuthStateChange(() => {
    window.setTimeout(() => void update(), 0);
  });
  void update();
}
