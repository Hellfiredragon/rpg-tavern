import { serve, file } from "bun";
import { join } from "path";
import { listLorebooks, loadLorebookMeta, saveLorebookMeta } from "./lorebook";
import { listConversations } from "./chat";
import { loadSettings } from "./settings";
import { initBackendsFromConfig } from "./backends";
import { initRepo } from "./git";
import { handleApi } from "./routes";

const DIST_DIR = join(import.meta.dir, "..", "dist");
const DEV = process.env.DEV === "1";

/**
 * Migrate non-template lorebooks with zero conversations to templates.
 * Handles the existing "default" lorebook and any other orphans.
 */
async function migrateOrphanLorebooks(): Promise<void> {
  const lorebooks = await listLorebooks();
  const allConvos = await listConversations();

  for (const lb of lorebooks) {
    if (lb.meta.template || lb.preset) continue;
    const hasConvos = allConvos.some((c) => c.lorebook === lb.slug);
    if (!hasConvos) {
      await saveLorebookMeta(lb.slug, { ...lb.meta, template: true });
    }
  }
}

/**
 * Initialize git repos for existing non-template lorebooks (adventures).
 */
async function initGitRepos(): Promise<void> {
  const lorebooks = await listLorebooks();
  for (const lb of lorebooks) {
    if (lb.meta.template || lb.preset) continue;
    try {
      await initRepo(lb.slug);
    } catch (err) {
      console.error(`Failed to init git repo for ${lb.slug}:`, err);
    }
  }
}

/**
 * Load settings and initialize LLM backends.
 */
async function initLLMBackends(): Promise<void> {
  try {
    const settings = await loadSettings();
    if (settings.backends.length > 0) {
      initBackendsFromConfig(settings.backends);
    }
  } catch (err) {
    console.error("Failed to initialize backends:", err);
  }
}

export async function startServer(port: number) {
  await migrateOrphanLorebooks();
  await initGitRepos();
  await initLLMBackends();

  const server = serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // API routes
      if (url.pathname.startsWith("/api/")) {
        return handleApi(req, url);
      }

      // In dev mode, Vite serves the frontend — backend only handles API
      if (DEV) {
        return new Response("Not Found", { status: 404 });
      }

      // Production: serve static files from dist/
      const filePath = join(DIST_DIR, url.pathname === "/" ? "index.html" : url.pathname);
      const asset = file(filePath);
      if (await asset.exists()) {
        return new Response(asset);
      }

      // SPA fallback — all non-API, non-asset paths return index.html
      const fallback = file(join(DIST_DIR, "index.html"));
      if (await fallback.exists()) {
        return new Response(fallback);
      }

      // index.html missing (e.g. mid-build) — return a page that auto-retries
      return new Response(
        '<html><body><script>setTimeout(()=>location.reload(),1000)</script></body></html>',
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  return server;
}

// Auto-start when run directly (not imported by tests)
if (import.meta.main) {
  const PORT = Number(process.env.PORT) || 3001;
  startServer(PORT);
  console.log(`Server running at http://localhost:${PORT}`);
}
