/**
 * 05a: a standalone brave is a spirit for field events, but its summon and
 * effect attribution has a separate rule (official Eternal page09 / Q378).
 * This classifies the event's subject, never the effect that caused it.
 */
export function usesFieldCardCategory(event: string): boolean {
  switch (event) {
    case "attack":
    case "attack_declared":
    case "attack_after":
    case "own_attack":
    case "block":
    case "pre_declaration_attack":
    case "pre_declaration_block":
    case "exhaust":
    case "recover":
    case "destroy":
    case "vanish":
    case "bounce":
    case "remove_from_game":
    case "leave_field":
    case "targeted":
    case "rebirth":
    case "battle_end":
    case "battle_destroy_opponent_only":
    case "soul_state_to_spirit_state":
    case "text_role_under_card_placed":
      return true;
    default:
      return false;
  }
}
