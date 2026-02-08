import type { ReactNode } from 'react'
import './Layout.css'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="layout">
      <header className="header">
        <div className="header-inner">
          <h1 className="logo">RPG Tavern</h1>
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
