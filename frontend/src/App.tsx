import { useEffect, useState } from 'react'
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

  if (loading) return <div className="container"><p>Loading...</p></div>

  return (
    <div className="container">
      <h1>RPG Tavern</h1>
      <p className="subtitle">Choose your adventure</p>

      <div className="adventure-list">
        {adventures.map(adv => (
          <div key={adv.id} className="adventure-card">
            <div className="adventure-info">
              <h2>{adv.name}</h2>
              {adv.description && <p>{adv.description}</p>}
            </div>
            <div className="adventure-actions">
              <button className="btn-primary" onClick={() => alert(`TODO: Play "${adv.name}"`)}>
                Play
              </button>
              <button className="btn-danger" onClick={() => handleDelete(adv.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
        {adventures.length === 0 && (
          <p className="empty">No adventures yet. Create one to get started!</p>
        )}
      </div>

      {showCreate ? (
        <form className="create-form" onSubmit={handleCreate}>
          <input
            type="text"
            placeholder="Adventure name"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
          <textarea
            placeholder="Description (optional)"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
          />
          <div className="form-actions">
            <button type="submit" className="btn-primary">Create</button>
            <button type="button" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          New Adventure
        </button>
      )}
    </div>
  )
}

export default App
