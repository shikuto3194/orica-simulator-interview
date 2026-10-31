const path = require("node:path");
const devServerContract = require("./dev-server-contract.json");
const {
  violatesEffectResolutionScope,
} = require("./effect-resolution-scope-guard.cjs");

const SHELL_SEGMENT_SPLIT_RE = /(?:\r?\n|&&|\|\||;)/;
const DIRECT_VITE_RE =
  /^(?:npx(?:\.cmd)?\s+vite\b|(?:corepack\s+)?pnpm(?:\.cmd)?\s+(?:exec\s+)?vite\b|(?:\.?[\\/])?node_modules[\\/]\.bin[\\/]vite(?:\.cmd)?\b|vite(?:\.cmd)?\b)/i;
const WRAPPED_VITE_RE =
  /^(?:start-process|cmd(?:\.exe)?\s+\/(?:c|k)|powershell(?:\.exe)?\s+.*-command|pwsh(?:\.exe)?\s+.*-command)\b.*\bvite\b/i;

const EFFECT_TYPE_PATHS = [
  /^packages[\\/]rules-core[\\/]src[\\/](dsl-types|model)\.ts$/,
  /^packages[\\/]rules-core[\\/]src[\\/].*[\\/](types|kinds|model)\.ts$/,
  /^packages[\\/]rules-core[\\/]src[\\/]effects[\\/].*\.ts$/,
];

const DESIGN_DIR_RE = /^manual[\\/]ai-reference[\\/]20_design[\\/][^\\/]+\.md$/;

const ABANDONED_TAIL_RE =
  /\b(TODO|FIXME|required|未実装|未対応|未完成|後で|あとで)\s*[.。]?\s*$/i;

const KIND_LITERAL_RE =
  /(?:["']kind["']|\bkind)\s*:\s*["']([a-z][a-z0-9_-]*)["']/g;

const SSOT_ZONE_TRIO = ["reserve", "trash", "life"];
const SSOT_DISPLAY_SCOPE = /apps[\\/]playground-web[\\/]src[\\/]/;
const SSOT_ZONE_ALLOW = [
  /coreDisplayOverrides\.ts$/,
  /coreSelectionFacade\.ts$/,
];
const CARD_DATA_SCOPE = /packages[\\/]card-data[\\/]src[\\/]cards[\\/]/;
const ADVENT_LEAVE_SUMMON_CONTEXT_CHARS = 1800;

function normalizeRelPath(rel) {
  return String(rel || "").replaceAll("/", "\\");
}

function normalizeShellTokens(segment) {
  return String(segment || "")
    .replace(/["'`,]/g, " ")
    .replaceAll("\\", "/")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function flagValue(tokens, flag) {
  const index = tokens.findIndex((token) => token === flag);
  if (index >= 0) return tokens[index + 1];
  const prefix = `${flag}=`;
  const joined = tokens.find((token) => token.startsWith(prefix));
  return joined?.slice(prefix.length);
}

function isDevServerStartSegment(segment) {
  const trimmed = String(segment || "")
    .trim()
    .replace(/^&\s*/, "");
  if (!trimmed) return false;
  const commandTokens = normalizeShellTokens(trimmed).map((token) =>
    token.toLowerCase()
  );
  const packageManagerIndex = commandTokens[0] === "corepack" ? 1 : 0;
  const packageManager = commandTokens[packageManagerIndex]?.replace(
    /\.cmd$/,
    ""
  );
  const isPackageDevCommand =
    ["pnpm", "npm", "yarn", "bun"].includes(packageManager ?? "") &&
    commandTokens.some((token) =>
      ["dev", "dev:web", "preview"].includes(token)
    );
  if (isPackageDevCommand || WRAPPED_VITE_RE.test(trimmed)) return true;
  if (!DIRECT_VITE_RE.test(trimmed)) return false;

  const viteIndex = commandTokens.findIndex((token) => token === "vite");
  const viteMode = viteIndex >= 0 ? commandTokens[viteIndex + 1] : undefined;
  return viteMode !== "build";
}

function isCanonicalDevServerSegment(segment, options = {}) {
  const tokens = normalizeShellTokens(segment);
  const lowerTokens = tokens.map((token) => token.toLowerCase());
  const hasNpx = lowerTokens.some(
    (token) => token === "npx" || token === "npx.cmd"
  );
  const hasVite = lowerTokens.includes("vite");
  const configPath = flagValue(tokens, "--config")?.replace(/^\.\//, "");
  const portText = flagValue(tokens, "--port");
  const port = portText && /^\d+$/.test(portText) ? Number(portText) : NaN;
  const isPrimaryWorktree = options.isPrimaryWorktree !== false;

  return (
    hasNpx &&
    hasVite &&
    configPath === devServerContract.configPath &&
    Number.isInteger(port) &&
    (!isPrimaryWorktree || port === devServerContract.mainPort)
  );
}

function checkDevServerCommand(command, options = {}, env = process.env) {
  if (env.ORICA_AI_DEV_SERVER_GUARD_OFF === "true") return null;
  if (typeof command !== "string" || command.trim() === "") return null;

  const segments = command.split(SHELL_SEGMENT_SPLIT_RE);
  const devSegments = segments.filter(isDevServerStartSegment);
  if (devSegments.length === 0) return null;
  if (
    devSegments.every((segment) =>
      isCanonicalDevServerSegment(segment, options)
    )
  ) {
    return null;
  }

  const worktreeNote =
    options.isPrimaryWorktree === false
      ? "並列 worktree では new-worktree.ps1 が割り当てた port に置き換えてよい。"
      : "main working tree では port 4173 固定。";
  return (
    `dev server 起動契約違反: AI は repo root から次のコマンドを使うこと。\n` +
    `${devServerContract.command}\n` +
    `${worktreeNote}\n` +
    `pnpm dev:web / bare vite / apps/playground-web 内からの vite 起動は禁止。` +
    `緊急時のみ ORICA_AI_DEV_SERVER_GUARD_OFF=true で解除できる。`
  );
}

function isVerifiedCommitSegment(segment) {
  const normalized = String(segment || "").replaceAll("\\", "/");
  return (
    /(?:^|\s)(?:node(?:\.exe)?\s+)?(?:\.?\/)?scripts\/verified-commit\.mjs\b/i.test(
      normalized
    ) ||
    /(?:^|\s)(?:corepack\s+)?pnpm(?:\.cmd)?\s+verified-commit\b/i.test(
      normalized
    )
  );
}

function isGitCommitSegment(segment) {
  const tokens = normalizeShellTokens(segment).map((token) =>
    token.toLowerCase()
  );
  let gitIndex = 0;
  while (tokens[gitIndex] === "&" || tokens[gitIndex] === "command") {
    gitIndex++;
  }
  if (tokens[gitIndex] !== "git" && tokens[gitIndex] !== "git.exe") {
    return false;
  }
  for (let i = gitIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (["-c", "-C", "--git-dir", "--work-tree"].includes(token)) {
      i++;
      continue;
    }
    if (token.startsWith("-")) continue;
    return token === "commit";
  }
  return false;
}

function checkVerifiedCommitCommand(command, env = process.env) {
  if (env.ORICA_AI_DIRECT_GIT_COMMIT_OK === "true") return null;
  if (typeof command !== "string" || command.trim() === "") return null;
  const segments = command.split(SHELL_SEGMENT_SPLIT_RE);
  const directCommit = segments.some(
    (segment) =>
      isGitCommitSegment(segment) && !isVerifiedCommitSegment(segment)
  );
  if (!directCommit) return null;
  return (
    "verified commit gate: AI shell commands must not call `git commit` directly.\n" +
    'Run `pnpm verified-commit -- -m "<message>"` or `node scripts/verified-commit.mjs -m "<message>"` after adversarial verifier evidence is current.\n' +
    "Emergency/manual override: ORICA_AI_DIRECT_GIT_COMMIT_OK=true."
  );
}

function hasZoneTrioDiscrimination(txt) {
  if (!txt) return false;
  return SSOT_ZONE_TRIO.every((z) =>
    new RegExp(
      `(?:\\.kind\\s*===\\s*|\\bcase\\s+|["']kind["']\\s*:\\s*)["']${z}["']`
    ).test(txt)
  );
}

function isParallelZoneDisplayMapping(txt) {
  if (!txt) return false;
  return (
    hasZoneTrioDiscrimination(txt) &&
    /[Oo]verrides\b/.test(txt) &&
    !/coreContainerDisplayKey/.test(txt)
  );
}

function hasAdventSourceLeaveSummonExactEventRegression(txt) {
  if (!txt) return false;
  const re = /\brestrictToTriggerLeaveAdventSource\s*:\s*true\b/g;
  let match;
  while ((match = re.exec(txt)) !== null) {
    const nearby = txt.slice(
      Math.max(0, match.index - ADVENT_LEAVE_SUMMON_CONTEXT_CHARS),
      Math.min(txt.length, match.index + ADVENT_LEAVE_SUMMON_CONTEXT_CHARS)
    );
    if (
      /\bevent\s*:\s*["']leave_field["']/.test(nearby) &&
      /\bexactEventKind\s*:\s*true\b/.test(nearby)
    ) {
      return true;
    }
  }
  return false;
}

function checkWriteAdvisor(rel, content, previousContent, env = process.env) {
  if (env.ORICA_AI_WRITE_ADVISOR_OFF === "true") return null;
  if (typeof content !== "string") return null;

  const normWindows = normalizeRelPath(rel);

  const isEffectFile = EFFECT_TYPE_PATHS.some((re) => re.test(normWindows));
  if (isEffectFile) {
    const before = new Set();
    if (previousContent) {
      for (const m of previousContent.matchAll(KIND_LITERAL_RE))
        before.add(m[1]);
    }
    const after = new Set();
    for (const m of content.matchAll(KIND_LITERAL_RE)) after.add(m[1]);
    const added = [...after].filter((k) => !before.has(k));
    if (added.length > 0) {
      return (
        `Cross-cutting Rule 違反候補: ${rel} に新規 kind ${added
          .map((k) => `"${k}"`)
          .join(", ")} を追加しようとしている。\n` +
        `CLAUDE.md「Effect 型への専用フィールド追加は原則禁止」「専用ハンドラを書く前に既存の汎用パイプラインで表現できないか検討する」を再確認。\n` +
        `既存 action / evaluateCondition / 共通プリミティブで表現できないか先に検討すること。\n` +
        `本当に追加が必要なら env ORICA_AI_WRITE_ADVISOR_OFF=true で advisor を無効化できる。`
      );
    }
  }

  if (DESIGN_DIR_RE.test(normWindows)) {
    const isNew = previousContent === undefined;
    const lineCount = content.split(/\r?\n/).length;
    if (isNew && lineCount < 30) {
      return (
        `${rel} は manual/ai-reference/20_design/ (reference 配置、target 18KB/250 行) に ${lineCount} 行で作成しようとしている。\n` +
        `短文 TODO / 設計メモは issues/<ID>.md または issues/<ID>/index.md に書く規約 (CLAUDE.md ドキュメント管理 / 課題管理セクション参照)。\n` +
        `継続して reference として育てる確証があるなら 30 行以上の構造で書き直すか、env ORICA_AI_WRITE_ADVISOR_OFF=true で無効化。`
      );
    }
  }

  if (previousContent === undefined) {
    const trimmed = content.trim();
    const lineCount = trimmed.split(/\r?\n/).length;
    if (
      lineCount < 5 &&
      trimmed.length > 0 &&
      ABANDONED_TAIL_RE.test(trimmed)
    ) {
      return (
        `${rel} は ${lineCount} 行で末尾が TODO / required / 未実装 系の言葉で終わっている。\n` +
        `「LLM が途中で投げた中間ファイル」の signature。完成させてから書くか、issues/ に書くか、env ORICA_AI_WRITE_ADVISOR_OFF=true で無効化。`
      );
    }
  }

  if (
    SSOT_DISPLAY_SCOPE.test(normWindows) &&
    !SSOT_ZONE_ALLOW.some((re) => re.test(normWindows)) &&
    isParallelZoneDisplayMapping(content) &&
    !isParallelZoneDisplayMapping(previousContent)
  ) {
    return (
      `SSOT 違反候補: ${rel} がコア所在→表示キー写像を正源 coreContainerDisplayKey() を介さず独自実装しようとしている (ゾーン三つ組判別 ＋ overrides 構築を検出)。\n` +
      `apps/playground-web/src/coreDisplayOverrides.ts の coreContainerDisplayKey() を共有 / 拡張すること (CLAUDE.md「同じ列挙の判別・写像を 2 箇所に実装しない」)。\n` +
      `ゾーン制御フロー等の正当な別実装なら env ORICA_AI_WRITE_ADVISOR_OFF=true で無効化できる。`
    );
  }

  if (violatesEffectResolutionScope(rel, content)) {
    return `SSOT 違反: ${rel} の継続解決は createEffectResolutionScope() を経由すること。実行と最終化に別々の chainId を渡さない。`;
  }

  if (
    CARD_DATA_SCOPE.test(normWindows) &&
    hasAdventSourceLeaveSummonExactEventRegression(content) &&
    !hasAdventSourceLeaveSummonExactEventRegression(previousContent)
  ) {
    return (
      `SSOT 違反候補: ${rel} が restrictToTriggerLeaveAdventSource 型の煌臨元召喚を exactEventKind:true の physical leave_field に戻そうとしている。\n` +
      `BSSG01-C08 型は「離れるとき」= pending leave pre-flush 参照。manual/ai-reference/10_rules/04_state-based-rules.md と trigger-system.ts の pendingLeave adventSourceInstanceIds に寄せること。\n` +
      `正当な別用途なら env ORICA_AI_WRITE_ADVISOR_OFF=true で advisor を無効化できる。`
    );
  }

  return null;
}

function relFromRepo(repoRoot, absOrRel) {
  if (!absOrRel) return "";
  const abs = path.isAbsolute(absOrRel)
    ? absOrRel
    : path.resolve(repoRoot, absOrRel);
  return path.relative(repoRoot, abs) || "";
}

module.exports = {
  checkWriteAdvisor,
  checkDevServerCommand,
  checkVerifiedCommitCommand,
  isCanonicalDevServerSegment,
  isDevServerStartSegment,
  isGitCommitSegment,
  isVerifiedCommitSegment,
  relFromRepo,
  isParallelZoneDisplayMapping,
  hasAdventSourceLeaveSummonExactEventRegression,
};
