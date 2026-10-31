# 化け化けの個別交換

正源は [ミラージュの裁定](../10_rules/08c_imagin-mirage-grandwalker.md)。
受付原本は Telegram 629905111、追跡先は `followup-8437fb41d31008128c86`。

`?scenario=burst-mirage-zone-browse` は両者にバーストとミラージュを各1枚置き、
バーストエリア内の斜め重ね表示とクリック閲覧を確認する。

`?scenario=mirage-individual-swap` は、化け化け+Aから通常Bをセットする盤面を作る。
追加と化け化け交換は提示せず、Aとの交換だけを選べる。
`incoming=exempt` は新規化け化け、`multiple=1` は既存化け化け2枚、`owner=bob` はBobの盤面。

- 化け化け+Aから化け化けB: 追加、既存化け化けとの交換、Aとの交換。
- 化け化け2枚から通常Bまたは化け化けC: 追加、既存1枚目との交換、2枚目との交換。
- 入口は「ミラージュセット」1つ。同名の交換先は盤面と選択肢のセット番号で区別する。
- 交換先0〜1件をLegal Actionに保持し、支払いHUD後にも同じ選択を宣言する。

`e2e/scenario-mirage-individual-swap.spec.ts` は全候補をAlice GUI / Bob RESTで完走する。
既存のroom harnessを通じて、GUI宣言をRESTで読み、REST宣言への応答と最終盤面をAlice GUIへ同期する。
最終ゾーン、セット記録、交換ログ、コア実支払い、GUIの個体順を照合し、選択肢・支払い・最終盤面の画像を残す。
REST一覧は交換先と実コストを含む。全件交換・他人・非セット・重複・枠超過の直接適用拒否と、
同名ターン1回・別名/相手の独立性・旧セーブ移行は `bsth002-c01-mirage-set-count-exemption.test.ts` で確認する。

`?scenario=mirage-effect-swap&effect=self|free|paid` は実カードの効果解決を交換選択直前まで進める。
`self` は里香(EX)の手札セットと後続回復、`free` は竹田ヒバリのバースト公開セット、
`paid` はスカベンジャー・ファイド自身の公開時セット（1コア）を使う。既存は化け化け2枚。
各3候補をAlice GUI / Bob RESTで選び、公開処理・回復・実支払いまで完了させる。
オンラインのstep choiceは非公開継続情報を持つサーバで確定し、一人バトルは完全状態で解決する。
交換待ちの公開処理は共通の原因文脈走査にも接続し、保存中も原因ID検査とバトル終了待機の寿命を保持する。
効果セットは新たなスタック窓・通常行動数・手札同名免除を消費しない。
`mirage-effect-individual-swap.test.ts` は全writerで4盤面の全候補と、実カードM04/R02の経路、
副作用前の選択、支払い1回、秘密情報の非開示を確認する。里香(EX)の実効果回帰は
`bsth002-x01-free-hand-mirage-set.test.ts` で交換後の既選択対象と回復の継続も確認する。

宣言後の応答で交換先が離れても、別ゾーンから引き戻したり別個体へ交換先を変更したりしない。
空いた通常枠へセットできる場合はそのまま解決する。応答で別の通常ミラージュがセットされ、
元の選択では枠を超える場合は [03f](../10_rules/03f_stack-failure-and-waiting-cores.md) の共通取消処理で
元の宣言と支払いだけを戻す。応答側のセットと支払いは保持する。
上記の単体回帰は、有償効果セットによる割込みと、交換先がトラッシュへ移動する場合を反証する。

公開mainの採用は [受入証跡](../00_meta/followup-acceptance.md) と親runnerの統合確認で別途判定する。
