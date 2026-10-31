# 実装から監視への遷移

2026-10-06本人承認: AI強化は資源が許す限り24時間継続する。LLMによる成果確認・修正は
当初120分ごと。[自律学習](continuous-learning.md)と[一人バトルの復帰](solo-fallback.md)が運用の前提。

## 実装期

現在の15分起動試行を使用し、実行中はIgnoreNew+共有lockで重複禁止。
1 runのworkerは既存6時間上限内で節目を完了。長いgateを15分で打ち切らない。
ゲームAIの背景計算予算はresources.md。Codex利用上限breakerと検証leaseも維持する。
通常の課題解消と必要な監査を進め、監査0でdisableする旧経路を使わない。

## 監視移行のtransaction

1. controllerがI0-I6の証跡有効性・release gate・修復残件・I7のLLMなし72時間観測を確認。
2. 親runnerがverified commitのmain/remote到達・配備hash・fresh healthを確認。
3. 学習runnerの独立したOS管理・起動復帰・負荷制御を確認後、今のLLM worker終了を待つ。
   親側で同じsupervisor taskを120分へ更新。LLM用の別cron/heartbeatを作らない。
4. task enabled状態・action固定先・Interval=PT2H・IgnoreNewを読戻し、transition receiptを保存。
5. 失敗時はmonitorへ変更せず再試行可能なpendingを保持。状態ファイルだけを成功へ書き換えない。
6. configure-codex-autostart等の再登録もphaseの正源から120分を復元。手動disableを勝手に解除しない。

切替とworker実行の排他は既存supervisor lockを使う。workerからtask/lockを直接操作しない。
ロックheartbeat・軽量watchdog・Telegram受信/relayの周期は120分へ変えない。
学習runnerはsupervisorの終了/LLM利用制限で止めない。本人の学習停止は別の永続状態として維持する。
モデルの通常更新にLLMの起動・承認を要求しない。

## 120分tick

最初に安価な機械check（上限30秒、各probe5秒×最大2回）:

- release/engine/card/model/protocol hash、health、要求数とerror/timeout、queue age。
- CPU/RAM/GPU・空き容量・日次予算、直近対戦のstuck/illegal/stale、未解決repair queue。
- 生成数・有効sample・実更新数・候補/本番版・評価進捗・勝率/CI・終局率・速度・待機理由。
- 単独局面の軽量probe。隔日など曖昧な条件でなく、1日1回は席交換2戦を10分内で分割確認する。

当初は正常でも120分ごとにLLMへ差分報告を渡し、成果と停滞を確認する。
自律運用証跡と機械的な停滞検出が揃った後は、親controllerが正常tickのLLM起動を省略できる。
機械checkとreceipt保存は続け、同文通知・全件gateを毎回行わない。
意味ある変化、復旧、失敗、本人対応が必要な場合に既存通知経路を使う。
同一障害はfingerprintで集約し、未解決キューを次tickへ持ち越す。再報告を解決扱いにしない。

## 修復

異常はreplay/seed/要求hash/版/生ログを保護し、再現→回帰→修正→gate/verifier→統合→
配備→同条件の復旧確認を行う。情報漏洩・違法手・反復crashは故障版を隔離し、
現行→旧正常モデル→独立した簡易AIへ復帰する。共通engine/状態まで壊れている場合は安全に適用を止める。
機械的な降格・deadline保護は2時間待たず実行する。他作業・対戦APIは停止しない。
service再起動は同一障害につき1 tick最大1回、失敗なら簡易AIを維持して次tickへ引き継ぐ。
修復中も既存120分起動試行とIgnoreNewを維持。勝手に15分へ戻さない。
修復時間はworker6時間上限、追加評価は共有資源予算内。3回同原因失敗は根拠と必要入力を通知する。
性能/勝率劣化は現champion維持で診断。生成・学習・評価は24時間目標で資源余力に応じて継続し、
評価gate合格時だけ機械的に昇格する。旧3時間/日・改善学習20分/日は定常運用へ持ち込まない。
VM有料化、API移行、新用途、新カード群の大規模拡張はこの保守範囲に含めない。

## 継続運用の証明

設定コードのunit成功と、OSに実登録された周期の確認を分ける。
live停止を伴うOS再起動は検証目的で勝手に行わず、再登録回帰と次の実再起動時の確認で追跡する。
再起動未観測は未観測と報告し、実機確認済みにしない。既存復帰設定を残して監視は開始できる。
`autonomy-soak`はLLMなしの実更新・評価進捗・日次境界・負荷再開・process中断復旧を必要とする。
単なる72時間経過、待機、モデルファイル生成だけで自律運用成功としない。実モデル昇格・強さは別に報告する。
