/** Persona CRUD panel. When adventureSlug is provided, shows adventure-scoped
 * personas with promote/localize actions; otherwise shows global personas only. */
import { useEffect, useRef, useState } from 'react'
import { type Persona } from '../types'
import CollapsibleCard from './CollapsibleCard'
import StateEditor from './StateEditor'
import useEntityStates from './useEntityStates'
import './PersonaPanel.css'

export default function PersonaPanel({ adventureSlug }: { adventureSlug?: string }) {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [newName, setNewName] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const debounceRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const isGlobal = !adventureSlug
  const apiBase = isGlobal ? '/api/personas' : `/api/adventures/${adventureSlug}/personas`

  function patchPersona(pslug: string, body: Record<string, unknown>) {
    fetch(`${apiBase}/${pslug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const { removeState, addState, changeStateValue } = useEntityStates(personas, setPersonas, patchPersona, debounceRefs)

  useEffect(() => {
    fetch(apiBase)
      .then(res => res.ok ? res.json() : [])
      .then((list: Persona[]) => {
        if (isGlobal) {
          setPersonas(list.map(p => ({ ...p, source: 'global' as const })))
        } else {
          setPersonas(list)
        }
      })
  }, [apiBase, isGlobal])

  async function addPersona() {
    const name = newName.trim()
    if (!name) return
    const res = await fetch(apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (res.ok) {
      const p = await res.json()
      setPersonas(prev => [...prev, { ...p, source: isGlobal ? 'global' as const : 'adventure' as const }])
      setNewName('')
    }
  }

  async function deletePersona(pslug: string) {
    const res = await fetch(`${apiBase}/${pslug}`, { method: 'DELETE' })
    if (res.ok) {
      if (isGlobal) {
        setPersonas(prev => prev.filter(p => p.slug !== pslug))
      } else {
        const refreshed = await fetch(apiBase).then(r => r.json())
        setPersonas(refreshed)
      }
      if (expanded === pslug) setExpanded(null)
    }
  }

  function updateNicknames(persona: Persona, nicknames: string[]) {
    setPersonas(prev => prev.map(p => p.slug === persona.slug ? { ...p, nicknames } : p))
    patchPersona(persona.slug, { nicknames })
  }

  function updateDescription(persona: Persona, description: string) {
    setPersonas(prev => prev.map(p => p.slug === persona.slug ? { ...p, description } : p))
    const key = `${persona.slug}-desc`
    const existing = debounceRefs.current.get(key)
    if (existing) clearTimeout(existing)
    debounceRefs.current.set(key, setTimeout(() => {
      patchPersona(persona.slug, { description })
      debounceRefs.current.delete(key)
    }, 500))
  }

  async function promotePersona(pslug: string) {
    await fetch(`${apiBase}/${pslug}/promote`, { method: 'POST' })
    const refreshed = await fetch(apiBase).then(r => r.json())
    setPersonas(refreshed)
  }

  async function localizePersona(pslug: string) {
    await fetch(`${apiBase}/${pslug}/localize`, { method: 'POST' })
    const refreshed = await fetch(apiBase).then(r => r.json())
    setPersonas(refreshed)
  }

  return (
    <div className="persona-panel">
      <h3 className="panel-heading">{isGlobal ? 'Global Personas' : 'Personas'}</h3>
      <form className="add-character-form" onSubmit={e => { e.preventDefault(); addPersona() }}>
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Persona name..."
        />
        <button type="submit" disabled={!newName.trim()}>
          <i className="fa-solid fa-plus" /> Add
        </button>
      </form>

      {personas.length === 0 && (
        <p className="character-empty">
          {isGlobal
            ? 'No global personas yet. Add one above.'
            : 'No personas yet. Add one above or create a global persona in settings.'}
        </p>
      )}

      {personas.map(persona => {
        const isExpanded = expanded === persona.slug
        const totalStates = persona.states.core.length + persona.states.persistent.length + persona.states.temporal.length
        return (
          <CollapsibleCard
            key={persona.slug}
            expanded={isExpanded}
            onToggle={() => setExpanded(isExpanded ? null : persona.slug)}
            name={persona.name}
            badges={<>
              {!isGlobal && <span className="persona-source-badge">{persona.source}</span>}
              {persona.overflow_pending && <span className="overflow-badge" title="Category overflow — resolve slots">overflow</span>}
            </>}
            stateCount={totalStates}
          >
            <div className="character-meta-section">
              <label className="character-meta-label">
                Description
                <textarea
                  className="persona-description"
                  value={persona.description || ''}
                  onChange={e => updateDescription(persona, e.target.value)}
                  placeholder="A wandering sellsword from the northern marches..."
                  rows={3}
                />
              </label>
              <label className="character-meta-label">
                Nicknames
                <input
                  type="text"
                  value={(persona.nicknames || []).join(', ')}
                  onChange={e => updateNicknames(persona, e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  placeholder="Al, The Wanderer (comma-separated)"
                />
              </label>
            </div>

            <StateEditor
              states={persona.states}
              onRemoveState={(cat, idx) => removeState(persona.slug, cat, idx)}
              onAddState={(cat, label) => addState(persona.slug, cat, label)}
              onChangeValue={(cat, idx, raw) => changeStateValue(persona.slug, cat, idx, raw)}
            />

            <div className="persona-actions">
              {!isGlobal && persona.source === 'adventure' && (
                <button className="persona-action-btn" onClick={() => promotePersona(persona.slug)} title="Copy to global personas">
                  <i className="fa-solid fa-arrow-up" /> Promote to Global
                </button>
              )}
              {!isGlobal && persona.source === 'global' && (
                <button className="persona-action-btn" onClick={() => localizePersona(persona.slug)} title="Copy to adventure-local">
                  <i className="fa-solid fa-arrow-down" /> Copy to Adventure
                </button>
              )}
              {(isGlobal || persona.source === 'adventure') && (
                <button className="character-delete" onClick={() => deletePersona(persona.slug)}>
                  <i className="fa-solid fa-trash" /> Delete
                </button>
              )}
            </div>
          </CollapsibleCard>
        )
      })}
    </div>
  )
}
