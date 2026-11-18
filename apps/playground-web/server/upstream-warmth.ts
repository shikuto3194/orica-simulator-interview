/**
 * Keeps the pooled HTTPS connection to the database gateway warm while players
 * are connected. Node's fetch closes idle connections after about 4 seconds, so
 * between two moves every database request used to pay a new TLS handshake
 * (about +0.9 s measured on this host). A cheap request every few seconds keeps
 * one connection open; correctness never depends on it, so failures are ignored.
 */
export const UPSTREAM_WARMTH_INTERVAL_MS = 3_000;
const UPSTREAM_WARMTH_TIMEOUT_MS = 5_000;

export function startUpstreamWarmth(options: {
  url: string;
  apikey: string;
  isActive: () => boolean;
  request?: typeof fetch;
  intervalMs?: number;
}): () => void {
  const request = options.request ?? fetch;
  let inFlight = false;
  const ping = async () => {
    if (inFlight || !options.isActive()) return;
    inFlight = true;
    try {
      const response = await request(options.url, {
        method: "HEAD",
        headers: { apikey: options.apikey },
        signal: AbortSignal.timeout(UPSTREAM_WARMTH_TIMEOUT_MS),
      });
      await response.body?.cancel();
    } catch {
      // Best effort: the next real request opens a connection if this failed.
    } finally {
      inFlight = false;
    }
  };
  const timer = setInterval(
    () => void ping(),
    options.intervalMs ?? UPSTREAM_WARMTH_INTERVAL_MS
  );
  timer.unref();
  return () => clearInterval(timer);
}
