# BSLH01-CX01 クォーツ再確認（2026-09-27）

- qa-029〜035/039とENIGMA本文を再照合。[裁定・出典](../10_rules/07g_quartz-replacement.md)。
- 通常セット・効果セットに交換先選択を追加。同名交換、満杯時交換、応答後の交換先消失を扱う。
- 双児珠の手札からの入れ替え禁止を通常・効果セットとHUDの共通候補へ反映。
- 同数の交換でもセット成功と判定し、後続効果は新しくセットしたカードを参照する。
- 交換で手札へ戻るカードは魂状態・セットを解除し、手札増加時の対象外にする。
- 「クォーツセット」1ボタン→スロットHUDへ統一。RESTにもhost・位置・交換先を公開。
- BPのないカードがBP0として候補に入るフォールバックを修正。実効BPを持つ分身は維持。
- 回帰: `quartz-replacement.test.ts`、既存クォーツ・BSLH01回帰、`scenario-quartz-replacement.spec.ts`。
  検証経路は分離コピーの`codex:finish-check`（型・全件テスト等）とGUI/REST。
  通常交換・効果交換・双児珠の禁止位置・相手RESTと魂状態レイアウトを確認。
  Active Board・issueの変更なし。

## バースト位置選択と交換移動先（2026-10-13）

- Telegram 629905086 / followup-c69a24bd1268bdca7101の原本・添付を照合。本番R05バースト→2段階スタック→セット枝で位置pendingが落ちる経路を回帰化。
- 法的アクションの解決と入力継続に対話コンテキストを共通適用し、バースト以外の任意手順→対象→位置選択も維持する。
- バースト自身の交換で旧カードを通常バーストの解決後移動先へ送り、通常の手札セットは手札へ戻す。[ユーザー裁定の範囲・信頼度](../10_rules/07g_quartz-replacement.md)。
- 独立verifierの公開APIポリシー反証を修復。`stay_in_burst`の実効移動先も位置pendingへ保存し、再開時にlookupを省略しても旧カードはburstへ移動する実経路を回帰化。
- 回帰入口: `burst-quartz-placement.test.ts`、`scenario-burst-quartz-placement.spec.ts`、既存通常交換回帰。R05の中央/右追加・占有右交換・後続破壊/ドロー/カウントの一度だけの完走、非バースト継続を確認する。
- `?scenario=quartz-replacement&mode=burst`は実バースト宣言から開始。`owner=bob`でRESTとGUIの反転経路も確認する。
