import {
  isStrictRoomMutationRequest as isRoomMutationRequest,
  parseRoomMutationId,
} from "../shared/room-protocol";
import { createApiAdmission } from "./api-limits";
import { boundedJsonRequest } from "../src/networkRequest";
/**
 * Game API — 本番 Node サーバーと Vite 開発サーバーで共有する REST API。
 *
 * レガシーエンドポイント（単一ゲーム / 後方互換）:
 *   POST   /api/game/start           ゲーム開始（デッキ指定可）
 *   GET    /api/game/state            現在の GameState
 *   GET    /api/game/actions/:player  プレイヤーの合法手一覧
 *   POST   /api/game/action           アクション実行
 *   POST   /api/game/step             ステップ送り
 *   POST   /api/game/reset            ゲームリセット
 *
 * ルームエンドポイント（対人対戦）:
 *   POST   /api/room                  ルーム作成 → { roomId }
 *   GET    /api/room                  本人の参加済み未決着ルーム一覧（接続更新なし）
 *   GET    /api/room/:id              ルーム情報取得
 *   POST   /api/room/:id/join         ルーム参加
 *   DELETE /api/room/:id              作成者による未決着ルーム削除
 *   POST   /api/room/:id/deck         デッキ登録
 *   DELETE /api/room/:id/deck         準備解除
 *   POST   /api/room/:id/start        ゲーム開始（両者デッキ登録済み時）
 *   GET    /api/room/:id/state/full   ゲーム state 取得
 *   PUT    /api/room/:id/state        state push（GUI → API）
 *   GET    /api/room/:id/state/version  polling 用
 */

import type { Connect, Plugin } from "vite";
import { applyBraveSeparationWithCores } from "../src/utils/brave-separation";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { handleRoomInvitations, joinRoomAtomically } from "./room-invitations";
import { startRoomPushDelivery } from "./room-push";
import { listUnfinishedRooms } from "./room-list";
import { parseCardNos } from "../src/input-validation";
import fastJsonPatch from "fast-json-patch";
import type { Operation } from "fast-json-patch";
import {
  cleanupExpiredRooms,
  startRoomCleanup,
  ROOM_DISCONNECT_TIMEOUT_MS,
} from "./room-retention";
const { compare: jsonPatchCompare } = fastJsonPatch;

// --- engine 型の動的 import（ESM ビルドと互換） ---
import type {
  GameState,
  CardDefinition,
  CardInstance,
  PlayerState,
  PendingLeaveEntity,
  LegalAction,
  AvailableOnBoardCorePaymentSource,
  GetLegalActionsOptions,
  MainDeckValidationIssue,
  PreGamePhase,
} from "../../../packages/rules-core/src/index";
import { mulliganHand as applyServerMulligan } from "../../../packages/rules-core/src/factories";

let engine: typeof import("../../../packages/rules-core/src/runtime");
let cardData: typeof import("../../../packages/card-data/src/generated-index");

async function ensureEngine() {
  if (!engine) {
    engine = await import("../../../packages/rules-core/src/runtime");
  }
  if (!cardData) {
    cardData = await import("../../../packages/card-data/src/generated-index");
  }
}

/** Initialise the shared server catalogue without connecting to room persistence. */
export async function initializeGameApiRuntime(): Promise<void> {
  await ensureEngine();
  if (allCardDefs.length === 0) {
    allCardDefs = cardData.ALL_CARDS as CardDefinition[];
    installCardLookups(allCardDefs);
  }
}

/** effectLookups の型: GetLegalActionsOptions から state/actingPlayerId/getCardDefinitionById を除外 */
type EffectLookupFields = Omit<
  GetLegalActionsOptions,
  "state" | "actingPlayerId" | "getCardDefinitionById"
>;

// --- server-side game state (legacy single-game) ---
let currentState: GameState | null = null;
let stateVersion = 0;
let allCardDefs: CardDefinition[] = [];
let defLookup: (id: string) => CardDefinition | undefined = () => undefined;
let effectLookups = {} as EffectLookupFields;

export async function __initializeGameApiLookupsForTest(
  definitions?: readonly CardDefinition[]
) {
  await ensureEngine();
  allCardDefs = [...(definitions ?? (cardData.ALL_CARDS as CardDefinition[]))];
  installCardLookups(allCardDefs);
}

// --- Supabase (server-side) ---
//
// rooms テーブルは RLS 有効、クライアント (anon key) からの直接アクセスを default deny。
// サーバ側ミドルウェアは service_role_key で RLS を bypass し、独自の JWT 検証 +
// requireRoomMember / authorizeRoomRead で参加者検証する設計。
//
// SUPABASE_SERVICE_ROLE_KEY が未設定だと anon key にフォールバックするが、
// その場合は RLS により rooms への INSERT/UPDATE/DELETE が拒否され、
// 大半の API が 500 を返すため、実サーバ起動時に warning ログを出して気付けるようにする。
const PRODUCTION_SUPABASE_URL = "https://nnthvbizvqpufpfkzlho.supabase.co";
const INTERVIEW_MODE = process.env.INTERVIEW_MODE === "true";
const interviewSupabaseUrl = process.env.SUPABASE_URL?.trim();
if (
  INTERVIEW_MODE &&
  (!interviewSupabaseUrl ||
    new URL(interviewSupabaseUrl).protocol !== "https:" ||
    new URL(interviewSupabaseUrl).origin !== interviewSupabaseUrl ||
    interviewSupabaseUrl === PRODUCTION_SUPABASE_URL)
) {
  throw new Error(
    "Interview API requires its own SUPABASE_URL and cannot use production."
  );
}
const supabaseUrl = INTERVIEW_MODE
  ? interviewSupabaseUrl!
  : PRODUCTION_SUPABASE_URL;
const SUPABASE_ANON_KEY = "sb_publishable_3v3fyKOO4Bib5aoa-rMwcQ_EOBMK_28";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (INTERVIEW_MODE && !supabaseServiceKey?.trim()) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is required by the interview API."
  );
}
if (!supabaseServiceKey) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required in production. " +
        "rooms テーブルは RLS 有効のため、anon key では INSERT/UPDATE/DELETE が拒否される。"
    );
  }
  // vitest が単体テストで game-api.ts を import しただけでもこの top-level は評価される。
  // vitest は apps/playground-web/.env を読まず rooms にも一切触れない (純関数のテストのみ)
  // ため、ここで「未設定」を出すと「ローカルの rooms API が壊れている」と誤読させる元になる
  // (実際は dev server が load-server-env 経由で .env から読み込み正常稼働する。2026-06-19 に
  // この警告を環境全体の事実と取り違えた)。テストコンテキストでは黙り、実サーバ起動時のみ、
  // 鍵の在り処を明示して警告する。
  if (!process.env.VITEST && process.env.ORICA_LOCAL_GAME_TESTS !== "1") {
    console.warn(
      "[game-api] SUPABASE_SERVICE_ROLE_KEY が未設定です。anon key にフォールバックしますが、" +
        "rooms テーブルの RLS により大半のルーム API が動作しません。" +
        "dev server は apps/playground-web/.env (load-server-env が process.env へ注入) から" +
        "読み込みます。Supabase Dashboard > Settings > API > service_role キーを同ファイルに" +
        "設定してください。"
    );
  }
}
const supabaseKey = supabaseServiceKey ?? SUPABASE_ANON_KEY;
const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  global: {
    fetch: (input, init) => boundedJsonRequest(fetch, input, init, 6_000),
  },
});
const interviewRequestClient = new AsyncLocalStorage<SupabaseClient>();
const INTERVIEW_SERVER_ONLY_TABLES = new Set([
  "rooms",
  "replay_events",
  "room_invitations",
  "room_mutation_cancellations",
  "room_network_contract",
  "room_push_subscriptions",
]);
const supabaseServer: SupabaseClient = INTERVIEW_MODE
  ? (new Proxy(supabaseAdmin, {
      get(target, property) {
        const client = interviewRequestClient.getStore() ?? target;
        if (client !== target && property === "from") {
          return (table: string) =>
            INTERVIEW_SERVER_ONLY_TABLES.has(table)
              ? target.from(table)
              : client.from(table);
        }
        // Simulator RPCs are server-only in the interview DB. The HTTP API
        // verifies JWT + active membership before reaching any application route.
        if (client !== target && property === "rpc") {
          return target.rpc.bind(target);
        }
        const value = Reflect.get(client, property, client);
        return typeof value === "function" ? value.bind(client) : value;
      },
    }) as SupabaseClient)
  : supabaseAdmin;

function createInterviewRequestClient(req: IncomingMessage): SupabaseClient {
  const token = extractBearerToken(req);
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      fetch: (input, init) => boundedJsonRequest(fetch, input, init, 6_000),
    },
  });
}

// --- room management (DB-backed) ---
interface RoomPlayer {
  supabaseUserId: string;
  role: "alice" | "bob";
  deckCardNos: string[] | null;
}

type SpectatorMode = "private" | "public_link";

interface RoomRow {
  id: string;
  players: RoomPlayer[];
  state: GameState | null;
  state_version: number;
  scenario_id: string | null;
  connected: Record<string, boolean>;
  all_disconnected_at: string | null;
  last_heartbeat: Record<string, string>;
  /** 観戦許可モード。マイグレーション 003 適用前の既存行は undefined → 'private' 扱い。 */
  spectator_mode?: SpectatorMode;
  created_at: string;
}

type RoomMetaRow = Pick<
  RoomRow,
  | "id"
  | "players"
  | "state_version"
  | "scenario_id"
  | "connected"
  | "last_heartbeat"
  | "spectator_mode"
>;

/**
 * GET 系エンドポイント共通のアクセス認可。
 * - public_link: 認証不要
 * - private (default / undefined): JWT 必須 + 参加者のみ
 *
 * 戻り値が null なら通過、文字列を含むオブジェクトならエラー応答に使う。
 * 第二戻り値の isMember は public_link 時に観戦者かどうかを判定するために使う
 * （sanitize 適用判定）。
 */
export async function authorizeRoomRead(
  req: IncomingMessage,
  room: { spectator_mode?: SpectatorMode | null; players: RoomPlayer[] }
): Promise<{ status: number; message: string } | null> {
  if (room.spectator_mode === "public_link") return null;
  const userId = await authenticateRequest(req);
  if (!userId) return { status: 401, message: "Missing or invalid token." };
  const memberError = requireRoomMember(room, userId);
  if (memberError) return { status: 403, message: memberError };
  return null;
}

async function getViewerPlayerId(
  req: IncomingMessage,
  room: { players: RoomPlayer[] }
): Promise<string | null> {
  const userId = await authenticateRequest(req);
  if (!userId) return null;
  return room.players.find((p) => p.supabaseUserId === userId)?.role ?? null;
}

/**
 * GET 系 viewer エンドポイント (/state/full・/events) 用: 認証を 1 回だけ行い、
 * アクセス可否と viewer player ID を同時に解決する。
 *
 * 背景 (バグ修正):
 * 旧実装は `authorizeRoomRead` と `getViewerPlayerId` がそれぞれ
 * `authenticateRequest` を呼び、1 リクエストにつき Supabase Auth 検証が
 * 2 回走っていた。RoomBattleLoader はゲーム開始待ち中 /state/full を
 * 500ms ごとにポーリングするため getUser 呼び出しが累積し、2 回目だけが一過性失敗
 * (レート制限等) すると、メンバーなのに viewerPlayerId=null へ化けて観戦者 sanitize
 * (全カード definitionId="_hidden_card_") が返り、クライアントがそれをキャッシュして
 * 「カードが読み込まれない」恒久バグになっていた。認証を 1 回に統一して divergence を排除する。
 */
async function authorizeRoomReadAndResolveViewer(
  req: IncomingMessage,
  room: { spectator_mode?: SpectatorMode | null; players: RoomPlayer[] }
): Promise<
  | { ok: false; status: number; message: string }
  | { ok: true; viewerPlayerId: string | null; isMember: boolean }
> {
  const userId = await authenticateRequest(req);
  if (room.spectator_mode !== "public_link") {
    if (!userId)
      return { ok: false, status: 401, message: "Missing or invalid token." };
    const memberError = requireRoomMember(room, userId);
    if (memberError) return { ok: false, status: 403, message: memberError };
  }
  const viewerPlayerId = userId
    ? (room.players.find((p) => p.supabaseUserId === userId)?.role ?? null)
    : null;
  return { ok: true, viewerPlayerId, isMember: viewerPlayerId !== null };
}

// sanitizeStateForViewer / sanitizeStateForSpectator は rules-core の
// 軽量モジュール (state-sanitize.ts, 型のみ import で engine 非ロード) に集約。
// シナリオ / スナップショットのクライアント表示用サニタイズと SSOT を共有する。
// 内部利用のため import し、既存 consumer (tests) 向けに re-export する。
import { refreshPendingRebirthSeparationCoreSources } from "../../../packages/rules-core/src/mechanics/core-charge-distribution";
import {
  sanitizeStateForViewer,
  sanitizeStateForSpectator,
  backfillOptionalStateFields,
  syncMinimumRequiredCoresFromCurrentDefinitions,
} from "../../../packages/rules-core/src/state-sanitize";
export { sanitizeStateForViewer, sanitizeStateForSpectator };
import { projectTriggerConditionObservations } from "../../../packages/rules-core/src/effect/trigger-condition-observation";

/** 内部イベント判定を伏せた配送stateには、認証された本人の合法手だけを添える。 */
export function prepareRoomViewerState(
  state: GameState,
  viewerPlayerId: string | null
): GameState {
  const observation = projectTriggerConditionObservations(state);
  // 発揮資格は内部観測値を除く前の正規stateで判定する。
  const sanitized = sanitizeStateForViewer(
    observation.value,
    viewerPlayerId,
    engine?.getCurrentActorPlayerIds(state, {
      getCardDefinitionById: defLookup,
      ...effectLookups,
    })
  );
  if (!observation.hasTimingObservations || viewerPlayerId === null)
    return sanitized;
  return {
    ...sanitized,
    viewerLegalActions: {
      actingPlayerId: viewerPlayerId,
      actions: engine.getLegalActions({
        state,
        actingPlayerId: viewerPlayerId,
        getCardDefinitionById: defLookup,
        ...effectLookups,
      }),
    },
  };
}

export type ViewerStateSyncPayload =
  | { state: GameState }
  | { patch: Operation[]; baseVersion: number };

export interface PreparedViewerStateSync {
  viewerPlayerId: string | null;
  version: number | null;
  payload: ViewerStateSyncPayload;
  fullState: GameState;
}

function prepareViewerStateSync(
  state: GameState,
  viewerPlayerId: string | null,
  version: number | null,
  previousState?: GameState | null,
  previousVersion?: number
): PreparedViewerStateSync {
  const sanitizedState = prepareRoomViewerState(state, viewerPlayerId);
  const sanitizedPrevious = previousState
    ? prepareRoomViewerState(previousState, viewerPlayerId)
    : null;
  if (sanitizedPrevious == null) {
    return {
      viewerPlayerId,
      version,
      payload: { state: sanitizedState },
      fullState: sanitizedState,
    };
  }

  const patch = jsonPatchCompare(
    sanitizedPrevious as unknown as Record<string, unknown>,
    sanitizedState as unknown as Record<string, unknown>
  );
  const patchBytes = JSON.stringify(patch).length;
  const stateBytes = JSON.stringify(sanitizedState).length;
  return {
    viewerPlayerId,
    version,
    payload:
      patchBytes <= stateBytes && previousVersion !== undefined
        ? { patch, baseVersion: previousVersion }
        : { state: sanitizedState },
    fullState: sanitizedState,
  };
}

function viewerStateSyncPayload(
  state: GameState,
  viewerPlayerId: string | null,
  previousState?: GameState | null,
  previousVersion?: number
): ViewerStateSyncPayload {
  return prepareViewerStateSync(
    state,
    viewerPlayerId,
    null,
    previousState,
    previousVersion
  ).payload;
}

/**
 * 1 mutation 内で使う viewer 別 payload を作る。
 *
 * Map は呼び出し元のローカル変数にだけ保持し、次 mutation へ持ち越さない。
 * patch は version が連番のときだけ許可し、飛び番なら full state に落とす。
 */
export function prepareViewerStateSyncPayloads(
  state: GameState,
  version: number,
  viewerPlayerIds: Iterable<string | null>,
  previousState?: GameState | null,
  previousVersion?: number,
  incrementalViewerPlayerIds?: ReadonlySet<string | null>
): Map<string | null, PreparedViewerStateSync> {
  const prepared = new Map<string | null, PreparedViewerStateSync>();
  const canPatch =
    previousState != null &&
    previousVersion !== undefined &&
    version === previousVersion + 1;
  for (const viewerPlayerId of viewerPlayerIds) {
    if (prepared.has(viewerPlayerId)) continue;
    const viewerCanPatch =
      canPatch &&
      (incrementalViewerPlayerIds === undefined ||
        incrementalViewerPlayerIds.has(viewerPlayerId));
    prepared.set(
      viewerPlayerId,
      prepareViewerStateSync(
        state,
        viewerPlayerId,
        version,
        viewerCanPatch ? previousState : null,
        viewerCanPatch ? previousVersion : undefined
      )
    );
  }
  return prepared;
}

function prepareViewerStateSyncPayloadsSafely(
  state: GameState,
  version: number,
  requirements: ReadonlyMap<string | null, boolean>,
  previousState?: GameState | null,
  previousVersion?: number
): Map<string | null, PreparedViewerStateSync> {
  const prepared = new Map<string | null, PreparedViewerStateSync>();
  for (const [viewerPlayerId, needsIncremental] of requirements) {
    try {
      const incrementalViewers = needsIncremental
        ? new Set<string | null>([viewerPlayerId])
        : new Set<string | null>();
      const viewerSync = prepareViewerStateSyncPayloads(
        state,
        version,
        [viewerPlayerId],
        previousState,
        previousVersion,
        incrementalViewers
      ).get(viewerPlayerId);
      if (viewerSync) prepared.set(viewerPlayerId, viewerSync);
    } catch {
      // A malformed viewer projection must not turn an already committed
      // mutation into HTTP 500 or block healthy viewers.
    }
  }
  return prepared;
}

function roomMutationSuccessPayload(
  state: GameState,
  version: number,
  viewerPlayerId: string,
  previousState?: GameState | null,
  previousVersion?: number,
  extra?: Record<string, unknown>,
  preparedSync?: PreparedViewerStateSync
) {
  return {
    ok: true,
    version,
    ...(preparedSync?.viewerPlayerId === viewerPlayerId &&
    preparedSync.version === version
      ? preparedSync.payload
      : viewerStateSyncPayload(
          state,
          viewerPlayerId,
          previousState,
          previousVersion
        )),
    isSpectator: false,
    ...(extra ?? {}),
  };
}

function committedRoomMutationSuccessPayload(
  version: number,
  viewerPlayerId: string,
  preparedSync: PreparedViewerStateSync | undefined,
  extra?: Record<string, unknown>
) {
  const validPrepared =
    preparedSync?.viewerPlayerId === viewerPlayerId &&
    preparedSync.version === version
      ? preparedSync
      : undefined;
  return {
    ok: true,
    version,
    ...(validPrepared?.payload ?? { syncUnavailable: true }),
    isSpectator: false,
    ...(extra ?? {}),
  };
}

function normalizePersistedState(state: Partial<GameState>): GameState {
  const backfilled = backfillOptionalStateFields(state);
  const synced = syncMinimumRequiredCoresFromCurrentDefinitions(
    backfilled,
    defLookup
  ).state;
  return refreshPendingRebirthSeparationCoreSources(synced, defLookup);
}

/**
 * PUT /state で受信した sanitize 済み state を、相手プレイヤーの隠匿情報で再合成する。
 *
 * 背景:
 * クライアントは GET /state/full で sanitize 済み state (相手の手札・デッキ・ミラージュ
 * ・未公開バースト・裏向き field カードの definitionId が "_hidden_card_") を受け取る。
 * クライアントが自分のアクション後にその state をそのまま PUT で送り返すと、サーバの
 * DB には "_hidden_card_" が書き込まれ、相手プレイヤー自身の手札 definitionId が
 * 消滅する破壊的なバグになる。
 *
 * 修正:
 * actor (現在 PUT を送ったプレイヤー) 以外の隠匿情報を、freshRoom.state (現 DB 値)
 * から復元する。具体的には:
 * - cardInstances: definitionId / originalDefinitionId が "_hidden_card_" のものを
 *   previous state の instanceId 一致レコードで埋め直す。
 * - pendingPrivateDeclarations: incoming に含まれる actor 自身の declarations は
 *   保持し、`ownerPlayerId !== actorPlayerId` の entry を previous から取り戻す。
 *   (actor の action が自分以外の declarations を追加した場合、incoming にそれが
 *   含まれているはずなので concat + dedupe する)
 * - pendingDeferredTriggeredEffects: 同様に `actingPlayerId !== actorPlayerId` を
 *   previous から取り戻す。
 *
 * actorPlayerId が null (理論上は requireRoomMember を通過しているので発生しない)
 * の場合は cardInstances のみ復元し、pending 系は手を加えない。
 */
export function restoreHiddenStateForActor(
  incoming: GameState,
  previous: GameState | null,
  actorPlayerId: string | null
): GameState {
  if (!previous) return incoming;
  const HIDDEN = "_hidden_card_";
  const prevCardMap = new Map(
    previous.cardInstances.map((c) => [c.instanceId, c])
  );
  const restoredCardInstances = incoming.cardInstances.map((c) => {
    const isDefHidden = c.definitionId === HIDDEN;
    const isOrigHidden = c.originalDefinitionId === HIDDEN;
    if (!isDefHidden && !isOrigHidden) return c;
    const prev = prevCardMap.get(c.instanceId);
    if (!prev) return c;
    return {
      ...c,
      definitionId: isDefHidden ? prev.definitionId : c.definitionId,
      originalDefinitionId: isOrigHidden
        ? prev.originalDefinitionId
        : c.originalDefinitionId,
    };
  });

  let pendingPrivateDeclarations = incoming.pendingPrivateDeclarations ?? [];
  let pendingDeferredTriggeredEffects =
    incoming.pendingDeferredTriggeredEffects ?? [];
  if (actorPlayerId) {
    const incomingDeclIds = new Set(
      pendingPrivateDeclarations.map((d) => d.declarationId)
    );
    const restoredOpponentDecls = (
      previous.pendingPrivateDeclarations ?? []
    ).filter(
      (d) =>
        d.ownerPlayerId !== actorPlayerId &&
        !incomingDeclIds.has(d.declarationId)
    );
    pendingPrivateDeclarations = [
      ...pendingPrivateDeclarations,
      ...restoredOpponentDecls,
    ];

    const incomingDeferredIds = new Set(
      pendingDeferredTriggeredEffects.map(
        (e: { pendingId?: string }) => e.pendingId
      )
    );
    const restoredOpponentDeferred = (
      previous.pendingDeferredTriggeredEffects ?? []
    ).filter(
      (e: { actingPlayerId: string; pendingId?: string }) =>
        e.actingPlayerId !== actorPlayerId &&
        (e.pendingId === undefined || !incomingDeferredIds.has(e.pendingId))
    );
    pendingDeferredTriggeredEffects = [
      ...pendingDeferredTriggeredEffects,
      ...restoredOpponentDeferred,
    ];
  }

  return {
    ...incoming,
    cardInstances: restoredCardInstances,
    pendingPrivateDeclarations,
    pendingDeferredTriggeredEffects,
  };
}

export function startRoomMaintenance(): () => void {
  const stopCleanup = startRoomCleanup(() =>
    cleanupExpiredRooms(supabaseAdmin)
  );
  // This worker runs with cross-user privileges. Keep it disabled until its
  // delivery lifecycle is scoped to an interview tenant.
  const stopPush = INTERVIEW_MODE
    ? () => undefined
    : startRoomPushDelivery(supabaseAdmin);
  return () => {
    stopCleanup();
    stopPush();
  };
}

async function getRoomMeta(roomId: string): Promise<RoomMetaRow | null> {
  const { data, error: dbError } = await supabaseServer
    .from("rooms")
    .select(
      "id, players, state_version, scenario_id, connected, last_heartbeat, spectator_mode"
    )
    .eq("id", roomId)
    .single();
  if (dbError && dbError.code !== "PGRST116")
    throw new RoomDependencyError("ROOM_READ_UNAVAILABLE");
  return data as RoomMetaRow | null;
}

async function getRoom(roomId: string): Promise<RoomRow | null> {
  const { data, error: dbError } = await supabaseServer
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .single();
  if (dbError && dbError.code !== "PGRST116")
    throw new RoomDependencyError("ROOM_READ_UNAVAILABLE");
  const row = data as RoomRow | null;
  // 後方互換: 新フィールド追加前に永続化された rooms.state は当該キーが欠落している。
  // 補完しないと厳密 `!== null` 判定が `undefined` を pending と誤認し進行不能になる
  // (スナップショット復元と同根。getRoom は全 state 読み込みの単一経路)。冪等。
  if (row?.state) {
    row.state = normalizePersistedState(row.state);
  }
  return row;
}

async function updateRoom(
  roomId: string,
  updates: Partial<Omit<RoomRow, "id" | "created_at">>
) {
  const { error: err } = await supabaseServer
    .from("rooms")
    .update(updates)
    .eq("id", roomId);
  if (err) throw new Error(`DB update failed: ${err.message}`);
}

/**
 * 楽観的ロック付き更新。state_version が expectedVersion と一致する場合のみ更新。
 * 一致しなければ false を返す（409 Conflict 用）。
 */

async function generateRoomId(): Promise<string> {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 6; i++)
    id += chars[Math.floor(Math.random() * chars.length)];
  // DB上の衝突チェック
  const existing = await getRoom(id);
  return existing ? generateRoomId() : id;
}

function buildLookup(defs: CardDefinition[]) {
  const map = new Map(defs.map((d: CardDefinition) => [d.cardNo, d]));
  return (id: string) => map.get(id);
}

/**
 * defLookup と effectLookups を **同一の展開済みプール** から一括構築する単一入口 (SSOT)。
 *
 * 入力 `defs` は表面のみ（= ALL_CARDS / デッキ構築プール）。ここで
 * `engine.expandCardDefinitionsWithBackFaces` によりダブルフェイス裏面の合成定義を加えた
 * 展開版を作り、定義ルックアップ・全効果レジストリの双方をその展開版から導出する。これにより
 * 転醒後 (executeRebirth が definitionId を 裏面 cardNo へ swap) の instance について
 * getCardDefinitionById(裏面cardNo) が解決され、裏面の card_event:"rebirth"（『転醒時』）効果が
 * レジストリにも登録されて production で発火する。
 *
 * 展開はこの 1 箇所のみで行い、ルックアップ側とレジストリ側へ二重実装しない。`allCardDefs`
 * (= デッキ構築・公開列挙が参照する表面プール) は変更せず、展開版はローカルに留める。
 */
function installCardLookups(defs: CardDefinition[]) {
  const expanded = engine.expandCardDefinitionsWithBackFaces(defs);
  defLookup = buildLookup(expanded);
  effectLookups = {
    getRegisteredTriggeredEffectActions:
      engine.buildTriggeredEffectLookup(expanded),
    getRegisteredBattleImmediateEffectActions:
      engine.buildBattleImmediateEffectLookup(expanded),
    getRegisteredFieldCardEffectActions:
      engine.buildFieldCardEffectLookup(expanded),
    getRegisteredHandActivatedEffectActions:
      engine.buildHandActivatedEffectLookup(expanded),
    getRegisteredMagicActions: engine.buildMagicLookup(expanded),
    getRegisteredBurstActions: engine.buildBurstEffectLookup(expanded),
  };
}

function resolveRequestedMainDeck(requestedNos: string[]): {
  deck: CardDefinition[];
  issues: MainDeckValidationIssue[];
} {
  const deck: CardDefinition[] = [];
  for (const no of requestedNos) {
    const def = defLookup(no);
    if (!def) continue;
    deck.push(def);
  }
  return { deck, issues: engine.validateMainDeckDefinitions(deck) };
}

function formatMainDeckValidationIssues(
  issues: readonly MainDeckValidationIssue[]
): string {
  return issues.map(engine.describeMainDeckValidationIssue).join(", ");
}

function buildDeck(requestedNos?: string[]): CardDefinition[] {
  if (requestedNos) {
    const { deck, issues } = resolveRequestedMainDeck(requestedNos);
    if (issues.length > 0) {
      throw new Error(
        `Deck violates main-deck rules: ${formatMainDeckValidationIssues(issues)}`
      );
    }
    // 40枚以上ならそのまま全枚数使う（切り詰めない）
    if (deck.length >= engine.MIN_DECK_SIZE) return deck;
  }
  return engine.randomDeck(allCardDefs, engine.RANDOM_DECK_SIZE);
}

function initGame(aliceDeckNos?: string[], bobDeckNos?: string[]) {
  currentState = engine.initializeGame({
    playerIds: ["alice", "bob"],
    decks: [buildDeck(aliceDeckNos), buildDeck(bobDeckNos)],
  });
  stateVersion++;
  return currentState;
}

// --- SSE (Server-Sent Events) connection registry ---
// hidden tab の heartbeat (30s) が intensive throttling で約 60s へ延びても
// 誤切断しない猶予を持たせつつ、half-open は有限時間で stale に戻す。
const SSE_MEMBER_LEASE_MS = 90_000;
const SSE_TRANSPORT_LEASE_MS = 120_000;
type SSEWritableResponse = Pick<ServerResponse, "write"> & {
  once?: ServerResponse["once"];
  end?: ServerResponse["end"];
  destroy?: ServerResponse["destroy"];
};

export interface SSEConnectionEntry {
  res: SSEWritableResponse;
  /** ルーム参加者なら true。観戦者 (public_link 経由 non-member) なら false。 */
  isMember: boolean;
  /** sanitize の基準になる viewer player ID。観戦者は null。 */
  viewerPlayerId: string | null;
  /** res.write() が false を返して drain 待ちなら true。 */
  backpressured: boolean;
  /** backpressure 中は中間 patch を捨て、最新 full state 1 件だけを保持する。 */
  pendingStateFrame: string | null;
  /** 送信済みまたは pending に保持した state_update の最大 version。 */
  latestStateVersion: number;
  /** member 接続を生存シグナルとして扱える期限。heartbeat でのみ延長する。 */
  memberLeaseExpiresAt: number;
  /** 全接続共通の最大寿命。満了時に close し、クライアントへ再接続させる。 */
  transportLeaseExpiresAt: number;
  drainListenerRegistered: boolean;
}
const sseConnections = new Map<string, Set<SSEConnectionEntry>>();

export function drainRoomStreams(): void {
  for (const [roomId, entries] of sseConnections) {
    for (const entry of [...entries]) {
      try {
        entry.res.write('event: reconnect\ndata: {"reason":"deployment"}\n\n');
      } catch {
        /* closed */
      }
      removeSSEConnection(roomId, entry, true);
    }
  }
}

export function addSSEConnection(
  roomId: string,
  res: SSEWritableResponse,
  isMember: boolean,
  viewerPlayerId: string | null,
  now = Date.now()
): SSEConnectionEntry {
  let connections = sseConnections.get(roomId);
  if (!connections) {
    connections = new Set();
    sseConnections.set(roomId, connections);
  }
  const entry: SSEConnectionEntry = {
    res,
    isMember,
    viewerPlayerId,
    backpressured: false,
    pendingStateFrame: null,
    latestStateVersion: -1,
    memberLeaseExpiresAt: isMember ? now + SSE_MEMBER_LEASE_MS : 0,
    transportLeaseExpiresAt: now + SSE_TRANSPORT_LEASE_MS,
    drainListenerRegistered: false,
  };
  connections.add(entry);
  return entry;
}

export function removeSSEConnection(
  roomId: string,
  entry: SSEConnectionEntry,
  closeResponse = false
): void {
  const connections = sseConnections.get(roomId);
  if (!connections) return;
  connections.delete(entry);
  entry.pendingStateFrame = null;
  entry.backpressured = false;
  entry.latestStateVersion = -1;
  entry.memberLeaseExpiresAt = 0;
  entry.transportLeaseExpiresAt = 0;
  entry.drainListenerRegistered = false;
  if (connections.size === 0) {
    sseConnections.delete(roomId);
  }
  if (closeResponse) {
    try {
      entry.res.end?.();
    } catch {
      try {
        entry.res.destroy?.();
      } catch {
        /* already closed */
      }
    }
  }
}

function hasSSEConnection(roomId: string, entry: SSEConnectionEntry): boolean {
  return sseConnections.get(roomId)?.has(entry) === true;
}

function registerSSEDrain(roomId: string, entry: SSEConnectionEntry): void {
  if (entry.drainListenerRegistered) return;
  if (typeof entry.res.once !== "function") {
    removeSSEConnection(roomId, entry);
    return;
  }
  entry.drainListenerRegistered = true;
  try {
    entry.res.once("drain", () => {
      entry.drainListenerRegistered = false;
      if (!hasSSEConnection(roomId, entry)) return;
      entry.backpressured = false;
      const pendingFrame = entry.pendingStateFrame;
      entry.pendingStateFrame = null;
      if (pendingFrame) writeSSEFrame(roomId, entry, pendingFrame);
    });
  } catch {
    removeSSEConnection(roomId, entry);
  }
}

function writeSSEFrame(
  roomId: string,
  entry: SSEConnectionEntry,
  frame: string
): void {
  if (!hasSSEConnection(roomId, entry) || entry.backpressured) return;
  try {
    if (entry.res.write(frame) === false) {
      entry.backpressured = true;
      registerSSEDrain(roomId, entry);
    }
  } catch {
    removeSSEConnection(roomId, entry);
  }
}

function deliverSSEStateFrame(
  roomId: string,
  entry: SSEConnectionEntry,
  version: number,
  frame: string
): void {
  if (entry.backpressured) {
    entry.pendingStateFrame = frame;
    entry.latestStateVersion = version;
    return;
  }
  entry.latestStateVersion = version;
  writeSSEFrame(roomId, entry, frame);
}

function fullStateSSEFrame(version: number, state: GameState): string {
  return `event: state_update\ndata: ${JSON.stringify({
    version,
    state,
  })}\n\n`;
}

export function shouldDeliverSSESnapshot(
  snapshotVersion: number,
  latestDeliveredVersion: number
): boolean {
  return snapshotVersion > latestDeliveredVersion;
}

/** テスト専用: SSE 接続レジストリを初期化する。 */
export function __resetSSEConnectionsForTest(): void {
  sseConnections.clear();
}

export function pruneExpiredSSEConnections(
  roomId: string,
  now = Date.now()
): number {
  let removed = 0;
  for (const entry of [...(sseConnections.get(roomId) ?? [])]) {
    if (
      entry.transportLeaseExpiresAt < now ||
      (entry.isMember && entry.memberLeaseExpiresAt < now)
    ) {
      removeSSEConnection(roomId, entry, true);
      removed += 1;
    }
  }
  return removed;
}

/** プレイヤー・観戦者を区別せず、現在有効な SSE 接続があるか返す。 */
function hasLiveSSEConnection(roomId: string): boolean {
  pruneExpiredSSEConnections(roomId);
  return (sseConnections.get(roomId)?.size ?? 0) > 0;
}

function getSSEViewerSyncRequirements(
  roomId: string
): Map<string | null, boolean> {
  pruneExpiredSSEConnections(roomId);
  const requirements = new Map<string | null, boolean>();
  for (const entry of sseConnections.get(roomId) ?? []) {
    requirements.set(
      entry.viewerPlayerId,
      (requirements.get(entry.viewerPlayerId) ?? false) || !entry.backpressured
    );
  }
  return requirements;
}

/**
 * 指定 role のプレイヤーがアクティブな member SSE 接続を持つか。
 *
 * SSE registry だけでは TCP half-open を検出できないため、接続時に短い grace lease を
 * 与え、その後はクライアント heartbeat でのみ延長する。通常 close が届かない断線でも
 * lease 満了後は DB heartbeat の時刻へ戻り、切断判定が無期限に抑止されない。
 */
export function renewSSEMemberLease(
  roomId: string,
  role: string | null,
  now: number
): void {
  if (!role) return;
  for (const entry of sseConnections.get(roomId) ?? []) {
    if (entry.isMember && entry.viewerPlayerId === role) {
      entry.memberLeaseExpiresAt = now + SSE_MEMBER_LEASE_MS;
    }
  }
}

function hasActiveMemberSSE(
  roomId: string,
  role: string | null,
  now: number
): boolean {
  if (!role) return false;
  pruneExpiredSSEConnections(roomId, now);
  const connections = sseConnections.get(roomId);
  if (!connections) return false;
  for (const entry of connections) {
    if (
      entry.isMember &&
      entry.viewerPlayerId === role &&
      entry.memberLeaseExpiresAt >= now
    ) {
      return true;
    }
  }
  return false;
}

/**
 * heartbeat ハンドラ用: 相手プレイヤーごとの切断判定 (role → disconnected)。
 * 純関数化してテスト可能にする。判定優先順位は
 *   1. heartbeat で更新済みの member SSE lease 内 → 接続中
 *   2. 最終 heartbeat が threshold より前 → 切断
 *   3. heartbeat 履歴なし → connected フラグにフォールバック
 */
export function computeOpponentDisconnected(
  roomId: string,
  players: ReadonlyArray<{ role: string; supabaseUserId: string }>,
  lastHeartbeat: Record<string, string> | null | undefined,
  connected: Record<string, boolean>,
  requesterUserId: string | undefined,
  now: number,
  disconnectThresholdMs = ROOM_DISCONNECT_TIMEOUT_MS
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const p of players) {
    if (p.supabaseUserId === requesterUserId) continue;
    if (hasActiveMemberSSE(roomId, p.role, now)) {
      result[p.role] = false;
      continue;
    }
    const lastBeat = (lastHeartbeat ?? {})[p.supabaseUserId];
    if (lastBeat) {
      result[p.role] =
        now - new Date(lastBeat).getTime() > disconnectThresholdMs;
    } else {
      result[p.role] = !(connected[p.supabaseUserId] ?? false);
    }
  }
  return result;
}

/**
 * SSE state_update ブロードキャスト。
 * viewer ごとに sanitize 済み payload / SSE frame を 1 回だけ作り、同じ視点の
 * 複数接続へ再利用する。backpressure 中の接続には最新 full state のみを残す。
 */
export function broadcastSSEStateUpdate(
  roomId: string,
  version: number,
  state: GameState,
  previousState?: GameState | null,
  preparedPayloads?: ReadonlyMap<string | null, PreparedViewerStateSync>,
  previousVersion = version - 1
): void {
  pruneExpiredSSEConnections(roomId);
  const connections = sseConnections.get(roomId);
  if (!connections || connections.size === 0) return;

  const prepared = new Map(preparedPayloads ?? []);
  const failedViewers = new Set<string | null>();
  const incrementalFrames = new Map<string | null, string>();
  const fullFrames = new Map<string | null, string>();

  const getPrepared = (
    viewerPlayerId: string | null,
    needsIncremental: boolean
  ): PreparedViewerStateSync | null => {
    if (failedViewers.has(viewerPlayerId)) return null;
    const cached = prepared.get(viewerPlayerId);
    if (
      cached?.viewerPlayerId === viewerPlayerId &&
      cached.version === version
    ) {
      return cached;
    }
    try {
      const generated = prepareViewerStateSyncPayloads(
        state,
        version,
        [viewerPlayerId],
        needsIncremental ? previousState : null,
        needsIncremental ? previousVersion : undefined
      ).get(viewerPlayerId);
      if (!generated) throw new Error("viewer sync payload was not prepared");
      prepared.set(viewerPlayerId, generated);
      return generated;
    } catch {
      failedViewers.add(viewerPlayerId);
      return null;
    }
  };

  const getIncrementalFrame = (
    viewerPlayerId: string | null
  ): string | null => {
    const cached = incrementalFrames.get(viewerPlayerId);
    if (cached) return cached;
    const viewerSync = getPrepared(viewerPlayerId, true);
    if (!viewerSync) return null;
    try {
      const frame = `event: state_update\ndata: ${JSON.stringify({
        version,
        ...viewerSync.payload,
      })}\n\n`;
      incrementalFrames.set(viewerPlayerId, frame);
      return frame;
    } catch {
      failedViewers.add(viewerPlayerId);
      return null;
    }
  };

  const getFullFrame = (viewerPlayerId: string | null): string | null => {
    const cached = fullFrames.get(viewerPlayerId);
    if (cached) return cached;
    const viewerSync = getPrepared(viewerPlayerId, false);
    if (!viewerSync) return null;
    try {
      const frame = fullStateSSEFrame(version, viewerSync.fullState);
      fullFrames.set(viewerPlayerId, frame);
      return frame;
    } catch {
      failedViewers.add(viewerPlayerId);
      return null;
    }
  };

  for (const entry of [...connections]) {
    if (version <= entry.latestStateVersion) continue;
    const frame = entry.backpressured
      ? getFullFrame(entry.viewerPlayerId)
      : getIncrementalFrame(entry.viewerPlayerId);
    if (!frame) {
      removeSSEConnection(roomId, entry);
      continue;
    }
    deliverSSEStateFrame(roomId, entry, version, frame);
  }
}

// --- P3-64 Phase C: replay event log (server-authoritative + replay) ---
//
// rooms.state は最新 snapshot (cache)、replay_events は event log (source of truth)。
// dispatch endpoint 6 種に加え、replay restore checkpoint も CAS 成功時に
// 次の state_version で 1 行 INSERT する。
//
// state_version は新しい (適用後の) rooms.state_version をそのまま記録 → 順序保証。
// 観戦許可ポリシーは rooms と同じ (service_role 経由のみ、RLS で client 直アクセス拒否)。
export type ReplayEventEndpoint =
  | "action"
  | "step"
  | "claim-victory"
  | "core-move"
  | "brave-separation"
  | "pregame-update"
  | "replay-restore";

export interface ReplayEventRow {
  id: number;
  room_id: string;
  state_version: number;
  acting_player_id: string;
  endpoint: ReplayEventEndpoint;
  payload: Record<string, unknown>;
  client_mutation_id?: string | null;
  created_at: string;
}

export interface ViewerReplayEventRow extends Omit<ReplayEventRow, "payload"> {
  payload: Record<string, unknown> | null;
  payloadRedacted: boolean;
}

function isReplayGameStatePayload(value: unknown): value is GameState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GameState>;
  return (
    Array.isArray(candidate.players) && Array.isArray(candidate.cardInstances)
  );
}

/** replay payload 内に埋め込まれた state も通常の room state と同じ視点で伏せる。 */
export function sanitizeReplayEventForViewer(
  event: ReplayEventRow,
  viewerPlayerId: string | null
): ViewerReplayEventRow {
  // dispatch input は hidden card の instance ID や deck order を含む。入力者本人
  // 以外には event metadata だけを返し、公開履歴は別の disclosure schema を使う。
  if (event.acting_player_id !== viewerPlayerId) {
    return { ...event, payload: null, payloadRedacted: true };
  }
  const payload = { ...event.payload };
  for (const key of ["state", "stateOverrides"] as const) {
    if (payload[key] === undefined) continue;
    if (isReplayGameStatePayload(payload[key])) {
      payload[key] = sanitizeStateForViewer(payload[key], viewerPlayerId);
    } else {
      // 部分 state や未知の形をそのまま返すと、新フィールド経由で秘匿情報が
      // 再流出しうる。replay 実行用の raw event は DB 内に保持される。
      delete payload[key];
    }
  }
  return { ...event, payload, payloadRedacted: false };
}

/**
 * dispatch 経路の append-only 永続化。
 *
 * 失敗時は console.error のみで例外を握り潰す: CAS update 成功後の post-hook なので、
 * ここで throw すると client は「適用済みなのに失敗レスポンス」を見ることになり、
 * 再送による double-apply 検知が複雑化する。replay 機能はあくまで補助層であり、
 * 一時的な log 欠落は次の dispatch までに復旧可能 (event 列再構築のときに gap として観測される)。
 */
export async function appendReplayEvent(input: {
  roomId: string;
  stateVersion: number;
  actingPlayerId: string;
  endpoint: ReplayEventEndpoint;
  payload: Record<string, unknown>;
  clientMutationId?: string | null;
}): Promise<void> {
  try {
    const row: Record<string, unknown> = {
      room_id: input.roomId,
      state_version: input.stateVersion,
      acting_player_id: input.actingPlayerId,
      endpoint: input.endpoint,
      payload: input.payload,
    };
    if (input.clientMutationId) {
      row.client_mutation_id = input.clientMutationId;
    }
    let { error: err } = await supabaseServer.from("replay_events").insert(row);
    // Migration 009 may not be applied in every dev database yet. Preserve the
    // old durable replay behavior, then the RPC path will take over once applied.
    if (
      err &&
      input.clientMutationId &&
      err.message.includes("client_mutation_id")
    ) {
      const { error: retryErr } = await supabaseServer
        .from("replay_events")
        .insert({
          room_id: input.roomId,
          state_version: input.stateVersion,
          acting_player_id: input.actingPlayerId,
          endpoint: input.endpoint,
          payload: input.payload,
        });
      err = retryErr;
    }
    if (err) {
      console.error(
        `[replay_events] insert failed (room=${input.roomId}, version=${input.stateVersion}, endpoint=${input.endpoint}): ${err.message}`
      );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[replay_events] insert threw (room=${input.roomId}, version=${input.stateVersion}, endpoint=${input.endpoint}): ${msg}`
    );
  }
}

/**
 * action body から「再生に必要な input」だけを抽出する。
 *
 * 巨大フィールド (state snapshot を body に含めるパターンなど) は除外し、
 * dispatch endpoint が再実行に必要とする keys のみ保存する。
 *
 * 観戦者向けの sanitize はここでは行わない (sanitize は GET /replay 経由の出力時)。
 */
export function sanitizeReplayPayload(
  endpoint: ReplayEventEndpoint,
  body: Record<string, unknown>
): Record<string, unknown> {
  const ALLOWED_KEYS: Record<ReplayEventEndpoint, readonly string[]> = {
    action: [
      "actionId",
      "expectedVersion",
      "clientMutationId",
      "serverAutoDrain",
      "skipOptionalEffect",
      "targetInstanceIds",
      "additionalSourceInstanceIds",
      "additionalAttackExhaustCostSourceInstanceIds",
      "chosenLifeCoreKind",
      "followUpTargetInstanceIds",
      "followUpChosenLifeCoreKind",
      "followUpPerTargetInputs",
      "paymentSources",
      "payCostPaymentSources",
      "deferPayCostSourceSelection",
      "summonPaymentSources",
      "summonEnterFieldCorePlacements",
      "enterFieldCorePlacements",
      "separateCoreDistribution",
      "selectedDeckRevealCardIds",
      "deckRevealMiragePaymentSourcesByInstanceId",
      "deckRevealRemainderOrder",
      "deckRevealPlacement",
      "deckRevealRemainderPlacements",
      "deckRevealPickFreeDestination",
      "selectedZoneCardIds",
      "zoneSelectionDestinationByCardId",
      "drawStepCostChoice",
      "drawStepCostDiscardCardInstanceId",
      "summonCostExcludeSelectedCardInstanceIds",
      "summonCostCoreMoveSelectedCount",
      "summonCostCoreMoveDestination",
      "summonCostCoreMoveAllocations",
      "groupedSummonCostOverrideSelectedCardInstanceIds",
      "lifeDamageDiscardChoice",
      "lifeGainReplacementChoice",
      "coreShootDistribution",
      "coreShootSoulCoreInstanceId",
      "payToActCoreSourceContainerId",
      "payToActCoreKind",
      "payToActCoreGateDecline",
      "fieldMagicPreCostTriggerDecision",
      "coreSplitDistribution",
      "splitSummonTokenCount",
      "splitSummonZoneCardInstanceIds",
      "coreCountSelection",
      "countDecreaseSelection",
      "discardSetBurstCountSelection",
      "lifeCorePartitionChoice",
      "coreSourceAllocations",
      "coreSourceSoulCoreInstanceId",
      "coreDistributionAllocations",
      "coreDistributionSoulCoreAllocations",
      "coreDistributionSoulCoreInstanceId",
      "coreDistributionSourceAllocations",
      "coreDistributionSoulCoreSourceAllocations",
      "multiPlacementAllocations",
      "swapTargetInstanceId",
      "redirectTargetReplacementInstanceId",
      "redirectTargetReplacementInstanceIds",
      "payToActHandDiscardCardInstanceIds",
      "payToActHandDiscardGateDecline",
      // ENGINE-paid-prevention-immunity-card-cost Step3 follow-up (adversarial
      // verifier 2026-07-28 round3 refute): このキーが passthroughKeys
      // (extractApplyOptionsFromBody 側) にだけ存在し、こちらに無いと room action は
      // ライブ実行 (executeAction) では成功するのに、保存された replay payload から
      // 落ちて replay/restore 時に "explicit ... is required" で再び throw する。
      // 新規 passthrough キーを足すときは常にこの配列にも対で追加する
      // (payToActHandDiscardCardInstanceIds/GateDecline と同じ理由)。
      "paidPreventionImmunityCardSelection",
    ],
    step: ["expectedVersion", "clientMutationId", "serverAutoDrain"],
    "claim-victory": [
      "reason",
      "expectedVersion",
      "clientMutationId",
      "serverAutoDrain",
    ],
    "core-move": [
      "coreMoveDrafts",
      "expectedVersion",
      "clientMutationId",
      "serverAutoDrain",
    ],
    "brave-separation": [
      "actionId",
      "separateCoreDistribution",
      "separationSoulCoreSource",
      "braveInstanceId",
      "expectedVersion",
      "clientMutationId",
      "serverAutoDrain",
    ],
    "pregame-update": [
      "preGame",
      "expectedVersion",
      "clientMutationId",
      "serverAutoDrain",
    ],
    "replay-restore": ["state"],
  };
  const allowed = ALLOWED_KEYS[endpoint];
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

function extractClientMutationId(body: Record<string, unknown>): string | null {
  return parseRoomMutationId(body.clientMutationId);
}

export function mutationFingerprint(
  body: Record<string, unknown>,
  route: string
): string {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, canonical(item)])
          )
        : value;
  const { expectedVersion: _version, clientMutationId: _id, ...payload } = body;
  return createHash("sha256")
    .update(JSON.stringify([route, canonical(payload)]))
    .digest("hex");
}

async function findDuplicateMutationVersion(
  roomId: string,
  clientMutationId: string,
  actorPlayerId: string,
  fingerprint: string,
  endpoint: string
): Promise<number | null> {
  try {
    const { data, error: err } = await supabaseServer.rpc(
      "lookup_room_mutation",
      {
        p_room_id: roomId,
        p_id: clientMutationId,
        p_actor: actorPlayerId,
        p_endpoint: endpoint,
        p_fingerprint: fingerprint,
      }
    );
    if (err) throw new RoomDependencyError("ROOM_OUTCOME_UNAVAILABLE");
    return typeof data === "number" ? data : null;
  } catch (error) {
    if (error instanceof RoomDependencyError) throw error;
    throw new RoomDependencyError("ROOM_OUTCOME_UNAVAILABLE");
  }
}

class RoomDependencyError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export async function checkRoomNetworkReadiness(): Promise<boolean> {
  try {
    const { data, error } = await supabaseServer.rpc(
      "room_network_readiness_v2"
    );
    return !error && data === true;
  } catch {
    return false;
  }
}

export interface RoomMutationRandomContext {
  seed: number | null;
  state: number;
  drawCount: number;
}

const ROOM_RANDOM_TRACE_VERSION = 1;

/**
 * Room mutation 内の乱数を replay 可能にする軽量 PRNG context。
 * seed は最初の乱数要求まで生成しないため、非乱数 mutation の payload は増えない。
 */
export function createRoomMutationRandomContext(
  seed?: number
): RoomMutationRandomContext {
  if (
    seed !== undefined &&
    (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
  ) {
    throw new Error("Invalid replay random seed.");
  }
  return {
    seed: seed ?? null,
    state: seed ?? 0,
    drawCount: 0,
  };
}

function nextRoomMutationRandom(context: RoomMutationRandomContext): number {
  if (context.seed === null) {
    context.seed = randomBytes(4).readUInt32LE(0);
    context.state = context.seed;
  }

  // mulberry32: shuffle 用として十分な分布を持つ決定論的 32-bit PRNG。
  context.state = (context.state + 0x6d2b79f5) >>> 0;
  let value = context.state;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  context.drawCount += 1;
  return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
}

/** callback は同期処理限定。await を跨がないため、他 request と乱数源を共有しない。 */
export function runWithRoomMutationRandom<T>(
  context: RoomMutationRandomContext,
  callback: () => T
): T {
  const previousRandom = Math.random;
  Math.random = () => nextRoomMutationRandom(context);
  try {
    return callback();
  } finally {
    Math.random = previousRandom;
  }
}

export function roomMutationRandomTrace(
  context: RoomMutationRandomContext
): Record<string, number> {
  return {
    randomTraceVersion: ROOM_RANDOM_TRACE_VERSION,
    randomDrawCount: context.drawCount,
    ...(context.seed === null ? {} : { randomSeed: context.seed }),
  };
}

function isMissingCommitRpcError(err: { code?: string; message?: string }) {
  const message = err.message ?? "";
  return (
    err.code === "PGRST202" ||
    message.includes("Could not find the function") ||
    message.includes("commit_room_state")
  );
}

export function isReplayRestoreCommitAuthorized(
  providedToken: string | string[] | undefined,
  configuredToken = process.env.ROOM_REPLAY_RESTORE_TOKEN
): boolean {
  const expected = configuredToken?.trim();
  if (!expected || typeof providedToken !== "string") return false;
  const providedDigest = createHash("sha256").update(providedToken).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

async function commitRoomMutation(input: {
  roomId: string;
  expectedVersion: number;
  nextState: GameState;
  actingPlayerId: string;
  endpoint: ReplayEventEndpoint;
  replayPayload: Record<string, unknown>;
  clientMutationId?: string | null;
  timing?: HttpTimingCollector;
  requireAtomic?: boolean;
}): Promise<
  | { ok: true; version: number; duplicate: boolean }
  | {
      ok: false;
      currentVersion: number;
      unavailable?: boolean;
      cancelled?: boolean;
    }
> {
  const rpcArgs = {
    p_room_id: input.roomId,
    p_expected_version: input.expectedVersion,
    p_state: input.nextState,
    p_acting_player_id: input.actingPlayerId,
    p_endpoint: input.endpoint,
    p_payload: input.replayPayload,
    p_client_mutation_id: input.clientMutationId ?? null,
  };
  const rpcCall = async () =>
    supabaseServer.rpc("commit_room_state", rpcArgs).single();
  const { data, error: err } = input.timing
    ? await input.timing.measure("db_commit_rpc", rpcCall)
    : await rpcCall();
  // Never split a durable state write from its deduplication/replay record.
  // Do not cache RPC absence: migration can happen while the API is live.
  if (err?.code === "P0002")
    return {
      ok: false,
      currentVersion: input.expectedVersion,
      cancelled: true,
    };
  if (err?.code === "22023")
    return { ok: false, currentVersion: input.expectedVersion };
  if (err || !data || typeof data !== "object") {
    throw new RoomDependencyError(
      isMissingCommitRpcError(err ?? {})
        ? "ROOM_SCHEMA_UNAVAILABLE"
        : "ROOM_COMMIT_UNAVAILABLE"
    );
  }
  const row = data as {
    ok?: boolean;
    new_version?: number;
    current_version?: number;
    duplicate?: boolean;
  };
  if (row.ok === true && typeof row.new_version === "number") {
    return {
      ok: true,
      version: row.new_version,
      duplicate: row.duplicate === true,
    };
  }
  return {
    ok: false,
    currentVersion: row.current_version ?? input.expectedVersion,
  };
}

async function repairRoomStateFromReplay(input: {
  roomId: string;
  expectedRoomVersion: number;
  replayedToVersion: number;
  state: GameState;
  actingPlayerId: string;
  replayPayload: Record<string, unknown>;
}): Promise<
  | { ok: true; version: number }
  | {
      ok: false;
      currentVersion: number;
      eventVersion?: number;
      unavailable?: boolean;
    }
> {
  const { data, error: rpcError } = await supabaseServer.rpc(
    "repair_room_state_from_replay",
    {
      p_room_id: input.roomId,
      p_expected_room_version: input.expectedRoomVersion,
      p_replayed_to_version: input.replayedToVersion,
      p_state: input.state,
      p_acting_player_id: input.actingPlayerId,
      p_payload: input.replayPayload,
    }
  );
  if (rpcError) {
    const unavailable =
      rpcError.code === "PGRST202" ||
      rpcError.message.includes("Could not find the function");
    if (!unavailable) {
      console.error(`[repair_room_state_from_replay] ${rpcError.message}`);
    }
    return {
      ok: false,
      currentVersion: input.expectedRoomVersion,
      unavailable,
    };
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    new_version?: number;
    current_version?: number;
    event_version?: number;
  } | null;
  if (row?.ok === true && typeof row.new_version === "number") {
    return { ok: true, version: row.new_version };
  }
  return {
    ok: false,
    currentVersion:
      typeof row?.current_version === "number"
        ? row.current_version
        : input.expectedRoomVersion,
    ...(typeof row?.event_version === "number"
      ? { eventVersion: row.event_version }
      : {}),
  };
}

async function finalizeRoomMutation(input: {
  res: ServerResponse;
  roomId: string;
  currentVersion: number;
  previousState: GameState;
  nextState: GameState;
  actorPlayerId: string;
  endpoint: ReplayEventEndpoint;
  body: Record<string, unknown>;
  requestBody?: Record<string, unknown>;
  timing?: HttpTimingCollector;
  randomContext?: RoomMutationRandomContext;
}) {
  const clientMutationId = extractClientMutationId(input.body);
  const randomContext =
    input.randomContext ?? createRoomMutationRandomContext();
  const autoDrainStartedAt = performance.now();
  const drained = runWithRoomMutationRandom(randomContext, () =>
    autoDrainRoomState(input.nextState)
  );
  input.timing?.mark("auto_drain", performance.now() - autoDrainStartedAt);
  const finalState = drained.state;
  const trustedReplayBody = { ...input.body };
  delete trustedReplayBody.clientMutationId;
  delete trustedReplayBody.serverAutoDrain;
  const replayPayload = sanitizeReplayPayload(input.endpoint, {
    ...trustedReplayBody,
    ...(clientMutationId ? { clientMutationId } : {}),
    ...(drained.steps.length > 0 ? { serverAutoDrain: true } : {}),
  });
  Object.assign(replayPayload, roomMutationRandomTrace(randomContext));
  replayPayload.requestFingerprint = mutationFingerprint(
    input.requestBody ?? input.body,
    (input.res as TimedServerResponse).__roomRoute ?? input.endpoint
  );
  const commit = await commitRoomMutation({
    roomId: input.roomId,
    expectedVersion: input.currentVersion,
    nextState: finalState,
    actingPlayerId: input.actorPlayerId,
    endpoint: input.endpoint,
    replayPayload,
    clientMutationId,
    ...(input.timing ? { timing: input.timing } : {}),
  });
  if (!commit.ok) {
    return json(
      input.res,
      {
        error: "Conflict",
        currentVersion: commit.currentVersion,
        ...(commit.cancelled ? { code: "ROOM_MUTATION_CANCELLED" } : {}),
      },
      409
    );
  }
  if (commit.duplicate) {
    let latestRoom: RoomRow | null = null;
    try {
      latestRoom = input.timing
        ? await input.timing.measure("db_duplicate_state", () =>
            getRoom(input.roomId)
          )
        : await getRoom(input.roomId);
    } catch {
      // The duplicate is already durable. Never label previousState with the
      // duplicate version when the authoritative row cannot be reloaded.
    }
    const duplicateExtra = {
      ...(clientMutationId ? { clientMutationId } : {}),
      duplicate: true,
      duplicateVersion: commit.version,
    };
    if (!latestRoom?.state) {
      return json(
        input.res,
        committedRoomMutationSuccessPayload(
          commit.version,
          input.actorPlayerId,
          undefined,
          duplicateExtra
        )
      );
    }
    const latestState = latestRoom.state;
    const latestVersion = latestRoom.state_version;
    const duplicateRequirements = getSSEViewerSyncRequirements(input.roomId);
    duplicateRequirements.set(input.actorPlayerId, false);
    const duplicatePrepared = prepareViewerStateSyncPayloadsSafely(
      latestState,
      latestVersion,
      duplicateRequirements
    );
    try {
      broadcastSSEStateUpdate(
        input.roomId,
        latestVersion,
        latestState,
        null,
        duplicatePrepared
      );
    } catch {
      // Duplicate HTTP acknowledgement must still succeed; clients can fetch.
    }
    return json(
      input.res,
      committedRoomMutationSuccessPayload(
        latestVersion,
        input.actorPlayerId,
        duplicatePrepared.get(input.actorPlayerId),
        duplicateExtra
      )
    );
  }
  const syncRequirements = getSSEViewerSyncRequirements(input.roomId);
  syncRequirements.set(input.actorPlayerId, true);
  let preparedSyncPayloads = new Map<string | null, PreparedViewerStateSync>();
  try {
    preparedSyncPayloads = measureSync(input.timing, "state_sync_prepare", () =>
      prepareViewerStateSyncPayloadsSafely(
        finalState,
        commit.version,
        syncRequirements,
        input.previousState,
        input.currentVersion
      )
    );
  } catch {
    // DB commit is already durable. Return success and let clients fetch.
  }
  try {
    measureSync(input.timing, "sse_broadcast", () =>
      broadcastSSEStateUpdate(
        input.roomId,
        commit.version,
        finalState,
        input.previousState,
        preparedSyncPayloads,
        input.currentVersion
      )
    );
  } catch {
    // Per-viewer broadcast is best-effort after commit; polling recovers.
  }
  return json(
    input.res,
    committedRoomMutationSuccessPayload(
      commit.version,
      input.actorPlayerId,
      preparedSyncPayloads.get(input.actorPlayerId),
      {
        ...(clientMutationId ? { clientMutationId } : {}),
        ...(commit.duplicate ? { duplicate: true } : {}),
        ...(drained.steps.length > 0
          ? { autoDrained: drained.steps.length }
          : {}),
      }
    )
  );
}

async function maybeRespondDuplicateMutation(input: {
  res: ServerResponse;
  room: RoomRow;
  actorPlayerId: string;
  body: Record<string, unknown>;
}): Promise<boolean> {
  if (!input.room.state) return false;
  // A fresh base cannot be an earlier successful retry. The commit still checks
  // every ID under the DB lock; skip an unnecessary serial lookup on the hot path.
  if (input.body.expectedVersion === input.room.state_version) return false;
  const clientMutationId = extractClientMutationId(input.body);
  if (!clientMutationId) return false;
  const duplicateVersion = await findDuplicateMutationVersion(
    input.room.id,
    clientMutationId,
    input.actorPlayerId,
    mutationFingerprint(
      input.body,
      (input.res as TimedServerResponse).__roomRoute ?? ""
    ),
    ["/rematch", "/reset-request", "/reset-response", "/start"].some((suffix) =>
      ((input.res as TimedServerResponse).__roomRoute ?? "").endsWith(suffix)
    )
      ? "replay-restore"
      : ((input.res as TimedServerResponse).__roomRoute ?? "")
          .split("/")
          .at(-1)!
  );
  if (duplicateVersion == null) return false;
  const committedRoom =
    input.room.state_version >= duplicateVersion
      ? input.room
      : await getRoom(input.room.id);
  if (!committedRoom?.state || committedRoom.state_version < duplicateVersion)
    throw new RoomDependencyError("ROOM_OUTCOME_UNAVAILABLE");
  const syncRequirements = getSSEViewerSyncRequirements(input.room.id);
  syncRequirements.set(input.actorPlayerId, false);
  const prepared = prepareViewerStateSyncPayloadsSafely(
    committedRoom.state,
    committedRoom.state_version,
    syncRequirements
  );
  try {
    broadcastSSEStateUpdate(
      input.room.id,
      committedRoom.state_version,
      committedRoom.state,
      null,
      prepared
    );
  } catch {
    // Duplicate acknowledgement remains successful; polling is the fallback.
  }
  json(
    input.res,
    committedRoomMutationSuccessPayload(
      committedRoom.state_version,
      input.actorPlayerId,
      prepared.get(input.actorPlayerId),
      { clientMutationId, duplicate: true, duplicateVersion }
    )
  );
  return true;
}

// --- HTTP helpers ---
export function readBody(
  req: IncomingMessage,
  maxBytes = 1_048_576
): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.destroy();
        reject(new Error("Payload too large"));
        return;
      }
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

/**
 * JWT 認証: Authorization ヘッダーから Supabase ユーザーIDを検証して返す。
 * トークンが無い/無効なら null を返す。
 *
 * Room polling/heartbeat は同じ短命 access token を連続使用するため、
 * getClaims で検証した sub を token 期限内かつ短時間だけ再利用する。
 * getUser は Supabase Auth へのネットワーク往復が常に発生するため hot path では避ける。
 */
type AuthVerifierResult = { userId: string; tokenExpiresAtMs?: number };
type AuthVerifier = (token: string) => Promise<AuthVerifierResult | null>;
type JwtClaimsLike = { sub?: unknown; exp?: unknown };

interface HttpTimingEntry {
  name: string;
  durationMs: number;
}

class HttpTimingCollector {
  private readonly startedAt = performance.now();
  private readonly entries: HttpTimingEntry[] = [];

  async measure<T>(name: string, task: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await task();
    } finally {
      this.entries.push({ name, durationMs: performance.now() - start });
    }
  }

  mark(name: string, durationMs: number): void {
    this.entries.push({ name, durationMs });
  }

  toHeader(): string {
    const total = performance.now() - this.startedAt;
    return [...this.entries, { name: "total", durationMs: total }]
      .map((entry) => `${entry.name};dur=${entry.durationMs.toFixed(1)}`)
      .join(", ");
  }
}

type TimedServerResponse = ServerResponse & {
  __roomTiming?: HttpTimingCollector;
  __roomRoute?: string;
};

function measureSync<T>(
  timing: HttpTimingCollector | undefined,
  name: string,
  task: () => T
): T {
  const start = performance.now();
  try {
    return task();
  } finally {
    timing?.mark(name, performance.now() - start);
  }
}

const AUTH_CACHE_TTL_MS = 10_000;
const authUserCache = new Map<
  string,
  { userId: string; expiresAtMs: number }
>();
const interviewMembershipCache = new WeakMap<
  IncomingMessage,
  Promise<boolean>
>();

async function verifySupabaseJwtClaims(
  token: string
): Promise<AuthVerifierResult | null> {
  const { data, error: err } = await supabaseServer.auth.getClaims(token);
  const claims = data?.claims as JwtClaimsLike | undefined;
  const userId = claims?.sub;
  if (
    err &&
    (err.status === 0 ||
      (err.status ?? 0) >= 500 ||
      err.name === "AuthRetryableFetchError")
  )
    throw new RoomDependencyError("AUTH_UNAVAILABLE");
  if (err || typeof userId !== "string" || userId.length === 0) return null;
  const exp = claims?.exp;
  if (typeof exp === "number") {
    return { userId, tokenExpiresAtMs: exp * 1000 };
  }
  return { userId };
}

let authVerifier: AuthVerifier = verifySupabaseJwtClaims;

export function __setAuthVerifierForTest(verifier: AuthVerifier | null): void {
  authVerifier = verifier ?? verifySupabaseJwtClaims;
  authUserCache.clear();
}

export function __clearAuthCacheForTest(): void {
  authUserCache.clear();
}

function extractBearerToken(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

async function authenticateToken(token: string): Promise<string | null> {
  const now = Date.now();
  const cached = authUserCache.get(token);
  if (cached) {
    if (cached.expiresAtMs > now) return cached.userId;
    authUserCache.delete(token);
  }

  const verified = await authVerifier(token);
  if (!verified) return null;
  const tokenExpiresAtMs = verified.tokenExpiresAtMs ?? now + AUTH_CACHE_TTL_MS;
  if (tokenExpiresAtMs <= now) return null;
  const expiresAtMs = Math.min(now + AUTH_CACHE_TTL_MS, tokenExpiresAtMs);
  authUserCache.set(token, { userId: verified.userId, expiresAtMs });
  return verified.userId;
}

export async function authenticateRequest(
  req: IncomingMessage
): Promise<string | null> {
  const token = extractBearerToken(req);
  const userId = token ? await authenticateToken(token) : null;
  if (!userId || !INTERVIEW_MODE) return userId;
  let membershipCheck = interviewMembershipCache.get(req);
  if (!membershipCheck) {
    membershipCheck = Promise.resolve()
      .then(() =>
        supabaseAdmin.rpc("service_has_active_interview_membership", {
          p_user_id: userId,
        })
      )
      .then(({ data, error: membershipError }) => {
        if (membershipError) {
          throw new RoomDependencyError("INTERVIEW_MEMBERSHIP_UNAVAILABLE");
        }
        return data === true;
      });
    interviewMembershipCache.set(req, membershipCheck);
  }
  return (await membershipCheck) ? userId : null;
}

/**
 * GameState のトップレベルバリデーション。
 * 完全なスキーマ検証ではなく、型・必須フィールドの最低限チェック。
 * 違反があればエラーメッセージ文字列を返す。合格なら null。
 */
function validateGameState(state: unknown): string | null {
  if (state === null || state === undefined) return null; // preGame-only push 時は null も許容
  if (typeof state !== "object" || Array.isArray(state))
    return "state must be an object";
  const s = state as Record<string, unknown>;

  // 必須フィールドと期待される型
  const requiredFields: [string, string][] = [
    ["turnNumber", "number"],
    ["activePlayerId", "string"],
    ["step", "string"],
    ["players", "array"],
    ["cardInstances", "array"],
  ];
  for (const [field, expectedType] of requiredFields) {
    if (!(field in s)) return `missing required field: ${field}`;
    if (expectedType === "array") {
      if (!Array.isArray(s[field])) return `${field} must be an array`;
    } else if (typeof s[field] !== expectedType) {
      return `${field} must be a ${expectedType}, got ${typeof s[field]}`;
    }
  }

  // players は 2 要素
  if (Array.isArray(s.players) && s.players.length !== 2) {
    return `players must have exactly 2 elements, got ${(s.players as unknown[]).length}`;
  }

  // turnNumber は非負整数
  if (
    typeof s.turnNumber === "number" &&
    (s.turnNumber < 0 || !Number.isInteger(s.turnNumber))
  ) {
    return `turnNumber must be a non-negative integer`;
  }

  return null;
}

// [REMOVED] validateGameInvariants — P3-64 Phase B-5 で削除 (2026-05-17)
// 旧 PUT /api/room/:id/state でクライアント送信 state の不変量を検証していた helper。
// Phase B-5 で PUT 削除に伴い、server-side で engine 直接実行する経路に統一されたため、
// client が不正な state を送る前提自体が排除された。

/**
 * 自動コスト支払いソースを計算する。
 * リザーブから優先的に支払い、不足分をフィールドカード（コア数の多いカードから）で補填。
 * ソウルコアは使わない（安全策）。
 */
function autoPaymentSources(
  state: GameState,
  playerId: string,
  action: {
    availableOnBoardCoreSources?: readonly AvailableOnBoardCorePaymentSource[];
    finalCost?: number;
  },
  def: CardDefinition
): (
  | { kind: "reserve"; amount: number }
  | { kind: "card"; instanceId: string; amount: number }
)[] {
  const finalCost =
    action.finalCost ??
    engine.calculateReduction({
      state,
      actingPlayerId: playerId,
      card: def,
      getCardDefinitionById: defLookup,
    }).finalCost;
  if (finalCost <= 0) return [];

  const sources: (
    | { kind: "reserve"; amount: number }
    | {
        kind: "card";
        instanceId: string;
        amount: number;
        destination?: "trash" | "void";
      }
  )[] = [];

  // リザーブから支払い
  const player = state.players.find((p: PlayerState) => p.id === playerId);
  const reserveAvailable = player?.reserveNormalCoreCount ?? 0;
  const reservePay = Math.min(reserveAvailable, finalCost);
  if (reservePay > 0) {
    sources.push({ kind: "reserve", amount: reservePay });
  }

  // 不足分をフィールドカードから補填（コア数の多いカードから優先）
  let remaining = finalCost - reservePay;
  if (remaining > 0) {
    const fieldSources = (action.availableOnBoardCoreSources ?? [])
      .filter(
        (s: AvailableOnBoardCorePaymentSource) => s.availableCoreAmount > 0
      )
      .sort(
        (
          a: AvailableOnBoardCorePaymentSource,
          b: AvailableOnBoardCorePaymentSource
        ) => b.availableCoreAmount - a.availableCoreAmount
      );
    for (const src of fieldSources) {
      if (remaining <= 0) break;
      const take = Math.min(src.availableCoreAmount, remaining);
      sources.push({
        kind: "card",
        instanceId: src.instanceId,
        amount: take,
        ...(src.destination ? { destination: src.destination } : {}),
      });
      remaining -= take;
    }
  }

  return sources;
}

/**
 * body から ApplyLegalActionOptions の payload フィールド (action 以外) を抽出する。
 *
 * P3-64 Phase B-3: BattleScreen の各 setStateAndSync callsite で渡される
 * 追加引数 (paymentSources / targetInstanceIds / selectedZoneCardIds / ...) を
 * server `/action` の body 経由で受け取り、applyLegalAction に pass-through する。
 *
 * 未指定フィールドは省略 (`exactOptionalPropertyTypes` 互換のため undefined を入れない)。
 */
function extractApplyOptionsFromBody(
  body: Record<string, unknown>
): Partial<
  Omit<
    import("@orica/rules-core").ApplyLegalActionOptions,
    | "state"
    | "action"
    | "getCardDefinitionById"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
    | "getRegisteredBattleImmediateEffectActions"
    | "getRegisteredFieldCardEffectActions"
    | "getRegisteredMagicActions"
    | "getHandWrittenBurstPostResolutionPolicy"
    | "resolveFieldCardEffect"
    | "getHandWrittenEffectResolver"
    | "getConditionalCostCanExecuteCheck"
    | "getConditionalResultSuccessCheck"
    | "resolvePendingTriggeredEffect"
    | "getPendingTriggeredEffectResolver"
    | "resolvePendingBurstCheck"
    | "getPendingBurstCheckResolver"
  >
> {
  const out: Record<string, unknown> = {};
  const passthroughKeys = [
    "skipOptionalEffect",
    "targetInstanceIds",
    "additionalSourceInstanceIds",
    "additionalAttackExhaustCostSourceInstanceIds",
    "chosenLifeCoreKind",
    "followUpTargetInstanceIds",
    "followUpChosenLifeCoreKind",
    "followUpPerTargetInputs",
    "paymentSources",
    "payCostPaymentSources",
    "deferPayCostSourceSelection",
    "summonPaymentSources",
    "summonEnterFieldCorePlacements",
    "enterFieldCorePlacements",
    "separateCoreDistribution",
    "selectedDeckRevealCardIds",
    "deckRevealMiragePaymentSourcesByInstanceId",
    "deckRevealRemainderOrder",
    "deckRevealPlacement",
    "deckRevealRemainderPlacements",
    "deckRevealPickFreeDestination",
    "selectedZoneCardIds",
    "zoneSelectionDestinationByCardId",
    "drawStepCostChoice",
    "drawStepCostDiscardCardInstanceId",
    "summonCostExcludeSelectedCardInstanceIds",
    "summonCostCoreMoveSelectedCount",
    "summonCostCoreMoveDestination",
    "summonCostCoreMoveAllocations",
    "groupedSummonCostOverrideSelectedCardInstanceIds",
    "lifeDamageDiscardChoice",
    "lifeGainReplacementChoice",
    "coreShootDistribution",
    "coreShootSoulCoreInstanceId",
    "payToActCoreSourceContainerId",
    "payToActCoreKind",
    "payToActCoreGateDecline",
    "fieldMagicPreCostTriggerDecision",
    "coreSplitDistribution",
    "splitSummonTokenCount",
    "splitSummonZoneCardInstanceIds",
    "coreCountSelection",
    "countDecreaseSelection",
    "discardSetBurstCountSelection",
    "lifeCorePartitionChoice",
    "coreSourceAllocations",
    "coreSourceSoulCoreInstanceId",
    "coreDistributionAllocations",
    "coreDistributionSoulCoreAllocations",
    "coreDistributionSoulCoreInstanceId",
    "coreDistributionSourceAllocations",
    "coreDistributionSoulCoreSourceAllocations",
    "multiPlacementAllocations",
    "swapTargetInstanceId",
    "redirectTargetReplacementInstanceId",
    "redirectTargetReplacementInstanceIds",
    "payToActHandDiscardCardInstanceIds",
    "payToActHandDiscardGateDecline",
    "paidPreventionImmunityCardSelection",
  ] as const;
  for (const key of passthroughKeys) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out as Partial<
    Omit<
      import("@orica/rules-core").ApplyLegalActionOptions,
      | "state"
      | "action"
      | "getCardDefinitionById"
      | "getRegisteredTriggeredEffectActions"
      | "getRegisteredBurstActions"
      | "getRegisteredBattleImmediateEffectActions"
      | "getRegisteredFieldCardEffectActions"
      | "getRegisteredMagicActions"
      | "getHandWrittenBurstPostResolutionPolicy"
      | "resolveFieldCardEffect"
      | "getHandWrittenEffectResolver"
      | "getConditionalCostCanExecuteCheck"
      | "getConditionalResultSuccessCheck"
      | "resolvePendingTriggeredEffect"
      | "getPendingTriggeredEffectResolver"
      | "resolvePendingBurstCheck"
      | "getPendingBurstCheckResolver"
    >
  >;
}

/**
 * P3-64 Phase B: legal action を engine 実行して新 state を返す。
 *
 * legacy `/api/game/action` と新規 `/api/room/:id/action` の共通ロジック。
 * action.kind に応じて適切な engine 関数 (playSummonAsAction / placeNexusAsAction /
 * applyLegalAction) を呼び分け、必要なら autoPaymentSources で自動払い。
 * body から追加 payload (paymentSources / corePlacements / coreShoot 分配等) を抽出。
 *
 * カード定義未解決時 (致命的状態) は Error を throw。caller 側で 400 系エラーにする。
 */
export function executeAction(input: {
  state: GameState;
  actingPlayerId: string;
  action: LegalAction;
  body: Record<string, unknown>;
}): { state: GameState } {
  const { state, actingPlayerId, action, body } = input;

  const passthrough = extractApplyOptionsFromBody(body);

  if (action.kind === "summon" || action.kind === "place_nexus") {
    const card = state.cardInstances.find(
      (c: CardInstance) => c.instanceId === action.sourceInstanceId
    );
    const def = card ? defLookup(card.definitionId) : undefined;
    if (!def) {
      throw new Error(
        `Card definition not found for ${action.kind} action: ${action.sourceInstanceId}`
      );
    }
    // 通常召喚/配置は engine.applyLegalAction 経由で実行する。メインステップ中の
    // ターンプレイヤーの召喚/配置は applyLegalAction が
    // useSummonInStackContextAsAction / usePlaceNexusInStackContextAsAction →
    // openStackWindow でスタック窓を開き、窓クローズ後に維持コア配置を
    // pendingEnterFieldPlacement として遅延させる。
    //
    // 旧実装は playSummonAsAction / placeNexusAsAction を直接呼んでおり、これは
    // スタック窓を開かず即時に場入りする経路だった (client の楽観 applyLegalAction とは
    // 別経路)。このため (1) 召喚/配置のスタックタイミングが server で発生しない、
    // (2) 即時場入り時に enterFieldCorePlacements 未指定だと spirit (最低1コア) で
    //     "Not enough enter-field cores selected" になる、(3) client (遅延) と
    //     server (即時) の state 乖離、を招いていた。applyLegalAction に統一して解消する。
    //
    // enterFieldCorePlacements は明示時のみ渡す (未指定なら遅延)。paymentSources は
    // 支払い前の場入りがある召喚は補完せず、その配置後に共通の支払い選択へ渡す。
    const explicitPayments = passthrough.paymentSources as
      | readonly import("@orica/rules-core").CardCostPaymentSource[]
      | undefined;
    const explicitPlacements = passthrough.enterFieldCorePlacements as
      | readonly import("@orica/rules-core").EnterFieldCorePlacement[]
      | undefined;
    const {
      paymentSources: _paymentSources,
      enterFieldCorePlacements: _enterFieldCorePlacements,
      ...restPassthrough
    } = passthrough;
    void _paymentSources;
    void _enterFieldCorePlacements;
    const result = engine.applyLegalAction({
      state,
      action,
      getCardDefinitionById: defLookup,
      ...effectLookups,
      ...restPassthrough,
      ...(explicitPayments !== undefined
        ? { paymentSources: explicitPayments }
        : action.kind === "summon" &&
            engine.findTokenPoolPreCostForcedCombineTrigger(
              state,
              actingPlayerId,
              action.sourceInstanceId,
              defLookup
            )
          ? {}
          : {
              paymentSources: autoPaymentSources(
                state,
                actingPlayerId,
                action,
                def
              ),
            }),
      ...(explicitPlacements !== undefined
        ? { enterFieldCorePlacements: explicitPlacements }
        : {}),
    });
    return { state: result.state };
  }

  if (action.kind === "use_magic") {
    const card = state.cardInstances.find(
      (c: CardInstance) => c.instanceId === action.sourceInstanceId
    );
    const def = card ? defLookup(card.definitionId) : undefined;
    if (!def) {
      throw new Error(
        `Card definition not found for use_magic action: ${action.sourceInstanceId}`
      );
    }
    const isFreeUse = action.costMode === "free";
    const explicitPayments = passthrough.paymentSources as
      | readonly import("@orica/rules-core").CardCostPaymentSource[]
      | undefined;
    const { paymentSources: _ignored, ...restPassthrough } = passthrough;
    void _ignored;
    const result = engine.applyLegalAction({
      state,
      action,
      getCardDefinitionById: defLookup,
      ...effectLookups,
      ...restPassthrough,
      paymentSources:
        explicitPayments ??
        (isFreeUse
          ? []
          : autoPaymentSources(state, actingPlayerId, action, def)),
    });
    return { state: result.state };
  }

  if (action.kind === "resolve_pending_core_shoot") {
    const dist = body.coreShootDistribution as
      | Record<string, number>
      | undefined;
    const soulId = body.coreShootSoulCoreInstanceId as string | undefined;
    let distribution = dist;
    if (!distribution && state.pendingCoreShootSelection) {
      const pending = state.pendingCoreShootSelection;
      distribution = {};
      let rem = pending.totalAmount;
      for (const c of pending.candidates) {
        if (rem <= 0) break;
        const take = Math.min(rem, c.availableCores);
        distribution[c.instanceId] = take;
        rem -= take;
      }
    }
    const {
      coreShootDistribution: _ignoredDist,
      coreShootSoulCoreInstanceId: _ignoredSoul,
      ...restPassthrough
    } = passthrough;
    void _ignoredDist;
    void _ignoredSoul;
    const result = engine.applyLegalAction({
      state,
      action,
      getCardDefinitionById: defLookup,
      ...effectLookups,
      ...restPassthrough,
      ...(distribution ? { coreShootDistribution: distribution } : {}),
      ...(soulId ? { coreShootSoulCoreInstanceId: soulId } : {}),
    });
    return { state: result.state };
  }

  // generic: applyLegalAction (汎用 passthrough)
  const result = engine.applyLegalAction({
    state,
    action,
    getCardDefinitionById: defLookup,
    ...effectLookups,
    ...passthrough,
  });
  return { state: result.state };
}

interface ServerAutoDrainStep {
  actingPlayerId: string;
  actionId: string;
  kind: string;
}

function actionHasChoice(action: LegalAction): boolean {
  return (
    "choiceIndex" in action &&
    (action as { choiceIndex?: number }).choiceIndex !== undefined
  );
}

function actionNeedsPlayerInput(action: LegalAction): boolean {
  const record = action as unknown as Record<string, unknown>;
  const required = (action as { requiredTargetCount?: number })
    .requiredTargetCount;
  const max = (action as { maxTargetCount?: number }).maxTargetCount;
  const requiredPayCostAmount = (action as { requiredPayCostAmount?: number })
    .requiredPayCostAmount;
  if (
    (required !== undefined && required > 0) ||
    (max !== undefined && max > 0) ||
    (requiredPayCostAmount !== undefined && requiredPayCostAmount > 0)
  ) {
    return true;
  }

  const positiveNumberFields = [
    "requiredCountCostAmount",
    "paidPreventionImmunityCardCostAmount",
    "requiredCount",
    "requiredTotal",
    "requiredCost",
  ];
  if (
    positiveNumberFields.some((field) => {
      const value = record[field];
      return typeof value === "number" && value > 0;
    })
  ) {
    return true;
  }

  const requiredBooleanFields = [
    "requiresChosenLifeCoreKind",
    "requiresEnterFieldCorePlacements",
    "requiresFreeDestinationChoice",
    "requiresPerCardDestinationChoice",
    "replacementSelectionRequired",
  ];
  if (requiredBooleanFields.some((field) => record[field] === true)) {
    return true;
  }

  const requiredObjectFields = [
    "requiredSelectedTargetsCountCost",
    "requiredCoreMoveCost",
    "requiredDiscardCost",
    "targetTotalSelection",
  ];
  if (requiredObjectFields.some((field) => record[field] != null)) {
    return true;
  }

  const targetGroups = record.targetGroups;
  if (
    Array.isArray(targetGroups) &&
    targetGroups.some((group) => {
      const requiredCount = (group as { requiredTargetCount?: unknown })
        .requiredTargetCount;
      const maxCount = (group as { maxTargetCount?: unknown }).maxTargetCount;
      return (
        (typeof requiredCount === "number" && requiredCount > 0) ||
        (typeof maxCount === "number" && maxCount > 0)
      );
    })
  ) {
    return true;
  }

  const followUpOptions = record.targetFollowUpMagicOptions;
  if (Array.isArray(followUpOptions) && followUpOptions.length > 0) {
    return true;
  }

  const placementOptions = record.targetEnterFieldCorePlacementOptions;
  if (
    Array.isArray(placementOptions) &&
    placementOptions.some(
      (option) =>
        (option as { requiresEnterFieldCorePlacements?: unknown })
          .requiresEnterFieldCorePlacements === true
    )
  ) {
    return true;
  }

  return false;
}

function isMandatoryExecution(action: LegalAction): boolean {
  return !(
    "executionMode" in action &&
    (action as { executionMode?: string }).executionMode === "optional"
  );
}

function actionEffectIncludesSelfSummon(
  state: GameState,
  action: LegalAction
): boolean {
  const sourceInstanceId = (action as { sourceInstanceId?: string })
    .sourceInstanceId;
  if (!sourceInstanceId) return false;
  const sourceCard = state.cardInstances.find(
    (card) => card.instanceId === sourceInstanceId
  );
  const sourceDefinition = sourceCard
    ? defLookup(sourceCard.definitionId)
    : undefined;
  if (!sourceDefinition?.effects) return false;
  for (const effect of sourceDefinition.effects) {
    if (effect.timing.kind === "activated") continue;
    for (const step of effect.steps) {
      if (step.action.kind === "summon" && step.action.target.kind === "self") {
        return true;
      }
    }
  }
  return false;
}

function isServerAutoDrainAction(
  state: GameState,
  action: LegalAction
): boolean {
  if (actionHasChoice(action)) return false;
  if (action.kind === "open_battle_flash") return true;
  if (action.kind === "resolve_pending_burst_check") {
    return (action as { sourceInstanceId?: string }).sourceInstanceId == null;
  }
  if (
    action.kind === "resolve_battle_immediate_effect" ||
    action.kind === "resolve_pending_triggered_effect"
  ) {
    if (!isMandatoryExecution(action)) return false;
    if (actionNeedsPlayerInput(action)) return false;
    if (actionEffectIncludesSelfSummon(state, action)) return false;
    return true;
  }
  return false;
}

export function autoDrainRoomState(
  state: GameState,
  maxSteps = 8
): { state: GameState; steps: ServerAutoDrainStep[] } {
  let current = state;
  const steps: ServerAutoDrainStep[] = [];
  for (let i = 0; i < maxSteps; i++) {
    if (current.gameResult || current.preGame) break;
    const actorIds = [
      ...engine.getCurrentActorPlayerIds(current, {
        getCardDefinitionById: defLookup,
        ...effectLookups,
      }),
    ];
    if (actorIds.length !== 1) break;
    const actingPlayerId = actorIds[0]!;
    const actions = engine.getLegalActions({
      state: current,
      actingPlayerId,
      getCardDefinitionById: defLookup,
      ...effectLookups,
    });
    if (actions.length === 0) break;
    const safeActions = actions.filter((action) =>
      isServerAutoDrainAction(current, action)
    );
    if (safeActions.length !== 1 || safeActions.length !== actions.length) {
      break;
    }
    const action = safeActions[0]!;
    current = executeAction({
      state: current,
      actingPlayerId,
      action,
      body: { actionId: action.actionId },
    }).state;
    steps.push({
      actingPlayerId,
      actionId: action.actionId,
      kind: action.kind,
    });
  }
  return { state: current, steps };
}

function replayServerAutoDrainIfNeeded(
  state: GameState,
  payload: Record<string, unknown>
): GameState {
  return payload.serverAutoDrain === true
    ? autoDrainRoomState(state).state
    : state;
}

// --- P3-64 Phase C-5: replay event を base state に再適用する pure helpers ---
//
// dispatch endpoint 6 種それぞれの engine 実行ロジックを、HTTP context (auth / CAS /
// SSE broadcast) から切り離して再利用可能にした版。`replayEvent` が endpoint 種別で
// 振り分け、`/api/room/:id/replay/restore` から呼ばれる。
//
// 設計前提:
// - replay 時の validation は最小限。元 dispatch 時に既に検証済みのため、actor 確認や
//   legal action 検索の失敗は「state drift / event 列汚染」として throw する (caller が捕捉)
// - body から取得するフィールドは sanitizeReplayPayload で allowlist 済みのものだけ
// - effectLookups / defLookup は middleware で初期化済みのモジュールスコープ参照を使用

export function replayActionEvent(
  state: GameState,
  actorPlayerId: string,
  body: Record<string, unknown>
): GameState {
  const actionId = body.actionId as string | undefined;
  if (!actionId) throw new Error("replay: actionId missing");
  const actions = engine.getLegalActions({
    state,
    actingPlayerId: actorPlayerId,
    getCardDefinitionById: defLookup,
    ...effectLookups,
  });
  const action = actions.find((a: LegalAction) => a.actionId === actionId);
  if (!action) {
    throw new Error(
      `replay: actionId "${actionId}" not in legal actions for ${actorPlayerId} (state drift?)`
    );
  }
  return executeAction({ state, actingPlayerId: actorPlayerId, action, body })
    .state;
}

export const ROOM_GAMEPLAY_COMMANDS = [
  "action",
  "step",
  "core-move",
  "brave-separation",
  "pregame-update",
] as const;
export type RoomGameplayCommand = (typeof ROOM_GAMEPLAY_COMMANDS)[number];

export class RoomGameplayError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

export function roomLegalActions(
  state: GameState,
  actingPlayerId: string
): LegalAction[] {
  return engine.getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById: defLookup,
    ...effectLookups,
  });
}

/** Gameplay only. Authentication, version/CAS and persistence belong to the host. */
export function applyRoomGameplayCommand(
  state: GameState,
  actor: string,
  command: RoomGameplayCommand,
  body: Record<string, unknown>
): GameState {
  if (!state.players.some((player) => player.id === actor))
    throw new RoomGameplayError("Not a player role.", 403);
  if (command === "action" || command === "brave-separation") {
    const allowed = engine.getCurrentActorPlayerIds(state, {
      getCardDefinitionById: defLookup,
      ...effectLookups,
    });
    if (!allowed.has(actor))
      throw new RoomGameplayError(
        `Not current actor: allowed=[${[...allowed].join(",")}], requester=${actor}`,
        403
      );
    if (command === "brave-separation")
      return replayBraveSeparationEvent(state, actor, body);
    const action = roomLegalActions(state, actor).find(
      (a) => a.actionId === body.actionId
    );
    if (!action)
      throw new RoomGameplayError(
        `actionId "${body.actionId}" not in legal actions for ${actor}.`
      );
    return executeAction({ state, actingPlayerId: actor, action, body }).state;
  }
  if (command === "step" || command === "core-move") {
    if (actor !== state.activePlayerId)
      throw new RoomGameplayError(
        `${command === "step" ? "Step advance" : "Core move"} allowed only for activePlayerId=${state.activePlayerId}, requester=${actor}`,
        403
      );
    if (command === "step") return replayStepEvent(state);
    if (state.step !== "main")
      throw new RoomGameplayError("Core move allowed only in main step.", 403);
    const blocker = engine.getGameProgressBlockerReason(state);
    if (blocker) throw new RoomGameplayError(`Core move blocked: ${blocker}`);
    const drafts = readManualCoreMoveDrafts(body, "core-move");
    const violation = engine.findManualCoreMoveViolation(
      state,
      drafts,
      defLookup
    );
    if (violation) throw new RoomGameplayError(violation.reason);
    return replayCoreMoveEvent(state, body);
  }
  if (command === "pregame-update")
    return replayPregameUpdateEvent(state, body, actor);
  throw new RoomGameplayError("Unknown gameplay command.", 404);
}

export function replayStepEvent(state: GameState): GameState {
  return engine.advanceStep(
    state,
    defLookup,
    effectLookups.getRegisteredTriggeredEffectActions,
    effectLookups.getRegisteredBurstActions,
    effectLookups.getRegisteredMagicActions
  );
}

export function replayClaimVictoryEvent(
  state: GameState,
  winnerPlayerId: string,
  body: Record<string, unknown>
): GameState {
  if (state.gameResult) {
    throw new Error("replay: claim-victory but game already ended");
  }
  const reason =
    (body.reason as string | undefined) ?? "opponent_disconnect_timeout";
  const loser = state.players.find((p: PlayerState) => p.id !== winnerPlayerId);
  if (!loser) throw new Error("replay: claim-victory loser not found");
  return {
    ...state,
    gameResult: {
      kind: "player_loss" as const,
      losingPlayerId: loser.id,
      reason,
    },
  };
}

function readManualCoreMoveDrafts(
  body: Record<string, unknown>,
  detail: string
): ReadonlyArray<import("@orica/rules-core").DraftCoreMove> {
  const drafts = body.coreMoveDrafts as
    | ReadonlyArray<import("@orica/rules-core").DraftCoreMove>
    | undefined;
  if (!Array.isArray(drafts) || drafts.length === 0) {
    throw new Error(`${detail}: coreMoveDrafts missing`);
  }
  for (const [index, draft] of drafts.entries()) {
    if (draft?.purpose !== "core_move") {
      throw new Error(
        `${detail}: coreMoveDrafts[${index}].purpose must be core_move`
      );
    }
  }
  return drafts;
}

export function replayCoreMoveEvent(
  state: GameState,
  body: Record<string, unknown>
): GameState {
  const drafts = readManualCoreMoveDrafts(body, "replay");
  let next = engine.applyDraftCoreMoves(state, drafts, defLookup);
  const sba = engine.runStateBasedActions(next, defLookup);
  if (sba.checks.length > 0) {
    next = engine.flushPendingLeaves(sba.state, defLookup);
  }
  return engine.recomputeAndRebuildContinuousEffects(next, defLookup);
}

export function replayBraveSeparationEvent(
  state: GameState,
  actorPlayerId: string,
  body: Record<string, unknown>
): GameState {
  const actionId = body.actionId as string | undefined;
  const separateCoreDistribution = body.separateCoreDistribution as
    | Record<string, number>
    | undefined;
  const soulSource = body.separationSoulCoreSource as string | undefined;
  const braveInstanceId = body.braveInstanceId as string | undefined;
  if (!actionId) throw new Error("replay: brave-separation actionId missing");
  if (!separateCoreDistribution)
    throw new Error("replay: separateCoreDistribution missing");

  const actions = engine.getLegalActions({
    state,
    actingPlayerId: actorPlayerId,
    getCardDefinitionById: defLookup,
    ...effectLookups,
  });
  const action = actions.find((a: LegalAction) => a.actionId === actionId);
  if (!action) {
    throw new Error(
      `replay: brave-separation actionId "${actionId}" not in legal actions`
    );
  }
  if (
    action.kind !== "brave_separate" &&
    !(action.kind === "resolve_brave_leave_choice" && action.choice === "keep")
  ) {
    throw new Error(
      `brave-separation: actionId "${actionId}" must separate a brave or keep it on the field (kind=${action.kind})`
    );
  }
  return applyBraveSeparationWithCores(
    {
      state,
      action,
      getCardDefinitionById: defLookup,
      ...effectLookups,
      separateCoreDistribution,
    },
    soulSource,
    braveInstanceId
  ).state;
}

type JankenHand = "rock" | "scissors" | "paper";

/** じゃんけんの勝敗をサーバが判定する。"a"=h0 勝ち / "b"=h1 勝ち / "draw"=あいこ。 */
function resolveJanken(h0: JankenHand, h1: JankenHand): "a" | "b" | "draw" {
  if (h0 === h1) return "draw";
  const beats: Record<JankenHand, JankenHand> = {
    rock: "scissors",
    scissors: "paper",
    paper: "rock",
  };
  return beats[h0] === h1 ? "a" : "b";
}

/**
 * 確定済みの入力 (先後 / じゃんけん勝者 / マリガン) から phase をサーバが導出する。
 * クライアント送信の `phase` は一切信用しない (グローバル遷移をクライアント任意に
 * 押し込めないようにする = 今回の root fix)。
 */
function derivePregamePhase(d: {
  contractCandidatePlayerIds?: readonly string[];
  contractPresentationChoices?: Record<string, boolean>;
  contractConfirmed?: Record<string, boolean>;
  firstPlayerId: string | null;
  jankenWinner: string | null;
  drawNow: boolean;
  mulliganDone: Record<string, boolean>;
  players: { id: string }[];
}): PreGamePhase {
  const contractCandidatePlayerIds = d.contractCandidatePlayerIds ?? [];
  if (contractCandidatePlayerIds.length > 0) {
    const allPresentationChoicesDone = contractCandidatePlayerIds.every(
      (id) => d.contractPresentationChoices?.[id] !== undefined
    );
    if (!allPresentationChoicesDone) return "waiting_contract";
    const allConfirmed = d.players.every(
      (player) => d.contractConfirmed?.[player.id] === true
    );
    if (!allConfirmed) return "contract_confirm";
  }
  if (d.firstPlayerId != null) {
    const secondId = d.players.find((p) => p.id !== d.firstPlayerId)?.id;
    const firstDone = d.mulliganDone[d.firstPlayerId] !== undefined;
    const secondDone =
      secondId != null && d.mulliganDone[secondId] !== undefined;
    if (firstDone && secondDone) return "pregame_complete";
    if (firstDone) return "waiting_mulligan_second";
    return "order_decided";
  }
  if (d.jankenWinner != null) return "waiting_order_pick";
  if (d.drawNow) return "janken_resolved";
  return "waiting_janken";
}

/**
 * pregame-update をサーバ権威で適用する。ライブ経路 (POST /pregame-update) と
 * replay 経路の共通実装。
 *
 * 設計 (2026-06-19 server-authoritative 化):
 * 各リクエストは「**プレイヤー X が自分の入力を宣言する**」もので、グローバルな帰結は
 * すべてサーバが導出する。クライアント送信の `phase` / `jankenWinner` は信用しない。
 * - 契約提示: actor 自身の提示する/しないだけ採用。全員分が揃ったらサーバが初期手札と
 *   `contractCardNo` を確定し、確認フェーズを挟んでからじゃんけんへ進める。
 * - じゃんけんの手: actor 自身の分のみ採用。`jankenRound` 不一致 (旧ラウンドの遅延再送)
 *   は破棄。両者の手が揃ったらサーバが勝敗を判定し、あいこは round++ して表示用に手を残す。
 * - 先後選択: `firstPlayerId` は **じゃんけん勝者** のリクエストでのみ採用。一度確定したら
 *   据え置き (null へ戻さない)。null→確定で order + `game:first_player_set` を確定。
 * - マリガン: 先後確定後、actor 自身の未記録分のみ採用 (二重押下 / CAS リトライによる
 *   再シャッフル = 不正な 2 回目マリガンを遮断)。新規 true のみ `mulligan:<id>` を push。
 * - finalize (preGame=null + 開始ステップ): phase が導出で `pregame_complete` に達した
 *   とき = 先後確定 ＆ 両者マリガン選択済みのときだけ。
 * - マリガンは新規 true の actor についてサーバ state 上で実行する。クライアントからは
 *   yes/no だけを受け、手札内容・デッキ順・stateOverrides は採用しない。
 *
 * `actorPlayerId` が null の文脈 (actor 不明の旧 replay 等) では入力スコープを
 * 全プレイヤーへフォールバックし、互換のため partial に含まれる分を採用する。
 */
function applyPregameUpdate(
  state: GameState,
  partial: Partial<import("@orica/rules-core").PreGameState>,
  actorPlayerId: string | null
): GameState {
  const fresh = state.preGame!;
  const allIds = state.players.map((p) => p.id);
  // 入力を attribute するプレイヤー集合。actor 明示時はその 1 名のみ (per-player scope)。
  const scopedIds = actorPlayerId != null ? [actorPlayerId] : allIds;

  let workingState = state;
  const contractCandidateCardNos = {
    ...(fresh.contractCandidateCardNos ?? {}),
  };
  const contractCandidateInstanceIds = {
    ...(fresh.contractCandidateInstanceIds ?? {}),
  };
  const contractCandidatePlayerIds = Object.keys(contractCandidateCardNos);
  const contractPresentationChoices = {
    ...(fresh.contractPresentationChoices ?? {}),
  };
  const contractConfirmed = { ...(fresh.contractConfirmed ?? {}) };

  if (contractCandidatePlayerIds.length > 0) {
    if (
      fresh.phase === "waiting_contract" &&
      partial.contractPresentationChoices
    ) {
      for (const id of scopedIds) {
        if (!(id in contractCandidateCardNos)) continue;
        if (contractPresentationChoices[id] !== undefined) continue;
        const choice = partial.contractPresentationChoices[id];
        if (choice !== undefined) contractPresentationChoices[id] = choice;
      }
    }

    const allChoicesDone = contractCandidatePlayerIds.every(
      (id) => contractPresentationChoices[id] !== undefined
    );
    if (fresh.phase === "waiting_contract" && allChoicesDone) {
      workingState = engine.applyGameStartEffects(
        engine.applyContractPresentationChoices(
          state,
          contractPresentationChoices
        ),
        defLookup
      );
    }

    if (
      (fresh.phase === "contract_confirm" ||
        (fresh.phase === "waiting_contract" && allChoicesDone)) &&
      partial.contractConfirmed
    ) {
      for (const id of scopedIds) {
        if (partial.contractConfirmed[id] === true)
          contractConfirmed[id] = true;
      }
    }
  }

  const contractReadyForJanken =
    contractCandidatePlayerIds.length === 0 ||
    (contractCandidatePlayerIds.every(
      (id) => contractPresentationChoices[id] !== undefined
    ) &&
      workingState.players.every(
        (player) => contractConfirmed[player.id] === true
      ));

  let jankenHands = { ...fresh.jankenHands };
  let jankenRound = fresh.jankenRound ?? 0;
  let jankenWinner = fresh.jankenWinner;
  let firstPlayerId = fresh.firstPlayerId;

  // 1. じゃんけんの手 (actor 自分の分のみ・ラウンド一致時のみ)。
  if (contractReadyForJanken && jankenWinner == null && firstPlayerId == null) {
    const roundOk =
      partial.jankenRound == null || partial.jankenRound === jankenRound;
    if (roundOk && partial.jankenHands) {
      const incoming = partial.jankenHands;
      const addIds = scopedIds.filter((id) => incoming[id] != null);
      // 直前があいこ表示 (janken_resolved) のとき、新規入力が来たら旧ラウンドの
      // 表示用の手をクリアして新ラウンドを開始する。
      if (addIds.length > 0 && fresh.phase === "janken_resolved") {
        jankenHands = {};
      }
      for (const id of addIds) jankenHands[id] = incoming[id]!;
    }
  }

  // 2. 両者の手が揃ったらサーバが勝敗を導出。あいこは round++ で次ラウンドへ。
  let drawNow = false;
  if (contractReadyForJanken && jankenWinner == null && firstPlayerId == null) {
    const h0 = jankenHands[allIds[0]!];
    const h1 = jankenHands[allIds[1]!];
    if (h0 && h1) {
      const r = resolveJanken(h0, h1);
      if (r === "draw") {
        drawNow = true;
        // round の二重 increment 防止: あいこ表示からの冪等な再評価では上げない。
        if (fresh.phase !== "janken_resolved") jankenRound += 1;
      } else {
        jankenWinner = r === "a" ? allIds[0]! : allIds[1]!;
      }
    }
  }

  // 3. 先後選択 (じゃんけん勝者のリクエストでのみ採用)。
  if (firstPlayerId == null && jankenWinner != null) {
    const pick = partial.firstPlayerId;
    const validPick = pick != null && allIds.includes(pick);
    const actorIsWinner =
      actorPlayerId == null || actorPlayerId === jankenWinner;
    if (validPick && actorIsWinner) firstPlayerId = pick!;
  }

  // 4. マリガン (先後確定後・actor 自分の未記録分のみ)。
  const mulliganDone = { ...fresh.mulliganDone };
  const newlyMulliganedTrue: string[] = [];
  if (firstPlayerId != null && partial.mulliganDone) {
    for (const id of scopedIds) {
      const choice = partial.mulliganDone[id];
      if (choice !== undefined && mulliganDone[id] === undefined) {
        mulliganDone[id] = choice;
        if (choice === true) newlyMulliganedTrue.push(id);
      }
    }
  }

  // 5. phase をサーバが導出 (クライアント送信 phase は無視)。
  const phase = derivePregamePhase({
    firstPlayerId,
    jankenWinner,
    drawNow,
    mulliganDone,
    contractCandidatePlayerIds,
    contractPresentationChoices,
    contractConfirmed,
    players: workingState.players,
  });

  const nextPreGame = {
    ...fresh,
    phase,
    ...(contractCandidatePlayerIds.length > 0
      ? {
          contractCandidateInstanceIds,
          contractCandidateCardNos,
          contractPresentationChoices,
          contractConfirmed,
        }
      : {}),
    firstPlayerId,
    jankenHands,
    jankenRound,
    jankenWinner,
    mulliganDone,
  };

  const baseLog = [...(workingState.log ?? [])];
  const logAdditions: string[] = [];

  // 先後決定: null → 確定 の遷移を検知して order + log をサーバ確定。
  let orderFields: Partial<GameState> = {};
  if (fresh.firstPlayerId == null && firstPlayerId != null) {
    const secondId =
      workingState.players.find((p) => p.id !== firstPlayerId)?.id ??
      workingState.playerOrder[1]!;
    orderFields = {
      activePlayerId: firstPlayerId,
      playerOrder: [firstPlayerId, secondId],
    };
    logAdditions.push(`game:first_player_set:${firstPlayerId}`);
  }

  // マリガン: 新規に true 確定したプレイヤーのみ log を push。
  for (const pid of newlyMulliganedTrue) logAdditions.push(`mulligan:${pid}`);

  // 新規 true の actor について、サーバ state 上で戻す→shuffle→4枚 draw を実行する。
  // mulliganHand は legacy API 互換で log 配列へ push するため、入力 state の
  // 配列を共有しない。最終 log は下で server-derived additions から再構築する。
  let mergedState = { ...workingState, log: [...baseLog] };
  for (const playerId of newlyMulliganedTrue) {
    mergedState = applyServerMulligan(mergedState, playerId, defLookup);
  }

  let result: GameState = {
    ...mergedState,
    ...orderFields,
    preGame: nextPreGame,
    log: [...baseLog, ...logAdditions],
  };

  // pregame_complete はサーバ側で確定する (preGame=null + 開始ステップトリガ)。
  // engine 未ロードの単体テスト文脈では finalize をスキップ (engine===undefined)。
  if (engine && phase === "pregame_complete") {
    result = engine.queueInitialStartStepTrigger(
      { ...result, preGame: null },
      defLookup,
      effectLookups.getRegisteredTriggeredEffectActions
    );
  }
  return result;
}

export function replayPregameUpdateEvent(
  state: GameState,
  body: Record<string, unknown>,
  actorPlayerId: string | null = null
): GameState {
  const partial = body.preGame as
    | Partial<import("@orica/rules-core").PreGameState>
    | undefined;
  if (!partial) throw new Error("replay: pregame-update preGame missing");
  if (!state.preGame) {
    throw new Error("replay: pregame-update but state.preGame is null");
  }
  return applyPregameUpdate(state, partial, actorPlayerId);
}

/**
 * 1 件の replay event を base state に再適用する。
 *
 * 元 dispatch 時の payload (sanitizeReplayPayload で allowlist 済み) を再実行し、
 * 新しい GameState を返す。validation は最小限 (caller が event 列の整合性を保証する想定)。
 *
 * 例外:
 * - actorPlayerId 不整合 / actionId 欠落 / state drift 検出時は Error throw
 * - caller (POST /replay/restore) で 4xx エラーとして返す
 */
export function replayEvent(
  state: GameState,
  event: {
    acting_player_id: string;
    endpoint: ReplayEventEndpoint;
    payload: Record<string, unknown>;
  }
): GameState {
  const { acting_player_id: actorPlayerId, endpoint, payload } = event;
  const applyEvent = (): GameState => {
    switch (endpoint) {
      case "action":
        return replayServerAutoDrainIfNeeded(
          replayActionEvent(state, actorPlayerId, payload),
          payload
        );
      case "step":
        return replayServerAutoDrainIfNeeded(replayStepEvent(state), payload);
      case "claim-victory":
        return replayServerAutoDrainIfNeeded(
          replayClaimVictoryEvent(state, actorPlayerId, payload),
          payload
        );
      case "core-move":
        return replayServerAutoDrainIfNeeded(
          replayCoreMoveEvent(state, payload),
          payload
        );
      case "brave-separation":
        return replayServerAutoDrainIfNeeded(
          replayBraveSeparationEvent(state, actorPlayerId, payload),
          payload
        );
      case "pregame-update":
        return replayServerAutoDrainIfNeeded(
          replayPregameUpdateEvent(state, payload, actorPlayerId),
          payload
        );
      case "replay-restore": {
        const restoredState = payload.state as GameState | undefined;
        if (!restoredState) throw new Error("replay: restore state missing");
        const validationError = validateGameState(restoredState);
        if (validationError) {
          throw new Error(`replay: restore state invalid: ${validationError}`);
        }
        return normalizePersistedState(restoredState);
      }
    }
  };

  if (payload.randomTraceVersion === undefined) {
    if (
      payload.randomSeed !== undefined ||
      payload.randomDrawCount !== undefined
    ) {
      throw new Error("replay: incomplete random trace metadata");
    }
    const legacyRandomContext = createRoomMutationRandomContext();
    const legacyResult = runWithRoomMutationRandom(
      legacyRandomContext,
      applyEvent
    );
    if (legacyRandomContext.drawCount > 0) {
      throw new Error(
        "replay: legacy random event requires a server checkpoint"
      );
    }
    return legacyResult;
  }
  if (
    payload.randomTraceVersion !== ROOM_RANDOM_TRACE_VERSION ||
    typeof payload.randomDrawCount !== "number" ||
    !Number.isInteger(payload.randomDrawCount) ||
    payload.randomDrawCount < 0 ||
    (payload.randomDrawCount > 0 && typeof payload.randomSeed !== "number") ||
    (payload.randomSeed !== undefined && typeof payload.randomSeed !== "number")
  ) {
    throw new Error("replay: invalid random trace metadata");
  }
  const randomContext = createRoomMutationRandomContext(
    payload.randomSeed as number | undefined
  );
  const result = runWithRoomMutationRandom(randomContext, applyEvent);
  if (randomContext.drawCount !== payload.randomDrawCount) {
    throw new Error(
      `replay: random draw drift (expected=${payload.randomDrawCount}, actual=${randomContext.drawCount})`
    );
  }
  return result;
}

function json(res: ServerResponse, data: unknown, status = 200) {
  const timing = (res as TimedServerResponse).__roomTiming;
  if (timing && !res.headersSent) {
    res.setHeader("Server-Timing", timing.toHeader());
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, msg: string, status = 400) {
  json(res, { error: msg }, status);
}

/**
 * 認証済みユーザーが対象ルームの参加者か検証する。
 * 戻り値が null なら参加者として OK、文字列ならエラーメッセージ。
 *
 * 6 桁 roomId は推測可能なため、room.players に含まれない第三者が
 * state push / start などの状態変更系エンドポイントを叩けないよう保護する。
 */
export function requireRoomMember(
  room: { players: ReadonlyArray<{ supabaseUserId: string }> },
  authenticatedUserId: string | null
): string | null {
  if (!authenticatedUserId) return "Authentication required.";
  const isMember = room.players.some(
    (p) => p.supabaseUserId === authenticatedUserId
  );
  return isMember ? null : "Not a player in this room.";
}

// --- Vite plugin ---
/**
 * ブラウザ側と API 側が同じ rules-core / card-data 世代を使うため、API が native import で
 * キャッシュしている依存が変わったときだけ Vite server を再起動する。
 */
export function shouldRestartGameApiForHotUpdate(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  return (
    normalized.includes("/packages/rules-core/src/") ||
    normalized.includes("/packages/card-data/src/")
  );
}

export function gameApiPlugin(): Plugin {
  return {
    name: "game-api",
    async handleHotUpdate(context) {
      if (!shouldRestartGameApiForHotUpdate(context.file)) return;
      context.server.config.logger.info(
        `[game-api] ${context.file} changed; restarting to keep client/server rules in sync.`
      );
      await context.server.restart();
      return [];
    },
    configureServer(server) {
      const stopCleanup = startRoomMaintenance();
      server.httpServer?.once("close", stopCleanup);
      registerGameApiMiddlewares(
        (middleware) => server.middlewares.use(middleware),
        { includeLegacy: true }
      );
    },
  };
}

/** 本番は room / snapshot のみ。開発用の単一ゲーム API は明示的に有効化する。 */
export function registerGameApiMiddlewares(
  use: (middleware: Connect.NextHandleFunction) => void,
  { includeLegacy = false }: { includeLegacy?: boolean } = {}
): void {
  const memberAdmission = createApiAdmission({
    peerRequestsPerSecond: 15,
    peerBurst: 30,
    maxPeerStreams: 3,
    maxPeerActiveRequests: 8,
  });
  let readiness: { until: number; value: Promise<boolean> } | null = null;
  use(async (req, res, next) => {
    if (req.url !== "/readyz" || req.method !== "GET") return next();
    if (!readiness || Date.now() >= readiness.until) {
      readiness = {
        until: Date.now() + 5_000,
        value: checkRoomNetworkReadiness(),
      };
    }
    const ok = await readiness.value;
    return json(
      res,
      { ok, revision: process.env.ORICA_API_REVISION ?? null },
      ok ? 200 : 503
    );
  });
  if (INTERVIEW_MODE) {
    use((req, _res, next) => {
      if (!req.url?.startsWith("/api/")) return next();
      return interviewRequestClient.run(createInterviewRequestClient(req), next);
    });
    use(async (req, res, next) => {
      if (!req.url?.startsWith("/api/")) return next();
      try {
        const userId = await authenticateRequest(req);
        if (!userId) return error(res, "Active interview membership required.", 401);
        (req as IncomingMessage & { __interviewUserId?: string }).__interviewUserId = userId;
        return next();
      } catch {
        return error(res, "Interview access check unavailable.", 503);
      }
    });
  }
  use((req, res, next) => {
    if (!/^\/api\/room-invitations(?:[/?]|$)/.test(req.url ?? ""))
      return next();
    void handleRoomInvitations(
      req,
      res,
      supabaseServer,
      authenticateRequest,
      readBody
    );
  });
  // --- Room API middleware ---
  const roomMiddleware: Connect.NextHandleFunction = async (req, res, next) => {
    const url = req.url ?? "";
    if (!url.startsWith("/api/room")) return next();
    const timing = new HttpTimingCollector();
    (res as TimedServerResponse).__roomTiming = timing;
    (res as TimedServerResponse).__roomRoute = url;

    try {
      // Discovery must not reuse lobby reads, which can renew a member's lease.
      if (url === "/api/room" && req.method === "GET") {
        const userId = await timing.measure("auth", () =>
          authenticateRequest(req)
        );
        if (!userId) return error(res, "Missing or invalid token.", 401);
        res.setHeader("Cache-Control", "private, no-store");
        const rooms = await timing.measure("db_list", () =>
          // 観戦者は DB の connected に記録されないため、SSE registry も空席判定へ含める。
          listUnfinishedRooms(supabaseServer, userId, hasLiveSSEConnection)
        );
        return json(res, { rooms });
      }
      // Every mutation, including leave, requires a verified JWT before DB work.
      let authenticatedUserId: string | null = null;
      if (
        req.method === "POST" ||
        req.method === "PUT" ||
        req.method === "DELETE"
      ) {
        authenticatedUserId = await timing.measure("auth", () =>
          authenticateRequest(req)
        );
        if (!authenticatedUserId)
          return error(res, "Missing or invalid token.", 401);
      }
      if (!authenticatedUserId)
        authenticatedUserId = await timing.measure("auth", () =>
          authenticateRequest(req)
        );
      if (
        authenticatedUserId &&
        !memberAdmission.admit(req, res, authenticatedUserId)
      )
        return;
      await timing.measure("load_engine", ensureEngine);
      if (allCardDefs.length === 0) {
        allCardDefs = cardData.ALL_CARDS as CardDefinition[];
        installCardLookups(allCardDefs);
      }

      // POST /api/room — ルーム作成
      if (url === "/api/room" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}");
        const userId = body.userId as string;
        const scenarioId = body.scenarioId as string | undefined;
        const spectatorModeRaw = body.spectatorMode as string | undefined;
        if (!userId) return error(res, "userId required.");
        // JWT があれば body.userId との照合
        if (authenticatedUserId && authenticatedUserId !== userId) {
          return error(res, "userId mismatch with token.", 403);
        }
        const spectatorMode: SpectatorMode =
          spectatorModeRaw === "public_link" ? "public_link" : "private";

        const roomId = await generateRoomId();
        const { error: insertErr } = await supabaseServer.from("rooms").insert({
          id: roomId,
          players: [
            { supabaseUserId: userId, role: "alice", deckCardNos: null },
          ],
          state: null,
          state_version: 0,
          scenario_id: scenarioId ?? null,
          connected: { [userId]: true },
          last_heartbeat: { [userId]: new Date().toISOString() },
          all_disconnected_at: null,
          spectator_mode: spectatorMode,
        });
        if (insertErr)
          return error(res, `DB insert failed: ${insertErr.message}`, 500);
        return json(res, { roomId, role: "alice", spectatorMode });
      }

      // /api/room/:id/* のパース
      const roomMatch = url.match(/^\/api\/room\/([a-z0-9]+)(\/.*)?$/);
      if (!roomMatch) return error(res, "Invalid room URL", 404);
      const roomId = roomMatch[1]!;
      const subPath = roomMatch[2] ?? "";

      // GET /api/room/:id — ルーム情報。state 本体を読まず lobby 表示に必要な列だけ取得。
      if (subPath === "" && req.method === "GET") {
        const roomMeta = await timing.measure("db_meta", () =>
          getRoomMeta(roomId)
        );
        if (!roomMeta) return error(res, `Room "${roomId}" not found.`, 404);
        const auth = await authorizeRoomReadAndResolveViewer(req, roomMeta);
        if (!auth.ok) return error(res, auth.message, auth.status);
        const member = roomMeta.players.find(
          (p) => p.role === auth.viewerPlayerId
        );
        // Existing lobby clients poll instead of sending heartbeat. Spectators and
        // already-left members must not keep abandoned rooms alive by reading them.
        if (
          member &&
          roomMeta.state_version === 0 &&
          roomMeta.connected[member.supabaseUserId]
        ) {
          const userId = member.supabaseUserId;
          const lastBeat = Date.parse(roomMeta.last_heartbeat?.[userId] ?? "");
          if (!Number.isFinite(lastBeat) || Date.now() - lastBeat >= 10_000) {
            await updateRoom(roomId, {
              last_heartbeat: {
                ...roomMeta.last_heartbeat,
                [userId]: new Date().toISOString(),
              },
            });
          }
        }
        return json(res, {
          roomId: roomMeta.id,
          players: roomMeta.players.map((p) => ({
            role: p.role,
            userId: p.supabaseUserId,
            deckReady: p.deckCardNos !== null,
            connected: roomMeta.connected[p.supabaseUserId] ?? false,
          })),
          ownDeckCardNos: member?.deckCardNos ?? null,
          gameStarted: roomMeta.state_version > 0,
          scenarioId: roomMeta.scenario_id,
          spectatorMode: roomMeta.spectator_mode ?? "private",
        });
      }

      // POST /api/room/:id/heartbeat — 接続維持。state 本体は不要。
      if (subPath === "/heartbeat" && req.method === "POST") {
        const roomMeta = await timing.measure("db_meta", () =>
          getRoomMeta(roomId)
        );
        if (!roomMeta) return error(res, `Room "${roomId}" not found.`, 404);
        const memberError = requireRoomMember(roomMeta, authenticatedUserId);
        if (memberError) return error(res, memberError, 403);
        const body = JSON.parse((await readBody(req)) || "{}");
        const userId = body.userId as string;
        if (authenticatedUserId && userId && authenticatedUserId !== userId) {
          return error(res, "userId mismatch with token.", 403);
        }
        if (userId) {
          const heartbeatNow = Date.now();
          await timing.measure("db_heartbeat", async () => {
            const { data, error: heartbeatError } = await supabaseServer.rpc(
              "heartbeat_room",
              { p_room_id: roomId, p_user_id: userId }
            );
            if (heartbeatError || data !== true)
              throw new RoomDependencyError("ROOM_HEARTBEAT_UNAVAILABLE");
          });
          const heartbeatRole =
            roomMeta.players.find((player) => player.supabaseUserId === userId)
              ?.role ?? null;
          renewSSEMemberLease(roomId, heartbeatRole, heartbeatNow);
        }
        const opponentDisconnected = computeOpponentDisconnected(
          roomId,
          roomMeta.players,
          roomMeta.last_heartbeat,
          roomMeta.connected,
          userId,
          Date.now()
        );
        return json(res, { ok: true, opponentDisconnected });
      }

      // GET /api/room/:id/state/version — polling 用。state 本体は不要。
      if (subPath === "/state/version" && req.method === "GET") {
        const roomMeta = await timing.measure("db_meta", () =>
          getRoomMeta(roomId)
        );
        if (!roomMeta) return error(res, `Room "${roomId}" not found.`, 404);
        const denied = await authorizeRoomRead(req, roomMeta);
        if (denied) return error(res, denied.message, denied.status);
        return json(res, { version: roomMeta.state_version });
      }

      const room = await timing.measure("db_room", () => getRoom(roomId));
      if (!room) return error(res, `Room "${roomId}" not found.`, 404);

      // DELETE /api/room/:id — 作成者 (常に最初の alice) だけが未決着ルームを削除できる。
      if (subPath === "" && req.method === "DELETE") {
        const creator = room.players.find((player) => player.role === "alice");
        if (!creator || creator.supabaseUserId !== authenticatedUserId) {
          return error(res, "Only the room creator can delete this room.", 403);
        }
        if (room.state?.gameResult) {
          return error(res, "Finished rooms cannot be deleted here.", 409);
        }
        if (
          room.players.some(
            (player) => room.connected[player.supabaseUserId]
          ) ||
          hasLiveSSEConnection(roomId)
        ) {
          return error(res, "Room is not vacant.", 409);
        }
        const { error: deleteErr } = await supabaseServer
          .from("rooms")
          .delete()
          .eq("id", roomId);
        if (deleteErr)
          return error(res, `DB delete failed: ${deleteErr.message}`, 500);
        return json(res, { ok: true });
      }

      // POST /api/room/:id/join — ルーム参加
      if (subPath === "/join" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}");
        const userId = body.userId as string;
        if (!userId) return error(res, "userId required.");
        if (authenticatedUserId && authenticatedUserId !== userId) {
          return error(res, "userId mismatch with token.", 403);
        }

        const joined = await joinRoomAtomically(supabaseServer, roomId, userId);
        return json(res, joined, joined.status ?? 200);
      }

      // 登録・準備解除とも既存の行ロック付きRPCで、相手の選択を保持する。
      if (
        subPath === "/deck" &&
        (req.method === "POST" || req.method === "DELETE")
      ) {
        const body = JSON.parse((await readBody(req)) || "{}");
        const userId = body.userId as string;
        if (!userId) return error(res, "userId required.");
        if (authenticatedUserId && authenticatedUserId !== userId) {
          return error(res, "userId mismatch with token.", 403);
        }
        let registeredDeck: string[] | null = null;
        if (req.method === "POST") {
          let deckCardNos: string[];
          try {
            deckCardNos = parseCardNos(body.deckCardNos);
          } catch (cause) {
            return error(res, (cause as Error).message);
          }
          const resolvedDeck = resolveRequestedMainDeck(deckCardNos);
          if (resolvedDeck.issues.length > 0) {
            return error(
              res,
              `Deck violates main-deck rules: ${formatMainDeckValidationIssues(resolvedDeck.issues)}`
            );
          }
          if (resolvedDeck.deck.length < engine.MIN_DECK_SIZE) {
            return error(
              res,
              `Deck must have at least ${engine.MIN_DECK_SIZE} cards, got ${resolvedDeck.deck.length}.`
            );
          }
          registeredDeck = resolvedDeck.deck.map((d) => d.cardNo);
        }

        const { data, error: deckError } = await supabaseServer.rpc(
          "set_room_deck",
          {
            p_room_id: roomId,
            p_user_id: userId,
            p_deck: registeredDeck,
          }
        );
        if (deckError)
          return error(
            res,
            "デッキ登録に失敗しました。再試行してください",
            500
          );
        return json(res, data, data.status ?? 200);
      }

      // POST /api/room/:id/start — ゲーム開始
      if (subPath === "/start" && req.method === "POST") {
        const memberError = requireRoomMember(room, authenticatedUserId);
        if (memberError) return error(res, memberError, 403);
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!isRoomMutationRequest(body) || body.expectedVersion !== 0)
          return error(
            res,
            "Invalid room start metadata. Reload the client.",
            400
          );
        const actorPlayerId = room.players.find(
          (p) => p.supabaseUserId === authenticatedUserId
        )!.role;
        if (
          await maybeRespondDuplicateMutation({
            res,
            room,
            actorPlayerId,
            body,
          })
        )
          return;
        if (room.state) return error(res, "Game already started.");
        if (room.players.length < 2) return error(res, "Need 2 players.");
        const alice = room.players.find((p) => p.role === "alice")!;
        const bob = room.players.find((p) => p.role === "bob")!;
        if (!alice.deckCardNos || !bob.deckCardNos)
          return error(res, "Both players must register decks.");

        const aliceDeck = buildDeck(alice.deckCardNos);
        const bobDeck = buildDeck(bob.deckCardNos);
        const newState = engine.initializeGame({
          playerIds: ["alice", "bob"],
          decks: [aliceDeck, bobDeck],
        });
        const clientMutationId = extractClientMutationId(body)!;
        const { data: started, error: startError } = await timing.measure(
          "db_initialize_rpc",
          async () =>
            supabaseServer
              .rpc("initialize_room_state", {
                p_room_id: roomId,
                p_expected_players: room.players,
                p_state: newState,
                p_acting_player_id: actorPlayerId,
                p_payload: {
                  state: newState,
                  requestFingerprint: mutationFingerprint(body, url),
                },
                p_client_mutation_id: clientMutationId,
              })
              .single<{
                ok: boolean;
                new_version: number;
                current_version: number;
                duplicate: boolean;
              }>()
        );
        if (startError)
          throw new RoomDependencyError("ROOM_INITIALIZE_UNAVAILABLE");
        if (!started?.ok)
          return error(res, "準備状態が変わりました。再確認してください", 409);
        if (
          !Number.isSafeInteger(started.new_version) ||
          started.new_version < 1
        )
          throw new RoomDependencyError("ROOM_INITIALIZE_UNAVAILABLE");
        return json(res, {
          ok: true,
          version: started.new_version,
          clientMutationId,
        });
      }

      // Resolve an unknown ACK transactionally, fencing a late original request.
      if (subPath === "/mutation-settle" && req.method === "POST") {
        const memberError = requireRoomMember(room, authenticatedUserId);
        if (memberError) return error(res, memberError, 403);
        const body = JSON.parse((await readBody(req)) || "{}");
        const id = extractClientMutationId(body);
        if (
          !id ||
          ![
            "start",
            "action",
            "step",
            "claim-victory",
            "core-move",
            "brave-separation",
            "pregame-update",
            "rematch",
            "reset-request",
            "reset-response",
          ].includes(body.path) ||
          !body.payload ||
          typeof body.payload !== "object" ||
          Array.isArray(body.payload)
        )
          return error(res, "Invalid operation identity.");
        const actor = room.players.find(
          (player) => player.supabaseUserId === authenticatedUserId
        )!.role;
        const { data, error: settleError } = await timing.measure(
          "db_settle",
          async () =>
            supabaseServer
              .rpc("settle_room_mutation", {
                p_room_id: roomId,
                p_client_mutation_id: id,
                p_acting_player_id: actor,
                p_fingerprint: mutationFingerprint(
                  body.payload,
                  `/api/room/${roomId}/${body.path}`
                ),
              })
              .single<{
                outcome: string;
                applied_version: number | null;
                room_version: number;
              }>()
        );
        if (
          settleError ||
          !data ||
          !["applied", "cancelled"].includes(data.outcome)
        )
          throw new RoomDependencyError("ROOM_OUTCOME_UNAVAILABLE");
        return json(res, {
          clientMutationId: id,
          outcome: data.outcome,
          appliedVersion: data.applied_version,
          roomVersion: data.room_version,
        });
      }

      // Rematches use the registered decks and the same authoritative CAS/SSE pipeline.
      // The existing replay checkpoint event also keeps server recovery deterministic.
      if (
        (subPath === "/rematch" ||
          subPath === "/reset-request" ||
          subPath === "/reset-response") &&
        req.method === "POST"
      ) {
        const memberError = requireRoomMember(room, authenticatedUserId);
        if (memberError) return error(res, memberError, 403);
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!isRoomMutationRequest(body))
          return error(res, "Invalid room mutation metadata.", 400);
        const actorPlayerId = room.players.find(
          (p) => p.supabaseUserId === authenticatedUserId
        )!.role;
        if (
          await maybeRespondDuplicateMutation({
            res,
            room,
            actorPlayerId,
            body,
          })
        )
          return;
        if (
          !Number.isInteger(body.expectedVersion) ||
          body.expectedVersion !== room.state_version
        )
          return json(
            res,
            { error: "Conflict", currentVersion: room.state_version },
            409
          );
        if (!room.state) return error(res, "Game not started.", 409);
        const reset = room.state.roomReset ?? {
          gameNumber: 0,
          requestedBy: null,
          usedBy: [],
        };
        let restart = subPath === "/rematch";
        let nextState: GameState = room.state;
        if (restart) {
          if (!room.state.gameResult)
            return error(res, "Game must be finished before a rematch.", 409);
        } else {
          if (room.state.gameResult)
            return error(res, "Game already finished. Use rematch.", 409);
          if (subPath === "/reset-request") {
            if (reset.requestedBy || reset.usedBy.includes(actorPlayerId))
              return error(res, "Reset already requested in this game.", 409);
            nextState = {
              ...room.state,
              roomReset: {
                ...reset,
                requestedBy: actorPlayerId,
                usedBy: [...reset.usedBy, actorPlayerId],
              },
            };
          } else {
            if (typeof body.approve !== "boolean")
              return error(res, "approve must be a boolean.");
            if (!reset.requestedBy)
              return error(res, "No reset request pending.", 409);
            if (reset.requestedBy === actorPlayerId)
              return error(
                res,
                "Only the opponent can respond to a reset request.",
                403
              );
            restart = body.approve;
            nextState = {
              ...room.state,
              roomReset: { ...reset, requestedBy: null },
            };
          }
        }
        if (restart) {
          const alice = room.players.find((p) => p.role === "alice");
          const bob = room.players.find((p) => p.role === "bob");
          if (!alice?.deckCardNos || !bob?.deckCardNos)
            return error(res, "Both players must register decks.");
          nextState = engine.initializeGame({
            playerIds: ["alice", "bob"],
            decks: [buildDeck(alice.deckCardNos), buildDeck(bob.deckCardNos)],
          });
          nextState.roomReset = {
            gameNumber: reset.gameNumber + 1,
            requestedBy: null,
            usedBy: [],
          };
        }
        return await finalizeRoomMutation({
          res,
          roomId,
          currentVersion: room.state_version,
          previousState: room.state,
          nextState,
          actorPlayerId,
          endpoint: "replay-restore",
          body: { state: nextState, clientMutationId: body.clientMutationId },
          requestBody: body,
        });
      }

      // POST /api/room/:id/leave — only the authenticated participant can leave.
      if (subPath === "/leave" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}");
        const userId = body.userId as string;
        if (!userId) return error(res, "userId required.");
        if (userId !== authenticatedUserId)
          return error(res, "userId mismatch with token.", 403);
        const memberError = requireRoomMember(room, authenticatedUserId);
        if (memberError) return error(res, memberError, 403);
        const connected = { ...room.connected, [userId]: false };
        const anyConnected = room.players.some(
          (p) => connected[p.supabaseUserId]
        );
        await updateRoom(roomId, {
          connected,
          all_disconnected_at: anyConnected
            ? null
            : (room.all_disconnected_at ?? new Date().toISOString()),
        });
        return json(res, { ok: true, allDisconnected: !anyConnected });
      }

      // GET /api/room/:id/state/full
      if (subPath === "/state/full" && req.method === "GET") {
        const auth = await authorizeRoomReadAndResolveViewer(req, room);
        if (!auth.ok) return error(res, auth.message, auth.status);
        if (!room.state) return error(res, "Game not started.", 404);
        return json(res, {
          state: prepareRoomViewerState(room.state, auth.viewerPlayerId),
          version: room.state_version,
          isSpectator: !auth.isMember,
          viewerPlayerId: auth.viewerPlayerId,
        });
      }

      // [REMOVED] PUT /api/room/:id/state — P3-64 Phase B-5 で物理削除 (2026-05-17)
      //
      // 旧フル GameState push 経路。Phase B-3 で applyLegalAction / advanceStep 経路を
      // `POST /action` `/step` に、Phase B-5 で claim-victory / core-move /
      // brave-separation / pregame-update を専用 endpoint に移行し、残存呼び出し元なし。
      //
      // 旧経路を呼ぼうとするクライアントは下のフォールバック route 群を抜け、
      // 既定の "Endpoint not found" 404 を受ける (PUT /api/room/:id/state)。これは
      // 「dispatch 化忘れの新規 callsite」を早期検出する意図的なガードレール。

      // POST /api/room/:id/action — Phase B action-replay
      // クライアントは action を送信し、サーバが engine 実行して state を計算する。
      // 旧来 PUT /state (フル GameState push) の段階的代替。
      if (subPath === "/action" && req.method === "POST") {
        const memberError = requireRoomMember(room, authenticatedUserId);
        if (memberError) return error(res, memberError, 403);

        const body = JSON.parse(await readBody(req));
        if (!isRoomMutationRequest(body))
          return error(res, "Invalid room mutation metadata.", 400);
        const actionId = body.actionId as string;
        const expectedVersion =
          typeof body.expectedVersion === "number"
            ? body.expectedVersion
            : undefined;
        if (!actionId) return error(res, "actionId required.");

        const freshRoom = room;
        if (!freshRoom.state) return error(res, "Game not started.", 404);

        const currentVersion = freshRoom.state_version;
        const actorPlayer = freshRoom.players.find(
          (p) => p.supabaseUserId === authenticatedUserId
        );
        const actorPlayerId = actorPlayer?.role ?? null;
        if (!actorPlayerId) return error(res, "Not a player role.", 403);
        if (
          expectedVersion !== undefined &&
          expectedVersion !== currentVersion
        ) {
          if (
            await maybeRespondDuplicateMutation({
              res,
              room: freshRoom,
              actorPlayerId,
              body,
            })
          ) {
            return;
          }
          return json(res, { error: "Conflict", currentVersion }, 409);
        }

        // engine 実行
        let nextState: GameState;
        const randomContext = createRoomMutationRandomContext();
        try {
          nextState = runWithRoomMutationRandom(randomContext, () =>
            measureSync(timing, "engine", () =>
              applyRoomGameplayCommand(
                freshRoom.state!,
                actorPlayerId,
                "action",
                body
              )
            )
          );
        } catch (e: unknown) {
          if (
            await maybeRespondDuplicateMutation({
              res,
              room: freshRoom,
              actorPlayerId,
              body,
            })
          ) {
            return;
          }
          const msg = e instanceof Error ? e.message : String(e);
          return error(
            res,
            msg,
            e instanceof RoomGameplayError ? e.status : 400
          );
        }

        return await finalizeRoomMutation({
          res,
          roomId,
          currentVersion,
          previousState: freshRoom.state,
          nextState,
          actorPlayerId,
          endpoint: "action",
          body,
          timing,
          randomContext,
        });
      }

      // POST /api/room/:id/step — Phase B step advance
      // engine.advanceStep を server-side で実行。actor は activePlayer のみ許可。
      if (subPath === "/step" && req.method === "POST") {
        const memberError = requireRoomMember(room, authenticatedUserId);
        if (memberError) return error(res, memberError, 403);

        const body = req.headers["content-length"]
          ? JSON.parse((await readBody(req)) || "{}")
          : {};
        if (!isRoomMutationRequest(body))
          return error(res, "Invalid room mutation metadata.", 400);
        const expectedVersion =
          typeof body.expectedVersion === "number"
            ? body.expectedVersion
            : undefined;

        const freshRoom = room;
        if (!freshRoom.state) return error(res, "Game not started.", 404);

        const currentVersion = freshRoom.state_version;
        const actorPlayer = freshRoom.players.find(
          (p) => p.supabaseUserId === authenticatedUserId
        );
        const actorPlayerId = actorPlayer?.role ?? null;
        if (!actorPlayerId) return error(res, "Not a player role.", 403);
        if (
          expectedVersion !== undefined &&
          expectedVersion !== currentVersion
        ) {
          if (
            await maybeRespondDuplicateMutation({
              res,
              room: freshRoom,
              actorPlayerId,
              body,
            })
          ) {
            return;
          }
          return json(res, { error: "Conflict", currentVersion }, 409);
        }

        let nextState: GameState;
        const randomContext = createRoomMutationRandomContext();
        try {
          nextState = runWithRoomMutationRandom(randomContext, () =>
            measureSync(timing, "engine", () =>
              applyRoomGameplayCommand(
                freshRoom.state!,
                actorPlayerId,
                "step",
                body
              )
            )
          );
        } catch (e: unknown) {
          if (
            await maybeRespondDuplicateMutation({
              res,
              room: freshRoom,
              actorPlayerId,
              body,
            })
          ) {
            return;
          }
          const msg = e instanceof Error ? e.message : String(e);
          return error(
            res,
            msg,
            e instanceof RoomGameplayError ? e.status : 400
          );
        }

        return await finalizeRoomMutation({
          res,
          roomId,
          currentVersion,
          previousState: freshRoom.state,
          nextState,
          actorPlayerId,
          endpoint: "step",
          body,
          timing,
          randomContext,
        });
      }

      // POST /api/room/:id/claim-victory — Phase B-5
      // 切断タイムアウト等で勝利宣言。state.gameResult に { player_loss, opponent_disconnect_timeout }
      // を直接埋める。LegalAction では表現できない非エンジン経路だが、server-authoritative。
      if (subPath === "/claim-victory" && req.method === "POST") {
        const memberError = requireRoomMember(room, authenticatedUserId);
        if (memberError) return error(res, memberError, 403);

        const body = JSON.parse(await readBody(req));
        if (!isRoomMutationRequest(body))
          return error(res, "Invalid room mutation metadata.", 400);
        const reason =
          (body.reason as string | undefined) ?? "opponent_disconnect_timeout";
        const expectedVersion =
          typeof body.expectedVersion === "number"
            ? body.expectedVersion
            : undefined;

        const freshRoom = room;
        if (!freshRoom.state) return error(res, "Game not started.", 404);

        const currentVersion = freshRoom.state_version;
        const actorPlayer = freshRoom.players.find(
          (p) => p.supabaseUserId === authenticatedUserId
        );
        const winnerPlayerId = actorPlayer?.role ?? null;
        if (!winnerPlayerId) return error(res, "Not a player role.", 403);
        if (
          expectedVersion !== undefined &&
          expectedVersion !== currentVersion
        ) {
          if (
            await maybeRespondDuplicateMutation({
              res,
              room: freshRoom,
              actorPlayerId: winnerPlayerId,
              body,
            })
          ) {
            return;
          }
          return json(res, { error: "Conflict", currentVersion }, 409);
        }
        if (freshRoom.state.gameResult) {
          if (
            await maybeRespondDuplicateMutation({
              res,
              room: freshRoom,
              actorPlayerId: winnerPlayerId,
              body,
            })
          ) {
            return;
          }
          return error(res, "Game already ended.", 400);
        }
        const loser = freshRoom.state.players.find(
          (p: PlayerState) => p.id !== winnerPlayerId
        );
        if (!loser) return error(res, "Opponent player not found.", 400);

        const nextState: GameState = {
          ...freshRoom.state,
          gameResult: {
            kind: "player_loss" as const,
            losingPlayerId: loser.id,
            reason,
          },
        };

        return await finalizeRoomMutation({
          res,
          roomId,
          currentVersion,
          previousState: freshRoom.state,
          nextState,
          actorPlayerId: winnerPlayerId,
          endpoint: "claim-victory",
          body,
          timing,
        });
      }

      // POST /api/room/:id/core-move — Phase B-5
      // メインステップのコア移動 (applyDraftCoreMoves + state-based action +
      // recomputeAndRebuildContinuousEffects 合成)。LegalAction で表現できない
      // 多段 engine 操作のため専用 endpoint で受信する。
      if (subPath === "/core-move" && req.method === "POST") {
        const memberError = requireRoomMember(room, authenticatedUserId);
        if (memberError) return error(res, memberError, 403);

        const body = JSON.parse(await readBody(req));
        if (!isRoomMutationRequest(body))
          return error(res, "Invalid room mutation metadata.", 400);
        const expectedVersion =
          typeof body.expectedVersion === "number"
            ? body.expectedVersion
            : undefined;
        const freshRoom = room;
        if (!freshRoom.state) return error(res, "Game not started.", 404);

        const currentVersion = freshRoom.state_version;
        const actorPlayer = freshRoom.players.find(
          (p) => p.supabaseUserId === authenticatedUserId
        );
        const actorPlayerId = actorPlayer?.role ?? null;
        if (!actorPlayerId) return error(res, "Not a player role.", 403);
        if (
          expectedVersion !== undefined &&
          expectedVersion !== currentVersion
        ) {
          if (
            await maybeRespondDuplicateMutation({
              res,
              room: freshRoom,
              actorPlayerId,
              body,
            })
          ) {
            return;
          }
          return json(res, { error: "Conflict", currentVersion }, 409);
        }
        let nextState: GameState;
        const randomContext = createRoomMutationRandomContext();
        try {
          nextState = runWithRoomMutationRandom(randomContext, () =>
            measureSync(timing, "engine", () =>
              applyRoomGameplayCommand(
                freshRoom.state!,
                actorPlayerId,
                "core-move",
                body
              )
            )
          );
        } catch (e: unknown) {
          if (
            await maybeRespondDuplicateMutation({
              res,
              room: freshRoom,
              actorPlayerId,
              body,
            })
          ) {
            return;
          }
          const msg = e instanceof Error ? e.message : String(e);
          return error(
            res,
            msg,
            e instanceof RoomGameplayError ? e.status : 400
          );
        }

        return await finalizeRoomMutation({
          res,
          roomId,
          currentVersion,
          previousState: freshRoom.state,
          nextState,
          actorPlayerId,
          endpoint: "core-move",
          body,
          timing,
          randomContext,
        });
      }

      // POST /api/room/:id/brave-separation — Phase B-5
      // 分離 / 離脱時に残す LegalAction + moveSoulCore の合成。LegalAction 単独では
      // ソウルコア移動を表現できないため、専用 endpoint で 2 段階を 1 トランザクションに統合。
      if (subPath === "/brave-separation" && req.method === "POST") {
        const memberError = requireRoomMember(room, authenticatedUserId);
        if (memberError) return error(res, memberError, 403);

        const body = JSON.parse(await readBody(req));
        if (!isRoomMutationRequest(body))
          return error(res, "Invalid room mutation metadata.", 400);
        const actionId = body.actionId as string | undefined;
        const separateCoreDistribution = body.separateCoreDistribution as
          | Record<string, number>
          | undefined;
        const expectedVersion =
          typeof body.expectedVersion === "number"
            ? body.expectedVersion
            : undefined;
        if (!actionId) return error(res, "actionId required.");
        if (!separateCoreDistribution)
          return error(res, "separateCoreDistribution required.");

        const freshRoom = room;
        if (!freshRoom.state) return error(res, "Game not started.", 404);

        const currentVersion = freshRoom.state_version;
        const actorPlayer = freshRoom.players.find(
          (p) => p.supabaseUserId === authenticatedUserId
        );
        const actorPlayerId = actorPlayer?.role ?? null;
        if (!actorPlayerId) return error(res, "Not a player role.", 403);
        if (
          expectedVersion !== undefined &&
          expectedVersion !== currentVersion
        ) {
          if (
            await maybeRespondDuplicateMutation({
              res,
              room: freshRoom,
              actorPlayerId,
              body,
            })
          ) {
            return;
          }
          return json(res, { error: "Conflict", currentVersion }, 409);
        }

        let nextState: GameState;
        const randomContext = createRoomMutationRandomContext();
        try {
          nextState = runWithRoomMutationRandom(randomContext, () =>
            measureSync(timing, "engine", () =>
              applyRoomGameplayCommand(
                freshRoom.state!,
                actorPlayerId,
                "brave-separation",
                body
              )
            )
          );
        } catch (e: unknown) {
          if (
            await maybeRespondDuplicateMutation({
              res,
              room: freshRoom,
              actorPlayerId,
              body,
            })
          ) {
            return;
          }
          const msg = e instanceof Error ? e.message : String(e);
          return error(
            res,
            msg,
            e instanceof RoomGameplayError ? e.status : 400
          );
        }

        return await finalizeRoomMutation({
          res,
          roomId,
          currentVersion,
          previousState: freshRoom.state,
          nextState,
          actorPlayerId,
          endpoint: "brave-separation",
          body,
          timing,
          randomContext,
        });
      }

      // POST /api/room/:id/pregame-update — Phase B-5
      // preGame (janken / pick_first / mulligan) 状態の部分更新。両プレイヤーが
      // 並行書き込みする経路のため、jankenHands / mulliganDone は field-merge する。
      // 既存 PUT /state の preGame merge ロジックを切り出した専用 endpoint。
      if (subPath === "/pregame-update" && req.method === "POST") {
        const memberError = requireRoomMember(room, authenticatedUserId);
        if (memberError) return error(res, memberError, 403);

        const body = JSON.parse(await readBody(req));
        if (!isRoomMutationRequest(body))
          return error(res, "Invalid room mutation metadata.", 400);
        const partial = body.preGame as
          | Partial<import("@orica/rules-core").PreGameState>
          | undefined;
        const expectedVersion =
          typeof body.expectedVersion === "number"
            ? body.expectedVersion
            : undefined;
        if (!partial) return error(res, "preGame partial update required.");

        const freshRoom = room;
        if (!freshRoom.state) return error(res, "Game not started.", 404);
        const actorPlayer = freshRoom.players.find(
          (p) => p.supabaseUserId === authenticatedUserId
        );
        if (!actorPlayer) return error(res, "Not a player role.", 403);
        // server-finalize (pregame_complete 検知時に preGame=null 確定) 後に、
        // クライアントの in-flight / 重複 pregame-update が届くことがある。これは
        // 既にゲーム開始済みで no-op なので、400 エラー (=「同期失敗」バナー) ではなく
        // 冪等な成功として返す。
        if (!freshRoom.state.preGame) {
          return json(res, {
            ...roomMutationSuccessPayload(
              freshRoom.state,
              freshRoom.state_version,
              actorPlayer.role
            ),
            alreadyComplete: true,
          });
        }

        const currentVersion = freshRoom.state_version;
        if (
          expectedVersion !== undefined &&
          expectedVersion !== currentVersion
        ) {
          if (
            await maybeRespondDuplicateMutation({
              res,
              room: freshRoom,
              actorPlayerId: actorPlayer.role,
              body,
            })
          ) {
            return;
          }
          return json(res, { error: "Conflict", currentVersion }, 409);
        }

        // merge / 先後・マリガンのサーバ確定 /
        // pregame_complete 確定 は applyPregameUpdate に集約 (replay 経路と共通)。
        // クライアントからは actor 自身の選択だけを受け、shuffle/draw はサーバで行う。
        const randomContext = createRoomMutationRandomContext();
        const nextState: GameState = runWithRoomMutationRandom(
          randomContext,
          () =>
            measureSync(timing, "engine", () =>
              applyRoomGameplayCommand(
                freshRoom.state!,
                actorPlayer.role,
                "pregame-update",
                body
              )
            )
        );

        return await finalizeRoomMutation({
          res,
          roomId,
          currentVersion,
          previousState: freshRoom.state,
          nextState,
          actorPlayerId: actorPlayer.role,
          endpoint: "pregame-update",
          body,
          timing,
          randomContext,
        });
      }

      // GET /api/room/:id/state/patch?since=N — legacy fallback
      if (subPath.startsWith("/state/patch") && req.method === "GET") {
        const denied = await authorizeRoomRead(req, room);
        if (denied) return error(res, denied.message, denied.status);
        // Raw patch cache is not viewer-safe because hidden card changes can
        // appear in JSON Patch values. Live sync now sends per-viewer
        // sanitized patches through SSE / mutation responses; this legacy
        // endpoint intentionally forces clients to fall back to /state/full.
        return json(res, {
          available: false,
          version: room.state_version,
          reason: "viewer_safe_patch_stream_only",
        });
      }

      // GET /api/room/:id/replay/verify — Phase C-5 障害復旧用整合性チェック
      // rooms.state_version と replay_events の最大 version の差分を検出し、
      // event 列のギャップ (連番欠落) を列挙する。
      //
      // 用途:
      // - server crash 後の整合性確認 (CAS update 後の log append 欠落検知)
      // - リプレイ機能の前提として「event 列が gap-free か」を保証する
      // - 観戦巻き戻しが安全に成立する範囲を特定する
      //
      // 障害復旧の方針 (将来拡張):
      // - rooms.state_version > max(replay_events.state_version): log 欠落
      //   → 補完不能 (state snapshot 側を真とみなす、event ログから当該 version を生成不可)
      // - rooms.state_version < max(replay_events.state_version): state stale
      //   → engine 再生で復旧可能 (該当範囲を action 順に dispatch 再実行)
      // - gaps: 連続性破綻
      //   → 部分リプレイは可、完全リプレイ不可
      if (subPath === "/replay/verify" && req.method === "GET") {
        const denied = await authorizeRoomRead(req, room);
        if (denied) return error(res, denied.message, denied.status);

        const { data, error: err } = await supabaseServer
          .from("replay_events")
          .select("state_version")
          .eq("room_id", roomId)
          .order("state_version", { ascending: true });
        if (err) {
          return error(res, `Failed to verify replay: ${err.message}`, 500);
        }
        const versions = (data ?? []).map(
          (r: { state_version: number }) => r.state_version
        );
        const maxEventVersion = versions.length
          ? versions[versions.length - 1]!
          : 0;
        const minEventVersion = versions.length ? versions[0]! : 0;
        // gap detection: 連番 (minEventVersion .. maxEventVersion) の欠落版数を列挙
        const present = new Set(versions);
        const gaps: number[] = [];
        for (let v = minEventVersion; v <= maxEventVersion; v++) {
          if (!present.has(v)) gaps.push(v);
        }
        const eventCount = versions.length;
        const stateVersion = room.state_version;
        const stateLeadsEvents = stateVersion > maxEventVersion;
        const eventsLeadState = maxEventVersion > stateVersion;
        return json(res, {
          roomId,
          stateVersion,
          eventCount,
          minEventVersion,
          maxEventVersion,
          gaps,
          stateLeadsEvents, // log 欠落 (補完不能)
          eventsLeadState, // state stale (engine 再生で復旧可)
          consistent:
            !stateLeadsEvents && !eventsLeadState && gaps.length === 0,
        });
      }

      // GET /api/room/:id/replay — Phase C リプレイ event 列取得
      // クエリ: ?fromVersion=N&toVersion=M (両方省略可、開区間でなく閉区間)
      // - fromVersion 未指定: state_version 1 から
      // - toVersion 未指定: 現在の room.state_version まで
      // - 観戦者は authorizeRoomRead 経由でアクセス制御 (rooms と同じポリシー)
      // - viewer audit API。raw event は server 内の /replay/restore だけが再実行する
      // - 非入力者の dispatch payload は null + payloadRedacted=true
      // 注: /replay/verify (Phase C-5) / /replay/restore (Phase C-5) と subPath が分岐するため
      // 完全一致 + クエリパラメータ付きのみマッチさせる。
      const isReplayList =
        subPath === "/replay" || subPath.startsWith("/replay?");
      if (isReplayList && req.method === "GET") {
        const auth = await authorizeRoomReadAndResolveViewer(req, room);
        if (!auth.ok) return error(res, auth.message, auth.status);

        const queryStr = url.split("?")[1] ?? "";
        const params = new URLSearchParams(queryStr);
        const fromVersionRaw = params.get("fromVersion");
        const toVersionRaw = params.get("toVersion");
        const fromVersion = fromVersionRaw ? parseInt(fromVersionRaw, 10) : 1;
        const toVersion = toVersionRaw
          ? parseInt(toVersionRaw, 10)
          : room.state_version;
        if (
          !Number.isFinite(fromVersion) ||
          !Number.isFinite(toVersion) ||
          fromVersion < 0 ||
          toVersion < 0
        ) {
          return error(
            res,
            "fromVersion / toVersion must be non-negative integers",
            400
          );
        }
        if (fromVersion > toVersion) {
          return error(res, "fromVersion must be <= toVersion", 400);
        }

        const { data, error: err } = await supabaseServer
          .from("replay_events")
          .select(
            "id, room_id, state_version, acting_player_id, endpoint, payload, created_at"
          )
          .eq("room_id", roomId)
          .gte("state_version", fromVersion)
          .lte("state_version", toVersion)
          .order("state_version", { ascending: true });
        if (err) {
          return error(
            res,
            `Failed to fetch replay events: ${err.message}`,
            500
          );
        }
        const events = (data ?? []) as ReplayEventRow[];
        const viewerSafeEvents = events.map((event) =>
          sanitizeReplayEventForViewer(event, auth.viewerPlayerId)
        );
        return json(res, {
          roomId,
          fromVersion,
          toVersion,
          currentVersion: room.state_version,
          mode: "viewer_audit",
          engineReplayable: false,
          serverReplayPath: `/api/room/${roomId}/replay/restore`,
          events: viewerSafeEvents,
        });
      }

      // POST /api/room/:id/replay/restore — Phase C-5 障害復旧 / リプレイ巻き戻し
      //
      // body: {
      //   baseSnapshotId?: string,    // snapshots テーブルの UUID。指定時はこの state を base
      //   baseState?: GameState,      // 直接 state を渡す経路 (テスト・観戦巻き戻し用)
      //   toVersion?: number,         // 再生する最終 state_version。未指定なら room.state_version
      //   commit?: boolean,           // true なら rooms.state を CAS update + SSE broadcast
      // }
      //
      // 用途:
      // - server crash で rooms.state が stale → snapshot + replay で復旧
      // - room member の任意 version 巻き戻し (commit=false で state を返すのみ)
      // - QA リグレッション再現 (replay 列の固定 base から再現)
      //
      // authentication:
      // - engine replay は commit の有無を問わず認証済み room member 限定
      // - public_link 観戦者は viewer-safe な GET /replay audit のみ利用可能
      if (subPath === "/replay/restore" && req.method === "POST") {
        const body = JSON.parse(await readBody(req));
        const commit = body.commit === true;
        if (!authenticatedUserId) {
          return error(res, "Missing or invalid token.", 401);
        }
        const memberError = requireRoomMember(room, authenticatedUserId);
        if (memberError) return error(res, memberError, 403);
        if (commit) {
          if (
            !isReplayRestoreCommitAuthorized(
              req.headers["x-orica-replay-restore-token"]
            )
          ) {
            return error(res, "Replay restore commit is operator-only.", 403);
          }
        }

        const baseSnapshotId = body.baseSnapshotId as string | undefined;
        const baseStateInput = body.baseState as GameState | undefined;
        const toVersionRaw = body.toVersion as number | undefined;
        if (commit && baseStateInput) {
          return error(
            res,
            "commit=true requires a server snapshot; raw baseState is read-only.",
            400
          );
        }

        // base state + base version を決定
        let baseState: GameState;
        let baseVersion: number;
        if (baseSnapshotId) {
          const { data, error: err } = await supabaseServer
            .from("snapshots")
            .select(
              "owner_user_id, room_id, to_version, state, is_public, is_server_checkpoint"
            )
            .eq("id", baseSnapshotId)
            .single();
          if (err || !data) {
            return error(res, "baseSnapshotId not found.", 404);
          }
          if (data.room_id != null && data.room_id !== roomId) {
            return error(
              res,
              "Replay restore snapshot must belong to this room.",
              403
            );
          }
          if (commit && data.is_server_checkpoint !== true) {
            return error(
              res,
              "Replay restore commit requires a server checkpoint.",
              403
            );
          }
          // snapshot 認可: public または owner のみ
          if (!data.is_public) {
            if (!authenticatedUserId)
              return error(res, "Missing or invalid token.", 401);
            if (data.owner_user_id !== authenticatedUserId) {
              return error(res, "Not owner of base snapshot.", 403);
            }
          }
          const snapshotEnvelope = data.state as {
            state?: GameState;
            schemaVersion?: unknown;
          } | null;
          if (
            !snapshotEnvelope ||
            typeof snapshotEnvelope.state !== "object" ||
            snapshotEnvelope.state === null
          ) {
            return error(res, "baseSnapshot state malformed.", 500);
          }
          baseState = normalizePersistedState(snapshotEnvelope.state);
          baseVersion = data.to_version ?? 0;
        } else if (baseStateInput) {
          const validationError = validateGameState(baseStateInput);
          if (validationError)
            return error(res, `Invalid baseState: ${validationError}`, 400);
          baseState = normalizePersistedState(baseStateInput);
          baseVersion = 0;
        } else {
          return error(res, "baseSnapshotId or baseState required.", 400);
        }

        let toVersion: number;
        if (typeof toVersionRaw === "number") {
          toVersion = toVersionRaw;
        } else if (commit) {
          const { data: headRows, error: headError } = await supabaseServer
            .from("replay_events")
            .select("state_version")
            .eq("room_id", roomId)
            .order("state_version", { ascending: false })
            .limit(1);
          if (headError) {
            return error(
              res,
              `Failed to fetch replay head: ${headError.message}`,
              500
            );
          }
          const replayHead = (
            headRows?.[0] as { state_version?: unknown } | undefined
          )?.state_version;
          toVersion =
            typeof replayHead === "number"
              ? Math.max(room.state_version, replayHead)
              : room.state_version;
        } else {
          toVersion = room.state_version;
        }
        if (!Number.isFinite(toVersion) || toVersion < baseVersion) {
          return error(
            res,
            `toVersion (${toVersion}) must be >= baseVersion (${baseVersion})`,
            400
          );
        }

        // baseVersion+1 .. toVersion の events を順に取得
        const { data: rawEvents, error: fetchErr } = await supabaseServer
          .from("replay_events")
          .select(
            "id, room_id, state_version, acting_player_id, endpoint, payload, created_at"
          )
          .eq("room_id", roomId)
          .gt("state_version", baseVersion)
          .lte("state_version", toVersion)
          .order("state_version", { ascending: true });
        if (fetchErr) {
          return error(
            res,
            `Failed to fetch replay events: ${fetchErr.message}`,
            500
          );
        }
        const events = (rawEvents ?? []) as ReplayEventRow[];

        // gap check: baseVersion+1 から toVersion まで連番か
        for (let i = 0; i < events.length; i++) {
          const expected = baseVersion + i + 1;
          if (events[i]!.state_version !== expected) {
            return error(
              res,
              `replay gap: expected version ${expected}, got ${events[i]!.state_version}`,
              409
            );
          }
        }
        if (events.length !== toVersion - baseVersion) {
          return error(
            res,
            `replay incomplete: expected ${toVersion - baseVersion} events, got ${events.length}`,
            409
          );
        }

        // 順次再生
        let state = baseState;
        for (const ev of events) {
          try {
            state = replayEvent(state, {
              acting_player_id: ev.acting_player_id,
              endpoint: ev.endpoint,
              payload: ev.payload,
            });
          } catch (e: unknown) {
            console.error(
              `[replay-restore] failed at version ${ev.state_version} (${ev.endpoint})`,
              e
            );
            return error(
              res,
              `replay failed at version ${ev.state_version} (${ev.endpoint}).`,
              500
            );
          }
        }

        // commit モード: restore 自体も新 version の checkpoint event として
        // rooms.state + replay_events へ原子的に commit する。
        let committedVersion = toVersion;
        if (commit) {
          const currentVersion = room.state_version;
          if (toVersion < currentVersion) {
            return error(
              res,
              `commit requires toVersion (${toVersion}) >= currentVersion (${currentVersion})`,
              409
            );
          }
          const actorPlayerId = room.players.find(
            (player) => player.supabaseUserId === authenticatedUserId
          )?.role;
          if (!actorPlayerId) {
            return error(res, "Not a player role.", 403);
          }
          const restoreCommit = await repairRoomStateFromReplay({
            roomId,
            expectedRoomVersion: currentVersion,
            replayedToVersion: toVersion,
            state,
            actingPlayerId: actorPlayerId,
            replayPayload: {
              ...sanitizeReplayPayload("replay-restore", { state }),
              ...roomMutationRandomTrace(createRoomMutationRandomContext()),
            },
          });
          if (!restoreCommit.ok) {
            if (restoreCommit.unavailable) {
              return error(
                res,
                "Atomic replay restore is unavailable; apply Supabase migrations 009 and 010.",
                503
              );
            }
            return json(
              res,
              {
                error: "Conflict",
                currentVersion: restoreCommit.currentVersion,
                ...(restoreCommit.eventVersion !== undefined
                  ? { eventVersion: restoreCommit.eventVersion }
                  : {}),
              },
              409
            );
          }
          committedVersion = restoreCommit.version;
          broadcastSSEStateUpdate(
            roomId,
            committedVersion,
            state,
            room.state,
            undefined,
            currentVersion
          );
        }

        const viewerPlayerId = await getViewerPlayerId(req, room);
        return json(res, {
          roomId,
          baseVersion,
          toVersion,
          version: committedVersion,
          eventsReplayed: events.length,
          commit,
          state: prepareRoomViewerState(state, viewerPlayerId),
        });
      }

      // GET /api/room/:id/events — SSE ストリーム
      if (subPath === "/events" && req.method === "GET") {
        const auth = await authorizeRoomReadAndResolveViewer(req, room);
        if (!auth.ok) return error(res, auth.message, auth.status);
        const viewerPlayerId = auth.viewerPlayerId;
        const isMember = auth.isMember;
        const interviewUserId = (
          req as IncomingMessage & { __interviewUserId?: string }
        ).__interviewUserId;
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders?.();
        const entry = addSSEConnection(roomId, res, isMember, viewerPlayerId);
        let keepalive: ReturnType<typeof setInterval> | null = null;
        let membershipCheckRunning = false;
        req.on("close", () => {
          if (keepalive) clearInterval(keepalive);
          keepalive = null;
          removeSSEConnection(roomId, entry);
        });
        // 初回 connected も backpressure 管理下で送り、直後の state_update と順序を保つ。
        writeSSEFrame(
          roomId,
          entry,
          `event: connected\ndata: ${JSON.stringify({ version: room.state_version, isSpectator: !isMember })}\n\n`
        );
        if (!hasSSEConnection(roomId, entry)) return;
        // 先に registry へ登録してから再取得する。await 中の mutation は通常 broadcast
        // で entry.latestStateVersion を進めるため、古い snapshot で上書きしない。
        let streamRoom: RoomRow | null;
        try {
          streamRoom = await getRoom(roomId);
        } catch {
          removeSSEConnection(roomId, entry, true);
          return;
        }
        if (!streamRoom) {
          removeSSEConnection(roomId, entry, true);
          return;
        }
        if (
          streamRoom.state &&
          shouldDeliverSSESnapshot(
            streamRoom.state_version,
            entry.latestStateVersion
          )
        ) {
          try {
            deliverSSEStateFrame(
              roomId,
              entry,
              streamRoom.state_version,
              fullStateSSEFrame(
                streamRoom.state_version,
                prepareRoomViewerState(streamRoom.state, viewerPlayerId)
              )
            );
          } catch {
            removeSSEConnection(roomId, entry, true);
            return;
          }
        }
        if (!hasSSEConnection(roomId, entry)) return;

        // keepalive: クライアントの stale 検出にも使える ping イベントを送信する。
        keepalive = setInterval(() => {
          pruneExpiredSSEConnections(roomId);
          if (!hasSSEConnection(roomId, entry)) {
            if (keepalive) clearInterval(keepalive);
            keepalive = null;
            return;
          }
          if (INTERVIEW_MODE && interviewUserId && !membershipCheckRunning) {
            membershipCheckRunning = true;
            void Promise.resolve()
              .then(() =>
                supabaseAdmin.rpc("service_has_active_interview_membership", {
                  p_user_id: interviewUserId,
                })
              )
              .then(({ data, error: membershipError }) => {
                if (membershipError || data !== true) {
                  removeSSEConnection(roomId, entry, true);
                }
              })
              .catch(() => removeSSEConnection(roomId, entry, true))
              .finally(() => {
                membershipCheckRunning = false;
              });
          }
          if (entry.backpressured) return;
          writeSSEFrame(
            roomId,
            entry,
            `event: ping\ndata: ${JSON.stringify({ serverTime: Date.now() })}\n\n`
          );
        }, 5_000);

        return; // レスポンスを閉じない
      }

      return error(res, "Unknown room endpoint", 404);
    } catch (e: unknown) {
      if (e instanceof RoomDependencyError) {
        console.error(
          JSON.stringify({
            requestId: res.getHeader("X-Request-ID"),
            code: e.code,
            timing: (res as TimedServerResponse).__roomTiming?.toHeader(),
          })
        );
        res.setHeader("Retry-After", "1");
        return json(
          res,
          {
            error: "対戦サーバーに再接続しています。",
            code: e.code,
            requestId: res.getHeader("X-Request-ID"),
          },
          503
        );
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "Payload too large") return error(res, msg, 413);
      return error(res, msg, 500);
    }
  };
  use(roomMiddleware);

  // --- Snapshot API middleware (P3-19 + P3-64 Phase C-4) ---
  // ルーム永続化された GameSnapshot を保存・取得・一覧表示する。
  // 認可ポリシー:
  //   POST /api/snapshot         JWT 必須 (owner_user_id = authenticated)
  //   GET  /api/snapshots        JWT 必須 (自分の snapshot 一覧)
  //   GET  /api/snapshot/:id     is_public=true なら認証不要、それ以外は owner のみ
  //   DELETE /api/snapshot/:id   JWT 必須 (owner のみ)
  const snapshotMiddleware: Connect.NextHandleFunction = async (
    req,
    res,
    next
  ) => {
    const url = req.url ?? "";
    if (!url.startsWith("/api/snapshot")) return next();

    await ensureEngine();

    try {
      // POST /api/snapshot — snapshot 保存
      // roomId ありは rooms.state から server checkpoint を生成する。
      // body.state は roomId なしの read-only snapshot でのみ採用する。
      // body: { state?: GameState, label?, origin?, roomId?, fromVersion?, toVersion?, isPublic? }
      if (url === "/api/snapshot" && req.method === "POST") {
        const authenticatedUserId = await authenticateRequest(req);
        if (!authenticatedUserId)
          return error(res, "Missing or invalid token.", 401);

        const body = JSON.parse(await readBody(req));
        const roomIdInput = body.roomId as string | undefined;
        const stateInput = body.state as GameState | undefined;
        const label = body.label as string | undefined;
        const originRaw = body.origin as string | undefined;
        let origin: "scenario" | "room" | "manual" =
          originRaw === "scenario" || originRaw === "room"
            ? originRaw
            : "manual";
        let fromVersion =
          typeof body.fromVersion === "number" ? body.fromVersion : null;
        let toVersion =
          typeof body.toVersion === "number" ? body.toVersion : null;
        let isPublic = body.isPublic === true;
        let isServerCheckpoint = false;
        let state: GameState;

        if (roomIdInput) {
          const checkpointRoom = await getRoom(roomIdInput);
          if (!checkpointRoom) return error(res, "Room not found.", 404);
          const memberError = requireRoomMember(
            checkpointRoom,
            authenticatedUserId
          );
          if (memberError) return error(res, memberError, 403);
          if (!checkpointRoom.state) {
            return error(res, "Room has no game state.", 409);
          }
          state = normalizePersistedState(checkpointRoom.state);
          origin = "room";
          toVersion = checkpointRoom.state_version;
          fromVersion = Math.min(
            fromVersion ?? checkpointRoom.state_version,
            checkpointRoom.state_version
          );
          isPublic = false;
          isServerCheckpoint = true;
        } else {
          if (!stateInput) return error(res, "state required.", 400);
          const stateValidationError = validateGameState(stateInput);
          if (stateValidationError) {
            return error(res, `Invalid state: ${stateValidationError}`, 400);
          }
          state = normalizePersistedState(stateInput);
        }

        const snapshotPayload = {
          schemaVersion: 1,
          savedAt: new Date().toISOString(),
          ...(label !== undefined ? { label } : {}),
          ...(roomIdInput || origin !== "manual"
            ? {
                origin: {
                  sourceKind: origin,
                  ...(roomIdInput ? { sourceId: roomIdInput } : {}),
                },
              }
            : {}),
          state,
        };

        const { data, error: insertErr } = await supabaseServer
          .from("snapshots")
          .insert({
            owner_user_id: authenticatedUserId,
            room_id: roomIdInput ?? null,
            from_version: fromVersion,
            to_version: toVersion,
            label: label ?? null,
            origin,
            state: snapshotPayload,
            is_public: isPublic,
            is_server_checkpoint: isServerCheckpoint,
          })
          .select("id, created_at")
          .single();
        if (insertErr || !data) {
          return error(
            res,
            `Failed to save snapshot: ${insertErr?.message ?? "unknown"}`,
            500
          );
        }
        return json(res, {
          id: data.id,
          createdAt: data.created_at,
        });
      }

      // GET /api/snapshots — 自分の snapshot 一覧 (JWT 必須)
      if (url.startsWith("/api/snapshots") && req.method === "GET") {
        const authenticatedUserId = await authenticateRequest(req);
        if (!authenticatedUserId)
          return error(res, "Missing or invalid token.", 401);
        const queryStr = url.split("?")[1] ?? "";
        const params = new URLSearchParams(queryStr);
        const limit = Math.min(
          parseInt(params.get("limit") ?? "50", 10) || 50,
          200
        );
        const { data, error: err } = await supabaseServer
          .from("snapshots")
          .select(
            "id, label, origin, room_id, from_version, to_version, is_public, is_server_checkpoint, created_at"
          )
          .eq("owner_user_id", authenticatedUserId)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (err) {
          return error(res, `Failed to list snapshots: ${err.message}`, 500);
        }
        return json(res, { snapshots: data ?? [] });
      }

      // GET /api/snapshot/:id — snapshot 取得
      //   is_public=true → 認証不要
      //   それ以外      → JWT 必須 + owner 一致
      const getMatch = url.match(/^\/api\/snapshot\/([0-9a-f-]+)$/i);
      if (getMatch && req.method === "GET") {
        const snapshotId = getMatch[1]!;
        const { data, error: err } = await supabaseServer
          .from("snapshots")
          .select(
            "id, owner_user_id, room_id, from_version, to_version, label, origin, state, is_public, is_server_checkpoint, created_at"
          )
          .eq("id", snapshotId)
          .single();
        if (err || !data) {
          return error(res, "Snapshot not found.", 404);
        }
        if (!data.is_public) {
          const authenticatedUserId = await authenticateRequest(req);
          if (!authenticatedUserId)
            return error(res, "Missing or invalid token.", 401);
          if (data.owner_user_id !== authenticatedUserId) {
            return error(res, "Not owner of this snapshot.", 403);
          }
        }
        if (data.is_server_checkpoint === true) {
          return json(res, {
            snapshot: {
              ...data,
              state: null,
              is_public: false,
            },
          });
        }
        return json(res, { snapshot: data });
      }

      // DELETE /api/snapshot/:id — snapshot 削除 (owner のみ)
      const delMatch = url.match(/^\/api\/snapshot\/([0-9a-f-]+)$/i);
      if (delMatch && req.method === "DELETE") {
        const authenticatedUserId = await authenticateRequest(req);
        if (!authenticatedUserId)
          return error(res, "Missing or invalid token.", 401);
        const snapshotId = delMatch[1]!;
        const { data: existing, error: selErr } = await supabaseServer
          .from("snapshots")
          .select("owner_user_id")
          .eq("id", snapshotId)
          .single();
        if (selErr || !existing) {
          return error(res, "Snapshot not found.", 404);
        }
        if (existing.owner_user_id !== authenticatedUserId) {
          return error(res, "Not owner of this snapshot.", 403);
        }
        const { error: delErr } = await supabaseServer
          .from("snapshots")
          .delete()
          .eq("id", snapshotId);
        if (delErr) {
          return error(
            res,
            `Failed to delete snapshot: ${delErr.message}`,
            500
          );
        }
        return json(res, { ok: true });
      }

      return error(res, "Unknown snapshot endpoint", 404);
    } catch (e: unknown) {
      if (e instanceof RoomDependencyError) {
        console.error(
          JSON.stringify({
            requestId: res.getHeader("X-Request-ID"),
            code: e.code,
            timing: (res as TimedServerResponse).__roomTiming?.toHeader(),
          })
        );
        res.setHeader("Retry-After", "1");
        return json(
          res,
          {
            error: "対戦サーバーに再接続しています。",
            code: e.code,
            requestId: res.getHeader("X-Request-ID"),
          },
          503
        );
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "Payload too large") return error(res, msg, 413);
      return error(res, msg, 500);
    }
  };
  use(snapshotMiddleware);

  if (!includeLegacy) return;

  // --- Legacy game API middleware ---
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    const url = req.url ?? "";
    if (!url.startsWith("/api/game")) return next();

    await ensureEngine();
    if (allCardDefs.length === 0) {
      allCardDefs = cardData.ALL_CARDS as CardDefinition[];
      installCardLookups(allCardDefs);
    }

    try {
      // POST /api/game/start
      if (url === "/api/game/start" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}");
        initGame(body.aliceDeck, body.bobDeck);
        return json(res, {
          ok: true,
          state: summarizeState(currentState!),
        });
      }

      // GET /api/game/state
      if (url === "/api/game/state" && req.method === "GET") {
        if (!currentState)
          return error(res, "No active game. POST /api/game/start first.", 404);
        return json(res, {
          ...summarizeState(currentState),
          version: stateVersion,
        });
      }

      // PUT /api/game/state — GUI が state を push
      if (url === "/api/game/state" && req.method === "PUT") {
        const body = JSON.parse(await readBody(req));
        const stateValidationError = validateGameState(body.state);
        if (stateValidationError)
          return error(res, `Invalid state: ${stateValidationError}`, 400);
        currentState = normalizePersistedState(body.state);
        stateVersion++;
        return json(res, { ok: true, version: stateVersion });
      }

      // GET /api/game/state/version — polling 用軽量エンドポイント
      if (url === "/api/game/state/version" && req.method === "GET") {
        return json(res, { version: stateVersion });
      }

      // GET /api/game/state/full — 完全な GameState を返す（GUI が bob の操作結果を取得）
      if (url === "/api/game/state/full" && req.method === "GET") {
        if (!currentState) return error(res, "No active game.", 404);
        return json(res, { state: currentState, version: stateVersion });
      }

      // GET /api/game/actions/:playerId
      const actionsMatch = url.match(/^\/api\/game\/actions\/(\w+)$/);
      if (actionsMatch && req.method === "GET") {
        if (!currentState) return error(res, "No active game.", 404);
        const playerId = actionsMatch[1]!;
        const actions = engine.getLegalActions({
          state: currentState,
          actingPlayerId: playerId,
          getCardDefinitionById: defLookup,
          ...effectLookups,
        });
        return json(res, {
          playerId,
          step: currentState.step,
          turn: currentState.turnNumber,
          activePlayerId: currentState.activePlayerId,
          actions: actions.map(summarizeAction),
        });
      }

      // POST /api/game/action
      if (url === "/api/game/action" && req.method === "POST") {
        if (!currentState) return error(res, "No active game.", 404);
        const body = JSON.parse(await readBody(req));
        const playerId = body.playerId as string;
        const actionId = body.actionId as string;
        if (!playerId || !actionId)
          return error(res, "playerId and actionId required.");

        const actions = engine.getLegalActions({
          state: currentState,
          actingPlayerId: playerId,
          getCardDefinitionById: defLookup,
          ...effectLookups,
        });
        const action = actions.find(
          (a: LegalAction) => a.actionId === actionId
        );
        if (!action)
          return error(
            res,
            `actionId "${actionId}" not found in legal actions.`
          );

        const { state: nextState } = executeAction({
          state: currentState,
          actingPlayerId: playerId,
          action,
          body,
        });
        currentState = nextState;
        stateVersion++;
        return json(res, {
          ok: true,
          state: summarizeState(currentState),
          version: stateVersion,
        });
      }

      // POST /api/game/step
      if (url === "/api/game/step" && req.method === "POST") {
        if (!currentState) return error(res, "No active game.", 404);
        try {
          currentState = engine.advanceStep(
            currentState,
            defLookup,
            effectLookups.getRegisteredTriggeredEffectActions,
            effectLookups.getRegisteredBurstActions,
            effectLookups.getRegisteredMagicActions
          );
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return error(res, msg, 400);
        }
        stateVersion++;
        return json(res, {
          ok: true,
          state: summarizeState(currentState),
          version: stateVersion,
        });
      }

      // POST /api/game/reset
      if (url === "/api/game/reset" && req.method === "POST") {
        currentState = null;
        stateVersion = 0;
        return json(res, { ok: true });
      }

      return error(res, "Unknown endpoint", 404);
    } catch (e: unknown) {
      if (e instanceof RoomDependencyError) {
        console.error(
          JSON.stringify({
            requestId: res.getHeader("X-Request-ID"),
            code: e.code,
            timing: (res as TimedServerResponse).__roomTiming?.toHeader(),
          })
        );
        res.setHeader("Retry-After", "1");
        return json(
          res,
          {
            error: "対戦サーバーに再接続しています。",
            code: e.code,
            requestId: res.getHeader("X-Request-ID"),
          },
          503
        );
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "Payload too large") return error(res, msg, 413);
      return error(res, msg, 500);
    }
  };
  use(middleware);
}

// --- state/action summaries for API output ---
export function summarizeState(state: GameState) {
  const players = state.players.map((p: PlayerState) => ({
    id: p.id,
    life: p.lifeNormalCoreCount,
    reserveCores: p.reserveNormalCoreCount,
    trashCores: p.trashNormalCoreCount,
    soulCoreLocation: p.soulCoreLocation,
  }));

  const cardByInstanceId = new Map(
    state.cardInstances.map((card) => [card.instanceId, card])
  );
  const cards = state.cardInstances.map((c: CardInstance) => {
    const def = defLookup(c.definitionId);
    const ci = c as CardInstance & Record<string, unknown>;
    const underCards =
      c.underCards?.map((entry) => {
        const underCard = cardByInstanceId.get(entry.cardInstanceId);
        const underDefinition = underCard
          ? defLookup(underCard.definitionId)
          : undefined;
        return {
          cardInstanceId: entry.cardInstanceId,
          role: entry.role,
          ...(entry.roleTag !== undefined ? { roleTag: entry.roleTag } : {}),
          ...(underCard !== undefined
            ? {
                cardNo: underCard.definitionId,
                name: underDefinition?.name ?? underCard.definitionId,
              }
            : {}),
        };
      }) ?? [];
    return {
      instanceId: c.instanceId,
      cardNo: c.definitionId,
      name: def?.name ?? c.definitionId,
      owner: c.ownerPlayerId,
      controller: c.controllerPlayerId,
      zone: c.zone,
      cores: c.normalCoreCount,
      exhausted: ci.exhausted,
      level: ci.currentLevel,
      bp: (ci.resolvedBp as number | undefined) ?? def?.levelDefs?.[0]?.bp ?? 0,
      ...(c.zoneRoleName ? { zoneRoleName: c.zoneRoleName } : {}),
      ...(c.attachedToInstanceId
        ? { attachedToInstanceId: c.attachedToInstanceId }
        : {}),
      ...(c.attachedChildrenIds.length > 0
        ? { attachedChildrenIds: c.attachedChildrenIds }
        : {}),
      ...(underCards.length > 0 ? { underCards } : {}),
    };
  });

  return {
    turn: state.turnNumber,
    step: state.step,
    activePlayerId: state.activePlayerId,
    gameResult: state.gameResult ?? null,
    players,
    cards,
    activeAttack: state.activeAttack
      ? {
          attackerEntityId: state.activeAttack.primaryEntityId,
          target: state.activeAttack.target,
          blockAssignments: state.activeAttack.blockAssignments ?? [],
        }
      : null,
    logLength: state.log?.length ?? 0,
    pendingLeaveEntities:
      state.pendingLeaveEntities?.map((e: PendingLeaveEntity) => ({
        instanceId: e.instanceId,
        kind: e.kind,
        cause: e.cause,
      })) ?? [],
    battleImmediateEffects: state.battleImmediateEffects.map((effect) => ({
      promptId: effect.promptId,
      attackId: effect.attackId,
      timing: effect.timing,
      sourceKind: effect.sourceKind,
      sourceInstanceId: effect.sourceInstanceId,
      sourceDefinitionId: effect.sourceDefinitionId,
      ...(effect.sourceEffectDefinitionId !== undefined
        ? { sourceEffectDefinitionId: effect.sourceEffectDefinitionId }
        : {}),
      ...(effect.sourceEffectInstanceId !== undefined
        ? { sourceEffectInstanceId: effect.sourceEffectInstanceId }
        : {}),
      sourceCardNo: effect.sourceCardNo,
      actingPlayerId: effect.actingPlayerId,
      participantEntityId: effect.participantEntityId,
      registrationIndex: effect.registrationIndex,
      ...(effect.executionMode !== undefined
        ? { executionMode: effect.executionMode }
        : {}),
      ...(effect.simultaneousGroupId !== undefined
        ? { simultaneousGroupId: effect.simultaneousGroupId }
        : {}),
    })),
    effectQueueSummary: state.effectQueueSummary ?? [],
  };
}

export function summarizeAction(action: LegalAction) {
  const summary: Record<string, unknown> = {
    actionId: action.actionId,
    kind: action.kind,
    reason: action.reason,
  };
  if ("sourceInstanceId" in action && action.sourceInstanceId)
    summary.sourceInstanceId = action.sourceInstanceId;
  if ("sourceCardNo" in action && action.sourceCardNo)
    summary.sourceCardNo = action.sourceCardNo;
  if ("targetInstanceId" in action && action.targetInstanceId)
    summary.targetInstanceId = action.targetInstanceId;
  if ("actingPlayerId" in action && action.actingPlayerId)
    summary.actingPlayerId = action.actingPlayerId;
  if (action.kind === "set_mirage") {
    summary.replacedMirageInstanceIds = [...action.replacedMirageInstanceIds];
    summary.finalCost = action.finalCost;
  }
  if (action.kind === "resolve_pending_step_choice") {
    summary.choiceIndex = action.choiceIndex;
    summary.choiceLabel = action.choiceLabel;
  }
  if (action.kind === "resolve_pending_step_optional_choice") {
    summary.choice = action.choice;
  }
  const actionRecord = action as LegalAction & Record<string, unknown>;
  for (const key of [
    "sourceDefinitionId",
    "sourceEffectDefinitionId",
    "sourceEffectInstanceId",
    "promptId",
    "pendingId",
    "registrationIndex",
    "executionMode",
    "skipOnly",
    "targetMode",
    "requiredTargetCount",
    "maxTargetCount",
    "candidateTargetInstanceIds",
    "allowDuplicateTargets",
    "selectionTargetGroups",
    "hostInstanceId",
    "hostCardNo",
    "slot",
    "replacedQuartzInstanceId",
    "replacedQuartzName",
    "quartzCountCost",
  ]) {
    const value = actionRecord[key];
    if (value !== undefined && value !== null) summary[key] = value;
  }
  return summary;
}
