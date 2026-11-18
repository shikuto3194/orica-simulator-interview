# 公開情報ログのモックアップ・検証

親仕様: [公開情報盤面演出・公開情報ログ](13_public-disclosure-log-plan.md)。

## モックアップ

以下は過去の設計資料。現行UIや受入結果は「実装の確認」を参照する。

レビュー用に `mockups/public-disclosure-log.html` を作成する。

- `mockups/battle.css` は作成時（2026-08-06）に `apps/playground-web/src/battle.css` をコピーしたもので、2026-08-06時点の表示を確認するための過去資料。
- 既存 GUI の class 名を使う。
  - `battle-screen`
  - `game-hud`
  - `field-area`
  - `card-view`
  - `effect-queue-card`
  - `dr-overlay` / `dr-modal`
  - `zone-browse-overlay` / `zone-browse-panel`
  - `more-menu-wrap` / `more-menu-panel` / `more-menu-item`
- モックアップだけの CSS は `.pd-*` prefix に閉じ込め、位置合わせ、公開情報 presentation、ログリストだけに限定する。
- 実カード画像がローカル公開 assets に無い場合は、既存 `card-placeholder` / `dr-card-placeholder` / `zone-browse-card-placeholder` を使う。

## 検証計画

計画/モックアップ段階:

- 作成時点では `mockups/battle.css` が本体 `apps/playground-web/src/battle.css` と一致することを確認した。現在は一致しない（上記）。
- HTML が既存 class を参照し、操作ボタンで対象宣言/デッキオープン/ログを切り替えられることを確認する。
- PC / スマホ横 / スマホ縦で実 viewport を切り替え、スマホ横では本体の `max-height: 500px` media query、スマホ縦では本体の向き警告が発動することを確認する。
- 通知 HUD が描画されず、応答権なしの公開カード演出が約 3 秒・対象矢印が約 2 秒で退場し、応答権ありでは action 実行まで保持されることを確認する。
- README の目的別索引から計画書へ到達できることを確認する。

実装の確認（ `apps/playground-web/test/public-disclosure-*.test.ts`、`packages/rules-core/test/public-disclosure*.test.ts`、`e2e/scenario-public-disclosure*.spec.ts`、`e2e/scenario-soul-state-layout.spec.ts` が対応）:

- Phase 0 で、魂状態の spirit / nexus がそれぞれ印刷カテゴリ行を維持し、自分側はライフ側左端、相手側はライフ側右端へ固定されることを component test と Playwright で確認する。複数の魂状態カード、合体スピリットとの同居、横 overflow 後も順序が崩れないケースを含める。
- `state-sanitize.ts` の viewer 別 unit test を追加する。
- deck reveal / pick / order / cost discard / target declared の unit test を追加する。
- GUI は Playwright で汎用通知 HUD 非表示、対象矢印、右上の縮小効果キュー、ピック/サーチ/オープン系モーダル、`・・・` メニュー、ログモーダル、viewer 切替を確認する。
- 公開 API / 型変更の検査は[影響範囲](../00_meta/validation-scope.md)で選び、該当経路を GUI+REST の双方向で確認する。
