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
                <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M11.078 0l.762 2.845a7.46 7.46 0 011.57.908l2.87-.678 1.078 1.868-2.11 2.166c.1.35.168.71.204 1.078l2.528 1.37v2.156l-2.528 1.37a7.46 7.46 0 01-.204 1.078l2.11 2.166-1.078 1.868-2.87-.678a7.46 7.46 0 01-1.57.908L11.078 20H8.922l-.762-2.845a7.46 7.46 0 01-1.57-.908l-2.87.678-1.078-1.868 2.11-2.166a7.46 7.46 0 01-.204-1.078L2 11.443V9.287l2.548-1.37a7.46 7.46 0 01.204-1.078L2.642 4.673 3.72 2.805l2.87.678a7.46 7.46 0 011.57-.908L8.922 0h2.156zM10 6.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z"/>
                </svg>
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
