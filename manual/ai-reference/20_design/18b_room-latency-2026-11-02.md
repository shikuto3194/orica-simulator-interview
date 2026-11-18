# ルーム反映遅延: 差し戻し不可の確認と B/C/D 対応、往復計測 F（2026-11-02）

[18b 11/01](18b_room-latency-2026-11-01.md)の続き。10/25構成への差し戻しは成立しない（DBトリガー・権限）ため、症状ごとに個別対処した。

- **B**: `POST /pregame-update` は版不一致でも 409 にせず、重複再送の確認だけ行い、最新roomへactor別mergeで適用して`currentVersion`のCASで確定する（`game-api.ts`）。両者が同時に送るじゃんけん/マリガンの 409 を解消する。
- **C**: 結果不明後の`mutation-settle`が`cancelled`を返したpregame-updateは、新しいmutation IDで最新版から自動再送する（`useRoomSync.ts`）。他の操作は非冪等のため従来どおりユーザー再操作。
- **D**: 操作POST（action/step/claim-victory/core-move/brave-separation/pregame-update）の`getRoom`を、20秒TTLの部屋行キャッシュで省く。commitの`expectedVersion`CASが正しさを担保し、古ければ409＋キャッシュ破棄。commit成功で新stateへ前進、他の書込系ルート・`updateRoom`(state/players)・replay修復で破棄。単一APIプロセス前提。
- **F（計測、確度B）**: 計測時刻により大きく違う。先の時間帯は、このPC（大阪、KDDI回線）からSupabaseだけでなくgoogle.com・example.com・cloudflare.comへも、TCP接続約25msに対しTLSハンドシェイクが300〜1100ms（Node生TLS、TLS1.3。ping 20ms、CPU 5%前後）。その後の再測定は、Surfshark Service稼働のままSupabaseへ6回22〜45ms、さらに8秒間隔16回が24〜39msで、遅延は再現しなかった。
  - よって遅さの主因はSupabaseの地域でも、Surfsharkの常駐でもない。**時間帯で変動するこのPC/回線側の一過性のTLS確立遅延**（原因は未特定。混雑時間帯の回線、同時の他通信の可能性）。
  - Surfshark停止のA/Bは、ベースラインが速く比較にならないため実施せず、サービスには触れていない。
  - 次の手: 遅い時間帯（夜の混雑時）に`tls2.mjs`相当を定期採取し、遅延の時間分布を取る。

```js
// node tls.mjs: host毎に tcp/tls のms を6回表示
```

テスト: B/Dは`room-pregame-concurrency-cache.test.ts`（実HTTP＋Supabase fixture）で検証。B（同じ版を見た後着の送信が200）とD（2回目の全列SELECT省略）は旧サーバコードで失敗することを確認済み。キャッシュ失効（DBが別経路で進んだ→409→読み直し）の1件は旧コードでも通るため回帰ガードに留まる。C追加1件を含む関連テストが通過。未検証: 実ルームでの体感、重複再送(duplicate)経路のサーバ統合、キャッシュのTTL失効。
