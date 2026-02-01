import { serve, file } from "bun";
import { join } from "path";
import { listLorebooks, loadLorebookMeta, saveLorebookMeta } from "./lorebook";
import { listConversations } from "./chat";
import { handleApi } from "./routes";

const PUBLIC_DIR = join(import.meta.dir, "public");
const DEV = process.env.DEV === "1";

const LIVERELOAD_SCRIPT = `<script>(function(){if(!DEV)return;var u="ws://"+location.host+"/dev/ws";function c(){var w=new WebSocket(u);w.onclose=function(){setTimeout(function r(){var t=new WebSocket(u);t.onerror=function(){setTimeout(r,250)};t.onopen=function(){location.reload()}},250)}}c()}).call({DEV:true})</script>`;

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

export async function startServer(port: number) {
  await migrateOrphanLorebooks();

  const server = serve({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      // Dev livereload WebSocket upgrade
      if (DEV && url.pathname === "/dev/ws") {
        if (server.upgrade(req)) return;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // API routes
      if (url.pathname.startsWith("/api/")) {
        return handleApi(req, url);
      }

      // Static files — try the exact path, then fall back to index.html
      const filePath = join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);
      const asset = file(filePath);
      if (await asset.exists()) {
        if (DEV && filePath.endsWith(".html")) {
          const content = await asset.text();
          return new Response(content.replace("</body>", LIVERELOAD_SCRIPT + "</body>"), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
        return new Response(asset);
      }

      // SPA fallback
      const fallback = file(join(PUBLIC_DIR, "index.html"));
      if (DEV) {
        const content = await fallback.text();
        return new Response(content.replace("</body>", LIVERELOAD_SCRIPT + "</body>"), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new Response(fallback);
    },
    websocket: {
      open() {},
      message() {},
      close() {},
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
