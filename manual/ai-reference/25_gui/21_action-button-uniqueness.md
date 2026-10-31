# 行動ボタンの一意性

2026-09-26 ユーザー指示。同一画面・同一効果元で、同一文言の行動ボタンを複数生成しない。

- 共通 `ActionButtonChoices` は効果元と文言で入口をまとめる。候補を捨てず、押した後で本文による選択へ進む。
- 効果選択は `distinguishActionButtonChoices` で識別する。同じ本文の独立効果も保持し、必要時だけ選択肢番号を補う。
- `assertUniqueActionButtonLabels` が表示直前に重複を拒否する。対象選択フッターにも適用する。
- マジックは使用入口→効果選択→コスト支払い→相手の応答窓という既存順序を維持する。
- カード操作モーダル、効果選択、下部アクションバーで同じ原則を使用する。

クォーツも入口は「クォーツセット」1件。位置・交換先は専用HUDで選ぶ。
宣言画面の行数は `ActionButtonChoices` と同じ候補集約から数え、配置先の数を含めない。
カード画像は通常の宣言と同じサイズ。本文選択ボタンが実際に表示された段階だけ、
共通CSSで本文用の領域を確保する。候補の重複だけを理由に画像を縮めない。
`?scenario=quartz-replacement`（`owner=bob`でREST側）、`e2e/scenario-quartz-replacement.spec.ts`。
手札・手元からの宣言サイズと六・七表記は `e2e/scenario-card-presentation.spec.ts`。

## 範囲コストの神技

BSTH11-X01は「神技発揮」1件→相手の応答→共通コアHUDで2～6個を選択→「完了」→実支払い数に応じたバウンス対象HUD→戻し先選択→解決。
コアが6個未満なら現在数を上限にする。奇数支払いも可能で、対象上限は支払い数を2で割り切り捨てる。
対象を選ぶ前に支払いを確定し、再開時に二重払いしない。無効・発揮元離脱・必要コア不足では支払いを行わない。

根拠: [神技の発揮宣言と窓後支払い](../10_rules/08d_grandwalker-nexus.md)。
回帰: `?scenario=divine-skill-payment`、`e2e/scenario-divine-skill-payment.spec.ts`。
