# 魂状態への契約煌臨・フィールド供給の回帰

対象: Telegram 629905085 / `followup-c32cb0134c17fad8e459`（2026-10-12）。
選択依頼の回帰候補。main統合前はpendingを保持する。

## 正源と入力

[08a2 契約煌臨](../10_rules/08a2_contract.md)は「魂状態に煌臨した場合、フィールド/リザーブからコアを好きなだけ置ける」と定義する。0個配置を一律に禁止しない。

受付原本を全文確認し、信頼しない添付JSONはデータとして読み取った。保存時刻は2026-10-10T02:53:46.682Z、SHA-256は`4d1a65a440b58f777f10449825d3fe645fa16db7c607c47441fed209212c051a`。最終盤面はR01/card-5・CX01/card-26がtrash、C08/card-8がfieldに通常4/ソウル1、リザーブ0。ログでは真バディの代替コストを選択し、任意配置は`player-selected-empty`として解決された。snapshotのoriginにはsourceKindのみあり、当時の配信revision・pending・クリック列を確定できない。

## 現行経路の確認

調査時のsource HEAD・local main・remote mainは`662a38c09fb18da6f514076dc7771ff94f0a0a9b`。同時に稼働PC APIの`/healthz`と公開フロントの`/release-version.json`が同SHAを返した。これは調査時の一致であり、添付保存時や今回の回帰候補の配備証明ではない。

- `core-charge-distribution.ts`は通常ネクサスC08をfield sourceへ含め、`sourceAvailable["field:<id>"]`に4を持つpendingを作る。
- 真バディのnormal/alternate選択を経由する実宣言・stack pass・対象選択をrules-coreとRESTで行う。代替コストではC08上のソウル1が残る。
- `requiresCoreDistributionTargetTotals()`はこのpendingで別の総数選択HUDを要求しない。BattleScreenのsource→held→target→draftを使い、`recomposeTrashDistributionLegalAction()`が配置先・供給元の両配分を再構成する。
- game-apiの通常実行・保存用passthrough双方に`coreDistributionSourceAllocations`がある。既存dev専用roomHarnessを実REST engineへ中継し、GUIのroom dispatchに両配分が入ることと、R01=field/1・C08=field/3の最終盤面を確認する。本番JWT/DBルームの実対戦はこの回帰の検証範囲に含まない。

現行sourceでは操作不能を再現しない。ゲーム本体・API・配分制約の実装変更はせず、不足していた実カード横断回帰とシナリオを追加する。

## 再発時の証跡

`?scenario=contract-advent-charge&manualOpponent=1`が最小盤面。自分側GUIまたは`owner=bob`のREST操作で再現できる。自動回帰はnormal/alternateのGUI配置、RESTの1/0個配置、GUIの0個完了を確認する。

Playwright添付`core-distribution-evidence`にはpendingのfromKind・allowedSources・sourceAvailable、assert後に実測したHUDのphase/text、ネットワークで観測した配分payloadのみを保存する。スクリーンショットは`debug-screenshots/contract-advent-charge-one-<alternate>.png`。認証header・全GameState・非公開カード定義は診断証跡へコピーしない。新しい報告は配信revisionとこれら3点を併せて比較する。

## 救出差分の判断

最新救出stash `582e213d35825af59b814b7785fde2823c4cd37f`は別unitのI0 caller部分会計と失効監査確認であり、本依頼の前提ではない。既存引継ぎは同unitのchain到達試行3件を記録しているため、このrunで第4試行はしない。stash本体・全parent（未追跡3ファイルを含む）をGit ref `rescue/engine-drain-i0-caller-20261012`へ保全してから最新stashをdropし、残りの救出stashは保持した。I0候補の承認・commit・統合を完了したとは扱わない。
