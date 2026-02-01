import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from "bun:test";
import { resolve, join } from "path";
import { rm, readdir } from "fs/promises";
import type { Server } from "bun";
import {
  saveEntry,
  loadEntry,
  createFolder,
  createLorebook,
} from "../src/lorebook";
import { startServer } from "../src/server";

const LOREBOOKS_DIR = resolve(join(import.meta.dir, "..", "data-test", "lorebooks"));

async function cleanLorebooks() {
  try {
    await rm(LOREBOOKS_DIR, { recursive: true });
  } catch {
    // doesn't exist yet
  }
}

describe("lorebook API routes", () => {
  let server: Server;
  let BASE: string;

  beforeAll(async () => {
    const port = 13000 + Math.floor(Math.random() * 1000);
    server = await startServer(port);
    BASE = `http://localhost:${port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  beforeEach(cleanLorebooks);
  afterEach(cleanLorebooks);

  test("GET /api/lorebook/tree returns JSON with empty state", async () => {
    await createLorebook("default", "Default Lorebook");
    const res = await fetch(`${BASE}/api/lorebook/tree?lorebook=default`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    expect(data.nodes).toEqual([]);
    expect(data.readonly).toBe(false);
  });

  test("GET /api/lorebook/entry returns entry data for new entry", async () => {
    await createLorebook("default", "Default Lorebook");
    const res = await fetch(`${BASE}/api/lorebook/entry?path=test-new&lorebook=default`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.path).toBe("test-new");
    expect(data.isNew).toBe(true);
  });

  test("GET /api/lorebook/entry returns 400 without path", async () => {
    const res = await fetch(`${BASE}/api/lorebook/entry?lorebook=default`);
    expect(res.status).toBe(400);
  });

  test("POST /api/lorebook/entry creates an entry", async () => {
    await createLorebook("default", "Default Lorebook");
    const res = await fetch(`${BASE}/api/lorebook/entry?path=locations/tavern&lorebook=default`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "The Rusty Tankard",
        content: "A dimly lit tavern.",
        keywords: "tavern, rusty tankard",
        regex: "",
        priority: 10,
        enabled: true,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.entry.name).toBe("The Rusty Tankard");

    // Verify it persisted
    const loaded = await loadEntry("default", "locations/tavern");
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("The Rusty Tankard");
    expect(loaded!.keywords).toEqual(["tavern", "rusty tankard"]);
  });

  test("POST /api/lorebook/entry returns 400 for invalid data", async () => {
    await createLorebook("default", "Default Lorebook");
    const res = await fetch(`${BASE}/api/lorebook/entry?path=bad&lorebook=default`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "no name" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Name is required");
  });

  test("PUT /api/lorebook/entry updates an existing entry", async () => {
    await createLorebook("default", "Default Lorebook");
    await saveEntry("default", "update-me", {
      name: "Original",
      content: "Old content.",
      keywords: ["old"],
      regex: "",
      priority: 1,
      enabled: true,
      contexts: [],
    });

    const res = await fetch(`${BASE}/api/lorebook/entry?path=update-me&lorebook=default`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Updated",
        content: "New content.",
        keywords: "new, updated",
        regex: "",
        priority: 5,
        enabled: true,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    const loaded = await loadEntry("default", "update-me");
    expect(loaded!.name).toBe("Updated");
    expect(loaded!.priority).toBe(5);
  });

  test("DELETE /api/lorebook/entry removes an entry", async () => {
    await createLorebook("default", "Default Lorebook");
    await saveEntry("default", "delete-me", {
      name: "To Delete",
      content: "",
      keywords: [],
      regex: "",
      priority: 0,
      enabled: true,
      contexts: [],
    });

    const res = await fetch(`${BASE}/api/lorebook/entry?path=delete-me&lorebook=default`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    expect(await loadEntry("default", "delete-me")).toBeNull();
  });

  test("POST /api/lorebook/folder creates a folder", async () => {
    await createLorebook("default", "Default Lorebook");
    const res = await fetch(`${BASE}/api/lorebook/folder?lorebook=default`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "test-folder" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    const contents = await readdir(join(LOREBOOKS_DIR, "default"));
    expect(contents).toContain("test-folder");
  });

  test("DELETE /api/lorebook/folder removes a folder", async () => {
    await createLorebook("default", "Default Lorebook");
    await createFolder("default", "remove-folder");
    const res = await fetch(`${BASE}/api/lorebook/folder?path=remove-folder&lorebook=default`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    const contents = await readdir(join(LOREBOOKS_DIR, "default")).catch(() => []);
    expect(contents).not.toContain("remove-folder");
  });

  test("GET /api/lorebook/entry returns existing entry data", async () => {
    await createLorebook("default", "Default Lorebook");
    await saveEntry("default", "existing", {
      name: "Existing Entry",
      content: "Some content.",
      keywords: ["foo", "bar"],
      regex: "test.*",
      priority: 7,
      enabled: true,
      contexts: [],
    });

    const res = await fetch(`${BASE}/api/lorebook/entry?path=existing&lorebook=default`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entry.name).toBe("Existing Entry");
    expect(data.isNew).toBe(false);
    expect(data.entry.keywords).toEqual(["foo", "bar"]);
  });

  test("GET /api/lorebook/tree shows entries after creation", async () => {
    await createLorebook("default", "Default Lorebook");
    await saveEntry("default", "people/gabrielle", {
      name: "Gabrielle",
      content: "",
      keywords: [],
      regex: "",
      priority: 0,
      enabled: true,
      contexts: [],
    });

    const res = await fetch(`${BASE}/api/lorebook/tree?lorebook=default`);
    const data = await res.json();
    // Should have a "people" folder with "Gabrielle" entry inside
    const peopleNode = data.nodes.find((n: { name: string }) => n.name === "people");
    expect(peopleNode).toBeTruthy();
    const gabNode = peopleNode.children.find((n: { name: string }) => n.name === "Gabrielle");
    expect(gabNode).toBeTruthy();
  });

  // --- Lorebook management API tests ---

  test("GET /api/lorebooks returns JSON with templates", async () => {
    await createLorebook("default", "Default Lorebook", true);
    const res = await fetch(`${BASE}/api/lorebooks`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.templates).toBeDefined();
    expect(data.templates.some((t: { name: string }) => t.name === "Default Lorebook")).toBe(true);
  });

  test("POST /api/lorebooks creates a lorebook", async () => {
    const res = await fetch(`${BASE}/api/lorebooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "homebrew", name: "Homebrew Setting" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    // Verify it shows up in the list
    const listRes = await fetch(`${BASE}/api/lorebooks`);
    const listData = await listRes.json();
    expect(listData.templates.some((t: { name: string }) => t.name === "Homebrew Setting")).toBe(true);
  });

  test("DELETE /api/lorebooks removes a lorebook", async () => {
    await createLorebook("to-remove", "Remove Me");
    const res = await fetch(`${BASE}/api/lorebooks?slug=to-remove`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  test("DELETE /api/lorebooks returns 403 for preset lorebook", async () => {
    const res = await fetch(`${BASE}/api/lorebooks?slug=default`, {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
  });

  test("tree returns nodes and readonly flag", async () => {
    await createLorebook("default", "Default Lorebook");
    await saveEntry("default", "people/gabrielle", {
      name: "Gabrielle",
      content: "",
      keywords: [],
      regex: "",
      priority: 0,
      enabled: true,
      contexts: [],
    });

    const res = await fetch(`${BASE}/api/lorebook/tree?lorebook=default`);
    const data = await res.json();
    expect(data.readonly).toBe(false);
    expect(data.nodes.length).toBeGreaterThan(0);
  });

  test("entry response includes lorebook context", async () => {
    await createLorebook("homebrew", "Homebrew");
    const res = await fetch(`${BASE}/api/lorebook/entry?path=dragon&lorebook=homebrew`);
    const data = await res.json();
    expect(data.path).toBe("dragon");
    expect(data.isNew).toBe(true);
  });

  // --- Template API tests ---

  test("POST /api/lorebooks/copy copies a lorebook", async () => {
    await createLorebook("default", "Default Lorebook");
    await saveEntry("default", "hero", {
      name: "Hero",
      content: "The hero.",
      keywords: ["hero"],
      regex: "",
      priority: 0,
      enabled: true,
      contexts: [],
    });

    const res = await fetch(`${BASE}/api/lorebooks/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "default", slug: "my-copy", name: "My Copy" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    // Verify the copy has the entry
    const hero = await loadEntry("my-copy", "hero");
    expect(hero).not.toBeNull();
    expect(hero!.name).toBe("Hero");
  });

  test("POST /api/lorebooks/copy returns 400 for missing params", async () => {
    const res = await fetch(`${BASE}/api/lorebooks/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "default" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/lorebooks returns templates and adventures", async () => {
    const res = await fetch(`${BASE}/api/lorebooks`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.templates).toBeDefined();
    expect(data.adventures).toBeDefined();
    expect(data.templates.some((t: { name: string }) => t.name === "Key Quest")).toBe(true);
    expect(data.templates.some((t: { name: string }) => t.name === "Default Lorebook")).toBe(true);
  });

  test("GET /api/lorebooks shows both templates and adventures", async () => {
    await createLorebook("my-adventure", "My Adventure"); // non-template
    await createLorebook("user-tpl", "User Template", true); // user-created template
    const res = await fetch(`${BASE}/api/lorebooks`);
    const data = await res.json();
    // Templates section
    expect(data.templates.some((t: { slug: string }) => t.slug === "template-key-quest")).toBe(true);
    // Adventures section
    expect(data.adventures.some((a: { slug: string }) => a.slug === "my-adventure")).toBe(true);
    expect(data.adventures.find((a: { slug: string }) => a.slug === "my-adventure").name).toBe("My Adventure");
    // User template
    expect(data.templates.some((t: { slug: string }) => t.slug === "user-tpl")).toBe(true);
  });

  // --- Preset guard tests ---

  test("POST /api/lorebook/entry on preset returns 403", async () => {
    const res = await fetch(`${BASE}/api/lorebook/entry?path=new-entry&lorebook=template-key-quest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test", content: "test", keywords: "", regex: "", priority: 0, enabled: true }),
    });
    expect(res.status).toBe(403);
  });

  test("PUT /api/lorebook/entry on preset returns 403", async () => {
    const res = await fetch(`${BASE}/api/lorebook/entry?path=characters/old-sage&lorebook=template-key-quest`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test", content: "test", keywords: "", regex: "", priority: 0, enabled: true }),
    });
    expect(res.status).toBe(403);
  });

  test("DELETE /api/lorebook/entry on preset returns 403", async () => {
    const res = await fetch(`${BASE}/api/lorebook/entry?path=characters/old-sage&lorebook=template-key-quest`, {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
  });

  test("POST /api/lorebook/folder on preset returns 403", async () => {
    const res = await fetch(`${BASE}/api/lorebook/folder?lorebook=template-key-quest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "new-folder" }),
    });
    expect(res.status).toBe(403);
  });

  test("DELETE /api/lorebook/folder on preset returns 403", async () => {
    const res = await fetch(`${BASE}/api/lorebook/folder?path=characters&lorebook=template-key-quest`, {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/lorebook/tree on preset returns readonly tree", async () => {
    const res = await fetch(`${BASE}/api/lorebook/tree?lorebook=template-key-quest`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.readonly).toBe(true);
    // Should have entries
    expect(data.nodes.length).toBeGreaterThan(0);
    // Find the characters folder with Old Sage
    const chars = data.nodes.find((n: { name: string }) => n.name === "characters");
    expect(chars).toBeTruthy();
    const sage = chars.children.find((n: { name: string }) => n.name === "The Old Sage");
    expect(sage).toBeTruthy();
  });

  test("GET /api/lorebook/entry on preset returns readonly entry", async () => {
    const res = await fetch(`${BASE}/api/lorebook/entry?path=characters/old-sage&lorebook=template-key-quest`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entry.name).toBe("The Old Sage");
    expect(data.readonly).toBe(true);
    expect(data.isNew).toBe(false);
  });

  // --- Chat API tests ---

  test("POST /api/chat returns Hello World in messages", async () => {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hi there" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    const assistantMsg = data.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistantMsg.content).toContain("Hello World");
  });
});
