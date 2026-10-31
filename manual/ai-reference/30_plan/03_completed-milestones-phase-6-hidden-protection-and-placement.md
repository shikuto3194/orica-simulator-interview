# 非公開耐性・反復配置・転醒合体（2026-09-27）

[履歴索引](03_completed-milestones.md)

## 変更

- BSTH09-X01はネクサス/ミラージュ/バーストをまとめて0〜3個選択し、選択したものだけに破壊/破棄を適用する。
- 耐性判定は遮断した効果と証明に必要なカードを返す。自身の効果や非公開属性を根拠にする耐性は公開履歴へ記録し、公開情報だけで防げる耐性は開示を追加しない。手札破棄/閲覧にも共通適用し、証明を効果の閲覧成功に数えない。
- 導託は同じ解決chain・発揮元・種類の保留中キューを再登録しない。反復配置の中断/再開で同じ配置が何度も観測される重複を防ぎ、別の発揮後chainは独立して扱う。
- 転醒内蔵の合体選択pendingにInfinityを保存すると、通常のJSON通信でnullとなり裏返しが失敗していた。上限なしを有限の最大安全整数で保存し、既存nullも上限なしとして読む。失敗した転醒には合体・カウント加算を行わない。
- 魂状態/クォーツのabsolute配置にもグリッド内の幅を予約し、疲労した合体カードとの重なりを防ぐ。

## 根拠・回帰

- [耐性公開の公式根拠とユーザー確認](../10_rules/01b_information-visibility.md#耐性の証明2026-09-27)。同一効果の導託の単位は既存の [同時イベント](../10_rules/03e_simultaneous-event-trigger-unit.md) に従う。
- `hidden-immunity-proof.test.ts`、`bsth09-cards.test.ts`、`oracle-continuation-dedup.test.ts`、`bsth09-tr01a-effect-activation-trigger.test.ts`で盤面と公開履歴・通信往復を検証。
- GUI/REST再現入口は[カード回帰シナリオ](../25_gui/10c_scenario-test-reference-card-regressions.md)。既存の魂状態配置もPlaywrightで確認。
