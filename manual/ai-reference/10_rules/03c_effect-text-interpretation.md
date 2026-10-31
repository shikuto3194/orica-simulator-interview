# Effect Text Interpretation（効果テキスト表現の解釈ルール）

> [03b_resolution-and-interrupts.md](./03b_resolution-and-interrupts.md) から分割（2026-06-12）。効果解決・割込・無効化・空撃ちは 03b、コスト計算・支払いは [03a_cost-payment.md](./03a_cost-payment.md) を参照。常時/継続 vs 誘発/即時判定・時間指定効果の継続・〔ターンに1回〕/〔重複不可〕は [03e_effect-duration-and-repeat-scope.md](./03e_effect-duration-and-repeat-scope.md) へ分割（2026-07-18、サイズ上限）。

(公式ルールマニュアル エターナル Ver.17.0 FAQ 信頼度 A)

## 「する」vs「できる」(強制 / 任意)

- **「○○する」**: 強制。可能な限り必ず発揮させなければいけない。
- **「○○できる」**: 任意。プレイヤーがその効果を発揮させるかどうかを選択できる。
- **「できる」(任意) は字面の「○○できる」に限らず、任意を意味する文言すべてを含む**（ユーザー裁定 2026-06-12、信頼度 C）。
  - 可能形の語尾全般が該当: 「置ける」「戻せる」「引ける」「裏返せる」「入れ替えられる」「加えられる」など（〜ける / 〜せる / 〜られる）。
  - 「加えられる」=任意・「加える」=強制（2026-05-31 裁定）はこの一般則の個別事例。
  - **効果全体の optional 判定（ユーザー裁定 2026-08-09、信頼度 C）**: 効果の最初の文が任意文で、後続の強制文がその前の任意文を発揮していないと成立しない場合、効果全体は `executionMode:"optional"`。一方、最初の文が強制、または前の任意文を発揮しなくても成立する強制文が効果内にある場合、効果全体は mandatory。
  - **effect-level と step-level の使い分け（ユーザー裁定 2026-08-09 追補、信頼度 C）**: 任意文が単一 step、または最初の任意文に後続の強制/任意文がすべて依存する場合、発揮有無は effect-level `executionMode:"optional"` のみで表し、先頭 `EffectStep` に step-level optional を重ねない。依存後続の任意文だけが別選択として残る場合は、その後続 `EffectStep` に付ける。step-level optional は、mandatory effect 中の一部手順、または effect-level optional 発揮後の依存後続手順だけを任意にする場合に使う。
  - **effect-level optional 発揮後の全辞退禁止（ユーザー裁定 2026-08-09 追補、信頼度 C）**: カードデータ上は `effect.executionMode:"optional"` と全 step-level optional の併用を許容する。ただし実行時に「発揮する」を選んだ後、通常の optional step をすべて辞退して空発揮することは不可。`Nまで` / `count.min:0` / `optionalUpTo` など本文上 0 指定が許される場合は例外。
  - DSL 実装規約: 任意文言の効果は `executionMode: "optional"`（または `count.min: 0` 等の任意表現）で表す。省略時デフォルトは `"mandatory"` のため、可能形テキストでの省略は実装誤り（監査: [P3-96 (完了)](../../../issues/archive/P3-96/index.md)）。
  - **card_event 系の特例 (裁定 2026-06-24 ruling C)**: `findRevealedEffect` (省略時 optional) と `findMovedToTrashAutoEffect` (省略時 mandatory) の既定が経路別で非対称。書き忘れリスク回避のため、`timing.kind === "card_event"` で `event` に `"revealed"` または `"moved_to_trash"` を含む effect は **executionMode の per-effect 明示を必須** とし、cards:fidelity 監査で省略を fail として検知する (engine 既定は据置)。他の card_event 種別 (attack/advent/summon 等) は `getEffectExecutionMode` (default mandatory) 経路で対称のため対象外。

実装状況: `executionMode` / `getEffectExecutionMode()` 配線済み。optional は自動発揮せず GUI ラベルと `skipOptionalEffect` に反映。`revealed` / `moved_to_trash` の card_event は default 非対称のため、cards:fidelity 監査 fail で明示必須を強制する (P3-96 ruling C, タスク `ENGINE-card-event-execution-mode-fidelity-fail`)。

固定枚数の交換・検索・破棄は、効果または任意stepの実行確定後、対象選択で再度辞退できない。候補不在による不発はこの禁止に含まれない。BSAZ02-C16の「このカード」は発揮元個体、「手札」は手札だけを指す。[2026-10-02の原文・全経路監査](../00_meta/source-findings-selection-contract-2026-10-02.md)（原文A・既存裁定の適用C）。

## 効果の優先順位

- **「できない」＞「しなければならない」＞「する・できる」** の順で優先される。
- カード効果とルールが矛盾する場合は、カード効果が優先。

実装状況: 型定義済み。`EffectForceLevel` (`"prohibition"` | `"obligation"` | `"normal"`, 省略時 `"normal"`) を全効果登録型に追加済み。比較ヘルパー `compareForceLevel()` あり。resolver 側の競合判定は未実装。

## 効果防止の優先順位

- 「防げない」の解決時の貫通・発揮前無効化との区別（公式Q1481）・`cannot_*` 貫通・「受けない」のプレイヤー範囲・文言の2型とtarget lock貫通範囲は [04b2 効果防止の優先順位](04b2_effect-prevention-priority.md) を参照。「防げない」を発揮禁止や効果自体の無効化に優先するものと扱わない。
- バースト無効/発揮できない/受けないタイミング・バースト発動対価ゲートは [04b3 バースト特有の抑止・対価ゲート](04b3_burst-suppression-and-paid-gates.md)（2026-08-04 に 04b2 から分離）。

## 効果の「対象」がプレイヤーかカード/ゾーンか（人称判定）

サイズ分割により [03d_effect-target-and-prerequisite-gates.md](./03d_effect-target-and-prerequisite-gates.md) へ移設（2026-06-24）。

## 「デッキを破棄する」vs「デッキからトラッシュに置く」

語義、耐性対象、DSL の表現と回帰は [03c2_deck-discard-and-zone-move.md](./03c2_deck-discard-and-zone-move.md) を正源とする。

## 「○○しなければ△△を発揮できない」(発揮前提の除去/移動効果)

サイズ分割により [03d_effect-target-and-prerequisite-gates.md](./03d_effect-target-and-prerequisite-gates.md) へ移設（2026-06-24）。

## フラッシュ/スタックの見出しラベルと本文の実行窓

[効果分類・ラベルなし行動・禁止対象](03c3_activated-effect-labels.md)を参照。

## 「○○することで△△する」(ことで構文)

- 構文全体が**任意**。「○○する」単体は強制だが、「ことで」構文に包まれると全体が任意になる。
- ○○を行わない選択ができる。ただし、行うなら必ず○○を完了しなければ△△は発揮できない。
- △△できないときに○○だけすることも**できない** (双方向チェック)。

実装状況: `connector: "conditional_cost"`、宣言時の実行可否判定と解決時ロールバックで双方向チェックを表現する。
現界ではソウルコアを指定元から払えて、かつ支払い後に維持コアを確保できる必要がある。
ソウルコアがトラッシュにある場合や支払い後の維持コアが不足する場合は、手札から発揮できない
（ユーザー確認C、2026-09-25。[監査・検証記録](../30_plan/03_completed-milestones-phase-6-conditional-cost-audit.md)）。

## 「○○できる。そうしたとき、△△する」(そうしたとき構文)

「ことで」との違い、指定数の完全達成条件、公式Q&A根拠、DSL実装は [03c1_effect-connectors-and-completion.md](./03c1_effect-connectors-and-completion.md) を正源とする。

## 「さらに」「その後」「この効果発揮後」の違い

- **「さらに」**: 前述と**同じタイミング**で解決する効果。型定義済み (`EffectCompositionKind = "simultaneous"` + `EffectComposition`)。resolver 側の同時解決グループ処理は未実装。
- **「その後」**: 前述を解決してから**他の効果を割り込まずに**発揮する効果。○○ができなくても△△は実行できる。
  - 後段の方法・対象は前段解決後に選ぶ。[全件監査 A](../30_plan/03_completed-milestones-phase-6-sequential-order-audit.md)に公式FAQと回帰を記録。
- **「この効果発揮後」**: 前述の効果を解決したら、それによって**誘発する他の効果を先に解決してから**解決する効果。実装済み (`runPendingReactionMainResolution()` が効果解決後に `queuePendingReactionsFromTriggerEvents()` で誘発を積み、先に処理させてから後続へ戻る)。
  - BSRK01-C03 は破壊 → BSRK01-CX01【不殺のるろうに】などの誘発解決 → 後段の手札戻し。既存 `after_triggers` を実カード回帰で確認（2026-09-21）。

## 「この効果を○○につき追加で発揮する」(反復発揮)

- 「この効果を自分のカウント1につき追加で発揮し」(BSTH04-X02) 等は、当該 step の action を**基本 1 回に加えて** N 回（解決時に動的評価）追加実行する＝合計 1+N 回。語尾が**終止形/連用形（「発揮し」「発揮する」）= 強制**、**「発揮できる」= 任意**（本ファイル冒頭「する」vs「できる」節）。
- 各反復は**対象を独立に再解決**する（毎回候補集合から選び直す。同一対象重ねも別対象も可）。
- **「追加で」なしの「この効果を○○1につき1回発揮できる」**は基本回を加算しない。量化値 N 回だけ、一連の効果全体を実行する。`repeat.additional` を使う場合は N-1 を指定し、N=0 を発揮不可にする前提条件を別途置く。〔ターンに1回：同名〕のような発揮制限は効果全体の宣言可否であり、この N 回を 1 回に縮約しない。
- 実装（engine-drain）: `EffectStep.repeat.additional` を floor 評価し native パスを追加実行する。`deck_reveal` は継続情報に固定済みの追加回数と次の反復 index を保存して、選択・残札配置後に同じ step の未実行回を再開する。他の pending action に `repeat` を載せるときは、この継続再開が実装済みかを個別に確認し、未対応なら静的に完了扱いにしない。`condition` は `evaluateCondition` 真でのみ追加、`braves_on_source` は発動元の合体ブレイヴ数。BSTH04-X02（強制反復）と BSTH09-TR01(B)（N 回の任意反復）は着地。
- 任意反復は `repeat.optional: true` で choice 化。固定1回は追加有無、動的0..N は対象数から追加回数を復元。追加コスト連動は `count_decrease selected_targets` + `repeat.executionAdditional` で選択回数分支払う。BSGE01-C08 は契約合体時とアタック時の双方で、この選択・再開経路を通じて解決する。

## 「N枚破棄するか、N枚になるように破棄する」

2026-09-13、BSAZ02-X02「ソリス」についてユーザーが「発揮側が2つから選ぶ」と回答（信頼度 C）。従来の自動キャップ解釈は撤回する。

- 発揮側が同じ効果の中で「固定 N 枚破棄」または「手札が N 枚になるまで破棄」を選ぶ。
- 固定枚数の分岐は `min(N, 手札枚数)`。N=3 のとき、手札4枚なら3枚、手札2枚なら2枚破棄する。
- 手札枚数を揃える分岐は `max(0, 手札枚数 - N)`。N=3 のとき、手札4枚なら1枚、手札2枚なら0枚破棄する。
- DSL は `choice` 内に `discard.count` と `discard.targetHandSize` を別々に置く。両式を `min` で合成して選択を省略しない。

根拠は保存原文と上記ユーザー回答。回帰対象: `packages/rules-core/test/bsaz02-x02-solis.test.ts`。この裁定を、選択構文のない「N枚以下になるように破棄する」へ広げない。

### 「本来のコスト」

公式 Q&A Q21662（信頼度 A）は、「本来のコスト」を**ブレイヴや効果でコストが変更される前の、カードに書かれているコスト**と定義する。同型の神域についても Q24243 は、合体しているブレイヴのコストを無視してカード記載コストを参照すると明記する。

実装含意: 「本来のコストが N 以上/以下」の単独条件は `CardFilter.costBasis: "printed"` で表す。効果によるコスト変更や合体ブレイヴのコストをこの判定へ加えない。

### 「本来のコストを含むコスト5～8」

BSTH02.7-M01について、2026-09-13ユーザー確認（信頼度 C）: 「印字と効果適用後の両方」。
印字コストと実効コストがそれぞれ5～8の範囲にあることを要求する。一方だけが範囲内でも対象にしない。

## 「BP0になった」(遷移) vs 「BP0の」(状態) — BPマイナス連動

（公式 Q&A 準拠、信頼度 A。BP-/BP+ 章 Q164・Q165・Q192・Q213。2026-06-16 同日の信頼度 C 仮ルールを訂正）

- **BP の基本**: BP-N で 0 以下でも BP0 扱い（Q164）。BP- は 0 でも消えず累積し後で BP+ してもマイナス分は残る（Q165）。**BP0 体にも BP- を発揮できる**（Q192 前提・Q213）⇒ 仮ルール「既に BP0 を BP マイナス対象に選べない」は**誤り・撤回**、BP0 体も対象に取れる現挙動が正。
- **「BP0になった」発火条件（Q192 で確定）**: 実効 BP が **この BP- で >0 から 0 へ遷移したとき**に限り発火。**既に BP0 の体に BP- してもマイナス値が増えるだけで発火しない**（効果前に 0 なら対象外）。
- 「BP-Nし、BP0になった〜を破壊/デッキ下」型（大半）= この遷移を満たした体のみ。広対象（相手全体 BP-N 等）でもその BP- で 0 に落ちた体は全部対象・既に 0 だった体だけ除外。「BP0の〜を破壊」型（少数）= 現在 BP0 すべて（状態）。

実装済み（[P3-104](../../../issues/archive/P3-104/index.md)）: `bp_modify` が実効 BP >0→0以下の対象を `StepResult.bpBecameZeroCardInstanceIds` に記録し、「BP0になった」後続は `TargetSpec.ref.result:"bp_became_zero"` で参照。「BPが0の」状態型は `maxBp:0` 再スキャン。

## 召喚コストすべてを支払ったものとする代替支払い

BSFT01-X01について2026-09-13ユーザー確認（信頼度 C）。「コスト＋N」「Nコストにする」などのコスト変更は変更後の全額を支払い済みとする。「Nコスト余分に支払う」という別途の追加支払いは残る。印字コストの分だけ減算する処理では表現しない。

## シンボル数を固定する効果

（公式 Q&A 準拠、信頼度 A。CB19 Q15011）

「シンボルを0にする」「シンボルを2つに固定する」等の固定値変更効果が有効な間は、ブレイヴ合体や「シンボル1つを追加する」効果ではシンボル数が変わらない。

実装含意: 単なる `symbols: []` の base 上書きではなく、追加シンボル・合体ブレイヴ集約より後まで効く固定ロックとして扱う。DSL は `override_properties.properties.symbolCountFixed` で表し、表示/軽減/バトル entity 再計算の全シンボル経路が同じ固定を参照する。

## 効果の継続性・反復スコープ

常時/継続 vs 誘発/即時の判定根拠、時間指定効果の継続、〔ターンに1回〕系、〔重複不可〕系は
[03e_effect-duration-and-repeat-scope.md](./03e_effect-duration-and-repeat-scope.md) を参照
（2026-07-18 サイズ分割）。

## Ver.17.0 省略表記の読み替え（新旧同義）

Ver.17.0 (2026-04-11 適用) でカードテキストの省略表記が導入された。テキスト→DSL 変換時は
以下を旧表記と**完全に同義**として読む（自動パーサーは存在しない。変換者が読み替える）:

| 新表記                  | 旧表記（同義）                        |
| ----------------------- | ------------------------------------- |
| 「1枚ドローする」       | 「自分はデッキから1枚ドローする」     |
| 「下から1枚ドローする」 | 「自分はデッキの下から1枚ドローする」 |
| 「Lv1-2-3」             | 「Lv1-Lv2-Lv3」                       |
| 「除外する」            | 「ゲームから除外する」                |

- 主語の無いドローは自分。「相手は1枚ドローする」は従来通り相手。
- キーワード効果（旧称: 属性専用効果）は同一カードが**同名効果を複数所持できる**（Ver.17.0）。各インスタンスは独立した効果として並列実装する（重複排除しない。P2-06 Phase 3 判定参照）。

## 召喚と配置の対象種別

[種別指定のない召喚・配置の対象範囲とDSL実装](../30_plan/03_completed-milestones-phase-6-summon-place-audit.md)（2026-09-08ユーザー仕様、信頼度B）。

## 主なソース

- `https://www.battlespirits.com/rule/official-rule-manual-eternal/page14.html` (効果テキスト解釈、信頼度 A)
- `https://www.battlespirits.com/news/2026/rule-manual-eternal17-revised.php` (Ver.17.0 省略表記、信頼度 A)
