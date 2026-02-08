import type { ReactNode } from 'react'
import './Layout.css'

interface LayoutProps {
  children: ReactNode
  adventureName?: string | null
  onBack?: () => void
}

export default function Layout({ children, adventureName, onBack }: LayoutProps) {
  return (
    <div className="layout">
      <header className="header">
        <div className="header-inner">
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
          {onBack && (
            <button className="btn btn-ghost btn-sm" onClick={onBack}>
              Quest Board
            </button>
          )}
        </div>
      </header>

      <main className="main">
        {children}
      </main>

      <footer className="footer">
        <span className="footer-text">Gather your party and venture forth</span>
      </footer>
    </div>
  )
}
