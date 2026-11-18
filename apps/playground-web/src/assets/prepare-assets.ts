import {
  ASSET_MANIFEST_URL,
  ASSET_VERSION_URL,
  parseAssetManifest,
} from "./asset-contract";
import { downloadImages, type ImageDownloadProgress } from "./download-images";
import { IMAGE_REVISION_HEADER } from "./image-cache-contract";
import { openAssetStore, type StorageTier } from "./local-asset-store";
import { IS_INTERVIEW_BUILD } from "../interview-mode";

let preparation: Promise<void> | undefined;
export async function waitForAssetPreparation() {
  let current;
  do {
    current = preparation;
    await current;
  } while (current !== preparation);
}

/** Assets stay in app-owned files, then best-effort cache, then stream normally.
 * A complete local inventory enables immediate entry. Update checking never
 * blocks it. The authenticated app owns the download across screen changes. */
export function prepareAssets(options: {
  signal: AbortSignal;
  onProgress: (progress: ImageDownloadProgress) => void;
  onTier?: (tier: StorageTier) => void;
  onInstalled?: () => void;
}) {
  if (IS_INTERVIEW_BUILD) {
    options.onTier?.("stream");
    options.onProgress({ status: "unavailable", percent: 0, logs: [] });
    return Promise.resolve();
  }
  let ready!: () => void;
  preparation = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const progress = (value: ImageDownloadProgress) => {
    options.onProgress(value);
    if (["ready", "unavailable", "error"].includes(value.status)) ready();
  };
  const stream = () => {
    options.onTier?.("stream");
    progress({ status: "unavailable", percent: 0, logs: [] });
  };
  const run = async () => {
    const { signal } = options;
    signal.throwIfAborted();
    // Files/cache can only replace ordinary media URLs once SW controls the page.
    if (!navigator.serviceWorker || !crypto.subtle) {
      stream();
      return;
    }
    if (!navigator.serviceWorker.controller) {
      await Promise.race([
        new Promise<void>((resolve) =>
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => resolve(),
            { once: true, signal }
          )
        ),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
    signal.throwIfAborted();
    if (!navigator.serviceWorker.controller) {
      stream();
      return;
    }
    const store = await openAssetStore(options.onTier);
    // Persistence is a best-effort eviction protection, never a prerequisite.
    try {
      void navigator.storage.persist?.().catch(() => {});
    } catch {
      /* unsupported */
    }
    let localRevision: string | undefined;
    const previous = await store.match(ASSET_MANIFEST_URL);
    if (previous)
      try {
        const manifest = parseAssetManifest(await previous.json());
        let complete = true;
        for (const asset of manifest.assets) {
          signal.throwIfAborted();
          const saved = await store.match(asset.url);
          if (
            saved?.headers.get(IMAGE_REVISION_HEADER) !== asset.revision ||
            saved.headers.get("Content-Length") !== String(asset.bytes)
          ) {
            complete = false;
            break;
          }
        }
        if (complete) {
          localRevision = manifest.revision;
          progress({ status: "ready", percent: 100, logs: [] });
        }
      } catch {
        signal.throwIfAborted();
      }
    if (localRevision) {
      try {
        const response = await fetch(ASSET_VERSION_URL, {
          cache: "no-store",
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        });
        if (!response.ok || (await response.json()).revision === localRevision)
          return;
      } catch {
        signal.throwIfAborted();
        return;
      }
    }
    const install = () =>
      downloadImages({
        signal,
        store,
        manifestUrl: ASSET_MANIFEST_URL,
        parseManifest: parseAssetManifest,
        onFailure: (error) =>
          console.warn(
            "[orica-assets] preloading failed; using streaming",
            error
          ),
        onProgress(value) {
          if (localRevision && value.status === "checking") return;
          if (value.status === "error" || value.status === "unavailable") {
            if (localRevision) progress(value);
            else stream();
          } else progress(value);
          if (value.status === "ready") options.onInstalled?.();
        },
      });
    // Only installations need serialization. A different tab's update must
    // never delay this tab's already-complete local startup. The downloader
    // rechecks missing files after acquiring the lock.
    if (navigator.locks)
      await navigator.locks.request("orica-asset-install", { signal }, install);
    else await install();
  };
  return run()
    .catch((error: unknown) => {
      if (options.signal.aborted) throw error;
      stream();
    })
    .finally(ready);
}
