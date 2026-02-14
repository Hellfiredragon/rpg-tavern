/** Renders core/persistent/temporal state sections with value sliders and add/remove controls. */
import { type StateCategory, type CharacterStates, CATEGORY_LIMITS, stateLevel } from '../types'
import AddStateInput from './AddStateInput'
import './StateEditor.css'

interface StateEditorProps {
  states: CharacterStates
  onRemoveState(cat: StateCategory, idx: number): void
  onAddState(cat: StateCategory, label: string): void
  onChangeValue(cat: StateCategory, idx: number, raw: number): void
}

export default function StateEditor({ states, onRemoveState, onAddState, onChangeValue }: StateEditorProps) {
  return (
    <>
      {(['core', 'persistent', 'temporal'] as StateCategory[]).map(category => (
        <div key={category} className="character-states-section">
          <h5>
            {category}
            <span className="slot-count">{states[category].length}/{CATEGORY_LIMITS[category]}</span>
          </h5>
          {states[category].map((state, i) => (
            <div key={i} className="state-row">
              <span className="state-label">{state.label}</span>
              <input
                type="number"
                className={`state-value-input state-level--${stateLevel(state.value)}`}
                value={state.value}
                onChange={e => onChangeValue(category, i, parseInt(e.target.value) || 0)}
              />
              <button className="state-remove" onClick={() => onRemoveState(category, i)} title="Remove state">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          ))}
          <AddStateInput onAdd={label => onAddState(category, label)} />
        </div>
      ))}
    </>
  )
}
