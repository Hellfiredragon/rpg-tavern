import { useState, useEffect } from "react";
import * as api from "../api";
import type { Settings, BackendConfig, PipelineStep, BackendType } from "../types";

const defaults: Settings = {
  general: { appName: "RPG Tavern" },
  llm: { provider: "anthropic", apiKey: "", model: "claude-sonnet-4-20250514", temperature: 0.7 },
  backends: [],
  pipeline: {
    steps: [
      { role: "narrator", backendId: "", enabled: true },
      { role: "character", backendId: "", enabled: true },
      { role: "extractor", backendId: "", enabled: true },
    ],
  },
};

function newBackend(): BackendConfig {
  const id = `backend-${Date.now().toString(36)}`;
  return {
    id,
    name: "",
    type: "openai",
    url: "",
    apiKey: "",
    model: "",
    streaming: true,
    maxConcurrent: 1,
  };
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    api.fetchSettings().then((s) => {
      // Ensure new fields exist on old settings
      if (!Array.isArray(s.backends)) s.backends = [];
      if (!s.pipeline || !Array.isArray(s.pipeline.steps)) {
        s.pipeline = defaults.pipeline;
      }
      setSettings(s);
    }).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const result = await api.saveSettings(settings);
      setSettings(result.settings);
      setFeedback({ type: "success", msg: "Settings saved." });
    } catch (err: unknown) {
      setFeedback({ type: "error", msg: err instanceof Error ? err.message : "Failed to save" });
    }
  };

  const updateBackend = (idx: number, patch: Partial<BackendConfig>) => {
    setSettings((s) => ({
      ...s,
      backends: s.backends.map((b, i) => i === idx ? { ...b, ...patch } : b),
    }));
  };

  const addBackend = () => {
    setSettings((s) => ({ ...s, backends: [...s.backends, newBackend()] }));
  };

  const removeBackend = (idx: number) => {
    setSettings((s) => {
      const removed = s.backends[idx];
      const newBackends = s.backends.filter((_, i) => i !== idx);
      // Clear pipeline steps referencing this backend
      const newSteps = s.pipeline.steps.map((step) =>
        step.backendId === removed.id ? { ...step, backendId: "" } : step
      );
      return { ...s, backends: newBackends, pipeline: { steps: newSteps } };
    });
  };

  const updatePipelineStep = (idx: number, patch: Partial<PipelineStep>) => {
    setSettings((s) => ({
      ...s,
      pipeline: {
        steps: s.pipeline.steps.map((step, i) => i === idx ? { ...step, ...patch } : step),
      },
    }));
  };

  return (
    <div className="settings-panel">
      {feedback && <div className={`feedback ${feedback.type}`}>{feedback.msg}</div>}
      <form onSubmit={handleSubmit}>
        <fieldset>
          <legend>General</legend>
          <label htmlFor="appName">App name</label>
          <input id="appName" type="text" value={settings.general.appName}
            onChange={(e) => setSettings({ ...settings, general: { ...settings.general, appName: e.target.value } })} />
        </fieldset>

        <fieldset>
          <legend>LLM (legacy)</legend>
          <label htmlFor="provider">Provider</label>
          <select id="provider" value={settings.llm.provider}
            onChange={(e) => setSettings({ ...settings, llm: { ...settings.llm, provider: e.target.value as "anthropic" | "openai" } })}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>

          <label htmlFor="apiKey">API Key</label>
          <input id="apiKey" type="password" value={settings.llm.apiKey} placeholder="sk-..."
            onChange={(e) => setSettings({ ...settings, llm: { ...settings.llm, apiKey: e.target.value } })} />

          <label htmlFor="model">Model</label>
          <input id="model" type="text" value={settings.llm.model}
            onChange={(e) => setSettings({ ...settings, llm: { ...settings.llm, model: e.target.value } })} />

          <label htmlFor="temperature">Temperature: <strong>{settings.llm.temperature}</strong></label>
          <input id="temperature" type="range" min="0" max="2" step="0.1" value={settings.llm.temperature}
            onChange={(e) => setSettings({ ...settings, llm: { ...settings.llm, temperature: Number(e.target.value) } })} />
        </fieldset>

        <fieldset>
          <legend>Backends</legend>
          <p className="hint">Configure LLM backends (KoboldCpp or OpenAI-compatible). At least one backend is needed for the LLM pipeline.</p>
          {settings.backends.map((backend, idx) => (
            <div key={backend.id} className="backend-config">
              <div className="backend-config-header">
                <strong>{backend.name || backend.id}</strong>
                <button type="button" className="btn-sm btn-danger" onClick={() => removeBackend(idx)}>Remove</button>
              </div>
              <label>ID</label>
              <input type="text" value={backend.id} readOnly className="hint" />
              <label>Name</label>
              <input type="text" value={backend.name} placeholder="e.g. Local Kobold"
                onChange={(e) => updateBackend(idx, { name: e.target.value })} />
              <label>Type</label>
              <select value={backend.type}
                onChange={(e) => updateBackend(idx, { type: e.target.value as BackendType })}>
                <option value="openai">OpenAI-compatible</option>
                <option value="koboldcpp">KoboldCpp</option>
              </select>
              <label>URL</label>
              <input type="text" value={backend.url} placeholder="http://localhost:5001"
                onChange={(e) => updateBackend(idx, { url: e.target.value })} />
              <label>API Key</label>
              <input type="password" value={backend.apiKey} placeholder="(empty for local)"
                onChange={(e) => updateBackend(idx, { apiKey: e.target.value })} />
              {backend.type === "openai" && (
                <>
                  <label>Model</label>
                  <input type="text" value={backend.model} placeholder="gpt-4o"
                    onChange={(e) => updateBackend(idx, { model: e.target.value })} />
                </>
              )}
              <label className="entry-checkbox-label">
                <input type="checkbox" checked={backend.streaming}
                  onChange={(e) => updateBackend(idx, { streaming: e.target.checked })} />
                Enable streaming
              </label>
              <label>Max concurrent slots</label>
              <input type="number" min="1" max="10" value={backend.maxConcurrent}
                onChange={(e) => updateBackend(idx, { maxConcurrent: Number(e.target.value) || 1 })} />
            </div>
          ))}
          <button type="button" className="btn-sm" onClick={addBackend}>+ Add Backend</button>
        </fieldset>

        <fieldset>
          <legend>Pipeline</legend>
          <p className="hint">Configure which backend handles each pipeline step. Leave backend empty to skip a step.</p>
          {settings.pipeline.steps.map((step, idx) => (
            <div key={step.role} className="pipeline-step">
              <label className="pipeline-step-role">{step.role}</label>
              <select value={step.backendId}
                onChange={(e) => updatePipelineStep(idx, { backendId: e.target.value })}>
                <option value="">-- None --</option>
                {settings.backends.map((b) => (
                  <option key={b.id} value={b.id}>{b.name || b.id}</option>
                ))}
              </select>
              <label className="entry-checkbox-label">
                <input type="checkbox" checked={step.enabled}
                  onChange={(e) => updatePipelineStep(idx, { enabled: e.target.checked })} />
                Enabled
              </label>
            </div>
          ))}
        </fieldset>

        <button type="submit">Save settings</button>
      </form>
    </div>
  );
}
