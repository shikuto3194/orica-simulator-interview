/** 公開サイトと API を別ホストに置く。未指定の開発環境では同一 origin を使う。 */
export function createApiUrl(base = ""): (path: string) => string {
  const trimmed = base.trim().replace(/\/$/, "");
  if (trimmed) {
    const url = new URL(trimmed);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.hostname.includes("*") ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.origin !== trimmed
    ) {
      throw new Error("VITE_API_BASE_URL must be an HTTPS origin (no path).");
    }
  }
  return (path) => {
    if (!path.startsWith("/api/")) throw new Error("Expected an /api/ path.");
    return `${trimmed}${path}`;
  };
}

export const apiUrl = createApiUrl(import.meta.env.VITE_API_BASE_URL);
