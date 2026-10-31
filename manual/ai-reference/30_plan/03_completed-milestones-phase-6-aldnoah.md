# アルドノア召喚時と純化（2026-09-26）

ユーザー提供の2スナップショットから、召喚直後の条件判定と純化の合体判定を修正。
裁定の根拠は[調査記録](../00_meta/source-findings-aldnoah.md)。

- ただちに誘発の解決前に落としていた通常公開候補を保持し、先行処理後に条件を確定する。発揮元が離れた場合の除去、任意辞退、通常処理開始後の復活防止を維持。
- 純化の分離例外は共通の合体判定を経由する。アルドノア下カードは、表裏にかかわらず重なりを解除して裏向きカード状態へ移行する。
- 回帰: `aldnoah-immediate-summon.test.ts`、`bsth10-purification-board.test.ts`、`scenario-kanjuden.spec.ts`。手札/場/導域の下置き、辞退、純化の表裏、既存の合体ブレイヴ/分身を確認する。
- GUI/REST: `?scenario=kanjuden&mode=aldnoah-summon` / `pure-aldnoah` / `pure-aldnoah-facedown`。Alice GUI、Bob RESTの両側を用いる。

現役ToDoの追加・変更、独立issueの起票は不要。

## 2026-09-27: シレーン画像が並ぶ誘発キュー

- 手札ドライブの宣言候補で原因カードのC03を画像・本文に使っていた誤参照を修正。宣言後も登録効果番号を引き継ぎ、下置き本文を維持する。
- 条件後判定待ちのC03を画像のフォールバックで先に表示しない。神託等の発揮元は共通の機構判定で特定する。
- 回帰: `aldnoah-trigger-queue.test.ts`で手札/場の3枚、宣言前後の画像・本文、下置き優先、神託とC03各1回のコア増加を確認。GUI/REST入口は[アルドノアシナリオ](../25_gui/10e_aldnoah.md)。
