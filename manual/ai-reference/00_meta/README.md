# 00_meta — ソース調査 / 信頼度 / 未解決質問

このディレクトリはルール・裁定の **出典管理** と **未解決事項** に加え、AI運用・検証ゲート・公開前検査・配備・フルラン運用の文書を置く。
出典はファイル単体ではなく、`source-map.md` を起点に他ファイルへ辿る運用。

## ファイル

| ファイル | 用途 |
|---|---|
| [source-map.md](./source-map.md) | **正源インデックス**。ソース URL / 信頼度 / 参照優先順 (A>B>C) を集約。先に読む |
| [source-access.md](./source-access.md) | ソース取得時の URL 規則 |
| [task-execution-modes.md](./task-execution-modes.md) | 通常・連続・フルラン・Engine Lane の規定 |
| [source-findings-official.md](./source-findings-official.md) | 公式寄り調査メモ索引 (turn-cost / core-and-states / battle-brave-burst の 3 サブを案内) |
| [source-findings-official-turn-cost.md](./source-findings-official-turn-cost.md) | 公式: ターン進行 / コスト支払い |
| [source-findings-official-core-and-states.md](./source-findings-official-core-and-states.md) | 公式: コア資源 / カード状態モデル |
| [source-findings-official-battle-brave-burst.md](./source-findings-official-battle-brave-burst.md) | 公式: バトル / ブレイヴ / バースト |
| [source-findings-custom.md](./source-findings-custom.md) | 独自カードサイト由来の裁定メモ本体 |
| [open-questions.md](./open-questions.md) | ソース不足で断定不能な項目 (P0-P2 優先度) |
| [local-tooling.md](./local-tooling.md) | ローカルテストコマンドとデバッグ成果物の置き場 |
| [conditional-cost-scope-audit-2026-10-26.md](./conditional-cost-scope-audit-2026-10-26.md) | 「ことで」全221行の新規分類、任意範囲・対価継続の修復と受入の区別 |
| [ai-operation-rules.md](./ai-operation-rules.md) | AI 推論プロトコル（作話防止の4原則）と裁定の伝播先・実装ギャップ調査 |
| [documentation-maintenance.md](./documentation-maintenance.md) | 文書の正源の分担、重複を増やさない更新、`docs:lint` の検査範囲 |
| [harness-validation.md](./harness-validation.md) | 共通検証、成功証跡、負荷制御、hook運用 |
| [validation-scope.md](./validation-scope.md) | 内容から選ぶ限定検査（`--plan`、比較基点、根拠） |
| [gate-queue.md](./gate-queue.md) | 共有検証枠（lease）の順番待ち |
| [remote-main-integration.md](./remote-main-integration.md) | remote main の取得・独立候補rebase・再検証・公開SHA |
| [fidelity-detection.md](./fidelity-detection.md) | 原文監査の類似検出、確認記録、フルランへの引継ぎ |
| [followup-acceptance.md](./followup-acceptance.md) | 対応済み依頼の受入証跡の登録と一括解消 |
| [full-run-efficiency.md](./full-run-efficiency.md) | フルランの監査入力・確認記録の失効範囲・実績計測 |
| [supervisor-health.md](./supervisor-health.md) | フルラン統合の監視（`pnpm supervisor:status`） |
| [conditional-cost-r21-continuation.md](./conditional-cost-r21-continuation.md) | 「ことで」監査の追補: R21の効果解決後のバトル継続 |
| [publish-preflight.md](./publish-preflight.md) | 公開前の事前検査、20分基準、所要時間の計測 |
| [gate-classification-queue.md](./gate-classification-queue.md) | ゲート選択の未分類・reviewed-full・新規検証の分類必須、キューと分類エージェントの手順 |
| [gate-classification-server.md](./gate-classification-server.md) | server 15モジュールの公開ゲート絞り込み実測（P2-16） |
| [gate-classification-playground.md](./gate-classification-playground.md) | playground-web の src 261本・test 145本の公開ゲート絞り込み実測（P2-16） |
| [gate-classification-e2e.md](./gate-classification-e2e.md) | e2e の spec 220本の公開ゲート絞り込み実測（P2-16） |
| [e2e-run.md](./e2e-run.md) | e2e の実走（変更 spec のゲート `e2e-changed` と定期の全件実走）と既知失敗の台帳（P2-17） |
| [unit-test-entry.md](./unit-test-entry.md) | 修正途中の単体確認と最終検証の区別、引数・実行範囲 |
| [merge-push-cost-review-2026-10-13.md](./merge-push-cost-review-2026-10-13.md) | merge/pushの導入理由・実測・費用対効果・worker判断の境界 |
| [full-run-audit-2026-10-08.md](./full-run-audit-2026-10-08.md) | フルラン全体の効率・構成・環境監査、原因修正と反映証跡 |
| [engine-drain-rescue-review-2026-10-02.md](./engine-drain-rescue-review-2026-10-02.md) | 救出 stash 21件の個別判断・取込み済み根拠・復元先 |
| [engine-drain-integration-review-2026-10-03.md](./engine-drain-integration-review-2026-10-03.md) | 最新mainの選択契約変更後の監査69件の再確認 |
| [primary-main-recovery.md](./primary-main-recovery.md) | オートマージ停止の診断・detached main復旧・分岐の保全 |
| [public-build.md](./public-build.md) | 公開用 dist の機能・素材の境界と検証 |
| [oracle-ai-deployment.md](./oracle-ai-deployment.md) | 対戦AI専用のOracle VM構成・配備前ゲート |
| [oracle-deployment.md](./oracle-deployment.md) | 対戦APIのOracle移行手順（ユーザー指示で保留） |
| [local-pc-deployment.md](./local-pc-deployment.md) | 現行対戦APIの Windows PC + Tailscale 公開と自動再開 |
| [funnel-watchdog.md](./funnel-watchdog.md) | 公開DNS監視・Funnelの条件付き復旧・PC外のActions監視 |
| [room-retention.md](./room-retention.md) | ルームの保持期間・通信断の回収・再接続保護 |
| [input-validation.md](./input-validation.md) | フォーム名・デッキ取込の上限、DB制約と回帰確認 |
| [local-ai-tools.md](./local-ai-tools.md) | ローカルAI用の環境・ルール・カードAPI一覧 |
| [security-secrets.md](./security-secrets.md) | 認証情報の混入防止、送信前検査、RLS 検証 |

日付付きの調査・監査・事故記録（`*-YYYY-MM-DD.md`、個別の `source-findings-*`、`source-review-*`、`fidelity-audit-2026-09-13/`、`archive/`）は一覧に重複させず、`source-map.md` か各親文書から辿る。

## 読み方

1. **裁定が必要なとき**: `source-map.md` で該当トピックの正源と信頼度を確認 → 該当 `source-findings-*.md` で詳細
2. **独自拡張の確認**: `source-findings-custom.md` を起点に。独自ソースの優先順は `Q&A / 裁定 > カード本文 > errata > ユーザー確認` (CLAUDE.md Cross-cutting Rule)
3. **未確定項目に当たったとき**: `open-questions.md` で既知の議論を確認、無ければ追記してユーザー裁定を求める

## 書き込みルール

- 新規調査は同ターンで該当source-findings/裁定章へ根拠・取得方法・適用範囲を反映する。新しい参照先が生じたときはsource-mapへリンクする。既存記録の全文を重複転記しない。
- 独自カードサイトだけがソースのギミックは `source-findings-custom.md` に集約。
- 裁定論点は実装着手前に `open-questions.md` へ起票し、ユーザー裁定を待ってから消化する。

詳細運用は CLAUDE.md の **Cross-cutting Rule → リサーチ・ソース運用** を参照。
