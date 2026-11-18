import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureE2EAuth,
  signInAsAlice,
  signInAsBob,
} from "../../../e2e/security/auth-helpers";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("../load-server-env", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("live room E2E authentication", () => {
  it("leaves Supabase untouched for missing credentials and uses only fixed accounts otherwise", async () => {
    vi.stubEnv("E2E_ALICE_EMAIL", undefined);
    await expect(signInAsAlice()).rejects.toThrow("E2E_ALICE_EMAIL");
    expect(createClient).not.toHaveBeenCalled();

    vi.stubEnv("E2E_ALICE_EMAIL", "alice@example.test");
    vi.stubEnv("E2E_ALICE_PASSWORD", "alice-test-password");
    vi.stubEnv("E2E_BOB_EMAIL", "bob@example.test");
    vi.stubEnv("E2E_BOB_PASSWORD", "bob-test-password");
    const signInAnonymously = vi.fn();
    const signInWithPassword = vi.fn(async ({ email }: { email: string }) => ({
      data: { user: { id: email }, session: { access_token: "fixture-token" } },
      error: null,
    }));
    createClient.mockReturnValue({
      auth: { signInWithPassword, signInAnonymously },
    });
    const fetch = vi.fn(async () => Response.json({ roomId: "fixture-room" }));
    vi.stubGlobal("fetch", fetch);

    await expect(ensureE2EAuth("http://localhost")).resolves.toEqual({
      available: true,
      reason: "",
    });
    await expect(signInAsAlice()).resolves.toMatchObject({
      userId: "alice@example.test",
    });
    await expect(signInAsBob()).resolves.toMatchObject({
      userId: "bob@example.test",
    });
    expect(signInWithPassword.mock.calls.map(([value]) => value.email)).toEqual(
      ["alice@example.test", "bob@example.test"]
    );
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
