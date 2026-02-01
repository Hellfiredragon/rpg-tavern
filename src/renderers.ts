import { loadSettings, DEFAULT_SETTINGS, type Settings } from "./settings";
import {
  loadEntry,
  type LorebookEntry, type LorebookMeta, type TreeNode, type ActiveEntry,
} from "./lorebook";
import type { ChatMeta, ChatMessage } from "./chat";

// ---------------------------------------------------------------------------
// Core HTML helpers
// ---------------------------------------------------------------------------

export function html(body: string, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...extraHeaders },
  });
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ---------------------------------------------------------------------------
// Settings renderers
// ---------------------------------------------------------------------------

export function validateSettings(body: unknown): Settings {
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

export function settingsFormHtml(s: Settings): string {
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

export function renderTree(nodes: TreeNode[], lorebook: string, readonly = false): string {
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

export function renderLorebookPicker(lorebooks: { slug: string; meta: LorebookMeta; preset: boolean }[]): string {
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

export function entryFormHtml(path: string, entry: LorebookEntry, isNew: boolean, lorebook: string, readonly = false): string {
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

  <label for="lb-contexts">Contexts <span class="hint">(comma-separated entry paths or trait: refs)</span></label>
  <input id="lb-contexts" name="contexts" type="text"
         value="${escapeHtml(entry.contexts.join(", "))}"${dis} />

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

export function renderChatList(convos: ChatMeta[]): string {
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

export function renderChatMessages(messages: ChatMessage[]): string {
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

export async function renderAdventurePicker(lorebooks: { slug: string; meta: LorebookMeta; preset: boolean }[], allConvos: ChatMeta[]): Promise<string> {
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

  // Resolve location display names for adventures with a current location
  const locationNames = new Map<string, string>();
  await Promise.all(startedAdventures.map(async (adv) => {
    if (!adv.latest.currentLocation) return;
    const entry = await loadEntry(adv.slug, adv.latest.currentLocation);
    const name = entry?.name ?? adv.latest.currentLocation.split("/").pop() ?? "";
    if (name) locationNames.set(adv.slug, name);
  }));

  let out = "";

  // User adventures
  if (startedAdventures.length > 0) {
    out += `<h2>Your Adventures</h2>`;
    for (const adv of startedAdventures) {
      const lastPlayed = formatRelativeDate(adv.latest.updatedAt);
      const locName = locationNames.get(adv.slug);

      out += `<div class="adventure-card" data-lorebook="${escapeHtml(adv.slug)}">
        <div class="adventure-card-info">
          <span class="adventure-card-name">${escapeHtml(adv.meta.name)}</span>
          <span class="adventure-card-meta">Last played: ${escapeHtml(lastPlayed)}${locName ? ` · Location: ${escapeHtml(locName)}` : ""}</span>
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

// ---------------------------------------------------------------------------
// Active entries panel renderer
// ---------------------------------------------------------------------------

export function renderActiveEntries(entries: ActiveEntry[], traits: string[], chatId: string): string {
  let out = "";

  // Traits section
  out += `<div class="active-entries-traits">`;
  out += `<h4>Traits</h4>`;
  out += `<div class="trait-tags">`;
  for (const trait of traits) {
    out += `<span class="trait-tag">${escapeHtml(trait)}<button class="trait-remove" data-trait="${escapeHtml(trait)}" data-chat-id="${escapeHtml(chatId)}">&times;</button></span>`;
  }
  out += `</div>`;
  out += `<form class="trait-add-form" data-chat-id="${escapeHtml(chatId)}">`;
  out += `<input type="text" class="trait-add-input" placeholder="Add trait..." />`;
  out += `<button type="submit" class="btn-sm">+</button>`;
  out += `</form></div>`;

  // Entries grouped by category
  if (entries.length === 0) {
    out += `<p class="active-entries-empty">No active entries.</p>`;
    return out;
  }

  // Group by category
  const groups = new Map<string, ActiveEntry[]>();
  for (const e of entries) {
    const list = groups.get(e.category) || [];
    list.push(e);
    groups.set(e.category, list);
  }

  // Sort groups: locations, characters, items, then alphabetical
  const order = ["locations", "characters", "items"];
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b);
  });

  for (const key of sortedKeys) {
    const group = groups.get(key)!;
    out += `<div class="active-entries-group">`;
    out += `<h4>${escapeHtml(key)}</h4>`;
    for (const e of group) {
      const preview = e.content.length > 80 ? e.content.slice(0, 80) + "..." : e.content;
      out += `<div class="active-entry-item">`;
      out += `<span class="active-entry-name">${escapeHtml(e.name)}</span>`;
      out += `<span class="active-entry-preview">${escapeHtml(preview)}</span>`;
      out += `</div>`;
    }
    out += `</div>`;
  }

  return out;
}

export function formatRelativeDate(isoString: string): string {
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
