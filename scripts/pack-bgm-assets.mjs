#!/usr/bin/env node
/**
 * pack-bgm-assets — sounds/ と images/title/ を tarball にまとめて配信用に保存する。
 *
 * 既定の出力先は C:\dev 下の archive ディレクトリ (OneDrive 外・同期負荷回避)
 * (orica-card-images-archive/ と同じ規約)。
 *
 * ファイル名は `orica-bgm-assets-YYYY-MM-DD.tar.gz`。
 * 出力先は環境変数 ORICA_BGM_ASSETS_TARBALL で上書き可能。
 *
 * MP3 は既に圧縮済みなので gzip による追加圧縮効果は乏しいが、
 * 単一ファイル配信の方が同期/転送が楽なため tar.gz でまとめる。
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const SOUND_DIR = path.join(ROOT, "sounds");
const TITLE_DIR = path.join(ROOT, "images", "title");

const today = new Date().toISOString().slice(0, 10);
const DEFAULT_ARCHIVE_DIR = "C:/dev/orica-bgm-assets-archive";
const DEFAULT_TARBALL = path.join(
  DEFAULT_ARCHIVE_DIR,
  `orica-bgm-assets-${today}.tar.gz`
);

const tarball = process.env.ORICA_BGM_ASSETS_TARBALL ?? DEFAULT_TARBALL;
const archiveDir = path.dirname(tarball);

if (!fs.existsSync(SOUND_DIR) || !fs.existsSync(TITLE_DIR)) {
  console.error(
    `[pack-bgm-assets] source dirs missing — expected both ${SOUND_DIR} and ${TITLE_DIR}`
  );
  process.exit(1);
}

if (!fs.existsSync(archiveDir)) {
  console.log(`[pack-bgm-assets] creating ${archiveDir}`);
  fs.mkdirSync(archiveDir, { recursive: true });
}

console.log(`[pack-bgm-assets] packing to ${tarball}...`);
console.log(
  `[pack-bgm-assets]   sounds/ + images/title/ (~1.5GB, may take minutes)`
);
try {
  // --force-local: Windows ドライブ文字 (C:) をホスト名と誤解させない (GNU tar)
  execSync(
    `tar --force-local -czf "${tarball}" -C "${ROOT}" sounds "images/title"`,
    {
      stdio: "inherit",
    }
  );
  const sizeMB = (fs.statSync(tarball).size / 1024 / 1024).toFixed(1);
  console.log(`[pack-bgm-assets] done (${sizeMB} MB)`);
} catch (err) {
  console.error("[pack-bgm-assets] packing failed:", err.message);
  process.exit(1);
}
