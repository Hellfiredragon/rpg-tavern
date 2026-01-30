import { join } from "path";
import { mkdir } from "fs/promises";

export type Settings = {
  general: {
    appName: string;
  };
  llm: {
    provider: "anthropic" | "openai";
    apiKey: string;
    model: string;
    temperature: number;
  };
};

export const DEFAULT_SETTINGS: Settings = {
  general: {
    appName: "RPG Tavern",
  },
  llm: {
    provider: "anthropic",
    apiKey: "",
    model: "claude-sonnet-4-20250514",
    temperature: 0.7,
  },
};

const DATA_DIR = join(import.meta.dir, "..", "data");
const SETTINGS_PATH = join(DATA_DIR, "settings.json");

export async function loadSettings(): Promise<Settings> {
  const f = Bun.file(SETTINGS_PATH);
  if (!(await f.exists())) return structuredClone(DEFAULT_SETTINGS);
  try {
    return (await f.json()) as Settings;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await Bun.write(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}
