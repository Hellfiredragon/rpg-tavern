import git from "isomorphic-git";
import fs from "fs";
import { join, resolve } from "path";
import { readdir } from "fs/promises";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR || join(import.meta.dir, "..", "data");
const LOREBOOKS_DIR = join(DATA_DIR, "lorebooks");

const AUTHOR = { name: "RPG Tavern", email: "tavern@localhost" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lorebookDir(slug: string): string {
  return resolve(join(LOREBOOKS_DIR, slug));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize a git repository in a lorebook directory.
 * If .git already exists, this is a no-op.
 * Stages all files and creates an initial commit.
 */
export async function initRepo(lorebookSlug: string): Promise<void> {
  const dir = lorebookDir(lorebookSlug);

  if (await isGitRepo(lorebookSlug)) return;

  await git.init({ fs, dir });

  // Stage all existing files
  await stageAll(dir);

  // Create initial commit
  await git.commit({
    fs,
    dir,
    message: "Initial lorebook state",
    author: AUTHOR,
  });
}

/**
 * Stage all changes and create a commit.
 * Returns the commit SHA, or null if there were no changes.
 */
export async function commitChange(lorebookSlug: string, message: string): Promise<string | null> {
  const dir = lorebookDir(lorebookSlug);

  if (!(await isGitRepo(lorebookSlug))) {
    await initRepo(lorebookSlug);
  }

  await stageAll(dir);

  // Check if there are staged changes
  const matrix = await git.statusMatrix({ fs, dir });
  const hasChanges = matrix.some(([, head, workdir, stage]) => {
    return head !== workdir || head !== stage || workdir !== stage;
  });

  if (!hasChanges) return null;

  const sha = await git.commit({
    fs,
    dir,
    message,
    author: AUTHOR,
  });

  return sha;
}

/**
 * Revert commits by checking out affected files from the parent state.
 * Processes in reverse order (most recent first).
 */
export async function revertCommits(lorebookSlug: string, commitSHAs: string[]): Promise<void> {
  const dir = lorebookDir(lorebookSlug);

  for (const sha of [...commitSHAs].reverse()) {
    try {
      // Read the commit to find its parent
      const commit = await git.readCommit({ fs, dir, oid: sha });
      const parentOid = commit.commit.parent[0];

      if (!parentOid) continue; // skip initial commits

      // Get the tree of the parent
      const parentTree = await git.readTree({ fs, dir, oid: parentOid });
      const currentTree = await git.readTree({ fs, dir, oid: sha });

      // Find files that changed in this commit by comparing trees
      const parentFiles = await listTreeFiles(dir, parentOid);
      const commitFiles = await listTreeFiles(dir, sha);

      // Files added or modified in the commit — restore to parent state
      for (const filepath of commitFiles) {
        if (parentFiles.has(filepath)) {
          // File existed in parent — restore it
          const blob = await readFileFromCommit(dir, parentOid, filepath);
          if (blob !== null) {
            const absPath = join(dir, filepath);
            await fs.promises.mkdir(join(absPath, ".."), { recursive: true });
            await fs.promises.writeFile(absPath, blob);
          }
        } else {
          // File was added in this commit — delete it
          const absPath = join(dir, filepath);
          try {
            await fs.promises.unlink(absPath);
          } catch {
            // file may already be gone
          }
        }
      }

      // Files deleted in the commit — restore from parent
      for (const filepath of parentFiles) {
        if (!commitFiles.has(filepath)) {
          const blob = await readFileFromCommit(dir, parentOid, filepath);
          if (blob !== null) {
            const absPath = join(dir, filepath);
            await fs.promises.mkdir(join(absPath, ".."), { recursive: true });
            await fs.promises.writeFile(absPath, blob);
          }
        }
      }

      // Stage and commit the revert
      await stageAll(dir);
      await git.commit({
        fs,
        dir,
        message: `Revert: ${sha.slice(0, 7)}`,
        author: AUTHOR,
      });
    } catch (err) {
      console.error(`Failed to revert commit ${sha}:`, err);
    }
  }
}

/**
 * Check if a lorebook directory has a git repository.
 */
export async function isGitRepo(lorebookSlug: string): Promise<boolean> {
  const dir = lorebookDir(lorebookSlug);
  try {
    const gitDir = join(dir, ".git");
    const stat = await fs.promises.stat(gitDir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Stage all files (add new/modified, remove deleted) based on status matrix.
 */
async function stageAll(dir: string): Promise<void> {
  const matrix = await git.statusMatrix({ fs, dir });
  for (const [filepath, head, workdir, stage] of matrix) {
    if (filepath.startsWith(".git")) continue;
    if (workdir === 0) {
      // File deleted in working dir
      await git.remove({ fs, dir, filepath });
    } else if (head !== workdir || stage !== workdir) {
      // File added or modified
      await git.add({ fs, dir, filepath });
    }
  }
}

/**
 * List all files in a commit's tree.
 */
async function listTreeFiles(dir: string, oid: string): Promise<Set<string>> {
  const files = new Set<string>();

  async function walk(treeOid: string, prefix: string) {
    const tree = await git.readTree({ fs, dir, oid: treeOid });
    for (const entry of tree.tree) {
      const path = prefix ? `${prefix}/${entry.path}` : entry.path;
      if (entry.type === "blob") {
        files.add(path);
      } else if (entry.type === "tree") {
        await walk(entry.oid, path);
      }
    }
  }

  const commit = await git.readCommit({ fs, dir, oid });
  await walk(commit.commit.tree, "");
  return files;
}

/**
 * Read a file from a specific commit.
 */
async function readFileFromCommit(dir: string, commitOid: string, filepath: string): Promise<Uint8Array | null> {
  try {
    const { blob } = await git.readBlob({
      fs,
      dir,
      oid: commitOid,
      filepath,
    });
    return blob;
  } catch {
    return null;
  }
}
