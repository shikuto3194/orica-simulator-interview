#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { runAgent } from "../agent.js";
import type { Message } from "ollama";

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const history: Message[] = [];
  console.warn("orica-ai-chat — 'exit' で終了");
  while (true) {
    const line = (await rl.question("you> ")).trim();
    if (!line) continue;
    if (line === "exit") break;
    const result = await runAgent({ task: line, history });
    console.warn(`ai> ${result.output}`);
    history.push({ role: "user", content: line });
    history.push({ role: "assistant", content: result.output });
  }
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
