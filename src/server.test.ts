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
    const html = await res.text();
    // Template section with Key Quest
    expect(html).toContain("Start New Adventure");
    expect(html).toContain("Key Quest");
    expect(html).toContain("adventure-start-btn");
    expect(html).toContain('data-template="template-key-quest"');
  });

  test("shows empty-state message when no adventures have been started", async () => {
    const res = await api("/api/adventures");
    const html = await res.text();
    expect(html).toContain("No adventures yet");
  });

  test("does not show templates as adventures", async () => {
    // "default" lorebook is a template (migrated at startup) and should not appear as an adventure
    const res = await api("/api/adventures");
    const html = await res.text();
    expect(html).not.toContain("adventure-continue-btn");
    expect(html).not.toContain('data-lorebook="default"');
  });

  test("shows Continue button for adventures with conversations", async () => {
    // Copy template and create a conversation for it
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "my-quest", name: "My Quest" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "my-quest" });
    const chatId = chatRes.headers.get("X-Chat-Id");
    expect(chatId).toBeTruthy();

    const res = await api("/api/adventures");
    const html = await res.text();
    expect(html).toContain("Your Adventures");
    expect(html).toContain("My Quest");
    expect(html).toContain("adventure-continue-btn");
    expect(html).toContain(`data-chat-id="${chatId}"`);
    expect(html).toContain('data-lorebook="my-quest"');
  });

  test("every adventure card has both Continue and Delete buttons", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "quest-btns", name: "Quest Buttons" });
    await jsonPost("/api/chats", { lorebook: "quest-btns" });

    const res = await api("/api/adventures");
    const html = await res.text();
    // Find the adventure card
    expect(html).toContain("adventure-continue-btn");
    expect(html).toContain("adventure-delete-btn");
  });

  test("orders adventures by last played (most recent first)", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "quest-old", name: "Old Quest" });
    const oldRes = await jsonPost("/api/chats", { lorebook: "quest-old" });
    const oldChatId = oldRes.headers.get("X-Chat-Id");

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 15));

    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "quest-new", name: "New Quest" });
    await jsonPost("/api/chats", { lorebook: "quest-new" });

    const res = await api("/api/adventures");
    const html = await res.text();

    // "New Quest" should appear before "Old Quest"
    const newIdx = html.indexOf("New Quest");
    const oldIdx = html.indexOf("Old Quest");
    expect(newIdx).toBeGreaterThan(-1);
    expect(oldIdx).toBeGreaterThan(-1);
    expect(newIdx).toBeLessThan(oldIdx);
  });

  test("re-orders after a message updates an older adventure", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "quest-a", name: "Quest A" });
    const aRes = await jsonPost("/api/chats", { lorebook: "quest-a" });
    const aChatId = aRes.headers.get("X-Chat-Id");

    await new Promise((r) => setTimeout(r, 15));

    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "quest-b", name: "Quest B" });
    await jsonPost("/api/chats", { lorebook: "quest-b" });

    // Quest B is now more recent. Now send a message to Quest A to make it most recent.
    await new Promise((r) => setTimeout(r, 15));
    await jsonPost("/api/chat", { message: "hello", chatId: aChatId, lorebook: "quest-a" });

    const res = await api("/api/adventures");
    const html = await res.text();
    const aIdx = html.indexOf("Quest A");
    const bIdx = html.indexOf("Quest B");
    expect(aIdx).toBeLessThan(bIdx);
  });
});

// ---------------------------------------------------------------------------
// POST /api/chats — create conversation with lorebook
// ---------------------------------------------------------------------------

describe("POST /api/chats", () => {
  beforeEach(cleanChats);

  test("returns X-Chat-Id header", async () => {
    const res = await jsonPost("/api/chats", { lorebook: "default" });
    expect(res.status).toBe(200);
    const chatId = res.headers.get("X-Chat-Id");
    expect(chatId).toBeTruthy();
    expect(chatId).toMatch(/^\d+-[0-9a-f]{3}$/);
  });

  test("binds conversation to lorebook", async () => {
    const res = await jsonPost("/api/chats", { lorebook: "my-adventure" });
    const chatId = res.headers.get("X-Chat-Id")!;

    // Verify by loading messages and checking via the chats list
    const listRes = await api("/api/chats?lorebook=my-adventure");
    const listHtml = await listRes.text();
    expect(listHtml).toContain(chatId);
  });

  test("conversation does not appear in other lorebook filters", async () => {
    await jsonPost("/api/chats", { lorebook: "adventure-x" });

    const listRes = await api("/api/chats?lorebook=adventure-y");
    const listHtml = await listRes.text();
    expect(listHtml).not.toContain("chat-list-item");
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
    const chatId = res.headers.get("X-Chat-Id");
    expect(chatId).toBeTruthy();

    // Verify it appears under the correct lorebook filter
    const listRes = await api("/api/chats?lorebook=some-adventure");
    const listHtml = await listRes.text();
    expect(listHtml).toContain(chatId!);
  });

  test("returns assistant message HTML", async () => {
    const res = await jsonPost("/api/chat", { message: "hello", lorebook: "test" });
    const html = await res.text();
    expect(html).toContain("chat-msg-assistant");
  });

  test("detects movement to existing location and changes location", async () => {
    // Copy key-quest so we have a writable adventure with locations
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "chat-loc", name: "Chat Loc" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "chat-loc" });
    const chatId = chatRes.headers.get("X-Chat-Id")!;

    const res = await jsonPost("/api/chat", {
      message: "I want to go to the village square",
      chatId,
      lorebook: "chat-loc",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("chat-msg-system");
    expect(html).toContain("Village Square");
    expect(html).toContain("chat-msg-assistant");
    expect(res.headers.get("X-Location")).toBe("locations/village-square");
  });

  test("creates new location entry for unknown destination", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "chat-new-loc", name: "Chat New Loc" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "chat-new-loc" });
    const chatId = chatRes.headers.get("X-Chat-Id")!;

    const res = await jsonPost("/api/chat", {
      message: "Let's go to the flower garden",
      chatId,
      lorebook: "chat-new-loc",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("chat-msg-system");
    expect(html).toContain("flower garden");
    expect(html).toContain("chat-msg-assistant");
    expect(res.headers.get("X-Location")).toBe("locations/flower-garden");

    // Verify the new location appears in the dropdown
    const locRes = await api("/api/adventures/locations?lorebook=chat-new-loc");
    const locHtml = await locRes.text();
    expect(locHtml).toContain("flower garden");
  });

  test("no location change for non-movement messages", async () => {
    const res = await jsonPost("/api/chat", { message: "What is your name?", lorebook: "test" });
    const html = await res.text();
    expect(html).not.toContain("chat-msg-system");
    expect(html).toContain("chat-msg-assistant");
    expect(res.headers.get("X-Location")).toBeNull();
  });

  test("no location detection without a lorebook", async () => {
    const res = await jsonPost("/api/chat", { message: "go to the tavern" });
    const html = await res.text();
    expect(html).not.toContain("chat-msg-system");
    expect(res.headers.get("X-Location")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /api/chats/messages — render messages including system
// ---------------------------------------------------------------------------

describe("GET /api/chats/messages", () => {
  beforeEach(cleanChats);

  test("returns placeholder for empty conversation", async () => {
    const chatRes = await jsonPost("/api/chats", { lorebook: "test" });
    const chatId = chatRes.headers.get("X-Chat-Id")!;

    const res = await api(`/api/chats/messages?id=${chatId}`);
    const html = await res.text();
    expect(html).toContain("Your adventure begins");
  });

  test("renders user and assistant messages", async () => {
    const chatRes = await jsonPost("/api/chat", { message: "I enter the tavern", lorebook: "test" });
    const chatId = chatRes.headers.get("X-Chat-Id")!;

    const res = await api(`/api/chats/messages?id=${chatId}`);
    const html = await res.text();
    expect(html).toContain("chat-msg-user");
    expect(html).toContain("I enter the tavern");
    expect(html).toContain("chat-msg-assistant");
  });

  test("renders system messages with system styling", async () => {
    // Create a conversation and change location to generate a system message
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "msg-test", name: "Msg Test" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "msg-test" });
    const chatId = chatRes.headers.get("X-Chat-Id")!;

    await jsonPut("/api/adventures/location", { chatId, location: "locations/village-square" });

    const res = await api(`/api/chats/messages?id=${chatId}`);
    const html = await res.text();
    expect(html).toContain("chat-msg-system");
    expect(html).toContain("Village Square");
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
  test("returns location options for a lorebook with locations", async () => {
    const res = await api("/api/adventures/locations?lorebook=template-key-quest");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<option");
    expect(html).toContain("The Village Square");
    expect(html).toContain("The Inn Cellar");
    expect(html).toContain("The Treasure Room");
    expect(html).toContain('value="locations/village-square"');
  });

  test("includes a blank placeholder option", async () => {
    const res = await api("/api/adventures/locations?lorebook=template-key-quest");
    const html = await res.text();
    expect(html).toContain("-- Choose a location --");
  });

  test("returns only placeholder for lorebook with no locations", async () => {
    const res = await api("/api/adventures/locations?lorebook=default");
    const html = await res.text();
    // Only the placeholder option
    const optionCount = (html.match(/<option/g) || []).length;
    expect(optionCount).toBe(1);
    expect(html).toContain("-- Choose a location --");
  });
});

// ---------------------------------------------------------------------------
// PUT /api/adventures/location — change location
// ---------------------------------------------------------------------------

describe("PUT /api/adventures/location", () => {
  beforeEach(cleanChats);

  test("appends system narration message and returns it", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "loc-test", name: "Loc Test" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "loc-test" });
    const chatId = chatRes.headers.get("X-Chat-Id")!;

    const res = await jsonPut("/api/adventures/location", {
      chatId,
      location: "locations/village-square",
    });
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("chat-msg-system");
    expect(html).toContain("Village Square");

    // Verify X-Location header
    expect(res.headers.get("X-Location")).toBe("locations/village-square");
  });

  test("narration includes location entry content", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "loc-content", name: "Loc Content" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "loc-content" });
    const chatId = chatRes.headers.get("X-Chat-Id")!;

    const res = await jsonPut("/api/adventures/location", {
      chatId,
      location: "locations/cellar",
    });
    const html = await res.text();
    // The Inn Cellar entry content mentions barrels of ale
    expect(html).toContain("Inn Cellar");
  });

  test("updates currentLocation in conversation meta", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "loc-meta", name: "Loc Meta" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "loc-meta" });
    const chatId = chatRes.headers.get("X-Chat-Id")!;

    await jsonPut("/api/adventures/location", { chatId, location: "locations/village-square" });

    // The adventure picker should show the updated location
    const pickRes = await api("/api/adventures");
    const pickHtml = await pickRes.text();
    expect(pickHtml).toContain('data-location="locations/village-square"');
    // Location display name should appear on the card
    expect(pickHtml).toContain("Location: The Village Square");
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
    // The loadConversation returns null, which becomes a 404
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
    const chatId = chatRes.headers.get("X-Chat-Id")!;

    const delRes = await api("/api/adventures?lorebook=to-delete", { method: "DELETE" });
    expect(delRes.status).toBe(200);

    // Adventure should no longer appear in picker
    const pickRes = await api("/api/adventures");
    const pickHtml = await pickRes.text();
    expect(pickHtml).not.toContain("To Delete");
    expect(pickHtml).not.toContain('data-lorebook="to-delete"');

    // Conversation should be gone
    const msgRes = await api(`/api/chats/messages?id=${chatId}`);
    expect(msgRes.status).toBe(404);
  });

  test("returns 400 for missing lorebook param", async () => {
    const res = await api("/api/adventures", { method: "DELETE" });
    expect(res.status).toBe(400);
  });

  test("can delete any adventure including former default", async () => {
    // Create a non-template copy to act as adventure
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "deletable-adv", name: "Deletable Adventure" });
    await jsonPost("/api/chats", { lorebook: "deletable-adv" });

    const res = await api("/api/adventures?lorebook=deletable-adv", { method: "DELETE" });
    expect(res.status).toBe(200);

    const pickRes = await api("/api/adventures");
    const pickHtml = await pickRes.text();
    expect(pickHtml).not.toContain("Deletable Adventure");
  });

  test("returns updated picker after deletion", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "del-a", name: "Del A" });
    await jsonPost("/api/chats", { lorebook: "del-a" });
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "del-b", name: "Del B" });
    await jsonPost("/api/chats", { lorebook: "del-b" });

    const delRes = await api("/api/adventures?lorebook=del-a", { method: "DELETE" });
    const html = await delRes.text();

    // Del A gone, Del B still there
    expect(html).not.toContain("Del A");
    expect(html).toContain("Del B");
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
    const chatId = chatRes.headers.get("X-Chat-Id")!;

    // Change location so we can verify it's returned
    await jsonPut("/api/adventures/location", { chatId, location: "locations/village-square" });

    const res = await api("/api/adventures/resume?lorebook=resume-test");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.lorebook).toBe("resume-test");
    expect(data.chatId).toBe(chatId);
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
    const chatId1 = chat1Res.headers.get("X-Chat-Id")!;

    await new Promise((r) => setTimeout(r, 15));

    const chat2Res = await jsonPost("/api/chats", { lorebook: "resume-multi" });
    const chatId2 = chat2Res.headers.get("X-Chat-Id")!;

    const res = await api("/api/adventures/resume?lorebook=resume-multi");
    expect(res.status).toBe(200);
    const data = await res.json();
    // Should return the most recent conversation (chat2)
    expect(data.chatId).toBe(chatId2);
  });
});

// ---------------------------------------------------------------------------
// GET /api/adventures/active-entries — active lorebook entries
// ---------------------------------------------------------------------------

describe("GET /api/adventures/active-entries", () => {
  beforeEach(cleanChats);

  test("returns active entries HTML for a conversation", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "active-test", name: "Active Test" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "active-test" });
    const chatId = chatRes.headers.get("X-Chat-Id")!;

    // Change location to village-square so NPCs can activate
    await jsonPut("/api/adventures/location", { chatId, location: "locations/village-square" });

    // Send a message mentioning the sage
    await jsonPost("/api/chat", { message: "I talk to the sage", chatId, lorebook: "active-test" });

    const res = await api("/api/adventures/active-entries?chatId=" + chatId);
    expect(res.status).toBe(200);
    const html = await res.text();
    // Village Square should be active (current location)
    expect(html).toContain("Village Square");
    // The sage should be active (context: village-square is active + keyword match)
    expect(html).toContain("Old Sage");
  });

  test("returns 400 for missing chatId", async () => {
    const res = await api("/api/adventures/active-entries");
    expect(res.status).toBe(400);
  });

  test("returns 404 for nonexistent conversation", async () => {
    const res = await api("/api/adventures/active-entries?chatId=9999999999999-aaa");
    expect(res.status).toBe(404);
  });

  test("includes traits section in HTML", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "trait-html-test", name: "Trait HTML" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "trait-html-test" });
    const chatId = chatRes.headers.get("X-Chat-Id")!;

    const res = await api("/api/adventures/active-entries?chatId=" + chatId);
    const html = await res.text();
    expect(html).toContain("trait-add-form");
    expect(html).toContain("Traits");
  });
});

// ---------------------------------------------------------------------------
// PUT /api/adventures/traits — update player traits
// ---------------------------------------------------------------------------

describe("PUT /api/adventures/traits", () => {
  beforeEach(cleanChats);

  test("updates traits and returns active entries HTML", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "traits-test", name: "Traits Test" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "traits-test" });
    const chatId = chatRes.headers.get("X-Chat-Id")!;

    const res = await jsonPut("/api/adventures/traits", { chatId, traits: ["warrior", "stealthy"] });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("warrior");
    expect(html).toContain("stealthy");
    expect(html).toContain("trait-tag");
  });

  test("returns 400 for missing chatId", async () => {
    const res = await jsonPut("/api/adventures/traits", { traits: ["warrior"] });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// HX-Trigger: refreshActiveEntries
// ---------------------------------------------------------------------------

describe("refreshActiveEntries trigger", () => {
  beforeEach(cleanChats);

  test("POST /api/chat includes refreshActiveEntries in HX-Trigger", async () => {
    const res = await jsonPost("/api/chat", { message: "hello", lorebook: "test" });
    const trigger = res.headers.get("HX-Trigger");
    expect(trigger).toContain("refreshActiveEntries");
  });

  test("PUT /api/adventures/location includes refreshActiveEntries in HX-Trigger", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "trigger-test", name: "Trigger Test" });
    const chatRes = await jsonPost("/api/chats", { lorebook: "trigger-test" });
    const chatId = chatRes.headers.get("X-Chat-Id")!;

    const res = await jsonPut("/api/adventures/location", { chatId, location: "locations/village-square" });
    const trigger = res.headers.get("HX-Trigger");
    expect(trigger).toContain("refreshActiveEntries");
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
    const chatId = chatRes.headers.get("X-Chat-Id")!;
    expect(chatId).toBeTruthy();

    // 3. Load locations
    const locRes = await api("/api/adventures/locations?lorebook=flow-test");
    const locHtml = await locRes.text();
    expect(locHtml).toContain("The Village Square");

    // 4. Change location
    const moveRes = await jsonPut("/api/adventures/location", {
      chatId,
      location: "locations/village-square",
    });
    expect(moveRes.status).toBe(200);
    const moveHtml = await moveRes.text();
    expect(moveHtml).toContain("chat-msg-system");

    // 5. Send a message
    const msgRes = await jsonPost("/api/chat", {
      message: "I look around",
      chatId,
      lorebook: "flow-test",
    });
    expect(msgRes.status).toBe(200);

    // 6. Load all messages — should have system + user + assistant
    const allMsgRes = await api(`/api/chats/messages?id=${chatId}`);
    const allMsgHtml = await allMsgRes.text();
    expect(allMsgHtml).toContain("chat-msg-system");
    expect(allMsgHtml).toContain("chat-msg-user");
    expect(allMsgHtml).toContain("I look around");
    expect(allMsgHtml).toContain("chat-msg-assistant");

    // 7. Check picker shows the adventure with Continue
    const pickRes = await api("/api/adventures");
    const pickHtml = await pickRes.text();
    expect(pickHtml).toContain("Flow Test");
    expect(pickHtml).toContain("adventure-continue-btn");
    expect(pickHtml).toContain(`data-chat-id="${chatId}"`);
    expect(pickHtml).toContain('data-location="locations/village-square"');

    // 8. Change location again
    const move2Res = await jsonPut("/api/adventures/location", {
      chatId,
      location: "locations/cellar",
    });
    expect(move2Res.status).toBe(200);

    // 9. Picker should now show updated location
    const pick2Res = await api("/api/adventures");
    const pick2Html = await pick2Res.text();
    expect(pick2Html).toContain('data-location="locations/cellar"');
  });
});
