import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from "bun:test";
import { resolve, join } from "path";
import { rm, readdir } from "fs/promises";
import type { Server } from "bun";
import {
  saveEntry,
  loadEntry,
  createFolder,
  createLorebook,
  seedTemplates,
} from "../src/lorebook";
import { startServer } from "../src/server";

const LOREBOOKS_DIR = resolve(join(import.meta.dir, "..", "data", "lorebooks"));

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

  test("GET /api/lorebook/tree returns HTML with empty state", async () => {
    await createLorebook("default", "Default Lorebook");
    const res = await fetch(`${BASE}/api/lorebook/tree?lorebook=default`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("No entries yet.");
  });

  test("GET /api/lorebook/entry returns editor form for new entry", async () => {
    await createLorebook("default", "Default Lorebook");
    const res = await fetch(`${BASE}/api/lorebook/entry?path=test-new&lorebook=default`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("test-new");
    expect(body).toContain("hx-post"); // new entry uses POST
    expect(body).toContain("Create");
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
    const body = await res.text();
    expect(body).toContain("Entry created.");
    expect(body).toContain("hx-put"); // editor switches to update mode
    expect(res.headers.get("hx-trigger")).toBe("refreshTree");

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
    const body = await res.text();
    expect(body).toContain("Name is required");
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
    const body = await res.text();
    expect(body).toContain("Entry saved.");
    expect(res.headers.get("hx-trigger")).toBe("refreshTree");

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
    });

    const res = await fetch(`${BASE}/api/lorebook/entry?path=delete-me&lorebook=default`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Entry deleted.");
    expect(res.headers.get("hx-trigger")).toBe("refreshTree");

    expect(await loadEntry("default", "delete-me")).toBeNull();
  });

  test("POST /api/lorebook/folder creates a folder", async () => {
    await createLorebook("default", "Default Lorebook");
    const res = await fetch(`${BASE}/api/lorebook/folder?lorebook=default`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "path=test-folder",
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Folder created.");
    expect(res.headers.get("hx-trigger")).toBe("refreshTree");

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
    expect(res.headers.get("hx-trigger")).toBe("refreshTree");

    const contents = await readdir(join(LOREBOOKS_DIR, "default")).catch(() => []);
    expect(contents).not.toContain("remove-folder");
  });

  test("GET /api/lorebook/entry returns edit form for existing entry", async () => {
    await createLorebook("default", "Default Lorebook");
    await saveEntry("default", "existing", {
      name: "Existing Entry",
      content: "Some content.",
      keywords: ["foo", "bar"],
      regex: "test.*",
      priority: 7,
      enabled: true,
    });

    const res = await fetch(`${BASE}/api/lorebook/entry?path=existing&lorebook=default`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Existing Entry");
    expect(body).toContain("hx-put"); // existing entry uses PUT
    expect(body).toContain("Save");
    expect(body).toContain("Delete");
    expect(body).toContain("foo, bar");
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
    });

    const res = await fetch(`${BASE}/api/lorebook/tree?lorebook=default`);
    const body = await res.text();
    expect(body).toContain("Gabrielle");
    expect(body).toContain("people");
  });

  // --- Lorebook management API tests ---

  test("GET /api/lorebooks returns selector HTML with templates only", async () => {
    await createLorebook("default", "Default Lorebook", true);
    const res = await fetch(`${BASE}/api/lorebooks`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("lorebook-selector");
    expect(body).toContain("Default Lorebook");
    expect(body).toContain("btn-new-lorebook");
    expect(body).toContain("+ Template");
  });

  test("POST /api/lorebooks creates a lorebook", async () => {
    const res = await fetch(`${BASE}/api/lorebooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "homebrew", name: "Homebrew Setting" }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Lorebook created.");
    expect(res.headers.get("hx-trigger")).toBe("refreshLorebooks");

    // Verify it shows up in the list
    const listRes = await fetch(`${BASE}/api/lorebooks`);
    const listBody = await listRes.text();
    expect(listBody).toContain("Homebrew Setting");
  });

  test("DELETE /api/lorebooks removes a lorebook", async () => {
    await createLorebook("to-remove", "Remove Me");
    const res = await fetch(`${BASE}/api/lorebooks?slug=to-remove`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("hx-trigger")).toBe("refreshLorebooks");
  });

  test("DELETE /api/lorebooks allows deleting any lorebook", async () => {
    await createLorebook("default", "Default Lorebook", true);
    const res = await fetch(`${BASE}/api/lorebooks?slug=default`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
  });

  test("tree renders per-folder + New buttons with data-prefix", async () => {
    await createLorebook("default", "Default Lorebook");
    await saveEntry("default", "people/gabrielle", {
      name: "Gabrielle",
      content: "",
      keywords: [],
      regex: "",
      priority: 0,
      enabled: true,
    });

    const res = await fetch(`${BASE}/api/lorebook/tree?lorebook=default`);
    const body = await res.text();
    // Root-level + New button with empty prefix
    expect(body).toContain('data-prefix=""');
    // Folder-level + New button with prefix
    expect(body).toContain('data-prefix="people/"');
    expect(body).toContain('data-lorebook="default"');
    expect(body).toContain("btn-new-entry");
  });

  test("entry form includes lorebook param in URLs", async () => {
    await createLorebook("homebrew", "Homebrew");
    const res = await fetch(`${BASE}/api/lorebook/entry?path=dragon&lorebook=homebrew`);
    const body = await res.text();
    expect(body).toContain("lorebook=homebrew");
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
    });

    const res = await fetch(`${BASE}/api/lorebooks/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "default", slug: "my-copy", name: "My Copy" }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Lorebook created from template.");
    expect(res.headers.get("hx-trigger")).toBe("refreshLorebooks");

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

  test("GET /api/lorebooks shows templates in single dropdown", async () => {
    await createLorebook("default", "Default Lorebook", true);
    await seedTemplates();
    const res = await fetch(`${BASE}/api/lorebooks`);
    expect(res.status).toBe(200);
    const body = await res.text();
    // Single dropdown with templates
    expect(body).toContain("Key Quest");
    expect(body).toContain("Default Lorebook");
    // No separate template selector or Use Template button
    expect(body).not.toContain("template-select");
    expect(body).not.toContain("btn-use-template");
  });

  test("GET /api/lorebooks shows both templates and adventures in grouped dropdown", async () => {
    await createLorebook("default", "Default Lorebook", true);
    await createLorebook("my-adventure", "My Adventure"); // non-template
    await seedTemplates();
    const res = await fetch(`${BASE}/api/lorebooks`);
    const body = await res.text();
    const mainSelect = body.match(/<select[^>]*id="lorebook-select"[^>]*>([\s\S]*?)<\/select>/);
    expect(mainSelect).not.toBeNull();
    // Templates in dropdown under Templates optgroup
    expect(mainSelect![1]).toContain("template-key-quest");
    expect(mainSelect![1]).toContain("Default Lorebook");
    expect(mainSelect![1]).toContain("Templates");
    // Adventures in dropdown under Adventures optgroup
    expect(mainSelect![1]).toContain("My Adventure");
    expect(mainSelect![1]).toContain("Adventures");
  });

  // --- Chat API tests ---

  test("POST /api/chat returns Hello World", async () => {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hi there" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("Hello World");
    expect(body).toContain("chat-msg-assistant");
  });
});
