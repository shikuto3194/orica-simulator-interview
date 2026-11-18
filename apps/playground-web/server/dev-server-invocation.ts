// The dev server contract (scripts/harness/dev-server-contract.json): a dev
// server is started from the repo root with the canonical command, and the
// primary worktree uses only the main port. The decision is a pure function so
// that the vite config only has to read the process and the file system.
//
// The browser test runner starts its own servers on free ports (two lanes, no shared
// port) and marks each one with ORICA_E2E_LANE_SERVER=<its port>. A GitHub
// Actions checkout is a primary worktree (.git is a directory), so without the
// mark the contract rejected every lane there and the run ended with "the web
// server was not able to start". The mark lifts the main-port rule only for the
// port it names; the config path and a numeric port are still required, and the
// hook refuses a command that assigns the mark (pre-tool-guard-core.cjs).

export interface DevServerContract {
  command: string;
  configPath: string;
  mainPort: number;
}

export interface DevServerInvocation {
  /** process.argv.slice(2) */
  argv: string[];
  /** process.argv[1] */
  executable: string;
  isPrimaryWorktree: boolean;
  /** ORICA_E2E_LANE_SERVER: the port a browser test runner lane marked. */
  laneServerPort: string | undefined;
}

export function cliFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index >= 0) return argv[index + 1];
  const prefix = `${flag}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

/** The error message of a non-canonical invocation, or null when it is fine. */
export function devServerInvocationError(
  invocation: DevServerInvocation,
  contract: DevServerContract
): string | null {
  const { argv } = invocation;
  const name = (invocation.executable.split(/[\\/]/).pop() ?? "").toLowerCase();
  if (!name.startsWith("vite") || argv.includes("build")) return null;
  if (argv.includes("preview")) return null;

  const configPath = cliFlagValue(argv, "--config")
    ?.replaceAll("\\", "/")
    .replace(/^\.\//, "");
  const portText = cliFlagValue(argv, "--port");
  const port = portText && /^\d+$/.test(portText) ? Number(portText) : NaN;
  const portIsValid =
    Number.isInteger(port) &&
    (invocation.laneServerPort === String(port) ||
      !invocation.isPrimaryWorktree ||
      port === contract.mainPort);

  if (configPath !== contract.configPath || !portIsValid) {
    return `[orica dev server contract] repo root から次を実行してください: ${contract.command}`;
  }
  return null;
}
