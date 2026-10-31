# ローカルAIツールとチャット操作

## ツール一覧

| 名前                          | 種別     | 用途                                                                 |
| ----------------------------- | -------- | -------------------------------------------------------------------- |
| `lookup_card`                 | read     | カード番号 → CardDefinition                                          |
| `filter_cards`                | read     | パック / 系統 / 色 / 種別で絞り込み (max 20)                         |
| `read_doc`                    | read     | manual/ai-reference 配下を読む (8000 字 trim)                        |
| `inspect_game_state`          | read     | GameSnapshot 要約                                                    |
| `legal_actions`               | read     | rules-core から合法アクション抽出                                    |
| `read_file`                   | read     | リポジトリ内ファイル読み取り (allowlist 外は拒否)                    |
| `git_status` / `git_diff`     | read     | 作業ツリーの状態                                                     |
| `run_tests` / `run_typecheck` | read-ish | vitest / tsc を実行                                                  |
| `web_fetch`                   | read     | https URL を GET (SSRF + デフォルト 3 ドメイン allowlist + 容量上限) |
| `web_search`                  | read     | DuckDuckGo HTML 経由の検索                                           |
| `write_file` / `apply_edit`   | write    | ファイル新規 / 差し替え (allowlist 内のみ)                           |
| `run_command`                 | write    | allowlist された pnpm スクリプトを実行                               |

### Tool 自動起動 (skill 一覧)

GUI チャットの自然言語入力に対し、`skills/<name>.md` の `triggers` がマッチすれば自動で system prompt に注入される。

| Skill          | 主なトリガ語                               | 起動する tool                                                                     |
| -------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `rule-qa`      | ルール, 裁定, スタック, 煌臨, 転醒, 契約   | `read_doc`, `lookup_card`, `filter_cards`                                         |
| `card-info`    | BSTH..., カード番号, 緑のスピリット        | `lookup_card`, `filter_cards`, `read_doc`                                         |
| `code-edit`    | 実装して, 修正して, リファクタ, テストを書 | `read_file`, `apply_edit`, `write_file`, `run_tests`, `run_typecheck`, `git_diff` |
| `git-inspect`  | 差分, 変更ファイル, 未コミット             | `git_status`, `git_diff`, `read_file`                                             |
| `test-fixing`  | テスト失敗, vitest, テストが落ち           | `run_tests`, `run_typecheck`, `read_file`, `git_diff`, `apply_edit`               |
| `web-research` | ウェブリサーチ, ネットで調べ, 公式FAQ, URL | `web_search`, `web_fetch`, `read_doc`, `lookup_card`                              |
| `game-state`   | 盤面, 手札, 合法手, 次に何ができる         | `inspect_game_state`, `legal_actions`, `lookup_card`, `read_doc`                  |

### GameSnapshot の渡し方

GUI チャットで `orica-snapshot-*.json` をファイル添付すると、サーバーが自動で:

1. JSON を解析し registry に `boundSnapshot` として注入
2. task 文への生 JSON 展開はスキップ (コンテキスト節約)
3. プロンプト末尾に「セッションに紐付け済み」メモを追加
4. SSE notice で UI にも「GameSnapshot 紐付け」を通知

以後 `inspect_game_state` / `legal_actions` は `snapshot` 引数なしで呼べる。複数 JSON を添付した場合は最初の snapshot 形式 (名前が `orica-snapshot-*.json` か `players` キーを含む) を採用。

### Slash command (GUI 入力)

GUI チャットで `/<command> <args>` と打つと `prompts/commands/<command>.md` が読み込まれ、`{{ARGS}}` が引数で展開される。CLI の `pnpm ai:run /<command>` と同じ挙動。

| Command     | 用途                        |
| ----------- | --------------------------- |
| `/review`   | 作業ツリーレビュー          |
| `/research` | 指定トピックを Web リサーチ |
| `/add-card` | カード追加ワークフロー      |
