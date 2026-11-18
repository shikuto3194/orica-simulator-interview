import { IMAGE_CACHE_NAME } from "./image-cache-contract";
import { IS_INTERVIEW_BUILD } from "../interview-mode";

export const ASSET_DIRECTORY = "orica-assets-v1";
export type AssetStore = Pick<Cache, "match" | "put" | "keys" | "delete">;
export type StorageTier = "files" | "cache" | "stream";
const SAVED_AT = "X-Orica-Saved-At";
async function newest(stores: AssetStore[], input: RequestInfo | URL) {
  let result: Response | undefined;
  for (const store of stores)
    try {
      const saved = await store.match(input);
      if (
        saved &&
        (!result ||
          Number(saved.headers.get(SAVED_AT)) >
            Number(result.headers.get(SAVED_AT)))
      )
        result = saved;
    } catch {
      /* next readable store */
    }
  return result;
}
const absolute = (input: RequestInfo | URL) =>
  new URL(input instanceof Request ? input.url : String(input), location.origin)
    .href;
async function filename(url: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(url)
  );
  return Array.from(new Uint8Array(hash), (v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
}

/** An atomic OPFS file holds both response metadata and body. Failed writes
 * never replace a complete previous response. Only this app's directory is used. */
export async function openFileStore(create = false): Promise<AssetStore> {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(ASSET_DIRECTORY, { create });
  async function read(name: string) {
    const file = await (await directory.getFileHandle(name)).getFile();
    const prefix = await file.slice(0, 4).arrayBuffer();
    if (prefix.byteLength !== 4) throw new Error("Incomplete asset header");
    const length = new DataView(prefix).getUint32(0);
    if (length > 16384 || file.size < length + 4)
      throw new Error("Invalid asset header");
    const meta = JSON.parse(await file.slice(4, 4 + length).text()) as {
      url: string;
      headers: [string, string][];
      bytes: number;
    };
    if (file.size !== 4 + length + meta.bytes)
      throw new Error("Incomplete asset body");
    return {
      url: meta.url,
      response: new Response(file.slice(4 + length), { headers: meta.headers }),
    };
  }
  return {
    async match(input) {
      const url = absolute(input);
      try {
        const saved = await read(await filename(url));
        return saved.url === url ? saved.response : undefined;
      } catch {
        return undefined;
      }
    },
    async put(input, response) {
      const url = absolute(input);
      const body = await response.blob();
      const header = new TextEncoder().encode(
        JSON.stringify({
          url,
          headers: [...response.headers.entries()],
          bytes: body.size,
        })
      );
      const prefix = new ArrayBuffer(4);
      new DataView(prefix).setUint32(0, header.byteLength);
      const file = await directory.getFileHandle(await filename(url), {
        create: true,
      });
      const writer = await file.createWritable();
      try {
        await writer.write(new Blob([prefix, header, body]));
        await writer.close();
      } catch (error) {
        await writer.abort().catch(() => {});
        throw error;
      }
    },
    async keys() {
      const keys: Request[] = [];
      const entries = directory as FileSystemDirectoryHandle & {
        keys(): AsyncIterableIterator<string>;
      };
      for await (const name of entries.keys()) {
        try {
          keys.push(new Request((await read(name)).url));
        } catch {
          /* incomplete entry */
        }
      }
      return keys;
    },
    async delete(input) {
      try {
        await directory.removeEntry(await filename(absolute(input)));
        return true;
      } catch {
        return false;
      }
    },
  };
}
export async function openCacheStore(): Promise<AssetStore> {
  return caches.open(IMAGE_CACHE_NAME);
}

/** Probe write access, then fall back once on each failed tier. Completed files
 * remain readable; a failed write retries the same verified response. */
export async function openAssetStore(
  onTier: (tier: StorageTier) => void = () => {},
  factories: (() => Promise<AssetStore>)[] = [
    () => openFileStore(true),
    openCacheStore,
  ]
): Promise<AssetStore> {
  if (IS_INTERVIEW_BUILD) {
    throw new DOMException("Persistent asset storage is disabled", "NotAllowedError");
  }
  const stores: AssetStore[] = [];
  let cursor = 0;
  let active: AssetStore | undefined;
  let switching: Promise<void> | undefined;
  async function advance() {
    active = undefined;
    while (cursor < factories.length) {
      const tier = cursor++;
      try {
        const candidate = await factories[tier]!();
        const probe = new URL(
          `/__orica-storage-probe-${crypto.randomUUID()}`,
          location.origin
        ).href;
        await candidate.put(probe, new Response("ok"));
        await candidate.delete(probe);
        stores.push(candidate);
        active = candidate;
        onTier(tier === 0 ? "files" : "cache");
        return;
      } catch {
        /* next storage tier */
      }
    }
    onTier("stream");
    throw new DOMException("Asset storage unavailable", "QuotaExceededError");
  }
  await advance();
  // Existing image caches remain usable when OPFS becomes available.
  if (cursor === 1 && factories[1])
    try {
      stores.push(await factories[1]());
    } catch {
      /* optional */
    }
  return {
    async match(input) {
      return newest(stores, input);
    },
    async put(input, response) {
      const headers = new Headers(response.headers);
      const previous = await newest(stores, input);
      headers.set(
        SAVED_AT,
        String(
          Math.max(Date.now(), Number(previous?.headers.get(SAVED_AT) ?? 0) + 1)
        )
      );
      const stamped = new Response(response.body, { headers });
      for (;;) {
        if (switching) await switching;
        const current = active;
        if (!current)
          throw new DOMException(
            "Asset storage unavailable",
            "QuotaExceededError"
          );
        try {
          await current.put(input, stamped.clone());
          return;
        } catch (error) {
          console.warn("[orica-assets] storage write failed", error);
          if (current === active && !switching)
            switching = advance().finally(() => {
              switching = undefined;
            });
          if (switching) await switching;
        }
      }
    },
    async keys() {
      const keys = new Map<string, Request>();
      for (const store of stores)
        try {
          for (const request of await store.keys())
            keys.set(request.url, request);
        } catch {
          /* unavailable store */
        }
      return [...keys.values()];
    },
    async delete(input) {
      const results = await Promise.allSettled(
        stores.map((store) => store.delete(input))
      );
      return results.some(
        (result) => result.status === "fulfilled" && result.value
      );
    },
  };
}
export async function readLocalAsset(input: RequestInfo | URL) {
  if (IS_INTERVIEW_BUILD) return null;
  const stores: AssetStore[] = [];
  for (const open of [() => openFileStore(), openCacheStore]) {
    try {
      stores.push(await open());
    } catch {
      /* next tier */
    }
  }
  return newest(stores, input);
}
