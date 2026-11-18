# 2026-10-26 秦 こころの軽減訂正

対象は Telegram 629905112 / `followup-b4475e9533fb5ed942bf`。
ユーザー原文は「秦 こころの軽減シンボルのデータは正しくは、赤 赤 赤 神 導」。
`images/BSTH08.5-X01.webp` のコスト7の横も、赤3個・神1個・導1個で一致する。
画像SHA-256: `f14b6fa860d9417cf4828e093d90b136c82ade9b31dad5106566004ea10b041f`。
信頼度A（配布カード画像の印字）、C（ユーザー明示訂正）として実装採用する。

監査ミラーの取得元は引き続き `shikuto3194/orika-react` の
`f51f8ba814654a725e7d36554ada87265293bde9:src/cardData.js`。
この固定版とローカル配布元 `400adda67a6f199ae9e8d39df4c51282c28b0359` の同ファイルには
赤2個・神1個・導1個が残っていた。ローカル配布元の後続訂正履歴も確認し、
`external-qa/qaData.js` / `errataData.js` に本件を覆す記述は見つからなかった。
remote HEAD は `332981b468b9d461823a142308eeca071aa92497` と観測したが、
その `src/cardData.js` のraw取得は404であり、最新配布元全体の確認済みとは扱わない。
既存版を別revisionへ付け替えず、本件1枚だけを画像と明示訂正に基づく補正として保持する。

補正前ミラーのLF正規化SHA-256は
`84e44c876d73aa715f8970e49b8b9bb2ac6b4920eb2c8852ae4dfee66cd665e1`。
共有 `external-qa/cardData.js` とlane内コピーの対象 `reduction` だけを赤3個へ変更し、
provenanceの `corrections` に旧値・訂正値・画像hash・元ミラーhashを記録した。
補正後の全体hashは同provenanceの `sha256`。hashだけの版承認ではない。
元bytesと変更記録はlaneの `.codex-temp/soul-state-attached-brave/` に保全する。

Git管理下の原本aggregate・by-packと変換済みTSも同じ値へ同期する。
再作成したミラーには、固定取得版の同カードのこの1項目へ同じ補正を適用する。
別カードの軽減・本文・従来の訂正履歴は変更しない。

公開対象UIのraw監査fixtureもこの3ファイルの旧全体hashを固定していたため、
埋込再生成コードで全648面を再確認した。3 sourceHashesと対応する2 rawModuleHashes以外の
全生成値（152本文行・14借用action・公開/秘匿runtimeEvidenceを含む）が完全一致した。
この確認を同fixtureのsourceCorrectionsへ追記し、旧訂正履歴は保持した。
単にhashを更新して監査済み扱いにしたものではない。
