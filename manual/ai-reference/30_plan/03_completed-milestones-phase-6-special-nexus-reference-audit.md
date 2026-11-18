# 創界神系のネクサス参照・全経路監査（2026-09-19）

親索引: [Phase 6](03_completed-milestones-phase-6.md)。裁定正源: [08d 創界神ネクサス](../10_rules/08d_grandwalker-nexus.md)。

## 再現と裁定

ユーザー提供 `orica-snapshot-2026-09-18T15-56-52-054Z.json` は第5ターンAliceアタック中、カウント14、Lv2ベニマルとLv3リムル。Bobの `BSSA01-XX01` が破壊された記録はあるが、ベニマルの誘発がない。添付JSONは盤面データとしてのみ参照した。

公式エターナル Q1532（2024.10.31、既存公式ミラー本文 A）は「参照する効果であれば、ネクサスとして参照できます」と規定する。BSTS01-M02は創界神に作用するのではなく離脱を参照し、ライフへ作用するため誘発する。導界者/創界石へのネクサス参照適用は独自種の本文と既存裁定からの実装上の推論 C。導界者を創界神として数えない qa-002、魂状態の参照制限、作用対象の制限は維持する。

原因は `matchesCardFilter` の作用対象用既定除外を参照条件にも使っていたことと、M02の `sourceWhose` 欠落。M02は被害者が相手、原因が被害者の相手の効果という既存指定を保ち、リスナーと被害者の所有者一致を要求しない `sourceWhose: "either"` を補った。

## 監査方法と範囲

`packages/rules-core/src` の `matchesCardFilter` 全呼び出し、定義専用filter、特殊種判定（grandwalker/guided/grandstone）、カードデータの離脱系game_eventを検索し、参照と作用対象を分類。`ALL_CARDS` は裏面を展開し、leave_field/destroy/vanish/bounce/remove_from_gameの相手・双方参照で `sourceWhose` が未指定の定義を検査した。修正後の残件は0。

`matchesCardReferenceFilter` は既存filterの実効値・OR・除外・種別限定・魂状態条件を再利用し、特殊ネクサスの既定対象ロックのみ解除する。個別カードへ `targetsGrandwalker:true` を追加する対処はしない。

### 修正した参照経路

以下のパスは `packages/rules-core/src/` 相対。

| ファイル | 参照する内容 |
| --- | --- |
| `card/card-filter.ts` | 参照用共通関数、継続効果の追加コスト枚数 |
| `effect/trigger-system.ts` | 通常誘発のイベント対象・原因効果の発生源、バースト条件 |
| `mechanics/grant-effect-system.ts` / `effect/retrigger-system.ts` | 付与効果の誘発、遅延誘発のイベント対象 |
| `effect/structured-condition-eval.ts` | 枚数・全体一致・対象参照・履歴・バトル等の条件 |
| `legal/legal-actions-shared.ts` | 宣言時の動的枚数/BP合計、下カードのシンボル供給元、フィールド同名存在 |
| `effect/target-resolution.ts` | 前段処理結果の枚数・コスト・シンボル合計（対象選択本体は維持） |
| `effect/native-condition-connector.ts` | 前段処理結果のカード照合 |
| `effect/deck-reveal-count-boost.ts` | オープン枚数補正の効果発生源 |
| `effect/structured-core-move.ts` / `effect/structured-state-grants.ts` | ライフ保護に照合する効果発生源 |
| `effect/redirect-effect-target.ts` | 対象変更条件の原因効果の発生源（変更先は従来判定） |
| `core/cost-system.ts` / `effect/effect-affect-adapter.ts` | プレイヤーへの制約が参照する軽減シンボル供給元・シンボル追加発生源 |
| `battle/battle-actions.ts` / `battle/battle-availability.ts` | ライフ保護・ブロック数/ブロック義務条件が参照する攻撃元 |
| `effect/granted-effect-materialization.ts` | コピーする効果本文の供給元 |
| `mechanics/star-garment-utils.ts` | 下カード枠数の判定で見る子カード |
| `effect/expand-effect-target-count.ts` | 元効果が選べる候補の種類を数え対象数補正を判定（候補追加はしない） |

### 変更不要と判定した経路

| 経路 | 判定理由 |
| --- | --- |
| `matchesCardFilterByDef`、存在確認の実効category直接参照 | フィールドの特殊ネクサス既定除外がなく、ネクサス参照に既に含まれる |
| `target-resolution` / `native-target-resolution` / `structured-effect-interpreter`、`redirect-effect-target`の変更先 | 破壊・移動等の作用対象を選ぶ |
| `structured-core-move`の移動先、`structured-core-shoot`、`payment-system`、`pay-to-act-core-gate`、`required-effect-cost-gate` | コアを移動する対象・支払い元を選ぶ |
| `native-action-shared` / `native-move-core-handlers` | 下カード操作の対象ホスト・コア操作対象を選ぶ |
| `grant-effect-system`の付与先、`advent-system`、`manifest-system`、`state-based-actions`、`recovery-restriction` | 効果付与・煌臨・顕現・移し替え・回復制限の作用先 |
| `effect-param-override` / `duration-override`、`stack-negate`、`effect-resistance-check` | カード効果の修飾/無効化、耐性、代替支払い。単なる種類の参照ではない |
| `battle-actions` / `battle-availability`の付与先、`legal-actions-availability` | 同時アタック・ブロック制限・使用禁止等の作用対象 |
| `legal-actions-shared`の残り | バースト/スタック制限、コスト、転醒対象、効果抑止、対象候補の照合 |
| `turn-system`、`native-action-registry`、`structured-zone-ops`、`structured-summon`、`summon-from-zone-candidates`、`zone-search-candidates`、`deck-reveal-pick-candidates`、`grouped-summon-cost-override-choice`、`summon-cost-exclude-choice` | 移動・召喚・支払い等の対象、またはフィールド外のカード照合 |
| 神託/導託/解封、独立コア管理、`only` / `grandwalkerKind` | 特殊種の識別・固有機構。ネクサス参照に含むことを理由に種別限定を消さない |

## 検証

- `special-nexus-reference.test.ts`: 実カード定義3種（BSSA01-XX01 / BSAZ02-X04 / BSTH001-転醒R01(A)）で参照・再誘発・付与誘発・ライフ保護・軽減上限・シンボル追加制限・対象枚数補正を確認。OR/除外/only/魂状態と通常ネクサス破壊の負例も確認。
- BSTS01-X02の実効果→イベント収集→M02合法手→スタック応答→ライフ6→5/リザーブ3→4。通常ネクサスでも同様、ベニマル2体でも重複不可、Lv1/相手ターンは不発。
- `special-nexus-reference` シナリオ: Alice GUI / Bob REST。ローカルGUIはREST状態を取り込まないため、Aliceは画面上のライフまで、BobはAPI状態を検証する。
- GUI起動時に既存共有 `brave-separation.ts` がVite設定の読み込み段階で未解決のdistを参照する問題を発見。サーバーからも読めるソースへの相対importに統一。
- 必須ゲート: `pnpm codex:finish-check:full`（型・全件テスト・文書・SSOT・wiring等）。完了時の実行結果はコミットとタスク報告に記録する。
