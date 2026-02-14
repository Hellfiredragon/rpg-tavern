import { type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { type StateCategory, type CharacterStates, CATEGORY_MAX_VALUES, CATEGORY_DEFAULTS } from '../types'

export default function useEntityStates<T extends { slug: string; states: CharacterStates }>(
  items: T[],
  setItems: Dispatch<SetStateAction<T[]>>,
  patchEntity: (slug: string, body: Record<string, unknown>) => void,
  debounceRefs: MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>,
) {
  function removeState(slug: string, category: StateCategory, index: number) {
    const entity = items.find(e => e.slug === slug)
    if (!entity) return
    const newList = entity.states[category].filter((_, i) => i !== index)
    setItems(prev => prev.map(e => e.slug === slug ? { ...e, states: { ...e.states, [category]: newList } } : e))
    patchEntity(slug, { states: { [category]: newList } })
  }

  function addState(slug: string, category: StateCategory, label: string) {
    const entity = items.find(e => e.slug === slug)
    if (!entity) return
    const newList = [...entity.states[category], { label, value: CATEGORY_DEFAULTS[category] }]
    setItems(prev => prev.map(e => e.slug === slug ? { ...e, states: { ...e.states, [category]: newList } } : e))
    patchEntity(slug, { states: { [category]: newList } })
  }

  function changeStateValue(slug: string, category: StateCategory, index: number, rawValue: number) {
    const entity = items.find(e => e.slug === slug)
    if (!entity) return
    const cap = CATEGORY_MAX_VALUES[category]
    const value = cap !== null && rawValue > cap ? cap : rawValue
    const newList = entity.states[category].map((s, i) => i === index ? { ...s, value } : s)
    setItems(prev => prev.map(e => e.slug === slug ? { ...e, states: { ...e.states, [category]: newList } } : e))
    const key = `${slug}-${category}-${index}`
    const existing = debounceRefs.current.get(key)
    if (existing) clearTimeout(existing)
    debounceRefs.current.set(key, setTimeout(() => {
      patchEntity(slug, { states: { [category]: newList } })
      debounceRefs.current.delete(key)
    }, 400))
  }

  return { removeState, addState, changeStateValue }
}
