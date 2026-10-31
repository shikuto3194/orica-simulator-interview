import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});
async function harness(controlled = true) {
  vi.useFakeTimers();
  const reload = vi.fn();
  const window = Object.assign(new EventTarget(), { location: { reload } });
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  const serviceWorker = Object.assign(new EventTarget(), {
    controller: controlled ? {} : null,
  });
  const navigator = { serviceWorker, onLine: true };
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", navigator);
  const updater = await import("../src/app-updates");
  const update = vi.fn().mockResolvedValue(undefined);
  const monitor = updater.monitorAppUpdates();
  monitor.registered({ update } as unknown as ServiceWorkerRegistration);
  await vi.advanceTimersByTimeAsync(0);
  return {
    ...updater,
    monitor,
    window,
    document,
    navigator,
    serviceWorker,
    reload,
    update,
  };
}

it("checks on resume and online, but not while hidden/offline or after cleanup", async () => {
  const h = await harness();
  expect(h.update).toHaveBeenCalledTimes(1);
  h.document.visibilityState = "hidden";
  await vi.advanceTimersByTimeAsync(60000);
  expect(h.update).toHaveBeenCalledTimes(1);
  h.document.visibilityState = "visible";
  h.document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(h.update).toHaveBeenCalledTimes(2);
  h.navigator.onLine = false;
  h.window.dispatchEvent(new Event("pageshow"));
  expect(h.update).toHaveBeenCalledTimes(2);
  h.navigator.onLine = true;
  h.window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(h.update).toHaveBeenCalledTimes(3);
  h.monitor.stop();
  await vi.advanceTimersByTimeAsync(60000);
  h.window.dispatchEvent(new Event("pageshow"));
  expect(h.update).toHaveBeenCalledTimes(3);
});

it("defers a new worker during a battle/editor and reloads once at a safe screen", async () => {
  const h = await harness();
  const leaveHome = h.allowAppReload();
  leaveHome();
  h.serviceWorker.controller = {};
  h.serviceWorker.dispatchEvent(new Event("controllerchange"));
  expect(h.reload).not.toHaveBeenCalled();
  const leaveTitle = h.allowAppReload();
  expect(h.reload).toHaveBeenCalledTimes(1);
  h.requestAppReload();
  expect(h.reload).toHaveBeenCalledTimes(1);
  leaveTitle();
  h.monitor.stop();
});

it("does not reload on first installation, and postpones reload while hidden", async () => {
  const h = await harness(false);
  const leave = h.allowAppReload();
  h.serviceWorker.controller = {};
  h.serviceWorker.dispatchEvent(new Event("controllerchange"));
  expect(h.reload).not.toHaveBeenCalled();
  h.document.visibilityState = "hidden";
  h.serviceWorker.controller = {};
  h.serviceWorker.dispatchEvent(new Event("controllerchange"));
  expect(h.reload).not.toHaveBeenCalled();
  h.document.visibilityState = "visible";
  h.document.dispatchEvent(new Event("visibilitychange"));
  expect(h.reload).toHaveBeenCalledTimes(1);
  leave();
  h.monitor.stop();
});
