# フィールド表示のシナリオ

[シチュエーションテストの入口・使い方](10_scenario-test-reference.md)。

## P3-47 裏向きフィールド / 分身 (act_as_spirit)

| パラメータ | シナリオ名 | 内容 |
|-----------|-----------|------|
| `face-down-field` | P3-47 F-1 裏向きフィールド | alice/bob 各 裏向きスピリット 2 (コア 1) + 通常 1。`?viewer=alice/bob` で対戦相手側を mask、card-back 表示確認 |
| `p3-47-act-as-spirit-token` | P3-47 F-2 act_as_spirit token | フランドール本体 (3 コア=Lv2 BP13000) + 裏向き token 3 体 (各 1 コア) に act_as_spirit CE 注入。host 追従で token も Lv2/BP13000/「合体不可」 |
| `p3-47-bunshin-opponent-view` | P3-47 F-2 分身 (相手視点) | フランドール本体 + 分身 token 3 体。`?viewer=bob` で相手視点 mask。長押しで正体を伏せたまま Lv/BP/コア数を開示 |
| `p3-47-redirect-prompt` | P3-47 効果対象リダイレクト prompt | 本体 + token 2 体に bob 効果対象を本体に取った状態。`pendingTargetRedirects` に prompt 1 件。overlay 表示・confirm/decline |
| `p3-47-redirect-choose-token` | P3-76 効果対象リダイレクト 分身選択 (field-tap) | 本体 + token 2 体 (1 recovered / 1 heavily_exhausted)。`pendingTargetRedirects` 注入済。field-tap で候補が `.ac-selectable`、疲労状態が回転で判別。タップ=変更 / 中央「変更しない」=decline (P3-76 中央プロンプト統合) |
| `p3-47-frandolle-activatable` | P3-47 Phase 3 フランドール【フォーオブアカインド】起動可能 | フランドール (3 コア=Lv2) のみ + デッキ 5/リザーブ 3/創界神・導界者ネクサスなし、bob に効果対象 1 体。Lv2 フラッシュ→裏向き 3 配置→コア分配→act_as_spirit + redirect_effect_target CE 登録の e2e |
| `p3-47-frandolle-multi-source` | P3-47 F-5 フランドール multi-source 配分 | フランドール (Lv2) + 補助 (4 コア)。デッキ 5/リザーブ 4/トラッシュ 2/ライフ 5。Lv2 フラッシュで `any_movable_self` 複数ソース配分。`?soul=trash\|life` でソウルコア所在切替 (既定 reserve) |

## P3-56 フィールドオーバーフロー (横スクロール)

分割: [10b_scenario-test-reference-overflow.md](10b_scenario-test-reference-overflow.md)（`field-overflow-*`、`field-card-state`）。

[カード回帰](10c_scenario-test-reference-card-regressions.md) / [日本語表示](14_japanese-display.md)

