// vite.config.ts が dev server 起動時だけ、./server/game-api より先に
// await import するサイドエフェクトモジュール。game-api.ts の
// トップレベルが process.env.SUPABASE_SERVICE_ROLE_KEY を読む時点で既に .env の値が
// 反映されている。
//
// linked worktree には gitignore 対象の .env が複製されない。ローカルの最初の worktree
// にだけ保持する service-role キーで final-verify 等も検証できるよう、当該キーが未設定
// のときだけ primary worktree の同じ env ファイルを fallback として読む。
//
// loadEnvFile は Node 22 標準。既に process.env にある値は上書きしないので、
// シェル経由で渡した環境変数が優先される。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { join } from "node:path";

const envFileNames = [".env", ".env.local"] as const;
const appRoot = fileURLToPath(new URL("./", import.meta.url));

function loadEnvFiles(root: string): void {
  for (const file of envFileNames) {
    const filePath = join(root, file);
    if (existsSync(filePath)) {
      process.loadEnvFile(filePath);
    }
  }
}

function primaryWorktreeRoot(): string | null {
  try {
    const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: appRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.match(/^worktree (.+)$/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

// 実room検証用の固定アカウント (E2E_ALICE_* / E2E_BOB_*) は repo 直下の
// .env.e2e.local (.gitignore 済み `.env.*.local`) に置く。Claude/Codex/手動の
// どの実行主体でも同じファイルを読めるよう、primary worktree 側にも fallback する。
const e2eEnvFile = ".env.e2e.local";
const e2eEnvKeys = [
  "E2E_ALICE_EMAIL",
  "E2E_ALICE_PASSWORD",
  "E2E_BOB_EMAIL",
  "E2E_BOB_PASSWORD",
] as const;

function loadE2eEnvFile(root: string): void {
  const filePath = join(root, e2eEnvFile);
  if (existsSync(filePath)) {
    process.loadEnvFile(filePath);
  }
}

loadEnvFiles(appRoot);
loadE2eEnvFile(join(appRoot, "..", ".."));

const needsServiceRoleKey =
  process.env.INTERVIEW_MODE !== "true" &&
  !process.env.SUPABASE_SERVICE_ROLE_KEY;
const needsE2eAccounts = e2eEnvKeys.some((key) => !process.env[key]);
if (needsServiceRoleKey || needsE2eAccounts) {
  const primaryRoot = primaryWorktreeRoot();
  if (primaryRoot) {
    if (needsServiceRoleKey) {
      loadEnvFiles(join(primaryRoot, "apps", "playground-web"));
    }
    if (needsE2eAccounts) {
      loadE2eEnvFile(primaryRoot);
    }
  }
}
