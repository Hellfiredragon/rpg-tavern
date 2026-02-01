import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { join, resolve } from "path";
import { rm } from "fs/promises";
import { startServer } from "./server";

const DATA_DIR = resolve(join(import.meta.dir, "..", "data-test"));
const CHATS_DIR = join(DATA_DIR, "chats");
const LOREBOOKS_DIR = join(DATA_DIR, "lorebooks");

let server: ReturnType<typeof Bun.serve>;
const PORT = 39182; // unlikely to collide
const BASE = `http://localhost:${PORT}`;

async function cleanData() {
  try { await rm(CHATS_DIR, { recursive: true }); } catch {}
  try { await rm(LOREBOOKS_DIR, { recursive: true }); } catch {}
}

beforeAll(async () => {
  await cleanData();
  server = await startServer(PORT);
});

afterAll(async () => {
  server.stop(true);
  await cleanData();
});

// Helper: reset chats between tests (presets provide templates automatically)
async function cleanChats() {
  try { await rm(CHATS_DIR, { recursive: true }); } catch {}
}

function api(path: string, init?: RequestInit) {
  return fetch(BASE + path, init);
}

function jsonPost(path: string, body: object) {
  return fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jsonPut(path: string, body: object) {
  return fetch(BASE + path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// GET /api/adventures — picker
// ---------------------------------------------------------------------------

describe("GET /api/adventures", () => {
  beforeEach(cleanChats);

  test("returns template cards on a fresh state", async () => {
    const res = await api("/api/adventures");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.templates.length).toBeGreaterThan(0);
    expect(data.templates).toContainEqual(expect.objectContaining({ name: "Key Quest" }));
  });

  test("shows empty adventures when none have been started", async () => {
    const res = await api("/api/adventures");
    const data = await res.json();
    expect(data.adventures).toEqual([]);
  });

  test("does not show templates as adventures", async () => {
    const res = await api("/api/adventures");
    const data = await res.json();
    const slugs = data.adventures.map((a: { slug: string }) => a.slug);
    expect(slugs).not.toContain("default");
  });

  test("shows Continue data for adventures with conversations", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "my-quest", name: "My Quest" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "my-quest" });
    const chatData = await chatRes.json();
    expect(chatData.chatId).toBeTruthy();

    const res = await api("/api/adventures");
    const data = await res.json();
    const adv = data.adventures.find((a: { slug: string }) => a.slug === "my-quest");
    expect(adv).toBeTruthy();
    expect(adv.name).toBe("My Quest");
    expect(adv.latestChatId).toBe(chatData.chatId);
  });

  test("every adventure has slug, name, latestChatId fields", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "quest-btns", name: "Quest Buttons" });
    await jsonPost("/api/chats", { lorebook: "quest-btns" });

    const res = await api("/api/adventures");
    const data = await res.json();
    const adv = data.adventures.find((a: { slug: string }) => a.slug === "quest-btns");
    expect(adv).toBeTruthy();
    expect(adv.latestChatId).toBeTruthy();
    expect(adv.name).toBe("Quest Buttons");
  });

  test("orders adventures by last played (most recent first)", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "quest-old", name: "Old Quest" });
    await jsonPost("/api/chats", { lorebook: "quest-old" });

    await new Promise((r) => setTimeout(r, 15));

    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "quest-new", name: "New Quest" });
    await jsonPost("/api/chats", { lorebook: "quest-new" });

    const res = await api("/api/adventures");
    const data = await res.json();
    const names = data.adventures.map((a: { name: string }) => a.name);
    const newIdx = names.indexOf("New Quest");
    const oldIdx = names.indexOf("Old Quest");
    expect(newIdx).toBeGreaterThanOrEqual(0);
    expect(oldIdx).toBeGreaterThanOrEqual(0);
    expect(newIdx).toBeLessThan(oldIdx);
  });

  test("re-orders after a message updates an older adventure", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "quest-a", name: "Quest A" });
    const aRes = await jsonPost("/api/chats", { lorebook: "quest-a" });
    const aData = await aRes.json();

    await new Promise((r) => setTimeout(r, 15));

    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "quest-b", name: "Quest B" });
    await jsonPost("/api/chats", { lorebook: "quest-b" });

    // Quest B is now more recent. Now send a message to Quest A to make it most recent.
    await new Promise((r) => setTimeout(r, 15));
    await jsonPost("/api/chat", { message: "hello", chatId: aData.chatId, lorebook: "quest-a" });

    const res = await api("/api/adventures");
    const data = await res.json();
    const names = data.adventures.map((a: { name: string }) => a.name);
    expect(names.indexOf("Quest A")).toBeLessThan(names.indexOf("Quest B"));
  });
});

// ---------------------------------------------------------------------------
// POST /api/chats — create conversation with lorebook
// ---------------------------------------------------------------------------

describe("POST /api/chats", () => {
  beforeEach(cleanChats);

  test("returns chatId in JSON", async () => {
    const res = await jsonPost("/api/chats", { lorebook: "default" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.chatId).toBeTruthy();
    expect(data.chatId).toMatch(/^\d+-[0-9a-f]{3}$/);
  });

  test("binds conversation to lorebook", async () => {
    const res = await jsonPost("/api/chats", { lorebook: "my-adventure" });
    const data = await res.json();

    const listRes = await api("/api/chats?lorebook=my-adventure");
    const convos = await listRes.json();
    const ids = convos.map((c: { id: string }) => c.id);
    expect(ids).toContain(data.chatId);
  });

  test("conversation does not appear in other lorebook filters", async () => {
    await jsonPost("/api/chats", { lorebook: "adventure-x" });

    const listRes = await api("/api/chats?lorebook=adventure-y");
    const convos = await listRes.json();
    expect(convos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/chat — send message with lorebook
// ---------------------------------------------------------------------------

describe("POST /api/chat", () => {
  beforeEach(cleanChats);

  test("creates conversation bound to lorebook when no chatId given", async () => {
    const res = await jsonPost("/api/chat", { message: "hello", lorebook: "some-adventure" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.chatId).toBeTruthy();
    expect(data.isNew).toBe(true);

    const listRes = await api("/api/chats?lorebook=some-adventure");
    const convos = await listRes.json();
    const ids = convos.map((c: { id: string }) => c.id);
    expect(ids).toContain(data.chatId);
  });

  test("returns assistant message in messages array", async () => {
    const res = await jsonPost("/api/chat", { message: "hello", lorebook: "test" });
    const data = await res.json();
    const roles = data.messages.map((m: { role: string }) => m.role);
    expect(roles).toContain("assistant");
  });

  test("detects movement to existing location and changes location", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "chat-loc", name: "Chat Loc" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "chat-loc" });
    const chatData = await chatRes.json();

    const res = await jsonPost("/api/chat", {
      message: "I want to go to the village square",
      chatId: chatData.chatId,
      lorebook: "chat-loc",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const roles = data.messages.map((m: { role: string }) => m.role);
    expect(roles).toContain("system");
    expect(roles).toContain("assistant");
    const sysMsg = data.messages.find((m: { role: string }) => m.role === "system");
    expect(sysMsg.content).toContain("Village Square");
    expect(data.location).toBe("locations/village-square");
  });

  test("creates new location entry for unknown destination", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "chat-new-loc", name: "Chat New Loc" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "chat-new-loc" });
    const chatData = await chatRes.json();

    const res = await jsonPost("/api/chat", {
      message: "Let's go to the flower garden",
      chatId: chatData.chatId,
      lorebook: "chat-new-loc",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const sysMsg = data.messages.find((m: { role: string }) => m.role === "system");
    expect(sysMsg.content).toContain("flower garden");
    expect(data.location).toBe("locations/flower-garden");

    // Verify the new location appears in the locations list
    const locRes = await api("/api/adventures/locations?lorebook=chat-new-loc");
    const locs = await locRes.json();
    expect(locs.some((l: { name: string }) => l.name === "flower garden")).toBe(true);
  });

  test("no location change for non-movement messages", async () => {
    const res = await jsonPost("/api/chat", { message: "What is your name?", lorebook: "test" });
    const data = await res.json();
    const roles = data.messages.map((m: { role: string }) => m.role);
    expect(roles).not.toContain("system");
    expect(roles).toContain("assistant");
    expect(data.location).toBeNull();
  });

  test("no location detection without a lorebook", async () => {
    const res = await jsonPost("/api/chat", { message: "go to the tavern" });
    const data = await res.json();
    const roles = data.messages.map((m: { role: string }) => m.role);
    expect(roles).not.toContain("system");
    expect(data.location).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /api/chats/messages — render messages including system
// ---------------------------------------------------------------------------

describe("GET /api/chats/messages", () => {
  beforeEach(cleanChats);

  test("returns empty messages for new conversation", async () => {
    const chatRes = await jsonPost("/api/chats", { lorebook: "test" });
    const chatData = await chatRes.json();

    const res = await api(`/api/chats/messages?id=${chatData.chatId}`);
    const data = await res.json();
    expect(data.messages).toEqual([]);
  });

  test("returns user and assistant messages", async () => {
    const chatRes = await jsonPost("/api/chat", { message: "I enter the tavern", lorebook: "test" });
    const chatData = await chatRes.json();

    const res = await api(`/api/chats/messages?id=${chatData.chatId}`);
    const data = await res.json();
    const roles = data.messages.map((m: { role: string }) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
    const userMsg = data.messages.find((m: { role: string }) => m.role === "user");
    expect(userMsg.content).toContain("I enter the tavern");
  });

  test("returns system messages for location changes", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "msg-test", name: "Msg Test" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "msg-test" });
    const chatData = await chatRes.json();

    await jsonPut("/api/adventures/location", { chatId: chatData.chatId, location: "locations/village-square" });

    const res = await api(`/api/chats/messages?id=${chatData.chatId}`);
    const data = await res.json();
    const sysMsg = data.messages.find((m: { role: string }) => m.role === "system");
    expect(sysMsg).toBeTruthy();
    expect(sysMsg.content).toContain("Village Square");
  });

  test("returns 400 for missing id", async () => {
    const res = await api("/api/chats/messages");
    expect(res.status).toBe(400);
  });

  test("returns 404 for nonexistent conversation", async () => {
    const res = await api("/api/chats/messages?id=9999999999999-aaa");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/adventures/locations — location dropdown
// ---------------------------------------------------------------------------

describe("GET /api/adventures/locations", () => {
  test("returns location entries for a lorebook with locations", async () => {
    const res = await api("/api/adventures/locations?lorebook=template-key-quest");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(3);
    expect(data).toContainEqual(expect.objectContaining({ name: "The Village Square", path: "locations/village-square" }));
    expect(data).toContainEqual(expect.objectContaining({ name: "The Inn Cellar" }));
    expect(data).toContainEqual(expect.objectContaining({ name: "The Treasure Room" }));
  });

  test("returns empty array for lorebook with no locations", async () => {
    const res = await api("/api/adventures/locations?lorebook=default");
    const data = await res.json();
    expect(data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/adventures/location — change location
// ---------------------------------------------------------------------------

describe("PUT /api/adventures/location", () => {
  beforeEach(cleanChats);

  test("appends system narration and returns location + narration", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "loc-test", name: "Loc Test" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "loc-test" });
    const chatData = await chatRes.json();

    const res = await jsonPut("/api/adventures/location", {
      chatId: chatData.chatId,
      location: "locations/village-square",
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.location).toBe("locations/village-square");
    expect(data.narration).toContain("Village Square");
  });

  test("narration includes location entry content", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "loc-content", name: "Loc Content" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "loc-content" });
    const chatData = await chatRes.json();

    const res = await jsonPut("/api/adventures/location", {
      chatId: chatData.chatId,
      location: "locations/cellar",
    });
    const data = await res.json();
    expect(data.narration).toContain("Inn Cellar");
  });

  test("updates currentLocation in conversation meta", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "loc-meta", name: "Loc Meta" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "loc-meta" });
    const chatData = await chatRes.json();

    await jsonPut("/api/adventures/location", { chatId: chatData.chatId, location: "locations/village-square" });

    const pickRes = await api("/api/adventures");
    const pickData = await pickRes.json();
    const adv = pickData.adventures.find((a: { slug: string }) => a.slug === "loc-meta");
    expect(adv).toBeTruthy();
    expect(adv.currentLocation).toBe("locations/village-square");
    expect(adv.locationName).toBe("The Village Square");
  });

  test("returns 400 for missing chatId", async () => {
    const res = await jsonPut("/api/adventures/location", { location: "locations/foo" });
    expect(res.status).toBe(400);
  });

  test("returns 400 for missing location", async () => {
    const res = await jsonPut("/api/adventures/location", { chatId: "1234567890123-abc" });
    expect(res.status).toBe(400);
  });

  test("returns 404 for nonexistent conversation", async () => {
    const res = await jsonPut("/api/adventures/location", {
      chatId: "9999999999999-aaa",
      location: "locations/foo",
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/adventures — delete adventure
// ---------------------------------------------------------------------------

describe("DELETE /api/adventures", () => {
  beforeEach(cleanChats);

  test("deletes lorebook and its conversations", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "to-delete", name: "To Delete" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "to-delete" });
    const chatData = await chatRes.json();

    const delRes = await api("/api/adventures?lorebook=to-delete", { method: "DELETE" });
    expect(delRes.status).toBe(200);
    const delData = await delRes.json();
    expect(delData.ok).toBe(true);

    // Adventure should no longer appear in picker
    const pickRes = await api("/api/adventures");
    const pickData = await pickRes.json();
    const slugs = pickData.adventures.map((a: { slug: string }) => a.slug);
    expect(slugs).not.toContain("to-delete");

    // Conversation should be gone
    const msgRes = await api(`/api/chats/messages?id=${chatData.chatId}`);
    expect(msgRes.status).toBe(404);
  });

  test("returns 400 for missing lorebook param", async () => {
    const res = await api("/api/adventures", { method: "DELETE" });
    expect(res.status).toBe(400);
  });

  test("can delete any adventure", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "deletable-adv", name: "Deletable Adventure" });
    await jsonPost("/api/chats", { lorebook: "deletable-adv" });

    const res = await api("/api/adventures?lorebook=deletable-adv", { method: "DELETE" });
    expect(res.status).toBe(200);

    const pickRes = await api("/api/adventures");
    const pickData = await pickRes.json();
    const slugs = pickData.adventures.map((a: { slug: string }) => a.slug);
    expect(slugs).not.toContain("deletable-adv");
  });

  test("returns ok after deletion", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "del-a", name: "Del A" });
    await jsonPost("/api/chats", { lorebook: "del-a" });
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "del-b", name: "Del B" });
    await jsonPost("/api/chats", { lorebook: "del-b" });

    const delRes = await api("/api/adventures?lorebook=del-a", { method: "DELETE" });
    const delData = await delRes.json();
    expect(delData.ok).toBe(true);

    // Del A gone, Del B still there
    const pickRes = await api("/api/adventures");
    const pickData = await pickRes.json();
    const names = pickData.adventures.map((a: { name: string }) => a.name);
    expect(names).not.toContain("Del A");
    expect(names).toContain("Del B");
  });
});

// ---------------------------------------------------------------------------
// GET /api/adventures/resume — resume adventure by lorebook
// ---------------------------------------------------------------------------

describe("GET /api/adventures/resume", () => {
  beforeEach(cleanChats);

  test("returns JSON with chatId, lorebook, name, location", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "resume-test", name: "Resume Test" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "resume-test" });
    const chatData = await chatRes.json();

    await jsonPut("/api/adventures/location", { chatId: chatData.chatId, location: "locations/village-square" });

    const res = await api("/api/adventures/resume?lorebook=resume-test");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.lorebook).toBe("resume-test");
    expect(data.chatId).toBe(chatData.chatId);
    expect(data.name).toBe("Resume Test");
    expect(data.location).toBe("locations/village-square");
  });

  test("returns 404 for lorebook with no conversations", async () => {
    const res = await api("/api/adventures/resume?lorebook=template-key-quest");
    expect(res.status).toBe(404);
  });

  test("returns 404 for nonexistent lorebook", async () => {
    const res = await api("/api/adventures/resume?lorebook=does-not-exist");
    expect(res.status).toBe(404);
  });

  test("returns the most recent conversation when multiple exist", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "resume-multi", name: "Resume Multi" });
    const chat1Res = await jsonPost("/api/chats", { lorebook: "resume-multi" });
    const chat1Data = await chat1Res.json();

    await new Promise((r) => setTimeout(r, 15));

    const chat2Res = await jsonPost("/api/chats", { lorebook: "resume-multi" });
    const chat2Data = await chat2Res.json();

    const res = await api("/api/adventures/resume?lorebook=resume-multi");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.chatId).toBe(chat2Data.chatId);
  });
});

// ---------------------------------------------------------------------------
// GET /api/adventures/active-entries — active lorebook entries
// ---------------------------------------------------------------------------

describe("GET /api/adventures/active-entries", () => {
  beforeEach(cleanChats);

  test("returns active entries for a conversation", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "active-test", name: "Active Test" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "active-test" });
    const chatData = await chatRes.json();

    await jsonPut("/api/adventures/location", { chatId: chatData.chatId, location: "locations/village-square" });
    await jsonPost("/api/chat", { message: "I talk to the sage", chatId: chatData.chatId, lorebook: "active-test" });

    const res = await api("/api/adventures/active-entries?chatId=" + chatData.chatId);
    expect(res.status).toBe(200);
    const data = await res.json();
    // Village Square should be active (current location)
    expect(data.entries.some((e: { name: string }) => e.name.includes("Village Square"))).toBe(true);
    // The sage should be active
    expect(data.entries.some((e: { name: string }) => e.name.includes("Old Sage"))).toBe(true);
  });

  test("returns 400 for missing chatId", async () => {
    const res = await api("/api/adventures/active-entries");
    expect(res.status).toBe(400);
  });

  test("returns 404 for nonexistent conversation", async () => {
    const res = await api("/api/adventures/active-entries?chatId=9999999999999-aaa");
    expect(res.status).toBe(404);
  });

  test("includes traits in response", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "trait-html-test", name: "Trait HTML" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "trait-html-test" });
    const chatData = await chatRes.json();

    const res = await api("/api/adventures/active-entries?chatId=" + chatData.chatId);
    const data = await res.json();
    expect(data.traits).toBeDefined();
    expect(Array.isArray(data.traits)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/adventures/traits — update player traits
// ---------------------------------------------------------------------------

describe("PUT /api/adventures/traits", () => {
  beforeEach(cleanChats);

  test("updates traits and returns active entries", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "traits-test", name: "Traits Test" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "traits-test" });
    const chatData = await chatRes.json();

    const res = await jsonPut("/api/adventures/traits", { chatId: chatData.chatId, traits: ["warrior", "stealthy"] });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.traits).toContain("warrior");
    expect(data.traits).toContain("stealthy");
    expect(Array.isArray(data.entries)).toBe(true);
  });

  test("returns 400 for missing chatId", async () => {
    const res = await jsonPut("/api/adventures/traits", { traits: ["warrior"] });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// JSON response format (replaces HX-Trigger tests)
// ---------------------------------------------------------------------------

describe("JSON response format", () => {
  beforeEach(cleanChats);

  test("POST /api/chat returns JSON with messages array", async () => {
    const res = await jsonPost("/api/chat", { message: "hello", lorebook: "test" });
    const data = await res.json();
    expect(data.messages).toBeDefined();
    expect(Array.isArray(data.messages)).toBe(true);
    expect(data.chatId).toBeTruthy();
  });

  test("PUT /api/adventures/location returns JSON with location and narration", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "trigger-test", name: "Trigger Test" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "trigger-test" });
    const chatData = await chatRes.json();

    const res = await jsonPut("/api/adventures/location", { chatId: chatData.chatId, location: "locations/village-square" });
    const data = await res.json();
    expect(data.location).toBe("locations/village-square");
    expect(data.narration).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Full adventure flow
// ---------------------------------------------------------------------------

describe("full adventure flow", () => {
  beforeEach(cleanChats);

  test("start from template → play → change location → back → continue", async () => {
    // 1. Copy template
    const copyRes = await jsonPost("/api/lorebooks/copy", {
      source: "template-key-quest",
      slug: "flow-test",
      name: "Flow Test",
    });
    expect(copyRes.status).toBe(200);

    // 2. Create conversation
    const chatRes = await jsonPost("/api/chats", { lorebook: "flow-test" });
    expect(chatRes.status).toBe(200);
    const chatData = await chatRes.json();
    expect(chatData.chatId).toBeTruthy();

    // 3. Load locations
    const locRes = await api("/api/adventures/locations?lorebook=flow-test");
    const locs = await locRes.json();
    expect(locs.some((l: { name: string }) => l.name.includes("Village Square"))).toBe(true);

    // 4. Change location
    const moveRes = await jsonPut("/api/adventures/location", {
      chatId: chatData.chatId,
      location: "locations/village-square",
    });
    expect(moveRes.status).toBe(200);
    const moveData = await moveRes.json();
    expect(moveData.narration).toBeTruthy();

    // 5. Send a message
    const msgRes = await jsonPost("/api/chat", {
      message: "I look around",
      chatId: chatData.chatId,
      lorebook: "flow-test",
    });
    expect(msgRes.status).toBe(200);

    // 6. Load all messages — should have system + user + assistant
    const allMsgRes = await api(`/api/chats/messages?id=${chatData.chatId}`);
    const allMsgData = await allMsgRes.json();
    const roles = allMsgData.messages.map((m: { role: string }) => m.role);
    expect(roles).toContain("system");
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
    const userMsg = allMsgData.messages.find((m: { content: string }) => m.content === "I look around");
    expect(userMsg).toBeTruthy();

    // 7. Check picker shows the adventure
    const pickRes = await api("/api/adventures");
    const pickData = await pickRes.json();
    const adv = pickData.adventures.find((a: { slug: string }) => a.slug === "flow-test");
    expect(adv).toBeTruthy();
    expect(adv.name).toBe("Flow Test");
    expect(adv.latestChatId).toBe(chatData.chatId);
    expect(adv.currentLocation).toBe("locations/village-square");

    // 8. Change location again
    const move2Res = await jsonPut("/api/adventures/location", {
      chatId: chatData.chatId,
      location: "locations/cellar",
    });
    expect(move2Res.status).toBe(200);

    // 9. Picker should now show updated location
    const pick2Res = await api("/api/adventures");
    const pick2Data = await pick2Res.json();
    const adv2 = pick2Data.adventures.find((a: { slug: string }) => a.slug === "flow-test");
    expect(adv2.currentLocation).toBe("locations/cellar");
  });
});
