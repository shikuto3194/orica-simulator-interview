import { beforeEach, expect, it, vi } from "vitest";
import type { GameState } from "@orica/rules-core";

const hooks = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>,
  cursor: 0,
}));
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
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
  vi.unstubAllGlobals();
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
