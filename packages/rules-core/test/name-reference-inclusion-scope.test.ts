/**
 * 名前参照の包含スコープ（field_has。10_rules/08a「名前参照の包含スコープ」, 裁定 2026-06-13）。
 *
 * 「…を含む自分の「X」」の接頭句で、数える「X」の所在スコープが決まる:
 *   - （無印）「X」              = 通常フィールドのみ（魂状態・アンダーカードは数えない）
 *   - 「魂状態を含む「X」」      = 通常フィールド ∪ 魂状態（soulStateInstanceIds）
 *   - 「煌臨元を含む「X」」      = 通常フィールド ∪ 煌臨元（underCards role='advent_source'）
 * text_role アンダーカード（星霊衣/アルドノア等）は接頭句に関わらず常に数えない。
 *
 * 魂状態カード・煌臨元アンダーカードはいずれも zone:"field" のまま残るため、無印が
 * これらを数えてしまう退行を field_has 評価が防いでいることを直接検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, Condition } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { evaluateCondition } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const ALICE = "player-1";

// BSTS01-CX01 の name は "リムル=テンペスト"（contains "リムル" で一致）。BSTS01-C02 は
// "リグル"（名前不一致）なのでアンダーカードを抱える host として使う。
const NAMED = "BSTS01-CX01";
const HOST = "BSTS01-C02";

function fieldHasRimuru(
  opts: { includeSoulState?: boolean; includeAdventSource?: boolean } = {}
): Condition {
  return [
    {
      kind: "field_has",
      player: "self",
      cardNames: [{ contains: "リムル" }],
      minCount: 1,
      ...opts,
    },
  ];
}

const evalIt = (
  state: Parameters<typeof evaluateCondition>[0],
  cond: Condition
) => evaluateCondition(state, cond, "", ALICE, getDef);

describe("名前参照の包含スコープ（field_has, 裁定 2026-06-13）", () => {
  it("通常フィールドの「リムル」は無印で数える", () => {
    const normal = createCardInstance(card(NAMED), {
      instanceId: "norm-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({ cardInstances: [normal] });
    expect(evalIt(state, fieldHasRimuru())).toBe(true);
  });

  it("魂状態の「リムル」は無印では数えず、includeSoulState で数える", () => {
    const soul = createCardInstance(card(NAMED), {
      instanceId: "soul-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      cardInstances: [soul],
      playerOverrides: [{ soulStateInstanceIds: ["soul-1"] }, {}],
    });
    expect(evalIt(state, fieldHasRimuru())).toBe(false);
    expect(evalIt(state, fieldHasRimuru({ includeSoulState: true }))).toBe(
      true
    );
  });

  it("煌臨元の「リムル」は無印では数えず、includeAdventSource で数える", () => {
    const host = {
      ...createCardInstance(card(HOST), {
        instanceId: "host-1",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [{ cardInstanceId: "adv-1", role: "advent_source" as const }],
    };
    const under = createCardInstance(card(NAMED), {
      instanceId: "adv-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({ cardInstances: [host, under] });
    expect(evalIt(state, fieldHasRimuru())).toBe(false);
    expect(evalIt(state, fieldHasRimuru({ includeAdventSource: true }))).toBe(
      true
    );
  });

  it("text_role アンダーカードの「リムル」は接頭句に関わらず常に数えない", () => {
    const host = {
      ...createCardInstance(card(HOST), {
        instanceId: "host-2",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }),
      underCards: [
        {
          cardInstanceId: "txt-1",
          role: "text_role" as const,
          roleTag: "星霊衣",
        },
      ],
    };
    const under = createCardInstance(card(NAMED), {
      instanceId: "txt-1",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({ cardInstances: [host, under] });
    expect(evalIt(state, fieldHasRimuru())).toBe(false);
    expect(evalIt(state, fieldHasRimuru({ includeSoulState: true }))).toBe(
      false
    );
    expect(evalIt(state, fieldHasRimuru({ includeAdventSource: true }))).toBe(
      false
    );
  });
});
