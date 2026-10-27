/* 1.6.1: Settings → AI Assistant (CEO only). One switch that turns the Assistant on or off for everyone.
 * The database keeps the setting (app_config.ai_assistant.enabled) and refuses changes from anyone else;
 * the ai-assistant edge function refuses questions while it is off. */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from './ui'
import { Icon } from './Icon'
import { toast } from './toast'
import { useAuth } from '../lib/auth'
import { useAiSwitchOn } from '../lib/config'
import { aiSetEnabled } from '../lib/ai'

export function AiSwitchCard() {
  const { session } = useAuth()
  const on = useAiSwitchOn()
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState<boolean | null>(null)
  const val = shown ?? on
  const flip = async () => {
    const next = !val
    setBusy(true); setShown(next)
    try {
      await aiSetEnabled(next, session?.user.id)
      toast(next ? 'Assistant turned on for everyone' : 'Assistant turned off for everyone')
    } catch (e) {
      setShown(null); toast((e as Error).message, 'err')
    } finally { setBusy(false); setTimeout(() => setShown(null), 1500) }
  }
  return (
    <Card title="AI Assistant" className="ai-sw-card">
      <div className="ai-sw-row">
        <span className={`ai-sw-ic${val ? ' on' : ''}`}><Icon name="spark" size={20} /></span>
        <div className="ai-sw-txt">
          <strong>Assistant for everyone</strong>
          <small className="muted" data-testid="ai-switch-state">{val
            ? 'On — the Assistant shows in the menu, search and “Ask Assistant” buttons.'
            : 'Off — hidden from every menu, search and button. Questions are refused.'}</small>
        </div>
        <button type="button" role="switch" aria-checked={val} aria-label="AI Assistant on or off" data-testid="ai-switch"
          className={`sw${val ? ' on' : ''}`} disabled={busy} onClick={() => void flip()}><span /></button>
      </div>
      <p className="small muted mt-s">Turning it off keeps the daily limit and saved drafts; turning it on again brings everything back. {val && <Link to="/assistant">Open Assistant</Link>}</p>
    </Card>
  )
}
