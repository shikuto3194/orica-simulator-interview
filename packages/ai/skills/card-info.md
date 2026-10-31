---
name: card-info
description: カード情報の問い合わせ (lookup_card / filter_cards)
triggers:
  [
    カード番号,
    カードを教え,
    カードを見せ,
    カードの効果,
    カードのテキスト,
    カードを調べ,
    カードを探,
    どんなカード,
    という カード,
    なるカード,
    BSTH,
    BSTC,
    BS,
    BSH,
    緑のスピリット,
    赤のスピリット,
    青のスピリット,
    紫のスピリット,
    黄のスピリット,
    白のスピリット,
    黒のスピリット,
    煌臨カード,
    転醒カード,
    契約カード,
    アクセル系,
    ブレイヴ持ち,
    マジック,
    ネクサス,
    バースト,
    pack,
    パック,
    系統,
    キーワード能力,
    card lookup,
    card info,
  ]
allowed-tools: [lookup_card, filter_cards, read_doc]
---

# カード情報の問い合わせ

orica-simulator のカードデータ (`packages/card-data/cards/`) に対する問い合わせ。

## 使うツール

- **`lookup_card`**: カード番号が分かっている時 (例: `BSTH05-X01`)。`{ cardNo: string }` で単発取得。
- **`filter_cards`**: 条件で絞り込みたい時。pack / tribe / color / printedCategory / limit の組合せで最大 20 件返る。
  - `color` は `red/blue/green/yellow/purple/white/black` のいずれか。
  - `printedCategory` は `spirit/magic/brave/nexus/ultimate` のいずれか。
- **`read_doc`**: カードのキーワード能力やルール用語の定義が必要な時 (`manual/ai-reference/10_rules/`)。

## 流れ

1. ユーザーがカード番号を出した → `lookup_card` 一発。
2. ユーザーが「赤の煌臨スピリット」「○○パックのネクサス」のような条件を出した → `filter_cards` で絞り込む。1 回目で多すぎたら追加条件で再フィルタ。
3. キーワード能力 (煌臨条件 / 転醒条件 / 契約 など) を説明する必要が出たら `read_doc` で `manual/ai-reference/10_rules/` を引いて補強。

## 注意

- `lookup_card` は番号一致のみ。表記揺れ ("bsth5-x01" など) は正規化されないので、まず大文字で試して null なら確認する。
- `filter_cards` の `tribe` は部分一致だが、ユーザーが日本語で言う系統名と完全一致しないことがある。ヒット 0 なら緩めて再試行。
- カードテキストは `effects` (DSL) と `printedText` (印刷文) の両方を含む。「テキスト見せて」と言われたら `printedText` を、「効果は」と言われたら `effects` を中心に提示する。

## 出力

```
カード番号: <番号>
名称 / 色 / コスト / 種別: <要点>
テキスト要約: <短く>
特記: <煌臨 / 転醒 / 契約 / その他のキーワード>
```
