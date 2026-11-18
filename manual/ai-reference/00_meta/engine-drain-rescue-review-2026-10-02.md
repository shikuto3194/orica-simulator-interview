# engine-drain 救出 stash の確認（2026-10-02）

## 判断と保存先

wrapper 指定の20件と、同じ自動救出 marker を持つ追加1件を確認した。
確認時の lane HEAD は `8ccada01cb8d50cec58e6a7193eecd83af48b0f3`。
各 stash の tracked 差分、index 親、untracked 親を調べ、untracked ファイルは0件だった。
実装修正は現行 tree と main に取込み済みであり、復元を要する未反映差分はなかった。
旧確認記録・旧残量を適用すると現行の schemaVersion 2 記録と実測を巻き戻すため、採用しない。

削除するのは下表の確認済み stash entry だけで、元の Git object は
`refs/archive/engine-drain-rescue-20261002/<下表の完全SHA>` に保存する。
この ref は stash の index / untracked 親も保全する。復元は
`git stash apply refs/archive/engine-drain-rescue-20261002/<完全SHA>` で可能。
同一 repository のローカル保存であり、remote に archive ref を送信したとは扱わない。
全文 patch と SHA-256、全親・ファイル一覧・判断は lane の
`artifacts/full-run-current/rescue-review-20261002/inventory.json` と `<完全SHA>.patch` に保存した。
他 branch の stash と `engine-drain recovery backup before main 916743b9f` は変更しない。

## 現行実装との対応

|区分|stash の内容|採用済みの根拠|
|---|---|---|
|A|BSTH10 の10任意効果、BSTH003-C32 の無償直接合体 carrier、正例・破損例、snapshot 出力、旧確認記録|`992dd3c08` が card-data と optional 配線回帰の同一差分を含む。直接合体 carrier と反例も現行で保持。旧 schemaVersion 1 記録と残量だけ不採用|
|B|BSTH003-C32 carrier・反例・snapshot 出力と旧確認記録|`992dd3c08` の整形済み実装と対応し、現行も `asSummon:true`・source 未指定だけを無料 carrier として扱う|
|C|BSRK01-X01 / BSSL01-C02 / BSTH001-C03 / BSTH002-R03 の旧確認記録と残量・着地|変更は旧 context、根拠/回帰 hash、説明と当時の残量だけ。4件とも現行 fresh fidelity の schemaVersion 2 `confirmed_correct` に置換済み|
|D|BSTH01-M01 継続マジック無料化 carrier と実カード・監査器回帰|追加で検出した21件目。`916743b9f` に取込み済み。実カード回帰は同一差分で、carrier は verifier を経て未印字条件・分岐等を拒否するより厳密な形になっている|

`992dd3c08` と `916743b9f` は確認時の HEAD と local main の双方の ancestor である。
current tree の carrier・回帰の存続も確認し、commit の存在だけで判断していない。
全件 gate で上記回帰を含む現行 tree を検証する。確認記録や baseline の hash だけを更新しない。

## 原文・裁定と回帰

- 任意効果: [03c](../10_rules/03c_effect-text-interpretation.md) の「発揮有無は effect-level `executionMode:"optional"` のみで表し、先頭 `EffectStep` に step-level optional を重ねない」。BSTH10 の10対象と `bsth10-cards.test.ts` の配線・盤面回帰が対応する。
- 直接合体: [05](../10_rules/05_brave-and-attack-special-cases.md) の「直接合体の場合、コアを置くこともできる（個数不問、置かなくてもよい）」。BSTH003-C32 の保存原文の無償召喚と、`bsth003-cards.test.ts` のリザーブ・ブレイヴ上コアの最終盤面を照合した。
- 回数制限: [03e](../10_rules/03e_effect-duration-and-repeat-scope.md) の同名共有ターン／ゲーム制限と event 単位の `no_duplicate`。対象4件の fresh confirmed 記録はそれぞれ `bsrk01-x01-hand-gain-prevention`、`bssl01-cards`、`bsth001-c03-draw-discard`、`bsth002-cards` の盤面回帰を引用している。
- フラッシュ: [02](../10_rules/02_turn-flow-and-timing.md) の「フラッシュ使用後はスタックサブ窓が開き、解決後にループ継続」。BSTH002-R03 の同名別個体・相手側独立・解決後のコア移動の回帰を保持した。
- 継続無料化: `cost-override-magic.test.ts` の BSTH01-M01 実カード回帰と `test-fidelity-audit-integration.mjs` の正例・制約混入反例を現行で確認した。旧案に戻すと追加条件や期間違いの拒否を失うため、stash の carrier を再適用しない。

## 個別判断

下表は stash 番号の変動を避け、完全 SHA で保存先と判断を固定する。
すべて取込み済み実装／置換済み記録として archive ref を確認後、stash entry を drop する。

|stash SHA|区分|
|---|---|
|`46da8967de70f7826e1962ff6931ab3a5a486b60`|A|
|`72a0f3b7de2d53957a0f0886c730bff34531b028`|A|
|`48b634025ebfe656c7cc9d4ec2aacec8b3cf03dc`|A|
|`5ed67e1a811bf97b9ca47f7b07cc742e19edc948`|A|
|`164011ed9b810b7249138e42be84a72310d07727`|A|
|`f7adaae9457a35bed27519f3f95f333f3c2152b7`|A|
|`dd3d36040c38d0c83c326efe1f610dbd58991d20`|B|
|`6e427723b29d9a7ede1512af7a0a6db13aa1210d`|C|
|`b1efcc47ffba37ddcc4a689261e74781a8d5bf96`|C|
|`056e2856239094513d6858de5f5d3ca6e42ed32c`|C|
|`3c79caa7a5454a919f044ce078798cdd18f318e0`|C|
|`08a625c364d6dc38f505cb67bb7192d9e2629127`|C|
|`e12084f443d6f20c37e6ba6935e4e118f4179b5c`|C|
|`9d0bcaaedcb3f52e7a24b78a5aa1590e9a387427`|C|
|`cb9821c3bba98a7e0a9fbd3639a6f795fc61b062`|C|
|`0d3e2f519537c61593d3d326aa28bb0b960b44e0`|C|
|`0bfc2f7d260d5db1b7c6c44f45c16a8df199b59c`|C|
|`a34b645a9c34a3a5608370ffa4c593b8030e264e`|C|
|`f33a3a2c3eb1af1a5bdd686f465e60900ca51d92`|C|
|`ed319234215aa7410d7b8982428d2f7cf3afbe59`|C|
|`dde3953255ffab43859a69be4a0f2e411598a2ab`|D|

この判断は coverage/fidelity 監査範囲の既存修正の最終化である。
main 統合・remote main・両 tree の fresh 監査の最終確認は親 runner に委ねる。
対象外の AI デバッグ・EDH・checkpoint の未完了記録は保持する。
