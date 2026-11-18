import { expect, it, vi } from "vitest";
import {
  invitationDestination,
  openInvitationNotification,
} from "../src/invitationLaunch";

const origin = "https://example.com";
const id = "00000000-0000-4000-8000-000000000010";
it("keeps malformed notification data inside the message inbox", () => {
  expect(invitationDestination("https://evil.test", origin)).toBe(
    `${origin}/?messages=1`
  );
  expect(invitationDestination(id, origin)).toBe(`${origin}/?invitation=${id}`);
});
it.each([3, 2, 1])(
  "prefers an available app at priority %s over lower ranked windows",
  async (priority) => {
    const windows = [1, 2, 3].map((rank) => ({
      rank,
      url: rank === 1 ? invitationDestination(id, origin) : origin,
      focus: vi.fn().mockResolvedValue(undefined),
      postMessage: vi.fn(),
    }));
    const openWindow = vi.fn();
    await openInvitationNotification(
      { matchAll: async () => windows, openWindow },
      origin,
      id,
      async (client) => ({
        priority: windows.find((item) => item === client)!.rank,
        available: windows.find((item) => item === client)!.rank <= priority,
      })
    );
    expect(windows[priority - 1]!.focus).toHaveBeenCalledOnce();
    expect(windows[priority - 1]!.postMessage).toHaveBeenCalledWith({
      type: "OPEN_INVITATION",
      url: invitationDestination(id, origin),
    });
    expect(
      windows
        .filter((item) => item.rank !== priority)
        .every((item) => item.focus.mock.calls.length === 0)
    ).toBe(true);
    expect(openWindow).not.toHaveBeenCalled();
  }
);
it("opens the OS app route when all existing windows are playing or editing", async () => {
  const focus = vi.fn();
  const openWindow = vi.fn();
  await openInvitationNotification(
    {
      matchAll: async () => [
        { url: `${origin}/?room=active`, focus, postMessage: vi.fn() },
      ],
      openWindow,
    },
    origin,
    id,
    async () => ({ priority: 3, available: false })
  );
  expect(focus).not.toHaveBeenCalled();
  expect(openWindow).toHaveBeenCalledWith(invitationDestination(id, origin));
});
