#!/usr/bin/env node
/**
 * needs-dsl-rank — needs-dsl キュー（open）を機構別クラスタに集計し「解消枚数」降順で
 * ランクする。engine-drain ループの 1 イテレーション = 1 プリミティブなので、
 * 「そのプリミティブを実装すると何枚のカードが unblock されるか」が高いものから着手すると
 * 時間当たりスループット（net/h）が上がる。lumpy なスループットを意図的に活用する。
 *
 * tmp-cluster-dsl.mjs（temp 入力前提）を正式化したもの。実キュー
 * autorun-queue/needs-dsl*.jsonl の status:"open" 行を直接読む。
 *
 * Usage:
 *   node scripts/needs-dsl-rank.mjs          # ランク表 + 推奨次クラスタ
 *   node scripts/needs-dsl-rank.mjs --json   # JSON 出力
 *   node scripts/needs-dsl-rank.mjs --cluster grant_effect  # クラスタ内のカードを列挙
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");
const QUEUE_DIR = join(ROOT, "autorun-queue");

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const CLUSTER_FILTER = (() => {
  const i = args.indexOf("--cluster");
  return i >= 0 ? args[i + 1] : null;
})();

// 機構キーワード（gap 文面に対する正規表現）。1 カードは複数クラスタに属しうる
// （gap が複合的なため）。クラスタ count = そのプリミティブで前進しうるカード数の上限。
const CLUSTERS = [
  [
    "negate/無効/発揮できない",
    /無効|発揮でき(ない|る)|negate|発揮されない|抑止|させない/,
  ],
  [
    "grant_effect/効果付与",
    /付与|grant_effect|入れ子の誘発|効果そのもの.*付与/,
  ],
  [
    "対象開示/redirect/割込",
    /対象になっ?たとき|対象になるとき|redirect|対象開示|対象.*割り?込/,
  ],
  ["クォーツ/quartz", /クォーツ|quartz|魂状態.*セット/],
  ["創界石/転醒/解封/逆転醒", /創界石|転醒|解封|解放|逆転/],
  ["煌臨/契約/advent", /煌臨|advent|契約/],
  [
    "動的コスト/召喚条件",
    /動的コスト|コスト固定|コストにな(り|る)|召喚条件|使用できる|トラッシュから.*使用/,
  ],
  ["バースト条件ゲート", /バースト/],
  ["カウント関連", /カウント|count/],
  ["コア移動/配置(特殊)", /コア配置|コア移動|ライフ.*コア|ソウルコア/],
  [
    "スタックtiming源抑止",
    /スタックタイミング元|stack timing|タイミング元にならない/,
  ],
  ["ミラージュ", /ミラージュ|mirage/],
  ["待機/疲労", /待機状態|疲労|重疲労/],
  ["離脱置換/効果耐性", /離脱.*置換|effect_resistance|離れるとき|戻すことで/],
];

function unresolvedGapText(gap) {
  const text = String(gap ?? "");
  const match = text.match(/残(?:ギャップ)?[:：]\s*([\s\S]*)$/);
  return match ? match[1] : text;
}

function loadOpen() {
  if (!existsSync(QUEUE_DIR)) return [];
  const rows = [];
  for (const f of readdirSync(QUEUE_DIR).filter((f) =>
    /^needs-dsl.*\.jsonl$/.test(f)
  )) {
    for (const line of readFileSync(join(QUEUE_DIR, f), "utf8").split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try {
        const o = JSON.parse(s);
        if (o.status === "open") rows.push(o);
      } catch {
        /* skip */
      }
    }
  }
  return rows;
}

function clusterOf(gap) {
  const hits = [];
  for (const [name, pat] of CLUSTERS) if (pat.test(gap)) hits.push(name);
  return hits;
}

function main() {
  const rows = loadOpen();
  const byCluster = new Map(); // name -> [{cardNo,name,set}]
  const bySet = new Map();
  const unmatched = [];

  for (const r of rows) {
    const gap = unresolvedGapText(r.gap);
    bySet.set(r.set, (bySet.get(r.set) || 0) + 1);
    const hits = clusterOf(gap);
    if (hits.length === 0) {
      unmatched.push({ cardNo: r.cardNo, name: r.name, set: r.set });
      continue;
    }
    for (const h of hits) {
      if (!byCluster.has(h)) byCluster.set(h, []);
      byCluster.get(h).push({ cardNo: r.cardNo, name: r.name, set: r.set });
    }
  }

  const ranked = [...byCluster.entries()]
    .map(([cluster, cards]) => ({ cluster, count: cards.length, cards }))
    .sort((a, b) => b.count - a.count);

  if (CLUSTER_FILTER) {
    const hit = ranked.find((r) => r.cluster.includes(CLUSTER_FILTER));
    if (!hit) {
      console.error(`クラスタ "${CLUSTER_FILTER}" は該当なし。`);
      process.exit(1);
    }
    console.log(`\n[${hit.cluster}] ${hit.count} 枚:`);
    for (const c of hit.cards)
      console.log(`  ${c.cardNo.padEnd(18)} ${c.name}`);
    return;
  }

  if (JSON_OUT) {
    process.stdout.write(
      JSON.stringify(
        { totalOpen: rows.length, ranked, unmatched, bySet: [...bySet] },
        null,
        2
      ) + "\n"
    );
    return;
  }

  console.log(
    `\n=== needs-dsl open クラスタランク（open ${rows.length} 件）===`
  );
  console.log("枚数  クラスタ（実装で unblock されうるカード数の上限）");
  for (const r of ranked)
    console.log(`${String(r.count).padStart(4)}  ${r.cluster}`);
  if (unmatched.length)
    console.log(
      `${String(unmatched.length).padStart(4)}  (未分類 — クラスタ語彙の追加候補)`
    );

  console.log("\n=== 弾別 open 件数 ===");
  for (const [set, n] of [...bySet].sort((a, b) => b[1] - a[1]))
    console.log(`${String(n).padStart(4)}  ${set}`);

  if (ranked.length) {
    console.log(
      `\n推奨次クラスタ: 「${ranked[0].cluster}」(${ranked[0].count} 枚)` +
        ` → 詳細: node scripts/needs-dsl-rank.mjs --cluster <語>`
    );
    console.log(
      "注: 枚数は上限値。実装コストと 10_rules 確定性を勘案し、枚数/コスト比で選ぶ（runbook 手順2）。"
    );
  }
}

main();
