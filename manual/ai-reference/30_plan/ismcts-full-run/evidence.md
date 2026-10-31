# 受入条件・検証証跡

## 完了判定の入力

I0で `scripts/ismcts-program.mjs` を実装。CLIは `plan / record / verify / status`。
planは読取専用JSONでschemaVersion=1/action/skipWorker(bool)/workerFocus/nextTask/evidenceStateを返す。
actionはismcts-implementation-required/ismcts-monitor/ismcts-waitの3値。
nextTaskはI0〜I7またはmaintenance、evidenceStateはunverified/valid/invalid。implementationはskipWorker=false。
monitorはnextTask=maintenanceかつevidenceState=validが必須。waitはskipWorker=trueで、
waitReason=deferred_load/deferred_budget/awaiting_approvalを必須にする。monitor中の異常はskipWorker=false。
当初のmonitorは正常でも120分ごとのLLM成果確認を行うためskipWorker=false。
正常tickでtrueにできるのは、I7の自律運用証跡と機械的な停滞検出が有効な段階だけ。
skipWorkerはLLM起動だけを制御し、自律学習runnerの起動・停止・待機を兼用しない。
planの異常終了・parse失敗・必須欠落はcontroller修復。waitは予算/負荷/承認待ちを区別する。
監視に入る判定とscheduler変更は親側に置く。workerは完了JSONの手編集でphaseを変えない。

各タスクreceiptは機械生成し、次を必須にする:

- schemaVersion/taskId/acceptanceId、基点commit、検証対象treeとscope fingerprint。
- 必須gate名、正確なargv、実開始/終了時刻、exit code、stdout/stderrの保存pathとSHA256。
- 仕様・コード・テスト・fixture・外部入力・依存lock・runtime・設定・deck・modelのhash。
- 容量受付は既存artifact-storage source/policyと実保存量helperのJS/PS1もscopeに結合する。
- source入力は実行checkoutの生byte SHA256とGitの属性適用後blob IDを併記する。
  `.gitattributes`もscopeへ含め、最終化はverified commitのblob IDへ結合する。
  CRLF/LFを一律に同一視せず、生byte変更は失効させる。ログ・verifier・ticketは生byte hashを維持する。
- attempted/completed/failed/deferred件数、seed、席、truncated/capped/error、資源・時間の実測。
- 独立verifierのcontext/report/result hash、verified commit、親integration IDと完了結果。
- 稼働証跡にはdeployment artifact hash、接続先識別、配備版、health/GUI/負荷試験の時刻。

shared rootは `logs/ismcts-program/`。重いreplayは `artifacts/ismcts/`、相対pathとhashで参照する。
ファイル不存在・hash不一致・未来時刻・異常終了・partial・必要なテスト0件は成功にしない。
raw logとreplayは未解決中保護。解決後の圧縮・保管も既存artifact-storage規則を使う。
インデックスには有効/失効/未検証と理由を残し、ログを消して失敗履歴を隠さない。

## 自己参照・再利用

code treeの検証結果を得た後、同じtreeにreceiptを書いてhashを合わせる無限循環を作らない。
receiptは生成物領域へ置き、commit treeから対象scopeを照合する。verifierは従来どおり完全treeを照合。
タスクの対象コード・テスト・入力が変われば対応receiptを失効。依存解決不能は再検証。
後発の同条件失敗は先行成功を無効化。commitが違うだけで無関係な全試験を繰り返さない。
既存gate再利用はharness-validationの条件のまま。同一root・source・依存・環境・比較範囲を照合し、
別worktreeへreceiptをコピーして緑にしない。finish/full/CIのfresh実行規則は変更しない。
main/remote統合は実commitの祖先関係と親runner成功で証明し、要求受理だけでは完了にしない。
live healthの有効期間は5分、負荷/GUI配備確認は24時間。コード回帰receiptに一律の時間失効を付けない。
監視は固定release manifestの版を照合し、古いdeployment成功だけで現在の稼働を判断しない。

## 必須反証

| ID | 完走させる反証と合格条件 |
|---|---|
| H1 | 同一観測・異なる実秘密状態・同seedで要求/探索統計/応答が一致。秘密IDのrenamingも含む |
| H2 | 既知deck位置・追跡hand・shuffle失効・裏向き・生成カード・両面同一性をsampleが守る |
| H3 | pool外相手と全候補消滅。未知priorまたは説明可能エラー。真deck参照0 |
| T1 | 小さな手計算可能gameで選択・availability・observer別value符号・相手非公開choiceの集約を確認 |
| T2 | 支払い/配分/対象/順序/マリガン/advance/manual coreの全種類をtraceしengineへ適用する |
| T3 | 試行間で合法手集合が変わる。非合法edge選択0、choice削除による見かけの成功0 |
| S1 | timeout/cancel/queue満杯/切断/二重送信/旧revision/版不一致/過大body/未認証を実routeで検査 |
| S2 | 現行/旧モデルと探索serviceを故障させ、独立した簡易AIで全入力・自然終局。遅着/二重適用0、認証迂回0 |
| R1 | CPU/RAM/GPU閾値、計測欠落、日次境界、再起動、孤児子、負荷再開を検査 |
| E1 | stale/tampered/missing/partial/exit非0/0tests/他root/後続失敗のreceiptを拒否 |
| O1 | worker終了だけでは監視へ移らない。未統合・配備版違い・監視設定失敗から安全に再開 |
| L1 | LLM不通でも生成・実学習・評価が進む。負荷/日次/中断後に再開し、待機を更新成功へ数えない |
| L2 | 候補凍結・自動棄却/昇格・配備失敗復帰・版固定。候補差替え、部分評価、改変/古い証跡で昇格しない |

追加acceptance: I4=`solo-fallback`(S2)、I5=`deployment`にS2実機を含める、
I6=`training-loop`(L1)/`model-lifecycle`(L2)、I7=`autonomy-soak`(L1の72時間実機)。
I6の既存`nn-resume`/`nn-evaluation`、I7の`O1`/`monitor-live`も維持する。
実装時にcontrollerの必須集合・harness gate・schema移行・未達拒否をまとめて追加する。
旧集合だけのreceiptで新要件を完了扱いにしない。現段階の文書変更は実装証明ではない。

mock projector同士の一致だけではH1を通さない。実engineで秘密だけ変えたfixtureを使い、
canaryとして意図的漏洩・stale receipt・未配線serviceを検出するテストを置く。
`ai-search-deck-sampler.test.ts`の初期配札→sanitize→観測→部分sampleは、秘密の素性/順序/IDの
非干渉・既知位置・viewer別失効・未知prior・制約矛盾を検査する。完全request・root候補・tree統計・
応答・仮想GameStateの再projectは通さないため、I1のH1-H3 receiptの代用にはしない。
verifierには仕様、完全diff、実ログ、反証fixtureを渡す。実装者の要約だけでvouchさせない。
既存のカード中心lensに加え、情報境界・統計・deadline・証跡失効・配備/監視遷移を確認させる。

## 処理別実測と報告

[共通telemetry](i0-work-telemetry.md)の単位・clock・観測有無を保存し、CPU率や設定値だけで性能を認定しない。
設計済み/実装済み/稼働確認済み/実更新あり/強さ改善確認済みを分け、各判断に
`original_text`（正確な抜粋）、`source`（commit・file:lineまたは実行ログ）、`note`（事実/推論/未確認）を添える。

## 固定評価

### 候補順序と旧checkpoint

候補の配列indexは共通encoderから除去し、live推論とreplayの同じ意味の候補を並べ替えて
特徴・logit・確率・mask・教師indexを照合する。学習後/復元後も同じ対応を検査し、旧位置特徴の
checkpoint/encoded batchは拒否する。
`TinyPolicyValueNetwork`は既存source/target pointerで観測内の個別card tokenを取り出し、
別々の`sourceW`/`targetW`でchoice embeddingへ加算する。平坦choice特徴と平均state poolが
同一でも参照先の公開コア/BP等を区別し、live/replay評価/head学習で同じembeddingを使う。
欠落配列・不正index・masked token・非有限特徴を拒否し、ID文字列や生stateをモデルへ渡さない。
checkpoint schema 2は両role行列を保存し、schema 1を明示拒否する。旧観測schemaのadapterは
両role行列にも同じcard feature幅を要求する。新しい重みを旧checkpointへ自動補完しない。
これは既存pointer消失の修復であり、applyOptionsの対象・支払い元・配分、parent actionや
複数対象のbinding、同じ公開特徴を持つカードの個体区別、学習可能なカードembeddingは残る。
平均後変換はカード組合せの差を失い、単一ID比率はカテゴリへ根拠のない順序と距離を導入する。
今回のrole別個別特徴は参照先差を保持する最小の接続で、state poolとID比率は比較baselineとして
維持する。カテゴリembedding・カード単位の非線形poolとの比較とbody学習を後続I3/I6aで行う。
この部分の回帰をchoice意味表現全体や本番ISMCTSの完成としない。

2026-10-30の受付再確認では、host 16点が開始条件を満たしても共有旧予約により固定smokeは
`owned_job_or_unreconciled_orphan`で生成前拒否。既存予約/全会計を保全し、I0を最初の未完了に維持する。
今回の受入単位は既存source/target pointer→個別公開token→NN scoreのlive/replay/head学習経路。
親条件は観測限定探索・全入力表現・body学習/再開・探索接続・自律運用/固定評価までで、依頼全体はpending。
回帰は[証跡](evidence.md#候補順序と旧checkpoint)の同一flat特徴4候補を使い、全体会計阻害中のbounded修復とする。
配備・自然終局・実運用更新・強さ改善の受入には換算しない。次の実験はapplyOptionsの
対象/支払い元/コア数のbindingと配分差の保持。I0の全writer会計/安全回収を並行正源のまま残す。

`training-policy-token-bindings.test.ts`は同じカード定義の公開コア数だけ異なるsource/targetと、
同一flat特徴の4候補を使う。role重みだけを有効にしてlogit差、候補/カードtoken順置換、
実replay encoderとの一致、正確なhead gradient、学習後/復元後のscore/probability対応を反証する。
秘密手札の素性/ID差、可視IDのrenaming、masked/不正参照、非有限値、schema 1の安全拒否も検査する。
これは既存source/target pointerのNN接続で、支払い/対象/配分のapplyOptions・embedding改善・body学習は残る。
I0の未回収予約で実smokeが生成前拒否された間のbounded修復で、I0/I3/I6aを完了にしない。
次はapplyOptionsの対象/支払い元/コア数を同じrole別表現へ結び、配分だけが異なる候補の区別と順序非干渉を同時に反証する。

今回の統合前提でhandoff gateがWindows process censusの文字コード不一致を検出した。
`readWindowsProcesses`のPowerShell出力をUTF-8へ固定し、decode失敗はcommand lineを引用しない。
health回帰は日本語・ギリシャ文字・非BMP文字を引数に持つ私有子の完全な読戻しを実OSで検査する。
旧実装でJSON decode失敗を再現してから修復し、この前提復旧をI0の親受入へ換算しない。
NN参照配列は穴あき要素も拒否する。配列長だけを見て欠落を暗黙の参照なしへ変換しない。
前runのNN回帰は共有lease待機30分後の再試行で旧owner終了を検出し、コード75で未実行だった。
2026-10-30の再開ではcheckpointの9ファイル・退避manifestの全hash一致と、旧lease不在を確認した。
workerはleaseを回収せず、正規入口が取得した共有枠で関連3ファイル17テストの成功を確認した。
旧失敗・中断と旧receiptは保持し、単体成功を最終gate・独立査読・親統合へ昇格しない。
最終化は同じ受入単位の全28gate→新しい独立査読→verified commit→fuzz省略なしの親統合とする。
具体的な最終tree・run・査読・commit・統合結果は既存harness/verifier/親ticketへ結合し、
この文書や要求受理だけで親I0・受付全体・公開main採用を完了にしない。

### 固定対戦の条件

I0で既存deck selectionから8デッキを選ぶ。tier1/2を優先、色/速攻/制御/複雑入力が偏らないよう
selection理由と内容hashを凍結。ファイル欠落時は保存デッキの正規入力から再構成し検証する。
対面表・seed一覧・先後交替を固定し、学習用seedと評価seedを分離する。

- smoke: 席交替16戦。hard failure0、全失敗を保存。終局率不足は次段階へ進む前に診断。
- release: 200組/400戦、同一deck pair/seedの席交換。max12000 decision、1戦wall10分、partial再開可能。
- 自然終局率95%以上、stuck/error/違法適用0、truncatedな戦略選択0。
  不足・中断試行も分母から消さず、予算待ちは未完了として追加日へ継続。
- 同じ思考予算の観測限定heuristicに対し、自然終局での勝ち+0.5引分の比率55%以上、
  paired bootstrap95% CI下限50%超。先後/対面別件数と未終局も併記。
- 応答p95 3秒以内、hard deadline超過0、fallback率5%以下を固定60局面×3seedで確認。
  CPU資源制御と同時の試験を含める。低負荷profileとの比較を残す。
- NN昇格: 旧championと200組、同条件で勝率55%以上・CI下限50%超、正しさ/終局/速度も維持。
  不合格なら現championを維持して改善タスクへ戻し、全NN採用を完了の前提にしない。

自動昇格は[継続学習の評価policy](continuous-learning.md)を追加で満たす。過去モデル/基準AIへの
退行、反復評価、学習/評価データ分離を機械検査する。簡易AIへ退避した試行は元モデルの勝率へ
混ぜず、失敗・fallback件数として全試行の分母に残す。故障注入S2は通常性能評価と分離する。
重み更新の証跡はcodeのverifier/commitと区別し、検証済み実行版・評価policy・候補hash・
全評価ログ・機械判定・配備transactionを結合する。通常の各モデル昇格にLLM署名は要求しない。

閾値はこの計画の受入基準。試行数を下げたり成功seedだけを選んだりして合格にしない。
学習実装・resumeの検証は必要だが、改善しないモデルを本番採用する必要はない。
ユーザーが遊べる第1版の配備と、第2段階を含むprogram完了を別々に報告する。
