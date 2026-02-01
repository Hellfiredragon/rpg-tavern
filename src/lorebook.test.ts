import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join, resolve } from "path";
import { rm, readdir, mkdir } from "fs/promises";
import {
  resolveEntryPath,
  resolveDirPath,
  validateEntry,
  saveEntry,
  loadEntry,
  deleteEntry,
  createFolder,
  deleteFolder,
  scanTree,
  loadAllEntries,
  createLorebook,
  DEFAULT_ENTRY,
  type LorebookEntry,
} from "./lorebook";

// The lorebook module stores data in data/lorebooks/ relative to src/.
// Tests use that real directory, so we clean it before/after each test.
const LOREBOOKS_DIR = resolve(join(import.meta.dir, "..", "data-test", "lorebooks"));

async function cleanLorebooks() {
  try {
    await rm(LOREBOOKS_DIR, { recursive: true });
  } catch {
    // doesn't exist yet
  }
}

// ---------------------------------------------------------------------------
// validateEntry
// ---------------------------------------------------------------------------

describe("validateEntry", () => {
  test("validates a minimal valid entry", () => {
    const result = validateEntry({ name: "Test", content: "", keywords: "", regex: "", priority: 0, enabled: true });
    expect(result).toEqual({
      name: "Test",
      content: "",
      keywords: [],
      regex: "",
      priority: 0,
      enabled: true,
    });
  });

  test("trims name and rejects empty name", () => {
    expect(() => validateEntry({ name: "  ", content: "" })).toThrow("Name is required");
    expect(() => validateEntry({ content: "" })).toThrow("Name is required");
  });

  test("rejects non-object body", () => {
    expect(() => validateEntry(null)).toThrow("Body must be a JSON object");
    expect(() => validateEntry("string")).toThrow("Body must be a JSON object");
    expect(() => validateEntry(42)).toThrow("Body must be a JSON object");
  });

  test("parses comma-separated keywords string", () => {
    const result = validateEntry({ name: "Test", keywords: "tavern, barmaid, rusty tankard" });
    expect(result.keywords).toEqual(["tavern", "barmaid", "rusty tankard"]);
  });

  test("filters empty keywords from string", () => {
    const result = validateEntry({ name: "Test", keywords: "tavern,,, barmaid,," });
    expect(result.keywords).toEqual(["tavern", "barmaid"]);
  });

  test("accepts keywords as array", () => {
    const result = validateEntry({ name: "Test", keywords: ["foo", "bar"] });
    expect(result.keywords).toEqual(["foo", "bar"]);
  });

  test("defaults keywords to empty array if missing", () => {
    const result = validateEntry({ name: "Test" });
    expect(result.keywords).toEqual([]);
  });

  test("validates regex pattern", () => {
    const result = validateEntry({ name: "Test", regex: "foo.*bar" });
    expect(result.regex).toBe("foo.*bar");
  });

  test("rejects invalid regex", () => {
    expect(() => validateEntry({ name: "Test", regex: "[invalid" })).toThrow("Invalid regex pattern");
  });

  test("allows empty regex", () => {
    const result = validateEntry({ name: "Test", regex: "" });
    expect(result.regex).toBe("");
  });

  test("parses priority as number", () => {
    const result = validateEntry({ name: "Test", priority: 10 });
    expect(result.priority).toBe(10);
  });

  test("parses priority from string", () => {
    const result = validateEntry({ name: "Test", priority: "5" });
    expect(result.priority).toBe(5);
  });

  test("defaults priority to 0 for non-finite values", () => {
    expect(validateEntry({ name: "Test", priority: "abc" }).priority).toBe(0);
    expect(validateEntry({ name: "Test", priority: NaN }).priority).toBe(0);
    expect(validateEntry({ name: "Test" }).priority).toBe(0);
  });

  test("rounds fractional priority", () => {
    const result = validateEntry({ name: "Test", priority: 3.7 });
    expect(result.priority).toBe(4);
  });

  test("handles enabled as boolean true", () => {
    expect(validateEntry({ name: "Test", enabled: true }).enabled).toBe(true);
  });

  test("handles enabled as 'on' (htmx checkbox)", () => {
    expect(validateEntry({ name: "Test", enabled: "on" }).enabled).toBe(true);
  });

  test("handles missing enabled as false", () => {
    expect(validateEntry({ name: "Test" }).enabled).toBe(false);
  });

  test("handles enabled as false", () => {
    expect(validateEntry({ name: "Test", enabled: false }).enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

describe("resolveEntryPath", () => {
  test("resolves a simple path", () => {
    const result = resolveEntryPath("default", "people/gabrielle");
    expect(result).toBe(join(LOREBOOKS_DIR, "default", "people", "gabrielle.json"));
  });

  test("strips leading and trailing slashes", () => {
    const result = resolveEntryPath("default", "/people/gabrielle/");
    expect(result).toBe(join(LOREBOOKS_DIR, "default", "people", "gabrielle.json"));
  });

  test("rejects path traversal with ..", () => {
    expect(() => resolveEntryPath("default", "../../etc/passwd")).toThrow("Invalid path");
  });

  test("resolves root-level entry", () => {
    const result = resolveEntryPath("default", "tavern");
    expect(result).toBe(join(LOREBOOKS_DIR, "default", "tavern.json"));
  });
});

describe("resolveDirPath", () => {
  test("resolves a directory path", () => {
    const result = resolveDirPath("default", "people");
    expect(result).toBe(join(LOREBOOKS_DIR, "default", "people"));
  });

  test("rejects path traversal with ..", () => {
    expect(() => resolveDirPath("default", "../../../tmp")).toThrow("Invalid path");
  });
});

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

describe("CRUD operations", () => {
  beforeEach(async () => { await cleanLorebooks(); await createLorebook("default", "Default"); });
  afterEach(cleanLorebooks);

  const sampleEntry: LorebookEntry = {
    name: "The Rusty Tankard",
    content: "A dimly lit tavern on the edge of town.",
    keywords: ["tavern", "rusty tankard"],
    regex: "",
    priority: 10,
    enabled: true,
  };

  test("saveEntry and loadEntry round-trip", async () => {
    await saveEntry("default", "locations/tavern", sampleEntry);
    const loaded = await loadEntry("default", "locations/tavern");
    expect(loaded).toEqual(sampleEntry);
  });

  test("loadEntry returns null for non-existent entry", async () => {
    const result = await loadEntry("default", "does-not-exist");
    expect(result).toBeNull();
  });

  test("saveEntry creates parent directories", async () => {
    await saveEntry("default", "deep/nested/path/entry", sampleEntry);
    const loaded = await loadEntry("default", "deep/nested/path/entry");
    expect(loaded).toEqual(sampleEntry);
  });

  test("saveEntry overwrites existing entry", async () => {
    await saveEntry("default", "test-entry", sampleEntry);
    const updated = { ...sampleEntry, name: "Updated Name" };
    await saveEntry("default", "test-entry", updated);
    const loaded = await loadEntry("default", "test-entry");
    expect(loaded!.name).toBe("Updated Name");
  });

  test("deleteEntry removes the file", async () => {
    await saveEntry("default", "to-delete", sampleEntry);
    expect(await loadEntry("default", "to-delete")).not.toBeNull();

    await deleteEntry("default", "to-delete");
    expect(await loadEntry("default", "to-delete")).toBeNull();
  });

  test("deleteEntry cleans up empty parent directories", async () => {
    await saveEntry("default", "cleanup/nested/entry", sampleEntry);
    await deleteEntry("default", "cleanup/nested/entry");

    // The cleanup/ and cleanup/nested/ dirs should be removed
    const rootContents = await readdir(join(LOREBOOKS_DIR, "default")).catch(() => []);
    expect(rootContents).not.toContain("cleanup");
  });

  test("deleteEntry preserves non-empty parent directories", async () => {
    await saveEntry("default", "shared/entry-a", sampleEntry);
    await saveEntry("default", "shared/entry-b", sampleEntry);
    await deleteEntry("default", "shared/entry-a");

    // shared/ should still exist because entry-b is there
    const loaded = await loadEntry("default", "shared/entry-b");
    expect(loaded).not.toBeNull();
  });

  test("createFolder creates a directory", async () => {
    await createFolder("default", "new-folder");
    const contents = await readdir(join(LOREBOOKS_DIR, "default"));
    expect(contents).toContain("new-folder");
  });

  test("createFolder creates nested directories", async () => {
    await createFolder("default", "a/b/c");
    const contents = await readdir(join(LOREBOOKS_DIR, "default", "a", "b"));
    expect(contents).toContain("c");
  });

  test("deleteFolder removes a directory recursively", async () => {
    await saveEntry("default", "to-remove/entry", sampleEntry);
    await deleteFolder("default", "to-remove");
    const contents = await readdir(join(LOREBOOKS_DIR, "default")).catch(() => []);
    expect(contents).not.toContain("to-remove");
  });

  test("loadAllEntries returns all entries with paths", async () => {
    await saveEntry("default", "locations/tavern", sampleEntry);
    await saveEntry("default", "people/gabrielle", {
      ...sampleEntry,
      name: "Gabrielle",
      keywords: ["gabrielle"],
      priority: 5,
    });

    const all = await loadAllEntries("default");
    expect(all).toHaveLength(2);

    const paths = all.map((e) => e.path).sort();
    expect(paths).toEqual(["locations/tavern", "people/gabrielle"]);

    const tavern = all.find((e) => e.path === "locations/tavern");
    expect(tavern!.name).toBe("The Rusty Tankard");
  });

  test("loadAllEntries returns empty array when no entries exist", async () => {
    const all = await loadAllEntries("default");
    expect(all).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tree scanning
// ---------------------------------------------------------------------------

describe("scanTree", () => {
  beforeEach(async () => { await cleanLorebooks(); await createLorebook("default", "Default"); });
  afterEach(cleanLorebooks);

  test("returns empty array for empty directory", async () => {
    const tree = await scanTree("default");
    expect(tree).toEqual([]);
  });

  test("returns entry nodes for JSON files", async () => {
    await saveEntry("default", "tavern", {
      name: "The Rusty Tankard",
      content: "A tavern.",
      keywords: ["tavern"],
      regex: "",
      priority: 0,
      enabled: true,
    });

    const tree = await scanTree("default");
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("The Rusty Tankard");
    expect(tree[0].path).toBe("tavern");
    expect(tree[0].isEntry).toBe(true);
    expect(tree[0].children).toEqual([]);
  });

  test("returns folder nodes for directories", async () => {
    await createFolder("default", "people");
    const tree = await scanTree("default");
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("people");
    expect(tree[0].isEntry).toBe(false);
  });

  test("nests entries inside folders", async () => {
    await saveEntry("default", "people/gabrielle", {
      name: "Gabrielle",
      content: "",
      keywords: [],
      regex: "",
      priority: 0,
      enabled: true,
    });

    const tree = await scanTree("default");
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("people");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe("Gabrielle");
    expect(tree[0].children[0].path).toBe("people/gabrielle");
  });

  test("sorts nodes alphabetically", async () => {
    await saveEntry("default", "charlie", { ...DEFAULT_ENTRY, name: "Charlie" });
    await saveEntry("default", "alice", { ...DEFAULT_ENTRY, name: "Alice" });
    await saveEntry("default", "bob", { ...DEFAULT_ENTRY, name: "Bob" });

    const tree = await scanTree("default");
    expect(tree.map((n) => n.path)).toEqual(["alice", "bob", "charlie"]);
  });

  test("handles file and directory with same name (coexistence)", async () => {
    // gabrielle.json + gabrielle/ directory
    await saveEntry("default", "gabrielle", {
      name: "Gabrielle",
      content: "The barmaid.",
      keywords: ["gabrielle"],
      regex: "",
      priority: 0,
      enabled: true,
    });
    await saveEntry("default", "gabrielle/secrets", {
      name: "Gabrielle's Secrets",
      content: "She is actually a princess.",
      keywords: ["secret"],
      regex: "",
      priority: 10,
      enabled: true,
    });

    const tree = await scanTree("default");
    expect(tree).toHaveLength(1);

    const node = tree[0];
    expect(node.isEntry).toBe(true);
    expect(node.name).toBe("Gabrielle");
    expect(node.children).toHaveLength(1);
    expect(node.children[0].name).toBe("Gabrielle's Secrets");
    expect(node.children[0].path).toBe("gabrielle/secrets");
  });

  test("does not include _lorebook.json in tree nodes", async () => {
    await createLorebook("default", "Default Lorebook");
    await saveEntry("default", "tavern", { ...DEFAULT_ENTRY, name: "Tavern" });

    const tree = await scanTree("default");
    const names = tree.map((n) => n.name);
    expect(names).not.toContain("_lorebook");
    expect(names).toContain("Tavern");
  });
});
