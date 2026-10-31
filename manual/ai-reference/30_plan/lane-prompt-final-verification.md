# Final Verification Lane Prompt

停止条件 1〜4 と 8 が達成済みになった後の one-shot 検証 lane。継続検証 lane は廃止済み。

## 必ず読む

- `CLAUDE.md`
- [`full-run-worker-brief.md`](./full-run-worker-brief.md)
- このファイル
- `25_gui/12_bidirectional-e2e-pattern.md`
- `final-gui-review-checklist.md`（完了報告時の誘導先）

## 実行

- `FUZZ_GAMES=1000 pnpm fuzz`
- `npx playwright test`
- 全弾 set-review

`FUZZ_GAMES=1000 pnpm fuzz` は、stdout の `capped=0 stuck=0 error=0` / green test と
**exit code 0 の両方**を確認する。非ゼロ exit は stdout が green でも失敗として扱い、
stdout と終了コードを対象 lane への診断情報として記録する。`capped` は未分類の stuck 相当であり、
出力された seed を対象 lane の修正対象にする。

## 編集方針

原則 read-only + test 実行。fail したら修正せず、対象 lane へ handoff する。テスト harness 側の
明白な修正だけ、rules-core / card-data に触れない範囲で許可する。
