/** Shared TypeScript types and constants. Data model types: Character, Persona,
 * ChatMessage, StoryRoles, StoryRoleConfig, LorebookEntryData. State constants:
 * CATEGORY_LIMITS, CATEGORY_MAX_VALUES, CATEGORY_DEFAULTS. Helpers: stateLevel(),
 * ROLE_NAMES, ROLE_LABELS, ROLE_ICONS. */
export type StateCategory = 'core' | 'persistent' | 'temporal'

export interface CharacterState {
  label: string
  value: number
}

export interface CharacterStates {
  core: CharacterState[]
  persistent: CharacterState[]
  temporal: CharacterState[]
}

export interface Character {
  name: string
  slug: string
  nicknames: string[]
  chattiness: number
  states: CharacterStates
  overflow_pending: boolean
}

export interface Persona {
  name: string
  slug: string
  nicknames: string[]
  description: string
  states: CharacterStates
  overflow_pending: boolean
  source: 'global' | 'adventure'
}

export interface LorebookEntryData {
  title: string
  content: string
  keywords: string[]
}

export interface ChatSegment {
  type: 'narration' | 'dialog'
  text: string
  character?: string
  emotion?: string
}

export interface ChatMessage {
  role: 'player' | 'narrator' | 'dialog' | 'intention'
  text: string
  ts: string
  segments?: ChatSegment[]
  character?: string
  emotion?: string
}

export interface StoryRoleConfig {
  prompt: string
  connection: string
}

export interface StoryRoles {
  narrator: StoryRoleConfig
  character_intention: StoryRoleConfig
  extractor: StoryRoleConfig
  lorebook_extractor: StoryRoleConfig
  max_rounds: number
  sandbox: boolean
}

export type RoleName = 'narrator' | 'character_intention' | 'extractor' | 'lorebook_extractor'

export const CATEGORY_LIMITS: Record<StateCategory, number> = { core: 3, persistent: 10, temporal: 10 }
export const CATEGORY_MAX_VALUES: Record<StateCategory, number | null> = { core: 30, persistent: 20, temporal: null }
export const CATEGORY_DEFAULTS: Record<StateCategory, number> = { core: 30, persistent: 20, temporal: 6 }

export function stateLevel(value: number): string {
  if (value < 6) return 'silent'
  if (value <= 10) return 'subconscious'
  if (value <= 15) return 'manifest'
  if (value <= 20) return 'dominant'
  return 'definitive'
}

export const ROLE_LABELS: Record<RoleName, string> = {
  narrator: 'Narrator',
  character_intention: 'Character Intention',
  extractor: 'Character Extractor',
  lorebook_extractor: 'Lorebook Extractor',
}

export const ROLE_ICONS: Record<RoleName, string> = {
  narrator: 'fa-solid fa-book-open',
  character_intention: 'fa-solid fa-feather',
  extractor: 'fa-solid fa-flask',
  lorebook_extractor: 'fa-solid fa-book',
}

export const ROLE_NAMES: RoleName[] = ['narrator', 'character_intention', 'extractor', 'lorebook_extractor']
