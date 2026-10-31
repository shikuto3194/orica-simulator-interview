# Advanced Mechanics（未対応ギミック設計リファレンス）

この章は、Phase 6 タスク B の未対応ギミックについて、ルール説明と実装設計を一体でまとめたものである。
各ギミックを読めば「何をするか」と「コードでどう表現するか」の両方が分かることを目標とする。

ソース信頼度は `00_meta/source-map.md` の A/B/C ラベルに準拠。

## 分割ファイル

| ファイル | 内容 |
|---------|------|
| `08a_advent-rebirth-contract.md` | §1 煌臨 / §2 転醒 / §3 契約（概要） |
| `08a2_contract.md` | §3 契約（詳細） |
| `08a2_name-reference-scope.md` | 名前参照の包含スコープ |
| `08b_accel-change-zero-counter.md` | §4 アクセル / §5 チェンジ / §6 ゼロカウンター |
| `08c_imagin-mirage-grandwalker.md` | §7 異魔神 / §8 ミラージュ |
| `08d_grandwalker-nexus.md` | §9 創界神ネクサス / 創界石 |
| `08e_manifest.md` | 顕現のカウント条件・支払い・召喚 |

## 実装状況マトリクス（2026-04-15 時点）

| ギミック | 収録枚数（567枚ベース） | 実装状態 | 実装フェーズ |
|---------|---------|---------|---------|
| 転醒 | 54枚(double_sided) + 2(rebirth) | **完了** | P2-07 Phase A+B（A面自動復帰・Lv検証・同時転醒不可・バトル中BP再計算） |
| 契約 | 14枚(contract) + 95(soul_state) | **完了** | P2-07 Phase A+B（ゲーム開始手順・魂状態置換・バースト不発動・契約煌臨・F契約煌臨） |
| 煌臨 | 20枚(advent) | **完了** | P2-07 Phase C（`executeAdvent` / 煌臨元スタック / 状態引き継ぎ） |
| アクセル | 4枚(accel) | **完了** | P2-07 Phase D（`useAccelCardAsAction` / 手元移動 / スタック窓統合） |
| チェンジ | 少数 | **完了** | P2-07 Phase D（`useChangeCardAsAction` / 入れ替え / バトル中切替） |
| ミラージュ | 少数 | **完了** | P2-07 Phase E-2（`useSetMirageAsAction` / セット状態管理 / CE ゾーン対応） |
| 創界神/導界者 | 少数 | **完了** | P2-07 Phase F-1+F-2+F-3（神託/神技/界放/神域/転神/導界者/導シンボル） |
| ゼロカウンター | 14枚 | 未実装 | - |
| 異魔神 | 少数 | 未実装 | - |
| クォーツ / 待機状態 / 星霊衣 / 起導 | - | 未実装 | - |

> 「スタック効果」は上記マトリクスから削除（needs-ruling.jsonl 2026-07-07 解決、resolution A）。
> qa-005「フラッシュ効果に次ぐ新しい発揮タイミング」を指す一般ルール用語であり、クォーツ等の
> 専用ギミックとは独立。一般スタックタイミング自体は `02_turn-flow-and-timing.md` §スタック窓の
> とおり実装済み（`stack-resolution-core.ts`/`stack-window-openers.ts`/`stack/stack-negate.ts`）。

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
