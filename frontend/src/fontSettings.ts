export const FONT_LIST = [
  { name: 'Crimson Text', category: 'serif' },
  { name: 'Cinzel', category: 'serif' },
  { name: 'Cinzel Decorative', category: 'display' },
  { name: 'EB Garamond', category: 'serif' },
  { name: 'Inter', category: 'sans-serif' },
  { name: 'JetBrains Mono', category: 'monospace' },
  { name: 'Lato', category: 'sans-serif' },
  { name: 'Libre Baskerville', category: 'serif' },
  { name: 'Lora', category: 'serif' },
  { name: 'MedievalSharp', category: 'display' },
  { name: 'Merriweather', category: 'serif' },
  { name: 'Source Sans 3', category: 'sans-serif' },
  { name: 'Spectral', category: 'serif' },
] as const

export const FONT_GROUPS = ['narration', 'dialog', 'intention', 'heading', 'ui'] as const

export type FontGroup = (typeof FONT_GROUPS)[number]

export interface FontGroupSettings {
  family: string
  size: number
  style: 'normal' | 'italic'
}

export type FontSettings = Record<FontGroup, FontGroupSettings>

const FALLBACKS: Record<string, string> = {
  serif: 'Georgia, serif',
  'sans-serif': 'system-ui, sans-serif',
  monospace: 'monospace',
  display: 'Georgia, serif',
}

export const FONT_GROUP_LABELS: Record<FontGroup, string> = {
  narration: 'Narration',
  dialog: 'Dialog',
  intention: 'Player / Intention',
  heading: 'Headings',
  ui: 'UI',
}

export function applyFontSettings(fs: FontSettings) {
  const el = document.documentElement
  for (const group of FONT_GROUPS) {
    const g = fs[group]
    const font = FONT_LIST.find(f => f.name === g.family)
    const fallback = font ? FALLBACKS[font.category] : 'Georgia, serif'
    el.style.setProperty(`--font-${group}-family`, `'${g.family}', ${fallback}`)
    el.style.setProperty(`--font-${group}-size`, `${g.size}px`)
    el.style.setProperty(`--font-${group}-style`, g.style)
  }
  // Keep aliases for backward compat
  el.style.setProperty('--font-heading', el.style.getPropertyValue('--font-heading-family'))
  el.style.setProperty('--font-body', el.style.getPropertyValue('--font-ui-family'))
}
