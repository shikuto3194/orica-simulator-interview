import type { GameState, PreGameState } from "@orica/rules-core";

export type JankenHand = "rock" | "scissors" | "paper";
export type PreGameUiPhase =
  | { kind: "janken" }
  | { kind: "contract_present" }
  | { kind: "waiting_contract" }
  | { kind: "contract_confirm" }
  | { kind: "waiting_contract_confirm" }
  | { kind: "janken_result"; myHand: JankenHand; oppHand: JankenHand }
  | { kind: "waiting_opponent_janken" }
  | { kind: "pick_order" }
  | { kind: "waiting_opponent_pick" }
  | { kind: "announce"; message: string }
  | { kind: "mulligan_self" }
  | { kind: "mulligan_opponent" }
  | { kind: "done" };

/** Shared initial view for live pregame and seeking a recorded pregame. */
export function initialPreGameUiPhase(
  pg: PreGameState | null | undefined,
  playerId: string
): PreGameUiPhase {
  if (!pg) return { kind: "done" };
  const first = pg.firstPlayerId;
  const isFirst = first === playerId;
  switch (pg.phase) {
    case "waiting_contract":
      return pg.contractCandidateCardNos?.[playerId] &&
        pg.contractPresentationChoices?.[playerId] === undefined
        ? { kind: "contract_present" }
        : { kind: "waiting_contract" };
    case "contract_confirm":
      return pg.contractConfirmed?.[playerId]
        ? { kind: "waiting_contract_confirm" }
        : { kind: "contract_confirm" };
    case "waiting_janken":
      return pg.jankenHands[playerId]
        ? { kind: "waiting_opponent_janken" }
        : { kind: "janken" };
    case "janken_resolved":
    case "waiting_order_pick":
      return pg.jankenWinner === playerId
        ? { kind: "pick_order" }
        : { kind: "waiting_opponent_pick" };
    case "order_decided":
    case "waiting_mulligan_first":
      return isFirst
        ? { kind: "mulligan_self" }
        : { kind: "mulligan_opponent" };
    case "waiting_mulligan_second":
      return !isFirst && pg.mulliganDone[first!] !== undefined
        ? { kind: "mulligan_self" }
        : { kind: "mulligan_opponent" };
    case "pregame_complete":
      return { kind: "done" };
    default:
      return { kind: "janken" };
  }
}

export interface RecordedPreGameInput {
  actor: string;
  controlTestId: string;
  uiPhase: PreGameUiPhase;
}

/** Read existing choices only; missing hands are never generated or saved. */
export function recordedPreGameInputs(
  before: GameState,
  after: GameState
): RecordedPreGameInput[] {
  const previous = before.preGame;
  const next = after.preGame;
  if (!previous || !next) return [];
  const inputs: RecordedPreGameInput[] = [];
  for (const { id } of before.players) {
    const hand = next.jankenHands[id];
    if (
      (previous.phase === "waiting_janken" ||
        (previous.phase === "janken_resolved" && !previous.jankenWinner)) &&
      hand &&
      (previous.jankenRound === next.jankenRound ||
        (next.phase === "janken_resolved" &&
          next.jankenRound === previous.jankenRound + 1)) &&
      (previous.phase === "janken_resolved"
        ? next.phase !== "janken_resolved" ||
          next.jankenRound > previous.jankenRound
        : previous.jankenHands[id] !== hand)
    )
      inputs.push({
        actor: id,
        controlTestId: `pregame-janken-${hand}`,
        uiPhase: { kind: "janken" },
      });
  }
  if (!previous.firstPlayerId && next.firstPlayerId && previous.jankenWinner) {
    inputs.push({
      actor: previous.jankenWinner,
      controlTestId: `pregame-order-${next.firstPlayerId === previous.jankenWinner ? "first" : "second"}`,
      uiPhase: { kind: "pick_order" },
    });
  }
  return inputs;
}

export function replayPreGameUiPhase(
  before: GameState,
  after: GameState,
  viewer: string,
  phase: number
): PreGameUiPhase {
  const state = phase === 3 ? after : before;
  const pg = state.preGame;
  if (!pg) return { kind: "done" };
  const opponent = state.players.find((player) => player.id !== viewer)?.id;
  const myHand = pg.jankenHands[viewer];
  const oppHand = opponent ? pg.jankenHands[opponent] : undefined;
  const input = phase < 3 ? recordedPreGameInputs(before, after)[0] : undefined;
  if (input) return input.uiPhase;
  if (
    myHand &&
    oppHand &&
    (pg.phase === "janken_resolved" ||
      (phase === 3 && before.preGame?.phase === "waiting_janken"))
  )
    return { kind: "janken_result", myHand, oppHand };
  return initialPreGameUiPhase(pg, viewer);
}
