# Manual Index

この `manual/` は、バトルスピリッツシミュレーター開発のための調査・仕様・実装計画をまとめる場所です。

最上位の開発方針は、**再利用可能なルールエンジンを先に作ること**です。
手動操作UI、AI操作、対戦ゲーム画面は、その上に載せる成果物として扱います。

## まず読む順番

1. `ai-reference/README.md`
   - AI向けに再構成した参照導線。目的別索引から辿る。
2. `ai-reference/10_rules/`
   - ルール要点の正規化版。
   - 独自カードサイト由来の custom mechanic もここに整理する。
4. `ai-reference/20_design/`
  - 実装に落とすためのデータモデル・API・UI方針。
  - まず `00_project-structure.md` で repo 全体の責務を把握すると迷いにくい。
  - 長い設計は、基礎モデル / コア資源 / battle-effect に分割して置く。
5. `ai-reference/30_plan/`
   - フェーズ別ロードマップ、現役 ToDo、完了済み履歴。
6. `deep-research-report.md`
   - 元の調査レポート（歴史的成果物）。日常参照不要。詳細な引用が必要な場合のみ参照。

## 役割分担

- `deep-research-report.md`
  - 生の調査成果物。日常参照不要。`ai-reference/` に整理済みの内容が優先。
- `ai-reference/00_meta/`
  - ソースの信頼度、参照方針、未解決事項。
- `ai-reference/10_rules/`
  - シミュレーター実装のためのルール要約。
  - 公式にない独自ギミックの実装前提も含む。
- `ai-reference/20_design/`
  - エンジン設計、状態管理、API/UI方針。
- `ai-reference/30_plan/`
  - 着手順、細かい作業項目、完了済みマイルストーン履歴。

## 更新方針

- 2026-03-19 JST 時点では、`batspi.com` の一部ルールページが本文ではなく編集画面表示になる。
- そのため、本ディレクトリでは
  - 元レポート内の直リンクで確認できた内容
  - `batspi.com` の検索結果スニペットで補完できた内容
  を分けて扱う。
- 公式ルールマニュアルや `batspi.com` の本文が安定参照できる場合は `00_meta/source-map.md` を起点に差し替える。

## 作業後ルール

実装運用ルールの正源は `CLAUDE.md` の **Cross-cutting Rule**。本ファイルに重複転記しない。
