/** Inline form for adding a new state entry to a character or persona. */
import { useState } from 'react'

export default function AddStateInput({ onAdd }: { onAdd: (label: string) => void }) {
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
