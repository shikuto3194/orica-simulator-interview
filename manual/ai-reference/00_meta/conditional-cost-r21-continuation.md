# R21の効果解決後のバトル継続

[ことで監査](conditional-cost-scope-audit-2026-10-26.md)の追補。2026-10-27の独立再査読で確認したfixture契約と回帰範囲を記録する。

## 反証と修復

候補`43ab6e8d`は通常26gateとGUI/REST91件を通ったが、新しいR21シナリオと単体fixtureは`ActiveAttack.blockAssignments`を空配列で作っていた。効果の疲労・破壊・pending解消だけを確認して停止したため、その後の合法なフラッシュパス2回で`Missing block assignment for battleResolutionGroup participant`となる境界を捉えていなかった。両所有者で再現した独立反証を採用する。

両fixtureは公開SSOTの`createActiveAttack`で生成する。`packages/rules-core/src/battle/battle-shared.ts`の通常生成処理は、未ブロックの各参加体にも`{participantEntityId, blockedByEntityIds:[]}`を用意する。`battle-system.ts`→`runtime.ts`→`index.ts`の既存公開経路を使う。

ルール根拠は[前半フラッシュの優先権ループ](../10_rules/02_turn-flow-and-timing.md#フラッシュタイミングの優先権ループ)と[バトルの存続・終了](../10_rules/02c_battle-lifetime-and-resolution.md)。効果・応答解決後もループを続け、2連続パスで閉じる。ブロックしなければ後半フラッシュはなく、そのままバトル解決へ進む。

## 検査する実行経路

- 単体14件は、対象・疲労・返却の既存assertion後にも、実際に提示された`pass_battle_flash`／`decline_block`を上限付きで解決する。生存する1シンボルの攻撃者はライフ1減少、破壊した攻撃者はダメージ0となり、バトルが終了する。
- GUI/REST4件は両所有者の実行・辞退後、AliceはGUI、BobはRESTで継続する。各入力のversion更新を待ち、ブロック辞退後のライフ5→3、`activeAttack:null`、pending解消を確認し、before／効果後／バトル後と入力順を添付する。
- 実カード・生成登録・応答経路を使うlocal transport bridgeと本番投影関数の検査であり、実JWTネットワークルームの受入とは区別する。完成候補は再び必要gateと独立査読へ通す。

画面の「対象選択完了」は2秒の`message-toast`で、CSSは`pointer-events:none`。攻撃者の赤い表示も生存中のアタッカーの描画である。これらの表示を原因とする懸念は、ソースと継続probeに基づき棄却した。

候補`f0c8a55e`の通常scenario検証は90件成功・1件失敗。Aliceの辞退時には味方ブロッカーが残り、専用の「ブロックしない」ボタンが出るが、テストは汎用の`data-action-kind`を探して待ち続けた。失敗時のDOMと`BattleScreen.tsx`の専用ボタン、`action-ui.ts`の`decline_block: "other"`を照合し、テストだけを既存のrole/name操作へ修復する。実行側・Bobの辞退側はバトル終了まで成功していた。失敗記録は`logs/harness/runs/1793059994152-9284.json`に残し、変更後の通常scenarioと必要gateを再確認する。
