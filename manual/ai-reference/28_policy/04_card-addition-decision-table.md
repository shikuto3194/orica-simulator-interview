# Card Addition Decision Table

カード本文を、既存の汎用ルールと DSL で実行できる定義へ変換するための入口。
運用規則は [CLAUDE.md](../../../CLAUDE.md)、型は [dsl-types.ts](../../../packages/rules-core/src/dsl-types.ts) と [model.ts](../../../packages/rules-core/src/model.ts) を参照する。

## 判断順

1. 関連する [ルール索引](../README.md)・原文・Q&Aを確認し、効果の対象、選択者、条件、処理順を確定する。既存コードの挙動だけを裁定の根拠にしない。
2. 印字情報とキーワード固有の構造を `CardDefinition` に、個別の効果本文を `effects: Effect[]` に対応付ける。
3. 既存の `Timing` / `ConditionClause` / `CardFilter` / `Action` / `EffectStep` で表現する。複数手順や相手の選択を含むだけでは手書き resolver の理由にならない。
4. 表現力や配線が不足する場合は、既存の型・共通判定・登録・インタプリタを拡張する。特定 `cardNo` の例外を先に追加しない。
5. 個別経路が必要と判断した場合も、汎用経路では表せない根拠、適用範囲、回帰テストを関連設計・issueへ残す。既存の手書き経路があること自体は、新規例外を増やす理由にならない。

## 判定表

| 内容 | 使用する表現・経路 | 確認すること |
|---|---|---|
| コスト・軽減・色・Lv・シンボル | `CardDefinition` の印字情報 | 表裏と実効値の区別 |
| 煌臨・契約・ミラージュなど | 対応するカード副構造と一般ルール | 共通処理を個別 `effects` に重複記述しない |
| 個別効果本文 | `effects` と必要な nested effects | タイミング・Lv・強制/任意・回数制限を含める |
| 対象・数量・選択者 | `TargetSpec` / `Count` / `CardFilter` / `chooser` | 対象所有者と選択者を混同しない |
| 連続処理・支払い条件・結果参照 | `EffectStep` / `connector` / `stepCondition` / step参照 | 宣言・選択・解決・継続再開の順序 |
| 既存DSLで表せない内容 | 汎用型・共通処理の拡張 | 同じ列挙や判定を別の場所へ複製しない |

`keywordTags` は共有のキーワード機構が読むメタデータであり、効果本文の実装を代替しない。
`effects` があるだけでGUI到達性や原文との同値性を証明したことにもならない。

## 実装と検証の入口

- カードは [src/cards](../../../packages/card-data/src/cards/) の該当パックを編集する。既存定義の訂正は [カードデータ更新フロー](06_card-data-update-flow.md) に従う。
- DSLの読み方と実行経路は [DSL仕様](../20_design/12_dsl-specification.md)・[実装ナビゲーション](../20_design/11_structured-effect-model.md)。登録は [structured-effect-registrations.ts](../../../packages/rules-core/src/effect/structured-effect-registrations.ts) が生成する。
- 原文との対応は [本文台帳](../20_design/12a_text-accountability-ledger.md)。`textRef` の存在だけで意味的な実装済みとしない。
- 各カードに効果実行後の盤面を確認する回帰を用意する。選択や対象制限は複数候補と不適格候補も含める。
- `pnpm codex:finish-check --plan` で差分の検査範囲を確認し、必要な検査を実行する。GUI・APIを変更した場合は [シナリオ検証](../25_gui/12_bidirectional-e2e-pattern.md) の検証経路を区別する。
- 残作業は [現役ToDo](../30_plan/02_detailed-todo.md) と該当issueで管理する。この判定表に対応率・未実装一覧を複製しない。
