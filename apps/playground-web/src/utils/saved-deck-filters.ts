import type { CardDefinition } from "@orica/rules-core";
import { COLOR_JA } from "./symbol-format";
export type DeckFilterKey = "color" | "tribe" | "pack" | "contract";
export type DeckFilters = Record<DeckFilterKey, string>;
export type DeckFilterOptions = Record<
  DeckFilterKey,
  { value: string; count: number }[]
>;
type Face = {
  colors?: string[];
  tribe?: string | undefined;
  pack?: string | undefined;
  contract?: string | undefined;
};
type ProfileCard = {
  count: number;
  values: Record<DeckFilterKey, Set<string>>;
};
export type DeckProfile = { cards: ProfileCard[]; total: number };
import { PACK_OPTIONS } from "./deck-packs";

export const EMPTY_DECK_FILTERS: DeckFilters = {
  color: "",
  tribe: "",
  pack: "",
  contract: "",
};
export const NO_CONTRACT = "契約なし";
export const DECK_FILTER_LABELS = {
  color: "色",
  tribe: "系統",
  pack: "収録パック",
  contract: "契約カード",
};
const fields = Object.keys(EMPTY_DECK_FILTERS) as DeckFilterKey[];
const colorOrder = ["赤", "紫", "緑", "白", "黄", "青", "黒", "無色", "多色"];
const collator = new Intl.Collator("ja", { numeric: true });
const normalize = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase("ja");

// Both apps supply main-deck copies and printed faces; tokens never enter this index.
export function createDeckProfile(
  entries: { count: number; faces: Face[] }[]
): DeckProfile {
  const cards: ProfileCard[] = [];
  let total = 0;
  for (const entry of entries) {
    const count = Number(entry.count);
    if (!Number.isFinite(count) || count <= 0) continue;
    const values: ProfileCard["values"] = {
      color: new Set(),
      tribe: new Set(),
      pack: new Set(),
      contract: new Set(),
    };
    for (const face of entry.faces) {
      for (const color of face.colors || []) if (color) values.color.add(color);
      for (const tribe of (face.tribe || "").split(/[・/／]/))
        if (tribe.trim()) values.tribe.add(tribe.trim());
      if (face.pack?.trim()) values.pack.add(face.pack.trim());
      if (face.contract?.trim()) values.contract.add(face.contract.trim());
    }
    if (values.color.size > 1) values.color.add("多色");
    cards.push({ count, values });
    total += count;
  }
  return { cards, total };
}

export function getDeckFilterOptions(
  profiles: DeckProfile[]
): DeckFilterOptions {
  const counts = Object.fromEntries(
    fields.map((field) => [field, new Map<string, number>()])
  ) as Record<DeckFilterKey, Map<string, number>>;
  for (const profile of profiles) {
    for (const field of fields) {
      const values = new Set(
        profile.cards.flatMap((card) => [...card.values[field]])
      );
      if (field === "contract" && !values.size) values.add(NO_CONTRACT);
      for (const value of values)
        counts[field].set(value, (counts[field].get(value) || 0) + 1);
    }
  }
  return Object.fromEntries(
    fields.map((field) => [
      field,
      [...counts[field]]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => {
          const order =
            field === "color"
              ? colorOrder
              : field === "pack"
                ? PACK_OPTIONS
                : [];
          const rank = (value: string) =>
            order.indexOf(value) < 0 ? Infinity : order.indexOf(value);
          return (
            rank(a.value) - rank(b.value) ||
            0 ||
            collator.compare(a.value, b.value)
          );
        }),
    ])
  ) as DeckFilterOptions;
}

export function matchDeckProfile(profile: DeckProfile, filters: DeckFilters) {
  const active = fields.filter((field) => normalize(filters[field]));
  if (!active.length) return { matches: true, score: null };
  const shares = active.map((field) => {
    const query = normalize(filters[field]);
    if (field === "contract" && query === normalize(NO_CONTRACT)) {
      return profile.cards.some((card) => card.values.contract.size) ? 0 : 1;
    }
    const count = profile.cards.reduce((sum, card) => {
      const matches = [...card.values[field]].some((value) =>
        field === "tribe" || field === "contract"
          ? normalize(value).includes(query)
          : normalize(value) === query
      );
      return sum + (matches ? card.count : 0);
    }, 0);
    return profile.total ? count / profile.total : 0;
  });
  return {
    matches: shares.every((share) => share > 0),
    score: shares.reduce((sum, share) => sum + share, 0) / shares.length,
  };
}

export function profileFromCardNos(
  cardNos: string[],
  cards: ReadonlyMap<string, CardDefinition>
) {
  return createDeckProfile(
    cardNos.map((cardNo) => {
      const card = cards.get(cardNo);
      return {
        count: 1,
        faces: card
          ? [card, ...(card.backFace ? [card.backFace] : [])].map((face) => ({
              colors: face.colors.map((color) => COLOR_JA[color] ?? color),
              tribe: face.tribe,
              pack: face.pack || card.pack,
              contract: face.keywordTags.includes("contract") ? face.name : "",
            }))
          : [],
      };
    })
  );
}
