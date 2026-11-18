# GUI Design Reference — バトル演出

[インタラクション索引](08b_gui-interaction-reference.md) / [効果キューの出典表示](15_effect-queue-text.md)

### 4.1 アタック / ブロック

- アタッカー／ブロッカーはペア色の外枠で示す（`.card-view.ac-attacker` / `.ac-blocker`。1ペア目=赤・2ペア目=青…で、ブロックされた相手と同色）。戦闘状態は ⚔ マーク（`.ac-duel-mark`）で出す。アタック中は赤いグロー（`.card-attacking`）。
- 光線エフェクト・ブロッカーが前に出る動き・BP 比較の並べ表示と勝敗エフェクト（旧 `BattleCenterDisplay`）は**未実装**。旧 CSS は P2-08 10-4 で削除済み（`battle.css` 冒頭付近のコメント）。
- 宣言未成立の参加カードは全員30度傾ける。同時アタックの追加参加体・合体カードも含む。`preDeclarationStackWindow` と `pendingPreDeclarationConfirmation` を参照し、スタック応答・対象選択・派生効果中も維持する。疲労・重疲労、場からの移動、宣言確定・取消で解除し、成立後の回復では再表示しない。

### 4.2 キャラクターカットイン

- 特定のキーカード使用時にアバターのカットイン演出。
- 未実装。優先度低。

### 4.3 バースト発動

- バーストカード公開時に専用演出。
- カードが裏返るアニメーション（CSS 3D flip、0.5s）。実装済み。

### 4.4 転醒フリップ（実装済み）

- `definitionId` 変化検知で CSS 3D flip 発火（perspective 400px + rotateY、0.6s）。
- B面表示中はシアングロー（`.card-rebirthed`）。転醒テキストバッジは廃止済みで、カード画像が B 面へ差し替わる。

### 4.5 煌臨オーバーレイ（実装済み）

- 煌臨中は下カードの重なりで示す。選択可能表示と混同する金色枠は付けない。着地・跳ね返り演出は行わず、初回表示や盤面更新でも再生しない。
- 盤面カードの宣言・転醒・ドロップ対象の強調では拡大縮小しない。
- 下カードの枚数・内容は長押し／右クリックから煌臨スタックを確認する。

### 4.6 契約視覚表示（実装済み）

- 魂状態: カード画像を少し淡く（`opacity 0.78`）+ 青紫グロー脈動（`.card-soul-state`）。「魂状態」バッジは出さない。
- 契約カード専用の枠・アイコン（紫ボーダー・右上「契」）は**未実装**。`battle.css` に見出しコメントだけが残り、`CardView.tsx` に契約カードの判定・描画は無い。

### 4.7 契約提示 / 契約確認（実装済み）

契約カードを初手に加えるかを選び、確定後にお互いの契約カードを見せる 2 段のオーバーレイ。契約カード欄は画像表示で、クリック/長押し/右クリックすると `CardDetailModal` を開く。裁定は [10_rules/08a2_contract.md](../10_rules/08a2_contract.md)、公開範囲は [10_rules/01b_information-visibility.md](../10_rules/01b_information-visibility.md)。

- **じゃんけんの前**に出す。提示はシャッフル前の手順なので提示画面は**手札配布前**（手札 0 枚・デッキは契約 1 枚を抜いた残り）、確認画面は手札 4 枚確定後。契約なしデッキは両段をスキップ。
- **既存の `bjk-overlay` 系を全面流用**。プレゲーム UI の本体は `BattleScreen.tsx` 内のオーバーレイ（`.battle-screen.bjk-active`）で、`contract_present` / `contract_confirm` をじゃんけん・マリガンと同じ `uiPhase` に載せる。`JankenScreen.tsx` は**どこからも import されていないデッドコード**なので触らない。
- 表示クラスは `.bjk-overlay-contract` / `.bjk-card-contract` / `.bjk-contract-list` / `.bjk-contract-card` / `.bjk-contract-card-button` / `.bjk-contract-thumb` / `.bjk-contract-owner` / `.bjk-contract-name`。room では提示前の候補 cardNo は本人だけに sanitize 表示し、確認以降は提示された契約だけ相手にも見せる。
- モックアップ: リポジトリ直下 `mockups/mobile-landscape.html` の「契約提示」「契約確認」タブ（試作で本体とは別。スクショ `debug-screenshots/contract-{present,confirm,cdm}.png` は gitignore のためローカルにしか無い）。

