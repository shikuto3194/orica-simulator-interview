# Open Questions

ソース不足の論点と過去の判断経緯をまとめる。取消線・確定済みの記録は現在の未解決件数に含めない。新しい確定裁定は該当ルール章へ反映し、ここには残る疑問と再開条件を残す。
実装上の選択は公式裁定と区別し、既存コードだけでルールの正しさを証明しない。

## P0

- バーストの reveal timing の細則
  - 実装影響: `revealedBurstStates`、burst 解決開始ログ、post-resolution cleanup の前後順。
  - 現状: `source-findings-official-battle-brave-burst.md` §7/§7b で set/reveal/post-resolution の主要ルールを裏取り済み。エターナル版 page12 から「発動宣言時はまだセット状態、解決時にバースト状態に遷移」「手札/トラッシュから効果で発動したバーストもバーストエリア扱い」「バースト状態はバースト対象効果以外を受けない」「【超装甲】【重装甲】でバースト効果を防げる」を確認。また Ver.15.0 の「ただちにバーストを発動できる」効果での発動宣言タイミング制限、Ver.6.0 のバースト効果+メイン/フラッシュ効果を「ひとつの効果」として扱う裁定も確認。post-resolution は「解決後も burst zone に残っているなら trash、解決中に別 zone へ移っていればその移動を優先」と整理。
  - 残る未解決: reveal/公開ログの厳密順の網羅、`このカードをコストを支払わずに使用する` 系の挙動、個別 post-resolution 例外の実カード網羅。これらは実カード追加時に対応する。
  - 公式再確認 (2026-06-09, `battlespirits.com/.../page12.html` Ver.17.1): set=ターン1回・発動宣言時はまだセット状態・解決時にバースト状態へ遷移・複数は発動順・コスト支払い不要・マジックは解決後トラッシュ、を再確認。**reveal 公開ログの厳密順と post-resolution 個別例外は公式マニュアルに明文なし**。
  - **実装内容で確定** (2026-06-09): 公式に逐語規定が無い deep-edge（reveal ログ厳密順・post-resolution 個別例外）は**現行実装をプロジェクト裁定として確定**。反例カードが出たら個別対応。

## P1

- スピリット召喚 / ネクサス配置の特殊例外カード
  - 実装影響: `summon` / `place_nexus` runner の例外分岐、カードタグ設計。
  - 現状: `03a_cost-payment.md` と `source-findings-official-turn-cost.md` で基本ルールは網羅済み。実装では `keywordTags.enter_field_core_placement_forbidden`、`enter_field_core_placement_rule/min/max`、`getHandWrittenEnterFieldCorePlacementPolicy(cardNo)` を使えるようにし、実例として `BS58-X09` / `BS59-X09` / `BS61-X09` / `BS58-071(A)` / `BS59-071(A)` を shared registry に追加済み。コア不要Lv維持カードなど他の個別例外を `keywordTags` と hand-written rule のどちらで持つかはカード追加時に判断する。
- フィールド上のマジックと手札使用マジックの差分をどこまで共通化するか
  - 実装影響: `CardInstance` の `zoneRoleName` と `actionKind`。
  - 現状: `03b_resolution-and-interrupts.md` に `resolveFieldMagicEffect` vs `useFieldMagicAsAction` の分離方針を記載。Q313/Q314 ベースで差は把握しているが、例外カード調査が未着手。
- ~~ライフにソウルコアがあるときの generic な core move の明示根拠~~ → 解消 (2026-06-09, 信頼度 C→**A**)
  - 実装影響: `resolveLifeDamage()` と `moveLifeCoreByEffect()` の対象選択、UI 表示、AI 向け合法手列挙。
  - 確定: generic「コア」は soul を含む（除外は「ソウルコア以外」明記時のみ。**BS35 Q22728**: ライフから減らすコアを soul→リザーブ / 通常→ボイドで**選べる**＝持ち主選択）。soul の硬い行き先制約は**ボイド不可のみ**（**BS36 Q5941**: 行き先がボイドなら通常コア強制で選択不可）。soul はライフ上に正常に存在でき（**BS74 Q30852**）、ライフ generic 移動でも持ち主が soul/通常を選ぶ。→ `moveLifeCoreByEffect` は「行き先がボイドか否か」で選択可否を分岐。詳細 [`06_core-system.md`](../10_rules/06_core-system.md)。
- ~~待機カード上のコアを支払い / 維持コア選択 / コア除去に使えるか~~ → **ユーザー裁定で確定** (2026-09-04、[正源](../10_rules/03f_stack-failure-and-waiting-cores.md))。
  - 使える。`cost_payment` 由来を除外する旧採択は撤回。残存コアは実移動時にリザーブへ置く。コア除去による再消滅・他の待機から消滅待機への変更はしない。
- 複数体同時アタック / 途中参加アタックの内部モデル
  - 実装影響: `activeAttack`、`attack` legal action、ブロック処理、ライフ減少順、`attack` 中の target 再指定や途中参加 participant 追加。
  - 現状: `source-findings-official-battle-brave-burst.md` §3/§3b に Q26329-Q26342, Q26718, Q26724, Q27706 ベースの裁定を集約済み。確認済みの主要裁定:
    - 途中参加で2体同時アタックになる
    - 2体のうち片方だけブロックされる（1バトルで1体しかブロックできない）
    - ライフ減少やBP比較は `⑤バトル解決` のまとまりとして扱い、その後に `⑥破壊` とバースト解決
    - 同時アタック中の `アタック時` 効果の解決順はターンプレイヤーが選ぶ
    - `アタックしたとき` は2回ではなく1回として数える
    - アタック由来のライフ減少とその派生効果による追加ライフ減少では `ライフが減らされたとき` が複数回発揮
  - 公式基本ルール確定 (2026-06-09, `battlespirits.com/.../page08.html` Ver.17.1): **基本ルールでは「アタックは1体ずつ行なわれる」「2体以上で同時にブロックすることはできない（一部例外の効果を持つカードあり）」**。→ 複数同時アタック/複数ブロックは基本ルールではなく**カード効果による例外**。上記 batspi Q&A 裁定はその例外カードの挙動規定として扱う（基本=単体、例外=カード付与、という二層で実装する）。
  - 残る未解決: 複数 participant の battle resolution group をどこまで厳密に state 化するか、custom で「1体の participant に複数 blocker が付く」ケースを scalar ではなく list で持つべきかどうか（公式基本ルールに該当規定が無く、例外カード本文に依存）。
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
  - 確定 (ソース: 独自サイト Q&A = precedence 最上位 / 信頼度 A、`external-qa/qaData.js` qa-029〜035): slot 上限は host カードが定義（ENIGMA=左右3+中央1=7枚）・**同名クォーツ2枚以上セット不可**・セットコストはカウント消費（C2=カウント-2、「支払わずに」表記が無ければ効果でも必須）・host 移動でクォーツも追従し**セット解除**・属性値7種（地火水風時空幻、色と別軸）・ENIGMA は BP 不在（BP0 ではない）でセット条件≠合体条件。詳細は [`07_custom-orica-mechanics.md` §4](../10_rules/07_custom-orica-mechanics.md)。残: 実装（専用モデル）はカード追加時。
- ~~宣言後・解決前のカードゾーン (`in_use`) の細則~~ → **実装内容で確定** (2026-06-09)
  - 実装影響: Zone 型の `"in_use"` 値、宣言から解決までの中間 zone 移動タイミング。
  - 確定: 公式は派生効果の解決前にカードを**提示**し解決後に場入り/トラッシュ（**BS33 Q5582** 等）という挙動を示すが、「in_use」という独立ゾーン名は使わない。公式に物理位置の逐語規定が無いため、**内部 `in_use` 中間ゾーン（コスト支払済みならキャンセル/不発でもトラッシュ、[03a_cost-payment.md](../10_rules/03a_cost-payment.md) 記載）を実装裁定として確定**。28,245 件の公式 FAQ にもステップ2〜5中の物理位置を明記する記述は無し。
- 独自カードサイトの errata / Q&A を card-data 運用へどう反映するか
  - 実装影響: `sourceUrls`、`updatedAt`、cache invalidation、cardNo ベースの差し替えフロー。
  - 現状: site には errata / Q&A payload があることを確認済み。手動反映で運用する。
- ~~BSSA01-XX01 の「このカード/ネクサス」併記はフィールド外のシンボルにも適用するか~~ → **ユーザー確認で確定** (2026-08-07, 信頼度 C)
  - 実装影響: `treat_as.appliesToCard`、`getEffectiveSymbolBundles()`、配置時の軽減要求枠。
  - 確定: 表向きである限り、フィールド外でも「このカード」の神シンボルを紫/白/黄としても扱う。手札から配置するときは、このカード自身の軽減要求枠も紫/白/黄として扱う。裏向きカードは null identity のため対象外。詳細は [`07_custom-orica-mechanics.md`](../10_rules/07_custom-orica-mechanics.md)。
- ~~redirect_effect_target (P3-47 F-4) と効果耐性 (defense_immune / cannot_be_X) の相互作用~~ → 解消 (2026-05-05)
  - 採択: **案 (a)** — candidate 集合解決時に source の `preventionLevel` で
    `filterTargetsByPreventionLevel` をかけ、defense_immune を持つ token を candidate から除外。
    redirect 自体不可とする。「防げない」(unpreventable) 効果は `canEffectPenetrateDefense`
    経由で defense_immune を貫通するため candidate に残る。
  - 採択理由: 「効果を受けない」状態の対象に効果を受けさせることはできない (「防げない」効果を除く)
    という前提に従う。UI に違法な redirect 選択肢を出さない・legal action 生成時の
    defense_immune 検査と一貫する点も利点。
  - 実装: `findApplicableTargetRedirects(state, resolved, actingPlayerId, sourcePreventionLevel)`
    に preventionLevel 引数を追加 (省略時 "none")。effect-interpreter は
    `options.sourcePreventionLevel` を渡す。テストは
    `redirect-effect-target.test.ts` に 4 ケース追加 (Step 2 describe)。
  - (b)/(c) 棄却: (b) は新対象側で再評価するという公式テキスト方向に近いが、(a) で
    候補段階で枝刈りすれば挙動として等価かつ UI が綺麗。(c) は「対象から外した」結果と
    矛盾するため不採用。

## P2

- 手元、重疲労、起導、Uトリガーなど特殊系ルールの参照モデル
  - 実装影響: 長期拡張性。
  - 現状: 手元は `08b_accel-change-zero-counter.md` のアクセル節で文書化済み。重疲労は `02_turn-flow-and-timing.md` のリフレッシュステップで言及。起導・Uトリガーは MVP 対象外。
- 効果分類ページを読んだうえでの「常在」「瞬間」「継続」「条件成立時待機」の正式分類
  - 実装影響: 内部 DSL 設計。
  - 現状: `always_on / activated / triggered / delayed / replacement` の独自分類を採用。
- スタンダード版ルールマニュアルにのみ記載されているルールの扱い
  - 「そうしたなら」(○○を完全に解決できたら△△する。完全達成条件)。エターナル版には「そうしたとき」(Q6) のみ記載。
  - 「起動」の▶構文 (▶前の部分を完全に解決できない場合、効果全体を発揮不可)。エターナル版に記載なし。
  - 実装影響: カード効果テキストの解釈。独自カードで必要になれば対応する。
  - 現状: エターナル版を正源とする。スタンダード版固有項目は対象外。
- 「可能なら最初にアタックする」等の強制アタック系イディオムの強制力範囲（`ENGINE-force-first-attack-this-turn`、BSTH02.7-TR02(A)）
  - 実装影響: `battle-availability.ts` の `force_first_attacker`。真の強制（interpretation A）: 対象カード自身が合法アタック宣言可能な間、他カードのアタック宣言 (`getAttackDeclarationBlockReason`) だけでなく、誰にもアタックさせずアタックステップを終了する選択 (`getAvailableEndAttackStepLegalActions`) も抑止する。
  - **ユーザー裁定で確定** (2026-07-07, `needs-ruling.jsonl` ENGINE-force-first-attack-this-turn、resolution=A): interpretation A（真の強制）採用。「可能なら〜する」型の終止形イディオムは強制と扱い、対象が宣言可能な間は誰もアタックさせずにアタックステップを終える抜け道を許さない。B（ソフトな強制）への revert は不要。BSRK01-C05 型・【超・激突】型等の同種イディオムにも本裁定を適用する。

## 保留でよい前提

- ターン順は
  - `Start -> Core -> Draw -> Refresh -> Main -> Attack -> End`
  として進める。
- 詳細マイクロステップや高度な割り込み順序は別途調査する。
  - スタック窓・フラッシュ優先権ループの設計は `20_design/08_stack-window-and-priority-loop.md` に整理済み。
