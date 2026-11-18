# 2026-10-13 神託の本文イベント列挙

対象: Telegram 629905090 / `followup-fc12b43dab12b87d9a6d`。実装候補の記録。main統合・配備は親runnerが確認する。

## 根拠と設計

- **A / 採用**: [08b アクセル](../10_rules/08b_accel-change-zero-counter.md)「手札からマジックのようにコストを支払って効果を使用」。[08d](../10_rules/08d_grandwalker-nexus.md) / 独自Q&A qa-046 の「カードの使用ではありますが、『召喚/煌臨』ではないため」の区別を適用する。
- **A / 採用**: 全31 `grandwalkerData` の通常本文を、`scripts/audit-mirror-provenance.json` の版固定ミラー（配布元 `f51f8ba814654a725e7d36554ada87265293bde9`）とカード単位で照合。全31のイベント句が一致。hashも既存provenanceと一致し、本文・印字値・ミラー・baselineの訂正は不要。[版訂正の確認記録](../00_meta/source-review-2026-09-29.md)を参照。
- **A / 採用**: 現行配布画像の [BSTH03-X02](https://dancing-pixie-db5cc3.netlify.app/images/BSTH03-X02.png) は召喚/煌臨のみ、[BSTH08.5-X03](https://dancing-pixie-db5cc3.netlify.app/images/BSTH08.5-X03.png) は召喚/煌臨/アクセル使用を印字。2026-10-13取得・目視確認。SHA-256はそれぞれ `4d0d0240e5b05647c4c03cb8751569271479812bd116056ee51f58dae07ab4fa` / `c33b7a566a69d86da2ea4fb6778c3144d1d313e18669668d46146bc893cdc628`。配布元GitHubの同revision直接取得は404で、再取得成功とは扱わない。
- 添付snapshotでは `card-31`（永琳）へ `card-13`（ミスティア）の `use_accel` 神託pendingが残存。再現資料として扱い、その状態を正しい裁定とは扱わない。

`GrandwalkerData.oracleTriggerKinds` を必須・空不可のtupleにし、通常神託の共通収集器（事前判定とenqueueが共有）では未指定・空・非配列をキューしない。`use_accel` 発行元は変更しない。カード/アクセル別除外は不要。

coverageとfidelityは同じ本文検出器を使い、欠落・空・重複・本文にないイベント・印字イベントの欠落を違反にする。ヘッダの「アクセルを持つ」、配置時神託、他の神技本文からイベントを推定しない。本文台帳の省略互換も廃止。

## 全定義の原文照合

通常イベント句は下表のとおり。各行は独立したカードオブジェクト。`追加`は今回の欠落修正、`維持`は既存列挙が原文一致。

| カード | 通常イベント句 | 列挙 |
| --- | --- | --- |
| BSAZ02-X04 | 召喚/煌臨 | 維持 |
| BSAZ02-X05 | 召喚/煌臨 | 維持 |
| BSES01-CX01 | 召喚 | 維持 |
| BSLH01-X01 | 召喚/煌臨 | 追加 |
| BSLH01-X02 | 召喚/煌臨 | 追加 |
| BSSA01-XX01 | 召喚/煌臨/配置 | 追加 |
| BSTH003-X01 | 召喚/煌臨 | 追加 |
| BSTH003-X03 | 召喚/煌臨 | 追加 |
| BSTH01-XX01 | 召喚/煌臨/配置 | 維持 |
| BSTH02-X01 | 召喚/煌臨 | 維持 |
| BSTH02.7-CX01 | 召喚/配置 | 維持 |
| BSTH03-X02 | 召喚/煌臨 | 追加 |
| BSTH04-X01 | 召喚/煌臨/配置 | 維持 |
| BSTH04-XX01 | 召喚/煌臨/配置 | 維持 |
| BSTH05-X01 | 召喚/煌臨/配置 | 維持 |
| BSTH05-X02 | 召喚/煌臨 | 追加 |
| BSTH05.5-X02 | 召喚/煌臨 | 追加 |
| BSTH05.5-XX01 | 召喚/煌臨/配置 | 維持 |
| BSTH06-X01 | 召喚/煌臨 | 追加 |
| BSTH07-X01 | 召喚/煌臨/配置 | 維持 |
| BSTH07.8-XX01 | 召喚/煌臨 | 維持 |
| BSTH08-X01 | 召喚/煌臨/配置 | 維持 |
| BSTH08-XX01 | 召喚/煌臨/配置 | 維持 |
| BSTH08.5-X03 | 召喚/煌臨/【アクセル】の使用 | 維持 |
| BSTH09.2-X01 | 召喚/煌臨/配置 | 維持 |
| BSTH09.2-XX01 | 召喚/煌臨/配置 | 維持 |
| BSTH10-X01 | 召喚/煌臨/配置 | 維持 |
| BSTH10-X03 | 召喚/煌臨 | 維持 |
| BSTH10-X04 | 召喚/煌臨 | 維持 |
| BSTH10.5-X01 | 配置/使用 | 維持 |
| BSTH11-X01 | 召喚/煌臨 | 維持 |

## 回帰と受入

- `oracle-trigger-kinds.test.ts`: 実カードC03の手札アクセル→導託0、通常召喚→維持コア配置→導託1、同対象のsummon/adventイベント→導託1。X03/C20の手札アクセル→神託1→発揮→コア+1・ボイド-1・手元移動。旧/不正入力は全5通常イベントでenqueueも事前判定もfalse。
- `printed-kanako-miko-oracle.test.ts`: 従来の「未指定なら非印字アクセルも発火する」反例を、未指定はキューしない正の回帰に変更。既存synthetic fixtureも必要なイベントを明記する。
- `test-fidelity-coverage.mjs` / `test-fidelity-audit-integration.mjs`: 欠落/空/不一致を実CLI gateまで確認。配置時/神技の語、ヘッダの機構条件、順序差、裏面を反証する。
- `?scenario=oracle-trigger-kinds` / `scenario-oracle-trigger-kinds.spec.ts`: Alice GUIとBob RESTで非列挙/列挙アクセルを使用し、発揮後の神託コア・ボイド・手元・pending終端を検査する。
- 必須gate・独立verifier・verified commit・親統合要求を順に実行し、統合要求中は依頼をpendingに保持する。

ISMCTS実装・配備・120分監視移行・強さ実証の証跡には該当しない。ローカル知識照会は別件I0根拠の `EVIDENCE_DRIFT` でstart/search失敗。native auditはpartialであり、未確認の過去turnを完了扱いしない。
