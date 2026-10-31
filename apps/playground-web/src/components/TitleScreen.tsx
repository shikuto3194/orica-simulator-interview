import { useEffect } from "react";
import { useAuth } from "../AuthContext";
import { useAssetPreparation } from "../assets/AssetPreparation";
import { useAppReloadBoundary } from "../hooks/useAppReloadBoundary";
import { LoginPage } from "./LoginPage";
import "./title-screen.css";

export function TitleScreen({
  onStart,
  autoStart = false,
}: {
  onStart: () => void;
  autoStart?: boolean;
}) {
  const { user, loading } = useAuth();
  const {
    progress,
    tier: storageTier,
    ready,
    retry: retryDownload,
  } = useAssetPreparation();
  useAppReloadBoundary(true);
  const retry = progress.status === "error";
  const showProgress = progress.status === "downloading" || (retry && !ready);
  const canStart = Boolean(user) && !loading && ready && !showProgress;
  const downloadLabel = ready ? "アップデート中" : "ダウンロード中";
  const checking = Boolean(user) && !loading && progress.status === "checking";
  useEffect(() => {
    if (autoStart && canStart) onStart();
  }, [autoStart, canStart, onStart]);
  const enterHome = () => {
    if (canStart) onStart();
  };
  return (
    <div
      className={
        "title-screen" +
        (!canStart ? " title-screen-preload" : "") +
        (checking ? " title-screen-checking" : "") +
        (showProgress ? " title-screen-downloading" : "")
      }
      role={canStart ? "button" : undefined}
      tabIndex={canStart ? 0 : undefined}
      onClick={enterHome}
      onKeyDown={(event) => {
        if (canStart && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          enterHome();
        }
      }}
      data-testid="title-screen"
      data-storage-tier={storageTier}
    >
      <div className="title-card">
        <div className="title-brand">
          <span className="title-brand-reading" aria-hidden="true">
            GENSOUFU
          </span>
          <h1 className="title-logo gensou-wordmark">幻想符</h1>
          <span className="title-brand-rule" aria-hidden="true" />
          <p className="title-sub">バトルスピリッツ シミュレーター</p>
        </div>
        {loading ? (
          <p className="title-session-status">ログインを確認中…</p>
        ) : !user ? (
          <LoginPage embedded />
        ) : (
          <>
            {checking && (
              <div
                className="title-loading-ring"
                role="status"
                aria-label="読み込み中"
                data-testid="title-loading-ring"
              />
            )}
            {showProgress && (
              <div
                className="title-download"
                data-testid="title-download"
                aria-busy={!retry}
              >
                <div
                  className="title-download-percent"
                  data-testid="title-download-percent"
                >
                  {downloadLabel} {progress.percent}%
                </div>
                <div
                  className="title-download-track"
                  role="progressbar"
                  aria-label={downloadLabel}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress.percent}
                >
                  <div
                    className="title-download-fill"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div
                  className="title-download-log"
                  role="log"
                  aria-label="ダウンロードログ"
                  aria-live="polite"
                  aria-relevant="additions text"
                >
                  {progress.logs.map((line, index) => (
                    <div key={`${index}:${line}`}>{line}</div>
                  ))}
                </div>
                {retry && (
                  <button
                    className="title-download-retry"
                    onClick={(event) => {
                      event.stopPropagation();
                      retryDownload();
                    }}
                    aria-label="素材のダウンロードを再試行"
                  />
                )}
              </div>
            )}
            {canStart && (
              <p
                className="title-start-prompt"
                data-testid="title-start-prompt"
              >
                タップでスタート
              </p>
            )}
            {canStart && (
              <p className="title-status" data-testid="title-status">
                <span className="title-status-dot" aria-hidden="true" />
                {user.email}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
