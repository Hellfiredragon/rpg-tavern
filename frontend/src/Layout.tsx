/** App shell with header breadcrumb (adventure name + back link). Applies font
 * settings from /api/settings on mount and sets --app-width CSS variable. */
import { useEffect, type ReactNode } from 'react'
import { applyFontSettings, type FontSettings } from './fontSettings'
import './Layout.css'

interface LayoutProps {
  children: ReactNode
  adventureName?: string | null
  onBack?: () => void
  appWidthPercent?: number
}

export default function Layout({ children, adventureName, onBack, appWidthPercent }: LayoutProps) {
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then((data: { font_settings?: FontSettings }) => {
        if (data.font_settings) applyFontSettings(data.font_settings)
      })
      .catch(() => {})
  }, [])

  const pct = appWidthPercent ?? 100
  const widthStyle = pct < 100
    ? { maxWidth: `${pct}%` } as const
    : { maxWidth: 'none' } as const

  return (
    <div className="layout">
      <header className="header">
        <div className="header-inner" style={widthStyle}>
          <div className="header-breadcrumb">
            <h1 className="logo" onClick={onBack} style={onBack ? { cursor: 'pointer' } : undefined}>
              RPG Tavern
            </h1>
            {adventureName && (
              <>
                <span className="breadcrumb-sep">/</span>
                <span className="breadcrumb-adventure">{adventureName}</span>
              </>
            )}
          </div>
          <div className="header-actions">
            {onBack && (
              <button className="btn btn-ghost btn-sm" onClick={onBack}>
                Quest Board
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="main" style={widthStyle}>
        {children}
      </main>

      <footer className="footer">
        <span className="footer-text">Gather your party and venture forth</span>
      </footer>
    </div>
  )
}
