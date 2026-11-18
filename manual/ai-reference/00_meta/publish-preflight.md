# 公開前の事前検査と所要時間の計測

公開（auto-merge）は**初回起動から20分以内**を基準とする。超えた場合は中止して原因と改善案を示し、判断を得てから続ける。

## 事前検査

`node scripts/preflight-publish.mjs`（読み取りのみ）。失敗は公開前に直す。

| 検査 | 内容 | 過去の失敗 |
|---|---|---|
| shell | Git Bash（`MSYSTEM`）起動を拒否。PowerShellから起動する | `pc-api-build-storage`が落ち、全件をやり直した（46分） |
| tree | 作業ツリーがclean。stat情報だけの汚れは`git add`で更新 | `lane became dirty`で中止 |
| line endings | indexがLFでcheckoutがCRLFのファイルが無い | `format:check`が落ちた |
| base | HEADが`origin/main`を含む | 専用候補worktreeでrebaseした後、独立レビューをやり直した |
| selection | `run-gates --profile merge --plan`が通る | 未分類scriptで中止 |
| verifier evidence | 証跡が`main`基準でHEADを覆う | `archived context identity mismatch` |
| interrupted publication | `running`のまま生存プロセスが無いauto-merge記録（直近24時間、または同じブランチ）が無い | セッション終了でpushが中断し、約50分気づかなかった |
| unpublished main | ローカル`main`に`origin/main`へ未公開のcommitが無い | `main`が候補を取り込み済みで計画の差分が空になり、全29ゲートが選ばれた |
| verification lease | 共有の検証リースの所有プロセスが消えていない。消えていれば`node scripts/harness/recover-gate-lease.mjs --root <所有ルート>`で復旧する | 公開を`TaskStop`で止めたあと、次の公開が`exit 75`（Verification owner exited）になった |
| classification | 変更に未分類パス、または分類の無い新規検証が無い（[分類](./gate-classification-queue.md)） | `server/`変更が未分類で全件（約3335秒） |
| estimate | 選択ゲートの過去中央値＋固定の余白で所要を見積もる | 20分超過の事後発覚 |

見積りは実測が無いゲートを含むと下限値になり、表示は`at least`になる。

## 独立レビュー

[remote main統合](remote-main-integration.md) に従って専用候補を最新の `origin/main` に合わせてから、`spawn-verifier --base main`を1回行う。公開は`coverage.unverified`が空であることを要求する。読み取り専用で確認できない項目（テスト実行、公式原文のWeb再取得）は`items`に残余として明記する。

## 計測

- ゲート別時間: 実行ごとに`logs/harness/timing/<開始時刻>-<pid>.json`へ保存する（一時worktreeが消えても残る）。`reused`の実行は集計に含めない。
- 2回の公開の実測（秒）: vitest 601〜611、fuzz 241〜250（分割前）、その他ゲート46〜377、残り約160。
- 2739秒の初回通し（`vitest.config.ts`の変更が未分類で全ゲートになった）: handoff 775、vitest 647、ismcts-program 312、ismcts-runtime 253、harness 214、fidelity 147。

## 実測記録: 20分超過の許容公開（2026-11-01, N13載せ替え `c07f267aa`）

ユーザーが「一度だけ超過を許容し、情報を記録して改善へつなげる」と判断した公開。見積1228秒（`node scripts/preflight-publish.mjs`の出力。機械記録ファイルには残らない）に対し、壁時計は約1225秒（auto-merge run JSON `logs/auto-merge-runs/47da8bab530b47d88f5f4b682b998a37.json` の startedAt 18:27:57.3 → finishedAt 18:48:22.6、phase published）。見積値と実測の差は3秒（約-0.2%）。ただし見積は`effect-debug`が履歴なし（unknown）で「at least」の下限値だったため、約23秒を含まない。固定のオーバーヘッド・fuzz定数と履歴中央値の合算なので、この一致を見積精度の根拠にはしない。

- 時間の内訳（秒、各機械記録から）: 起動→ゲート開始 約46、ゲート約971（timing JSON `logs/harness/timing/1793525323784-50232.json`、18:28:43〜18:44:54）、ゲート完了→fuzz開始 約12（うちleaseWait 11）、fuzz 約138（`logs/fuzz-runs/1793526294571-*.json`、startedAt 18:45:05.8→finishedAt 18:47:24.05、status passed）、fuzz完了→published 約58（binding 18:47:33、push-input 18:47:37、advertisement 18:48:05、published 18:48:22.6）。合計約1225。
- ゲート別（timing JSON、秒、丸め。合計は約963）: vitest 612、harness 261、effect-debug 23（初回計測）、verifier 23、types 12、ismcts-catalog 11、fuzz-runner 9、audit-operations 3、changed-style 2、docs 2、put-semantics 2。
- 20分超過の主因は、全件vitest（612）、`harness`（261）、fuzz（約138）の3つ。

### 選択元の確定（計測。コミット `c07f267aa` の差分を base `86c002f67` に対して `semanticScope`＋`selectGates` へ渡して再現）

- 素朴な`selectGates(merge, 実ファイル8件)`は29ゲート、`semanticScope`の上書きを渡すと実行時と同じ11ゲートになる。差は意味的絞り込み: `action-input-choices.ts`→types/vitest/put-semantics/ismcts-catalog、テスト3件→`focused-vitest`、`gate-manifest.json`→`harness-selection`/verifier/audit-operations（`selectorManifestOnlyChange`）。
- 1ファイルずつ渡した結果: **vitestを選んだのは`packages/rules-core/src/action-input-choices.ts`だけ**（fuzzも同じ`rules-core/src`で必須）。**`harness`を選んだのは`scripts/fuzz-seed-ledger.mjs`だけ**（同コミットで追加した規則`harness,fuzz-runner,effect-debug`）。`gate-manifest.json`単独は`harness`でなく既存の専用ゲート`harness-selection`（`test-harness.mjs --selection-only`、実測10〜14秒）を選ぶ。`harness`が選ばれると`harness-selection`は重複として外れるため、公開ではharnessだけが走った。前節の「manifest編集だけでも`harness`が選ばれる」は`semanticScope`を通さない素朴再現の結果で、実行時には当たらない（訂正）。
- `rules-core/test`の変更は既に`focused-vitest`（新規追加、既存テストへの追記・コメントのみの変更、いずれも計画で確認）。`rules-core/src`はコメントのみなら`types`だけ、実変更なら全件vitest。

### `test:harness`の内訳と261秒との差（計測）

- 静かな環境で単独197〜208秒（`node scripts/test-harness.mjs` 195秒、`pnpm run test:harness` 201秒、`run-gates --profile finish`内のharnessゲート200秒。リース待ち39秒は別）。内訳（行頭の経過秒から）: 先頭の選択検査 約10秒（`--selection-only`と同じ）、`testGateReuse`＋`testDocLinks` 約144秒（`runGates`を使う約50の固定ケース、各0.3〜2.5秒）、`testUnitEntry` 約32秒、`testGateQueue` 約9秒、`test-local-game-gates.mjs` 1秒。
- 公開時のゲート実測は259/261/263/273秒（成功したmerge実行のtiming JSON 4件。失敗した別の1件は297秒で除外）。今回の公開（`1745f1d5d`）も267秒で、warm済みの同じworktreeでも縮まなかった。
- **原因（確度B。対照実験、各1〜4回でばらつき大）**: 起動シェルの違い。`test:harness`をBash起動すると201/211秒、PowerShell起動だと276/286/329/329秒。PowerShellの`git`はGit for Windowsの起動ラッパー`cmd/git.exe`（実体`mingw64/bin/git.exe`をさらに起動する）に解決され、Bashは実体を直接使う。PowerShellで`mingw64/bin`をPATHの先頭に足すと225/232秒に戻る。出力の扱い（ファイルへ/`ForEach-Object { Write-Host }`経由）は主因でない（ファイルへでも286秒）。残る20〜30秒は未説明。
- **対策**: `run-gates.mjs`の`gateEnvironment`が`preferNativeGit`でゲート子プロセスのPATH先頭へ実体のgitを置く（同じGit installの別exeを起動するだけで、検査内容は変えない）。`run-gates`経由（PowerShell起動）のharnessゲートは250/227秒（同時期の対照329秒）。単位テストと3変異（先頭でなく末尾に置く、親ディレクトリ誤り、既に先頭のとき重複して置く）の反証は`test-harness.mjs --selection-only`が検出。公開（`99ad7ae48`、初回起動から356秒。auto-merge run JSON c970535d… の startedAt→finishedAt）では`harness`が225秒（従来259〜273秒。`logs/harness/timing/1793533875389-45756.json`。1回の実測）。

### `fuzz-seed-ledger.mjs`に`harness`は不要（反証つき）

- 台帳をわざと構文エラーにして実行: `test-fuzz-runner.mjs`と`test:effect-debug-loop`は即失敗（0秒）。**全`test:harness`は208秒かけて成功**、`--selection-only`も成功。つまり`harness`は台帳の実行を一切検査せず、台帳が関与する検査は`requiresMergeFuzz`の選択検査（`--selection-only`に含まれる）だけ。
- 実施した改善: 規則を`harness-selection,fuzz-runner,effect-debug`へ変更し、`test-harness.mjs`に`selectGates(finish/push, 台帳)`の厳密一致を追加。反証: 規則を`harness`へ戻す、`effect-debug`/`fuzz-runner`/`harness-selection`のいずれかを抜く、の4変異はすべて`--selection-only`が失敗。台帳変更だけの公開から約250秒を除く（見込み。公開実測は未取得）。

### 見送り: `rules-core/src`のvitestをimport依存閉包で絞る（計測で否定）

- 1245テストファイルのうち1057（84.9%）が`action-input-choices.ts`をimport閉包に含む（`@orica/rules-core`のbarrel経由を含む。TypeScript ASTでimport/export/動的import（文字列リテラル）/require/`vi.mock`を解決した近似。非リテラルの動的importは閉包外として数えず別集計）。閉包外188のうち157は閉包内で`readFileSync`/`readdirSync`/`spawn`等を使い、閉包外だと断定できない。安全に除外できるのは31ファイル（apps 24、ai 6、rules-core 1）で、実行すると4秒（全件612秒の1%未満）。節約が小さく、取りこぼしリスク（fs経由の参照）に見合わないため分類は変えない。

改善候補（残り）:

1. 残る約25秒（225秒対単独200秒）の原因と、`vitest`・`fuzz`も同じラッパー経由のgit呼び出しで遅くなっていないかを調べる。`testGateReuse`の約50ケース（約144秒）のケース別計測が次の手。
2. 計測の欠けたゲート（今回の`effect-debug`など）は見積に加算されず（unknown扱い）、見積は下限値になる。unknownが出たら下限値として扱うか、新ゲート登録時にtimingを先に採取する運用を検討する。

## 実測記録: 全件ゲートの公開（2026-11-01, `fc0e5b9e5`、`apps/playground-web/server/`変更）

見積は「少なくとも1238秒」（計測の無い20ゲートを含まない下限値）で、利用者が一度だけ超過を許容して公開した。実測は**約3335秒**（run JSON 13:05:57.973→14:01:32.465 UTC。timing JSONはゲート2984秒・リース待ち54秒。残り約350秒は起動、fuzz、push）。見積の約2.7倍で、許容の前提（約21分）を大きく超えた。

- ゲート別（timing JSON `1793538414062-23040.json`、秒）: handoff 740、vitest 645、ismcts-program 425、harness 266、ismcts-runtime 250、fidelity 138、format 78、auto-merge-integration 71、lint 54、effect-debug 54、ledger 44、types 39、telegram 34、supervisor-runner-lock 31、storage 24、local-game-ui 23、verifier 20、他は10秒未満。
- 全件になった原因: `server/`配下は`room-retention.ts`のような既存ファイルでも未分類で、全件ゲートに倒れる（`selectGates("merge", …)`で確認。`room-retention.ts`単独は29、`game-api.ts`を含むと`local-game-ui`が加わり30）。
- 見積が外れた原因: 見積はゲート別の過去中央値で、上位5ゲート（handoff・ismcts-program・ismcts-runtime・fidelity・auto-merge-integration）に履歴が無く、加算されず（unknown扱い）、下限値になっていた。この実行で履歴が採取されたため、次回の見積には入る。
- harnessは266秒で、PATH修正後の前回（225秒）より長い。静かな環境の単独は約200秒。1回ずつの実測で、公開時のばらつきは±40秒程度あり、PATH修正の公開経路での効果は**確認できていない**（確度C）。

改善案（検知力を下げない条件つき。記録時点は全て未実施。現況: 1・2は実施済み、3・4は未実施で P2-16 の残タスク）:

1. **見積の履歴が無いゲートを0秒で足さない**（確度A、コード修正で対処可能）。履歴の無いゲートは、直近の全件実行の実測を既定値にするか、見積を「不明」とし超過判断を明示させる。今回は見積の誤差が許容判断を誤らせた。
2. **`apps/playground-web/server/**`に狭い分類を足す**（最大の効果。約2000秒の削減見込み）。**実施済み（2026-11-02）**: 15モジュールを完全一致で絞った。根拠・規則・反証テストは [server 15モジュールの絞り込み実測](gate-classification-server.md)。静的なimport閉包では、handoff・ismcts-program・ismcts-runtime・fidelity・harness・auto-merge-integration・effect-debug・ledger・storage・telegram・supervisor-runner-lockの11ゲートは`server/`を1件もimportしない（記録時点）。
3. **handoff（740秒）のケース別計測**。全件で最長だが、セクション別の所要は未計測。`test-harness.mjs`と同じ手順（行頭の経過秒）で計測する。
4. **vitest（645秒）**: 前節のとおり、import閉包での絞り込みは節約が小さく見送り済み。

## fuzz分割

`pnpm fuzz`は既定で2 workerに分割する（`scripts/harness/vitest-pool.mjs`の`COMPUTE_WORKERS`）。同じseed列を`index % 2`で分け、各shardが自分の要約行を出す。runnerは終了コード0だけでなく、各shardの局数・自然終局数・capped/stuck/errorを検査する。要約が無いshardは失敗とする。`FUZZ_SHARDS=1`で単一プロセスに戻せる。実測は262秒→149秒（同一seed、200局とも自然終局）。

## vitestのモジュール読込（100ファイルのCPUプロファイル）

テスト本体は6.5秒、importに55秒。非idle時間のうち、`vite-node`の`toFilePath`の`existsSync`が約16%、ファイル探索系の合計が約25%、`vm.Script`のコンパイルが約15%、モジュール評価が約14%。GC設定（`--max-semi-space-size`）は効果なし。worker数は1→2でほぼ線形（79秒→42秒）。安全に減らせる手段は見つかっていない（`vite-node`のパッチやid形式の変更はモジュール同一性を崩すおそれがあり採用しない）。

## 運用ルール

- 事前検査は**公開対象の作業ツリー**で、そのツリーの`scripts/preflight-publish.mjs`を実行する（別ツリーのscriptを呼ぶと、tree・証跡・見積もりが別ツリーの結果になる）。失敗が残るときは公開しない。
- auto-mergeはPowerShellから起動する。初回起動から20分（1200秒）を超えたら中止し、原因と改善案を示して判断を得る。見積りが予算超過のときも公開前に議論する。
- 長い実行は、開始時にpidと開始時刻を記録する。セッションを再開したら、最初に`logs/auto-merge-runs`の`running`記録とプロセスの生死、ローカル`main`の先行を確認する。「完了通知が来たら報告する」は、プロセスが消えた場合に成立しないので約束にしない。
- 中断した記録は、`auto-merge-status.mjs record`で`failed`（原因つき）に閉じる。終わったバックグラウンドタスクとサブエージェントは止める。
- 公開を途中で止める（`TaskStop`など）と、検証リースと`main`ツリーへの取り込みが残る。次の公開の前に、リースは`recover-gate-lease.mjs`、`main`ツリーは`origin/main`への巻き戻し（候補ブランチに保全してから、利用者の許可を得る）で整える。事前検査が両方を検出する。
- gateが落ちたら、再実行だけで通さない。`main`と候補を同じ時間帯に交互実行して頻度を比べ、候補固有か既存の不安定さかを切り分ける。再試行（retries）の追加で検知力を下げない。
- 破壊的操作（`main`のツリーの`reset --hard`など）が自動判定で拒否されたら回避せず、保全先（候補ブランチ）を示して利用者に判断を求める。権限ルールの追加は利用者が行う。
