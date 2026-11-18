# 名前参照の包含スコープ

親索引: `08_advanced-mechanics.md`。煌臨 / 転醒 / 契約の基礎は `08a_advent-rebirth-contract.md` を参照。

---

## 「…を含む自分の「X」」

カード名参照に付く接頭句で、数える／参照する「X」の所在スコープが決まる（裁定 2026-06-13）。
名前一致は card_name_reference 規約（「X」=部分一致／カード名：「X」=完全一致）に従う。

| 接頭句 | 対象「X」の所在 |
|---|---|
| （無印）「X」 | **通常フィールドのみ**（スピリット/ネクサス/アルティメット等） |
| 「魂状態を含む「X」」 | 通常フィールド ∪ 魂状態（`soulStateInstanceIds`） |
| 「魂状態/煌臨元を含む「X」」 | 通常フィールド ∪ 魂状態 ∪ 煌臨元（スピリットの下の `underCards` role=advent_source） |
| 「煌臨元を含む「X」」 | 通常フィールド ∪ 煌臨元 |

- **無印は「通常フィールドに実体配備された個体の現在面の印字名一致」のみが対象**（裁定 2026-06-13）。
  包含表記の無い「自分の「X」」では、以下はすべて**数えられず・参照できない**:
  1. **魂状態**（`soulStateInstanceIds`）。
  2. **煌臨元**（スピリットの下の `underCards` role=advent_source）。
  3. **その他「下に置かれたカード」全般**（星霊衣／アルドノア／バレットエディット系など `underCards` role=text_role）。
     ＝下に置かれたカードはアンダー役割に関わらず無印スコープ外。
  4. **表向き名前一致の分身**（`act_as_spirit` トークン）。分身が「X」の名前をコピーしていても無印では数えない。
  5. **転醒カードの現在面と違う面での一致**。名前一致は**現在面（現在の `definitionId`）の印字名のみ**で判定し、
     裏面・元面（現在表示していない面）の名前では一致しない。
  これらの包含は「魂状態を含む」「煌臨元を含む」等の接頭句で**明示された分のみ** opt-in される。
- **カウントでも参照でも同一スコープ**を適用する（《召喚条件：…N体以上》のような体数カウント、
  対象選択・重ね先指定などの参照、どちらも）。
- 契約煌臨後の「X」は `soulStateInstanceIds` から除去されるが、煌臨元（`underCards`）または
  スピリット本体として通常フィールド/煌臨元スコープに加算されるため、二重計上は起きない。
  advent-system の `soulStateInstanceIds` 除去は変更不要。
- 既出カード = BSDB01（孫悟空＆ベジータ）、BSKB01（メタナイト）、BSSL01（水篠旬）、
  BSTS01-X02・BSFT01-X01（召喚条件）等。
- **実装状態（2026-06-16 解消済）**:
  `field_has` カウント経路と `matchesCardFilter` 参照経路はいずれも、無印では魂状態・煌臨元・
  text_role アンダーカードを除外する。魂状態は `includeSoulState`、煌臨元は
  `includeAdventSource` / `adventSourceScope:"include"` で opt-in する。
  参照経路は `collectUnderCardScopeIds` を SSOT として `MatchCardFilterOptions.underCardIds`
  を注入し、text_role アンダーカードは常に無印スコープ外にする。
  回帰: `name-reference-inclusion-scope.test.ts` /
  `name-reference-inclusion-scope-reference.test.ts`。
