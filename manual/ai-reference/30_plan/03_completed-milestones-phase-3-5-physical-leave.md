# 誘発・バースト・バトル解決後の離脱配送（2026-10-03）

入力: `orica-snapshot-2026-10-02T23-53-07-315Z.json`。BSAZ02-R02「ニロケラス」で自分のBSAZ02-X04「[導界者]アセイラム・ヴァース・アリューシア」を破壊し、3枚ドローした後、トラッシュのBSAZ02-M04「眠れる月の少女」が誘発しなかった。スナップショットは破壊後の状態で、回収効果の使用記録はなかった。

## 原因と修正

- カード定義は原因限定なしで正しかった。創界神/導界者を参照するfilterも既存の `matchesCardReferenceFilter` を使用していた。
- `runPendingReactionMainResolution` は待機入りの誘発を収集した後、実移動をイベント収集なしで行っていた。通常の `finalizeEffectResolution` を直接使う既存テストでは見つからなかった。
- 誘発・バースト共通解決の通常終了、解決前再評価中断、SBA後再評価中断の3出口を `flushPendingLeavesAndQueueReactions` に統一。バトル破壊後にも同じ欠落を再現し、同じ共通処理へ接続した。
- 原因プレイヤー、効果元、バトルID、離脱待機・残留選択の共通判定を維持。共通flushにイベント由来・同時解決グループを引き継ぎ、バトルの待機入りと実移動後を同じ束に保つ。カード定義や本文に限定・専用フィールドを追加しない。
- 根拠: [04d](../10_rules/04d_leave-choice-timing.md) の実移動後誘発、[04e](../10_rules/04e_leave-outcomes-and-trigger-eligibility.md) の同一効果と別誘発の区別、[08d](../10_rules/08d_grandwalker-nexus.md) のネクサス参照。新規裁定ではなく既存ルールの実装修正。

## 同類監査

`packages/card-data/src/cards/*.ts` のASTを再帰走査し、`leave_field` timingを持つ69箇所を確認した。内訳は前後面を含むカード直下effectsが62面・65定義、入れ子の付与効果が3定義、cardNo外の共通helperが1定義。カード直下のうち実移動後の指定は以下の8定義。本文・発揮場所・プレイヤー・原因限定を照合し、カード個別修正は不要と確認した。残るカード直下57定義は離脱待機入りを参照する既存経路で、今回の実移動後配送と二重発揮しないよう既存の解決済みregistration keyを維持する。

入れ子の3定義はBSFT01-C04、BSFT01-TR05(A)、BSTH09-X02の `grant_effect` 内の残留効果。共通helperはBSSA01の `transcendenceFlipTriggerEffects` で、BSSA01-転醒X01(A)/転醒X04(A)が使用する。追加4箇所はいずれも離脱前の残留/転醒であり、実移動後8定義の一覧への追加はない。

| カード | 発揮場所・限定 | 確認結果 |
|---|---|---|
| BSAZ02-M04 | トラッシュ、自分の火星ネクサス、原因不問 | 自分/相手の効果とも実移動後に回収 |
| BSAZ01-C06 | トラッシュ、自分のブレイヴ/ネクサス、相手によって | 自分効果は非誘発、相手効果・バトルは回収 |
| BSAZ01-C16 | Lv2、自分の地球かつCFスピリット、相手によって | exactEventKind・原因限定を維持 |
| BSDB01-TX01(B) | カウント14以上、自分による相手カードの離脱 | exactEventKind・原因限定を維持 |
| BSLH01-C05 | クォーツ、CBスピリット効果による相手カードの2回目の離脱 | exactEventKind・発生源filterを維持 |
| BSLH01-M04 | クォーツ、自分のスピリット効果による相手スピリット/アルティメットの離脱 | exactEventKind・発生源filterを維持 |
| BSTH02.7-X01 | 手札/手元、アリス邸または動玩/導魔、相手によって | exactEventKind・原因限定を維持 |
| BSTH10-M02 | 手札/トラッシュ、指定系統の黒、相手効果 | afterPhysicalLeave・原因限定を維持 |

トラッシュ常駐の近縁BSAZ03-M01は「離れるとき」なので待機入りで発揮する。BSAZ01-C06/M04と混同せず、既存回帰を全件検証に含める。`runPendingReactionMainResolution` の呼出元は誘発とバーストの2系統で、3出口をすべて回帰化。バトル解決の直接flushも監査し、追加修正した。宣言コスト（スピリット/アルティメットの破壊、フィールドのマジック戻し）やAIの手動コア移動は効果解決の出口ではなく、本件の火星ネクサス離脱とは対象・原因が異なる。

## 回帰

- `packages/rules-core/test/mars-trash-leave.test.ts`: ニロケラスの召喚誘発宣言→スタック→対象選択→破壊→ドロー→回収を正規アクションで完走。直接実行との差を再現した先行失敗から修正を確認。
- 自分/相手効果×破壊/消滅/手札戻し/除外×回収2カード、同名2枚のターン制限、バーストの通常終了/再評価中断2箇所、バトル破壊後の回収を検証。
- `e2e/scenario-mars-effects.spec.ts`: `mars-effects&mode=trash-leave`。Alice GUI・Bob RESTでアリューシアがトラッシュへ移り、ドロー後3枚から回収後4枚の手札になることを確認。画像: `debug-screenshots/mars-trash-leave-trigger.png`。
- 既存バトル回帰は破壊待機に加え、実離脱・トラッシュ増加と同時解決グループを確認。BSDB01-CX01の連続発揮回帰は後段の任意効果も解決してから次の破壊効果を実行する。
- 全検証・独立verifier・push/mergeの結果は標準harness/verifier証跡へ保存する。

Active Board・issue更新なし。
