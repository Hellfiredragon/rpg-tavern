import type {
  BackendConfig, CompletionRequest, CompletionResponse,
  LLMBackend, ToolCall, ToolDefinition,
} from "./backends";

// ---------------------------------------------------------------------------
// OpenAI API types
// ---------------------------------------------------------------------------

type OAIMessage = { role: string; content: string | null };

type OAITool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

type OAIChoice = {
  message: {
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason: string;
};

type OAIStreamDelta = {
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

type OAIStreamChoice = {
  delta: OAIStreamDelta;
  finish_reason: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toOAIMessages(messages: Array<{ role: string; content: string }>): OAIMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function toOAITools(tools: ToolDefinition[]): OAITool[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function mapFinishReason(reason: string): CompletionResponse["finishReason"] {
  switch (reason) {
    case "stop": return "stop";
    case "tool_calls": return "tool_use";
    case "length": return "length";
    default: return "stop";
  }
}

function parseOAIToolCalls(raw: OAIChoice["message"]["tool_calls"]): ToolCall[] {
  if (!raw) return [];
  return raw.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments || "{}"),
  }));
}

// ---------------------------------------------------------------------------
// OpenAI-compatible backend
// ---------------------------------------------------------------------------

export function createOpenAIBackend(config: BackendConfig): LLMBackend {
  const baseUrl = config.url.replace(/\/+$/, "");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const backend: LLMBackend = {
    config,

    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const body: Record<string, unknown> = {
        model: config.model,
        messages: toOAIMessages(req.messages),
        temperature: req.temperature ?? 0.7,
        stream: false,
      };
      if (req.maxTokens) body.max_tokens = req.maxTokens;
      if (req.stopSequences?.length) body.stop = req.stopSequences;
      if (req.tools?.length) body.tools = toOAITools(req.tools);

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`OpenAI error ${res.status}: ${errText}`);
      }

      const data = await res.json() as { choices: OAIChoice[] };
      const choice = data.choices?.[0];
      if (!choice) throw new Error("No completion choice returned");

      const toolCalls = parseOAIToolCalls(choice.message.tool_calls);
      return {
        content: choice.message.content ?? "",
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: mapFinishReason(choice.finish_reason),
      };
    },

    async *stream(req: CompletionRequest): AsyncGenerator<string | ToolCall, CompletionResponse> {
      const body: Record<string, unknown> = {
        model: config.model,
        messages: toOAIMessages(req.messages),
        temperature: req.temperature ?? 0.7,
        stream: true,
      };
      if (req.maxTokens) body.max_tokens = req.maxTokens;
      if (req.stopSequences?.length) body.stop = req.stopSequences;
      if (req.tools?.length) body.tools = toOAITools(req.tools);

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`OpenAI stream error ${res.status}: ${errText}`);
      }

      let fullContent = "";
      let finishReason: CompletionResponse["finishReason"] = "stop";

      // Accumulate tool call chunks: index -> { id, name, argChunks }
      const toolCallAccum = new Map<number, { id: string; name: string; args: string }>();

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!;

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;

            let chunk: { choices: OAIStreamChoice[] };
            try {
              chunk = JSON.parse(payload);
            } catch {
              continue;
            }

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) {
              finishReason = mapFinishReason(choice.finish_reason);
            }

            const delta = choice.delta;
            if (delta.content) {
              fullContent += delta.content;
              yield delta.content;
            }

            // Accumulate tool call chunks
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                let accum = toolCallAccum.get(tc.index);
                if (!accum) {
                  accum = { id: tc.id ?? "", name: "", args: "" };
                  toolCallAccum.set(tc.index, accum);
                }
                if (tc.id) accum.id = tc.id;
                if (tc.function?.name) accum.name += tc.function.name;
                if (tc.function?.arguments) accum.args += tc.function.arguments;
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Build final tool calls
      const toolCalls: ToolCall[] = [];
      for (const [, accum] of [...toolCallAccum.entries()].sort((a, b) => a[0] - b[0])) {
        try {
          toolCalls.push({
            id: accum.id,
            name: accum.name,
            arguments: JSON.parse(accum.args || "{}"),
          });
        } catch {
          // skip malformed tool call arguments
        }
      }

      // Yield assembled tool calls
      for (const tc of toolCalls) yield tc;

      return {
        content: fullContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason,
      };
    },
  };

  return backend;
}
