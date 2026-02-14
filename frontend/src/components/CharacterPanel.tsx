/** Character list with states, nicknames, and chattiness slider. Supports
 * adding, removing, and editing characters per adventure. */
import { useEffect, useRef, useState } from 'react'
import { type Character } from '../types'
import CollapsibleCard from './CollapsibleCard'
import StateEditor from './StateEditor'
import useEntityStates from './useEntityStates'
import './CharacterPanel.css'

export default function CharacterPanel({ slug }: { slug: string }) {
  const [characters, setCharacters] = useState<Character[]>([])
  const [newName, setNewName] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const debounceRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  function patchCharacter(cslug: string, body: Record<string, unknown>) {
    fetch(`/api/adventures/${slug}/characters/${cslug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const { removeState, addState, changeStateValue } = useEntityStates(characters, setCharacters, patchCharacter, debounceRefs)

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
      <h3 className="panel-heading">Characters</h3>
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
          <CollapsibleCard
            key={char.slug}
            expanded={isExpanded}
            onToggle={() => setExpanded(isExpanded ? null : char.slug)}
            name={char.name}
            badges={char.overflow_pending ? <span className="overflow-badge" title="Category overflow — resolve slots">overflow</span> : undefined}
            stateCount={totalStates}
          >
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

            <StateEditor
              states={char.states}
              onRemoveState={(cat, idx) => removeState(char.slug, cat, idx)}
              onAddState={(cat, label) => addState(char.slug, cat, label)}
              onChangeValue={(cat, idx, raw) => changeStateValue(char.slug, cat, idx, raw)}
            />

            <button className="character-delete" onClick={() => deleteCharacter(char.slug)}>
              <i className="fa-solid fa-trash" /> Delete Character
            </button>
          </CollapsibleCard>
        )
      })}
    </div>
  )
}
