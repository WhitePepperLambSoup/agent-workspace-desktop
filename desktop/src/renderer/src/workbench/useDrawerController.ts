import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export type DrawerId = 'sessions' | 'inspector'

export function useDrawerController() {
  const [active, setActive] = useState<DrawerId | null>(null)
  const [narrow, setNarrow] = useState(() => typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 1023px)').matches : window.innerWidth < 1024)
  const opener = useRef<HTMLElement | null>(null)
  const activeRef = useRef<DrawerId | null>(null)
  const elements = useRef<Record<DrawerId, HTMLElement | null>>({ sessions: null, inspector: null })
  const close = useCallback((restore = true): void => {
    activeRef.current = null
    setActive(null)
    if (restore) opener.current?.focus()
  }, [])
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 1023px)')
    const update = (event: MediaQueryListEvent): void => {
      setNarrow(event.matches)
      if (!event.matches) close(false)
    }
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [close])
  const open = useCallback((id: DrawerId, element: HTMLElement): void => {
    if (activeRef.current === id) {
      close()
      return
    }
    opener.current = element
    activeRef.current = id
    setActive(id)
  }, [close])
  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && active) { event.preventDefault(); close() }
      if (event.key !== 'Tab' || !narrow || !active) return
      const drawer = elements.current[active]
      if (!drawer) return
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute('aria-hidden') && element.tabIndex >= 0)
      if (focusable.length === 0) { event.preventDefault(); drawer.focus(); return }
      const initial = focusable.find((element) => element.hasAttribute('data-drawer-initial-focus'))
      if (initial && focusable[0] !== initial) {
        focusable.splice(focusable.indexOf(initial), 1)
        focusable.unshift(initial)
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!drawer.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [active, close, narrow])
  useLayoutEffect(() => {
    if (!narrow || !active) return
    const drawer = elements.current[active]
    const initial = drawer?.querySelector<HTMLElement>('[data-drawer-initial-focus]')
      ?? drawer?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')
    ;(initial ?? drawer)?.focus()
  }, [active, narrow])
  const register = useCallback((id: DrawerId, element: HTMLElement | null): void => {
    elements.current[id] = element
  }, [])
  return { active, narrow, open, close, register }
}
