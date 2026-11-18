import {
  MIN_DECK_SIZE,
  validateMainDeckDefinitions,
  type CardDefinition,
} from "@orica/rules-core";

export function deckSelectionIssue(
  cardNos: string[],
  cards: ReadonlyMap<string, CardDefinition>
): string | null {
  if (cardNos.length < MIN_DECK_SIZE) return `${MIN_DECK_SIZE}枚以上必要です`;
  const definitions = cardNos.map((no) => cards.get(no));
  if (definitions.some((card) => !card)) return "未対応のカードがあります";
  const issue = validateMainDeckDefinitions(definitions as CardDefinition[])[0];
  if (!issue) return null;
  if (issue.kind === "too_many_contract_types")
    return "契約カードは1種類までです";
  const name = cards.get(issue.cardNo ?? "")?.name ?? issue.cardNo;
  return issue.kind === "too_many_copies"
    ? `${name}は${issue.maxDeckCount}枚までです`
    : `${name}はメインデッキに入れられません`;
}
