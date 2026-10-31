# merge / 通常pushの費用対効果（2026-10-13）

正源は [CLAUDE.md](../../../CLAUDE.md)、実行契約は [検証運用](harness-validation.md)。
信頼度A: 保存されたharness JSON・出力・Git履歴を一次証拠に用いた。
対象は2026-10-11以降に開始した、登録中worktreeに残る128 run。削除済みログは含めない。
証拠と集計プログラムは `C:/Users/kensh/Documents/Codex/2026-10-13/task/` に保存。
`historical-harness-details.json`、`historical-harness-summary.json`、
`historical-scope-comparison.json` が元path・各run・集計条件を保持する。
以下の時間はwall timeの累計であり、CPU時間や2日間の占有率ではない。

## 観測

| 指標 | 保存ログの値 |
|---|---|
| run | passed 80 / failed 45 / runningのまま3 |
| lease待機 | 16.25時間、30分timeout 17件、終了済みowner 2件 |
| run実行時間 | 35.93時間（検査以外の管理時間を含む） |
| handoff | 実行52回 / 再利用14回、累計13.79時間、中央値796.8秒、最大2463.9秒、失敗4回 |
| ISMCTS | 実行48回 / 再利用14回、累計8.89時間、中央値669.8秒 |
| Vitest | 実行37回 / 再利用14回、累計4.36時間、中央値411.7秒 |

108 runで`startedAt - requestedAt - leaseWaitMs`も取得でき、準備時間は累計38.47分だった。
現行コードはlease取得後、run開始計時前にtree・入力fingerprintを作る。この時間は上表のrun時間に含まれない。
`historical-preparation-cost.json`に内訳を保存。lease占有はgate本体だけではなく、入力照合も含む。

同一root・fingerprintの成功runを時系列で照合した重複実行はledgerの13件のみ。
ledgerは比較先main依存で再利用を禁止しているため、この13件を無駄とは分類しない。
25/26 gateという表示だけでは再実行を意味しない。公開`882831620`では25 gateを再利用した。
中断run中の部分成功は再利用しないため、同じ入力の中断→やり直しは別に存在する。

失敗は待機/owner不在19、format/changed-style/docs/lint14、型2、handoff4、
Telegram2、Vitest2、ISMCTS終了異常1、format終了異常1。
handoffにはPowerShellの折返しで期待文字列を拾えないテスト不備、
worker回復経路のheartbeat契約不一致、PowerShell native gate pipeline検査の失敗、
親runnerの進行待ちassert失敗があった。すべてを安全ガード過剰とは扱わない。

## 最小変更

`test-verifier-gate.mjs` と `test-supervisor-environment.mjs` がscope未登録だった。
前者はverifier専用回帰、後者はhandoffに既に含まれる回帰であり、
テスト自体の修正にゲーム全件回帰を要求する理由はない。
前者をharness/verifier/dev契約、後者をhandoff/lock回帰へ登録する。
本番の`verifier-tree.mjs`は複数consumerを持つため今回登録せず、fullを維持する。

- verifier回帰単独のfinish/pushは25→4 gate。専用回帰・harness・dev契約を実行する。
- 直前作業の全25 gate実行13件に現在のscopeを適用すると、10件は8～12 gate、3件はfullのまま。
  省かれる旧gateの実測累計は134.72分。これは反実仮想の内訳比較であり、
  新しいchanged-style時間や競合を含む将来の短縮時間の保証ではない。
  通常公開のmerge全検証は残るため、公開までの総短縮時間にも読み替えない。
- 全検証の短い運用回帰を長いISMCTS/handoffより先に置く。gate集合は同じ。
  Telegram失敗2件では、旧順序で失敗前に34.11分・38.89分の長い回帰を消費していた。
  成功runの全計算量はこの並替えだけでは減らない。
- handoff内も、環境・fuzz lease・同期失敗等の回帰を先に、長い親runner/remote実Git回帰を最後に置く。
  逐次awaitを保持してheartbeat starvationを再導入せず、suiteを省略しない。
- 負の回帰で、未知ファイル・エンジン・依存・共有tree処理が混ざるとfullへ戻り、
  merge/full/CIの全gateが残ること、Telegram失敗後に長い3 suiteを開始しないことを検査する。
- 査読の完全patchを全ファイル文脈から周辺3行へ戻す。全変更・metadata・binaryを保持し、
  local Git設定による文脈拡大も抑える。関連実装・caller・原文は提示したrootと固定treeから確認する。
  大きな末尾registry・複数hunk・新規/削除・binaryを含むpatchの正逆適用tree一致と、末尾切断の拒否を回帰に加える。

先行runの固定tree `edcb76bbb`、53 fileでも実測した。
旧patchは3,853,921 bytes・95,050行、うち91,824行が無変更文脈だった。
新patchは181,053 bytes・4,154行（文脈834行）で、bytesは95.30%減。
隔離indexで正逆適用したtreeは元のbase/headと完全一致した。査読時間の95%短縮を示す測定ではない。
元patch・新patch・対象tree・hashと測定コードは `review-patch-evidence/`、
`review-patch-comparison.json`、`measure-review-patch.mjs` に保存した。

## 導入理由と現在の判断

| 条件 / 導入証拠 | 費用・現在のリスク | 分類・判断 |
|---|---|---|
| 共通gate・lease `131fbe644` (9/14) | 同一Gitの重い検証を直列化。30分より長いfull runが待機失敗を起こす | 重い検証の資源保護は機械強制を維持。今回scope漏れを直して占有時間を減らす |
| 厳密な再利用 `854369e24` (9/19)、`77da740bd` (9/29) | 同一内容のpushを再実行しない。root・入力・依存・環境・範囲の照合が必要 | 既に有効。root除外や成功receiptの他ツリー移植はしない |
| stale lease回収 `518341fa2` (9/24) | owner終了だけでは孫プロセスの終了を証明できない | census・token・経過・再読一致は維持。workerの一括kill/lock削除に委譲しない |
| Git hook環境分離 `127b07409` (9/28) | fixtureのgit init/configが本番Gitへ向く事故を防止 | 機械的に環境を除去。workerの注意だけでは代替不可 |
| 親runnerが統合を待つ `77da740bd` (9/29) | worker終了時のpush打切りと、認証待ちという誤報の実例 | 実終了コード・remote確認まで必須。PID生存を成功と解釈しない |
| handoff逐次import `c19cbcba9` (10/8) | 同期Git fixtureが別suiteの非同期heartbeatを飢餓状態にした | 回帰自体が再現対象。単純並列化しない。短いsuiteを先行させる |
| remote候補`e5a925fae`、writer保護`99cf6322c` (10/12)、公開`882831620` | 元lane/他履歴を保持、公開直前の査読失効・remote分岐を検出 | 機械的不変条件を維持。旧writer停止は現役リスクを正しく検出したもの |
| 独立査読`273a56890` (6/16)、強制`82522a4f1` (6/17)、全差分/lens強化`131fbe644` | 意味・接続・見落しを機械gateだけでは検出できない。修正後は新tree | 独立性と未確認時停止を維持。資料準備/指摘一括処理はworker手順 |
| 全ファイル文脈`e8fc694df` (9/27)、末尾保持`571d060c1` (同日) | 末尾が欠けるpatchへの暫定対策が、後の`trimEnd`修正後も残り、巨大な無変更文脈を生成 | 完全性は必須、全行展開は冗長。正逆tree一致・切断拒否を保ち周辺3行へ戻す |

9/29の実事故と検査は [障害記録](full-run-incident-2026-09-29.md)、
公開中のraceと負の実Git回帰は [remote統合](remote-main-integration.md) を参照。

## 比較して採らなかった案・残余リスク

| 案 | 利益 | 条件・今回の判断 |
|---|---|---|
| timeout延長のみ | timeout件数を減らせる | 実計算も占有も減らない。不採用 |
| 全検証のleaseをgateごとに解放 | 小runが割込める可能性 | 公平queueがなければ再取得競争、同じcheckoutの生成物競合も残る。既存ownerとの混在を検査せず変更しない |
| 軽い検査をlease外へ移す | 待機前に失敗を発見 | 同じcheckoutの並行run、待機中のtree変化、出力先を含む設計と負の検査が必要。今回の順序変更とは分ける |
| gate別依存fingerprint | 無関係な変更後も高価な回帰を再利用 | 動的import・Git参照・外部根拠の漏れが誤成功を生む。依存閉包を実証する別変更が必要 |
| 成功fuzz200の再利用 | 同じ候補の事前200件を公開証拠に使えれば約6分/run削減 | fuzzも共通lease内で実行するが、毎回新しい探索seed範囲を予約する。現行receiptに入力fingerprint・regression pool・環境の結合がなく、成功ログだけでは再利用できない |
| rebase後の旧査読流用 | main前進時の再査読を短縮 | 差分が同じでも周辺コード・競合解消・履歴が違う。安全な内容同一性の証明なしに省略しない |
| 巨大査読資料を単に切捨て | 入力が小さくなる | 変更行の切捨ては不採用。全変更を保持した適用可能patchと、固定treeへの追加読取りを採用 |

直前の最終候補では約1.38MBの査読入力があり、35 fileを確認している。
00:09の査読はGUIログの相対path誤解で未確認、00:18に絶対path/hash付き対応表を渡して完了した。
本当に未読のまま通すことと、資料の場所を正しく渡すことを区別する。
fuzzの旧成功→通常公開の再実行は改善余地だが、本変更で安全な再利用を実装したとは主張しない。
最終候補の事前fuzzはseedBase `17693562`・379.3秒、公開時は`17694759`で、
両方27固定回帰+173新規探索、200自然完走だった。同じ200入力の重複ではなく、
固定27件の重複と新しい173件の探索を分けて評価する必要がある。
追加173件の探索には発見範囲を増す効果があるが、同じ候補の公開に毎回400件を要求する根拠とは別である。
事前fuzzが別途必要でなければ、通常auto-mergeが実行する200件へまとめる。再現・追加探索の目的があるときだけ手動実行を加える。
本調査の公開でも事前200件を重ねず、auto-mergeの必須fuzzを通常どおり実行する。
GitHub CIは課金/利用上限でjob未開始という別の障害。設定変更やローカル必須gate削除は行わない。

## 代替workerへ委譲できる境界

workerは`--plan`、本書、固定base SHA、最終tree、gate JSON、完全diff、元ログの絶対path/hashを
引き継いで、同じroundの全指摘をまとめて直し、format後に1回のfinishと独立査読へ進める。
小さくなったpatchだけで意味を推測せず、提示されたGit rootとtreeで関連実装・callerを読む。
必要な文脈を取得できなければ未確認として止める。全変更file・hunkの確認と6 lensは省略しない。
今回のscope選択はworkerの能力を仮定せず機械判定し、未知範囲はfullへ戻す。
再起動後は稼働中/失敗runを成功扱いにせず、保存された完了証跡とtreeを再確認する。

| 分類 | workerに許すこと | 検出・復旧 |
|---|---|---|
| 機械的に強制 | normal hook、tree/fingerprint、6 lens、token、clean/祖先照合を通して実行 | 不一致で停止。元履歴と失敗候補を保持 |
| 判断に委譲 | 関連回帰による修正の一括化、資料分割・絶対path案内、必要時のfull拡大 | gate選択・未確認・査読・commit treeで過少検証を検出 |
| 事後検出/回復 | ログ集計、滞留分類、証拠を残した次runへの再試行 | owner不在を証明して既存回収手順。生存中の別作業は維持 |
| 冗長だった部分 | 登録漏れだけを理由とする専用回帰変更の全件昇格 | 2 pathを明示登録。混在・未知・merge/CI維持の負のテスト |

調査・変更準備は並行できた。最終検証と公開ではmain前進と共有leaseの競合を避けるため、
02:57 UTCから次回の定期起動だけを無効化し、進行中runを継続させた。元はRunning/Enabled=true。
公開完了または中断時に有効化し、元定義と実起動を確認する。並行primary作業は別branchで保持する。
公開・実動作・今回の一時ツリー削除は別々に証拠確認し、自然採用だけで清掃完了とはしない。
