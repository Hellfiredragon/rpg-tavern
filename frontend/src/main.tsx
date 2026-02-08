import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Select all text when any text input receives focus
document.addEventListener('focusin', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'text') {
    e.target.select()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
