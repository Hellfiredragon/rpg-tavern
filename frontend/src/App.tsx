import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import Layout from './Layout'
import QuestBoard from './QuestBoard'
import AdventureView from './AdventureView'
import './App.css'

// ── URL-based routing ───────────────────────────────────────

type Route =
  | { page: 'board' }
  | { page: 'template'; slug: string }
  | { page: 'adventure'; slug: string }

function parseRoute(): Route {
  const path = window.location.pathname
  const tmpl = path.match(/^\/templates\/([^/]+)/)
  if (tmpl) return { page: 'template', slug: tmpl[1] }
  const adv = path.match(/^\/adventures\/([^/]+)/)
  if (adv) return { page: 'adventure', slug: adv[1] }
  return { page: 'board' }
}

function subscribeToLocation(cb: () => void) {
  window.addEventListener('popstate', cb)
  return () => window.removeEventListener('popstate', cb)
}

// We need a stable snapshot reference for useSyncExternalStore
let _lastRoute: Route = parseRoute()
let _lastPath = window.location.pathname

function getRouteSnapshot(): Route {
  const currentPath = window.location.pathname
  if (currentPath !== _lastPath) {
    _lastPath = currentPath
    _lastRoute = parseRoute()
  }
  return _lastRoute
}

function navigate(path: string) {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// ── App ─────────────────────────────────────────────────────

function App() {
  const route = useSyncExternalStore(subscribeToLocation, getRouteSnapshot)
  const [title, setTitle] = useState<string | null>(null)

  const goToTemplate = useCallback((slug: string) => navigate(`/templates/${slug}`), [])
  const goToAdventure = useCallback((slug: string) => navigate(`/adventures/${slug}`), [])
  const goToBoard = useCallback(() => navigate('/'), [])

  useEffect(() => {
    if (route.page === 'board') {
      setTitle(null)
      return
    }
    const apiBase = route.page === 'template' ? '/api/templates' : '/api/adventures'
    fetch(`${apiBase}/${route.slug}`)
      .then(res => res.json())
      .then(data => setTitle(data.title))
  }, [route])

  const isDetail = route.page !== 'board'

  return (
    <Layout
      adventureName={title}
      onBack={isDetail ? goToBoard : undefined}
    >
      {route.page === 'board' && (
        <QuestBoard
          onSelectTemplate={goToTemplate}
          onSelectAdventure={goToAdventure}
        />
      )}
      {route.page === 'template' && (
        <AdventureView slug={route.slug} kind="template" />
      )}
      {route.page === 'adventure' && (
        <AdventureView slug={route.slug} kind="adventure" />
      )}
    </Layout>
  )
}

export default App
