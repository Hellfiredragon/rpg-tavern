import type {
  Adventure, Template, LocationEntry, ActiveEntry,
  ChatMessage, ChatMeta, TreeNode, LorebookEntry, Settings,
} from "./types";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data as T;
}

function apiPost<T>(path: string, body: object): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function apiPut<T>(path: string, body: object): Promise<T> {
  return apiFetch<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function apiDelete<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE" });
}

// --- Adventures ---

export function fetchAdventures(): Promise<{ adventures: Adventure[]; templates: Template[] }> {
  return apiFetch("/api/adventures");
}

export function deleteAdventure(slug: string): Promise<{ ok: true }> {
  return apiDelete(`/api/adventures?lorebook=${encodeURIComponent(slug)}`);
}

export function resumeAdventure(slug: string): Promise<{ lorebook: string; chatId: string; name: string; location: string }> {
  return apiFetch(`/api/adventures/resume?lorebook=${encodeURIComponent(slug)}`);
}

export function fetchLocations(slug: string): Promise<LocationEntry[]> {
  return apiFetch(`/api/adventures/locations?lorebook=${encodeURIComponent(slug)}`);
}

export function changeLocation(chatId: string, location: string): Promise<{ location: string; narration: string }> {
  return apiPut("/api/adventures/location", { chatId, location });
}

export function fetchActiveEntries(chatId: string): Promise<{ traits: string[]; entries: ActiveEntry[] }> {
  return apiFetch(`/api/adventures/active-entries?chatId=${encodeURIComponent(chatId)}`);
}

export function updateTraits(chatId: string, traits: string[]): Promise<{ traits: string[]; entries: ActiveEntry[] }> {
  return apiPut("/api/adventures/traits", { chatId, traits });
}

export function toggleGoal(lorebook: string, path: string, completed: boolean, chatId: string): Promise<{ traits: string[]; entries: ActiveEntry[] }> {
  return apiPut("/api/adventures/goal", { lorebook, path, completed, chatId });
}

// --- Chats ---

export function createChat(lorebook: string, location?: string): Promise<{ chatId: string }> {
  return apiPost("/api/chats", { lorebook, location: location || "" });
}

export function fetchMessages(id: string): Promise<{ meta: ChatMeta; messages: ChatMessage[] }> {
  return apiFetch(`/api/chats/messages?id=${encodeURIComponent(id)}`);
}

export function sendMessage(message: string, chatId: string, lorebook: string): Promise<{ chatId: string; messages: ChatMessage[]; location: string | null; isNew: boolean }> {
  return apiPost("/api/chat", { message, chatId, lorebook });
}

// --- Lorebooks ---

export function fetchLorebooks(): Promise<{ templates: Template[] }> {
  return apiFetch("/api/lorebooks");
}

export function fetchLorebookMeta(slug: string): Promise<{ slug: string; name: string; template: boolean; preset: boolean }> {
  return apiFetch(`/api/lorebooks/meta?slug=${encodeURIComponent(slug)}`);
}

export function createLorebook(slug: string, name: string): Promise<{ ok: true }> {
  return apiPost("/api/lorebooks", { slug, name });
}

export function deleteLorebook(slug: string): Promise<{ ok: true }> {
  return apiDelete(`/api/lorebooks?slug=${encodeURIComponent(slug)}`);
}

export function copyLorebook(source: string, slug: string, name: string): Promise<{ ok: true }> {
  return apiPost("/api/lorebooks/copy", { source, slug, name });
}

export function makeTemplate(source: string, slug: string, name: string): Promise<{ ok: true }> {
  return apiPost("/api/lorebooks/make-template", { source, slug, name });
}

// --- Lorebook entries ---

export function fetchTree(lorebook: string): Promise<{ nodes: TreeNode[]; readonly: boolean }> {
  return apiFetch(`/api/lorebook/tree?lorebook=${encodeURIComponent(lorebook)}`);
}

export function fetchEntry(lorebook: string, path: string): Promise<{ path: string; entry: LorebookEntry; isNew: boolean; readonly: boolean }> {
  return apiFetch(`/api/lorebook/entry?path=${encodeURIComponent(path)}&lorebook=${encodeURIComponent(lorebook)}`);
}

export function createEntry(lorebook: string, path: string, entry: LorebookEntry): Promise<{ ok: true; entry: LorebookEntry }> {
  return apiPost(`/api/lorebook/entry?path=${encodeURIComponent(path)}&lorebook=${encodeURIComponent(lorebook)}`, entry);
}

export function saveEntry(lorebook: string, path: string, entry: LorebookEntry): Promise<{ ok: true; entry: LorebookEntry }> {
  return apiPut(`/api/lorebook/entry?path=${encodeURIComponent(path)}&lorebook=${encodeURIComponent(lorebook)}`, entry);
}

export function deleteEntry(lorebook: string, path: string): Promise<{ ok: true }> {
  return apiDelete(`/api/lorebook/entry?path=${encodeURIComponent(path)}&lorebook=${encodeURIComponent(lorebook)}`);
}

export function createFolder(lorebook: string, path: string): Promise<{ ok: true }> {
  return apiPost(`/api/lorebook/folder?lorebook=${encodeURIComponent(lorebook)}`, { path });
}

export function deleteFolder(lorebook: string, path: string): Promise<{ ok: true }> {
  return apiDelete(`/api/lorebook/folder?path=${encodeURIComponent(path)}&lorebook=${encodeURIComponent(lorebook)}`);
}

export function moveEntry(lorebook: string, path: string, destination: string): Promise<{ ok: true; newPath: string }> {
  return apiPut(`/api/lorebook/entry/move?lorebook=${encodeURIComponent(lorebook)}`, { path, destination });
}

// --- Message deletion ---

export function deleteMessage(chatId: string, messageId: string): Promise<{ ok: true }> {
  return apiDelete(`/api/chats/message?chatId=${encodeURIComponent(chatId)}&messageId=${encodeURIComponent(messageId)}`);
}

// --- Settings ---

export function fetchSettings(): Promise<Settings> {
  return apiFetch("/api/settings");
}

export function saveSettings(settings: Settings): Promise<{ ok: true; settings: Settings }> {
  return apiPut("/api/settings", settings);
}
