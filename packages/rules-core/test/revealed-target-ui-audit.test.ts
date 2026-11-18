import { expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const {
  loadCards,
  scanCards,
} = require("../../../scripts/audit-revealed-target-ui.cjs");

it("全カード・裏面・導技・選択分岐の公開経路を監査済み一覧と照合する", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const actual = scanCards(loadCards(root));
  delete actual.moduleHashes;
  const audited = JSON.parse(
    readFileSync(
      resolve(
        root,
        "packages/rules-core/test/fixtures/revealed-target-ui-audit.json"
      ),
      "utf8"
    )
  );
  expect(actual).toEqual(audited);
  expect(actual.explicitRevealedTargetSelectors).toHaveLength(5);
  expect(
    actual.cards.filter(
      (card: { classification: string }) =>
        card.classification === "non-related"
    )
  ).toHaveLength(460);
});

it("raw全648面の公開・閲覧本文と対応実装を監査時の原本へ照合する", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const audit = JSON.parse(
    readFileSync(
      resolve(
        root,
        "packages/rules-core/test/fixtures/revealed-target-ui-raw-audit.json"
      ),
      "utf8"
    )
  );
  for (const [file, hash] of Object.entries(audit.sourceHashes)) {
    expect(
      createHash("sha256")
        .update(readFileSync(resolve(root, file)))
        .digest("hex"),
      file
    ).toBe(hash);
  }
  expect(audit.rows).toHaveLength(648);
  expect(audit.summary.unmatchedDefinitions).toBe(0);
  expect(audit.summary.unmappedRawMatchedLines).toBe(0);
  expect(audit.summary.matchedRawLinesWithoutEffectRefs).toBe(0);
  expect(audit.summary.matchedStubRefs).toBe(0);
  expect(audit.summary.rawMatchedLines).toBe(152);
  expect(audit.outsideStructuredAudit).toHaveLength(12);
  expect(audit.borrowActions).toHaveLength(14);
});
