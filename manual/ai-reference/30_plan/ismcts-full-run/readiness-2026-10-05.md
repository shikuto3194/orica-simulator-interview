# 開始前の実機・VM経路確認

2026-10-05 JST、read-onlyのCIM / nvidia-smi / Get-ScheduledTask / supervisor:statusと
認証済みOracle Consoleを直接確認。実測値の信頼度A。採用する上限値は設計判断Bで
[resources.md](resources.md)に固定し、I0で校正・負荷guardを検証する。

| 項目 | 観測 |
|---|---|
| CPU | Intel Core i7-14700KF、20 core / 28 logical、瞬間負荷1〜11% |
| RAM | 31.85 GiB、空き6.31 GiB。他作業があるため全容量をAIへ割り当てない |
| GPU | RTX 4070、VRAM 12282 MiB中1435 MiB使用、利用10%、46°C、13.60 W |
| disk | C: 空き約1.16 TB。別途artifact-storageの全tree制限を維持 |
| scheduler | 既存orica-full-run-supervisorはDisabled、15分+logon、実行worker/統合なし |
| worker/main | engine-drain / 専用fullrun-syncを維持。primaryの別branchを上書きしない |
| OCI CLI | CLI・ユーザーの.oci/configは未配置。認証済みWeb Consoleを使用 |
| SSH鍵 | 既存orica-ai-01の公開鍵を再利用。秘密鍵は未読・非保存 |

## Oracle確認結果

- ホーム大阪ap-osaka-1、AD-1、root compartmentのinstance/boot/block volume一覧は空。
- Ubuntu 24.04 Minimal aarch64、A1.Flex 2 OCPU/12 GB、default boot 46.6 GBの作成経路を確認。
  VCN/subnetは予定名を使用し、公開IPv4/IPv6なし、既存公開鍵を設定した作成前フォーム。
- 画面はAlways Free eligibleだが、boot volumeを月額309.62円と見積もり、無料層を反映しない可能性を注記。
- 作成送信は自動承認審査で拒否。理由は無料適用が確実でなく課金の可能性があること。
  新規VM/VCN/volumeは作成していない。現在の空き容量は未確認であり、今回もOut of capacityだったとは報告しない。
- 既存ユーザー承認のPC代替経路で開始する。有料化・別shape・別送信経路で再試行しない。
  VM/SSH/Tailscale疎通とArm配備は未実施として残す。VM待ちでI0〜I7を止めない。

[Oracle公式Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
を同日確認（信頼度A）。公開仕様は実アカウントの請求確認や容量確保の証拠には代用しない。

ここでの数値は開始前のsnapshot。恒常的な空き容量/性能の保証ではない。
本番稼働・負荷制御・評価成功は各タスクの新しいreceiptで証明する。
