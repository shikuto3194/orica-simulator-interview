# Open Questions

ソース不足の論点と過去の判断経緯をまとめる。取消線・確定済みの記録は現在の未解決件数に含めない。新しい確定裁定は該当ルール章へ反映し、ここには残る疑問と再開条件を残す。
実装上の選択は公式裁定と区別し、既存コードだけでルールの正しさを証明しない。公式FAQの原文確認は [出典索引](source-map.md) と各裁定の出典を参照。ローカルの旧複製は取得時点の内容。

## P0

- バーストの reveal timing の細則
  - 実装影響: `revealedBurstStates`、burst 解決開始ログ、post-resolution cleanup の前後順。
  - 現状: `source-findings-official-battle-brave-burst.md` §7/§7b で set/reveal/post-resolution の主要ルールを裏取り済み。エターナル版 page12 から「発動宣言時はまだセット状態、解決時にバースト状態に遷移」「手札/トラッシュから効果で発動したバーストもバーストエリア扱い」「バースト状態はバースト対象効果以外を受けない」「【超装甲】【重装甲】でバースト効果を防げる」を確認。また Ver.15.0 の「ただちにバーストを発動できる」効果での発動宣言タイミング制限、Ver.6.0 のバースト効果+メイン/フラッシュ効果を「ひとつの効果」として扱う裁定も確認。post-resolution は「解決後も burst zone に残っているなら trash、解決中に別 zone へ移っていればその移動を優先」と整理。
  - 残る未解決: reveal/公開ログの厳密順の網羅、`このカードをコストを支払わずに使用する` 系の挙動、個別 post-resolution 例外の実カード網羅。これらは実カード追加時に対応する。
  - 公式再確認 (2026-06-09, `battlespirits.com/.../page12.html` Ver.17.1): set=ターン1回・発動宣言時はまだセット状態・解決時にバースト状態へ遷移・複数は発動順・コスト支払い不要・マジックは解決後トラッシュ、を再確認。**reveal 公開ログの厳密順と post-resolution 個別例外は公式マニュアルに明文なし**。
  - **実装内容で確定** (2026-06-09): 公式に逐語規定が無い deep-edge（reveal ログ厳密順・post-resolution 個別例外）は**現行実装をプロジェクト裁定として確定**。反例カードが出たら個別対応。

## P1

- ~~スピリット召喚 / ネクサス配置の特殊例外カード~~ → 旧カード番号別の登録を廃止。独立コア管理または `keywordTags` で判定
  - 現状: 基本ルールは `03a_cost-payment.md` と `source-findings-official-turn-cost.md`。例外は `enter_field_core_placement_forbidden` / `_rule_*` / `_min_*` / `_max_*`（`zone/enter-field-placement-policy.ts`）で表し、使用例は BSAZ02 / BSES01 / BSLH01 のカード定義。hand-written の登録機構（旧 `getHandWrittenEnterFieldCorePlacementPolicy` と shared registry）は P3-70 G で撤去済み。`BS58-X09` 等は `index.test.ts` の合成 fixture。
  - 残る未解決: コア不要Lv維持カードなど他の個別例外は、カード追加時に同じタグで表せるか判断する。
- ~~フィールド上のマジックと手札使用マジックの差分をどこまで共通化するか~~ → 「発揮」と「使用」の分離は実装済み（`card-effect-system.ts` の `isOperationMagicDefinition` / `finishOperationMagicFieldUseIfReady`）
  - 現状: 裁定は [07b §6 タイプ：作戦](../10_rules/07b_card-observed-mechanics.md) と `03b_resolution-and-interrupts.md`（旧記載の `resolveFieldMagicEffect` / `useFieldMagicAsAction` という関数は存在しない）。Q313/Q314 は公式原文未確認。作戦以外の例外カードは実カード追加時に確認する。
- ~~ライフにソウルコアがあるときの generic な core move の明示根拠~~ → 解消 (2026-06-09, 信頼度 C→**A**)
  - 実装影響: `resolveLifeDamage()` と `moveLifeCoreByEffect()` の対象選択、UI 表示、AI 向け合法手列挙。
  - ソウルコアをライフに置くには名指しが必要。ライフから取り除く場合、許された行き先なら持ち主が通常／ソウルを選べる（公式BS35 Q22728の個別例）。ボイドには置けない（公式BS36 Q5941）。[06 コア](../10_rules/06_core-system.md) を参照。
- ~~待機カード上のコアを支払い / 維持コア選択 / コア除去に使えるか~~ → **ユーザー裁定で確定** (2026-09-04、[正源](../10_rules/03f_stack-failure-and-waiting-cores.md))。
  - 使える。`cost_payment` 由来を除外する旧採択は撤回。残存コアは実移動時にリザーブへ置く。コア除去による再消滅・他の待機から消滅待機への変更はしない。
- ~~複数体同時アタック / 途中参加アタックの内部モデル~~ → 解消（P2-05 完了、2026-07-12）
  - 確定: 基本ルールは1体ずつのアタックで、同時アタック・複数ブロックはカード効果による例外（二層）。裁定と引用は [05b](../10_rules/05b_multi-attack-designated-attack-lifecap.md) と `source-findings-official-battle-brave-burst.md` §3/§3b。[エターナルVer.17.0公式PDF](https://asia-en.battlespirits.com/pdf/official-rule-manual_eternal.pdf?ver.17.0=) の Attack Step で基本手順を確認。
  - 実装: 1 participant に複数 blocker が付くケースは `ActiveAttackBlockAssignment.blockedByEntityIds: string[]`（`model.ts`）の list で持つ。経緯は P2-05。
- ~~指定アタック成立後の block-side 即時効果の積み順~~ → 解消 (2026-06-09, 信頼度 **A**)
  - 実装影響: 強制ブロック宣言直後に `ブロック時` / `バトルしたとき` / 途中参加系をどの順で `battleImmediateEffects` へ積むか。
  - 確定: 同時に発揮する block-side 効果は **ターンプレイヤーが順番を指定して解決**（**BS30 Q19406**: ブロック時効果と「ブロック時に破壊した合体の破壊時効果」は同時＝ターンプレイヤー順）。→ 同時誘発と同じ順序選択モデルで積む。注意: 解決順で下流が変わりうる（**BS26 Q4882** BS26-037 海獣ケートス: 【合体時】を先に解決すると「ブロックされなかったことになる」ため相手の『ブロック時』が不発）。
- ~~ギミック `星霊衣 / アルドノアドライブ / タイプ：作戦 / 分身スピリット` の汎用ルール~~ → **全て確定 (2026-06-09)**
  - 実装影響: host-subcard model、temporary treated-as、proxy card、separate zone/mode 設計。
  - **`分身` → 公式確定 (信頼度 A)**: 公式 FAQ「汎用 -【分身】編」(Q782 ほか87件、`external-qa-official/_freeword-分身.md`)。定義・【分身：N】・緑シンボル・スピリット対象効果可/合体不可・バニラ扱い・破壊/戻りで表向きトラッシュ・召喚ではない・入れ替え不可・内容非統一 を確定。詳細 [`07b_card-observed-mechanics.md` §5](../10_rules/07b_card-observed-mechanics.md)。
  - **`星霊衣 / アルドノアドライブ / タイプ：作戦` → 独自確定 (信頼度 B = カード本文 + ユーザー裁定)**: 公式 FAQ 0件（作戦は名称部分一致のみ）＝独自。星霊衣=B面アンダーレイ（裏面=B面・表向き公開、B面なしは置けない、フラッシュ挿入/入れ替え、離脱で破棄、入れ替え後は正規合体ブレイヴ）／アルドノアドライブ=表向き非合体 enabler（host 離脱は host と同じ場所へ追従）／タイプ：作戦=非アクティブ場マジック（元々マジックを使える窓だけ合法化、マジック/カード対象のみ被対象）。詳細 [`07b_card-observed-mechanics.md` §6](../10_rules/07b_card-observed-mechanics.md)。
  - 教訓: 製品別 prodname 収集は **汎用ルール Q&A を取りこぼす**。汎用概念は **freeword 検索**（`harvest-official-faq.mjs --freeword <語>`）で確認する。
- ~~独自ギミック `クォーツ` の slot / host inheritance / remove 条件の細部~~ → 解消 (2026-06-09)
  - 実装影響: set host model、count コスト、host 移動時処理、セット解除条件。
  - 確定 (ソース: 独自サイト Q&A = precedence 最上位 / 信頼度 A、`external-qa/qaData.js` qa-029〜035): slot 上限は host カードが定義（ENIGMA=左右3+中央1=7枚）・**同名クォーツ2枚以上セット不可**・セットコストはカウント消費（C2=カウント-2、「支払わずに」表記が無ければ効果でも必須）・host 移動でクォーツも追従し**セット解除**・属性値7種（地火水風時空幻、色と別軸）・ENIGMA は BP 不在（BP0 ではない）でセット条件≠合体条件。詳細は [`07_custom-orica-mechanics.md` §4](../10_rules/07_custom-orica-mechanics.md)。
  - 実装済み（`quartzSetStates`、`quartz-system.test.ts` ほか）。入れ替えは [07g](../10_rules/07g_quartz-replacement.md)。qa-029〜035 は独自サイト原文（`orika-react/src/qaData.js`）で照合済み。
- ~~宣言後・解決前のカードゾーン (`in_use`) の細則~~ → **実装内容で確定** (2026-06-09)
  - 実装影響: Zone 型の `"in_use"` 値、宣言から解決までの中間 zone 移動タイミング。
  - 実装では提示中のカードに内部 `in_use` を使う。支払い後の解決不成立と、宣言違法化で宣言・支払いを取り消す場合の違いは [03f](../10_rules/03f_stack-failure-and-waiting-cores.md) を参照。公式 BS33 Q5582 は提示・解決後の移動の先例。
- 独自カードサイトの errata / Q&A を card-data 運用へどう反映するか
  - 実装影響: `sourceUrls`、`updatedAt`、cache invalidation、cardNo ベースの差し替えフロー。
  - 現状: site には errata / Q&A payload（原本 `orika-react/src/errataData.js` / `qaData.js`）がある。取込済み `cardData` ミラーは `scripts/audit-mirror-provenance.json`（revision・sha256・補正）を `card-source` gate が検査する。errata / Q&A の card-data への反映は手動（自動同期は一部項目のみ、`scripts/sync-combined-boost-from-orika-react.mjs` 等）。
- ~~BSSA01-XX01 の「このカード/ネクサス」併記はフィールド外のシンボルにも適用するか~~ → **ユーザー確認で確定** (2026-08-07, 信頼度 C)
  - 実装影響: `treat_as.appliesToCard`、`getEffectiveSymbolBundles()`、配置時の軽減要求枠。
  - 確定: 表向きである限り、フィールド外でも「このカード」の神シンボルを紫/白/黄としても扱う。手札から配置するときは、このカード自身の軽減要求枠も紫/白/黄として扱う。裏向きカードは null identity のため対象外。詳細は [`07_custom-orica-mechanics.md`](../10_rules/07_custom-orica-mechanics.md)。
- ~~redirect_effect_target (P3-47 F-4) と効果耐性 (defense_immune / cannot_be_X) の相互作用~~ → 解消 (2026-05-05)
  - 採択: **案 (a)** — candidate 集合解決時に source の `preventionLevel` で `filterTargetsByPreventionLevel` をかけ、defense_immune を持つ token を candidate から除外（redirect 自体不可）。「防げない」(unpreventable) 効果は `canEffectPenetrateDefense` 経由で defense_immune を貫通するため candidate に残る。
  - 理由: 「効果を受けない」状態の対象に効果を受けさせることはできない（「防げない」効果を除く）。UI に違法な redirect 選択肢を出さず、legal action 生成時の検査と一貫する。(b)(c) は (a) で候補段階に枝刈りすれば等価、または「対象から外した」結果と矛盾するため棄却。
  - 実装: `findApplicableTargetRedirects(..., sourcePreventionLevel)`（省略時 "none"、`effect-interpreter` が `options.sourcePreventionLevel` を渡す）。テストは `redirect-effect-target.test.ts` の「案 (a)」ケース。

## P2

- 手元、重疲労、起導、Uトリガーなど特殊系ルールの参照モデル
  - 実装影響: 長期拡張性。
  - 現状: 手元は `08b_accel-change-zero-counter.md` のアクセル節、重疲労は `02_turn-flow-and-timing.md` のリフレッシュ節で文書化済み。起導・Uトリガーは専用実装なし（`packages/` に該当語0件、MVP 対象外）。
- 効果分類ページを読んだうえでの「常在」「瞬間」「継続」「条件成立時待機」の正式分類
  - 実装影響: 内部 DSL 設計。
  - 現状: `activated / triggered / continuous / replacement / delayed` の独自分類（`model.ts` の `EffectCategory`）を採用。発揮タイミングは別軸の `Timing.kind`（[12_dsl-specification §軸2](../20_design/12_dsl-specification.md)）。
- スタンダード版ルールマニュアルにのみ記載されているルールの扱い
  - 「そうしたなら」(○○を完全に解決できたら△△する。完全達成条件)。エターナル版には「そうしたとき」(Q6) のみ記載。
  - 「起動」の▶構文 (▶前の部分を完全に解決できない場合、効果全体を発揮不可)。エターナル版に記載なし。
  - 実装影響: カード効果テキストの解釈。独自カードで必要になれば対応する。
  - 現状: エターナル版を正源とする。スタンダード版固有項目は対象外。
- 「可能なら最初にアタックする」等の強制アタック系イディオムの強制力範囲（`ENGINE-force-first-attack-this-turn`、BSTH02.7-TR02(A)）
  - 実装影響: `battle-availability.ts` の `force_first_attacker`。真の強制（interpretation A）: 対象カード自身が合法アタック宣言可能な間、他カードのアタック宣言 (`getAttackDeclarationBlockReason`) だけでなく、誰にもアタックさせずアタックステップを終了する選択 (`getAvailableEndAttackStepLegalActions`) も抑止する。
  - **ユーザー裁定で確定** (2026-07-07, `needs-ruling.jsonl` ENGINE-force-first-attack-this-turn、resolution=A): interpretation A（真の強制）採用。「可能なら〜する」型の終止形イディオムは強制と扱い、対象が宣言可能な間は誰もアタックさせずにアタックステップを終える抜け道を許さない。B（ソフトな強制）への revert は不要。BSRK01-C05 型・【超・激突】型等の同種イディオムにも本裁定を適用する。
- ~~神喰カウントの保護分を、系統「神喰」を持たない発揮元が「数える」参照から除くか~~ → **ユーザー裁定で確定** (2026-11-01、[正源](../10_rules/07h_protected-count-visibility.md))
  - 現実装（`model.ts` の `countValueVisibleToEffect`＝保護分を除く）のまま確定。根拠はカード文面からの推論（信頼度C）。契約創界神のLvとブレイヴ条件は総量のまま、該当カードで差が出たら再確認する。

## 保留でよい前提

- ターン順は
  - `Start -> Core -> Draw -> Refresh -> Main -> Attack -> End`
  として進める。
- 詳細マイクロステップや高度な割り込み順序は別途調査する。
  - スタック窓・フラッシュ優先権ループの設計は [08_stack-window-and-priority-loop.md](../20_design/08_stack-window-and-priority-loop.md)（実装は [08a](../20_design/08a_stack-window-implementation.md)）に整理済み。

## 使用会計（P3-170 の確認事項）

現行挙動を信頼度 C で暫定保存（経緯: `issues/archive/P3-170/history-2026-11.md`）。

- 数量枠の基準が経路で不揃い（契約「実量」と乖離、history H7）: BP 閾値枠は予定量、効果起因の累積は完全置換でも原量、シンボル制限は試行量を加算。`forcedUnpreventable` の実減少は `life_reduced_this_turn` が偽のまま。
- 追加アタック権: 疲労していない付与元の通常アタックでも 1 つ消費。同時アタックの追加参加体は未配線の疑い。
- I06 tapless は世代・付与元違いの同一個体を 1 予算に畳む。I07 複数コピーは個体別枠。
- 同名カードの共通部分は共有し、差分は別枠とする裁定を [03e](../10_rules/03e_effect-duration-and-repeat-scope.md) に反映済み。実装差は [使用会計](../20_design/20_effect-usage-accounting.md)。
- 神技の宣言取消で回数を戻すか、効果内煌臨が `declareUsageLimit` を消費するか、煌臨枠の使用者別（03e 準用）。
- private 宣言済み誘発は払い戻し情報を作らない。
- ミラージュ免除・追加アタック権・コネクトバトル権の相手への公開は旧 state の引継ぎ（`01b` に明記なし）。
