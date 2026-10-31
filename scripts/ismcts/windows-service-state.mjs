// Service state is data owned by this module. Never execute a caller callback:
// even Promise.prototype.then can throw at @@species before handling rejection.
import { sharedServiceBusy } from "./service-priority.mjs";

const states = new WeakMap();

function readerFor(record) {
  const reader = Object.freeze(() => readWindowsServiceBusy(reader));
  states.set(reader, record);
  return reader;
}

export function createWindowsServiceReader(busy = false) {
  if (typeof busy !== "boolean") throw new Error("invalid service boolean");
  return readerFor({ busy });
}

export function setWindowsServiceBusy(reader, busy) {
  const state = states.get(reader);
  if (!state || state.directory !== undefined || typeof busy !== "boolean")
    throw new Error("invalid local service state update");
  state.busy = busy;
}

export function readWindowsServiceBusy(reader) {
  if (typeof reader === "boolean") return reader;
  const state = states.get(reader);
  if (!state)
    throw new Error(
      "service state requires a boolean or owned synchronous reader"
    );
  if (state.directory !== undefined)
    return (
      sharedServiceBusy(state.directory) || readWindowsServiceBusy(state.local)
    );
  return state.busy;
}

export function bindWindowsServiceReader(directory, local) {
  if (typeof directory !== "string" || !directory)
    throw new Error("invalid shared service directory");
  // Validate identity before reading the ledger, reserving, or generating work.
  if (typeof local !== "boolean" && !states.has(local))
    throw new Error(
      "service state requires a boolean or owned synchronous reader"
    );
  return readerFor({ directory, local });
}
