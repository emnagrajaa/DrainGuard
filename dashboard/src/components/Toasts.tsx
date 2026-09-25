import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { CircleCheck, Info, Waves, X } from 'lucide-react'

type ToastTone = 'accent' | 'critical' | 'serious' | 'good'

interface Toast {
  id: number
  tone: ToastTone
  title: string
  body?: string
  action?: { label: string; onClick: () => void }
}

type PushToast = (t: Omit<Toast, 'id'>) => void

const ToastContext = createContext<PushToast>(() => {})

export const useToast = () => useContext(ToastContext)

const ICON = { accent: Info, critical: Waves, serious: Info, good: CircleCheck }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])

  const push = useCallback<PushToast>(
    (t) => {
      const id = nextId.current++
      setToasts((ts) => [...ts.slice(-2), { ...t, id }])
      window.setTimeout(() => dismiss(id), t.tone === 'critical' ? 9000 : 5000)
    },
    [dismiss],
  )

  const value = useMemo(() => push, [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICON[t.tone]
          return (
            <div key={t.id} className={`toast toast--${t.tone}`}>
              <Icon size={18} aria-hidden style={{ color: `var(--${t.tone === 'accent' ? 'accent' : t.tone})` }} />
              <div>
                <div className="toast__title">{t.title}</div>
                {t.body && <div className="toast__body">{t.body}</div>}
                {t.action && (
                  <button
                    type="button"
                    className="link-btn"
                    style={{ marginTop: 4 }}
                    onClick={() => {
                      t.action!.onClick()
                      dismiss(t.id)
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
