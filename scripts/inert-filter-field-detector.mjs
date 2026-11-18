/**
 * card-data の「書かれているが評価されないフィルタフィールド」検出。
 *
 * 背景 (2026-08-03, P3-134): `CardFilter.grandwalkerKind` は
 * `card-filter.ts:321` の `admitsAsGrandwalkerOnlyTarget` からしか評価されず、
 * その関数は冒頭で
 *
 *     if (filter.targetsGrandwalker !== "only") return true;
 *
 * と短絡する。したがって `targetsGrandwalker` が `"only"` 以外のとき
 * `grandwalkerKind` は**完全に不活性**。にもかかわらず card-data には
 * 「創界神ネクサスに限定したつもり」で書かれた箇所があり、読む人は絞り込みが
 * 効いていると誤解する。P3-134 の全数監査でも 3 箇所が dead field として除去されたが、
 * `choice[0].action.from.filter` のような深いネストで 1 箇所取りこぼしていた。
 *
 * **検出は読解を要さない**（「この組み合わせでは評価経路に到達しない」という engine 側の
 * 事実だけで決まる）が、**対処には印字テキストの読解が要る**。
 *
 * ## 対処は「削除」ではない（2026-08-03 訂正）
 *
 * 不活性フィールドは多くの場合 **`"only"` と書くべきところを `true` と書いた痕跡**である。
 * `true` は「通常スピリット/ネクサスに**加えて**創界神/導界者も含める」、
 * `"only"` は「創界神/導界者**のみ**（通常を除外）」で意味が違う（dsl-types.ts:697-709）。
 * 種別絞り込み `grandwalkerKind` は排他パス (`admitsAsGrandwalkerOnlyTarget`) の中にしか
 * ないため、`true` の下では必ず不活性になる。
 *
 * したがって **不活性フィールドを消すと、書き間違いの証拠だけが消えて乖離が残る**。
 * 実例 (BSTH11-X03): 印字「自分の創界神ネクサスの「隠岐奈」のコア-4する」に対し
 * `targetsGrandwalker: true` + `grandwalkerKind: "grandwalker"` と書かれていた。
 * 当初これを「dead field だから削除」と処理したが、正しい対処は
 * `targetsGrandwalker: "only"` への修正だった（`true` は通常ネクサスも許容し印字と乖離する）。
 *
 * **対処手順**: 印字テキストを読み、(1) 通常スピリット/ネクサスも対象なら `true` のまま
 * `grandwalkerKind` を削除、(2) 創界神/導界者限定なら `"only"` へ修正。判断せずに
 * フィールドだけ消さない。
 *
 * warn 扱いにする理由: 不活性フィールド自体は**現時点の挙動を誤らせていない**。
 * ただし上記のとおり周辺に印字乖離が潜んでいる可能性があるので、警告は無視せず
 * 必ず印字と突き合わせる。
 *
 * このモジュールは pure 関数のみ。
 */

/**
 * 不活性判定ルール。
 * - `field`: 対象フィールド名
 * - `activeWhen(node)`: そのフィールドが評価される条件
 * - `reason`: なぜ不活性かの説明（warn 本文に出す）
 */
export const INERT_FIELD_RULES = [
  {
    field: "grandwalkerKind",
    activeWhen: (node) => node.targetsGrandwalker === "only",
    reason:
      'CardFilter.grandwalkerKind は admitsAsGrandwalkerOnlyTarget (card-filter.ts:321) からのみ評価され、同関数は targetsGrandwalker !== "only" で短絡する',
  },
];

/**
 * `grandwalkerKind` を持つが `targetsGrandwalker` 自体を持たないノードは
 * `ConditionClause` 側（structured-condition-eval.ts / legal-actions-shared.ts で
 * 無条件評価される）なので対象外。CardFilter かどうかは `targetsGrandwalker` の
 * **存在**で判別する。
 */
function isCardFilterLike(node, field) {
  if (field !== "grandwalkerKind") return true;
  return Object.prototype.hasOwnProperty.call(node, "targetsGrandwalker");
}

/**
 * effects ツリーを走査し、不活性フィールドを持つノードを列挙する。
 * @returns {{path: string, field: string, reason: string, detail: string}[]}
 */
export function findInertFilterFields(effects, basePath = "effects") {
  const out = [];
  const visit = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((n, i) => visit(n, `${path}[${i}]`));
      return;
    }
    for (const rule of INERT_FIELD_RULES) {
      const value = node[rule.field];
      if (value === undefined || value === "any") continue;
      if (!isCardFilterLike(node, rule.field)) continue;
      if (rule.activeWhen(node)) continue;
      out.push({
        path,
        field: rule.field,
        reason: rule.reason,
        detail:
          `${path} の ${rule.field}:${JSON.stringify(value)} は評価されない ` +
          `(targetsGrandwalker:${JSON.stringify(node.targetsGrandwalker)})。${rule.reason}。` +
          `**フィールドを消して終わりにしない**: 多くは "only" と書くべきところを true と書いた痕跡で、` +
          `true は通常スピリット/ネクサスも許容するため印字と乖離しうる。印字を読み、` +
          `創界神/導界者限定なら targetsGrandwalker:"only" へ修正すること`,
      });
    }
    for (const [k, v] of Object.entries(node)) visit(v, `${path}.${k}`);
  };
  visit(effects ?? [], basePath);
  return out;
}
