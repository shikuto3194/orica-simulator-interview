import { Ollama } from "ollama";
import type { ChatRequest, ChatResponse, Message, Tool } from "ollama";
import type { AiConfig } from "./config.js";
import { loadConfig } from "./config.js";

export interface ChatOptions {
  model: string;
  messages: Message[];
  tools?: Tool[];
  format?: "json";
  temperature?: number;
  topP?: number;
  numCtx?: number;
  stream?: false;
}

export interface EmbedOptions {
  model: string;
  input: string | string[];
}

export class OllamaClient {
  readonly config: AiConfig;
  private readonly inner: Ollama;

  constructor(config?: Partial<AiConfig>) {
    this.config = { ...loadConfig(), ...(config ?? {}) };
    this.inner = new Ollama({ host: this.config.baseUrl });
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const request: ChatRequest & { stream: false } = {
      model: options.model,
      messages: options.messages,
      stream: false,
      options: {
        ...(options.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
        ...(options.topP !== undefined ? { top_p: options.topP } : {}),
        ...(options.numCtx !== undefined ? { num_ctx: options.numCtx } : {}),
      },
      ...(options.tools !== undefined ? { tools: options.tools } : {}),
      ...(options.format !== undefined ? { format: options.format } : {}),
    };
    return this.inner.chat(request);
  }

  async chatStream(options: ChatOptions): Promise<AsyncIterable<ChatResponse>> {
    const request: ChatRequest & { stream: true } = {
      model: options.model,
      messages: options.messages,
      stream: true,
      options: {
        ...(options.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
        ...(options.topP !== undefined ? { top_p: options.topP } : {}),
        ...(options.numCtx !== undefined ? { num_ctx: options.numCtx } : {}),
      },
      ...(options.tools !== undefined ? { tools: options.tools } : {}),
      ...(options.format !== undefined ? { format: options.format } : {}),
    };
    return this.inner.chat(request);
  }

  async embed(options: EmbedOptions): Promise<number[][]> {
    const result = await this.inner.embed({
      model: options.model,
      input: options.input,
    });
    return result.embeddings;
  }

  async listModels(): Promise<string[]> {
    const result = await this.inner.list();
    return result.models.map((m) => m.name);
  }

  /**
   * モデルの capabilities を返す (例: ["completion", "vision", "tools"])。
   * モデルが pull されていない / Ollama が capability を返さない時は空配列。
   */
  async showModelCapabilities(model: string): Promise<string[]> {
    try {
      const res = (await this.inner.show({ model })) as {
        capabilities?: string[];
      };
      return Array.isArray(res.capabilities) ? res.capabilities : [];
    } catch {
      return [];
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch {
      return false;
    }
  }
}
