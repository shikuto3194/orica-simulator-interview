import { useState } from "react";
import type { CardDefinition } from "@orica/rules-core";

export function DeckThumbnail({
  allCards,
  cardNos,
  thumbnailCardNo,
  random = false,
}: {
  allCards: CardDefinition[];
  cardNos: string[];
  thumbnailCardNo?: string | null | undefined;
  random?: boolean;
}) {
  const card =
    allCards.find(
      (candidate) => candidate.cardNo === (thumbnailCardNo ?? cardNos[0])
    ) ?? allCards.find((candidate) => candidate.cardNo === cardNos[0]);
  const src = card?.image ? `/${card.image}` : null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return (
    <span className="battle-deck-thumbnail" aria-hidden="true">
      {src && src !== failedSrc ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span>{random ? "？" : "画像なし"}</span>
      )}
    </span>
  );
}
