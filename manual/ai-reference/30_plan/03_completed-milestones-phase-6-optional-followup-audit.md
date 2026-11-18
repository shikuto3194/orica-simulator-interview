# 任意前段と強制後続の全監査（2026-09-22）

## BSLH01-C05の再現と修正

ユーザー提供 `orica-snapshot-2026-09-22T11-42-29-836Z.json` を起点に、
「破壊/破棄したとき」の強制処理が任意確認に見える問題を調査した。

- 原文・DSL上、任意なのは先頭のカウント増加と破壊/バースト破棄。破壊/破棄成立後の通常コア3個回収とカウント増加は既にmandatoryで、変更は不要だった。
- 確認本文の既定値が効果全体の `textRef` だったため、任意確認に「置き」「する」の強制処理まで掲載されていた。任意2stepへ、それぞれに対応する原文だけを `prompt.sourceText` として指定した。
- 添付盤面のトラッシュ通常コアは0個。効果の直接実行では先頭カウント確認→除去確認→対象選択となり、破壊後に確認は出ずカウント合計+2まで進む。添付時点は効果解決中のpendingを含まないため、報告された画面そのものの履歴は復元できない。
- 正源は[03cの強制/任意](../10_rules/03c_effect-text-interpretation.md)と[03c1の前段成立後の処理](../10_rules/03c1_effect-connectors-and-completion.md)。前段が任意でも、成立後の「置き」「する」は可能な限り強制で処理する。

## 全件監査の範囲と結果

`ALL_CARDS` を既存の `collectCardFaces` / `collectEffectContainers`
（`scripts/card-text-accountability-core.mjs`）で列挙し、表裏・機構内・入れ子の効果とstepを走査した。
634面、1,825効果登録、2,870step中の **262任意step** を原文と照合。
そのうち `conditional_result` または `stepCondition` を持つ **49step** は、
前段の結果に依存していても本文自身に任意表現があることを重点確認した。
強制後続に誤って `executionMode: optional` を付けた追加の誤りは確認されなかった。

| 弾 | 任意step数 | 弾 | 任意step数 |
| --- | ---: | --- | ---: |
| BSAZ01 | 2 | BSAZ02 | 4 |
| BSAZ03 | 1 | BSDB01 | 20 |
| BSES01 | 3 | BSFT01 | 30 |
| BSGE01 | 13 | BSKB01 | 16 |
| BSLH01 | 43 | BSRK01 | 1 |
| BSSA01 | 10 | BSSG01 | 23 |
| BSSG02 | 2 | BSSL01 | 8 |
| BSTH002 | 3 | BSTH003 | 2 |
| BSTH005 | 2 | BSTH02 | 3 |
| BSTH02.7 | 20 | BSTH03 | 3 |
| BSTH04 | 2 | BSTH05 | 8 |
| BSTH05.5 | 1 | BSTH06 | 3 |
| BSTH08 | 3 | BSTH08.5 | 1 |
| BSTH09 | 6 | BSTH11 | 24 |
| BSTS01 | 5 | 合計 | 262 |

確認の境界:

- 「できる」「置ける」「戻せる」等の可能形、「ことで」の任意対価、明示的な0〜N指定、任意の効果全体を束ねる入口を区別した。単に本文内に「する」があるという理由でoptionalを削除しない。
- BSLH01-C05・BSSG01-M04の除去後コア回収は強制。BSLH01-R05の破壊後ドロー/カウント、TR03(B)の消滅後コア配置は本文も任意。BSFT01の転醒後合体選択、BSTS01-X01の「1個まで」も維持する。
- 共通実行器 `effect-interpreter.ts` のoptional確認ゲートは現在のstepの `executionMode` だけを検査する。前stepや効果全体のoptionalを後stepへ継承しない。選択再開時にも同じゲートと結果参照を使う。
- 本監査は強制後続を任意にする誤設定とその実行経路が対象。原文全文の補助表示そのものは不正な任意判定ではなく、全カードの確認文を自動的に切り詰める変更は行わない。

## 検証

- `bslh01-c05-mandatory-followup.test.ts`: 破壊/バースト破棄 × 通常コア0/2/5個、ソウル除外、除去辞退。後続の任意確認がないことと実際の盤面・資源を検証。
- 既存の `bslh01-cards.test.ts` は対象不存在、カウント辞退、ネクサスのコスト条件、破壊とバースト破棄の結果参照を維持する。
- `?scenario=mandatory-followup` / `e2e/scenario-mandatory-followup.spec.ts`: Alice GUIとBob RESTの両方で、任意確認2回の後にコア3個回収・カウント+1まで自動完了する。
- 関連の型検査、カード忠実度検査、全件テストは `pnpm codex:finish-check` で確認する。
