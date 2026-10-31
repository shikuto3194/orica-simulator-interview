# M06召喚時の任意ライフ増加

対象: followup-c0ae70cde5b1cb44a5b4 / Telegram受付629905108。
`?scenario=m06-summon-life&manualOpponent=1`で正規バーストセット済みの相手メインから始める。
`mode=normal`は通常召喚、`owner=bob`はBob REST / Alice GUI応答。

## 正源と境界

BSTH03-M06の本文は「Lv3-Lv4『このアルティメットの召喚/アタック時』ターンに1回、ボイドからコア1個を自分のライフに置ける」。
共有ミラー`external-qa/cardData.js`と`packages/card-data/src/cards/BSTH03.ts`を照合する。
[03c:10-15](../10_rules/03c_effect-text-interpretation.md)の「任意。プレイヤーがその効果を発揮させるかどうかを選択できる。」に従い、effect-level optionalを明示選択する。
応答窓後に実解決し、コア移動の共通プリミティブが増加禁止も評価する。

バーストの非公開表示は`setBurstStates`が担う。`faceDown:true`はフィールドの素性なしを表すため、セットの代わりに手作業で立てない（[素性の境界](../10_rules/04c_face-down-identity.md)、`zone/face-down-policy.ts`）。
シナリオと回帰は`set_burst`から生成したカードを次の相手メインの初期盤面に使う。

## 受入経路

`packages/rules-core/test/bsth03-m06-summon-life.test.ts`で、通常召喚とeffects[0]のバースト無料自己召喚について次を分離する。

- 維持コア1個でLv3となった後、召喚時任意効果が1件だけ出る。発揮宣言→相手スタックパス→ライフ5→6、ボイド10→9。
- 任意効果の辞退ではライフ・ボイドが変わらない。
- Lv3未満では発揮候補が出ない。M06の最低Lvは3なので、この対照は召喚後の0コア状態に対する候補評価であり、合法にLv1/2で召喚できるという意味ではない。
- BSTH002-R02の実カード由来の`life_gain_prevention`がある場合は、発揮してもライフ・ボイドが変わらない。阻止なしの対照と組にする。

`e2e/scenario-m06-summon-life.spec.ts`は両召喚経路・両所有者で、実APIの合法手から召喚・維持コア配置を解決する。
Aliceの「発揮する」とBob RESTの発揮宣言を通し、相手のスタックパス後にライフ画像数5→6・ボイド10→9・相手ライフ・ボイド不変・pending終端を照合する。
local room harnessは`prepareRoomViewerState`を使い、実行用APIと表示用盤面を接続する。配備先の実ルーム受入とは区別する。
このE2Eは既存scenario gateへ登録し、Vitestは通常の全件gateから到達する。

## 永遠亭との組み合わせ

追加依頼: followup-1151cd5472dfb540bd6e / 受付629905117（添付なし）。
`eirentei=1`で相手フィールドにBSTH03-C31を加え、通常召喚/バースト自己召喚と両所有者の4経路を通す。
永遠亭の本文とM06の本文は共有ミラー・raw・DSL間で一致する。監査元の版やhashの訂正は伴わない。
[召喚時ラベルと種類参照](../10_rules/07e_kanjuden-mechanics.md#スピリットとして扱わないqa-055)に従い、アルティメットM06は永遠亭のボイド増加抑止から除く。

`restrict_core_placement.sourceFilter`はコア移動を起こす効果の発揮元を既存CardFilterで照合する。
DSL/native型→registry→CE metadata→共通affect判定へ渡し、移動先や制限登録元のカテゴリを使わない。
通常コア移動とunion源、分配、レベル合わせは共通の効果発揮元解決を使う。
ライフ配置制限も同じフィルタを使い、`fromZone`と併用できる。フィルタ省略時の従来動作は保つ。

- `bsth03-m06-summon-life.test.ts`: 永遠亭の双方CEが有効な通常/バースト自己召喚から任意効果を選び、life+1/void-1・ボイド抑止blockログなしを確認する。
- `bsth03-c31-nexus-deck-void-restriction.test.ts`: 発揮元をスピリットにした双方の召喚時抑止と非召喚時許可を確認する。
- `restrict-core-placement-source-filter.test.ts`: 両プレイヤーのカテゴリ対照、各コア操作経路、フィルタ省略、テキスト供給元とhostの区別、ライフ配置と移動元制限の併用を確認する。
- GUI/RESTは上記4経路で任意効果表示・発揮・応答・life画像5→6・void10→9・pending終端を確認する。local room harnessの範囲は前節と同じ。

既存の629905108受入はM06単体の証拠であり、この組み合わせの成功証拠には流用しない。
依頼は最終gate・独立査読・verified commitの後に条件別の受入証拠を登録し、公開main包含が確認されるまでpendingを保持する。

公開・閲覧のraw監査fixtureはBSTH03実装モジュール全体のhashも固定している。
埋込再生成コードで648面・152本文行・公開分類・借用のruntimeEvidenceを再実行し、全意味データとraw/補助原本hashが一致した。
C31の追加フィルタ1行と説明コメント2行だけをメモリ上で戻すと旧Git原本のbytes/hashへ完全一致するため、その実装モジュールhashだけを根拠付きで再固定した。
比較証跡は`artifacts/m06-source-filter-public-audit-rebind.json`、fixtureの`sourceCorrections`へ保存する。ミラー原文・分類・件数・テスト期待値は変更しない。

GUI gateでM06比較経路・R21・ソウル状態のREST更新後にGUIが旧盤面へ留まる失敗を検出した。
`useRoomSync`が取得済みversionを進めた後、SSE状態変更で旧poll effectの結果が破棄されると、同versionの次pollがstateを返さず描画だけを失っていた。
同versionでは検証済みの最新cacheを再配送し、BattleScreenは既に適用した同じobjectを再記録・再適用しない。旧version・不正version・ルーム変更時の拒否は維持する。
`room-sync-errors.test.ts`で「取得済みだが未描画、サーバ更新なし」の状態喪失を修正前に再現し、同じ回帰で修復を検証する。retry・待ち時間の延長・RESTだけへの置換では回避しない。

## 受付添付の限界

添付183409 bytesのSHA-256は受付値と一致した。
保存盤面にはM06・当該召喚/ライフ増加ログ・`life_gain_prevention`がなく、過去事象の原因は確定していない。
現行正規経路の受入確認と過去原因の特定を区別し、再現しない不具合へのカード専用例外は加えない。
