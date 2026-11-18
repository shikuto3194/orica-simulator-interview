# ルーム反映遅延の計測（2026-11-01、巻き戻し要否の判定）

[18_room-network.md](18_room-network.md)の続き。

調査PC（API同居）から本番Supabaseへ。書込・アカウント作成なし。1回ずつの計測で、利用者端末・相手側描画の遅延ではない。

- **巻き戻しは成立しない**: 現行DBのトリガー`require_atomic_room_state`は`commit_room_state`以外の`state`/`state_version`更新を拒否する（`20261026181917_room_network_atomic_readiness.sql:316-328`）。`20261029070703`は`rooms`・`replay_events`から`anon`/`authenticated`の権限を外し、`room_mutation_cancellations`と`replay_events`への`service_role`の書込権限を外す（`:5-7`。`rooms`の`service_role`権限は残る）。10/25構成のサーバは`updateRoomCAS`で`rooms`を直接`UPDATE`するためトリガーで弾かれ、`replay_events`への直接書込も止まる。DBのmigrationまで戻さない限り書けない（本番へのmigration適用状況は未確認）。
- **DB関数のコストは主因でない**（ローカルPGlite）: `room_network_readiness_v2()`は1.3ms、状態600KBのコミットは厳密版RPC 6.4ms・素のUPDATE 5.1ms。本番で`readiness_v2`をSELECTと交互に40回測った差は約60ms（p50）。
- **支配的なのは往復時間**: 認証なしREST（DBに触れないゲートウェイ応答）で中央値約1.0秒、1行SELECTと全列SELECTも約0.95秒で差が無い。区間は接続約30ms、TLS確立約0.75秒、応答約0.7秒。10/27の同種計測（163ms）より大幅に遅く、時期による外部要因（Supabase側・経路）が疑わしいが、原因の特定には至っていない（確度C）。
- **接続の再確立が毎アクションに乗る**: Nodeのfetchは約4秒アイドルで接続を閉じる。アイドル6秒以上で1.7〜2.0秒、再利用で約0.8秒（待機間隔を変えた実測）。対戦の操作間隔は通常4秒を超えるため、API→DBの先頭要求が毎回TLSを払う。
- **6秒期限**: 実運用ログ（失敗のみ記録）に`ROOM_COMMIT_UNAVAILABLE`が10/31に83件、`db_commit_rpc`が期限の6.0秒で打ち切られている。成功時の所要は記録されない（Server-Timingの常時記録は未実装）。
- **対策（実施）**: 接続のウォームアップ（`server/upstream-warmth.ts`）。プレイヤー接続中のみ約3秒ごとにHEADを送り、1本の接続を温存する。操作間隔6秒の再現計測で、中央値は1.8〜1.9秒（なし）→0.87〜1.26秒（あり）を2回確認。
- **未実施・次の候補**: 操作ごとの`db_room`読取を省く（サーバ内キャッシュ＋コミットRPCのCAS）、成功時のServer-Timing記録、利用者端末からの送信ACK・相手描画のp50/p95、Supabaseの地域・経路の調査。
