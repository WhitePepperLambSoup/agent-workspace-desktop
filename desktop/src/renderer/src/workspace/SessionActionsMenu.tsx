import { Archive, Download, MoreHorizontal, PencilLine, Pin, PinOff, Smartphone } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import { useOptionalI18n } from '../i18n/I18nProvider'

export interface SessionMenuActions {
  onRename?: () => void
  onTogglePin?: () => void
  onArchive?: () => void
  onExport?: () => void
  /** Put the conversation in a paired phone's inbox, to go on with it there. */
  onContinueOnPhone?: () => void
}

interface MenuItem { key: string; label: string; icon: React.ReactNode; run: () => void }

/** The "more" button and menu for one sidebar session. */
export function SessionActionsMenu({ title, pinned, actions, open, onOpenChange }: {
  title: string
  pinned: boolean
  actions: SessionMenuActions
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useOptionalI18n()
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const candidates: Array<MenuItem | null> = [
    actions.onRename ? { key: 'rename', label: t('workspace.renameSession'), icon: <PencilLine size={14} />, run: actions.onRename } : null,
    actions.onTogglePin ? { key: 'pin', label: t(pinned ? 'workspace.unpin' : 'workspace.pin'), icon: pinned ? <PinOff size={14} /> : <Pin size={14} />, run: actions.onTogglePin } : null,
    actions.onExport ? { key: 'export', label: t('workspace.exportSession'), icon: <Download size={14} />, run: actions.onExport } : null,
    actions.onContinueOnPhone ? { key: 'phone', label: t('devices.continueOnPhone'), icon: <Smartphone size={14} />, run: actions.onContinueOnPhone } : null,
    actions.onArchive ? { key: 'archive', label: t('workspace.archive'), icon: <Archive size={14} />, run: actions.onArchive } : null,
  ]
  const items = candidates.filter((item): item is MenuItem => item !== null)

  useEffect(() => {
    if (!open) return
    setFocusIndex(0)
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) onOpenChange(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, onOpenChange])

  if (items.length === 0) return null

  const close = (restoreFocus: boolean): void => {
    onOpenChange(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }
  const moveFocus = (index: number): void => {
    const next = (index + items.length) % items.length
    setFocusIndex(next)
    menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[next]?.focus()
  }
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(focusIndex + 1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(focusIndex - 1) }
    else if (event.key === 'Home') { event.preventDefault(); moveFocus(0) }
    else if (event.key === 'End') { event.preventDefault(); moveFocus(items.length - 1) }
    else if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); close(event.key === 'Escape') }
  }

  return (
    <>
      <button ref={triggerRef} type="button" className="session-row-more icon-button"
        aria-label={t('workspace.moreActions')} title={t('workspace.moreActions')}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        data-open={open ? 'true' : undefined}
        onClick={() => onOpenChange(!open)}>
        <MoreHorizontal size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div ref={menuRef} id={menuId} className="session-actions-menu" role="menu" aria-label={t('workspace.sessionActions', { title })} onKeyDown={onMenuKeyDown}>
          {items.map((item, index) => (
            <button key={item.key} type="button" role="menuitem" tabIndex={index === focusIndex ? 0 : -1}
              data-action={item.key}
              onClick={() => { close(item.key !== 'rename'); item.run() }}>
              {item.icon}<span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  )
}
