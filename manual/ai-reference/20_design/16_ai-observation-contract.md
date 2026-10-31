# AI 観測入力 contract

目的: 非通信対戦 AI / 将来のマッチング対戦 AI が、人間プレイヤーと同じ公開情報で判断できる観測入力を固定する。`LegalAction` / `PlayerDecision` は「選べる行動」の正源であり、盤面・手札・カード性能はこの観測 contract から渡す。

対象外: ルーム対戦 AI。相手に個別連絡して遊ぶ経路なので AI は介入しない。

## 層の分離

```text
GameState
  -> visibility projection
  -> derived board projection
  -> AiObservation

PlayerDecision surface
  -> LegalAction / TrainingSystemAction / action_input
  -> action mask
```

- `AiObservation`: 現在見えている状態。手札、場、公開済みカード、実効シンボル/BP/Lv など。
- `PlayerDecision`: 現在選べる選択肢。`LegalAction`、ステップ遷移、手動コア移動、追加入力など。
- policy/value は `AiObservation + decision choices` を受ける。`LegalAction` に盤面特徴を詰めない。

公開の進行は `global.turnClock`（席順・通番）、`stepProgression`（追加step/復帰列）、`turnSchedule`（追加ターン予約・禁止step/次席・次ターンskip）へコピーする。秘密ID・returnContext・窓payloadは含めず、旧観測の欠落や未対応の中断復帰/遅延開始は合成前に拒否する。旧stateの既定値と観測の拒否条件、検証範囲は [進行contract](../30_plan/ismcts-full-run/i1-turn-schedule.md)を参照。

## 使用回数制限の状態

`GameState.effectUsageRecords` が、`〔ゲームに1回:同名〕` を含む使用回数制限の engine SSOT である。状態遷移と MCTS の branch clone はこの台帳をそのまま保持し、同一プレイヤーが消費済みの効果を発揮する action は legal action として列挙しない（任意 pending を除去する `skipOnly` drain は残りうる）。

- policy/value が現在の行動を選ぶ際は `PlayerDecision` の legal choice / action mask が残回数の十分統計量になる。消費済み action を新たな AI 用台帳で重複管理しない。
- raw の `effectUsageRecords` 全件を `AiObservation` に複製しない。相手の将来の一回限り効果を個別に評価する feature が必要になった場合だけ、公開情報の範囲で「同名・効果ラベルごとの残使用可否」を圧縮して encoder に追加する。
- debug/replay の過去 snapshot を外部ファイルへ流しても、この canonical state はゲーム中の memory から外さない。

## 可視性モード

実装 API は `packages/rules-core/src/ai-observation.ts` の
`buildAiObservation({ state, viewpointPlayerId, mode, getCardDefinitionById })`。

| mode | 用途 | 非公開情報 |
|---|---|---|
| `player` | 通常の非通信対戦 AI / matching AI | 人間プレイヤーと同じ境界で伏せる |
| `spectator_full` | 棋譜ビューア / デバッグ観戦 | 両手札・裏向き・デッキ順を開示してよい |
| `debug_perfect` | 学習 harness のバグ切り分け | 完全情報。policy 学習データには混ぜない |

`player` mode は `sanitizeStateForViewer(state, playerId)` と同じ可視性境界を起点にする。
ただし GUI 表示用 pending mask と、AI の意思決定 node 生成は分離する。AI が解決者である pending は
`PlayerDecision` 側で node として列挙し、観測側には「どの pending が開いているか」を要約する。

## カード identity の扱い

AI はカード性能を知る必要がある。ただし、現在位置が非公開のカード identity を知ってよいわけではない。

| 領域 | `player` mode の identity |
|---|---|
| 自分の手札 | 実 `cardNo` / `definitionId` を出す |
| 自分の場・トラッシュ・除外・手元 | 公開状態に応じて実 identity を出す |
| 相手の場・トラッシュ・除外・表向き手元 | 実 identity を出す |
| 相手の手札 | 枚数のみ。公開追跡済み情報がある場合だけ public memory に出す |
| 自分のデッキ | デッキリスト由来の残り multiset は出してよい。現在順序は `knownDeckCards` の範囲だけ |
| 相手のデッキ | 枚数のみ。公開・推定アーキ情報は別 feature |
| バースト/裏向きフィールド | owner 本人または公開済みなら実 identity。相手視点は `UNK` |
| ライフ | 枚数/コア数のみ。裏向きカード identity は出さない |

実装では hidden identity を `_hidden_card_` の文字列として出し続けるより、
観測 token に `identityVisibility: "known" | "unknown" | "public_memory"` を持たせ、
unknown の embedding index は `UNK_CARD` に寄せる。

## Static Card DB

観測ごとにカードテキスト全文を複製しない。AI ランタイムは以下の静的テーブルを別に持つ。

```text
cardNo -> StaticCardFeatures
```

初期 feature:

- cost / colors / reduction symbols / printed symbols
- category / tribes / card names
- level cost / BP table
- timing tags: main / flash / attack / summon / when attacks / when destroyed など
- mechanic tags: burst / mirage / brave / advent / contract / divine skill / accel / change / quartz など
- structured effect tags: draw, search, core move, destroy, bounce, summon, negate, prevention など

観測 token は `cardNo` または `cardDefinitionIndex` を参照する。新カード追加時の汎化のため、
embedding だけでなく上記の明示特徴を併用する。

## AiObservation schema

JSON schema v2はtensor化前の中間表現。v1は相手の公開契約提示をnullへ落として未提示との区別を復元できないため、現search/encoder/学習artifact入口で拒否する。
encoderのtensor layoutとその版は変更しない。現在の観測を再生成して使う。

```ts
interface AiObservation {
  schemaVersion: 2;
  mode: "player" | "spectator_full" | "debug_perfect";
  viewpointPlayerId: string;
  global: AiGlobalFeatures;
  players: readonly AiPlayerFeatures[];
  cards: readonly AiCardToken[];
  publicMemory: AiPublicMemory;
  knownDeck: readonly AiKnownDeckEntry[];
  pending: AiPendingSummary;
}
```

### Global / player features

- turn number / active player / priority player / current step / window
- preGame phase and chooser
- active attack id, attacker, target, block assignment summary
- stack window / battle flash / pre-declaration window flags
- per player: life count, reserve/trash/void/life core counts, soul core counts, deck count, hand count
- per player: burst/mirage/quartz set counts, count value, used-per-turn mechanic counts
- `contractCardNo`はsanitize後の公開提示種別。確定前/未提示はnull、確定後は両者に保持する。
  私的な候補・デッキ採用・現在の手札実体から推測せず、live instanceへ再結合しない。
- pending kind one-hot and resolver player id

### Card token

`cards` は「可視カード」と「公開メモリとして必要なカード」だけを token 化する。

```ts
interface AiCardToken {
  tokenId: number;
  instanceId?: string;
  owner: "me" | "opp";
  controller: "me" | "opp";
  zone: string;
  identityVisibility: "known" | "unknown" | "public_memory";
  cardNoOrUnknown: string;
  faceDown: boolean;
  exhausted: boolean;
  exhaustState: string;
  normalCoreCount: number;
  soulCoreCount: number;
  effectiveLevel?: number;
  effectiveBp?: number;
  printedSymbols: readonly string[];
  effectiveSymbols: readonly string[];
  effectiveSymbolBundles: readonly { colors: readonly string[]; count: number }[];
  effectiveColors: readonly string[];
  effectiveCategory?: string;
  attachedToInstanceId?: string;
  attachedChildrenIds: readonly string[];
  underCardCount: number;
}
```

実効値は GUI 表示と同じ engine SSOT から取る。特にシンボルは flat 配列だけでなく
`SymbolBundle` を保持し、二色シンボルや「シンボル数」参照で壊れないようにする。

## デッキ・手札の観測

手札内容:

- 自分の手札は card token として全て出す。
- 相手の手札は `handCount` と、公開追跡済みカードがある場合の `publicMemory.knownHandCards` に分ける。
- `publicMemory` は `publicDisclosures` を正源に、現在も追跡可能なものだけを入れる。

デッキ:

- `knownDeckCards` は `AiKnownDeckEntry` にそのまま写し、`indexFromBottom` を保持する。
- シャッフルで既知情報が reset された後は観測にも残さない。
- 自分の残り deck multiset は deck list と既知公開移動から作る。raw `GameState` の deck 順は使わない。
- 相手の未公開 deck multiset は出さない。ISMCTS はアーキ信念分布から determinization する。

現 `buildAiObservation` には登録list・移動beliefを受け取る入力がないため、`player` modeの
`ownDeckCardNoCounts` は、本人へsanitize済みの既知slotが自分のdeck全位置を覆う場合だけ出す。
未知slotがある場合はこのoptional値を省略し、部分的な既知位置は `knownDeck` に保持する。
rawな現在deckの素性を数えて本人の知識へ補完しない。空deckは既知の空multisetとなる。
shuffle後に位置知識が失効した場合もrawから再生成しない。登録list・履歴から維持できる
multisetのbeliefは後続I1で接続する。この保守的な省略をbelief実装の完成とは扱わない。
`debug_perfect` / `spectator_full` は明示した完全情報baselineとしてraw集計を維持する。
optional値・encoderのknown flag/幅は既存schemaの範囲であり、未知を空deckへ変換しない。
`ai-observation-deck-knowledge.test.ts` は未知素性だけ異なるstateから観測・本番NN入力adapter・
同seed初期化NNの予測が一致すること、実peekのaudienceと実shuffleでの失効を検査する。
この反証は探索request/root候補/tree統計/responseを通すH1-H3の完成証拠ではない。

## Action との接続

policy は各 `PlayerDecision` choice を pointer 方式で score する。

- action source / target が card token に存在すれば `tokenId` で参照する。
- hidden card や deck のように token が存在しない対象は、zone/count/choice metadata で表す。
- 支払い元・対象・配分・順序などの `action_input` node は、同じ `AiObservation` を見て選ぶ。
- `advance_step` は、ほかの行動が残っていても選べる top-level choice として扱う。

`trace-smoke` は `frames.jsonl`（debug 向け）に加えて `replay-buffer.jsonl` を出す。replay sample は
`AiObservation + TrainingDecisionNode + policyTarget + valueTarget` で、raw `GameState` は含めない。
`truncated` node は policy weight 0、`capped` / `stuck` / `error` は value weight 0 とし、候補漏れや
未終局を強さ学習へ混ぜない。

`training-action-encoder.ts` は `EncodedAiObservation.cardInstanceIds` を使って source/target pointer を
解決する。新しい `LegalAction` kind は `ACTION_KINDS` と `check:ssot` で漏れ検知する。

## 実装順

1. `AiObservation` 型と `buildAiObservation()` を追加する。
2. `player` mode は `sanitizeStateForViewer` を起点にし、hidden identity leakage test を先に置く。
3. field card token に実効 Lv/BP/シンボル/シンボル bundle を入れる。
4. 自分の手札 token と相手手札 count / public memory を入れる。
5. `knownDeckCards` と自分 deck remaining multiset を入れる。
6. `PlayerDecision` node 生成に observation snapshot id を持たせ、trace と replay で対応付ける。
7. tensor encoder は `ai-observation-encoder.ts` で追加済み。domain 追加時は `check:ssot` と
   `ai-observation-encoder.test.ts` を更新する。

### Encoder v3と既存checkpoint

`token_pool` はトークン自身の支払い前効果を評価するときの公開領域。
encoder v3は対応するzone bitを追加する。v1/v2 checkpointへの入力では、この1列を
カード特徴から除去して元の幅・順序を維持する。v1への公開履歴比率の変換も継続する。
新しいcheckpointへ旧形式の観測を渡す逆変換は受け付けない。

## 漏れ検知

I1の探索元field分類は `ai-search-state-fields.ts` の
`AI_SEARCH_STATE_FIELD_POLICIES` を正源とする。全 `GameState` fieldを
`public / viewer-private / sampled / excluded` に明示分類し、必須・optional双方の追加/削除を
型と既存 `check:ssot` で検出する。未分類fieldの既定許可は設けない。

分類は値の配送許可ではない。`public` でも明示schemaと正準IDが必要。
`viewer-private` は観測者別のfilter・nested allowlist・参照変換が必要な混合fieldであり、
`pending/stack/usage` や `extraTurnState` のsnapshotをそのまま渡さない。
`sampled` の実カード実体は可視制約と公開priorから再構築し、秘密部分のclone/上書きに使わない。
`excluded` は元値を配送せず、仮想engineに必要な内部状態は公開履歴等から別途再構築する。

全top-level field分類に加え、[観測履歴](16a_ai-search-history.md)と[可視カード参照](16b_ai-search-cards.md)を分割実装する。
pending/stack/usage等の残るnested projector、raw `GameState` を受けない
`AiSearchRequest/SearchPublicState`、sampler、H1-H3の実engine反証は未達。
I0の旧予約は受付/保存/終了tailの欠測があり、安全回収せず全予約を保持する。
I0を最初の未完了項目に保ち、資源gate前のコード実装として本分類を追加する。
根拠は既存 [I0/I1タスク](../30_plan/ismcts-full-run/tasks.md)の校正未達時のコード実装条件。

最低限の guard:

- `player` mode で相手手札・未公開デッキ・未公開バーストの `cardNo` が JSON に出ない。
- 自分手札の全 card token が出る。
- `knownDeckCards` が audience と deck count 範囲で filter され、shuffle 後に消える。
- field token の `effectiveSymbolBundles` が GUI と同じ `getCombinedUnitSymbolBundles` /
  `getEffectiveSymbolBundles` 系 helper の結果と一致する。
- field token の Lv/BP が `getEffectiveLevel` / `getEffectiveBp` 系 helper の結果と一致する。
- `CardDefinition` に AI feature 化すべき静的 field が増えたら、
  `AI_STATIC_CARD_FEATURE_FIELD_ROLES` の分類漏れで `check:ssot` を落とす。
- `GameState` の `pending*` field を追加したら、
  `AI_OBSERVATION_PENDING_FIELD_ROLES` の `summary` / `engine_internal` 分類漏れで `check:ssot` を落とす。

この check は `check:ssot` に登録する。目的は「新しい行動」だけでなく、
「人間 GUI には見えている情報が AI 観測から漏れる」ことも検知すること。
