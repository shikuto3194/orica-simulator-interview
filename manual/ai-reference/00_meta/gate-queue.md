# 共有検証枠の順番待ち

検証運用の入口は [harness-validation.md](harness-validation.md)。実装は
`scripts/harness/gate-lease.mjs` と `gate-queue.mjs`。

## 受付と再試行

- 同じGit共通ディレクトリに属するtreeは従来と同じTEMP内のleaseを使う。
  隣接する `.lock.queue.json` に単調増加する受付番号、ランダムな受付ID、
  受付時刻、要求と入力のhash、試行token、期限を保存する。実際に待機中の要求を受付の確定順で実行する。
- `run-gates`の全profile（対話finish、full/test、push、merge、CI）と`pnpm fuzz`が共通入口。
  全項目を再利用できるpush等は実検証をしないため受付不要で、同じ入力の放棄済み再試行受付だけを閉じる。直接起動したVitestは対象外。
- 要求は実treeの正規パスと検査目的・引数で識別する。入力は既存の`followupFingerprint`と
  比較基点・対象パス、またはfuzz設定に結び付ける。生存中の同じ要求の二重起動は
  `VALIDATION_DUPLICATE`で停止し、既存試行tokenや期限を上書きしない。
- 受付識別ではworkerからwrapperへ移る際の配送・LLM起動metadataだけを明示的に除外する。
  実データroot・未知の`ORICA_*`・計算設定は保持し、wrapperは公開再開前にworkerと同じrootを設定する。
  検証cacheと取得前後の入力照合は従来の厳密な`sourceFingerprint`を使い続ける。
- 1回の待機上限は30分。`VALIDATION_BUSY`または`VALIDATION_OWNER_EXITED`では
  60分の再試行猶予を残す。同じ要求・入力の再実行は受付ID・番号・最初の受付時刻を継承する。
  再試行が休眠中なら後続の待機要求を進め、復帰時には元の番号で未実行の待機列へ戻す。
  既に取得済みのownerは追い越さない。猶予を過ぎた要求や入力が変わった要求は新規受付で末尾に並ぶ。
- 待機中は1秒ごとに更新し、更新停止から2分で受付を失効させる。PIDの再利用で
  待機者を生存扱いしない。失効した旧試行はtoken照合で取得を拒否される。
  この期限は**検証ownerのleaseには適用しない**。
- 取得時に受付を消費し、成功・検査失敗後の次の実行は新しい受付になる。
  取得後も入力を再照合し、待機中の編集で古い順番を別の入力に使わせない。
- 待機中のSIGINT/SIGTERMまたはAbortSignalは自分の受付を取消す。
  明示取消APIは `cancelGateRequest(root, { requestKey, receiptId })`。
  受付IDも一致する場合だけ取消し、古い取消操作で新規受付やownerを消さない。
  強制終了では2分の期限で後続が進む。再試行を放棄した場合も60分で失効する。
- 受付情報は成功／失敗のharness・fuzzログの`queueReceipt`に保存する。
  1試行の待ち時間は`leaseWaitMs`、通算待ち時間は`queueReceipt.enqueuedAt`から確認できる。
  finishの待機失敗も共通の終了コード75を返す。

## 排他と異常時

受付番号の発行、更新、取消、待機中の先頭・token確認と既存leaseの`wx`取得を、短時間の
OS排他の内側で行う。Windowsはnamed pipe、Linuxはabstract socketを使い、
常駐サービスは置かない。プロセスが途中終了してもOSが排他を解放する。
その他のOSはGit共通ディレクトリに結び付いたexclusive loopback portを使う。
別プロセスとのport競合は5秒で明示エラーとし、他のlistenerを停止しない。

queue更新は一時ファイルからのatomic rename。更新中のクラッシュでは旧版または
新版の完全なJSONが残る。Windowsの一時的な共有違反では同じ排他内で書込みだけを最大1秒再試行し、受付処理は繰り返さない。schema不明・JSON破損・書込不能は失敗とし、空queueへ初期化しない。
期限判定は同一ホストの時計を使う。通常運用中に時計を大きく変更しない。

検証本体の排他は従来の`wx`とowner token照合で保つ。owner PIDの終了・情報不足は
従来どおりエラーで、queueはそのleaseを削除しない。ownerの`started`は実取得時刻。
旧版ownerのJSON書込み途中やWindowsの一時的な読取り拒否は、連続する失敗ごとに最大1秒だけ再観測する。空きとは扱わず、継続する読取り失敗とPID生存確認の失敗はエラーで止める。
復旧は既存の`recover-gate-lease.mjs`の所有者・子プロセス・他検証・内容一致確認による。
生存ownerを停止・奪取しない。

公開再開の`supervisor-integration`はlease状態の読取だけを行う。
作成途中のJSONとWindowsの一時的な読取り拒否には、取得処理と共通の最大1秒の再観測を使う。
そこで受付を作成／消費せず、公開処理内の実際の`run-gates`が受付・再試行を担当する。
状態確認後に他の要求が来ても、実取得時のFIFOと`wx`で再判定する。
公開は再開時もmerge検証からfuzzへ進む。休眠したfuzz受付は前段mergeを塞がず、
merge完了後のfuzz再開時に同じ受付で待機へ戻る。

## 段階移行

旧版ownerと新版waiterは同じleaseを使うので排他は維持する。旧版waiterは受付番号を
持たず、解放時に先頭を追い越し得る。**旧版が混在する間の全体FIFOは保証しない**。
過去の待機開始時刻を推測して受付を作ったり、稼働中コードの書換えやowner停止で
順番を作ったりしない。

通常push後、各実行treeの処理境界で検証済みcommitを統合し、新規起動から採用する。
既に読込済みの旧プロセスは自然終了まで旧版。対話tree、control/worker、公開用mainの
採用commit・関連ファイルhash・起動世代を確認する。dirty保全や別の検証で統合できないtreeは
未採用と報告し、他タスクの変更・スケジュール・稼働プロセスを勝手に動かさない。

## 回帰

`node scripts/harness/test-gate-queue.mjs` は隔離repoで5プロセスの順序、別プロセスの
timeout再開、休眠中の後続実行と復帰時の優先、重複、取消、期限切れ、クラッシュ、旧試行の遮断、旧版との排他、破損時の
停止を検証する。`test-harness.mjs`からも実行される。
fuzzと公開再開の既存回帰も併用し、finish/pushのscope登録とfull/merge/CIの維持を確認する。
fuzz回帰ではtimeout後のmerge取得と、初回worker・再開wrapperの別プロセスで元の受付を使うこと、
source・fuzz設定・データroot・未知の設定が変わった要求は末尾へ並ぶことも確認する。
