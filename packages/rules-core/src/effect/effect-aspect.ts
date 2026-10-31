import type { Action } from "../dsl-types";

/** Shared operation aspect for registration, target candidates and affect gates. */
export function deriveEffectAspectForImmunity(
  action: Action
): string | undefined {
  switch (action.kind) {
    case "bp_modify":
      return "bp";
    case "symbol_add":
      return "symbols";
    case "override_properties":
      return action.properties.symbols !== undefined ||
        action.properties.symbolCountFixed === true
        ? "symbols"
        : undefined;
    default:
      return undefined;
  }
}
