---
name: game-state
description: 盤面 / 合法アクションの確認 (inspect_game_state / legal_actions)
triggers:
  [
    盤面,
    フィールド,
    フィールドの状態,
    手札,
    手札の中身,
    ゲーム状態,
    ゲームの状態,
    snapshot,
    スナップショット,
    合法手,
    合法アクション,
    可能なアクション,
    打てる手,
    次の手,
    次に何ができ,
    何ができる,
    プレイヤーの状態,
    自分の盤面,
    相手の盤面,
    game state,
    legal actions,
    what can I do,
  ]
allowed-tools: [inspect_game_state, legal_actions, lookup_card, read_doc]
---

# 盤面 / 合法アクション確認

GameSnapshot に対するリードオンリーの問い合わせ。

## セッションへの snapshot 紐付け

ユーザーが `orica-snapshot-*.json` を GUI から **添付** すると、サーバーが自動で検出して registry に紐付ける。LLM 側は:

- `inspect_game_state` を呼ぶ際、`snapshot` 引数は**省略** してよい (`query` だけ渡す)。
- `legal_actions` も同様に `snapshot` 引数なしで呼べる。
- 紐付けが行われた場合、システム側から「セッションに GameSnapshot を紐付け済み」というメモがプロンプト末尾に入る。

snapshot 紐付けがない状態で呼ぶと「snapshot is required」エラーになる。その時はユーザーに `orica-snapshot-*.json` の添付を促す (memory: `reference_snapshot_location` 参照、保存場所は `C:\Users\kensh\Downloads\`)。

## 使うツール

- **`inspect_game_state`**: `query: { kind: "field_summary"|"hand_summary"|"raw", player?: "self"|"opponent"|"both" }`。
  - 盤面全体を要約したい → `field_summary`。
  - 手札を見たい → `hand_summary`。
  - 生 JSON が必要 → `raw` (デバッグ用、コンテキスト食う)。
- **`legal_actions`**: 引数不要 (紐付き時)。先頭 20 件が `sampled` に入る。
- **`lookup_card`**: 盤面のカード番号からカードテキストを引きたい時。
- **`read_doc`**: ルール (例: フラッシュタイミングの可否、煌臨条件) を確認したい時。

## 流れ

1. ユーザーが盤面について質問 → まず `inspect_game_state` で要約を取る。
2. 必要なら `lookup_card` で個別カードの効果を補足する。
3. 「次に何ができる?」の質問なら `legal_actions` で合法手のサンプルを取得し、上から重要なものを選んで紹介。
4. ルール解釈が絡む質問は `read_doc` で裏取り。

## 出力

```
盤面要約:
- 自分: <スピリット / コア / 手札枚数>
- 相手: <スピリット / コア / 手札枚数>

合法手 (代表): <or 該当なし>
- <action 種別>: <カード or 対象>

メモ: <ルール上の注意点 / 不確実性>
```
