# 探索入力の観測履歴（I1分割）

親仕様: [AI観測contract](16_ai-observation-contract.md)、実行計画: [I1](../30_plan/ismcts-full-run/tasks.md#i1-観測からの探索入力と仮想世界)。

`ai-search-history.ts` の `projectAiSearchHistory(AiObservation)` は、将来の探索packetの
履歴componentだけを射影する。`player` modeの `buildAiObservation` 出力が信頼境界内の入力。
外部JSONの認証・完全なschema validatorではなく、raw GameStateやdebug/full modeを渡さない。
現時点で本番service/探索へ未接続。`AiSearchRequest/SearchPublicState` やsamplerの完成ではない。

## 配送する値と除外

- `state-sanitize` が観測者へ配送した開示snapshot・手順・対象/結果の具体値をnamed allowlistで複製する。
  audienceの再確認は既存 `disclosureAudienceCanView` を使う。
- actor/playerは `me/opp`、eventは観測者内ordinal、attackは観測履歴内の初出ordinalへ変換する。
  engineのevent ID/sequenceとその欠番、attack ID、live instance ID、registrationIndexは配送しない。
- sourceの公開定義snapshot・effectIndex・definitionPathは保持する。対象/結果のsnapshotも公開時点の値を保持し、
  現在のcard DBやliveカードから欠落identityを補わない。未知sourceは未知のままにする。
- 私的操作の公開移動事実は `state-sanitize` が既に `hidden_card_action/hidden_card_move` へ変換する。
  そのvariantからは移動先/元・枚数・actor/player等の公開事実だけを出し、素性や位置snapshotを復元しない。
- 配送するnested値は新しいobject/arrayへ複製する。未知field・toJSON・raw debug logは出さない。
  scalarのaccessor・object値・非有限数値と必須値欠落は拒否する。未知playerも拒否する。
  入力全体が任意の敵対的JS objectでも安全という保証ではない。

可視性の根拠は [01b](../10_rules/01b_information-visibility.md):
「公開履歴ログでは、非公開ゾーンへ入った時点で live card instance との対応は切る」。
本componentはlive対応をすべて除き、履歴のsnapshotを残す。公開中カードとの正準参照/同一性の接続は
後続の信頼境界内projectorで実装する。履歴だけでengineを再開したり現在カードを追跡したりしない。

## 検証と残条件

`ai-search-history.test.ts` は実際の `appendPublicDisclosure → state-sanitize → buildAiObservation` を使用。
異なる相手手札/山札順・秘密ID、public/live IDのrename、非可視event数とsequence欠番を変えても履歴出力が一致する。
観測者別の私的開示・内容を見せない移動事実・公開定義snapshot・対象/配分の数値差を保持することも検査する。
これらは履歴componentの回帰であり、探索を通したH1-H3ではない。

pending/stack/usageのnested schema、公開盤面/本人可視カードと正準参照、登録deck/既知位置、要求/current decision、
仮想世界構築と再project、root candidate/tree statistics/responseまでの非干渉反証が残る。
I0の未回収予約・全体会計・資源runtime/固定8実戦/校正は未達のまま。
I0を最初の未完了項目に保持し、[tasks.md](../30_plan/ismcts-full-run/tasks.md)の資源gate前のコード実装許可に従う。
本番学習の実更新・配備・監視移行・強さ改善の証明はこの分割に含めない。
