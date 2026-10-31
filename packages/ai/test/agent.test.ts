import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ChatResponse } from "ollama";
import { runAgent, runAgentStreaming } from "../src/agent";
import type { AgentEvent } from "../src/agent";
import { OllamaClient } from "../src/client";
import { registryOf } from "../src/tools/registry";
import type { AnyToolDef } from "../src/tools/types";

interface FakeChunk {
  content?: string;
  tool_calls?: ChatResponse["message"]["tool_calls"];
}

interface FakeTurn {
  chunks: FakeChunk[];
}

function makeFakeStreamingClient(turns: FakeTurn[]): OllamaClient {
  const client = new OllamaClient();
  let turnIdx = 0;
  (
    client as unknown as {
      chatStream: () => Promise<AsyncIterable<ChatResponse>>;
    }
  ).chatStream = vi.fn(async () => {
    const turn = turns[turnIdx++] ?? { chunks: [{ content: "" }] };
    async function* gen(): AsyncGenerator<ChatResponse> {
      for (const c of turn.chunks) {
        yield {
          model: "fake",
          created_at: new Date(),
          message: {
            role: "assistant",
            content: c.content ?? "",
            ...(c.tool_calls ? { tool_calls: c.tool_calls } : {}),
          },
          done: false,
          done_reason: "",
          total_duration: 0,
          load_duration: 0,
          prompt_eval_count: 0,
          prompt_eval_duration: 0,
          eval_count: 0,
          eval_duration: 0,
        } as ChatResponse;
      }
    }
    return gen();
  });
  return client;
}

const baseInput = {
  skipProjectContext: true,
  skipAutoContext: true,
  skipHooks: true,
};

describe("runAgent (wraps streaming)", () => {
  it("returns plain answer when no tools called", async () => {
    const client = makeFakeStreamingClient([{ chunks: [{ content: "ok" }] }]);
    const result = await runAgent({
      ...baseInput,
      task: "hello",
      client,
      registry: registryOf([]),
    });
    expect(result.output).toBe("ok");
    expect(result.steps).toBe(1);
  });

  it("dispatches a tool call then returns final answer", async () => {
    const echoSchema = z.object({ msg: z.string() });
    const echo = {
      name: "echo",
      description: "echo the message",
      schema: echoSchema,
      jsonSchema: {
        type: "object",
        required: ["msg"],
        properties: { msg: { type: "string" } },
      },
      execute: ({ msg }: { msg: string }) => ({ echoed: msg }),
    };
    const client = makeFakeStreamingClient([
      {
        chunks: [
          {
            tool_calls: [
              { function: { name: "echo", arguments: { msg: "hi" } } },
            ],
          },
        ],
      },
      { chunks: [{ content: "got hi" }] },
    ]);
    const result = await runAgent({
      ...baseInput,
      task: "say hi",
      client,
      registry: registryOf([echo as unknown as AnyToolDef]),
    });
    expect(result.output).toBe("got hi");
    expect(result.steps).toBe(2);
  });

  it("rejects invalid tool arguments without crashing", async () => {
    const doubleSchema = z.object({ count: z.number() });
    const strict = {
      name: "double",
      description: "double the count",
      schema: doubleSchema,
      jsonSchema: {
        type: "object",
        required: ["count"],
        properties: { count: { type: "number" } },
      },
      execute: ({ count }: { count: number }) => count * 2,
    };
    const client = makeFakeStreamingClient([
      {
        chunks: [
          {
            tool_calls: [
              { function: { name: "double", arguments: { count: "abc" } } },
            ],
          },
        ],
      },
      { chunks: [{ content: "recovered" }] },
    ]);
    const result = await runAgent({
      ...baseInput,
      task: "double",
      client,
      registry: registryOf([strict as unknown as AnyToolDef]),
    });
    expect(result.output).toBe("recovered");
  });
});

describe("runAgentStreaming", () => {
  it("yields text deltas in order then returns final result", async () => {
    const client = makeFakeStreamingClient([
      {
        chunks: [{ content: "Hello" }, { content: ", " }, { content: "world" }],
      },
    ]);
    const events: AgentEvent[] = [];
    const gen = runAgentStreaming({
      ...baseInput,
      task: "greet",
      client,
      registry: registryOf([]),
    });
    let next = await gen.next();
    while (!next.done) {
      events.push(next.value);
      next = await gen.next();
    }
    const textDeltas = events
      .filter((e) => e.type === "text")
      .map((e) => (e as { type: "text"; delta: string }).delta);
    expect(textDeltas).toEqual(["Hello", ", ", "world"]);
    expect(next.value.output).toBe("Hello, world");
    expect(next.value.steps).toBe(1);
  });

  it("emits tool_start / tool_result events around tool execution", async () => {
    const addSchema = z.object({ a: z.number(), b: z.number() });
    const add = {
      name: "add",
      description: "add two numbers",
      schema: addSchema,
      jsonSchema: {
        type: "object",
        required: ["a", "b"],
        properties: { a: { type: "number" }, b: { type: "number" } },
      },
      execute: ({ a, b }: { a: number; b: number }) => a + b,
    };
    const client = makeFakeStreamingClient([
      {
        chunks: [
          {
            tool_calls: [
              { function: { name: "add", arguments: { a: 2, b: 3 } } },
            ],
          },
        ],
      },
      { chunks: [{ content: "answer: 5" }] },
    ]);
    const events: AgentEvent[] = [];
    const gen = runAgentStreaming({
      ...baseInput,
      task: "2+3",
      client,
      registry: registryOf([add as unknown as AnyToolDef]),
    });
    let next = await gen.next();
    while (!next.done) {
      events.push(next.value);
      next = await gen.next();
    }
    const types = events.map((e) => e.type);
    expect(types).toContain("tool_start");
    expect(types).toContain("tool_result");
    expect(types).toContain("text");
    const result = events.find((e) => e.type === "tool_result") as {
      type: "tool_result";
      result: unknown;
    };
    expect(result.result).toBe(5);
  });
});
