import { useCallback, useEffect, useRef, useState } from 'react'
import AppSettings from './AppSettings'
import { type ChatMessage, type Persona, type StoryRoles, type StoryRoleConfig, type RoleName, ROLE_NAMES } from './types'
import CharacterPanel from './components/CharacterPanel'
import LorebookPanel from './components/LorebookPanel'
import PersonaPanel from './components/PersonaPanel'
import PromptHintsPanel from './components/PromptHintsPanel'
import StatusTabs from './components/StatusTabs'
import StoryRoleCard from './components/StoryRoleCard'
import TemplateSettingsPanel from './components/TemplateSettingsPanel'
import './AdventureView.css'

interface AdventureViewProps {
  slug: string
  kind: 'template' | 'adventure'
  initialTab?: string
  onTabChange: (tab: string) => void
  onWidthChange: (percent: number) => void
}

interface ItemData {
  title: string
  slug: string
  description: string
  intro?: string
  player_name?: string
  active_persona?: string
}

type Tab = 'chat' | 'personas' | 'characters' | 'world' | 'settings' | 'global-settings' | 'global-personas'

const VALID_TABS: Tab[] = ['chat', 'personas', 'characters', 'world', 'settings', 'global-settings', 'global-personas']

export default function AdventureView({ slug, kind, initialTab, onTabChange, onWidthChange }: AdventureViewProps) {
  const [data, setData] = useState<ItemData | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>(
    VALID_TABS.includes(initialTab as Tab) ? initialTab as Tab : 'chat'
  )
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [storyRoles, setStoryRoles] = useState<StoryRoles | null>(null)
  const [personas, setPersonas] = useState<Persona[]>([])
  const [activePersona, setActivePersona] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const apiBase = kind === 'template' ? '/api/templates' : '/api/adventures'
    fetch(`${apiBase}/${slug}`)
      .then(res => res.json())
      .then(d => {
        setData(d)
        if (d.active_persona) setActivePersona(d.active_persona)
      })
  }, [slug, kind])

  useEffect(() => {
    if (kind !== 'adventure') return
    fetch(`/api/adventures/${slug}/messages`)
      .then(res => res.ok ? res.json() : [])
      .then(setMessages)
  }, [slug, kind])

  useEffect(() => {
    if (kind !== 'adventure') return
    fetch(`/api/adventures/${slug}/story-roles`)
      .then(res => res.ok ? res.json() : null)
      .then(setStoryRoles)
  }, [slug, kind])

  useEffect(() => {
    if (kind !== 'adventure') return
    fetch(`/api/adventures/${slug}/personas`)
      .then(res => res.ok ? res.json() : [])
      .then(setPersonas)
  }, [slug, kind])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const patchStoryRole = useCallback((role: RoleName, fields: Partial<StoryRoleConfig>) => {
    setStoryRoles(prev => {
      if (!prev) return prev
      return { ...prev, [role]: { ...prev[role], ...fields } }
    })
    fetch(`/api/adventures/${slug}/story-roles`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [role]: fields }),
    })
  }, [slug])

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setError('')
    setMessages(prev => [...prev, { role: 'player', text, ts: new Date().toISOString() }])
    setLoading(true)

    try {
      const res = await fetch(`/api/adventures/${slug}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Request failed' }))
        throw new Error(err.detail || `Error ${res.status}`)
      }
      const data = await res.json()
      setMessages(prev => [...prev.slice(0, -1), ...data.messages])
    } catch (e) {
      setMessages(prev => prev.slice(0, -1))
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  function handlePersonaChange(pslug: string) {
    setActivePersona(pslug)
    fetch(`/api/adventures/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active_persona: pslug }),
    })
  }

  if (!data) {
    return <p className="loading-text">Loading...</p>
  }

  function switchTab(tab: Tab) {
    setActiveTab(tab)
    onTabChange(tab)
  }

  const isTemplate = kind === 'template'
  const chatLabel = isTemplate ? 'Test' : 'Adventure'

  const leftTabs: { key: Tab; label: string; icon?: string }[] = [
    { key: 'chat', label: chatLabel },
    ...(!isTemplate ? [{ key: 'personas' as Tab, label: 'Personas' }] : []),
    ...(!isTemplate ? [{ key: 'characters' as Tab, label: 'Characters' }] : []),
    { key: 'world', label: 'World' },
    { key: 'settings', label: 'Settings' },
  ]

  const rightTabs: { key: Tab; label: string; icon?: string }[] = [
    { key: 'global-settings', label: 'Settings', icon: 'fa-solid fa-gear' },
    { key: 'global-personas', label: 'Personas', icon: 'fa-solid fa-user' },
  ]

  return (
    <div className="adventure-view">
      <nav className="tab-bar">
        <div className="tab-group tab-group--left">
          {leftTabs.map(tab => (
            <button
              key={tab.key}
              className={`tab-btn ${activeTab === tab.key ? 'tab-btn--active' : ''}`}
              onClick={() => switchTab(tab.key)}
            >
              {tab.icon && <i className={tab.icon} />}
              {tab.label}
            </button>
          ))}
        </div>
        <div className="tab-group tab-group--right">
          {rightTabs.map(tab => (
            <button
              key={tab.key}
              className={`tab-btn ${activeTab === tab.key ? 'tab-btn--active' : ''}`}
              onClick={() => switchTab(tab.key)}
            >
              {tab.icon && <i className={tab.icon} />}
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="tab-content">
        {activeTab === 'chat' && (
          <div className="chat-container">
            <div className="chat-messages">
              {messages.length === 0 && !loading && (
                <p className="chat-empty">Describe what your character does to begin.</p>
              )}
              {messages.map((msg, i) => {
                if (msg.role === 'player') {
                  return (
                    <div key={i} className="chat-msg chat-msg--player">
                      {msg.text}
                    </div>
                  )
                }
                if (msg.role === 'intention') {
                  const isSandbox = storyRoles?.sandbox
                  if (!isSandbox) return null
                  return (
                    <div key={i} className="chat-msg chat-msg--intention">
                      <span className="intention-label">{msg.character}</span>
                      <span className="intention-text">{msg.text}</span>
                    </div>
                  )
                }
                if (msg.segments && msg.segments.length > 0) {
                  return (
                    <div key={i} className="chat-msg chat-msg--narrator">
                      {msg.segments.map((seg, si) => {
                        if (seg.type === 'dialog') {
                          return (
                            <div key={si} className="dialog-card">
                              <span className="dialog-character">{seg.character}</span>
                              {seg.emotion && <span className="dialog-emotion">{seg.emotion}</span>}
                              <span className="dialog-text">{seg.text}</span>
                            </div>
                          )
                        }
                        return <p key={si} className="narration-text">{seg.text}</p>
                      })}
                    </div>
                  )
                }
                return (
                  <div key={i} className="chat-msg chat-msg--narrator">
                    {msg.text}
                  </div>
                )
              })}
              {loading && (
                <div className="chat-msg chat-msg--narrator chat-msg--loading">
                  <i className="fa-solid fa-ellipsis fa-fade" />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            {error && <p className="chat-error">{error}</p>}
            <form className="chat-input-bar" onSubmit={e => { e.preventDefault(); sendMessage() }}>
              {kind === 'adventure' && personas.length > 0 && (
                <select
                  className="persona-selector"
                  value={activePersona}
                  onChange={e => handlePersonaChange(e.target.value)}
                  disabled={loading}
                >
                  <option value="">No persona</option>
                  {personas.map(p => (
                    <option key={p.slug} value={p.slug}>
                      {p.name} ({p.source})
                    </option>
                  ))}
                </select>
              )}
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="What do you do?"
                disabled={loading}
              />
              <button type="submit" disabled={loading || !input.trim()}>
                <i className="fa-solid fa-paper-plane" />
              </button>
            </form>
          </div>
        )}
        {activeTab === 'personas' && kind === 'adventure' && (
          <PersonaPanel adventureSlug={slug} />
        )}
        {activeTab === 'characters' && kind === 'adventure' && (
          <CharacterPanel slug={slug} />
        )}
        {activeTab === 'world' && kind === 'adventure' && (
          <div>
            <LorebookPanel slug={slug} />
          </div>
        )}
        {activeTab === 'world' && isTemplate && (
          <div className="tab-placeholder">
            <p>World settings for templates are not yet available.</p>
          </div>
        )}
        {activeTab === 'settings' && kind === 'adventure' && storyRoles && (
          <div className="story-roles-settings">
            <h3 className="panel-heading">Pipeline Settings</h3>
            <div className="pipeline-controls">
              <label className="pipeline-control">
                <span>Max Rounds</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={storyRoles.max_rounds}
                  onChange={e => {
                    const v = parseInt(e.target.value) || 3
                    setStoryRoles(prev => prev ? { ...prev, max_rounds: v } : prev)
                    fetch(`/api/adventures/${slug}/story-roles`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ max_rounds: v }),
                    })
                  }}
                />
              </label>
              <label className="pipeline-control pipeline-control--toggle">
                <span>Sandbox Mode</span>
                <input
                  type="checkbox"
                  checked={storyRoles.sandbox}
                  onChange={e => {
                    const v = e.target.checked
                    setStoryRoles(prev => prev ? { ...prev, sandbox: v } : prev)
                    fetch(`/api/adventures/${slug}/story-roles`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ sandbox: v }),
                    })
                  }}
                />
                <span className="pipeline-hint">Show character intentions in chat</span>
              </label>
            </div>
            <h3 className="panel-heading">Story Roles</h3>
            {ROLE_NAMES.map(role => (
              <StoryRoleCard
                key={role}
                role={role}
                config={storyRoles[role]}
                onPromptChange={prompt => patchStoryRole(role, { prompt })}
              />
            ))}
          </div>
        )}
        {activeTab === 'settings' && isTemplate && (
          <TemplateSettingsPanel slug={slug} data={data} setData={setData} />
        )}
        {activeTab === 'global-settings' && (
          <AppSettings onWidthChange={onWidthChange} />
        )}
        {activeTab === 'global-personas' && (
          <PersonaPanel />
        )}
      </div>

      {kind === 'adventure' && storyRoles && (
        <PromptHintsPanel />
      )}
      {kind === 'adventure' && (
        <StatusTabs loading={loading} />
      )}
    </div>
  )
}
