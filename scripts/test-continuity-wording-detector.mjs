#!/usr/bin/env node
/**
 * continuity-wording-detector.mjs の単体テスト。pure 関数のため card-data ビルドや
 * engine 状態に依存しない。`node scripts/test-continuity-wording-detector.mjs` で実行。
 *
 * 期待: 「Xを満たしている間、フィールドに置き/置ける」型イディオムを検出すること、
 * かつ通常の誘発見出し(『〜時』)や無関係な配置効果テキストを false positive にしない
 * こと。全カードコーパス照合(2026-07-18)では BSLH01-T07..T17 の 11 件のみヒットし
 * false positive 0 件を確認済み(cards-fidelity-audit.mjs 実行ログ参照)。
 */
import { hasContinuityPlacementWording } from "./continuity-wording-detector.mjs";

let pass = 0;
let fail = 0;
function check(label, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${label}`);
  }
}

// 1. 実カード(BSLH01-T07)のイディオムを検出する
check(
  "detects BSLH01-T07 idiom",
  hasContinuityPlacementWording(
    "【アーツ：(自分の魂状態の「オーブメント」の属性値が以下を満たしている間、フィールドに置き、フィールドにある間、〔ターンに1回:同名〕アタックステップに使用できる）】"
  ) === true
);

// 2. 通常の誘発見出し(『〜時』)は false positive にならない
check(
  "does not flag triggered header text",
  hasContinuityPlacementWording(
    "Lv1-Lv2『このスピリットの召喚時』デッキ2ドロー後、手札2枚を破棄。"
  ) === false
);

// 3. 「満たしている間」を含まない配置効果は false positive にならない
check(
  "does not flag unrelated placement text",
  hasContinuityPlacementWording(
    "このカードをフィールドに置ける。その後、コアを1個置く。"
  ) === false
);

// 4. 空文字/undefined は false
check("empty string is false", hasContinuityPlacementWording("") === false);
check("undefined is false", hasContinuityPlacementWording(undefined) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
