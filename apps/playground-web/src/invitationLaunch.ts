/** Shared by the page and worker; only same-origin invitation destinations are accepted. */
export function invitationDestination(id: unknown, origin: string) {
  return new URL(
    typeof id === "string" &&
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
      ? `/?invitation=${encodeURIComponent(id)}`
      : "/?messages=1",
    origin
  ).href;
}

type InvitationClient = Pick<WindowClient, "url" | "postMessage" | "focus">;
type Target = { priority: number; available: boolean };
function inspectTarget(client: InvitationClient): Promise<Target> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (target: Target) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(target);
    };
    const timer = setTimeout(
      () => finish({ priority: 0, available: false }),
      500
    );
    channel.port1.onmessage = (event) => {
      const data = event.data as Partial<Target> | null;
      finish({
        priority: Number(data?.priority) || 0,
        available: data?.available === true,
      });
    };
    client.postMessage({ type: "INVITATION_TARGET" }, [channel.port2]);
  });
}

/** Prefer an installed app; never replace an ongoing game or deck editing session. */
export async function openInvitationNotification(
  clients: {
    matchAll: (
      options: ClientQueryOptions & { type: "window" }
    ) => Promise<readonly InvitationClient[]>;
    openWindow: (url: string) => Promise<unknown>;
  },
  origin: string,
  id: unknown,
  inspect: (client: InvitationClient) => Promise<Target> = inspectTarget
) {
  const destination = invitationDestination(id, origin);
  const windows = await clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const candidates = await Promise.all(
    windows
      .filter((client) => new URL(client.url).origin === origin)
      .map(async (client) => ({ client, ...(await inspect(client)) }))
  );
  candidates.sort(
    (a, b) =>
      b.priority - a.priority ||
      Number(b.client.url === destination) -
        Number(a.client.url === destination)
  );
  for (const candidate of candidates) {
    if (!candidate.available) continue;
    try {
      await candidate.client.focus();
      candidate.client.postMessage({
        type: "OPEN_INVITATION",
        url: destination,
      });
      return;
    } catch {
      /* The window may have closed while the notification was clicked. */
    }
  }
  // The OS/browser routes this to the installed app when supported, even if it is closed.
  await clients.openWindow(destination);
}
