# 契約（Contract）

親索引: `08_advanced-mechanics.md`。煌臨/転醒は `08a_advent-rebirth-contract.md` を参照。
既存コード対応状況は `20_design/11_structured-effect-model.md` 参照。
ソース: batspi.com (`cmd=read&page=` で取得、2026-03-29)

---

デッキの基軸となるカード区分。契約スピリット・契約アルティメット・契約ネクサス（フラッグネクサス含む）の種類がある。

## デッキ構築 / ゲーム開始

- デッキに**1種のみ**（同名3枚まで）
- 開始時: シャッフル前に1枚抜いて裏向き提示 → **3枚ドロー**（通常4枚の代わり） → 公開して手札に加え計4枚

### 提示は任意（ユーザー裁定 2026-08-05）

- 契約カードを採用していても、**初手に加えるかは選択できる**。加えない場合は契約カードをデッキに戻してシャッフルし、通常どおり 4 枚ドローする（提示しなかった契約カードが初手 1〜3 枚目に来る確率をゼロにしないこと）。`PlayerState.contractCardNo` は `null` のままになる。
- **提示した契約カードの種別は相手に公開される**（→ [01b_information-visibility.md](01b_information-visibility.md)）。手札に加えた後もこの情報は残る。
- 提示すると**実質マリガン不可**になる。マリガンは手札を丸ごとデッキへ戻すため、契約情報を相手に渡したうえで初手固定の利点まで失う。これは「初手が 1 枚確定する」強さに対するデメリットとして意図された設計であり、マリガン側に契約カードの除外処理は入れない。

### 契約参照の判定（裁定 2026-07-17）

- 「自分がこのカードと契約しているとき」は、`contracts_only_mono_color` と同じく**デッキ採用レベル**で判定する。指定プレイヤーが所有する契約カード定義をゾーン横断で走査し、該当 `cardNo` が採用されていれば成立する。
- 「ゲーム開始時に提示した契約カードが〜」のように提示を明示する文だけ、提示レベル（実装上は `PlayerState.contractCardNo`）で判定する。

## 魂状態

- **BSRK01-CX01「このスピリットがいれば」**（2026-09-26ユーザー確認、信頼度C）: 【魂状態】で「飛天御剣流」の全軽減は有効だが、効果発揮後に魂状態のままならカウント+2しない。契約煌臨元では上のスピリットを参照する。軽減の適用資格と後段の存在条件を分け、後段を解決するときに判定する。回帰: `bsrk01-cards.test.ts`、`e2e/scenario-soul-state-presence.spec.ts`（Alice GUI / Bob REST）。

- **相手によって**フィールドを離れるとき、魂状態で残す**選択**可（**ルールであり効果ではない**）
- 選択は離脱関連効果・派生効果の解決後、待機解除と実移動の直前。ブレイヴ残留と同じ時点（公式 Q1501 / Q1533、信頼度 A、2026-09-09）。バーストの発動宣言は待機入り時に済ませる。→ [待機解除の順序](04d_leave-choice-timing.md)
- **資格はデッキ採用レベルで判定する**（ユーザー裁定 2026-08-05）。提示の有無に関わらず、そのプレイヤーのデッキに採用された契約カードであれば魂状態で残せる／魂状態への契約煌臨・契約合体の対象になれる。魂状態は契約カード共通の**ルール**であってカード自身の性質に付随するため、提示という手順には依存しない。提示レベル（`PlayerState.contractCardNo`）を見るのは「ゲーム開始時に提示した契約カードが〜」と明示する効果だけ（`presented_contract_color`）。
- 魂状態化時、上のコアは全て**リザーブへ**移動（契約創界神ネクサスは**ボイドへ**、公式 Q1533）。魂状態の上にはコアを置けない
- **疲労状態は保持しない**（2026-09-12、ユーザー裁定・信頼度B）。魂状態には回復・疲労・重疲労の区別がない。魂状態化時に疲労状態を消し、契約合体・リンクエイド・召喚などでスピリットに戻った場合は回復状態となる。実装上の `exhaustState: "recovered"` は中立値であり、回復効果を発揮した扱いにはしない。
- 制限: バトル不可・軽減不可・魂状態対象の効果でしか対象に取れず参照もできない
- 軽減不可の根拠: [公式エターナルマニュアル「フィールドにいる魂状態のカード」](https://www.battlespirits.com/rule/official-rule-manual-eternal/page12.html)（信頼度 A、2026-09-09 確認）。GUI のシンボル表示も魂状態を除外する（`FieldArea`）。
- Lvのある効果は不発。`〖魂状態〗` 効果はLvに関係なく発揮
- 通常召喚不可。魂状態のカードを召喚する効果でのみ召喚可能
- 破壊→魂状態の場合、トラッシュに置かれないため「相手による破壊後」バースト不発動

### 煌臨元を含む重なりからの魂状態化（2026-09-15、信頼度 A）

公式エターナル FAQ **Q1505 / Q1506**（2024-10-31 更新）。ミラー: `external-qa-official/_freeword-契約カード.md:125-133`。

> はい、「魂状態」にできます。これは《契約煌臨》でなく、《煌臨》を持つスピリットの煌臨元にあるときも可能です。（Q1505）

> 煌臨したスピリットや他の煌臨元カードは通常通り、指定された場所に移動します。煌臨元に契約カードが2枚以上ある場合は同時に複数「魂状態」にできます。（Q1506）

- 相手起因の離脱が確定した重なりでは、一番上に加え、同行する煌臨元の契約カードも選択対象にする。複数枚の選択を終えてから、選んだ契約カードを魂状態にし、残りを確定した移動先へ送る。辞退は他の契約カードの選択を妨げない。
- 魂状態で残る煌臨元は重なりの参照を解除して独立させる。契約カードはフィールドを離れておらず（Q1512）、上の煌臨スピリットは指定先へ移動する（Q1506）。
- 共有煌臨元は、本章の【真バディ】裁定に従い、別の煌臨スピリットが参照している間は離脱せず、魂状態化の選択も出さない。
- 適用例: **BSTS01-C01［受け継いだ想い］リムル=テンペスト**が破壊された場合、煌臨元の**BSTS01-CX01 リムル=テンペスト**を魂状態で残せる。`state-based-actions.ts` の候補列挙・同時選択と `contract-advent-leave` シナリオで検証する。

## フラッグネクサス (Ver.17.0 追加 / 確定: 公式 Ver.17.1 マニュアル page11、信頼度 A)

系統「フラッグ」を持つネクサス。ソース: `battlespirits.com/rule/official-rule-manual-eternal/page11.html`（2026-06-09 取得）。

- 定義: 系統「フラッグ」を持つネクサス。**「魂状態以外では通常のネクサス」**。
- **創界神ネクサスとの差別化（確定）**: フィールドで通常の**ネクサス対象効果を受ける**。かつ**配置時を含め上にコアを置く／メインステップでコア移動／コスト支払いに使用**ができる（通常ネクサス同様。創界神の「対象効果でしかコア不可」制約は適用されない）。ネクサスとしての**参照は創界神にも可能**で、この点は相違ではない（[公式Q1532](08d_grandwalker-nexus.md)）。
- **相手によってフィールドを離れるとき、魂状態にできる**（契約カード共通ルール）。
- 契約フラッグネクサスの場合: **デッキに1種類のみ／初期手札に1枚加える**（契約カード共通）。
- F契約煌臨: フラッグ煌臨したスピリットに【契約煌臨元】効果を与える（→ 下記 F契約煌臨節）。

（旧「残留懸念: Q&A 更新待ち」は公式 page11 の追加で解消。2026-06-09）

## 契約煌臨

- ソウルコアをトラッシュに置いて手札から重ねる。煌臨として扱われる
- **魂状態にも煌臨可能**。魂状態に煌臨した場合、フィールド/リザーブからコアを好きなだけ置ける
- 煌臨元カードになったとき、【契約煌臨元】効果をLvに関係なく発揮（合体中効果と同様）
- 「ターンに1回」効果は煌臨元/スピリット状態で合算1回

## 【バディ】キーワード（裁定 2026-07-13）

公式 Q&A (`external-qa-official/CB26.md:822-824`, Q15989, verbatim):

> Q: 【バディ】ってどんな効果なの？
> A: 【バディ】を持つスピリットには、この効果で指定されたカード名を含むスピリットカードを左右に分けて1枚ずつ、合計2枚まで《契約煌臨》できます。煌臨元になった【バディ】を持つカードは常に回復状態になります。また、【バディ】を持つカードと、それに重ねたカードには、指定されたカード名を含むカード以外を合体/煌臨/入れ替えできません。

自サイトミラー(qaData.js/errataData.js)に【バディ】ヒットは0件、`external-qa-official/`（公式FAQミラー）にのみ本問答えが存在する。信頼度A（公式FAQ verbatim）。

BSDB01-CX01【真バディ】(`external-qa/cardData.js:13932-13933`) はこの base キーワードの拡張版。ユーザー裁定（2026-07-13、上記公式裁定との突き合わせ後）:

1. **宣言単位は base キーワードと同じく1宣言=1体**。「対象を右左に1体ずつ」は**1回の宣言で2体同時に選ぶ**という意味ではない。
2. **構造は共有(分岐)モデル**。孫悟空名カード・ベジータ名カードはそれぞれ**別々の宣言**でこの CX01（host）を自分の契約煌臨元として選べる。2枚は host を「1番下の煌臨元」として共有し、host の上に**並行して**(host→A、host→B の分岐。host→A→B のチェーンではない)乗る。
3. **片方が離れても host は魂状態に戻らない**。一方の occupant がフィールドを離れても、host はもう一方の occupant の煌臨元としてそのまま残る（"一括移動"で host ごと道連れにはならない。host が本当に手放されるのは両方の occupant が離れたときのみ）。

**2026-07-13 反証・再設計完了**: 同日先行実装 `HostDualAdventGrant`/`mechanics/host-dual-advent.ts`/`declare_host_dual_advent` legal action (commit `80a24a07`) は「1宣言で2枚を同時に受け取り、host→slot0Card→slot1Card のチェーンとして重ねる」設計であり、上記裁定の (1)(2)(3) いずれとも矛盾すると判明（チェーンでは片方の occupant が独立して存在し得ず、`state-based-actions.ts` の「煌臨元カード一括移動」一般規則により top 離脱時に host ごと道連れになる）。

**類似構造 BSSG01-M01/M02（host 側煌臨許可付与）との差異確認（2026-07-25 ruling-researcher）**: BSSG01-M01/M02
「自分は、「暁 切歌」（M02は「月読 調」）を《ソウルコア》をトラッシュに置いたものとしてこのスピリットに
【煌臨】できる。」(`external-qa/cardData.js:10194`/`10224`) は、BSDB01-CX01 と同じ
「ソウルコアをトラッシュに置いたものとして＝擬制消費」経路を host 側に付与する構造だが、
(1) BSDB01-CX01 は alternateCost に「〔ターンに1回:同名〕」を明示するのに対し M01/M02 原文には
無く、(2) BSDB01-CX01 は「魂状態/煌臨元を含むこのカードには...【契約煌臨】できる」で通常
(実消費) 経路を別文で明示するのに対し M01/M02 にはこの文が無い。定型句「《ソウルコア》を
トラッシュに置いたものとして」を伴う `external-qa/cardData.js` 内の既知全実例（BSGE01-C09/C13、
BSDB01-CX01/R01、BSRK01-M01、BSSL01-X01）は例外なく「〔ターンに1回:同名〕」を伴い、通常経路が
あるカードはそれを別文で明示する一貫パターンを持つため、M01/M02 はこのパターンから逸脱している。
断定を避けユーザー確認待ちとして `needs-ruling.jsonl`（cardNo `BSSG01-M01/M02`,
kind:`"ruling"`, status:`"open"`）に記録した。詳細は
[issues/P3-89/open-gaps.md](../../../issues/P3-89/open-gaps.md) の「host 側煌臨許可付与」節。
回答確定まで `HostDualAdventGrant` の一般化（slots 可変長化 + 通常経路無効化フラグ +
alternateCost のターン制限無効化フラグ）は保留。

branch 構造へ再設計済み: host を2度 (スロットごとに1回) `executeAdvent` の target に直接指定するだけで branch 構造が自然に得られる (`executeAdvent` は毎回 target の `underCards` を独立にリセットするため新データ構造は不要)。各スロットの充足状況は専用フィールドを持たず既存 `underCards` を都度走査して導出 (`getHostDualAdventOpenSlotIndices`)。一括移動ロジックは「離脱する top 以外にまだその煌臨元を参照している現存カードがあれば道連れにしない」共有参照チェックを追加。詳細は [issues/archive/P3-117](../../../issues/archive/P3-117/index.md)。

## F契約煌臨 (Ver.17.0 追加)

フラッグネクサスに対応する新しい煌臨形態。

- **魂状態を含むスピリットおよびネクサスに煌臨可能**（通常の煌臨はスピリット/アルティメットのみ）。
- それ以外の処理手順（ソウルコア消費、煌臨元管理、状態引き継ぎ等）は通常の煌臨と同様。
- F契約煌臨も煌臨の派生形として扱われる。

## 実装設計

契約煌臨元効果の上カード条件と「持っているものとして扱う」は
[下カードの継承と効果の発揮条件](08a7_under-card-inheritance.md) を参照。

```typescript
// Phase B 完了:
// PlayerState.contractCardNo — preGame の契約提示で「提示する」を選んだときだけ設定。
// initializeGame() — 契約候補ありなら waiting_contract で開始し、提示確定後に 3+契約 / 通常4枚を配る。
// PendingSoulStateReplacement + resolveSoulStateReplacement() — 魂状態置換選択。
// PendingLeaveEntity.causePlayerId — 相手起因判定。
// 破壊→魂状態: pendingLeave除去→トラッシュ移動なし→バースト不発動。
// F契約煌臨: getFContractAdventTargets() で nexus ターゲット追加。Phase C で実装済み。
// 契約煌臨: getContractAdventTargets() / executeAdvent(isContractAdvent) で魂状態への煌臨。Phase C で実装済み。
// 増分2 (legal-actions 配線): AdventData.adventVariant ("contract"/"f_contract") で
//   getAvailableAdventLegalActions が列挙器を選び、declare_advent.adventMode 経由で
//   executeAdvent の isContractAdvent/isFContractAdvent を立てる。
//   executeAdvent のカテゴリ条件チェックも isFContractAdvent 時に "nexus" を許可するよう緩和。
// 魂状態への煌臨時のコア任意配置 (上記「コアを好きなだけ置ける」) は実装済み。
//   executeAdvent の枠外なので legal-actions-apply の declare_advent 分岐が煌臨直後に
//   buildChargeCoresPendingCoreDistribution で pendingCoreDistribution(any_movable) を
//   生成 (創界石転醒 postRebirth と共通 SSOT)。test/contract-advent-charge-cores.test.ts。
```

### 実装状況（2026-08-08）

上記「提示は任意」は preGame に実装済み。現状の扱いは次のとおり:

- `initializeGame()` は契約候補がある通常対戦では手札を配らず `preGame.phase="waiting_contract"` で開始する。提示する場合は契約 1 枚 + 通常 3 枚、提示しない場合は契約候補を含めてシャッフルし通常 4 枚を配る。`skipPreGame` はシナリオ/既存テスト互換として従来どおり自動提示する。
- room 対戦では `/pregame-update` が actor 自身の `contractPresentationChoices` / `contractConfirmed` だけを採用し、手札配布・`contractCardNo`・`game_start` 効果はサーバ側で確定する。提示前の候補 cardNo は本人にだけ、確認以降は提示した契約だけ相手にも sanitize 表示する。
- 魂状態の資格は `isPlayersContractCard(card, contractCardNo)`（`card/card-lookup.ts`）＝提示レベルの cardNo 一致で判定している。呼び出しは 3 箇所で、いずれも魂状態まわり: 魂状態で残せるか（`state-based-actions.ts`）／魂状態への契約煌臨（`mechanics/advent-system.ts`）／魂状態の契約合体（`legal/legal-actions-availability.ts`）。**契約煌臨そのもの（通常の煌臨先）はこのゲートを通らない。**
- デッキ採用レベル判定は `owns_contract_card` ConditionClause（`effect/structured-condition-eval.ts`）が既に実装している。魂状態資格をデッキ採用レベルへ寄せる移行時は、これを共通関数へ括り出して `card-lookup.ts` と共有する（同一ロジックの二重持ちは `check:ssot` の検知対象）。

GUI 側の提示・確認フローは [25_gui/08b_gui-interaction-reference.md](../25_gui/08b_gui-interaction-reference.md) の「4.7 契約提示 / 契約確認」を参照。
