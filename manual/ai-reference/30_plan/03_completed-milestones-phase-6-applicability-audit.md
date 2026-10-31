# 発揮資格と継続効果の保持監査 (2026-09-26)

## 問題と漏れの原因

- BSRK01-CX01「緋村 剣心」の契約煌臨元の白扱いは、登録側が `applicability` を評価しても、後続の整理が独自のゾーン規則で消していた。前回の修正は `treat_as` へのゾーン複製と例外追加に留まり、共通評価器へ集約できていなかった。
- 登録・再構築テストは再登録で欠落を補うため、後処理単独の誤削除を見逃した。プレイヤーを対象にする効果にも別の効果名リストがあり、全カードの登録→整理で BSTH03-C31「永遠亭」の `prevent_deck_discard` 2件の誤削除を再現した。
- 型には存在する `applicability.form` が共通評価器で未評価だった。現行カード定義に使用例はなかったが、実効カテゴリの既存正源へ接続した。

## SSOTへの集約

- 軽量整理にもカード定義 lookup を渡し、provenance から元 Effect を解決。常時効果の発揮資格・条件は、再構築と同じ `isContinuousEffectStillValid` → `evaluateEffectApplicabilityForCard` / `evaluateCondition` で判定する。
- `treat_as` 専用の `sourceApplicabilityZone` 複製、独立したゾーン照合2本、自己対象の効果名例外、プレイヤー対象の効果名リストを廃止。プレイヤー対象は実際の `state.players` のIDで識別する。
- 定義/provenanceの無い旧CEだけは、保存済みのゾーン情報を同じ共通評価器へ渡す。解決済みの起動・誘発効果は発動時のLv等を維持条件にせず、期間指定を維持する。
- 常時スタック元禁止の直接参照経路も、発揮条件フィールドの手列挙をやめて共通評価器へ接続。
- 役割を与えるCEの失効で別のCEも資格を失う場合は、削除が収束するまで再評価する。チェンジ・アクセル・神技は元定義の効果コンテナへの位置参照をprovenanceに保持し、通常の `effects[0]` と取り違えない。条件本文は複製せず、合成効果は定義外であることを明示する。

## 本文・カード定義の監査

- 公開プール594定義の表裏・効果コンテナを走査し、1,858効果を対象に明示ヘッダーを照合。`applicability` が無いだけでは欠落としない。Lv制限の `condition.min_level`、合体制限の `condition.combined`、最低Lvから有効な本文、状態別に分割した同一処理も確認する。
- 魂状態/煌臨元の明示ゾーンを8カード11効果で整理: BSFT01-CX01[1]、BSGE01-CX01〜CX04[2]、BSKB01-CX01[1,2]、BSSL01-CX01[1,2]、BSTS01-CX01[2,3]。角括弧は0始まりのeffectIndex。BSTS01-CX01[3]は既存の `self_state.in_advent_source` を同義の発揮ゾーンへ置換し、状態別に分割された通常スピリット版は広げない。
- 省略箇所すべてを実害と数えてはいない。既定の物理 `field` 判定で通る起動/誘発経路と、明示 `advent_source` を必要とする常時効果の登録経路が異なるため、定義側を明示してこの差に依存しないようにした。
- `scripts/applicability-header-audit.mjs` と `applicability-header-audit.test.ts` が照合を継続する。同じ本文に別処理があるだけで欠落を隠さないよう、状態別の実装は処理種別ごとに照合する。剣心の白扱い定義を除去すると検査が落ちることも確認する。
- 監査は明示ヘッダーと発揮資格に限定。任意の日本語本文の意味や、全組合せ盤面の効果を完全証明するものではない。

## 回帰検証

- `applicability-lifecycle.test.ts`: 通常の場・手札・トラッシュ・手元・公開中、Lv・形態・合体・左右合体・魂状態・契約煌臨資格の保持/失効と、解決済みターン効果の保持。
- `continuous-effect-card-pool-lifecycle.test.ts`: 裏面を含む全定義の、単体・最高Lvと明示された追加ゾーンで到達した常時効果を整理し、同じeffectIdが残ることを確認。条件付き効果の全到達盤面は含まない。
- 剣心の既存C04/R03回帰と `e2e/scenario-kenshin-inherited-symbol.spec.ts`: Alice GUI / Bob RESTで柱斧のドロー解決後の白表示と1コスト配置。
- 共通ルール変更として `pnpm codex:finish-check` の全検証を実施する。Active Boardとissuesの更新は不要。

関連設計: [継続効果の状態整合性](../20_design/13_continuous-effect-state-integrity.md)。
