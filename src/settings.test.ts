import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join, resolve } from "path";
import { rm, mkdir } from "fs/promises";
import {
  validateSettings,
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  DEFAULT_PIPELINE,
  type Settings,
} from "./settings";

const DATA_DIR = resolve(join(import.meta.dir, "..", "data-test"));
const SETTINGS_PATH = join(DATA_DIR, "settings.json");

async function cleanSettings() {
  try { await rm(SETTINGS_PATH); } catch {}
}

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    general: { appName: "RPG Tavern", temperature: 0.7 },
    llm: { provider: "openai", apiKey: "sk-test", model: "gpt-4", temperature: 0.8 },
    backends: [],
    pipeline: { steps: [] },
    ...overrides,
  };
}

describe("validateSettings", () => {
  test("accepts valid input and returns normalized settings", () => {
    const result = validateSettings(validInput());
    expect(result.general.appName).toBe("RPG Tavern");
    expect(result.general.temperature).toBe(0.7);
    expect(result.llm.provider).toBe("openai");
    expect(result.llm.apiKey).toBe("sk-test");
    expect(result.llm.model).toBe("gpt-4");
    expect(result.llm.temperature).toBe(0.8);
    expect(result.backends).toEqual([]);
    expect(result.pipeline.steps).toEqual([]);
  });

  test("rejects non-object body", () => {
    expect(() => validateSettings(null)).toThrow("Body must be a JSON object");
    expect(() => validateSettings("string")).toThrow("Body must be a JSON object");
    expect(() => validateSettings(42)).toThrow("Body must be a JSON object");
  });

  test("rejects missing general section", () => {
    expect(() => validateSettings({ llm: { provider: "openai", temperature: 0.5 } }))
      .toThrow("Missing general section");
  });

  test("rejects missing llm section", () => {
    expect(() => validateSettings({ general: { appName: "Test" } }))
      .toThrow("Missing llm section");
  });

  test("rejects invalid provider", () => {
    expect(() => validateSettings(validInput({
      llm: { provider: "invalid", apiKey: "", model: "", temperature: 0.5 },
    }))).toThrow("Invalid provider");
  });

  test("accepts anthropic as provider", () => {
    const result = validateSettings(validInput({
      llm: { provider: "anthropic", apiKey: "key", model: "claude", temperature: 0.5 },
    }));
    expect(result.llm.provider).toBe("anthropic");
  });

  test("rejects temperature below 0", () => {
    expect(() => validateSettings(validInput({
      llm: { provider: "openai", apiKey: "", model: "", temperature: -1 },
    }))).toThrow("Temperature must be 0–2");
  });

  test("rejects temperature above 2", () => {
    expect(() => validateSettings(validInput({
      llm: { provider: "openai", apiKey: "", model: "", temperature: 3 },
    }))).toThrow("Temperature must be 0–2");
  });

  test("accepts temperature at boundary values", () => {
    const at0 = validateSettings(validInput({
      llm: { provider: "openai", apiKey: "", model: "", temperature: 0 },
    }));
    expect(at0.llm.temperature).toBe(0);

    const at2 = validateSettings(validInput({
      llm: { provider: "openai", apiKey: "", model: "", temperature: 2 },
    }));
    expect(at2.llm.temperature).toBe(2);
  });

  test("rejects NaN temperature", () => {
    expect(() => validateSettings(validInput({
      llm: { provider: "openai", apiKey: "", model: "", temperature: NaN },
    }))).toThrow("Temperature must be 0–2");
  });

  test("defaults appName when empty", () => {
    const result = validateSettings(validInput({
      general: { appName: "  ", temperature: 0.5 },
    }));
    expect(result.general.appName).toBe(DEFAULT_SETTINGS.general.appName);
  });

  test("defaults model when empty", () => {
    const result = validateSettings(validInput({
      llm: { provider: "openai", apiKey: "", model: "", temperature: 0.5 },
    }));
    expect(result.llm.model).toBe(DEFAULT_SETTINGS.llm.model);
  });

  test("validates backends — id required", () => {
    expect(() => validateSettings(validInput({
      backends: [{ id: "", type: "openai" }],
    }))).toThrow("Backend ID is required");
  });

  test("validates backends — unique IDs", () => {
    expect(() => validateSettings(validInput({
      backends: [
        { id: "a", name: "A", type: "openai" },
        { id: "a", name: "B", type: "openai" },
      ],
    }))).toThrow("Duplicate backend ID: a");
  });

  test("validates backends — valid type", () => {
    expect(() => validateSettings(validInput({
      backends: [{ id: "a", type: "invalid" }],
    }))).toThrow("Invalid backend type");
  });

  test("validates backends — accepts koboldcpp type", () => {
    const result = validateSettings(validInput({
      backends: [{ id: "k", name: "KoboldCpp", type: "koboldcpp", url: "http://localhost:5001" }],
    }));
    expect(result.backends).toHaveLength(1);
    expect(result.backends[0].type).toBe("koboldcpp");
  });

  test("validates backends — normalizes fields", () => {
    const result = validateSettings(validInput({
      backends: [{
        id: "  test  ",
        name: "  My Backend  ",
        type: "openai",
        url: "  http://localhost:8080  ",
        apiKey: "sk-123",
        model: "  gpt-4  ",
        streaming: true,
        maxConcurrent: 3,
      }],
    }));
    const b = result.backends[0];
    expect(b.id).toBe("test");
    expect(b.name).toBe("My Backend");
    expect(b.url).toBe("http://localhost:8080");
    expect(b.model).toBe("gpt-4");
    expect(b.streaming).toBe(true);
    expect(b.maxConcurrent).toBe(3);
  });

  test("validates backends — maxConcurrent defaults to 1", () => {
    const result = validateSettings(validInput({
      backends: [{ id: "a", type: "openai" }],
    }));
    expect(result.backends[0].maxConcurrent).toBe(1);
  });

  test("validates backends — maxConcurrent floors to 1", () => {
    const result = validateSettings(validInput({
      backends: [{ id: "a", type: "openai", maxConcurrent: 0 }],
    }));
    expect(result.backends[0].maxConcurrent).toBe(1);
  });

  test("validates pipeline — unknown backend ref throws", () => {
    expect(() => validateSettings(validInput({
      backends: [{ id: "real", type: "openai" }],
      pipeline: { steps: [{ role: "narrator", backendId: "fake", enabled: true }] },
    }))).toThrow("Pipeline step references unknown backend: fake");
  });

  test("validates pipeline — valid backend ref is accepted", () => {
    const result = validateSettings(validInput({
      backends: [{ id: "real", type: "openai" }],
      pipeline: { steps: [{ role: "narrator", backendId: "real", enabled: true }] },
    }));
    expect(result.pipeline.steps).toHaveLength(1);
    expect(result.pipeline.steps[0].backendId).toBe("real");
  });

  test("validates pipeline — empty backendId is allowed", () => {
    const result = validateSettings(validInput({
      pipeline: { steps: [{ role: "narrator", backendId: "", enabled: true }] },
    }));
    expect(result.pipeline.steps[0].backendId).toBe("");
  });

  test("validates pipeline — invalid roles are skipped", () => {
    const result = validateSettings(validInput({
      pipeline: { steps: [
        { role: "narrator", backendId: "", enabled: true },
        { role: "invalid", backendId: "", enabled: true },
        { role: "character", backendId: "", enabled: true },
      ] },
    }));
    expect(result.pipeline.steps).toHaveLength(2);
    expect(result.pipeline.steps.map((s) => s.role)).toEqual(["narrator", "character"]);
  });

  test("defaults pipeline when missing", () => {
    const result = validateSettings(validInput({ pipeline: undefined }));
    expect(result.pipeline.steps).toHaveLength(3);
    expect(result.pipeline.steps.map((s) => s.role)).toEqual(["narrator", "character", "extractor"]);
  });

  test("general.temperature falls back to llm.temperature", () => {
    const result = validateSettings({
      general: { appName: "Test" },
      llm: { provider: "openai", apiKey: "", model: "", temperature: 1.2 },
    });
    expect(result.general.temperature).toBe(1.2);
  });

  test("general.temperature takes precedence over llm.temperature", () => {
    const result = validateSettings(validInput({
      general: { appName: "Test", temperature: 0.3 },
      llm: { provider: "openai", apiKey: "", model: "", temperature: 1.5 },
    }));
    expect(result.general.temperature).toBe(0.3);
  });

  test("enabled defaults to true when not false", () => {
    const result = validateSettings(validInput({
      pipeline: { steps: [{ role: "narrator", backendId: "", enabled: undefined }] },
    }));
    expect(result.pipeline.steps[0].enabled).toBe(true);
  });

  test("enabled false is preserved", () => {
    const result = validateSettings(validInput({
      pipeline: { steps: [{ role: "narrator", backendId: "", enabled: false }] },
    }));
    expect(result.pipeline.steps[0].enabled).toBe(false);
  });
});

describe("loadSettings", () => {
  beforeEach(cleanSettings);
  afterEach(cleanSettings);

  test("returns defaults when no file exists", async () => {
    const settings = await loadSettings();
    expect(settings.general.appName).toBe(DEFAULT_SETTINGS.general.appName);
    expect(settings.general.temperature).toBe(DEFAULT_SETTINGS.general.temperature);
    expect(settings.llm.provider).toBe(DEFAULT_SETTINGS.llm.provider);
    expect(settings.backends).toEqual([]);
    expect(settings.pipeline.steps).toHaveLength(3);
  });

  test("returns defaults for corrupted file", async () => {
    await mkdir(DATA_DIR, { recursive: true });
    await Bun.write(SETTINGS_PATH, "not json!!!");
    const settings = await loadSettings();
    expect(settings.general.appName).toBe(DEFAULT_SETTINGS.general.appName);
  });
});

describe("saveSettings + loadSettings round-trip", () => {
  beforeEach(cleanSettings);
  afterEach(cleanSettings);

  test("persists and loads settings", async () => {
    const settings: Settings = {
      general: { appName: "My Tavern", temperature: 1.0 },
      llm: { provider: "openai", apiKey: "sk-test", model: "gpt-4o", temperature: 0.9 },
      backends: [{ id: "b1", name: "Backend 1", type: "openai", url: "http://localhost", apiKey: "key", model: "gpt-4", streaming: true, maxConcurrent: 2 }],
      pipeline: { steps: [{ role: "narrator", backendId: "b1", enabled: true }] },
    };

    await saveSettings(settings);
    const loaded = await loadSettings();
    expect(loaded.general.appName).toBe("My Tavern");
    expect(loaded.general.temperature).toBe(1.0);
    expect(loaded.llm.apiKey).toBe("sk-test");
    expect(loaded.backends).toHaveLength(1);
    expect(loaded.backends[0].id).toBe("b1");
    expect(loaded.pipeline.steps).toHaveLength(1);
    expect(loaded.pipeline.steps[0].backendId).toBe("b1");
  });
});

describe("loadSettings migration", () => {
  beforeEach(cleanSettings);
  afterEach(cleanSettings);

  test("migrates old settings without backends/pipeline", async () => {
    await mkdir(DATA_DIR, { recursive: true });
    await Bun.write(SETTINGS_PATH, JSON.stringify({
      general: { appName: "Old App", temperature: 0.7 },
      llm: { provider: "openai", apiKey: "", model: "gpt-4", temperature: 0.7 },
    }));

    const settings = await loadSettings();
    expect(settings.backends).toEqual([]);
    expect(settings.pipeline.steps).toHaveLength(3);
  });

  test("auto-migrates old llm.apiKey to a backend", async () => {
    await mkdir(DATA_DIR, { recursive: true });
    await Bun.write(SETTINGS_PATH, JSON.stringify({
      general: { appName: "Migrated", temperature: 0.7 },
      llm: { provider: "openai", apiKey: "sk-old-key", model: "gpt-4", temperature: 0.7 },
    }));

    const settings = await loadSettings();
    expect(settings.backends).toHaveLength(1);
    expect(settings.backends[0].id).toBe("default");
    expect(settings.backends[0].apiKey).toBe("sk-old-key");
    expect(settings.backends[0].type).toBe("openai");
    // Pipeline steps should point to the migrated backend
    for (const step of settings.pipeline.steps) {
      expect(step.backendId).toBe("default");
    }
  });

  test("does not migrate masked API key placeholder", async () => {
    await mkdir(DATA_DIR, { recursive: true });
    await Bun.write(SETTINGS_PATH, JSON.stringify({
      general: { appName: "Masked", temperature: 0.7 },
      llm: { provider: "openai", apiKey: "••••••••", model: "gpt-4", temperature: 0.7 },
    }));

    const settings = await loadSettings();
    expect(settings.backends).toEqual([]);
  });

  test("migrates temperature from llm to general when general.temperature is missing", async () => {
    await mkdir(DATA_DIR, { recursive: true });
    await Bun.write(SETTINGS_PATH, JSON.stringify({
      general: { appName: "Temp Test" },
      llm: { provider: "openai", apiKey: "", model: "", temperature: 1.3 },
    }));

    const settings = await loadSettings();
    expect(settings.general.temperature).toBe(1.3);
  });
});
