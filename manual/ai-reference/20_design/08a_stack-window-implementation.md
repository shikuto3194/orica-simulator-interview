# スタック窓の実装入口

[スタック窓と優先権ループ](08_stack-window-and-priority-loop.md)の実装ガイド。

## 新規キーワード能力実装時の選択ガイド (P3-113)

スタック窓オープン関数は計8個あるが、新規実装者が直接呼ぶのは以下2つでよい:

- `openEffectDeclarationStackWindow()`: 発揮宣言と同時に窓を開く（誘発効果 / battle_immediate / カードプレイ宣言）。
- `openDeferredDeclarationStackWindow()`: 一度 deferred してから開く（field 起動効果 / マジック / アクセル / チェンジ等 `useXInFlashContextAsAction` 系）。

残る6関数は上記2つの内部実装で、直接呼ぶことは想定しない
（バースト発動の2段階窓のみ固有副作用を内包するため専用関数を持つ）。

P3-111 型（`*Data: {}` 見出しラベルキーワード効果）追加時は兄弟効果の窓配線を個別確認する。
「`pending*` 非依存＝窓不要」は誤り。P3-112/P3-115/P3-116 で同型見落とし3件連続
（機械ガード: `check:ssot` の `not-a-declaration-needs-citation`/`freestanding-not-a-declaration`）。

## 実装ファイル

| ファイル | 責務 |
|---------|------|
| `model.ts` | `StackInteractionWindowState`, `StackWindow`, `BattleFlashWindowState`, `PreDeclarationStackWindow`, `Window` 型 |
| `stack-window-shared.ts` | 共通ヘルパー (create/transfer/peel/nullify) |
| `legal/stack-window-openers.ts` | 内部実装6関数(上記) |
| `legal-actions-apply.ts` | エントリポイント2つ(上記)、open/close/pass 適用、`resolveDeferredStackAction()` |
| `battle-actions.ts` | バトルフラッシュの open/pass/close |
| `battle-availability.ts` | フラッシュ窓中の合法手判定 |

