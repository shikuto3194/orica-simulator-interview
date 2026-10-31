# ブレイヴの意味イベント

裁定正源: [ブレイヴの合体](../10_rules/05_brave-and-attack-special-cases.md#合体)。
受付原本・公式Q21599・不具合snapshotは、それぞれ依頼、召喚時直接合体の裁定、再現データとして区別する。

## 発行契約

`effect/semantic-trigger-events.ts`が操作の成立時に`SupplementalTriggerEvent`互換の事実を記録する。
表示用の`effect:summon:*`/`brave:combine:*`ログ、fieldへの移動、attachment差分からブレイヴの召喚・合体を作らない。

| 操作 | 発行する事実 |
| --- | --- |
| 通常合体、異魔神の右合体、非召喚の効果合体 | `brave_combined`（成立したhostを保持） |
| 通常のブレイヴ召喚 | `summon` |
| 召喚に伴う直接合体 | `summon` + `brave_combined` |
| `brave_combine_effect.asSummon:true`の直接合体召喚 | 維持コア選択の確定後に両方 |
| 契約合体 | `brave_combined` + `cause:contract_combine` |

通常/効果の召喚・配置・put操作は、ブレイヴについても明示された場入り種別を渡す。
召喚許可やdeck-revealの操作経路も同じ発行契約へ接続する。スピリット等の既存差分推論全体の移行は本変更の対象外。

## 継続・保存・配送

`GameState.semanticTriggerEvents`は型付きの解決内台帳。`semanticTriggerSequence`で事実ごとにIDを採番する。
pendingと継続snapshotが通常のGameStateとして台帳を保存する。台帳・採番は権威stateと正式snapshotだけで保持し、viewer向け投影には出さない。維持コア未確定のカードは共通guardで配送を待つ。
`collectAndQueueTriggerReactions`/`queuePendingReactionsFromTriggerEvents`は、観測者の有無によらず配送済みIDを記録する。
キューを解決/辞退して空にした後、同じchainを保存復元して再収集しても、配送済みの事実を再配送しない。成立後に関連カードが場を離れても、観測者の現在の発揮資格と事実の存在を分けて台帳を消費し、後の再場入りへ持ち越さない。
型付き召喚の神託は共通ファネルで同じバッチから配送する。途中のafter_triggersで通常誘発を消費しても、外側finalizeへ神託だけを取り残さない。X03やoracle-systemへカード別例外を足さない。

維持コア不足・取消で成立しなかった場入りの未配送事実は破棄する。取消で配送済み記録と採番は戻さず、snapshot内の確定済み前段は保持する。
台帳は新規発行時に前ターンの配送済み事実を除く。未配送事実は保持する。
学習の進展判定では配送記録・採番を除き、未配送事実の意味を残す。

## 回帰入口

- `brave-semantic-events.test.ts`: 629905088のC21/X01/X03盤面、通常召喚/直接合体召喚、偽ログ、正式snapshot保存復元、同一chain配送、召喚時/明示ブレイヴ召喚バースト。
- `bsaz01-cards.test.ts` / `c2-trigger-events.test.ts`: アナリティカルエンジン、通常合体・右合体・host帰属。
- `bsge01-cards.test.ts`: 契約合体限定と召喚時の分離。
- `training-progress-revisit-guard.test.ts`: 配送記録で無償合体/分離ループを進展にしない。
- `?scenario=brave-semantic-events`: 手元合体と`mode=direct-summon`/`summon`の比較。`owner=bob`でREST側を反転。
- `e2e/scenario-brave-semantic-events.spec.ts`: Alice GUI / Bob RESTを共通APIへ接続して最終盤面とイベントを検査。
