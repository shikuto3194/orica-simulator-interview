export type PushChannel = "pwa" | "app" | "browser";
export const pushChannelPriority: Record<PushChannel, number> = {
  pwa: 3,
  app: 2,
  browser: 1,
};
export function isPushChannel(value: unknown): value is PushChannel {
  return value === "pwa" || value === "app" || value === "browser";
}
export function currentPushChannel(): PushChannel {
  if (
    ["standalone", "fullscreen", "window-controls-overlay"].some(
      (mode) => window.matchMedia(`(display-mode: ${mode})`).matches
    )
  )
    return "pwa";
  if (
    (navigator as Navigator & { standalone?: boolean }).standalone ||
    window.matchMedia("(display-mode: minimal-ui)").matches
  )
    return "app";
  return "browser";
}
