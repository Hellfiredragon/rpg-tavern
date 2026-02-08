import { resolve, join } from "path";
import { rm } from "fs/promises";

export const DATA_DIR = resolve(join(import.meta.dir, "..", "data-test"));
export const CHATS_DIR = join(DATA_DIR, "chats");
export const LOREBOOKS_DIR = join(DATA_DIR, "lorebooks");

export async function cleanData() {
  try { await rm(CHATS_DIR, { recursive: true }); } catch {}
  try { await rm(LOREBOOKS_DIR, { recursive: true }); } catch {}
}

export async function cleanChats() {
  try { await rm(CHATS_DIR, { recursive: true }); } catch {}
}

export async function cleanLorebooks() {
  try { await rm(LOREBOOKS_DIR, { recursive: true }); } catch {}
}

export function createApiHelpers(base: string) {
  function api(path: string, init?: RequestInit) {
    return fetch(base + path, init);
  }

  function jsonPost(path: string, body: object) {
    return fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function jsonPut(path: string, body: object) {
    return fetch(base + path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  return { api, jsonPost, jsonPut };
}
