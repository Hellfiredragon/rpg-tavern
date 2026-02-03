import { join, dirname, resolve } from "path";
import { mkdir, readdir, unlink, rm, rmdir, cp, rename } from "fs/promises";

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
  contexts: string[]; // entry paths or "trait:" refs — all must be active for entry to activate
  // Location-specific (entries in locations/)
  characters?: string[];    // character paths that can appear here (template hint)
  // Character-specific (entries in characters/)
  homeLocation?: string;    // starting location path
  currentLocation?: string; // where the character is NOW (dynamic in adventures)
  state?: string[];         // status tags, e.g. ["friendly", "injured", "has-given-key"]
  goals?: string[];         // refs to goal entry paths, e.g. ["goals/find-key"]
  // Item-specific (entries in items/)
  location?: string;        // where the item is (location path, character path, or "player")
  // Goal-specific (entries in goals/)
  requirements?: string[];  // what must happen — freeform strings for LLM context
  completed?: boolean;      // whether the goal is done (default false)
};

/** Entry type inferred from folder path prefix. */
export type EntryType = "character" | "location" | "item" | "goal" | "other";

/** Determine entry type from its relative path. */
export function getEntryType(path: string): EntryType {
  if (path.startsWith("characters/")) return "character";
  if (path.startsWith("locations/")) return "location";
  if (path.startsWith("items/")) return "item";
  if (path.startsWith("goals/")) return "goal";
  return "other";
}

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

const DATA_DIR = process.env.DATA_DIR || join(import.meta.dir, "..", "data");
const LOREBOOKS_DIR = join(DATA_DIR, "lorebooks");
const PRESETS_DIR = join(import.meta.dir, "..", "presets", "lorebooks");
const LOREBOOK_META_FILE = "_lorebook.json";

export const DEFAULT_ENTRY: LorebookEntry = {
  name: "",
  content: "",
  keywords: [],
  regex: "",
  priority: 0,
  enabled: true,
  contexts: [],
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

/** Sanitize a lorebook slug and return the absolute path in the presets directory. */
function presetRoot(lorebook: string): string {
  const slug = lorebook.replace(/[^a-z0-9_-]/gi, "").toLowerCase();
  if (!slug) throw new Error("Invalid lorebook slug");
  const abs = resolve(join(PRESETS_DIR, slug));
  if (!abs.startsWith(resolve(PRESETS_DIR))) {
    throw new Error("Invalid lorebook slug");
  }
  return abs;
}

/** Check if a lorebook slug exists as a preset (read-only, shipped with the app). */
export async function isPresetLorebook(slug: string): Promise<boolean> {
  try {
    const root = presetRoot(slug);
    const f = Bun.file(join(root, LOREBOOK_META_FILE));
    return await f.exists();
  } catch {
    return false;
  }
}

/**
 * Resolve the root directory for a lorebook slug.
 * User data dir takes priority; falls back to presets dir.
 */
async function resolveLorebookRoot(slug: string): Promise<string> {
  const dataRoot = lorebookRoot(slug);
  const dataMetaPath = join(dataRoot, LOREBOOK_META_FILE);
  if (await Bun.file(dataMetaPath).exists()) return dataRoot;
  const presRoot = presetRoot(slug);
  const presMetaPath = join(presRoot, LOREBOOK_META_FILE);
  if (await Bun.file(presMetaPath).exists()) return presRoot;
  return dataRoot; // default for new lorebooks
}

/**
 * Check if a lorebook slug is a read-only preset (no user-data override).
 * Unlike isPresetLorebook(), returns false if the user has a data-dir copy.
 */
export async function isReadOnlyPreset(slug: string): Promise<boolean> {
  if (!(await isPresetLorebook(slug))) return false;
  const dataRoot = lorebookRoot(slug);
  const dataMetaPath = join(dataRoot, LOREBOOK_META_FILE);
  return !(await Bun.file(dataMetaPath).exists());
}

/** Throw if the lorebook is a read-only preset (write guard). */
async function assertNotPreset(slug: string): Promise<void> {
  if (await isReadOnlyPreset(slug)) {
    throw new Error("Cannot modify a preset lorebook");
  }
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/**
 * Resolves a user-provided relative path to an absolute filesystem path
 * for a lorebook entry (.json file). Throws if the resolved path escapes
 * the lorebook's directory.
 */
export function resolveEntryPath(lorebook: string, relativePath: string, root?: string): string {
  const r = root ?? lorebookRoot(lorebook);
  const cleaned = relativePath.replace(/^\/+|\/+$/g, "");
  const abs = resolve(join(r, cleaned + ".json"));
  if (!abs.startsWith(resolve(r))) {
    throw new Error("Invalid path");
  }
  return abs;
}

/**
 * Resolves a user-provided relative path to an absolute directory path
 * within a lorebook's directory. Throws if the resolved path escapes.
 */
export function resolveDirPath(lorebook: string, relativePath: string, root?: string): string {
  const r = root ?? lorebookRoot(lorebook);
  const cleaned = relativePath.replace(/^\/+|\/+$/g, "");
  const abs = resolve(join(r, cleaned));
  if (!abs.startsWith(resolve(r))) {
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
  const root = await resolveLorebookRoot(lorebook);
  if (root.startsWith(resolve(LOREBOOKS_DIR))) {
    await mkdir(root, { recursive: true });
  }
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
  const root = await resolveLorebookRoot(lorebook);
  const absPath = resolveEntryPath(lorebook, relativePath, root);
  const f = Bun.file(absPath);
  if (!(await f.exists())) return null;
  try {
    const data = (await f.json()) as LorebookEntry;
    if (!Array.isArray(data.contexts)) data.contexts = [];
    return data;
  } catch {
    return null;
  }
}

/** Save an entry (creates parent dirs as needed). */
export async function saveEntry(lorebook: string, relativePath: string, entry: LorebookEntry): Promise<void> {
  await assertNotPreset(lorebook);
  const absPath = resolveEntryPath(lorebook, relativePath);
  await mkdir(dirname(absPath), { recursive: true });
  await Bun.write(absPath, JSON.stringify(entry, null, 2) + "\n");
}

/** Delete an entry file. */
export async function deleteEntry(lorebook: string, relativePath: string): Promise<void> {
  await assertNotPreset(lorebook);
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

/**
 * Move an entry from one folder to another within a lorebook.
 * Returns the new relative path (without .json extension).
 */
export async function moveEntry(lorebook: string, oldPath: string, newFolder: string): Promise<string> {
  await assertNotPreset(lorebook);
  const root = lorebookRoot(lorebook);

  // Extract filename stem from oldPath (e.g. "characters/sage" → "sage")
  const parts = oldPath.replace(/^\/+|\/+$/g, "").split("/");
  const stem = parts[parts.length - 1];
  const oldFolder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";

  // Compute new relative path
  const newRelPath = newFolder ? `${newFolder}/${stem}` : stem;

  // Same folder → no-op
  if (oldFolder === newFolder) return oldPath;

  // Check destination doesn't already exist
  const newAbs = resolveEntryPath(lorebook, newRelPath, root);
  if (await Bun.file(newAbs).exists()) {
    throw new Error(`Entry already exists at ${newRelPath}`);
  }

  // Ensure destination directory exists
  await mkdir(dirname(newAbs), { recursive: true });

  // Move the file (atomic rename on same filesystem)
  const oldAbs = resolveEntryPath(lorebook, oldPath, root);
  await rename(oldAbs, newAbs);

  // Clean up empty source directories up to the lorebook root
  let dir = dirname(oldAbs);
  const rootResolved = resolve(root);
  while (dir !== rootResolved && dir.startsWith(rootResolved)) {
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

  return newRelPath;
}

/** Create a directory (for organizational folders). */
export async function createFolder(lorebook: string, relativePath: string): Promise<void> {
  await assertNotPreset(lorebook);
  const absPath = resolveDirPath(lorebook, relativePath);
  await mkdir(absPath, { recursive: true });
}

/** Delete a folder (recursive). */
export async function deleteFolder(lorebook: string, relativePath: string): Promise<void> {
  await assertNotPreset(lorebook);
  const absPath = resolveDirPath(lorebook, relativePath);
  await rm(absPath, { recursive: true });
}

/** Load ALL entries recursively (for the matching engine). */
export async function loadAllEntries(lorebook: string): Promise<MatchedEntry[]> {
  const root = await resolveLorebookRoot(lorebook);
  if (root.startsWith(resolve(LOREBOOKS_DIR))) {
    await mkdir(root, { recursive: true });
  }
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
        if (!Array.isArray(data.contexts)) data.contexts = [];
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
// Context-aware activation engine
// ---------------------------------------------------------------------------

export type ActivationContext = {
  text: string;                // recent chat text to match keywords against
  currentLocation: string;     // entry path, e.g. "locations/village-square"
  traits: string[];            // player traits, e.g. ["warrior", "stealthy"]
};

export type ActiveEntry = {
  path: string;
  name: string;
  content: string;
  category: string; // first path segment or "other"
  // Type-specific fields for UI display
  state?: string[];           // character state tags
  currentLocation?: string;   // character's current location path
  location?: string;          // item's current location
  completed?: boolean;        // goal completion status
  requirements?: string[];    // goal requirements
};

/** Helper: check keyword/regex match against text. */
function matchesText(entry: MatchedEntry, text: string, textLower: string): boolean {
  if (entry.keywords.some((kw) => textLower.includes(kw.toLowerCase()))) return true;
  if (entry.regex !== "") {
    try {
      if (new RegExp(entry.regex, "i").test(text)) return true;
    } catch { /* invalid regex */ }
  }
  return false;
}

/**
 * Find all lorebook entries that should be active given the current context.
 *
 * Algorithm:
 * 1. Seed: current location entry (from ChatMeta.currentLocation)
 * 2. Characters: activate if entry.currentLocation === playerLocation
 *    (fall back to homeLocation if currentLocation is unset)
 * 3. Items: activate if entry.location === playerLocation OR "player"
 *    OR matches an active character path
 * 4. Goals: activate if !completed (incomplete goals are always shown)
 * 5. Other entries: keyword/regex/context matching (existing fixed-point logic)
 */
export async function findActiveEntries(
  lorebook: string, context: ActivationContext
): Promise<ActiveEntry[]> {
  const allEntries = await loadAllEntries(lorebook);
  const activeSet = new Set<string>();
  const entryMap = new Map<string, MatchedEntry>();
  const textLower = context.text.toLowerCase();

  for (const entry of allEntries) {
    if (!entry.enabled) continue;
    entryMap.set(entry.path, entry);
  }

  // Step 1: Seed — current location is always active
  if (context.currentLocation && entryMap.has(context.currentLocation)) {
    activeSet.add(context.currentLocation);
  }

  // Step 2: Characters — activate if their currentLocation (or homeLocation fallback) matches
  for (const [path, entry] of entryMap) {
    if (getEntryType(path) !== "character") continue;
    const charLoc = entry.currentLocation || entry.homeLocation;
    if (charLoc && charLoc === context.currentLocation) {
      activeSet.add(path);
    }
  }

  // Step 3: Items — activate if location matches playerLocation, "player", or an active character
  for (const [path, entry] of entryMap) {
    if (getEntryType(path) !== "item") continue;
    if (!entry.location) continue;
    if (entry.location === context.currentLocation || entry.location === "player") {
      activeSet.add(path);
    } else if (activeSet.has(entry.location)) {
      activeSet.add(path);
    }
  }

  // Step 4: Goals — incomplete goals are always shown
  for (const [path, entry] of entryMap) {
    if (getEntryType(path) !== "goal") continue;
    if (!entry.completed) {
      activeSet.add(path);
    }
  }

  // Step 5: Fixed-point iteration for other entries (keyword/regex/context matching)
  let changed = true;
  while (changed) {
    changed = false;
    for (const [path, entry] of entryMap) {
      if (activeSet.has(path)) continue;
      const type = getEntryType(path);

      // Location entries are exclusive — only the current location can be active
      if (type === "location") continue;
      // Characters, items, and goals already handled above
      if (type === "character" || type === "item" || type === "goal") continue;

      // Check context gates
      const contextsOk = entry.contexts.length === 0 || entry.contexts.every((ctx) => {
        if (ctx.startsWith("trait:")) {
          return context.traits.includes(ctx.slice(6));
        }
        return activeSet.has(ctx);
      });
      if (!contextsOk) continue;

      // Check keyword/regex match
      if (matchesText(entry, context.text, textLower)) {
        activeSet.add(path);
        changed = true;
      }
    }
  }

  // Re-check items after fixed-point (new active characters may have items)
  for (const [path, entry] of entryMap) {
    if (activeSet.has(path)) continue;
    if (getEntryType(path) !== "item") continue;
    if (entry.location && activeSet.has(entry.location)) {
      activeSet.add(path);
    }
  }

  // Build result with type-specific fields
  const result: ActiveEntry[] = [];
  for (const path of activeSet) {
    const entry = entryMap.get(path);
    if (!entry) continue;
    const slashIdx = path.indexOf("/");
    const category = slashIdx > 0 ? path.slice(0, slashIdx) : "other";
    const active: ActiveEntry = { path, name: entry.name, content: entry.content, category };
    const type = getEntryType(path);
    if (type === "character") {
      if (entry.state && entry.state.length > 0) active.state = entry.state;
      if (entry.currentLocation) active.currentLocation = entry.currentLocation;
    }
    if (type === "item" && entry.location) {
      active.location = entry.location;
    }
    if (type === "goal") {
      active.completed = !!entry.completed;
      if (entry.requirements) active.requirements = entry.requirements;
    }
    result.push(active);
  }

  result.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return result;
}

// ---------------------------------------------------------------------------
// Lorebook management
// ---------------------------------------------------------------------------

/** List all lorebooks by scanning both data and presets directories. */
export async function listLorebooks(): Promise<{ slug: string; meta: LorebookMeta; preset: boolean }[]> {
  await mkdir(LOREBOOKS_DIR, { recursive: true });
  const seen = new Set<string>();
  const results: { slug: string; meta: LorebookMeta; preset: boolean }[] = [];

  // Data dir first (user lorebooks take priority)
  const dataEntries = await readdir(LOREBOOKS_DIR, { withFileTypes: true });
  for (const ent of dataEntries) {
    if (!ent.isDirectory()) continue;
    const metaPath = join(LOREBOOKS_DIR, ent.name, LOREBOOK_META_FILE);
    try {
      const meta = (await Bun.file(metaPath).json()) as LorebookMeta;
      results.push({ slug: ent.name, meta, preset: false });
      seen.add(ent.name);
    } catch {
      // skip directories without valid _lorebook.json
    }
  }

  // Presets dir (skip slugs already seen in data dir)
  try {
    const presetEntries = await readdir(PRESETS_DIR, { withFileTypes: true });
    for (const ent of presetEntries) {
      if (!ent.isDirectory()) continue;
      if (seen.has(ent.name)) continue;
      const metaPath = join(PRESETS_DIR, ent.name, LOREBOOK_META_FILE);
      try {
        const meta = (await Bun.file(metaPath).json()) as LorebookMeta;
        results.push({ slug: ent.name, meta, preset: true });
      } catch {
        // skip
      }
    }
  } catch {
    // presets dir may not exist in some environments
  }

  results.sort((a, b) => a.slug.localeCompare(b.slug));
  return results;
}

/** Create a new lorebook with the given slug and display name. */
export async function createLorebook(slug: string, name: string, template?: boolean): Promise<void> {
  const root = lorebookRoot(slug);
  await mkdir(root, { recursive: true });
  const meta: LorebookMeta = { name };
  if (template) meta.template = true;
  await Bun.write(join(root, LOREBOOK_META_FILE), JSON.stringify(meta, null, 2) + "\n");
}

/** Delete a lorebook directory recursively. */
export async function deleteLorebook(slug: string): Promise<void> {
  await assertNotPreset(slug);
  const root = lorebookRoot(slug);
  await rm(root, { recursive: true });
}

/** Load the metadata for a lorebook. Returns null if not found. */
export async function loadLorebookMeta(slug: string): Promise<LorebookMeta | null> {
  const root = await resolveLorebookRoot(slug);
  const metaPath = join(root, LOREBOOK_META_FILE);
  const f = Bun.file(metaPath);
  if (!(await f.exists())) return null;
  try {
    return (await f.json()) as LorebookMeta;
  } catch {
    return null;
  }
}

/** Write updated metadata for an existing lorebook. */
export async function saveLorebookMeta(slug: string, meta: LorebookMeta): Promise<void> {
  await assertNotPreset(slug);
  const root = lorebookRoot(slug);
  await Bun.write(join(root, LOREBOOK_META_FILE), JSON.stringify(meta, null, 2) + "\n");
}

/**
 * Copy an entire lorebook to a new slug. The new lorebook gets its own
 * _lorebook.json with `template: false` and the given display name.
 * Source may be a preset or user lorebook; destination is always in data dir.
 */
export async function copyLorebook(sourceSlug: string, destSlug: string, destName: string): Promise<void> {
  const srcRoot = await resolveLorebookRoot(sourceSlug);
  const dstRoot = lorebookRoot(destSlug);
  await cp(srcRoot, dstRoot, { recursive: true });
  // Overwrite metadata so the copy is not a template
  const meta: LorebookMeta = { name: destName };
  await Bun.write(join(dstRoot, LOREBOOK_META_FILE), JSON.stringify(meta, null, 2) + "\n");
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

  // contexts — accept comma-separated string or array
  let contexts: string[];
  const rawContexts = obj.contexts;
  if (typeof rawContexts === "string") {
    contexts = rawContexts
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (Array.isArray(rawContexts)) {
    contexts = rawContexts
      .filter((c) => typeof c === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    contexts = [];
  }

  // characters — location-specific, accept comma-separated string or array
  let characters: string[] | undefined;
  const rawChars = obj.characters;
  if (typeof rawChars === "string") {
    characters = rawChars.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (Array.isArray(rawChars)) {
    characters = rawChars.filter((c) => typeof c === "string").map((s) => s.trim()).filter(Boolean);
  }

  // homeLocation — character-specific
  const homeLocation = typeof obj.homeLocation === "string" ? obj.homeLocation.trim() || undefined : undefined;

  // currentLocation — character-specific (dynamic)
  const currentLocation = typeof obj.currentLocation === "string" ? obj.currentLocation.trim() || undefined : undefined;

  // state — character-specific, accept comma-separated string or array
  let state: string[] | undefined;
  const rawState = obj.state;
  if (typeof rawState === "string") {
    state = rawState.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (Array.isArray(rawState)) {
    state = rawState.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean);
  }

  // goals — character-specific, accept comma-separated string or array
  let goals: string[] | undefined;
  const rawGoals = obj.goals;
  if (typeof rawGoals === "string") {
    goals = rawGoals.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (Array.isArray(rawGoals)) {
    goals = rawGoals.filter((g) => typeof g === "string").map((s) => s.trim()).filter(Boolean);
  }

  // location — item-specific
  const location = typeof obj.location === "string" ? obj.location.trim() || undefined : undefined;

  // requirements — goal-specific, accept comma-separated string or array
  let requirements: string[] | undefined;
  const rawReqs = obj.requirements;
  if (typeof rawReqs === "string") {
    requirements = rawReqs.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (Array.isArray(rawReqs)) {
    requirements = rawReqs.filter((r) => typeof r === "string").map((s) => s.trim()).filter(Boolean);
  }

  // completed — goal-specific
  const completed = obj.completed === true ? true : undefined;

  const entry: LorebookEntry = { name, content, keywords, regex, priority, enabled, contexts };
  if (characters !== undefined) entry.characters = characters;
  if (homeLocation !== undefined) entry.homeLocation = homeLocation;
  if (currentLocation !== undefined) entry.currentLocation = currentLocation;
  if (state !== undefined) entry.state = state;
  if (goals !== undefined) entry.goals = goals;
  if (location !== undefined) entry.location = location;
  if (requirements !== undefined) entry.requirements = requirements;
  if (completed !== undefined) entry.completed = completed;
  return entry;
}
