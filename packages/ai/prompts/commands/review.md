---
name: review
description: 現在の作業ツリーの未コミット差分をレビューする
allowed-tools: [git_status, git_diff, read_file, run_typecheck]
args: "対象パス (省略時は全体)"
---

# Skill: 作業ツリーレビュー

`git_status` で変更ファイルを把握 → `git_diff` で差分を取得 → 必要に応じて `read_file` で周辺コードを参照 → `run_typecheck` で型エラーが入っていないか確認。

# レビュー観点 (この順で確認)

1. **rules-core の不変条件**: ゾーン移動・コア移動・continuous effect の整合を壊していないか。
2. **DSL の汎用性**: 専用フィールド追加で逃げていないか (`evaluateCondition()` / 既存 Action で表現できないか)。
3. **型安全**: `as` の濫用がないか、`exactOptionalPropertyTypes` 規約を守っているか。
4. **テスト**: カード/効果追加なら最小 1 件のテストがあるか。
5. **コミット粒度**: 1 コミット = 1 関心事になっているか。

# 出力フォーマット

- 各変更ファイルごとに「OK / 要修正 / 質問」を 1 行で。
- 要修正の場合は理由と修正案を箇条書きで。

引数: {{ARGS}}
