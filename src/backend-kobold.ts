import type {
  BackendConfig, CompletionRequest, CompletionResponse,
  LLMBackend, ToolCall,
} from "./backends";

// ---------------------------------------------------------------------------
// Prompt formatting — flatten chat messages into a single text prompt
// ---------------------------------------------------------------------------

function formatPrompt(messages: Array<{ role: string; content: string }>): string {
  const parts: string[] = [];
  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        parts.push(`### System:\n${msg.content}`);
        break;
      case "user":
        parts.push(`### Human:\n${msg.content}`);
        break;
      case "assistant":
        parts.push(`### Assistant:\n${msg.content}`);
        break;
      default:
        parts.push(`### ${msg.role}:\n${msg.content}`);
    }
  }
  parts.push("### Assistant:\n");
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Tool call parsing — extract JSON from <tool_calls>...</tool_calls> tags
// ---------------------------------------------------------------------------

export function parseKoboldToolCalls(text: string): { content: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  const tagRe = /<tool_calls>([\s\S]*?)<\/tool_calls>/g;
  let cleaned = text;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const calls: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const call of calls) {
        if (call && typeof call === "object" && "name" in call) {
          const c = call as { name: string; arguments?: Record<string, unknown> };
          toolCalls.push({
            id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: c.name,
            arguments: c.arguments ?? {},
          });
        }
      }
    } catch {
      // malformed tool call JSON — ignore
    }
    cleaned = cleaned.replace(match[0], "");
  }

  return { content: cleaned.trim(), toolCalls };
}

// ---------------------------------------------------------------------------
// KoboldCpp backend
// ---------------------------------------------------------------------------

export function createKoboldBackend(config: BackendConfig): LLMBackend {
  const baseUrl = config.url.replace(/\/+$/, "");

  const backend: LLMBackend = {
    config,

    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const prompt = formatPrompt(req.messages);
      const body: Record<string, unknown> = {
        prompt,
        max_length: req.maxTokens ?? 512,
        temperature: req.temperature ?? 0.7,
      };
      if (req.stopSequences?.length) {
        body.stop_sequence = req.stopSequences;
      }

      const res = await fetch(`${baseUrl}/api/v1/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`KoboldCpp error ${res.status}: ${errText}`);
      }

      const data = await res.json() as { results: Array<{ text: string }> };
      const rawText = data.results?.[0]?.text ?? "";

      // Parse tool calls if present
      if (req.tools?.length) {
        const { content, toolCalls } = parseKoboldToolCalls(rawText);
        return {
          content,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          finishReason: toolCalls.length > 0 ? "tool_use" : "stop",
        };
      }

      return { content: rawText.trim(), finishReason: "stop" };
    },

    async *stream(req: CompletionRequest): AsyncGenerator<string | ToolCall, CompletionResponse> {
      const prompt = formatPrompt(req.messages);
      const body: Record<string, unknown> = {
        prompt,
        max_length: req.maxTokens ?? 512,
        temperature: req.temperature ?? 0.7,
      };
      if (req.stopSequences?.length) {
        body.stop_sequence = req.stopSequences;
      }

      const res = await fetch(`${baseUrl}/api/extra/generate/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`KoboldCpp stream error ${res.status}: ${errText}`);
      }

      let fullText = "";
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
            if (line.startsWith("data:")) {
              const payload = line.slice(5).trim();
              if (!payload) continue;
              try {
                const data = JSON.parse(payload) as { token?: string };
                if (data.token) {
                  fullText += data.token;
                  yield data.token;
                }
              } catch {
                // skip malformed SSE lines
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Parse tool calls from full text
      if (req.tools?.length) {
        const { content, toolCalls } = parseKoboldToolCalls(fullText);
        for (const tc of toolCalls) yield tc;
        return {
          content,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          finishReason: toolCalls.length > 0 ? "tool_use" : "stop",
        };
      }

      return { content: fullText.trim(), finishReason: "stop" };
    },
  };

  return backend;
}
