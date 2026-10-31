#!/usr/bin/env node
/**
 * fetch-bgm-assets — BGM 音源 (sounds/) と背景画像 (images/title/) を
 * tarball から復元する。
 *
 * 編集元の JPG/PNG/MP3 は Git 管理外なので、再圧縮するときだけ復元する。
 * 配信用 WebP/M4A は Git 管理しており、通常の clone/build では復元不要。
 *
 * tarball パスは環境変数 ORICA_BGM_ASSETS_TARBALL で上書き可能。
 * 既定値は C:\dev 下の archive ディレクトリ (OneDrive 外・同期負荷回避)。
 *
 * 動作: idempotent — 音源・背景の編集元が両方あれば skip。
 * --force で強制再展開。
 *
 * 対の作成スクリプトは pack-bgm-assets.mjs。
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const SOUND_DIR = path.join(ROOT, "sounds", "music");
const TITLE_DIR = path.join(ROOT, "images", "title");

const DEFAULT_TARBALL =
  "C:/dev/orica-bgm-assets-archive/orica-bgm-assets-2026-05-17.tar.gz";

const tarball = process.env.ORICA_BGM_ASSETS_TARBALL ?? DEFAULT_TARBALL;

function hasOriginals(dir, pattern) {
  return (
    fs.existsSync(dir) &&
    fs.readdirSync(dir, { recursive: true }).some((name) => pattern.test(name))
  );
}

if (
  hasOriginals(SOUND_DIR, /\.mp3$/i) &&
  hasOriginals(TITLE_DIR, /\.(png|jpe?g)$/i)
) {
  console.log(
    "[fetch-bgm-assets] original audio/background files already present — skip (use --force to override)"
  );
  if (!process.argv.includes("--force")) {
    process.exit(0);
  }
  console.log("[fetch-bgm-assets] --force specified, re-extracting...");
}

if (!fs.existsSync(tarball)) {
  console.error(`[fetch-bgm-assets] tarball not found: ${tarball}`);
  console.error(
    "Set ORICA_BGM_ASSETS_TARBALL env var or place the tarball at the default path."
  );
  console.error("To create a tarball, run: pnpm pack-bgm-assets");
  process.exit(1);
}

console.log(`[fetch-bgm-assets] extracting ${tarball}...`);
try {
  // --force-local: Windows ドライブ文字 (C:) をホスト名と誤解させない (GNU tar)
  execSync(`tar --force-local -xzf "${tarball}" -C "${ROOT}"`, {
    stdio: "inherit",
  });
  console.log("[fetch-bgm-assets] done");
} catch (err) {
  console.error("[fetch-bgm-assets] extraction failed:", err.message);
  process.exit(1);
}
