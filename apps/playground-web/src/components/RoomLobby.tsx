import { apiUrl } from "../apiUrl";
import { userFacingError } from "../utils/user-facing-error";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { type CardDefinition } from "@orica/rules-core";
import QRCode from "react-qr-code";
import { DeckThumbnail } from "./DeckThumbnail";
import { RoomDeckPicker } from "./RoomDeckPicker";
import { deckSelectionIssue } from "../utils/deck-selection";
import { RoomInvitePicker } from "./RoomInvitePicker";
import { Html5Qrcode } from "html5-qrcode";
import { useAuth } from "../AuthContext";
import { AuthSessionUnavailableError, fetchWithAuthRetry } from "../authFetch";
import { useCloudDecks, type CloudDeck } from "../hooks/useCloudDecks";
import { notifyRoomLeave } from "../roomLeave";
import type { UnfinishedRoomSummary } from "../../server/room-list";

interface RoomLobbyProps {
  allCards: CardDefinition[];
  roomId: string | null;
  initialRole?: "alice" | "bob";
  onGameStart: (roomId: string, role: "alice" | "bob") => void;
  onExit: () => void;
}

/** ルームIDからフルURLを生成 */
function buildRoomUrl(rid: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("room", rid);
  return url.toString();
}

/** ルームIDから観戦専用URLを生成 (?spectate=...) */
function buildSpectateUrl(rid: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("spectate", rid);
  return url.toString();
}

/** URLコピー */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * ルームロビー: ルーム作成/参加 → デッキ選択 → ゲーム開始
 */
export function RoomLobby({
  allCards,
  roomId: initialRoomId,
  initialRole,
  onGameStart,
  onExit,
}: RoomLobbyProps) {
  const { user, getAccessToken, getCachedAccessToken, refreshAccessToken } =
    useAuth();

  const authenticatedFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) =>
      fetchWithAuthRetry(input, init, { getAccessToken, refreshAccessToken }),
    [getAccessToken, refreshAccessToken]
  );
  const {
    decks: cloudDecks,
    loading: decksLoading,
    error: deckError,
  } = useCloudDecks(user?.id, allCards);

  const [roomId, setRoomId] = useState(initialRoomId);
  const [role, setRole] = useState<"alice" | "bob" | null>(initialRole ?? null);
  const [joinInput, setJoinInput] = useState("");
  const [selectedDeck, setSelectedDeck] = useState<CloudDeck | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deckBusy, setDeckBusy] = useState(false);
  const [deckChangeError, setDeckChangeError] = useState("");
  const [registeredCardNos, setRegisteredCardNos] = useState<string[] | null>(
    null
  );
  const deckMutation = useRef({ revision: 0, busy: false });
  const cardMap = useMemo(
    () => new Map(allCards.map((card) => [card.cardNo, card])),
    [allCards]
  );
  const selectedIssue = selectedDeck
    ? deckSelectionIssue(selectedDeck.cardNos, cardMap)
    : null;
  const [deckSubmitted, setDeckSubmitted] = useState(false);
  const [opponentReady, setOpponentReady] = useState(false);
  const [error, setError] = useState("");
  const [unfinishedRooms, setUnfinishedRooms] = useState<
    UnfinishedRoomSummary[]
  >([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsError, setRoomsError] = useState("");
  const [roomsRevision, setRoomsRevision] = useState(0);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);
  const [roomPlayers, setRoomPlayers] = useState<
    Array<{ role: string; userId: string; deckReady: boolean }>
  >([]);
  const [copied, setCopied] = useState(false);
  const [spectateLinkCopied, setSpectateLinkCopied] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [allowSpectators, setAllowSpectators] = useState(false);
  const [spectatorMode, setSpectatorMode] = useState<
    "private" | "public_link" | null
  >(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerRef = useRef<HTMLDivElement | null>(null);
  const joiningRoomRef = useRef(false);
  const leavingRef = useRef(false);

  const handleExit = useCallback(() => {
    leavingRef.current = true;
    if (roomId && user && role) {
      void getAccessToken()
        .then((token) => notifyRoomLeave(roomId, user.id, token))
        .catch(() => {});
    }
    onExit();
  }, [roomId, user, role, getAccessToken, onExit]);

  useEffect(() => {
    if (!roomId || !user || !role) return;
    const onPageHide = () => {
      leavingRef.current = true;
      void notifyRoomLeave(roomId, user.id, getCachedAccessToken());
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      void authenticatedFetch(apiUrl(`/api/room/${roomId}/join`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      })
        .then((response) => {
          if (response.ok) leavingRef.current = false;
        })
        .catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [roomId, user, role, getCachedAccessToken, authenticatedFetch]);

  const apiErrorMessage = useCallback(
    (response: Response, data: { error?: unknown }): string => {
      if (response.status === 401) {
        return "認証を確認できませんでした。戻って再度ログインしてください。";
      }
      return typeof data.error === "string"
        ? userFacingError(data.error, "サーバーとの通信に失敗しました")
        : "サーバーとの通信に失敗しました";
    },
    []
  );

  const requestErrorMessage = useCallback(
    (error: unknown, fallback: string): string =>
      error instanceof AuthSessionUnavailableError
        ? "ログインセッションの有効期限が切れました。戻って再度ログインしてください。"
        : fallback,
    []
  );

  // 一覧の取得では個別ロビーのポーリング・join・heartbeat を一切行わない。
  useEffect(() => {
    if (roomId || !user) return;
    const controller = new AbortController();
    setRoomsLoading(true);
    setRoomsError("");
    void authenticatedFetch(apiUrl("/api/room"), { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setRoomsError(apiErrorMessage(res, data));
          return;
        }
        setUnfinishedRooms(data.rooms);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setRoomsError(
            requestErrorMessage(e, "ルーム一覧の取得に失敗しました")
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setRoomsLoading(false);
      });
    return () => controller.abort();
  }, [
    roomId,
    user,
    roomsRevision,
    authenticatedFetch,
    apiErrorMessage,
    requestErrorMessage,
  ]);

  // ルーム作成
  const createRoom = useCallback(async () => {
    setError("");
    try {
      const res = await authenticatedFetch(apiUrl("/api/room"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user!.id,
          spectatorMode: allowSpectators ? "public_link" : "private",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(apiErrorMessage(res, data));
        return;
      }
      setRoomId(data.roomId);
      setRole(data.role);
      setSpectatorMode(data.spectatorMode ?? "private");
      const url = new URL(window.location.href);
      url.searchParams.set("room", data.roomId);
      window.history.replaceState(null, "", url.toString());
    } catch (e) {
      setError(requestErrorMessage(e, "ルーム作成に失敗しました"));
    }
  }, [
    user,
    authenticatedFetch,
    allowSpectators,
    apiErrorMessage,
    requestErrorMessage,
  ]);

  // ルーム参加
  const joinRoom = useCallback(
    async (rid: string) => {
      if (joiningRoomRef.current) return;
      joiningRoomRef.current = true;
      setJoiningRoomId(rid);
      setError("");
      try {
        const res = await authenticatedFetch(apiUrl(`/api/room/${rid}/join`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user!.id }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(apiErrorMessage(res, data));
          if (res.status === 404) setRoomsRevision((revision) => revision + 1);
          return;
        }
        setRoomId(data.roomId);
        setRole(data.role);
        const url = new URL(window.location.href);
        url.searchParams.set("room", data.roomId);
        window.history.replaceState(null, "", url.toString());
      } catch (e) {
        setError(requestErrorMessage(e, "ルーム参加に失敗しました"));
      } finally {
        joiningRoomRef.current = false;
        setJoiningRoomId(null);
      }
    },
    [user, authenticatedFetch, apiErrorMessage, requestErrorMessage]
  );

  const deleteRoom = useCallback(
    async (rid: string) => {
      setRoomsError("");
      setDeletingRoomId(rid);
      try {
        const res = await authenticatedFetch(apiUrl(`/api/room/${rid}`), {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) {
          setRoomsError(apiErrorMessage(res, data));
          return;
        }
        setUnfinishedRooms((rooms) =>
          rooms.filter((room) => room.roomId !== rid)
        );
      } catch (e) {
        setRoomsError(requestErrorMessage(e, "ルームの削除に失敗しました"));
      } finally {
        setDeletingRoomId(null);
      }
    },
    [authenticatedFetch, apiErrorMessage, requestErrorMessage]
  );

  // URL に roomId があれば自動参加
  useEffect(() => {
    if (initialRoomId && !role && user) {
      joinRoom(initialRoomId);
    }
  }, [initialRoomId, role, user, joinRoom]);

  // デッキ登録
  const submitDeck = useCallback(async () => {
    if (!roomId || !selectedDeck || selectedIssue || deckMutation.current.busy)
      return;
    deckMutation.current = {
      revision: deckMutation.current.revision + 1,
      busy: true,
    };
    setDeckBusy(true);
    setError("");
    try {
      const res = await authenticatedFetch(apiUrl(`/api/room/${roomId}/deck`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user!.id,
          deckCardNos: selectedDeck.cardNos,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(apiErrorMessage(res, data));
        return;
      }
      setDeckSubmitted(true);
      if (data.allReady) setOpponentReady(true);
    } catch (e) {
      setError(requestErrorMessage(e, "デッキ登録に失敗しました"));
    } finally {
      deckMutation.current = {
        revision: deckMutation.current.revision + 1,
        busy: false,
      };
      setDeckBusy(false);
    }
  }, [
    roomId,
    selectedDeck,
    selectedIssue,
    user,
    authenticatedFetch,
    apiErrorMessage,
    requestErrorMessage,
  ]);

  const chooseDeck = useCallback(
    async (deck: CloudDeck) => {
      if (!roomId || !user || deckMutation.current.busy) return;
      if (deckSelectionIssue(deck.cardNos, cardMap)) return;
      // 同じ保存デッキの再確認は準備状態を変えない。
      if (
        selectedDeck?.id === deck.id &&
        JSON.stringify(selectedDeck.cardNos) === JSON.stringify(deck.cardNos)
      ) {
        setPickerOpen(false);
        return;
      }
      deckMutation.current = {
        revision: deckMutation.current.revision + 1,
        busy: true,
      };
      setDeckBusy(true);
      setDeckChangeError("");
      try {
        // 別タブの準備完了も解除するため、ローカル表示によらずサーバーへ送る。
        const response = await authenticatedFetch(
          apiUrl(`/api/room/${roomId}/deck`),
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: user.id }),
          }
        );
        const data = await response.json();
        if (!response.ok) {
          setDeckChangeError(apiErrorMessage(response, data));
          return;
        }
        setSelectedDeck(deck);
        setRegisteredCardNos(null);
        setDeckSubmitted(false);
        setOpponentReady(false);
        setError("");
        setPickerOpen(false);
      } catch (cause) {
        setDeckChangeError(
          requestErrorMessage(cause, "変更に失敗しました。再試行してください")
        );
      } finally {
        deckMutation.current = {
          revision: deckMutation.current.revision + 1,
          busy: false,
        };
        setDeckBusy(false);
      }
    },
    [
      roomId,
      user,
      selectedDeck,
      cardMap,
      authenticatedFetch,
      apiErrorMessage,
      requestErrorMessage,
    ]
  );

  // 再参加時は自分の登録内容だけを復元する。保存元が削除済みでも内容を確認できる。
  useEffect(() => {
    if (!registeredCardNos) return;
    const signature = [...registeredCardNos].sort().join("\n");
    setSelectedDeck((current) => {
      const matchingDeck = cloudDecks.find(
        (deck) => [...deck.cardNos].sort().join("\n") === signature
      );
      if (
        current &&
        [...current.cardNos].sort().join("\n") === signature &&
        (cloudDecks.some((deck) => deck.id === current.id) || !matchingDeck)
      )
        return current;
      return (
        matchingDeck ?? {
          id: "registered-deck",
          name: "登録済みデッキ",
          cardNos: registeredCardNos,
          totalCards: registeredCardNos.length,
          thumbnailCardNo: null,
          tokenDeck: [],
        }
      );
    });
  }, [registeredCardNos, cloudDecks]);

  // ルーム状態ポーリング
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    const pollRoom = async () => {
      if (leavingRef.current) return;
      const revision = deckMutation.current.revision;
      try {
        const res = await authenticatedFetch(apiUrl(`/api/room/${roomId}`));
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.gameStarted && role) {
          onGameStart(roomId, role);
          return;
        }
        if (
          deckMutation.current.busy ||
          revision !== deckMutation.current.revision
        )
          return;
        setRoomPlayers(data.players);
        setRegisteredCardNos(data.ownDeckCardNos ?? null);
        const ownPlayer = data.players.find(
          (p: { role: string }) => p.role === role
        );
        if (ownPlayer) setDeckSubmitted(ownPlayer.deckReady);
        if (data.spectatorMode) {
          setSpectatorMode(data.spectatorMode);
        }
        const allReady =
          data.players.length === 2 &&
          data.players.every((p: { deckReady: boolean }) => p.deckReady);
        setOpponentReady(allReady);
      } catch {
        /* ignore */
      }
    };
    void pollRoom();
    const interval = setInterval(() => {
      void pollRoom();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [roomId, role, onGameStart, authenticatedFetch]);

  // ゲーム開始
  const startGame = useCallback(async () => {
    if (!roomId || !user) return;
    try {
      // Persist before sending. A lost response/reload must reuse this identity.
      // Lobby polling enters a game only after the server reports it started.
      const key = `orica-room-start:${user.id}:${roomId}`;
      const clientMutationId = localStorage.getItem(key) || crypto.randomUUID();
      localStorage.setItem(key, clientMutationId);
      const res = await authenticatedFetch(
        apiUrl(`/api/room/${roomId}/start`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedVersion: 0, clientMutationId }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(apiErrorMessage(res, data));
        return;
      }
      if (role) onGameStart(roomId, role);
    } catch (e) {
      setError(requestErrorMessage(e, "バトル開始に失敗しました"));
    }
  }, [
    user,
    roomId,
    role,
    onGameStart,
    authenticatedFetch,
    apiErrorMessage,
    requestErrorMessage,
  ]);

  // URLコピー
  const handleCopy = useCallback(async () => {
    if (!roomId) return;
    const ok = await copyToClipboard(buildRoomUrl(roomId));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [roomId]);

  // 観戦リンクコピー
  const handleSpectateCopy = useCallback(async () => {
    if (!roomId) return;
    const ok = await copyToClipboard(buildSpectateUrl(roomId));
    if (ok) {
      setSpectateLinkCopied(true);
      setTimeout(() => setSpectateLinkCopied(false), 2000);
    }
  }, [roomId]);

  /** QR読取結果を処理 */
  const handleQrResult = useCallback(
    (decodedText: string) => {
      // URLからルームIDを抽出
      try {
        const url = new URL(decodedText);
        const rid = url.searchParams.get("room");
        if (rid) {
          joinRoom(rid);
          return;
        }
      } catch {
        /* not a URL */
      }
      // ルームID直値の場合
      if (/^[a-z0-9]{4,10}$/.test(decodedText)) {
        joinRoom(decodedText);
      } else {
        setError("QRコードからルームIDを読み取れませんでした");
      }
    },
    [joinRoom]
  );

  // カメラスキャナー開始
  const startScanner = useCallback(async () => {
    setScanning(true);
    setError("");
    await new Promise((r) => setTimeout(r, 100));
    try {
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 200, height: 200 } },
        (decodedText) => {
          scanner.stop().catch(() => {});
          scannerRef.current = null;
          setScanning(false);
          handleQrResult(decodedText);
        },
        () => {}
      );
    } catch (_e) {
      // カメラ不可 → スキャナーUIは閉じてエラー表示（画像読込は別ボタン）
      setScanning(false);
      setError(
        "カメラを起動できませんでした。「画像から読取」をお試しください。"
      );
    }
  }, [handleQrResult]);

  // QRスキャナー停止
  const stopScanner = useCallback(() => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
      scannerRef.current = null;
    }
    setScanning(false);
  }, []);

  // 画像ファイルからQR読取
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setError("");
      try {
        const scanner = new Html5Qrcode("qr-file-reader");
        const result = await scanner.scanFile(file, true);
        scanner.clear();
        handleQrResult(result);
      } catch {
        setError("画像からQRコードを読み取れませんでした");
      }
      // inputをリセット（同じファイル再選択を可能に）
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleQrResult]
  );

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  /** ルーム情報 + QRコード + コピーボタン の共通表示 */
  const renderRoomInfo = (showQr: boolean) => {
    if (!roomId) return null;
    const roomUrl = buildRoomUrl(roomId);
    return (
      <div
        style={{
          background: "var(--lobby-surface, #0f3460)",
          padding: "0.8em",
          borderRadius: 8,
          marginBottom: "1em",
        }}
      >
        <div style={{ fontSize: "0.85em", color: "#aaa" }}>ルームID</div>
        <div
          style={{
            fontSize: "1.2em",
            fontWeight: "bold",
            letterSpacing: "0.1em",
          }}
        >
          {roomId}
        </div>
        {role && (
          <div
            style={{ fontSize: "0.85em", color: "#aaa", marginTop: "0.3em" }}
          >
            あなた: {role === "alice" ? "プレイヤー1" : "プレイヤー2"}
          </div>
        )}
        <div style={{ fontSize: "0.85em", color: "#aaa" }}>
          参加者: {roomPlayers.length}/2
        </div>
        {spectatorMode === "public_link" && (
          <div
            style={{
              fontSize: "0.85em",
              color: "#7fffaa",
              marginTop: "0.3em",
            }}
            data-testid="spectator-mode-indicator"
          >
            観戦リンク共有: 有効
          </div>
        )}
        {showQr && (
          <details className="room-share-options">
            <summary>URL・QRコードで招待</summary>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                marginTop: "0.8em",
                gap: "0.5em",
              }}
            >
              <div
                style={{
                  background: "#fff",
                  padding: 8,
                  borderRadius: 8,
                  display: "inline-block",
                }}
              >
                <QRCode value={roomUrl} size={160} />
              </div>
              <button
                onClick={handleCopy}
                style={{ ...btnSmallStyle, width: "auto" }}
              >
                {copied ? "コピーしました" : "URLをコピー"}
              </button>
              {spectatorMode === "public_link" && (
                <button
                  onClick={handleSpectateCopy}
                  style={{ ...btnSmallStyle, width: "auto" }}
                  data-testid="copy-spectate-link"
                >
                  {spectateLinkCopied ? "コピーしました" : "観戦リンクをコピー"}
                </button>
              )}
            </div>
          </details>
        )}
      </div>
    );
  };

  return (
    <div className="room-lobby">
      <div className="room-lobby-card">
        <p className="room-lobby-brand gensou-wordmark">幻想符</p>
        <h2 className="room-lobby-heading">対戦ルーム</h2>
        <p
          className="room-account"
          style={{
            textAlign: "center",
            fontSize: "0.85em",
            color: "#aaa",
            marginBottom: "1.5em",
          }}
        >
          {user?.email}
        </p>

        {/* html5-qrcode の scanFile 用非表示コンテナ */}
        <div id="qr-file-reader" style={{ display: "none" }} />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />

        {/* ルーム未参加 */}
        {!roomId && !scanning && (
          <section
            className="room-resume"
            aria-labelledby="room-resume-heading"
          >
            <div className="room-resume-header">
              <h3 id="room-resume-heading">参加済みの未決着ルーム</h3>
              <button
                type="button"
                style={btnSmallStyle}
                disabled={roomsLoading || joiningRoomId !== null}
                onClick={() => setRoomsRevision((revision) => revision + 1)}
              >
                一覧を更新
              </button>
            </div>
            {roomsLoading && <p role="status">ルーム一覧を読み込み中...</p>}
            {roomsError && <p role="alert">{roomsError}</p>}
            {!roomsLoading && !roomsError && unfinishedRooms.length === 0 && (
              <p>戻れるルームはありません。</p>
            )}
            {unfinishedRooms.length > 0 && (
              <ul className="room-resume-list">
                {unfinishedRooms.map((room) => (
                  <li key={room.roomId}>
                    <div>
                      <strong>{room.roomId}</strong>
                      <span>
                        {room.gameStarted ? "対戦中" : "開始待ち"}・参加者{" "}
                        {room.playerCount}/2
                      </span>
                      <span>
                        作成: {new Date(room.createdAt).toLocaleString("ja-JP")}
                      </span>
                    </div>
                    {room.role === "alice" && room.isVacant && (
                      <button
                        type="button"
                        style={btnSmallStyle}
                        aria-label={`ルーム ${room.roomId} を削除`}
                        disabled={
                          joiningRoomId !== null || deletingRoomId !== null
                        }
                        onClick={() => void deleteRoom(room.roomId)}
                      >
                        {deletingRoomId === room.roomId ? "削除中..." : "削除"}
                      </button>
                    )}
                    <button
                      type="button"
                      style={btnSmallStyle}
                      aria-label={`ルーム ${room.roomId} に戻る`}
                      disabled={
                        joiningRoomId !== null || deletingRoomId !== null
                      }
                      onClick={() => joinRoom(room.roomId)}
                    >
                      {joiningRoomId === room.roomId ? "接続中..." : "戻る"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {!roomId && !scanning && (
          <div className="room-entry">
            <button
              className="room-create"
              onClick={createRoom}
              disabled={joiningRoomId !== null}
              style={btnStyle}
            >
              ルームを作成
            </button>
            <label
              className="room-share"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5em",
                margin: "0.5em 0",
                fontSize: "0.85em",
                color: "#aaa",
                cursor: "pointer",
              }}
              data-testid="allow-spectators-toggle"
            >
              <input
                type="checkbox"
                checked={allowSpectators}
                onChange={(e) => setAllowSpectators(e.target.checked)}
              />
              観戦リンクを共有可能にする
            </label>
            <div
              className="room-or"
              style={{ margin: "1em 0", textAlign: "center", color: "#666" }}
            >
              または
            </div>
            <div
              className="room-join"
              style={{ display: "flex", gap: "8px", marginBottom: "0.5em" }}
            >
              <input
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value)}
                placeholder="ルームIDを入力"
                style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
              />
              <button
                className="ui-primary"
                onClick={() => joinRoom(joinInput.trim())}
                disabled={!joinInput.trim() || joiningRoomId !== null}
                style={{ ...btnStyle, width: "auto", padding: "0.5em 1em" }}
              >
                参加
              </button>
            </div>
            <div className="room-qr" style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={startScanner}
                style={{ ...btnSmallStyle, flex: 1 }}
              >
                カメラで読取
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{ ...btnSmallStyle, flex: 1 }}
              >
                画像から読取
              </button>
            </div>
          </div>
        )}

        {/* QRカメラスキャナー */}
        {!roomId && scanning && (
          <div style={{ textAlign: "center" }}>
            <p style={{ marginBottom: "0.5em", fontSize: "0.9em" }}>
              QRコードをカメラにかざしてください
            </p>
            <div
              id="qr-reader"
              ref={scannerContainerRef}
              style={{ width: "100%", marginBottom: "0.8em" }}
            />
            <button onClick={stopScanner} style={btnSmallStyle}>
              キャンセル
            </button>
          </div>
        )}

        {roomId && role && (
          <>
            {renderRoomInfo(roomPlayers.length < 2)}
            {role === "alice" && roomPlayers.length < 2 && (
              <RoomInvitePicker key={roomId} roomId={roomId} />
            )}
            <button
              type="button"
              className="room-selected-deck"
              disabled={deckBusy || decksLoading}
              onClick={() => {
                setDeckChangeError("");
                setPickerOpen(true);
              }}
            >
              {selectedDeck ? (
                <>
                  <DeckThumbnail
                    allCards={allCards}
                    cardNos={selectedDeck.cardNos}
                    thumbnailCardNo={selectedDeck.thumbnailCardNo}
                  />
                  <span>
                    <strong>{selectedDeck.name}</strong>
                    <small>{selectedDeck.cardNos.length}枚 · 変更</small>
                  </span>
                </>
              ) : decksLoading ? (
                "読み込み中…"
              ) : (
                "デッキを選ぶ"
              )}
            </button>
            {deckError && <p role="alert">{deckError}</p>}
            {!decksLoading && !deckError && cloudDecks.length === 0 && (
              <p>保存デッキがありません。ホームでデッキを保存してください。</p>
            )}
            <div className="room-ready-status" aria-live="polite">
              <span>
                あなた:{" "}
                {deckSubmitted
                  ? "準備完了"
                  : selectedDeck
                    ? "選択済み"
                    : "未選択"}
              </span>
              <span>
                相手:{" "}
                {roomPlayers.length < 2
                  ? "参加待ち"
                  : roomPlayers.some(
                        (player) => player.role !== role && player.deckReady
                      )
                    ? "準備完了"
                    : "準備中"}
              </span>
            </div>
            {selectedIssue && (
              <p className="saved-deck-issue">{selectedIssue}</p>
            )}
            {!deckSubmitted && (
              <button
                className="ui-primary"
                onClick={submitDeck}
                disabled={
                  !selectedDeck || !!selectedIssue || deckBusy || pickerOpen
                }
                style={btnStyle}
              >
                {deckBusy ? "送信中…" : "準備完了"}
              </button>
            )}
            {deckSubmitted &&
              opponentReady &&
              (role === "alice" ? (
                <button
                  className="ui-primary"
                  onClick={startGame}
                  disabled={deckBusy || pickerOpen}
                  style={btnStyle}
                >
                  バトル開始
                </button>
              ) : (
                <p>対戦開始を待っています…</p>
              ))}
            <RoomDeckPicker
              open={pickerOpen}
              decks={
                selectedDeck &&
                !cloudDecks.some((deck) => deck.id === selectedDeck.id)
                  ? [selectedDeck, ...cloudDecks]
                  : cloudDecks
              }
              allCards={allCards}
              selectedDeck={selectedDeck}
              busy={deckBusy}
              error={deckChangeError}
              onClose={() => setPickerOpen(false)}
              onSelect={(deck) => {
                void chooseDeck(deck);
              }}
            />
          </>
        )}

        {error && (
          <div
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

        <div
          className="room-footer"
          style={{ textAlign: "center", marginTop: "1.5em" }}
        >
          <button
            onClick={handleExit}
            className="ui-link"
            style={{
              background: "none",
              border: "none",
              color: "var(--lobby-muted)",
              cursor: "pointer",
              fontSize: "0.85em",
            }}
          >
            ホームに戻る
          </button>
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--lobby-primary)",
  color: "#fff",
  fontWeight: "bold",
  fontSize: "1.1em",
  border: "1px solid var(--lobby-border)",
  borderRadius: 6,
  padding: "0.7em",
  cursor: "pointer",
};

const btnSmallStyle: React.CSSProperties = {
  background: "var(--lobby-surface)",
  color: "var(--lobby-text)",
  fontSize: "0.9em",
  border: "1px solid var(--lobby-border)",
  borderRadius: 6,
  padding: "0.5em 1em",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  fontSize: "1em",
  padding: "0.5em",
  borderRadius: 6,
  border: "1px solid var(--lobby-border)",
  background: "var(--lobby-surface)",
  color: "#fff",
  boxSizing: "border-box",
};
