import { useState, useEffect } from "react";
import * as api from "../api";
import type { Settings } from "../types";

const defaults: Settings = {
  general: { appName: "RPG Tavern" },
  llm: { provider: "anthropic", apiKey: "", model: "claude-sonnet-4-20250514", temperature: 0.7 },
};

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    api.fetchSettings().then(setSettings).catch(() => {});
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
          <legend>LLM</legend>
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

        <button type="submit">Save settings</button>
      </form>
    </div>
  );
}
