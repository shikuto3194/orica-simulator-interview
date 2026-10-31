import {
  IMAGE_CACHE_NAME,
  IMAGE_MANIFEST_URL,
  IMAGE_REVISION_HEADER,
  IMAGE_VERIFIED_HEADER,
  parseImageManifest,
  type ImageAsset,
} from "./image-cache-contract";
import { assetContentType } from "./asset-contract";
import type { AssetStore } from "./local-asset-store";

export interface ImageDownloadProgress {
  status: "checking" | "downloading" | "ready" | "error" | "unavailable";
  percent: number;
  logs: string[];
}

export const INITIAL_IMAGE_PROGRESS: ImageDownloadProgress = {
  status: "checking",
  percent: 0,
  logs: ["images checking"],
};

export interface DownloadOptions {
  signal: AbortSignal;
  onProgress: (progress: ImageDownloadProgress) => void;
  storage?: CacheStorage;
  fetcher?: typeof fetch;
  store?: AssetStore;
  manifestUrl?: string;
  parseManifest?: typeof parseImageManifest;
  onFailure?: (error: unknown) => void;
}

async function readImage(
  response: Response,
  asset: ImageAsset,
  onBytes: (bytes: number) => void,
  signal: AbortSignal
) {
  if (
    !response.ok ||
    !response.headers
      .get("Content-Type")
      ?.startsWith(assetContentType(asset.url))
  ) {
    throw new Error("画像を取得できませんでした");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("画像を取得できませんでした");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > asset.bytes) throw new Error("画像が更新されました");
      chunks.push(value);
      onBytes(bytes);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (bytes !== asset.bytes)
    throw new Error("画像のダウンロードが中断されました");
  const body = new Blob(chunks, {
    type: response.headers.get("Content-Type")!,
  });
  const hash = await crypto.subtle.digest("SHA-256", await body.arrayBuffer());
  const revision = Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, "0")
  ).join("");
  if (revision !== asset.revision) throw new Error("画像が更新されました");
  signal.throwIfAborted();
  return new Response(body, {
    headers: {
      "Content-Type": body.type,
      "Content-Length": String(bytes),
      [IMAGE_REVISION_HEADER]: revision,
      [IMAGE_VERIFIED_HEADER]: "1",
    },
  });
}

/** Cache writes are per complete, verified file, so reloads resume without a separate ledger. */
export async function downloadImages({
  signal,
  onProgress,
  storage,
  fetcher = fetch,
  store,
  manifestUrl = IMAGE_MANIFEST_URL,
  parseManifest = parseImageManifest,
  onFailure,
}: DownloadOptions): Promise<void> {
  let state = { ...INITIAL_IMAGE_PROGRESS };
  const publish = (patch: Partial<ImageDownloadProgress>) => {
    signal.throwIfAborted();
    if (Object.keys(patch).length === 1 && patch.percent === state.percent)
      return;
    state = { ...state, ...patch };
    onProgress(state);
  };
  const log = (line: string) =>
    publish({ logs: [...state.logs.slice(-2), line] });
  try {
    if (!store) storage ??= globalThis.caches;
  } catch {
    publish({ status: "unavailable", logs: [] });
    return;
  }
  if ((!store && !storage) || !globalThis.crypto?.subtle) {
    publish({
      status: "unavailable",
      logs: [],
    });
    return;
  }
  try {
    publish(INITIAL_IMAGE_PROGRESS);
    let cache: AssetStore;
    try {
      cache = store ?? (await storage!.open(IMAGE_CACHE_NAME));
    } catch {
      publish({ status: "unavailable", logs: [] });
      return;
    }
    let manifest;
    let offlineInventory = false;
    try {
      const response = await fetcher(manifestUrl, {
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) throw new Error("画像一覧を取得できませんでした");
      manifest = parseManifest(await response.json());
    } catch (error) {
      signal.throwIfAborted();
      const previous = await cache.match(manifestUrl);
      if (!previous) throw error;
      manifest = parseManifest(await previous.json());
      offlineInventory = true;
    }
    const missing: ImageAsset[] = [];
    for (const asset of manifest.assets) {
      signal.throwIfAborted();
      const saved = await cache.match(asset.url);
      if (
        saved?.headers.get(IMAGE_REVISION_HEADER) !== asset.revision ||
        saved.headers.get("Content-Length") !== String(asset.bytes)
      )
        missing.push(asset);
    }
    if (offlineInventory && missing.length)
      throw new Error("保存画像が不足しています");
    const totalBytes = missing.reduce((sum, asset) => sum + asset.bytes, 0);
    let completedBytes = 0;
    const active = new Map<string, number>();
    const updateBytes = () =>
      publish({
        percent: totalBytes
          ? Math.min(
              99,
              Math.floor(
                (100 *
                  (completedBytes +
                    [...active.values()].reduce((a, b) => a + b, 0))) /
                  totalBytes
              )
            )
          : 0,
      });
    if (missing.length > 0) publish({ status: "downloading" });
    // Bounded concurrency keeps both network and memory use reasonable on phones.
    let cursor = 0;
    let failed = false;
    const worker = async () => {
      while (!failed) {
        signal.throwIfAborted();
        const asset = missing[cursor++];
        if (!asset) return;
        const name = decodeURIComponent(asset.url.split("/").at(-1)!);
        for (let attempt = 0; attempt < 3; attempt++) {
          signal.throwIfAborted();
          log(`${name} downloading`);
          const stalled = new AbortController();
          let timeout: ReturnType<typeof setTimeout> | undefined;
          const receivedBytes = () => {
            clearTimeout(timeout);
            timeout = setTimeout(
              () =>
                stalled.abort(
                  new DOMException("Download stalled", "TimeoutError")
                ),
              60_000
            );
          };
          try {
            // Query bypasses the unversioned image route and any stale HTTP response.
            // Large audio may take minutes; only a lack of progress times out.
            receivedBytes();
            const requestSignal = AbortSignal.any([signal, stalled.signal]);
            const result = await fetcher(
              `${asset.url}?revision=${asset.revision}`,
              { cache: "no-store", signal: requestSignal }
            );
            const image = await readImage(
              result,
              asset,
              (bytes) => {
                receivedBytes();
                active.set(asset.url, bytes);
                updateBytes();
              },
              requestSignal
            );
            clearTimeout(timeout);
            signal.throwIfAborted();
            try {
              await cache.put(asset.url, image);
            } catch {
              throw new DOMException(
                "Image cache unavailable",
                "QuotaExceededError"
              );
            }
            completedBytes += asset.bytes;
            active.delete(asset.url);
            updateBytes();
            break;
          } catch (error) {
            active.delete(asset.url);
            if (signal.aborted) throw error;
            if (
              attempt === 2 ||
              (error as Error).name === "QuotaExceededError"
            ) {
              failed = true;
              log(`${name} failed`);
              throw error;
            }
          } finally {
            clearTimeout(timeout);
          }
        }
      }
    };
    const results = await Promise.allSettled([worker(), worker()]);
    const rejection = results.find((result) => result.status === "rejected");
    if (rejection?.status === "rejected") throw rejection.reason;
    signal.throwIfAborted();
    // Remove only obsolete images, after this inventory is fully available.
    const wanted = new Set(
      manifest.assets.map((asset) => new URL(asset.url, location.origin).href)
    );
    for (const key of await cache.keys()) {
      signal.throwIfAborted();
      if (
        (new URL(key.url).pathname.startsWith("/images/") ||
          (store && new URL(key.url).pathname.startsWith("/sounds/"))) &&
        !wanted.has(key.url)
      )
        await cache.delete(key);
    }
    // This small completion inventory permits a cache-only start when offline.
    try {
      await cache.put(manifestUrl, Response.json(manifest));
    } catch {
      /* Complete image files are already usable; metadata is optional. */
    }
    publish({
      status: "ready",
      percent: 100,
      logs: [...state.logs.slice(-2), "download complete"],
    });
  } catch (error) {
    if (signal.aborted) throw error;
    onFailure?.(error);
    if (
      (error as Error).name === "QuotaExceededError" ||
      (error as Error).name === "SecurityError"
    ) {
      publish({ status: "unavailable", logs: [] });
      return;
    }
    const message = "通信を確認してタップで再試行";
    publish({ status: "error", logs: [...state.logs.slice(-2), message] });
  }
}
