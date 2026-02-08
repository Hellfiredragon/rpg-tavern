import { useEffect, useRef, useState } from 'react'
import './EmbarkDialog.css'

interface EmbarkDialogProps {
  templateSlug: string
  templateTitle: string
  onEmbark: (title: string) => void
  onCancel: () => void
}

export default function EmbarkDialog({ templateSlug, templateTitle, onEmbark, onCancel }: EmbarkDialogProps) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchName = async () => {
    setLoading(true)
    const res = await fetch(`/api/name-suggestion?title=${encodeURIComponent(templateTitle)}`)
    const data = await res.json()
    setName(data.name)
    setLoading(false)
  }

  useEffect(() => { fetchName() }, [templateSlug])

  useEffect(() => {
    if (!loading && inputRef.current) {
      inputRef.current.focus()
    }
  }, [loading])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim()) onEmbark(name.trim())
  }

  return (
    <div className="embark-overlay" onClick={onCancel}>
      <div className="embark-dialog" onClick={e => e.stopPropagation()}>
        <h3 className="embark-dialog-title">Embark: {templateTitle}</h3>
        <form onSubmit={handleSubmit}>
          <label className="embark-label">Adventure name</label>
          <div className="embark-input-row">
            <input
              ref={inputRef}
              type="text"
              className="embark-input"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={loading}
            />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={fetchName}
              disabled={loading}
              title="Generate a new name"
            >
              Re-roll
            </button>
          </div>
          <div className="embark-actions">
            <button type="submit" className="btn btn-primary" disabled={!name.trim() || loading}>
              Embark
            </button>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
