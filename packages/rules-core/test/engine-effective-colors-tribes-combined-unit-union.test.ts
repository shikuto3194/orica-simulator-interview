/**
 * engine-effective-colors-tribes-combined-unit-union: P3-142 残留懸念フォローアップ。
 *
 * `getEffectiveCategories()` は合体中ブレイヴのカテゴリにホスト側の値を union するが
 * (P3-142)、`getEffectiveColors()`/`getEffectiveTribes()` は union しない設計判断
 * (`legal-actions-shared.ts` の `buildEffectSourceIdentity` doc コメント参照)。
 * - 系統: `05_brave-and-attack-special-cases.md:27`「合算しない要素: 名前、系統、
 *   Lv ごとのコア数、軽減シンボル」で明示的に対象外。
 * - 色: 同ファイル:26「属性（色が追加）」は合体スピリット全体の表示用属性の話であり、
 *   防止元 identity (`EffectSourceIdentity`, `colorMatchMode:"exact"` 等) に union
 *   すると意図せず単色判定を崩すリスクがある。現行カードプールに実害となる組み合わせ
 *   (ブレイヴ側が cannot_be_destroyed/cannot_be_targeted 型耐性を持ち、かつ
 *   `preventionRestriction` 付きカードを防ぎうる) が存在しないため見送り。
 *
 * この test は上記「union しない」という決定を機械的に固定する回帰ガード。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import {
  buildEffectSourceIdentity,
  getEffectiveColors,
  getEffectiveTribes,
} from "../src/legal/legal-actions-shared";
import type { CardDefinition, GameState } from "../src/model";

const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const cardNoMap = new Map<string, CardDefinition>(
  expanded.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

// 黄のブレイヴ (地球・アルドノア系統) と赤のホストスピリット (幻想・地霊・皇獣系統)。
// P3-142 テストと同じ組み合わせ (色・系統が非重複であることを確認済み)。
const braveDef = card("BSAZ01-C18"); // アナリティカルエンジン: colors:["yellow"]
const hostSpiritDef = card("BSTH06-C01"); // キスメ: colors:["red"]

function makeCombinedState(): {
  state: GameState;
  host: ReturnType<typeof createCardInstance>;
  brave: ReturnType<typeof createCardInstance>;
} {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const host = createCardInstance(hostSpiritDef, {
    instanceId: "host-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    attachedChildrenIds: ["brave-1"],
  });
  const brave = createCardInstance(braveDef, {
    instanceId: "brave-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    attachedToInstanceId: "host-1",
  });
  const state: GameState = { ...base, cardInstances: [host, brave] };
  return { state, host, brave };
}

describe("engine-effective-colors-tribes-combined-unit-union: colors/tribes は合体ユニットで union しない", () => {
  it("getEffectiveColors: 合体中ブレイヴの実効色はブレイヴ自身の印字色のみ (ホスト色を含まない)", () => {
    const { state, brave } = makeCombinedState();
    const colors = getEffectiveColors(state, brave, braveDef);
    expect(colors).toEqual(["yellow"]);
  });

  it("getEffectiveColors: 合体先ホストの実効色もホスト自身の印字色のみ (ブレイヴ色を含まない)", () => {
    const { state, host } = makeCombinedState();
    const colors = getEffectiveColors(state, host, hostSpiritDef);
    expect(colors).toEqual(["red"]);
  });

  it("getEffectiveTribes: 合体中ブレイヴの実効系統はブレイヴ自身の印字系統のみ", () => {
    const { state, brave } = makeCombinedState();
    const tribes = getEffectiveTribes(
      state,
      brave,
      braveDef,
      getCardDefinitionById
    );
    expect(tribes).toEqual(["地球", "アルドノア"]);
  });

  it("buildEffectSourceIdentity: 合体中ブレイヴ発生源の colors/tribes はブレイヴ自身の値のみ (categories はホスト値を union する)", () => {
    const { state, brave } = makeCombinedState();
    const identity = buildEffectSourceIdentity(
      state,
      brave,
      braveDef,
      getCardDefinitionById
    );
    expect(identity.colors).toEqual(["yellow"]);
    expect(identity.tribes).toEqual(["地球", "アルドノア"]);
    // categories は P3-142 の既存挙動どおりホスト側(spirit)も union する対照区。
    expect(identity.categories).toContain("spirit");
    expect(identity.categories).toContain("brave");
  });
});
