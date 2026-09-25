import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const media = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

function current(): Theme {
  const stamped = document.documentElement.dataset.theme
  if (stamped === 'light' || stamped === 'dark') return stamped
  return media.matches ? 'dark' : 'light'
}

media.addEventListener('change', () => listeners.forEach((l) => l()))

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t
  try {
    localStorage.setItem('dg-theme', t)
  } catch {
    /* storage unavailable — the choice lasts for this page view */
  }
  listeners.forEach((l) => l())
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    current,
  )
}
