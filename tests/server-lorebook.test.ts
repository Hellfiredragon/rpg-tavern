import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { startServer } from "../src/server";
import { cleanData, cleanChats, createApiHelpers } from "./helpers";

let server: ReturnType<typeof Bun.serve>;
const PORT = 39183;
const BASE = `http://localhost:${PORT}`;
const { api, jsonPost } = createApiHelpers(BASE);

beforeAll(async () => {
  await cleanData();
  server = await startServer(PORT);
});

afterAll(async () => {
  server.stop(true);
  await cleanData();
});

describe("POST /api/lorebooks/make-template", () => {
  beforeEach(cleanChats);

  test("copies adventure lorebook as template", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "my-adventure", name: "My Adventure" });
    await jsonPost("/api/chats", { lorebook: "my-adventure" });

    const res = await jsonPost("/api/lorebooks/make-template", {
      source: "my-adventure",
      slug: "my-template",
      name: "My Template",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    const lbRes = await api("/api/lorebooks");
    const lbData = await lbRes.json();
    expect(lbData.templates.some((t: { name: string }) => t.name === "My Template")).toBe(true);
  });

  test("returns 400 for missing fields", async () => {
    const res = await jsonPost("/api/lorebooks/make-template", { source: "x", slug: "" , name: "" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/lorebooks — templates only", () => {
  test("returns templates as JSON (no adventures)", async () => {
    const res = await api("/api/lorebooks");
    const data = await res.json();

    expect(data.templates.some((t: { name: string }) => t.name === "Key Quest")).toBe(true);
    expect(data.templates.some((t: { name: string }) => t.name === "The Rusty Flagon")).toBe(true);

    expect(data.adventures).toBeUndefined();
  });

  test("returns templates array", async () => {
    const res = await api("/api/lorebooks");
    const data = await res.json();
    expect(data.templates).toBeDefined();
    expect(Array.isArray(data.templates)).toBe(true);
  });
});

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

describe("POST /api/lorebooks — creates templates", () => {
  test("created lorebook is a template", async () => {
    const res = await jsonPost("/api/lorebooks", { slug: "new-tpl-test", name: "New Tpl Test" });
    expect(res.status).toBe(200);

    const lbRes = await api("/api/lorebooks");
    const lbData = await lbRes.json();
    expect(lbData.templates.some((t: { name: string }) => t.name === "New Tpl Test")).toBe(true);
  });
});

describe("DELETE /api/lorebooks — preset guard", () => {
  test("can delete user-created lorebooks", async () => {
    await jsonPost("/api/lorebooks", { slug: "del-tpl-test", name: "Del Tpl Test" });

    const res = await api("/api/lorebooks?slug=del-tpl-test", { method: "DELETE" });
    expect(res.status).toBe(200);

    const lbRes = await api("/api/lorebooks");
    const lbData = await lbRes.json();
    expect(lbData.templates.some((t: { name: string }) => t.name === "Del Tpl Test")).toBe(false);
  });

  test("returns 403 when deleting a preset lorebook", async () => {
    const res = await api("/api/lorebooks?slug=template-key-quest", { method: "DELETE" });
    expect(res.status).toBe(403);
  });
});

describe("adventure picker — adventures have metadata", () => {
  beforeEach(cleanChats);

  test("adventure entries include lorebook slug", async () => {
    await jsonPost("/api/lorebooks/copy", { source: "template-key-quest", slug: "tpl-btn-test", name: "Tpl Btn Test" });
    await jsonPost("/api/chats", { lorebook: "tpl-btn-test" });

    const res = await api("/api/adventures");
    const data = await res.json();
    const adventure = data.adventures.find((a: { slug: string }) => a.slug === "tpl-btn-test");
    expect(adventure).toBeTruthy();
    expect(adventure.name).toBe("Tpl Btn Test");
    expect(adventure.latestChatId).toBeTruthy();
  });
});

describe("preset lorebooks visible at startup", () => {
  test("default lorebook is available as a preset template", async () => {
    const lbRes = await api("/api/lorebooks");
    const lbData = await lbRes.json();
    expect(lbData.templates.some((t: { name: string }) => t.name === "The Rusty Flagon")).toBe(true);
  });
});
