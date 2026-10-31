import { boundedJsonRequest } from "./networkRequest";
import { fetchWithAuthRetry } from "./authFetch";
import { apiUrl } from "./apiUrl";
import { userFacingError } from "./utils/user-facing-error";
import { useState, useMemo, useCallback, useEffect } from "react";
import type { CardDefinition, GameState } from "@orica/rules-core";
import {
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
  parseGameSnapshot,
  restoreSnapshot,
  sanitizeMainDeckDefinitions,
} from "@orica/rules-core";
import { BattleScreen, type PlayerController } from "./components/BattleScreen";
import { DeckBuilder } from "./components/DeckBuilder";
import { BattleSetup, type SavedDeckInfo } from "./components/BattleSetup";
import { LoginPage } from "./components/LoginPage";
import { TitleScreen } from "./components/TitleScreen";
import { MyPage } from "./components/MyPage";
import { RoomLobby } from "./components/RoomLobby";
import { MessageInbox } from "./components/MessageInbox";
import { OperationNotices } from "./components/OperationNotices";
import { useAuth } from "./AuthContext";
import { useCloudDecks } from "./hooks/useCloudDecks";
import { useInvitationLaunch } from "./hooks/useInvitationLaunch";
import { usePushRegistration } from "./hooks/usePushRegistration";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import { useBgm } from "./bgm/BgmContext";
import { BgmBackdrop } from "./bgm/BgmBackdrop";
import { BgmControls } from "./bgm/BgmControls";
import type { ParsedReplay } from "./replayViewer";
import { parseReplayFile } from "./replayViewer";
import { ReplayViewer } from "./components/ReplayViewer";
import "./nonbattle-theme.css";
import "./brand.css";

type DevelopmentTools = typeof import("./development");

const SAVED_DECKS_KEY = "orica-saved-decks-v2";

// 盤面の復元は転醒後も参照する。構築用の ALL_CARDS は表面だけを維持する。
const stateDefinitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const stateCardNoMap = new Map(stateDefinitions.map((c) => [c.cardNo, c]));
const getStateCardDefinitionById = (id: string) => stateCardNoMap.get(id);

interface SavedDeckRaw extends Omit<SavedDeckInfo, "cards"> {
  cardNos: string[];
}

function loadAllSavedDecks(): SavedDeckInfo[] {
  const map = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
  try {
    let raw = localStorage.getItem(SAVED_DECKS_KEY);
    if (!raw) raw = localStorage.getItem("orica-saved-decks-v1");
    if (!raw) return [];
    const decks: SavedDeckRaw[] = JSON.parse(raw);
    // 同名 dedupe (後勝ち)。DeckBuilder の loadSavedDecks と同方針。
    const byName = new Map<string, SavedDeckRaw>();
    for (const d of decks) byName.set(d.name, d);
    return Array.from(byName.values()).map((d) => ({
      name: d.name,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      ...(d.tokenDeck ? { tokenDeck: d.tokenDeck } : {}),
      ...(d.thumbnailCardNo ? { thumbnailCardNo: d.thumbnailCardNo } : {}),
      cards: sanitizeMainDeckDefinitions(
        d.cardNos
          .map((no) => map.get(no))
          .filter((card): card is CardDefinition => card !== undefined)
      ),
    }));
  } catch {
    return [];
  }
}

type Screen =
  | { kind: "title" }
  | { kind: "deck_builder" }
  | { kind: "battle_setup" }
  | { kind: "battle"; aliceDeck: CardDefinition[]; bobDeck: CardDefinition[] }
  | {
      kind: "scenario_battle";
      initialState: GameState;
      manualOpponent: boolean;
      viewingPlayerId: "alice" | "bob";
      roomHarnessId?: string;
    }
  | {
      kind: "room_lobby";
      joinedRoom?: { roomId: string; role: "alice" | "bob" };
    }
  | { kind: "messages"; invitationId?: string }
  | { kind: "notices" }
  | { kind: "room_battle"; roomId: string; role: "alice" | "bob" }
  | { kind: "spectate"; roomId: string; viewingPlayerId: "alice" | "bob" }
  | {
      kind: "replay_viewer";
      replay: ParsedReplay;
      viewingPlayerId: "alice" | "bob";
    }
  | { kind: "mypage" };

/** URLパラメータからルームIDを取得 */
function getRoomIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("room");
}

/** `?viewer=alice|bob` を読む (省略時 alice)。シナリオ / 観戦 / snapshot で共通。 */
function getViewerFromUrl(): "alice" | "bob" {
  return new URLSearchParams(window.location.search).get("viewer") === "bob"
    ? "bob"
    : "alice";
}

function getInitialScreen(development?: DevelopmentTools): Screen {
  const params = new URLSearchParams(window.location.search);
  const localGame = import.meta.env.DEV ? params.get("localGame") : null;
  if (localGame && /^local-[a-f0-9-]+$/.test(localGame))
    return { kind: "room_battle", roomId: localGame, role: getViewerFromUrl() };
  const scenarioId = params.get("scenario");
  const roomId = params.get("room");
  const spectateRoomId = params.get("spectate");
  const invitationId = params.get("invitation");
  if (invitationId && /^[0-9a-f-]{36}$/i.test(invitationId))
    return { kind: "messages", invitationId };
  if (params.get("messages") === "1") return { kind: "messages" };
  if (params.get("notices") === "1") return { kind: "notices" };

  // 観戦専用 URL
  if (spectateRoomId) {
    return {
      kind: "spectate",
      roomId: spectateRoomId,
      viewingPlayerId: getViewerFromUrl(),
    };
  }
  // ルーム参加URL
  if (roomId) return { kind: "room_lobby" };
  // シナリオ直開き
  if (
    import.meta.env.DEV &&
    development &&
    scenarioId &&
    development.SCENARIOS[scenarioId]
  ) {
    const built = development.SCENARIOS[scenarioId].build(ALL_CARDS, params);
    // フィールド/ミラージュ/バースト上の継続効果カードから CE を再構築する。
    // inst() による直接配置は通常召喚パイプラインを通らないため、
    // 継続効果が CE として登録されない。リビルダで補正する (Option C 整合性回復)。
    const hasActiveQueue =
      !development.isSafeStateForContinuousRebuild(built) ||
      built.pendingStepOptionalChoice !== null ||
      built.pendingStepChoice !== null;
    const initialState = hasActiveQueue
      ? built
      : development.rebuildContinuousEffectsFromField(
          built,
          getStateCardDefinitionById
        );
    return {
      kind: "scenario_battle",
      initialState,
      manualOpponent: params.get("manualOpponent") === "1",
      viewingPlayerId: getViewerFromUrl(),
      ...(import.meta.env.DEV && params.get("roomHarness")
        ? { roomHarnessId: params.get("roomHarness")! }
        : {}),
    };
  }
  return { kind: "title" };
}

/** 何もしないコントローラー（対人モード: 相手の自動進行を無効化） */
const noOpController: PlayerController = () => null;

/** ゲーム内画面 (BGM mode = ingame) を判定する。 */
function isIngameScreen(kind: Screen["kind"]): boolean {
  return (
    kind === "battle" ||
    kind === "scenario_battle" ||
    kind === "room_battle" ||
    kind === "spectate" ||
    kind === "replay_viewer"
  );
}

export function App({ development }: { development?: DevelopmentTools }) {
  const { user, profile, loading: authLoading } = useAuth();
  const [screen, setScreen] = useState<Screen>(() =>
    getInitialScreen(development)
  );
  const [_loginSkipped, _setLoginSkipped] = useState(false);
  const { setMode: setBgmMode, initialReady: bgmReady } = useBgm();

  const [startupComplete, setStartupComplete] = useState(false);
  // Scenario URLs remain a direct development/review entry point. Invitations and
  // spectator links retain their destination behind the same title login/download.
  const isLocalGame =
    import.meta.env.DEV &&
    screen.kind === "room_battle" &&
    screen.roomId.startsWith("local-");
  const needsStartup =
    !(import.meta.env.DEV && screen.kind === "scenario_battle") &&
    !isLocalGame &&
    (!startupComplete || !user);
  const isTitle = screen.kind === "title" || needsStartup;
  const ingame = !isTitle && isIngameScreen(screen.kind);
  const openInvitation = useCallback((invitationId?: string) => {
    setScreen({ kind: "messages", ...(invitationId ? { invitationId } : {}) });
  }, []);
  const canOpenInvitation = useCallback(
    () =>
      isTitle ||
      screen.kind === "messages" ||
      (screen.kind === "deck_builder" &&
        !!document.querySelector('[aria-label="ホーム"]')),
    [isTitle, screen.kind]
  );
  useInvitationLaunch(canOpenInvitation, openInvitation);
  usePushRegistration();

  useEffect(() => {
    setBgmMode(ingame ? "ingame" : "outside");
  }, [ingame, setBgmMode]);

  /** BGM 背景 + フローティングコントロールで包む。ゲーム内画面では背景なし。
   *  ゲーム内画面では BattleScreen の「・・・」メニューに BGM 操作を統合するため
   *  フローティング BgmControls は表示しない。
   *  初回 BGM/画像ロード完了までは「読み込み中…」を全画面で被せる。 */
  const wrap = (node: React.ReactNode) => (
    <>
      {!ingame && (
        <BgmBackdrop
          blur={isTitle ? 0 : 2}
          overlayOpacity={isTitle ? 0 : 0.32}
        />
      )}
      {!ingame && user && <BgmControls themed />}
      {!ingame && !isTitle ? <div className="gensou-shell">{node}</div> : node}
      {!bgmReady && !isTitle && (
        <div
          className="bgm-initial-loading"
          data-testid="bgm-initial-loading"
          aria-live="polite"
        >
          <div className="bgm-initial-loading-text">読み込み中…</div>
        </div>
      )}
    </>
  );

  const localDecks = useMemo(() => loadAllSavedDecks(), [screen]); // eslint-disable-line react-hooks/exhaustive-deps -- screen is intentional trigger to reload decks on navigation
  const { decks: cloudDecksRaw } = useCloudDecks(user?.id, ALL_CARDS);
  const cardNoMap = useMemo(
    () => new Map(ALL_CARDS.map((c) => [c.cardNo, c])),
    []
  );

  // Merge local + cloud decks for battle setup (同名は local 優先で 1 件にまとめる)
  const savedDecks = useMemo(() => {
    const byName = new Map<string, SavedDeckInfo>();
    for (const ld of localDecks) {
      // local 内同名は後勝ち (通常は DeckBuilder 側で起きないが保険)
      byName.set(ld.name, ld);
    }
    for (const cd of cloudDecksRaw) {
      if (byName.has(cd.name)) continue; // local 優先
      const cards = sanitizeMainDeckDefinitions(
        cd.cardNos
          .map((no) => cardNoMap.get(no))
          .filter((card): card is CardDefinition => card !== undefined)
      );
      byName.set(cd.name, {
        name: cd.name,
        cards,
        createdAt: cd.createdAt,
        updatedAt: cd.updatedAt,
        tokenDeck: cd.tokenDeck,
        ...(cd.thumbnailCardNo ? { thumbnailCardNo: cd.thumbnailCardNo } : {}),
      });
    }
    return Array.from(byName.values());
  }, [localDecks, cloudDecksRaw, cardNoMap]);

  const handleRoomGameStart = useCallback(
    (roomId: string, role: "alice" | "bob") => {
      setScreen({ kind: "room_battle", roomId, role });
    },
    []
  );

  const resetToTitle = useCallback(() => {
    window.history.replaceState(null, "", "/");
    setScreen({ kind: "title" });
  }, []);

  // ホーム画面（デッキビルダーの home タブ）へ戻る。?scenario= 等の URL も初期化する。
  const goHome = useCallback(() => {
    window.history.replaceState(null, "", "/");
    setScreen({ kind: "deck_builder" });
  }, []);

  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);

  const handleSnapshotFile = useCallback(async (file: File) => {
    setSnapshotError(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text) as unknown;
      const parsed = parseGameSnapshot(json);
      if (!parsed.ok) {
        setSnapshotError(
          `スナップショット解析失敗: ${userFacingError(parsed.error, "対応する形式のスナップショットを選んでください")}`
        );
        return;
      }
      const { state: restored, warnings } = restoreSnapshot(
        parsed.snapshot,
        getStateCardDefinitionById,
        {
          getRegisteredTriggeredEffectActions:
            buildTriggeredEffectLookup(stateDefinitions),
        }
      );
      if (warnings.length > 0) {
        console.warn("[snapshot] restore warnings:", warnings);
      }
      setScreen({
        kind: "scenario_battle",
        initialState: restored,
        manualOpponent: false,
        // snapshot も `?viewer=` を尊重する (旧: "alice" 固定で視点切替不可だった)。
        viewingPlayerId: getViewerFromUrl(),
      });
    } catch (e) {
      const msg = userFacingError(e, "読み込みに失敗しました");
      setSnapshotError(`読み込み失敗: ${msg}`);
    }
  }, []);

  const handleReplayFile = useCallback(async (file: File) => {
    setReplayError(null);
    try {
      const replay = await parseReplayFile(file, {
        getCardDefinitionById: getStateCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(stateDefinitions),
      });
      if (replay.warnings.length > 0) {
        console.warn("[replay] restore warnings:", replay.warnings);
      }
      setScreen({
        kind: "replay_viewer",
        replay,
        viewingPlayerId: getViewerFromUrl(),
      });
    } catch (e) {
      const msg = userFacingError(e, "読み込みに失敗しました");
      setReplayError(`棋譜読み込み失敗: ${msg}`);
    }
  }, []);

  if (isTitle) {
    return wrap(
      <TitleScreen
        key={user?.id ?? "guest"}
        autoStart={screen.kind !== "title"}
        onStart={() => {
          setStartupComplete(true);
          if (screen.kind === "title") setScreen({ kind: "deck_builder" });
        }}
      />
    );
  }

  // 認証読み込み中
  if (authLoading && !isTitle) {
    return wrap(
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          color: "#fff",
        }}
      >
        読み込み中...
      </div>
    );
  }

  // ルーム関連の画面はログイン必須
  if (
    (screen.kind === "room_lobby" ||
      screen.kind === "room_battle" ||
      screen.kind === "messages" ||
      screen.kind === "notices") &&
    !user &&
    !isLocalGame
  ) {
    return wrap(<LoginPage onSkip={resetToTitle} />);
  }

  // ルームロビー
  if (screen.kind === "notices")
    return wrap(<OperationNotices onExit={goHome} />);
  if (screen.kind === "messages") {
    return wrap(
      <MessageInbox
        {...(screen.invitationId
          ? { initialInvitationId: screen.invitationId }
          : {})}
        onExit={goHome}
        onJoin={(room) => {
          const url = new URL(window.location.href);
          url.search = "";
          url.searchParams.set("room", room.roomId);
          window.history.replaceState(null, "", url.toString());
          setScreen({ kind: "room_lobby", joinedRoom: room });
        }}
      />
    );
  }
  if (screen.kind === "room_lobby") {
    return wrap(
      <RoomLobby
        allCards={ALL_CARDS}
        roomId={screen.joinedRoom?.roomId ?? getRoomIdFromUrl()}
        {...(screen.joinedRoom ? { initialRole: screen.joinedRoom.role } : {})}
        onGameStart={handleRoomGameStart}
        onExit={goHome}
      />
    );
  }

  // ルーム対戦
  if (screen.kind === "room_battle") {
    return wrap(
      <RoomBattleLoader
        key={`${screen.roomId}:${user?.id ?? ""}`}
        roomId={screen.roomId}
        role={screen.role}
        {...(user?.id != null ? { userId: user.id } : {})}
        onExit={resetToTitle}
        onHome={goHome}
      />
    );
  }

  // 観戦専用画面 (P3-17 Phase 5)
  if (screen.kind === "spectate") {
    return wrap(
      <SpectatorLoader
        key={`${screen.roomId}:${screen.viewingPlayerId}`}
        roomId={screen.roomId}
        viewingPlayerId={screen.viewingPlayerId}
        onExit={resetToTitle}
        onHome={goHome}
      />
    );
  }

  // シナリオバトル
  if (screen.kind === "scenario_battle") {
    return wrap(
      <BattleScreen
        cardDefs={ALL_CARDS}
        initialState={screen.initialState}
        viewingPlayerId={screen.viewingPlayerId}
        {...(screen.roomHarnessId ? { roomId: screen.roomHarnessId } : {})}
        {...(screen.manualOpponent
          ? { opponentController: noOpController }
          : {})}
        onExit={resetToTitle}
        onHome={goHome}
      />
    );
  }

  if (screen.kind === "replay_viewer") {
    return wrap(
      <ReplayViewer
        replay={screen.replay}
        viewingPlayerId={screen.viewingPlayerId}
        onExit={resetToTitle}
        onHome={goHome}
      />
    );
  }

  // 通常バトル（じゃんけんはBattleScreen内で処理）
  if (screen.kind === "battle") {
    return wrap(
      <BattleScreen
        cardDefs={ALL_CARDS}
        aliceDeck={screen.aliceDeck}
        bobDeck={screen.bobDeck}
        onExit={() => setScreen({ kind: "title" })}
        onHome={goHome}
      />
    );
  }

  if (screen.kind === "battle_setup") {
    return wrap(
      <BattleSetup
        allCards={ALL_CARDS}
        savedDecks={savedDecks}
        onStart={(aliceDeck, bobDeck) =>
          setScreen({ kind: "battle", aliceDeck, bobDeck })
        }
        onBack={goHome}
      />
    );
  }

  if (screen.kind === "deck_builder") {
    return wrap(
      <DeckBuilder
        key={user?.id ?? "guest"}
        allCards={ALL_CARDS}
        onNavigate={(s) => {
          if (s === "title") resetToTitle();
          else setScreen({ kind: s } as Screen);
        }}
        onLoadSnapshot={(file) => void handleSnapshotFile(file)}
        onLoadReplay={(file) => void handleReplayFile(file)}
        snapshotError={snapshotError}
        replayError={replayError}
      />
    );
  }

  // マイページ (ログイン必須)
  if (screen.kind === "mypage") {
    if (!user) {
      return wrap(<LoginPage onSkip={resetToTitle} />);
    }
    if (!profile) {
      return wrap(
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            color: "#fff",
          }}
        >
          プロフィール読み込み中...
        </div>
      );
    }
    return wrap(<MyPage initialProfile={profile} onBack={goHome} />);
  }

  return wrap(
    <TitleScreen onStart={() => setScreen({ kind: "deck_builder" })} />
  );
}

/** Loads the sanitized room state before mounting the read-only battle. */
function SpectatorLoader({
  roomId,
  viewingPlayerId,
  onExit,
  onHome,
}: {
  roomId: string;
  viewingPlayerId: "alice" | "bob";
  onExit: () => void;
  onHome: () => void;
}) {
  const [initialState, setInitialState] = useState<GameState | null>(null);
  const [initialVersion, setInitialVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const init = async () => {
      try {
        // 1. ルーム存在 / 観戦許可確認
        const roomRes = await boundedJsonRequest(
          fetch,
          apiUrl(`/api/room/${roomId}`),
          { signal: controller.signal }
        );
        if (!roomRes.ok) {
          if (cancelled) return;
          if (roomRes.status === 404) setError("ルームが見つかりません");
          else if (roomRes.status === 401)
            setError("このルームは観戦が許可されていません");
          else setError(`ルーム取得失敗 (HTTP ${roomRes.status})`);
          return;
        }
        const roomData = await roomRes.json();
        if (roomData.spectatorMode !== "public_link") {
          if (!cancelled) setError("このルームは観戦が許可されていません");
          return;
        }
        // 2. ゲーム開始まで state を待つ
        while (!cancelled) {
          const stateRes = await boundedJsonRequest(
            fetch,
            apiUrl(`/api/room/${roomId}/state/full`),
            { signal: controller.signal }
          );
          if (stateRes.ok) {
            const data = await stateRes.json();
            if (data.state && !cancelled) {
              setInitialState(data.state);
              setInitialVersion(
                typeof data.version === "number" ? data.version : 0
              );
              return;
            }
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (e) {
        if (!cancelled) {
          setError(userFacingError(e, "読み込みに失敗しました"));
        }
      }
    };
    init();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [roomId]);

  const containerStyle = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--lobby-panel)",
    color: "#fff",
    flexDirection: "column" as const,
    gap: "1em",
    padding: "1em",
    textAlign: "center" as const,
  };

  if (error) {
    return (
      <div style={containerStyle} data-testid="spectator-error">
        <div>{error}</div>
        <button
          onClick={onExit}
          className="ui-link"
          style={{
            background: "none",
            border: "1px solid #666",
            color: "#aaa",
            padding: "0.5em 1em",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          戻る
        </button>
      </div>
    );
  }

  if (!initialState) {
    return (
      <div style={containerStyle}>
        <div>観戦データを読み込み中...</div>
        <div style={{ fontSize: "0.85em", color: "#aaa" }}>
          ゲーム開始までお待ちください
        </div>
        <button
          onClick={onExit}
          className="ui-link"
          style={{
            background: "none",
            border: "1px solid #666",
            color: "#aaa",
            padding: "0.5em 1em",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          戻る
        </button>
      </div>
    );
  }

  return (
    <BattleScreen
      cardDefs={ALL_CARDS}
      initialState={initialState}
      initialVersion={initialVersion}
      roomId={roomId}
      viewingPlayerId={viewingPlayerId}
      readOnly
      opponentController={noOpController}
      onExit={onExit}
      onHome={onHome}
    />
  );
}

/** ルーム対戦ローダー: サーバーからGameStateを取得してからBattleScreenをマウント */
function RoomBattleLoader({
  roomId,
  role,
  userId,
  onExit,
  onHome,
}: {
  roomId: string;
  role: "alice" | "bob";
  userId?: string;
  onExit: () => void;
  onHome: () => void;
}) {
  const { getAccessToken, refreshAccessToken } = useAuth();
  const [initialState, setInitialState] = useState<GameState | null>(null);
  const [initialVersion, setInitialVersion] = useState(0);
  const [resolvedRole, setResolvedRole] = useState(role);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const request = (input: RequestInfo | URL, init?: RequestInit) =>
      fetchWithAuthRetry(input, init, { getAccessToken, refreshAccessToken });
    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await boundedJsonRequest(
            request,
            apiUrl(`/api/room/${roomId}/state/full`),
            { signal: controller.signal }
          );
          if (res.ok) {
            const data = await res.json();
            // public_link ルームでは getViewerPlayerId の再認証が失敗すると
            // 200 + 観戦者 sanitize 済み state が返る。RoomBattleLoader は
            // プレイヤー専用 (観戦者は SpectatorLoader) なので、isSpectator:true は
            // 受理せずポーリングを継続する (Supabase 自動リフレッシュ後に再試行)。
            if (data.state && data.isSpectator !== true && !cancelled) {
              let viewer = data.viewerPlayerId;
              if (viewer !== "alice" && viewer !== "bob") {
                const meta = await boundedJsonRequest(
                  request,
                  apiUrl(`/api/room/${roomId}`),
                  { signal: controller.signal }
                );
                if (!meta.ok) throw new Error("Room role unavailable");
                viewer = (await meta.json()).players?.find(
                  (player: { userId: string }) => player.userId === userId
                )?.role;
              }
              if (cancelled || (viewer !== "alice" && viewer !== "bob")) return;
              setResolvedRole(viewer);
              setInitialState(data.state);
              setInitialVersion(
                typeof data.version === "number" ? data.version : 0
              );
              return;
            }
          }
        } catch {
          /* retry */
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    poll();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [roomId, userId, getAccessToken, refreshAccessToken]);

  if (!initialState) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--lobby-panel)",
          color: "#fff",
          flexDirection: "column",
          gap: "1em",
        }}
      >
        <div>ゲームデータを読み込み中...</div>
        <button
          onClick={onExit}
          className="ui-link"
          style={{
            background: "none",
            border: "1px solid #666",
            color: "#aaa",
            padding: "0.5em 1em",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          戻る
        </button>
      </div>
    );
  }

  return (
    <BattleScreen
      cardDefs={ALL_CARDS}
      initialState={initialState}
      initialVersion={initialVersion}
      roomId={roomId}
      viewingPlayerId={resolvedRole}
      {...(userId != null ? { userId } : {})}
      opponentController={noOpController}
      onExit={onExit}
      onHome={onHome}
    />
  );
}
