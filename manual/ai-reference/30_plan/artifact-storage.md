# 棋譜・デバッグ生成物の容量管理

正源設定は `scripts/artifact-storage-policy.json`。対象は Git に登録された同一リポジトリの
全 worktree の `artifacts/`。コード・カード・画像・音声や他アプリのデータは整理しない。

## 上限と実行経路

| 項目 | 既定値 |
|---|---:|
| 合計警告 / 収集禁止 | 150 / 200 GiB |
| 整理後の目標 | 120 GiB |
| 空き容量の警告 / 収集禁止 | 150 / 100 GiB 未満 |
| 棋譜・対局別ログの1ファイル | 1 GiB |
| 集約ログの1ファイル | 8 GiB |
| 1実験の出力 | 32 GiB |

- supervisor はカード監査より先に容量を測定し、警告時は harvest を省略して
  `storage-cleanup-required`、計測失敗時は `storage-repair-required` として worker を起動する。
- `effect:debug` / `effect:debug:loop` / `policy:bootstrap` / `position:bias` の CLI も開始時に容量を検査する。
  警告段階から新規収集を拒否し、先に整理させる。
- effect-debug / policy-bootstrap / position-bias は書き込み時にもファイル・実験容量と空き容量を検査する。
  超過時は `ARTIFACT_STORAGE_LIMIT` を返す。正常収集・clean判定として扱わない。
  完了済み checkpoint は保持し、途中の `.partial` は上限以内で残す。
- ルールエンジンの判定、対戦上限、coverage条件を容量回避のために緩和しない。

## 保存方式と運用容量

- 新規棋譜は `*.jsonl.gz`。128フレームごとの完全状態と、その間の可逆JSON差分を単一gzipストリームに保存する。
  状態・選択・ログを間引かず、復元後の全フレームは元のJSONと一致する。
- 対局別の trace / frames、学習 replay-buffer も gzip にする。
  effect-debug の集約ログは `frames.manifest.json` / `trace.manifest.json` から対局別ファイルを参照し、
  同じ詳細ログを集約先へ再コピーしない。manifest 内は同じ実験の実在ファイルに限定する。
- triage / trace validator は従来JSON・JSONLと新形式を読み、gzip詳細ログは逐次展開する。
  GUI の棋譜インポートも両形式を受け付ける。壊れた圧縮・差分・参照はエラーとする。
- エンジンの同期callback中は容量制限付き一時ファイルに書き、対局間でgzip化する。
  一時ファイルと完成gzipが共存するピークも32GiB枠に計上する。
  1GiBの個別上限は圧縮前の差分／対局別詳細ログにも適用するため、異常な1局の肥大化を止められる。
- 合計150/200GiBはWindowsではNTFS圧縮後の保存バイト数、他OSではファイルの符号化済みサイズで測る。
  `logicalGiB` も併記する。計測APIが失敗したら収集開始を拒否する。
  NTFS圧縮済み旧実験を再開する際の32GiB判定は保守的に論理サイズを数える。

従来の非圧縮形式では自然終了100局で14.21GiB、線形換算で1万局約1,421GiBになり、
32GiB枠でフルランを運用できなかった。上限は保存方式とセットで評価し、棋譜・ログの欠落で容量を減らさない。
新形式の実測結果は下記の検証記録を参照する。

## 整理

```powershell
pnpm storage:status
pnpm storage:maintain
pnpm storage:maintain -- --apply
# 空フォルダーのみ整理（棋譜ファイルは削除しない）
pnpm storage:maintain -- --empty-only --apply
pnpm storage:check
# Windows: 保護済み旧データも内容を変えずに圧縮
node scripts/artifact-storage.mjs compact
node scripts/artifact-storage.mjs compact --apply
```

`maintain` は既定で候補表示のみ。`--apply` で古い bulk payload を削除する。
空フォルダーも毎回整理し、過去の整理で残ったものは容量が正常でも対象とする。
`--empty-only` は空フォルダーだけを対象にし、候補数を `emptyDirectoryCount`、
実際の削除数を `removedDirectories` で返す。
対象 bucket は `effect-debug` / `policy-shadow` / `position-bias` / `policy-bootstrap`。

- 6時間以内に更新された実験、各 bucket の直近2実験、実行中 writer を保護する。
- 全 worktree の未解決 cluster、現役 loop state、pending follow-up、active issue が参照する
  実験を保護する。保持する実験の config / metrics / checkpoint の依存先も辿る。
- 棋譜、JSONL詳細ログ、巨大な旧game ledger、未完了 partial だけを削除する。
  metrics、tickets、config、学習checkpoint、小さいledgerを保持する。
- 整理済み実験には `.storage-pruned.json` を残す。元ディレクトリでの収集再開は拒否する。
  再現が必要なら保持した seed / config から新しい出力先へ実行する。
- 削除前のパス・サイズ一覧を hub の `logs/artifact-storage-cleanup-*.jsonl` に記録する。
- 空フォルダーは実験内を下から削除し、実験フォルダー自体は保持する。
  writer・参照保護中・整理中・最新実験を除外し、未整理実験は6時間以内の更新も保護する。
  削除直前に空であることを再確認し、非再帰削除で新規ファイルを保護する。
- junction / symbolic link、パス逸脱、壊れた参照JSONは fail closed。
  削除直前に参照と更新を再確認し、活動中の証拠を消さない。

Windows の `compact --apply` は1MiB以上の旧棋譜・詳細ログをNTFS透過圧縮する。
ファイル名と読み出し内容は変えず、active writer / 6時間以内 / 整理中 / gzip済みを除外する。
保護対象も削除せず圧縮できる。実行前一覧を `logs/artifact-storage-compaction-*.jsonl` に記録する。
既に十分圧縮されたファイルは再処理しない。

## worker の必須対応

容量警告を受けたら通常実装・新規収集より先に `storage:maintain -- --apply` を実行し、
解放量・空フォルダー削除数と `storage:check` の結果を確認する。空フォルダー整理も同じタスク内で行う。
保護中の証拠を手動で消さない。
保護分だけで警告が残る場合はWindowsで `node scripts/artifact-storage.mjs compact --apply` を実行し、再計測する。
それでも警告が残る場合は圧縮・記録方式の改善を実装する。
上限引上げ、guard無効化、checkpointの完了扱いへの書換えで回避しない。

整理 lock のエラーは PID の生存と別の整理処理を確認して扱う。
動作中 lock を消して並行実行しない。収集停止は同一フルラン内の容量制御であり、
scheduled task 自体の disable / enable を変更する操作ではない。

## 2026-09-12 実測

200局コホート（seed496997）の残存自然終了198局で、棋譜とtrace/framesの旧二重保存25.346GiBに対し、
差分gzipと重複解消後は0.341GiB（約98.65%減）。全フレームのJSON復元一致を確認した。
平均1.763MiB/局、最大7.173MiB/局、差分一時データは最大15.919MiBだった。
同じ分布なら1万局で17.22GiB、32GiB枠に約14.78GiBの余裕がある。
これは198局の保存量からの推計で、1万局のエンジン実走保証ではない。異常な長時間対局や分布変化はguardで検知する。
再現記録: `logs/storage-optimization-full-cohort-benchmark.json`（ローカル生成物）。
