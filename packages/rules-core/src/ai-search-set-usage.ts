import type { AiObservation, AiRelativePlayer } from "./ai-observation";
import { AI_SEARCH_WORLD_PLAYERS } from "./ai-search-deck-instances";
import { searchPlayerResolver } from "./ai-search-observation";
import type { GameState } from "./model";

/** Public set-action usage only, not effect usage or a resumable world.
 * Neither a current occupied slot nor its visible/hidden card identity proves
 * whether a normal action or the Mirage count exemption was used this turn.
 */
export interface AiSearchSetUsage {
  owner: AiRelativePlayer;
  burst: boolean;
  mirage: boolean;
  mirageCountExemptionCardNos: string[];
}

function data<T extends object, K extends keyof T>(input: T, key: K): T[K] {
  if (!input || typeof input !== "object")
    throw new Error("missing observed set usage");
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor || !("value" in descriptor))
    throw new Error("missing observed set usage data");
  return descriptor.value as T[K];
}

function copyUsage(input: Omit<AiSearchSetUsage, "owner">) {
  const burst = data(input, "burst");
  const mirage = data(input, "mirage");
  const cardNos = data(input, "mirageCountExemptionCardNos");
  if (
    [burst, mirage].some((v) => typeof v !== "boolean") ||
    !Array.isArray(cardNos)
  )
    throw new Error("invalid observed set usage");
  const copy: string[] = [];
  for (let index = 0; index < cardNos.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(cardNos, String(index));
    if (
      !descriptor ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string" ||
      !descriptor.value ||
      copy.includes(descriptor.value)
    )
      throw new Error("invalid observed set usage");
    copy.push(descriptor.value);
  }
  return { burst, mirage, mirageCountExemptionCardNos: copy.sort() };
}

/** Accept only the current player observation. Never inspect a real GameState,
 * hidden slot, registered deck or private candidate to fill a missing flag. */
export function projectAiSearchSetUsage(
  observation: AiObservation
): readonly AiSearchSetUsage[] {
  const relative = searchPlayerResolver(observation);
  return (["me", "opp"] as const).map((owner) => {
    const player = observation.players.find(
      (entry) => relative(entry.playerId) === owner
    )!;
    return { owner, ...copyUsage(data(player, "setUsageThisTurn")!) };
  });
}

/** Return fresh overrides for a newly constructed synthetic world. Other usage
 * records, slot state, continuations and full-world reprojection remain separate.
 * Synthetic player order here is fixed and never derived from real player IDs. */
export function materializeAiSearchSetUsage(
  usage: readonly AiSearchSetUsage[]
): Pick<
  GameState,
  | "burstSetPlayerIdsThisTurn"
  | "mirageSetPlayerIdsThisTurn"
  | "mirageSetCountExemptionsUsed"
> {
  if (!Array.isArray(usage) || usage.length !== 2)
    throw new Error("invalid observed set usage component");
  const result: ReturnType<typeof materializeAiSearchSetUsage> = {
    burstSetPlayerIdsThisTurn: [],
    mirageSetPlayerIdsThisTurn: [],
    mirageSetCountExemptionsUsed: [],
  };
  for (const owner of ["me", "opp"] as const) {
    const matching = usage.filter((entry) => data(entry, "owner") === owner);
    if (matching.length !== 1)
      throw new Error("invalid observed set usage owner");
    const flags = copyUsage(matching[0]!);
    const playerId = AI_SEARCH_WORLD_PLAYERS[owner];
    if (flags.burst) result.burstSetPlayerIdsThisTurn.push(playerId);
    if (flags.mirage) result.mirageSetPlayerIdsThisTurn.push(playerId);
    for (const cardNo of flags.mirageCountExemptionCardNos)
      result.mirageSetCountExemptionsUsed.push({ playerId, cardNo });
  }
  return result;
}
