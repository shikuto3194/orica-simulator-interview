# 剣心カードの印字値・OC・状態参照

## 2026-09-26: CX01の存在条件とカード状態へのコア配置

- 添付スナップショットの魂状態のCX01に対し、「このスピリットがいれば」の後段条件が欠けていた。全軽減は魂状態でも維持し、カウント+2の直前に既存の `self_state` とスピリットフィルタを評価する。契約煌臨元では上のスピリットを参照する。
- 手動コア移動は `isCardTextCardState` の共通判定で魂状態・表裏のカード状態・下カードを除外する。GUI候補・preview・RESTの判定を共有し、通常の実体と状態付与中の分身への配置は維持する。
- 回帰: `bsrk01-cards.test.ts`、`manual-core-move-card-state.test.ts`、`core-move-guard.test.ts`。`scenario-soul-state-presence.spec.ts`でAlice GUI / Bob RESTのカウントとGUIの配置先を確認する。

## 2026-09-25

- ユーザー提示のカード画像と訂正を根拠に、BSRK01-R03「[御庭番衆編]緋村 剣心」をLv1(1) BP5000、Lv2(3) BP9000、OC2+ BP+3000へ修正。最初の表のOC4+は同ターンの「OCも2+が正解」で訂正された（信頼度C: ユーザー確認）。
- 実行データ、印字OC、本文、OCフラッシュのカウント条件、rawの集約・弾別データを同期。
- BP計算が印字コア閾値を直接参照していたため、Lvコスト+2でLvが下がってもBPが下がらなかった。共通の実効Lv判定へ接続し、BP上書き・転神時も同じLvを使う。
- 添付スナップショット（`orica-snapshot-2026-09-25T12-44-03-019Z.json`）の剣心は3コア、カウント2、BP-5000、Lvコスト+2。訂正後はLv2/12000→7000→Lv1/3000。旧印字値かつOC未達なら11000→6000→2000という指摘は正しい。
- 回帰: OC未達/達成の境界、BP減少後のLvコスト加算、Lvコスト固定、Lv自体の減算、印字/上書き/転神BP、BattleEntityの再計算。`kenshin-level-bp`シナリオで小町の実効果をAlice GUI・Bob RESTから解決する。

検証入口: `packages/rules-core/test/bsrk01-r03-level-bp.test.ts`、`e2e/scenario-kenshin-level-bp.spec.ts`。
