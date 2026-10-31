# 印字複合シンボルの個数保持（2026-10-12）

- BSTH02.7-CX01「［魔導と叡智の契約者］アリス・マーガトロイド」の原文 `symbol: ["黄導"]` を黄導1個として保持。黄1個と導1個には分けない。
- 同じ原文変換経路のBSES01-CX01「[白銀の契約者]ヴラディレーナ・ミリーゼ」も白導1個を保持する。
- 同じ監査で見つかったBSTH10-X01/X03/X04の黒神1、BSTH11-X01の緑神1も弾別rawと承認済みミラーに合わせて保持する。
- `symbolColorEntries` が物理シンボル単位、`symbolColors` は互換用の平坦化。省略時は既存の単色シンボル列として扱う。原文変換、表裏定義、軽減・印字個数・コピー・ゾーン由来追加、AI静的特徴とカード詳細表示へ接続。
- 原文監査は色の集合だけでなく1個ごとの境界も比較する。`["黄導"]` と `["黄", "導"]` の取り違えを検知する。
- 最新mainとの統合時、I0固定デッキの「動魔」「86」「天空璋」の定義hashを再確認。今回の `symbolColorEntries` 追加だけを除くと旧hashへ一致することを確認し、3デッキの定義hashとmanifest固定hashを更新した。カード番号・順序・seed・選定metadata・拒否条件は変更しない。
- 回帰: `printed-compound-symbols.test.ts`（1枚は最大1軽減、2枚は2軽減、印字個数とコピー）、`raw-compound-symbol-conversion.test.ts`（表裏の変換）、`symbol-format.test.ts`（黄導1と黄1・導1の区別）、`scenario-alice-oracle-optional.spec.ts`（Alice GUI / Bob REST、盤面と詳細の黄導1）。
- 根拠: `packages/card-data/raw/cardData.js` と弾別raw、2026-10-12ユーザー確認。ルール正源は [03a](../10_rules/03a_cost-payment.md)。
