# Effect Target And Prerequisite Gates

> [03c_effect-text-interpretation.md](./03c_effect-text-interpretation.md) からサイズ分割（2026-06-24）。効果文言の強制/任意・ことで構文・反復・BP0 文言などは 03c を参照。

## 効果の「対象」がプレイヤーかカード/ゾーンか（人称判定）

(公式 Q&A 信頼度 A、2026-01-17 更新 / BSFT01-X01 星霊王・BSSA01-転醒X04 裁定)

- **効果文中の人称の直後に読点「、」が付くもの＝プレイヤーを対象とした効果**。「相手は、」「自分は、」「お互い、」など。
- 読点が付かず特定のゾーン/カードを指すもの（「相手のスピリット」「手札」「コア」）はカード/ゾーン対象であり、プレイヤー対象ではない。
- 同じ意味の効果（使用できない / 発揮できない / 効果を受けない 等）でも、**カードごとにプレイヤー対象かカード対象かの裁定が異なりうる**。文言の人称＋読点で個別判定する。
- 例:
  - 「相手は、ドローできない」→ プレイヤー対象
  - 「手札を1枚捨てる」（手札破棄）→ 手札（ゾーン）対象。プレイヤー対象ではない
  - コア奪取 → コアのある場所（ゾーン）対象。プレイヤー対象ではない
- この区別は「自分は相手の効果を受けない」型の**プレイヤー耐性**（例: BSTH01-X07 EXルーミア 節②）が何を防ぐかの判定に使う。プレイヤー耐性はプレイヤー対象効果のみブロックし、手札/コア/フィールドのカードを対象とする効果は別途カード耐性側で判定する。

実装状況: 配線済み（P3-77 Phase 3/4、2026-06-01）。プレイヤー耐性は `player_effect_immunity` CE + `isPlayerImmuneToOpponentEffect`（effect-resistance-check.ts、自分/system 起因は対象外）で判定し、restrict_flash/use/manifest/end_attack_step 等のプレイヤー対象 executor を人称 gate（相手起因 player 対象を no-op）。詳細は [P3-77 archive](../../../issues/archive/P3-77/index.md)。

## 所有者の指定がない破壊対象

公式エターナル [BS01 Q24495](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=BS01) は「自分か相手の表記がされていなければ、自分のスピリットを対象にできます」とする（公式A、2026-10-27再確認。ミラー `external-qa-official/BS01.md:906-909`）。
BSTH01-R21の「BP5000以下のスピリット/BP1000以下のアルティメット1体」は所有者無指定なので、この一般則を適用して両プレイヤーを候補に含む（本文A・適用は推論C）。「ことで」の結果可否にも同じ範囲を用い、相手に対象がいないことだけで発揮不能にしない。

## 「○○しなければ△△を発揮できない」(発揮前提の除去/移動効果)

手札増加に課すコストの任意性、公開回収/自己回収/ドローのイベント単位は
[手札増加対価](03d2_hand-gain-cost.md)を参照。

(独自カード裁定、信頼度 C。2026-06-15 ユーザー確認 / 耐性①の拘束力の扱いと「含む」opt-in 判定は 2026-08-02 ユーザー確認で改訂。コア除去型 BSTS01-M03 / BSSL01-M03、手札破棄型 BSSA01-X01 等は下記)

- 「相手は[ゾーン]のコア1個をトラッシュに置かなければ、フラッシュ/スタック効果を発揮できない」型は**追加コスト(pay-to-act)でなく、発揮の前提として相手にコア除去(移動)を課す継続効果**。コスト経路でなく `core_move`/除去で表現＝この再分類により**耐性が効く**のが最大の差。
- **耐性の受け手は2つ**: ①発揮するフラッシュ/スタック効果(またはそれを持つカード)、②移動するコアの在処。
  - **①耐性持ちは「要求自体」を消さない**: 「コアを置け/手札を破棄せよ」という要求(pending)は耐性の有無を問わず変わらず提示される。耐性が効くのは**拒否/候補0でも不発にならない**という一点のみ(要求に応じるかは任意、応じなくても効果は解決する)。
  - **神技(divine_skill)フラッシュは①とは別の理由でそもそもゲート対象外**: `PAY_TO_ACT_GATED_STACK_KINDS` は `magic`/`accel`/`change`/`field_card_effect`/`hand_card_effect` と、見出しラベルがフラッシュの起動型キーワード宣言(`declare_advent` 系/`declare_manifest`/`contract_combine`/`link_aid`)を対象にするが、`divine_skill` は含まれないため、耐性判定に到達する前に構造的に除外される(pay-to-act-core-gate.ts `PAY_TO_ACT_GATED_STACK_KINDS`)。
  - **「○○を含む」opt-in の無いカテゴリは①耐性持ちとして扱う**: 創界神/導界者ネクサス(フィールド上)・魂状態カード・ミラージュ(セット中)は、ゲート効果の文中に「創界神ネクサスを含む」「魂状態を含む」等の明示が無い限り対象に含まれない(`matchesCardFilter` の既定除外を空フィルタで流用、ミラージュのみ `zone === "mirage"` 判定。`isCardInOptInOnlyCategory`、pay-to-act-core-gate.ts)。ただしこれは**カード状態(フィールド上でない、例: 手札にある創界神ネクサスの配置フラッシュ)には及ばない**——`matchesCardFilter` の創界神既定除外は `card.zone === "field"` 限定のため、手札/手元からの活動はこの opt-in-only 除外の対象外(通常どおり拘束される)。
  - **②除去不可な場所(効果を受けない等)からは移動不可**。コア除去ゲートは「コアを移動させる効果」である以上、コア源候補の判定は通常の `core_move` と**同一の SSOT** `getFieldCoreSourceTakeableCount`(structured-core-shoot.ts)を通す。次の5層がゲートにも一律に効く:
    - (a) 独立コア管理(創界神/導界者/創界石。`filter.targetsGrandwalker`/`targetsGrandstone` 明示指定が escape hatch)
    - (b) **対象ロック**(`cannot_be_targeted`/`cannot_include`)
    - (c) 効果免疫(`defense_immune`、バイスタンダー保護)
    - (d) CardFilter 既定除外(魂状態等。ゲートは opt-in 無し＝`filter:{}` を渡す)
    - (e) コア最低残存数耐性(`cannot_reduce_cores_below`)
  - 候補の `available` も印字コア数ではなく**耐性を差し引いた実移動可能数**。リザーブ空＆フィールドが全て②除外のみ→**①にも該当しなければ**発揮不可(①-a/①-b いずれかで非拘束なら不発にならない)。
  - **「コア奪取＝コアのある場所を対象にする効果」であり、コアのある場所がカードならそれはカード対象**(上記人称判定節の帰結、ユーザー確認 2026-08-02)。したがって「対象にされない」耐性(b)はコア奪取に効く。
  - **発揮するカード自身の手札/手元耐性では免除されない**: 通常カードは使用→発揮で発揮時に `in_use` 等の非保護領域へ移り、手札/手元の耐性に守られず対象になる(例外: BSKB01-R04/BSES01-C04 のように「発揮後まで」「常に」`in_use` を含めて受けないカードは①-a に該当し非拘束)。
- **手札破棄型ゲート**(「相手は手札1枚を破棄しなければ…発揮できない」, BSSA01-X01/BSTH03-R02/BSTH09-R02)も発揮前提の**手札破棄(除去)効果**で耐性が効く。差は受け手②＝**破棄される相手の手札カード1枚(相手選択)**: その札が耐性持ちなら破棄不可(手札に残るバイスタンダー＝手札耐性に守られる。上記「発揮するカード自身」とは別主体で矛盾しない)。①-a/①-b いずれにも該当せず、かつ非耐性の破棄候補無/手札0枚なら発揮不可。
- **対象は明示ラベルの「フラッシュ」/「スタック」効果のみ**(タイミングでなく効果種別で判定。逆も真)。誘発=含まない、バースト=原則含まない。
- **粒度＝毎回**(発揮1つごとにコア1個/手札1枚)。同型ゲート複数(別カード)なら合計複数個。〔重複不可〕は同名のみ抑止。
- **タイミング＝発揮(解決)の直前・対象選択前**(宣言時前置でない。対象選択は解決時=[magic_target_after_stack_window])。
- **マジック等カード使用は止めない**(使用は通り発揮直前に除去要求、不能なら不発でトラッシュ＝空撃ち類似)。支払い不能/拒否はその効果のみ発揮不可(①非該当時)、スタックパス常時可。

### 「○○から1コスト支払わなければアタック/ブロックできない」(バトル宣言前提のコスト)

(独自カード裁定、信頼度 C。2026-08-05 ユーザー確認。BSAZ01-C09「煙幕阻害」)

- 上記「発揮前提の除去」型はフラッシュ/スタック**効果の発揮**が対象だが、この裁定は**アタック/ブロック宣言**の前提コストにも同じ構造を適用する（対象拡張）。「相手は、アタック/ブロックする相手のスピリット/アルティメットから1コスト支払わなければアタック/ブロックできない」（BSAZ01-C09）は、読点判定によりプレイヤー対象効果（[効果の「対象」がプレイヤーかカード/ゾーンか](#効果の対象がプレイヤーかカードゾーンか人称判定)節）だが、コスト源泉は対象スピリット/アルティメット自身の通常コアであるため、その支払い（コア消費）自体は対象カードへの「効果」として扱う。
- したがって対象カードの**効果免疫**(`defense_immune`)・**コア最低残存数耐性**(`cannot_reduce_cores_below`)がこの支払いをブロックしうる。ブロックされれば要求コストを支払えず、結果としてそのスピリット/アルティメットではアタック/ブロック宣言できない（`source_not_ready`）。
- この制限は「アタック/ブロックする相手の**スピリット/アルティメット**から1コスト支払う」ことを条件にするため、何らかの効果でスピリット/アルティメット以外のカード種類がアタック/ブロックする場合、そのカードはこの支払い条件の対象ではない（2026-08-10 ユーザー確認、独自QA qa-047 追補）。
- 判定は上記②除去不可な場所からは移動不可と同じ SSOT `getFieldCoreSourceTakeableCount` を通す（`isBattleCostGateUnaffordable`、battle-availability.ts）。raw `normalCoreCount` の直接比較はしない。
- 実装/テスト: `packages/rules-core/src/battle/battle-availability.ts`(`isBattleCostGateUnaffordable`) / `packages/rules-core/test/bsaz01-c09-battle-cost-gate.test.ts`。

実装メモ:

- `restrict_flash`/`restrict_stack` のハード禁止でなく、発揮前提の除去効果＋耐性判定。継続ゲート CE 登録＋発揮解決前置フック(対象選択前)が両型共通の要件。
- **受け手②の候補判定は「その除去が何の効果か」の SSOT に合流させる。** コア除去型は `getFieldCoreSourceTakeableCount`(コア移動元候補の SSOT)、手札破棄型は `isGateCandidateProtected`(pay-to-act-core-gate.ts、手札カードの免疫＋「含む」opt-in 除外)。**ゲート専用の候補フィルタを新規に書かない。** コア除去型は当初この合流をせず `normalCoreCount > 0` だけで候補を組んでいたため、免疫もコア最低残存数耐性も効かないまま長期未検知だった(同一規則の並行実装が別々に育った SSOT ドリフトの実例)。
- **コア移動元候補の列挙は例外なく `getFieldCoreSourceTakeableCount` を通す。** 2026-08-02 時点で、`analyzeCoreShootCandidates`(`from:field`)/ その自動 fallback / `from:field_card` / 明示ソウルコア2経路 / 発揮前提コア除去ゲート の全経路が合流済み。ソウルコアは複数個化しうるため個数(`soulCoresOnCard`/`soulCoresMovable`)で受ける(P3-101)。`canMoveCoresFrom` はコア保有判定に `CardInstance.soulCoreCount` を使う一方コアシュート経路のソウルは `player.soulCoreLocation` で追跡されるため、本 SSOT は独立コア管理の判定だけを `hasIndependentCoreManagement` から直接取る。
- コア除去型 (`gate_flash_stack_core`, pay-to-act-core-gate.ts) / 手札破棄型 (`gate_flash_stack_hand_discard`, pay-to-act-hand-discard-gate.ts) いずれも実装済み。両型とも `PendingPayToActCoreGate.declineFizzles` / `PendingPayToActHandDiscardGate.declineFizzles`(+ `PendingPayToActHandDiscardSlot.holderImmune`) で①の拘束力有無を pending に持ち回り、`applyPendingPayToActCoreGateAction` / `applyPendingPayToActHandDiscardGateAction` の decline 分岐が `declineFizzles=false` なら不発にせず解決を再開する。

## 効果種別の具体例（2026-09-10再確認）

信頼度 C / ユーザー確認。既存原則の具体例。

- BSGE01-R01 の「フラッシュ『お互いのアタックステップ』」は明示見出しなので、召喚を含んでいてもフラッシュ効果。BSSA01-X01 の手札破棄、BSTS01-M03 のコア移動の両方が発揮前提になる。公式 Q8430/Q9791/Q14674 の行為許可を「手札から召喚する効果」全般へ広げない（独自 qa-054 も「召喚できる」という文言だけでは分類しない）。
- BSGE01-CX01〜CX04 の【バレットエディット】入替は本文が「フラッシュタイミングで」であり、フラッシュ効果ではない。両ゲートの要求を出さず、`flash_used` にも数えない。
