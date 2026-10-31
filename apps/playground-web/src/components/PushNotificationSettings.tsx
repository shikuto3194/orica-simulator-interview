import { useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import { useInvitationRequest } from "../hooks/useInvitationRequest";
import {
  currentPushSubscription,
  pushOwner,
  setPushOwner,
  unsubscribeBrowserPush,
} from "../pushSubscription";
import { userFacingError } from "../utils/user-facing-error";
import { currentPushChannel } from "../pushDelivery";

export function PushNotificationSettings() {
  const { user } = useAuth();
  const request = useInvitationRequest();
  const supported =
    "Notification" in window &&
    "PushManager" in window &&
    "serviceWorker" in navigator;
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const appleMobile =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  useEffect(() => {
    let cancelled = false;
    if (!supported || !user) {
      setBusy(false);
      return;
    }
    setBusy(true);
    void (async () => {
      const subscription = await currentPushSubscription();
      const config = await request<{
        publicKey: string | null;
        subscribed: boolean;
      }>(
        `/push${subscription ? `?endpoint=${encodeURIComponent(subscription.endpoint)}` : ""}`
      );
      if (!cancelled) {
        setPublicKey(config.publicKey);
        setEnabled(
          !!subscription &&
            config.subscribed &&
            Notification.permission === "granted"
        );
        setError("");
      }
    })()
      .catch((e: unknown) => {
        if (!cancelled)
          setError(userFacingError(e, "通知設定を取得できませんでした"));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request, supported, user, revision]);
  const toggle = async () => {
    if (!user || busy) return;
    setBusy(true);
    setError("");
    try {
      if (enabled) {
        const subscription = await currentPushSubscription();
        if (subscription)
          await request("/push", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
        await unsubscribeBrowserPush();
        setEnabled(false);
      } else {
        // Must run directly from the click, before network awaits (Safari user activation).
        const permission = await Notification.requestPermission();
        if (permission !== "granted")
          throw new Error(
            "通知が許可されていません。ブラウザーのサイト設定で通知を許可してください"
          );
        if (!publicKey) throw new Error("端末通知は現在利用できません");
        if (pushOwner() && pushOwner() !== user.id)
          await unsubscribeBrowserPush();
        const registration = await new Promise<ServiceWorkerRegistration>(
          (resolve, reject) => {
            const timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "通知の準備ができませんでした。画面を再読み込みしてください"
                  )
                ),
              10_000
            );
            navigator.serviceWorker.ready.then(
              (value) => {
                clearTimeout(timer);
                resolve(value);
              },
              (reason) => {
                clearTimeout(timer);
                reject(reason);
              }
            );
          }
        );
        const key = Uint8Array.from(
          atob(publicKey.replaceAll("-", "+").replaceAll("_", "/")),
          (char) => char.charCodeAt(0)
        );
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          }));
        await request("/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...subscription.toJSON(),
            channel: currentPushChannel(),
          }),
        });
        setPushOwner(user.id);
        setEnabled(true);
      }
    } catch (e) {
      setError(
        userFacingError(e, "通知設定を変更できませんでした。再試行してください")
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="push-settings" aria-label="端末通知の設定">
      <div>
        <strong>端末への通知</strong>
        <p>
          {!supported
            ? appleMobile
              ? "ホーム画面に追加した幻想符を開き、通知をオンにしてください。"
              : "この環境は端末通知に対応していません。インストールしたアプリ、または対応ブラウザーで開いてください。"
            : "アプリを閉じていても、対戦のお誘いをお知らせします。"}
        </p>
        <p>通知先はPWA、追加したアプリ、ブラウザーの順に優先します。</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-label="端末への通知"
        aria-checked={enabled}
        disabled={!supported || busy || !publicKey}
        onClick={() => void toggle()}
      >
        <span className="push-switch-track" aria-hidden="true">
          <span />
        </span>
        {busy ? "確認中" : enabled ? "オン" : "オフ"}
      </button>
      {supported && !busy && !publicKey && !error && (
        <p>端末通知は現在利用できません。</p>
      )}
      {error && (
        <div className="push-settings-error">
          <p role="alert">{error}</p>
          <button
            className="invite-text-button"
            disabled={busy}
            onClick={() => setRevision(revision + 1)}
          >
            通知設定を再取得
          </button>
        </div>
      )}
    </section>
  );
}
