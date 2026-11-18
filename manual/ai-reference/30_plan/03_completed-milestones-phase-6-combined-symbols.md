# 合体シンボルの表示・判定経路監査（2026-09-27）

## 根拠

- 公式エターナル版[ブレイヴ](https://www.battlespirits.com/rule/official-rule-manual-eternal/page09.html)の合体による変化、アルティメットへの読替え、異魔神、神話ブレイヴを再確認（信頼度A、実装採用）。
- シンボル数固定は[03c](../10_rules/03c_effect-text-interpretation.md)の既存確定事項を維持。
- 公式エターナル版[Q3263](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=BS13)とローカル`external-qa-official/BS13.md:301`を照合（信頼度A）。合体で追加されたシンボルも合体先の「赤としても扱う」効果を受ける。Q3262は効果追加分の追従も明示。
- 多色の色集合と物理シンボル数は別物。表示・軽減・ライフ減少で同じバンドル数を参照する。

## 経路ごとの結果

| 経路 | 結果 |
|---|---|
| FieldAreaのシンボル表示 | 合体子を含まないキャッシュを手動加算していた。ネクサスは本体のみ。全種類をgetCombinedUnitSymbolBundlesに統一 |
| 詳細モーダル | 通常カードは合体単位のgetterを使用済み。分身の独自集計と相手分身の印字参照を廃止し、多色・追加効果も共通バンドル計算へ接続 |
| コスト軽減 | 古いbattle member参照を廃止し現在の合体を参照。異魔神の右のみ合体を独立供給源から除外 |
| field_has / field_lacksの色条件 | 本体だけの色判定から合体単位へ変更。合体子の独立計数を除外し0固定も反映 |
| 相手シンボル色に依存する耐性 | 合体単位に統一。仮想合体を含み、固定・魂状態・下のカードを反映 |
| field_colors_present | 印字直読みを廃止。循環コピー自身を除く実効値から合体・固定・仮想合体を集計 |
| copy_from / 分身live_copy | 合体・左右・仮想合体・固定・多色1個をバンドルで保持。継続全体コピーの動的対象にもsnapshotを適用 |
| バトル・ライフ | resolvedSymbolCountで色数と物理個数を分離。旧snapshotのfallbackを維持 |
| シンボル色追加 | 本体・合体・仮想合体・効果追加の集計後に共通色処理を適用。バトルも同じ処理へ統一し、ブレイヴ単体へは本体の色を漏らさない |
| CardFilter・動的シンボル予算・戦闘候補 | 既存getCombinedUnitSymbolCount経由を確認 |
| AI観測・encoder | 単体effectiveSymbolsとは別にcombinedUnitSymbolBundlesを保持・エンコードする既存経路を確認 |
| 印字参照 | デッキ構築、定義生成、under_card_symbols・非fieldのzone_symbolsはカード情報の参照として維持 |
| 煌臨後のバトル | 仮の印字値設定後にrecomputeBattleEntityBpを通り、現在の合体へ再計算する経路を確認 |
| 下カード・旧状態の互換性 | text_role/煌臨元を合体子へ混入させない。旧バトルの単色同値再計算は参照を維持し、多色化時のみ物理個数を補う |

## 検証

- combined-symbol-consumers、field-symbol-overlay、brave-combined-symbol-lifeに再現回帰。
- 既存のact-as-spirit、シンボル色・多色軽減・シンボル固定・AI観測の回帰も対象。
- `?scenario=combined-symbols&kind=spirit|ultimate|nexus`。実カードでAlice GUI合体とBob REST合体を比較。
- `combined=1`で合体済み、`owner=bob`で操作側変更。スクリーンショットはdebug-screenshots配下。
- `token=own|hidden`で分身の自分/相手向け詳細表示を検証。
- 完了検査は`pnpm codex:finish-check`のfull範囲（rules-core型・全件テストを含む）。

Active Boardに残タスクの追加は不要。作業開始時の未コミット分は内容差分がなく、索引の再確認でクリーン化。
