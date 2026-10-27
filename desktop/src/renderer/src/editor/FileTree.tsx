import { ChevronDown, ChevronRight, FileCode, FileText, Folder, FolderOpen, RefreshCw, Search } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { useOptionalI18n } from '../i18n/I18nProvider'

export interface WorkspaceFileItem {
  path: string
  name: string
  type: 'file' | 'directory'
  size: number
  modified: number
}

interface FileTreeProps {
  files: WorkspaceFileItem[]
  selectedPath?: string
  loading?: boolean
  onSelectFile: (path: string) => void
  onRefresh: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileTree({ files, selectedPath, loading = false, onSelectFile, onRefresh }: FileTreeProps) {
  const { t } = useOptionalI18n()
  const [filter, setFilter] = useState('')
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const set = new Set<string>()
    for (const f of files) {
      if (f.type === 'directory' && !f.path.includes('/')) {
        set.add(f.path)
      }
    }
    return set
  })

  const toggleExpand = (dirPath: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
      }
      return next
    })
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return files
    return files.filter((f) => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
  }, [files, filter])

  const visibleItems = useMemo(() => {
    if (filter.trim()) return filtered
    return filtered.filter((item) => {
      const parts = item.path.split('/')
      if (parts.length === 1) return true
      let current = ''
      for (let i = 0; i < parts.length - 1; i++) {
        current = current ? `${current}/${parts[i]}` : parts[i]
        if (!expanded.has(current)) return false
      }
      return true
    })
  }, [filtered, expanded, filter])

  const activeFocusPath = useMemo(() => {
    if (focusedPath && visibleItems.some((v) => v.path === focusedPath)) {
      return focusedPath
    }
    if (selectedPath && visibleItems.some((v) => v.path === selectedPath)) {
      return selectedPath
    }
    return visibleItems[0]?.path ?? ''
  }, [focusedPath, selectedPath, visibleItems])

  const handleKeyDown = (event: React.KeyboardEvent, index: number, item: WorkspaceFileItem): void => {
    const isDir = item.type === 'directory'
    const isExpanded = expanded.has(item.path)

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (index < visibleItems.length - 1) {
        const next = visibleItems[index + 1]
        setFocusedPath(next.path)
        nodeRefs.current.get(next.path)?.focus()
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (index > 0) {
        const prev = visibleItems[index - 1]
        setFocusedPath(prev.path)
        nodeRefs.current.get(prev.path)?.focus()
      }
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      if (isDir) {
        if (!isExpanded) {
          toggleExpand(item.path)
        } else if (index < visibleItems.length - 1) {
          const next = visibleItems[index + 1]
          setFocusedPath(next.path)
          nodeRefs.current.get(next.path)?.focus()
        }
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (isDir && isExpanded) {
        toggleExpand(item.path)
      } else {
        const lastSlash = item.path.lastIndexOf('/')
        if (lastSlash > 0) {
          const parentPath = item.path.slice(0, lastSlash)
          const parentItem = visibleItems.find((v) => v.path === parentPath)
          if (parentItem) {
            setFocusedPath(parentItem.path)
            nodeRefs.current.get(parentItem.path)?.focus()
          }
        }
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (isDir) {
        toggleExpand(item.path)
      } else {
        onSelectFile(item.path)
      }
    } else if (event.key === 'Home') {
      event.preventDefault()
      if (visibleItems.length > 0) {
        const first = visibleItems[0]
        setFocusedPath(first.path)
        nodeRefs.current.get(first.path)?.focus()
      }
    } else if (event.key === 'End') {
      event.preventDefault()
      if (visibleItems.length > 0) {
        const last = visibleItems[visibleItems.length - 1]
        setFocusedPath(last.path)
        nodeRefs.current.get(last.path)?.focus()
      }
    }
  }

  return (
    <aside className="file-tree-sidebar" aria-label={t('workspace.fileTree')}>
      <div className="file-tree-toolbar">
        <div className="file-tree-search">
          <Search size={13} />
          <input
            type="search"
            aria-label={t('workspace.filterFiles')}
            placeholder={t('workspace.filterFiles')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t('workspace.refreshFiles')}
          title={t('workspace.refreshFiles')}
          disabled={loading}
          onClick={onRefresh}
        >
          <RefreshCw size={14} className={loading ? 'spin-animation' : undefined} />
        </button>
      </div>

      <div className="file-tree-list" role="tree" aria-label={t('workspace.files')}>
        {visibleItems.length === 0 ? (
          <p className="file-tree-empty">{t('workspace.noFilesFound')}</p>
        ) : (
          visibleItems.map((item, index) => {
            const depth = item.path.split('/').length - 1
            const isDir = item.type === 'directory'
            const isExpanded = expanded.has(item.path)
            const isSelected = selectedPath === item.path
            const isItemFocused = activeFocusPath === item.path

            return (
              <div
                key={item.path}
                ref={(el) => {
                  if (el) nodeRefs.current.set(item.path, el)
                  else nodeRefs.current.delete(item.path)
                }}
                role="treeitem"
                tabIndex={isItemFocused ? 0 : -1}
                aria-selected={isSelected}
                aria-expanded={isDir ? isExpanded : undefined}
                className={`file-tree-node ${isSelected ? 'selected' : ''}`}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
                onFocus={() => setFocusedPath(item.path)}
                onKeyDown={(e) => handleKeyDown(e, index, item)}
                onClick={() => {
                  setFocusedPath(item.path)
                  if (isDir) {
                    toggleExpand(item.path)
                  } else {
                    onSelectFile(item.path)
                  }
                }}
              >
                <span className="file-tree-chevron">
                  {isDir ? (
                    isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
                  ) : (
                    <span style={{ width: 12, display: 'inline-block' }} />
                  )}
                </span>
                <span className="file-tree-icon">
                  {isDir ? (
                    isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />
                  ) : item.name.endsWith('.ts') || item.name.endsWith('.tsx') || item.name.endsWith('.js') || item.name.endsWith('.py') ? (
                    <FileCode size={14} />
                  ) : (
                    <FileText size={14} />
                  )}
                </span>
                <span className="file-tree-name" title={item.path}>
                  {item.name}
                </span>
                {!isDir && item.size > 0 ? (
                  <span className="file-tree-size">{formatBytes(item.size)}</span>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}

