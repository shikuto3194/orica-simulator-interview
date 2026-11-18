import { execFileSync } from "node:child_process";
import type { Plugin } from "vite";

/** Public deployment evidence only; never includes build environment or secrets. */
export function releaseVersionPlugin(root: string): Plugin {
  return {
    name: "release-version",
    apply: "build",
    generateBundle() {
      const revision =
        process.env.COMMIT_REF ||
        execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
          windowsHide: true,
        }).trim();
      if (!/^[0-9a-f]{40}$/.test(revision))
        throw new Error("Invalid release revision");
      this.emitFile({
        type: "asset",
        fileName: "release-version.json",
        source: JSON.stringify({ revision }) + "\n",
      });
    },
  };
}
