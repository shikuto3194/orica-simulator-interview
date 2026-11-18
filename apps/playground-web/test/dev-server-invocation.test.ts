import { describe, expect, it } from "vitest";
import contract from "../../../scripts/harness/dev-server-contract.json";
import {
  cliFlagValue,
  devServerInvocationError,
  type DevServerInvocation,
} from "../server/dev-server-invocation";

const canonical = [
  "--config",
  contract.configPath,
  "--port",
  String(contract.mainPort),
];

function invocation(
  overrides: Partial<DevServerInvocation> = {}
): DevServerInvocation {
  return {
    argv: canonical,
    executable: "/repo/node_modules/vite/bin/vite.js",
    isPrimaryWorktree: true,
    laneServerPort: undefined,
    ...overrides,
  };
}

const withPort = (port: string) => [
  "--config",
  contract.configPath,
  "--port",
  port,
];

describe("dev server contract", () => {
  it("accepts the canonical command in the primary worktree", () => {
    expect(devServerInvocationError(invocation(), contract)).toBeNull();
  });

  it("rejects another port in the primary worktree (a hand-started dev server)", () => {
    expect(
      devServerInvocationError(invocation({ argv: withPort("4999") }), contract)
    ).toContain("orica dev server contract");
  });

  it("accepts a free port for a browser test runner lane even in a primary worktree (every CI checkout)", () => {
    expect(
      devServerInvocationError(
        invocation({ argv: withPort("4999"), laneServerPort: "4999" }),
        contract
      )
    ).toBeNull();
  });

  it("lifts the main-port rule only for the port the mark names", () => {
    // a stray `1`, or a mark left over from another run, opens nothing else
    for (const mark of ["1", "4998", ""]) {
      expect(
        devServerInvocationError(
          invocation({ argv: withPort("4999"), laneServerPort: mark }),
          contract
        )
      ).not.toBeNull();
    }
  });

  it("accepts another port in a linked worktree", () => {
    expect(
      devServerInvocationError(
        invocation({ argv: withPort("4999"), isPrimaryWorktree: false }),
        contract
      )
    ).toBeNull();
  });

  it("keeps the config path and a numeric port required for a lane server", () => {
    expect(
      devServerInvocationError(
        invocation({
          argv: ["--config", "other/vite.config.ts", "--port", "4999"],
          laneServerPort: "4999",
        }),
        contract
      )
    ).not.toBeNull();
    expect(
      devServerInvocationError(
        invocation({ argv: withPort("auto"), laneServerPort: "4999" }),
        contract
      )
    ).not.toBeNull();
    expect(
      devServerInvocationError(
        invocation({
          argv: ["--config", contract.configPath],
          laneServerPort: "4999",
        }),
        contract
      )
    ).not.toBeNull();
  });

  it("does not check build, preview or a process that is not vite", () => {
    expect(
      devServerInvocationError(invocation({ argv: ["build"] }), contract)
    ).toBeNull();
    expect(
      devServerInvocationError(invocation({ argv: ["preview"] }), contract)
    ).toBeNull();
    expect(
      devServerInvocationError(
        invocation({ executable: "C:\\tools\\other\\cli.js", argv: [] }),
        contract
      )
    ).toBeNull();
  });

  it("reads flags in both spellings", () => {
    expect(cliFlagValue(["--port", "4173"], "--port")).toBe("4173");
    expect(cliFlagValue(["--port=4173"], "--port")).toBe("4173");
    expect(cliFlagValue([], "--port")).toBeUndefined();
  });
});
