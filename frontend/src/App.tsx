/** URL-based router. Routes: / (QuestBoard), /global-settings (AppSettings),
 * /tmpl/{slug} (template view), /advn/{slug} (adventure view). Tab selection
 * is reflected in the URL path and restored on page load via history.replaceState. */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import Layout from './Layout'
import QuestBoard from './QuestBoard'
import AdventureView from './AdventureView'
import AppSettings from './AppSettings'
import './App.css'

// ── URL-based routing ───────────────────────────────────────

type Route =
  | { page: 'board' }
  | { page: 'global-settings' }
  | { page: 'template'; slug: string; tab?: string }
  | { page: 'adventure'; slug: string; tab?: string }

function parseRoute(): Route {
  const path = window.location.pathname
  if (path === '/global-settings') return { page: 'global-settings' }
  const tmpl = path.match(/^\/tmpl\/([^/]+)(?:\/([^/]+))?/)
  if (tmpl) return { page: 'template', slug: tmpl[1], tab: tmpl[2] }
  const adv = path.match(/^\/advn\/([^/]+)(?:\/([^/]+))?/)
  if (adv) return { page: 'adventure', slug: adv[1], tab: adv[2] }
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

  const goToTemplate = useCallback((slug: string) => navigate(`/tmpl/${slug}`), [])
  const goToAdventure = useCallback((slug: string) => navigate(`/advn/${slug}`), [])
  const goToBoard = useCallback(() => navigate('/'), [])
  const goToSettings = useCallback(() => navigate('/global-settings'), [])

  const [appWidth, setAppWidth] = useState(100)

  useEffect(() => {
    // Load initial width from settings
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.app_width_percent) setAppWidth(data.app_width_percent)
      })
  }, [])

  useEffect(() => {
    if (route.page === 'board' || route.page === 'global-settings') {
      setTitle(null)
      return
    }
    const apiBase = route.page === 'template' ? '/api/templates' : '/api/adventures'
    fetch(`${apiBase}/${route.slug}`)
      .then(res => res.json())
      .then(data => setTitle(data.title))
  }, [route])

  const handleTabChange = useCallback((slug: string, kind: 'template' | 'adventure', tab: string) => {
    const prefix = kind === 'template' ? '/tmpl' : '/advn'
    const path = tab === 'chat' ? `${prefix}/${slug}` : `${prefix}/${slug}/${tab}`
    window.history.replaceState(null, '', path)
  }, [])

  const isDetail = route.page !== 'board'

  return (
    <Layout
      adventureName={title}
      onBack={isDetail ? goToBoard : undefined}
      appWidthPercent={appWidth}
    >
      {route.page === 'board' && (
        <QuestBoard
          onSelectTemplate={goToTemplate}
          onSelectAdventure={goToAdventure}
          onSettings={goToSettings}
        />
      )}
      {route.page === 'global-settings' && (
        <AppSettings onWidthChange={setAppWidth} />
      )}
      {route.page === 'template' && (
        <AdventureView
          slug={route.slug}
          kind="template"
          initialTab={route.tab}
          onTabChange={tab => handleTabChange(route.slug, 'template', tab)}
          onWidthChange={setAppWidth}
        />
      )}
      {route.page === 'adventure' && (
        <AdventureView
          slug={route.slug}
          kind="adventure"
          initialTab={route.tab}
          onTabChange={tab => handleTabChange(route.slug, 'adventure', tab)}
          onWidthChange={setAppWidth}
        />
      )}
    </Layout>
  )
}

export default App
