# Resolution And Interrupts

> コスト計算・支払いソース・標準パイプライン・配置時コア配置等は [03a_cost-payment.md](./03a_cost-payment.md) を参照。

## 効果テキスト表現の解釈ルール

[03c_effect-text-interpretation.md](./03c_effect-text-interpretation.md) へ分割（2026-06-12）。「する」vs「できる」（強制/任意、可能形文言の裁定）・効果の優先順位・効果防止の優先順位・ことで構文/そうしたとき構文・「さらに/その後/この効果発揮後」は 03c、人称判定・発揮前提ゲートは [03d](./03d_effect-target-and-prerequisite-gates.md)、常時/継続 vs 誘発/即時判定・時間指定効果・〔ターンに1回〕/〔重複不可〕は [03e](./03e_effect-duration-and-repeat-scope.md) を参照。

## 実行不能時の巻き戻し

### 発揮不能キューと不発の区別（SSOT）

2026-09-22 ユーザー確認（C）: 「発揮できないキューは残さないこと。これSSOTに追加　※不発とは区別せよ」。未宣言の発揮候補は、共通の発揮資格判定で資格を失った時点でキューから除去する。表示を隠すだけ、スキップ操作を要求するだけ、古いイベントを保持して後で再提示する処理にしない。「残る」による待機解除で発揮できなくなった別効果も含む。

宣言済みの効果が解決時に不成立となる「不発」はこの除去とは別で、宣言・支払い・使用回数と解決の通常処理を保つ。対象がいないだけで発揮可能な空撃ちや、内側の処理待ちで順序上選べない効果は「発揮不能」に含めない。発揮資格は `getAvailableTriggeredEffectSourceChoices()`、未宣言候補の除去は `pruneIllegalPendingTriggeredEffects()` に集約する。

2026-09-23 ユーザー報告・確認（B）: 召喚時効果の発揮宣言へスタックで応答し、その発揮元をフィールドから離した場合、召喚時は不発。対象・効果文内対価の選択前に発揮元の必要ゾーンを再確認する。これは未宣言キューの除去ではない。自身の離脱に伴う誘発の離脱前参照や、トラッシュ等を発揮場所に指定する効果は、それぞれの正規の発揮場所に従う。

2026-09-22 ユーザー補足（C）: 宣言前でも「1体破壊する」は対象0体だけを理由にキューから除去しない。「〜がいるとき、1体破壊する」は「〜がいるとき」という発揮条件が未達なら除去する。対象候補数を発揮条件に読み替えない。

### 巻き戻しの条件

- 手札から使用を宣言したカードは、可能な限り実行しなければならない。
- スタックタイミングを介さず、計算ミスで途中から絶対にコア不足だと判明した場合は、メインステップの通常召喚や【神速】なら手札やコアを宣言前の状態に戻す。その他の効果による召喚なら、召喚を含む効果は解決され、提示したカードは行き先が書かれていなければトラッシュに置かれる。
- スタック窓後の必要コア不足では、召喚不成立のままトラッシュへ置く。宣言自体が違法になった場合だけ宣言・支払いを取り消し、スタック効果の結果は維持する（2026-09-04 ユーザー裁定、[03f](03f_stack-failure-and-waiting-cores.md)）。

実装メモ: `dryRunValidation` と `applyCommit` を分け、中途半端な支払い状態を残さない。

実装メモ: `legal-actions-apply.ts` の `tryApplyLegalAction()` は例外時に元の `options.state` とエラーを返す。これは単一アクションの例外安全性であり、スタック窓後の巻き戻し条件を定めるものではない。

## 常在効果の割り込み

通常は解決中の効果に新規効果は割り込まない。ただし `発揮されない` / `効果を受けない` のような常在系は、解決中でも後続部分を止め得る。

## 常時効果の無効化ルール (Ver.17.0 追加)

- 発揮場所・発揮条件のない常時効果（= 常に発揮されている効果）は、「効果を発揮できない」効果によっても**無効化できない**。
- ただし、「防げない」効果の機能は常時効果に対しても適用可能。
- 例: 「このスピリットのシンボルは赤としても扱う」のような条件なし常時効果は、「効果を発揮できない」で止められない。一方「このスピリットの破壊は防げない」は適用される。

実装メモ:

- `EffectFilterTag` の `suppress_effects` チェック時に、対象効果が「発揮場所・条件なしの常時効果」かどうかを判定する。
- 常時効果で `activationCondition == null && activationLocation == null` なら `suppress_effects` フィルタを無視する。
- `EffectPreventionLevel: "unpreventable"` は常時効果に対しても通常通り適用する。

実装状況: 型定義済み:

- `EffectReevaluationTiming` (`"before_each_step"` | `"after_sba"` | `"after_trigger_resolution"`)
- `EffectReevaluationCheckKind` (`"target_validity"` | `"effect_suppression"` | `"prevention_clash"`)
- `EffectReevaluationFailurePolicy` (`"skip_step"` | `"abort_remaining"` | `"remove_target"`)
- `EffectReevaluationPoint` を `model.ts` に追加済み、全効果登録型に `reevaluationPoints?` あり
- ヘルパー: `runReevaluationAtTiming()` / `executeReevaluationCheck()`（`target_validity` 実装済み、`effect_suppression` / `prevention_clash` は resolver 統合時に実装）

実装メモ:

- 効果解決中でも `recomputeContinuousEffects()` を節目ごとに挟む。
- 対象や後続テキストの有効性を再評価できるようにする。

## 付与（効果を与える）の持続タイプ（裁定 2026-06-14）

「他カードに効果を与える」付与の持続は、**付与テキストの型**で決まる（2分類）。付与元が場を離れたときの挙動が逆になるため取り違えない。

1. **即時型持続効果**（「**このターンの間**、自分のスピリットすべてに『このスピリットのアタック時』〜を与える」のように**期間指定**を伴う）
   - 付与は**指定期間が切れるまで持続する**。**付与元が場を離れても消えない**（一度発揮された効果が独立した期間指定効果として盤面に残るため）。
   - DSL: `duration:{ scope:"turn" }` 等の明示 duration。

2. **常時型効果**（「自分のスピリットすべてに『このスピリットのアタック時』〜を与える」＝**期間指定なし＝発揮元の常在能力**）
   - **付与元が場を離れたら即座に消える**（合体ブレイヴ付与 [`04`:76](04_state-based-rules.md) 「付与は即座に停止する」と同じ）。
   - DSL: `duration:{ scope:"while_on_field" }`（既定）。

実装含意:

- grant_effect の `duration` はテキストの期間指定有無で決める。テキストに期間指定が無い付与だけを while_on_field（付与元在不在に追従）とする。
- `recomputeContinuousEffects()` は **while_on_field CE のみ**を付与元離脱で除去し、`turn` 等の**明示 duration CE は付与元の在不在に関係なく満了まで残す**（即時型を付与元離脱で誤除去しない）。

## マジック無効化と使用判定

- マジックの効果が無効にされても、「マジックを使用した」事実は残る。
  - コスト支払い済み、カードはトラッシュへ移動する。
  - 「マジックを使用したとき」を条件とする誘発は発動しうる。
- 効果無効化は「効果の発揮」を止めるが、「使用の宣言」「コスト支払い」「カードの後処理」は止めない。

実装状況:

- `ActiveStack.isNullified` フィールドを追加済み。`resolveDeferredMagicStack()` / `resolveDeferredFieldEffectStack()` で `isNullified === true` の場合、効果解決をスキップしトラッシュ移動のみ行う。
- `resolveDeferredStackAction()` の対象選択延期 (`getStackTargetSelection`) は `isNullified` のとき素通りする。対象選択は「効果の発揮」の一部のため、無効化済み効果はコントローラへ対象選択を要求しない（P3-75）。
- 実際に印を立てる配線は `markPendingStackActionNullifiedByCardInstance()`（咲夜 BSTH01-X05 の declare 時、3 種応答窓 + LIFO ネスト鎖を走査して該当 ActiveStack に印付け。P3-73）。
- 汎用ヘルパー `nullifyPendingStackAction()` は定義のみで現状 src からの呼び出しはない。

## フィールド上のマジック

- フィールド上のマジックは
  - `効果を発揮する`
  - `使用する`
  の差がある。
- 効果発揮だけなら場に残ることがある。
- 使用したなら、手札使用時と同様に場から離れたものとして扱い、特段の指示がなければトラッシュへ行く。

実装メモ:

- `resolveFieldMagicEffect` と `useFieldMagicAsAction` を分ける。

## 空撃ち

- マジック/効果の空撃ち（対象不在でも使用可能）は**原則可能**。
- 「1体を破壊する」の "1体" は条件ではなく効果範囲。対象がいなくてもカード使用自体は許容される。
- 空撃ちできないケース:
  - メイン効果をフラッシュタイミングで使用する場合（timing 窓フィルタで既に弾かれる）
  - 「○○のとき」の発動条件を満たさない場合（`evaluateCondition` で別途ガード）
  - 「ターンに1回」をすでに使用している場合（`canUseEffectByUsageLimit` で別途ガード）
  - **「○○することで△△する」(ことで構文) で △△ の対象が 0 体のとき**: コスト○○だけ払って効果なしは双方向ルール（[03c](./03c_effect-text-interpretation.md) ことで構文 節）で禁止。
- 空撃ちは戦術的に活用される（例: BP比較を避けるためにフラッシュマジックを空撃ち）。

実装メモ（実装済み）:

- 各効果タイプの legal action 生成（`legal-actions-availability.ts` の誘発 / 発揮型 / フラッシュ / 戦闘即時 / マジック）で、対象数ガードを共有ヘルパー `resolveEmptyFireTargetCounts()`（`legal-actions-shared.ts`）に置換。候補が必要数未満でも「可能な限り選ぶ」に従い実効必要数＝候補数（0 体＝空撃ち）として action を生成する。
- ことで構文（`connector: "conditional_cost"` の効果側）は登録時に `targetGatedByConditionalCost` が立ち、対象 0 体なら空撃ちをブロックする。フラグは `extractFieldTargetingMetadata()`（`structured-effect-registrations.ts`）で対象 step の connector から伝搬。
- 解決側は対象 0 体で各 executor が no-op、ことでは `stepSucceeded=false` → コスト rollback（`effect-interpreter.ts` P3-62）で安全。
- 回帰防止: `packages/rules-core/test/empty-fire-no-target.test.ts`。

BSDB01監査追補（2026-09-13）: 任意の固定数破壊stepも、対価でなければ対象数不足や0体を理由に発揮を禁止しない。CX01の「破壊効果を発揮したとき」は実際に破壊した件数とは別に処理し、本文末または「効果発揮後」の派生解決境界で発揮を一度だけ通知する。任意破壊を辞退した場合は通知しない。出典と回帰は [BSDB01監査](../00_meta/source-findings-bsdb01-fidelity.md)。

### 複数対象の部分解決と耐性

- 宣言時に指定した複数対象の一部が解決時に効果を受けない場合、その対象だけを affect gate で除外し、残りには効果を可能な限り解決する。1体が耐性を得たことを理由に、宣言済み効果全体を不発にしない。
- 対象取得（指定できるか）と affect（効果を受けるか）は別判定。deferred stack の再検査は対象カードの存在と対象ゾーンだけを扱い、`effect_immunity` / prevention を missing target に読み替えない。
- 根拠: Q26241（`external-qa-official/SD01.md:137-140`）は必要数より対象が少なくても「効果は可能な限り実行」と明示する。Q7830（`external-qa-official/BS49.md:373-376`）は効果を受けない対象以外を処理しつつ、全対象を処理できなかった場合の「そうしたとき」だけを不成立とする。信頼度 A（公式FAQ逐語ミラー）。
- 実装: `resolveDeferredMagicStack()` の再検査は acquisition のみ。各 action executor の共通 affect gate が対象ごとの耐性を除外し、`affectedCardInstanceIds` が後続 step の成立数を保持する。

ドローのデッキ耐性（2026-10-24 ユーザー確認、信頼度 C）: 「ドローはデッキに影響を与える効果である」。カード効果のドローでは、指定された上/下の実カードに解決時の耐性を適用し、受けないカードはデッキに残す。残ったカードの代わりに指定範囲外のカードを引かず、実際の移動数だけ手札枚数・ドローイベントに反映する。通常ドローステップはスピリット/ネクサスのカード効果に含めない。根拠と回帰は [M03追補](../30_plan/03_completed-milestones-phase-6-bsaz02-audit.md#2026-10-24-m03のドロー耐性追補) を参照。

## BSDB01-C06「カメハウス」の後続条件

配置時の「さらに」のドロー/「かめはめ波」回収にも、魂状態を含む自分の「孫悟空」が必要。2026-09-13ユーザー回答「ドロー／回収にも孫悟空が必要」で確定したカード固有裁定（信頼度C）。既存DSLを維持し、孫悟空不在時には両処理を発揮しない。調査と回帰の参照先は [BSDB01監査](../00_meta/source-findings-bsdb01-fidelity.md)。

## 主なソース

- `https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q12120133112` (空撃ち、信頼度 B)
- `https://batspi.com/index.php?ルールＱ＆Ａ=`
