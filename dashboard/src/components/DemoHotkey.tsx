import { useEffect, useRef } from 'react'
import { KHADRA_NODE_ID, useToggleKhadra } from '../api/queries'
import { useOps } from '../lib/ops'
import { useToast } from './Toasts'

/**
 * Pitch control: P toggles the staged flood warning at El Khadra (Tunis).
 * First press raises it and flies the map there; the next press removes it
 * and the map goes back to the empty whole-area view. Ignored while typing,
 * in a dialog, with modifier keys (Ctrl+P still prints) or while a toggle is
 * still in flight.
 */
export function DemoHotkey() {
  const { focusNode, nodeById, selectedNodeId, openNode } = useOps()
  const toggle = useToggleKhadra()
  const toast = useToast()
  const latest = useRef({ focusNode, openNode, mutate: toggle.mutate, pending: toggle.isPending, on: false, selectedNodeId, toast })
  latest.current = {
    focusNode,
    openNode,
    mutate: toggle.mutate,
    pending: toggle.isPending,
    on: nodeById.has(KHADRA_NODE_ID),
    selectedNodeId,
    toast,
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'p' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('dialog[open]')) return
      const { focusNode, openNode, mutate, pending, on, selectedNodeId, toast } = latest.current
      e.preventDefault()
      if (pending) return

      if (on && selectedNodeId === KHADRA_NODE_ID) openNode(null)
      mutate(!on, {
        onSuccess: () => focusNode(on ? null : KHADRA_NODE_ID),
        onError: (err) =>
          toast({
            tone: 'critical',
            title: on ? "Couldn't clear the El Khadra alert" : "Couldn't raise the El Khadra alert",
            body: /method not allowed|not found/i.test(err.message) ? 'Restart the cloud API to load the latest demo endpoints.' : err.message,
          }),
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return null
}
