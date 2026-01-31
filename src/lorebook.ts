import { join, dirname, resolve } from "path";
import { mkdir, readdir, unlink, rm, rmdir, rename, cp } from "fs/promises";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Schema for each lorebook JSON file */
export type LorebookEntry = {
  name: string;
  content: string;
  keywords: string[];
  regex: string; // empty string = no regex trigger
  priority: number; // higher = injected earlier
  enabled: boolean;
};

/** Metadata stored in _lorebook.json for each lorebook */
export type LorebookMeta = { name: string; template?: boolean };

/** A matched entry returned by the matching engine, with its path attached */
export type MatchedEntry = LorebookEntry & {
  path: string; // relative path within the lorebook, e.g. "people/gabrielle"
};

/** Tree node for the UI browser */
export type TreeNode = {
  name: string; // display name (directory or file stem)
  path: string; // relative path within the lorebook, no .json extension
  isEntry: boolean; // true if a .json file exists at this path
  children: TreeNode[]; // subdirectories and their contents
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_DIR = join(import.meta.dir, "..", "data");
const LOREBOOKS_DIR = join(DATA_DIR, "lorebooks");
const LOREBOOK_META_FILE = "_lorebook.json";

export const DEFAULT_ENTRY: LorebookEntry = {
  name: "",
  content: "",
  keywords: [],
  regex: "",
  priority: 0,
  enabled: true,
};

// ---------------------------------------------------------------------------
// Lorebook root helper
// ---------------------------------------------------------------------------

/** Sanitize a lorebook slug and return the absolute path to its directory. */
function lorebookRoot(lorebook: string): string {
  const slug = lorebook.replace(/[^a-z0-9_-]/gi, "").toLowerCase();
  if (!slug) throw new Error("Invalid lorebook slug");
  const abs = resolve(join(LOREBOOKS_DIR, slug));
  if (!abs.startsWith(resolve(LOREBOOKS_DIR))) {
    throw new Error("Invalid lorebook slug");
  }
  return abs;
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/**
 * Resolves a user-provided relative path to an absolute filesystem path
 * for a lorebook entry (.json file). Throws if the resolved path escapes
 * the lorebook's directory.
 */
export function resolveEntryPath(lorebook: string, relativePath: string): string {
  const root = lorebookRoot(lorebook);
  const cleaned = relativePath.replace(/^\/+|\/+$/g, "");
  const abs = resolve(join(root, cleaned + ".json"));
  if (!abs.startsWith(resolve(root))) {
    throw new Error("Invalid path");
  }
  return abs;
}

/**
 * Resolves a user-provided relative path to an absolute directory path
 * within a lorebook's directory. Throws if the resolved path escapes.
 */
export function resolveDirPath(lorebook: string, relativePath: string): string {
  const root = lorebookRoot(lorebook);
  const cleaned = relativePath.replace(/^\/+|\/+$/g, "");
  const abs = resolve(join(root, cleaned));
  if (!abs.startsWith(resolve(root))) {
    throw new Error("Invalid path");
  }
  return abs;
}

// ---------------------------------------------------------------------------
// Tree scanning
// ---------------------------------------------------------------------------

/**
 * Recursively scans a lorebook's directory and returns a nested TreeNode structure.
 * Each .json file becomes a node with isEntry=true.
 * Each subdirectory becomes a node with children.
 */
export async function scanTree(lorebook: string): Promise<TreeNode[]> {
  const root = lorebookRoot(lorebook);
  await mkdir(root, { recursive: true });
  return scanDir(root, "");
}

async function scanDir(absDir: string, relativePrefix: string): Promise<TreeNode[]> {
  const entries = await readdir(absDir, { withFileTypes: true });
  const nodeMap = new Map<string, TreeNode>();

  // First pass: collect .json files (skip _lorebook.json)
  for (const ent of entries) {
    if (ent.isFile() && ent.name.endsWith(".json") && ent.name !== LOREBOOK_META_FILE) {
      const stem = ent.name.slice(0, -5);
      const relPath = relativePrefix ? relativePrefix + "/" + stem : stem;
      let entryName = stem;
      try {
        const data = await Bun.file(join(absDir, ent.name)).json();
        if (data && typeof data.name === "string" && data.name.trim()) {
          entryName = data.name;
        }
      } catch {
        // use filename stem as fallback
      }
      nodeMap.set(stem, {
        name: entryName,
        path: relPath,
        isEntry: true,
        children: [],
      });
    }
  }

  // Second pass: collect directories
  for (const ent of entries) {
    if (ent.isDirectory()) {
      const relPath = relativePrefix ? relativePrefix + "/" + ent.name : ent.name;
      const children = await scanDir(join(absDir, ent.name), relPath);
      const existing = nodeMap.get(ent.name);
      if (existing) {
        // Merge: entry file + directory with same name
        existing.children = children;
      } else {
        nodeMap.set(ent.name, {
          name: ent.name,
          path: relPath,
          isEntry: false,
          children,
        });
      }
    }
  }

  // Sort alphabetically by map key
  const sorted = [...nodeMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return sorted.map(([, node]) => node);
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/** Load a single entry. Returns null if file doesn't exist. */
export async function loadEntry(lorebook: string, relativePath: string): Promise<LorebookEntry | null> {
  const absPath = resolveEntryPath(lorebook, relativePath);
  const f = Bun.file(absPath);
  if (!(await f.exists())) return null;
  try {
    return (await f.json()) as LorebookEntry;
  } catch {
    return null;
  }
}

/** Save an entry (creates parent dirs as needed). */
export async function saveEntry(lorebook: string, relativePath: string, entry: LorebookEntry): Promise<void> {
  const absPath = resolveEntryPath(lorebook, relativePath);
  await mkdir(dirname(absPath), { recursive: true });
  await Bun.write(absPath, JSON.stringify(entry, null, 2) + "\n");
}

/** Delete an entry file. */
export async function deleteEntry(lorebook: string, relativePath: string): Promise<void> {
  const absPath = resolveEntryPath(lorebook, relativePath);
  await unlink(absPath);

  // Clean up empty parent directories up to the lorebook root
  let dir = dirname(absPath);
  const root = resolve(lorebookRoot(lorebook));
  while (dir !== root && dir.startsWith(root)) {
    try {
      const contents = await readdir(dir);
      if (contents.length === 0) {
        await rmdir(dir);
        dir = dirname(dir);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

/** Create a directory (for organizational folders). */
export async function createFolder(lorebook: string, relativePath: string): Promise<void> {
  const absPath = resolveDirPath(lorebook, relativePath);
  await mkdir(absPath, { recursive: true });
}

/** Delete a folder (recursive). */
export async function deleteFolder(lorebook: string, relativePath: string): Promise<void> {
  const absPath = resolveDirPath(lorebook, relativePath);
  await rm(absPath, { recursive: true });
}

/** Load ALL entries recursively (for the matching engine). */
export async function loadAllEntries(lorebook: string): Promise<MatchedEntry[]> {
  const root = lorebookRoot(lorebook);
  await mkdir(root, { recursive: true });
  return collectEntries(root, "");
}

async function collectEntries(absDir: string, relativePrefix: string): Promise<MatchedEntry[]> {
  const entries = await readdir(absDir, { withFileTypes: true });
  const results: MatchedEntry[] = [];

  for (const ent of entries) {
    if (ent.isFile() && ent.name.endsWith(".json") && ent.name !== LOREBOOK_META_FILE) {
      const stem = ent.name.slice(0, -5);
      const relPath = relativePrefix ? relativePrefix + "/" + stem : stem;
      try {
        const data = (await Bun.file(join(absDir, ent.name)).json()) as LorebookEntry;
        results.push({ ...data, path: relPath });
      } catch {
        // skip invalid files
      }
    } else if (ent.isDirectory()) {
      const relPath = relativePrefix ? relativePrefix + "/" + ent.name : ent.name;
      const sub = await collectEntries(join(absDir, ent.name), relPath);
      results.push(...sub);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Location entries
// ---------------------------------------------------------------------------

/** Return all entries whose path starts with "locations/", sorted by name. */
export async function listLocationEntries(lorebook: string): Promise<MatchedEntry[]> {
  const all = await loadAllEntries(lorebook);
  return all
    .filter((e) => e.path.startsWith("locations/"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Matching engine
// ---------------------------------------------------------------------------

/**
 * Scans all enabled lorebook entries and returns those matching the given text.
 * An entry matches if ANY of these fire:
 *   1. Keywords — any keyword is a case-insensitive substring of `text`
 *   2. Regex — the entry's regex pattern matches `text`
 *
 * Returns matched entries sorted by priority descending (highest first).
 */
export async function findMatchingEntries(lorebook: string, text: string): Promise<MatchedEntry[]> {
  const allEntries = await loadAllEntries(lorebook);
  const textLower = text.toLowerCase();
  const matched: MatchedEntry[] = [];

  for (const entry of allEntries) {
    if (!entry.enabled) continue;

    let isMatch = false;

    // Keyword matching
    if (entry.keywords.some((kw) => textLower.includes(kw.toLowerCase()))) {
      isMatch = true;
    }

    // Regex matching
    if (!isMatch && entry.regex !== "") {
      try {
        if (new RegExp(entry.regex, "i").test(text)) {
          isMatch = true;
        }
      } catch {
        // Invalid regex — skip
      }
    }

    if (isMatch) {
      matched.push(entry);
    }
  }

  // Sort by priority descending
  matched.sort((a, b) => b.priority - a.priority);
  return matched;
}

// ---------------------------------------------------------------------------
// Lorebook management
// ---------------------------------------------------------------------------

/** List all lorebooks by scanning LOREBOOKS_DIR for directories with _lorebook.json. */
export async function listLorebooks(): Promise<{ slug: string; meta: LorebookMeta }[]> {
  await mkdir(LOREBOOKS_DIR, { recursive: true });
  const entries = await readdir(LOREBOOKS_DIR, { withFileTypes: true });
  const results: { slug: string; meta: LorebookMeta }[] = [];

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const metaPath = join(LOREBOOKS_DIR, ent.name, LOREBOOK_META_FILE);
    try {
      const meta = (await Bun.file(metaPath).json()) as LorebookMeta;
      results.push({ slug: ent.name, meta });
    } catch {
      // skip directories without valid _lorebook.json
    }
  }

  results.sort((a, b) => a.slug.localeCompare(b.slug));
  return results;
}

/** Create a new lorebook with the given slug and display name. */
export async function createLorebook(slug: string, name: string): Promise<void> {
  const root = lorebookRoot(slug);
  await mkdir(root, { recursive: true });
  const meta: LorebookMeta = { name };
  await Bun.write(join(root, LOREBOOK_META_FILE), JSON.stringify(meta, null, 2) + "\n");
}

/** Delete a lorebook directory recursively. */
export async function deleteLorebook(slug: string): Promise<void> {
  const root = lorebookRoot(slug);
  await rm(root, { recursive: true });
}

/** Load the metadata for a lorebook. Returns null if not found. */
export async function loadLorebookMeta(slug: string): Promise<LorebookMeta | null> {
  const root = lorebookRoot(slug);
  const metaPath = join(root, LOREBOOK_META_FILE);
  const f = Bun.file(metaPath);
  if (!(await f.exists())) return null;
  try {
    return (await f.json()) as LorebookMeta;
  } catch {
    return null;
  }
}

/**
 * Migration: if no lorebook directories with _lorebook.json exist,
 * move all existing files/folders into a "default" subdirectory and
 * create its _lorebook.json.
 */
export async function ensureDefaultLorebook(): Promise<void> {
  await mkdir(LOREBOOKS_DIR, { recursive: true });

  // Check if any lorebook already exists
  const entries = await readdir(LOREBOOKS_DIR, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.isDirectory()) {
      const metaPath = join(LOREBOOKS_DIR, ent.name, LOREBOOK_META_FILE);
      try {
        await Bun.file(metaPath).json();
        // At least one lorebook exists — nothing to migrate
        return;
      } catch {
        // no valid meta, continue checking
      }
    }
  }

  // No lorebook found — migrate existing content into default/
  const defaultRoot = join(LOREBOOKS_DIR, "default");

  // Collect items to move (anything currently in LOREBOOKS_DIR)
  const itemsToMove = entries.filter((e) => e.name !== "default");

  if (itemsToMove.length > 0) {
    await mkdir(defaultRoot, { recursive: true });
    for (const item of itemsToMove) {
      const src = join(LOREBOOKS_DIR, item.name);
      const dst = join(defaultRoot, item.name);
      await rename(src, dst);
    }
  } else {
    await mkdir(defaultRoot, { recursive: true });
  }

  // Write metadata
  const meta: LorebookMeta = { name: "Default Lorebook" };
  await Bun.write(join(defaultRoot, LOREBOOK_META_FILE), JSON.stringify(meta, null, 2) + "\n");
}

/**
 * Copy an entire lorebook to a new slug. The new lorebook gets its own
 * _lorebook.json with `template: false` and the given display name.
 */
export async function copyLorebook(sourceSlug: string, destSlug: string, destName: string): Promise<void> {
  const srcRoot = lorebookRoot(sourceSlug);
  const dstRoot = lorebookRoot(destSlug);
  await cp(srcRoot, dstRoot, { recursive: true });
  // Overwrite metadata so the copy is not a template
  const meta: LorebookMeta = { name: destName };
  await Bun.write(join(dstRoot, LOREBOOK_META_FILE), JSON.stringify(meta, null, 2) + "\n");
}

/**
 * Seed built-in template lorebooks. Called at startup.
 * Only creates templates that don't already exist.
 */
export async function seedTemplates(): Promise<void> {
  await mkdir(LOREBOOKS_DIR, { recursive: true });

  const slug = "template-key-quest";
  const root = lorebookRoot(slug);
  const metaPath = join(root, LOREBOOK_META_FILE);
  try {
    await Bun.file(metaPath).json();
    return; // already seeded
  } catch {
    // doesn't exist yet — create it
  }

  await mkdir(root, { recursive: true });
  const meta: LorebookMeta = { name: "Key Quest", template: true };
  await Bun.write(join(root, LOREBOOK_META_FILE), JSON.stringify(meta, null, 2) + "\n");

  const entries: Record<string, LorebookEntry> = {
    "characters/old-sage": {
      name: "The Old Sage",
      content: "A wizened old man who sits by the fountain in the village square. He speaks in riddles but knows many secrets. When asked about the key, he says: \"The one who shapes iron holds what you seek. Visit the blacksmith's forge.\"",
      keywords: ["old sage", "sage", "wise man", "old man"],
      regex: "",
      priority: 10,
      enabled: true,
    },
    "characters/blacksmith": {
      name: "Brondar the Blacksmith",
      content: "A burly dwarf who runs the village forge. He is gruff but fair. He possesses an old iron key that was left in his care long ago. If the player mentions the sage sent them, Brondar hands over the key: \"Aye, the sage said someone would come for it. Take it — but be careful what you unlock.\"",
      keywords: ["blacksmith", "brondar", "forge", "dwarf"],
      regex: "",
      priority: 10,
      enabled: true,
    },
    "characters/innkeeper": {
      name: "Marta the Innkeeper",
      content: "A cheerful halfling woman who runs The Sleeping Fox inn. She knows every rumor in the village. When asked about a locked room, she whispers: \"There's a door in the old cellar beneath the inn that no one has opened in years. They say treasure lies behind it.\"",
      keywords: ["innkeeper", "marta", "inn", "sleeping fox"],
      regex: "",
      priority: 10,
      enabled: true,
    },
    "items/iron-key": {
      name: "The Iron Key",
      content: "A heavy, old iron key with strange runes etched along its shaft. It was forged decades ago to lock away something valuable. The blacksmith Brondar has kept it safe. It opens the locked door in the cellar of The Sleeping Fox inn.",
      keywords: ["iron key", "key", "runed key"],
      regex: "",
      priority: 15,
      enabled: true,
    },
    "locations/village-square": {
      name: "The Village Square",
      content: "The heart of the small village. A stone fountain sits in the center, surrounded by market stalls. The Old Sage can usually be found sitting on a bench near the fountain. The blacksmith's forge is on the east side, and The Sleeping Fox inn is on the west.",
      keywords: ["village square", "square", "village", "fountain"],
      regex: "",
      priority: 5,
      enabled: true,
    },
    "locations/cellar": {
      name: "The Inn Cellar",
      content: "A damp, dimly lit cellar beneath The Sleeping Fox inn. Barrels of ale line the walls. At the far end, a heavy iron door stands shut, covered in dust. The door has a single keyhole — the Iron Key fits it perfectly.",
      keywords: ["cellar", "inn cellar", "locked door", "iron door"],
      regex: "",
      priority: 10,
      enabled: true,
    },
    "locations/treasure-room": {
      name: "The Treasure Room",
      content: "Behind the locked iron door lies a small stone chamber. In the center, on a pedestal, sits a golden chest. Inside the chest: a pouch of 200 gold coins, a silver dagger with a sapphire pommel, and a rolled-up map leading to further adventures.",
      keywords: ["treasure room", "treasure", "golden chest", "chest"],
      regex: "",
      priority: 20,
      enabled: true,
    },
  };

  for (const [path, entry] of Object.entries(entries)) {
    const absPath = join(root, path + ".json");
    await mkdir(dirname(absPath), { recursive: true });
    await Bun.write(absPath, JSON.stringify(entry, null, 2) + "\n");
  }
}

// ---------------------------------------------------------------------------
// Entry validation
// ---------------------------------------------------------------------------

/**
 * Validates and sanitizes a raw body object into a LorebookEntry.
 * Throws Error with message on invalid input.
 */
export function validateEntry(body: unknown): LorebookEntry {
  if (!body || typeof body !== "object") throw new Error("Body must be a JSON object");
  const obj = body as Record<string, unknown>;

  // name
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  if (!name) throw new Error("Name is required");

  // content
  const content = typeof obj.content === "string" ? obj.content : "";

  // keywords — accept comma-separated string or array
  let keywords: string[];
  const rawKeywords = obj.keywords;
  if (typeof rawKeywords === "string") {
    keywords = rawKeywords
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (Array.isArray(rawKeywords)) {
    keywords = rawKeywords
      .filter((k) => typeof k === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    keywords = [];
  }

  // regex
  const regex = typeof obj.regex === "string" ? obj.regex : "";
  if (regex !== "") {
    try {
      new RegExp(regex);
    } catch {
      throw new Error("Invalid regex pattern");
    }
  }

  // priority
  let priority = typeof obj.priority === "number" ? obj.priority : Number(obj.priority);
  if (!Number.isFinite(priority)) priority = 0;
  priority = Math.round(priority);

  // enabled — json-enc sends "on" for checked checkboxes, omits unchecked
  const enabled = obj.enabled === true || obj.enabled === "on";

  return { name, content, keywords, regex, priority, enabled };
}
