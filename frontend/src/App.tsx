import { useEffect, useState } from 'react'
import Layout from './Layout'
import QuestBoard from './QuestBoard'
import type { Adventure } from './QuestBoard'
import AdventureView from './AdventureView'
import './App.css'

function App() {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [adventureTitle, setAdventureTitle] = useState<string | null>(null)

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
      onBack={selectedSlug ? () => setSelectedSlug(null) : undefined}
    >
      {selectedSlug
        ? <AdventureView slug={selectedSlug} />
        : <QuestBoard onSelect={setSelectedSlug} />
      }
    </Layout>
  )
}

export default App
