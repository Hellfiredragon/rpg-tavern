import { useEffect, useRef, useState } from 'react'
import { FONT_LIST, FONT_GROUPS, FONT_GROUP_LABELS, applyFontSettings, type FontSettings, type FontGroupSettings, type FontGroup } from './fontSettings'
import './AppSettings.css'

interface LLMConnection {
  name: string
  provider_url: string
  api_key: string
}

interface StoryRoles {
  narrator: string
  character_intention: string
  extractor: string
}

interface Settings {
  llm_connections: LLMConnection[]
  story_roles: StoryRoles
  app_width_percent: number
  help_panel_width_percent: number
  font_settings: FontSettings
}

interface AppSettingsProps {
  onWidthChange: (percent: number) => void
}

function newConnection(): LLMConnection {
  return { name: '', provider_url: '', api_key: '' }
}

const PREVIEW_SAMPLES: Record<FontGroup, { className: string; content: React.ReactNode }> = {
  narration: {
    className: 'font-preview-narration',
    content: 'The tavern door creaks open, letting in a gust of cold mountain air.',
  },
  dialog: {
    className: 'font-preview-dialog',
    content: <>
      <span className="font-preview-dialog-name">Elena</span>
      <span className="font-preview-dialog-emotion">(whispered)</span>
      {' The dragon stirs at dusk.'}
    </>,
  },
  intention: {
    className: 'font-preview-intention',
    content: <>
      <span className="font-preview-intention-label">Gareth:</span>
      {' I want to inspect the old mine entrance.'}
    </>,
  },
  heading: {
    className: 'font-preview-heading',
    content: "Dragon's Hollow",
  },
  ui: {
    className: 'font-preview-ui',
    content: 'Quest Board — 3 adventures available',
  },
}

function fontStyle(g: FontGroupSettings): React.CSSProperties {
  const font = FONT_LIST.find(f => f.name === g.family)
  const fallback = font ? ({ serif: 'Georgia, serif', 'sans-serif': 'system-ui, sans-serif', monospace: 'monospace', display: 'Georgia, serif' }[font.category] ?? 'Georgia, serif') : 'Georgia, serif'
  return { fontFamily: `'${g.family}', ${fallback}`, fontSize: `${g.size}px`, fontStyle: g.style }
}

function FontPreview({ fontSettings }: { fontSettings: FontSettings }) {
  return (
    <div className="font-preview">
      <div className="font-preview-label">Preview</div>
      <div className="font-preview-scene">
        {FONT_GROUPS.map(group => {
          const sample = PREVIEW_SAMPLES[group]
          return (
            <div key={group} className={`font-preview-line ${sample.className}`} style={fontStyle(fontSettings[group])}>
              {sample.content}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function AppSettings({ onWidthChange }: AppSettingsProps) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const initialUiRef = useRef<{ app_width_percent: number; help_panel_width_percent: number } | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then((data: Settings) => {
        setSettings(data)
        initialUiRef.current = {
          app_width_percent: data.app_width_percent,
          help_panel_width_percent: data.help_panel_width_percent,
        }
        onWidthChange(data.app_width_percent)
        if (data.font_settings) applyFontSettings(data.font_settings)
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

  function patchUi(field: 'app_width_percent' | 'help_panel_width_percent', value: number) {
    setSettings(prev => prev ? { ...prev, [field]: value } : prev)
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
  }

  function patchFontGroup(group: string, updates: Partial<FontGroupSettings>) {
    setSettings(prev => {
      if (!prev) return prev
      const newFs = { ...prev.font_settings, [group]: { ...prev.font_settings[group as keyof FontSettings], ...updates } }
      applyFontSettings(newFs)
      fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ font_settings: { [group]: updates } }),
      })
      return { ...prev, font_settings: newFs }
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

  const uiDirty = initialUiRef.current != null && (
    settings.app_width_percent !== initialUiRef.current.app_width_percent ||
    settings.help_panel_width_percent !== initialUiRef.current.help_panel_width_percent
  )

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
        <h3 className="panel-heading">LLM Connections</h3>
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
        <h3 className="panel-heading">Story Roles</h3>
        {roleSelect('Narrator', 'narrator')}
        {roleSelect('Character Intention', 'character_intention')}
        {roleSelect('Extractor', 'extractor')}
      </div>

      <hr className="divider" />

      <div className="settings-section">
        <h3 className="panel-heading">UI Settings</h3>
        <p className="settings-hint">Changes are saved immediately but take effect after reload.</p>
        <div className="settings-field">
          <label>App Width — {settings.app_width_percent}%</label>
          <input
            type="range"
            min={50}
            max={100}
            step={5}
            value={settings.app_width_percent}
            onChange={e => patchUi('app_width_percent', Number(e.target.value))}
          />
        </div>
        <div className="settings-field">
          <label>Help Panel Width — {settings.help_panel_width_percent}%</label>
          <input
            type="range"
            min={15}
            max={50}
            step={5}
            value={settings.help_panel_width_percent}
            onChange={e => patchUi('help_panel_width_percent', Number(e.target.value))}
          />
        </div>
        {uiDirty && (
          <div className="settings-apply-bar">
            <span className="settings-apply-hint">
              <i className="fa-solid fa-circle-info" /> UI settings changed — reload to apply
            </span>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              <i className="fa-solid fa-rotate-right" /> Apply
            </button>
          </div>
        )}
      </div>

      <hr className="divider" />

      <div className="settings-section">
        <h3 className="panel-heading">Font Settings</h3>
        <div className="font-settings-layout">
          <div className="font-settings-grid">
            {FONT_GROUPS.map(group => {
              const g = settings.font_settings[group]
              return (
                <div key={group} className="font-group-row">
                  <span className="font-group-label">{FONT_GROUP_LABELS[group]}</span>
                  <select
                    className="font-group-family"
                    value={g.family}
                    onChange={e => patchFontGroup(group, { family: e.target.value })}
                  >
                    {FONT_LIST.map(f => (
                      <option key={f.name} value={f.name}>{f.name}</option>
                    ))}
                  </select>
                  <div className="font-group-size">
                    <input
                      type="number"
                      min={10}
                      max={32}
                      value={g.size}
                      onChange={e => patchFontGroup(group, { size: Number(e.target.value) })}
                    />
                    <span className="font-size-unit">px</span>
                  </div>
                  <button
                    className={`font-style-toggle ${g.style === 'italic' ? 'font-style-toggle--active' : ''}`}
                    onClick={() => patchFontGroup(group, { style: g.style === 'italic' ? 'normal' : 'italic' })}
                    title={g.style === 'italic' ? 'Switch to normal' : 'Switch to italic'}
                  >
                    <i className="fa-solid fa-italic" />
                  </button>
                </div>
              )
            })}
          </div>
          <FontPreview fontSettings={settings.font_settings} />
        </div>
      </div>
    </div>
  )
}
