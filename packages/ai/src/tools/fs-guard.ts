import { resolve, sep } from "node:path";
import { defaultRepoRoot } from "../context/project.js";

const DEFAULT_DENY_PATTERNS: RegExp[] = [
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])dist([\\/]|$)/,
  /(^|[\\/])\.git([\\/]|$)/,
  /(^|[\\/])\.pnpm-store([\\/]|$)/,
  /(^|[\\/])\.env(\.[^\\/]+)?$/,
];

export interface PathGuardOptions {
  repoRoot?: string;
  /** 書き込み禁止パターン (write_file / apply_edit で使う) */
  denyPatterns?: RegExp[];
}

export interface ResolvedPath {
  abs: string;
  rel: string;
}

export function resolveInsideRepo(
  pathInput: string,
  options: PathGuardOptions = {}
): ResolvedPath {
  const repoRoot = resolve(options.repoRoot ?? defaultRepoRoot());
  const abs = resolve(repoRoot, pathInput);
  const norm = abs + sep;
  const rootNorm = repoRoot + sep;
  if (!norm.startsWith(rootNorm) && abs !== repoRoot) {
    throw new Error(
      `path escape detected: ${pathInput} resolved to ${abs} (outside ${repoRoot})`
    );
  }
  return { abs, rel: abs.slice(repoRoot.length + 1) };
}

export function assertWritable(
  resolved: ResolvedPath,
  options: PathGuardOptions = {}
): void {
  const deny = options.denyPatterns ?? DEFAULT_DENY_PATTERNS;
  for (const re of deny) {
    if (re.test(resolved.rel)) {
      throw new Error(`write denied for protected path: ${resolved.rel}`);
    }
  }
}
