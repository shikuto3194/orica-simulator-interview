import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { AuthProvider } from "./AuthContext";
import { App } from "./App";
import { useAuth } from "./AuthContext";
import { BgmProvider } from "./bgm/BgmContext";
import { AssetPreparationProvider } from "./assets/AssetPreparation";
import { LoginPage } from "./components/LoginPage";
import { IS_INTERVIEW_BUILD } from "./interview-mode";
import "./battle.css";
import "./app-theme.css";

function InterviewAuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (!IS_INTERVIEW_BUILD || user) return children;
  if (loading) {
    return <div style={{ padding: 40, textAlign: "center" }}>ログイン状態を確認しています...</div>;
  }
  return <LoginPage />;
}

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container was not found.");
}

async function start() {
  const development = import.meta.env.DEV
    ? await import("./development")
    : undefined;
  const localGame = new URLSearchParams(window.location.search).get(
    "localGame"
  );
  const SessionProvider =
    development && localGame?.startsWith("local-")
      ? development.LocalGameAuthProvider
      : AuthProvider;
  createRoot(container!).render(
    <StrictMode>
      <SessionProvider>
        <InterviewAuthGate>
          <AssetPreparationProvider>
            <BgmProvider>
              <App {...(development ? { development } : {})} />
            </BgmProvider>
          </AssetPreparationProvider>
        </InterviewAuthGate>
      </SessionProvider>
    </StrictMode>
  );
}
void start();
if (
  window.location.hostname === "127.0.0.1" &&
  new URLSearchParams(window.location.hash.slice(1)).has("dot")
) {
  void import("./dot-connection").then((module) =>
    module.installDotConnection()
  );
}
