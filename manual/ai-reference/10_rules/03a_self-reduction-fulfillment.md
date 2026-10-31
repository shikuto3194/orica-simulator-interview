# 自己軽減枠の充足

親: [コスト支払い](03a_cost-payment.md)。

## 枚数に応じて「軽減シンボルを満たす」自己効果

- 「満たす」は既存の未充足軽減枠を成立させ、要求枠を追加しない。通常シンボルによる軽減と合算しても要求枠数を超えない（2026-10-24 Telegram 629905110、信頼度 C・実装に使用）。
- BSAZ01-C04/C07〜C12は自分の場のマジックを数え、使用する個体自身の効果を1回評価する。手札使用・場のフラッシュ使用の双方が対象で、場使用では自身も1枚に数える。別の同名個体から自己効果を重複付与しない。
- BSAZ03-M01は両プレイヤーの場を合算し、黄の未充足枠だけを満たす。白枠は免除しない。「追加する」と明記するBSRK01-C03/BSTH11-C04とは区別する。
- 通常シンボルと自己充足は最大軽減となるよう割り当てる。M01で黄3枠を自己充足でき、黄/白の複合1シンボルがある場合、その1個を白へ割り当てて計4軽減する。
- `waivesReductionRequirement` の自己修飾を cost-system の支払い個体経路で評価する。外部付与の `whenPayingForFilter` 走査とは分ける。回帰: `self-magic-reduction-waiver.test.ts` / `bsaz03-m01-cost-reduction-symbol.test.ts`、GUI+REST: `scenario-self-magic-reduction.spec.ts`。

## C04自己軽減

`?scenario=self-magic-reduction` は手札使用、`&useFrom=field` は場のフラッシュ使用。
`&owner=bob&viewer=bob&manualOpponent=1` で逆席も確認する。
`e2e/scenario-self-magic-reduction.spec.ts` は両席の合法行動、Aliceの支払いHUD、実コア移動、
メインの3枚破棄と自己配置／場のフラッシュによるネクサス破壊と使用後トラッシュを検査する。

## 固定評価入力の再確認

2026-10-25、基点 `328996bc6` の固定8デッキを通常validatorで照合した。対象カードを含むのは「動魔」のC08だけ。
現行C08の自己充足1アクションを旧`addsReductionSymbol:true` / `cardStateOnly:true`へ復元した定義配列は、旧定義hash `67611476f2e9293d318fdb23cce35d03ce6aeef7ef2d97663dad9d2298ce3919` と完全一致した。他の7デッキは現行定義で旧hashへ一致する。

- 「動魔」の新定義hash: `0f4aed52e87b1ee6526565ccd654a0a158b4a3b0d8912a25bf044d1e13265360`。
- manifest: `1737a093cb9bdf939ac66442454ea61a42d5d8cdec48f7453024c60fcddf78f0` → `838552a281058e8306488c92405caa96f4e786dfa357ece1a2da46232bbefbc3`。
- デッキのカード番号・順序・枚数・保存元・選定理由・profile・seedは維持。通常validatorと既存16回帰で入力の結合・改変拒否を検査する。実戦・校正・学習成功の証跡は更新しない。

## 既存回帰と公開対象監査の追従

C12は場の自身1枚で使用コストが4→3となる。中断元がコスト4の場合、初期リザーブ6からC12に3を払い、分身3体へ3を配ると支払い元は場の3だけになり不足する。初期7なら場3＋リザーブ1で4を払える。両境界を`engine-magic-field-pre-cost-payment-trigger.test.ts`で解決まで検査し、旧「7でも不足」の前提を維持しない。
M01は場のC12により基本支払いが5→4となる。`selfplay-driver-variable-zone-payment.test.ts`は破棄4枚/0コストと破棄3枚/1コストの両方で、C12への割込み判断を経ても完全な入力と支払いを保持する。

公開対象UI監査は基点`328996bc6`の旧source hashと照合した。差分はBSAZ01/BSAZ03の2モジュールのみ。8枚の新フラグを旧`addsReductionSymbol`/`cardStateOnly`へ戻し、M01の`waiverColors`を除くと旧定義全体を完全再現する。全カードの本文と対象外定義は同一で、`scanCards(loadCards(root))`の公開対象分類も監査fixtureと一致した。
raw本文・648行の監査結果・12件の構造外監査・14件の借用actionは維持し、`revealed-target-ui-raw-audit.json`の対応2モジュールhashだけを新しい実装版へ結合した。監査テストの照合や件数の要求は変更しない。
