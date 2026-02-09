import type { ReactNode } from 'react'
import './Layout.css'

interface LayoutProps {
  children: ReactNode
  adventureName?: string | null
  onBack?: () => void
  onSettings?: () => void
  appWidthPercent?: number
}

export default function Layout({ children, adventureName, onBack, onSettings, appWidthPercent }: LayoutProps) {
  const widthStyle = appWidthPercent && appWidthPercent < 100
    ? { maxWidth: `${appWidthPercent}%` } as const
    : undefined

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
            {onSettings && (
              <button className="btn-gear" onClick={onSettings} title="Settings">
                <i className="fa-solid fa-gear" />
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
