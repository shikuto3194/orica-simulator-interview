# workerタスク

依存順I0→I1→I2→I3→I4→I5→I6→I7。完了は[evidence](evidence.md)で判定。
各タスクは小commitへ分割可。途中で対応表を更新しても親タスクを完了にしない。
有効なreceiptがある段階の再実装・無関係な全件gate反復を避ける。

## I0: 制御・証跡・資源予算（最初）

対象: scripts/ismcts-program.mjs、その回帰、CLI config/資源runner、harnessへの必要gate登録。
既存harness・supervisor統合・artifact-storageを再利用し、並行する別検証台帳を作らない。
controllerのplan/record/verify/status、receipt schema/失効、依存順、partial再開を実装。
資源profileをJSON正源にし、resources.mdの数値を機械照合。runtime計測・合計budget/lockを実装。
2026-10-06承認の24時間目標へ時間予算を移行し、旧ledgerを消さず版・使用量を保全する。
現在のJSONはbootstrap用。定常運用前に新profile・移行回帰・JST境界での連続再開を検証する。
固定8デッキとseed manifestを凍結し、平常負荷/短いsmokeを測定する。
完了: E1/R1、実機校正、controller破損時fail-closed、日次使用量の再起動持越し。
分割単位は [controller入口](i0-controller.md)。E1/R1-budgetの回帰と証跡の節目は
親I0の完了と区別し、R1-runtime/固定8デッキ/実機校正が欠ければI0を維持する。
最大阻害は実smoke予約の全体会計・安全回収と、同じ資源contractによる固定8実戦/探索校正。
次workerは開始時資源条件と未回収予約を実測し、合法な短いsmoke→停止/再開→使用量持越しまで通す受入単位を優先する。
追加計測はその実験で不足が判明した場合に限定する。E1/R1-budgetの再採取だけで終了せず、未達なら実測・反証・残条件・次の実験を本タスクへ引き継ぐ。
未回収の実smokeは旧controller基点のため受付CPUと保存後tailが欠落する。PID不在は完全会計の代用にならない。
公開入口前の基点をcontrollerへ通し、管理保存後のcaller cutoffまで比較する回帰を接続するが、予約の安全回収は未達を保持する。
次はcaller終了までを所有する外側runtime・全writer/metadata会計を通し、同じ固定入力で停止/再開と校正へ進む。
Job/guardian/helperの全寿命OS書込み転送を既存telemetryへ接続する。上書き/削除済みファイルと
終了済み子の実OS反証を必須とし、保持量・payload claimへ読み替えない。callerと受付/保存の別processは
未計測で、旧smoke予約の欠測復元・安全回収は未達。これを完了しない限り固定8実走へ進めない。
所有Jobの超過停止はnative timerへ接続するが、write前のbyte制限ではない。
最外caller・全writer/metadataの会計と完全guard、旧予約の安全回収は引き続き未達とする。
外側Jobへ受付callerを生成時から所属させる[実OS反証](i0-caller-accounting.md#外側jobによる受付callerの実os反証)は、
私有ledgerの受付/保存・別scan writer・cutoff後tail・caller終了・残留子の終了までを既存runtime gateで検査する。
本番接続・最外制御caller/実probe/service/metadataの会計・安全回収は未達。内側集計を外側Jobへ重複加算しない。
固定smoke入口は共有予約後の内側受付・実storage helper・保存/終了を外側Jobへ接続する。
私有OS回帰は同じ受付continuationで単一予約と期限/owner拒否を検査するが、共有旧予約の欠測/安全回収は残る。
最外制御callerの受付前後/最終保存・全writer/service/metadata強制を完成させてから実ゲーム校正を再開する。
既知のactive/日次予算拒否は容量helper・transaction書込みより前に返す。実予約時の排他内再判定と
旧予約保持を維持する。この拒否経路の改善は全caller寿命/全writer会計・安全回収の完成とは区別する。
受付 `followup-f95407b05e54aad988ae` の再確認・残条件は本タスク群へ統合する。
[処理別telemetry](i0-work-telemetry.md)の同一contractでコピー/候補/遷移/推論/学習/decision/simulation/gameを測る。
E1/R1-budgetはscope/後続失敗・verified commit・公開mainを再照合し、失効なら既存harnessから再採取する。
公開前gateのcheckpointは親の`integrating`状態と実行中ticket・clean HEAD・両lockを照合する。
worker終了後の状態差で未統合となった候補を先に公開し、この前提修復をI0受入へ換算しない。
統合gateのcontained-admissionはcaller終了とJob排出完了を別に観測する。通常系は全memberの排出、
孤児系は残存子のidentity/生存を確認してからfinishし、強制終了の有無・終端会計を照合する。
親独立査読の通常候補に残る秘密印字名依存と、disclosure対象変更候補のprovider伝搬漏れも
同じ未統合候補で修復する。公開名/除外のviewer一致、text_role/合体ブレイヴの色差と
対象変更後の継続解決まで照合し、全差分のgate・独立査読・親統合をやり直す。
GUIで再現した公開名選択後のTargetSpec再検証拒否も同じresolverへ接続する。
全件回帰で見つかった星霊衣のB面資格喪失も修復し、通常fieldの印字素性は戻さない。
独立査読のcore_move源/作用/配置先の公開名不一致と、追加巡disclosureのprovider欠落も修復する。
完走反証で見つかった基本巡/追加巡の反応ID再利用は、本文chainを保って既存step/巡から区別する。
候補だけでなく最終コア数、1/2step×追加0/1/2のredirect・誘発・最終BP・全待機解消まで再検証する。
統合前fuzzのseed1558798883は外側コスト離脱と応答バーストの相互待機を修復する。
明示的な依存と発揮後のworking tailを照合し、両席の保持/完走/非依存対照・同seed自然終局から
全gate・査読・親統合へ戻る。場入り後のcascade消失は二次症状で、全handlerの保持証明ではない。
自己対戦の除外割引後の支払いも
共通入力生成器へ渡し、リザーブ不足を合法な場/ソウルコアで完了する。コア移動後の残額も同じ生成器で払い、途中状態でなく召喚完了を確認する。修復の成功はI0受入と区別する。
校正未達ではI1以降のコード実装を進めてもよいが、大量実行は資源gate成立まで禁止。
共有旧予約は`owned_job_or_unreconciled_orphan`で固定smokeを生成前拒否する。開始資源の回復だけで
欠測会計を復元・予約を解放しない。この阻害中は下記I1の観測制約・部分sampleをbounded回帰で進める。

## I1: 観測からの探索入力と仮想世界

対象: rules-coreのai-observation/player-decision/state-sanitize関連と新search packet/sampler。
先にGameState全fieldの分類・公開履歴・正準ID contractを作り、SSOT gateで漏れを検知。
samplerは実stateを受け取らないAPI。既存deck/カードvalidatorを使い未知priorも実装する。
手札/山札の[部分sampler](design.md#手札山札の制約と部分sampler)は観測と公開仮説だけを受ける。
本人登録list＋viewer可視delta→現在母集団→既存samplerの合成入口をbounded回帰する。
本番の完全delta producer（移動/生成/消滅/素性変更のprovenance）は未接続。手動入力の合成成功を
完全履歴抽出へ拡張しない。次はこのproducerと下記pending/stack/usage、完全request・仮想GameState・
再project・root候補へ接続する。部分sampleだけでH1-H3を完了にしない。
sample→共通factoryの新規手札/山札実体は、bottom-index→top-first変換と実draw/枚数同期へ接続する。
根拠は`ai-search-deck-instances.test.ts`。既知位置audienceは共通投影→新規実体→両viewer再投影を
`ai-search-known-deck-instances.test.ts`で照合する。rootに見えない相手の私的知識は補完しない。
`materializeAiSearchDecksWithHandRefs`は観測内の手札参照を合成手札へ一対一で結び、
同名の別コピーの通常召喚・窓pass・維持コア配置まで両root席で反証する。参照はroot内だけで有効とし、
履歴の素性snapshotをlive手札へ結ばない。
field合成は公開物理値・元面・通常/異魔神の合体参照を保持し、両席の再投影・攻撃/ブロック・離脱を反証する。
裏向き・不完全/入れ子合体・下敷き・離脱待ちは拒否する。詳細と回帰は[設計](design.md)へ。
可視trash/void/除外の合成は同名別コピーを保持し、両席の再投影・回収/再使用と開発GUI/RESTを反証する。
秘密カード・処理中/公開中snapshot・不完全な関係は拒否する。実装と回帰は[設計](design.md)へ。
[player部分合成](i1-player-resources.md)は資源/魂状態/保護カウント/公開契約提示を保持する。
両席の支払い・召喚/維持配置・攻撃可否・カウント減少・提示色分岐と旧観測拒否を反証する。
公開セット使用も保持し、枠除去後の再セット拒否・免除消費・ターンresetを両席で照合する。
[公開の進行component](i1-turn-schedule.md)は連鎖追加ターンの禁止step/次席/skipから自然deck-outまで反証する。窓context/中断復帰・遅延開始は残る。
動的修飾・履歴・observer知識・pending/stack/他usageは残る。完全world/本番受入ではない。
H1は同一観測・異なる秘密state/ID・同seedのrequest/root候補/tree統計/response一致まで反証する。
H2/H3は制約不整合・未知archetype・pool外相手とpending/stack/usageを個別に検査する。
可視カードcomponentでは、裏向きfieldの秘密印字を伏せたまま公開付与値を保持する
[観測経路](../../20_design/16b_ai-search-cards.md)も必要。実登録・live追従・付与除去・秘密source遮断を
既存NN入力まで反証する。実global BP加算は共通filterを経て所有者/相手の観測・NN特徴へ届き、
公開全体耐性・cannot_includeも保持する。ローカルGUI/RESTでも公開BPと加算除去を確認する。
条件付き耐性のBP/Lv/物理シンボル数と、動的な公開対象数/BP総和を同じ経路で反証する。
公開付与名の条件・除外も保持し、既知の秘密印字名を実効field条件へ混入させない。
場のシンボル色集合も公開付与を含め、B面等の通常投影の明示定義を生stateの定義で置換しない。
全体シンボル付与の対象ロック・aspect限定免疫・bypassと、公開Lv表による相対最低/最高Lv条件も保持する。
実nativeの全体/snapshot双方でBP/シンボルの作用種別と、合法なtext providerを使う免疫・追加数制限を照合する。
自己対象も共通免疫判定を通し、`self`/`any`/`opponent`範囲と非一致aspectの対照を保持する。
この部分の成功を完全request/sampler/H1-H3の完了へ拡張しない。
通常のBP/symbol候補も作用種別を共有し、group/choice/on_stepと再開へ伝搬する。
部分免疫・provider・空撃ち/ことで・宣言済み対象の部分解決を実行経路で照合する。
条件付き耐性と全体BP/シンボルの再帰依存は、同一read内の除外CE集合と結果を共有する。
自己除外と他CE・順序を保持し、独立read/状態/lookup間へ結果を持ち越さない。
固定1〜8付与の参照回数・実時間・判定一致を反証し、探索全体の性能受入とは区別する。
source限定の対象lockも候補/native/作用で同じproviderを使い、合体ブレイヴのhostを維持する。
通常宣言→stack passと実印字耐性の回帰で対象指定/全体/bypassを区別する。
完了: H1-H3、公開state再project一致、pending/stack/usageの往復とengine不変条件。

## I2: 情報集合探索

対象: rules-coreの新ISMCTS module。既存training-mctsは完全情報比較用を維持。
原著の該当Algorithmを確認してdesign.mdへ短い対応表を追加してから実装。
MO木・正準edge・availability・actor観測・value符号・deadline/制限を実装。
完了: T1/T3、H1を探索統計まで拡大、固定seed再現、rootに合法な応答、共有木が実際に利用されること。

## I3: 全入力・再現CLI・固定評価

対象: training decision surfaceとのadapter、apps/cli、trace/replay schema。
legal_actionから従属入力を完了するまで同じ手予算を共有。途中のchoiceを省略しない。
choiceのsource/target/支払い/配分・順序と今回の受入単位/残条件は[証跡](evidence.md#候補順序と旧checkpoint)。
CLIにismcts agentと固定iteration/deadlineの別modeを追加し、raw stateを学習sampleへ保存しない。
完了: T2、16戦smoke、GUIで開けるreplay、席交換評価、capped/errorの分母とlabelが正しい。

## I4: AIサービスと一人バトル

対象: 既存PC API認証route、別worker探索サービス、GUI一人バトルadapter、e2e/scenario。
ローカルのservice tokenは環境に置く。鍵・tokenをGit/フロント/証跡へ出さない。
requestId/revision/hash/actor、rate/body/queue/deadline/cancel、同一要求の二重適用防止を実装。
完了: S1、GUI+REST双方向でpreGame→支払い/対象/配分→自然終局、旧応答破棄、切断再接続。
S2として[現行→旧正常モデル→簡易AI](solo-fallback.md)を実装・反証する。探索service全停止でも
簡易AIで全入力・自然終局へ到達し、遅着応答の二重適用と認証迂回を防ぐ。

## I5: 配備・第1版release

対象: deployのAI専用成果物、PC/Ubuntu Arm service、health/rollback/runbook。
VM利用条件はoracle-ai-deployment。未確認/確保不可なら承認済みPC profileで実機検証。
対戦APIの配置を変更しない。releaseは版固定・旧版保持・health成功後に切替。
完了: 採用環境のGUI/REST・負荷/再開確認、400戦release gate、配備hash一致、失敗時旧版復帰。
旧版も失敗したときの簡易AIを配備成果物へ含め、S2の実機証跡も必須とする。
VM未確保はPCで完了できる。VMで未検証の項目を成功として記録しない。

## I6: NNと自律学習・モデル更新

[継続学習仕様](continuous-learning.md)を正源とし、I6a→I6b→I6cで進める。
controllerのtaskIdはI6のまま、acceptance単位を追加して既存証跡を移行する。

- I6a: training-policy-value/network、prior/value、body/optimizer/RNG/データ位置の保存・再開。
  CPU/GPU adapterの能力検出・有限値/gradient/旧checkpoint互換・推論が実探索に寄与する反証。
  同seed/予算でcheckpoint出力の変更が探索配分・leaf値・最終decisionを変えることも反証する。
  完了: `nn-resume`。GPUは資源gate通過時のみ使う。
- I6b: LLMと独立した単一runnerで生成→学習→凍結候補評価を反復。24時間目標・共有予算・
  更新0/停滞検出・日次持越し・負荷回復時の自動再開・評価枠の確保を実装。
  候補頻度/評価seed更新/反復評価の誤採用制御/退行閾値をpolicyへ固定する。
  完了: `training-loop` と `nn-evaluation`。有効評価結果を保存し、不合格なら現championを維持。
- I6c: immutable候補の機械判定→atomic配備→health→切替/rollbackをLLM承認なしで実行。
  三モデル分離・版固定・旧版保持・S2への接続・故障注入・重複/中断transaction回復を実装。
  完了: `model-lifecycle`。本番の実昇格は評価合格候補が出た際に別途証明し、弱い候補を採用しない。

## I7: 監視移行と継続保守

対象: controller、wrapper、register-supervisor-task、configure-codex-autostart、監視回帰。
I0-I6の有効receipt・main/remote統合・稼働版一致と学習runnerの独立性を親が確認する。
`autonomy-soak`でLLMなし72時間の実機観測・実更新・評価進捗・日次/負荷/中断復旧を証明する。
その後120分設定を適用/読戻しし、当初はLLMが学習成果を各tickで確認する。
再起動登録が15分へ巻き戻さないこと、設定失敗時の再試行、実行中の非重複、手動停止維持を実装。
完了: O1、`autonomy-soak`、`monitor-live`。以降も学習は可能なら24時間、LLM確認は120分を継続。
正常tickのLLM省略は自律運用証跡・機械的な停滞検出を満たしてから親が判定する。

## 各タスク共通の検証

実装中は狙った回帰。節目で `pnpm codex:finish-check --plan` → 必要gateを実行。
rules-core変更はtsc必須。状態モデル/公開型/API/ルール骨格は全件検証、状態/APIはGUI+REST必須。
既存 `adversarial-verifier-prompt.md` の手順を使い、ISMCTS専用反証を追加してverified commit。
spawn失敗・不正JSON・refute残・tree変更時はcommit/統合禁止。3回失敗なら具体的原因を永続化し、
独立タスクだけ進める。stub/受入条件削除でタスクを完了にしない。
main統合要求後は終了し親runnerに引き渡す。次runで統合結果を照合する。
