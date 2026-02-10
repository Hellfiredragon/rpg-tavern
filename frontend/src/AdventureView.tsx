import { useCallback, useEffect, useRef, useState } from 'react'
import AppSettings from './AppSettings'
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
}

interface ChatMessage {
  role: 'player' | 'narrator' | 'character_writer' | 'extractor'
  text: string
  ts: string
}

type StateCategory = 'core' | 'persistent' | 'temporal'

interface CharacterState {
  label: string
  value: number
}

interface CharacterStates {
  core: CharacterState[]
  persistent: CharacterState[]
  temporal: CharacterState[]
}

interface Character {
  name: string
  slug: string
  states: CharacterStates
  overflow_pending: boolean
}

const CATEGORY_LIMITS: Record<StateCategory, number> = { core: 3, persistent: 10, temporal: 10 }
const CATEGORY_DEFAULTS: Record<StateCategory, number> = { core: 30, persistent: 20, temporal: 6 }

function stateLevel(value: number): string {
  if (value < 6) return 'silent'
  if (value <= 10) return 'urge'
  if (value <= 16) return 'driver'
  if (value <= 20) return 'important'
  return 'overflow'
}

type Tab = 'chat' | 'characters' | 'world' | 'settings' | 'global-settings'

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

const ROLE_ICONS: Record<RoleName, string> = {
  narrator: 'fa-solid fa-book-open',
  character_writer: 'fa-solid fa-feather',
  extractor: 'fa-solid fa-flask',
}

interface GlobalSettings {
  llm_connections: { name: string; provider_url: string; api_key: string }[]
  story_roles: Record<RoleName, string>
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
  { name: 'characters', type: 'array', desc: 'Character objects with .name, .descriptions' },
  { name: 'characters_summary', type: 'string', desc: 'Pre-formatted character states' },
]

const MESSAGE_FIELDS: { name: string; desc: string }[] = [
  { name: '.role', desc: '"player" or "narrator"' },
  { name: '.text', desc: 'Content' },
  { name: '.ts', desc: 'ISO timestamp' },
  { name: '.is_player', desc: 'Boolean flag' },
  { name: '.is_narrator', desc: 'Boolean flag' },
]

function PromptHintsPanel({ showAfterNarration }: { showAfterNarration: boolean }) {
  const [open, setOpen] = useState(false)
  const [widthPct, setWidthPct] = useState(25)

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.help_panel_width_percent) setWidthPct(data.help_panel_width_percent)
      })
  }, [])

  useEffect(() => {
    const el = document.documentElement
    if (open) {
      el.style.setProperty('--hint-panel-width', `${widthPct}%`)
      el.classList.add('hint-panel-open')
    } else {
      el.style.setProperty('--hint-panel-width', '0px')
      el.classList.remove('hint-panel-open')
    }
    return () => {
      el.style.setProperty('--hint-panel-width', '0px')
      el.classList.remove('hint-panel-open')
    }
  }, [open, widthPct])

  if (!open) {
    return (
      <div className="hint-panel">
        <button className="hint-panel-toggle" onClick={() => setOpen(true)} title="Template help">
          <span className="hint-panel-label">Help</span>
        </button>
      </div>
    )
  }

  return (
    <div className="hint-panel hint-panel--open" style={{ width: `${widthPct}%` }}>
      <div className="hint-panel-header">
        <h3>Template Help</h3>
        <button className="hint-panel-close" onClick={() => setOpen(false)} title="Close">
          <i className="fa-solid fa-xmark" />
        </button>
      </div>
      <div className="hint-panel-body">
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

        <h4>Block Helpers</h4>
        <dl className="hint-vars">
          <div className="hint-var">
            <dt><code>{'{{#take arr N}}...{{/take}}'}</code></dt>
            <dd>Iterate over the first N items of an array</dd>
          </div>
          <div className="hint-var">
            <dt><code>{'{{#last arr N}}...{{/last}}'}</code></dt>
            <dd>Iterate over the last N items of an array</dd>
          </div>
        </dl>
        <pre className="hint-example">{'{{#last messages 5}}\n{{#if is_player}}> {{text}}{{else}}{{text}}{{/if}}\n{{/last}}'}</pre>

        <h4>Examples</h4>
        <pre className="hint-example">{'{{#each messages}}\n{{#if is_player}}> {{text}}{{else}}{{text}}{{/if}}\n{{/each}}'}</pre>
        <pre className="hint-example">{'{{#take characters 3}}\n{{name}}: {{descriptions}}\n{{/take}}'}</pre>
      </div>
    </div>
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

type ConnectionStatus = 'unknown' | 'checking' | 'ok' | 'error'

function StatusTabs({
  storyRoles,
  loading,
}: {
  storyRoles: StoryRoles | null
  loading: boolean
}) {
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null)
  const [connStatus, setConnStatus] = useState<Record<string, ConnectionStatus>>({})
  const [openRole, setOpenRole] = useState<RoleName | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close status box when clicking outside
  useEffect(() => {
    if (!openRole) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenRole(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openRole])

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then((data: GlobalSettings) => setGlobalSettings(data))
  }, [])

  // Check connection health for each assigned role on mount and every 30s
  useEffect(() => {
    if (!globalSettings) return

    function checkAll() {
      if (!globalSettings) return
      const roles = Object.keys(ROLE_LABELS) as RoleName[]
      for (const role of roles) {
        const connName = globalSettings.story_roles[role]
        if (!connName) continue
        const conn = globalSettings.llm_connections.find(c => c.name === connName)
        if (!conn) continue

        setConnStatus(prev => ({ ...prev, [role]: 'checking' }))
        fetch('/api/check-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider_url: conn.provider_url, api_key: conn.api_key }),
        })
          .then(res => res.json())
          .then(data => {
            setConnStatus(prev => ({ ...prev, [role]: data.ok ? 'ok' : 'error' }))
          })
          .catch(() => {
            setConnStatus(prev => ({ ...prev, [role]: 'error' }))
          })
      }
    }

    checkAll()
    const interval = setInterval(checkAll, 30000)
    return () => clearInterval(interval)
  }, [globalSettings])

  if (!storyRoles || !globalSettings) return null

  const roles = Object.keys(ROLE_LABELS) as RoleName[]

  // Pipeline order: phase 1 (on_player_message) then phase 2 (after_narration),
  // each in narrator → character_writer → extractor order.
  const pipelineOrder: RoleName[] = []
  const roleOrder: RoleName[] = ['narrator', 'character_writer', 'extractor']
  for (const phase of ['on_player_message', 'after_narration'] as const) {
    for (const r of roleOrder) {
      if (storyRoles[r].when === phase) pipelineOrder.push(r)
    }
  }

  // During loading, only one role per connection executes at a time.
  // Walk the pipeline and mark the first pending role per connection as executing.
  const executingSet = new Set<RoleName>()
  const queuedSet = new Set<RoleName>()
  if (loading) {
    const busyConnections = new Set<string>()
    for (const r of pipelineOrder) {
      const connName = globalSettings.story_roles[r]
      if (!connName) continue
      if (busyConnections.has(connName)) {
        queuedSet.add(r)
      } else {
        executingSet.add(r)
        busyConnections.add(connName)
      }
    }
  }

  function getStatusForRole(role: RoleName): {
    enabled: boolean
    assigned: boolean
    connName: string
    status: ConnectionStatus
    executing: boolean
    queued: boolean
  } {
    const cfg = storyRoles![role]
    const enabled = cfg.when !== 'disabled'
    const connName = globalSettings!.story_roles[role] || ''
    const assigned = !!connName
    const status = connStatus[role] || 'unknown'
    const executing = executingSet.has(role)
    const queued = queuedSet.has(role)
    return { enabled, assigned, connName, status, executing, queued }
  }

  return (
    <div className="status-tabs" ref={containerRef}>
      {roles.map(role => {
        const info = getStatusForRole(role)
        const isOpen = openRole === role

        let dotClass = 'status-dot--off'
        if (info.executing) dotClass = 'status-dot--running'
        else if (info.queued) dotClass = 'status-dot--queued'
        else if (!info.enabled) dotClass = 'status-dot--off'
        else if (!info.assigned) dotClass = 'status-dot--unassigned'
        else if (info.status === 'ok') dotClass = 'status-dot--ok'
        else if (info.status === 'error') dotClass = 'status-dot--error'
        else if (info.status === 'checking') dotClass = 'status-dot--checking'
        else dotClass = 'status-dot--unknown'

        return (
          <div key={role} className="status-tab-group">
            <button
              className={`status-tab ${isOpen ? 'status-tab--open' : ''}`}
              onClick={() => setOpenRole(isOpen ? null : role)}
              title={ROLE_LABELS[role]}
            >
              <i className={`${ROLE_ICONS[role]} status-tab-icon`} />
              <span className={`status-dot ${dotClass}`} />
            </button>
            {isOpen && (
              <div className="status-box">
                <div className="status-box-header">
                  <i className={ROLE_ICONS[role]} />
                  <strong>{ROLE_LABELS[role]}</strong>
                </div>
                <dl className="status-box-fields">
                  <div className="status-field">
                    <dt>Trigger</dt>
                    <dd>{storyRoles![role].when === 'disabled' ? 'Disabled' : storyRoles![role].when.replace('_', ' ')}</dd>
                  </div>
                  <div className="status-field">
                    <dt>Connection</dt>
                    <dd>{info.connName || <span className="status-muted">not assigned</span>}</dd>
                  </div>
                  <div className="status-field">
                    <dt>Status</dt>
                    <dd>
                      {info.executing && <span className="status-badge status-badge--running"><i className="fa-solid fa-spinner fa-spin" /> Running</span>}
                      {info.queued && <span className="status-badge status-badge--queued">Queued</span>}
                      {!info.executing && !info.queued && !info.enabled && <span className="status-badge status-badge--off">Disabled</span>}
                      {!info.executing && !info.queued && info.enabled && !info.assigned && <span className="status-badge status-badge--unassigned">No connection</span>}
                      {!info.executing && !info.queued && info.enabled && info.assigned && info.status === 'ok' && <span className="status-badge status-badge--ok">Connected</span>}
                      {!info.executing && !info.queued && info.enabled && info.assigned && info.status === 'error' && <span className="status-badge status-badge--error">Unreachable</span>}
                      {!info.executing && !info.queued && info.enabled && info.assigned && info.status === 'checking' && <span className="status-badge status-badge--checking">Checking...</span>}
                      {!info.executing && !info.queued && info.enabled && info.assigned && info.status === 'unknown' && <span className="status-badge status-badge--checking">Pending</span>}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AddStateInput({ onAdd }: { onAdd: (label: string) => void }) {
  const [label, setLabel] = useState('')
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = label.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setLabel('')
  }
  return (
    <form className="add-state-row" onSubmit={handleSubmit}>
      <input
        type="text"
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="Add state..."
      />
      <button type="submit" disabled={!label.trim()}>
        <i className="fa-solid fa-plus" />
      </button>
    </form>
  )
}

function CharacterPanel({ slug }: { slug: string }) {
  const [characters, setCharacters] = useState<Character[]>([])
  const [newName, setNewName] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const debounceRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    fetch(`/api/adventures/${slug}/characters`)
      .then(res => res.ok ? res.json() : [])
      .then(setCharacters)
  }, [slug])

  async function addCharacter() {
    const name = newName.trim()
    if (!name) return
    const res = await fetch(`/api/adventures/${slug}/characters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (res.ok) {
      const char = await res.json()
      setCharacters(prev => [...prev, char])
      setNewName('')
    }
  }

  async function deleteCharacter(cslug: string) {
    const res = await fetch(`/api/adventures/${slug}/characters/${cslug}`, { method: 'DELETE' })
    if (res.ok) {
      setCharacters(prev => prev.filter(c => c.slug !== cslug))
      if (expanded === cslug) setExpanded(null)
    }
  }

  function patchStates(cslug: string, states: Partial<CharacterStates>) {
    fetch(`/api/adventures/${slug}/characters/${cslug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ states }),
    })
  }

  function removeState(char: Character, category: StateCategory, index: number) {
    const newList = char.states[category].filter((_, i) => i !== index)
    setCharacters(prev => prev.map(c => c.slug === char.slug ? { ...c, states: { ...c.states, [category]: newList } } : c))
    patchStates(char.slug, { [category]: newList })
  }

  function addState(char: Character, category: StateCategory, label: string) {
    const newList = [...char.states[category], { label, value: CATEGORY_DEFAULTS[category] }]
    setCharacters(prev => prev.map(c => c.slug === char.slug ? { ...c, states: { ...c.states, [category]: newList } } : c))
    patchStates(char.slug, { [category]: newList })
  }

  function changeStateValue(char: Character, category: StateCategory, index: number, value: number) {
    const newList = char.states[category].map((s, i) => i === index ? { ...s, value } : s)
    setCharacters(prev => prev.map(c => c.slug === char.slug ? { ...c, states: { ...c.states, [category]: newList } } : c))
    // Debounce the PATCH
    const key = `${char.slug}-${category}-${index}`
    const existing = debounceRefs.current.get(key)
    if (existing) clearTimeout(existing)
    debounceRefs.current.set(key, setTimeout(() => {
      patchStates(char.slug, { [category]: newList })
      debounceRefs.current.delete(key)
    }, 400))
  }

  return (
    <div className="character-panel">
      <h3>Characters</h3>
      <form className="add-character-form" onSubmit={e => { e.preventDefault(); addCharacter() }}>
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Character name..."
        />
        <button type="submit" disabled={!newName.trim()}>
          <i className="fa-solid fa-plus" /> Add
        </button>
      </form>

      {characters.length === 0 && (
        <p className="character-empty">No characters yet. Add one above.</p>
      )}

      {characters.map(char => {
        const isExpanded = expanded === char.slug
        const totalStates = char.states.core.length + char.states.persistent.length + char.states.temporal.length
        return (
          <div key={char.slug} className="character-card">
            <div className="character-card-header" onClick={() => setExpanded(isExpanded ? null : char.slug)}>
              <i className={`fa-solid ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'} character-expand-icon`} />
              <span className="character-name">{char.name}</span>
              {char.overflow_pending && <span className="overflow-badge" title="Category overflow — resolve slots">overflow</span>}
              <span className="character-state-count">{totalStates} states</span>
            </div>

            {isExpanded && (
              <div className="character-card-body">
                {(['core', 'persistent', 'temporal'] as StateCategory[]).map(category => (
                  <div key={category} className="character-states-section">
                    <h5>
                      {category}
                      <span className="slot-count">{char.states[category].length}/{CATEGORY_LIMITS[category]}</span>
                    </h5>
                    {char.states[category].map((state, i) => (
                      <div key={i} className="state-row">
                        <span className="state-label">{state.label}</span>
                        <input
                          type="number"
                          className={`state-value-input state-level--${stateLevel(state.value)}`}
                          value={state.value}
                          onChange={e => changeStateValue(char, category, i, parseInt(e.target.value) || 0)}
                        />
                        <button className="state-remove" onClick={() => removeState(char, category, i)} title="Remove state">
                          <i className="fa-solid fa-xmark" />
                        </button>
                      </div>
                    ))}
                    <AddStateInput onAdd={label => addState(char, category, label)} />
                  </div>
                ))}

                <button className="character-delete" onClick={() => deleteCharacter(char.slug)}>
                  <i className="fa-solid fa-trash" /> Delete Character
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const VALID_TABS: Tab[] = ['chat', 'characters', 'world', 'settings', 'global-settings']

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

  function switchTab(tab: Tab) {
    setActiveTab(tab)
    onTabChange(tab)
  }

  const isTemplate = kind === 'template'
  const chatLabel = isTemplate ? 'Test' : 'Chat'

  const tabs: { key: Tab; label: string; icon?: string }[] = [
    { key: 'chat', label: chatLabel },
    ...(!isTemplate ? [{ key: 'characters' as Tab, label: 'Characters' }] : []),
    { key: 'world', label: 'World' },
    { key: 'settings', label: 'Settings' },
    { key: 'global-settings', label: 'Global Settings', icon: 'fa-solid fa-gear' },
  ]

  return (
    <div className="adventure-view">
      <nav className="tab-bar">
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`tab-btn ${activeTab === tab.key ? 'tab-btn--active' : ''} ${tab.key === 'global-settings' ? 'tab-btn--push-right' : ''}`}
            onClick={() => switchTab(tab.key)}
          >
            {tab.icon && <i className={tab.icon} />}
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
        {activeTab === 'characters' && kind === 'adventure' && (
          <CharacterPanel slug={slug} />
        )}
        {activeTab === 'world' && (
          <div className="tab-placeholder">
            <p>World settings for <strong>{data.title}</strong>. (Coming soon)</p>
          </div>
        )}
        {activeTab === 'settings' && kind === 'adventure' && storyRoles && (
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
        )}
        {activeTab === 'settings' && isTemplate && (
          <div className="tab-placeholder">
            <p>Template settings for <strong>{data.title}</strong>. (Coming soon)</p>
          </div>
        )}
        {activeTab === 'global-settings' && (
          <AppSettings onWidthChange={onWidthChange} />
        )}
      </div>

      {kind === 'adventure' && storyRoles && (
        <PromptHintsPanel
          showAfterNarration={Object.values(storyRoles).some(r => r.when === 'after_narration')}
        />
      )}
      {kind === 'adventure' && (
        <StatusTabs storyRoles={storyRoles} loading={loading} />
      )}
    </div>
  )
}
