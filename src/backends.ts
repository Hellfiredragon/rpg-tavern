// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export type LLMErrorCategory = "auth" | "rate_limit" | "server" | "network" | "unknown";

export class LLMError extends Error {
  constructor(message: string, public readonly category: LLMErrorCategory, public readonly status?: number) {
    super(message);
    this.name = "LLMError";
  }
}

export function classifyHTTPError(status: number, body: string): LLMError {
  if (status === 401 || status === 403) return new LLMError("Invalid API key or unauthorized.", "auth", status);
  if (status === 429) return new LLMError("Rate limit exceeded. Wait a moment and try again.", "rate_limit", status);
  if (status >= 500) return new LLMError(`Backend server error (${status}).`, "server", status);
  return new LLMError(`Backend error ${status}: ${body.slice(0, 200)}`, "unknown", status);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BackendType = "koboldcpp" | "openai";

export type BackendConfig = {
  id: string;
  name: string;
  type: BackendType;
  url: string;
  apiKey: string;
  model: string;
  streaming: boolean;
  maxConcurrent: number;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type CompletionRequest = {
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  stopSequences?: string[];
  signal?: AbortSignal;
};

export type CompletionResponse = {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: "stop" | "tool_use" | "length" | "error";
};

export interface LLMBackend {
  readonly config: BackendConfig;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
  stream(req: CompletionRequest): AsyncGenerator<string | ToolCall, CompletionResponse>;
}

// ---------------------------------------------------------------------------
// Semaphore — limits concurrency per backend
// ---------------------------------------------------------------------------

export class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.current < this.max) {
      this.current++;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ---------------------------------------------------------------------------
// Backend registry
// ---------------------------------------------------------------------------

const backends = new Map<string, LLMBackend>();
const semaphores = new Map<string, Semaphore>();

export function initBackends(configs: BackendConfig[], createBackend: (config: BackendConfig) => LLMBackend): void {
  backends.clear();
  semaphores.clear();
  for (const config of configs) {
    backends.set(config.id, createBackend(config));
    semaphores.set(config.id, new Semaphore(config.maxConcurrent || 1));
  }
}

export function getBackend(id: string): LLMBackend | undefined {
  return backends.get(id);
}

export function getSemaphore(id: string): Semaphore | undefined {
  return semaphores.get(id);
}

export function listBackendIds(): string[] {
  return [...backends.keys()];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

import { createKoboldBackend } from "./backend-kobold";
import { createOpenAIBackend } from "./backend-openai";

export function createBackendFromConfig(config: BackendConfig): LLMBackend {
  switch (config.type) {
    case "koboldcpp":
      return createKoboldBackend(config);
    case "openai":
      return createOpenAIBackend(config);
    default:
      throw new Error(`Unknown backend type: ${config.type}`);
  }
}

export function initBackendsFromConfig(configs: BackendConfig[]): void {
  initBackends(configs, createBackendFromConfig);
}
