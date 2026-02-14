import { useEffect, useRef, useState } from 'react'
import './TemplateSettingsPanel.css'

interface ItemData {
  title: string
  slug: string
  description: string
  intro?: string
  player_name?: string
  active_persona?: string
}

export default function TemplateSettingsPanel({
  slug,
  data,
  setData,
}: {
  slug: string
  data: ItemData
  setData: (d: ItemData) => void
}) {
  const [intro, setIntro] = useState(data.intro || '')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    setIntro(data.intro || '')
  }, [data.intro])

  function handleIntroChange(value: string) {
    setIntro(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetch(`/api/templates/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intro: value }),
      }).then(res => {
        if (res.ok) res.json().then(setData)
      })
    }, 500)
  }

  return (
    <div className="template-settings-panel">
      <h3 className="panel-heading">Template Settings</h3>
      <div className="template-intro-section">
        <label>
          <strong>Intro Text</strong>
          <p className="template-intro-hint">
            Shown as the first narrator message when a player embarks on this template.
          </p>
          <textarea
            className="prompt-editor"
            value={intro}
            onChange={e => handleIntroChange(e.target.value)}
            placeholder="A narrator introduction that sets the scene..."
            rows={5}
          />
        </label>
      </div>
    </div>
  )
}
