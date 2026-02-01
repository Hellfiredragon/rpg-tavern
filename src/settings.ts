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

const DATA_DIR = process.env.DATA_DIR || join(import.meta.dir, "..", "data");
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
