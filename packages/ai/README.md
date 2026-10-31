# @orica/ai

orica-simulator のローカル LLM エージェント基盤。Ollama (OpenAI 互換 API) を起動済みであることが前提。

```
pnpm ai:smoke              # 接続確認 (Ollama) + vision モデルの capability 検査
pnpm ai:web-smoke          # web_fetch / web_search の実 HTTP 疎通確認 (DDG layout 変化検知)
pnpm ai:e2e:attachments    # 添付パイプライン E2E (classifier + 実 LLM 往復)
pnpm ai:e2e:skill-trigger  # skill auto-trigger E2E (static match + 実 LLM)
pnpm ai:lint               # skill / command frontmatter と registry tool 一覧の整合
pnpm ai:skill-report       # 過去の skill 起動率を `.claude/ai-telemetry.jsonl` から集計
pnpm ai:run <task>         # 一発実行 (CLAUDE.md + memory + skills を自動注入)
pnpm ai:run /<command>     # slash command (packages/ai/prompts/commands/*.md)
pnpm ai:chat               # 対話 REPL (ターミナル)
pnpm ai:gui                # ブラウザ GUI チャット (http://127.0.0.1:5180)
pnpm ai:parse-card -- --card BSTH05-X01    # カードテキスト → DSL 提案
pnpm ai:rule-qa "<質問>"   # ルール QA (read_doc ツール経由)
```

`ai:gui` は Node http サーバを立て、既定ブラウザを自動で開く。`--port <n>` / `--host <h>` / `--no-open` で挙動を変更可。サーバは `runAgent()` をそのまま叩くので、CLI と同じく CLAUDE.md / memory / skills / hooks が自動注入される。停止は Ctrl+C。

## Claude Code 寄せ機構

| Claude Code 概念     | この実装                                                                                                                                                                                                        | パス                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `CLAUDE.md` 自動注入 | `loadProjectContext()` が起動時に CLAUDE.md を system prompt 先頭に貼る                                                                                                                                         | `src/context/project.ts`  |
| Slash commands       | `prompts/commands/<name>.md` を frontmatter 付きで配置、`pnpm ai:run /<name>` で起動                                                                                                                            | `src/context/commands.ts` |
| Skills               | `skills/<name>.md` を frontmatter で配置、トリガ語マッチで自動有効化                                                                                                                                            | `src/context/skills.ts`   |
| Hooks                | `settings.json` の `hooks` 配列、`PreToolUse` / `PostToolUse` / `Stop` で shell command を発火                                                                                                                  | `src/context/hooks.ts`    |
| Memory               | `.claude/memory/<type>/<name>.md` を frontmatter で配置、関連時に system prompt に注入                                                                                                                          | `src/context/memory.ts`   |
| MCP / Tools          | OpenAI 互換 tool-call。デフォルトで 14 種 (lookup/filter/read_doc/inspect_state/legal_actions + read_file/write_file/apply_edit/run_command/run_tests/run_typecheck/git_status/git_diff + web_fetch/web_search) | `src/tools/`              |

## 環境変数

| 変数                            | デフォルト               | 用途                                                                   |
| ------------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `ORICA_AI_BASE_URL`             | `http://localhost:11434` | Ollama エンドポイント                                                  |
| `ORICA_AI_MODEL_FLAGSHIP`       | `qwen3:14b`              | エージェントのデフォルト。30B MoE に切り替える時は `qwen3:30b-a3b`     |
| `ORICA_AI_MODEL_FAST`           | `qwen3:14b`              | 低レイテンシ用                                                         |
| `ORICA_AI_MODEL_CODER`          | `qwen2.5-coder:14b`      | コード / DSL 生成                                                      |
| `ORICA_AI_MODEL_EMBED`          | `bge-m3`                 | 埋め込み (将来の RAG 用)                                               |
| `ORICA_AI_TIMEOUT_MS`           | `120000`                 | 1 リクエストの上限                                                     |
| `ORICA_AI_MAX_AGENT_STEPS`      | `12`                     | tool-call ループの上限                                                 |
| `ORICA_AI_DISABLE_HOOKS`        | `false`                  | `true` で hooks 発火を無効化                                           |
| `ORICA_AI_DISABLE_WEB`          | `false`                  | `true` で `web_fetch` / `web_search` を無効化                          |
| `ORICA_AI_WEB_HOST_ALLOWLIST`   | (下記 3 ドメイン)        | カンマ区切り。`*.example.com` 形式可。設定するとデフォルトを完全上書き |
| `ORICA_AI_WEB_HOST_BLOCKLIST`   | (空)                     | カンマ区切り。allowlist より優先                                       |
| `ORICA_AI_WEB_MAX_BYTES`        | `2097152` (2MB)          | `web_fetch` の 1 回あたり最大ダウンロードバイト                        |
| `ORICA_AI_WEB_TIMEOUT_MS`       | `30000`                  | `web_fetch` / `web_search` のリクエストタイムアウト                    |
| `ORICA_AI_WRITE_ADVISOR_OFF`    | `false`                  | `true` で write_file / apply_edit の Cross-cutting Rule guard を無効化 |
| `ORICA_AI_VISION_DISABLE_TOOLS` | `false`                  | `true` で vision モデルの tool calling を無効化 (manifest 非対応時)    |
| `ORICA_AI_TELEMETRY_OFF`        | `false`                  | `true` で `.claude/ai-telemetry.jsonl` への記録を停止                  |

### `web_fetch` のデフォルト allowlist

`ORICA_AI_WEB_HOST_ALLOWLIST` が未設定なら以下のホストだけ許可される。それ以外は throw。さらに `https` のみ受け付ける (平文 `http` はダウングレード防止で拒否)。

| ホスト                             | 用途                                        |
| ---------------------------------- | ------------------------------------------- |
| `batspi.com`                       | コミュニティ運営カードデータベース          |
| `www.battlespirits.com`            | 公式サイト                                  |
| `dancing-pixie-db5cc3.netlify.app` | 独自カードサイト (orica 同人版データ参照先) |

別ドメインを開けたい場合は env で上書きする (= デフォルトは捨てて全部書く):

```powershell
$env:ORICA_AI_WEB_HOST_ALLOWLIST = "batspi.com,www.battlespirits.com,dancing-pixie-db5cc3.netlify.app,*.wikipedia.org"
```

`web_search` は DuckDuckGo HTML 固定で叩くので allowlist の影響を受けない。検索結果に出てくる URL を `web_fetch` で取りに行く時に allowlist が効く。

## ツール一覧

詳細は [ローカルAIツールとチャット操作](../../manual/ai-reference/00_meta/local-ai-tools.md) を参照。

## カードテキスト → DSL ワークフロー (Task A 加速)

```powershell
pnpm ai:parse-card -- --card BSTH05-X01
```

- `packages/card-data/proposals/<cardNo>.json` に zod 検証済の `Effect[]` 候補を書き出す。失敗時は `<cardNo>.error.json`。
- ソースは直接編集しない。人間レビューを経て手動でカードファイルに反映。
- few-shot は `effects.length` 昇順で 6 件自動選択。

## テスト方針

- 単体テストは LLM を呼ばない (transport モック)。
- `pnpm verify` (= format / lint / check / docs:lint / test) は LLM 起動なしで緑のまま。
- 実 LLM 疎通は `pnpm ai:smoke` で手動実行。pre-push には含まれない。

## ローカル LLM ランタイムのセットアップ

`@orica/ai` の利用者向け詳細手順 (Ollama + LM Studio のインストール、推奨モデル、環境変数) は**プロジェクトには含まない**。
これは個人マシン固有の設定で、orica-simulator 固有のコードや裁定とは関係しないため。
セットアップが必要な場合は Ollama 公式 (<https://ollama.com>) と LM Studio 公式 (<https://lmstudio.ai>) を直接参照すること。
