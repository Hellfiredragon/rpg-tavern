import { useEffect, useState } from 'react'
import './AppSettings.css'

interface LLMConnection {
  name: string
  provider_url: string
  api_key: string
}

interface StoryRoles {
  narrator: string
  character_writer: string
  extractor: string
}

interface Settings {
  llm_connections: LLMConnection[]
  story_roles: StoryRoles
  app_width_percent: number
  help_panel_width_percent: number
}

interface AppSettingsProps {
  onWidthChange: (percent: number) => void
}

function newConnection(): LLMConnection {
  return { name: '', provider_url: '', api_key: '' }
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

  function patchConnections(connections: LLMConnection[]) {
    setSettings(prev => prev ? { ...prev, llm_connections: connections } : prev)
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ llm_connections: connections }),
    })
  }

  function patchRole(role: keyof StoryRoles, value: string) {
    setSettings(prev => prev ? { ...prev, story_roles: { ...prev.story_roles, [role]: value } } : prev)
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ story_roles: { [role]: value } }),
    })
  }

  function patchWidth(value: number) {
    setSettings(prev => prev ? { ...prev, app_width_percent: value } : prev)
    onWidthChange(value)
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_width_percent: value }),
    })
  }

  function updateConnection(index: number, field: keyof LLMConnection, value: string) {
    if (!settings) return
    const updated = settings.llm_connections.map((c, i) =>
      i === index ? { ...c, [field]: value } : c
    )
    // If renaming a connection, update any roles that referenced the old name
    if (field === 'name') {
      const oldName = settings.llm_connections[index].name
      if (oldName) {
        const roles = { ...settings.story_roles }
        let rolesChanged = false
        for (const key of Object.keys(roles) as (keyof StoryRoles)[]) {
          if (roles[key] === oldName) {
            roles[key] = value
            rolesChanged = true
          }
        }
        if (rolesChanged) {
          setSettings(prev => prev ? { ...prev, llm_connections: updated, story_roles: roles } : prev)
          fetch('/api/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ llm_connections: updated, story_roles: roles }),
          })
          return
        }
      }
    }
    patchConnections(updated)
  }

  function addConnection() {
    if (!settings) return
    patchConnections([...settings.llm_connections, newConnection()])
  }

  function removeConnection(index: number) {
    if (!settings) return
    const removedName = settings.llm_connections[index].name
    const updated = settings.llm_connections.filter((_, i) => i !== index)
    // Clear any roles referencing the removed connection
    const roles = { ...settings.story_roles }
    let rolesChanged = false
    for (const key of Object.keys(roles) as (keyof StoryRoles)[]) {
      if (roles[key] === removedName && removedName) {
        roles[key] = ''
        rolesChanged = true
      }
    }
    if (rolesChanged) {
      setSettings(prev => prev ? { ...prev, llm_connections: updated, story_roles: roles } : prev)
      fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm_connections: updated, story_roles: roles }),
      })
    } else {
      patchConnections(updated)
    }
  }

  if (!settings) return <p className="loading-text">Loading...</p>

  const connectionNames = settings.llm_connections.map(c => c.name).filter(Boolean)

  function roleSelect(label: string, role: keyof StoryRoles) {
    return (
      <div className="settings-field">
        <label>{label}</label>
        <select value={settings!.story_roles[role]} onChange={e => patchRole(role, e.target.value)}>
          <option value="">Which LLM connection to assign?</option>
          {connectionNames.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div className="settings-page">
      <h2>Settings</h2>

      <div className="settings-section">
        <h3>LLM Connections</h3>
        {settings.llm_connections.map((conn, i) => (
          <div key={i} className="connection-card">
            <div className="connection-header">
              <input
                className="connection-name"
                type="text"
                value={conn.name}
                onChange={e => updateConnection(i, 'name', e.target.value)}
                placeholder="Connection name"
              />
              <button className="btn-icon btn-danger" onClick={() => removeConnection(i)} title="Remove connection">
                <i className="fa-solid fa-trash" />
              </button>
            </div>
            <div className="settings-field">
              <label>Provider URL</label>
              <input
                type="text"
                value={conn.provider_url}
                onChange={e => updateConnection(i, 'provider_url', e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div className="settings-field">
              <label>API Key</label>
              <input
                type="password"
                value={conn.api_key}
                onChange={e => updateConnection(i, 'api_key', e.target.value)}
                placeholder="sk-..."
              />
            </div>
          </div>
        ))}
        <button className="btn-add" onClick={addConnection}>
          <i className="fa-solid fa-plus" /> Add Connection
        </button>
      </div>

      <hr className="divider" />

      <div className="settings-section">
        <h3>Story Roles</h3>
        {roleSelect('Narrator', 'narrator')}
        {roleSelect('Character Writer', 'character_writer')}
        {roleSelect('Extractor', 'extractor')}
      </div>

      <hr className="divider" />

      <div className="settings-section">
        <h3>UI Settings</h3>
        <div className="settings-field">
          <label>App Width (%)</label>
          <input
            type="number"
            min={50}
            max={100}
            value={settings.app_width_percent}
            onChange={e => {
              const v = Math.max(50, Math.min(100, Number(e.target.value)))
              patchWidth(v)
            }}
          />
        </div>
        <div className="settings-field">
          <label>Help Panel Width (%)</label>
          <input
            type="number"
            min={15}
            max={50}
            value={settings.help_panel_width_percent}
            onChange={e => {
              const v = Math.max(15, Math.min(50, Number(e.target.value)))
              setSettings(prev => prev ? { ...prev, help_panel_width_percent: v } : prev)
              fetch('/api/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ help_panel_width_percent: v }),
              })
            }}
          />
        </div>
      </div>
    </div>
  )
}
