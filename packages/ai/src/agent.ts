import type { Message, ToolCall } from "ollama";
import { OllamaClient } from "./client.js";
import type { AiConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { getModelProfile } from "./models.js";
import type { ModelRole } from "./models.js";
import { buildDefaultRegistry } from "./tools/registry.js";
import type { ToolRegistry } from "./tools/registry.js";
import {
  formatProjectSystemBlock,
  loadProjectContext,
} from "./context/project.js";
import type { ProjectContext } from "./context/project.js";
import {
  formatMemorySystemBlock,
  loadAllMemory,
  selectRelevantMemories,
} from "./context/memory.js";
import type { MemoryEntry } from "./context/memory.js";
import {
  formatSkillsSystemBlock,
  loadAllSkills,
  selectMatchingSkills,
} from "./context/skills.js";
import type { Skill } from "./context/skills.js";
import { fireHooks, loadHooks } from "./context/hooks.js";
import type { HookResult, HooksSettings } from "./context/hooks.js";

export interface RunAgentInput {
  task: string;
  additionalSystem?: string;
  allowedTools?: string[];
  role?: ModelRole;
  registry?: ToolRegistry;
  client?: OllamaClient;
  configOverride?: Partial<AiConfig>;
  history?: Message[];
  skipProjectContext?: boolean;
  skipAutoContext?: boolean;
  skipHooks?: boolean;
  /**
   * 添付画像 (base64 文字列、データ URL の `data:image/...;base64,` プレフィックスは取り除いてある状態)。
   * 1 件以上ある時はモデルを `vision` ロールへ自動切替し、tool 注入は無効化する。
   */
  images?: string[];
  preloaded?: {
    project?: ProjectContext;
    memory?: MemoryEntry[];
    skills?: Skill[];
    hooks?: HooksSettings;
  };
}

export interface RunAgentResult {
  output: string;
  steps: number;
  history: Message[];
  hookResults: HookResult[];
  selectedSkills: string[];
  selectedMemories: string[];
}

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; callId: string; name: string; arguments: unknown }
  | { type: "tool_result"; callId: string; name: string; result: unknown }
  | { type: "tool_error"; callId: string; name: string; error: string }
  | { type: "step_done"; step: number; hasToolCalls: boolean };

/**
 * 旧 `runAgent` の挙動を維持する非ストリーミング API。
 * 内部で `runAgentStreaming` を消費して最終結果だけ返す。
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const gen = runAgentStreaming(input);
  for (;;) {
    const next = await gen.next();
    if (next.done) return next.value;
  }
}

/**
 * tool-call ループを 1 ターンずつ進めるジェネレータ。
 * 各ターンで client.chatStream() を呼び、テキストデルタとツール実行イベントを yield。
 * 完了時に RunAgentResult を return。
 */
export async function* runAgentStreaming(
  input: RunAgentInput
): AsyncGenerator<AgentEvent, RunAgentResult, void> {
  const config = { ...loadConfig(), ...(input.configOverride ?? {}) };
  const client = input.client ?? new OllamaClient(config);
  const baseRegistry = input.registry ?? buildDefaultRegistry();
  const registry = input.allowedTools
    ? baseRegistry.restrictTo(input.allowedTools)
    : baseRegistry;
  const hasImages = (input.images?.length ?? 0) > 0;
  const effectiveRole: ModelRole = hasImages
    ? "vision"
    : (input.role ?? "flagship");
  const model = getModelProfile(effectiveRole, config);
  // tool 有効化は model 側の supportsTools フラグに従う (vision でも opt-in 可)
  const useTools = model.supportsTools;
  const hookResults: HookResult[] = [];

  const project = input.skipProjectContext
    ? null
    : (input.preloaded?.project ?? (await loadProjectContext()));
  const memory = input.skipAutoContext
    ? []
    : (input.preloaded?.memory ?? (await loadAllMemory()));
  const skills = input.skipAutoContext
    ? []
    : (input.preloaded?.skills ?? (await loadAllSkills()));
  const hooks =
    input.skipHooks || process.env.ORICA_AI_DISABLE_HOOKS === "true"
      ? {}
      : (input.preloaded?.hooks ?? (await loadHooks()));

  const matchedSkills = selectMatchingSkills(skills, input.task);
  const matchedMemories = selectRelevantMemories(memory, input.task);

  const systemBlocks: string[] = [];
  if (project) {
    const block = formatProjectSystemBlock(project);
    if (block) systemBlocks.push(block);
  }
  const memBlock = formatMemorySystemBlock(matchedMemories);
  if (memBlock) systemBlocks.push(memBlock);
  const skillBlock = formatSkillsSystemBlock(matchedSkills);
  if (skillBlock) systemBlocks.push(skillBlock);
  if (input.additionalSystem) systemBlocks.push(input.additionalSystem);
  if (systemBlocks.length === 0) {
    systemBlocks.push(
      "あなたは orica-simulator を支援するエージェントです。日本語で簡潔に応答してください。"
    );
  }
  const systemPrompt = systemBlocks.join("\n\n---\n\n");

  const userMessage: Message = {
    role: "user",
    content: input.task,
    ...(hasImages ? { images: input.images } : {}),
  };
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    ...(input.history ?? []),
    userMessage,
  ];

  hookResults.push(
    ...(await fireHooks(
      hooks,
      "Start",
      project?.repoRoot ? { cwd: project.repoRoot } : {}
    ))
  );

  for (let step = 0; step < config.maxAgentSteps; step++) {
    const stream = await client.chatStream({
      model: model.tag,
      messages,
      numCtx: model.contextWindow,
      ...(useTools ? { tools: registry.asOllamaTools() } : {}),
    });

    let accumulatedContent = "";
    let lastToolCalls: ToolCall[] = [];
    for await (const part of stream) {
      const content = part.message?.content ?? "";
      if (content) {
        accumulatedContent += content;
        yield { type: "text", delta: content };
      }
      const tc = part.message?.tool_calls;
      if (tc && tc.length > 0) {
        lastToolCalls = tc;
      }
    }

    const assistantMessage: Message = {
      role: "assistant",
      content: accumulatedContent,
      ...(lastToolCalls.length > 0 ? { tool_calls: lastToolCalls } : {}),
    };
    messages.push(assistantMessage);

    yield {
      type: "step_done",
      step: step + 1,
      hasToolCalls: lastToolCalls.length > 0,
    };

    if (lastToolCalls.length === 0) {
      hookResults.push(
        ...(await fireHooks(
          hooks,
          "Stop",
          project?.repoRoot ? { cwd: project.repoRoot } : {}
        ))
      );
      return {
        output: accumulatedContent,
        steps: step + 1,
        history: messages,
        hookResults,
        selectedSkills: matchedSkills.map((s) => s.name),
        selectedMemories: matchedMemories.map((m) => m.name),
      };
    }

    for (let i = 0; i < lastToolCalls.length; i++) {
      const call = lastToolCalls[i]!;
      const callId = `step${step + 1}-call${i + 1}`;
      const tool = registry.get(call.function.name);
      if (!tool) {
        messages.push({
          role: "tool",
          content: JSON.stringify({
            error: `unknown tool ${call.function.name}`,
          }),
        });
        yield {
          type: "tool_error",
          callId,
          name: call.function.name,
          error: "unknown tool",
        };
        continue;
      }
      let parsed: unknown;
      try {
        parsed = tool.schema.parse(call.function.arguments);
      } catch (err) {
        const errMsg = `invalid arguments: ${(err as Error).message}`;
        messages.push({
          role: "tool",
          content: JSON.stringify({ error: errMsg }),
        });
        yield {
          type: "tool_error",
          callId,
          name: call.function.name,
          error: errMsg,
        };
        continue;
      }
      yield {
        type: "tool_start",
        callId,
        name: call.function.name,
        arguments: call.function.arguments,
      };
      hookResults.push(
        ...(await fireHooks(hooks, "PreToolUse", {
          toolName: call.function.name,
          toolInput: parsed,
          ...(project?.repoRoot !== undefined ? { cwd: project.repoRoot } : {}),
        }))
      );
      try {
        const result = await tool.execute(parsed);
        messages.push({ role: "tool", content: safeStringify(result) });
        yield { type: "tool_result", callId, name: call.function.name, result };
      } catch (err) {
        const errMsg = `execution failed: ${(err as Error).message}`;
        messages.push({
          role: "tool",
          content: JSON.stringify({ error: errMsg }),
        });
        yield {
          type: "tool_error",
          callId,
          name: call.function.name,
          error: errMsg,
        };
      }
      hookResults.push(
        ...(await fireHooks(hooks, "PostToolUse", {
          toolName: call.function.name,
          toolInput: parsed,
          ...(project?.repoRoot !== undefined ? { cwd: project.repoRoot } : {}),
        }))
      );
    }
  }

  hookResults.push(
    ...(await fireHooks(
      hooks,
      "Stop",
      project?.repoRoot ? { cwd: project.repoRoot } : {}
    ))
  );
  return {
    output: `[max steps ${config.maxAgentSteps} reached without final answer]`,
    steps: config.maxAgentSteps,
    history: messages,
    hookResults,
    selectedSkills: matchedSkills.map((s) => s.name),
    selectedMemories: matchedMemories.map((m) => m.name),
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "unserializable result" });
  }
}
