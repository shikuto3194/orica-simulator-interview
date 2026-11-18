# 内容から選ぶ限定検査

`semantic-scope.mjs` が固定した比較基点と現在の内容を照合する。`--plan` は比較基点、ファイルごとの検査と根拠、限定testファイル、変更カード番号、分類に足りない情報を表示する。

`--plan` の `fullSelectionReason` は、明示指定か、共有実行基盤・依存解決・状態契約の横断変更の根拠を示す。完了前は `pnpm codex:finish-check` で差分を検証する。ローカルの finish/full/push/merge では `evidence.passed` に照合済みの成功、`evidence.missing` に成功証跡が不足するゲートを出す。`pnpm verify --plan` の `missing` が空なら、同じ入力での全検証の証跡が揃っている。`pnpm verify` を実行した場合は従来どおり新規実行する。台帳の証跡は実行時の main が現在と一致する場合だけ照合する。merge の fuzz と独立査読は別に判定する。

- 軽減値: 識別済みカードのliteral配列だけを構文木から除いた全体が一致する時に限定。対象カードの原データ2か所と実装値を照合し、関連testファイルだけ実行する。呼出し・他field・カード追加/削除はこの扱いにしない。
- 型だけ: runtime出力が変わらない変更は下流込みの型検査。動的importの実行コードはこの扱いにしない。
- 単体testだけ: 他moduleからimportされない既存/新規testをliteralパスで実行。削除・共有testは関連集合へ戻す。全file・全case成功、skip/todoなし、retryなし、case件数一致を完了条件にする。限定成功は全件成功を代替しない。
- 裁定記録は変更recordのcardNo/cardNosに紐づくtest、raw監査fixture・監査実装・sourceHashesの原本は専用照合testを選び、重いゲーム検証より先に実行する。出典は追跡済み情報と根拠の存在を確認し、local mirrorがある環境ではそのhashも確認する。外部原文の意味の確認は独立査読が担当する。
- カード定義は構文木で追加・削除・変更を識別する。共有定数を参照するカード、パック登録・生成入口の利用先、DSLの分岐・ドロー・回収の共通回帰も含める。
- 分岐ハンドラの本体だけが変わる場合は、条件・空候補・辞退・選択番号・使用回数と継続解決の回帰、GUI/APIの解決経路を選ぶ。境界を限定できない場合はゲーム領域の回帰へ広げる。
- 公開情報ログの表示専用コンポーネント・CSS・専用e2eは、変更ファイルのformat/lint、型・文書・機密検査、未提示カードの非公開と双方のルーム同期のGUI検査、本番ビルドと公開版の起動検査を選ぶ。ログへのデータ供給と共有CSSは従来の範囲で扱う。コミット・公開時は独立査読を維持する。

完全重複3caseを削除し、全件Vitestとnotice-editor、storageとhandoffのwork-plan重複実行を除去した。異なるカード・seed・終局保証は削除しない。テストを保持することと今回選択することは別判断。

限定Vitestの静的import閉包が確定できる場合は、閉包外のTS変更を入力hashから除外する。I/O・任意package・動的loader等があれば全入力照合に戻す。config・依存・環境・監査入力は保持する。未分類の依存を推測で免除しない。

10分は検証フェーズ全体の効率目安であり、時間切れによる合格や必要検査の省略条件ではない。初回の全diff査読と修正後の差分/影響先査読を合わせ、最終treeの全変更と検査選択を覆う。過去のheadTreeを書き換えて再利用せず、現在treeへの新しい査読結果を記録する。


通信snapshotの既知の受取/二重適用防止だけの変更は、TS/TSX構文木で全fileを比較し、指定文以外が一致する場合に限りweb型・room回帰・ローカル双方向GUIへ限定する。ASI・JSX本文・guard等の変更は拒否して通常範囲へ戻す。シナリオ定義はその登録済みGUIを選ぶ。

確認記録と既知の実行コードが混在しても、双方の必要gateを合成する。review-batchは現行の監査結果・record・根拠・実行証跡を照合し、実行コードの検査を代替しない。未知path、新規モジュール、動的入口は利用先を確認して必要検査を登録する。`unresolved` が残る限定計画は実行時に失敗する。基点確定済みの空差分は検査なし。push・merge・CIでは明示的に `--full` を指定できる。`node scripts/test-harness.mjs --selection-only` は選択・編集guardの回帰だけを実行し、通常入口は従来の全harness回帰を保持する。

ゲームsource変更では既存の固定deck/catalog検査2群（22件）を独立したismcts-catalogで確認する。ismcts-runtimeのWindows保護・予約・storage・telemetry検査は別契約であり、該当script変更とfullで従来どおり実行する。元の失敗や診断を成功へ昇格しない。両gateが必要なら元runtimeがcatalogを含むため重複実行しない。

登録済みscenarioの新規追加だけは、追加importとSCENARIOS項目を除いた構文木全体の一致、literalの名前/説明とbuilder参照を確認して対応GUIと型へ限定する。既存項目・制御フロー・未登録scenarioの変更は免除しない。スタイル設定の変更は実際のformat/lint検査を選ぶ。

## 差分に応じた検査

ファイル数で一律にfullへ切り替えない。`scopes` の該当検査を合成し、重複は1回にする。

| 変更範囲 | finish / pushの検査 |
|---|---|
| Markdown | 変更ファイルのformat + docs |
| 監査確認記録・残量 | 変更ファイルのformat + fidelity回帰 + 更新recordのfresh有効性・紐づく回帰を一括検証 |
| ホームの表示コンポーネント・CSS・専用e2e | 変更ファイルのformat/lint + `e2e/home-lobby.spec.ts` |
| 保存デッキの共通ブラウザー・絞り込み・並び替え・選択モーダルと専用CSS/e2e | 変更ファイルのformat/lint + web型 + 保存デッキunit + 保存デッキ・ルーム選択・構築配置・詳細のGUI。DeckBuilder本体・API・エンジン混在は各差分を分類 |
| タイトルの表示コンポーネント・CSS・専用e2e / BGMコントロール | 変更ファイルのformat/lint + 初期取得・更新・直リンクのe2e。BGMコントロールはホームのe2eも実行。保存処理やBGM再生基盤は対応する回帰を追加 |
| 共通の塗り専用CSS・外観／招待／通知の専用e2e | 変更ファイルのformat/lint + `app-theme`・`room-invitations`・`room-push` のe2e（配置・透過・操作状態も確認） |
| 招待の実JWTテスト・後片付けとその回帰 | 変更ファイルのformat/lint + 後片付け回帰 + 上記mock GUI。実JWT検証はservice-role環境で別途実行 |
| バトルの戻るメニューの文言・遷移先だけ | 変更ファイルのformat/lint + じゃんけん中・シナリオ・棋譜の遷移e2e |
| harness・専用回帰テスト（`test-verifier-gate.mjs`を含む）・pre-push | 変更ファイルのformat/lint + harness・verifier回帰・dev契約 |
| Funnel監視モジュール・登録script・専用回帰・公開API監視workflow | 変更ファイルのformat/lint + Funnel監視回帰。API監督・HTTP本体・CI本体は該当する運用と実行経路を検証 |
| supervisor wrapper・監査work-plan・auto-mergeとprimary復旧・その専用回帰 | 変更ファイルのformat/lint + handoff（監査残件・停止判定・primary復旧を含む）・supervisor lock・runner lock回帰 |
| 登録済みscenario / ローカルGUI | 変更style＋対応GUI。公開build specはbuildも実行 |
| ゲーム共有部 | 型・put・固定デッキ/catalogと、影響する機構またはゲーム領域の回帰。該当するGUI/API検査を追加 |
| カード定義・原本 | 構文木で識別したカードと機構の回帰、本文台帳、カード回帰参照、原本照合。hash照合を先に実行 |
| 上記の混在 | 必要な検査の和集合 |
| 未知経路・基点不明 | 影響先や基点を確認するまで限定検査の合格を止める。横断変更は `fullSelectionReason` に根拠を出す |

新scopeは影響を覆う回帰と選択テストを伴う。BattleScreenは差分行も限定する。未分類の実行経路は保守的に扱い、関連する型・GUI・APIの確認を追加する。[GUI/API検証](../25_gui/12_bidirectional-e2e-pattern.md)。
