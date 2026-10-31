# 公開情報盤面演出・公開情報ログ 計画

## 目的

公開情報を、プレイヤーごとに正しくサニタイズされた盤面演出とログで見せる。

- 盤面演出: 対象強調と処理ラベル付き矢印を表示する。汎用通知 HUD は出さず、右上の縮小効果キューと専用モーダルは維持する。
- 通知と盤面演出は行動者にかかわらず双方へ表示する。表示内容は各 viewer のサニタイズ済み情報に従い、本人限定の公開・匿名移動・公開時点の履歴をそのまま使う。自分の操作で新しく発生した演出を、その操作によって即座に閉じない。
- ログ: 右下の `・・・` メニューから開けるモーダルで、そのプレイヤーに公開済みの情報だけを時系列表示する。
- 実装: 既存の文字列 `GameState.log` を公開情報の正源にしない。構造化された公開情報イベントを engine から出し、GUI は盤面演出とログへ射影する。

## ルール根拠

対象選択と盤面演出寿命の前提になるルール:

- `10_rules/02_turn-flow-and-timing.md:190`: 「コスト支払い完了後に窓が開く。」
- `10_rules/03d_effect-target-and-prerequisite-gates.md:41`: 「タイミング＝発揮(解決)の直前・対象選択前」。
- `10_rules/01b_information-visibility.md:44`: `sanitizeStateForViewer()` が可視性の実装 SSOT。
- `10_rules/01b_information-visibility.md:50`: `GameState` の新規情報は、明示的に除去しないと相手へ見える。

このため、対象選択はスタック窓の後に起きる。通常の対象確定演出は応答権を新しく作らず、解決を止めない。止まるかどうかは演出ではなく engine の pending / legal action が決める。

## 仕様前提

今回の判断で固定する公開/非公開の境界:

- コストとして手札から破棄したカードは公開情報として扱う。効果文が「内容を見せずに」や「裏向きで」を指定する場合は、カード名/内容を伏せたまま、破棄した事実・枚数・移動先だけを公開する。「裏向き」と「裏面」は混同しない。
- 対象候補として提示されたが選ばれなかったカードは公開しない。相手ログにも盤面演出にも候補リストを残さない。
- 相手に非公開のまま移動するカードも、移動の事実・枚数・行き先は通知とログに残し、カード裏面画像で表示する。本人限定の公開カードを戻す場合も相手・観戦者には匿名で配送する。通常ドローは既存の枚数イベントから裏面を描画し、移動イベントを重複させない。
- 裏面画像の既存ラベルには「手札へ」「トラッシュへ」など実際の移動先を表示し、「ドロー」「破棄」だけで済ませない。ログ本文にも行き先を含める。デッキ上/下は保存された指定がある場合だけ区別し、カード名や未知の順番は補完しない。
- 現時点で耐性があり対象にできないカードは、対象解決時点で候補から除外されるため「対象にした」事実を emit しない。いったん対象にした後、割り込みで耐性を得た場合は、その流れ自体が公開情報として残る。

確定した設計判断:

- 既存 `state.log` はデバッグ専用に降格する。GUI は `displayState.publicDisclosures` を表示し、置換後は `sanitizeStateForViewer()` で `log` を送信/表示対象から落とす。
- `PublicDisclosure` は `blocking` / `lifetime` / `autoDismissMs` を持たない。盤面演出寿命は viewer の legal action とクライアント側 auto-dismiss タイマーから導出する。
- 対象強調/矢印は viewer の応答操作まで保持。自分・相手のオープン/公開・フィールド外移動はカード画像と行き先を表示し、応答権なしなら約3秒で退場する。
- 対象と結果はログ上 1 件の disclosure として扱う。通常は対象/結果を同じ record に載せ、engine が対象確定で停止する必要がある場合だけ同じ `id` の record を後続結果で補完する。before/after を別ログとして二重 emit しない。
- engine は対象選択から適用まで同期完了する。GUI は解決前 anchor/snapshot を取得し、場を離れた target を state と独立した overlay で演出する。
- `zone:"field"` の待機カードは実 anchor、flush 後に anchor が消えた target/source だけ ghost にする。判定軸は live anchor の有無。
- 用語の正源は `10_rules/01_glossary-and-card-types.md` と `EffectQueueEntry` の stage 名を突き合わせた `Record` 1 本に置く。
- **着手前に魂状態カードのライフ側端固定を先行実装し、target の anchor 座標を安定させる。**

## 対象イベント

### 実装済みの文言契約（2026-09-15）

- 場入りはDSL・解決スタック・維持コア選択pendingの種別を保持し、召喚／出す／現界／配置／煌臨／契約合体／顕現を区別する。カード種別だけで召喚と推測しない。旧ログの汎用フィールド移動は「フィールドに出す」と表示する。
- 合体・分離・交換・転醒・裏返し・魂状態の変化も記録する。対象の予定処理で結果を上書きせず、対象ログには実際の結果を併記する。
- オープンと手札公開・デッキ閲覧を区別し、公開範囲を保持する。デッキ位置不明を「下」と断定せず、非公開破棄・BP差分・コア差分・発揮抑止も処理に合った文言にする。

初期対応で扱う公開情報:

- デッキをオープンしたカード
- オープン/公開されたカードから手札に加えたカード
- オープン/公開されたカードの残りをデッキ上/下へ戻した順番
- 相手の手札やデッキなど、非公開ゾーンから公開されたカード
- 手札からコストとして破棄したカード、またはカード名を伏せた破棄事実
- 効果で実際に対象にしたカード/ゾーン/プレイヤー
- 公開ゾーンから手札/デッキ/除外/手元へ移動したカードと、その順番が公開情報になる移動
- アタック宣言、ブロック宣言、バトル解決
- バトル/効果による破壊、ライフ増減、ドロー枚数、カウント増減
- 公開カードのコア増減、回復/疲労/重疲労

対象外:

- 選ばれなかった対象候補
- サニタイズ前の `GameState.log`
- プレイヤーが知り得ない相手手札、デッキ順、裏向きカードの素性

## データモデル方針

`GameState` に `publicDisclosures` を追加し、既存の `log: string[]` とは別に扱う。

engine はカード名を文字列化しない。履歴 identity は公開時点の `definitionIdSnapshot`、live anchor は `instanceId` とし、非公開ゾーン移動時に後者を viewer state から切る。表示は GUI renderer が解決する。

想定形:

```ts
interface PublicDisclosure {
  id: string;
  sequence: number;
  turnNumber: number;
  step: Step;
  actorPlayerId: PlayerId;
  audience: "both" | "actor_only" | "opponent_only";
  source?: {
    instanceId?: string;
    definitionIdSnapshot?: string;
    registrationIndex?: number;
    effectIndex?: number;
    textRef?: TextRef;
  };
  kind:
    | "attack_declared"
    | "block_declared"
    | "battle_resolved"
    | "target_declared"
    | "deck_revealed"
    | "picked"
    | "zone_moved"
    | "core_moved"
    | "bp_modified"
    | "state_changed"
    | "destroyed"
    | "hidden_card_action";
  targets: readonly PublicDisclosureTarget[];
  results: readonly PublicDisclosureResult[];
}

interface PublicDisclosureTarget {
  kind: "card" | "zone" | "player" | "core_source";
  instanceId?: string;
  definitionIdSnapshot?: string;
  playerId?: PlayerId;
  zone?: Zone;
  actionLabel?: PublicDisclosureActionLabel;
  actionKind?: string;
}

interface PublicDisclosureResult {
  kind:
    | "card_move"
    | "core_move"
    | "bp_delta"
    | "destroyed"
    | "life_delta"
    | "count_delta"
    | "hand_delta"
    | "core_delta"
    | "exhaust_state"
    | "hidden_card_move";
  instanceId?: string;
  definitionIdSnapshot?: string;
  count?: number;
  amount?: number;
  from?: Zone;
  to?: Zone;
  order?: "top_to_bottom" | "bottom_to_top";
  hiddenReason?: "without_showing_contents" | "face_down";
  actionLabel: PublicDisclosureActionLabel;
  actionKind?: string;
}
```

実装時の注意:

- `PublicDisclosureActionLabel` は engine 文言ではなく enum/Record key として持つ。GUI renderer が「破壊する」「デッキの下に置く」「コアをリザーブに置く」などの表示語に変換する。
- 未知の DSL action は一律の「効果を適用する」に落とさない。`action_execute` と `actionKind` を組にし、GUI は既知 kind を日本語化、未知 kind も kind 名を含む簡易文へ構文化する。
- `audience` は公開済み情報の最小スコープを保持する。全員公開の情報でも viewer ごとに `自分`/`相手` ラベルを再計算する。
- `sequence` は engine で単調増加させ、通知キューとログの順序を一致させる。
- `PublicDisclosure` にカード名、表示文、通知寿命、blocking 判定を書かない。
- `definitionIdSnapshot` は公開時点の immutable な履歴情報であり、現在のカード位置を示さない。非公開ゾーンへの移動後は viewer 向け `instanceId` を除去し、後の再公開時にも過去 record と live instance を再結合しない。
- effect queue の `entries` / `summary` と同じく、派生文字列を持つ場合は invariant で構造化 entries からの導出を保証する。

## Engine 実装計画

1. `model.ts` に `PublicDisclosure` 系の型と `publicDisclosures` を追加する。
2. 追加 helper で `appendPublicDisclosure(state, disclosure)` を提供し、`sequence` 採番を一箇所に閉じ込める。
3. `state-sanitize.ts` で viewer ごとに `publicDisclosures` をフィルタする。置換後は `log` を落とし、既存漏洩を閉じる。
4. Deck reveal 系:
   - `executeDeckReveal`
   - `applyPendingDeckRevealAction`
   - pick/skip/order 確定時
   から、オープン、手札へ加える、デッキ下/上へ戻す順序を emit する。
5. 手札破棄コスト:
   - カード名を公開してよい破棄は `cards_moved_public`
   - 「内容を見せずに」/「裏向きで」は `hidden_card_action`
   を emit する。
6. 対象宣言:
   - `resolveTargets` 後、実際に選ばれた target のみ emit する。
   - 耐性で対象不能なカードは emit 対象にしない。
   - 対象後の割り込みで耐性を得た場合は、同じ disclosure record に対象宣言の事実と結果を残す。
   - `pendingTargetedDisclosureContinuation` は既存停止点候補だが、コメントだけを正源にせず、実装時に `resolveTargets` 直後で常に必要な emit が行えるか確認する。
7. `game-state-invariants-*` に、派生表示/summary がある場合は `publicDisclosures` から導出されることを確認する invariant を追加する。

## Phase 分割

0. Phase 0（先行必須）: `FieldArea` の印刷カテゴリ行を維持し、spirit は `魂状態 -> 合体 -> その他`、nexus は `魂状態 -> その他` の順でライフ側へ固定する。両陣営を GUI 検証する。
1. Phase 1: `PublicDisclosure` 型、emit helper、sanitize 拡張、invariant、ログモーダル。既存 `LogPanel` / `state.log` 表示を置換し、`state.log` をデバッグ専用へ降格する。
2. Phase 2: 公開情報ログ renderer。汎用の公開情報通知 HUD は採用せず、既存の専用モーダルは維持する。
3. Phase 3: アンカー/矢印レイヤ、`EffectQueueOverlay` corner 表示、盤面上カード向けのフィールド表現。

## GUI 実装計画

1. `PublicDisclosureRenderer` を公開情報ログへ追加する。
2. `BattleScreen` は `displayState.publicDisclosures` だけを読む。raw `state.log` は表示しない。
3. 右下 `・・・` メニューに `ログ` を追加し、既存 `zone-browse-overlay` / `zone-browse-panel` 系の見た目でモーダルを出す。
4. 盤面演出:
   - 汎用通知 HUD (`public-disclosure-notice`) は表示せず、既存モーダルと右上の縮小効果キューを維持する。
   - 公開カードの画像通知は自分・相手のオープン/公開とフィールド外移動（デッキ破棄、トラッシュ回収、デッキ/手元/除外移動等）。対象宣言内の結果も実際の行き先を表示。匿名の移動結果はカード裏面画像と行き先を表示する。
   - フィールド上カードが対象の場合は、対象カード highlight と source から target への細い発光曲線矢印で表現する。矢印には `破壊` / `BP-3000` / `コア-1` / `デッキ上` / `デッキ下` など、その target が受ける処理ラベルを置く。
   - 1 効果が複数 target に異なる処理を行う場合は、「矢印 1 本 = target と処理 1 組」として source から分岐させる。例: 「1体を破壊し、別の1体をデッキの下に戻す」は、`破壊` と `デッキ下` の2本で表示する。
   - 常設対象面は全ゾーンをアンカー登録する。フィールドでは通常カード、ネクサス、魂状態カード、カード上コアを個別 target にできる。
   - 魂状態カードは印刷カテゴリ行を保ち、`field-center-scroll` のライフ側 scroll 起点へ固定する。ソート順は Phase 0 に従う。
   - ゾーンを対象にする効果はゾーン全体を highlight し、その外周へ矢印を着地させる。公開済みの特定カードを対象にする場合はカードへ着地させる。手札の「内容を見ないで1枚破棄」のように identity が非公開の処理はカードを指さず、手札ゾーンへ `1枚破棄` と表示する。
   - 複数ゾーンから合計 N 個まで選ぶ効果は、実際の各 source へ矢印を分けて個数を表示し、合計上限と移動先は縮小効果キューで示す。
   - 一時 zone の `revealed` は既存 `DeckRevealModal` 内のカード表示、`in_use` は effect queue の source 表示を使う。盤面上に同じ zone の常設ダミーを新設しない。
   - 応答権が無い場合の標準演出は合計約 3 秒とし、公開カード演出・矢印・処理ラベル・対象強調を退場させる。engine の進行は待たせない。
   - 応答権がある場合は、矢印・処理ラベル・対象強調を viewer がパスを含む action を実行するまで保持する。
   - room 初期同期や同じ game/viewer の再接続で既に配信済みの `sequence` は通知演出として再生しない。ログには残す。
   - 1 効果内の複数 target は同時描画する。presentation queue は 1 件 3 秒を標準にし、一定件数を超えたら最新状態へ fast-forward する。
   - `prefers-reduced-motion` では伸長を省略し、矢印・処理ラベル・対象強調を静的に提示する。
   - `pendingLeaveKind !== null` かつ `zone === "field"` の target は実カードを使い、誘発・置換・継続処理中に ghost を重ねない。snapshot は常時取得し、ghost は live anchor 不在時だけ生成する。
5. 盤面演出 queue:
   - viewer ごとに最後に見た `sequence` を GUI state で保持する。
   - ログは常に全件スクロール表示する。
6. 矢印レイヤとログモーダルは `DisclosureProvider` / 専用 component に切り出す。`BattleScreen.tsx` へ状態と描画を直接積み増さない。
7. persistent/auto の表示寿命は `displayState` の pending / legal action と viewer action 実行履歴から導出する。`PublicDisclosure` 側には持たせない。

## モックアップ・検証

[モックアップと検証手順](13a_public-disclosure-log-validation.md)を参照。
