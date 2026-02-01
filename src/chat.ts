import { join, resolve } from "path";
import { mkdir, readdir, unlink } from "fs/promises";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatMeta = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lorebook: string;         // adventure lorebook slug, e.g. "key-quest", or ""
  currentLocation: string;  // entry path, e.g. "locations/village-square", or ""
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR || join(import.meta.dir, "..", "data");
const CHATS_DIR = join(DATA_DIR, "chats");

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

export function generateChatId(): string {
  const ts = Date.now();
  const hex = Math.floor(Math.random() * 0xfff).toString(16).padStart(3, "0");
  return `${ts}-${hex}`;
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

const VALID_ID = /^[0-9]+-[0-9a-f]{3}$/;

function chatFilePath(id: string): string {
  if (!id || !VALID_ID.test(id)) throw new Error("Invalid chat ID");
  const abs = resolve(join(CHATS_DIR, id + ".jsonl"));
  if (!abs.startsWith(resolve(CHATS_DIR))) throw new Error("Invalid chat ID");
  return abs;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createConversation(opts?: { id?: string; lorebook?: string; currentLocation?: string }): Promise<ChatMeta> {
  await mkdir(CHATS_DIR, { recursive: true });
  const chatId = opts?.id ?? generateChatId();
  const now = new Date().toISOString();
  const meta: ChatMeta = {
    id: chatId,
    title: "New conversation",
    createdAt: now,
    updatedAt: now,
    lorebook: opts?.lorebook ?? "",
    currentLocation: opts?.currentLocation ?? "",
  };
  const filePath = chatFilePath(chatId);
  await Bun.write(filePath, JSON.stringify(meta) + "\n");
  return meta;
}

export async function listConversations(lorebook?: string): Promise<ChatMeta[]> {
  await mkdir(CHATS_DIR, { recursive: true });
  const entries = await readdir(CHATS_DIR);
  const results: ChatMeta[] = [];

  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    try {
      const text = await Bun.file(join(CHATS_DIR, name)).text();
      const firstLine = text.split("\n")[0];
      if (!firstLine) continue;
      const meta = JSON.parse(firstLine) as ChatMeta;
      if (meta.id && meta.createdAt) {
        // Default missing fields for old JSONL files
        if (meta.lorebook === undefined) meta.lorebook = "";
        if (meta.currentLocation === undefined) meta.currentLocation = "";
        if (lorebook !== undefined && meta.lorebook !== lorebook) continue;
        results.push(meta);
      }
    } catch {
      // skip malformed files
    }
  }

  results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return results;
}

export async function loadConversation(id: string): Promise<{ meta: ChatMeta; messages: ChatMessage[] } | null> {
  const filePath = chatFilePath(id);
  const f = Bun.file(filePath);
  if (!(await f.exists())) return null;

  try {
    const text = await f.text();
    const lines = text.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) return null;

    const meta = JSON.parse(lines[0]) as ChatMeta;
    // Default missing fields for old JSONL files
    if (meta.lorebook === undefined) meta.lorebook = "";
    if (meta.currentLocation === undefined) meta.currentLocation = "";
    const messages: ChatMessage[] = [];

    for (let i = 1; i < lines.length; i++) {
      try {
        const msg = JSON.parse(lines[i]) as ChatMessage;
        if (msg.role && msg.content !== undefined) {
          messages.push(msg);
        }
      } catch {
        // skip malformed message lines
      }
    }

    return { meta, messages };
  } catch {
    return null;
  }
}

export async function appendMessage(id: string, message: ChatMessage): Promise<ChatMeta> {
  const filePath = chatFilePath(id);
  const f = Bun.file(filePath);
  if (!(await f.exists())) throw new Error("Conversation not found");

  const text = await f.text();
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new Error("Conversation not found");

  const meta = JSON.parse(lines[0]) as ChatMeta;
  meta.updatedAt = new Date().toISOString();

  // Set title from first user message
  if (meta.title === "New conversation" && message.role === "user") {
    meta.title = message.content.length > 50
      ? message.content.slice(0, 50) + "…"
      : message.content;
  }

  // Rebuild file: updated meta line + existing messages + new message
  const newLines = [JSON.stringify(meta)];
  for (let i = 1; i < lines.length; i++) {
    newLines.push(lines[i]);
  }
  newLines.push(JSON.stringify(message));

  await Bun.write(filePath, newLines.join("\n") + "\n");
  return meta;
}

export async function deleteConversation(id: string): Promise<void> {
  const filePath = chatFilePath(id);
  await unlink(filePath);
}

export async function changeLocation(id: string, locationPath: string, narration: string): Promise<ChatMeta> {
  const filePath = chatFilePath(id);
  const f = Bun.file(filePath);
  if (!(await f.exists())) throw new Error("Conversation not found");

  const text = await f.text();
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new Error("Conversation not found");

  const meta = JSON.parse(lines[0]) as ChatMeta;
  meta.currentLocation = locationPath;
  meta.updatedAt = new Date().toISOString();

  const systemMsg: ChatMessage = { role: "system", content: narration, timestamp: new Date().toISOString() };

  const newLines = [JSON.stringify(meta)];
  for (let i = 1; i < lines.length; i++) {
    newLines.push(lines[i]);
  }
  newLines.push(JSON.stringify(systemMsg));

  await Bun.write(filePath, newLines.join("\n") + "\n");
  return meta;
}
