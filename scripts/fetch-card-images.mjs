#!/usr/bin/env node
/**
 * fetch-card-images — 編集用の元画像 (images/BS*.png) を tarball から復元する。
 *
 * 配信用 WebP は Git 管理されており、clone 後の通常利用・ビルドには不要。
 * 元 PNG が必要な場合だけ復元し、更新後は pnpm images:prepare で WebP 化する。
 *
 * tarball パスは環境変数 ORICA_IMAGES_TARBALL で上書き可能。
 * 既定値は C:\dev 下の archive ディレクトリ (OneDrive 外・同期負荷回避)。
 *
 * 動作: idempotent — sentinel ファイル (images/BSTH01-C01.png) があれば skip。
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const SENTINEL = path.join(ROOT, "images", "BSTH01-C01.png");

const DEFAULT_TARBALL =
  "C:/dev/orica-card-images-archive/orica-card-images-2026-04-27.tar.gz";

const tarball = process.env.ORICA_IMAGES_TARBALL ?? DEFAULT_TARBALL;

if (fs.existsSync(SENTINEL)) {
  console.log(
    "[fetch-card-images] images/BSTH01-C01.png exists — skip (use --force to override)"
  );
  if (!process.argv.includes("--force")) {
    process.exit(0);
  }
  console.log("[fetch-card-images] --force specified, re-extracting...");
}

if (!fs.existsSync(tarball)) {
  console.error(`[fetch-card-images] tarball not found: ${tarball}`);
  console.error(
    "Set ORICA_IMAGES_TARBALL env var or place the tarball at the default path."
  );
  process.exit(1);
}

console.log(`[fetch-card-images] extracting ${tarball}...`);
try {
  // --force-local: Windows ドライブ文字 (C:) をホスト名と誤解させない (GNU tar)
  execSync(`tar --force-local -xzf "${tarball}" -C "${ROOT}"`, {
    stdio: "inherit",
  });
  console.log("[fetch-card-images] done");
} catch (err) {
  console.error("[fetch-card-images] extraction failed:", err.message);
  process.exit(1);
}
