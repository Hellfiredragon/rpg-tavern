/** App entry point. Mounts React root, imports Font Awesome CSS, and sets up
 * global focus-select behavior for text inputs. */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fortawesome/fontawesome-free/css/fontawesome.min.css'
import '@fortawesome/fontawesome-free/css/solid.min.css'
import './index.css'
import App from './App.tsx'

// Select all text when any text input receives focus
document.addEventListener('focusin', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'text') {
    e.target.select()
  }
})

// Tab inserts two spaces in all textareas
document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && e.target instanceof HTMLTextAreaElement) {
    e.preventDefault()
    const ta = e.target
    const start = ta.selectionStart
    const end = ta.selectionEnd
    ta.setRangeText('  ', start, end, 'end')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
