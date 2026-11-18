# Completed Milestones: Phase 6 — 全弾 effects 変換一巡（2026-06-07〜09）

このファイルは、Phase 6 の「TH 全ナンバリング弾 + SP 弾 + 他弾 / collab 弾の effects 変換一巡（2026-06-07〜09）と関連エンジン拡張」の完了履歴です。
索引は [03_completed-milestones-phase-6.md](./03_completed-milestones-phase-6.md) から辿ります。

## Phase 6: データと DSL — 全弾 effects 変換一巡 + 関連エンジン拡張

- BSTH05.5 東方緋想天 全14枚 effects 変換完了（2026-06-07）:
  - C04 [緋想天]アリス（既存）+ 残13枚追加。カード番号順、最小1テスト/カード（計42テスト全通過）。
  - 表現できた効果: デッキ除外（`move_card` deck→void）/ デッキ破棄（deck→trash）/ deck_reveal 複数 pick / 召喚時・アタック時の破壊・消滅・重疲労（`degree: heavy_exhaust`）/ effect_resistance（破壊耐性）/ バースト召喚（life_decrease）/ 系統付与（addTribes）/ デュアルシンボル追加 / treat_as シンボル多色 / 配置時コア移動 / 合体条件（M01: 天人＆コスト6以上＆アルティメット）/ 相手起因 leave_field の stay_on_field（conditional_cost）。
  - stub 化した DSL ギャップ: 導託/導界者(X02)・神託/創界神(XX01) 本体ルール（grandwalkerData 連携要）/ 導技・神技・導域・神域 / after-attack バーストトリガー（M03）/ 召喚コスト下限「0にならない」(C01) / 条件付きライフ下限保護(R10) / 「相手の効果は発揮されない」抑制(C10) / 効果記述限定。詳細は各 effect の `stub` 文言と P3-16 参照。

- BSTH06 東方地霊殿 全14枚 effects 変換完了（2026-06-07）:
  - C01/R02/転醒X01(A) の既存部分効果を補完 + 残カードを追加。最小1テスト/カード（計18テスト全通過）。
  - 表現: treat_as 多色シンボル（appliesToCard）/ core_distribute（遊精皇獣2体）/ deck_reveal / flash の exhaust(自身)コスト+draw/place choice / burst 重疲労2体+召喚 / discard(手元)-cost → recover / 相手手札すべて→手元(move_card hand→set_aside count:all) / rebirth(maxCount) / restrict_end_attack_step / bp_modify。
  - stub 化した DSL ギャップ: 導託/導界者(X01) 本体・創界石/解封(転醒X01) ・三歩必殺(連続バトル)・召喚/配置コスト下限・動的 maxBp=自身BP・「その後…軽減コスト条件召喚」(C03)・スタック効果コスト+1(M01)・地霊スピリット最高Lv扱い・導域。詳細は各 stub と P3-16 参照。
  - 2026-07-14: BSTH06-X03 effects[2] を追加実装。自身がアタック中のバトルフラッシュに限定し、バトルに1回、自身BP以下の相手スピリット/アルティメット1体を破壊。破壊対象自身の破壊時効果抑止と、破壊成功時の相手ライフ1コア→相手リザーブ移動を既存 primitive で表現。盤面変化・legal action・同一バトル usageLimit・誘発抑止経路をテストで確認し、combined stub 295→294。

- BSTH07 東方星蓮船 全16枚 effects 変換完了（2026-06-07）:
  - C01/C02/M01 の既存部分効果を補完 + 残カードを追加。最小1テスト/カード（計18テスト全通過）。既存 bsth07-c01-exhaust-cost テストの effects index を [0]→[1] に追従修正。
  - 表現: deck_reveal（幻想＆起幻 tribesLogic:"and"）/ burst（hand_increase / spirit_destroyed / effect_activated）/ conditional_result（破壊→ドロー）/ discard の choice（2枚 or 1枚絞り）/ prevent_battle（疲労コスト→アタック不可）/ prevent_life_damage / symbol_add（filterOr 対象）/ rebirth / negate(opponent_burst)。
  - stub 化した DSL ギャップ: 導託/導界者(X01)・創界石/解封/神秘(転醒X02)・転者(divine_transform 起動)・仮想プレイグ合体(R01 雲山)・転醒強制(R11)・条件付きライフ下限(R10)・創界神コア全除去(M03)・「効果記述を持つ」絞り(M02)。negate は consumer 未配線(no-op)。詳細は各 stub と P3-16 参照。

- BSTH07.8 妖精大戦争 全13枚 effects 変換完了（2026-06-07）:
  - 全カードを追加。最小1テスト/カード（計26テスト全通過）。
  - 表現: 「軽減シンボルは赤/紫/緑/白/黄/青としても扱う」= treat_as(reduction_symbol, appliesToCard)×6（妖精弾の共通虹化）/ deck_reveal（妖精導界者ネクサス + cardName exact「チルノ」/ minCost）/ 疲労コスト→ deck_reveal（field_lacks guided 条件）/ core_move（trash→自身 / void→ライフ / 相手reserve→trash / 相手life→reserve）/ prevent_battle（2体 attack+block）/ burst(bp_modify -5000 + summon)。
  - stub 化した DSL ギャップ: 導界者/導託/導域(XX01・X01界放)・霧の湖/妖精効果での自己回収・動的コスト減少（バトル中妖精数）・妖精スピリットの離脱置換(M01)・X02 の3回BP-5000+BP0破壊・オープン中限定系統付与・配置軽減制限(C03)。詳細は各 stub と P3-16 参照。

- BSTH08 東方神霊廟 全18枚 effects 変換完了（2026-06-07）:
  - 全カードを追加。最小1テスト/カード（計19テスト全通過）。
  - 表現: treat_as(シンボル/単色)/deck_reveal（exclude cardName で「特定名以外」絞り）/burst(spirit_destroyed・life_decrease → send_to_deck bottom + summon)/move_card デッキ破棄（DynamicCount count_value×5）/send_to_deck DynamicCount/bounce/symbol_add/recover(turn)/effect_immunity（超重装甲）/rebirth/core_distribute(phase アタックステップ開始時)。
  - stub 化した DSL ギャップ: 導界者/導託/導技/導域(X01・XX01)・after-attack burst(C04・C05)・創界神コア全除去・色限定超重装甲（effect_immunity 近似）・DynamicCount 上限cap(X02最大15・X03最大3)・差分ドロー(R01)・召喚時効果の全体抑制・複数ブレイヴ合体(C05)・トラッシュ耐性(C01)。詳細は各 stub と P3-16 参照。

- BSTH08.5 東方心綺楼 全13枚 effects 変換完了（2026-06-07）:
  - 能面/面霊 アクセルブレイヴ中心。全カードを追加。最小1テスト/カード（計21テスト全通過）。
  - 表現: braveCondition(面霊＆コスト6以上)×10 / アクセル効果本体（deck_reveal / draw+discard choice / destroy(symbolCount) / send_to_deck / search_zone(trash→hand) / end_attack_step / core_move(life→reserve battle_end)）/ 合体中 unblockable / treat_as(赤/導) / burst(life_decrease)+summon。
  - stub 化した DSL ギャップ: 【アクセル】手札使用ラッパ(accelData 連携)・手元(set_aside)常駐効果群・創界神/神託/神技/神域(X03)・手元からの合体/除外置換・Lv改変消滅(X02)・動的 maxBp(R11)。詳細は各 stub と P3-16 参照。

- BSTH09 東方輝針城 全16枚 effects 変換完了（2026-06-07）:
  - 妖戒/勇傑/付喪 アーキタイプ。R01 の既存 restrict_end_attack_step を補完 + 残カードを追加。最小1テスト/カード（計16テスト全通過）。
  - 表現: deck_reveal(cardName exact 桂斧/少名 針妙丸 + tribe 妖戒)/疲労コスト→deck_reveal/count_increase(疲労/離脱・召喚/配置時)/burst(life_decrease summon+end_attack_step・after-attack stub の bounce/destroy+summon)/bp_modify(-15000 / 弁々八橋条件で+10000)/move_card(trash→deck bottom 同名ターン1回)/rebirth/destroy/recover/symbol_add。
  - stub 化した DSL ギャップ: 手札/手元入れ替え・追撃・タップ無しアタック・after-attack burst・スタック割り込み(X01)・カード名対象 BP 修飾(弁々/八橋)・最高Lv扱い(X02)・全コア移動+複数ゾーン破壊(X01)。詳細は各 stub と P3-16 参照。

- BSTH09.2 東方求聞史記 全8枚 effects 変換完了（2026-06-08）:
  - 導界者/転醒中心。全カードを追加。最小1テスト/カード（計8テスト全通過）。
  - 表現: treat_as(シンボル/単色・赤緑)/deck_reveal(起幻赤緑導界者 + 幻想&起幻 tribesLogic and)/destroy(nexus targetsGrandwalker)/疲労コスト→draw/core_move(void→自身)/symbol_add(導域 filter minCost5)/rebirth。
  - stub 化した DSL ギャップ: 導託/導技/導域(X01・XX01)・転醒トリガー・相手Lv1ネクサスのシンボル0化・軽減シンボル補助・バトル状態連動バースト無効(転醒R03)。詳細は各 stub と P3-16 参照。

- BSTH10.5 東方憑依花 全3枚 effects 変換完了（2026-06-08）:
  - R21/R22 の既存メイン効果を補完 + X01 創界神を追加。最小1テスト/カード（計5テスト全通過）。
  - 表現: override_properties(addTribes 幻想)/draw+discard/negate(summon, targetFilter category+maxCost)/treat_as(青)。
  - stub: 創界神/神託/導域(X01)・negate(consumer 未配線 no-op)・使用条件（ライフ5以上で不可）。詳細は各 stub と P3-16 参照。
  - これで **TH ナンバリング弾（BSTH01〜BSTH10.5、9 種の追補弾含む）の effects 変換が一巡完了**。次は SP 弾 BSTH001〜。

- BSTH001 東方靈異伝 14枚中13枚 effects 変換完了（2026-06-08）:
  - SP 弾（靈異伝）。転召/創界石/解封 中心。最小1テスト/カード（計16テスト全通過）。
  - 表現: treat_as(symbol+reduction_symbol デュアル面)/deck_reveal/override_properties(addTribes)/疲労コスト→draw/destroy(nexus / maxBp / battleState blocking / suppressDestroyedEffects)/recover/effect_immunity(field_lacks grandwalker 条件)/rebirth。
  - stub: 転召(imagin 召喚コスト)・創界石/解封/神秘・創界神シンボル0化・条件付きネクサス配置・ドロー枚数修飾・コア除去パラメータ修飾・unpreventable・negate。
  - **転醒R03(A) エリス（蝙蝠形態）は A 面 textLines がプレースホルダー("表面の効果テキスト")で effects 未追加**（Task D データ欠落、P3-16 残留懸念に起票）。

- BSTH002 東方封魔録 全13枚 effects 変換完了（2026-06-08）:
  - ミラージュ/封魔/転召/転醒 中心。最小1テスト/カード（計13テスト全通過）。M01 は cardNo "BSAZ01-C12"（再録）。
  - 表現: deck_reveal(hasMechanic:["mirage"] + exclude cardName)/core_move/treat_as/effect_immunity/addTribes/destroy/send_to_deck(nexus targetsGrandwalker)/bounce/symbol_add(field_lacks grandwalker 条件)/離脱時・フラッシュの core/draw choice/stay_on_field(デッキ2トラッシュ)/rebirth/discard→draw。
  - stub: ミラージュ(mirageData)/セット中効果・転召・セット枚数除外・ライフ制御・hand_increase 連動の相手破棄・コア数調整・破壊連動。詳細は各 stub と P3-16 参照。

- BSTH003 東方夢時空 全16枚 / BSTH004 全1枚 / BSTH005 全1枚 effects 変換完了（2026-06-08）:
  - 導魔/秘封/空牙/動器/導界者/転召/転醒 中心。X01/X03 は grandwalkerData 設定済（導託実行配線は未完）。計21テスト全通過。
  - 表現: treat_as(reduction 黄/赤)/deck_reveal(導界者/spirit minCost/brave 3 pick)/dual symbol_add(黄導・赤導)/braveCondition×3/destroy(maxBp/nexus/suppressDestroyedEffects)/bp_modify(-8000〜-10000)/core_distribute(導界者2)/summon(from_zone hand+trash)/search_zone/prevent_battle/effect_immunity(field_has cardName/grandwalker 条件)/rebirth(maxCount9)/addTribes。
  - stub: 導託/転者/導域・転召・合体中効果・破壊連動・BP0破壊・上下ドロー選択・カウント連動回復・他カード召喚誘発。詳細は P3-16。
  - **これで BSTH ナンバリング全弾 + SP 弾(BSTH001〜005) の effects 変換が一巡完了**。次は他弾 BSLH01〜。

- BSTH01-X08「神槍『スピア・ザ・グングニル』」破壊連動を正実装（2026-06-08）:
  - 旧実装は `card_event:"attack"`（→ battle_immediate 宣言時即時）で、破壊条件も持続性も欠き「アタック宣言で無条件にライフ2コア除去」という別物だった。
  - 設計: 「アタック中スコープの即時効果」。発火点＝破壊の観測なので `game_event:destroy`（`triggerFilter`＝spirit/ultimate、`cause:["battle","self_effect"]`＝自分起因のみ）で観測し、`condition:[in_battle:attacking]` で『アタック時』スコープにゲート。誘発収集はバトル reset 前（in_battle=true）に走るため解決が reset 後でも gate 成立。設計詳細は 10_rules/05「『アタック時』の2類型と上位フィルター」。
  - エンジン拡張2点: ①`game_event/card_event.cause` を配列許容に後方互換拡張（`matchesTriggerEvent` を `includes` 化、burst の `cause[]` と統一）。②`executeCoreMove` に life→void 分岐を新設（life→trash 同型、ライフダメージインターセプション経由）。
  - テスト `bsth01-x08-spear-gungnir.test.ts` 12 件（cause 配列マッチ / life→void 盤面変化 / in_battle+combined+cause ゲート）。型チェック両パッケージ clean、全 2650 vitest green。
  - 残: 『アタック時』ラベル（retrigger 参照用）の原文検出後付け（timing 種別と分離）。現状 X08 参照カードは無く need-driven。issues/P3-87。

- P3-88 汎用「コアN個まで」プレイヤー数選択の基盤を実装（2026-06-08）:
  - `core_move` の `amount:{min,max}`（単一ソース→単一移動先）で、プレイヤーが移動コア数 (min〜max) を選ぶ `pendingCoreCountSelection` を新設。X08「相手のライフのコア2個まで」を `amount:{min,max:2}` に移行（従来 amount:2 固定の近似を解消、相手ライフ減少バースト回避狙いの中間選択が可能に）。
  - engine: `model.ts`（型+GameState）/`effect-interpreter.ts`（available で max 丸め・選択余地無ければ直接解決）/`legal-actions(-apply/-types).ts`（`resolve_pending_core_count`）/`state-sanitize`/`current-actor`/`factories`。REST: `game-api.ts` 許可リストに `coreCountSelection`。GUI: `CoreCountModal.tsx`+`BattleScreen`配線+`ActionBar`ラベル。
  - 検証: `core-count-selection.test.ts` 8 件（生成/解決/盤面変化/edge）+ GUI シナリオ `?scenario=core-count-select`（モーダル→1 選択→決定→相手ライフ5→4・ボイド0→1 を GUI+REST で確認）。両パッケージ+web tsc clean。
  - field 源「相手のフィールドのコアN個まで除去」も対応（同日）: core_shoot 機構の under-selection 化。`PendingCoreShootSelection.minTotal` 追加・`analyzeCoreShootCandidates(minTotal)`（under-selection なら候補1つでも pending 化）・`applyPendingCoreShootAction` を `minTotal〜totalAmount` 範囲検証に緩和・legal action/GUI(`coreShootValid`) へ minTotal 伝搬。併せて従来 `field→reserve` のみだった field 源 core_move を `field→trash/void/life` へ一般化（`addNormalCoresToZone`/`soulCoreLocationForZone` で SSOT 化、resolver は元から generic）。`BSLH01-X09`「相手フィールドのコア2個まで→トラッシュ」を `{min:0,max:2}` に移行（field→trash 未実装の no-op も実機能化）。`core-shoot-under-selection.test.ts` 6 件 + GUI シナリオ `?scenario=core-shoot-up-to`（0 個でも確定可・トラッシュ0枚維持を GUI+REST 確認）。
  - 残: 「相手フィールドのコア…まで」系の多くは stub。実装時に `{min,max}` で書けば under-selection が効く。カウントエリア源は別途。詳細 issues/archive/P3-88（クローズ済）。

- BSRK01 全14枚 effects 変換完了（2026-06-09、弾 100%）。確定: C02 deck_reveal / C03 destroy+bounce / C04 core_move / CX01 symbol_add。stub: 契約煌臨宣言・マジック効果コピー・アタック置換・合体結誓。8 テスト green、GUI+REST 未実施。P3-16。

- BSKB01 星のカービィ-メタナイト編- 全12枚 effects 変換完了（2026-06-09、弾 100%、サブバッチ2回）。第1: C01/CX01/M01/R01/R03/X01（count_increase/core_move/draw/discard/deck_reveal/search_zone）。第2: C04/C05/C06/R02/R04/TX01（R02 召喚/アタック時2ドロー / TX01 紫シンボル treat_as＋転醒 rebirth(カウント1以上)）。stub: negate（ハルバードLv2）・動的コスト総量消滅（ギャラクシアダークネス）・カウント比例BP（バル艦長）・トラッシュ/一時耐性・ミラージュ反復・系統付与・動的コア補充・コントラクトチェンジ。tsc clean、2729 テスト green、GUI+REST 未実施（headless）。P3-16。

- BSSG01 戦姫絶唱シンフォギア-切歌＆調- 全17枚 effects 変換完了（2026-06-09、弾 100%）。残9枚 M03/M04/R01/R02/X01-X05。実装: bp_modify(-10000)→maxBp:0 send_to_deck（X05）/ send_to_deck(maxPreventable:0)（X01）/ destroy(suppressDestroyedEffects)（X02）/ maxBp:15000 全体破壊+battle_end recover（X04）/ pay_cost+conditional_cost recover（X05）/ targetsGrandwalker 破壊（M03/M04）/ heavy_exhaust。stub: 特殊煌臨コスト・待機同名1体制限・self-turn ゲート（R01第2/R02、ConditionClause 未対応）・R02単一アタック時抑止・X03降臨元参照・疲労/コアN以下/本来BP フィルタ近似・破壊数割算動的コア・X05月読在場 -20000 切替。2772 テスト green、GUI+REST 未実施（headless）。P3-16。

- BSAZ02 アルドノア・ゼロ-火星- 全32枚（+backFace2）effects 変換完了（2026-06-08）:
  - アルドノア collab 弾（火星側）。アルティメット中心。サブバッチ3回に分割。計17テスト。card-data/rules-core tsc clean。integration-real-cards 含む 87 テスト green で登録生成健全を確認。
  - 表現: deck_reveal（C06/C12 召喚時 pick, tribes+category）・draw＋send_to_deck（C10 召喚時ドロー→手札デッキ下, zone:hand）・send_to_deck bounce（C15 opponent maxCost6 count{0,3} / C18 either 1, position bottom）。`event` 配列・`zone:"hand"`・`player:"either"`・`maxCost` フィルタを使用。
  - stub（基盤未実装）: 【アルドノアドライブ：1】カードスタック機構（下に置く、ほぼ全アルティメットの効果を gate）/ アルティメット《召喚条件》無視 / 転醒（double_sided TR01/TX01）/ 導界者（導託・導域・導技、X04/X05、grandwalkerData は定義済み。2026-08-09 に「ただちに置ける」優先解決のみ解消）/ 分身スピリット・アルティメット生成 / 作戦型 / フラッシュ召喚許可 / 可変枚数pick・モード選択分岐。詳細は P3-16 残留懸念。
  - **弾完了の GUI+REST レビューは未実施**。

- BSAZ02-X04/X05「ただちに...置ける」優先解決を実装（2026-08-09）:
  - `Effect.triggerPriority:"immediate"` / `PendingTriggeredEffect.triggerPriority` を追加し、初回キュー時に通常誘発と即時誘発を優先度別 pending へ分割。即時 pending が残る間は通常 pending の選択/解決を legal actions と apply guard の両方で禁止。
  - 「ただちに」は現在解決中の効果を割り込まず、派生した同時誘発群で通常誘発より先に解決するものとしてルール化。BSAZ02-X04/X05 と同型の BSAZ02-C10 に `triggerPriority:"immediate"` を付与。
  - 付随修正: `triggerFilter.declaresUnderCardSlot` 明示時は、アルティメット召喚でも汎用 summon responder の category scope gate を通す（後段 `matchesCardFilter` で host の `underCardSlots` を判定）。
  - 回帰: `bsaz02-cards.test.ts` に X04 + 通常誘発 responder の同時イベントを追加し、X04 が先に解決されトラッシュの「アルドノアドライブ」が召喚 host 下へ置かれることを検証。

- BSAZ01 アルドノア・ゼロ-地球- 全21枚 effects 変換完了（2026-06-08）:
  - アルドノア collab 弾（地球側）。C18+CX1+X2。サブバッチ2回に分割、各 commit。計21テスト green。card-data/rules-core tsc clean。
  - 表現: draw（合体中+1）・deck_reveal（picks: tribes+category, remainder trash/bottom, 2pick）・bp_modify(-2000/-3000/-5000/-10000)+destroy(filterOr/maxBp0/count all)・activated flash（usageLimit per_instance turn 1）。スレイプニール C01/C02/X01/X02 のアタック/ブロック/フラッシュ系、カーム C16 の配置時 reveal。
  - stub（基盤未実装）: トラッシュ起点の同名煌臨 / 【タイプ：作戦】フィールド常駐マジック（C03〜C12 大半）/ 動的軽減（フィールドのマジック枚数）/ 分身スピリット生成 / 弾幕 / 契約（CX01）/ 追加発揮反復 / 他カードメイン効果代理発揮。詳細は P3-16 残留懸念。
  - 付随修正: BSTH002.ts のカード「戦車むすめのみるゆめ」が誤 cardNo "BSAZ01-C12" で本物の BSAZ01-C12 を ALL_CARDS マップ上で遮蔽していたバグを "BSTH002-M01" へ修正（cardNo 重複は全カードで本件 1 件のみと確認）。
  - **弾完了の GUI+REST レビューは未実施**（検証環境安定後に実施要）。

- BSLH01 英雄伝説 軌跡シリーズ 全57枚 effects 変換完了（2026-06-08）:
  - 他弾の先頭。CB（英雄伝説）アーキタイプ弾。C14+CX1+M5+R6+T17+TR4(両面)+X10。サブバッチ5回に分割、各 commit。計51テスト・全2603 green。型チェック両パッケージ clean。登録生成は全57枚 0 エラー（triggered33/burst3/battle_immediate20）。GUI はアプリ起動 smoke で新データ統合・コンソールエラーなし確認（CB シナリオ未整備のため実効果プレイスルーは未実施、実行系効果は unit/integration でカバー）。
  - 表現: count_increase/decrease・draw・set_exhaust_state/exhaust(heavy)・recover・destroy(filterOr/maxBp/maxCost/suppressDestroyedEffects)・bounce・send_to_deck・remove_from_game・vanish・summon(from_zone hand/trash free)・core_move/core_distribute・symbol_add・effect_immunity・cost_modify(導力器-1/-2)・peek_deck・deck_reveal・move_card(手元 faceDown)・move_self・shuffle_zone・stay_on_field・rebirth(maxCount5/8/9)・bp_modify・end_attack_step(deferTo)・effect_activated/life_decrease バースト。
  - stub（基盤未実装）: クォーツ set-effect システム（最大ギャップ・30枚超）/ ENIGMA契約魂+属性値 / アーツ system(T07〜T17) / ソウルドライブ・S / 導技・神技(X01/X02) / 宣言ギミック / トークン生成 / ゲーム外ソウルコア / BP比較破壊 / 効果持続書き換え / hand_increase 誘発 / 多色 treat_as。詳細は P3-16 残留懸念。

- BSGE01 ゴッドイーター 全35枚 effects 変換完了（2026-06-08）:
  - 神喰/GE アーキタイプ弾。C17+CX4+M4+R5+TR1+TX4(両面5枚)。サブバッチ4回に分割、各 commit。計35テスト・全2638 green。card-data tsc clean。登録生成は全35枚 0 エラー（triggered15/burst4/battle_immediate13）。
  - 表現: draw/discard・choice 分岐・exhaust(heavy)・recover・count_increase/decrease・配置時カウント+2・bp_modify(-10000)・destroy(maxBp0/maxCost4/filterOr)・core_move(void/field→reserve, all)・effect_immunity・summon(from_zone trash free)・move_card(trash→hand contract/色フィルタ)・treat_as(赤)・negate(no-op)・effect_activated(召喚/配置発揮後)/life_decrease バースト。
  - stub（基盤未実装）: 契約合体システム＋否定系統合体条件 / ミラージュ set-effect / リンクエイド / バレットエディット（アンダーカード）/ 神喰カウント保護タグ / 魂状態化（離脱時）/ 動的コア除去 / スタックタイミング制約。詳細は P3-16 残留懸念。

- 疲労時誘発トリガー + 同時誘発グループ + fixedPayment/overrideCost 分離:
  - DSL 型拡張 3 種: `on_exhaust` タイミング、`fixedPayment`（支払い総額固定、overrideCost と意味的に分離）、`simultaneousGroupId`（同時誘発グループ識別）。
  - エンジン拡張: `card_exhausted` 検出ロジック、opt-in フィルタリング、アタック時効果と疲労誘発の同グループ化、同時誘発グループの同時選択肢提示。
  - カードデータ修正: BSTH01（1箇所）、BSTH05（2箇所）の `overrideCost` → `fixedPayment` へ意味的修正。
  - 型チェック通過、371 unit tests 全通過。

- 召喚許可分類・内包召喚タイミング・コア種別の横断再監査完了（2026-08-12）:
  - 通常行動を許可する常時効果を `normalActionPermission:true` で明示し、Q54集合を BSFT01-X01 / BSTH01-M01 / BSSG01-C08 / BSKB01-M02 / BSSL01-M01 / BSLH01-X02 の6枚へ固定。見出しの「メイン」や「召喚できる」という文言では推測せず、通常行動許可をDSLで明示する。BSKB01-M02 は宣言コスト（自カウント0・相手カウント減少）→スタック→維持コア配置の通常 summon 経路へ移行した。
  - BSTH11-M01 / BSSL01-M02 / BSTH02.7-X02 等の即時効果文内召喚は use_hand_card_effect 宣言→スタック→解決中コスト・召喚・維持コア配置へ統一し、内包召喚で二重スタック窓を開かない回帰を追加した。
  - generic な「コア」はソウルコアを含み、明示的な「ソウルコア以外」だけ `effectKind:"normal_only"` とするDSL規約へ旧データ・テストを追従。転醒後の後続コア配置完了待ち、pending/continuation/after_triggers の二重誘発、神技 choice の宣言前展開も併せて修正した。
  - rules-core/card-data/web の型検査と全体テスト、`patchouli-start-summon` / `q54-keya-place` の GUI＋REST 双方向シナリオを通過。

- 原文1効果内の `EffectStep.choice` をスタック窓後選択へ統一（2026-08-13）:
  - BSGE01-C01「ティアーストーン」で、使用宣言時に「ドロー」「サーチ」の2宣言へ分裂していた原因を、choice 変種を legal action として枝別展開する共通パイプラインと特定した。
  - カードデータ全体の `EffectStep.choice` 77箇所を対象に、マジック・フィールド・手札・誘発・バースト・バトル即時の6宣言経路を1宣言へ集約し、スタック窓が閉じた後に `pendingStepChoice` で枝を選ぶ方式へ統一。枝固有の対象・効果文内コスト・usageLimit は選択後に処理する。
  - `?scenario=post-stack-step-choice-bsge01-c01` を追加し、alice GUI の単一宣言→窓後2択と、bob REST の stack pass→choice pending 遷移を双方向確認した。

- BSGE01-TR01(B) 合体中の転醒時効果を修正（2026-09-04）:
  - ユーザー裁定に従い、転醒イベントの主語はブレイヴ自身、アタックの主語と合体効果の発揮元はホストとして分離。見出しを「このスピリット/ブレイヴの転醒/アタック時」に訂正した。
  - `Timing.effectSourceEvents` を追加し、汎用誘発候補照合で指定イベントだけ効果テキスト元のinstanceを参照する。単一effectを維持して転醒/アタック間のターン1回制限を共有する。
  - 実カードのフラッシュ裏返し→カウント-2→相手2体破壊、ホスト/他カードの転醒での誤発揮防止、未合体時の除外、アタック時との回数制限共有を回帰テスト化。
  - `scenario-bsge01-tr01b-rebirth.spec.ts` は既存の合体ブレイヴシナリオを基に、roomHarnessの通信を実Game APIへ中継してAlice GUI/Bob RESTの双方向操作を検証。裁定はブレイヴ章と `needs-ruling.jsonl` に記録。

- BSRK01-C06 スタック効果選択とバースト破棄を修正（2026-09-04）:
  - 手札/手元の「スタック効果を使用」を1ボタンに統一し、attackでは別効果を選んでから支払う。自分mainは破棄のみで選択省略、相手mainは使用不可。
  - 発動宣言への応答中はセット扱いを維持し、発動成立時に解除。直接手札発動も破棄候補へ含め、トラッシュへ移動した発動だけを中止する。トラッシュ発動と効果発揮宣言後の境界も回帰化。
  - 同じtimingのmagic登録はeffectIndexも照合し、破棄を選んだときにbounceの対象候補が混ざらないよう修正。core回帰9件、Alice GUI/Bob RESTシナリオ3件を追加。

- BSTH02.7-TX01(B) Lv2 相手アタック開始時を実装（2026-09-04）:
  - 添付スナップショットではT6・Bobのアタック、AliceのB面に通常コア2個。B面にeffectsが未登録だったため開始時効果が誘発していなかった。
  - phase/attack/start/opponent + Lv2の効果を登録。デッキ下戻しと手札/手元からのバーストセットを独立した任意手順として実装し、「その後」は前段の成否に依存させない。
  - 汎用DSL `set_burst` を標準対象選択へ配線し、既存バーストセットの共通処理に接続。効果セットは通常セットのステップ・ターン1回制限を消費せず、ゾーン移動は共通プリミティブを経由する。
  - カード回帰9件（Lv/ターン、スピリット/アルティメット、手札/手元、辞退/対象不在、既存セット置換）と `tx01-opponent-attack-start` のAlice GUI/Bob REST 2件を追加。

## 2026-09-04: 転醒の同一原因排他

- BSSA01-転醒X01(A)/X04(A): 同じ召喚からの転醒は一方成立後に残りを候補から除外。通常効果・異なる原因/発生の転醒は維持。
- 原因・プレイヤー別の転醒済み窓を解決/再開へ渡し、ログ省略時も状態フィールドで保持。
- BSTH02.7-TR01(A)の黄単色トラッシュ増加/入れ替え・相手による離脱、TR02(A)のライフ増減を汎用誘発へ登録。
- 回帰: X02召喚時の後続召喚の転醒を先に解決しても先行候補を維持、同一召喚の排他、TR02実効果の破棄+ライフ増加。GUI Alice/REST Bobは `rebirth-same-cause`。

## 2026-09-08: BSGE01 モルターのフラッシュ起動対応

- TX01(B) の【合体中】フラッシュでR02/R04の支払い選択が欠落。支払い権利はホストに付与済みだが、選択処理が誘発/バトル即時効果に限定されていた。
- `field_card_effect` を共通の窓後選択に接続し、R02の離脱効果抑制と支払い時のカウント減少イベントを本体解決へ伝搬。
- 回帰は `bsge01-mortar-flash.test.ts`（支払う/辞退、両方使用、神喰保護カウント、誘発順）と `scenario-bsge01-mortar-flash.spec.ts`（既存合体シナリオからAlice GUI/Bob REST操作）。ルール根拠: [05 合体](../10_rules/05_brave-and-attack-special-cases.md#合体)、[02b 効果文内コスト](../10_rules/02b_declaration-timing-window-principle.md#起動型キーワード効果の発揮宣言と効果文内コスト)。

- [2026年9月追補](03_completed-milestones-phase-6-effects-sweep-2026-09.md): TX01(A)転醒コストのHUD選択。
