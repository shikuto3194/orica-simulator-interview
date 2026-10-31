import { useId, type ReactNode } from "react";
import {
  DECK_FILTER_LABELS,
  type DeckFilterKey,
  type DeckFilters,
  type DeckFilterOptions,
} from "../utils/saved-deck-filters";

export default function SavedDeckFilters({
  filters,
  options,
  onChange,
  children,
}: {
  filters: DeckFilters;
  options: DeckFilterOptions;
  onChange: (filters: DeckFilters) => void;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="saved-deck-filters">
      {(Object.entries(DECK_FILTER_LABELS) as [DeckFilterKey, string][]).map(
        ([field, label]) => {
          const searchable = field === "tribe" || field === "contract";
          const choices = options[field];
          return (
            <label key={field} className="saved-deck-filter-field">
              <span>{label}</span>
              {searchable ? (
                <>
                  <input
                    type="search"
                    list={`${id}-${field}`}
                    aria-label={`デッキの${label}`}
                    placeholder="指定なし・入力で検索"
                    value={filters[field]}
                    onChange={(event) =>
                      onChange({ ...filters, [field]: event.target.value })
                    }
                  />
                  <datalist id={`${id}-${field}`}>
                    {choices.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.count}デッキ
                      </option>
                    ))}
                  </datalist>
                </>
              ) : (
                <select
                  aria-label={`デッキの${label}`}
                  value={filters[field]}
                  onChange={(event) =>
                    onChange({ ...filters, [field]: event.target.value })
                  }
                >
                  <option value="">指定なし</option>
                  {filters[field] &&
                    !choices.some(
                      (option) => option.value === filters[field]
                    ) && (
                      <option value={filters[field]}>
                        {filters[field]}（0デッキ）
                      </option>
                    )}
                  {choices.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.value}（{option.count}デッキ）
                    </option>
                  ))}
                </select>
              )}
            </label>
          );
        }
      )}
      {children}
    </div>
  );
}
