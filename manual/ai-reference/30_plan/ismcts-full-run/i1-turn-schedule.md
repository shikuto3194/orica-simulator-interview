# I1 公開の時計・ステップ列・ターン予約

観測から新規盤面へ渡す部分component。完全worldや本番探索の受入とは区別する。
ルール正源は [追加ステップ・追加ターン](../../10_rules/02d_extra-steps-and-turns.md)。

`projectAiSearchTurnClock`→`materializeAiSearchTurnClock`は公開席順・active側・turn番号/発行済み番号・
step通番を合成IDへ保持する。旧観測の欠落・不正値・activeの不一致は拒否し、席順をplayers配列から推測しない。
実先攻選択と実追加ターンからの復帰を両席で反証し、次のコア・ドローまで照合する。
`projectAiSearchTurnPosition`→`materializeAiSearchTurnPosition`は同じ時計と観測のstep/windowを明示コピーする。
既存Step順・NNのwindow domainで値を検査し、欠落/未知値をfactory既定のstart/noneへ置換しない。
両席の実core/draw/refresh後→観測→新規player/カード/位置合成→次stepを照合し、コア/ドロー/回復の再実行を防ぐ。
同じ経路を開発GUI/RESTでも検査する。pending/stack/battle/contextは未再構成で、完全world受入ではない。
`projectAiSearchStepProgression`→`materializeAiSearchStepProgression`は観測の追加step予約と復帰列を新配列へ保持する。
順序・重複する復帰先を保ち、欠落/未知stepは拒否する。両席の実予約→追加attack→入れ子draw/refresh→
元core/draw/refresh/main→通常attack/endを再投影・資源数・開発GUI/RESTで照合する。
`projectAiSearchTurnSchedule`→`materializeAiSearchTurnSchedule`は公開の追加ターン予約、
実行中の禁止step/本来の次席、次ターンskipを相対席から新規合成する。旧観測の欠落・不正席/stepは拒否する。
中断復帰snapshotは運ばず、有無と遅延開始のflagを観測し、未対応の復帰/遅延開始は合成前に拒否する。
両席の予約→実行者が変わる連鎖追加→禁止step挿入の拒否→本来の次席/skip→自然deck-outを反証する。
開発GUI/RESTでも予約前/実行中から通常ターンのcore/drawまで照合する。窓context・returnContext・完全world/本番ISMCTSは未達。

## 検証経路と残条件

- unit: `ai-search-turn-clock.test.ts`、`ai-search-turn-position.test.ts`、`ai-search-turn-schedule.test.ts`。
- GUI/REST: `e2e/ai-search-turn-clock.spec.ts`。合成盤面の新規IDを表示用の席へ結び、
  Alice GUI/Bob RESTで予約前・実行中から追加ターン終了と通常core/draw、HUD・物理枚数を検査する。
- 中断復帰のsnapshot・遅延開始・窓payload・usage等の完全合成とworld再projectは残る。
  部分fixtureの自然deck-outを本番ISMCTS・一般の対戦完走やH1-H3へ拡張しない。

探索部品は旧観測の欠落を拒否し、既定の空予約へ置換しない。並び・重複と新規配列を保持する。
公開の次席が未設定の旧stateは明示nullとして観測し、合成時も次席を推測しない。
schedule回帰は山札順・秘密IDを変えた同seedの部分worldを比較する。既存clock/position回帰の
秘密素性変更はcomponentの一致だけを検査する。非空の秘密手札/異なる秘密素性を含むworld比較と、
request・root候補・tree統計・応答の一致は未達であり、本番経路で別途検証する。
