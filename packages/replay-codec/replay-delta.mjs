// Shared browser/CLI codec. Lossless JSON deltas preserve object keys and array edits.
export const REPLAY_DELTA_CODEC = "orica-replay-delta-v1";
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function delta(before, after) {
  if (before === after) return null;
  if (Array.isArray(before) && Array.isArray(after)) {
    const changes = [];
    for (let i = 0; i < after.length; i++) {
      const patch =
        i < before.length ? delta(before[i], after[i]) : ["v", after[i]];
      if (patch !== null) changes.push([i, patch]);
    }
    return changes.length || before.length !== after.length
      ? ["a", after.length, changes]
      : null;
  }
  if (object(before) && object(after)) {
    const keys = Object.keys(after),
      priorKeys = Object.keys(before),
      changes = [];
    for (const key of keys) {
      const patch = own(before, key)
        ? delta(before[key], after[key])
        : ["v", after[key]];
      if (patch !== null) changes.push([key, patch]);
    }
    return changes.length ||
      keys.length !== priorKeys.length ||
      keys.some((key, i) => key !== priorKeys[i])
      ? ["o", keys, changes]
      : null;
  }
  return ["v", after];
}

function apply(before, patch) {
  if (patch === null) {
    if (before === undefined) throw new Error("replay delta has no base value");
    return before;
  }
  if (!Array.isArray(patch)) throw new Error("invalid replay delta");
  if (patch[0] === "v" && patch.length === 2) return patch[1];
  if (patch.length !== 3 || !Array.isArray(patch[2]))
    throw new Error("invalid replay delta");
  if (patch[0] === "a") {
    if (!Array.isArray(before) || !Number.isInteger(patch[1]) || patch[1] < 0)
      throw new Error("invalid replay array delta");
    const result = before.slice(0, patch[1]),
      changed = new Set();
    result.length = patch[1];
    for (const entry of patch[2]) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        !Number.isInteger(entry[0]) ||
        entry[0] < 0 ||
        entry[0] >= result.length ||
        changed.has(entry[0])
      )
        throw new Error("invalid replay array entry");
      changed.add(entry[0]);
      result[entry[0]] = apply(before[entry[0]], entry[1]);
    }
    for (let i = before.length; i < result.length; i++)
      if (!changed.has(i)) throw new Error("missing replay array entry");
    return result;
  }
  if (patch[0] === "o") {
    if (
      !object(before) ||
      !Array.isArray(patch[1]) ||
      patch[1].some((key) => typeof key !== "string") ||
      new Set(patch[1]).size !== patch[1].length
    )
      throw new Error("invalid replay object delta");
    const keys = new Set(patch[1]),
      changes = new Map();
    for (const entry of patch[2]) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        !keys.has(entry[0]) ||
        changes.has(entry[0])
      )
        throw new Error("invalid replay object entry");
      changes.set(entry[0], entry[1]);
    }
    const result = {};
    for (const key of patch[1]) {
      const value = changes.has(key)
        ? apply(own(before, key) ? before[key] : undefined, changes.get(key))
        : own(before, key)
          ? before[key]
          : undefined;
      if (value === undefined) throw new Error("missing replay object entry");
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  }
  throw new Error("unknown replay delta operation");
}

export class ReplayDeltaEncoder {
  #previous;
  #index = 0;
  append(frame) {
    const normalized = JSON.parse(JSON.stringify(frame));
    const anchor = this.#index % 128 === 0;
    const record = {
      index: this.#index,
      base: anchor ? null : this.#index - 1,
      patch: anchor ? ["v", normalized] : delta(this.#previous, normalized),
    };
    this.#previous = normalized;
    this.#index++;
    return record;
  }
}

export class ReplayDeltaDecoder {
  #previous;
  #index = 0;
  append(record) {
    if (
      !object(record) ||
      record.index !== this.#index ||
      (record.base !== null &&
        (this.#index === 0 || record.base !== this.#index - 1)) ||
      (record.base === null &&
        (!Array.isArray(record.patch) || record.patch[0] !== "v"))
    )
      throw new Error("invalid replay delta sequence");
    const frame = apply(
      record.base === null ? undefined : this.#previous,
      record.patch
    );
    if (!object(frame)) throw new Error("replay frame must be an object");
    this.#previous = frame;
    this.#index++;
    return frame;
  }
}
