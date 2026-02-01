import { join, dirname, resolve } from "path";
import { mkdir, readdir, unlink, rm, rmdir, cp } from "fs/promises";

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
    return (await f.json()) as LorebookEntry;
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

  return { name, content, keywords, regex, priority, enabled };
}
