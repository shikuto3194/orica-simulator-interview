export { OllamaClient } from "./client.js";
export type { ChatOptions, EmbedOptions } from "./client.js";
export { loadConfig } from "./config.js";
export type { AiConfig } from "./config.js";
export { getModelProfile } from "./models.js";
export type { ModelProfile, ModelRole } from "./models.js";
export { runAgent, runAgentStreaming } from "./agent.js";
export type { RunAgentInput, RunAgentResult, AgentEvent } from "./agent.js";
export {
  buildDefaultRegistry,
  registryOf,
  DEFAULT_WEB_HOST_ALLOWLIST,
} from "./tools/registry.js";
export type { ToolRegistry, BuildRegistryOptions } from "./tools/registry.js";
export type { ToolDef, AnyToolDef } from "./tools/types.js";
export { toOllamaTool } from "./tools/types.js";
export { makeWebFetchTool, stripHtml } from "./tools/web-fetch.js";
export type { WebFetchOptions, WebFetchResult } from "./tools/web-fetch.js";
export {
  makeWebSearchTool,
  parseDuckDuckGoHtml,
  analyzeDuckDuckGoHtml,
} from "./tools/web-search.js";
export type {
  WebSearchOptions,
  WebSearchResult,
  WebSearchResultItem,
  SearchBackend,
  DuckDuckGoSignal,
  DuckDuckGoAnalysis,
} from "./tools/web-search.js";

// Context
export {
  loadProjectContext,
  formatProjectSystemBlock,
  defaultRepoRoot,
} from "./context/project.js";
export type { ProjectContext } from "./context/project.js";
export {
  loadAllMemory,
  selectRelevantMemories,
  formatMemorySystemBlock,
  parseFrontmatter,
} from "./context/memory.js";
export type { MemoryEntry, MemoryType } from "./context/memory.js";
export {
  loadAllSkills,
  selectMatchingSkills,
  formatSkillsSystemBlock,
} from "./context/skills.js";
export type { Skill } from "./context/skills.js";
export {
  loadAllCommands,
  findCommand,
  renderCommandPrompt,
} from "./context/commands.js";
export type { SlashCommand } from "./context/commands.js";
export { loadHooks, fireHooks } from "./context/hooks.js";
export type {
  HookEvent,
  HookConfig,
  HooksSettings,
  HookResult,
} from "./context/hooks.js";

// Server (browser GUI)
export { startGuiServer } from "./server/server.js";
export type { StartServerOptions, ServerHandle } from "./server/server.js";

// Parsers
export { parseCardToEffects } from "./parsers/card-to-effects.js";
export type {
  ParseCardInput,
  ParseCardResult,
  ParseCardSuccess,
  ParseCardFailure,
} from "./parsers/card-to-effects.js";
export {
  EffectSchema,
  ParseOutputSchema,
  validateParseOutput,
} from "./parsers/zod-schemas.js";
export type {
  EffectLike,
  ParseOutput,
  ValidationResult,
  ValidationSuccess,
  ValidationFailure,
} from "./parsers/zod-schemas.js";

// Prompts (kept for backward compatibility, but project context is now the canonical system prompt)
export {
  CARD_PARSE_SYSTEM,
  buildCardParseUserMessage,
} from "./prompts/card-parse.js";
export type { CardParseFewShot } from "./prompts/card-parse.js";
