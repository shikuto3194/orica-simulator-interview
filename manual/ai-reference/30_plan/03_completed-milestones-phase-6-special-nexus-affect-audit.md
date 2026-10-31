# 創界神系に作用する効果の全監査（2026-09-20）

親索引: [Phase 6](03_completed-milestones-phase-6.md)。ルール正源: [08d](../10_rules/08d_grandwalker-nexus.md)、[効果抑止](../10_rules/08d1_grandwalker-effect-suppression.md)、[導界者 qa-002](../10_rules/07_custom-orica-mechanics.md)。先行の[参照監査](03_completed-milestones-phase-6-special-nexus-reference-audit.md)と区別し、今回は作用対象・固有効果の発揮経路を監査した。

## 母集団と再現方法

- 裏面展開後634定義。創界神8・導界者20・創界石5の計33定義を確認。神技/導技/契約技、専用神託/導託/解封/転醒、導域hook、通常DSL効果、転神等で付与された効果を対象とする。
- 修正前は118カード・160箇所の特殊ネクサス対象指定。修正後は117カード・159箇所。全31個の `suppress_effect` action（21カード、裏面・選択肢を含む）も照合した。
- `node scripts/audit-special-nexus-affect.mjs > artifacts/special-nexus-affect-audit.json` で全件のカード番号・定義パス・作用種・filterを再出力できる。生成物は追跡せず、スクリプトを正源とする。
- 対象指定だけでなく、本文/textRefに創界神・導界者・創界石があるのに指定がない破壊・移動・修飾の候補、`hasMechanic:grandwalker` / `grandwalkerKind` / 系統制限、ネストした付与効果と神技も逆引きした。残った候補は別節への作用、場外回収、相手ターン専用枝、支払い元または存在参照だった。

## 裁定と修正

| 論点 | 根拠・判断 | 修正 |
| --- | --- | --- |
| 創界神の効果抑止 | 公式エターナルQ23202 A「いいえ、発揮できません。」。Q23201 Aでは対象制限・コア管理の共通ルールは残る | 神託に加え専用の解封・創界石転醒・紫苑のスタック反応導域を、検出・合法手・宣言・解決で共通抑止判定へ接続 |
| 導界者への作用 | 独自qa-002 A。作用系への一般化は07記載の2026-08-02裁定 | BSGE01-M01の破壊、M03/M04のコア除去、BSLH01-X08自分ターンの抑止・デッキ戻しから導界者を除外する誤った限定を削除 |
| 創界神へのコア追加 | qa-002 A「創界神ネクサスにコア+1する」効果で導界者には置けない | BSTH05-M03とBSTH11-R03の6系統の配置先に `grandwalkerKind:grandwalker` を追加。創界神/導界者の両種を持つ龍神は対象 |
| 創界神を明記しない抑止 | 08d・07の対象制限を適用 C。対象制限は「防げない」でも消えない | BSAZ02-C03のデッキオープン抑止で、根拠なく創界神だけを対象へ加えていた指定を削除。場外のカードには引き続き適用 |
| 転神・転者で得た効果 | 被付与カード自身の効果として抑止を適用 C | 通常の付与誘発・付与起動の列挙/宣言/解決も同じ判定へ。発揮元種別は実カードから決定し、ネクサスへの付与起動がスピリット扱いでエラーになる問題も修正。BSTH05-X01の転神で得たアタック時効果を実カードで検証 |
| 効果内容を限定した抑止 | DSLの `containsActionKinds` と同じ意味を神技にも適用 C | 神技のdescriptorへ実効果内のaction種を集約。対象選択・効果文内コア支払いより前に抑止可能 |
| 無条件常時効果 | Eternal Ver.17.0、03b「発揮場所・発揮条件のない常時効果」は無効化できない | シンボル追加扱い、および紫苑Lv1-Lv2の青マジック支払い導域は維持。Lv2のスタック反応導域は誘発なので抑止 |

独自本文確認: `external-qa/cardData.js` の対象カード番号、`external-qa/qaData.js:17-24`。公式本文: `external-qa-official/BS54.md:841-870`、[公式BS54](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=BS54)。公式のデッキオープンfreewordもharvestし2件取得したが、この対象制限の直接個別Q&Aではないため、BSAZ02-C03は基本ルール適用 Cとして記録する。独自サイト: [Battle Spirits Eternal](https://dancing-pixie-db5cc3.netlify.app/)。

## 作用経路の照合結果

以下の件数は修正後inventoryのfilterノード数であり、効果数とは異なる。OR枝・条件ノードを別々に数える。

| 経路 | 件数 | 確認内容 |
| --- | ---: | --- |
| core_move / core_distribute / core_set_to_level | 48 / 5 / 1 | 入れる側と取り除く側を区別。創界石は別軸。field_card・union・target_card・支払い元の候補と実移動は既存core/target SSOTを通る |
| destroy / bounce / send_to_deck | 25 / 1 / 4 | 通常ネクサス・創界神/導界者・創界石の明記、onlyとOR枝、場外カード扱い、耐性を照合 |
| exhaust / recover / set_exhaust_state | 2 / 2 / 1 | 創界神に作用する効果は導界者も受ける。通常対象指定だけで転神した創界神を選べない |
| override_properties / bp_modify / symbol_add | 7 / 1 / 1 | Lv維持コスト・色/コスト/シンボルの動的適用も対象制限を保つ |
| effect_immunity / effect_resistance | 1 / 1 | 付与先の対象制限と発生源参照を分離。抑止自体への耐性は共通再評価で判定 |
| divine_transform / grant_effect | 1 / 1 | 転神状態と付与効果を分離。既に転神済みでも付与された誘発は抑止される |
| suppress_effect | 10 | 直接対象・ref・動的全体・双方・field外を全31actionと照合。創界神/創界石を明記しない枝は既定対象外 |
| limit_cost_reduction / under_card_role_grant | 2 / 2 | 軽減供給元の参照と付与先への作用を区別。下カード付与先も既存target判定を通る |
| deck_reveal / search_zone / summon | 20 / 1 / 1 | 場外検索はカードとして照合。ネクサスカードの種別限定や特殊ネクサスを原資にする明示指定は維持 |
| reference/definition | 21 | イベント・存在条件・合体条件・顕現条件。先行Q1532の参照修正を維持し、作用制限を条件へ戻さない |

### 明記された抑止と除外境界

- BSLH01-X08: 自分ターンのみ創界神/導界者まで。相手ターン枝は通常対象のみ。
- BSSG01-R02: 相手の通常ネクサス/創界神/導界者。創界石は含まない。
- BSTH02.7-C01: 相手の通常ネクサス/創界神/導界者/創界石と、場外のミラージュ。step/turnの各経路を維持。
- BSTH04-転醒R01(A): 両者の実効6色の創界神/導界者まで。創界石は含まない。B面は創界神の明記がないため通常対象のみ。
- 残りの通常カテゴリ・召喚時・見出し・場外カードの抑止は、各対象種別とzoneの既定制限を維持。無条件常時効果の例外は共通判定を使用する。
- BSTH05.5-M03は「創界神/導界者1つずつ」の独立指定なので、創界神側の種別限定を維持。場外の創界神カードの検索と、創界神の存在条件も導界者一般を含めない。

## 検証

- `special-nexus-affect-audit.test.ts`: 全33定義、抑止の検出/宣言/解決、期限切れ、耐性、創界石の別対象軸、実際の解封条件、転醒コア・カウント、紫苑のデッキ破棄、転神付与、作用対象・コア配置先の正負例。
- 既存の神託/神技・創界石・転神・各弾のテストを実行。旧テストに残っていた導界者除外の期待値もqa-002に合わせた。
- GUI/REST: `grandwalker-effect-suppression.spec.ts` と `special-nexus-affect-audit.spec.ts`。`?scenario=grandwalker-suppression` を起点に、後者はdev APIへ解封待ちの盤面を投入。抑止中は窓もコア移動もなく、解除後はAlice GUIの解封・転醒とBob RESTの応答で鏡3→4コア→金龍1コア、カウント0→1を確認。画面も金龍の表示まで確認する。
- 完了ゲート: `pnpm codex:finish-check:full`。結果・commitはタスク完了報告を参照。

現行母集団に対する監査であり、将来追加されるカードの裁定を先取りしない。今回の修正で新しいDSL・状態フィールドは追加していない。
