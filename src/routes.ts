import { loadSettings, saveSettings, validateSettings, type Settings } from "./settings";
import { initBackendsFromConfig, listBackendIds } from "./backends";
import {
  scanTree, loadEntry, saveEntry, deleteEntry, moveEntry,
  createFolder, deleteFolder, validateEntry, DEFAULT_ENTRY,
  listLorebooks, createLorebook, deleteLorebook,
  copyLorebook, listLocationEntries, loadLorebookMeta,
  saveLorebookMeta, isReadOnlyPreset, findActiveEntries,
  loadAllEntries, getEntryType,
  type LorebookEntry,
} from "./lorebook";
import {
  createConversation, listConversations, loadConversation,
  appendMessage, deleteConversation, deleteMessage, changeLocation,
  updateTraits, generateMessageId,
  type ChatMessage,
} from "./chat";
import { createPipelineRun, removePipelineRun, getPipelineRun, cancelPipelineRun } from "./events";
import { executePipeline } from "./pipeline";
import { initRepo } from "./git";
import { revertCommits } from "./git";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function err(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

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
    contexts: [],
  };
  await saveEntry(lorebook, path, entry);
  return { path, name: destination, content: entry.content, isNew: true };
}

/** Dummy LLM: detect summon intent from a user message. Returns character name or null. */
function detectSummon(message: string): string | null {
  const patterns = [
    /\b(?:call|summon|bring|fetch|get)\s+(?:the\s+)?(.+?)(?:\s+here|\s+over|\s+to\s+.+)?$/i,
    /\b(.+?),?\s+(?:come\s+here|come\s+over|come\s+to\s+.+)/i,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (m && m[1]) {
      return m[1].replace(/[.!?,;]+$/, "").trim();
    }
  }
  return null;
}

/** Match a summoned character name against lorebook character entries. */
async function resolveCharacterSummon(
  lorebook: string,
  characterName: string,
): Promise<{ path: string; name: string } | null> {
  const allEntries = await loadAllEntries(lorebook);
  const lower = characterName.toLowerCase();

  for (const entry of allEntries) {
    if (!entry.path.startsWith("characters/")) continue;
    // Exact name match
    if (entry.name.toLowerCase() === lower) {
      return { path: entry.path, name: entry.name };
    }
    // Keyword match
    if (entry.keywords.some((kw) => kw.toLowerCase() === lower || lower.includes(kw.toLowerCase()))) {
      return { path: entry.path, name: entry.name };
    }
  }

  return null;
}

/** Check if any LLM backends are configured. */
function hasBackends(): boolean {
  return listBackendIds().length > 0;
}

// ---------------------------------------------------------------------------
// SSE helper
// ---------------------------------------------------------------------------

function createSSEResponse(chatId: string, lorebook: string, userMessage: ChatMessage): Response {
  const { bus, abort } = createPipelineRun(chatId);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const write = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream already closed
        }
      };

      const unsubscribe = bus.subscribe((evt) => {
        write(evt.type, evt);
      });

      // Run pipeline asynchronously
      (async () => {
        try {
          const settings = await loadSettings();
          await executePipeline(chatId, lorebook, userMessage, settings.pipeline, bus, abort.signal);
        } catch (err) {
          if (!abort.signal.aborted) {
            const errMsg = err instanceof Error ? err.message : "Pipeline failed";
            write("pipeline_error", { type: "pipeline_error", error: errMsg });
          }
        } finally {
          unsubscribe();
          removePipelineRun(chatId);
          try { controller.close(); } catch { /* already closed */ }
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function handleApi(req: Request, url: URL): Promise<Response> {
  // --- Chat routes ---

  if (url.pathname === "/api/chats" && req.method === "GET") {
    const lorebook = url.searchParams.get("lorebook") || undefined;
    const convos = await listConversations(lorebook);
    return json(convos);
  }

  if (url.pathname === "/api/chats" && req.method === "POST") {
    try {
      const body = await req.json();
      const lorebook = typeof body.lorebook === "string" ? body.lorebook : "";
      const location = typeof body.location === "string" ? body.location : "";
      const meta = await createConversation({ lorebook, currentLocation: location });
      // Initialize git repo for the lorebook when creating an adventure
      if (lorebook) {
        try { await initRepo(lorebook); } catch { /* may already exist */ }
      }
      return json({ chatId: meta.id });
    } catch {
      const meta = await createConversation();
      return json({ chatId: meta.id });
    }
  }

  if (url.pathname === "/api/chats/messages" && req.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return err("No conversation selected.", 400);
    const conv = await loadConversation(id);
    if (!conv) return err("Conversation not found.", 404);
    return json({ meta: conv.meta, messages: conv.messages });
  }

  // --- Message deletion ---

  if (url.pathname === "/api/chats/message" && req.method === "DELETE") {
    const chatId = url.searchParams.get("chatId") || "";
    const messageId = url.searchParams.get("messageId") || "";
    if (!chatId || !messageId) return err("Missing chatId or messageId");

    try {
      const deleted = await deleteMessage(chatId, messageId);
      if (!deleted) return err("Message not found", 404);

      // Revert git commits if the message had any
      if (deleted.commits && deleted.commits.length > 0) {
        const conv = await loadConversation(chatId);
        if (conv?.meta.lorebook) {
          await revertCommits(conv.meta.lorebook, deleted.commits);
        }
      }

      return json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      return err(msg);
    }
  }

  // --- Chat send (with LLM pipeline or fallback) ---

  if (url.pathname === "/api/chat" && req.method === "POST") {
    try {
      const body = await req.json();
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) return err("Empty message");

      let chatId = typeof body.chatId === "string" ? body.chatId : "";
      const lorebook = typeof body.lorebook === "string" ? body.lorebook : "";
      const useSSE = body.stream === true;
      let isNew = false;

      if (!chatId) {
        const meta = await createConversation({ lorebook });
        chatId = meta.id;
        isNew = true;
        if (lorebook) {
          try { await initRepo(lorebook); } catch { /* may already exist */ }
        }
      }

      const userMsg: ChatMessage = {
        id: generateMessageId(),
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
      };
      await appendMessage(chatId, userMsg);

      // Check for active pipeline
      if (getPipelineRun(chatId)) {
        return err("Pipeline already active for this chat", 409);
      }

      // If backends are configured, use the LLM pipeline
      if (hasBackends()) {
        if (useSSE) {
          return createSSEResponse(chatId, lorebook, userMsg);
        }

        // Synchronous fallback — run pipeline and return JSON
        const settings = await loadSettings();
        const { bus, abort } = createPipelineRun(chatId);
        try {
          const result = await executePipeline(chatId, lorebook, userMsg, settings.pipeline, bus, abort.signal);
          return json({
            chatId,
            messages: [userMsg, ...result.messages],
            location: result.location ?? null,
            isNew,
          });
        } finally {
          removePipelineRun(chatId);
        }
      }

      // No backends configured — use dummy LLM fallback
      const newMessages: ChatMessage[] = [userMsg];
      let location: string | null = null;

      // Detect location change from message (dummy LLM)
      const destination = lorebook ? detectDestination(message) : null;
      if (destination && lorebook) {
        const loc = await resolveOrCreateLocation(lorebook, destination);
        const narration = `You move to ${loc.name}. ${loc.content}`;
        await changeLocation(chatId, loc.path, narration);
        location = loc.path;

        const systemMsg: ChatMessage = {
          id: generateMessageId(),
          role: "system",
          source: "system",
          content: narration,
          timestamp: new Date().toISOString(),
        };
        newMessages.push(systemMsg);

        const assistantMsg: ChatMessage = {
          id: generateMessageId(),
          role: "assistant",
          content: `You arrive at ${loc.name}.`,
          timestamp: new Date().toISOString(),
        };
        await appendMessage(chatId, assistantMsg);
        newMessages.push(assistantMsg);
      } else if (lorebook) {
        // Detect summon intent
        const summonName = detectSummon(message);
        const conv = await loadConversation(chatId);
        if (summonName && conv && conv.meta.currentLocation) {
          const result = await resolveCharacterSummon(lorebook, summonName);
          if (result) {
            // Update the character entry's currentLocation to the player's location
            const charEntry = await loadEntry(lorebook, result.path);
            if (charEntry) {
              charEntry.currentLocation = conv.meta.currentLocation;
              await saveEntry(lorebook, result.path, charEntry);
            }
            const narration = `${result.name} arrives at your location.`;
            const systemMsg: ChatMessage = {
              id: generateMessageId(),
              role: "system",
              source: "system",
              content: narration,
              timestamp: new Date().toISOString(),
            };
            await appendMessage(chatId, systemMsg);
            newMessages.push(systemMsg);

            const assistantMsg: ChatMessage = {
              id: generateMessageId(),
              role: "assistant",
              content: `${result.name} has joined you.`,
              timestamp: new Date().toISOString(),
            };
            await appendMessage(chatId, assistantMsg);
            newMessages.push(assistantMsg);
          } else {
            // Character not found — normal response
            const assistantMsg: ChatMessage = {
              id: generateMessageId(),
              role: "assistant",
              content: "Hello World",
              timestamp: new Date().toISOString(),
            };
            await appendMessage(chatId, assistantMsg);
            newMessages.push(assistantMsg);
          }
        } else {
          // Placeholder response (future: LLM integration)
          const assistantMsg: ChatMessage = {
            id: generateMessageId(),
            role: "assistant",
            content: "Hello World",
            timestamp: new Date().toISOString(),
          };
          await appendMessage(chatId, assistantMsg);
          newMessages.push(assistantMsg);
        }
      } else {
        // No lorebook — placeholder response
        const assistantMsg: ChatMessage = {
          id: generateMessageId(),
          role: "assistant",
          content: "Hello World",
          timestamp: new Date().toISOString(),
        };
        await appendMessage(chatId, assistantMsg);
        newMessages.push(assistantMsg);
      }

      return json({ chatId, messages: newMessages, location, isNew });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Chat error";
      return err(msg);
    }
  }

  // --- Cancel in-flight generation ---

  if (url.pathname === "/api/chat/cancel" && req.method === "POST") {
    try {
      const body = await req.json();
      const chatId = typeof body.chatId === "string" ? body.chatId : "";
      if (!chatId) return err("Missing chatId");
      cancelPipelineRun(chatId);
      return json({ ok: true });
    } catch {
      return json({ ok: true });
    }
  }

  // --- Adventure routes ---

  if (url.pathname === "/api/adventures" && req.method === "GET") {
    const lorebooks = await listLorebooks();
    const allConvos = await listConversations();
    const templates = lorebooks.filter((lb) => lb.meta.template);

    // Only show user lorebooks that have been started (have at least one conversation)
    const startedAdventures: { slug: string; name: string; latestChatId: string; currentLocation: string; locationName: string; updatedAt: string }[] = [];
    for (const lb of lorebooks) {
      if (lb.meta.template) continue;
      const latest = allConvos.find((c) => c.lorebook === lb.slug);
      if (!latest) continue;

      let locationName = "";
      if (latest.currentLocation) {
        const entry = await loadEntry(lb.slug, latest.currentLocation);
        locationName = entry?.name ?? latest.currentLocation.split("/").pop() ?? "";
      }

      startedAdventures.push({
        slug: lb.slug,
        name: lb.meta.name,
        latestChatId: latest.id,
        currentLocation: latest.currentLocation,
        locationName,
        updatedAt: latest.updatedAt,
      });
    }

    // Sort by last played (most recent first)
    startedAdventures.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return json({
      adventures: startedAdventures,
      templates: templates.map((lb) => ({ slug: lb.slug, name: lb.meta.name, preset: lb.preset })),
    });
  }

  if (url.pathname === "/api/adventures" && req.method === "DELETE") {
    const slug = url.searchParams.get("lorebook");
    if (!slug) return err("Missing lorebook");
    // Delete all conversations for this adventure
    const convos = await listConversations(slug);
    for (const c of convos) {
      try { await deleteConversation(c.id); } catch { /* already gone */ }
    }
    // Delete the lorebook itself
    await deleteLorebook(slug);
    return json({ ok: true });
  }

  if (url.pathname === "/api/adventures/resume" && req.method === "GET") {
    const slug = url.searchParams.get("lorebook") || "";
    if (!slug) return err("Missing lorebook");
    const convos = await listConversations(slug);
    if (convos.length === 0) return err("No conversations found", 404);
    const latest = convos[0]; // already sorted by updatedAt desc
    let name = slug;
    try {
      const meta = await loadLorebookMeta(slug);
      if (meta) name = meta.name;
    } catch { /* use slug as fallback */ }
    return json({
      lorebook: slug,
      chatId: latest.id,
      name,
      location: latest.currentLocation || "",
    });
  }

  if (url.pathname === "/api/adventures/locations" && req.method === "GET") {
    const lb = url.searchParams.get("lorebook") || "default";
    const locations = await listLocationEntries(lb);
    return json(locations.map((loc) => ({ path: loc.path, name: loc.name })));
  }

  if (url.pathname === "/api/adventures/location" && req.method === "PUT") {
    try {
      const body = await req.json();
      const chatId = typeof body.chatId === "string" ? body.chatId : "";
      const location = typeof body.location === "string" ? body.location : "";
      if (!chatId || !location) return err("Missing chatId or location");

      const conv = await loadConversation(chatId);
      if (!conv) return err("Conversation not found", 404);

      // Load the location entry from the lorebook for its name/content
      const entry = await loadEntry(conv.meta.lorebook, location);
      const locationName = entry?.name ?? location.split("/").pop() ?? location;
      const narration = `You move to ${locationName}. ${entry?.content ?? ""}`;

      await changeLocation(chatId, location, narration);

      return json({ location, narration });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Location change error";
      return err(msg);
    }
  }

  if (url.pathname === "/api/adventures/active-entries" && req.method === "GET") {
    const chatId = url.searchParams.get("chatId") || "";
    if (!chatId) return err("Missing chatId");
    const conv = await loadConversation(chatId);
    if (!conv) return err("Conversation not found", 404);
    if (!conv.meta.lorebook) return json({ traits: conv.meta.traits, entries: [] });

    // Collect text from last 20 messages
    const recentMessages = conv.messages.slice(-20);
    const text = recentMessages.map((m) => m.content).join(" ");

    const entries = await findActiveEntries(conv.meta.lorebook, {
      text,
      currentLocation: conv.meta.currentLocation,
      traits: conv.meta.traits,
    });
    return json({ traits: conv.meta.traits, entries });
  }

  if (url.pathname === "/api/adventures/traits" && req.method === "PUT") {
    try {
      const body = await req.json();
      const chatId = typeof body.chatId === "string" ? body.chatId : "";
      const traits = Array.isArray(body.traits) ? body.traits.filter((t: unknown) => typeof t === "string" && t.trim()).map((t: string) => t.trim()) : [];
      if (!chatId) return err("Missing chatId");

      await updateTraits(chatId, traits);

      // Return updated active entries
      const conv = await loadConversation(chatId);
      if (!conv) return err("Conversation not found", 404);

      const recentMessages = conv.messages.slice(-20);
      const text = recentMessages.map((m) => m.content).join(" ");

      const entries = await findActiveEntries(conv.meta.lorebook, {
        text,
        currentLocation: conv.meta.currentLocation,
        traits: conv.meta.traits,
      });
      return json({ traits: conv.meta.traits, entries });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Traits update error";
      return err(msg);
    }
  }

  if (url.pathname === "/api/adventures/goal" && req.method === "PUT") {
    try {
      const body = await req.json();
      const lb = typeof body.lorebook === "string" ? body.lorebook.trim() : "";
      const path = typeof body.path === "string" ? body.path.trim() : "";
      const completed = body.completed === true;
      if (!lb || !path) return err("Missing lorebook or path");

      const entry = await loadEntry(lb, path);
      if (!entry) return err("Goal entry not found", 404);

      entry.completed = completed;
      await saveEntry(lb, path, entry);

      // Return updated active entries (need a chatId to compute context)
      const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
      if (chatId) {
        const conv = await loadConversation(chatId);
        if (conv) {
          const recentMessages = conv.messages.slice(-20);
          const text = recentMessages.map((m) => m.content).join(" ");
          const entries = await findActiveEntries(lb, {
            text,
            currentLocation: conv.meta.currentLocation,
            traits: conv.meta.traits,
          });
          return json({ traits: conv.meta.traits, entries });
        }
      }
      return json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Goal update error";
      return err(msg);
    }
  }

  // --- Settings routes ---

  if (url.pathname === "/api/settings" && req.method === "GET") {
    const settings = await loadSettings();
    const masked: Settings = {
      ...settings,
      llm: { ...settings.llm, apiKey: settings.llm.apiKey ? "••••••••" : "" },
      backends: settings.backends.map((b) => ({
        ...b,
        apiKey: b.apiKey ? "••••••••" : "",
      })),
    };
    return json(masked);
  }

  if (url.pathname === "/api/settings" && req.method === "PUT") {
    try {
      const body = await req.json();

      // Preserve actual API keys when masked placeholder is sent
      const currentSettings = await loadSettings();
      if (body.llm?.apiKey === "••••••••") {
        body.llm.apiKey = currentSettings.llm.apiKey;
      }
      if (Array.isArray(body.backends)) {
        for (let i = 0; i < body.backends.length; i++) {
          if (body.backends[i]?.apiKey === "••••••••") {
            // Find matching backend by id
            const existing = currentSettings.backends.find((b) => b.id === body.backends[i].id);
            if (existing) body.backends[i].apiKey = existing.apiKey;
          }
        }
      }

      const settings = validateSettings(body);
      await saveSettings(settings);

      // Re-initialize backends with new config
      if (settings.backends.length > 0) {
        initBackendsFromConfig(settings.backends);
      }

      return json({ ok: true, settings });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Invalid settings";
      return err(msg);
    }
  }

  // --- Lorebook management routes ---

  if (url.pathname === "/api/lorebooks" && req.method === "GET") {
    const lorebooks = await listLorebooks();
    const templates = lorebooks.filter((lb) => lb.meta.template);
    return json({
      templates: templates.map((lb) => ({ slug: lb.slug, name: lb.meta.name, preset: lb.preset })),
    });
  }

  if (url.pathname === "/api/lorebooks/meta" && req.method === "GET") {
    const slug = url.searchParams.get("slug") || "";
    if (!slug) return err("Missing slug");
    try {
      const meta = await loadLorebookMeta(slug);
      if (!meta) return err("Not found", 404);
      const preset = await isReadOnlyPreset(slug);
      return json({ slug, name: meta.name, template: !!meta.template, preset });
    } catch {
      return err("Not found", 404);
    }
  }

  if (url.pathname === "/api/lorebooks" && req.method === "POST") {
    try {
      const body = await req.json();
      const slug = typeof body.slug === "string" ? body.slug.trim() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!slug || !name) return err("Slug and name are required");
      await createLorebook(slug, name, true);
      return json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to create lorebook";
      return err(msg);
    }
  }

  if (url.pathname === "/api/lorebooks" && req.method === "DELETE") {
    const slug = url.searchParams.get("slug");
    if (!slug) return err("Missing slug");
    if (await isReadOnlyPreset(slug)) {
      return err("Cannot delete a preset lorebook", 403);
    }
    await deleteLorebook(slug);
    return json({ ok: true });
  }

  if (url.pathname === "/api/lorebooks/copy" && req.method === "POST") {
    try {
      const body = await req.json();
      const source = typeof body.source === "string" ? body.source.trim() : "";
      const slug = typeof body.slug === "string" ? body.slug.trim() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!source || !slug || !name) return err("Source, slug, and name are required");
      await copyLorebook(source, slug, name);
      return json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to copy lorebook";
      return err(msg);
    }
  }

  if (url.pathname === "/api/lorebooks/make-template" && req.method === "POST") {
    try {
      const body = await req.json();
      const source = typeof body.source === "string" ? body.source.trim() : "";
      const slug = typeof body.slug === "string" ? body.slug.trim() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!source || !slug || !name) return err("Source, slug, and name are required");
      await copyLorebook(source, slug, name);
      // Mark the copy as a template
      await saveLorebookMeta(slug, { name, template: true });
      return json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to create template";
      return err(msg);
    }
  }

  // --- Lorebook entry/folder routes ---

  if (url.pathname === "/api/lorebook/tree" && req.method === "GET") {
    const lb = getLorebookSlug(url);
    const tree = await scanTree(lb);
    const readonly = await isReadOnlyPreset(lb);
    return json({ nodes: tree, readonly });
  }

  if (url.pathname === "/api/lorebook/entry" && req.method === "GET") {
    const lb = getLorebookSlug(url);
    const path = url.searchParams.get("path");
    if (!path) return err("Missing path parameter");
    const entry = await loadEntry(lb, path);
    const readonly = await isReadOnlyPreset(lb);
    return json({ path, entry: entry ?? DEFAULT_ENTRY, isNew: !entry, readonly });
  }

  if (url.pathname === "/api/lorebook/entry" && req.method === "POST") {
    const lb = getLorebookSlug(url);
    if (await isReadOnlyPreset(lb)) return err("Cannot modify a preset lorebook", 403);
    const path = url.searchParams.get("path");
    if (!path) return err("Missing path");
    try {
      const body = await req.json();
      const entry = validateEntry(body);
      await saveEntry(lb, path, entry);
      return json({ ok: true, entry });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Invalid entry";
      return err(msg);
    }
  }

  if (url.pathname === "/api/lorebook/entry" && req.method === "PUT") {
    const lb = getLorebookSlug(url);
    if (await isReadOnlyPreset(lb)) return err("Cannot modify a preset lorebook", 403);
    const path = url.searchParams.get("path");
    if (!path) return err("Missing path");
    try {
      const body = await req.json();
      const entry = validateEntry(body);
      await saveEntry(lb, path, entry);
      return json({ ok: true, entry });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Invalid entry";
      return err(msg);
    }
  }

  if (url.pathname === "/api/lorebook/entry" && req.method === "DELETE") {
    const lb = getLorebookSlug(url);
    if (await isReadOnlyPreset(lb)) return err("Cannot modify a preset lorebook", 403);
    const path = url.searchParams.get("path");
    if (!path) return err("Missing path");
    await deleteEntry(lb, path);
    return json({ ok: true });
  }

  if (url.pathname === "/api/lorebook/folder" && req.method === "POST") {
    const lb = getLorebookSlug(url);
    if (await isReadOnlyPreset(lb)) return err("Cannot modify a preset lorebook", 403);
    try {
      const body = await req.json();
      const path = typeof body.path === "string" ? body.path.trim() : "";
      if (!path) return err("Missing path");
      await createFolder(lb, path);
      return json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to create folder";
      return err(msg);
    }
  }

  if (url.pathname === "/api/lorebook/folder" && req.method === "DELETE") {
    const lb = getLorebookSlug(url);
    if (await isReadOnlyPreset(lb)) return err("Cannot modify a preset lorebook", 403);
    const path = url.searchParams.get("path");
    if (!path) return err("Missing path");
    await deleteFolder(lb, path);
    return json({ ok: true });
  }

  if (url.pathname === "/api/lorebook/entry/move" && req.method === "PUT") {
    const lb = getLorebookSlug(url);
    if (await isReadOnlyPreset(lb)) return err("Cannot modify a preset lorebook", 403);
    try {
      const body = await req.json();
      const path = typeof body.path === "string" ? body.path.trim() : "";
      const destination = typeof body.destination === "string" ? body.destination : "";
      if (!path) return err("Missing path");
      const newPath = await moveEntry(lb, path, destination);
      return json({ ok: true, newPath });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Move failed";
      return err(msg);
    }
  }

  return new Response("Not Found", { status: 404 });
}
