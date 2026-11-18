# アルドノアドライブの召喚時と純化（2026-09-26）

BSAZ02-C16の手札限定・発揮元個体・発揮後の辞退は[対象選択監査](source-findings-selection-contract-2026-10-02.md)（2026-10-02、A/C）を参照。

## 根拠と適用範囲

- **A、順序に採用**: 公式エターナルQ26791（CB28-RV020、`external-qa-official/CB28.md:758-763`）は「『ただちに』と書かれたこの効果が必ず先に発揮されます」。Q15978/Q15980（`external-qa-official/CB26.md:763-776`）も召喚時より先にただちにバーストを解決し、その結果召喚元が離れれば召喚時を発揮できないとする。[公式CB28](https://www.battlespirits.com/faq/list.php?prodname=CB28&format=eternal) / [公式CB26](https://www.battlespirits.com/faq/list.php?prodname=CB26&format=eternal)。公開ページも確認したが、本文の逐語照合には保存済みミラーを用いた。
- **C、条件判定に採用**: 同日のユーザー指摘により、BSAZ02-C03の「下にアルドノアドライブがあるとき」は、同じ召喚に対するC10/X04のただちに下置きの後で判定する。公式の優先順だけから独自キーワードの条件獲得時期まで確定したとは扱わない。
- **A＋B、純化に採用**: 独自qa-056（`external-qa/qaData.js:554-568`）の分離例外は「合体スピリット/アルティメット/ネクサスなど」を対象にした場合のブレイヴ。下カードは重なりを解除して裏向きとなる。アルドノアドライブは合体しないという既存のカード本文・2026-06-09裁定Bと合わせ、印字種類のみで分離対象にしない。

## スナップショット照合

- `orica-snapshot-2026-09-26T12-06-34-117Z.json`: bobのC03 `card-75` はLv3相当のソウルコア1個、下にC10 `card-57`。召喚時候補は残っていない。保存データに処理ログはないため、召喚・下置きの実パイプラインで再現した。
- `orica-snapshot-2026-09-26T12-11-31-629Z.json`: C03は裏向きカード状態、C10は `attachedToInstanceId:null` だが表向きの `zoneRoleName:aldnoah-drive`。下カードを分離候補にした処理と一致。合体C12 `card-55` と下カードC10の扱いを区別する。

## 修正の正源

- `trigger-system.ts`: 即時優先候補があるイベントのみ、通常公開候補の条件判定を保持。発揮場所・主語・Lvは引き続き照合。先行効果・内側派生が終われば `evaluateCondition` で確定し、未達の登録は後から復活しない。
- `turn-face-down.ts`: `isAttachedCombinedChild` で分離資格を確認。既に裏向きの下カードも親の純化に伴って解除する。直接対象にした裏向き分身は変更しない。
- ルール本文: [02b](../10_rules/02b_declaration-timing-window-principle.md)、[07e](../10_rules/07e_kanjuden-mechanics.md)。

## 2026-09-27: シレーン画像の重複表示

- `orica-snapshot-2026-09-26T16-08-39-038Z.json`では、C03 `card-34` の召喚にC10 `card-3/card-16/card-1`の手札宣言3件、X04のただちに下置き、条件後判定のC03召喚時、神託が待機していた。C03の召喚時が複数回生成された状態ではない。
- 私的宣言の`effectSourceInstanceId`はイベントの原因C03を指す。これを効果提供元として表示したため、C10の画像・本文がC03に置き換わった。表示には宣言の`sourceInstanceId/sourceDefinitionId`を使う。
- 条件未達の公開候補から原因カードへ画像を代替する処理も撤去。内部の条件後判定待ちは維持し、条件が成立した時点でシレーンを表示する。宣言済み候補の`declaredRegistrationIndex`も引き継ぎ、C10自身の召喚時本文への誤切替を防ぐ。
- 2026-09-27ユーザー再確認（C、既存順序の実装要件）: シレーン召喚→手札/フィールドのドライブを神託より先に発揮→神託と条件成立したシレーン召喚時。根拠は既存[02b](../10_rules/02b_declaration-timing-window-principle.md#ただちに誘発)を維持。
