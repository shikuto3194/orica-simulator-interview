import { beforeEach, expect, it, vi } from "vitest";
import type { GameState } from "@orica/rules-core";

const hooks = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>,
  cursor: 0,
  effects: [] as Array<() => void | (() => void)>,
}));
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => {
    hooks.effects.push(effect);
  },
  useRef: (current: unknown) =>
    hooks.refs[hooks.cursor++] ?? (hooks.refs[hooks.cursor - 1] = { current }),
  useState: (initial: unknown) => [initial, () => {}],
}));
import { useRoomSync } from "../src/hooks/useRoomSync";

const state = { marker: "confirmed" } as unknown as GameState;
const render = (room: string, member = true, viewer = "alice") => {
  hooks.cursor = 0;
  return useRoomSync(
    room,
    undefined,
    member,
    0,
    state,
    undefined,
    "account",
    viewer
  );
};
beforeEach(() => {
  hooks.refs = [];
  hooks.cursor = 0;
  hooks.effects = [];
  vi.unstubAllGlobals();
});

it("StrictMode cleanup releases an aborted mutation flight and settles its original id", async () => {
  let release!: (value: Response) => void;
  let mutationId = "";
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/step")) {
      mutationId = JSON.parse(String(init?.body)).clientMutationId;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    if (url.endsWith("/mutation-settle")) {
      expect(JSON.parse(String(init?.body)).clientMutationId).toBe(mutationId);
      return new Response(
        JSON.stringify({
          clientMutationId: mutationId,
          outcome: "applied",
          roomVersion: 1,
          appliedVersion: 1,
        })
      );
    }
    return new Response(
      JSON.stringify({ version: 1, state, isSpectator: false })
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const sync = render("A");
  const cleanup = hooks.effects[0]!();
  const pending = sync.dispatchStep();
  await vi.waitFor(() => expect(mutationId).not.toBe(""));
  if (typeof cleanup === "function") cleanup();
  release(new Response(JSON.stringify({ version: 1, state })));
  expect(await pending).toMatchObject({ ok: false });
  expect(await sync.pollForChanges()).toEqual(state);
  expect(
    fetchMock.mock.calls.some(([url]) => url.endsWith("/mutation-settle"))
  ).toBe(true);
});

it("an A → B → A switch rejects old callbacks even after returning to A", async () => {
  let release!: (value: Response) => void;
  const fetchMock = vi.fn().mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  const old = render("A");
  const work = old.fetchLatestState();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  render("B");
  const current = render("A");
  release(
    new Response(JSON.stringify({ version: 8, state, isSpectator: false }))
  );
  expect(await work).toBeNull();
  expect(await old.fetchLatestState()).toBeNull();
  expect(await old.dispatchStep()).toMatchObject({ ok: false });
  expect(old.getConfirmedState()).toBeNull();
  expect(current.getConfirmedState()).toBeNull();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("member/viewer changes invalidate the previous audience", () => {
  const member = render("A");
  expect(member.getConfirmedState()).toBe(state);
  const spectator = render("A", false);
  expect(member.getConfirmedState()).toBeNull();
  expect(spectator.getConfirmedState()).toBeNull();
  const bob = render("A", true, "bob");
  expect(bob.getConfirmedState()).toBeNull();
});

it("old-scope effect cleanup does not abort the new room request", async () => {
  render("A");
  const cleanupA = hooks.effects[0]!();
  const current = render("B");
  let release!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    )
  );
  const work = current.fetchLatestState();
  await vi.waitFor(() => expect(release).toBeDefined());
  if (typeof cleanupA === "function") cleanupA();
  release(
    new Response(JSON.stringify({ version: 1, state, isSpectator: false }))
  );
  expect(await work).toEqual(state);
});
