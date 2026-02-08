import { useEffect, useState } from 'react'
import type { Adventure } from './QuestBoard'
import './AdventureView.css'

interface AdventureViewProps {
  adventureId: string
}

type Tab = 'chat' | 'world' | 'settings'

export default function AdventureView({ adventureId }: AdventureViewProps) {
  const [adventure, setAdventure] = useState<Adventure | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('chat')

  useEffect(() => {
    fetch(`/api/adventures/${adventureId}`)
      .then(res => res.json())
      .then(setAdventure)
  }, [adventureId])

  if (!adventure) {
    return <p className="loading-text">Loading adventure...</p>
  }

  const isTemplate = adventure.variant === 'template'
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
              <p>Test chat for <strong>{adventure.name}</strong>. Messages here won't be saved.</p>
            ) : (
              <p>Live chat for <strong>{adventure.name}</strong>. (Coming soon)</p>
            )}
          </div>
        )}
        {activeTab === 'world' && (
          <div className="tab-placeholder">
            <p>World settings for <strong>{adventure.name}</strong>. (Coming soon)</p>
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="tab-placeholder">
            <p>Adventure settings for <strong>{adventure.name}</strong>. (Coming soon)</p>
          </div>
        )}
      </div>
    </div>
  )
}
