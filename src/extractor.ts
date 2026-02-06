import {
  appendMessage, generateMessageId, updateTraits, loadConversation,
  type ChatMessage,
} from "./chat";
import { loadSettings } from "./settings";
import {
  getBackend, getSemaphore,
  type CompletionRequest, type ToolCall, type ToolDefinition,
} from "./backends";
import {
  loadEntry, saveEntry, deleteEntry, loadAllEntries,
  type LorebookEntry, type ActiveEntry,
} from "./lorebook";
import { commitChange } from "./git";
import { EventBus } from "./events";

// ---------------------------------------------------------------------------
// Tool definitions (provided to the LLM)
// ---------------------------------------------------------------------------

export const EXTRACTOR_TOOLS: ToolDefinition[] = [
  {
    name: "create_entry",
    description: "Create a new lorebook entry in a folder.",
    parameters: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Folder path, e.g. 'characters', 'locations', 'items'" },
        name: { type: "string", description: "Entry slug name (lowercase, hyphens)" },
        content: { type: "string", description: "Entry description/content" },
        keywords: { type: "array", items: { type: "string" }, description: "Matching keywords" },
      },
      required: ["folder", "name", "content"],
    },
  },
  {
    name: "update_entry",
    description: "Update fields on an existing lorebook entry.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Entry path, e.g. 'characters/old-sage'" },
        fields: {
          type: "object",
          description: "Fields to update (content, keywords, state, currentLocation, location, completed, requirements, etc.)",
        },
      },
      required: ["path", "fields"],
    },
  },
  {
    name: "delete_entry",
    description: "Delete a lorebook entry.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Entry path to delete" },
      },
      required: ["path"],
    },
  },
  {
    name: "move_character",
    description: "Move a character to a different location.",
    parameters: {
      type: "object",
      properties: {
        characterPath: { type: "string", description: "Character entry path, e.g. 'characters/blacksmith'" },
        locationPath: { type: "string", description: "Destination location path, e.g. 'locations/cellar'" },
      },
      required: ["characterPath", "locationPath"],
    },
  },
  {
    name: "update_item_location",
    description: "Move an item to a different location, character, or the player.",
    parameters: {
      type: "object",
      properties: {
        itemPath: { type: "string", description: "Item entry path, e.g. 'items/iron-key'" },
        location: { type: "string", description: "New location: a location path, character path, or 'player'" },
      },
      required: ["itemPath", "location"],
    },
  },
  {
    name: "complete_goal",
    description: "Mark a goal as completed or incomplete.",
    parameters: {
      type: "object",
      properties: {
        goalPath: { type: "string", description: "Goal entry path, e.g. 'goals/find-key'" },
        completed: { type: "boolean", description: "Whether the goal is completed" },
      },
      required: ["goalPath", "completed"],
    },
  },
  {
    name: "update_character_state",
    description: "Add or remove state tags from a character.",
    parameters: {
      type: "object",
      properties: {
        characterPath: { type: "string", description: "Character entry path" },
        add: { type: "array", items: { type: "string" }, description: "State tags to add" },
        remove: { type: "array", items: { type: "string" }, description: "State tags to remove" },
      },
      required: ["characterPath"],
    },
  },
  {
    name: "update_traits",
    description: "Add or remove player traits.",
    parameters: {
      type: "object",
      properties: {
        chatId: { type: "string", description: "Chat ID" },
        add: { type: "array", items: { type: "string" }, description: "Traits to add" },
        remove: { type: "array", items: { type: "string" }, description: "Traits to remove" },
      },
      required: ["chatId"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function executeTool(
  lorebook: string,
  chatId: string,
  toolCall: ToolCall,
  bus: EventBus,
): Promise<string | null> {
  const args = toolCall.arguments;
  bus.emit({ type: "extractor_tool_call", tool: toolCall.name, args });

  switch (toolCall.name) {
    case "create_entry": {
      const folder = typeof args.folder === "string" ? args.folder.replace(/\/+$/, "") : "";
      const name = typeof args.name === "string" ? args.name : "";
      if (!folder || !name) return null;
      const path = `${folder}/${name}`;
      const entry: LorebookEntry = {
        name: (typeof args.displayName === "string" ? args.displayName : name).replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
        content: typeof args.content === "string" ? args.content : "",
        keywords: Array.isArray(args.keywords) ? args.keywords.filter((k: unknown) => typeof k === "string") : [],
        regex: "",
        priority: 50,
        enabled: true,
        contexts: [],
      };
      await saveEntry(lorebook, path, entry);
      const sha = await commitChange(lorebook, `extractor: create ${path}`);
      return sha;
    }

    case "update_entry": {
      const path = typeof args.path === "string" ? args.path : "";
      const fields = args.fields as Record<string, unknown> | undefined;
      if (!path || !fields) return null;
      const existing = await loadEntry(lorebook, path);
      if (!existing) return null;
      // Merge fields
      for (const [key, val] of Object.entries(fields)) {
        if (val !== undefined) {
          (existing as Record<string, unknown>)[key] = val;
        }
      }
      await saveEntry(lorebook, path, existing);
      const sha = await commitChange(lorebook, `extractor: update ${path}`);
      return sha;
    }

    case "delete_entry": {
      const path = typeof args.path === "string" ? args.path : "";
      if (!path) return null;
      await deleteEntry(lorebook, path);
      const sha = await commitChange(lorebook, `extractor: delete ${path}`);
      return sha;
    }

    case "move_character": {
      const charPath = typeof args.characterPath === "string" ? args.characterPath : "";
      const locPath = typeof args.locationPath === "string" ? args.locationPath : "";
      if (!charPath || !locPath) return null;
      const entry = await loadEntry(lorebook, charPath);
      if (!entry) return null;
      entry.currentLocation = locPath;
      await saveEntry(lorebook, charPath, entry);
      const sha = await commitChange(lorebook, `extractor: move ${charPath} to ${locPath}`);
      return sha;
    }

    case "update_item_location": {
      const itemPath = typeof args.itemPath === "string" ? args.itemPath : "";
      const location = typeof args.location === "string" ? args.location : "";
      if (!itemPath || !location) return null;
      const entry = await loadEntry(lorebook, itemPath);
      if (!entry) return null;
      entry.location = location;
      await saveEntry(lorebook, itemPath, entry);
      const sha = await commitChange(lorebook, `extractor: move item ${itemPath} to ${location}`);
      return sha;
    }

    case "complete_goal": {
      const goalPath = typeof args.goalPath === "string" ? args.goalPath : "";
      const completed = args.completed === true;
      if (!goalPath) return null;
      const entry = await loadEntry(lorebook, goalPath);
      if (!entry) return null;
      entry.completed = completed;
      await saveEntry(lorebook, goalPath, entry);
      const sha = await commitChange(lorebook, `extractor: ${completed ? "complete" : "uncomplete"} ${goalPath}`);
      return sha;
    }

    case "update_character_state": {
      const charPath = typeof args.characterPath === "string" ? args.characterPath : "";
      if (!charPath) return null;
      const entry = await loadEntry(lorebook, charPath);
      if (!entry) return null;
      const state = new Set(entry.state || []);
      const addTags = Array.isArray(args.add) ? args.add.filter((s: unknown) => typeof s === "string") : [];
      const removeTags = Array.isArray(args.remove) ? args.remove.filter((s: unknown) => typeof s === "string") : [];
      for (const tag of addTags) state.add(tag);
      for (const tag of removeTags) state.delete(tag);
      entry.state = [...state];
      await saveEntry(lorebook, charPath, entry);
      const sha = await commitChange(lorebook, `extractor: update state for ${charPath}`);
      return sha;
    }

    case "update_traits": {
      const cid = typeof args.chatId === "string" ? args.chatId : chatId;
      const conv = await loadConversation(cid);
      if (!conv) return null;
      const traits = new Set(conv.meta.traits);
      const addTraits = Array.isArray(args.add) ? args.add.filter((s: unknown) => typeof s === "string") : [];
      const removeTraits = Array.isArray(args.remove) ? args.remove.filter((s: unknown) => typeof s === "string") : [];
      for (const t of addTraits) traits.add(t);
      for (const t of removeTraits) traits.delete(t);
      await updateTraits(cid, [...traits]);
      return null; // no git commit for traits (stored in chat, not lorebook)
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Execute extractor step
// ---------------------------------------------------------------------------

export async function executeExtractorStep(
  chatId: string,
  lorebook: string,
  backendId: string,
  userMessage: ChatMessage,
  turnMessages: ChatMessage[],
  activeEntries: ActiveEntry[],
  worldContext: string,
  bus: EventBus,
): Promise<void> {
  const backend = getBackend(backendId);
  const semaphore = getSemaphore(backendId);
  if (!backend || !semaphore) {
    throw new Error(`Backend "${backendId}" not found`);
  }

  const release = await semaphore.acquire();
  try {
    bus.emit({ type: "step_start", role: "extractor" });

    // Build extractor prompt
    const turnContent = [
      `[Player]: ${userMessage.content}`,
      ...turnMessages
        .filter((m) => m.content && m.role === "assistant")
        .map((m) => `[${m.source || "assistant"}]: ${m.content}`),
    ].join("\n\n");

    const messages: Array<{ role: string; content: string }> = [
      {
        role: "system",
        content: `You are a world state extractor for an RPG game. Analyze the latest exchange and extract any world state changes that should be persisted to the lorebook.

${worldContext}

## Instructions
- Analyze the exchange below for any world state changes.
- Use the provided tools to update the lorebook accordingly.
- Look for: character movements, item transfers, goal progress, new locations discovered, NPC state changes, player trait changes.
- Only make changes that are clearly indicated by the narrative.
- If no changes are needed, respond with "No changes detected." and do not call any tools.`,
      },
      {
        role: "user",
        content: turnContent,
      },
    ];

    const settings = await loadSettings();
    const req: CompletionRequest = {
      messages,
      temperature: 0.2, // low temperature for extraction
      maxTokens: 1024,
      tools: EXTRACTOR_TOOLS,
    };

    const resp = await backend.complete(req);

    // Execute tool calls
    const commits: string[] = [];
    if (resp.toolCalls && resp.toolCalls.length > 0) {
      for (const tc of resp.toolCalls) {
        const sha = await executeTool(lorebook, chatId, tc, bus);
        if (sha) commits.push(sha);
      }
    }

    // If there were commits, append an extractor message to record them
    if (commits.length > 0) {
      const extractorMsg: ChatMessage = {
        id: generateMessageId(),
        role: "system",
        source: "extractor",
        content: `[World updated: ${commits.length} change${commits.length > 1 ? "s" : ""} committed]`,
        timestamp: new Date().toISOString(),
        commits,
      };
      await appendMessage(chatId, extractorMsg);
      bus.emit({ type: "step_complete", role: "extractor", message: extractorMsg });
    } else {
      bus.emit({
        type: "step_complete",
        role: "extractor",
        message: {
          id: generateMessageId(),
          role: "system",
          source: "extractor",
          content: "",
          timestamp: new Date().toISOString(),
        },
      });
    }
  } finally {
    release();
  }
}
