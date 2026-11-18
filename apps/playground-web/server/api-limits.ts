import type { IncomingMessage, ServerResponse } from "node:http";

export const DEFAULT_API_LIMITS = {
  requestsPerSecond: 60,
  burst: 120,
  peerRequestsPerSecond: 30,
  peerBurst: 60,
  maxActiveRequests: 64,
  maxPeerActiveRequests: 32,
  maxStreams: 32,
  maxPeerStreams: 16,
  maxSockets: 128,
  maxPeers: 1024,
};
export type ApiLimits = typeof DEFAULT_API_LIMITS;

/** Fixed production policy; no environment-controlled numeric test overrides. */
export function apiLimitsForHost(
  host: string,
  behindLoopbackProxy: boolean
): Partial<ApiLimits> {
  return behindLoopbackProxy && host === "127.0.0.1"
    ? {
        peerRequestsPerSecond: 60,
        peerBurst: 120,
        maxPeerActiveRequests: 64,
        maxPeerStreams: 32,
      }
    : {};
}

class TokenBucket {
  private tokens: number;
  private updatedAt: number;
  constructor(
    private capacity: number,
    private rate: number,
    now: number
  ) {
    this.tokens = capacity;
    this.updatedAt = now;
  }
  take(now: number): number {
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (Math.max(0, now - this.updatedAt) * this.rate) / 1000
    );
    this.updatedAt = now;
    if (this.tokens < 1)
      return Math.max(1, Math.ceil((1 - this.tokens) / this.rate));
    this.tokens--;
    return 0;
  }
}

/** Bounds work before authentication/DB access. Never trusts client-supplied proxy headers. */
export function createApiAdmission(
  overrides: Partial<ApiLimits> = {},
  now: () => number = () => performance.now()
) {
  const limits = { ...DEFAULT_API_LIMITS, ...overrides };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("API limits must be positive integers.");
  }
  const globalBucket = new TokenBucket(
    limits.burst,
    limits.requestsPerSecond,
    now()
  );
  const peers = new Map<
    string,
    { bucket: TokenBucket; active: number; streams: number; lastSeen: number }
  >();
  let active = 0;
  let streams = 0;
  let lastSweep = now();
  function reject(res: ServerResponse, retryAfter = 1) {
    res.writeHead(429, {
      "Content-Type": "application/json; charset=utf-8",
      "Retry-After": String(retryAfter),
      Connection: "close",
    });
    res.end(
      JSON.stringify({ error: "Too many requests. Please retry later." })
    );
    return false;
  }
  return {
    limits,
    admit(
      req: IncomingMessage,
      res: ServerResponse,
      authenticatedIdentity?: string
    ): boolean {
      const time = now();
      const retry = globalBucket.take(time);
      if (retry) return reject(res, retry);
      if (time - lastSweep >= 60_000) {
        for (const [key, peer] of peers) {
          if (peer.active === 0 && time - peer.lastSeen >= 60_000)
            peers.delete(key);
        }
        lastSweep = time;
      }
      // Funnel/Caddy may aggregate clients under one peer. Forwarded/X-Forwarded-For
      // cannot safely identify clients without a separately configured trusted proxy.
      const key =
        authenticatedIdentity ?? req.socket.remoteAddress ?? "unknown";
      let peer = peers.get(key);
      if (!peer) {
        if (peers.size >= limits.maxPeers) return reject(res, 60);
        peer = {
          bucket: new TokenBucket(
            limits.peerBurst,
            limits.peerRequestsPerSecond,
            time
          ),
          active: 0,
          streams: 0,
          lastSeen: time,
        };
        peers.set(key, peer);
      }
      peer.lastSeen = time;
      const peerRetry = peer.bucket.take(time);
      if (peerRetry) return reject(res, peerRetry);
      const isStream =
        req.method === "GET" &&
        /^\/api\/room\/[a-z0-9]+\/events(?:\?|$)/.test(req.url ?? "");
      if (
        active >= limits.maxActiveRequests ||
        peer.active >= limits.maxPeerActiveRequests ||
        (isStream &&
          (streams >= limits.maxStreams ||
            peer.streams >= limits.maxPeerStreams))
      )
        return reject(res);
      active++;
      peer.active++;
      if (isStream) {
        streams++;
        peer.streams++;
      }
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        active--;
        peer.active--;
        if (isStream) {
          streams--;
          peer.streams--;
        }
        peer.lastSeen = now();
      };
      res.once("finish", release);
      res.once("close", release);
      return true;
    },
  };
}
