#!/usr/bin/env node
import { runAgent } from "../agent.js";

async function main(): Promise<void> {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error("usage: orica-ai-rule-qa <質問>");
    process.exit(2);
  }
  // `rule-qa` skill が trigger 語マッチで自動発火する。
  // 直接質問するより、明示的にルール領域だと宣言する形でタスクを渡す。
  const result = await runAgent({
    task: `次のルール / 裁定の質問に答えてください: ${question}`,
    role: "flagship",
  });
  console.warn(result.output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
