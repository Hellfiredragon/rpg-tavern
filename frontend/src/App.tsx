import { useEffect, useState } from 'react'
import Layout from './Layout'
import './App.css'

interface Adventure {
  id: string
  name: string
  description: string
  created_at: string
}

function App() {
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

  if (loading) {
    return (
      <Layout>
        <p className="loading-text">Unrolling the quest board...</p>
      </Layout>
    )
  }

  return (
    <Layout>
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

        <div className="adventure-list">
          {adventures.map(adv => (
            <article key={adv.id} className="adventure-card">
              <div className="adventure-card-body">
                <h3 className="adventure-name">{adv.name}</h3>
                {adv.description && (
                  <p className="adventure-desc">{adv.description}</p>
                )}
              </div>
              <div className="adventure-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => alert(`TODO: Play "${adv.name}"`)}
                >
                  Embark
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => handleDelete(adv.id)}
                >
                  Discard
                </button>
              </div>
            </article>
          ))}
          {adventures.length === 0 && (
            <div className="empty-board">
              <p className="empty-board-text">
                The quest board stands empty. Perhaps you should pin a new tale upon it.
              </p>
            </div>
          )}
        </div>
      </section>
    </Layout>
  )
}

export default App
