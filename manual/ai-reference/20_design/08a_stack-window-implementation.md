# スタック窓の実装入口

[スタック窓と優先権ループ](08_stack-window-and-priority-loop.md)の実装ガイド。

## 新規キーワード能力実装時の選択ガイド (P3-113)

スタック窓オープン関数は複数あるが（`legal/stack-window-openers.ts` の `open*` 群と下記2つ）、新規実装者が直接呼ぶのは以下2つでよい:

- `openEffectDeclarationStackWindow()`: 発揮宣言と同時に窓を開く（誘発効果 / battle_immediate / カードプレイ宣言）。
- `openDeferredDeclarationStackWindow()`: 一度 deferred してから開く（field 起動効果 / マジック / アクセル / チェンジ等 `useXInFlashContextAsAction` 系）。

バーストでは action handler が専用の `openBurstActivationStackWindow()` / `openBurstEffectDeclarationStackWindow()` を呼ぶ。汎用宣言からは上記2つを使う。

P3-111 型（`*Data: {}` 見出しラベルキーワード効果）追加時は兄弟効果の窓配線を個別確認する。
「`pending*` 非依存＝窓不要」は誤り。P3-112/P3-115/P3-116 で同型見落とし3件連続
（機械ガード: `check:ssot` の `not-a-declaration-needs-citation`/`freestanding-not-a-declaration`）。

## 実装ファイル

| ファイル | 責務 |
|---------|------|
| `model.ts` | `StackInteractionWindowState`, `StackWindow`, `BattleFlashWindowState`, `PreDeclarationStackWindow`, `Window` 型 |
| `stack/stack-window-shared.ts` | 共通ヘルパー (create/transfer/peel/nullify) |
| `legal/stack-window-openers.ts` | 内部の窓オープン関数群(上記) |
| `legal/legal-actions-apply.ts` | エントリポイント2つ(上記)、open/close/pass 適用（`pass_stack` / `pass_pre_declaration_stack` handler） |
| `legal/stack-resolution-core.ts` | `resolveDeferredStackAction()` / `resolveStackCascade()` |
| `battle/battle-actions.ts` | バトルフラッシュの open/pass/close |
| `battle/battle-availability.ts` | フラッシュ窓中の合法手判定 |

パスは `packages/rules-core/src/` からの相対。

