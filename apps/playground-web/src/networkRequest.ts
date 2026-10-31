import type { FetchImplementation } from "./authFetch";

export function retryDelayMs(value: string | null, attempt = 0): number {
  const retry =
    value === null
      ? 0
      : /^\d+(?:\.\d+)?$/.test(value)
        ? Number(value) * 1000
        : Math.max(0, Date.parse(value) - Date.now());
  return Math.max(
    Number.isFinite(retry) ? retry : 0,
    Math.min(10_000, 200 * 2 ** Math.min(attempt, 6)) *
      (0.75 + Math.random() * 0.5)
  );
}

export async function boundedJsonRequest(
  request: FetchImplementation,
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 8_000
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort(init?.signal?.reason);
  if (init?.signal?.aborted) abort();
  else init?.signal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await request(input, {
          ...init,
          signal: controller.signal,
        });
        const body = await response.arrayBuffer();
        return new Response(response.status === 204 ? null : body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("通信の確認が時間内に完了しませんでした。"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", abort);
  }
}
