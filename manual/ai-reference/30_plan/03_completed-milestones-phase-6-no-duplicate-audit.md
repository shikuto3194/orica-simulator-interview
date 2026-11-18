# 重複不可の全件監査とリムルのキュー（2026-09-17）

## 再現と修正

提供snapshot `orica-snapshot-2026-09-17T10-11-13-555Z.json` は、魂状態とスピリット状態の
BSTS01-CX01が同じ召喚イベントを観測していた。発揮後の使用制限はエンジンで機能していたが、
キューのソース収集が使用記録を見ず、他方を表示し続けた。
snapshotのカウント4→6は1回の発揮にBSTS01-C03の増加量修正+1が乗った結果。

ユーザー確認に従い、発揮前は2個体を選べるまま残し、宣言後は使用済み候補を除去する。
`resolution-items.ts` から共通の `canUseEffectByUsageLimit` を呼ぶ。
キューには魂状態・スピリット状態・煌臨元を表示し、背面カードの露出端にも状態を出す。
原文以外の「重複不可：どちらか1体」という補足は追加しない。

## 全件監査

全収録カードの `textLines` から「重複不可」「重複しない」「重複できない」「重複出来ない」
「重複せず」を抽出し、本文→DSLと、全 `no_duplicate` 定義→本文を双方向で検証（90項目）。
同名別個体の使用不可、別プレイヤーの独立性、同ターンの別イベントでの再使用を検証する。
継続効果の登録と消費側、inlineドロー、公開誘発、私的宣言、公開カード回収の専用処理も照合。

| 判定 | 対象 | 内容 |
| --- | --- | --- |
| 修正 | BSTH01-C12 ヴワル魔法図書館 | 同名ターン制限を `no_duplicate` に修正。同ターンの別ドローステップを妨げない |
| 修正 | BSRK01-C02 神谷薫 | 継続効果へ `no_duplicate` を明示。消費側の先頭1件扱いだけに依存せず重複登録を防ぐ |
| 機構で表現 | BSAZ01-C18、BSES01-T01 | 追加合体と召喚前トークン配置。空の本文参照effectと機構の回帰テストを確認 |
| 機構で表現 | BSTH002-C01 | `mirageData.exemptSetCountLimits`。既存のセット枚数免除回帰で確認 |
| カード全体指定 | BSLH01-C02 | 「このネクサスの効果は重複せず」が後段にも及ぶ。両effectに指定済み |
| その他 | 全該当本文・全重複不可定義 | 指定あり。複数制限の併記、分割effectのgroup指定を維持 |

## 検証

- `packages/rules-core/test/no-duplicate-audit.test.ts`: 全件本文監査と使用可否。
- `apps/playground-web/test/no-duplicate-queue.test.ts`: 魂状態/スピリット状態の両方を選択。
  宣言後の他方除去、カウント+1、スピリット発揮元だけの後続ドローを実行。
- `?scenario=no-duplicate` / `e2e/scenario-no-duplicate.spec.ts`: Alice GUI宣言とBob REST応答。
- 既存のgame-event、inline draw-step、継続効果、mirage-set-count、手札増加対価の回帰も実行。

### 完了時の実行結果

- 今回のコミット予定内容: Vitest 943ファイル・12,820テスト成功、既存7テストはskip。
  同じmain working treeで別タスクの編集が進行していたため、依頼外のTSはViteの読込時だけ
  作業開始時の `fdd32e148` に固定した。今回の変更と新規テストは現在の内容を実行し、
  実ファイルとindexは書き戻していない。ログは `artifacts/no-duplicate-frozen-full-tests.log`。
- 共有ツリーそのままの `pnpm test` は並行編集中のバトル終了・対象差し替え等で8件失敗。
  `pnpm codex:finish-check:full` も並行変更を含むformat検査で停止したため、成功とは扱わない。
- rules-core/GUIの型、全体ESLint、docs、SSOT、wiring、GUI/RESTは成功。
  共有ツリーの未コミット変更は今回のコミットに含めない。

ルール正源: [03e 重複不可](../10_rules/03e_effect-duration-and-repeat-scope.md#重複不可の詳細)。
現役タスクの追加・変更なし。
