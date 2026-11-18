import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

// One durable receipt per worker run; both its own report and child reports share it.
export function writeDelivery(path, value) {
  const tmp = path + "." + process.pid + ".tmp";
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}
export function readDelivery(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
export function completionDisposition(
  payload,
  isAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
) {
  const file = payload.workerDeliveryFile;
  const receipt = readDelivery(file);
  if (!receipt) return { action: "send" };
  if (receipt.finalDelivered) return { action: "archive", receipt, file };
  if (receipt.status === "running" && isAlive(receipt.pid))
    return { action: "wait", receipt, file };
  return {
    action: "send",
    receipt,
    file,
    messageId: receipt.messageId || null,
  };
}
export function formatCompletionText(reply, heading = "✅ 完了") {
  const text = heading + "\n\n" + reply;
  return text.length > 3900 ? text.slice(0, 3880) + "\n…(truncated)" : text;
}
export function deliveryPath(stateFile, runId) {
  return join(dirname(stateFile), "worker-notifications", runId + ".json");
}
