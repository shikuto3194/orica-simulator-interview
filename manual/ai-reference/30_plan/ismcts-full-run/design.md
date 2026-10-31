# 実戦用ISMCTS設計

本書は採用した設計。既存training-mctsは完全情報baselineで、I1/I2の実装証明ではない。

## 境界

通常対戦探索はraw実GameStateを受け取らない。既存training-mcts-policyは完全情報baselineとして区別する。
型はrules-coreで共有し、名前を変える場合は対応表と理由を残す。

- `AiSearchRequest`: schema/request/session/revision/actor、engine/card/schema hash、player観測、
  自分の登録deck、観測履歴、`SearchPublicState`、現在のdecision。
- `SearchPublicState`: 観測だけではengineを再開できない公開stack/pending/使用回数/関係ID等。
  GameState fieldをpublic/viewer-private/sampled/excludedに分類するSSOT registryと未分類検出gateを作る。
  sanitizedStateへの単純castで済ませない。
- `AiSearchResponse`: requestId/revision/各hash、正準choice keyと従属入力、seed、simulation数、
  時間、資源profile、打切り理由、fallback、観測hash。
- 実state→要求projectorは信頼境界内。ログ・RNG内部・秘密identity/順序・hidden IDによる
  並び順を流さない。root候補生成も漏洩監査対象。全カードDBは公開知識として配置する。

public memoryは既存visibility/公開履歴を利用し、シャッフル・追跡不能移動で失効させる。
自分の残deckも登録listと本人が知る移動から求め、秘密の移動を参照して漏洩させない。

公開実効値の条件付き耐性と全体付与は、共通read内だけで依存計算を共有する。
自己CEを除いた状態を同じ親状態・残CE順序で正準化し、BP/シンボル結果は対象・lookup別に保持する。
同期read終了/例外で破棄し、次readや別状態へcacheしない。シンボル配列は呼出側へ複製する。
依存部分集合の増大自体は残るため、固定局面の参照回数削減を一般的な線形性能の証明としない。

## 仮想盤面

1. 公開盤面・本人可視領域・枚数・公開履歴・既知deck位置を制約にする。
2. training-deck-poolの固定weightを相手priorとし、公開カード/枚数に矛盾する候補を除いて正規化。
3. 全滅時は既存構築validatorと公開枚数を満たすカードpool事前分布を使い、unknown_archetypeを記録。
   相手の真deckで補完しない。pool外の相手で動く反例を必須とする。
4. 自分の未知deck順、相手hand/deck/裏向きをseed付きsample。既知位置、追跡済hand、
   公開セット、生成カード、転醒両面の同一性、下敷きを保持する。
5. engine共通構築処理から仮想GameStateを生成しSBA/continuous/invariantを確認。
   公開部分の再project一致をassert。実state cloneの秘密部分だけを上書きする実装は禁止。
6. 制約充足の試行上限32。全失敗はinconsistent_observation。公開制約を緩めずfixtureを保存して直す。

### 手札・山札の制約と部分sampler

`projectAiSearchDeckKnowledge(AiObservation)`はplayer観測の枚数・本人可視手札・既知山札位置を
相対ownerと公開snapshotだけへ射影する。位置は`indexFromBottom`を維持し、audienceを再確認する。
秘密ID・実山札順・実相手手札・元token番号は渡さない。本人手札の枚数不一致・重複位置は拒否する。
枚数は観測正源から`projectObservedZoneCounts`で検証付きコピーを作り、実状態の枚数を再計算しない。
SSOT guardはトップレベルの単一player引数・直接returnだけのhelperと、対応する正確な文字列キーを
ASTで認識する。文字列内空白による別キー化、検証関数の引数/局所shadowing、入れ子の同名helper、
同fileの加減算・別関数・破壊的更新を拒否する。moduleの検証関数自体の意味は別途回帰と査読で確認する。

`sampleAiSearchDeck`はこのcomponent、現在のhand+deck母集団の仮説、公開DB、固定seedだけを受ける。
仮説内の並び順を捨て、既知手札と位置を先に確保して残りをsampleする。相手候補は制約に合うものの
固定weightを正規化する。全滅時だけ公開poolから最大32試行し、通常のmain-deck validatorで
投入可否・同名上限・契約種類を検査する。本人の正確な母集団と矛盾した場合は未知priorへ置換しない。
このvalidatorは現在の部分母集団に適用するため、登録時の最小枚数や完全デッキの合法性証明ではない。
任意collectorの`hidden_zone_sampling`はowner別の母集団割当数と単調wall時間を共通telemetryへ保存し、
失敗試行も残す。simulation/gameや実相手の再構成成功とは数えない。

この部分samplerはGameStateを構築せず、本番経路へ未接続。呼出側の仮説は真の残り山札から作らず、
登録list・可視移動・生成/変身のprovenanceから復元する必要がある。
`sampleAiSearchOwnRegisteredDeck`は本人登録listと`AiSearchOwnPopulationChanges`の合成入口。
登録時だけ通常validatorと`MIN_DECK_SIZE`を適用し、hand+deckへの流入/流出・生成/消滅・素性変更を
viewer-local順序のremoved/added多重集合で適用して、既存の手札/既知位置制約へ渡す。
現在の効果生成物へ構築時の同名/契約/トークン制限を再適用しない。通常の任意prior入口は従来の検査を維持する。
欠番/重複順序・中間での不足・枚数/既知素性矛盾は拒否し、本人矛盾を未知priorへ置換しない。
この入力は信頼境界内のcomponentであり、完全なviewer可視差分を作る本番producerは未実装。
既存PublicDisclosureだけから完全な生成/変身provenanceを得たとは扱わず、自己申告の完全性をreceiptにしない。
回帰の移動は実engine primitive→観測からの可視snapshot→手動delta供給であり、自動抽出の証明ではない。
`materializeAiSearchDecks`は両ownerのsampleと公開DBだけから共通`createCardInstance`で
新規の手札/山札実体を作る。秘密実体をcloneせず、player/instance IDはworld内の固定slot参照とする。
samplerのbottom=0をengineのtop-first配列へ変換し、実draw primitiveと枚数同期で順序を照合する。
登録時制限を現在の生成物へ再適用しない。
`projectAiSearchDeckKnowledgeWithVisibility`は同じ投影/検査の正源でaudienceと相対actorも保持する。
`materializeAiSearchDecksWithKnowledge`は枚数/既知手札/既知位置の一致を検査し、新規山札実体へ
観測済みの公開範囲と合成player IDだけを設定する。両席のroot既知位置再投影と相手への私的位置非開示、
秘密素性/順序/IDへの非干渉、共通の位置知識resetと実top/bottom draw後の位置変化を回帰する。
rootに見えない相手の私的知識は復元しない。
`materializeAiSearchDecksWithHandRefs`はproject済みカードのroot内`cardRef`と既存sampleを合成し、
可視手札の多重集合が既知手札と完全一致する場合だけ、各コピーを新規手札実体へ一対一で結ぶ。
重複/欠落参照、秘密deck/手札、履歴だけの`public_memory`は拒否し、出力へlive IDを保存しない。
同名カードの2枚目を指定する通常召喚→stack pass→維持コア配置を両root席で検査する。
この対応はroot内のみ。動的修飾・公開盤面の継続状態・完全なobserver知識・pending/stack/usageの合成と
GameState全体の再projectは未実装で、部分fixtureの実行成功を完全worldや本番受入へ拡張しない。
`materializeAiSearchFieldInstances`はfield部分の公開tokenと公開DBだけから物理状態の新規実体を作る。
root内参照を合成IDへ結び、所有/制御・通常/魂コア・最低コア・役割・疲労を保持する。
通常ブレイヴの相互参照が揃った一段の合体グラフは、全参照を検査してから合成IDへ結ぶ。
欠落/片側だけ/重複/自己参照/入れ子は拒否し、子の順序・別コピー・通常/魂コアを保持する。
裏向き/素性不明・下敷き・離脱待ちは不足する関係を推測せず拒否する。
異魔神の右slotは、表向き可視fieldの観測で明示nullまたは参照を保持し、root内番号へ置換する。
右slot未収録の旧観測は単独状態と推測せず拒否する。左右同一/自己/欠落/入れ子/重複hostも拒否する。
両root席の実左右合体→観測→合成→再投影と各hostの攻撃で、BP加算・2シンボル減少を検査する。
右だけ/単独の物理snapshotも区別するが、実離脱処理・継続効果・完全worldの受入には拡張しない。
表向きfieldの`originalCardNo`は共通sanitize後の元面を保持し、隠れた素性や履歴tokenへは追加しない。
合成fieldは公開DBの同一面または共通B面合成規約に一致する元面だけを受ける。旧観測の欠落は拒否する。
両席の実転醒→観測→合成→逆転醒/バウンス完了でA面復帰を検査する。任意の変身provenanceは未対応。
通常の単独カードを使う両席fixtureで手札/山札との合成・field token再投影・宣言前窓からの攻撃/ブロック・
BP比較による破壊とライフ維持を検査する。継続効果・任意変身provenance・履歴・魂所在等は再構成せず、
この部品を完全な再開可能worldへ直接読み替えない。完全builderで再構成後の観測一致が別途必要となる。
通常合体は実legal action→観測→合成field→両root席の攻撃で、合体BPによるブロッカー破壊と
非ブロック時の2シンボル減少まで検査する。これはfield部品の経路で、本番ISMCTS/完全H1-H3ではない。
[player資源・公開提示の部分合成](i1-player-resources.md)は物理値・魂状態・保護カウントと公開契約提示を保持する。
両席の実支払い・召喚・条件/分岐完了と秘密非干渉を検査し、完全world・H1-H3・本番受入とは区別する。
公開セット使用も相対ownerとboolだけで合成する。枠消失後の通常再セット拒否・免除消費・
効果セットの対照・次ターンresetを両席で検査する。その他のusage/slot/CEは未再構成。
時計/位置・step予約/復帰列・公開ターン予約の契約と反証は [公開の進行component](i1-turn-schedule.md)を参照。

`materializeAiSearchPublicZoneInstances`は可視なtrash/removed_from_gameの物理componentを
公開DBと観測内参照だけから新規合成する。同名別コピー・所有/制御・コア・疲労・役割を保持し、
voidはコア専用のためカード入力では公開DB参照前に拒否する（[カード除外との区別](../../10_rules/06_core-system.md)）。
秘密カード、revealed/in_use等の処理中状態、欠落/重複/不完全な合体・下敷き関係を拒否する。
元stateを複製せず、既存手札/山札/field部品と衝突しない合成IDを使う。
両席の公開部分再投影→同名2枚目の回収→手札増加バースト確認→通常召喚/維持コア配置を回帰する。
開発GUIのAlice選択とBob RESTでも同じ合成実体の回収を照合する。本番認証/ISMCTS経路の証明ではない。
zone進入履歴・使用制限・継続効果・完全requestとworld再projectは別途再構成し、物理部品だけで再開しない。

## 木と探索

現行NNのchoice入力から列挙indexを除き、候補順序だけの変更が意味別score/probabilityを変えない
回帰をlive/replay・学習後・checkpoint復元後へ接続する。旧choice schemaは既存fingerprint/次元検査で
明示拒否し、重みや保存済みbatchを自動変換しない。
既存source/target pointerは観測内の個別card tokenをrole別行列でNNへ接続する。
checkpoint schema 2・反証範囲・残条件は[候補入力の証跡](evidence.md#候補順序と旧checkpoint)。
この部分を全choice意味表現・body学習・本番ISMCTSの完成にしない。

observer別の情報集合木を持つMO-ISMCTSを基礎にする。simulationごとにrootでsampleし、
その世界をengineで進める。途中で矛盾する秘密状態へ再sampleしない。
独立した完全情報UCTの多数決をISMCTS完成にしない。

- 情報集合key: observer可視状態、本人が知るaction/observation履歴、actor、decision kind、
  入力prefix、公開使用制限。秘密の実ID/順序/sample seedを含めない。
- choice key: kind、可視source/targetの正準ID、公開parameter、actor本人の選択。
  他observerには秘密入力を伏せた観測可能edgeを使う。配列indexやlabelだけをkeyにしない。
- 全observerの木を同じsimulationで進め、手番actorの木から選ぶ。
  相手policy/valueはそのactor視点の観測を受ける。GameStateをNNへ直渡ししない。
- 現sampleの合法edgeのみ選択。edgeはvisits/value/availabilityを持ち、合法な機会だけavailability加算。
  UCB=`mean + 1.4 * sqrt(log(max(1, availability)) / visits)`、未訪問合法edgeを先に展開。
- valueはobserver本人視点で保存。手番交代回数で機械的に符号反転せず、割込・連続入力で回帰確認。
- 終局win/loss/drawは+1/-1/0。非終局は観測限定heuristic [-1,1]。
  capped/stuck/errorを勝敗labelにせず、探索例外をcatchして枝を黙って削除しない。
- legal_action→action_inputは既存逐次decision APIを使用。支払い・配分を打切る場合も
  現行合法な完全payloadを生成。大候補は既存逐次分解を使い、未展開候補を恒久削除しない。
- 第1版は要求ごとに木を破棄。productionはdeadline、回帰は固定simulation数で再現性を確認。

## 通信とGUI

- 一人バトルが対象。対戦API移行・room対戦へのAI介入は対象外。
- ブラウザ→既存認証PC APIのAI専用route→loopbackまたはprivate VM service。
  VMをブラウザから直接呼ばず、秘密service tokenをフロントへ置かない。
- 既存認証middlewareを使いCPU探索をHTTP主thread外へ。actor/revision/順序を照合し、
  採用時にGUI/engineでも合法性検査。requestId冪等性で二重適用を防ぐ。
- CORS/body/rate/queue/deadline/cancelを共通adapterで実装。未認証探索endpointを公開しない。
- busy/offlineを再試行可能に表示、古い応答を破棄。AI入力をGUI側の固定補完で隠さない。
- 一人バトルは[復帰仕様](solo-fallback.md)に従い、現行/旧モデルが使えない場合も独立した簡易AIで継続する。
- VM/PCは同じartifact/protocol。arm64非対応依存があればCPU TS経路を標準にする。

## NNと学習

source/target token pointerだけをmetadataへ置かず、対象・支払い元・配分の対応をモデル入力へ保持する。
カード平均後の変換と単一数値IDで失う情報を比較し、カード単位特徴/学習embeddingの最小構成をI3/I6aで選ぶ。
候補順の置換に対するscore/probability対応、対象/配分だけ異なるchoiceの識別、schema移行/安全拒否を反証する。
現Tiny networkのhead更新をbody学習の完了にせず、globalW/cardW/knownDeckW/choiceW/sourceW/targetW/両body biasも対象にする。
[処理別telemetry](i0-work-telemetry.md)を後続callerへ明示的に接続し、未計測を0msの実測としない。

PolicyValuePredictorを探索prior/valueへ接続。UCTは比較経路として維持。
PUCTは合法候補上のpriorを正規化し、mask/truncated契約を維持する。
body/optimizer/RNG/schema/data hashをcheckpointへ保存し、固定batchの中断再開前後を比較。
GPU adapterはCPUとの誤差・速度・占有を実測。[評価gate](evidence.md)を通った版だけ昇格。
[継続学習](continuous-learning.md)のlearner/candidate/championを分離し、可能なら24時間
生成・学習・評価・自動配備を反復する。LLMの120分確認と独立し、更新・評価の再開点を永続化する。

## 根拠

- A（一次資料）: [Cowling/Powley/Whitehouse 2012](https://doi.org/10.1109/TCIAIG.2012.2200894)、
  [York掲載情報](https://pure.york.ac.uk/portal/en/publications/information-set-monte-carlo-tree-search/)。
  情報集合木の方針に採用。[大学公開の原稿](https://eprints.whiterose.ac.uk/id/eprint/75048/1/CowlingPowleyWhitehouse2012.pdf)は取得timeout。
  I2前に原著Algorithmを取得・照合し、差があれば根拠付き設計修正と反証を先行する。本文未取得を読了扱いにしない。
- 可視性: [情報公開ルール](../../10_rules/01b_information-visibility.md)、[観測contract](../../20_design/16_ai-observation-contract.md)。
- B（設計判断）: 本書の境界/key/通信。実装済みの証明ではない。
