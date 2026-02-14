/** Lorebook entry CRUD panel. Manages per-adventure world knowledge entries
 * with title, content, and keyword fields. */
import { useEffect, useState } from 'react'
import { type LorebookEntryData } from '../types'
import './LorebookPanel.css'

export default function LorebookPanel({ slug }: { slug: string }) {
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
        <h3 className="panel-heading">Lorebook</h3>
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
