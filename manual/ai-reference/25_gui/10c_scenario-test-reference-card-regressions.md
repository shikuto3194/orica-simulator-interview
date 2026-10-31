# カード回帰シナリオ

[妖精](10g_fairy.md)
`react-card-corrections`: 金龍の任意回復、サグメ/ドレミーの神域Lv境界。

- [耐性/導託/転醒](10f_hidden-protection.md)

[アルドノア](10e_aldnoah.md)

[M06召喚時のライフ増加](10_m06-summon-life.md)

[火男](10_c23.md)

`pregame-order`: 先後選択・開始前AI。

`battle-end-selection-chain`: 数・コア・バースト枚数・入替の選択→派生→発揮後を検証。Alice GUI / Bob REST（保存復元、発揮/辞退）。再現パラメータと検査は[組合せ監査](../10_rules/02d2_causality-combination-audit.md#guirestの再現入口)参照。

`genkai-cost`: 現界2種の対価・維持コア。`card=BSTH10-X05`、`soul=reserve`、`cores=1`、`owner=bob&viewer=bob`で切替。Alice GUIの黄色枠・宣言とBob RESTのコア配置を確認。

`core-distribution-groups`: BSTH11-R03の種類横断配分・黄色枠・リセット・途中完了・後段ドロー。`owner=bob&viewer=bob`でRESTの違法配分拒否と一括配置、`kind=cb`でBSLH01-X04への共通適用。`e2e/scenario-core-distribution-groups.spec.ts`。

`kanjuden&mode=pure-contract` / `pure-brave`: 純化の発揮確認→対象HUD→持ち主の魂状態・分離選択。`owner=bob&viewer=alice&manualOpponent=1` で相手の効果に対する確認を検証。`e2e/scenario-kanjuden.spec.ts`。
`kanjuden&mode=pure`: 疲労した対象が裏向きのカード状態になり、手元上の固定カード列と共通一覧に表示される。Alice GUI/Bob RESTで双方の配置を確認。
`kanjuden&mode=card-state-battle&owner=alice/bob`: 表向きカード状態・純化後の疲労ブロック付与持ちはブロック候補から除外し、状態付与中の分身だけでブロック成立。共通カード一覧も操作不可。

`recovery-degree`: 重疲労のユージオ＋青薔薇の剣を一段階回復。Alice GUI / `owner=bob` RESTで疲労状態と合体同期を確認。

`triggered-source-departure`: BSTH11-X04召喚時へBSTH08-C01をスタック。発揮元離脱後は対象選択を出さず不発。Alice GUI / `owner=bob` REST。

`cost-leave-completion`: BSTH04-C01の全コアで浄玻璃の鏡を配置した直後。配置時効果で回収・辞退すると消滅待機が確定する。Alice GUI / `owner=bob&viewer=bob&manualOpponent=1` REST。`e2e/scenario-cost-leave-completion.spec.ts`。

`hidden-card-return` / `brave-condition`: C03の手札戻し、相手への裏面通知・本人の既知位置、X01の条件外合体拒否。Alice GUI / `owner=bob` REST。`e2e/scenario-hidden-return-and-brave.spec.ts`。

`mandatory-followup`: BSLH01-C05の任意確認2回から、破壊後の通常コア3個回収・カウント増加まで自動実行する。Alice GUI / `owner=bob` REST。`e2e/scenario-mandatory-followup.spec.ts`。

`public-disclosure-zone-moves`: デッキ2枚破棄→トラッシュ1枚回収の画像・行き先通知。Alice GUI / `owner=bob&manualOpponent=1` REST、`targeted=1` 対象指定経由、`viewer` 視点切替。`e2e/scenario-public-disclosure-zone-moves.spec.ts`。

`special-nexus-reference`: BSTS01-X02でBSSA01-XX01を破壊した直後。Lv2ベニマルの離脱参照誘発で相手ライフ6→5・リザーブ3→4。Alice GUI / `owner=bob&manualOpponent=1` REST。`e2e/scenario-special-nexus-reference.spec.ts`。

`placement-oracle-trash-immunity`: 相手にジュラ・テンペスト連邦国。Alice のカーディナルで発揮→Bob REST パス→3枚トラッシュ・対象2枚参照・コア2個。落ちたR11の回収は不可。`e2e/placement-oracle-trash-immunity.spec.ts`。

`summon-source-union`: BSTS01-C05配置時のトラッシュ/魂状態を同じ候補一覧に表示。
`card=BSGE01-C16`で魂の家の使用、`owner=bob`でREST側に反転。両召喚元・不正対象拒否・維持コア配置を確認。

[契約煌臨の回帰](10d_scenario-test-reference-contract.md)（魂状態へのコア配置・離脱）。


`nested-advent-triggers`: BSTS01-C01煌臨→CX01カウント+1後の盤面。内側のドロー中は外側の煌臨時を前面化不可。ドロー解決後に煌臨時へ戻る。Alice GUI / `owner=bob` REST対応、`stage=advent`はカウント増加前。

[10_scenario-test-reference.md](./10_scenario-test-reference.md) のサイズ上限に伴うカード固有回帰シナリオの別紙。

`effect-immunity`: 最古の金木犀の配置時。回復パチュリーは対象不可、疲労パチュリーをBP0破壊。`owner=bob`で反転し、Bob RESTでは耐性対象の不正指定も拒否する。

| パラメータ                          | シナリオ名                        | 内容                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `star-king-payment`                 | 星霊王の召喚コスト全額支払い      | コスト+20の効果中、合体中の鍵を必ず1枚選んで除外し、全額支払い済みで召喚。Alice GUI / `owner=bob` RESTで召喚と維持コア確定まで確認。                                                                                                                                                                                                                                                             |
| `main-step-end`                     | メイン終了時の自動進行            | 水兵ワドルディの手札破棄と任意デッキ破棄後、アタックへ自動遷移。相手RESTの選択完了まで待機。`magic=1` は終了時マジック使用機会、`owner=bob` はBob側盤面                                                                                                                                                                                                                                          |
| `burst-effect-tree`                 | バースト効果発揮の待機            | 反逆者アリスの同時召喚→コア配置→残り誘発→ヨハネスの効果発揮宣言。`owner=bob` でREST                                                                                                                                                                                                                                                                                                              |
| `contract-count-rebirth`            | 同時誘発とスタック応答            | `owner=bob` / `turn=opponent` / `flash=after_block`。`mode=shared` は紅魔館とレミリアの共有召喚イベント                                                                                                                                                                                                                                                                                          |
| `host-advent-soul-only`             | 真バディの擬制煌臨                | ソウルコア単独の対象へ契約煌臨。Alice GUI / `owner=bob` REST でコア引き継ぎと pending 解消を確認。                                                                                                                                                                                                                                                                                               |
| `contract-leave-choice`             | 契約カードと同行ブレイヴの離脱    | ユウ+クレメンサーの実際の破壊待機。「一緒に移動」→魂状態/通常離脱。`owner=bob` でREST側。                                                                                                                                                                                                                                                                                                        |
| `eugeo-summon-timing`               | ユージオ召喚確定                  | アリスの効果召喚。維持コアHUD中は誘発なし、確定後に召喚時1回。`actor=bob` 対応                                                                                                                                                                                                                                                                                                                   |
| `eugeo-advent-source-rebirth`       | ユージオの煌臨元転醒              | 候補一覧/重なり閲覧から青薔薇の剣を選択→分離コアHUD→赤薔薇の剣。`cores=waiting`でリザーブ0・破壊待機ユージオからコア配置。`battle=attacking`でアタック中の供給元の黄色枠も確認。`owner=bob&viewer=bob`で旧候補のREST復元とBob GUI反映、取消・他ホスト候補除外も確認                                                                                                                              |
| `rebirth-same-cause`                | 同じ召喚の転醒排他                | X04のコア配置確定後にX01の転醒候補だけが消える。owner=bobでBob REST確認                                                                                                                                                                                                                                                                                                                          |
| `bsaz01-c05-c08-partial-resolution` | C05/C08 耐性後の部分解決          | ブロック後フラッシュ。alice C05→bob 場C08で合体ブロッカーを耐性化→攻撃側だけ破壊、双方の手札は維持                                                                                                                                                                                                                                                                                               |
| `edh-0041-waiting-cores`            | 待機残存コアの場入り配置          | マミゾウ召喚の支払いでリリーホワイトが消滅待機に入り、残存1コアを配置。Alice GUI / `actor=bob&viewer=bob` RESTで任意誘発辞退・実移動まで確認                                                                                                                                                                                                                                                     |
| `tx01-rebirth-core-placement`       | TX01 転醒コア配置                 | 実バトルのライフ減少→手札宣言・対象選択・3コスト支払い後。トラッシュ通常コア1個だけで確定し、相手エンドステップへ。`payment=field/mixed` はリザーブ0/3＋フィールド3、`payment=mixed-low` はリザーブ通常1＋フィールドの併用。`payment=reserve` は通常16個で支払い前から開始。`soul=reserve` はソウル併用、未指定は自動支払い。`fixed=4` は保存済み総数指定、`owner=bob&viewer=bob` はBob REST確認 |
| `bsrk01-c06-stack`                  | C06 スタック効果選択              | 手札/手元から効果選択→支払い→Bob REST応答→バーストをトラッシュへ。`source=set_aside` / `step=main&active=bob` / `stage=effect` / `burstSource=hand` で境界を確認                                                                                                                                                                                                                                 |
| `tx01-opponent-attack-start`        | TX01 相手アタック開始時           | Lv2 B面と手札/手元のバースト。相手メイン→アタックからデッキ下戻し・セットを確認。`owner=bob&viewer=bob` はBob REST                                                                                                                                                                                                                                                                               |
| `shot-rebirth-battle`               | 雷鎚ショット→グランギニョル転醒   | Bobユウ+神機+サクヤ装弾、Alice手札TX01(A)。離脱/魂状態化後の前半フラッシュ→バトル終了→ステップ強制終了                                                                                                                                                                                                                                                                                           |
| `effect-source-display`             | 合体中ブレイヴの効果元画像        | TR01(A) アタック時効果の応答待ち。相手パス後の任意裏返しでもキューと同じブレイヴ画像                                                                                                                                                                                                                                                                                                             |
| `bsge01-tx01-combined-brave-flash`  | BSGE01-TX01(A) 合体中ブレイヴ起動 | CX01+TX01(A)、bob 攻撃前半フラッシュ。タップ→各画像下に「効果発揮」、キャンセル1                                                                                                                                                                                                                                                                                                                 |
| `bssa01-effect-text`                | 反逆者アリス第2効果の本文         | メインで召喚効果を使用済み。宣言前後でライフ回復本文を保持し、Alice GUI / Bob RESTで通常コア移動を確認。`stage=queued` / `owner=bob`                                                                                                                                                                                                                                                             |

- `flash-effect-category`: R01 の手札フラッシュ召喚と CX01〜CX04 の入替を、X01 の手札破棄・M03 のコア移動下で確認。`owner=bob&viewer=bob` で Bob REST、`gate=hand|core|both`、`host=BSGE01-CX01`〜`BSGE01-CX04`。
- `crossover-fidelity`: BSES01-C02 の公開残りをデッキ下/破棄へ選択。`kind=count` は BSAZ01-C12 の0枚選択、`owner=bob` はREST側。Alice GUI / Bob REST の6件。
- `core-hud-audit&kind=bell`: ベルの代替支払いをフィールド2枚/リザーブへ配分。`tax=1` は実レティの余分3支払い、`owner=bob` はREST側。GUI/RESTの3件。
- `self-attack-flash`: 本人限定アタック時フラッシュの選択可否。`card=BSGE01-TX01(B)|BSGE01-TX02(B)`、`role=idle|attacking|blocking`、`window=before|after`、`owner=bob`。非参加中は裏返しだけ使用でき、本人の攻撃中はカウント消費効果を使用できる。

## 手札増加バースト

`bsrk01-c07-up-to`: トラッシュ通常コア2個から弥彦の配分・任意ドロー・手札5枚への戻し。`burst=1` は相手M02の先行バースト、`owner=bob` で反転。GUI/REST: `e2e/scenario-bsrk01-c07-up-to.spec.ts`。非公開閲覧/公開のモーダルタイトルは `e2e/deck-view-title.spec.ts`。

`hand-increase-burst`: `stage=open/self-recovery/hand-burst` で通常回収／自己回収／手札ランガを検証。`stage=unseal` はBSTH02-M02の3ドロー→召喚→創界石の解封（このstageのownerはバースト所有者）。`owner=bob` で反転。Alice GUI / Bob REST: `e2e/scenario-hand-increase-burst.spec.ts`。

## 相打ちの魂状態選択

- `kenshin-inherited-symbol`: CX01を煌臨元に持つC04（`host=r03` はR03）のシンボルが柱斧のドロー解決後も赤/白の1個となり、柱斧と合わせて手札の弥彦を1コスト配置。`owner=bob` でREST、既定はAlice GUI。

- `mutual-soul-state`: 両者のアリサのBP比較後。`owner=bob` で攻守反転、`contract=1` で契約カード。GUIの受諾/辞退後、相手RESTまで処理する。

- `brave-bp-zero`: モルター支払い＋モウスィブロウのBP-80000を各2回ずつ分配。アリス＋金木犀/夜空、ユージオ＋青薔薇、キリトのBP0破壊を再現。`event=contract` で契約合体時、既定はアタック時。`owner=bob&manualOpponent=1` でBob REST。`targets=reborn` はユージオB面のBP16000と既存BP0を並べ、新たに0になった個体だけ破壊・既存0のバッジ維持を確認。

- `night-sword`: [仕様](../10_rules/07d_night-sword-combination-audit.md)。`mode=vanish&targets=soul&cores=3`: 同時消滅→ライフ移動→魂状態。
- `combined-effect-stack`: TR01(B)転醒時へのスタック・バウンス後、残留/同行と魂状態を選択。合体解除後は対象選択・破壊・カウント減少なし。`owner=bob` でREST側を検証。

- `inaho-combine-trigger`: C18の通常合体誘発。`zone=trash` / `owner=bob`。
