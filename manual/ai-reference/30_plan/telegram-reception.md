# Telegram 即時受付と通知

正源は [full-run-supervisor.md](full-run-supervisor.md) と `CLAUDE.md`。
2026-09-12 ユーザー指示: フルランの実装中でもTelegramへ即時に応答し、処理過程から完了まで同じ通知を更新する。

## 受信と返答

1. `telegram-inbox.mjs poll` が通常文章・画像付き指示・明示裁定をpendingへ保存する。
2. 受信直後に `telegram-message-worker.mjs drain` を非同期起動する。
   supervisorのRunning状態・engine用lockには依存しない。long-pollの各tickも未処理分を再確認する。
3. 受付専用lock `logs/codex-telegram-inbox/reception.lock.json` を既存supervisor-lockで取得し、
   受信順に処理する。同じ受付の多重起動を防ぎ、実行中の追加返信は次に処理する。
4. `worker-codex-stream.mjs` をread-only sandboxで起動する。各受付は新規文脈で、
   通常受付はsession.jsonlの直近会話と今回の原文・添付情報を渡す。下記の定型照会だけは必要な資料に限定する。
5. 情報照会はその場で回答する。裁定・修正・運用変更は、受付が解釈と具体的なタスクを返し、
   controllerが原文付きでdurable follow-upへ保存する。engine/docの書込みとcommitはフルランworkerが行う。
6. 保存に成功してからinboxをappliedへ移し、「フルランキューへ登録済み（実装待ち）」と回答する。

`apply-rulings` は同じ即時受付への互換入口。明示裁定だけを無条件にresolvedへ変える処理は使わない。
自然文の「裁定返信」も扱い、既にresolvedだったカードへの補足・訂正を取りこぼさない。
supervisorのinbox summaryは件数だけを示し、同じ未処理メッセージを別workerへ二重投入しない。
実装依頼は従来のdurable follow-upから、通常タスクより先に読む。
裁定の解釈・受付完了と、実装修正完了は別の状態である。

## 定型照会のモデル固定

`auxiliary-model-policy.mjs` の文面全体の許可リストで、処理開始前に振り分ける。分類のためのモデル呼出はない。
「フルランの状況」「フルランの進捗は？」「Telegramのコマンド一覧」などの定型照会だけ `gpt-6-luna` / `high`。
添付付き、裁定、修正依頼、混在文面、引用、文脈依存の追加返信、forceは通常受付のまま。
`/status` など既存の制御コマンドは引き続きスクリプトが処理する。

定型照会には会話履歴を渡さず、状態ファイルの時刻・状態またはコマンド一覧だけを渡す。
状態は記録上の値であり、現在のプロセス生存・検証成功・配備完了と断定しない。
資料外の調査は禁止し、`handoff=null` をcontrollerでも要求する。失敗時の自動昇格はない。
定型受付のエラーも通知するが、フルランへ復旧タスクを自動投入しない。通常受付とフルランのエラー引継ぎは維持する。

初回起動前に `reception-models/<id>.json` へモデル・推論設定・入力hashを保存する。
再試行と `/retry` はこの選択を維持する。導入前の未完了受付は既存runnerの記録を引き継ぎ、
前回モデル不明・記録破損・入力変化なら推測して再起動せず停止する。
`/retry` も試行履歴を消す前にモデル記録を確定する。初回選択とretryは共通のinbox mutation lockで直列化する。
通常受付は既存の `ORICA_CODEX_MODEL` / `ORICA_CODEX_REASONING_EFFORT`（未設定時 `gpt-5.6-terra` / `xhigh`）を初回に固定する。
受付の子プロセスはfull-runの環境フラグを継承しない。フルラン本体と敵対的検証の `gpt-6.1-sol` / `xhigh` は変更しない。

## 実装への選択と記録

- wrapperはISMCTSの待機判定より先に `supervisor-followup.mjs plan` を読む。確定受付の `handoffId` とpendingキューが一致する依頼だけを選ぶ。従来形式の依頼も移行操作なしで対象になり、古い運用報告や方針メモは実装依頼へ昇格しない。
- 容量・監査計測の修復を前提に、Telegram依頼を通常監査・ISMCTSより優先する。1 runに1件、未着手は受付順、未解決の再試行は未着手の後へ回し、1件の失敗で後続を塞がない。稼働中run・lock・手動停止は維持する。
- promptは選択依頼の要件を先頭6000文字と原本パスで渡す。workerは原本を必ず全文読む。運用報告は直近4件・各800文字のみ。全件は `summary --repo <hub>` で確認でき、保存記録は削除しない。
- workerの `thread.started` で `logs/codex-supervisor-followups/activity/<id>.json` と `runs/<run-id>/<id>.json` に実行ID・thread ID・開始時刻を記録する。これは選択した依頼をworkerへ渡して起動した証跡であり、修正完了ではない。クラッシュ時はrun状態と照合する。
- 終了コード0でも自動で依頼を解決しない。統合要求中・未解決はpendingのまま再選択し、workerはmain反映済みcommitと関連回帰を確認して `resolve` する。選択依頼のIDと結果を最終報告へ含める。
- 着手時に現行main・関連回帰・後続依頼と照合し、古い診断をそのまま再実装しない。対応済みはcommitと回帰、重複は未解決要件をすべて保持する後続依頼IDを根拠に閉じる。部分対応・単なる古さ・通知済みだけでは閉じない。
- 受付結果の `supervisorRequest` に起動要求の成否・稼働中によるスキップ・時刻を保存する。キュー保存成功と起動要求成功を区別する。
- 保護されたprimaryでのナレッジ操作はknowledge入口の例外に従い、taskなしの `search` / `show` を使う。補助記録の保護を依頼拒否と表示せず、保護設定自体は変更しない。

## 進捗と完了

- 起動時に進捗メッセージを作り、15秒ごとに同じIDを編集する。終了時は同じメッセージを完了本文へ更新する。
- worker本体と子プロセスのcompleted報告は、runごとの `worker-notifications/<uuid>.json` の配信receiptを共有する。
- relayはlive完了の送達済みを確認したoutboxを送信せずsentへ移す。完了本文・未解決follow-upは保存する。
- 受付は確定結果より先に完了outboxと配信receiptを保存する。runner停止後もrelayが同じIDを更新し、モデルを再実行しない。
- 一時的な編集失敗では別メッセージを増やさず同じIDへ再試行する。削除済みIDだけ代替を作る。
  live無効・初回送信失敗時も最終通知は一度だけ送る。
- ruling/errorなど別の対応が必要な報告は引き続き通知する。

## 障害と制御

- 広範・破壊的instructionは受付workerへ渡さず隔離する。除外先ラベル `removed from game` だけを
  破壊語の走査対象から除き、`DeleteFile` / `RemoveAll` など複合名の従来の検査も維持する。
  日本語の広範指示と `rm` / `del` / `erase` / `format` の組合せも遮断する。
  ゲーム文言によるメッセージ全体の許可は行わず、同じ本文に混在する削除指示も検査する。
- 結果JSONの不備・実行失敗はpendingを保持し、1分以上あけて最大3回まで試行する。
  `/retry <inbox-id>` または `telegram-inbox.mjs retry --id <id>` で試行数をリセットできる。
- `/new` / `/cancel` で消した受付が後から完了しても新しい引継ぎを作らない。
  supervisor本体やengineのlock・プロセスは操作しない。
- `ORICA_TELEGRAM_AUTORUN=0` は自動受付を抑止する。
- 状態: `reception-<id>.json`、試行: `reception-attempts/`、確定結果: `reception-results/`。
  結果はpreparedとして先に保存し、確定結果を保存してからpendingを消費する。
  再試行は共通follow-upの一度限りの投入を使い、解決済みの同じ引継ぎを再投入しない。
  確定と `/cancel` / `/new` の保存区間は `mutation.lock.json` で直列化する。
  先に確定した受付は取消対象から外れ、取消が先なら引継ぎを作らない。
- 受付先: `logs/codex-telegram-inbox/`。実装引継ぎ先: `logs/codex-supervisor-followups/pending/`。

## 旧Claude連携の参照と検証

`C:/Users/kensh/Claude-Code-Remote/telegram-polling.js` の `startTask` /
`handleTaskComplete`（調査時343〜570行）を確認した。
非同期CLI起動、受付通知の再利用、15秒ごとのedit、同じメッセージでの完了表示を継承する。
getUpdatesの受信者は `orica-telegram-inbox` の1つだけにする。
旧 `telegram-polling.js` との同時起動は409競合を起こすため、旧プロセスを再開しない。

`pnpm test:telegram-reception` は実Telegram・実LLMに接続しないfixtureで、
フルランと独立した受付、並行起動時の一意処理、追加返信の文脈、確実な引継ぎ、
キャンセル、再試行上限、重複完了と編集失敗時のfallback、定型受付の起動モデル・再試行時の固定・引継ぎ禁止を検証する。
`node scripts/test-auxiliary-model-policy.mjs` は分類境界・既存受付の移行・記録異常・最小資料を検証する。
