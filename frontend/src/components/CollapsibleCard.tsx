import { type ReactNode } from 'react'
import './CollapsibleCard.css'

interface CollapsibleCardProps {
  expanded: boolean
  onToggle(): void
  name: string
  badges?: ReactNode
  stateCount: number
  children: ReactNode
}

export default function CollapsibleCard({ expanded, onToggle, name, badges, stateCount, children }: CollapsibleCardProps) {
  return (
    <div className="character-card">
      <div className="character-card-header" onClick={onToggle}>
        <i className={`fa-solid ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'} character-expand-icon`} />
        <span className="character-name">{name}</span>
        {badges}
        <span className="character-state-count">{stateCount} states</span>
      </div>
      {expanded && (
        <div className="character-card-body">
          {children}
        </div>
      )}
    </div>
  )
}
