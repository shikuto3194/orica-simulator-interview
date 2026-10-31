# 2026-09-26 系統共有のコア配分

BSTH11-R03の系統別6選択を1つの配置選択にまとめた。配置先・系統とも1個までとし、
スピリット/アルティメット/創界神ネクサスを同じHUDで扱う。後段の支払い付きドローは独立した任意選択。
裁定は [06a](../10_rules/06a_core-placement-groups.md)（ユーザー確認C）。

汎用 `core_distribute` に配置先上限とフィルタ別共有枠を追加。既存最大流の共通処理を使い、
重なる系統の再割り当て、最大数、仮配置、REST確定、AI入力で合法性を共有する。
BSLH01-X04にも配置先上限と1回のHUDを適用し、既存pendingの配置先上限も黄色枠に反映する。

配分HUDの「トラッシュ→フィールド」固定文言を廃止し、移動元・移動先・表示側から生成。
ボイド/トラッシュ/リザーブ/ライフ/ゲーム外/複数ソースを区別し、ソウル込みの個数・残数を表示する。

回帰: `core-distribution-groups.test.ts`、既存BSTH11・創界神対象・コア配分テスト。
GUI/REST: `scenario-core-distribution-groups.spec.ts`（Alice操作、Bob入力、X04）。
Active Boardとissueの追加はなし。
