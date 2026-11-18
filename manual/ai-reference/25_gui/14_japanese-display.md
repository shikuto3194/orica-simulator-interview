# 日本語表示

対戦操作の表示文言は日本語に統一する。カード名・曲名などの固有名詞と、カードに印字される BP/Lv・レアリティ、ファイル形式やキー名称は原表記を保持する。

## ラベルの正源

- 効果種別: `packages/rules-core/src/effect/action-display.ts` の `EFFECT_ACTION_LABELS`。
  `Record<Action["kind"], string>` で全種別を網羅し、新しい Action の訳語漏れを型チェックで検出する。
- ゾーン・カード種別・能力: `packages/rules-core/src/display-names.ts`。
- 合法アクションのボタン: `apps/playground-web/src/components/action-ui.ts` の `ACTION_LABELS` / `getActionLabel()`。
- 色・シンボル: `apps/playground-web/src/utils/symbol-format.ts`。

明示ラベルがない効果選択肢は辞書から生成する。ドローの上/下など、既存のパラメーターによる区別を保持する。
詳細な確認文を生成できない効果も同じ辞書を使い、内部識別子を表示しない。
公開情報ログの汎用効果名もこの辞書を参照する。

旧スナップショットに保存された `unblockable` などは `localizeEffectLabel()` で表示時に日本語へ復元する。
保存内容・選択番号・アクションIDは変更しない。未知の識別子には日本語の汎用名を使う。
表示用の辞書はゲーム効果を実行するコードとは分離し、効果処理を変更しない。

## シナリオ検証

### 操作するプレイヤーの視点

DSL の `self/opponent` と明示ラベルは効果実行者基準。任意確認・選択肢を pending に載せる際、
`effect-step-prompt.ts` で実際の `choosingPlayerId` に合わせて自分/相手を変換する。
通常の interpreter とスタック後の choice の両経路が同じ処理を使う。`sourceText`、カード原文、
「」内のカード名・系統名は変えない。補助本文は指定された `sourceText`、解決中の効果の `textRef` の順で引用する。

2026-09-21監査: 全収録カードを裏面・付与効果・choice・神技まで再帰走査し、相手 chooser は3箇所。
BSGE01-C13のカウント支払いとBSKB01-C02の自分のデッキ破棄が該当。BSKB01-T01の強制対象選択は
候補の実プレイヤーIDで表示しており、逆転する任意確認文はない。固定文も監査し、バースト破棄枚数は
`targetPlayerId` で人称を決め、両者のフィールドを扱えるコア移動HUDは「コアを掴む」に統一した。

- `?scenario=step-prompt-perspective&manualOpponent=1`: BSGE01-C13。`kind=deck` でBSKB01-C02。
- `chooser=bob&viewer=bob`: Bob REST。Alice GUI/Bob REST双方で実行・辞退、選択者の資源だけの変化、原文保持を確認。
- `step-prompt-perspective.test.ts` は全カード監査、引用・固有名詞保持、choice変種、通常/スタック後の表示と盤面を検証。

### 効果名

`?scenario=japanese-effect-choice&manualOpponent=1` で BSTH01-C21 の「ブロックされない / アタック終了」を表示する。

- `legacy=1`: 保存済み英語ラベルを再現。
- `owner=bob&viewer=bob`: Bob 側の選択肢を表示し REST で解決。
- `e2e/scenario-japanese-effect-choice.spec.ts`: Alice GUI の新旧ラベル表示と終了選択、Bob REST の終了選択を確認。
- `packages/rules-core/test/japanese-effect-labels.test.ts`: 実カード、全収録カードの choice、辞書フォールバック、ドロー位置・明示ラベルの保持を検証。

通常のエラー表示には `userFacingError()` を使う。既知の通信エラーを日本語にし、未登録の英語診断文には日本語の代替文を出す。診断の詳細は既存のコンソールログを参照する。
