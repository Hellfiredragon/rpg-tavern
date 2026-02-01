import { serve, file } from "bun";
import { join } from "path";
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from "./settings";
import {
  scanTree, loadEntry, saveEntry, deleteEntry,
  createFolder, deleteFolder, validateEntry, DEFAULT_ENTRY,
  listLorebooks, createLorebook, deleteLorebook,
  copyLorebook, listLocationEntries, loadLorebookMeta,
  saveLorebookMeta, isPresetLorebook, isReadOnlyPreset,
  type LorebookEntry, type LorebookMeta, type TreeNode,
} from "./lorebook";
import {
  createConversation, listConversations, loadConversation,
  appendMessage, deleteConversation, changeLocation,
  type ChatMeta, type ChatMessage,
} from "./chat";

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLorebookSlug(url: URL): string {
  return url.searchParams.get("lorebook") || "";
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function handleApi(req: Request, url: URL): Promise<Response> {
  if (url.pathname === "/api/greeting") {
    const name = url.searchParams.get("name") || "adventurer";
    return html(`<p>Welcome to the tavern, <strong>${escapeHtml(name)}</strong>! Pull up a chair.</p>`);
  }

  // --- Chat routes ---

  if (url.pathname === "/api/chats" && req.method === "GET") {
    const lorebook = url.searchParams.get("lorebook") || undefined;
    const convos = await listConversations(lorebook);
    return html(renderChatList(convos));
  }

  if (url.pathname === "/api/chats" && req.method === "POST") {
    try {
      const body = await req.json();
      const lorebook = typeof body.lorebook === "string" ? body.lorebook : "";
      const location = typeof body.location === "string" ? body.location : "";
      const meta = await createConversation({ lorebook, currentLocation: location });
      return html("", 200, {
        "HX-Trigger": "refreshChatList",
        "X-Chat-Id": meta.id,
      });
    } catch {
      const meta = await createConversation();
      return html("", 200, {
        "HX-Trigger": "refreshChatList",
        "X-Chat-Id": meta.id,
      });
    }
  }

  if (url.pathname === "/api/chats/messages" && req.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return html(`<p class="editor-placeholder">No conversation selected.</p>`, 400);
    const conv = await loadConversation(id);
    if (!conv) return html(`<p class="editor-placeholder">Conversation not found.</p>`, 404);
    return html(renderChatMessages(conv.messages));
  }

  if (url.pathname === "/api/chat" && req.method === "POST") {
    try {
      const body = await req.json();
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) return html(`<div class="feedback error">Empty message</div>`, 400);

      let chatId = typeof body.chatId === "string" ? body.chatId : "";
      const lorebook = typeof body.lorebook === "string" ? body.lorebook : "";
      let isNew = false;

      if (!chatId) {
        const meta = await createConversation({ lorebook });
        chatId = meta.id;
        isNew = true;
      }

      const userMsg: ChatMessage = { role: "user", content: message, timestamp: new Date().toISOString() };
      await appendMessage(chatId, userMsg);

      // Placeholder response (future: LLM integration)
      const assistantMsg: ChatMessage = { role: "assistant", content: "Hello World", timestamp: new Date().toISOString() };
      await appendMessage(chatId, assistantMsg);

      const headers: Record<string, string> = { "HX-Trigger": "refreshChatList" };
      if (isNew) headers["X-Chat-Id"] = chatId;

      return html(
        `<div class="chat-msg chat-msg-assistant">${escapeHtml(assistantMsg.content)}</div>`,
        200,
        headers,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Chat error";
      return html(`<div class="feedback error">${escapeHtml(msg)}</div>`, 400);
    }
  }

  // --- Adventure routes ---

  if (url.pathname === "/api/adventures" && req.method === "GET") {
    const lorebooks = await listLorebooks();
    const allConvos = await listConversations();
    return html(renderAdventurePicker(lorebooks, allConvos));
  }

  if (url.pathname === "/api/adventures" && req.method === "DELETE") {
    const slug = url.searchParams.get("lorebook");
    if (!slug) return html(`<div class="feedback error">Missing lorebook</div>`, 400);
    // Delete all conversations for this adventure
    const convos = await listConversations(slug);
    for (const c of convos) {
      try { await deleteConversation(c.id); } catch { /* already gone */ }
    }
    // Delete the lorebook itself
    await deleteLorebook(slug);
    // Return updated picker
    const lorebooks = await listLorebooks();
    const allConvos = await listConversations();
    return html(renderAdventurePicker(lorebooks, allConvos), 200, {
      "HX-Trigger": "refreshAdventures",
    });
  }

  if (url.pathname === "/api/adventures/resume" && req.method === "GET") {
    const slug = url.searchParams.get("lorebook") || "";
    if (!slug) return Response.json({ error: "Missing lorebook" }, { status: 400 });
    const convos = await listConversations(slug);
    if (convos.length === 0) return Response.json({ error: "No conversations found" }, { status: 404 });
    const latest = convos[0]; // already sorted by updatedAt desc
    let name = slug;
    try {
      const meta = await loadLorebookMeta(slug);
      if (meta) name = meta.name;
    } catch { /* use slug as fallback */ }
    return Response.json({
      lorebook: slug,
      chatId: latest.id,
      name,
      location: latest.currentLocation || "",
    });
  }

  if (url.pathname === "/api/adventures/locations" && req.method === "GET") {
    const lb = url.searchParams.get("lorebook") || "default";
    const locations = await listLocationEntries(lb);
    let options = `<option value="">-- Choose a location --</option>`;
    for (const loc of locations) {
      options += `<option value="${escapeHtml(loc.path)}">${escapeHtml(loc.name)}</option>`;
    }
    return html(options);
  }

  if (url.pathname === "/api/adventures/location" && req.method === "PUT") {
    try {
      const body = await req.json();
      const chatId = typeof body.chatId === "string" ? body.chatId : "";
      const location = typeof body.location === "string" ? body.location : "";
      if (!chatId || !location) return html(`<div class="feedback error">Missing chatId or location</div>`, 400);

      const conv = await loadConversation(chatId);
      if (!conv) return html(`<div class="feedback error">Conversation not found</div>`, 404);

      // Load the location entry from the lorebook for its name/content
      const entry = await loadEntry(conv.meta.lorebook, location);
      const locationName = entry?.name ?? location.split("/").pop() ?? location;
      const narration = `You move to ${locationName}. ${entry?.content ?? ""}`;

      await changeLocation(chatId, location, narration);

      return html(
        `<div class="chat-msg chat-msg-system">${escapeHtml(narration)}</div>`,
        200,
        { "X-Location": location },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Location change error";
      return html(`<div class="feedback error">${escapeHtml(msg)}</div>`, 400);
    }
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
    return html(renderLorebookPicker(lorebooks));
  }

  if (url.pathname === "/api/lorebooks/meta" && req.method === "GET") {
    const slug = url.searchParams.get("slug") || "";
    if (!slug) return Response.json({ error: "Missing slug" }, { status: 400 });
    try {
      const meta = await loadLorebookMeta(slug);
      if (!meta) return Response.json({ error: "Not found" }, { status: 404 });
      const preset = await isReadOnlyPreset(slug);
      return Response.json({ slug, name: meta.name, template: !!meta.template, preset });
    } catch {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
  }

  if (url.pathname === "/api/lorebooks" && req.method === "POST") {
    try {
      const body = await req.json();
      const slug = typeof body.slug === "string" ? body.slug.trim() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!slug || !name) return html(`<div class="feedback error">Slug and name are required</div>`, 400);
      await createLorebook(slug, name, true);
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
    if (await isReadOnlyPreset(slug)) {
      return html(`<div class="feedback error">Cannot delete a preset lorebook</div>`, 403);
    }
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

  if (url.pathname === "/api/lorebooks/make-template" && req.method === "POST") {
    try {
      const body = await req.json();
      const source = typeof body.source === "string" ? body.source.trim() : "";
      const slug = typeof body.slug === "string" ? body.slug.trim() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!source || !slug || !name) return html(`<div class="feedback error">Source, slug, and name are required</div>`, 400);
      await copyLorebook(source, slug, name);
      // Mark the copy as a template
      await saveLorebookMeta(slug, { name, template: true });
      return html(
        `<div class="feedback success">Template created.</div>`,
        200,
        { "HX-Trigger": "refreshLorebooks" },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to create template";
      return html(`<div class="feedback error">${escapeHtml(msg)}</div>`, 400);
    }
  }

  // --- Lorebook entry/folder routes ---

  if (url.pathname === "/api/lorebook/tree" && req.method === "GET") {
    const lb = getLorebookSlug(url);
    const tree = await scanTree(lb);
    const readonly = await isReadOnlyPreset(lb);
    return html(renderTree(tree, lb, readonly));
  }

  if (url.pathname === "/api/lorebook/entry" && req.method === "GET") {
    const lb = getLorebookSlug(url);
    const path = url.searchParams.get("path");
    if (!path) return html(`<div class="feedback error">Missing path parameter</div>`, 400);
    const entry = await loadEntry(lb, path);
    const readonly = await isReadOnlyPreset(lb);
    return html(entryFormHtml(path, entry ?? DEFAULT_ENTRY, !entry, lb, readonly));
  }

  if (url.pathname === "/api/lorebook/entry" && req.method === "POST") {
    const lb = getLorebookSlug(url);
    if (await isReadOnlyPreset(lb)) return html(`<div class="feedback error">Cannot modify a preset lorebook</div>`, 403);
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
    if (await isReadOnlyPreset(lb)) return html(`<div class="feedback error">Cannot modify a preset lorebook</div>`, 403);
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
    if (await isReadOnlyPreset(lb)) return html(`<div class="feedback error">Cannot modify a preset lorebook</div>`, 403);
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
    if (await isReadOnlyPreset(lb)) return html(`<div class="feedback error">Cannot modify a preset lorebook</div>`, 403);
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
    if (await isReadOnlyPreset(lb)) return html(`<div class="feedback error">Cannot modify a preset lorebook</div>`, 403);
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

function renderTree(nodes: TreeNode[], lorebook: string, readonly = false): string {
  if (nodes.length === 0) {
    return (readonly ? "" : renderNewButton("", lorebook)) + `<p class="tree-empty">No entries yet.</p>`;
  }
  return (readonly ? "" : renderNewButton("", lorebook)) + renderTreeLevel(nodes, lorebook, readonly);
}

function renderTreeLevel(nodes: TreeNode[], lorebook: string, readonly = false): string {
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
          ${readonly ? "" : renderNewButton(folderPrefix, lorebook)}
          ${renderTreeLevel(node.children, lorebook, readonly)}
        </details>
      </li>`;
    } else if (!node.isEntry) {
      // Empty folder
      const folderPrefix = node.path + "/";
      out += `<li class="tree-folder">
        <details>
          <summary>${escapeHtml(node.name)}/</summary>
          ${readonly ? "" : renderNewButton(folderPrefix, lorebook)}
          <p class="tree-empty">Empty folder</p>
          ${readonly ? "" : `<button hx-delete="/api/lorebook/folder?path=${encodeURIComponent(node.path)}&lorebook=${encodeURIComponent(lorebook)}"
                  hx-target="#lorebook-tree" hx-swap="innerHTML"
                  hx-confirm="Delete empty folder '${escapeHtml(node.name)}'?"
                  class="btn-sm btn-danger">Delete folder</button>`}
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

function renderLorebookPicker(lorebooks: { slug: string; meta: LorebookMeta; preset: boolean }[]): string {
  const templates = lorebooks.filter((lb) => lb.meta.template);
  const adventures = lorebooks.filter((lb) => !lb.meta.template);

  let out = "";

  // Adventures section (non-template lorebooks)
  if (adventures.length > 0) {
    out += `<h2>Your Adventures</h2>`;
    for (const lb of adventures) {
      out += `<div class="adventure-card">
        <span class="adventure-card-name">${escapeHtml(lb.meta.name)}</span>
        <div class="adventure-card-actions">
          <button class="btn-sm lorebook-edit-btn" data-slug="${escapeHtml(lb.slug)}" data-name="${escapeHtml(lb.meta.name)}">Edit</button>
        </div>
      </div>`;
    }
  }

  // Templates section
  out += `<h2>Templates</h2>`;
  if (templates.length > 0) {
    for (const lb of templates) {
      const presetAttr = lb.preset ? ` data-preset="true"` : "";
      out += `<div class="adventure-card adventure-card-template">
        <span class="adventure-card-name">${escapeHtml(lb.meta.name)}</span>
        <div class="adventure-card-actions">
          <button class="btn-sm lorebook-edit-btn" data-slug="${escapeHtml(lb.slug)}" data-name="${escapeHtml(lb.meta.name)}"${presetAttr}>${lb.preset ? "View" : "Edit"}</button>
          ${lb.preset ? `<button class="btn-sm lorebook-copy-btn" data-slug="${escapeHtml(lb.slug)}" data-name="${escapeHtml(lb.meta.name)}">Copy</button>` : `<button class="btn-sm btn-danger lorebook-delete-btn" data-slug="${escapeHtml(lb.slug)}" data-name="${escapeHtml(lb.meta.name)}">Delete</button>`}
        </div>
      </div>`;
    }
  } else {
    out += `<p class="editor-placeholder">No templates yet.</p>`;
  }

  out += `<button type="button" id="btn-new-lorebook" class="btn-sm" style="margin-top:0.5rem">+ Template</button>`;

  return out;
}

function entryFormHtml(path: string, entry: LorebookEntry, isNew: boolean, lorebook: string, readonly = false): string {
  const method = isNew ? "hx-post" : "hx-put";
  const verb = isNew ? "Create" : "Save";
  const lbParam = `&lorebook=${encodeURIComponent(lorebook)}`;
  const dis = readonly ? " disabled" : "";

  return `<h2>${escapeHtml(path)}${readonly ? " <small>(Preset — Read Only)</small>" : ""}</h2>
<form ${method}="/api/lorebook/entry?path=${encodeURIComponent(path)}${lbParam}"
      hx-target="#lorebook-editor" hx-swap="innerHTML" hx-ext="json-enc">

  <label for="lb-name">Name</label>
  <input id="lb-name" name="name" type="text" value="${escapeHtml(entry.name)}" required${dis} />

  <label for="lb-content">Content</label>
  <textarea id="lb-content" name="content" rows="8"${dis}>${escapeHtml(entry.content)}</textarea>

  <label for="lb-keywords">Keywords <span class="hint">(comma-separated)</span></label>
  <input id="lb-keywords" name="keywords" type="text"
         value="${escapeHtml(entry.keywords.join(", "))}"${dis} />

  <label for="lb-regex">Regex pattern <span class="hint">(leave empty for none)</span></label>
  <input id="lb-regex" name="regex" type="text" value="${escapeHtml(entry.regex)}"${dis} />

  <label for="lb-priority">Priority: <strong>${entry.priority}</strong></label>
  <input id="lb-priority" name="priority" type="number" value="${entry.priority}"${dis} />

  <label>
    <input name="enabled" type="checkbox" ${entry.enabled ? "checked" : ""}${dis} />
    Enabled
  </label>

  ${readonly ? "" : `<div class="editor-actions">
    <button type="submit">${verb}</button>
    ${isNew ? "" : `<button type="button" class="btn-danger"
      hx-delete="/api/lorebook/entry?path=${encodeURIComponent(path)}${lbParam}"
      hx-target="#lorebook-editor" hx-swap="innerHTML"
      hx-confirm="Delete entry '${escapeHtml(entry.name)}'?">Delete</button>`}
  </div>`}
</form>`;
}

// ---------------------------------------------------------------------------
// Chat HTML renderers
// ---------------------------------------------------------------------------

function renderChatList(convos: ChatMeta[]): string {
  if (convos.length === 0) {
    return `<p class="chat-list-empty">No conversations yet.</p>`;
  }
  let out = "";
  for (const c of convos) {
    out += `<div class="chat-list-item" data-chat-id="${escapeHtml(c.id)}">
      <span class="chat-list-title">${escapeHtml(c.title)}</span>
    </div>`;
  }
  return out;
}

function renderChatMessages(messages: ChatMessage[]): string {
  if (messages.length === 0) {
    return `<p class="editor-placeholder">Your adventure begins...</p>`;
  }
  let out = "";
  for (const msg of messages) {
    if (msg.role === "system") {
      out += `<div class="chat-msg chat-msg-system">${escapeHtml(msg.content)}</div>`;
    } else {
      const cls = msg.role === "user" ? "chat-msg-user" : "chat-msg-assistant";
      out += `<div class="chat-msg ${cls}">${escapeHtml(msg.content)}</div>`;
    }
  }
  return out;
}

function renderAdventurePicker(lorebooks: { slug: string; meta: LorebookMeta; preset: boolean }[], allConvos: ChatMeta[]): string {
  const templates = lorebooks.filter((lb) => lb.meta.template);

  // Only show user lorebooks that have been started (have at least one conversation)
  const startedAdventures: { slug: string; meta: LorebookMeta; latest: ChatMeta }[] = [];
  for (const lb of lorebooks) {
    if (lb.meta.template) continue;
    const latest = allConvos.find((c) => c.lorebook === lb.slug);
    if (latest) startedAdventures.push({ ...lb, latest });
  }

  // Sort by last played (most recent first)
  startedAdventures.sort((a, b) => b.latest.updatedAt.localeCompare(a.latest.updatedAt));

  let out = "";

  // User adventures
  if (startedAdventures.length > 0) {
    out += `<h2>Your Adventures</h2>`;
    for (const adv of startedAdventures) {
      const lastPlayed = formatRelativeDate(adv.latest.updatedAt);

      out += `<div class="adventure-card" data-lorebook="${escapeHtml(adv.slug)}">
        <div class="adventure-card-info">
          <span class="adventure-card-name">${escapeHtml(adv.meta.name)}</span>
          <span class="adventure-card-meta">Last played: ${escapeHtml(lastPlayed)}</span>
        </div>
        <div class="adventure-card-actions">
          <button class="btn-sm adventure-continue-btn"
                  data-lorebook="${escapeHtml(adv.slug)}"
                  data-chat-id="${escapeHtml(adv.latest.id)}"
                  data-name="${escapeHtml(adv.meta.name)}"
                  data-location="${escapeHtml(adv.latest.currentLocation)}">Continue</button>
          <button class="btn-sm adventure-save-tpl-btn"
                  data-lorebook="${escapeHtml(adv.slug)}"
                  data-name="${escapeHtml(adv.meta.name)}">Save as Template</button>
          <button class="btn-sm btn-danger adventure-delete-btn"
                  data-lorebook="${escapeHtml(adv.slug)}"
                  data-name="${escapeHtml(adv.meta.name)}">Delete</button>
        </div>
      </div>`;
    }
  } else {
    out += `<h2>Your Adventures</h2>
      <p class="editor-placeholder">No adventures yet. Start one from a template below!</p>`;
  }

  // Templates
  if (templates.length > 0) {
    out += `<h2>Start New Adventure</h2>`;
    for (const lb of templates) {
      out += `<div class="adventure-card adventure-card-template">
        <span class="adventure-card-name">${escapeHtml(lb.meta.name)}</span>
        <button class="btn-sm adventure-start-btn"
                data-template="${escapeHtml(lb.slug)}"
                data-name="${escapeHtml(lb.meta.name)}">Start</button>
      </div>`;
    }
  }

  return out;
}

function formatRelativeDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
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
