# Final Verification Lane Prompt

明示的に割り当てられたときだけ使う one-shot 検証 lane。継続検証 lane は廃止済み。
開始時にfresh coverage/fidelityの残数を確認する。前段からの移行条件は [Full-run Supervisor](full-run-supervisor.md)「現在の範囲と移行条件」に従う。旧「停止条件」番号（8を含む）は同書から失効済みで、
`pnpm scan:ssot-candidates --gate` は個別に実行する検査である。

## 必ず読む

- `CLAUDE.md`
- [`full-run-worker-brief.md`](./full-run-worker-brief.md)
- このファイル
- [`25_gui/12_bidirectional-e2e-pattern.md`](../25_gui/12_bidirectional-e2e-pattern.md)
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
