/**
 * 名前参照の包含スコープ — 参照/対象選択経路（matchesCardFilter）。
 * 10_rules/08a「名前参照の包含スコープ」, 裁定 2026-06-13。
 *
 * field_has（カウント経路）と同一規約を matchesCardFilter（対象選択・候補列挙の
 * reference 経路）にも適用する。アンダーカード（煌臨元 / 星霊衣等の text_role）は
 * ホスト離脱まで zone:"field" を保持するため、無印スコープの効果対象として拾われて
 * しまう退行（08a L243-249 の reference 経路ギャップ）を防ぐことを直接検証する:
 *   - text_role アンダーカード     = 接頭句に関わらず常に対象外
 *   - 煌臨元（advent_source）       = 無印では対象外、adventSourceScope:"include" で対象化
 *   - 魂状態                        = 既存どおり無印で対象外（回帰ガード）
 *   - 通常フィールド個体            = 無印で対象
 *
 * 集合の算出は collectUnderCardScopeIds（model）を SSOT として共有する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, CardFilter } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { matchesCardFilter, collectUnderCardScopeIds } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const ALICE = "player-1";

// BSTS01-CX01 の name は "リムル=テンペスト"（contains "リムル" で一致）。
const NAMED = "BSTS01-CX01";
const HOST = "BSTS01-C02"; // "リグル" — 名前不一致なので host として使う

const rimuruFilter: CardFilter = { cardName: undefined, tribes: undefined };
// 「リムル」を含む名前で絞る filter（部分一致）。
const filterByName = (extra?: Partial<CardFilter>): CardFilter => ({
  ...rimuruFilter,
  cardNames: [{ contains: "リムル" }],
  ...extra,
});

describe("名前参照の包含スコープ（reference 経路 matchesCardFilter, 裁定 2026-06-13）", () => {
  it("通常フィールドの「リムル」は無印で対象になる", () => {
    const normal = createCardInstance(card(NAMED), {
      instanceId: "norm-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({ cardInstances: [normal] });
    const underCardIds = collectUnderCardScopeIds(state);
    expect(
      matchesCardFilter(normal, card(NAMED), filterByName(), {
        soulStateIds: new Set(),
        underCardIds,
      })
    ).toBe(true);
  });

  it("煌臨元の「リムル」は無印で対象外、adventSourceScope:include で対象化", () => {
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
    const underCardIds = collectUnderCardScopeIds(state);
    expect(underCardIds.adventSource.has("adv-1")).toBe(true);
    // 無印 = 対象外
    expect(
      matchesCardFilter(under, card(NAMED), filterByName(), {
        soulStateIds: new Set(),
        underCardIds,
      })
    ).toBe(false);
    // 「煌臨元を含む」= 対象化
    expect(
      matchesCardFilter(
        under,
        card(NAMED),
        filterByName({ adventSourceScope: "include" }),
        { soulStateIds: new Set(), underCardIds }
      )
    ).toBe(true);
  });

  it("text_role アンダーカードの「リムル」は接頭句に関わらず常に対象外", () => {
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
    const underCardIds = collectUnderCardScopeIds(state);
    expect(underCardIds.textRole.has("txt-1")).toBe(true);
    // 無印でも opt-in でも常に対象外
    expect(
      matchesCardFilter(under, card(NAMED), filterByName(), {
        soulStateIds: new Set(),
        underCardIds,
      })
    ).toBe(false);
    expect(
      matchesCardFilter(
        under,
        card(NAMED),
        filterByName({ adventSourceScope: "include" }),
        { soulStateIds: new Set(), underCardIds }
      )
    ).toBe(false);
  });

  it("underCardIds 未注入なら従来どおりアンダーカードチェックをスキップ（後方互換）", () => {
    const under = createCardInstance(card(NAMED), {
      instanceId: "adv-2",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({ cardInstances: [under] });
    // underCardIds を渡さないと従来挙動（名前一致のみ）
    expect(
      matchesCardFilter(under, card(NAMED), filterByName(), {
        soulStateIds: new Set(),
      })
    ).toBe(true);
    void state;
  });
});
