# 効果由来の使用枠・消費管理（使用会計）

効果の回数制限・取得した権利・実量の集計・事実の記録は、**一つの会計（`GameState.effectAccounting`）**だけが保持する。
機構ごとの「使用済み」配列・辞書・独自キーは持たない。この文書がその契約の唯一の説明で、他の文書はここへリンクする。

ルール上の意味の根拠は [03e 期間と反復](../10_rules/03e_effect-duration-and-repeat-scope.md)（期間と共有範囲は独立した軸）、
[03e 対象別制限](../10_rules/03e_domain-repeat-scope.md)、[02d 追加ステップ・ターン](../10_rules/02d_extra-steps-and-turns.md)、
[03b 解決と中断](../10_rules/03b_resolution-and-interrupts.md)（宣言済みの不発は回数を保つ）。

## 配置と依存方向

`effect-usage/`・`effect/`・`legal/`・`mechanics/` は `packages/rules-core/src/`、`test/`・`fixtures/` は `packages/rules-core/test/` 配下。

| 層 | 場所 | 役割 |
| --- | --- | --- |
| 中核 | `packages/rules-core/src/effect-usage/` | 型・識別・時計・純粋な台帳・正規化。GameState・legal・GUIを実行時importしない（型は `model`/`dsl-types` から参照）。例外は旧形式の変換 `migration.ts` で、各機構の site 構築関数を呼ぶ境界 |
| 状態アダプタ | `effect/effect-usage-accounting.ts` | 時計の導出、制約と文脈の組み立て、**GameStateへ台帳を反映する唯一の層**（初期化・保存復元・公開投影・移行境界を除く。許可は `scripts/effect-usage-ssot.mjs`） |
| 入口 | `legal/legal-actions-shared.ts` | `queryEffectUsage` / `canUseEffectUsage` / `consumeEffectUsage` / `refundEffectUsageOperations`（上限の評価を束縛する薄いfacade） |
| 機構別の組み立て | `mechanics/advent-usage.ts` など | 機構の事実から `UsageSite` を作るだけ。キー・配列を持たない |

制限の型（`EffectUsageLimit`）は `effect-usage/types.ts` の一つだけ。`model.ts` と `dsl-types.ts` はそれを参照する。

## 制限の軸（`UsageConstraint`）

共有・期間・世代・使用者・測定を**独立の軸**として持つ。文字列連結のキーを各所で作らない（識別は `identity.ts` だけが生成する）。

- 共有: `instance`（発揮元個体）/ `card_name`（同じプレイヤー内の同名）/ `group` / `subject_instance`（誘発主語ごと）/ `grant`。
- 期間: `game` / `turn` / `step` / `battle` / `event` / `activation`。別々の型のIDで表し、ステップ名だけをIDにしない。
- 測定: `use`（回数）/ `amount`（実量）/ `observation`（観測）/ `fact`（事実）。回数に数量を混ぜない。
- 同名カードでは同じ効果部分の使用枠を共有し、異なる部分は別枠とする（[裁定](../10_rules/03e_effect-duration-and-repeat-scope.md)、2026-11-18）。現行実装は印刷名＋構造化した効果全体の指紋で照合する。同じ印字でも `textRef` やDSL構造の差で別枠になり、同一Effect内に共通部分と異なる部分が混在する場合は部分単位で照合できない。
- 上限は固定または動的式で、使用済みとは別。上限が下がっても使用済みを切り詰めない。評価は既存の `DynamicCount` / 条件評価に委譲する。
- 同名共有の鍵（`context.nameKey`）は、呼出しが定義解決（`getCardDefinitionById`）を持つ前提で printed name になる。本番の呼出しは `LegacyUsageCallOptions.getCardDefinitionById`（型で必須）を通すので全経路で揃う。定義が引けない呼出しは定義IDで代替し、鍵が経路でずれる（列挙では使えるのに記録しても枠が効かない）ため、専用の機構は `nameKey` を明示する。
- 【魂状態】を含む効果か（soul 世代を個体の寿命に含めるか）は、列挙で渡す効果と、ラベルしか持たない記録・解決で同じになるよう、ラベルから効果を引く唯一の写像 `effectOfUsageLabel`（`effect/usage-identity.ts`）で決める。継続効果（`redirect_effect_target` 等、ラベルが経路名で効果を逆引きできない）は `sourceEffectOfContinuousEffect` が登録元の効果を返し、列挙と記録の両方が `sourceEffect` に渡す。渡し忘れは `pnpm check:ssot` の ce-source-effect が検出する。

## 操作（照会・消費・取消）

- `queryUsage` は状態を変更しない。候補の列挙・任意効果の辞退・未宣言の重複不可候補は**消費しない**。
- `consumeUsage` は全制限を確認してから**原子的**に更新する。同一 `operationId` の再送は冪等。同じ操作内で同じ枠を指す制限は一度だけ加算する。
- 消費は receipt（`operationId` と枠ごとの差分）を残す。`refundUsage` はその操作の差分だけを一度戻し、他の操作・他プレイヤーの消費を減らさない。
- 消費の地点は意味ごとに固定する（宣言時／コスト確定時／適用時）。無効・不発・空撃ち・支払い取消を同じ取消扱いにしない。
- 0未満・非整数・欠落した使用者は拒否する（使用者の推測補完をしない）。
- 消費に失敗した呼出しは state を変更しない（採番も進めず同一参照を返す）。宣言・解決の記録点（`recordEffectUsage*`）で失敗した事実は、列挙と記録の識別のずれ（無制限化として現れる）の兆候なので `usage:consume-failed:<理由>` として log に残し、検査（実経路テスト）が検出できるようにする。列挙と記録は同じ効果（`sourceEffect`）を渡す。ラベルが経路名（`spirit:N` 等）の呼出点は、ラベルから効果を逆引きできないため必須。
- 同じ `operationId` で量や対象の枠が違う再送は `operation_conflict` で拒否する。バトル外の `battle` 期間は、数える枠なら使用不可、観測なら何も記録しない（照会と一致）。バトル期間の枠・権利はバトル終了の確定（`finalizeBattleEndScopeExpirations`）で整理し、同じ攻撃者が同じステップで再度アタックしても前のバトルの使用済みを持ち越さない。

## 時計と追加ターン

時計は台帳に保存せず `GameState` から導出する: `turnId = turnNumber`、`stepId = stepOrdinalThisTurn`（ステップ遷移で +1、ターン開始で 0）、`battleId = activeAttack.attackId`。
効果でエンドステップへ飛ぶ遷移（`end_turn` の確定）も別のステップとして序数を進める。
`stepOrdinalThisTurn` はターン内状態なので、追加ターンの中断・復帰は既存の `returnContext.turnContext` の退避・復元で元に戻る。
台帳は入れ替えない。復帰で時計が戻ると中断元の枠が再び見え、`game` 枠は追加ターン中の消費も累積する。生存する時計（現在＋中断元）に属さない枠だけを整理する。

## 個体の寿命

実離脱で `fieldInstanceGeneration` が進むと個体の枠は更新される。魂状態化の `soulStateGeneration` は、【魂状態】を含まない効果の個体枠だけを更新する。
同名共有の履歴は個体の離脱では消えない。世代の更新は `effect/effect-usage-lifecycle.ts` が唯一の正源。

## 通常セット枠・ゲーム履歴との分担

`burstSetPlayerIdsThisTurn` / `mirageSetPlayerIdsThisTurn`（通常セットのルール上の制限）、`flashCardUsageLog` など出来事の履歴、pending・スタック・バトル進行の文脈は会計の対象外で残す。
効果による免除の**使用**は会計、通常セット枠は別。観測・宣言事実・実使用の履歴は意味が違うので混同しない。

## 公開投影（viewer）

会計は能力由来の非公開カード情報（手札・伏せ札の定義ID、非公開宣言の使用）を含みうるので、`projectEffectAccountingForViewer` が viewer ごとに投影する（`sanitizeStateForViewer` / 観戦）。
本人は自分の枠・権利・receiptを全て、相手・観戦者は公開が設計されたものだけを見る: ミラージュ免除の枠、神技・導技・界放・契約技の宣言数の観測（`measure=observation`。旧 `usedDivineSkillKeysThisTurn` が相手にも見えていた情報量で、将来のAI特徴量の入力候補。現行の観測入力では未使用。使用回数の枠は公開しない）、追加アタック権・コネクトバトル権と**その行使量**（旧 state でも伏せていなかった公開情報。付与だけを公開して行使を伏せると、相手の視点で行使済みの権利が未使用に見え、AI 観測が使用済みの追加アタック権を available と誤報告するため、行使の枠も同じ範囲で公開する）。
採番カウンタ `nextOperationSeq` と自動採番の receipt ID（`usage-op:N`）は全プレイヤーの消費で進む共有の値で、そのまま渡すと相手の非公開な消費の件数が、カウンタの差分や ID の欠番から推定できる（公開 receipt の ID からも）。投影では見える receipt の自動採番 ID を 0 から詰めて振り直し、カウンタも見える件数から決める（投影は表示専用で、操作の正源はサーバーの state）。
state が運ぶ receipt 参照（スタックの `recordedUsage`・終了予約の `refundableUsage`・`declarationUsageOperationIds`・`privateDeclarationUsageOperationId`・継続効果の `usageOperationId`・stepContext の `stepUsageReceipts` の値）も同じ写像（`projectUsageOperationReferencesForViewer`）で振り直し、viewer に見えない receipt への参照は取り除く。公開スタックに生の採番を残さない。型が運ぶ receipt 参照のプロパティ名は `USAGE_OPERATION_REFERENCE_KEYS` に登録する必要があり、`effect-usage-viewer-projection.test.ts` が型定義（`model.ts`・`step-execution-context.ts`）から未登録のプロパティを検出する。
ミラージュ免除・神技等の宣言数の観測の公開 bucket と追加アタック権・コネクトバトル権以外の公開数量（ターン累積ライフ減少など）は、AI 探索の projector を実装する際に会計から投影する設計を明示する。ギミック宣言数（`declarationCountThisTurn`）は旧実装では公開 state に載っていたが、数量 bucket になって本人のみに見える（相手・観戦者は 0）。消費者はサーバーのフル state で動くエンジン側で、クライアントは配送済みの合法手を使う。
クライアントは使用可否を自分で判定せず、サーバーの合法手を正源とする。

## 再分散防止（機械検査）

`scripts/effect-usage-ssot.mjs`（`pnpm check:ssot` に接続）が次を検出する: 許可外モジュールによる `effectAccounting` の直接書込・台帳の組み立て、識別キー生成関数の `effect-usage/` 外での利用、旧会計フィールドの実行時参照、継続効果の経路ラベル（`redirect_effect_target` / `expand_effect_target_count` / `grant_effect_source_prevention_immunity`）の列挙・記録が `sourceEffect` を渡していないこと。
素直な書き方に限らず、分割代入・要素アクセス・計算キー・同一ファイル内のconst文字列の連結・`Reflect.get(s, "…")` の文字列引数、`effectAccounting` 配下への代入・破壊的メソッド・部品の上書き、`import * as` 経由や再エクスポートのキー生成関数も検出する。対象は rules-core・ai の src、replay-codec、apps（テストは除く）。変数経由の動的な名前の組み立てなど静的に決まらないものは対象外で、レビューが補う。
旧名を持てるのは、旧形式の検出境界 `effect-usage/legacy-guard.ts`・変換の `migration.ts`・旧観測の語彙写像 `ai-observation-encoder.ts`（旧 kind 名を文字列のデータとして改名後へ写すだけ）に限る。
カタログ全件の制限は `packages/rules-core/test/effect-usage-catalog-manifest.test.ts` が型駆動で列挙し、汎用キー再帰との件数不一致（正規化されずに落ちた制限）で失敗する。同テストの識別 pin（`test/fixtures/effect-usage-identity-pins.json`）は既存カードの path・種類・値を hash で固定し、step の挿入・並べ替えや制限の種類の変更（件数は変わらず識別だけが変わる）で失敗する。本文の編集だけで変わる同名共有の指紋は対象外。意図した変更は `EFFECT_USAGE_PINS_UPDATE=1` で pin を更新し、保存済み state への影響を記録する。

## 保存と互換

保存形式（snapshot・room）の版付き移行と拒否条件は [保存と互換](20a_effect-usage-accounting-migration.md)。
