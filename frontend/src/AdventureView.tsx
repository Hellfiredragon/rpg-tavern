import { useEffect, useState } from 'react'
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

type Tab = 'chat' | 'world' | 'settings'

export default function AdventureView({ slug, kind }: AdventureViewProps) {
  const [data, setData] = useState<ItemData | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('chat')

  useEffect(() => {
    const apiBase = kind === 'template' ? '/api/templates' : '/api/adventures'
    fetch(`${apiBase}/${slug}`)
      .then(res => res.json())
      .then(setData)
  }, [slug, kind])

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
          <div className="tab-placeholder">
            {isTemplate ? (
              <p>Test chat for <strong>{data.title}</strong>. Messages here won't be saved.</p>
            ) : (
              <p>Live chat for <strong>{data.title}</strong>. (Coming soon)</p>
            )}
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
