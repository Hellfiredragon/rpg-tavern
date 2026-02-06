import type { ChatMessage } from "./chat";
import type { PipelineRole } from "./settings";

// ---------------------------------------------------------------------------
// Pipeline events
// ---------------------------------------------------------------------------

export type PipelineEvent =
  | { type: "step_start"; role: PipelineRole }
  | { type: "step_token"; role: PipelineRole; token: string }
  | { type: "step_complete"; role: PipelineRole; message: ChatMessage }
  | { type: "extractor_background"; status: "started" | "completed" | "failed"; error?: string }
  | { type: "extractor_tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "pipeline_complete"; messages: ChatMessage[]; location?: string }
  | { type: "pipeline_error"; error: string; role?: PipelineRole; category?: string }
  | { type: "pipeline_cancelled" };

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

export class EventBus {
  private listeners: Array<(event: PipelineEvent) => void> = [];

  emit(event: PipelineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // don't let a bad listener break the pipeline
      }
    }
  }

  subscribe(listener: (event: PipelineEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}

// ---------------------------------------------------------------------------
// Active pipeline registry — keyed by chatId
// ---------------------------------------------------------------------------

type PipelineRun = { bus: EventBus; abort: AbortController };

const activePipelines = new Map<string, PipelineRun>();

export function createPipelineRun(chatId: string): PipelineRun {
  if (activePipelines.has(chatId)) {
    throw new Error("Pipeline already active for this chat");
  }
  const run: PipelineRun = { bus: new EventBus(), abort: new AbortController() };
  activePipelines.set(chatId, run);
  return run;
}

export function getPipelineRun(chatId: string): PipelineRun | undefined {
  return activePipelines.get(chatId);
}

export function cancelPipelineRun(chatId: string): boolean {
  const run = activePipelines.get(chatId);
  if (!run) return false;
  run.abort.abort();
  return true;
}

export function removePipelineRun(chatId: string): void {
  activePipelines.delete(chatId);
}
