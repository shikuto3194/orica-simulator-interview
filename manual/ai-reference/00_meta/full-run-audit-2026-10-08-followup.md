# フルラン監査の統合時追加確認（2026-10-08）

入口・元の調査範囲は[監査台帳](full-run-audit-2026-10-08.md)。N09/N10の完了条件を維持し、
追加問題の未修復・修正済み・検証待ちを区別する。各最終treeの実行証跡で反映を判定する。

## N11: 支払モデルと保存原文の差（未修復）

Rainの保存原文（`packages/card-data/raw/by-pack/BSAZ03.js`）はフィールドのマジックで黄軽減要求を
「満たす」が、既存の`BSAZ03.ts`定義は`addsReductionSymbol`で要求シンボルを追加している。
N10の実盤面回帰は現行実装の軽減後5・4枚破棄後1を再現する。原文から推定する4・破棄後0との
差はカード意味論の別件で、修正比較は未実行。N10が導入した差ではなく、入力不足の再発防止を
原文準拠コストの証明としない。C12にも同種の静的懸念があるが支払再現は未実行。

支払・破棄量と入力合法性へ影響する可能性がある。個体限定waiverと重複充足防止を含む確認が必要で、
今回の境界付き入力修正では未修復とする。根拠の確度は保存原文Cと現行実装であり、配布元QA照合済みとしない。
共有rules-core更新で失効したcoverage 49件・fidelity 21件は無根拠に承認しない。

## N12: root先行終了テストの待機不備

main `3b5ef684`結合後のfinish（`1791467436761-40744`）で、新規Windows Job回帰が期待exit 0に
対し125で失敗した。rootのexitCode 0だけを終了待機に使い、生存子孫を最終化するJob終了と
競合する同期不足がある。[Windowsの終了手順](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-exitprocess)では
終了コード更新とprocess objectのsignaled化は別段階である。今回の正確なOS内順序はsample未保存のため確証不能。
fixtureと失敗ログを保全し、推定原因を実測事実と区別する。

テストはrootのJob退出と子孫のmembershipを待ち、成功した同じsampleを直前証跡として保持する。
終端コード0・子孫終了・CPU非減少の期待は維持し、固定sleepや125許容にはしない。本番nativeは変更しない。
直前と終端sampleを失敗fixtureへ残す。修正後の私有fixture回帰はWindows 21チェック成功。
結合treeの全体gate・独立査読・通常統合は別途必要であり、この21件を本番runtimeの完全会計の証明とはしない。
