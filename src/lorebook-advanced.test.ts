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
  findActiveEntries,
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
  try { await rm(LOREBOOKS_DIR, { recursive: true }); } catch {}
}

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

    await saveEntry("source", "entry", { ...DEFAULT_ENTRY, name: "Modified", enabled: true });

    const copied = await loadEntry("copy", "entry");
    expect(copied!.name).toBe("Original");
  });

  test("copied lorebook is not a template", async () => {
    await createLorebook("source", "Source");
    const root = join(LOREBOOKS_DIR, "source");
    await Bun.write(join(root, "_lorebook.json"), JSON.stringify({ name: "Source", template: true }));

    await copyLorebook("source", "copy", "My Copy");
    const meta = await loadLorebookMeta("copy");
    expect(meta!.template).toBeUndefined();
  });
});

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
    expect(all).toHaveLength(8);
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

describe("findActiveEntries", () => {
  beforeEach(async () => { await cleanLorebooks(); await createLorebook("default", "Default"); });
  afterEach(cleanLorebooks);

  async function seedContextEntries() {
    await saveEntry("default", "locations/village-square", {
      ...DEFAULT_ENTRY, name: "Village Square", keywords: ["village", "square"],
      priority: 5, enabled: true, contexts: [],
      characters: ["characters/sage", "characters/guard"],
    });
    await saveEntry("default", "characters/sage", {
      ...DEFAULT_ENTRY, name: "The Sage", keywords: ["sage", "wise man"],
      priority: 10, enabled: true, contexts: [],
      homeLocation: "locations/village-square",
    });
    await saveEntry("default", "items/iron-key", {
      ...DEFAULT_ENTRY, name: "Iron Key", keywords: ["key", "iron key"],
      priority: 15, enabled: true, contexts: [],
      location: "characters/sage",
    });
    await saveEntry("default", "locations/treasure-room", {
      ...DEFAULT_ENTRY, name: "Treasure Room", keywords: ["treasure"],
      priority: 20, enabled: true, contexts: [],
      characters: [],
    });
    // guard requires trait:warrior
    await saveEntry("default", "characters/guard", {
      ...DEFAULT_ENTRY, name: "The Guard", keywords: ["guard"],
      priority: 10, enabled: true, contexts: ["trait:warrior"],
      homeLocation: "locations/village-square",
    });
    await saveEntry("default", "goals/find-key", {
      ...DEFAULT_ENTRY, name: "Find the Key", keywords: [],
      priority: 5, enabled: true, contexts: [],
      requirements: ["Get the key from the sage"],
      completed: false,
    });
  }

  test("current location entry is always active", async () => {
    await seedContextEntries();
    const result = await findActiveEntries("default", {
      text: "", currentLocation: "locations/village-square", traits: [],
    });
    const paths = result.map((e) => e.path);
    expect(paths).toContain("locations/village-square");
  });

  test("items activate based on location field", async () => {
    await saveEntry("default", "items/torch", {
      ...DEFAULT_ENTRY, name: "Torch", keywords: ["torch", "light"],
      priority: 5, enabled: true, contexts: [],
      location: "player",
    });
    const result = await findActiveEntries("default", {
      text: "", currentLocation: "", traits: [],
    });
    const paths = result.map((e) => e.path);
    expect(paths).toContain("items/torch");
  });

  test("location entries do NOT activate via keyword — only current location is active", async () => {
    await seedContextEntries();
    const result = await findActiveEntries("default", {
      text: "I remember the village square", currentLocation: "locations/treasure-room", traits: [],
    });
    const paths = result.map((e) => e.path);
    expect(paths).toContain("locations/treasure-room");
    expect(paths).not.toContain("locations/village-square");
  });

  test("characters with no matching location do NOT activate", async () => {
    await seedContextEntries();
    const result = await findActiveEntries("default", {
      text: "I talk to the sage", currentLocation: "", traits: [],
    });
    const paths = result.map((e) => e.path);
    expect(paths).not.toContain("characters/sage");
  });

  test("chained activation (location -> home character -> item at character)", async () => {
    await seedContextEntries();
    const result = await findActiveEntries("default", {
      text: "",
      currentLocation: "locations/village-square",
      traits: [],
    });
    const paths = result.map((e) => e.path);
    expect(paths).toContain("locations/village-square");
    expect(paths).toContain("characters/sage");
    expect(paths).toContain("items/iron-key");
    expect(paths).not.toContain("locations/treasure-room");
  });

  test("trait-based context activation for character at location", async () => {
    await seedContextEntries();
    const result = await findActiveEntries("default", {
      text: "", currentLocation: "locations/village-square", traits: ["warrior"],
    });
    const paths = result.map((e) => e.path);
    expect(paths).toContain("characters/guard");
  });

  // Characters activate by location, not by context gates
  test("characters activate at home location regardless of traits", async () => {
    await seedContextEntries();
    const result = await findActiveEntries("default", {
      text: "", currentLocation: "locations/village-square", traits: [],
    });
    const paths = result.map((e) => e.path);
    expect(paths).toContain("characters/guard");
  });

  test("characters not at current location do not activate", async () => {
    await seedContextEntries();
    const result = await findActiveEntries("default", {
      text: "sage",
      currentLocation: "locations/treasure-room",
      traits: [],
    });
    const paths = result.map((e) => e.path);
    expect(paths).not.toContain("characters/sage");
  });

  test("disabled entries are not activated", async () => {
    await saveEntry("default", "characters/ghost", {
      ...DEFAULT_ENTRY, name: "Ghost", keywords: ["ghost"],
      priority: 10, enabled: false, contexts: [],
    });
    const result = await findActiveEntries("default", {
      text: "I see a ghost", currentLocation: "", traits: [],
    });
    const paths = result.map((e) => e.path);
    expect(paths).not.toContain("characters/ghost");
  });

  test("returns entries with correct category", async () => {
    await seedContextEntries();
    const result = await findActiveEntries("default", {
      text: "", currentLocation: "locations/village-square", traits: [],
    });
    const square = result.find((e) => e.path === "locations/village-square");
    expect(square).toBeDefined();
    expect(square!.category).toBe("locations");
    const sage = result.find((e) => e.path === "characters/sage");
    expect(sage).toBeDefined();
    expect(sage!.category).toBe("characters");
  });

  test("returns empty array for empty lorebook", async () => {
    const result = await findActiveEntries("default", {
      text: "anything", currentLocation: "", traits: [],
    });
    expect(result).toEqual([]);
  });

  test("home characters auto-activate at their home location", async () => {
    await seedContextEntries();
    const result = await findActiveEntries("default", {
      text: "", currentLocation: "locations/village-square", traits: [],
    });
    const paths = result.map((e) => e.path);
    expect(paths).toContain("characters/sage");
  });

  test("currentLocation field takes precedence over homeLocation", async () => {
    await seedContextEntries();
    await saveEntry("default", "characters/sage", {
      ...DEFAULT_ENTRY, name: "The Sage", keywords: ["sage"],
      priority: 10, enabled: true, contexts: [],
      homeLocation: "locations/village-square",
      currentLocation: "locations/treasure-room",
    });
    const result = await findActiveEntries("default", {
      text: "", currentLocation: "locations/treasure-room", traits: [],
    });
    const paths = result.map((e) => e.path);
    expect(paths).toContain("characters/sage");
    // At village-square, sage should NOT activate (currentLocation overrides homeLocation)
    const result2 = await findActiveEntries("default", {
      text: "", currentLocation: "locations/village-square", traits: [],
    });
    const paths2 = result2.map((e) => e.path);
    expect(paths2).not.toContain("characters/sage");
  });

  test("incomplete goals always activate", async () => {
    await seedContextEntries();
    const result = await findActiveEntries("default", {
      text: "", currentLocation: "", traits: [],
    });
    const paths = result.map((e) => e.path);
    expect(paths).toContain("goals/find-key");
  });

  test("completed goals do not activate", async () => {
    await seedContextEntries();
    await saveEntry("default", "goals/find-key", {
      ...DEFAULT_ENTRY, name: "Find the Key", keywords: [],
      priority: 5, enabled: true, contexts: [],
      requirements: ["Get the key"],
      completed: true,
    });
    const result = await findActiveEntries("default", {
      text: "", currentLocation: "", traits: [],
    });
    const paths = result.map((e) => e.path);
    expect(paths).not.toContain("goals/find-key");
  });

  test("items at player location activate", async () => {
    await saveEntry("default", "locations/tavern", {
      ...DEFAULT_ENTRY, name: "Tavern", keywords: ["tavern"],
      priority: 5, enabled: true, contexts: [],
    });
    await saveEntry("default", "items/sword", {
      ...DEFAULT_ENTRY, name: "Sword", keywords: ["sword"],
      priority: 10, enabled: true, contexts: [],
      location: "locations/tavern",
    });
    const result = await findActiveEntries("default", {
      text: "", currentLocation: "locations/tavern", traits: [],
    });
    const paths = result.map((e) => e.path);
    expect(paths).toContain("items/sword");
  });

  test("items carried by player activate everywhere", async () => {
    await saveEntry("default", "items/amulet", {
      ...DEFAULT_ENTRY, name: "Amulet", keywords: ["amulet"],
      priority: 10, enabled: true, contexts: [],
      location: "player",
    });
    const result = await findActiveEntries("default", {
      text: "", currentLocation: "locations/village-square", traits: [],
    });
    const paths = result.map((e) => e.path);
    expect(paths).toContain("items/amulet");
  });

  test("items at active character activate", async () => {
    await seedContextEntries();
    const result = await findActiveEntries("default", {
      text: "", currentLocation: "locations/village-square", traits: [],
    });
    const paths = result.map((e) => e.path);
    expect(paths).toContain("items/iron-key");
  });

  test("active entry includes type-specific fields", async () => {
    await seedContextEntries();
    const result = await findActiveEntries("default", {
      text: "", currentLocation: "locations/village-square", traits: [],
    });
    const goal = result.find((e) => e.path === "goals/find-key");
    expect(goal).toBeDefined();
    expect(goal!.completed).toBe(false);
    expect(goal!.requirements).toEqual(["Get the key from the sage"]);
  });
});
