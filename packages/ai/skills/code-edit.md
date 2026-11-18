---
name: code-edit
description: コード実装 / 追加 / 修正のワークフロー (read_file → apply_edit / write_file → run_tests)
triggers:
  [
    実装して,
    実装し直し,
    実装を,
    追加して,
    追加実装,
    修正して,
    直して,
    なおして,
    リファクタ,
    refactor,
    バグ修正,
    バグを,
    fix bug,
    書き直し,
    書き換え,
    書いて,
    関数を作,
    関数を追加,
    型を追加,
    新しいファイル,
    ファイルを作成,
    新規ファイル,
    新しいカード,
    カードを追加,
    DSL を追加,
    効果を追加,
    テストを書,
    テストを追加,
    type を追加,
    type を変更,
    implement,
    add function,
    create file,
  ]
allowed-tools:
  [read_file, apply_edit, write_file, run_tests, run_typecheck, git_diff]
---

# コード実装 / 修正ワークフロー

orica-simulator のソースを編集する一連の流れ。

## 順序（守る）

1. **読む**: `read_file` で対象ファイル + 周辺ファイル (テスト、型、呼び出し元) を最低 1〜3 件読む。**書く前に必ず読む** (構造を把握しないままの推測編集は禁止)。
2. **既存の流儀に合わせる**: 周辺コードの命名、importスタイル、型の使い方を踏襲する。新規抽象を持ち込まない (CLAUDE.md "Don't add features ... beyond what the task requires" 準拠)。
3. **書く**:
   - 既存ファイルの一部だけ書き換えたい → `apply_edit` (oldString → newString)。一致が 1 箇所であることを意識し、必要なら `replaceAll: true`。
   - ファイル新規 or 全置換 → `write_file` (overwrite=true は既存上書き)。
4. **検証**: `run_typecheck` で型エラーがないことを確認 → カード / DSL 追加なら `run_tests` で最低 1 テストの実行も。失敗したら原因を読み、テストを緩めずに実装側を直す (memory: `feedback_no_skip_effects`)。
5. **差分確認**: `git_diff` で意図通りの変更だけが入っているか最後に見る。

## 守る原則

- **Effect 型に専用フィールドを足さない**。既存 Action / `evaluateCondition()` / 共通プリミティブで表現する (CLAUDE.md Cross-cutting Rule)。
- **コメントを書かない**。well-named identifier が説明する。例外: 非自明な制約 / hidden invariant のみ。
- **テストをスキップしない / 期待値を実装に合わせて緩めない**。
- カード/効果追加なら最小 1 テストケースを必ず添える。
- 大きい変更を 1 コミットに詰め込まない。論理単位で分ける。

## 出力フォーマット

```
変更計画: <1〜2 行>

変更ファイル:
- <path>: <何を変えたか>

検証:
- run_typecheck: ✓ / 失敗内容
- run_tests: ✓ / 失敗内容

差分要約: <git_diff の主要 hunk>
```
