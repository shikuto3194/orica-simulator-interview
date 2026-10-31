# カードデータ更新フロー

原文の訂正・errata・Q&Aを既存カードへ反映する手順。
追加時の表現選択は [カード追加判断表](04_card-addition-decision-table.md)、出典の扱いは [CLAUDE.md](../../../CLAUDE.md) に従う。

## 更新手順

1. 原文・Q&Aと関連する `10_rules` を照合し、変更理由と対象の `cardNo`・面・本文行を特定する。出典とユーザー裁定は同ターンで関連ルール章・調査記録へ反映する。
2. [カード定義](../../../packages/card-data/src/cards/) の旧文言を検索し、`textLines`、`effects`、nested effects、`textRef`、`sourceText`、見出し、他カードからの参照、`backFace` を確認する。名前変更なら表示名とフィルタも確認する。
3. 印字値・本文と、変更の影響を受けるDSL・副構造を同期する。本文の行追加・削除では後続 `textRef` のずれも確認する。`sourceUrls` と根拠の確度を更新する。
4. 本文台帳の既存原文を訂正する場合は [訂正契約](../00_meta/harness-validation.md) に従う。baselineを変更して通さず、必要な `sourceCorrection` と実行テストで根拠を残す。
5. 変更した効果の回帰を実行し、`pnpm codex:finish-check --plan` で選ばれる検査と影響に応じた追加検査を完了する。

## 更新対象の目安

| 変更 | 確認する定義・影響 |
|---|---|
| 本文・名前 | 印字本文、効果・条件・対象、本文参照、表示用本文、表裏、他カード参照 |
| コスト・軽減・色・BP・Lv・系統 | 該当する印字フィールドと実効値の計算・参照 |
| キーワード・副構造 | 対応carrierと一般ルール、個別効果との重複 |
| 画像 | 参照先と表裏の対応、[公開用素材](../00_meta/public-build.md)の画素・参照検査 |

フィールド名と値の形は [CardDefinition](../../../packages/rules-core/src/model.ts) と [DSL型](../../../packages/rules-core/src/dsl-types.ts) を確認する。独立した型一覧をこの表で維持しない。

## 検証の意味

- 型チェックと対象カードの回帰は、定義の形と実行結果を確認する。
- `pnpm cards:coverage` は表裏・nested effectsの構造的な残量、`pnpm cards:fidelity --gate` は本文と定義の制約、`pnpm cards:text-ledger --gate` は本文の帰属を検査する。詳細と限界は [本文台帳](../20_design/12a_text-accountability-ledger.md)。単独の成功を完全実装の証拠にしない。
- `pnpm test:unit <関連テストファイル>` は開発中の絞り込み確認。finish/push/mergeの証跡は [共通検証入口](../00_meta/harness-validation.md) に従う。
- [card-definition.schema.json](../../../packages/card-data/card-definition.schema.json) は旧JSON形式の参考資料。現行 `CardDefinition` / DSLを網羅せず、現行データの受入検証には使わない。

更新件数や今後の機能一覧はここへ追加せず、必要な残作業だけを既存のToDo・issueへ記録する。
