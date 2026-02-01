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
  findMatchingEntries,
  listLocationEntries,
  createLorebook,
  listLorebooks,
  deleteLorebook,
  loadLorebookMeta,
  ensureDefaultLorebook,
  copyLorebook,
  seedTemplates,
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
  beforeEach(cleanLorebooks);
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
  beforeEach(cleanLorebooks);
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

// ---------------------------------------------------------------------------
// Matching engine
// ---------------------------------------------------------------------------

describe("findMatchingEntries", () => {
  beforeEach(cleanLorebooks);
  afterEach(cleanLorebooks);

  async function seedEntries() {
    await saveEntry("default", "locations/tavern", {
      name: "The Rusty Tankard",
      content: "A dimly lit tavern on the edge of town.",
      keywords: ["tavern", "rusty tankard"],
      regex: "",
      priority: 10,
      enabled: true,
    });
    await saveEntry("default", "people/gabrielle", {
      name: "Gabrielle",
      content: "The barmaid at the Rusty Tankard.",
      keywords: ["gabrielle", "barmaid"],
      regex: "",
      priority: 5,
      enabled: true,
    });
    await saveEntry("default", "people/dark-knight", {
      name: "The Dark Knight",
      content: "A mysterious figure.",
      keywords: ["dark knight"],
      regex: "dark\\s*knight",
      priority: 15,
      enabled: true,
    });
    await saveEntry("default", "disabled-entry", {
      name: "Disabled",
      content: "Should never match.",
      keywords: ["tavern", "gabrielle", "everything"],
      regex: ".*",
      priority: 100,
      enabled: false,
    });
  }

  test("matches entries by keyword (case-insensitive)", async () => {
    await seedEntries();
    const matches = await findMatchingEntries("default", "I walk into the TAVERN");
    const names = matches.map((m) => m.name);
    expect(names).toContain("The Rusty Tankard");
  });

  test("matches multiple entries and sorts by priority descending", async () => {
    await seedEntries();
    const matches = await findMatchingEntries("default", "I walk into the tavern and see Gabrielle");
    expect(matches.length).toBeGreaterThanOrEqual(2);
    // priority: tavern=10, gabrielle=5 -> tavern first
    expect(matches[0].name).toBe("The Rusty Tankard");
    expect(matches[1].name).toBe("Gabrielle");
  });

  test("matches by regex pattern", async () => {
    await seedEntries();
    const matches = await findMatchingEntries("default", "The darkknight approaches");
    const names = matches.map((m) => m.name);
    expect(names).toContain("The Dark Knight");
  });

  test("does not match disabled entries", async () => {
    await seedEntries();
    const matches = await findMatchingEntries("default", "tavern gabrielle everything");
    const names = matches.map((m) => m.name);
    expect(names).not.toContain("Disabled");
  });

  test("returns empty array when nothing matches", async () => {
    await seedEntries();
    const matches = await findMatchingEntries("default", "The weather is nice today");
    expect(matches).toEqual([]);
  });

  test("handles entries with invalid regex gracefully", async () => {
    await saveEntry("default", "bad-regex", {
      name: "Bad Regex",
      content: "",
      keywords: [],
      regex: "[invalid",
      priority: 0,
      enabled: true,
    });
    // Should not throw
    const matches = await findMatchingEntries("default", "some text");
    expect(matches).toEqual([]);
  });

  test("returns empty array with no entries", async () => {
    const matches = await findMatchingEntries("default", "anything");
    expect(matches).toEqual([]);
  });

  test("includes path in matched entries", async () => {
    await seedEntries();
    const matches = await findMatchingEntries("default", "I see the barmaid");
    const gabrielle = matches.find((m) => m.name === "Gabrielle");
    expect(gabrielle).toBeDefined();
    expect(gabrielle!.path).toBe("people/gabrielle");
  });

  test("scoped to lorebook — entries in other lorebooks not returned", async () => {
    await createLorebook("default", "Default");
    await createLorebook("homebrew", "Homebrew");
    await saveEntry("default", "tavern", {
      ...DEFAULT_ENTRY,
      name: "Default Tavern",
      keywords: ["tavern"],
      enabled: true,
    });
    await saveEntry("homebrew", "tavern", {
      ...DEFAULT_ENTRY,
      name: "Homebrew Tavern",
      keywords: ["tavern"],
      enabled: true,
    });

    const defaultMatches = await findMatchingEntries("default", "tavern");
    expect(defaultMatches).toHaveLength(1);
    expect(defaultMatches[0].name).toBe("Default Tavern");

    const homebrewMatches = await findMatchingEntries("homebrew", "tavern");
    expect(homebrewMatches).toHaveLength(1);
    expect(homebrewMatches[0].name).toBe("Homebrew Tavern");
  });
});

// ---------------------------------------------------------------------------
// Lorebook management
// ---------------------------------------------------------------------------

describe("lorebook management", () => {
  beforeEach(cleanLorebooks);
  afterEach(cleanLorebooks);

  test("createLorebook creates directory and metadata", async () => {
    await createLorebook("homebrew", "Homebrew Setting");
    const meta = await loadLorebookMeta("homebrew");
    expect(meta).toEqual({ name: "Homebrew Setting" });
  });

  test("listLorebooks returns sorted lorebooks", async () => {
    await createLorebook("beta", "Beta World");
    await createLorebook("alpha", "Alpha World");
    const list = await listLorebooks();
    expect(list).toHaveLength(2);
    expect(list[0].slug).toBe("alpha");
    expect(list[0].meta.name).toBe("Alpha World");
    expect(list[1].slug).toBe("beta");
    expect(list[1].meta.name).toBe("Beta World");
  });

  test("listLorebooks returns empty array when no lorebooks exist", async () => {
    const list = await listLorebooks();
    expect(list).toEqual([]);
  });

  test("deleteLorebook removes the lorebook directory", async () => {
    await createLorebook("to-delete", "Delete Me");
    await saveEntry("to-delete", "entry", { ...DEFAULT_ENTRY, name: "Entry" });
    await deleteLorebook("to-delete");
    const meta = await loadLorebookMeta("to-delete");
    expect(meta).toBeNull();
    const list = await listLorebooks();
    expect(list.find((l) => l.slug === "to-delete")).toBeUndefined();
  });

  test("loadLorebookMeta returns null for non-existent lorebook", async () => {
    const meta = await loadLorebookMeta("nonexistent");
    expect(meta).toBeNull();
  });

  test("entries are isolated between lorebooks", async () => {
    await createLorebook("world-a", "World A");
    await createLorebook("world-b", "World B");

    await saveEntry("world-a", "hero", { ...DEFAULT_ENTRY, name: "Hero A" });
    await saveEntry("world-b", "hero", { ...DEFAULT_ENTRY, name: "Hero B" });

    const heroA = await loadEntry("world-a", "hero");
    const heroB = await loadEntry("world-b", "hero");
    expect(heroA!.name).toBe("Hero A");
    expect(heroB!.name).toBe("Hero B");

    // Deleting in one shouldn't affect the other
    await deleteEntry("world-a", "hero");
    expect(await loadEntry("world-a", "hero")).toBeNull();
    expect(await loadEntry("world-b", "hero")).not.toBeNull();
  });

  test("scanTree scoped to lorebook", async () => {
    await createLorebook("world-a", "World A");
    await createLorebook("world-b", "World B");
    await saveEntry("world-a", "entry-a", { ...DEFAULT_ENTRY, name: "Entry A" });
    await saveEntry("world-b", "entry-b", { ...DEFAULT_ENTRY, name: "Entry B" });

    const treeA = await scanTree("world-a");
    expect(treeA).toHaveLength(1);
    expect(treeA[0].name).toBe("Entry A");

    const treeB = await scanTree("world-b");
    expect(treeB).toHaveLength(1);
    expect(treeB[0].name).toBe("Entry B");
  });
});

// ---------------------------------------------------------------------------
// ensureDefaultLorebook migration
// ---------------------------------------------------------------------------

describe("ensureDefaultLorebook", () => {
  beforeEach(cleanLorebooks);
  afterEach(cleanLorebooks);

  test("creates default lorebook when directory is empty", async () => {
    await ensureDefaultLorebook();
    const meta = await loadLorebookMeta("default");
    expect(meta).toEqual({ name: "Default Lorebook", template: true });
  });

  test("migrates legacy flat files into default lorebook", async () => {
    // Simulate legacy layout: files directly in LOREBOOKS_DIR
    await mkdir(LOREBOOKS_DIR, { recursive: true });
    const legacyEntry: LorebookEntry = {
      name: "Legacy Tavern",
      content: "Old tavern.",
      keywords: ["tavern"],
      regex: "",
      priority: 5,
      enabled: true,
    };
    await mkdir(join(LOREBOOKS_DIR, "people"), { recursive: true });
    await Bun.write(
      join(LOREBOOKS_DIR, "tavern.json"),
      JSON.stringify(legacyEntry),
    );
    await Bun.write(
      join(LOREBOOKS_DIR, "people", "gabrielle.json"),
      JSON.stringify({ ...legacyEntry, name: "Gabrielle" }),
    );

    await ensureDefaultLorebook();

    // Files should be migrated
    const meta = await loadLorebookMeta("default");
    expect(meta).toEqual({ name: "Default Lorebook", template: true });

    const tavern = await loadEntry("default", "tavern");
    expect(tavern).not.toBeNull();
    expect(tavern!.name).toBe("Legacy Tavern");

    const gabrielle = await loadEntry("default", "people/gabrielle");
    expect(gabrielle).not.toBeNull();
    expect(gabrielle!.name).toBe("Gabrielle");
  });

  test("does not migrate if a lorebook already exists", async () => {
    await createLorebook("existing", "Existing");
    await saveEntry("existing", "entry", { ...DEFAULT_ENTRY, name: "Keep" });

    await ensureDefaultLorebook();

    // "default" lorebook should NOT be created
    const meta = await loadLorebookMeta("default");
    expect(meta).toBeNull();

    // existing lorebook untouched
    const entry = await loadEntry("existing", "entry");
    expect(entry!.name).toBe("Keep");
  });
});

// ---------------------------------------------------------------------------
// copyLorebook
// ---------------------------------------------------------------------------

describe("copyLorebook", () => {
  beforeEach(cleanLorebooks);
  afterEach(cleanLorebooks);

  test("copies all entries from source to destination", async () => {
    await createLorebook("source", "Source");
    await saveEntry("source", "people/hero", { ...DEFAULT_ENTRY, name: "Hero", keywords: ["hero"], enabled: true });
    await saveEntry("source", "locations/town", { ...DEFAULT_ENTRY, name: "Town", keywords: ["town"], enabled: true });

    await copyLorebook("source", "dest", "My Copy");

    const destMeta = await loadLorebookMeta("dest");
    expect(destMeta).toEqual({ name: "My Copy" });

    const hero = await loadEntry("dest", "people/hero");
    expect(hero).not.toBeNull();
    expect(hero!.name).toBe("Hero");

    const town = await loadEntry("dest", "locations/town");
    expect(town).not.toBeNull();
    expect(town!.name).toBe("Town");
  });

  test("copy is independent from source", async () => {
    await createLorebook("source", "Source");
    await saveEntry("source", "entry", { ...DEFAULT_ENTRY, name: "Original", enabled: true });

    await copyLorebook("source", "copy", "Copy");

    // Modify source
    await saveEntry("source", "entry", { ...DEFAULT_ENTRY, name: "Modified", enabled: true });

    // Copy should still have original
    const copied = await loadEntry("copy", "entry");
    expect(copied!.name).toBe("Original");
  });

  test("copied lorebook is not a template", async () => {
    await createLorebook("source", "Source");
    // Manually set template flag on source
    const root = join(LOREBOOKS_DIR, "source");
    await Bun.write(join(root, "_lorebook.json"), JSON.stringify({ name: "Source", template: true }));

    await copyLorebook("source", "copy", "My Copy");
    const meta = await loadLorebookMeta("copy");
    expect(meta!.template).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// seedTemplates
// ---------------------------------------------------------------------------

describe("seedTemplates", () => {
  beforeEach(cleanLorebooks);
  afterEach(cleanLorebooks);

  test("creates the Key Quest template", async () => {
    await seedTemplates();
    const meta = await loadLorebookMeta("template-key-quest");
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe("Key Quest");
    expect(meta!.template).toBe(true);
  });

  test("Key Quest template has expected entries", async () => {
    await seedTemplates();
    const all = await loadAllEntries("template-key-quest");
    const names = all.map((e) => e.name).sort();
    expect(names).toContain("The Old Sage");
    expect(names).toContain("Brondar the Blacksmith");
    expect(names).toContain("Marta the Innkeeper");
    expect(names).toContain("The Iron Key");
    expect(names).toContain("The Village Square");
    expect(names).toContain("The Inn Cellar");
    expect(names).toContain("The Treasure Room");
    expect(all).toHaveLength(7);
  });

  test("does not overwrite existing template", async () => {
    await seedTemplates();
    // Modify an entry in the template
    await saveEntry("template-key-quest", "characters/old-sage", {
      ...DEFAULT_ENTRY,
      name: "Custom Sage",
      enabled: true,
    });

    // Re-seed should not overwrite
    await seedTemplates();
    const sage = await loadEntry("template-key-quest", "characters/old-sage");
    expect(sage!.name).toBe("Custom Sage");
  });

  test("template lorebooks are listed with template flag", async () => {
    await seedTemplates();
    await createLorebook("default", "Default Lorebook");
    const list = await listLorebooks();
    const tpl = list.find((l) => l.slug === "template-key-quest");
    expect(tpl).toBeDefined();
    expect(tpl!.meta.template).toBe(true);
    const def = list.find((l) => l.slug === "default");
    expect(def).toBeDefined();
    expect(def!.meta.template).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// listLocationEntries
// ---------------------------------------------------------------------------

describe("listLocationEntries", () => {
  beforeEach(cleanLorebooks);
  afterEach(cleanLorebooks);

  test("returns only entries under locations/", async () => {
    await saveEntry("default", "locations/tavern", { ...DEFAULT_ENTRY, name: "Tavern", enabled: true });
    await saveEntry("default", "locations/forest", { ...DEFAULT_ENTRY, name: "Forest", enabled: true });
    await saveEntry("default", "people/gabrielle", { ...DEFAULT_ENTRY, name: "Gabrielle", enabled: true });
    await saveEntry("default", "items/sword", { ...DEFAULT_ENTRY, name: "Sword", enabled: true });

    const locations = await listLocationEntries("default");
    expect(locations).toHaveLength(2);
    const names = locations.map((e) => e.name);
    expect(names).toContain("Tavern");
    expect(names).toContain("Forest");
    expect(names).not.toContain("Gabrielle");
    expect(names).not.toContain("Sword");
  });

  test("returns entries sorted by name", async () => {
    await saveEntry("default", "locations/zoo", { ...DEFAULT_ENTRY, name: "Zoo", enabled: true });
    await saveEntry("default", "locations/alley", { ...DEFAULT_ENTRY, name: "Alley", enabled: true });
    await saveEntry("default", "locations/market", { ...DEFAULT_ENTRY, name: "Market", enabled: true });

    const locations = await listLocationEntries("default");
    expect(locations.map((e) => e.name)).toEqual(["Alley", "Market", "Zoo"]);
  });

  test("returns empty array when no locations/ entries exist", async () => {
    await saveEntry("default", "people/hero", { ...DEFAULT_ENTRY, name: "Hero", enabled: true });
    const locations = await listLocationEntries("default");
    expect(locations).toEqual([]);
  });

  test("returns empty array for empty lorebook", async () => {
    const locations = await listLocationEntries("default");
    expect(locations).toEqual([]);
  });

  test("is scoped to the given lorebook", async () => {
    await createLorebook("world-a", "World A");
    await createLorebook("world-b", "World B");
    await saveEntry("world-a", "locations/castle", { ...DEFAULT_ENTRY, name: "Castle", enabled: true });
    await saveEntry("world-b", "locations/dungeon", { ...DEFAULT_ENTRY, name: "Dungeon", enabled: true });

    const locsA = await listLocationEntries("world-a");
    expect(locsA).toHaveLength(1);
    expect(locsA[0].name).toBe("Castle");

    const locsB = await listLocationEntries("world-b");
    expect(locsB).toHaveLength(1);
    expect(locsB[0].name).toBe("Dungeon");
  });

  test("includes path in returned entries", async () => {
    await saveEntry("default", "locations/tavern", { ...DEFAULT_ENTRY, name: "Tavern", enabled: true });
    const locations = await listLocationEntries("default");
    expect(locations[0].path).toBe("locations/tavern");
  });

  test("includes nested locations", async () => {
    await saveEntry("default", "locations/town/market", { ...DEFAULT_ENTRY, name: "Market", enabled: true });
    await saveEntry("default", "locations/town/inn", { ...DEFAULT_ENTRY, name: "Inn", enabled: true });
    const locations = await listLocationEntries("default");
    expect(locations).toHaveLength(2);
    const paths = locations.map((e) => e.path);
    expect(paths).toContain("locations/town/market");
    expect(paths).toContain("locations/town/inn");
  });
});
