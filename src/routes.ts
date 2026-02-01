import { loadSettings, saveSettings, type Settings } from "./settings";
import {
  scanTree, loadEntry, saveEntry, deleteEntry,
  createFolder, deleteFolder, validateEntry, DEFAULT_ENTRY,
  listLorebooks, createLorebook, deleteLorebook,
  copyLorebook, listLocationEntries, loadLorebookMeta,
  saveLorebookMeta, isReadOnlyPreset, findActiveEntries,
  type LorebookEntry,
} from "./lorebook";
import {
  createConversation, listConversations, loadConversation,
  appendMessage, deleteConversation, changeLocation, updateTraits,
  type ChatMessage,
} from "./chat";
import {
  html, escapeHtml,
  renderTree, renderLorebookPicker, entryFormHtml,
  renderChatList, renderChatMessages, renderAdventurePicker,
  renderActiveEntries, settingsFormHtml, validateSettings,
} from "./renderers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLorebookSlug(url: URL): string {
  return url.searchParams.get("lorebook") || "";
}

/** Dummy LLM: detect movement intent from a user message. Returns destination name or null. */
function detectDestination(message: string): string | null {
  const patterns = [
    /\b(?:go|walk|travel|head|move|run|ride|sneak|crawl|fly|sail)\s+(?:to|towards?|into)\s+(?:the\s+)?(.+)/i,
    /\b(?:enter|visit|explore)\s+(?:the\s+)?(.+)/i,
    /\blet(?:'s| us)\s+(?:go|head|travel|move)\s+(?:to|towards?|into)\s+(?:the\s+)?(.+)/i,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (m && m[1]) {
      return m[1].replace(/[.!?,;]+$/, "").trim();
    }
  }
  return null;
}

/** Match destination against existing location entries, or create a new one. */
async function resolveOrCreateLocation(
  lorebook: string,
  destination: string,
): Promise<{ path: string; name: string; content: string; isNew: boolean }> {
  const locations = await listLocationEntries(lorebook);
  const lower = destination.toLowerCase();

  // Exact name match
  for (const loc of locations) {
    if (loc.name.toLowerCase() === lower) {
      return { path: loc.path, name: loc.name, content: loc.content, isNew: false };
    }
  }

  // Partial match: destination is substring of name or vice versa
  for (const loc of locations) {
    const locLower = loc.name.toLowerCase();
    if (locLower.includes(lower) || lower.includes(locLower)) {
      return { path: loc.path, name: loc.name, content: loc.content, isNew: false };
    }
  }

  // No match — create new location entry
  const slug = destination.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const path = `locations/${slug}`;
  const entry: LorebookEntry = {
    name: destination,
    content: `A ${destination} stretches out before you.`,
    keywords: [destination.toLowerCase()],
    regex: "",
    priority: 50,
    enabled: true,
  };
  await saveEntry(lorebook, path, entry);
  return { path, name: destination, content: entry.content, isNew: true };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function handleApi(req: Request, url: URL): Promise<Response> {
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

      const headers: Record<string, string> = { "HX-Trigger": "refreshChatList,refreshActiveEntries" };
      if (isNew) headers["X-Chat-Id"] = chatId;

      let responseHtml = "";

      // Detect location change from message (dummy LLM)
      const destination = lorebook ? detectDestination(message) : null;
      if (destination && lorebook) {
        const loc = await resolveOrCreateLocation(lorebook, destination);
        const narration = `You move to ${loc.name}. ${loc.content}`;
        await changeLocation(chatId, loc.path, narration);
        headers["X-Location"] = loc.path;
        responseHtml += `<div class="chat-msg chat-msg-system">${escapeHtml(narration)}</div>`;

        const assistantMsg: ChatMessage = { role: "assistant", content: `You arrive at ${loc.name}.`, timestamp: new Date().toISOString() };
        await appendMessage(chatId, assistantMsg);
        responseHtml += `<div class="chat-msg chat-msg-assistant">${escapeHtml(assistantMsg.content)}</div>`;
      } else {
        // Placeholder response (future: LLM integration)
        const assistantMsg: ChatMessage = { role: "assistant", content: "Hello World", timestamp: new Date().toISOString() };
        await appendMessage(chatId, assistantMsg);
        responseHtml += `<div class="chat-msg chat-msg-assistant">${escapeHtml(assistantMsg.content)}</div>`;
      }

      return html(responseHtml, 200, headers);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Chat error";
      return html(`<div class="feedback error">${escapeHtml(msg)}</div>`, 400);
    }
  }

  // --- Adventure routes ---

  if (url.pathname === "/api/adventures" && req.method === "GET") {
    const lorebooks = await listLorebooks();
    const allConvos = await listConversations();
    return html(await renderAdventurePicker(lorebooks, allConvos));
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
    return html(await renderAdventurePicker(lorebooks, allConvos), 200, {
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
        { "X-Location": location, "HX-Trigger": "refreshActiveEntries" },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Location change error";
      return html(`<div class="feedback error">${escapeHtml(msg)}</div>`, 400);
    }
  }

  if (url.pathname === "/api/adventures/active-entries" && req.method === "GET") {
    const chatId = url.searchParams.get("chatId") || "";
    if (!chatId) return html(`<p class="active-entries-empty">No active entries.</p>`, 400);
    const conv = await loadConversation(chatId);
    if (!conv) return html(`<p class="active-entries-empty">Conversation not found.</p>`, 404);
    if (!conv.meta.lorebook) return html(`<p class="active-entries-empty">No lorebook attached.</p>`);

    // Collect text from last 20 messages
    const recentMessages = conv.messages.slice(-20);
    const text = recentMessages.map((m) => m.content).join(" ");

    const entries = await findActiveEntries(conv.meta.lorebook, {
      text,
      currentLocation: conv.meta.currentLocation,
      traits: conv.meta.traits,
    });
    return html(renderActiveEntries(entries, conv.meta.traits, chatId));
  }

  if (url.pathname === "/api/adventures/traits" && req.method === "PUT") {
    try {
      const body = await req.json();
      const chatId = typeof body.chatId === "string" ? body.chatId : "";
      const traits = Array.isArray(body.traits) ? body.traits.filter((t: unknown) => typeof t === "string" && t.trim()).map((t: string) => t.trim()) : [];
      if (!chatId) return html(`<div class="feedback error">Missing chatId</div>`, 400);

      const meta = await updateTraits(chatId, traits);

      // Return updated active entries
      const conv = await loadConversation(chatId);
      if (!conv) return html(`<div class="feedback error">Conversation not found</div>`, 404);

      const recentMessages = conv.messages.slice(-20);
      const text = recentMessages.map((m) => m.content).join(" ");

      const entries = await findActiveEntries(conv.meta.lorebook, {
        text,
        currentLocation: conv.meta.currentLocation,
        traits: conv.meta.traits,
      });
      return html(renderActiveEntries(entries, conv.meta.traits, chatId));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Traits update error";
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
