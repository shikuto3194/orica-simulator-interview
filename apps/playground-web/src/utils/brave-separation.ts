import {
  applyLegalAction,
  moveSoulCore,
  type ApplyLegalActionOptions,
} from "../../../../packages/rules-core/src/runtime";

/** GUI とルーム再生で、選択したソウルを維持コア判定より先に反映する。 */
export function applyBraveSeparationWithCores(
  options: ApplyLegalActionOptions,
  soulSource?: string,
  braveInstanceId?: string
) {
  const { action } = options;
  const targets =
    action.kind === "brave_separate"
      ? [action.braveInstanceId]
      : action.kind === "resolve_brave_leave_choice" && action.choice === "keep"
        ? action.braveInstanceIds
        : [];
  if (targets.length === 0)
    throw new Error("Expected brave separation or keep action");
  const target = braveInstanceId ?? targets[0];
  if (!target || !targets.includes(target))
    throw new Error("Invalid brave separation destination");
  const state = soulSource
    ? moveSoulCore(
        options.state,
        action.actingPlayerId,
        soulSource === "reserve"
          ? { kind: "reserve", playerId: action.actingPlayerId }
          : { kind: "card", instanceId: soulSource },
        { kind: "card", instanceId: target }
      )
    : options.state;
  return applyLegalAction({ ...options, state });
}
