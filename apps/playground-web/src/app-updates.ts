const safeScreens = new Set<symbol>();
let pending = false;
let reloading = false;

function applyUpdate() {
  if (
    !pending ||
    reloading ||
    !safeScreens.size ||
    document.visibilityState === "hidden" ||
    !navigator.onLine
  )
    return;
  reloading = true;
  window.location.reload();
}
export function requestAppReload() {
  pending = true;
  applyUpdate();
}
export function allowAppReload() {
  const screen = Symbol();
  safeScreens.add(screen);
  applyUpdate();
  return () => {
    safeScreens.delete(screen);
  };
}

/** Resume/online events cover installed PWAs that keep their document alive. */
export function monitorAppUpdates() {
  let registration: ServiceWorkerRegistration | undefined;
  let checking = false;
  let previous = navigator.serviceWorker?.controller;
  const changed = () => {
    const controller = navigator.serviceWorker.controller;
    if (previous && controller && previous !== controller) requestAppReload();
    previous = controller;
  };
  const check = () => {
    applyUpdate();
    if (
      !registration ||
      checking ||
      document.visibilityState === "hidden" ||
      !navigator.onLine
    )
      return;
    checking = true;
    void registration
      .update()
      .catch(() => {
        // Offline/transient failures are retried on resume or the next interval.
      })
      .finally(() => {
        checking = false;
      });
  };
  navigator.serviceWorker?.addEventListener("controllerchange", changed);
  window.addEventListener("pageshow", check);
  window.addEventListener("online", check);
  document.addEventListener("visibilitychange", check);
  const interval = setInterval(check, 60_000);
  return {
    registered(value: ServiceWorkerRegistration | undefined) {
      registration = value;
      check();
    },
    stop() {
      clearInterval(interval);
      navigator.serviceWorker?.removeEventListener("controllerchange", changed);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    },
  };
}
