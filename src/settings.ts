import { join } from "path";
import { mkdir } from "fs/promises";
import type { BackendConfig } from "./backends";

// ---------------------------------------------------------------------------
// Pipeline types
// ---------------------------------------------------------------------------

export type PipelineRole = "narrator" | "character" | "extractor";

export type PipelineStep = {
  role: PipelineRole;
  backendId: string;
  enabled: boolean;
};

export type PipelineConfig = {
  steps: PipelineStep[];
};

export const DEFAULT_PIPELINE: PipelineConfig = {
  steps: [
    { role: "narrator", backendId: "", enabled: true },
    { role: "character", backendId: "", enabled: true },
    { role: "extractor", backendId: "", enabled: true },
  ],
};

// ---------------------------------------------------------------------------
// Settings type
// ---------------------------------------------------------------------------

export type Settings = {
  general: {
    appName: string;
    temperature: number;
  };
  llm: {
    provider: "anthropic" | "openai";
    apiKey: string;
    model: string;
    temperature: number;
  };
  backends: BackendConfig[];
  pipeline: PipelineConfig;
};

export const DEFAULT_SETTINGS: Settings = {
  general: {
    appName: "RPG Tavern",
    temperature: 0.7,
  },
  llm: {
    provider: "anthropic",
    apiKey: "",
    model: "claude-sonnet-4-20250514",
    temperature: 0.7,
  },
  backends: [],
  pipeline: DEFAULT_PIPELINE,
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR || join(import.meta.dir, "..", "data");
const SETTINGS_PATH = join(DATA_DIR, "settings.json");

export async function loadSettings(): Promise<Settings> {
  const f = Bun.file(SETTINGS_PATH);
  if (!(await f.exists())) return structuredClone(DEFAULT_SETTINGS);
  try {
    const raw = (await f.json()) as Record<string, unknown>;
    const settings = raw as Settings;

    // Ensure new fields have defaults for old settings files
    if (!Array.isArray(settings.backends)) settings.backends = [];
    if (!settings.pipeline || !Array.isArray(settings.pipeline.steps)) {
      settings.pipeline = structuredClone(DEFAULT_PIPELINE);
    }
    // Migrate temperature from llm to general
    if (settings.general.temperature === undefined) {
      settings.general.temperature = settings.llm?.temperature ?? DEFAULT_SETTINGS.general.temperature;
    }

    // Auto-migrate: if backends empty but old llm.apiKey is set, create one OpenAI backend
    if (settings.backends.length === 0 && settings.llm?.apiKey && settings.llm.apiKey !== "••••••••") {
      settings.backends = [{
        id: "default",
        name: "Default",
        type: "openai",
        url: settings.llm.provider === "anthropic"
          ? "https://api.anthropic.com"
          : "https://api.openai.com",
        apiKey: settings.llm.apiKey,
        model: settings.llm.model || DEFAULT_SETTINGS.llm.model,
        streaming: true,
        maxConcurrent: 1,
      }];
      // Point pipeline steps at the migrated backend
      for (const step of settings.pipeline.steps) {
        if (!step.backendId) step.backendId = "default";
      }
    }

    return settings;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await Bun.write(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Validation
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

  // Validate backends
  const rawBackends = Array.isArray(obj.backends) ? obj.backends : [];
  const backends: BackendConfig[] = [];
  const seenIds = new Set<string>();
  for (const b of rawBackends) {
    if (!b || typeof b !== "object") continue;
    const bc = b as Record<string, unknown>;
    const id = typeof bc.id === "string" ? bc.id.trim() : "";
    if (!id) throw new Error("Backend ID is required");
    if (seenIds.has(id)) throw new Error(`Duplicate backend ID: ${id}`);
    seenIds.add(id);
    const bType = bc.type;
    if (bType !== "koboldcpp" && bType !== "openai") throw new Error(`Invalid backend type: ${bType}`);
    const maxConcurrent = typeof bc.maxConcurrent === "number" ? Math.max(1, Math.round(bc.maxConcurrent)) : 1;
    backends.push({
      id,
      name: typeof bc.name === "string" ? bc.name.trim() || id : id,
      type: bType,
      url: typeof bc.url === "string" ? bc.url.trim() : "",
      apiKey: typeof bc.apiKey === "string" ? bc.apiKey : "",
      model: typeof bc.model === "string" ? bc.model.trim() : "",
      streaming: bc.streaming === true,
      maxConcurrent,
    });
  }

  // Validate pipeline
  const rawPipeline = obj.pipeline as Record<string, unknown> | undefined;
  let pipeline: PipelineConfig;
  if (rawPipeline && Array.isArray(rawPipeline.steps)) {
    const steps: PipelineStep[] = [];
    for (const s of rawPipeline.steps) {
      if (!s || typeof s !== "object") continue;
      const step = s as Record<string, unknown>;
      const role = step.role;
      if (role !== "narrator" && role !== "character" && role !== "extractor") continue;
      const backendId = typeof step.backendId === "string" ? step.backendId : "";
      // Validate backendId references an existing backend (allow empty = disabled)
      if (backendId && !seenIds.has(backendId)) {
        throw new Error(`Pipeline step references unknown backend: ${backendId}`);
      }
      steps.push({ role, backendId, enabled: step.enabled !== false });
    }
    pipeline = { steps };
  } else {
    pipeline = structuredClone(DEFAULT_PIPELINE);
  }

  // General temperature (preferred) — fall back to llm temperature for migration
  const generalTemp = typeof (general as Record<string, unknown>).temperature === "number"
    ? Number((general as Record<string, unknown>).temperature)
    : temperature;

  return {
    general: {
      appName: typeof general.appName === "string" ? general.appName.trim() || DEFAULT_SETTINGS.general.appName : DEFAULT_SETTINGS.general.appName,
      temperature: isNaN(generalTemp) || generalTemp < 0 || generalTemp > 2 ? DEFAULT_SETTINGS.general.temperature : generalTemp,
    },
    llm: {
      provider,
      apiKey: typeof llm.apiKey === "string" ? llm.apiKey : "",
      model: typeof llm.model === "string" ? llm.model.trim() || DEFAULT_SETTINGS.llm.model : DEFAULT_SETTINGS.llm.model,
      temperature,
    },
    backends,
    pipeline,
  };
}
