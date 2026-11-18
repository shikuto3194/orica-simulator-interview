const ownerKey = "orica-push-owner";
export const pushOwner = () => localStorage.getItem(ownerKey);
export const setPushOwner = (userId: string | null) =>
  userId
    ? localStorage.setItem(ownerKey, userId)
    : localStorage.removeItem(ownerKey);

export async function currentPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration?.pushManager.getSubscription() ?? null;
}

/** Stop this browser's delivery before logout/account changes; other devices are unaffected. */
export async function unsubscribeBrowserPush() {
  const subscription = await currentPushSubscription();
  if (subscription && !(await subscription.unsubscribe()))
    throw new Error("端末通知の解除に失敗しました。再試行してください");
  setPushOwner(null);
}
