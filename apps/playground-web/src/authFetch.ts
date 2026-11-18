export interface AuthTokenSource {
  getAccessToken: () => Promise<string | null>;
  refreshAccessToken: () => Promise<string | null>;
}

export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/** ローカルに有効な Supabase セッションが無く、認証付き通信を開始できない。 */
export class AuthSessionUnavailableError extends Error {
  constructor() {
    super("Authentication session is unavailable.");
    this.name = "AuthSessionUnavailableError";
  }
}

function withBearerToken(
  init: RequestInit | undefined,
  token: string
): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

export async function boundedAuthToken(
  getToken: () => Promise<string | null>
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(getToken),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("認証の確認が時間内に完了しませんでした。")),
          7_000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const refreshes = new WeakMap<
  AuthTokenSource["refreshAccessToken"],
  Promise<string | null>
>();
function refreshOnce(source: AuthTokenSource): Promise<string | null> {
  const key = source.refreshAccessToken;
  const existing = refreshes.get(key);
  if (existing) return existing;
  const pending = boundedAuthToken(key).finally(() => {
    if (refreshes.get(key) === pending) refreshes.delete(key);
  });
  refreshes.set(key, pending);
  return pending;
}

/**
 * Supabase JWT を付けて通信し、401 のときだけセッションを更新して 1 回再送する。
 *
 * `getSession()` は期限間近の JWT を自動更新するが、サーバー側で失効済みの
 * JWT は期限内でも返り得る。ルーム API の 401 を契機に強制更新することで、
 * ロビーに英語の認証エラーを残したまま操作不能になる状態から復帰させる。
 */
export async function fetchWithAuthRetry(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  tokenSource: AuthTokenSource,
  fetchImplementation: FetchImplementation = fetch
): Promise<Response> {
  let token = await boundedAuthToken(tokenSource.getAccessToken);
  let refreshed = false;

  // user state と session storage の反映に一時的なずれがある場合も 1 回復旧を試す。
  if (!token) {
    token = await refreshOnce(tokenSource);
    refreshed = true;
  }
  if (!token) throw new AuthSessionUnavailableError();

  init?.signal?.throwIfAborted();
  const response = await fetchImplementation(
    input,
    withBearerToken(init, token)
  );
  if (response.status !== 401 || refreshed) return response;

  const refreshedToken = await refreshOnce(tokenSource);
  if (!refreshedToken) throw new AuthSessionUnavailableError();

  await response.body?.cancel();
  init?.signal?.throwIfAborted();
  return fetchImplementation(input, withBearerToken(init, refreshedToken));
}
