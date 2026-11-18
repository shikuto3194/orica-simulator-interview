#!/usr/bin/env node
import { runAgent } from "../agent.js";
import {
  findCommand,
  loadAllCommands,
  renderCommandPrompt,
} from "../context/commands.js";
import { recordAgentRun } from "../telemetry.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error(
      "usage: orica-ai-run <task>            (一発タスク実行)\n       orica-ai-run /<command> <args>  (slash command 起動)"
    );
    process.exit(2);
  }
  const head = argv[0] ?? "";
  if (head.startsWith("/")) {
    const commands = await loadAllCommands();
    const cmd = findCommand(commands, head);
    if (!cmd) {
      console.error(
        `unknown command: ${head}. available: ${commands.map((c) => "/" + c.name).join(", ") || "(none)"}`
      );
      process.exit(3);
    }
    const args = argv.slice(1).join(" ");
    const additionalSystem = renderCommandPrompt(cmd, args);
    const taskText =
      args ||
      `${cmd.name} コマンドを実行してください (引数省略時のデフォルト挙動)`;
    const result = await runAgent({
      task: taskText,
      additionalSystem,
      ...(cmd.allowedTools.length > 0
        ? { allowedTools: cmd.allowedTools }
        : {}),
    });
    await recordAgentRun({
      task: taskText,
      steps: result.steps,
      selectedSkills: result.selectedSkills,
      selectedMemories: result.selectedMemories,
      resolvedCommand: cmd.name,
    });
    printResult(result);
    return;
  }
  const task = argv.join(" ");
  const result = await runAgent({ task });
  await recordAgentRun({
    task,
    steps: result.steps,
    selectedSkills: result.selectedSkills,
    selectedMemories: result.selectedMemories,
  });
  printResult(result);
}

function printResult(result: {
  output: string;
  selectedSkills: string[];
  selectedMemories: string[];
  steps: number;
}): void {
  if (result.selectedSkills.length > 0) {
    console.warn(`[skills] ${result.selectedSkills.join(", ")}`);
  }
  if (result.selectedMemories.length > 0) {
    console.warn(`[memory] ${result.selectedMemories.join(", ")}`);
  }
  console.warn(`[steps] ${result.steps}`);
  console.warn("---");
  console.warn(result.output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
