import { serve, file } from "bun";
import { join } from "path";
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from "./settings";
import {
  scanTree, loadEntry, saveEntry, deleteEntry,
  createFolder, deleteFolder, validateEntry, DEFAULT_ENTRY,
  listLorebooks, createLorebook, deleteLorebook, ensureDefaultLorebook,
  copyLorebook, seedTemplates,
  type LorebookEntry, type LorebookMeta, type TreeNode,
} from "./lorebook";

const PUBLIC_DIR = join(import.meta.dir, "public");
const DEV = process.env.DEV === "1";

const LIVERELOAD_SCRIPT = `<script>(function(){if(!DEV)return;var u="ws://"+location.host+"/dev/ws";function c(){var w=new WebSocket(u);w.onclose=function(){setTimeout(function r(){var t=new WebSocket(u);t.onerror=function(){setTimeout(r,250)};t.onopen=function(){location.reload()}},250)}}c()}).call({DEV:true})</script>`;

export async function startServer(port: number) {
  await ensureDefaultLorebook();
  await seedTemplates();

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLorebookSlug(url: URL): string {
  return url.searchParams.get("lorebook") || "default";
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function handleApi(req: Request, url: URL): Promise<Response> {
  if (url.pathname === "/api/greeting") {
    const name = url.searchParams.get("name") || "adventurer";
    return html(`<p>Welcome to the tavern, <strong>${escapeHtml(name)}</strong>! Pull up a chair.</p>`);
  }

  if (url.pathname === "/api/chat" && req.method === "POST") {
    return html(`<div class="chat-msg chat-msg-assistant">Hello World</div>`);
  }

  // --- Settings routes ---

  if (url.pathname === "/api/settings" && req.method === "GET") {
    const settings = await loadSettings();
    const masked: Settings = {
      ...settings,
      llm: { ...settings.llm, apiKey: settings.llm.apiKey ? "••••••••" : "" },
    };
    return Response.json(masked);
  }

  if (url.pathname === "/api/settings/form" && req.method === "GET") {
    const s = await loadSettings();
    return html(settingsFormHtml(s));
  }

  if (url.pathname === "/api/settings" && req.method === "PUT") {
    try {
      const body = await req.json();
      const settings = validateSettings(body);
      await saveSettings(settings);
      return html(`<div class="feedback success">Settings saved.</div>` + settingsFormHtml(settings));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Invalid settings";
      return html(`<div class="feedback error">${escapeHtml(msg)}</div>` + settingsFormHtml(await loadSettings()), 400);
    }
  }

  // --- Lorebook management routes ---

  if (url.pathname === "/api/lorebooks" && req.method === "GET") {
    const lorebooks = await listLorebooks();
    const active = url.searchParams.get("active") || "default";
    return html(renderLorebookSelector(lorebooks, active));
  }

  if (url.pathname === "/api/lorebooks" && req.method === "POST") {
    try {
      const body = await req.json();
      const slug = typeof body.slug === "string" ? body.slug.trim() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!slug || !name) return html(`<div class="feedback error">Slug and name are required</div>`, 400);
      await createLorebook(slug, name);
      return html(
        `<div class="feedback success">Lorebook created.</div>`,
        200,
        { "HX-Trigger": "refreshLorebooks" },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to create lorebook";
      return html(`<div class="feedback error">${escapeHtml(msg)}</div>`, 400);
    }
  }

  if (url.pathname === "/api/lorebooks" && req.method === "DELETE") {
    const slug = url.searchParams.get("slug");
    if (!slug) return html(`<div class="feedback error">Missing slug</div>`, 400);
    if (slug === "default") return html(`<div class="feedback error">Cannot delete the default lorebook</div>`, 400);
    await deleteLorebook(slug);
    return html(
      `<div class="feedback success">Lorebook deleted.</div>`,
      200,
      { "HX-Trigger": "refreshLorebooks" },
    );
  }

  if (url.pathname === "/api/lorebooks/copy" && req.method === "POST") {
    try {
      const body = await req.json();
      const source = typeof body.source === "string" ? body.source.trim() : "";
      const slug = typeof body.slug === "string" ? body.slug.trim() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!source || !slug || !name) return html(`<div class="feedback error">Source, slug, and name are required</div>`, 400);
      await copyLorebook(source, slug, name);
      return html(
        `<div class="feedback success">Lorebook created from template.</div>`,
        200,
        { "HX-Trigger": "refreshLorebooks" },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to copy lorebook";
      return html(`<div class="feedback error">${escapeHtml(msg)}</div>`, 400);
    }
  }

  // --- Lorebook entry/folder routes ---

  if (url.pathname === "/api/lorebook/tree" && req.method === "GET") {
    const lb = getLorebookSlug(url);
    const tree = await scanTree(lb);
    return html(renderTree(tree, lb));
  }

  if (url.pathname === "/api/lorebook/entry" && req.method === "GET") {
    const lb = getLorebookSlug(url);
    const path = url.searchParams.get("path");
    if (!path) return html(`<div class="feedback error">Missing path parameter</div>`, 400);
    const entry = await loadEntry(lb, path);
    return html(entryFormHtml(path, entry ?? DEFAULT_ENTRY, !entry, lb));
  }

  if (url.pathname === "/api/lorebook/entry" && req.method === "POST") {
    const lb = getLorebookSlug(url);
    const path = url.searchParams.get("path");
    if (!path) return html(`<div class="feedback error">Missing path</div>`, 400);
    try {
      const body = await req.json();
      const entry = validateEntry(body);
      await saveEntry(lb, path, entry);
      return html(
        `<div class="feedback success">Entry created.</div>` + entryFormHtml(path, entry, false, lb),
        200,
        { "HX-Trigger": "refreshTree" },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Invalid entry";
      return html(`<div class="feedback error">${escapeHtml(msg)}</div>`, 400);
    }
  }

  if (url.pathname === "/api/lorebook/entry" && req.method === "PUT") {
    const lb = getLorebookSlug(url);
    const path = url.searchParams.get("path");
    if (!path) return html(`<div class="feedback error">Missing path</div>`, 400);
    try {
      const body = await req.json();
      const entry = validateEntry(body);
      await saveEntry(lb, path, entry);
      return html(
        `<div class="feedback success">Entry saved.</div>` + entryFormHtml(path, entry, false, lb),
        200,
        { "HX-Trigger": "refreshTree" },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Invalid entry";
      return html(`<div class="feedback error">${escapeHtml(msg)}</div>`, 400);
    }
  }

  if (url.pathname === "/api/lorebook/entry" && req.method === "DELETE") {
    const lb = getLorebookSlug(url);
    const path = url.searchParams.get("path");
    if (!path) return html(`<div class="feedback error">Missing path</div>`, 400);
    await deleteEntry(lb, path);
    return html(
      `<p class="editor-placeholder">Entry deleted.</p>`,
      200,
      { "HX-Trigger": "refreshTree" },
    );
  }

  if (url.pathname === "/api/lorebook/folder" && req.method === "POST") {
    const lb = getLorebookSlug(url);
    const formData = await req.formData();
    const path = formData.get("path") as string | null;
    if (!path) return html(`<div class="feedback error">Missing path</div>`, 400);
    await createFolder(lb, path);
    return html(
      `<p class="editor-placeholder">Folder created.</p>`,
      200,
      { "HX-Trigger": "refreshTree" },
    );
  }

  if (url.pathname === "/api/lorebook/folder" && req.method === "DELETE") {
    const lb = getLorebookSlug(url);
    const path = url.searchParams.get("path");
    if (!path) return html(`<div class="feedback error">Missing path</div>`, 400);
    await deleteFolder(lb, path);
    return html(
      `<p class="editor-placeholder">Folder deleted.</p>`,
      200,
      { "HX-Trigger": "refreshTree" },
    );
  }

  return new Response("Not Found", { status: 404 });
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

function validateSettings(body: unknown): Settings {
  if (!body || typeof body !== "object") throw new Error("Body must be a JSON object");
  const obj = body as Record<string, unknown>;

  const general = obj.general as Record<string, unknown> | undefined;
  const llm = obj.llm as Record<string, unknown> | undefined;
  if (!general || typeof general !== "object") throw new Error("Missing general section");
  if (!llm || typeof llm !== "object") throw new Error("Missing llm section");

  const provider = llm.provider;
  if (provider !== "anthropic" && provider !== "openai") throw new Error("Invalid provider");

  const temperature = Number(llm.temperature);
  if (isNaN(temperature) || temperature < 0 || temperature > 2) throw new Error("Temperature must be 0–2");

  return {
    general: {
      appName: typeof general.appName === "string" ? general.appName.trim() || DEFAULT_SETTINGS.general.appName : DEFAULT_SETTINGS.general.appName,
    },
    llm: {
      provider,
      apiKey: typeof llm.apiKey === "string" ? llm.apiKey : "",
      model: typeof llm.model === "string" ? llm.model.trim() || DEFAULT_SETTINGS.llm.model : DEFAULT_SETTINGS.llm.model,
      temperature,
    },
  };
}

function settingsFormHtml(s: Settings): string {
  const providerOptions = (["anthropic", "openai"] as const)
    .map((p) => `<option value="${p}"${s.llm.provider === p ? " selected" : ""}>${p === "anthropic" ? "Anthropic" : "OpenAI"}</option>`)
    .join("");

  return `<form hx-put="/api/settings" hx-target="#settings-form" hx-swap="innerHTML" hx-ext="json-enc">
  <fieldset>
    <legend>General</legend>
    <label for="appName">App name</label>
    <input id="appName" name="general.appName" type="text" value="${escapeHtml(s.general.appName)}" />
  </fieldset>

  <fieldset>
    <legend>LLM</legend>
    <label for="provider">Provider</label>
    <select id="provider" name="llm.provider">${providerOptions}</select>

    <label for="apiKey">API Key</label>
    <input id="apiKey" name="llm.apiKey" type="password" value="${escapeHtml(s.llm.apiKey)}" placeholder="sk-..." />

    <label for="model">Model</label>
    <input id="model" name="llm.model" type="text" value="${escapeHtml(s.llm.model)}" />

    <label for="temperature">Temperature: <strong>${s.llm.temperature}</strong></label>
    <input id="temperature" name="llm.temperature" type="range" min="0" max="2" step="0.1" value="${s.llm.temperature}" />
  </fieldset>

  <button type="submit">Save settings</button>
</form>`;
}

// ---------------------------------------------------------------------------
// Lorebook HTML renderers
// ---------------------------------------------------------------------------

function renderTree(nodes: TreeNode[], lorebook: string): string {
  if (nodes.length === 0) {
    return renderNewButton("", lorebook) + `<p class="tree-empty">No entries yet.</p>`;
  }
  return renderNewButton("", lorebook) + renderTreeLevel(nodes, lorebook);
}

function renderTreeLevel(nodes: TreeNode[], lorebook: string): string {
  let out = '<ul class="tree-list">';
  for (const node of nodes) {
    if (node.isEntry) {
      out += `<li class="tree-entry">
        <a href="#"
           hx-get="/api/lorebook/entry?path=${encodeURIComponent(node.path)}&lorebook=${encodeURIComponent(lorebook)}"
           hx-target="#lorebook-editor"
           hx-swap="innerHTML">${escapeHtml(node.name)}</a>
      </li>`;
    }
    if (node.children.length > 0) {
      const folderName = node.isEntry ? node.path.split("/").pop()! : node.name;
      const folderPrefix = node.path + "/";
      out += `<li class="tree-folder">
        <details open>
          <summary>${escapeHtml(folderName)}/</summary>
          ${renderNewButton(folderPrefix, lorebook)}
          ${renderTreeLevel(node.children, lorebook)}
        </details>
      </li>`;
    } else if (!node.isEntry) {
      // Empty folder
      const folderPrefix = node.path + "/";
      out += `<li class="tree-folder">
        <details>
          <summary>${escapeHtml(node.name)}/</summary>
          ${renderNewButton(folderPrefix, lorebook)}
          <p class="tree-empty">Empty folder</p>
          <button hx-delete="/api/lorebook/folder?path=${encodeURIComponent(node.path)}&lorebook=${encodeURIComponent(lorebook)}"
                  hx-target="#lorebook-tree" hx-swap="innerHTML"
                  hx-confirm="Delete empty folder '${escapeHtml(node.name)}'?"
                  class="btn-sm btn-danger">Delete folder</button>
        </details>
      </li>`;
    }
  }
  out += '</ul>';
  return out;
}

function renderNewButton(prefix: string, lorebook: string): string {
  return `<button class="btn-sm btn-new-entry" data-prefix="${escapeHtml(prefix)}" data-lorebook="${escapeHtml(lorebook)}">+ New</button>`;
}

function renderLorebookSelector(lorebooks: { slug: string; meta: LorebookMeta }[], active: string): string {
  const userBooks = lorebooks.filter((lb) => !lb.meta.template);
  const templates = lorebooks.filter((lb) => lb.meta.template);

  let options = "";
  for (const lb of userBooks) {
    const selected = lb.slug === active ? " selected" : "";
    options += `<option value="${escapeHtml(lb.slug)}"${selected}>${escapeHtml(lb.meta.name)}</option>`;
  }

  let templateOptions = "";
  for (const lb of templates) {
    templateOptions += `<option value="${escapeHtml(lb.slug)}">${escapeHtml(lb.meta.name)}</option>`;
  }

  return `<div class="lorebook-selector-container">
  <select class="lorebook-selector" id="lorebook-select">${options}</select>
  <button type="button" id="btn-new-lorebook" class="btn-sm">+ Lorebook</button>
</div>${templates.length > 0 ? `<div class="lorebook-selector-container">
  <select class="lorebook-selector" id="template-select">${templateOptions}</select>
  <button type="button" id="btn-use-template" class="btn-sm">Use Template</button>
</div>` : ""}`;
}

function entryFormHtml(path: string, entry: LorebookEntry, isNew: boolean, lorebook: string): string {
  const method = isNew ? "hx-post" : "hx-put";
  const verb = isNew ? "Create" : "Save";
  const lbParam = `&lorebook=${encodeURIComponent(lorebook)}`;

  return `<h2>${escapeHtml(path)}</h2>
<form ${method}="/api/lorebook/entry?path=${encodeURIComponent(path)}${lbParam}"
      hx-target="#lorebook-editor" hx-swap="innerHTML" hx-ext="json-enc">

  <label for="lb-name">Name</label>
  <input id="lb-name" name="name" type="text" value="${escapeHtml(entry.name)}" required />

  <label for="lb-content">Content</label>
  <textarea id="lb-content" name="content" rows="8">${escapeHtml(entry.content)}</textarea>

  <label for="lb-keywords">Keywords <span class="hint">(comma-separated)</span></label>
  <input id="lb-keywords" name="keywords" type="text"
         value="${escapeHtml(entry.keywords.join(", "))}" />

  <label for="lb-regex">Regex pattern <span class="hint">(leave empty for none)</span></label>
  <input id="lb-regex" name="regex" type="text" value="${escapeHtml(entry.regex)}" />

  <label for="lb-priority">Priority: <strong>${entry.priority}</strong></label>
  <input id="lb-priority" name="priority" type="number" value="${entry.priority}" />

  <label>
    <input name="enabled" type="checkbox" ${entry.enabled ? "checked" : ""} />
    Enabled
  </label>

  <div class="editor-actions">
    <button type="submit">${verb}</button>
    ${isNew ? "" : `<button type="button" class="btn-danger"
      hx-delete="/api/lorebook/entry?path=${encodeURIComponent(path)}${lbParam}"
      hx-target="#lorebook-editor" hx-swap="innerHTML"
      hx-confirm="Delete entry '${escapeHtml(entry.name)}'?">Delete</button>`}
  </div>
</form>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function html(body: string, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...extraHeaders },
  });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
