import { describe, expect, it } from "vitest";
import {
  AuthSessionUnavailableError,
  fetchWithAuthRetry,
  type AuthTokenSource,
  type FetchImplementation,
} from "../src/authFetch";

function authorization(init: RequestInit | undefined): string | null {
  return new Headers(init?.headers).get("Authorization");
}

describe("fetchWithAuthRetry", () => {
  it("現在のアクセストークンを付けて 1 回だけ通信する", async () => {
    const calls: Array<{
      authorization: string | null;
      contentType: string | null;
    }> = [];
    const fetchImplementation: FetchImplementation = async (_input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        authorization: headers.get("Authorization"),
        contentType: headers.get("Content-Type"),
      });
      return new Response("{}", { status: 200 });
    };
    const tokenSource: AuthTokenSource = {
      getAccessToken: async () => "current-token",
      refreshAccessToken: async () => {
        throw new Error("refresh must not be called");
      },
    };

    const response = await fetchWithAuthRetry(
      "/api/room",
      { headers: { "Content-Type": "application/json" } },
      tokenSource,
      fetchImplementation
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        authorization: "Bearer current-token",
        contentType: "application/json",
      },
    ]);
  });

  it("401 のときセッションを更新し、新しいトークンで 1 回再送する", async () => {
    const authorizations: Array<string | null> = [];
    const fetchImplementation: FetchImplementation = async (_input, init) => {
      authorizations.push(authorization(init));
      return new Response("{}", {
        status: authorizations.length === 1 ? 401 : 200,
      });
    };
    let refreshCount = 0;
    const tokenSource: AuthTokenSource = {
      getAccessToken: async () => "stale-token",
      refreshAccessToken: async () => {
        refreshCount += 1;
        return "refreshed-token";
      },
    };

    const response = await fetchWithAuthRetry(
      "/api/room",
      { method: "POST" },
      tokenSource,
      fetchImplementation
    );

    expect(response.status).toBe(200);
    expect(refreshCount).toBe(1);
    expect(authorizations).toEqual([
      "Bearer stale-token",
      "Bearer refreshed-token",
    ]);
  });

  it("初回取得でトークンが無ければ、更新後のトークンで通信する", async () => {
    const authorizations: Array<string | null> = [];
    const fetchImplementation: FetchImplementation = async (_input, init) => {
      authorizations.push(authorization(init));
      return new Response("{}", { status: 200 });
    };
    const tokenSource: AuthTokenSource = {
      getAccessToken: async () => null,
      refreshAccessToken: async () => "recovered-token",
    };

    await fetchWithAuthRetry(
      "/api/room/abc123/join",
      { method: "POST" },
      tokenSource,
      fetchImplementation
    );

    expect(authorizations).toEqual(["Bearer recovered-token"]);
  });

  it("更新してもトークンが無ければ未認証リクエストを送信しない", async () => {
    let fetchCount = 0;
    const fetchImplementation: FetchImplementation = async () => {
      fetchCount += 1;
      return new Response("{}", { status: 200 });
    };
    const tokenSource: AuthTokenSource = {
      getAccessToken: async () => null,
      refreshAccessToken: async () => null,
    };

    await expect(
      fetchWithAuthRetry(
        "/api/room",
        { method: "POST" },
        tokenSource,
        fetchImplementation
      )
    ).rejects.toBeInstanceOf(AuthSessionUnavailableError);
    expect(fetchCount).toBe(0);
  });

  it("401 後の更新に失敗した場合は古いトークンで再送しない", async () => {
    const authorizations: Array<string | null> = [];
    const fetchImplementation: FetchImplementation = async (_input, init) => {
      authorizations.push(authorization(init));
      return new Response("{}", { status: 401 });
    };
    const tokenSource: AuthTokenSource = {
      getAccessToken: async () => "rejected-token",
      refreshAccessToken: async () => null,
    };

    await expect(
      fetchWithAuthRetry(
        "/api/room",
        { method: "POST" },
        tokenSource,
        fetchImplementation
      )
    ).rejects.toBeInstanceOf(AuthSessionUnavailableError);
    expect(authorizations).toEqual(["Bearer rejected-token"]);
  });
});
