import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { notifyDeckLibraryChanged } from "../hooks/useDeckLibrary";

interface Settings {
  main_email: string;
  sub_email: string;
  account_enabled: boolean;
  deck_enabled: boolean;
  revision: string | null;
}

/** Menu hierarchy follows acg-react: management menu -> feature page. */
export function AccountLinkSettings({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("bs_admin_account_link");
      if (error) throw new Error(error.message);
      setSettings(data as Settings);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "取得に失敗しました");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const save = async () => {
    if (!settings) return;
    setBusy(true);
    setMessage("");
    try {
      const { data, error } = await supabase.rpc("bs_admin_account_link", {
        p_settings: settings,
      });
      if (error) throw new Error(error.message);
      setSettings(data as Settings);
      notifyDeckLibraryChanged();
      setMessage("設定を保存しました");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mp-section">
      <button className="mp-btn-secondary" onClick={onBack}>
        運営メニューへ戻る
      </button>
      <h2>アカウント・デッキ連携</h2>
      <p>
        管理者とルーム対戦用サブアカウントを設定します。ログインと対戦参加者は別々のままです。
      </p>
      {settings && (
        <fieldset
          disabled={busy}
          style={{ border: 0, padding: 0, minWidth: 0 }}
        >
          <label className="mp-label">
            メインアカウント（デッキの正源）
            <input
              className="mp-input"
              type="email"
              value={settings.main_email}
              onChange={(e) =>
                setSettings({ ...settings, main_email: e.target.value })
              }
            />
          </label>
          <label className="mp-label">
            サブアカウント
            <input
              className="mp-input"
              type="email"
              value={settings.sub_email}
              onChange={(e) =>
                setSettings({ ...settings, sub_email: e.target.value })
              }
            />
          </label>
          <button
            className="mp-btn-secondary"
            onClick={() =>
              setSettings({
                ...settings,
                main_email: settings.sub_email,
                sub_email: settings.main_email,
              })
            }
          >
            メインとサブを入れ替える
          </button>
          <label className="mp-label">
            <input
              type="checkbox"
              checked={settings.account_enabled}
              onChange={(e) =>
                setSettings({ ...settings, account_enabled: e.target.checked })
              }
            />{" "}
            サブアカウント連携
          </label>
          <label className="mp-label">
            <input
              type="checkbox"
              checked={settings.deck_enabled}
              onChange={(e) =>
                setSettings({ ...settings, deck_enabled: e.target.checked })
              }
            />{" "}
            デッキ連携（BS）
          </label>
          <p>
            両方オンでメインのデッキを共用します。サブからの保存・削除もメインに反映されます。
          </p>
          <p role="note">
            オンへの切り替えでサブの元のデッキは削除されます。オフではその時点の共有デッキを複製して独立させます。元のデッキは復元しません。連携中のメイン・サブの入れ替えでは、共有デッキを新メインへ引き継ぎます。
          </p>
          <button
            className="mp-btn-primary"
            onClick={() => void save()}
            disabled={!settings.main_email.trim() || !settings.sub_email.trim()}
          >
            設定を保存
          </button>
        </fieldset>
      )}
      {busy && <p role="status">処理中...</p>}
      {message && <p role="status">{message}</p>}
      <button
        className="mp-btn-secondary"
        onClick={() => void load()}
        disabled={busy}
      >
        設定を再読み込み
      </button>
    </section>
  );
}
