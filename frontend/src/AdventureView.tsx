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
  intro?: string
}

interface ChatSegment {
  type: 'narration' | 'dialog'
  text: string
  character?: string
  emotion?: string
}

interface ChatMessage {
  role: 'player' | 'narrator' | 'intention'
  text: string
  ts: string
  segments?: ChatSegment[]
  character?: string  // for intention messages
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
  nicknames: string[]
  chattiness: number
  states: CharacterStates
  overflow_pending: boolean
}

interface LorebookEntryData {
  title: string
  content: string
  keywords: string[]
}

const CATEGORY_LIMITS: Record<StateCategory, number> = { core: 3, persistent: 10, temporal: 10 }
const CATEGORY_MAX_VALUES: Record<StateCategory, number | null> = { core: 30, persistent: 20, temporal: null }
const CATEGORY_DEFAULTS: Record<StateCategory, number> = { core: 30, persistent: 20, temporal: 6 }

function stateLevel(value: number): string {
  if (value < 6) return 'silent'
  if (value <= 10) return 'urge'
  if (value <= 16) return 'driver'
  if (value <= 20) return 'important'
  return 'overflow'
}

type Tab = 'chat' | 'characters' | 'world' | 'settings' | 'global-settings'

interface StoryRoleConfig {
  prompt: string
}

interface StoryRoles {
  narrator: StoryRoleConfig
  character_intention: StoryRoleConfig
  extractor: StoryRoleConfig
  lorebook_extractor: StoryRoleConfig
  max_rounds: number
  sandbox: boolean
}

type RoleName = 'narrator' | 'character_intention' | 'extractor' | 'lorebook_extractor'

const ROLE_LABELS: Record<RoleName, string> = {
  narrator: 'Narrator',
  character_intention: 'Character Intention',
  extractor: 'Character Extractor',
  lorebook_extractor: 'Lorebook Extractor',
}

const ROLE_ICONS: Record<RoleName, string> = {
  narrator: 'fa-solid fa-book-open',
  character_intention: 'fa-solid fa-feather',
  extractor: 'fa-solid fa-flask',
  lorebook_extractor: 'fa-solid fa-book',
}

const ROLE_NAMES: RoleName[] = ['narrator', 'character_intention', 'extractor', 'lorebook_extractor']

interface GlobalSettings {
  llm_connections: { name: string; provider_url: string; api_key: string }[]
  story_roles: Record<RoleName, string>
}

interface TemplateVar {
  name: string
  type: string
  desc: string
}

const TEMPLATE_VARS: TemplateVar[] = [
  { name: 'description', type: 'string', desc: 'Adventure premise' },
  { name: 'title', type: 'string', desc: 'Adventure title' },
  { name: 'message', type: 'string', desc: 'Current player message' },
  { name: 'history', type: 'string', desc: 'Pre-formatted history' },
  { name: 'messages', type: 'array', desc: 'Message objects for {{#each}}' },
  { name: 'lorebook', type: 'string', desc: 'Pre-formatted matched lorebook entries' },
  { name: 'lorebook_entries', type: 'array', desc: 'Matched lorebook entry objects' },
  { name: 'intention', type: 'string', desc: 'Current intention being resolved' },
  { name: 'narration', type: 'string', desc: 'Narrator response text' },
  { name: 'narration_so_far', type: 'string', desc: 'All narration this turn so far' },
  { name: 'round_narrations', type: 'string', desc: 'All narrations from this round' },
  { name: 'characters', type: 'array', desc: 'Character objects with .name, .descriptions' },
  { name: 'characters_summary', type: 'string', desc: 'Pre-formatted character states' },
  { name: 'character_name', type: 'string', desc: 'Current character name' },
  { name: 'character_description', type: 'string', desc: 'Current character personality' },
  { name: 'character_states', type: 'string', desc: 'Visible states (≥6) for current character' },
  { name: 'character_all_states', type: 'string', desc: 'All states with raw values (extractor)' },
]

const MESSAGE_FIELDS: { name: string; desc: string }[] = [
  { name: '.role', desc: '"player" or "narrator"' },
  { name: '.text', desc: 'Content' },
  { name: '.ts', desc: 'ISO timestamp' },
  { name: '.is_player', desc: 'Boolean flag' },
  { name: '.is_narrator', desc: 'Boolean flag' },
]

function PromptHintsPanel() {
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
            <div key={v.name} className="hint-var">
              <dt>
                <code>{'{{' + v.name + '}}'}</code>
                <span className="hint-type">{v.type}</span>
              </dt>
              <dd>{v.desc}</dd>
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
  onPromptChange,
}: {
  role: RoleName
  config: StoryRoleConfig
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
        <h4>
          <i className={`${ROLE_ICONS[role]} story-role-icon`} />
          {ROLE_LABELS[role]}
        </h4>
      </div>
      <textarea
        className="prompt-editor"
        value={promptValue}
        onChange={e => handlePromptChange(e.target.value)}
        placeholder="Handlebars prompt template..."
        rows={8}
      />
    </div>
  )
}

type ConnectionStatus = 'unknown' | 'checking' | 'ok' | 'error'

function StatusTabs({
  loading,
}: {
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
      for (const role of ROLE_NAMES) {
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

  if (!globalSettings) return null

  function getStatusForRole(role: RoleName): {
    assigned: boolean
    connName: string
    status: ConnectionStatus
  } {
    const connName = globalSettings!.story_roles[role] || ''
    const assigned = !!connName
    const status = connStatus[role] || 'unknown'
    return { assigned, connName, status }
  }

  return (
    <div className="status-tabs" ref={containerRef}>
      {ROLE_NAMES.map(role => {
        const info = getStatusForRole(role)
        const isOpen = openRole === role

        let dotClass = 'status-dot--unknown'
        if (loading) dotClass = 'status-dot--running'
        else if (!info.assigned) dotClass = 'status-dot--unassigned'
        else if (info.status === 'ok') dotClass = 'status-dot--ok'
        else if (info.status === 'error') dotClass = 'status-dot--error'
        else if (info.status === 'checking') dotClass = 'status-dot--checking'

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
                    <dt>Connection</dt>
                    <dd>{info.connName || <span className="status-muted">not assigned</span>}</dd>
                  </div>
                  <div className="status-field">
                    <dt>Status</dt>
                    <dd>
                      {loading && <span className="status-badge status-badge--running"><i className="fa-solid fa-spinner fa-spin" /> Running</span>}
                      {!loading && !info.assigned && <span className="status-badge status-badge--unassigned">No connection</span>}
                      {!loading && info.assigned && info.status === 'ok' && <span className="status-badge status-badge--ok">Connected</span>}
                      {!loading && info.assigned && info.status === 'error' && <span className="status-badge status-badge--error">Unreachable</span>}
                      {!loading && info.assigned && info.status === 'checking' && <span className="status-badge status-badge--checking">Checking...</span>}
                      {!loading && info.assigned && info.status === 'unknown' && <span className="status-badge status-badge--checking">Pending</span>}
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

  function patchCharacter(cslug: string, body: Record<string, unknown>) {
    fetch(`/api/adventures/${slug}/characters/${cslug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  function removeState(char: Character, category: StateCategory, index: number) {
    const newList = char.states[category].filter((_, i) => i !== index)
    setCharacters(prev => prev.map(c => c.slug === char.slug ? { ...c, states: { ...c.states, [category]: newList } } : c))
    patchCharacter(char.slug, { states: { [category]: newList } })
  }

  function addState(char: Character, category: StateCategory, label: string) {
    const newList = [...char.states[category], { label, value: CATEGORY_DEFAULTS[category] }]
    setCharacters(prev => prev.map(c => c.slug === char.slug ? { ...c, states: { ...c.states, [category]: newList } } : c))
    patchCharacter(char.slug, { states: { [category]: newList } })
  }

  function changeStateValue(char: Character, category: StateCategory, index: number, rawValue: number) {
    const cap = CATEGORY_MAX_VALUES[category]
    const value = cap !== null && rawValue > cap ? cap : rawValue
    const newList = char.states[category].map((s, i) => i === index ? { ...s, value } : s)
    setCharacters(prev => prev.map(c => c.slug === char.slug ? { ...c, states: { ...c.states, [category]: newList } } : c))
    const key = `${char.slug}-${category}-${index}`
    const existing = debounceRefs.current.get(key)
    if (existing) clearTimeout(existing)
    debounceRefs.current.set(key, setTimeout(() => {
      patchCharacter(char.slug, { states: { [category]: newList } })
      debounceRefs.current.delete(key)
    }, 400))
  }

  function updateNicknames(char: Character, nicknames: string[]) {
    setCharacters(prev => prev.map(c => c.slug === char.slug ? { ...c, nicknames } : c))
    patchCharacter(char.slug, { nicknames })
  }

  function updateChattiness(char: Character, chattiness: number) {
    setCharacters(prev => prev.map(c => c.slug === char.slug ? { ...c, chattiness } : c))
    const key = `${char.slug}-chattiness`
    const existing = debounceRefs.current.get(key)
    if (existing) clearTimeout(existing)
    debounceRefs.current.set(key, setTimeout(() => {
      patchCharacter(char.slug, { chattiness })
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
                <div className="character-meta-section">
                  <label className="character-meta-label">
                    Nicknames
                    <input
                      type="text"
                      value={(char.nicknames || []).join(', ')}
                      onChange={e => updateNicknames(char, e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                      placeholder="Cap, The Brute (comma-separated)"
                    />
                  </label>
                  <label className="character-meta-label">
                    Chattiness
                    <div className="chattiness-row">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={char.chattiness ?? 50}
                        onChange={e => updateChattiness(char, parseInt(e.target.value))}
                      />
                      <span className="chattiness-value">{char.chattiness ?? 50}%</span>
                    </div>
                  </label>
                </div>

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

function TemplateSettingsPanel({
  slug,
  data,
  setData,
}: {
  slug: string
  data: ItemData
  setData: (d: ItemData) => void
}) {
  const [intro, setIntro] = useState(data.intro || '')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    setIntro(data.intro || '')
  }, [data.intro])

  function handleIntroChange(value: string) {
    setIntro(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetch(`/api/templates/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intro: value }),
      }).then(res => {
        if (res.ok) res.json().then(setData)
      })
    }, 500)
  }

  return (
    <div className="template-settings-panel">
      <h3>Template Settings</h3>
      <div className="template-intro-section">
        <label>
          <strong>Intro Text</strong>
          <p className="template-intro-hint">
            Shown as the first narrator message when a player embarks on this template.
          </p>
          <textarea
            className="prompt-editor"
            value={intro}
            onChange={e => handleIntroChange(e.target.value)}
            placeholder="A narrator introduction that sets the scene..."
            rows={5}
          />
        </label>
      </div>
    </div>
  )
}

function LorebookPanel({ slug }: { slug: string }) {
  const [entries, setEntries] = useState<LorebookEntryData[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  const [form, setForm] = useState({ title: '', content: '', keywords: '' })

  useEffect(() => {
    fetch(`/api/adventures/${slug}/lorebook`)
      .then(res => res.ok ? res.json() : [])
      .then(setEntries)
  }, [slug])

  function startAdd() {
    setForm({ title: '', content: '', keywords: '' })
    setEditing(-1)
  }

  function startEdit(i: number) {
    const e = entries[i]
    setForm({ title: e.title, content: e.content, keywords: e.keywords.join(', ') })
    setEditing(i)
  }

  async function save() {
    const body = {
      title: form.title.trim(),
      content: form.content.trim(),
      keywords: form.keywords.split(',').map(s => s.trim()).filter(Boolean),
    }
    if (!body.title) return
    const isNew = editing === -1
    const url = isNew
      ? `/api/adventures/${slug}/lorebook`
      : `/api/adventures/${slug}/lorebook/${editing}`
    const res = await fetch(url, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setEntries(await res.json())
      setEditing(null)
    }
  }

  async function remove(i: number) {
    const res = await fetch(`/api/adventures/${slug}/lorebook/${i}`, { method: 'DELETE' })
    if (res.ok) {
      setEntries(await res.json())
      if (editing === i) setEditing(null)
    }
  }

  return (
    <div className="lorebook-panel">
      <div className="lorebook-header">
        <h3>Lorebook</h3>
        <button onClick={startAdd}>
          <i className="fa-solid fa-plus" /> Add Entry
        </button>
      </div>

      {editing !== null && (
        <div className="lorebook-form">
          <input
            type="text"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Entry title..."
          />
          <textarea
            value={form.content}
            onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
            placeholder="Entry content..."
            rows={3}
          />
          <input
            type="text"
            value={form.keywords}
            onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))}
            placeholder="Keywords (comma-separated)..."
          />
          <div className="lorebook-form-actions">
            <button onClick={save} disabled={!form.title.trim()}>Save</button>
            <button onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      {entries.length === 0 && editing === null && (
        <p className="lorebook-empty">No lorebook entries yet. Add one above.</p>
      )}

      {entries.map((entry, i) => (
        <div key={i} className="lorebook-entry">
          <div className="lorebook-entry-header">
            <strong>{entry.title}</strong>
            <div className="lorebook-entry-actions">
              <button onClick={() => startEdit(i)} title="Edit">
                <i className="fa-solid fa-pen" />
              </button>
              <button onClick={() => remove(i)} title="Delete">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          </div>
          <p className="lorebook-entry-content">{entry.content}</p>
          <div className="lorebook-keywords">
            {entry.keywords.map((kw, ki) => (
              <span key={ki} className="lorebook-keyword">{kw}</span>
            ))}
          </div>
        </div>
      ))}
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
                // Narrator message — render segments if available
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
                // Fallback: plain text (old messages)
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
        {activeTab === 'world' && kind === 'adventure' && (
          <LorebookPanel slug={slug} />
        )}
        {activeTab === 'world' && isTemplate && (
          <div className="tab-placeholder">
            <p>World settings for templates are not yet available.</p>
          </div>
        )}
        {activeTab === 'settings' && kind === 'adventure' && storyRoles && (
          <div className="story-roles-settings">
            <h3>Pipeline Settings</h3>
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
            <h3>Story Roles</h3>
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
