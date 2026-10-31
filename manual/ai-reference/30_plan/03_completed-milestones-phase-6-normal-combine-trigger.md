# 通常合体からの共通誘発収集

Telegram `629905087` / `followup-61146166ea8525233014` の修正候補（2026-10-13）。
main統合と配備は親runnerの検証対象であり、この文書だけでは完了扱いにしない。

## 原文と状態遷移

- [03e](../10_rules/03e_effect-duration-and-repeat-scope.md)は「発揮開始タイミング語彙がある」効果を「原則として誘発効果」と扱う。
- `packages/card-data/raw/by-pack/BSAZ01.js`のC18本文は「自分のスピリットに『界塚伊奈帆』が合体したとき」。効果由来への限定はない。DSLの`brave_combined`と名前条件は維持する。
- 通常`brave_combine`は従来、合体状態を返すだけだった。左右いずれも共通`collectAndQueueTriggerReactions()`へ合体前後差分を渡し、通常操作の根IDは`allocateRootTriggerChain()`から取得する。
- 異魔神の右スロットは`imaginRightCombinedWith`だけを変更する。[08c §7](../10_rules/08c_imagin-mirage-grandwalker.md#左右合体)の「1体ずつ処理」に従い、共通収集器が新しい右リンクも検出する。左の既存リンクは再収集しない。
- 通常操作にはcauseを付けない。契約合体の`braveCombinedCause: "contract_combine"`は変更しない。
- 手札のC18は私的宣言、公開トラッシュのC18は公開誘発キューを使う。辞退は使用回数を消費しない。
- 原因IDの採番だけは学習の盤面進展ではない。既存の進展fingerprintからroot通番を除き、実際の宣言待ち・誘発・使用記録は保持する。合法な合体/分離を繰り返す既存回帰と、C18の宣言待ちが進展に残る対例を検査する。多重合体fixtureも実際の誘発lookupへ接続し、反応元のないイベントを架空の待ち行動にしない。

## 呼出元の確認

| 呼出元 | 差分収集の担当 |
|---|---|
| `legal-actions-apply.ts`通常・異魔神右合体 | 今回共通収集へ接続 |
| `native-action-registry.ts`効果による合体 | 呼出側の効果解決finalize。追加の内側収集は不要 |
| `structured-summon.ts`即時・保留付き召喚 | 効果finalize / `pendingMultiPlacement.priorStateSnapshot`から継続finalize |
| `pending-action-handlers.ts`直接合体召喚の配置 | 保存した効果前状態からresolution.finalize |
| 同ファイルの召喚後合体選択 | deferred stack再開 / effectSummonのtriggerBeforeStateからfinalize |
| 同ファイルのmultiPlacement合体 | 元のpriorStateSnapshotから継続finalize |
| `contract-combine-system.ts`契約合体 | 既存共通収集と契約causeを維持 |

## 回帰と確認範囲

- `bsaz01-cards.test.ts`は実際のLegalActionで通常合体、手札/トラッシュの宣言・窓・直接合体召喚、効果合体の辞退後に分離して同一ターン再合体、通常召喚後の合体選択を完走する。既存の使用済み同名制限も維持する。
- 直接合体後のC18自身の必須召喚時誘発も、窓と0枚選択まで解決する。unit/e2eの最終盤面でpendingの消去、コア0、同じhost、使用回数と召喚・解決ログの各1件を確認する。初回査読の途中盤面assertという指摘を反映した。
- 添付はcard-17=CX01、card-20=C02、card-6=C18。効果合体・私的辞退と後の通常合体ログを確認した。添付ログはターン3→5だが、回帰は依頼のより厳しい同一ターン条件を検査する。秘密情報をfixtureへコピーしない。
- `c2-trigger-events.test.ts`は右合体のLegalAction、変化なし、cause未指定/契約causeの既存対例を検査する。
- GUI/RESTは`inaho-combine-trigger`と専用e2eを使用。既存dev専用roomHarnessで実REST engineへ接続し、Alice GUI操作とBob REST操作、ポーリング反映、直接合体後の盤面を確認する。本番認証・配備証跡とは区別する。

## 救出と引継ぎ

開始時の最新stash `418f85c91`は`git stash show -p`と未追跡3ファイルを確認した。
I0 caller計測の候補であり、優先Telegram修正の前提ではない。後続のowned RSS修復を持つ
`rescue/engine-drain-i0-caller-20261012`と既存archiveへ引き継がれているため、古い候補を今回applyしない。
完全なstash object（3親・未追跡データを含む）を
`refs/archive/engine-drain-rescue/telegram-629905087-reviewed-stash-20261013`へ保全してdropした。
残るstashとprimaryの別作業は操作していない。I0候補を検証済み・統合済みとはしない。
選択follow-upは統合要求中もpendingを保持し、親のmain確認後にのみresolveする。
後続受付629905088 / `followup-5c08789c43cfbf0edbea`は合体と召喚の意味イベント基盤を扱う。
今回の通常合体部分との重なりは確認したが、状態差分による召喚推定の廃止はその別依頼に残る。
後続依頼全体を解消済みとして閉じない。
