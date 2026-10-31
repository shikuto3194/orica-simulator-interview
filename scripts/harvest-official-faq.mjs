#!/usr/bin/env node
/**
 * harvest-official-faq — battlespirits.com 公式 FAQ (エターナル版) の全件収集。
 *
 * 公式 FAQ は `list.php?prodname=<code>&format=eternal` で製品別に取得できる。
 * **`&format=eternal` が無いと全0件を返す**（重要）。HTML の faqListColList ブロックを
 * 決定論的にパースし、原文ママの Q&A を `external-qa-official/<code>.md` に書き出す。
 * WebFetch の要約は取りこぼし/作話が出るため使わない（生 HTML を curl + parse）。
 *
 * Usage:
 *   node scripts/harvest-official-faq.mjs            # 全製品収集
 *   node scripts/harvest-official-faq.mjs BS68 BSC47 # 指定製品のみ
 *
 * 出力: external-qa-official/<code>.md（gitignore）+ _manifest.md（製品別件数）。
 */

import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "external-qa-official");
mkdirSync(OUT, { recursive: true });

function codes() {
  const list = [];
  const pad2 = (n) => String(n).padStart(2, "0");
  for (let i = 1; i <= 76; i++) list.push(`BS${pad2(i)}`);
  for (let i = 1; i <= 51; i++) list.push(`BSC${pad2(i)}`);
  for (let i = 1; i <= 34; i++) list.push(`CB${pad2(i)}`);
  list.push("CBX01");
  for (let i = 1; i <= 70; i++) list.push(`SD${pad2(i)}`);
  for (let i = 1; i <= 6; i++) list.push(`26RSD${pad2(i)}`);
  list.push("26RBS01");
  for (let i = 1; i <= 12; i++) list.push(`PC${pad2(i)}`);
  for (let i = 1; i <= 48; i++) list.push(`PB${pad2(i)}`);
  list.push("EX");
  list.push("プロモーションカード");
  return list;
}

const stripTags = (html) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .trim();

const pick = (block, cls) => {
  const m = new RegExp(
    `<[^>]*class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)</`,
    "i"
  ).exec(block);
  return m ? stripTags(m[1]) : "";
};

function fetchUrl(url) {
  // -s 静音, -L リダイレクト追従, --max-time 30
  return execSync(`curl -s -L --max-time 30 "${url}"`, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function fetchHtml(code) {
  return fetchUrl(
    `https://www.battlespirits.com/faq/list.php?prodname=${encodeURIComponent(code)}&format=eternal`
  );
}

// フリーワード検索（汎用ルール Q&A はこれでないと拾えない。例: 分身/星霊衣）。
function fetchFreeword(word) {
  return fetchUrl(
    `https://www.battlespirits.com/faq/list.php?freeword=${encodeURIComponent(word)}&format=eternal`
  );
}

function parse(html) {
  const blocks = html.split('<li class="faqListColList');
  const items = [];
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    // Q番号は faqListColNum 直後・date span の前。生HTMLから抽出（stripTags すると年と連結する）。
    const qnum = (/faqListColNum"[^>]*>\s*(Q\d+)/.exec(b) || ["", ""])[1];
    const date = (/(\d{4}\.\d{2}\.\d{2})/.exec(b) || ["", ""])[1];
    const card = pick(b, "faqListColTit");
    const question = pick(b, "faqListColTerm");
    const answer = pick(b, "faqResultText");
    if (!question && !answer) continue;
    items.push({ qnum, date, card, question, answer });
  }
  return items;
}

function toMarkdown(code, items) {
  const lines = [
    `# ${code} 公式FAQ（エターナル版）`,
    "",
    `出典: https://www.battlespirits.com/faq/list.php?prodname=${code}&format=eternal`,
    `件数: ${items.length}`,
    "",
  ];
  for (const it of items) {
    lines.push(`## ${it.qnum}${it.date ? ` (${it.date})` : ""}`);
    if (it.card) lines.push(`- 対象: ${it.card}`);
    lines.push(`- Q: ${it.question}`);
    lines.push(`- A: ${it.answer.replace(/\n/g, "\n     ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);

  // フリーワード収集モード: node ... --freeword 分身 星霊衣 ...
  const fwIdx = argv.indexOf("--freeword");
  if (fwIdx >= 0) {
    const words = argv.slice(fwIdx + 1);
    for (const w of words) {
      let items;
      try {
        items = parse(fetchFreeword(w));
      } catch (e) {
        console.error(`[freeword:${w}] 失敗: ${e.message}`);
        continue;
      }
      // 日本語語を保持（Windows 禁止文字のみ置換）。`_freeword-` プレフィックスで識別。
      const safe = "_freeword-" + w.replace(/[\\/:*?"<>|]/g, "_");
      writeFileSync(
        join(OUT, `${safe}.md`),
        toMarkdown(`freeword:${w}`, items)
      );
      console.log(`[freeword:${w}] ${items.length}件 → ${safe}.md`);
    }
    return;
  }

  const targets = argv;
  const all = targets.length ? targets : codes();
  const manifest = [];
  let total = 0;
  for (const code of all) {
    let items;
    try {
      items = parse(fetchHtml(code));
    } catch (e) {
      console.error(`[${code}] fetch/parse 失敗: ${e.message}`);
      continue;
    }
    if (items.length === 0) {
      console.log(`[${code}] 0件 skip`);
      continue;
    }
    const safe = code.replace(/[^\w.-]/g, "_");
    writeFileSync(join(OUT, `${safe}.md`), toMarkdown(code, items));
    manifest.push({ code, count: items.length });
    total += items.length;
    console.log(`[${code}] ${items.length}件 → ${safe}.md`);
  }
  manifest.sort((a, b) => b.count - a.count);
  const man = [
    "# 公式FAQ 収集マニフェスト（エターナル版）",
    "",
    `収集日時はファイル mtime 参照。総製品(Q&Aあり): ${manifest.length} / 総Q&A: ${total}`,
    "",
    "| 製品 | 件数 |",
    "|---|---:|",
    ...manifest.map((m) => `| ${m.code} | ${m.count} |`),
    "",
  ].join("\n");
  writeFileSync(join(OUT, "_manifest.md"), man);
  console.log(`\n総製品(Q&Aあり): ${manifest.length} / 総Q&A: ${total}`);
  console.log(`manifest: external-qa-official/_manifest.md`);
}

main();
