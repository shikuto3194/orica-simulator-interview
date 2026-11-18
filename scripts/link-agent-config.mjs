#!/usr/bin/env node
// Claude Code / Codex の共有設定を .codex/ (git 追跡の正本) に一本化する。
// .claude/ は gitignore のため worktree に複製されない。.claude/{skills,rules,agents} を
// .codex/{skills,rules,agents} への junction にし、二重管理 (SSOT 違反) を避ける。
// 冪等。実体ディレクトリが既にある場合は .claude/<name>.pre-link へ退避してから張る。
// 退避先が既にあれば上書きせず、時刻付きの別名へ退避する (退避済みの内容を消さない)。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LINKS = ["skills", "rules", "agents"];

const claudeDir = path.join(root, ".claude");
fs.mkdirSync(claudeDir, { recursive: true });

// 退避先 `<p>.pre-link` が空いていればそれを、埋まっていれば時刻付きの別名を返す。
function backupPathFor(p) {
  const base = `${p}.pre-link`;
  if (!fs.lstatSync(base, { throwIfNoEntry: false })) return base;
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  for (let i = 0; ; i++) {
    const candidate = `${base}-${stamp}${i ? `-${i}` : ""}`;
    if (!fs.lstatSync(candidate, { throwIfNoEntry: false })) return candidate;
  }
}

// 既存の link が target を指していれば true。指す先が消えた (dangling)
// / 循環した link は解決できないので false (呼び出し側で張り直す)。それ以外の errno は再 throw。
function pointsTo(link, target) {
  try {
    return fs.realpathSync(link) === fs.realpathSync(target);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ELOOP") return false;
    throw error;
  }
}

let failed = false;
for (const name of LINKS) {
  const target = path.join(root, ".codex", name);
  const link = path.join(claudeDir, name);
  if (!fs.existsSync(target)) {
    console.error(`[SKIP] .codex/${name} が無い (main を取り込んでから再実行)`);
    failed = true;
    continue;
  }
  const st = fs.lstatSync(link, { throwIfNoEntry: false });
  if (st?.isSymbolicLink()) {
    if (pointsTo(link, target)) {
      console.log(`[OK]   .claude/${name} -> .codex/${name} (既存)`);
      continue;
    }
    fs.unlinkSync(link);
  } else if (st) {
    const backup = backupPathFor(link);
    fs.renameSync(link, backup);
    console.log(`[MOVE] .claude/${name} -> .claude/${path.basename(backup)}`);
  }
  fs.symlinkSync(target, link, "junction");
  console.log(`[LINK] .claude/${name} -> .codex/${name}`);
}

// 旧 .claude/commands は .codex/skills (orica-*) に統合済み。残っていれば退避する。
const commands = path.join(claudeDir, "commands");
const commandsStat = fs.lstatSync(commands, { throwIfNoEntry: false });
if (commandsStat && !commandsStat.isSymbolicLink()) {
  const backup = backupPathFor(commands);
  fs.renameSync(commands, backup);
  console.log(
    `[MOVE] .claude/commands -> .claude/${path.basename(backup)} (skills に統合済み)`
  );
}

process.exit(failed ? 1 : 0);
