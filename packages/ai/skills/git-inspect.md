---
name: git-inspect
description: 作業ツリーの状態 / 差分の確認 (git_status / git_diff)
triggers:
  [
    git status,
    git diff,
    差分,
    変更ファイル,
    変更点,
    未コミット,
    未ステージ,
    コミット前,
    今の状態,
    作業ツリー,
    どんな変更,
    どこを変えた,
    何が変わった,
    review my changes,
    show diff,
    uncommitted,
  ]
allowed-tools: [git_status, git_diff, read_file]
---

# 作業ツリー / 差分の確認

ローカルの未コミット変更を見るためのワークフロー。

## 使うツール

- **`git_status`**: 何が変わったファイル (の一覧) を把握する。引数なし。
- **`git_diff`**: 実際の差分。`path` で個別ファイルに絞れる、`staged: true` で `--cached` (= staged 分のみ)。
- **`read_file`**: diff だけだと文脈が足りない時に該当ファイルの周辺を読む。

## 流れ

1. `git_status` で全体感を取る。
2. ユーザーが特定ファイル / staged を指定していればそれだけ `git_diff`。汎用要求なら全体 `git_diff`。
3. 大きすぎる diff は、ユーザーの関心 (ファイル名 / 機能名 / commit prefix) で絞る。
4. レビュー的観点が必要なら `/review` slash command を提案する (より構造化された出力を返す)。

## 出力

```
変更ファイル: <git_status の要約>

主な変更:
- <path>: <意図 / 何が起きているか 1〜2 行>
- <path>: ...

気になる点: <or なし>
```
