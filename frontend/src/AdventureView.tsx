import { useEffect, useRef, useState } from 'react'
import './AdventureView.css'

interface AdventureViewProps {
  slug: string
  kind: 'template' | 'adventure'
}

interface ItemData {
  title: string
  slug: string
  description: string
}

interface ChatMessage {
  role: 'player' | 'narrator'
  text: string
  ts: string
}

type Tab = 'chat' | 'world' | 'settings'

export default function AdventureView({ slug, kind }: AdventureViewProps) {
  const [data, setData] = useState<ItemData | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
      // Replace optimistic player msg + add narrator msg with server timestamps
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

  const isTemplate = kind === 'template'
  const chatLabel = isTemplate ? 'Test' : 'Chat'

  const tabs: { key: Tab; label: string }[] = [
    { key: 'chat', label: chatLabel },
    { key: 'world', label: 'World' },
    { key: 'settings', label: 'Settings' },
  ]

  return (
    <div className="adventure-view">
      <nav className="tab-bar">
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`tab-btn ${activeTab === tab.key ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
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
              {messages.map((msg, i) => (
                <div key={i} className={`chat-msg chat-msg--${msg.role}`}>
                  {msg.text}
                </div>
              ))}
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
        {activeTab === 'world' && (
          <div className="tab-placeholder">
            <p>World settings for <strong>{data.title}</strong>. (Coming soon)</p>
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="tab-placeholder">
            <p>Adventure settings for <strong>{data.title}</strong>. (Coming soon)</p>
          </div>
        )}
      </div>
    </div>
  )
}
