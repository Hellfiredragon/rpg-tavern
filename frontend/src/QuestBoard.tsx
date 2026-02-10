import { useEffect, useState } from 'react'
import EmbarkDialog from './EmbarkDialog'
import './QuestBoard.css'

export interface Template {
  title: string
  slug: string
  description: string
  source: 'preset' | 'user'
}

export interface Adventure {
  title: string
  slug: string
  description: string
  template_slug?: string
  created_at: string
}

interface QuestBoardProps {
  onSelectTemplate: (slug: string) => void
  onSelectAdventure: (slug: string) => void
  onSettings: () => void
}

export default function QuestBoard({ onSelectTemplate, onSelectAdventure, onSettings }: QuestBoardProps) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [adventures, setAdventures] = useState<Adventure[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [embarkSlug, setEmbarkSlug] = useState<string | null>(null)

  const fetchData = async () => {
    const [tmplRes, advRes] = await Promise.all([
      fetch('/api/templates'),
      fetch('/api/adventures'),
    ])
    setTemplates(await tmplRes.json())
    setAdventures(await advRes.json())
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), description: description.trim() }),
    })
    setTitle('')
    setDescription('')
    setShowCreate(false)
    fetchData()
  }

  const handleDeleteTemplate = async (slug: string) => {
    await fetch(`/api/templates/${slug}`, { method: 'DELETE' })
    fetchData()
  }

  const handleDeleteAdventure = async (slug: string) => {
    await fetch(`/api/adventures/${slug}`, { method: 'DELETE' })
    fetchData()
  }

  const handleEmbark = async (slug: string, adventureTitle: string) => {
    const res = await fetch(`/api/templates/${slug}/embark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: adventureTitle }),
    })
    const adventure: Adventure = await res.json()
    setEmbarkSlug(null)
    fetchData()
    onSelectAdventure(adventure.slug)
  }

  const embarkTemplate = embarkSlug
    ? templates.find(t => t.slug === embarkSlug) ?? null
    : null

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
        <div className="quest-board-actions">
          {!showCreate && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              New Template
            </button>
          )}
          <button className="btn btn-ghost" onClick={onSettings} title="Global Settings">
            <i className="fa-solid fa-gear" />
          </button>
        </div>
      </div>

      <hr className="divider" />

      {showCreate && (
        <>
          <form className="create-form" onSubmit={handleCreate}>
            <h3 className="form-title">Scribe a New Tale</h3>
            <input
              type="text"
              placeholder="Name your template..."
              value={title}
              onChange={e => setTitle(e.target.value)}
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

      {adventures.length > 0 && (
        <>
          <h3 className="section-title">Running Adventures</h3>
          <div className="adventure-list">
            {adventures.map(adv => (
              <article key={adv.slug} className="adventure-card adventure-card--running">
                <div className="adventure-card-body">
                  <h3 className="adventure-name">{adv.title}</h3>
                  {adv.description && (
                    <p className="adventure-desc">{adv.description}</p>
                  )}
                </div>
                <div className="adventure-actions">
                  <button className="btn btn-primary" onClick={() => onSelectAdventure(adv.slug)}>
                    Continue
                  </button>
                  <button className="btn btn-danger" onClick={() => handleDeleteAdventure(adv.slug)}>
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
        {templates.map(tmpl => (
          <article key={tmpl.slug} className="adventure-card">
            <div className="adventure-card-body">
              <h3 className="adventure-name">{tmpl.title}</h3>
              {tmpl.description && (
                <p className="adventure-desc">{tmpl.description}</p>
              )}
            </div>
            <div className="adventure-actions">
              <button className="btn btn-primary" onClick={() => setEmbarkSlug(tmpl.slug)}>
                Embark
              </button>
              <button className="btn btn-ghost" onClick={() => onSelectTemplate(tmpl.slug)}>
                Edit
              </button>
              <button className="btn btn-danger" onClick={() => handleDeleteTemplate(tmpl.slug)}>
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

      {embarkTemplate && (
        <EmbarkDialog
          templateSlug={embarkTemplate.slug}
          templateTitle={embarkTemplate.title}
          onEmbark={(adventureTitle) => handleEmbark(embarkTemplate.slug, adventureTitle)}
          onCancel={() => setEmbarkSlug(null)}
        />
      )}
    </section>
  )
}
