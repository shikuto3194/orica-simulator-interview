# Advanced Mechanics（特殊ギミック設計リファレンス）

この章は、Phase 6 タスク B の特殊ギミック（実装済み／部分実装／未実装が混在）について、ルール説明と実装設計を一体でまとめたものである。
各ギミックを読めば「何をするか」と「コードでどう表現するか」の両方が分かることを目標とする。

ソース信頼度は `00_meta/source-map.md` の A/B/C ラベルに準拠。

## 分割ファイル

| ファイル | 内容 |
|---------|------|
| `08a_advent-rebirth-contract.md` | §1 煌臨 / §2 転醒 / §3 契約（概要） |
| `08a2_contract.md` | §3 契約（詳細） |
| `08a2_name-reference-scope.md` | 名前参照の包含スコープ |
| `08a7_entry-timing-and-conditions.md` | 煌臨・顕現・契約合体・現界の条件保持、2026-11-15監査と未修正箇所 |
| `08b_accel-change-zero-counter.md` | §4 アクセル / §5 チェンジ / §6 ゼロカウンター |
| `08c_imagin-mirage-grandwalker.md` | §7 異魔神 / §8 ミラージュ |
| `08d_grandwalker-nexus.md` | §9 創界神ネクサス / 創界石 |
| `08e_manifest.md` | 顕現のカウント条件・支払い・召喚 |

## 実装状況マトリクス

収録枚数は `pnpm cards:fidelity` / card-data を正とする（ここには複製しない）。2026-11-18 に実装とテストを確認した。

| ギミック | 実装状態 | 根拠・詳細 |
|---------|---------|---------|
| 転醒 | **実装済み** | P2-07 Phase A+B（A面自動復帰・Lv検証・同時転醒不可・バトル中BP再計算）。同時発揮は [08a3](08a3_rebirth-trigger-causes.md) |
| 契約 | **基本経路は実装済み**（魂状態の資格は提示レベル。F契約煌臨の魂状態ネクサスでは候補と実行の判定に差がある。[08a2](08a2_contract.md)） | P2-07 Phase A+B（ゲーム開始手順・魂状態置換・バースト不発動・契約煌臨・F契約煌臨） |
| 煌臨 | **実装済み** | P2-07 Phase C（`executeAdvent` / 煌臨元スタック / 状態引き継ぎ） |
| アクセル | **実装済み** | P2-07 Phase D（`useAccelCardAsAction` / 手元移動 / スタック窓統合） |
| チェンジ | **実装済み** | P2-07 Phase D（`useChangeCardAsAction` / 入れ替え / バトル中切替） |
| ミラージュ | **実装済み** | P2-07 Phase E-2（`useSetMirageAsAction` / セット状態管理 / CE ゾーン対応） |
| 創界神/導界者 | **実装済み** | P2-07 Phase F-1+F-2+F-3（神託/神技/界放/神域/転神/導界者/導シンボル） |
| クォーツ | **実装済み** | `mechanics/quartz-system.ts`（[07 §4](07_custom-orica-mechanics.md) / [07g](07g_quartz-replacement.md)） |
| 待機状態 | **実装済み** | `pendingLeaveKind` / `flushPendingLeaves`（[07b_waiting-state](07b_waiting-state.md)） |
| 星霊衣 | **実装済み** | 汎用アンダーカード基盤＋役割タグ（[07b §6](07b_card-observed-mechanics.md)） |
| 異魔神 | **部分実装** | 左右2体合体は実装済み。片方のホスト離脱時の右リンク解除が未解決（[08c §7](08c_imagin-mirage-grandwalker.md)） |
| ゼロカウンター | **割り込み未実装** | `ZeroCounterData` と機構識別・観測・表示あり。専用 legal action と解決は未実装（デマンド駆動で拡張予定、[02 ToDo](../30_plan/02_detailed-todo.md)） |
| 起導 | **専用実装なし** | 一般ルールは未確定。確定済みなのは自己消滅時の扱いだけ（[06_core-system](06_core-system.md)） |

> 「スタック効果」は上記マトリクスから削除（needs-ruling.jsonl 2026-07-07 解決、resolution A）。
> qa-005「フラッシュ効果に次ぐ新しい発揮タイミング」を指す一般ルール用語であり、クォーツ等の
> 専用ギミックとは独立。一般スタックタイミング自体は `02_turn-flow-and-timing.md` §スタック窓の
> とおり実装済み（`legal/stack-resolution-core.ts` / `legal/stack-window-openers.ts` / `stack/stack-negate.ts`）。

### 実装済みゾーン/エリア

| ゾーン/エリア | 必要ギミック | 実装 |
|-------------|------------|------|
| カウントエリア | 転醒・契約 | `PlayerState.countValue` |
| 手元ゾーン（set_aside） | アクセル・チェンジ | `CardZone: "set_aside"` |
| バーストエリア | バースト | `GameState.setBurstStates` / `revealedBurstStates` |
| ミラージュエリア | ミラージュ | `GameState.mirageSetStates` |
| 魂状態 | 契約 | `PlayerState.soulStateInstanceIds` |
| 創界神コア | 創界神 | `CardInstance.normalCoreCount`（統一管理） |

## 主なソース

- [公式ルールマニュアル エターナル版](https://www.battlespirits.com/rule/official-rule-manual-eternal/) - 信頼度A
- [公式ルール改定](https://www.battlespirits.com/rule/revised.html) - 信頼度A
- [公式煌臨解説](https://www.battlespirits.com/rule/kohrin.php) - 信頼度A
- [公式転醒紹介](https://www.battlespirits.com/product/capture-deck/tensei.php) - 信頼度A
- [公式契約紹介](https://www.battlespirits.com/product/capture-deck/contract.php) - 信頼度A
- [公式ミラージュ紹介](https://www.battlespirits.com/product/capture-deck/mirage.php) - 信頼度A
- [batspi.com](https://batspi.com/) - 信頼度A/B（ページによる）
