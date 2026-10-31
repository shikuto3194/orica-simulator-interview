import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState } from "@orica/rules-core";

// Transport tests exercise the hook's async methods; actual rendering is covered by e2e.
const { updates } = vi.hoisted(() => ({ updates: [] as unknown[] }));
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [
    initial,
    (value: unknown) => updates.push(value),
  ],
}));
import { useRoomSync } from "../src/hooks/useRoomSync";

describe("room polling delivery after a consumer restart", () => {
  it("redelivers the accepted state at the same version when the prior poll result was not rendered", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { version: 1 }))
      .mockResolvedValueOnce(
        response(200, { version: 1, state: latest, isSpectator: false })
      )
      .mockResolvedValueOnce(response(200, { version: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const sync = useRoomSync("room", undefined, true, 0, initial);
    // An SSE-status change can retire the UI polling effect after the hook
    // accepts this snapshot. No further server mutation follows that lost delivery.
    const unrendered = await sync.pollForChanges();
    expect(unrendered).toEqual(latest);
    expect(await sync.pollForChanges()).toBe(unrendered);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/state/full")
      )
    ).toHaveLength(1);
  });

  it("does not deliver a cached snapshot for a regressed or malformed server version", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { version: 1 }))
      .mockResolvedValueOnce(
        response(200, { version: 1, state: latest, isSpectator: false })
      )
      .mockResolvedValueOnce(response(200, { version: 0 }))
      .mockResolvedValueOnce(response(200, { version: "1" }))
      .mockResolvedValueOnce(response(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    const sync = useRoomSync("room", undefined, true, 0, initial);
    expect(await sync.pollForChanges()).toEqual(latest);
    expect(await sync.pollForChanges()).toBeNull();
    expect(await sync.pollForChanges()).toBeNull();
    expect(await sync.pollForChanges()).toBeNull();
  });
});

const initial = { marker: "initial" } as unknown as GameState;
const latest = { marker: "latest" } as unknown as GameState;
const response = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status });

it("does not advance authority to a snapshot below the recovery target", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      response(200, { version: 2, state: latest, isSpectator: false })
    );
  vi.stubGlobal("fetch", fetchMock);
  const sync = useRoomSync("room", undefined, true, 0, initial);
  expect(await sync.fetchLatestState(3)).toBeNull();
  expect(sync.roomStateVersion.current).toBe(0);
  expect(sync.getConfirmedState()).toBe(initial);
});

it("late HTTP success cannot replace a newer accepted server snapshot", async () => {
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce(
        response(200, { version: 2, state: latest, isSpectator: false })
      )
  );
  const sync = useRoomSync("room", undefined, true, 0, initial);
  const action = sync.dispatchStep();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await sync.fetchLatestState();
  release(response(200, { version: 1, state: { marker: "old ACK" } }));
  expect(await action).toMatchObject({ ok: true, version: 2, state: latest });
  expect(sync.getConfirmedState()).toEqual(latest);
});

it("a non-adjacent HTTP patch requires a full snapshot", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      response(200, {
        version: 3,
        baseVersion: 0,
        patch: [{ op: "replace", path: "/marker", value: "invalid gap" }],
      })
    )
    .mockResolvedValueOnce(
      response(200, { version: 3, state: latest, isSpectator: false })
    );
  vi.stubGlobal("fetch", fetchMock);
  const sync = useRoomSync("room", undefined, true, 0, initial);
  expect(await sync.dispatchStep()).toMatchObject({ ok: true, state: latest });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(sync.getConfirmedState()).toEqual(latest);
});
const dispatchers = [
  [
    "action",
    (sync: ReturnType<typeof useRoomSync>) =>
      sync.dispatchAction("pick", { selectedCount: 2 }),
  ],
  ["step", (sync: ReturnType<typeof useRoomSync>) => sync.dispatchStep()],
  [
    "core-move",
    (sync: ReturnType<typeof useRoomSync>) => sync.dispatchCoreMove([]),
  ],
  [
    "brave-separation",
    (sync: ReturnType<typeof useRoomSync>) =>
      sync.dispatchBraveSeparation({
        actionId: "separate",
        separateCoreDistribution: {},
      }),
  ],
  [
    "claim-victory",
    (sync: ReturnType<typeof useRoomSync>) => sync.dispatchClaimVictory(),
  ],
  [
    "pregame-update",
    (sync: ReturnType<typeof useRoomSync>) =>
      sync.dispatchPregameUpdate({ preGame: {} }),
  ],
] as const;

beforeEach(() => {
  updates.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(dispatchers)("room %s failures", (path, dispatch) => {
  it("401 refreshes the token and preserves the exact mutation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { version: 1, state: latest }));
    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn(async () => "fresh");
    const sync = useRoomSync(
      "room",
      async () => "stale",
      true,
      0,
      initial,
      refresh
    );
    expect(await dispatch(sync)).toMatchObject({ ok: true, state: latest });
    expect(refresh).toHaveBeenCalledOnce();
    expect(
      fetchMock.mock.calls.map((call) =>
        new Headers(call[1].headers).get("Authorization")
      )
    ).toEqual(["Bearer stale", "Bearer fresh"]);
    expect(fetchMock.mock.calls[1]![1].body).toBe(
      fetchMock.mock.calls[0]![1].body
    );
    expect(updates).not.toContainEqual(
      expect.objectContaining({ type: "push_failed" })
    );
  });

  it.each([408, 429, 500, 502, 503, 504])(
    "retries transient HTTP %i with the same mutation ID/version",
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(response(status))
        .mockResolvedValueOnce(response(200, { version: 1, state: latest }));
      vi.stubGlobal("fetch", fetchMock);
      const sync = useRoomSync("room", undefined, true, 0, initial);
      expect(await dispatch(sync)).toMatchObject({ ok: true, state: latest });
      expect(fetchMock.mock.calls[1]![1].body).toBe(
        fetchMock.mock.calls[0]![1].body
      );
    }
  );

  it.each([400, 403, 404, 413])(
    "keeps a permanent HTTP %i rejection visible without retrying",
    async (status) => {
      const fetchMock = vi.fn(async () =>
        response(status, { error: "rejected" })
      );
      vi.stubGlobal("fetch", fetchMock);
      const sync = useRoomSync("room", undefined, true, 0, initial);
      expect(await dispatch(sync)).toMatchObject({ ok: false });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(updates).toContainEqual(
        expect.objectContaining({
          type: "push_failed",
          lastError: expect.stringContaining("rejected"),
        })
      );
    }
  );

  it("recovers conflict without replaying a non-idempotent action", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(409))
      .mockResolvedValueOnce(
        response(200, { version: 2, state: latest, isSpectator: false })
      )
      .mockResolvedValueOnce(response(200, { version: 3, state: latest }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await dispatch(
      useRoomSync("room", undefined, true, 0, initial)
    );
    expect(result.ok).toBe(path === "pregame-update");
    expect(fetchMock).toHaveBeenCalledTimes(path === "pregame-update" ? 3 : 2);
    if (path === "pregame-update") {
      const first = JSON.parse(fetchMock.mock.calls[0]![1].body);
      const retry = JSON.parse(fetchMock.mock.calls[2]![1].body);
      expect(retry.clientMutationId).toBe(first.clientMutationId);
      expect(retry.expectedVersion).toBe(2);
    }
    expect(result.state).toEqual(latest);
  });

  it("shows conflict when its state recovery also fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(409))
        .mockResolvedValueOnce(response(503))
    );
    expect(
      await dispatch(useRoomSync("room", undefined, true, 0, initial))
    ).toMatchObject({ ok: false });
    expect(updates.at(-1)).toMatchObject({
      type: "push_failed",
      lastError: expect.stringContaining("409"),
    });
  });

  it("preserves the original mutation/version when authority advances during retry", async () => {
    vi.useFakeTimers();
    try {
      const postBodies: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          if (url.endsWith("/state/full")) {
            return response(200, {
              version: 8,
              state: latest,
              isSpectator: false,
            });
          }
          expect(init?.method).toBe("POST");
          postBodies.push(String(init?.body));
          if (postBodies.length === 1) throw new TypeError("lost ACK");
          return response(200, { version: 8, state: latest, duplicate: true });
        })
      );
      const sync = useRoomSync("room", undefined, true, 3, initial);
      const work = dispatch(sync);
      await vi.waitFor(() => expect(postBodies).toHaveLength(1));
      await sync.fetchLatestState();
      expect(sync.roomStateVersion.current).toBe(8);
      await vi.runAllTimersAsync();
      expect(await work).toMatchObject({ ok: true, state: latest });
      expect(postBodies).toHaveLength(2);
      expect(postBodies[1]).toBe(postBodies[0]);
      expect(JSON.parse(postBodies[0]!)).toMatchObject({
        expectedVersion: 3,
        clientMutationId: expect.any(String),
      });
      expect(
        JSON.parse(postBodies[0]!).clientMutationId.length
      ).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a lost response with the original mutation ID", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("lost response"))
      .mockResolvedValueOnce(
        response(200, { version: 1, state: latest, duplicate: true })
      );
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await dispatch(useRoomSync("room", undefined, true, 0, initial))
    ).toMatchObject({ ok: true });
    expect(fetchMock.mock.calls[1]![1].body).toBe(
      fetchMock.mock.calls[0]![1].body
    );
  });
});

it("stops retrying a persistent HTTP error after four attempts", async () => {
  const fetchMock = vi.fn(async () => response(503));
  vi.stubGlobal("fetch", fetchMock);
  expect(await useRoomSync("room").dispatchStep()).toMatchObject({ ok: false });
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(updates.at(-1)).toMatchObject({ type: "recovering", retryCount: 4 });
});

it("does not retry earlier than a long Retry-After restriction", async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response("{}", { status: 429, headers: { "Retry-After": "11" } })
  );
  vi.stubGlobal("fetch", fetchMock);
  expect(await useRoomSync("room").dispatchStep()).toMatchObject({ ok: false });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("reconnect fetches even the same version and delivers the authoritative state", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      response(200, { version: 0, state: latest, isSpectator: false })
    )
  );
  const sync = useRoomSync("room", undefined, true, 0, initial);
  expect(await sync.resetPolling()).toEqual(latest);
});

it("failed reconnect retains a visible error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(503))
  );
  const sync = useRoomSync("room", undefined, true, 0, initial);
  await sync.resetPolling();
  expect(updates.at(-1)).toMatchObject({ type: "poll_failed" });
});

it("serializes solo snapshots so an older save cannot overwrite a newer one", async () => {
  let release!: (value: Response) => void;
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    )
    .mockResolvedValueOnce(response(200, { version: 2 }));
  vi.stubGlobal("fetch", fetchMock);
  const sync = useRoomSync(null);
  const first = sync.pushState(initial);
  const second = sync.pushState(latest);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  release(response(200, { version: 1 }));
  await Promise.all([first, second]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetchMock.mock.calls[1]![1].body).state).toEqual(latest);
});

it("solo reconnect saves the latest local board instead of reading another solo session", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(response(400, { error: "Invalid state" }))
    .mockResolvedValueOnce(response(200, { version: 1 }));
  vi.stubGlobal("fetch", fetchMock);
  const sync = useRoomSync(null);
  await sync.pushState(latest);
  await sync.resetPolling();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1]![0]).toBe("/api/game/state");
  expect(JSON.parse(fetchMock.mock.calls[1]![1].body).state).toEqual(latest);
});

it("uncertain operation blocks successors, then recovers with its original ID/version", async () => {
  vi.useFakeTimers();
  try {
    const fetchMock = vi.fn(async () => response(503));
    vi.stubGlobal("fetch", fetchMock);
    const sync = useRoomSync("room", undefined, true, 0, initial);
    const first = sync.dispatchStep();
    await vi.runAllTimersAsync();
    expect(await first).toMatchObject({ ok: false, pending: true });
    const original = fetchMock.mock.calls[0]![1].body;
    fetchMock.mockClear();
    expect(await sync.dispatchAction("successor")).toMatchObject({
      pending: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock
      .mockResolvedValueOnce(
        response(200, {
          clientMutationId: JSON.parse(original).clientMutationId,
          outcome: "applied",
          appliedVersion: 1,
          roomVersion: 1,
        })
      )
      .mockResolvedValueOnce(response(200, { version: 1, state: latest }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await sync.resetPolling()).toEqual(latest);
    expect(fetchMock.mock.calls[0]![0]).toContain("/mutation-settle");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).clientMutationId).toBe(
      JSON.parse(original).clientMutationId
    );
  } finally {
    vi.useRealTimers();
  }
});
it("poll and full-state recovery each keep at most one in-flight request", async () => {
  let release!: (value: Response) => void;
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  const sync = useRoomSync("room", undefined, true, 0, initial);
  const polls = [
    sync.pollForChanges(),
    sync.pollForChanges(),
    sync.pollForChanges(),
  ];
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  release(response(200, { version: 0 }));
  await Promise.all(polls);
  fetchMock.mockClear();
  const snapshots = [sync.fetchLatestState(), sync.fetchLatestState()];
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  release(response(200, { version: 1, state: latest }));
  expect(await Promise.all(snapshots)).toEqual([latest, latest]);
});
it("poll continues after more than five failures and recovers automatically", async () => {
  vi.useFakeTimers();
  try {
    const fetchMock = vi.fn(async () => response(503));
    vi.stubGlobal("fetch", fetchMock);
    const sync = useRoomSync("room");
    for (let i = 0; i < 7; i++) {
      await sync.pollForChanges();
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(fetchMock).toHaveBeenCalledTimes(7);
    fetchMock
      .mockResolvedValueOnce(response(200, { version: 1 }))
      .mockResolvedValueOnce(response(200, { version: 1, state: latest }));
    expect(await sync.pollForChanges()).toEqual(latest);
  } finally {
    vi.useRealTimers();
  }
});

it.each([401, 403, 404, 409, 400])(
  "lost ACK followed by HTTP %i retains the operation until DB settlement",
  async (status) => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("lost ACK"))
        .mockResolvedValue(response(status));
      vi.stubGlobal("fetch", fetchMock);
      const sync = useRoomSync("room");
      const work = sync.dispatchStep();
      await vi.runAllTimersAsync();
      expect(await work).toMatchObject({ pending: true });
      const original = JSON.parse(fetchMock.mock.calls[0][1].body);
      fetchMock.mockClear();
      expect(await sync.dispatchStep()).toMatchObject({ pending: true });
      expect(fetchMock).not.toHaveBeenCalled();
      fetchMock
        .mockResolvedValueOnce(
          response(200, {
            clientMutationId: original.clientMutationId,
            outcome: "cancelled",
            roomVersion: 0,
          })
        )
        .mockResolvedValueOnce(response(200, { version: 0, state: latest }));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await sync.resetPolling()).toEqual(latest);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).clientMutationId).toBe(
        original.clientMutationId
      );
    } finally {
      vi.useRealTimers();
    }
  }
);
it("malformed 2xx ACK does not erase the journal or unlock dependent input", async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("broken", { status: 200 }))
    );
    const sync = useRoomSync("room");
    const work = sync.dispatchStep();
    await vi.runAllTimersAsync();
    expect(await work).toMatchObject({ pending: true });
    expect(await sync.dispatchAction("next")).toMatchObject({ pending: true });
  } finally {
    vi.useRealTimers();
  }
});

it("settlement keeps input blocked until a snapshot reaches its room version", async () => {
  vi.useFakeTimers();
  try {
    const fetchMock = vi.fn(async () => response(503));
    vi.stubGlobal("fetch", fetchMock);
    const sync = useRoomSync("room", undefined, true, 0, initial);
    const work = sync.dispatchStep();
    await vi.runAllTimersAsync();
    expect(await work).toMatchObject({ pending: true });
    const original = JSON.parse(fetchMock.mock.calls[0][1].body);
    await vi.advanceTimersByTimeAsync(30_000);
    fetchMock.mockClear();
    fetchMock
      .mockResolvedValueOnce(
        response(200, {
          clientMutationId: original.clientMutationId,
          outcome: "applied",
          appliedVersion: 2,
          roomVersion: 3,
        })
      )
      .mockResolvedValueOnce(response(200, { version: 1, state: latest }))
      .mockResolvedValueOnce(response(200, { version: 2, state: latest }));
    expect(await sync.resetPolling()).toBeNull();
    expect(await sync.dispatchStep()).toMatchObject({ pending: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_000);
    fetchMock
      .mockResolvedValueOnce(
        response(200, {
          clientMutationId: original.clientMutationId,
          outcome: "applied",
          appliedVersion: 2,
          roomVersion: 3,
        })
      )
      .mockResolvedValueOnce(response(200, { version: 3, state: latest }));
    expect(await sync.resetPolling()).toEqual(latest);
    fetchMock.mockResolvedValueOnce(
      response(200, { version: 4, state: latest })
    );
    expect(await sync.dispatchStep()).toMatchObject({ ok: true });
  } finally {
    vi.useRealTimers();
  }
});

it("settlement honors Retry-After even when reconnect is requested repeatedly", async () => {
  vi.useFakeTimers();
  try {
    const fetchMock = vi.fn(async () => response(503));
    vi.stubGlobal("fetch", fetchMock);
    const sync = useRoomSync("room");
    const work = sync.dispatchStep();
    await vi.runAllTimersAsync();
    expect(await work).toMatchObject({ pending: true });
    await vi.advanceTimersByTimeAsync(30_000);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(
      new Response("{}", {
        status: 429,
        headers: { "Retry-After": "60" },
      })
    );
    await sync.resetPolling();
    await vi.advanceTimersByTimeAsync(59_000);
    await sync.resetPolling();
    await sync.pollForChanges();
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    await sync.resetPolling();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
