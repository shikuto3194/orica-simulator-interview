# Source Map

## 前提

- [ことで A/C](conditional-cost-scope-audit-2026-10-26.md)
- [Q24495 A/R21 C](../10_rules/03d_effect-target-and-prerequisite-gates.md)

- [ルーム通信の調査 A/C](../20_design/18_room-network.md) / [確定・復旧契約 C](../20_design/19_room-network-protocol.md)

- [枠A/C](source-findings-brave-capacity-2026-10-20.md)
- [ブレイヴ合体枠と追加条件 A/C](source-findings-brave-capacity-2026-10-20.md)
- [engine-drain統合時の再確認 C](engine-drain-integration-review-2026-10-03.md)

- [X03/Q9 B・回復 C](../10_rules/03e_attack-duration-precedents.md)
- [アタック時の期間・回復制限 B/C](../10_rules/03e_attack-duration-precedents.md)

- [Funnel監視 A/C](funnel-watchdog.md)

- [合体シンボル A](../10_rules/05_brave-and-attack-special-cases.md#合体条件)

- [公開情報と耐性の証明 A/C](../10_rules/01b_information-visibility.md)

- [BSAZ02 A/C](source-findings-aldnoah.md)

- [誘発・原因ID必須化](../10_rules/02d_trigger-timing-and-causality.md)（2026-09-25、公式A・実装要件C）

- [Oracle配備 A](oracle-deployment.md)

- [下カード裁定 C](../10_rules/08a7_under-card-inheritance.md)

- 調査日: 2026-09-23 JST
- [紺珠伝14枚・qa-055〜057](source-findings-bsth10.md)（独自原文 A、早苗の優先条件・R03原文訂正はユーザー確認 C）
- [離脱成立・効果発揮後の境界](source-findings-effect-boundaries-2026-09-22.md)（公式 A・ユーザー確認 C）
- 正源: **公式エターナルVer.17.x**（スタンダード版は除外）。
- 採用基準は [CLAUDE.md](../../../CLAUDE.md) のエターナル版。下記の取得版と採用版を分け、改訂の適用は該当ルール章で根拠・適用範囲を確認する。通常版は裁定根拠にしない。
- **公式ソース優先順位**: `battlespirits.com`（バンダイ公式）> `batspi.com`（ファン PukiWiki）。
  エターナル公式マニュアル・FAQを優先。`batspi.com` は検索・補完。
- 公式ルールマニュアル(エターナル) Ver.17.1 ページ構成: page02 基本/ page05 ゲーム進行/ page08 アタックステップ/ page09 特殊カード(ブレイヴ)/ **page11 フラッグネクサス**/ page12 特殊な効果(バースト)/ page13 その他/ page14 FAQ/ page15 用語集。
- 公式 FAQ: `battlespirits.com/faq/list.php?prodname=<製品コード>&format=eternal`（製品別）。
  **`&format=eternal` 必須**（無いと全0件を返す）。全件ローカルミラー: `external-qa-official/<code>.md`（gitignore、`scripts/harvest-official-faq.mjs` で再生成、エターナル版 246製品 / 28,245 Q&A、Q番号で引用可）。製品別索引は `external-qa-official/_manifest.md`。
  個別Q&Aは収録時の裁定で、Ver.17.x改定が優先する場合がある。例: 待機状態の参照/シンボル軽減はVer.17.0が正（旧弾FAQには旧裁定が残る）。日付・版で最新公式を優先。
- 補助ソース: `manual/deep-research-report.md`
- 独自カード/独自裁定ソース: `https://dancing-pixie-db5cc3.netlify.app/`（ローカルミラー `external-qa/`、[source-findings-custom.md](source-findings-custom.md)）

アクセス時は [ソースへのアクセス方法](source-access.md) の URL 規則に従う。

## 信頼度ラベル

- `A`
  - 元レポート内で本文確認済みのページ、またはカード個別ページ/ルール解説ページとして直接内容確認できたもの。
- `B`
  - `batspi.com` 検索結果スニペットで補完できたもの。
  - 内容はかなり有用だが、本文直読よりは一段落として扱う。
- `C`
  - 上記からの実装上の推論。
  - コード設計の便宜上まとめたもので、公式/本文突合が必要。

- 2026-09-04: 転醒の同一原因排他（公式エターナル本文 A + 原因・発生が異なる独自カードの転醒はユーザー確認 C、実装適用済み）。根拠・具体例は [転醒の同時発揮](../10_rules/08a3_rebirth-trigger-causes.md)。

A/B/Cは取得方法の記録で、採用許可・実装成功ではない。出典主体と確定/暫定/未確認は各記録本文で区別する。過去のユーザー確認Cを未確認の推定と同一視しない。

## 基礎ソースの取得記録（取得時点）

- [Q1532 A](../10_rules/08d_grandwalker-nexus.md)

- 元レポート: `manual/deep-research-report.md`（A）。全体の論点整理、既存の引用整理
- 基本ルール: `https://batspi.com/index.php?基本ルール=`（A）。勝利条件、カードカテゴリ概要 (2026-03-23 `cmd=read` で本文取得成功)
- ルールQ&A: `https://batspi.com/index.php?ルールＱ＆Ａ=`（A）。ステップ処理、軽減、アタック、ブレイヴ、指定アタック、一時効果終了順 (2026-03-23 `cmd=read` で本文取得成功)
- マジック: `https://batspi.com/index.php?マジック&word=BS16-073`（A）。使用手順、メイン/フラッシュ、派生効果後にトラッシュ
- ブレイヴ: `https://batspi.com/index.php?ブレイヴ&word=SD57-005`（A）。ブレイヴ概要、メイン限定の基本動作
- スピリット: `https://batspi.com/index.php?スピリット&word=BS53-052`（A）。スピリット定義、Lv/BP表記
- アルティメット: `https://batspi.com/index.php?アルティメット&word=BS24-068`（A）。カテゴリ差分、表示差分
- ネクサス: `https://batspi.com/?ネクサス&word=BS21-071`（A）。配置という語彙
- フィールドを離れるとき: `https://batspi.com/index.php?カード効果：フィールドを離れるとき&word=CB25-074`（A）。待機状態、破壊/消滅/バウンスの種別
- 消滅について: `https://batspi.com/index.php?cmd=read&page=消滅について&word=消滅`（A）。消滅待機状態、対象制限、トラッシュ遅延
- 強化: `https://batspi.com/?強化&word=LM13-03`（A）。常在補正、重複、最終値参照
- 指定アタック: `https://batspi.com/index.php?カード効果：指定アタック&word=BSC18-X02`（A）。指定アタックの制約
- ギャラクシーステップ: `https://batspi.com/index.php?ギャラクシーステップ=`（A）。ターン内の主要ステップ順確認 (2026-03-23 カード効果テキスト + ターンの流れページで本文取得成功)
- カードのコスト及びその支払いについて: `https://www.batspi.com/index.php?カードのコスト及びその支払いについて=`（A）。ソウルコアの支払い、コア移動制限、余分コスト巻き戻し、コスト変更競合 (2026-03-23 `cmd=read` で本文取得成功)
- 旧通常版の取得記録（現行エターナル裁定の根拠から除外）: `https://www.battlespirits.com/rule/official-rule-manual/page04.html`（A）。召喚コスト支払い、召喚後の初期コア配置、ネクサス配置の基礎
- ゲームの流れ: `https://www.battlespirits.com/rule/official-rule-manual-eternal/page06.html`（A）。メインステップでのバーストセット回数、ミラージュセット回数、8種の行動一覧 (2026-03-23 エターナル版で本文取得成功。通常版はリダイレクトで取得不可)
- ブレイヴ(エターナル): `https://www.battlespirits.com/rule/official-rule-manual-eternal/page09.html`（A）。ブレイヴ召喚/合体/分離/交換/破壊時の公式ルール。コア補填はリザーブまたはフィールドのカード上から。
- コストとコア: `https://www.battlespirits.com/rule/official-rule-manual-eternal/page07.html`（A）。[効果召喚監査](source-findings-effect-summon.md) (2026-09-13)
- 特殊な効果: `https://www.battlespirits.com/rule/official-rule-manual-eternal/page12.html`（A）。バーストの set / reveal / 解決順 / burst状態 の公式整理 (通常版は転送、エターナル版で取得。手札/トラッシュ発動もバーストエリア扱い等の追加情報あり)
- バースト解説: `https://www.battlespirits.com/rule/burst.html`（A）。バースト効果解決後のトラッシュ移動、1ターン1回 set の補強
- 公式Q&A `PC12`（取得時URL。再取得は `format=eternal` を付ける）: `https://www.battlespirits.com/faq/list.php?prodname=PC12`（A）。指定アタックとアタック宣言バーストの前後関係
- エターナル版ルールマニュアル FAQ: `https://www.battlespirits.com/rule/official-rule-manual-eternal/page14.html`（A）。効果テキスト解釈 (する/できる/ことで/そうしたとき/その後/さらに/この効果発揮後)、効果優先順位、防止優先順位、時間指定効果の継続。バースト宣言は「誘発効果と同タイミングで**ブロック側から**宣言」を逐語確認 (2026-06-12、page12「発動した順番に解決」と合わせ P2-06 残留懸念1を解消)
- ルール改定に関して: `https://www.battlespirits.com/rule/revised.html`（A）。バーストでの `召喚/配置はコストを支払わずに行う` の整理、Ver.11.0 待機状態導入、Ver.15.0 即発動制限、ブロックアイコン《2》以降例外 (2026-03-23 部分取得で主要改定確認)
- ルールマニュアル(エターナル)Ver.17.0 改訂: `https://www.battlespirits.com/news/2026/rule-manual-eternal17-revised.php`（A）。Ver.17.0 (2026-04-11 適用) の待機状態統一。「待機状態になったスピリットは参照でき、そのシンボルでコストの軽減もできる」を逐語確認。消滅待機だけの軽減不可制約は撤廃 (旧 `source-findings:109` を更新)
- 創界神デッキ例 `BS58-X09`: `https://www.battlespirits.com/feature/structure/bs58/deck_parvati.php`（A）。実在する創界神グランウォーカーの cardNo 例
- 創界神デッキ例 `BS59-X09` / `BS59-071(A)`: `https://www.battlespirits.com/feature/structure/bs59/deck_synchronos.php`（A）。実在する創界神グランウォーカー / 創界石グランストーンの cardNo 例
- 創界神デッキ例 `BS61-X09`: `https://www.battlespirits.com/feature/structure/bs61/deck_white.php`（A）。実在する創界神グランウォーカーの cardNo 例
- 相手のライフを減らす: `https://www.batspi.com/index.php?カード効果：相手のライフを減らす&word=BS38-007`（B）。ライフ減少時のコア移動先の補強
- 自分のライフを参照: `https://batspi.com/index.php?カード効果：自分のライフを参照=`（B）。`[ソウルコア]を創界神ネクサスに置く` explicit 例外の補強
- ネクサスカードをコストを支払わずに配置する: `https://batspi.com/index.php?カード効果：ネクサスカードをコストを支払わずに配置する=`（B）。burst card 自身が解決中に別 zone へ移るカード例の補強
- 封印: `https://batspi.com/index.php?封印`（A）。`[ソウルコア]を自分のライフに置く` explicit 例外、`封印中` の語彙、派生封印9種リスト、ライフにソウルコアのみ時のボイド送り不可 (2026-03-23 `cmd=read` で本文取得成功)
- 魂状態 Q&A 例: `https://batspi.com/index.php?仮面ライダーW+サイクロンジョーカー+［3］=`（A）。`魂状態` の一般定義、対象制限、コア移動先、通常召喚不可 (2026-03-23 `cmd=read` で本文取得成功。魂状態ページも補助取得)
- ソウルコア: `https://batspi.com/index.php?cmd=read&page=ソウルコア`（A）。ソウルコアの移動禁止先4箇所(ライフ/ボイド/創界神/創界石)、相手効果時の持ち主選択権 (2026-03-23 本文取得成功)
- ターンの流れ: `https://batspi.com/index.php?cmd=read&page=ターンの流れ`（A）。7ステップの正式名称と処理概要 (2026-03-23 本文取得成功)
- 消滅について: `https://batspi.com/index.php?cmd=read&page=消滅について`（A）。消滅待機状態の4段階処理、Lv非依存キーワード保持、コスト支払い消滅のトラッシュ遅延 (2026-03-23 本文取得成功)
- 魂状態: `https://batspi.com/index.php?cmd=read&page=魂状態`（A）。魂状態化時のコアはリザーブへ、対象制限、通常召喚不可 (2026-03-23 補助取得成功)
- 独自カードサイト: `https://dancing-pixie-db5cc3.netlify.app/`（A）。公式に存在しない独自カード、独自Q&A、独自errata の一次ソース
- 独自カードサイト SPA bundle: `https://dancing-pixie-db5cc3.netlify.app/assets/index-4lr0zIZt.js`（A）。2026-03-19 JST 時点の公開 Q&A / errata payload の確認
- 独自カードサイト card data bundle: `https://dancing-pixie-db5cc3.netlify.app/assets/card-data-vfsOkgyf.js`（A）。2026-03-19 JST 時点のカード本文と独自用語の観測

### 2026-03-28 追加（9ギミック調査）

- 煌臨解説: `https://batspi.com/index.php?煌臨`（A）。煌臨の処理手順・状態引き継ぎ・煌臨元カード
- 煌臨公式: `https://www.battlespirits.com/rule/kohrin.php`（A）。煌臨の公式ルール定義
- 転醒解説: `https://batspi.com/index.php?転醒`（A）。転醒条件・処理手順・カウントエリア
- 転醒公式紹介: `https://www.battlespirits.com/product/capture-deck/tensei.php`（A）。ダブルフェイスカード構造
- 契約公式紹介: `https://www.battlespirits.com/product/capture-deck/contract.php`（A）。契約カードの基本ルール・魂状態
- ミラージュ公式紹介: `https://www.battlespirits.com/product/capture-deck/mirage.php`（A）。ミラージュセットの方法・制限
- アクセル: `https://batspi.com/index.php?アクセル`（A）。アクセルの使用手順・手元ゾーン
- チェンジ: `https://batspi.com/index.php?チェンジ`（A）。チェンジの入れ替えルール
- ゼロカウンター: `https://batspi.com/index.php?ゼロカウンター`（A）。発動条件・効果パターン
- 異魔神: `https://batspi.com/index.php?異魔神`（A）。左右合体・シンボル計算
- 創界神ネクサス: `https://batspi.com/index.php?創界神ネクサス`（A）。神託・神域・転神・界放
- 神託: `https://batspi.com/index.php?神託`（A）。神託のトリガー系統・コア配置

## カスタムソースの扱い

- 公式に存在しないギミックは、独自カードサイトを一次ソースとして扱う。
- 読み取り優先順は、
  - サイト上の Q&A / 裁定
  - サイト上のカード本文
  - サイト上の errata / 更新履歴
  - ユーザー確認
    の順とする。
- errata は基本的にカード本文へ反映済みの更新履歴として読む。
- ただし、サイト上の情報だけでは定義が閉じないときは、ユーザー確認を暫定正として採用し、その回答を `source-map` / `open-questions` / 該当章へ反映する。
- bundle名・件数・再取得の履歴は [独自サイト取得履歴](archive/source-map-acquisition-history.md)。現在の件数は再取得結果で確認する。

## 調査結果の置き場

- 公式寄りの補強結果は [source-findings-official.md](source-findings-official.md) を索引として分ける。
  - ターン進行、軽減とコスト支払いは `source-findings-official-turn-cost.md` に置く。
  - アタック窓、ブレイヴ、バーストは `source-findings-official-battle-brave-burst.md` に置く。
  - コア資源、ソウルコア、魂状態、待機状態は `source-findings-official-core-and-states.md` に置く。
- 独自サイト由来の裁定整理は [source-findings-custom.md](source-findings-custom.md) に分ける。
  - `スタック`、導界者、黒 / 七色、クォーツなど独自ギミックの裁定メモを置く。
- まだ断定しきれない点は [open-questions.md](open-questions.md) に残す。

## 更新ルール

- URL・信頼度・参照順・更新方針は本書で管理。
- 公式寄りの追加調査は `source-findings-official.md` から辿れる適切な分割先に残す。
- 独自サイト由来の追加調査や user-confirmed ruling は `source-findings-custom.md` に残す。
- 断定を避けるべき項目は `open-questions.md` に逃がす。
- 実装判断へ影響した調査は、そのターン内に `source-map` / `source-findings-*` / `open-questions` / 該当章のどれかへ必ず痕跡を残す。

## 実装時の扱い

- 出典主体・適用版・原文の対象範囲を確認し、A/B/Cだけで実装可否を決めない。Bは検索断片であることを残し、必要な裁定が閉じなければ原文確認へ戻る。
- Cの推定は未確認として扱う。ユーザー確認による採用済み裁定は確認日・対象・反映先を記録し、単なる推定から区別する。

- 2026-09-10: [「○○たとき」発揮条件の全面監査](../30_plan/03_completed-milestones-phase-6-result-wording-audit.md)。公式エターナルFAQ効果全般Q6・Q19491（A）を適用。634面・329行を照合し4カード修正。

- 2026-09-10/12: [夜空の剣・キリト: 本文A・裁定C](../10_rules/07d_night-sword-combination-audit.md)。

- [C:常時許可](../10_rules/08a5_as-if-soul-core-permissions.md)

- 2026-09-23: [BSTH05-R02の対象宣言窓・空撃ち・耐性](../10_rules/04b3_burst-suppression-and-paid-gates.md)。ユーザー裁定 C。「発揮できない」の無視は無効化に及ばない点は独自Q&A qa-023（A）でも確認。
