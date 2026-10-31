# 複合タイミング見出しのトリガー句 (2026-10-15)

- 対象: Telegram 629905097 / `followup-da37f93118e0ba60a4f2`。原本はprimaryの `logs/codex-telegram-inbox/reception-results/629905097.json`、添付は `.codex-remote-attachments/telegram/629905097.json`。添付ログはデッド・プルーフ解決後にてゐの `deck_reveal` が発生し、対象は後の支払いで消滅していた。後のトラッシュ在籍を破壊成功の根拠にしない。
- 正源: [スタック基本ルール](../10_rules/02_turn-flow-and-timing.md#基本ルール)の「スタック効果は応答元とは独立した効果であり、応答元による誘発効果ではない。後から宣言した順に」。今回はてゐの召喚時発揮宣言への応答なので、デッド・プルーフの無効化と破壊を先に解決する。
- 原因: `deriveTriggerPhrasesFromTextRefs()` が複合見出し3種類を個別列挙し、`召喚/アタック時` から `召喚時` が欠落した。既存のラベル生成と同じ共有接尾辞判定 `hasPrintedTiming()` へ統一した。半角/全角スラッシュ、3項、逆順も同じ判定を使い、カード例外や対象フィルター変更は加えない。
- 変更前の失敗: `logs/telegram-dead-proof-red.log`。実カードの通常召喚・維持コア配置・発揮宣言・マジック応答・パスを通し、両プレイヤーで `effect:negate:pending-stack:effect:<target stack>` の欠落を再現した。
- 回帰: `dead-proof-compound-timing.test.ts` は同ログ、デッキ4枚のID/所在/枚数保持、公開pendingなし、破壊ログ1件、両カードのトラッシュ移動、終端キュー/窓、turn suppression不在を検査する。実アタック時の本文識別・デッキ公開も確認し、召喚限定フィルターには一致しないことを検査する。
- 見出し回帰: `effect-label-utils.test.ts` は単独、既存の複合、召喚/アタック、3項、逆順を半角/全角の両方で検査。heading/本文参照/重複、対象種別スラッシュ、空行境界も含む。
- GUI/REST: `?scenario=dead-proof-compound-timing&manualOpponent=1`、`owner=bob`で反転。専用e2eはAlice GUIの召喚・宣言とBob RESTの応答、Bob RESTの召喚・宣言とAlice GUIの応答を実エンジンへ接続する。
- Active Board・issues更新なし。依頼は親runnerによるmain統合・公開確認までpendingを保持する。配備確認・ISMCTS運用移行の達成とは扱わない。
