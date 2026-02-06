import { useCallback, useSyncExternalStore } from 'react'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'overlap-theme'
const DEFAULT_THEME: Theme = 'dark'

let listeners: Array<() => void> = []

function getSnapshot(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME
  return (localStorage.getItem(STORAGE_KEY) as Theme) ?? DEFAULT_THEME
}

function getServerSnapshot(): Theme {
  return DEFAULT_THEME
}

function subscribe(listener: () => void) {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme)
  document.documentElement.classList.toggle('dark', theme === 'dark')
  listeners.forEach((l) => l())
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [theme])

  return { theme, toggleTheme } as const
}
