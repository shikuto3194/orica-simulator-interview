import { createServer } from "vite";
import { resolve } from "node:path";

// 検索範囲をカードの裏面・神技・選択肢・付与効果まで固定する監査用inventory。
const server = await createServer({
  configFile: "apps/playground-web/vite.config.ts",
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { ALL_CARDS } = await server.ssrLoadModule(
    resolve("packages/card-data/src/generated-index.ts")
  );
  const cards = new Map();
  const add = (card) => {
    cards.set(card.cardNo, card);
    if (card.backFace) add(card.backFace);
  };
  ALL_CARDS.forEach(add);
  const references = [];
  const suppressions = [];
  const visit = (value, path, card, actionKind) => {
    if (!value || typeof value !== "object") return;
    if (value.kind === "suppress_effect")
      suppressions.push({ cardNo: card.cardNo, path, action: value });
    if (value.targetsGrandwalker || value.targetsGrandstone)
      references.push({ cardNo: card.cardNo, path, actionKind, filter: value });
    for (const [key, child] of Object.entries(value)) {
      if (key === "backFace") continue;
      visit(
        child,
        `${path}.${key}`,
        card,
        key === "action" ? child?.kind : actionKind
      );
    }
  };
  for (const card of cards.values())
    visit(card, "", card, "reference/definition");
  const specialCards = [...cards.values()]
    .filter((c) => c.grandwalkerData || c.grandstoneData)
    .map((c) => ({
      cardNo: c.cardNo,
      kind: c.grandwalkerData?.kind ?? "grandstone",
      divineSkillCount: c.grandwalkerData?.divineSkills?.length ?? 0,
      domainHooks: c.grandwalkerData?.domainHooks ?? [],
    }));
  console.log(
    JSON.stringify(
      {
        definitionCount: cards.size,
        specialCards,
        referenceCardCount: new Set(references.map((r) => r.cardNo)).size,
        referenceCount: references.length,
        references,
        suppressions,
      },
      null,
      2
    )
  );
} finally {
  await server.close();
}
