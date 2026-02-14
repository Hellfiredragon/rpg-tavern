import { useEffect, useRef, useState } from 'react'
import { type RoleName, type StoryRoleConfig, ROLE_ICONS, ROLE_LABELS } from '../types'
import './StoryRoleCard.css'

export default function StoryRoleCard({
  role,
  config,
  onPromptChange,
}: {
  role: RoleName
  config: StoryRoleConfig
  onPromptChange: (prompt: string) => void
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
