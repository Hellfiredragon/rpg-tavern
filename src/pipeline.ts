import {
  loadConversation, appendMessage, changeLocation, generateMessageId,
  type ChatMessage,
} from "./chat";
import { loadSettings, type PipelineConfig, type PipelineRole } from "./settings";
import { getBackend, getSemaphore, type CompletionRequest, type ToolCall } from "./backends";
import { findActiveEntries, loadEntry, type ActiveEntry, type ActivationContext } from "./lorebook";
import { EventBus } from "./events";
import { executeExtractorStep, EXTRACTOR_TOOLS } from "./extractor";

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildWorldContext(activeEntries: ActiveEntry[], currentLocation: string, traits: string[]): string {
  const sections: string[] = [];

  // Current location
  const locationEntry = activeEntries.find((e) => e.path === currentLocation);
  if (locationEntry) {
    sections.push(`## Current Location: ${locationEntry.name}\n${locationEntry.content}`);
  }

  // Characters present
  const characters = activeEntries.filter((e) => e.category === "characters");
  if (characters.length > 0) {
    const charDescs = characters.map((c) => {
      let desc = `- **${c.name}**: ${c.content}`;
      if (c.state && c.state.length > 0) desc += ` (State: ${c.state.join(", ")})`;
      return desc;
    });
    sections.push(`## Characters Present\n${charDescs.join("\n")}`);
  }

  // Items
  const items = activeEntries.filter((e) => e.category === "items");
  if (items.length > 0) {
    const itemDescs = items.map((i) => {
      let desc = `- **${i.name}**: ${i.content}`;
      if (i.location) desc += ` (Location: ${i.location === "player" ? "carried by player" : i.location})`;
      return desc;
    });
    sections.push(`## Items\n${itemDescs.join("\n")}`);
  }

  // Goals
  const goals = activeEntries.filter((e) => e.category === "goals" && !e.completed);
  if (goals.length > 0) {
    const goalDescs = goals.map((g) => {
      let desc = `- **${g.name}**: ${g.content}`;
      if (g.requirements && g.requirements.length > 0) desc += ` (Requirements: ${g.requirements.join("; ")})`;
      return desc;
    });
    sections.push(`## Active Goals\n${goalDescs.join("\n")}`);
  }

  // Other active entries
  const others = activeEntries.filter(
    (e) => e.category !== "locations" && e.category !== "characters" && e.category !== "items" && e.category !== "goals"
  );
  if (others.length > 0) {
    sections.push(`## World Lore\n${others.map((o) => `- **${o.name}**: ${o.content}`).join("\n")}`);
  }

  // Player traits
  if (traits.length > 0) {
    sections.push(`## Player Traits\n${traits.join(", ")}`);
  }

  return sections.join("\n\n");
}

function buildNarratorMessages(
  worldContext: string,
  history: ChatMessage[],
  userMessage: ChatMessage,
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];

  messages.push({
    role: "system",
    content: `You are the Narrator for an interactive RPG adventure. Your role is to continue the story based on the player's actions.

${worldContext}

## Instructions
- Describe the scene, NPC actions, environmental events, and consequences of the player's actions.
- Use "{{user}}" to refer to the player character.
- You may describe forced movements (e.g. "the thieves drag {{user}} to the cellar") when dramatically appropriate.
- Keep responses concise (2-4 paragraphs).
- Do NOT generate dialog for NPCs — that will be handled separately.
- Focus on narration, description, and action.`,
  });

  // Recent history (last 20 messages)
  const recent = history.slice(-20);
  for (const msg of recent) {
    if (msg.role === "system") continue;
    messages.push({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    });
  }

  // Current user message
  messages.push({ role: "user", content: userMessage.content });

  return messages;
}

function buildCharacterMessages(
  worldContext: string,
  history: ChatMessage[],
  userMessage: ChatMessage,
  narratorOutput: string | null,
  characters: ActiveEntry[],
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];

  const charDescs = characters.map((c) => {
    let desc = `**${c.name}**: ${c.content}`;
    if (c.state && c.state.length > 0) desc += `\nState: ${c.state.join(", ")}`;
    return desc;
  }).join("\n\n");

  messages.push({
    role: "system",
    content: `You are generating in-character dialog for NPCs in an RPG adventure.

## Characters Present
${charDescs}

${worldContext}

## Instructions
- Generate dialog for the NPCs present at the current location.
- Each character should speak naturally based on their personality, state, and the current situation.
- Format: Start each character's dialog with their name in bold, e.g. "**Innkeeper**: Welcome, traveler!"
- You may include brief action descriptions between dialog lines.
- Stay in character — do not break the fourth wall.
- Keep responses concise.`,
  });

  // Recent history
  const recent = history.slice(-10);
  for (const msg of recent) {
    if (msg.role === "system") continue;
    messages.push({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    });
  }

  // User message + narrator context
  let userContent = userMessage.content;
  if (narratorOutput) {
    userContent += `\n\n[Narrator's description]: ${narratorOutput}`;
  }
  messages.push({ role: "user", content: userContent });

  return messages;
}

// ---------------------------------------------------------------------------
// Pipeline executor
// ---------------------------------------------------------------------------

export async function executePipeline(
  chatId: string,
  lorebook: string,
  userMessage: ChatMessage,
  config: PipelineConfig,
  bus: EventBus,
): Promise<{ messages: ChatMessage[]; location?: string }> {
  const resultMessages: ChatMessage[] = [];
  let narratorOutput: string | null = null;
  let currentLocation: string | undefined;

  try {
    // Load conversation context
    const conv = await loadConversation(chatId);
    if (!conv) throw new Error("Conversation not found");

    const history = conv.messages;
    const meta = conv.meta;

    // Build activation context
    const recentText = [...history.slice(-20), userMessage].map((m) => m.content).join(" ");
    const actCtx: ActivationContext = {
      text: recentText,
      currentLocation: meta.currentLocation,
      traits: meta.traits,
    };
    const activeEntries = lorebook ? await findActiveEntries(lorebook, actCtx) : [];
    const worldContext = buildWorldContext(activeEntries, meta.currentLocation, meta.traits);

    // Determine which steps to run
    const enabledSteps = config.steps.filter((s) => s.enabled && s.backendId);

    // Determine if extractor should run in background (different backend than others)
    const extractorStep = enabledSteps.find((s) => s.role === "extractor");
    const nonExtractorBackends = new Set(
      enabledSteps.filter((s) => s.role !== "extractor").map((s) => s.backendId)
    );
    const extractorIsAsync = extractorStep &&
      !nonExtractorBackends.has(extractorStep.backendId) &&
      nonExtractorBackends.size > 0;

    // Execute narrator and character steps sequentially
    for (const step of enabledSteps) {
      if (step.role === "extractor") continue; // handled separately

      const backend = getBackend(step.backendId);
      const semaphore = getSemaphore(step.backendId);
      if (!backend || !semaphore) {
        bus.emit({ type: "pipeline_error", error: `Backend "${step.backendId}" not found`, role: step.role });
        continue;
      }

      bus.emit({ type: "step_start", role: step.role });
      const release = await semaphore.acquire();

      try {
        let reqMessages: Array<{ role: string; content: string }>;

        if (step.role === "narrator") {
          reqMessages = buildNarratorMessages(worldContext, history, userMessage);
        } else if (step.role === "character") {
          const characters = activeEntries.filter((e) => e.category === "characters");
          if (characters.length === 0) {
            // No characters present — skip character step
            bus.emit({
              type: "step_complete",
              role: step.role,
              message: { id: generateMessageId(), role: "assistant", source: "character", content: "", timestamp: new Date().toISOString() },
            });
            continue;
          }
          reqMessages = buildCharacterMessages(worldContext, history, userMessage, narratorOutput, characters);
        } else {
          continue;
        }

        const settings = await loadSettings();
        const completionReq: CompletionRequest = {
          messages: reqMessages,
          temperature: settings.llm.temperature,
          maxTokens: 1024,
        };

        let content = "";

        if (backend.config.streaming) {
          const gen = backend.stream(completionReq);
          let result = await gen.next();
          while (!result.done) {
            const val = result.value;
            if (typeof val === "string") {
              content += val;
              bus.emit({ type: "step_token", role: step.role, token: val });
            }
            result = await gen.next();
          }
          content = result.value.content || content;
        } else {
          const resp = await backend.complete(completionReq);
          content = resp.content;
        }

        if (step.role === "narrator") {
          narratorOutput = content;
        }

        const msg: ChatMessage = {
          id: generateMessageId(),
          role: "assistant",
          source: step.role,
          content,
          timestamp: new Date().toISOString(),
        };

        if (content) {
          await appendMessage(chatId, msg);
          resultMessages.push(msg);
        }
        bus.emit({ type: "step_complete", role: step.role, message: msg });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        bus.emit({ type: "pipeline_error", error: errMsg, role: step.role });

        // Append error as system message
        const errorMsg: ChatMessage = {
          id: generateMessageId(),
          role: "system",
          source: "system",
          content: `[${step.role} error: ${errMsg}]`,
          timestamp: new Date().toISOString(),
        };
        await appendMessage(chatId, errorMsg);
        resultMessages.push(errorMsg);
      } finally {
        release();
      }
    }

    // Run extractor
    if (extractorStep && lorebook) {
      const runExtractor = async () => {
        try {
          bus.emit({ type: "extractor_background", status: "started" });
          await executeExtractorStep(
            chatId,
            lorebook,
            extractorStep.backendId,
            userMessage,
            resultMessages,
            activeEntries,
            worldContext,
            bus,
          );
          bus.emit({ type: "extractor_background", status: "completed" });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Extractor failed";
          bus.emit({ type: "extractor_background", status: "failed", error: errMsg });
        }
      };

      if (extractorIsAsync) {
        // Fire and forget — don't block pipeline return
        runExtractor();
      } else {
        await runExtractor();
      }
    }

    bus.emit({ type: "pipeline_complete", messages: resultMessages, location: currentLocation });
    return { messages: resultMessages, location: currentLocation };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Pipeline failed";
    bus.emit({ type: "pipeline_error", error: errMsg });
    throw err;
  }
}
