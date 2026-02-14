/** Floating connection status indicators showing which LLM connections are
 * assigned to each story role, with health check status. */
import { useEffect, useRef, useState } from 'react'
import { type RoleName, ROLE_NAMES, ROLE_LABELS, ROLE_ICONS } from '../types'
import './StatusTabs.css'

interface GlobalSettings {
  llm_connections: { name: string; provider_url: string; api_key: string }[]
  story_roles: Record<RoleName, string>
}

type ConnectionStatus = 'unknown' | 'checking' | 'ok' | 'error'

export default function StatusTabs({ loading }: { loading: boolean }) {
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null)
  const [connStatus, setConnStatus] = useState<Record<string, ConnectionStatus>>({})
  const [openRole, setOpenRole] = useState<RoleName | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openRole) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenRole(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openRole])

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then((data: GlobalSettings) => setGlobalSettings(data))
  }, [])

  useEffect(() => {
    if (!globalSettings) return

    function checkAll() {
      if (!globalSettings) return
      for (const role of ROLE_NAMES) {
        const connName = globalSettings.story_roles[role]
        if (!connName) continue
        const conn = globalSettings.llm_connections.find(c => c.name === connName)
        if (!conn) continue

        setConnStatus(prev => ({ ...prev, [role]: 'checking' }))
        fetch('/api/check-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider_url: conn.provider_url, api_key: conn.api_key }),
        })
          .then(res => res.json())
          .then(data => {
            setConnStatus(prev => ({ ...prev, [role]: data.ok ? 'ok' : 'error' }))
          })
          .catch(() => {
            setConnStatus(prev => ({ ...prev, [role]: 'error' }))
          })
      }
    }

    checkAll()
    const interval = setInterval(checkAll, 30000)
    return () => clearInterval(interval)
  }, [globalSettings])

  if (!globalSettings) return null

  function getStatusForRole(role: RoleName): {
    assigned: boolean
    connName: string
    status: ConnectionStatus
  } {
    const connName = globalSettings!.story_roles[role] || ''
    const assigned = !!connName
    const status = connStatus[role] || 'unknown'
    return { assigned, connName, status }
  }

  return (
    <div className="status-tabs" ref={containerRef}>
      {ROLE_NAMES.map(role => {
        const info = getStatusForRole(role)
        const isOpen = openRole === role

        let dotClass = 'status-dot--unknown'
        if (loading) dotClass = 'status-dot--running'
        else if (!info.assigned) dotClass = 'status-dot--unassigned'
        else if (info.status === 'ok') dotClass = 'status-dot--ok'
        else if (info.status === 'error') dotClass = 'status-dot--error'
        else if (info.status === 'checking') dotClass = 'status-dot--checking'

        return (
          <div key={role} className="status-tab-group">
            <button
              className={`status-tab ${isOpen ? 'status-tab--open' : ''}`}
              onClick={() => setOpenRole(isOpen ? null : role)}
              title={ROLE_LABELS[role]}
            >
              <i className={`${ROLE_ICONS[role]} status-tab-icon`} />
              <span className={`status-dot ${dotClass}`} />
            </button>
            {isOpen && (
              <div className="status-box">
                <div className="status-box-header">
                  <i className={ROLE_ICONS[role]} />
                  <strong>{ROLE_LABELS[role]}</strong>
                </div>
                <dl className="status-box-fields">
                  <div className="status-field">
                    <dt>Connection</dt>
                    <dd>{info.connName || <span className="status-muted">not assigned</span>}</dd>
                  </div>
                  <div className="status-field">
                    <dt>Status</dt>
                    <dd>
                      {loading && <span className="status-badge status-badge--running"><i className="fa-solid fa-spinner fa-spin" /> Running</span>}
                      {!loading && !info.assigned && <span className="status-badge status-badge--unassigned">No connection</span>}
                      {!loading && info.assigned && info.status === 'ok' && <span className="status-badge status-badge--ok">Connected</span>}
                      {!loading && info.assigned && info.status === 'error' && <span className="status-badge status-badge--error">Unreachable</span>}
                      {!loading && info.assigned && info.status === 'checking' && <span className="status-badge status-badge--checking">Checking...</span>}
                      {!loading && info.assigned && info.status === 'unknown' && <span className="status-badge status-badge--checking">Pending</span>}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
