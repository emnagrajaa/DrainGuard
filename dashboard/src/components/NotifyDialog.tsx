import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { useNotifyCrews } from '../api/queries'
import type { Channel } from '../api/types'
import { CHANNEL_LABEL, SCOPES } from '../lib/domain'
import { useOps } from '../lib/ops'
import { Dialog, Segmented } from './ui'
import { useToast } from './Toasts'

const TEMPLATES = [
  {
    label: 'Pre-storm standby',
    text: 'Rain above 60% is forecast within 12 hours. Stand by at your depot and check pumps and jetting equipment.',
  },
  {
    label: 'Storm in progress',
    text: 'Storm in progress. Stay at your depot with phones on and wait for dispatch from the operations room.',
  },
  { label: 'All clear', text: 'The storm has passed. Resume normal patrols and report any standing water.' },
]

const MUNICIPALITIES = ['Tunis', 'Ariana', 'Sousse', 'Sfax', 'Nabeul']

/**
 * Sends a message to specific crews (teamIds) or to every on-duty crew in a
 * municipality / the whole network.
 */
export function NotifyDialog({ open, onClose, teamIds }: { open: boolean; onClose: () => void; teamIds?: string[] }) {
  const { scope, teams } = useOps()
  const notify = useNotifyCrews()
  const toast = useToast()
  const [target, setTarget] = useState('all')
  const [channel, setChannel] = useState<Channel>('sms')
  const [message, setMessage] = useState('')

  // Default the audience to the area the operator is looking at.
  useEffect(() => {
    if (!open) return
    const muni = SCOPES.find((s) => s.id === scope)?.municipalities
    setTarget(muni?.length === 1 ? muni[0] : 'all')
  }, [open, scope])

  const close = () => {
    setMessage('')
    notify.reset()
    onClose()
  }

  const fixed = teamIds && teamIds.length > 0
  const audience = fixed
    ? teamIds!.join(', ')
    : target === 'all'
      ? `${teams.filter((t) => t.status !== 'off_duty').length} on-duty crews`
      : `${teams.filter((t) => t.status !== 'off_duty' && t.municipality === target).length} on-duty crews in ${target}`

  const send = () =>
    notify.mutate(
      {
        message: message.trim(),
        channel,
        ...(fixed ? { team_ids: teamIds } : target === 'all' ? {} : { municipality: target }),
      },
      {
        onSuccess: (sent) => {
          toast({ tone: 'good', title: `Message sent to ${sent.length} crew${sent.length === 1 ? '' : 's'}`, body: `By ${CHANNEL_LABEL[channel]}.` })
          close()
        },
      },
    )

  return (
    <Dialog
      open={open}
      onClose={close}
      title={fixed ? `Message ${teamIds!.join(', ')}` : 'Message crews'}
      sub="Crew leads receive the message on their phone or radio."
      footer={
        <>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!message.trim() || notify.isPending} onClick={send}>
            <Send size={14} aria-hidden />
            Send to {audience}
          </button>
        </>
      }
    >
      {!fixed && (
        <label className="field">
          <span className="field__label">Send to</span>
          <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="all">All on-duty crews</option>
            {MUNICIPALITIES.map((m) => (
              <option key={m} value={m}>
                On-duty crews in {m}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="field">
        <span className="field__label">Channel</span>
        <Segmented<Channel>
          label="Channel"
          value={channel}
          onChange={setChannel}
          options={(['sms', 'whatsapp', 'radio'] as Channel[]).map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))}
        />
      </div>
      <label className="field">
        <span className="field__label">Message</span>
        <textarea className="textarea" value={message} maxLength={480} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <div className="templates">
        <span className="muted small">Templates</span>
        {TEMPLATES.map((t) => (
          <button key={t.label} type="button" className="template" onClick={() => setMessage(t.text)}>
            {t.label}
          </button>
        ))}
      </div>
      {notify.error && <p className="form-error">{notify.error.message}</p>}
    </Dialog>
  )
}
