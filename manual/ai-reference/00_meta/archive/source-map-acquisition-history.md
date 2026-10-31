# 独自サイトの取得履歴

source-mapから分離した取得時点の記録。現在の状態を保証しない。入口は [source-map](../source-map.md)。

- 2026-03-19 JST の確認では、Netlify SPA の公開 bundle から Q&A / errata / カード本文を読んでいる。
  - hash 付き asset 名が変わるため、canonical URL は root site として扱う。
- 2026-03-23 JST の再確認では、JS bundle hash (`index-4lr0zIZt.js`, `card-data-vfsOkgyf.js`) に変更なし。サイト内容は 03-19 以降更新なし。
  - Q&A 38件、エラッタ 11件、カード 184枚。シリーズ: 東方(BSTH)、SAO(BSSA)、ゴッドイーター(BSGE)、軌跡(BSLH)、ドラゴンボールZ(BSDB)。
- 2026-08-07 JST、BSSA01-XX01 の「このカード/ネクサス」併記について、ユーザー確認を暫定正（信頼度 C）として採用。
  - ローカル本文は `external-qa/cardData.js` の `BSSA01-XX01`。フィールド外でも表向きの「このカード」のシンボルが神/紫/白/黄となり、手札から配置するときの軽減要求枠も紫/白/黄として扱う。詳細は [`07_custom-orica-mechanics.md`](../../10_rules/07_custom-orica-mechanics.md)。
- 2026-08-10 JST の再取得では、JS bundle hash (`index-DO-4YCqz.js`, `App-BHaceHtK.js`, `card-data-CJe1wIiN.js`) に更新。
  - Q&A 39件、エラッタ 17件、カード 184枚。シリーズ: 東方(BSTH)、SAO(BSSA)、ゴッドイーター(BSGE)、軌跡(BSLH)、ドラゴンボールZ(BSDB)、カービィ(BSKB)、転スラ(BSTS)。
  - `qa-039`: BSGE01-C13 等の `神喰` 保護カウントは、効果ではない支払いコストであるクォーツコストに使用可。旧ローカルミラーで `qa-039` と重複していた BSTH07.8-XX01 同時ブロック裁定は、最新 bundle 上の `qa-022` を正として参照する。
