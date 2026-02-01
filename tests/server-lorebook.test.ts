import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { join, resolve } from "path";
import { rm } from "fs/promises";
import { startServer } from "../src/server";

const DATA_DIR = resolve(join(import.meta.dir, "..", "data-test"));
const CHATS_DIR = join(DATA_DIR, "chats");
const LOREBOOKS_DIR = join(DATA_DIR, "lorebooks");

let server: ReturnType<typeof Bun.serve>;
const PORT = 39183; // different from server.test.ts
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

// ---------------------------------------------------------------------------
// POST /api/lorebooks/make-template — save adventure as template
// ---------------------------------------------------------------------------

describe("POST /api/lorebooks/make-template", () => {
  beforeEach(cleanChats);

  test("copies adventure lorebook as template", async () => {
    // Create an adventure from a template
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "my-adventure", name: "My Adventure" });
    await jsonPost("/api/chats", { lorebook: "my-adventure" });

    // Save it as a template
    const res = await jsonPost("/api/lorebooks/make-template", {
      source: "my-adventure",
      slug: "my-template",
      name: "My Template",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Template created");

    // Verify the new lorebook is a template (appears in lorebook selector)
    const lbRes = await api("/api/lorebooks");
    const lbHtml = await lbRes.text();
    expect(lbHtml).toContain("My Template");
  });

  test("returns 400 for missing fields", async () => {
    const res = await jsonPost("/api/lorebooks/make-template", { source: "x", slug: "" , name: "" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/lorebooks — template-only selector
// ---------------------------------------------------------------------------

describe("GET /api/lorebooks — unified model", () => {
  test("returns both templates and adventures as cards", async () => {
    // Create an adventure (non-template) by copying
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "non-tpl-adv", name: "Non-Tpl Adventure" });
    await jsonPost("/api/chats", { lorebook: "non-tpl-adv" });

    const res = await api("/api/lorebooks");
    const html = await res.text();

    // Templates section with cards
    expect(html).toContain("Key Quest");
    expect(html).toContain("Default Lorebook");
    expect(html).toContain("Templates");
    expect(html).toContain("adventure-card");
    expect(html).toContain("lorebook-edit-btn");
    // Adventures section
    expect(html).toContain("Non-Tpl Adventure");
    expect(html).toContain("Your Adventures");
  });

  test("shows + Template button instead of + Lorebook", async () => {
    const res = await api("/api/lorebooks");
    const html = await res.text();
    expect(html).toContain("+ Template");
    expect(html).not.toContain("+ Lorebook");
    expect(html).not.toContain("btn-use-template");
    expect(html).not.toContain("template-select");
  });
});

// ---------------------------------------------------------------------------
// GET /api/lorebooks/meta — lorebook metadata
// ---------------------------------------------------------------------------

describe("GET /api/lorebooks/meta", () => {
  test("returns JSON with slug, name, template, preset for existing lorebook", async () => {
    const res = await api("/api/lorebooks/meta?slug=template-key-quest");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.slug).toBe("template-key-quest");
    expect(data.name).toBe("Key Quest");
    expect(data.template).toBe(true);
    expect(data.preset).toBe(true);
  });

  test("returns 404 for nonexistent lorebook", async () => {
    const res = await api("/api/lorebooks/meta?slug=does-not-exist");
    expect(res.status).toBe(404);
  });

  test("returns 400 for missing slug", async () => {
    const res = await api("/api/lorebooks/meta");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/lorebooks — creates templates
// ---------------------------------------------------------------------------

describe("POST /api/lorebooks — creates templates", () => {
  test("created lorebook is a template", async () => {
    const res = await jsonPost("/api/lorebooks", { slug: "new-tpl-test", name: "New Tpl Test" });
    expect(res.status).toBe(200);

    // Should appear in the lorebook selector (which only shows templates)
    const lbRes = await api("/api/lorebooks");
    const lbHtml = await lbRes.text();
    expect(lbHtml).toContain("New Tpl Test");
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/lorebooks — preset guard
// ---------------------------------------------------------------------------

describe("DELETE /api/lorebooks — preset guard", () => {
  test("can delete user-created lorebooks", async () => {
    await jsonPost("/api/lorebooks", { slug: "del-tpl-test", name: "Del Tpl Test" });

    const res = await api("/api/lorebooks?slug=del-tpl-test", { method: "DELETE" });
    expect(res.status).toBe(200);

    const lbRes = await api("/api/lorebooks");
    const lbHtml = await lbRes.text();
    expect(lbHtml).not.toContain("Del Tpl Test");
  });

  test("returns 403 when deleting a preset lorebook", async () => {
    const res = await api("/api/lorebooks?slug=template-key-quest", { method: "DELETE" });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Adventure picker — Save as Template button
// ---------------------------------------------------------------------------

describe("adventure picker — Save as Template button", () => {
  beforeEach(cleanChats);

  test("adventure cards have Save as Template button", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "tpl-btn-test", name: "Tpl Btn Test" });
    await jsonPost("/api/chats", { lorebook: "tpl-btn-test" });

    const res = await api("/api/adventures");
    const html = await res.text();
    expect(html).toContain("adventure-save-tpl-btn");
    expect(html).toContain("Save as Template");
    expect(html).toContain('data-lorebook="tpl-btn-test"');
  });
});

// ---------------------------------------------------------------------------
// Startup migration — orphan lorebooks become templates
// ---------------------------------------------------------------------------

describe("preset lorebooks visible at startup", () => {
  test("default lorebook is available as a preset template", async () => {
    const lbRes = await api("/api/lorebooks");
    const lbHtml = await lbRes.text();
    // "default" should appear as a template in the selector (from presets)
    expect(lbHtml).toContain("Default Lorebook");
  });
});
