/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precache,
  addRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { createPartialResponse } from "workbox-range-requests";
import { readLocalAsset } from "./assets/local-asset-store";
import { BGM_MANIFEST_URL } from "./assets/asset-contract";
import { IMAGE_VERIFIED_HEADER } from "./assets/image-cache-contract";
import {
  invitationDestination,
  openInvitationNotification,
} from "./invitationLaunch";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};
self.addEventListener("push", (event) => {
  let invitationId: unknown;
  try {
    invitationId = event.data?.json()?.invitationId;
  } catch {
    /* Still show a generic notification. */
  }
  event.waitUntil(
    self.registration.showNotification("幻想符 — 対戦へのお誘い", {
      body: "対戦ルームへの招待が届きました。開いて内容を確認してください。",
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
      tag: `room-invitation-${typeof invitationId === "string" ? invitationId : "new"}`,
      data: { url: invitationDestination(invitationId, self.location.origin) },
    })
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let candidate: URL;
  try {
    candidate = new URL(
      event.notification.data?.url ?? "/?messages=1",
      self.location.origin
    );
  } catch {
    candidate = new URL("/?messages=1", self.location.origin);
  }
  event.waitUntil(
    openInvitationNotification(
      self.clients,
      self.location.origin,
      candidate.searchParams.get("invitation")
    )
  );
});
precache(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();
// Activate the new cache without navigating existing games. A user navigation
// fetches the current HTML, even while another tab still uses an older bundle.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});
const offlineShell = createHandlerBoundToURL("index.html");
registerRoute(
  new NavigationRoute(
    async (options) => {
      try {
        const response = await fetch(
          new Request(options.request, { cache: "no-store" })
        );
        if (
          response.ok &&
          response.headers.get("content-type")?.includes("text/html")
        )
          return response;
      } catch {
        // The precached shell remains available offline.
      }
      return offlineShell(options);
    },
    {
      denylist: [/^\/api\//, /^\/images\//, /^\/sounds\//],
      ...(import.meta.env.DEV ? { allowlist: [/^\/$/] } : {}),
    }
  )
);
// Navigation must precede the precache route, which also matches / and index.html.
addRoute();
registerRoute(
  ({ url, sameOrigin }) =>
    sameOrigin &&
    !url.search &&
    (url.pathname.startsWith("/images/") ||
      url.pathname.startsWith("/sounds/") ||
      url.pathname === BGM_MANIFEST_URL),
  async ({ request }) => {
    const saved = await readLocalAsset(request.url);
    if (saved?.headers.get(IMAGE_VERIFIED_HEADER) === "1") {
      return request.headers.has("range")
        ? createPartialResponse(request, saved)
        : saved;
    }
    return fetch(request);
  }
);
