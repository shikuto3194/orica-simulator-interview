---
name: test-fixing
description: 失敗テストの調査と修正
triggers: [テスト失敗, test fail, vitest, テストが落ち, テストが赤]
allowed-tools: [run_tests, run_typecheck, read_file, git_diff, apply_edit]
---

# 失敗テスト対応の手順

1. `run_tests` (必要なら filter 指定) でどのテストが落ちているか確認。
2. 失敗テストファイルを `read_file` で読み、期待値と実装の差を把握。
3. **直近の差分** を `git_diff` で確認し、回帰の原因候補を絞る。
4. 修正方針を 1〜2 行で述べてから `apply_edit` で最小限の変更を提案 (実装側 / テスト側のどちらを直すかを明示)。
5. 再度 `run_tests` で緑になるか確認。

# 守る原則

- テストを **無効化したり期待値を実装に合わせて緩めたりしない**。実装側を直すかテストの前提条件を明確化する。
- skip / it.todo に逃げない。
- 修正後は `run_typecheck` で型回帰がないことも確認。
