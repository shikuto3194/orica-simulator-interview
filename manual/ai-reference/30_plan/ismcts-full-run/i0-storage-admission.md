# I0 保存容量の受付

`storage-admission.mjs`をWindows共有budget入口へ接続する。
Git共通hubと登録worktreeを既存`artifact-storage.mjs`で解決し、
全artifactの実保存量・空き容量・保護参照の計測を再利用する。
警告・blocked・計測失敗は生成を拒否する。既存policyの上限を変えず、削除もしない。

現在管理するnamespaceは、登録worktreeすべての`artifacts/ismcts/`と
共通hubの`logs/ismcts-program/`。論理byteを合算して予約出力量を加え、
20GiB soft境界以上を拒否する。圧縮・hard linkでこの枠を拡張しない。
全artifactの150GiB警告境界と空き150GiB警告値にも予約出力を反映する。
欠落directoryは0byteだが、リンク・junction・非通常file・不正な計測値は拒否する。

共有予約前とcheckpoint保存後の生成直前に、新しい容量検査をそれぞれ実施する。
後段の拒否ではプロセスを作らず、全予約・ownerを保持する。
下位受付の入口で単調clockを固定し、検証・初回/再検査・service判定の所要時間を
残り期限から引く。期限切れやservice受付を
生成へ進めない。公開入口に保存先・policy・容量callbackの上書きはない。
私有回帰のfactory/容量callbackは下位の信頼された検査seamだけに置く。
受付ではrequest/callbackのdata descriptorを一度だけ読み、accessor・未知fieldを
予約前に拒否する。検査と共有予約へ同じ出力量を渡し、後段検査は保存済み予約量を使う。
専用service状態/AbortSignalと正規化済みargsを保持し、生成引数の準備後に最終期限を判定する。
公開`onSample`はundefined・関数・accessorとも予約前に拒否する。観測関数を呼んでから判定しない。

## 管理artifactの書込み

`writeManagedArtifact(worktree, id, owner, name, payload)`は共通hubを解決し、
同じactive予約のownerを照合する。64MiB以下のBufferを内部byte列へ一度固定し、
共有transaction内で累積出力claimをcheckpointへ保存してから容量を新規計測する。
予約枠超過・所有者不一致・終了済み予約では書かない。容量拒否、計測失敗、
保存失敗、期限切れでもclaimを返さない。完全会計で完了する場合も出力量の申告はclaim以上を要する。

保存先は共通`logs/ismcts-program/managed-output/<reservation-id>/artifact-<name>.bin`。
名前を制限し、リンク・junctionを拒否、新規fileの排他作成とfsyncを使う。
同じ共有lockを保存終了まで保持し、協調writerと完了処理の競合を拒否する。
同名の再試行でも上書きしない。部分fileと失敗claimは保全する。
容量検査・directory準備・checkpointの所要時間を単調clockで期限へ含め、
payload前と保存後に検査する。同期I/O自体の独立強制中断は未接続。

これは小容量管理APIの分割実装。任意moduleの出力先、API外の同時writer/増加、
今後のtraining/service保存先、caller/helperの完全会計は未接続。
payload枠はcheckpoint等のmetadata byteを含まないが、容量計測は共有namespaceのmetadataも含む。
上記namespaceを全AI生成物の完全な会計や本番稼働の受入へ昇格しない。
`accountingComplete:false`と全予約保持、`R1-runtime`/`calibration` gate未登録を維持する。

回帰は私有小容量Git/worktree・共有history・junctionを実列挙し、破損registryを拒否する。
上限の反例は実policyの数値へメモリ内の計測値を与える。20GiB実負荷は生成しない。
容量拒否の前後・予約保持・検査遅延・service変更をfactory境界で確認する。
管理writerは私有Git/worktreeの実保存・共有枠・部分書込み故障注入・再起動・履歴巻戻しを検査する。
Bufferの偽length等を参照せず内部slotの長さでcopyし、上限の検査は大容量負荷と区別する。
既存Windows取消回帰はidle processだけであり、本番探索/学習・実ゲーム校正ではない。

容量依存のsource/policyと実保存量計測helperは受入scopeへ追加し、
旧receiptのhashを書換えず、新しい固定treeの実gateから再採取する。
再開条件とexact run/tree/receiptは各runのintegration-handoffに保存する。
