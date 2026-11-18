# 要石のデッキ除外先

2026-10-15、Telegram `629905096` / `followup-8954ae6f798127ac5d3f`。

## 根拠と修正

受付原本、添付snapshot、remote main `10266ff13`、カード画像を照合した。添付の相手カード`card-46` / `card-47`は`void`にあり、`effect:move_card:deck->void:2cards`が記録されている。

[03c:143](../10_rules/03c_effect-text-interpretation.md)は「除外する」を「ゲームから除外する」と同義としている。[01b:24](../10_rules/01b_information-visibility.md)は除外を双方の公開ゾーンとしている。カード画像の召喚時・緋想/竜渡のアタック時本文も「相手のデッキを上から2枚除外する」で一致する。

`packages/card-data/src/cards/BSTH05.5.ts`の要石`effects[1]` / `effects[2]`について、既存の`move_card`の移動先だけを`void`から`removed_from_game`へ修正した。既存の除外ボタン・ZoneBrowseModalの閲覧先は正しく、UIの変更は不要。

## 回帰と確認範囲

- `packages/rules-core/test/bsth05_5-cards.test.ts`: 召喚時の旧void期待を修正。常時効果再構築後の合法手から、緋想スピリット・要石自身・竜渡アルティメットのアタック宣言→誘発宣言→応答窓解決を通す3正例を追加。相手デッキの先頭2枚のID・所有者・移動先、残り札、void不在、誘発/応答窓終端、移動ログ1件を検査する。系統不一致・相手のアタックは誘発しない。竜渡でもアタックできない紅美鈴は合法な攻撃候補に出ない。査読で判明した要石2体の未解決誘発と紅美鈴の常時効果欠落を修正した。旧除外先では召喚時とアタック正例が失敗し、修正後は通る。
- `apps/playground-web/src/scenario-kaname-removal.ts` / `e2e/scenario-kaname-removal.spec.ts`: `?scenario=kaname-removal`、`mode=attack`、`owner=bob`。Alice GUI→Bob REST、Bob REST→Alice GUIの通常召喚とアタックを既存dev専用room harnessで操作する。上2枚の除外・残デッキ1枚・void不在・移動ログ1件・誘発/応答窓終端と、盤面の除外ボタンから2枚の一覧・詳細を確認する。
- `packages/rules-core/test/fixtures/revealed-target-ui-raw-audit.json`: 最初の全件gateでカードモジュールの旧hash失効を検出。埋込再生成コードでraw全648面・152本文行と借用/公開のruntimeEvidenceを再実行した。意味データ、raw原本hash、補助原本hash、実行証跡は全値一致し、mainとの差分がC01の除外先2か所だけであることも独立比較した。その根拠と関連回帰を`sourceCorrections`へ追記してモジュールhashを再固定した。原文・監査分類・期待件数の巻き戻しは行っていない。

必須gate・verifier・verified commitは当該treeの証跡を参照する。親runnerへの統合要求はmain反映・配備・依頼resolveと別で、確認前は依頼をpendingに保持する。
