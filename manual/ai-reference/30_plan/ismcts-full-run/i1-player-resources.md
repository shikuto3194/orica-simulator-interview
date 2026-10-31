# I1 player資源・公開提示・セット使用の部分合成

親仕様: [仮想盤面](design.md#仮想盤面)、[I1タスク](tasks.md#i1-観測からの探索入力と仮想世界)、
[AI観測contract](../../20_design/16_ai-observation-contract.md)。完全worldや本番ISMCTSの受入ではない。

## 物理資源とカウント

`projectAiSearchPlayerResources`はplayer観測の通常/魂コア数と手札/山札枚数を明示コピーする。
legacyの魂所在は個数から推測せず別に保持し、公開field参照だけを同じ観測内の`cardRef`へ置換する。
観測の`soulCoreCardInstanceId`はsanitize後のfieldだけを許し、旧観測の欠落や秘密ゾーン参照は拒否する。
`materializeAiSearchPlayerResources`は検査済みfieldの合成参照へ結び、共通factory用のplayer overrideを返す。
複数個の魂コアを縮約せず、reserve/trash/life/除外/nullも保持する。カード所有者から魂所有者を推測しない。
`ai-search-player-resources.test.ts`は両席の再投影・魂支払い→召喚/維持配置・秘密非干渉を検査する。
総カウントと保護内訳を消費順を保つ新objectへ合成し、欠落・不正値・総量超過を拒否する。
`ai-search-count-resources.test.ts`は実増加→両席再投影→複数保護の部分減少→系統別条件を照合する。

## 公開契約提示

[契約ルール](../../10_rules/08a2_contract.md#提示は任意ユーザー裁定-2026-08-05):
「提示した契約カードの種別は相手に公開される」。手札へ移った後も公開された事実は残る。
公開契約提示はschema v2の両player観測から同じcomponentへ保持する。v1/欠落/不正値は拒否し、
合成時は公開DBの契約定義を照合する。候補・採用・live所在から補完しない。
`ai-search-presented-contract.test.ts`は実提示/辞退→両席再投影→実カードの提示色分岐/最終コア数と
秘密非干渉・旧観測拒否を検査する。e2eは相手root合成→GUI/RESTの実誘発/解決を通す。
CLIの`trace-smoke.test.ts`でも現観測の保存とv1 frame/sampleの読込拒否を照合し、外側containerの版とは区別する。
NNの既存公開提示flagにも届くが、カードの対応表現・body学習・探索接続はI3/I6aの残条件である。

## 公開されたターン内セット使用

player観測の`setUsageThisTurn`はsanitize後の通常バースト/ミラージュセットと免除消費を明示する。
`projectAiSearchSetUsage`→`materializeAiSearchSetUsage`は相対ownerとboolだけを新規盤面へ保持する。
現在のセット枚数・秘密カード・公開履歴の断片から使用済みかを推測しない。既存v2観測への追加項目であり、
項目のない旧snapshot・不正値・免除のみ消費済みの矛盾はこのcomponentの入口で拒否する。
`ai-search-set-usage.test.ts`は両席の実セット→枠除去→再投影→通常再セット拒否、効果セットの対照、
実免除消費・次ターンreset後の支払い/セット完了を照合する。同名e2eは相手rootの仮説手札と
合成資源/使用履歴を開発GUI/RESTへ渡し、空き枠でも再セット不可→実ターン境界でresetを確認する。
セット使用の保持は他の効果usage・slot/CE・完全world・本番ISMCTS/認証の証明ではない。

## 魂状態と境界

公開魂状態は観測のfield参照を同じcomponentから合成playerへ結ぶ。欠落/重複/秘密ゾーン・不整合な物理値は拒否する。
`ai-search-soul-state.test.ts`は両席の実魂状態化→再投影→明示召喚/維持配置と攻撃候補、秘密ID非干渉を検査する。
同名e2eは開発GUI/RESTでmain→attack後の魂状態と攻撃不可を照合し、本番ISMCTS受入とは区別する。
履歴の意味を保った欠落/書換え検知、完全producer、公開済み手札追跡、
裏向き/生成/両面/下敷き、pending/stack/残るeffect usage、公開部分再project、完全requestとroot候補は未実装。
初期配札の実engine→sanitize→観測と部分sampleの非干渉回帰を、探索全体のH1-H3へ拡張しない。
