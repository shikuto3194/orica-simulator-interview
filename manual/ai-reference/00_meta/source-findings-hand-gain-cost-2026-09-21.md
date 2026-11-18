# 手札増加対価の調査（2026-09-21）

## 入力と結論の根拠

- 提供snapshot `orica-snapshot-2026-09-20T22-01-40-910Z.json`: AliceにBSTH04-C01、BobにBSRK01-C02。手札増加対価CEは登録済みだった。
- 提供snapshot `orica-snapshot-2026-09-20T22-15-20-815Z.json`: 同じ制限下でBSTH04-C12のメイン使用履歴。2枚ドローに支払い選択がなかった。
- 独自カード本文: `external-qa/cardData.js` / `packages/card-data/src/cards/BSRK01.ts`。公開元は[独自カードDB](https://dancing-pixie-db5cc3.netlify.app/)。独自Q&A/errataには今回の組合せの直接回答を検索で確認できなかった。
- 一般則（A）: [03c:24](../10_rules/03c_effect-text-interpretation.md)「『できない』＞『しなければならない』＞『する・できる』」。公式エターナル[BS18 Q&A](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=BS18)のミラー `external-qa-official/BS18.md:458` は、手札増加禁止で「手札に戻す」効果自体が発揮されなくなると説明する。
- 公式freeword取得も `harvest-official-faq.mjs --freeword 支払わなければ` で試行したがcurl接続に失敗。公式エターナル製品別ページの閲覧とローカルミラーを併用。別の対価（召喚など）の裁定をこの独自カードの直接根拠にはしない。
- 今回の実装根拠（C）: ユーザーが強制回収でも対価を拒否できること、チルノの2枠は1イベント、カード自身の回収は別イベント、効果ドローも対象と明示。一般則と矛盾しない独自カード裁定として採用。

確定内容と実装導線: [手札増加対価](../10_rules/03d2_hand-gain-cost.md)。

同日追補（C）: ユーザーは通常ドローステップの除外と、枚数+1修正が元イベントへの加算であることを確認。BSAZ01-C01のDSLが1枚ドローを2stepに分けていたため、非合体1枚/合体2枚の枚数を動的に決める1イベントへ修正。
