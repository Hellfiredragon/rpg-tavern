import { useCallback, useEffect, useRef, useState } from 'react'
import './AdventureView.css'

interface AdventureViewProps {
  slug: string
  kind: 'template' | 'adventure'
}

interface ItemData {
  title: string
  slug: string
  description: string
}

interface ChatMessage {
  role: 'player' | 'narrator' | 'character_writer' | 'extractor'
  text: string
  ts: string
}

type Tab = 'chat' | 'world' | 'settings'

type WhenTrigger = 'on_player_message' | 'after_narration' | 'disabled'

interface StoryRoleConfig {
  when: WhenTrigger
  where: string
  prompt: string
}

interface StoryRoles {
  narrator: StoryRoleConfig
  character_writer: StoryRoleConfig
  extractor: StoryRoleConfig
}

type RoleName = keyof StoryRoles

const ROLE_LABELS: Record<RoleName, string> = {
  narrator: 'Narrator',
  character_writer: 'Character Writer',
  extractor: 'Extractor',
}

const WHEN_OPTIONS: { value: WhenTrigger; label: string }[] = [
  { value: 'on_player_message', label: 'On player message' },
  { value: 'after_narration', label: 'After narration' },
  { value: 'disabled', label: 'Disabled' },
]

interface TemplateVar {
  name: string
  type: string
  desc: string
  afterOnly?: boolean
}

const TEMPLATE_VARS: TemplateVar[] = [
  { name: 'description', type: 'string', desc: 'Adventure premise' },
  { name: 'title', type: 'string', desc: 'Adventure title' },
  { name: 'message', type: 'string', desc: 'Current player message' },
  { name: 'history', type: 'string', desc: 'Pre-formatted history' },
  { name: 'messages', type: 'array', desc: 'Message objects for {{#each}}' },
  { name: 'narration', type: 'string', desc: 'Narrator response (current turn)', afterOnly: true },
]

const MESSAGE_FIELDS: { name: string; desc: string }[] = [
  { name: '.role', desc: '"player" or "narrator"' },
  { name: '.text', desc: 'Content' },
  { name: '.ts', desc: 'ISO timestamp' },
  { name: '.is_player', desc: 'Boolean flag' },
  { name: '.is_narrator', desc: 'Boolean flag' },
]

function PromptHintsSidebar({ showAfterNarration }: { showAfterNarration: boolean }) {
  return (
    <aside className="prompt-hints">
      <h4>Template Variables</h4>
      <p className="hint-intro">Use Handlebars syntax in prompt templates.</p>
      <dl className="hint-vars">
        {TEMPLATE_VARS.map(v => (
          <div key={v.name} className={`hint-var ${v.afterOnly && !showAfterNarration ? 'hint-var--dim' : ''}`}>
            <dt>
              <code>{'{{' + v.name + '}}'}</code>
              <span className="hint-type">{v.type}</span>
            </dt>
            <dd>
              {v.desc}
              {v.afterOnly && <span className="hint-badge">after_narration only</span>}
            </dd>
          </div>
        ))}
      </dl>

      <h4>Message Fields</h4>
      <p className="hint-intro">Inside <code>{'{{#each messages}}'}</code>:</p>
      <dl className="hint-vars">
        {MESSAGE_FIELDS.map(f => (
          <div key={f.name} className="hint-var">
            <dt><code>{f.name}</code></dt>
            <dd>{f.desc}</dd>
          </div>
        ))}
      </dl>

      <h4>Examples</h4>
      <pre className="hint-example">{'{{#each messages}}\n{{#if is_player}}> {{text}}{{else}}{{text}}{{/if}}\n{{/each}}'}</pre>
    </aside>
  )
}

function StoryRoleCard({
  role,
  config,
  onTriggerChange,
  onPromptChange,
}: {
  role: RoleName
  config: StoryRoleConfig
  onTriggerChange: (when: WhenTrigger) => void
  onPromptChange: (prompt: string) => void
}) {
  const [promptValue, setPromptValue] = useState(config.prompt)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    setPromptValue(config.prompt)
  }, [config.prompt])

  function handlePromptChange(value: string) {
    setPromptValue(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onPromptChange(value), 500)
  }

  return (
    <div className="story-role-card">
      <div className="story-role-header">
        <h4>{ROLE_LABELS[role]}</h4>
        <select
          value={config.when}
          onChange={e => onTriggerChange(e.target.value as WhenTrigger)}
        >
          {WHEN_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      {config.when !== 'disabled' && (
        <textarea
          className="prompt-editor"
          value={promptValue}
          onChange={e => handlePromptChange(e.target.value)}
          placeholder="Handlebars prompt template..."
          rows={8}
        />
      )}
    </div>
  )
}

export default function AdventureView({ slug, kind }: AdventureViewProps) {
  const [data, setData] = useState<ItemData | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [storyRoles, setStoryRoles] = useState<StoryRoles | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const apiBase = kind === 'template' ? '/api/templates' : '/api/adventures'
    fetch(`${apiBase}/${slug}`)
      .then(res => res.json())
      .then(setData)
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
      // Replace optimistic player msg + add all response msgs with server timestamps
      setMessages(prev => [...prev.slice(0, -1), ...data.messages])
    } catch (e) {
      // Remove optimistic player message on error
      setMessages(prev => prev.slice(0, -1))
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (!data) {
    return <p className="loading-text">Loading...</p>
  }

  const isTemplate = kind === 'template'
  const chatLabel = isTemplate ? 'Test' : 'Chat'

  const tabs: { key: Tab; label: string }[] = [
    { key: 'chat', label: chatLabel },
    { key: 'world', label: 'World' },
    { key: 'settings', label: 'Settings' },
  ]

  return (
    <div className="adventure-view">
      <nav className="tab-bar">
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`tab-btn ${activeTab === tab.key ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="tab-content">
        {activeTab === 'chat' && (
          <div className="chat-container">
            <div className="chat-messages">
              {messages.length === 0 && !loading && (
                <p className="chat-empty">Describe what your character does to begin.</p>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`chat-msg chat-msg--${msg.role}`}>
                  {msg.text}
                </div>
              ))}
              {loading && (
                <div className="chat-msg chat-msg--narrator chat-msg--loading">
                  <i className="fa-solid fa-ellipsis fa-fade" />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            {error && <p className="chat-error">{error}</p>}
            <form className="chat-input-bar" onSubmit={e => { e.preventDefault(); sendMessage() }}>
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
        {activeTab === 'world' && (
          <div className="tab-placeholder">
            <p>World settings for <strong>{data.title}</strong>. (Coming soon)</p>
          </div>
        )}
        {activeTab === 'settings' && kind === 'adventure' && storyRoles && (
          <div className="settings-layout">
            <PromptHintsSidebar
              showAfterNarration={Object.values(storyRoles).some(r => r.when === 'after_narration')}
            />
            <div className="story-roles-settings">
              <h3>Story Roles</h3>
              {(Object.keys(ROLE_LABELS) as RoleName[]).map(role => (
                <StoryRoleCard
                  key={role}
                  role={role}
                  config={storyRoles[role]}
                  onTriggerChange={when => patchStoryRole(role, { when })}
                  onPromptChange={prompt => patchStoryRole(role, { prompt })}
                />
              ))}
            </div>
          </div>
        )}
        {activeTab === 'settings' && isTemplate && (
          <div className="tab-placeholder">
            <p>Template settings for <strong>{data.title}</strong>. (Coming soon)</p>
          </div>
        )}
      </div>
    </div>
  )
}
