/** Sliding help panel with template variable reference for Handlebars prompts. */
import { useEffect, useState } from 'react'
import './PromptHintsPanel.css'

interface VarLeaf {
  name: string
  type: string
  desc: string
  subfields?: VarLeaf[]
}

interface VarGroup {
  key: string
  label: string
  desc: string
  children: VarLeaf[]
}

const TOP_LEVEL_VARS: VarLeaf[] = [
  { name: 'title', type: 'string', desc: 'Adventure title' },
  { name: 'description', type: 'string', desc: 'Adventure premise' },
  { name: 'player_name', type: 'string', desc: 'Player character name' },
  { name: 'message', type: 'string', desc: 'Current player message' },
  { name: 'history', type: 'string', desc: 'Pre-formatted history' },
  { name: 'intention', type: 'string', desc: 'Current intention being resolved' },
  { name: 'narration', type: 'string', desc: 'Narrator response text' },
]

const VAR_GROUPS: VarGroup[] = [
  {
    key: 'player', label: 'player', desc: 'Active persona',
    children: [
      { name: 'player.description', type: 'string', desc: 'Persona description' },
      { name: 'player.states', type: 'array', desc: 'Persona visible states (value \u2265 6)', subfields: [
        { name: '.label', type: 'string', desc: 'State name' },
        { name: '.value', type: 'number', desc: 'Numeric value' },
        { name: '.category', type: 'string', desc: '"core", "persistent", or "temporal"' },
        { name: '.level', type: 'string', desc: '"subconscious", "manifest", "dominant", "definitive"' },
        { name: '.description', type: 'string', desc: 'Threshold description text' },
      ]},
    ],
  },
  {
    key: 'char', label: 'char', desc: 'Current character',
    children: [
      { name: 'char.name', type: 'string', desc: 'Character name' },
      { name: 'char.description', type: 'string', desc: 'Character personality' },
      { name: 'char.states', type: 'array', desc: 'Visible states (value \u2265 6)', subfields: [
        { name: '.label', type: 'string', desc: 'State name' },
        { name: '.value', type: 'number', desc: 'Numeric value' },
        { name: '.category', type: 'string', desc: '"core", "persistent", or "temporal"' },
        { name: '.level', type: 'string', desc: '"subconscious", "manifest", "dominant", "definitive"' },
        { name: '.description', type: 'string', desc: 'Threshold description text' },
        { name: '.is_subconscious', type: 'boolean', desc: 'Value 6\u201310' },
        { name: '.is_manifest', type: 'boolean', desc: 'Value 11\u201315' },
        { name: '.is_dominant', type: 'boolean', desc: 'Value 16\u201320' },
        { name: '.is_definitive', type: 'boolean', desc: 'Value 21\u201330' },
      ]},
      { name: 'char.all_states', type: 'array', desc: 'All states incl. silent (extractor)', subfields: [
        { name: '.label', type: 'string', desc: 'State name' },
        { name: '.value', type: 'number', desc: 'Numeric value' },
        { name: '.category', type: 'string', desc: '"core", "persistent", or "temporal"' },
        { name: '.level', type: 'string', desc: '"silent", "subconscious", "manifest", "dominant", "definitive"' },
        { name: '.is_silent', type: 'boolean', desc: 'Value 0\u20135' },
      ]},
    ],
  },
  {
    key: 'chars', label: 'chars', desc: 'All characters',
    children: [
      { name: 'chars.list', type: 'array', desc: 'Character objects (.name, .descriptions)' },
      { name: 'chars.summary', type: 'string', desc: 'Pre-formatted character states' },
      { name: 'chars.active', type: 'array', desc: 'Active characters this round' },
      { name: 'chars.active_summary', type: 'string', desc: 'Active characters summary' },
    ],
  },
  {
    key: 'turn', label: 'turn', desc: 'Current turn',
    children: [
      { name: 'turn.narration', type: 'string', desc: 'All narration this turn so far' },
      { name: 'turn.round_narrations', type: 'string', desc: 'All round narrations' },
    ],
  },
  {
    key: 'lore', label: 'lore', desc: 'Lorebook',
    children: [
      { name: 'lore.text', type: 'string', desc: 'Pre-formatted matched entries' },
      { name: 'lore.entries', type: 'array', desc: 'Matched entry objects' },
    ],
  },
  {
    key: 'msgs', label: 'msgs', desc: 'Message history (array)',
    children: [
      { name: '.role', type: 'string', desc: '"player" or "narrator"' },
      { name: '.text', type: 'string', desc: 'Content' },
      { name: '.ts', type: 'string', desc: 'ISO timestamp' },
      { name: '.is_player', type: 'boolean', desc: 'Boolean flag' },
      { name: '.is_narrator', type: 'boolean', desc: 'Boolean flag' },
    ],
  },
]

function HintGroup({ group }: { group: VarGroup }) {
  const [expanded, setExpanded] = useState(false)
  const isArray = group.desc.includes('array')
  return (
    <div className="hint-group">
      <button className="hint-group-toggle" onClick={() => setExpanded(!expanded)}>
        <i className={`fa-solid ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'} hint-group-chevron`} />
        <code>{'{{' + group.label + '}}'}</code>
        <span className="hint-type">{isArray ? 'array' : 'object'}</span>
        <span className="hint-group-desc">{group.desc}</span>
      </button>
      {expanded && (
        <dl className="hint-vars hint-vars--nested">
          {group.children.map(v => (
            <div key={v.name} className="hint-var">
              <dt>
                <code>{v.name.startsWith('.') ? v.name : '{{' + v.name + '}}'}</code>
                <span className="hint-type">{v.type}</span>
              </dt>
              <dd>{v.desc}</dd>
              {v.subfields && (
                <dl className="hint-vars hint-vars--nested">
                  {v.subfields.map(sf => (
                    <div key={sf.name} className="hint-var">
                      <dt>
                        <code>{sf.name}</code>
                        <span className="hint-type">{sf.type}</span>
                      </dt>
                      <dd>{sf.desc}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

export default function PromptHintsPanel() {
  const [open, setOpen] = useState(false)
  const [widthPct, setWidthPct] = useState(25)

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.help_panel_width_percent) setWidthPct(data.help_panel_width_percent)
      })
  }, [])

  useEffect(() => {
    const el = document.documentElement
    if (open) {
      el.style.setProperty('--hint-panel-width', `${widthPct}%`)
      el.classList.add('hint-panel-open')
    } else {
      el.style.setProperty('--hint-panel-width', '0px')
      el.classList.remove('hint-panel-open')
    }
    return () => {
      el.style.setProperty('--hint-panel-width', '0px')
      el.classList.remove('hint-panel-open')
    }
  }, [open, widthPct])

  if (!open) {
    return (
      <div className="hint-panel">
        <button className="hint-panel-toggle" onClick={() => setOpen(true)} title="Template help">
          <span className="hint-panel-label">Help</span>
        </button>
      </div>
    )
  }

  return (
    <div className="hint-panel hint-panel--open" style={{ width: `${widthPct}%` }}>
      <div className="hint-panel-header">
        <h3>Template Help</h3>
        <button className="hint-panel-close" onClick={() => setOpen(false)} title="Close">
          <i className="fa-solid fa-xmark" />
        </button>
      </div>
      <div className="hint-panel-body">
        <h4>Template Variables</h4>
        <p className="hint-intro">Use Handlebars syntax in prompt templates.</p>

        <dl className="hint-vars">
          {TOP_LEVEL_VARS.map(v => (
            <div key={v.name} className="hint-var">
              <dt>
                <code>{'{{' + v.name + '}}'}</code>
                <span className="hint-type">{v.type}</span>
              </dt>
              <dd>{v.desc}</dd>
            </div>
          ))}
        </dl>

        {VAR_GROUPS.map(g => <HintGroup key={g.key} group={g} />)}

        <h4>Block Helpers</h4>
        <dl className="hint-vars">
          <div className="hint-var">
            <dt><code>{'{{#take arr N}}...{{/take}}'}</code></dt>
            <dd>Iterate over the first N items of an array</dd>
          </div>
          <div className="hint-var">
            <dt><code>{'{{#last arr N}}...{{/last}}'}</code></dt>
            <dd>Iterate over the last N items of an array</dd>
          </div>
        </dl>
        <pre className="hint-example">{'{{#last msgs 5}}\n{{#if is_player}}> {{text}}{{else}}{{text}}{{/if}}\n{{/last}}'}</pre>

        <h4>Examples</h4>
        <pre className="hint-example">{'{{#each msgs}}\n{{#if is_player}}> {{text}}{{else}}{{text}}{{/if}}\n{{/each}}'}</pre>
        <pre className="hint-example">{'{{#take chars.list 3}}\n{{name}}: {{descriptions}}\n{{/take}}'}</pre>
      </div>
    </div>
  )
}
