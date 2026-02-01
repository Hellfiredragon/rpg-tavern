import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join, resolve } from "path";
import { rm } from "fs/promises";
import {
  saveEntry,
  loadEntry,
  deleteEntry,
  createFolder,
  deleteFolder,
  loadAllEntries,
  scanTree,
  findMatchingEntries,
  listLocationEntries,
  createLorebook,
  listLorebooks,
  deleteLorebook,
  loadLorebookMeta,
  copyLorebook,
  isPresetLorebook,
  saveLorebookMeta,
  DEFAULT_ENTRY,
} from "./lorebook";

const LOREBOOKS_DIR = resolve(join(import.meta.dir, "..", "data-test", "lorebooks"));

async function cleanLorebooks() {
  try {
    await rm(LOREBOOKS_DIR, { recursive: true });
  } catch {
    // doesn't exist yet
  }
}

// ---------------------------------------------------------------------------
// Matching engine
// ---------------------------------------------------------------------------

describe("findMatchingEntries", () => {
  beforeEach(async () => { await cleanLorebooks(); await createLorebook("default", "Default"); });
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

  test("listLorebooks returns sorted lorebooks including presets", async () => {
    await createLorebook("beta", "Beta World");
    await createLorebook("alpha", "Alpha World");
    const list = await listLorebooks();
    // Should include alpha, beta, default (preset), template-key-quest (preset)
    const userSlugs = list.filter((l) => !l.preset).map((l) => l.slug);
    expect(userSlugs).toContain("alpha");
    expect(userSlugs).toContain("beta");
    const presetSlugs = list.filter((l) => l.preset).map((l) => l.slug);
    expect(presetSlugs).toContain("default");
    expect(presetSlugs).toContain("template-key-quest");
  });

  test("listLorebooks returns presets even when no user lorebooks exist", async () => {
    const list = await listLorebooks();
    expect(list.length).toBeGreaterThanOrEqual(2);
    const slugs = list.map((l) => l.slug);
    expect(slugs).toContain("default");
    expect(slugs).toContain("template-key-quest");
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
// Preset lorebooks
// ---------------------------------------------------------------------------

describe("preset lorebooks", () => {
  beforeEach(cleanLorebooks);
  afterEach(cleanLorebooks);

  test("isPresetLorebook returns true for preset slugs", async () => {
    expect(await isPresetLorebook("template-key-quest")).toBe(true);
    expect(await isPresetLorebook("default")).toBe(true);
  });

  test("isPresetLorebook returns false for non-preset slugs", async () => {
    expect(await isPresetLorebook("my-custom")).toBe(false);
    expect(await isPresetLorebook("")).toBe(false);
  });

  test("read functions work on preset lorebooks", async () => {
    const meta = await loadLorebookMeta("template-key-quest");
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe("Key Quest");
    expect(meta!.template).toBe(true);

    const entry = await loadEntry("template-key-quest", "characters/old-sage");
    expect(entry).not.toBeNull();
    expect(entry!.name).toBe("The Old Sage");

    const all = await loadAllEntries("template-key-quest");
    expect(all).toHaveLength(7);
  });

  test("write functions throw on preset lorebooks", async () => {
    await expect(saveEntry("template-key-quest", "new-entry", { ...DEFAULT_ENTRY, name: "New" }))
      .rejects.toThrow("Cannot modify a preset lorebook");
    await expect(deleteEntry("template-key-quest", "characters/old-sage"))
      .rejects.toThrow("Cannot modify a preset lorebook");
    await expect(createFolder("template-key-quest", "new-folder"))
      .rejects.toThrow("Cannot modify a preset lorebook");
    await expect(deleteFolder("template-key-quest", "characters"))
      .rejects.toThrow("Cannot modify a preset lorebook");
    await expect(deleteLorebook("template-key-quest"))
      .rejects.toThrow("Cannot modify a preset lorebook");
  });

  test("copyLorebook from preset works", async () => {
    await copyLorebook("template-key-quest", "my-copy", "My Copy");
    const meta = await loadLorebookMeta("my-copy");
    expect(meta).toEqual({ name: "My Copy" });
    const entry = await loadEntry("my-copy", "characters/old-sage");
    expect(entry).not.toBeNull();
    expect(entry!.name).toBe("The Old Sage");
  });

  test("listLorebooks includes presets with preset flag", async () => {
    const list = await listLorebooks();
    const keyQuest = list.find((l) => l.slug === "template-key-quest");
    expect(keyQuest).toBeDefined();
    expect(keyQuest!.preset).toBe(true);
    expect(keyQuest!.meta.template).toBe(true);
  });

  test("user lorebook overrides preset of same slug", async () => {
    await createLorebook("template-key-quest", "Custom Key Quest", true);
    const list = await listLorebooks();
    const keyQuest = list.find((l) => l.slug === "template-key-quest");
    expect(keyQuest).toBeDefined();
    expect(keyQuest!.preset).toBe(false);
    expect(keyQuest!.meta.name).toBe("Custom Key Quest");
  });

  test("scanTree works on preset lorebooks", async () => {
    const tree = await scanTree("template-key-quest");
    const names = tree.map((n) => n.name);
    expect(names).toContain("characters");
    expect(names).toContain("items");
    expect(names).toContain("locations");
  });
});

// ---------------------------------------------------------------------------
// listLocationEntries
// ---------------------------------------------------------------------------

describe("listLocationEntries", () => {
  beforeEach(async () => { await cleanLorebooks(); await createLorebook("default", "Default"); });
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
