/** Resource limits for stored/imported data, independent of game deck rules. */
export const INPUT_LIMITS = {
  displayName: 30,
  deckName: 100,
  deckCards: 1000,
  importBytes: 1_048_576,
} as const;

export interface StoredDeckInput {
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  name: string;
  cardNos: string[];
  tokenDeck?: Array<{ cardNo: string; count: number }>;
  thumbnailCardNo?: string;
}
export interface IdCountEntry {
  id: number;
  count: number;
  isDeckThumbnail?: boolean;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("デッキ形式が不正です");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, label: string): string {
  if (typeof value !== "string")
    throw new Error(`${label}は文字列で指定してください`);
  // Bound allocation before counting Unicode code points (PostgreSQL char_length).
  if (value.length > max * 2 || Array.from(value).length > max)
    throw new Error(`${label}は${max}文字以内で入力してください`);
  return value;
}
export function limitInputText(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("");
}
export function validateDisplayName(value: unknown): string {
  return text(value, INPUT_LIMITS.displayName, "表示名");
}
export function validateDeckName(value: unknown): string {
  const name = text(value, INPUT_LIMITS.deckName, "デッキ名").trim();
  if (!name) throw new Error("デッキ名を入力してください");
  return name;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("デッキ形式が不正です");
  if (value.length > INPUT_LIMITS.deckCards)
    throw new Error(
      `デッキは${INPUT_LIMITS.deckCards}枚以内で指定してください`
    );
  return value;
}
function positiveInteger(value: unknown, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > max
  )
    throw new Error(`ID・枚数は1〜${max}の整数で指定してください`);
  return value;
}
function cardNo(value: unknown): string {
  const no = text(value, 100, "カード番号");
  if (!no.trim()) throw new Error("カード番号が空です");
  return no;
}
function counts<T>(
  value: unknown,
  parse: (entry: Record<string, unknown>) => T
): Array<T & { count: number }> {
  let total = 0;
  return array(value).map((raw) => {
    const entry = object(raw);
    const count = positiveInteger(entry.count, INPUT_LIMITS.deckCards);
    total += count;
    if (total > INPUT_LIMITS.deckCards)
      throw new Error(
        `デッキは合計${INPUT_LIMITS.deckCards}枚以内で指定してください`
      );
    return { ...parse(entry), count };
  });
}
export function parseIdCounts(value: unknown): IdCountEntry[] {
  return counts(value, (entry) => ({
    id: positiveInteger(entry.id, Number.MAX_SAFE_INTEGER),
    ...(entry.isDeckThumbnail === true ? { isDeckThumbnail: true } : {}),
  }));
}
export function parseCardNoCounts(value: unknown) {
  return counts(value, (entry) => ({ cardNo: cardNo(entry.cardNo) }));
}
export function parseCardNos(value: unknown): string[] {
  return array(value).map(cardNo);
}
export function expandCardCounts(value: unknown): string[] {
  // Validate the entire list before expanding even the first item.
  return parseCardNoCounts(value).flatMap((entry) =>
    Array<string>(entry.count).fill(entry.cardNo)
  );
}
export function parseStoredDeck(value: unknown): StoredDeckInput {
  const deck = object(value);
  return {
    name: validateDeckName(deck.name),
    cardNos: parseCardNos(deck.cardNos),
    ...(typeof deck.createdAt === "string" &&
    Number.isFinite(Date.parse(deck.createdAt))
      ? { createdAt: deck.createdAt }
      : {}),
    ...(typeof deck.updatedAt === "string" &&
    Number.isFinite(Date.parse(deck.updatedAt))
      ? { updatedAt: deck.updatedAt }
      : {}),
    ...(deck.tokenDeck !== undefined
      ? { tokenDeck: parseCardNoCounts(deck.tokenDeck) }
      : {}),
    ...(deck.thumbnailCardNo != null
      ? { thumbnailCardNo: cardNo(deck.thumbnailCardNo) }
      : {}),
  };
}
export function parseImportedDeck(
  value: unknown,
  idToCardNo: ReadonlyMap<number, string>
): StoredDeckInput {
  const deck = object(value);
  if (deck.cardNos !== undefined) return parseStoredDeck(deck);
  const cards = parseIdCounts(deck.cards);
  // Older orika exports use a tokenDeck object keyed by numeric card IDs.
  let tokens: unknown = deck.tokenDeck ?? deck.token_deck ?? [];
  if (!Array.isArray(tokens)) {
    tokens = Object.entries(object(tokens)).map(([id, count]) => ({
      id: Number(id),
      count,
    }));
  }
  const tokenEntries = parseIdCounts(tokens);
  const translate = (entries: IdCountEntry[]) =>
    entries.flatMap((entry) => {
      const no = idToCardNo.get(entry.id);
      return no ? [{ cardNo: no, count: entry.count }] : [];
    });
  const thumbnailId =
    deck.thumbnail_card_id ?? cards.find((entry) => entry.isDeckThumbnail)?.id;
  const thumbnail =
    typeof thumbnailId === "number" ? idToCardNo.get(thumbnailId) : undefined;
  return {
    name: validateDeckName(deck.name),
    cardNos: expandCardCounts(translate(cards)),
    tokenDeck: translate(tokenEntries),
    ...(thumbnail ? { thumbnailCardNo: thumbnail } : {}),
  };
}
export async function readDeckFile(
  file: Pick<File, "size" | "text">,
  idToCardNo: ReadonlyMap<number, string>
) {
  if (file.size > INPUT_LIMITS.importBytes)
    throw new Error("デッキファイルは1MiB以内にしてください");
  return parseImportedDeck(
    JSON.parse(await file.text()) as unknown,
    idToCardNo
  );
}
