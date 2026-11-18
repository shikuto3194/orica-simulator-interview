# BSTH04-X02 原文再確認

## BSTH04-X02 の後続句の再照合（2026-10-02）

信頼度 **A**（配布元の訂正履歴・カード画像を実装に使用）。承認版ミラーの
「3以上: お互い手札/手元の黄以外のカードを使えない。」は、配布元の
[訂正 commit f493604](https://github.com/shikuto3194/orika-react/commit/f493604b99579a4a084609c2a6cf86e25226fbcf)
と [カード画像](https://dancing-pixie-db5cc3.netlify.app/images/BSTH04-X02.png) に一致する。
配布元checkout（承認revision `f51f8ba`）の `images/BSTH04-X02.png` を目視確認した。
画像のSHA-256は `79d09bbaa4faf5208728b623004f02d763f0ccf9587f7e37843ed8754d623796`。

シミュレーターの旧保存原文とDSLは「手札」だけで、2026-07-12の訂正を欠いていた。
承認ミラー・provenance・監査baselineは変更せず、保存原文と両プレイヤーの
`restrict_use.filter.zone` を手札/手元へ整合した。`bsth04-cards.test.ts` は
C連鎖3解決後の両ゾーン・両プレイヤーの非黄禁止/黄許可を検証する。
量化BP反復のN=0/1/2とC連鎖1/2の回帰も維持する。

## 敵対的 verifier の対象 scope 反証への対応

本文の「お互い手札/手元」は人称の直後に読点がなく、カード/ゾーン対象である。
[03d](../10_rules/03d_effect-target-and-prerequisite-gates.md) の「プレイヤー耐性はプレイヤー対象効果のみブロックし」に従い、両 `restrict_use` を `targetScope:"card"` へ修正する。
省略値の player gate で相手のプレイヤー耐性が禁止を消す問題を、修正前に両ゾーンの盤面回帰で再現した。
修正後は両プレイヤーの非黄禁止/黄許可、対象カード自身の耐性による阻止、バトル終了の共通 finalizer による禁止失効を確認する。
