import { useEffect, useState } from 'react'
import './QuestBoard.css'

export interface Adventure {
  id: string
  name: string
  description: string
  variant: 'template' | 'running'
  template_id?: string
  created_at: string
}

interface QuestBoardProps {
  onSelect: (id: string) => void
}

export default function QuestBoard({ onSelect }: QuestBoardProps) {
  const [adventures, setAdventures] = useState<Adventure[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const fetchAdventures = async () => {
    const res = await fetch('/api/adventures')
    setAdventures(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchAdventures() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await fetch('/api/adventures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), description: description.trim() }),
    })
    setName('')
    setDescription('')
    setShowCreate(false)
    fetchAdventures()
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/adventures/${id}`, { method: 'DELETE' })
    fetchAdventures()
  }

  const handleEmbark = async (id: string) => {
    const res = await fetch(`/api/adventures/${id}/embark`, { method: 'POST' })
    const running: Adventure = await res.json()
    fetchAdventures()
    onSelect(running.id)
  }

  const templates = adventures.filter(a => a.variant === 'template')
  const running = adventures.filter(a => a.variant === 'running')

  if (loading) {
    return <p className="loading-text">Unrolling the quest board...</p>
  }

  return (
    <section className="quest-board">
      <div className="quest-board-header">
        <div>
          <h2 className="quest-board-title">Quest Board</h2>
          <p className="quest-board-subtitle">Choose your adventure, traveler</p>
        </div>
        {!showCreate && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            New Adventure
          </button>
        )}
      </div>

      <hr className="divider" />

      {showCreate && (
        <>
          <form className="create-form" onSubmit={handleCreate}>
            <h3 className="form-title">Scribe a New Tale</h3>
            <input
              type="text"
              placeholder="Name your adventure..."
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
            <textarea
              placeholder="Describe the premise... (optional)"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Create</button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
            </div>
          </form>
          <hr className="divider" />
        </>
      )}

      {running.length > 0 && (
        <>
          <h3 className="section-title">Running Adventures</h3>
          <div className="adventure-list">
            {running.map(adv => (
              <article key={adv.id} className="adventure-card adventure-card--running">
                <div className="adventure-card-body">
                  <h3 className="adventure-name">{adv.name}</h3>
                  {adv.description && (
                    <p className="adventure-desc">{adv.description}</p>
                  )}
                </div>
                <div className="adventure-actions">
                  <button className="btn btn-primary" onClick={() => onSelect(adv.id)}>
                    Continue
                  </button>
                  <button className="btn btn-danger" onClick={() => handleDelete(adv.id)}>
                    Discard
                  </button>
                </div>
              </article>
            ))}
          </div>
          <hr className="divider" />
        </>
      )}

      <h3 className="section-title">Templates</h3>
      <div className="adventure-list">
        {templates.map(adv => (
          <article key={adv.id} className="adventure-card">
            <div className="adventure-card-body">
              <h3 className="adventure-name">{adv.name}</h3>
              {adv.description && (
                <p className="adventure-desc">{adv.description}</p>
              )}
            </div>
            <div className="adventure-actions">
              <button className="btn btn-primary" onClick={() => handleEmbark(adv.id)}>
                Embark
              </button>
              <button className="btn btn-ghost" onClick={() => onSelect(adv.id)}>
                Edit
              </button>
              <button className="btn btn-danger" onClick={() => handleDelete(adv.id)}>
                Discard
              </button>
            </div>
          </article>
        ))}
        {templates.length === 0 && (
          <div className="empty-board">
            <p className="empty-board-text">
              The quest board stands empty. Perhaps you should pin a new tale upon it.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
