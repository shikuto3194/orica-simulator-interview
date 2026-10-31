import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

/** Encoded bytes stored by the filesystem; NTFS compression is transparent to readers. */
export function storedFileSizes(files) {
  if (!files.length) return [];
  if (process.platform !== "win32") return files.map((file) => file.bytes);
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      fileURLToPath(new URL("./stored-file-sizes.ps1", import.meta.url)),
    ],
    {
      input: JSON.stringify(files.map((file) => file.path)),
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024 ** 2,
      timeout: 30000,
    }
  );
  if (result.error || result.status !== 0)
    throw new Error(
      "cannot measure stored artifact bytes: " +
        (result.error?.message || result.stderr)
    );
  const sizes = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
  if (
    !Array.isArray(sizes) ||
    sizes.length !== files.length ||
    sizes.some((size) => !Number.isSafeInteger(size) || size < 0)
  )
    throw new Error("invalid stored artifact size response");
  return sizes;
}
