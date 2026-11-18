# 2026-10-30 クリリンの印字軽減訂正

対象は Telegram 629905123 / message 8956 / `followup-7960147f490a9563dd3f`。
原文「クリリンの軽減データが赤となっているが、正しくは、赤·青 である。修正せよ」と、
`images/BSDB01-C05.webp` のコスト3に隣接する赤1個・青1個の印字を照合した。
画像SHA-256は `7b8afa25ec471ceb8bec09b888719f43901166898abb0ac6c8e97f073f13900c`。
信頼度A（配布カード画像の印字）・C（ユーザー明示訂正）で実装に使用する。
実定義の `sourceConfidence: "C"` / `sourceUrls: []` は維持する。

監査ミラーの取得版は従来の `shikuto3194/orika-react` の
`f51f8ba814654a725e7d36554ada87265293bde9:src/cardData.js` を維持する。
ローカル配布元の同固定版と `a4ed7e6a1f6861e99236982594d782c39d0df605` の同ファイルは
いずれもクリリンの軽減が赤のみだった。固定版以降の同ファイルでクリリンまたは
BSDB01-C05を変更する履歴はなく、共有 `external-qa/qaData.js` / `errataData.js` にも
本件を覆すカード番号・カード名の記述は見つからなかった。これはローカル取得範囲の確認であり、
未取得の配布元全体や最新remoteの確認済みとは扱わない。

`03a_cost-payment.md:7` の「軽減は、フィールド上の同色シンボル数で決まる。」を適用する。
原文aggregate・by-pack・実定義の軽減要求を赤青各1へ同期し、カード色・印字シンボル・効果は維持する。
共有ミラーも画像と明示訂正に基づき、この1カードの `reduction` のみを訂正する。
補正前のLF正規化hashは `9509857cddf6cf9909f877e0f2370776d1191de71e3efbb814e1a28ab58b00dc`、
補正後は `92bbd98dc0df5371d805916ca95b318cce2f4064dff1bec6d2f7a92a4d5ed332`。
全カード配列を前後比較し、本件1フィールド以外の同一性を確認した。
原本bytes・旧provenance・補正記録は `.codex-temp/krillin-source-evidence/` に保全する。
provenanceの既存訂正（[こころ](source-review-2026-10-26-kokoro.md)）を保持し、本件を追加した。
元hashが一致したlane内ミラーも同じ1項目だけ同期した。カード番号除外は追加しない。

回帰は `packages/rules-core/test/bsdb01-cards.test.ts` のC05節。
原文台帳2か所・実定義・出典情報と、実定義を要求側に使う `calculateReduction` で
青1個なら軽減1/支払い2、赤青各1個なら軽減2/支払い1を検査する。
裁定記録は `needs-ruling.jsonl` の `bsdb01-c05-printed-red-blue-reduction`。
公開mainへの採用と依頼の受入完了は、gate・独立査読・commit後に親統合で別途照合する。

公開対象のraw監査fixtureは埋込 `regenerationSource` を実行して再生成した。
全648面・152本文行・14借用action・分類・実M01の公開/秘匿runtimeEvidenceを含め、
全生成値が従来と一致し、変化は上記3ファイルのsourceHashesと対応する2 rawModuleHashesのみ。
この比較証跡を既存の `sourceCorrections` に追加し、過去の訂正記録を保持した。
