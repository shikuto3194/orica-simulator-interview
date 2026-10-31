# 対象選択UIと発揮後の辞退監査（2026-10-02）

- BSAZ02-C16の手元混入、同名別個体の回収、発揮後の交換辞退を修正。
- 交換2種・転召・煌臨元追加先を共通のカード選択へ接続。盤面/手札のタップと画像付きゾーン候補を使い、選択した合法手の組合せを確定する。
- 固定枚数の破棄・複数ゾーン検索の再辞退を修正し、固定1枚検索7箇所にmandatoryを明示。「まで」と独立任意手順による0枚選択は維持。
- 調査根拠、219アクションの監査範囲と維持した例外は[監査記録](../00_meta/source-findings-selection-contract-2026-10-02.md)を参照。
- 回帰: `swap-choice-contract.test.ts`、`declared-selection-count.test.ts`、`selection-option-contract.test.ts`、交換の既存盤面/継続テスト。GUI/RESTは`scenario-choice-contract.spec.ts`と`scenario-swap-causality.spec.ts`で、候補個体・後続処理・相手側秘匿を検証する。

## 受諾後の継続choiceと全辞退（2026-10-16）

- BSTH06-C03の使用枠再確認で、配布を辞退した後も召喚の`noop`枝を選び、本文を全辞退できる既存回帰を発見した。正源は[03cの全辞退禁止](../10_rules/03c_effect-text-interpretation.md)。旧gateの成功を意味の正しさとして採用せず、確認根拠と実装を修正した。
- 継続choiceにも既存のoptional-step判定を使い、実行済みpayload・後続の独立手順・派生effectを同じ基準で評価する。全辞退できない段階では、空の枝と実行不能な枝をpending候補へ載せない。全枝が実行不能なら不発で終え、入力不能な選択待ちを残さない。
- 前段の配布を実行した後は後段召喚だけを辞退できる。印字上の0指定も共通判定に従う。カード番号や個別効果名による例外は追加していない。
- 独立査読の追加反証を受け、非対価の固定数破壊は[03b](../10_rules/03b_resolution-and-interrupts.md)に従い対象0体/部分対象でも発揮を選べるようにした。破壊を対価にする場合は必要数を維持する。枝の支払いは合法手生成・適用と同じ`canPayRequiredEffectCosts`を使い、物理カードと効果提供元の定義も分離する。`continuation-choice-availability.test.ts`で対象0/1/2体の最終盤面と破壊効果通知、支払い不能/可能、異なる合体条件の正例/反例を検証する。
- `bsth06-cards.test.ts`は通常召喚から2体へのコア配置を完了してから同名制限を検証し、配布辞退後の空choice拒否・保存復元・固定1コスト召喚・対象/支払い消失時の不発も確認する。GUI/REST回帰は`scenario-optional-choice-decline.spec.ts`。ローカルroom harnessで実カードDSLの継続状態を配送し、Alice GUIとBob RESTから候補・不正入力拒否・支払い・維持配置・pending終端を確認する。
- 追加の独立査読で、BSSG01-X05のBP低下辞退後に、回復対象不足でも2コスト支払い枝が残る反例を再現した。[03cの対価構文](../10_rules/03c_effect-text-interpretation.md)「△△できないときに○○だけすることもできない」に従い、`pay_cost`枝と直後の`conditional_cost`結果を一体で判定する。入力生成と共有する配分列挙から、実際の支払いprimitiveを複製盤面に適用し、支払い後に必要対象数を満たす配分が存在する場合だけ候補へ載せる。実盤面と使用枠はpreviewで変更しない。
- `conditional-cost-continuation-choice.test.ts`は実カードの成立済み煌臨event fixtureから公開の受諾・stack・辞退・choice・支払い・対象選択を進め、対象0/1/2体、支払い起因の対象消滅、安全なフィールド支払い、通常/ソウル混合支払いを検証する。合成DSLの正例では支払い後にLv条件が成立する場合も確認する。煌臨操作自体の試験とは区別する。非対価破壊の0/部分対象と印字0指定は既存回帰で維持する。

## 輪廻の西蔵人形の回収選択（2026-10-15）

- Telegram `followup-7fb8b9ffce429df11511` / inbox `629905100`。添付のC03・R01・C06公開後の自動回収を再現し、C03の`move_card.target`に`from`と同じ条件を追加。実行後に黄1色・指定系統のスピリット/ネクサスから1枚を選ぶ。
- 公開完了を`StepResult.executed`に保持し、手札加算0枚でも独立した後段回収を辞退できる。`succeeded`と`hand_added`の意味は維持する。対象付き移動の任意step可否も既存の移動共通gateへ接続し、手札増加禁止を反映する。
- 正源: [03c](../10_rules/03c_effect-text-interpretation.md)「その後」の対象は前段解決後に選び、固定枚数は実行確定後に再辞退しない。
- 回帰: `bsth02-7-c03-deck-reveal-hand-added-fallback.test.ts`。2候補の各選択・0枚/マジック/2枚指定の拒否・辞退・1候補自動確定・マジック取得時の回収不発・同名制限・手札増加禁止を確認する。GUI/RESTは`reveal-retrieval-audit.spec.ts`の`fallback`で候補2枚と選択後の盤面を照合する。
- 単一候補fixtureの補助札を、回収可能な楽族`BSTH01-C01`から対象外の地球・ＣＦ`BSAZ01-C01`へ変更した。実行後のpending不在と即時の手札移動を直接検証し、helperによる対象選択で自動確定を代用しない。
- 公開経路のraw監査fixtureも埋込コードで全648面・152本文行・借用/公開のruntimeEvidenceを再生成した。差分はC03の回収targetに伴う`filter`の列挙と当該モジュールhashだけで、他647行・raw原本/補助hash・分類・実行証跡は全値一致する。追加したtargetの12行だけを除いたbytesが旧module hashに一致することも確認し、根拠をfixtureの`sourceCorrections`へ追記した。

### 固定評価入力の再確認

固定8デッキ中「動魔」だけがC03を含む。現行catalogのC03から今回追加した`effects[0].steps[1].action.target`だけを削除した定義配列は旧`definitionsSha256`の`7c0cc059e7fc29e916525ed8bc784949eff2747c5208aff91289f58a456018a7`へ完全一致した。残る7デッキは現行定義で既存hashに一致する。

この差分に限り「動魔」の定義hashを`67611476f2e9293d318fdb23cce35d03ce6aeef7ef2d97663dad9d2298ce3919`へ更新した。`fixed-decks.json`と`fixed-decks.mjs`のmanifest hashは`8f2da586f1c84d14d4af4066bb1e454c748157a3159bec2bb8d8be5ba608e25c`から`118b5ec322c572707e9f34d2a2861ef469dc6e981e8b8383d7aa5671c532d4d2`となる。カード番号・順序・枚数・保存元・選定理由・profile・seedは変更しない。入力確認だけで、実戦・校正・学習の新規成功証跡にはしない。

### REST解決後の選択HUD解除（2026-10-15）

回収対象選択は`23a25777f`でmain反映済みだが、RESTで選択を解決すると、消滅した`pendingStepOptionalTargetSelection`に対応する画面内の`pendingAction`だけが残っていた。手札移動は完了しても対象選択HUDが残り、次のステップへ進めなかった。

`BattleScreen`の既存の任意step対象選択同期で、自分のpendingが消滅したときは同じ種別のローカル選択を解除する。他種別の対象選択には触れない。`reveal-retrieval-audit.spec.ts`のC03/R01回収で、Alice GUIとBob RESTの両方について候補2枚・選択した1枚の手札移動に加え、選択HUD消滅と次ステップ操作の復帰を検査する。

## BSTH06-X02の手元破棄の選択者（2026-10-16）

- 保存本文の「相手の手元のスピリットカード/ネクサスカード/白のマジックカード1枚を破棄することで、このスピリットは回復する。」は対象の所在を指定している。「相手は選ぶ」「相手が破棄する」とは書かれていない。今回のユーザー確認Cに従い、発揮側が選ぶ。
- 導入commit `bf4245dca9`から`discard.player: opponent`だけが設定され、選択者指定は省略されていた。現行`structured-zone-ops.ts`の破棄処理は省略時に対象プレイヤーを選択者とする。履歴に相手選択を正当化する本文解釈は記録されておらず、当時の思考理由は断定できない。
- 既存の`selectionPlayer: effect_controller`を設定し、破棄対象の所有者と選択者を分離した。同じ効果の「ことで」全体は[03c](../10_rules/03c_effect-text-interpretation.md)に従い`executionMode: optional`を明示。エンジンの共通既定は変えない。
- 旧回帰は候補1枚の自動確定であり、選択権を検証していなかった。`bsth06-x02-discard-chooser.test.ts`で両プレイヤー、3種の候補、対象外の色/所有者/手札、Lv1/2/3、候補なし、選択後の1枚破棄・回復・handCount維持を確認する。通常アタックからの発揮/辞退とAlice GUI / Bob RESTの選択は`scenario-koishi-discard.spec.ts`で検証する。
