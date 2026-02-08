import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import Layout from './Layout'
import QuestBoard from './QuestBoard'
import type { Adventure } from './QuestBoard'
import AdventureView from './AdventureView'
import './App.css'

// ── URL-based routing ───────────────────────────────────────

function parseSlug(): string | null {
  const m = window.location.pathname.match(/^\/adventures\/([^/]+)/)
  return m ? m[1] : null
}

function subscribeToLocation(cb: () => void) {
  window.addEventListener('popstate', cb)
  return () => window.removeEventListener('popstate', cb)
}

function navigate(path: string) {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// ── App ─────────────────────────────────────────────────────

function App() {
  const selectedSlug = useSyncExternalStore(subscribeToLocation, parseSlug)
  const [adventureTitle, setAdventureTitle] = useState<string | null>(null)

  const goToAdventure = useCallback((slug: string) => navigate(`/adventures/${slug}`), [])
  const goToBoard = useCallback(() => navigate('/'), [])

  useEffect(() => {
    if (!selectedSlug) {
      setAdventureTitle(null)
      return
    }
    fetch(`/api/adventures/${selectedSlug}`)
      .then(res => res.json())
      .then((adv: Adventure) => setAdventureTitle(adv.title))
  }, [selectedSlug])

  return (
    <Layout
      adventureName={adventureTitle}
      onBack={selectedSlug ? goToBoard : undefined}
    >
      {selectedSlug
        ? <AdventureView slug={selectedSlug} />
        : <QuestBoard onSelect={goToAdventure} />
      }
    </Layout>
  )
}

export default App
