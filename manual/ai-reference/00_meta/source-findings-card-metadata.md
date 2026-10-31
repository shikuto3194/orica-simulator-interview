# 収録パックとカード番号の整合（2026-09-27）

保存デッキの動的候補に「BSTH07 東方地霊殿」が現れたため、Reactとsimulatorの648カード面をカード番号・収録パック一覧と照合した。効果本文と効果実装は変更していない。

- `BSTH06-転醒X01(B)`「霊烏路 空」の `pack` だけが `BSTH07 東方地霊殿` だった。A面、カード番号、収録一覧とユーザー訂正（地霊殿はBSTH06）に合わせて `BSTH06 東方地霊殿` へ修正。信頼度C（ユーザー確認と既存正規番号の照合）として適用。
- `BSTH002-M01`「戦車むすめのみるゆめ」はReactとrawの `cardNumber` が `BSAZ01-C12` だった。Reactの `images/BSTH002-M01.png` 右下の印字 `BSTH002 M01/00` と、simulatorの既存 `cardNo: BSTH002-M01` を確認。信頼度A（カード画像の印字を確認）として元データの番号を修正。カードID 29は維持。
- 修正箇所はReactの `src/cardData.js`、simulatorの `raw/cardData.js`、`raw/by-pack/BSTH002.js`、`raw/by-pack/BSTH06.js`、`src/cards/BSTH06.ts`。再取り込み用のrawも同期する。
- 霊烏路 空の画像 `images/BSTH06-転醒X01(B).png` には旧番号 `BSTH07 転醒X02(B)` が印字されている。今回の訂正対象はデータの収録パックであり、画像は変更していない。

回帰は両プロジェクトの `savedDeckFilters` / `saved-deck-filters` テストで全表裏のパック・番号一致と、霊烏路 空から誤ったパック候補が生まれないことを確認する。
