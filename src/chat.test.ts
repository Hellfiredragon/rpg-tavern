import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join, resolve } from "path";
import { rm, mkdir } from "fs/promises";
import {
  generateChatId,
  createConversation,
  listConversations,
  loadConversation,
  appendMessage,
  deleteConversation,
  changeLocation,
  type ChatMeta,
  type ChatMessage,
} from "./chat";

const CHATS_DIR = resolve(join(import.meta.dir, "..", "data", "chats"));

async function cleanChats() {
  try {
    await rm(CHATS_DIR, { recursive: true });
  } catch {
    // doesn't exist yet
  }
}

// ---------------------------------------------------------------------------
// generateChatId
// ---------------------------------------------------------------------------

describe("generateChatId", () => {
  test("matches expected format: <timestamp>-<3-hex>", () => {
    const id = generateChatId();
    expect(id).toMatch(/^\d+-[0-9a-f]{3}$/);
  });

  test("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      ids.add(generateChatId());
    }
    // With 3-hex suffix (4096 values) and 20 calls at the same ms,
    // collisions are extremely unlikely
    expect(ids.size).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// createConversation
// ---------------------------------------------------------------------------

describe("createConversation", () => {
  beforeEach(cleanChats);
  afterEach(cleanChats);

  test("creates a JSONL file with meta on first line", async () => {
    const meta = await createConversation();
    expect(meta.id).toMatch(/^\d+-[0-9a-f]{3}$/);
    expect(meta.title).toBe("New conversation");
    expect(meta.createdAt).toBeTruthy();
    expect(meta.updatedAt).toBeTruthy();
    expect(meta.lorebook).toBe("");
    expect(meta.currentLocation).toBe("");

    const loaded = await loadConversation(meta.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.meta.id).toBe(meta.id);
    expect(loaded!.meta.lorebook).toBe("");
    expect(loaded!.meta.currentLocation).toBe("");
    expect(loaded!.messages).toEqual([]);
  });

  test("creates data/chats/ directory automatically", async () => {
    await cleanChats();
    const meta = await createConversation();
    const loaded = await loadConversation(meta.id);
    expect(loaded).not.toBeNull();
  });

  test("accepts a custom ID", async () => {
    const meta = await createConversation({ id: "1234567890123-abc" });
    expect(meta.id).toBe("1234567890123-abc");
  });

  test("stores lorebook and currentLocation when provided", async () => {
    const meta = await createConversation({ lorebook: "key-quest", currentLocation: "locations/village-square" });
    expect(meta.lorebook).toBe("key-quest");
    expect(meta.currentLocation).toBe("locations/village-square");

    const loaded = await loadConversation(meta.id);
    expect(loaded!.meta.lorebook).toBe("key-quest");
    expect(loaded!.meta.currentLocation).toBe("locations/village-square");
  });
});

// ---------------------------------------------------------------------------
// listConversations
// ---------------------------------------------------------------------------

describe("listConversations", () => {
  beforeEach(cleanChats);
  afterEach(cleanChats);

  test("returns conversations sorted by updatedAt descending", async () => {
    const a = await createConversation();
    await appendMessage(a.id, { role: "user", content: "First", timestamp: new Date().toISOString() });

    // Ensure different timestamp
    await new Promise((r) => setTimeout(r, 15));

    const b = await createConversation();
    await appendMessage(b.id, { role: "user", content: "Second", timestamp: new Date().toISOString() });

    const list = await listConversations();
    expect(list.length).toBe(2);
    // b was updated more recently
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  test("returns empty array when no conversations exist", async () => {
    const list = await listConversations();
    expect(list).toEqual([]);
  });

  test("skips malformed files", async () => {
    await mkdir(CHATS_DIR, { recursive: true });
    // Write a malformed file
    await Bun.write(join(CHATS_DIR, "9999999999999-bad.jsonl"), "not valid json\n");
    // Write a valid one
    const meta = await createConversation();

    const list = await listConversations();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(meta.id);
  });

  test("filters by lorebook when provided", async () => {
    await createConversation({ lorebook: "quest-a" });
    await createConversation({ lorebook: "quest-b" });
    await createConversation({ lorebook: "quest-a" });

    const all = await listConversations();
    expect(all.length).toBe(3);

    const questA = await listConversations("quest-a");
    expect(questA.length).toBe(2);
    questA.forEach((c) => expect(c.lorebook).toBe("quest-a"));

    const questB = await listConversations("quest-b");
    expect(questB.length).toBe(1);
    expect(questB[0].lorebook).toBe("quest-b");

    const none = await listConversations("nonexistent");
    expect(none.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// loadConversation
// ---------------------------------------------------------------------------

describe("loadConversation", () => {
  beforeEach(cleanChats);
  afterEach(cleanChats);

  test("returns null for missing conversation", async () => {
    const result = await loadConversation("9999999999999-aaa");
    expect(result).toBeNull();
  });

  test("returns meta and messages", async () => {
    const meta = await createConversation();
    await appendMessage(meta.id, { role: "user", content: "Hello", timestamp: "2024-01-01T00:00:00Z" });
    await appendMessage(meta.id, { role: "assistant", content: "Hi there", timestamp: "2024-01-01T00:00:01Z" });

    const conv = await loadConversation(meta.id);
    expect(conv).not.toBeNull();
    expect(conv!.messages).toHaveLength(2);
    expect(conv!.messages[0].role).toBe("user");
    expect(conv!.messages[0].content).toBe("Hello");
    expect(conv!.messages[1].role).toBe("assistant");
    expect(conv!.messages[1].content).toBe("Hi there");
  });

  test("skips malformed message lines", async () => {
    const meta = await createConversation();
    // Manually write a file with a bad line
    const filePath = join(CHATS_DIR, meta.id + ".jsonl");
    const text = await Bun.file(filePath).text();
    await Bun.write(filePath, text + "not valid json\n" + JSON.stringify({ role: "user", content: "Valid", timestamp: "2024-01-01T00:00:00Z" }) + "\n");

    const conv = await loadConversation(meta.id);
    expect(conv).not.toBeNull();
    expect(conv!.messages).toHaveLength(1);
    expect(conv!.messages[0].content).toBe("Valid");
  });
});

// ---------------------------------------------------------------------------
// appendMessage
// ---------------------------------------------------------------------------

describe("appendMessage", () => {
  beforeEach(cleanChats);
  afterEach(cleanChats);

  test("persists a message to the JSONL file", async () => {
    const meta = await createConversation();
    await appendMessage(meta.id, { role: "user", content: "Test message", timestamp: new Date().toISOString() });

    const conv = await loadConversation(meta.id);
    expect(conv!.messages).toHaveLength(1);
    expect(conv!.messages[0].content).toBe("Test message");
    expect(conv!.messages[0].role).toBe("user");
  });

  test("updates updatedAt on each append", async () => {
    const meta = await createConversation();
    const before = meta.updatedAt;

    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 10));
    await appendMessage(meta.id, { role: "user", content: "Hi", timestamp: new Date().toISOString() });

    const conv = await loadConversation(meta.id);
    expect(conv!.meta.updatedAt).not.toBe(before);
  });

  test("sets title from first user message", async () => {
    const meta = await createConversation();
    expect(meta.title).toBe("New conversation");

    await appendMessage(meta.id, { role: "user", content: "I enter the tavern", timestamp: new Date().toISOString() });

    const conv = await loadConversation(meta.id);
    expect(conv!.meta.title).toBe("I enter the tavern");
  });

  test("truncates long titles to 50 chars with ellipsis", async () => {
    const meta = await createConversation();
    const longMsg = "A".repeat(80);

    await appendMessage(meta.id, { role: "user", content: longMsg, timestamp: new Date().toISOString() });

    const conv = await loadConversation(meta.id);
    expect(conv!.meta.title).toBe("A".repeat(50) + "…");
  });

  test("does not overwrite title on subsequent user messages", async () => {
    const meta = await createConversation();
    await appendMessage(meta.id, { role: "user", content: "First message", timestamp: new Date().toISOString() });
    await appendMessage(meta.id, { role: "user", content: "Second message", timestamp: new Date().toISOString() });

    const conv = await loadConversation(meta.id);
    expect(conv!.meta.title).toBe("First message");
  });

  test("throws on missing conversation", async () => {
    expect(
      appendMessage("9999999999999-aaa", { role: "user", content: "Hi", timestamp: new Date().toISOString() })
    ).rejects.toThrow("Conversation not found");
  });

  test("persists system messages", async () => {
    const meta = await createConversation();
    await appendMessage(meta.id, { role: "system", content: "You move to the village square.", timestamp: new Date().toISOString() });

    const conv = await loadConversation(meta.id);
    expect(conv!.messages).toHaveLength(1);
    expect(conv!.messages[0].role).toBe("system");
    expect(conv!.messages[0].content).toBe("You move to the village square.");
  });
});

// ---------------------------------------------------------------------------
// deleteConversation
// ---------------------------------------------------------------------------

describe("deleteConversation", () => {
  beforeEach(cleanChats);
  afterEach(cleanChats);

  test("removes the JSONL file", async () => {
    const meta = await createConversation();
    await deleteConversation(meta.id);

    const loaded = await loadConversation(meta.id);
    expect(loaded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// changeLocation
// ---------------------------------------------------------------------------

describe("changeLocation", () => {
  beforeEach(cleanChats);
  afterEach(cleanChats);

  test("updates currentLocation in meta and appends system message", async () => {
    const meta = await createConversation({ lorebook: "key-quest" });
    expect(meta.currentLocation).toBe("");

    await new Promise((r) => setTimeout(r, 10));
    const updated = await changeLocation(meta.id, "locations/village-square", "You arrive at the village square.");

    expect(updated.currentLocation).toBe("locations/village-square");
    expect(updated.updatedAt).not.toBe(meta.updatedAt);

    const conv = await loadConversation(meta.id);
    expect(conv!.meta.currentLocation).toBe("locations/village-square");
    expect(conv!.messages).toHaveLength(1);
    expect(conv!.messages[0].role).toBe("system");
    expect(conv!.messages[0].content).toBe("You arrive at the village square.");
  });

  test("throws on missing conversation", async () => {
    expect(
      changeLocation("9999999999999-aaa", "locations/foo", "narration")
    ).rejects.toThrow("Conversation not found");
  });

  test("can change location multiple times", async () => {
    const meta = await createConversation({ lorebook: "key-quest" });

    await changeLocation(meta.id, "locations/village-square", "Narration 1");
    const updated = await changeLocation(meta.id, "locations/cellar", "Narration 2");

    expect(updated.currentLocation).toBe("locations/cellar");

    const conv = await loadConversation(meta.id);
    expect(conv!.messages).toHaveLength(2);
    expect(conv!.messages[0].content).toBe("Narration 1");
    expect(conv!.messages[1].content).toBe("Narration 2");
  });
});

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

describe("path validation", () => {
  test("rejects empty ID", () => {
    expect(() => loadConversation("")).toThrow("Invalid chat ID");
  });

  test("rejects path traversal attempts", () => {
    expect(() => loadConversation("../../etc/passwd")).toThrow("Invalid chat ID");
  });

  test("rejects IDs with invalid characters", () => {
    expect(() => loadConversation("abc-def")).toThrow("Invalid chat ID");
  });

  test("rejects IDs without hex suffix", () => {
    expect(() => loadConversation("1234567890123")).toThrow("Invalid chat ID");
  });
});
