import { useEffect, useState } from 'react'
import Layout from './Layout'
import QuestBoard from './QuestBoard'
import type { Adventure } from './QuestBoard'
import AdventureView from './AdventureView'
import './App.css'

function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adventureName, setAdventureName] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedId) {
      setAdventureName(null)
      return
    }
    fetch(`/api/adventures/${selectedId}`)
      .then(res => res.json())
      .then((adv: Adventure) => setAdventureName(adv.name))
  }, [selectedId])

  return (
    <Layout
      adventureName={adventureName}
      onBack={selectedId ? () => setSelectedId(null) : undefined}
    >
      {selectedId
        ? <AdventureView adventureId={selectedId} />
        : <QuestBoard onSelect={setSelectedId} />
      }
    </Layout>
  )
}

export default App
