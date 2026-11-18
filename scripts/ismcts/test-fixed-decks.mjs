import assert from "node:assert/strict";
import {
  fixedInputHash,
  fixedDeckManifestHash,
  readFixedDeckManifest,
  withFixedDeckCatalog,
  resolveFixedDecks,
  fixedEvaluationGames,
} from "./fixed-decks.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));

export async function testFixedDecks() {
  let completed = 0;
  const check = (name, fn) => {
    fn();
    completed++;
    console.log(`fixed-decks ok ${completed} - ${name}`);
  };
  await withFixedDeckCatalog((catalog) => {
    const manifest = readFixedDeckManifest();
    const pool = resolveFixedDecks(manifest, catalog);
    check("eight saved tier1/2 decks pass the normal current validator", () => {
      assert.equal(pool.decks.length, 8);
      assert.equal(pool.manifestHash, fixedDeckManifestHash);
      for (const tier of ["tier1", "tier2"])
        assert.equal(pool.decks.filter((deck) => deck.tier === tier).length, 4);
      for (const deck of pool.decks) {
        assert.ok(deck.cards.length >= catalog.minDeckSize);
        assert.deepEqual(catalog.validateMainDeckDefinitions(deck.cards), []);
        assert.equal(fixedInputHash(deck.cardNos), deck.cardNosSha256);
        assert.equal(fixedInputHash(deck.cards), deck.definitionsSha256);
      }
    });
    check(
      "profile reflects current card definitions, not measured strength",
      () => {
        for (const deck of pool.decks) {
          const colorCounts = {};
          for (const card of deck.cards)
            for (const color of card.colors || [])
              colorCounts[color] = (colorCounts[color] || 0) + 1;
          const mechanics = [
            ...new Set(
              deck.cards.flatMap((card) =>
                (card.effects || []).flatMap((effect) =>
                  (effect.steps || [])
                    .map((step) => step.action?.kind)
                    .filter(Boolean)
                )
              )
            ),
          ].sort();
          assert.deepEqual(deck.profile, { colorCounts, mechanics });
          assert.ok(deck.reason.trim());
        }
      }
    );
    check("manifest contains no account or connection metadata", () => {
      assert.deepEqual(Object.keys(manifest).sort(), [
        "contentSha256",
        "decks",
        "kind",
        "schemaVersion",
        "seeds",
        "selectionPolicy",
        "source",
      ]);
      assert.deepEqual(Object.keys(manifest.source).sort(), [
        "artifact",
        "exportedAt",
        "sha256",
        "tierEntry",
      ]);
      for (const deck of manifest.decks)
        assert.deepEqual(Object.keys(deck).sort(), [
          "archetype",
          "cardNos",
          "cardNosSha256",
          "definitionsSha256",
          "id",
          "name",
          "profile",
          "reason",
          "tier",
        ]);
    });
    check("rewriting card hashes cannot replace frozen deck content", () => {
      const altered = clone(manifest);
      altered.decks[0].cardNos[0] = "UNKNOWN-CARD";
      altered.decks[0].cardNosSha256 = fixedInputHash(altered.decks[0].cardNos);
      const { contentSha256: _hash, ...content } = altered;
      altered.contentSha256 = fixedInputHash(content);
      assert.throws(() => resolveFixedDecks(altered, catalog), /manifest hash/);
    });
    check(
      "unknown cards are rejected rather than removed or substituted",
      () => {
        assert.throws(
          () =>
            resolveFixedDecks(manifest, {
              ...catalog,
              engine: { getCardDefinitionById: () => undefined },
            }),
          /unknown\/mismatched/
        );
      }
    );
    check("wrong lookup identity is rejected", () => {
      assert.throws(
        () =>
          resolveFixedDecks(manifest, {
            ...catalog,
            engine: { getCardDefinitionById: () => pool.decks[0].cards[0] },
          }),
        /unknown\/mismatched/
      );
    });
    const modifiedCatalog = (modify) => ({
      ...catalog,
      engine: {
        getCardDefinitionById(cardNo) {
          return modify(clone(catalog.engine.getCardDefinitionById(cardNo)));
        },
      },
    });
    check("current normal validator rejects token definitions", () => {
      assert.throws(
        () =>
          resolveFixedDecks(
            manifest,
            modifiedCatalog((card) => ({ ...card, maxTokenDeckCount: 1 }))
          ),
        /invalid normal main deck.*token/
      );
    });
    check("current normal validator rejects maxDeckCount zero", () => {
      assert.throws(
        () =>
          resolveFixedDecks(
            manifest,
            modifiedCatalog((card) => ({ ...card, maxDeckCount: 0 }))
          ),
        /invalid normal main deck.*maxDeckCount=0/
      );
    });
    check("current normal validator rejects excessive copies", () => {
      assert.throws(
        () =>
          resolveFixedDecks(
            manifest,
            modifiedCatalog((card) => ({ ...card, maxDeckCount: 1 }))
          ),
        /invalid normal main deck.*too_many_copies/
      );
    });
    check("legal but changed definitions need explicit input review", () => {
      assert.throws(
        () =>
          resolveFixedDecks(
            manifest,
            modifiedCatalog((card) => ({
              ...card,
              name: card.name + " changed",
            }))
          ),
        /definitions changed/
      );
    });
    check("immutable pool does not freeze shared catalog objects", () => {
      assert.throws(() => pool.decks[0].cardNos.pop(), TypeError);
      assert.throws(() => {
        pool.decks[0].cards[0].name = "changed";
      }, TypeError);
      assert.throws(() => pool.seeds.releasePairs.pop(), TypeError);
      const original = catalog.engine.getCardDefinitionById(
        pool.decks[0].cardNos[0]
      );
      assert.notEqual(original, pool.decks[0].cards[0]);
      assert.equal(Object.isFrozen(original), false);
    });
    check(
      "smoke16 and release400 preserve paired seed and swap both seats",
      () => {
        for (const [phase, expected] of [
          ["smoke", 16],
          ["release", 400],
        ]) {
          const games = fixedEvaluationGames(pool, phase);
          assert.equal(games.length, expected);
          assert.equal(new Set(games.map((game) => game.id)).size, expected);
          for (let i = 0; i < games.length; i += 2) {
            assert.equal(games[i].seed, games[i + 1].seed);
            assert.equal(games[i].pairId, games[i + 1].pairId);
            assert.deepEqual(games[i].decks, [...games[i + 1].decks].reverse());
            assert.equal(games[i].seat, 0);
            assert.equal(games[i + 1].seat, 1);
          }
        }
      }
    );
    check(
      "release covers all 28 matchups with balanced deck and seat exposure",
      () => {
        const games = fixedEvaluationGames(pool, "release"),
          pairs = new Map();
        for (const pair of pool.seeds.releasePairs) {
          const key = [...pair.decks].sort().join("/");
          pairs.set(key, (pairs.get(key) || 0) + 1);
        }
        assert.equal(pairs.size, 28);
        assert.ok([...pairs.values()].every((n) => n === 7 || n === 8));
        for (const deck of pool.decks)
          for (const seat of [0, 1])
            assert.equal(
              games.filter((game) => game.decks[seat] === deck.id).length,
              50
            );
      }
    );
    check(
      "evaluation/calibration seeds are unique and outside training range",
      () => {
        const { training, calibration, smokePairs, releasePairs } = pool.seeds;
        const seeds = [
          ...calibration,
          ...smokePairs.map((p) => p.seed),
          ...releasePairs.map((p) => p.seed),
        ];
        assert.equal(new Set(seeds).size, 211);
        assert.ok(
          seeds.every((seed) => seed < training.first || seed > training.last)
        );
        const forged = clone(pool);
        forged.seeds.releasePairs[0].seed = training.first;
        assert.throws(
          () => fixedEvaluationGames(forged, "release"),
          /differs from frozen/
        );
        assert.throws(
          () => fixedEvaluationGames(pool, "training"),
          /unknown fixed/
        );
      }
    );
    check(
      "evaluation rejects deck content or metadata changes despite valid IDs and seeds",
      () => {
        const mutations = [
          (p) => {
            p.decks[0].cardNos = ["UNKNOWN-CARD"];
          },
          (p) => {
            p.decks[0].cardNos.reverse();
          },
          (p) => {
            p.decks[0].cardNos.pop();
          },
          (p) => {
            p.decks[0].cardNos[0] = "UNKNOWN-CARD";
            p.decks[0].cardNosSha256 = fixedInputHash(p.decks[0].cardNos);
          },
          (p) => {
            p.decks[0].tier = "tier2";
          },
          (p) => {
            p.decks[0].reason = "altered";
          },
          (p) => {
            p.source.sha256 = "altered";
          },
          (p) => {
            p.decks.reverse();
          },
        ];
        assert.equal(fixedEvaluationGames(clone(pool), "smoke").length, 16);
        for (const mutate of mutations) {
          const forged = clone(pool);
          mutate(forged);
          assert.throws(
            () => fixedEvaluationGames(forged, "smoke"),
            /differs from frozen/
          );
        }
      }
    );
    check(
      "evaluation binds resolved definitions even when their claimed hash is rewritten",
      () => {
        for (const mutate of [
          (p) => {
            p.decks[0].cards = [];
          },
          (p) => {
            p.decks[0].cards[0].name += " altered";
          },
          (p) => {
            p.decks[0].cards[0].cardNo = "UNKNOWN-CARD";
            p.decks[0].definitionsSha256 = fixedInputHash(p.decks[0].cards);
          },
        ]) {
          const forged = clone(pool);
          mutate(forged);
          assert.throws(
            () => fixedEvaluationGames(forged, "release"),
            /differs from frozen/
          );
        }
      }
    );
  });
  return { executed: true, completed };
}
