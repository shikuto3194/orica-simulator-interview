import {
  readPendingMutation,
  writePendingMutation,
  type PendingRoomMutation,
} from "../roomMutationJournal";
import { boundedJsonRequest, retryDelayMs } from "../networkRequest";
import { apiUrl } from "../apiUrl";
import {
  isRoomVersion,
  isRoomMutationAcknowledgement,
  isSequentialRoomPatch,
} from "../../shared/room-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState, DraftCoreMove, PreGameState } from "@orica/rules-core";
import { applyPatch, type Operation } from "fast-json-patch";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import {
  AuthSessionUnavailableError,
  fetchWithAuthRetry,
  boundedAuthToken,
} from "../authFetch";

export interface SyncError {
  type: "push_failed" | "poll_failed" | "network" | "recovering";
  retryCount: number;
  lastError: string;
}

export type SSEStatus = "disconnected" | "connecting" | "connected" | "stale";

export interface RoomSSEStateUpdateEnvelope {
  version?: unknown;
}

export function shouldApplyRoomSSEStateUpdate(
  data: RoomSSEStateUpdateEnvelope,
  currentVersion: number
): boolean {
  return shouldAcceptRoomSyncVersion(data.version, currentVersion, false);
}

export function shouldAcceptRoomSyncVersion(
  incomingVersion: unknown,
  currentVersion: number,
  allowEqual = true
): incomingVersion is number {
  return (
    isRoomVersion(incomingVersion) &&
    (allowEqual
      ? incomingVersion >= currentVersion
      : incomingVersion > currentVersion)
  );
}

export function isRoomSSEAudienceAccepted(
  expectMember: boolean,
  isSpectator: unknown
): boolean {
  return isSpectator === !expectMember;
}

export function shouldRecoverRoomSSESnapshot(
  targetVersion: unknown,
  currentVersion: number
): targetVersion is number {
  return isRoomVersion(targetVersion) && targetVersion > currentVersion;
}

const SSE_RECONNECT_BASE_DELAY_MS = 250;
const SSE_RECONNECT_MAX_DELAY_MS = 3_000;
const SSE_STALE_AFTER_MS = 10_000;
const SSE_WATCHDOG_INTERVAL_MS = 2_000;
const SSE_RECOVERY_MAX_ATTEMPTS = 3;
const SSE_RECOVERY_BASE_DELAY_MS = 100;
const SSE_CONNECTED_SNAPSHOT_GRACE_MS = 250;

export interface RoomDispatchResult {
  ok: boolean;
  version?: number;
  state?: GameState;
  error?: string;
  pending?: boolean;
  stateRecoveryAttempted?: boolean;
}

/**
 * ルームベースの GUI ↔ API 状態同期フック。
 * roomId が null の場合はレガシー（/api/game/*）にフォールバック。
 *
 * 楽観的ロック対応:
 * - room操作はversion付きで送信し、競合時は最新stateへ戻す。
 * - pregameのactor別mergeだけは競合後に再送できる。
 *
 * エラーハンドリング:
 * - syncError: 最新の同期エラー状態（UI 表示用）
 * - clearError: エラー状態をクリア
 * - 連続失敗はbackoffし、オンライン復帰時も自動再同期する
 */
export function useRoomSync(
  roomId: string | null,
  getAccessToken?: () => Promise<string | null>,
  /**
   * このクライアントが対戦参加者 (プレイヤー) なら true、観戦者なら false。
   * public_link ルームでは getViewerPlayerId の認証が一過性失敗すると、メンバーにも
   * 観戦者 sanitize 済み state (全カード definitionId="_hidden_card_") が 200 で返る。
   * プレイヤーがそれで良い state を上書きしないよう、fetchLatestState で弾く。
   * 観戦者 (false) は isSpectator:true が正常なので素通しする。
   */
  expectMember = true,
  initialVersion = 0,
  initialState: GameState | null = null,
  refreshAccessToken?: () => Promise<string | null>,
  accountId?: string | null,
  viewerPlayerId?: string
) {
  const lastKnownVersion = useRef(initialVersion);
  /** push 成功時の version を記録（SSE echo 判定用） */
  const lastPushedVersionRef = useRef(0);
  /** Delta sync: クライアント側の最新 state 参照（パッチ適用のベース） */
  const lastKnownState = useRef<GameState | null>(initialState);
  const lastKnownStateVersion = useRef(initialVersion);
  const mutationSequenceRef = useRef(0);
  const base = roomId ? apiUrl(`/api/room/${roomId}`) : "/api/game";
  const consecutivePollFailures = useRef(0);
  const nextPollAt = useRef(0);
  const fullFlight = useRef<Promise<GameState | null> | null>(null);
  const fullMinimumVersion = useRef(0);
  const pollFlight = useRef<Promise<GameState | null> | null>(null);
  const heartbeatFlight = useRef<Promise<Response> | null>(null);
  // The original ID/version is retained after an uncertain response; dependent input is blocked.
  const journalKey =
    roomId && accountId ? `orica-room-pending-v1:${accountId}:${roomId}` : null;
  const pendingMutation = useRef<PendingRoomMutation | null>(
    readPendingMutation(journalKey)
  );
  const mutationFlight = useRef(false);
  const generation = useRef(0);
  const requestControllers = useRef(new Set<AbortController>());
  const scopeKey = JSON.stringify([
    base,
    accountId,
    expectMember,
    viewerPlayerId,
  ]);
  const scope = useRef({ key: scopeKey });
  if (scope.current.key !== scopeKey) {
    scope.current = { key: scopeKey };
    generation.current++;
    for (const controller of requestControllers.current) controller.abort();
    pendingMutation.current = readPendingMutation(journalKey);
    lastKnownState.current = null;
    lastKnownStateVersion.current = 0;
    lastKnownVersion.current = 0;
    mutationFlight.current = false;
    fullFlight.current = null;
    pollFlight.current = null;
    heartbeatFlight.current = null;
    lastPushedVersionRef.current = 0;
  }
  // Object identity also rejects callbacks from A after switching A → B → A.
  const requestScope = scope.current;
  const getConfirmedState = useCallback(
    () => (scope.current === requestScope ? lastKnownState.current : null),
    [requestScope]
  );
  const rememberPending = useCallback(
    (pending: PendingRoomMutation | null) => {
      pendingMutation.current = pending;
      writePendingMutation(journalKey, pending);
    },
    [journalKey]
  );
  const [syncError, setSyncError] = useState<SyncError | null>(
    pendingMutation.current
      ? {
          type: "recovering",
          retryCount: 0,
          lastError: "前の操作の適用結果を確認します。",
        }
      : null
  );

  useEffect(
    () => () => {
      generation.current++;
      for (const controller of requestControllers.current) controller.abort();
    },
    []
  );

  const clearError = useCallback(() => setSyncError(null), []);

  const acceptAuthoritativeState = useCallback(
    (
      version: unknown,
      nextState: GameState,
      options?: { markPushed?: boolean; allowEqual?: boolean }
    ): boolean => {
      if (
        scope.current !== requestScope ||
        !shouldAcceptRoomSyncVersion(
          version,
          lastKnownVersion.current,
          options?.allowEqual ?? true
        )
      ) {
        return false;
      }
      lastKnownVersion.current = version;
      lastKnownState.current = nextState;
      lastKnownStateVersion.current = version;
      if (options?.markPushed) {
        lastPushedVersionRef.current = Math.max(
          lastPushedVersionRef.current,
          version
        );
      }
      return true;
    },
    [requestScope]
  );

  useEffect(() => {
    if (!roomId) return;
    if (
      initialState &&
      (!lastKnownState.current || initialVersion > lastKnownVersion.current)
    ) {
      acceptAuthoritativeState(initialVersion, initialState);
    }
    consecutivePollFailures.current = 0;
  }, [roomId, initialVersion, initialState, acceptAuthoritativeState]);

  const nextClientMutationId = useCallback(
    (kind: string): string => {
      mutationSequenceRef.current += 1;
      const suffix =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      return `${roomId ?? "solo"}:${kind}:${mutationSequenceRef.current}:${suffix}`;
    },
    [roomId]
  );

  const recordRoomDispatchSuccess = useCallback(
    (payload: unknown): RoomDispatchResult => {
      const data = (payload ?? {}) as {
        version?: unknown;
        baseVersion?: unknown;
        state?: unknown;
        patch?: unknown;
      };
      const result: RoomDispatchResult = { ok: true };
      if (typeof data.version === "number") result.version = data.version;
      if (
        typeof data.version === "number" &&
        data.version < lastKnownVersion.current
      ) {
        result.version = lastKnownVersion.current;
        if (lastKnownState.current) result.state = lastKnownState.current;
        setSyncError(null);
        return result;
      }
      if (
        typeof data.version === "number" &&
        data.version === lastKnownStateVersion.current &&
        lastKnownState.current
      ) {
        result.state = lastKnownState.current;
        setSyncError(null);
        return result;
      }
      const previousState = lastKnownState.current;
      const previousStateVersion = lastKnownStateVersion.current;
      const patchBaseVersion =
        typeof data.baseVersion === "number" ? data.baseVersion : null;
      let resolvedState: GameState | null = null;
      if (data.state && typeof data.state === "object") {
        resolvedState = data.state as GameState;
      } else if (
        Array.isArray(data.patch) &&
        previousState &&
        isSequentialRoomPatch(
          data.version,
          patchBaseVersion,
          previousStateVersion
        )
      ) {
        try {
          resolvedState = applyPatch(
            structuredClone(previousState),
            data.patch as Operation[],
            true,
            false
          ).newDocument as GameState;
        } catch {
          resolvedState = null;
        }
      }
      if (
        resolvedState &&
        acceptAuthoritativeState(data.version, resolvedState, {
          markPushed: true,
        })
      ) {
        result.state = resolvedState;
        result.version = data.version as number;
      }
      setSyncError(null);
      return result;
    },
    [acceptAuthoritativeState]
  );

  /** Authorization ヘッダー付きの headers を生成 */
  const buildHeaders = useCallback(async (): Promise<
    Record<string, string>
  > => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (getAccessToken) {
      const token = await boundedAuthToken(getAccessToken);
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }, [getAccessToken]);

  // ロビーと同じ認証復旧を対戦中の取得・操作・SSEにも適用する。
  const request = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (roomId && expectMember && getAccessToken && refreshAccessToken) {
        return fetchWithAuthRetry(
          input,
          {
            ...init,
            headers: {
              "Content-Type": "application/json",
              ...Object.fromEntries(new Headers(init?.headers)),
            },
          },
          { getAccessToken, refreshAccessToken }
        );
      }
      const headers = new Headers(await buildHeaders());
      new Headers(init?.headers).forEach((value, key) =>
        headers.set(key, value)
      );
      return fetch(input, { ...init, headers });
    },
    [roomId, expectMember, getAccessToken, refreshAccessToken, buildHeaders]
  );

  const jsonRequest = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (scope.current !== requestScope) throw new Error("Room changed");
      const controller = new AbortController();
      requestControllers.current.add(controller);
      const abort = () => controller.abort();
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
      try {
        return await boundedJsonRequest(request, input, {
          ...init,
          signal: controller.signal,
        });
      } finally {
        requestControllers.current.delete(controller);
        init?.signal?.removeEventListener("abort", abort);
      }
    },
    [request, requestScope]
  );
  const heartbeat = useCallback(
    (userId: string): Promise<Response> => {
      if (heartbeatFlight.current)
        return heartbeatFlight.current.then((response) => response.clone());
      const work = jsonRequest(`${base}/heartbeat`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      heartbeatFlight.current = work;
      void work
        .finally(() => {
          if (heartbeatFlight.current === work) heartbeatFlight.current = null;
        })
        .catch(() => {});
      return work.then((response) => response.clone());
    },
    [base, jsonRequest]
  );

  /** 最新 state を再取得して lastKnownVersion を更新 */
  const fetchLatestState = useCallback(
    (minimumVersion = 0): Promise<GameState | null> => {
      if (scope.current !== requestScope) return Promise.resolve(null);
      if (fullFlight.current) {
        fullMinimumVersion.current = Math.max(
          fullMinimumVersion.current,
          minimumVersion
        );
        return fullFlight.current;
      }
      fullMinimumVersion.current = minimumVersion;
      const requestGeneration = generation.current;
      const work = (async (): Promise<GameState | null> => {
        if (!import.meta.env.DEV && !roomId) return null;
        try {
          const fullRes = await jsonRequest(`${base}/state/full`);
          if (!fullRes.ok) return null;
          const fullData = await fullRes.json();
          if (generation.current !== requestGeneration) return null;
          // public_link ルームで認証が一過性失敗するとメンバーにも観戦者 sanitize 済み
          // state が 200 で返る。プレイヤーは良い state を上書きせず、次回 poll/SSE で
          // 正しい member view を取り直す (version は進めない)。
          if (expectMember && fullData.isSpectator === true) return null;
          if (!expectMember && fullData.isSpectator === false) return null;
          if (
            expectMember &&
            viewerPlayerId &&
            fullData.viewerPlayerId !== undefined &&
            fullData.viewerPlayerId !== viewerPlayerId
          )
            return null;
          if (
            !isRoomVersion(fullData.version) ||
            fullData.version < fullMinimumVersion.current
          ) {
            return lastKnownStateVersion.current >= fullMinimumVersion.current
              ? lastKnownState.current
              : null;
          }
          if (
            !fullData.state ||
            typeof fullData.state !== "object" ||
            Array.isArray(fullData.state)
          )
            return null;
          const fullState = fullData.state as GameState;
          if (!acceptAuthoritativeState(fullData.version, fullState)) {
            return lastKnownState.current;
          }
          return fullState;
        } catch {
          return null;
        }
      })();
      fullFlight.current = work;
      void work.finally(() => {
        if (fullFlight.current === work) fullFlight.current = null;
      });
      return work;
    },
    [
      acceptAuthoritativeState,
      base,
      jsonRequest,
      expectMember,
      roomId,
      requestScope,
      viewerPlayerId,
    ]
  );

  const completeRoomDispatchSuccess = useCallback(
    async (payload: unknown): Promise<RoomDispatchResult> => {
      const result = recordRoomDispatchSuccess(payload);
      if (result.version !== undefined && !result.state) {
        const recovered = await fetchLatestState(result.version);
        if (recovered) result.state = recovered;
      }
      if (
        roomId &&
        result.version !== undefined &&
        (!result.state || lastKnownStateVersion.current < result.version)
      )
        throw new Error(
          "操作は受け付けられました。最新の盤面を確認しています。"
        );
      return result;
    },
    [fetchLatestState, recordRoomDispatchSuccess, roomId]
  );

  const soloPushQueue = useRef<Promise<void>>(Promise.resolve());
  const latestSoloState = useRef<GameState | null>(null);
  const pushState = useCallback(
    (state: GameState): Promise<void> => {
      // Solo games and imported bug reports run locally in the public build.
      // The legacy /api/game bridge exists only for development GUI/REST tests.
      if (!import.meta.env.DEV && !roomId) return Promise.resolve();
      latestSoloState.current = state;
      // フルstate保存を呼出順に確定させ、古い保存による上書きを防ぐ。
      const save = async () => {
        try {
          const res = await jsonRequest(`${base}/state`, {
            method: "PUT",
            body: JSON.stringify({ state }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            setSyncError({
              type: "push_failed",
              retryCount: 1,
              lastError: `PUT ${base}/state: HTTP ${res.status}${body.error ? ` — ${body.error}` : ""}`,
            });
            return;
          }
          const data = await res.json();
          acceptAuthoritativeState(data.version, state, { markPushed: true });
          setSyncError(null);
        } catch (error) {
          setSyncError({
            type: "network",
            retryCount: 1,
            lastError: error instanceof Error ? error.message : "Network error",
          });
        }
      };
      const saved = soloPushQueue.current.then(save, save);
      soloPushQueue.current = saved;
      return saved;
    },
    [acceptAuthoritativeState, base, jsonRequest, roomId]
  );

  /** 全room操作の再送・競合処理を共有する。再送時もmutation IDを変えない。 */
  const dispatchRoomMutation = useCallback(
    async (
      path:
        | "action"
        | "step"
        | "claim-victory"
        | "core-move"
        | "brave-separation"
        | "pregame-update"
        | "rematch"
        | "reset-request"
        | "reset-response",
      payload: Record<string, unknown> = {},
      recovering = false
    ): Promise<RoomDispatchResult> => {
      if (!roomId || scope.current !== requestScope)
        return { ok: false, error: "Not in room" };
      if (mutationFlight.current || (pendingMutation.current && !recovering)) {
        return {
          ok: false,
          pending: true,
          error: "前の操作の適用結果を確認中です。",
        };
      }
      const pending: PendingRoomMutation = pendingMutation.current ?? {
        path,
        payload: structuredClone(payload),
        id: nextClientMutationId(path),
        version: lastKnownVersion.current,
        retryAt: 0,
      };
      if (Date.now() < pending.retryAt) return { ok: false, pending: true };
      rememberPending(pending);
      mutationFlight.current = true;
      const maxRetries = 3;
      const clientMutationId = pending.id;
      let requestExpectedVersion = pending.version;
      const requestGeneration = generation.current;
      const budgetEnd = Date.now() + 25_000;
      try {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            if (generation.current !== requestGeneration)
              return { ok: false, error: "Room changed" };
            const res = await jsonRequest(`${base}/${pending.path}`, {
              method: "POST",
              body: JSON.stringify({
                ...pending.payload,
                clientMutationId,
                expectedVersion: requestExpectedVersion,
              }),
            });
            if (generation.current !== requestGeneration)
              return { ok: false, error: "Room changed" };
            if (res.ok) {
              const acknowledgement = await res.json();
              if (generation.current !== requestGeneration)
                return { ok: false, error: "Room changed" };
              if (
                !isRoomMutationAcknowledgement(
                  acknowledgement,
                  clientMutationId
                )
              )
                throw new Error("操作の応答を確認できませんでした。");
              const result = await completeRoomDispatchSuccess(acknowledgement);
              if (generation.current !== requestGeneration)
                return { ok: false, error: "Room changed" };
              rememberPending(null);
              return result;
            }
            if (res.status === 409 && !pending.uncertain) {
              rememberPending(null);
              const recovered = await fetchLatestState();
              if (generation.current !== requestGeneration)
                return { ok: false, error: "Room changed" };
              // pregameだけはactor別の冪等mergeなので新versionで再評価できる。
              if (
                path === "pregame-update" &&
                recovered &&
                attempt < maxRetries
              ) {
                requestExpectedVersion = lastKnownVersion.current;
                pending.version = requestExpectedVersion;
                rememberPending(pending);
                continue;
              }
              // action / step / core-move / brave-separation は非冪等。
              // 最新versionで勝手に実行し直さず、権威stateへ戻して再操作を待つ。
              if (recovered) setSyncError(null);
              else
                setSyncError({
                  type: "push_failed",
                  retryCount: attempt + 1,
                  lastError: `POST ${base}/${path}: HTTP 409 Conflict（最新状態の取得に失敗）`,
                });
              return {
                ok: false,
                error: "Conflict",
                stateRecoveryAttempted: true,
                ...(recovered ? { state: recovered } : {}),
              };
            }
            const transient = [408, 429, 500, 502, 503, 504].includes(
              res.status
            );
            if (transient && res.status !== 429) pending.uncertain = true;
            if (transient) {
              const delay = retryDelayMs(
                res.headers.get("Retry-After"),
                attempt
              );
              pending.retryAt = Date.now() + delay;
              if (
                attempt < maxRetries &&
                delay <= 10_000 &&
                pending.retryAt + 8_000 <= budgetEnd
              ) {
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
              }
            }
            const errBody = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            if (generation.current !== requestGeneration)
              return { ok: false, error: "Room changed" };
            const error = `POST ${base}/${path}: HTTP ${res.status}${errBody.error ? ` — ${errBody.error}` : ""}`;
            const unresolved = transient || pending.uncertain === true;
            if (!unresolved) rememberPending(null);
            else
              pending.retryAt = Math.max(pending.retryAt, Date.now() + 1_000);
            setSyncError({
              type: unresolved ? "recovering" : "push_failed",
              retryCount: attempt + 1,
              lastError:
                error +
                (res.headers.get("X-Request-ID")
                  ? ` [${res.headers.get("X-Request-ID")}]`
                  : ""),
            });
            return {
              ok: false,
              error,
              ...(unresolved ? { pending: true } : {}),
            };
          } catch (error) {
            if (!(error instanceof AuthSessionUnavailableError))
              pending.uncertain = true;
            if (generation.current !== requestGeneration)
              return { ok: false, error: "Room changed" };
            if (
              !(error instanceof AuthSessionUnavailableError) &&
              attempt < maxRetries &&
              Date.now() + 8_000 < budgetEnd
            ) {
              await new Promise((resolve) =>
                setTimeout(resolve, retryDelayMs(null, attempt))
              );
              continue;
            }
            const message =
              error instanceof Error ? error.message : "Network error";
            setSyncError({
              type:
                error instanceof AuthSessionUnavailableError
                  ? "push_failed"
                  : "recovering",
              retryCount: attempt + 1,
              lastError: `POST ${base}/${path}: ${message}`,
            });
            pending.retryAt = Date.now() + retryDelayMs(null, 4);
            return { ok: false, pending: true, error: message };
          }
        }
        return { ok: false, pending: true, error: "Max retries exhausted" };
      } finally {
        if (generation.current === requestGeneration) {
          mutationFlight.current = false;
          writePendingMutation(journalKey, pendingMutation.current);
        }
      }
    },
    [
      base,
      jsonRequest,
      fetchLatestState,
      nextClientMutationId,
      completeRoomDispatchSuccess,
      roomId,
      rememberPending,
      journalKey,
      requestScope,
    ]
  );

  const recoverPendingMutation =
    useCallback(async (): Promise<GameState | null> => {
      const pending = pendingMutation.current;
      if (!pending || mutationFlight.current || Date.now() < pending.retryAt)
        return null;
      if (!pending.uncertain) {
        const result = await dispatchRoomMutation(
          pending.path as Parameters<typeof dispatchRoomMutation>[0],
          pending.payload,
          true
        );
        return result.state ?? null;
      }
      const requestGeneration = generation.current;
      mutationFlight.current = true;
      try {
        const response = await jsonRequest(`${base}/mutation-settle`, {
          method: "POST",
          body: JSON.stringify({
            clientMutationId: pending.id,
            path: pending.path,
            payload: pending.payload,
          }),
        });
        if (!response.ok) {
          pending.retryAt =
            Date.now() + retryDelayMs(response.headers.get("Retry-After"), 4);
          throw new Error(`HTTP ${response.status}`);
        }
        const result = await response.json();
        if (
          result.clientMutationId !== pending.id ||
          !["applied", "cancelled"].includes(result.outcome) ||
          !Number.isSafeInteger(result.roomVersion) ||
          result.roomVersion < 0 ||
          (result.outcome === "applied" &&
            (!Number.isSafeInteger(result.appliedVersion) ||
              result.appliedVersion < 0 ||
              result.appliedVersion > result.roomVersion))
        )
          throw new Error("操作結果を確認できませんでした。");
        if (generation.current !== requestGeneration) return null;
        // Refresh the board before releasing the input guard, including after a known cancellation.
        let state = await fetchLatestState(result.roomVersion);
        if (generation.current !== requestGeneration) return null;
        if (lastKnownVersion.current < result.roomVersion)
          state = await fetchLatestState(result.roomVersion);
        if (generation.current !== requestGeneration) return null;
        if (!state || lastKnownVersion.current < result.roomVersion)
          throw new Error("最新状態を取得しています。");
        rememberPending(null);
        setSyncError(
          result.outcome === "applied"
            ? null
            : {
                type: "push_failed",
                retryCount: 0,
                lastError:
                  "操作は適用されていません。最新の盤面からもう一度操作してください。",
              }
        );
        return state;
      } catch (error) {
        if (generation.current === requestGeneration) {
          pending.retryAt = Math.max(
            pending.retryAt,
            Date.now() + retryDelayMs(null, 4)
          );
          rememberPending(pending);
          setSyncError({
            type: "recovering",
            retryCount: 1,
            lastError:
              error instanceof Error
                ? error.message
                : "操作結果を確認しています。",
          });
        }
        return null;
      } finally {
        if (generation.current === requestGeneration)
          mutationFlight.current = false;
      }
    }, [
      base,
      dispatchRoomMutation,
      fetchLatestState,
      jsonRequest,
      rememberPending,
    ]);

  const dispatchAction = useCallback(
    (actionId: string, payload?: Record<string, unknown>) =>
      dispatchRoomMutation("action", { ...payload, actionId }),
    [dispatchRoomMutation]
  );
  const dispatchStep = useCallback(
    () => dispatchRoomMutation("step"),
    [dispatchRoomMutation]
  );
  const dispatchSpecial = dispatchRoomMutation;

  // Use the latest received version, including opponent updates and reconnection.
  const dispatchRematch = useCallback(
    () => dispatchSpecial("rematch"),
    [dispatchSpecial]
  );

  const dispatchReset = useCallback(
    (approve?: boolean) =>
      approve === undefined
        ? dispatchSpecial("reset-request")
        : dispatchSpecial("reset-response", { approve }),
    [dispatchSpecial]
  );

  /** Phase B-5: 切断タイムアウト勝利宣言。state.gameResult を直接埋める。 */
  const dispatchClaimVictory = useCallback(
    (
      reason: string = "opponent_disconnect_timeout"
    ): Promise<RoomDispatchResult> =>
      dispatchSpecial("claim-victory", { reason }),
    [dispatchSpecial]
  );

  /** Phase B-5: メインステップのコア移動。drafts は applyDraftCoreMoves 経由で server 反映。 */
  const dispatchCoreMove = useCallback(
    (drafts: ReadonlyArray<DraftCoreMove>): Promise<RoomDispatchResult> =>
      dispatchSpecial("core-move", { coreMoveDrafts: drafts }),
    [dispatchSpecial]
  );

  /** Phase B-5: brave_separate LegalAction + moveSoulCore の合成。 */
  const dispatchBraveSeparation = useCallback(
    (input: {
      actionId: string;
      separateCoreDistribution: Record<string, number>;
      separationSoulCoreSource?: string;
      braveInstanceId?: string;
    }): Promise<RoomDispatchResult> =>
      dispatchSpecial("brave-separation", input),
    [dispatchSpecial]
  );

  /**
   * Phase B-5: preGame (janken / pick_first / mulligan) の部分更新。
   * jankenHands / mulliganDone は server-side で field-merge される。
   * マリガンは yes/no だけを送り、shuffle/draw は server-side で実行する。
   */
  const dispatchPregameUpdate = useCallback(
    (input: { preGame: Partial<PreGameState> }): Promise<RoomDispatchResult> =>
      dispatchSpecial("pregame-update", input),
    [dispatchSpecial]
  );

  const pollForChanges = useCallback((): Promise<GameState | null> => {
    if (scope.current !== requestScope) return Promise.resolve(null);
    const requestGeneration = generation.current;
    if (pollFlight.current) return pollFlight.current;
    const work = (async (): Promise<GameState | null> => {
      if (!import.meta.env.DEV && !roomId) return null;
      if (Date.now() < nextPollAt.current) return null;
      if (pendingMutation.current) return recoverPendingMutation();
      try {
        const res = await jsonRequest(`${base}/state/version`);
        if (generation.current !== requestGeneration) return null;
        if (!res.ok) {
          consecutivePollFailures.current++;
          nextPollAt.current =
            Date.now() +
            retryDelayMs(
              res.headers.get("Retry-After"),
              consecutivePollFailures.current
            );
          if (consecutivePollFailures.current >= 3) {
            setSyncError({
              type: "poll_failed",
              retryCount: consecutivePollFailures.current,
              lastError: `HTTP ${res.status}`,
            });
          }
          return null;
        }
        const data = await res.json();
        if (generation.current !== requestGeneration) return null;
        consecutivePollFailures.current = 0;
        nextPollAt.current = 0;
        if (syncError?.type === "poll_failed") setSyncError(null);

        if (
          isRoomVersion(data.version) &&
          (data.version > lastKnownVersion.current || !lastKnownState.current)
        ) {
          return await fetchLatestState(data.version);
        }
        // Receiving a snapshot is separate from rendering it: an SSE status
        // change may retire the UI polling effect after this hook accepts it.
        // Keep the accepted snapshot deliverable until the consumer has it.
        if (data.version === lastKnownVersion.current) {
          return lastKnownState.current;
        }
      } catch (e: unknown) {
        if (generation.current !== requestGeneration) return null;
        consecutivePollFailures.current++;
        nextPollAt.current =
          Date.now() + retryDelayMs(null, consecutivePollFailures.current);
        if (consecutivePollFailures.current >= 3) {
          setSyncError({
            type: "poll_failed",
            retryCount: consecutivePollFailures.current,
            lastError: e instanceof Error ? e.message : "Network error",
          });
        }
      }
      return null;
    })();
    pollFlight.current = work;
    void work.finally(() => {
      if (pollFlight.current === work) pollFlight.current = null;
    });
    return work;
  }, [
    base,
    jsonRequest,
    fetchLatestState,
    syncError,
    roomId,
    recoverPendingMutation,
    requestScope,
  ]);

  /** 再接続は表示を消すだけでなく、同versionでも実際に再同期する。 */
  const resetPolling = useCallback(async (): Promise<GameState | null> => {
    consecutivePollFailures.current = 0;
    nextPollAt.current = 0;
    if (pendingMutation.current) return recoverPendingMutation();
    if (!roomId) {
      if (latestSoloState.current) await pushState(latestSoloState.current);
      return null;
    }
    const state = await fetchLatestState();
    if (state) setSyncError(null);
    else
      setSyncError({
        type: "poll_failed",
        retryCount: 1,
        lastError: "最新の対戦状態を取得できませんでした。",
      });
    return state;
  }, [roomId, fetchLatestState, pushState, recoverPendingMutation]);

  // --- SSE (Server-Sent Events via fetch-event-source) ---
  // EventSource 標準 API は Authorization ヘッダー付与不可のため、
  // @microsoft/fetch-event-source で fetch ベースに移行している。
  const [sseStatus, setSSEStatus] = useState<SSEStatus>("disconnected");
  const lastSSEMessageAtRef = useRef(0);
  const onSSEStateUpdateRef = useRef<
    ((state: GameState, version: number) => void) | null
  >(null);

  /** SSE state_update イベントを受信したときのコールバックを登録 */
  const setOnSSEStateUpdate = useCallback(
    (callback: ((state: GameState, version: number) => void) | null) => {
      onSSEStateUpdateRef.current = callback;
    },
    []
  );

  // SSE 接続: roomId がある場合のみ
  useEffect(() => {
    if (!roomId) return;

    let cancelled = false;
    let activeCtrl: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let connectedSnapshotTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let retryNotBefore = 0;
    let audienceAccepted = false;

    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const clearConnectedSnapshotTimer = () => {
      if (connectedSnapshotTimer) {
        clearTimeout(connectedSnapshotTimer);
        connectedSnapshotTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;
      const delay = Math.max(
        retryNotBefore - Date.now(),
        Math.min(
          SSE_RECONNECT_MAX_DELAY_MS,
          SSE_RECONNECT_BASE_DELAY_MS * 2 ** Math.min(reconnectAttempt, 6)
        ) *
          (0.75 + Math.random() * 0.5)
      );
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const markSSEActivity = () => {
      if (cancelled) return;
      lastSSEMessageAtRef.current = Date.now();
      reconnectAttempt = 0;
      if (!cancelled) setSSEStatus("connected");
    };

    const rejectSSEConnection = () => {
      clearConnectedSnapshotTimer();
      audienceAccepted = false;
      if (!cancelled) setSSEStatus("stale");
      activeCtrl?.abort();
    };

    const recoverSSEState = async (
      targetVersion: number
    ): Promise<GameState | null> => {
      if (lastKnownVersion.current >= targetVersion && lastKnownState.current) {
        return lastKnownState.current;
      }
      if (!cancelled) setSSEStatus("stale");
      for (let attempt = 0; attempt < SSE_RECOVERY_MAX_ATTEMPTS; attempt++) {
        if (cancelled) return null;
        if (attempt > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, SSE_RECOVERY_BASE_DELAY_MS * 2 ** (attempt - 1))
          );
        }
        if (cancelled) return null;
        const recovered = await fetchLatestState(targetVersion);
        if (cancelled) return null;
        if (
          recovered &&
          lastKnownVersion.current >= targetVersion &&
          lastKnownState.current
        ) {
          markSSEActivity();
          return lastKnownState.current;
        }
      }
      rejectSSEConnection();
      return null;
    };

    const handleMessage = async (event: { event?: string; data: string }) => {
      if (cancelled || scope.current !== requestScope) return;
      const eventName = event.event || "message";
      if (eventName === "reconnect") {
        rejectSSEConnection();
        return;
      }
      if (eventName === "ping") {
        if (!audienceAccepted) return;
        markSSEActivity();
        return;
      }
      if (eventName === "connected") {
        try {
          const data = JSON.parse(event.data);
          if (!isRoomSSEAudienceAccepted(expectMember, data.isSpectator)) {
            rejectSSEConnection();
            return;
          }
          audienceAccepted = true;
          markSSEActivity();
          clearConnectedSnapshotTimer();
          if (
            shouldRecoverRoomSSESnapshot(
              data.version,
              lastKnownVersion.current
            ) ||
            (!lastKnownState.current && isRoomVersion(data.version))
          ) {
            const targetVersion = data.version;
            connectedSnapshotTimer = setTimeout(() => {
              connectedSnapshotTimer = null;
              void (async () => {
                if (
                  cancelled ||
                  scope.current !== requestScope ||
                  (lastKnownState.current &&
                    !shouldRecoverRoomSSESnapshot(
                      targetVersion,
                      lastKnownVersion.current
                    ))
                ) {
                  return;
                }
                const newState = await recoverSSEState(targetVersion);
                if (!cancelled && newState && onSSEStateUpdateRef.current) {
                  onSSEStateUpdateRef.current(
                    newState,
                    lastKnownVersion.current
                  );
                }
              })();
            }, SSE_CONNECTED_SNAPSHOT_GRACE_MS);
          }
        } catch {
          rejectSSEConnection();
        }
        return;
      }
      if (eventName === "state_update") {
        if (!audienceAccepted) {
          rejectSSEConnection();
          return;
        }
        markSSEActivity();
        try {
          const data = JSON.parse(event.data);
          if (
            shouldApplyRoomSSEStateUpdate(data, lastKnownVersion.current) ||
            (!lastKnownState.current &&
              isRoomVersion(data.version) &&
              data.version === lastKnownVersion.current)
          ) {
            let newState: GameState | null = null;

            // 観戦者向け payload: patch ではなく sanitize 済み state が直接含まれる
            if (data.state && typeof data.state === "object") {
              const candidate = data.state as GameState;
              if (
                acceptAuthoritativeState(data.version, candidate, {
                  allowEqual: !lastKnownState.current,
                })
              ) {
                newState = candidate;
              }
            } else if (
              // Delta sync: SSE にパッチが含まれていれば適用を試みる
              Array.isArray(data.patch) &&
              lastKnownState.current &&
              isSequentialRoomPatch(
                data.version,
                data.baseVersion,
                lastKnownStateVersion.current
              )
            ) {
              try {
                const result = applyPatch(
                  structuredClone(lastKnownState.current),
                  data.patch as Operation[],
                  true, // validate
                  false // mutateDocument
                );
                const candidate = result.newDocument as GameState;
                if (
                  acceptAuthoritativeState(data.version, candidate, {
                    allowEqual: false,
                  })
                ) {
                  newState = candidate;
                }
              } catch {
                // パッチ適用失敗 → フルフェッチにフォールバック
                newState = null;
              }
            }

            // パッチ適用できなかった場合はフルフェッチ
            if (!newState) {
              newState = await recoverSSEState(data.version);
            }

            if (
              !cancelled &&
              scope.current === requestScope &&
              newState &&
              onSSEStateUpdateRef.current
            ) {
              onSSEStateUpdateRef.current(newState, lastKnownVersion.current);
            }
          }
        } catch {
          /* ignore */
        }
      }
    };

    const watchdog = setInterval(() => {
      if (cancelled) return;
      const ctrl = activeCtrl;
      if (!ctrl || ctrl.signal.aborted || lastSSEMessageAtRef.current === 0) {
        return;
      }
      if (Date.now() - lastSSEMessageAtRef.current <= SSE_STALE_AFTER_MS) {
        return;
      }
      setSSEStatus("stale");
      ctrl.abort();
    }, SSE_WATCHDOG_INTERVAL_MS);

    async function connect() {
      if (cancelled) return;
      clearReconnectTimer();
      clearConnectedSnapshotTimer();
      setSSEStatus("connecting");
      audienceAccepted = false;
      const ctrl = new AbortController();
      activeCtrl = ctrl;
      lastSSEMessageAtRef.current = Date.now();
      try {
        const headers = { Accept: "text/event-stream" };
        await fetchEventSource(apiUrl(`/api/room/${roomId}/events`), {
          method: "GET",
          fetch: request,
          headers,
          signal: ctrl.signal,
          openWhenHidden: true,
          onopen: async (response) => {
            if (!response.ok) {
              retryNotBefore =
                Date.now() +
                retryDelayMs(
                  response.headers.get("Retry-After"),
                  reconnectAttempt
                );
              throw new Error(`SSE open failed: ${response.status}`);
            }
          },
          onmessage: handleMessage,
          onerror: (err) => {
            if (!ctrl.signal.aborted) setSSEStatus("disconnected");
            throw err;
          },
        });
        if (!cancelled) {
          setSSEStatus("disconnected");
          scheduleReconnect();
        }
      } catch {
        if (!cancelled) {
          setSSEStatus("disconnected");
          scheduleReconnect();
        }
      } finally {
        if (activeCtrl === ctrl) activeCtrl = null;
      }
    }

    const wake = () => {
      if (document.hidden || cancelled) return;
      nextPollAt.current = 0;
      void resetPolling().then((state) => {
        if (!cancelled && state)
          onSSEStateUpdateRef.current?.(state, lastKnownVersion.current);
      });
      if (!activeCtrl) scheduleReconnect();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    void connect();

    return () => {
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      cancelled = true;
      clearReconnectTimer();
      clearConnectedSnapshotTimer();
      clearInterval(watchdog);
      activeCtrl?.abort();
      setSSEStatus("disconnected");
    };
  }, [
    roomId,
    acceptAuthoritativeState,
    buildHeaders,
    request,
    expectMember,
    fetchLatestState,
    resetPolling,
    requestScope,
  ]);

  return {
    getConfirmedState,
    roomStateVersion: lastKnownVersion,
    heartbeat,
    pushState,
    dispatchAction,
    dispatchStep,
    dispatchClaimVictory,
    dispatchCoreMove,
    dispatchBraveSeparation,
    dispatchPregameUpdate,
    dispatchRematch,
    dispatchReset,
    pollForChanges,
    syncError,
    clearError,
    resetPolling,
    sseStatus,
    setOnSSEStateUpdate,
    lastPushedVersion: lastPushedVersionRef,
    /** dispatch 後の reconcile 用: 権威 state を取り直す (server-authoritative 化)。 */
    fetchLatestState,
  };
}
