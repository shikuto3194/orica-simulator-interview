# 魂状態の合体カードと独立ブレイヴのバトル参加（2026-10-26）

対象: Telegram 629905112 / `followup-b4475e9533fb5ed942bf`。
親受入は、魂状態化後の不正ライフ減少を防ぎ、分離済みブレイヴの正規継続を保ち、
BSTH08.5-X01の軽減訂正を原本と同期して公開mainへ統合すること。公開採用は親runnerが確認する。

## 根拠と変更

- [02c:8](../10_rules/02c_battle-lifetime-and-resolution.md) は「攻撃者不在ならブロック宣言・後半フラッシュ・バトルダメージは行わない」と定める。
  公式Q17092は `external-qa-official/SD50.md:149-152`。
  [05](../10_rules/05_brave-and-attack-special-cases.md#合体先離脱後のアタックブロック継続) の単独スピリット状態での強制継続と区別する。
- 共通 `isCurrentCombatMember` がカード状態・現在の参加体・物理的な合体先の在籍を判定する。
  魂状態のホストへattachedの子を独立した攻撃／ブロック参加者へ昇格させない。
  参加体除去、BP/シンボル再計算、現在参加者を用いるBP比較／ライフ解決、旧継続選択で共有する。
  空になった成立済みバトルと終了時参照は既存の終了処理まで保持する。
- こころの軽減を赤3・神1・導1へ訂正。TS・raw aggregate・by-pack・共有監査ミラーを同期した。
  [画像・配布元・訂正履歴の照合](../00_meta/source-review-2026-10-26-kokoro.md) とprovenanceへ補正の根拠を残す。
  他カードの軽減変更はない。primaryのTelegram/harness未コミット変更は保全する。

## 回帰と証明範囲

- `soul-state-attached-brave-battle.test.ts`: 実R13アクセルによる破壊から魂状態を選び、同じattackIdの
  `battle_resolved`にlife_deltaがなく、ライフ不変・参加体なし・battle-end完了となることを確認する。
  現行合法手は残留／同行の選択を先に提示する。その通常経路と、同じ実効果が作った置換待ちを
  `resolveSoulStateReplacement`へ直接渡すattached状態の境界テストを明記して分ける。
  後者を合法手列だけの再現とは扱わない。攻撃・防御、攻防可能な通常ブレイヴも対照にする。
- 添付SHA-256 `59d59ae0f1e5d24543d0a1e5495a00ff7d72ddf79dece2d356ec3e33e0a961f2`。
  原本全文を読み、fixtureには実カード2枚・プレイヤー・残存entity・公開記録125/133/135/139だけを抽出した。
  終了後の状態をライフ1の解決境界へ再投入する検査であり、過去の全行動を復元するリプレイではない。
- `brave-battle-continuation.test.ts`: 通常の分離継続48ケースで攻撃ダメージ／ブロックBP比較を維持し、
  正しい防御側プレイヤーのライフも検査する。
- 既存 `brave-attack-continuation` シナリオは `createActiveAttack` の第3引数に対象側IDを渡していた。
  攻撃者IDへ訂正し、自己ライフ減少を対照の成功へ読み替えない。
- `bsth08_5-cards.test.ts` と `bsth08-5-kokoro-source.test.ts`: 軽減配列の完全一致をTSと両rawで検査する。
- 公開対象UIのraw監査fixtureは埋込コードを再実行し、648面・152本文行・14借用action・
  公開/秘匿runtimeEvidenceなど全non-hash生成値の不変を確認した。軽減訂正に対応する
  3入力のhashだけを新値へ結合し、既存sourceCorrectionsを保持して根拠を追記した。
- `?scenario=soul-state-brave-battle&manualOpponent=1`（`owner=bob`で反転）と既存分離シナリオ:
  Alice GUI／Bob RESTの魂状態・分離攻撃・分離ブロックの6ケース。
  実GUIとローカルAPIのreducer・viewer projectionで、最終ライフ・公開ログ・参加体・終了処理を検査する。
  ローカルroom橋渡しは分離専用endpointをactionへ接続し、候補なしブロック辞退の自動末尾をRESTで進める。
  本番認証・公開サービスへの配備確認とは区別する。

最終成功証跡は同checkoutの `logs/harness/runs/`、査読は `logs/verifier-history/`。
受付原本の全条件を実assertionへ対応付けて受入記録を登録し、統合中はpendingを保持する。
ISMCTS実装・学習・配備・監視周期の変更はこの受入単位に含めない。

受入登録は実行結果の完全なテスト名が追跡ソース内にも存在することを要求するため、
補間で生成していた名前を明示的なケース表へ変更した。各ケースの条件・assertion・
実行時の名前を維持し、旧成功結果を新treeの証跡へ流用せず、通常検証と独立査読をやり直す。
