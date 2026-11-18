# シナリオテスト参照

## 使い方

- [GUI/API検証](12_bidirectional-e2e-pattern.md)
- 定義: `apps/playground-web/src/scenarios.ts`
- テスト: `e2e/scenario-*.spec.ts`
- C03公開後回収: `e2e/reveal-retrieval-audit.spec.ts`、`attack`＋`fallback`。C03/R01の2候補からAlice GUI/Bob RESTで1枚回収。
- `marisa-brave-rewrite`: 必須読み替え。`mode=capacity`で上限失効→所有者選択→分離コア、`owner=bob`でREST反転。

## 一覧

- `hand-gain-cost` / `kanjuden`
- `revealed-burst-slot`: M01（詳細は04b）。`owner=bob&foreign=1&boundary=1`は所有者選択後に元効果がC03を消滅させる原因境界。
- `kanjuden&mode=hand-selection`: C02の手札閲覧→破棄。`card=BSTH10-C01`で同類、`delivered=1`で配送済み状態、`owner=bob`でREST操作。

### 基本

| パラメータ | シナリオ名 | 内容 |
|-----------|-----------|------|
| `no-duplicate` / `no-duplicate-opponent` / `queue-front-usage` / `rimuru-pending-leave` | キュー | 重複・待機（`e2e/scenario-no-duplicate.spec.ts`） |
| `card-detail-zones` | トークン詳細・除外 | 両者の除外と複数トークン。`empty=1`、`mode=search&owner=bob`でC09 REST、`noMatch=1`で対象なし |
| `kaname-removal` | 要石の実効果から除外閲覧 | 通常召喚、`mode=attack`は緋想のアタック。相手デッキ上2枚を除外一覧・詳細で確認。`owner=bob`でREST反転 |
| deck-exclusion | 除外 | |
| `dead-proof-compound-timing` | てゐの召喚時無効化・破壊 | 通常召喚の発揮宣言へデッド・プルーフを使用。`owner=bob`でREST反転。デッキ公開なし・破壊1回 |
| `snapshot-progress` | 選択後の進行 | `delivered=1`でブレイヴ分離、`mode=drives`で連続ドライブ。`stage=respond/select`、`host=siren`、`owner=bob` |
| `mid-battle` | 中盤戦 | 両者フィールド2体+手札2枚、T3メイン |
| `sequential-order` | その後 | ドロー→破棄選択。`owner=bob`でREST |
| `trash-entry-immunity` | 咲夜の回収不可 | `owner=bob`でREST |
| `rebirth-simultaneous-leave` | 転醒待機 | `mode=spirit` |
| `card-timing` | 手札戻し/太陽の畑 | `mode=stack` / `owner=bob` |
| `grandwalker-suppression` | 神秘 | 創界神抑止 |
| `domain-audit` | 領域 | 神子・レーナ、`mode=eiki/yuyuko`。Bob反転可 |
| `attack` | アタック | alice 3体 vs bob 2体、アタックステップ |
| `defense` | 防御側 | bob がアタック、alice にブロッカー1体+マジック |
| `opponent-combined-flash` | 相手合体フラッシュ | 合体3体の中央がアンダーカード付き疲労アタック中。wrapper中心回転・左右侵食・Brave前面確認 |
| `lethal-attack` | 致死アタック | alice 攻撃1体 vs bob(ライフ1、ブロッカー無)。未ブロック→life_zero |
| `summon-category` | 召喚種別 | BSSA01-X02の夜錆候補選択 |
| `summon` | 召喚テスト | 低コストスピリット4枚+マジック、リザーブ豊富 |
| `burst-activation` | バースト宣言・維持コア | `owner=bob`で反転、`card=BSTH01-M13`で対象変更、`response=BSTH05-R02`で相手手札に応答カードを追加 |
| `hand-increase-burst` | バースト・解封 | [設定一覧](10c_scenario-test-reference-card-regressions.md#手札増加バースト) |
| `burst-mirage-zone-browse` / `mirage-individual-swap` / `mirage-effect-swap` | ミラージュ | [個別交換](10m_mirage-individual-swap.md) |
| `direct-zone-browse-target-selection` | 直接ゾーンブラウズ対象選択 | field2+trash1+hand1 候補。HUD/通常トラッシュブラウズ双方で対象選択可。HUDは所有者+ゾーン見出し |
| `empty-target-selection` | 対象0件 | 確定 |
| `brave` | ブレイヴ合体 | スピリット1体+ブレイヴ1体（スピリット状態）、T3メイン |
| `brave-semantic-events` | 合体と召喚 | X01の手元C21合体とX03神託。`mode=direct-summon/summon`で実召喚を比較、`owner=bob`でREST反転 |
| `combined-symbols` | 合体シンボル | `kind=spirit/ultimate/nexus`、`owner=bob`、`combined=1`。表示・軽減・GUI/REST合体の比較 |
| `brave-combine-summon` / `effect-brave-choice` | ブレイヴ召喚 | 通常召喚の窓後選択 / 公開から合体可否（`owner=bob`:REST） |
| `count-leave-order` | 誘発→離脱 | `owner=bob`: REST |
| `brave-leave-choice` | ブレイヴ離脱選択 (P2-09) | 合体スピリット破壊時、ブレイヴを「フィールドに残す / 一緒に移動」の2択モーダル。`&hosts=2` で連続選択、`&owner=bob` でREST |
| `brave-attack-continuation` / `soul-state-brave-battle` | バトル参加 | [魂状態と分離継続](10n_soul-state-brave-battle.md) |
| `brave-separate` | 分離 (P3-58) | main。ホスト/ブレイヴ→「分離」→コア選択HUD |
| `x09-combine-condition` | X09合体条件 | alice X09+X03+X04。候補はX04のみ |
| `four-of-a-kind-multi-effect` | 効果発揮の効果選択 (X04 フォーオブアカインド) | X04(Lv2) flash 2効果。「効果発揮」→効果選択2択。束ね/usageLimit 回帰 |
| `quartz-activation` | クォーツ: 魂状態化+セット | alice 手札に ENIGMA + クォーツ3枚、カウント5。ENIGMA を魂状態化 → クォーツを host にセット |
| `nexus` | ネクサス配置 | ネクサス2枚+スピリット1枚手札、T3メイン |
| `makai-conditional-cost` | 魔界 | 実行/辞退・0枚、Bob REST |
| `r21-conditional-cost` | 紅魔館 | 自軍のみ適格の実行/辞退、Bob REST |
| `nexus-field` | 両者ネクサス | 両者スピリット1＋ネクサス1、T3メイン・横4行計測 |
| `choice` | choice ステップ | BSTH01-C05（チルノ）手札、相手スピリット2体、デッキ付き、T3メイン |
| `dsl` | DSL 効果テスト | effects 定義ありカードを手札に含む、デッキ付き、T3メイン（`?hand=` でカード指定可） |
| `badge-core-display` | バッジ整理 + コア数バッジ折り返し | コア11+ソウル(2行) / 煌臨中(金グロー+peek) / 転醒 / 破壊待機 / 消滅待機(snapshot Lv/BP P3-83)。テキストバッジ廃止 |
| `field-under-card-layout` | 合体/共有配置 | 鍵3+星霊衣2、煌臨、異魔神△、真・バディ▽ |
| `public-disclosure` | 公開情報・ログ | `targetOnly=1` 矢印、`viewer=bob` 履歴・秘匿確認 |
| `known-deck-bottom-draw` | デッキ既知位置 | 下ドロー後の上4枚。`owner=bob` でREST |
| `public-disclosure-hidden-discard` | 内容を見ない破棄ログ | bob の `unseen:true` 手札破棄を実 DSL で解決済み。alice ログはカード名/instanceId を伏せ、枚数・移動先のみ残す |

### pending / スタック / スケジューラ

| パラメータ | シナリオ名 | 内容 |
|-----------|-----------|------|
| `card-selection` | 手札/ゾーン候補 | `mode=exclude/mixed/grouped/draw/battle/payment`、`owner=bob` |
| `p3-29-triggered-stack` | P3-29 誘発スタック | alice の召喚時誘発 pending + bob のフラッシュマジック、T3メイン |
| `p3-29-battle-immediate-stack` | P3-29 バトル即時スタック | alice アタック時即時効果 prompt、アタック中フラッシュ窓 |
| `p3-62-koumakan-mid-stack` | 紅魔館の対象消失 | Bobのアタック中、紅魔館Lv2のフラッシュに応じ対象を退避。解決時にコスト・使用回数を返却 |
| `p3-63-extra-turn` | P3-63 追加ターン中 | 追加ターン状態を direct inject。HUD「＋追加ターン」バッジ表示 + advanceStep が core/attack をスキップ |
| `bsth01-x03-attack-grandwalker` | BSTH01-X03 レミリア アタック | アタック時 effects[1] (相手創界神ネクサス破壊) + effects[2] (BP20000 以下破壊+回復) の 2 prompt queue。発揮ボタン+target 候補絞り込み確認 (P3-50/51/52/53) |
| `grandstone-unseal-rebirth` | 創界石 | 陰陽玉の解封→コア3で転醒→玄爺へ裏返し→合体選択 |
| `draw-step-cost-choice` | ドロー前のコスト | カルテノン神殿Lv2。影/プレイヤー1枚破棄でドロー+1。開始時に候補を提示 |
| `bssl01-x01-split-summon-choice` | 場入り分配 | token put / zone summon の分配選択 |
| `step-optional-prompt-bssa01-c02` | step prompt | C02 任意文 |
| `step-choice-prompt-bslh01-r03` | choice prompt | R03 3択 |
| `bsth01-x03-attack-sync-target` | BSTH01-X03 アタック時 スタック窓+対象選択 | flash 窓前でも発揮宣言で相手スタック窓が開く (02:200)。bob BP≤20000 が 2 体。発揮→相手 pass→対象選択→選んだ 1 体のみ破壊+回復。先頭固定 auto-pick 回帰防止 |
| `bsth01-x03-summon-shared-pending` | BSTH01-X03 召喚時 + R21 共有 pending | bob X03+R21。共有 summon pending で片方 skip 後も残り誘発を保持。`?viewer=bob` |
| `pay-cost-recover` | 里乃の通常コスト | BSTH11-X04 4コア・疲労とX01 4コア、リザーブ0。窓後の対象選択→2コアHUD→支払い・回復。owner=bobでREST反転 |
| `p3-30-pay-cost-sources` | P3-30 pay_cost ソース選択 | BSTH01-X04 Lv1 フラッシュ。リザーブ 0、ネクサス 2 コア。起動でモーダル表示 |
| `a7-effect-param-modify-combined` | A-7 効果パラメータ修飾 (レーヴァテイン合体) | フランドール+レーヴァテイン合体。bob に各種 BP/カテゴリ。Lv1 フラッシュで maxBp 10000→15000 + spirit+ultimate 拡張確認 |
| `p3-36-mixed-owner-pending` | P3-36 混在オーナー pending | BSTH05.5-C04 を両 player 場 + 公開キューに 2 件注入。ターン player の選択モード + 「解決」ボタン |
| `p3-36-same-owner-chain` | P3-36 同一オーナー連鎖 (auto-select) | BSTH05.5-C04 alice 場 2 体 + alice owner 2 件 pending 注入。auto-fire で select が冗長され resolve 進行 |
| `p3-46-core-shoot` | P3-46 G6 コアシュート選択 UI | alice パチュリー / bob 2 体 (各 2 コア)。`pendingCoreShootSelection` 注入で 2 コア shoot 再現。facade `coreSelection` (purpose: shoot) 経路 |
| `core-count-select` | コア数選択 | ライフ→ボイド。`&lethal=1`: フラッシュ窓中の即時敗北、`&owner=bob`: Bob REST |
| `core-shoot-up-to` | P3-88 コアシュート「N個まで」 under-selection | BSLH01-X09 相当: 相手フィールド→トラッシュ (minTotal0/totalAmount2) 注入。0 個でも確定可（exact なら不可） |
| `p3-73-sakuya-flash-negate` | P3-73 咲夜 フラッシュ無効化 (BSTH01-X05) | alice 手札咲夜 + bob フラッシュ豊符 (BSTH05-R02)。bob フラッシュ→非公開キュー declare→isNullified→窓クローズで効果スキップ+trash。フル e2e は `p3-73-x05-end-to-end-window-close.test.ts` |
| `p3-86-sakuya-double-flash-negate` | P3-86 咲夜 2 枚 フラッシュ無効化 (案X + Q3 fizzle) | 咲夜 2 枚 + bob フラッシュ豊符。bob フラッシュで 2 枚誘発→窓中 declare 不可→パス→発揮前チェックポイントで 1 枚 declare→2 枚目は双方向 fizzle。重複プロンプト無し |
| `p3-86-sakuya-checkpoint` | P3-86 咲夜 2 枚 発揮前チェックポイント (bob フラッシュ済) | bob R02 使用済 (スタック保留) + alice 咲夜 2 枚誘発済 (非公開)。alice 視点で「窓中 declare 不可→パス→チェックポイント declare→2 枚目 fizzle→bob マジック無効化トラッシュ」完走 |

### カード固有効果

| パラメータ | シナリオ名 | 内容 |
|-----------|-----------|------|
| `rumia-lv2-symbol-add` | ルーミア Lv2 シンボル追加 | ルーミア(BSTH01-C04) Lv2 (2 コア)。Lv2-Lv3 メイン効果で創界神/導界者ネクサス無時赤シンボル+2 継続 (詳細モーダル「シンボル: 赤3」) |
| `patchouli-free-magic` | パチュリー無料マジック | パチュリー(BSTH01-M01) Lv2 + 手札 BSTH01-C22。タイミング選択後に「コスト支払わず」/「通常コスト」モーダル |
| `xx01-simul-attack` | XX01 複数体同時アタック | リリーブラック(BSTH07.8-XX01) + 妖精×3 + 非妖精。妖精タップ→「複数でアタック」→候補選択→同時宣言。ペア色 + ⚔×ペア数。ブロックは同時アタック数まで (qa-022)、初バトル終了でステップ強制終了 (P2-05) |
| `xx01-mid-battle-join` | XX01 召喚後の即時アタック | 妖精の参加／辞退→宣言スタック→同じバトルへ参加。[実召喚のGUI/REST回帰](10g_fairy.md)も参照。 |
| `coreshoot-soul-only-target` | コアシュート ソウルコアのみ対象 | 手札 BSTH01-C22 + bob 場 A(通常2)/B(ソウルのみ)。フラッシュで B も選択可、ソウルコアが相手リザーブへ |
| `magic-target-after-stack` / `divine-skill-payment&mode=stack-response` | 窓後の対象選択 | マジック/幽々子導技。応答の離脱完了後に選択。神技は`owner=bob`で反転 |
| `vwal-library-lv2-main` | ヴワル魔法図書館 Lv2 メイン | ヴワル(BSTH01-C12) Lv2 (1 コア)、ライフ 4。Lv2 メイン発揮で「ライフ→トラッシュ」後に dual-color (赤/紫) ×2 シンボル。inline draw step 誤発動防止 |
| `vwal-library-draw-step-inline` | ヴワル魔法図書館 ドローステップ inline | ヴワル Lv1 + コアステップ開始。「次のステップ」1 回でドロー +2→破棄選択モーダル (手札3 or 紅魔1 alt)。誘発キュー非経由 |
| `patchouli-trash-distribute` | パチュリー トラッシュ→紅魔配分 | パチュリー Lv2 + 紅魔 1 体、トラッシュ コア3+ソウル。「次のステップ」でアタック開始時誘発→紅魔回復+トラッシュコア配置 UI |
| `moved-to-trash-optional-choice` | トラッシュからの任意手札追加 (R12) | トラッシュに BSTH01-R12 + origin="trash" pendingDeckReveal(revealed_choice) 注入。「加えられる」=任意 (可能形文言は「できる」扱い、10_rules/03c) → モーダルで選択/据え置き |
| `patchouli-start-summon` | パチュリー スタートステップ召喚 | 手札パチュリー、場別名スピリット、bob エンドから。alice スタートステップで同名比較 false → 1 コスト召喚 action → スタック → 維持コア配置 |
| `patchouli-start-summon-blocked` | P3-57 パチュリー 同名スピリット存在で召喚抑止 | 場・手札両方にパチュリー、bob エンドから。`condition.field_lacks cardName=self` false により start-step 召喚 action 非出現 |
| `bsaz02-c14-zone-discount` | BSAZ02-C14 ヘブンズフォール zone_discount | 手札ヘブンズフォール、場に CF アルティメット、トラッシュに CF アルティメット2枚。追加コスト適用→トラッシュ2枚をデッキ上下へ戻して3コスト使用 |

### 手元 / トラッシュ表示

| パラメータ | シナリオ名 | 内容 |
|-----------|-----------|------|
| `koishi-discard` | こいし | 発揮側が手元を選択 |
| `set-aside-1` | 手元 1 枚 | alice の手元に 1 枚配置（基本表示確認） |
| `set-aside-3` | 手元 3 枚 | alice の手元に 3 枚配置（重なり確認） |
| `set-aside-5` | 手元 5 枚 | alice の手元に 5 枚配置（密度高確認） |
| `set-aside-vs` | 手元 対称 | alice 3 枚 + bob 3 枚（自分=右端最前 / 相手=左端最前 の対称性） |
| `set-aside-with-nexus` | 手元+ネクサス | alice にネクサス 5 枚 + 手元 3 枚（侵食防止確認） |
| `trash-selection` | トラッシュ選択 | スピリット4+マジック1。`return_from_trash` の画像・クリック・長押しを検証 |
| `set-aside-selection` | 手元の除外選択 | BSTH08.5-X01、手元の面霊ブレイヴ3枚。身代わり除外の候補表示・選択を検証 |

### P3-47 裏向きフィールド / 分身 (act_as_spirit)

[フィールド表示のシナリオ詳細](10a_field-scenario-reference.md)を参照。

### P3-56 フィールドオーバーフロー (横スクロール)

[フィールド表示のシナリオ詳細](10a_field-scenario-reference.md)を参照。

## 視点切替 (`?viewer=`)

[視点切替・カード詳細・除外閲覧](10g_card-detail-and-zones.md)を参照。

## シナリオ追加ルール

- `blazing-star-oracle` / `oracle-trigger-kinds`: [導託の回帰](10f_hidden-protection.md)。

- `?scenario=seirensen-draw-trigger`: 聖蓮船card-9→card-10の通常配置と配置時2ドロー・手札破棄。後者だけを原因としてcard-9が1回転醒し、B面転醒時効果まで完走する。`owner=bob`でBob REST / Alice GUI応答へ反転する。

- `?scenario=dormant-trigger-actor`: 同BP破壊でヴァルドの休眠観測と切歌の残置反応を並べる。非ターン側Alice GUI / `owner=bob`のBob RESTで切歌を辞退し、両カードの離脱とpending終端を確認する。

- `?scenario=simultaneous-trigger-level`: 2コア・カウント3のproductionマミゾウでアタック時コア+1後、同じ疲労群のLv2転醒を確認。Alice GUI / Bob RESTと表示用stateの内部判定除去・サーバー合法手配送をローカルroom harnessで検査する。

- `?scenario=bsaz02-fidelity`: エレクトリスの攻撃中制限。`mode=solis`は最初のバトル終了後までの制限。`owner=bob`でBob RESTとAlice画面の同期を確認（[監査記録](../30_plan/03_completed-milestones-phase-6-bsaz02-audit.md)）。

- 新機能を追加したら、対応するシナリオも `scenarios.ts` に追加し、この一覧を更新する。
- シナリオは `createEmptyGameState` + 手動カード配置で作る（`initializeGame` ではなく任意の盤面を直接構築）。
- Cross-cutting Rule の中規模以上の GUI レビューでは、関連するシナリオを使って Playwright + REST API で双方向テストする。
