import { FitAddon } from '@xterm/addon-fit'
import { type ITheme, Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

// The ANSI colors of VS Code's light and dark terminals: readable on either background.
const LIGHT: ITheme = {
  black: '#000000', red: '#cd3131', green: '#00bc00', yellow: '#949800',
  blue: '#0451a5', magenta: '#bc05bc', cyan: '#0598bc', white: '#555555',
  brightBlack: '#666666', brightRed: '#cd3131', brightGreen: '#14ce14', brightYellow: '#b5ba00',
  brightBlue: '#0451a5', brightMagenta: '#bc05bc', brightCyan: '#0598bc', brightWhite: '#a5a5a5',
}
const DARK: ITheme = {
  black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
  blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543',
  brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#e5e5e5',
}

function channels(color: string): number[] {
  return (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
}

function luminance(color: string): number {
  const [red = 0, green = 0, blue = 0] = channels(color)
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
}

/** The app's own text and accent colors, resolved (they may be color-mix() expressions). */
export function terminalTheme(host: HTMLElement): ITheme {
  const probe = host.ownerDocument.createElement('span')
  probe.hidden = true
  host.appendChild(probe)
  const resolve = (variable: string, fallback: string): string => {
    probe.style.color = fallback
    probe.style.color = `var(${variable}, ${fallback})`
    return getComputedStyle(probe).color || fallback
  }
  try {
    const foreground = resolve('--text', '#1d1d1f')
    const accent = resolve('--accent', '#2f6fde')
    const [red = 47, green = 111, blue = 222] = channels(accent)
    return {
      ...(luminance(foreground) > 0.5 ? DARK : LIGHT),
      background: 'rgba(0, 0, 0, 0)',
      foreground,
      cursor: accent,
      cursorAccent: foreground,
      selectionBackground: `rgba(${red}, ${green}, ${blue}, 0.3)`,
    }
  } finally {
    probe.remove()
  }
}

/** xterm writes its colors and cell sizes into <style> elements, which this window's content
 * security policy refuses. While it opens, those elements are made as stand-ins whose text goes
 * into stylesheets the document adopts instead (allowed, as for the code editor). */
function openWithAdoptedStyles(terminal: Terminal, host: HTMLElement): () => void {
  const page = host.ownerDocument
  const sheets: CSSStyleSheet[] = []
  const drop = (sheet: CSSStyleSheet): void => {
    page.adoptedStyleSheets = page.adoptedStyleSheets.filter((item) => item !== sheet)
  }
  const original = page.createElement.bind(page) as (tagName: string, options?: ElementCreationOptions) => HTMLElement
  page.createElement = function createElement(tagName: string, options?: ElementCreationOptions) {
    if (tagName.toLowerCase() !== 'style') return original(tagName, options)
    const standIn = original('template')
    const sheet = new CSSStyleSheet()
    sheets.push(sheet)
    page.adoptedStyleSheets = [...page.adoptedStyleSheets, sheet]
    let text = ''
    Object.defineProperty(standIn, 'textContent', {
      get: () => text,
      set: (value: string | null) => {
        text = value ?? ''
        sheet.replaceSync(text)
      },
    })
    const remove = standIn.remove.bind(standIn)
    standIn.remove = () => {
      drop(sheet)
      remove()
    }
    return standIn
  } as Document['createElement']
  try {
    terminal.open(host)
  } finally {
    Reflect.deleteProperty(page, 'createElement')
  }
  return () => sheets.forEach(drop)
}

export interface TerminalHost {
  terminal: Terminal
  /** Fits the terminal to its box; the new size, or null while the box is hidden. */
  fit(): { columns: number; rows: number } | null
  dispose(): void
}

export function createTerminalHost(host: HTMLElement): TerminalHost {
  const terminal = new Terminal({
    allowTransparency: true,
    cursorBlink: true,
    fontFamily: getComputedStyle(host).getPropertyValue('--font-mono').trim() || 'Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.15,
    scrollback: 5000,
    theme: terminalTheme(host),
  })
  // Keys the window keeps: the panel's own shortcut, and copy and paste as in Windows Terminal
  // (Ctrl+C copies only while text is selected; otherwise it interrupts the command).
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || !event.ctrlKey || event.altKey) return true
    const key = event.key.toLowerCase()
    if (key === '`' || key === 'v') return false
    return !(key === 'c' && (event.shiftKey || terminal.hasSelection()))
  })
  const fitter = new FitAddon()
  terminal.loadAddon(fitter)
  const releaseStyles = openWithAdoptedStyles(terminal, host)
  // The app's light or dark look can change while the terminal is open.
  const restyle = new MutationObserver(() => {
    terminal.options.theme = terminalTheme(host)
  })
  restyle.observe(host.ownerDocument.documentElement, { attributes: true })
  return {
    terminal,
    fit() {
      if (!host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) return null
      const size = fitter.proposeDimensions()
      if (!size || !Number.isFinite(size.cols) || !Number.isFinite(size.rows)) return null
      fitter.fit()
      return { columns: terminal.cols, rows: terminal.rows }
    },
    dispose() {
      restyle.disconnect()
      terminal.dispose()
      releaseStyles()
    },
  }
}
