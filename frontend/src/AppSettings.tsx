import { useEffect, useState } from 'react'
import './AppSettings.css'

interface Settings {
  llm_provider_url: string
  llm_api_key: string
  llm_model: string
  llm_completion_mode: string
  app_width_percent: number
}

interface AppSettingsProps {
  onWidthChange: (percent: number) => void
}

export default function AppSettings({ onWidthChange }: AppSettingsProps) {
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then((data: Settings) => {
        setSettings(data)
        onWidthChange(data.app_width_percent)
      })
  }, [onWidthChange])

  function patch(field: string, value: string | number) {
    setSettings(prev => prev ? { ...prev, [field]: value } : prev)
    if (field === 'app_width_percent') onWidthChange(value as number)
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
  }

  if (!settings) return <p className="loading-text">Loading...</p>

  return (
    <div className="settings-page">
      <h2>Settings</h2>

      <div className="settings-section">
        <h3>LLM Connection</h3>
        <div className="settings-field">
          <label>Provider URL</label>
          <input
            type="text"
            value={settings.llm_provider_url}
            onChange={e => patch('llm_provider_url', e.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </div>
        <div className="settings-field">
          <label>API Key</label>
          <input
            type="password"
            value={settings.llm_api_key}
            onChange={e => patch('llm_api_key', e.target.value)}
            placeholder="sk-..."
          />
        </div>
        <div className="settings-field">
          <label>Model</label>
          <input
            type="text"
            value={settings.llm_model}
            onChange={e => patch('llm_model', e.target.value)}
            placeholder="gpt-4o"
          />
        </div>
        <div className="settings-field">
          <label>Completion Mode</label>
          <select
            value={settings.llm_completion_mode}
            onChange={e => patch('llm_completion_mode', e.target.value)}
          >
            <option value="chat">Chat</option>
            <option value="text">Text</option>
          </select>
        </div>
      </div>

      <hr className="divider" />

      <div className="settings-section">
        <h3>Display</h3>
        <div className="settings-field">
          <label>App Width (%)</label>
          <input
            type="number"
            min={50}
            max={100}
            value={settings.app_width_percent}
            onChange={e => {
              const v = Math.max(50, Math.min(100, Number(e.target.value)))
              patch('app_width_percent', v)
            }}
          />
        </div>
      </div>
    </div>
  )
}
