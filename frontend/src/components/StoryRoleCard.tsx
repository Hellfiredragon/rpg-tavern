import { useEffect, useRef, useState } from 'react'
import { type RoleName, type StoryRoleConfig, ROLE_ICONS, ROLE_LABELS } from '../types'
import './StoryRoleCard.css'

export default function StoryRoleCard({
  role,
  config,
  connectionNames,
  onPromptChange,
  onConnectionChange,
}: {
  role: RoleName
  config: StoryRoleConfig
  connectionNames: string[]
  onPromptChange: (prompt: string) => void
  onConnectionChange: (connection: string) => void
}) {
  const [promptValue, setPromptValue] = useState(config.prompt)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    setPromptValue(config.prompt)
  }, [config.prompt])

  function handlePromptChange(value: string) {
    setPromptValue(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onPromptChange(value), 500)
  }

  return (
    <div className="story-role-card">
      <div className="story-role-header">
        <h4>
          <i className={`${ROLE_ICONS[role]} story-role-icon`} />
          {ROLE_LABELS[role]}
        </h4>
        <select
          value={config.connection}
          onChange={e => onConnectionChange(e.target.value)}
        >
          <option value="">Default</option>
          {connectionNames.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
      <textarea
        className="prompt-editor"
        value={promptValue}
        onChange={e => handlePromptChange(e.target.value)}
        placeholder="Handlebars prompt template..."
        rows={8}
      />
    </div>
  )
}
