'use strict'
// The start-up screen's own code, running before the window's: the look from what was last chosen, and
// from 8 s on what is taking long and how to close the window. As on the phone: lines of light drawn
// together into a lens around three turning orbits with a breathing core. The orbits and the core are CSS
// animations, which go on while the window's code loads; the lines are drawn here on a canvas in software
// (an OffscreenCanvas in a worker froze the window beside the studio's WebGL, about one start in three).
// The window's code ends it with the "aw-boot-done" event (app/boot-screen.ts).
;(() => {
  const screen = document.getElementById('boot-screen')
  if (!screen) return
  const read = (key) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  let appearance = {}
  try {
    appearance = JSON.parse(read('agent-workspace.appearance.v2') || '{}') || {}
  } catch {
    appearance = {}
  }
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches
  const dark = appearance.colorMode === 'dark' || (appearance.colorMode !== 'light' && !prefersLight)
  const still = appearance.reduceMotion === true || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  screen.dataset.mode = dark ? 'dark' : 'light'
  screen.dataset.still = still ? 'true' : 'false'

  const WORDS = {
    'zh-CN': { hint: (seconds) => `正在检查对话记录，记录多时需要几分钟，不用关闭窗口。已用 ${seconds} 秒`, minimize: '最小化', close: '关闭' },
    'zh-TW': { hint: (seconds) => `正在檢查對話記錄，記錄多時需要幾分鐘，不用關閉視窗。已用 ${seconds} 秒`, minimize: '最小化', close: '關閉' },
    'en-US': { hint: (seconds) => `Checking your conversations. With many this takes a few minutes; there is no need to close the window. ${seconds} s so far`, minimize: 'Minimize', close: 'Close' },
    'ja-JP': { hint: (seconds) => `会話の記録を確認しています。記録が多いと数分かかります。ウィンドウを閉じる必要はありません。経過 ${seconds} 秒`, minimize: '最小化', close: '閉じる' },
  }
  const words = WORDS[read('agent-workspace.locale.v1')] || WORDS['zh-CN']

  // ---- The lines of light -------------------------------------------------------------------------
  const LINES = 18
  const CENTER = 0.42
  const EXIT_MS = 620
  const colors = dark
    ? { accent: '#5cc6b1', sky: '#38bdf8', violet: '#a78bfa', sky40: 'rgba(56, 189, 248, .157)', violet14: 'rgba(167, 139, 250, .055)' }
    : { accent: '#0f766e', sky: '#0284c7', violet: '#7c3aed', sky40: 'rgba(2, 132, 199, .086)', violet14: 'rgba(124, 58, 237, .031)' }
  const canvas = screen.querySelector('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  let stroke = null
  let backdrop = null
  let ratio = 1
  let unit = 1

  const resize = () => {
    const width = window.innerWidth
    const height = window.innerHeight
    ratio = Math.min(window.devicePixelRatio || 1, 1.5)
    unit = Math.min(1.5, Math.max(1, Math.min(width, height) / 620))
    screen.style.setProperty('--boot-unit', String(unit))
    canvas.width = Math.max(1, Math.round(width * ratio))
    canvas.height = Math.max(1, Math.round(height * ratio))
    stroke = context.createLinearGradient(0, 0, canvas.width, 0)
    stroke.addColorStop(0, colors.accent)
    stroke.addColorStop(0.25, colors.sky)
    stroke.addColorStop(0.5, colors.violet)
    stroke.addColorStop(0.75, colors.sky)
    stroke.addColorStop(1, colors.accent)
    const centerY = canvas.height * CENTER
    backdrop = context.createRadialGradient(canvas.width / 2, centerY, 0, canvas.width / 2, centerY, canvas.width * 0.75)
    backdrop.addColorStop(0, colors.sky40)
    backdrop.addColorStop(0.55, colors.violet14)
    backdrop.addColorStop(1, 'rgba(0, 0, 0, 0)')
  }

  const draw = (time, opening) => {
    const { width, height } = canvas
    const centerX = width / 2
    const centerY = height * CENTER
    const spread = Math.min(height * 0.82, width * 2.1)
    const step = 12 * ratio
    const lineUnit = unit * ratio
    context.clearRect(0, 0, width, height)
    context.globalAlpha = 1 - opening
    context.fillStyle = backdrop
    context.fillRect(0, 0, width, height)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = stroke
    for (let index = 0; index < LINES; index += 1) {
      const offset = index - (LINES - 1) / 2
      const base = centerY + (offset / LINES) * spread
      const amplitude = (5 + 3 * Math.sin(index * 1.7)) * lineUnit * (1 + 2.2 * opening)
      const speed = 1.1 + (0.35 * ((index * 37) % 7)) / 7
      const pull = 0.88 * (1 - opening)
      context.beginPath()
      for (let x = 0; x <= width + step; x += step) {
        // A lens: near the centre every line bends towards the middle.
        const focus = pull * Math.exp(-(((x - centerX) / (width * 0.3)) ** 2))
        const wave = Math.sin((x / width) * 2 * Math.PI * 1.3 + time * speed + index * 0.8) * amplitude
        const y = base + (centerY - base) * focus + wave * (1 - 0.6 * focus)
        if (x === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      const nearness = 1 - Math.abs(offset) / (LINES / 2)
      const fade = (1 - opening) * (0.12 + 0.7 * nearness * nearness)
      context.globalAlpha = (fade * 38) / 255
      context.lineWidth = 5 * lineUnit
      context.stroke()
      context.globalAlpha = Math.min(1, fade)
      context.lineWidth = 1.3 * lineUnit
      context.stroke()
    }
    context.globalAlpha = 1
  }

  const startedAt = performance.now()
  let leavingAt = 0
  let frame = 0
  let drawnAt = 0
  const loop = (now) => {
    frame = requestAnimationFrame(loop)
    // 30 frames a second are plenty for lines this slow, on a thread with other work to do.
    if (now - drawnAt < 30) return
    drawnAt = now
    const left = leavingAt ? Math.min(1, (now - leavingAt) / EXIT_MS) : 0
    const opening = left < 0.5 ? 4 * left ** 3 : 1 - (-2 * left + 2) ** 3 / 2
    draw((now - startedAt) / 1000, opening)
  }
  const onResize = () => {
    resize()
    if (still) draw(2.4, 0)
  }
  window.addEventListener('resize', onResize)
  resize()
  draw(still ? 2.4 : 0, 0)
  if (!still) frame = requestAnimationFrame(loop)

  // ---- What is taking long ------------------------------------------------------------------------
  const hint = screen.querySelector('.boot-hint')
  const controls = screen.querySelector('.boot-controls')
  const [minimize, close] = controls.querySelectorAll('button')
  minimize.setAttribute('aria-label', words.minimize)
  minimize.title = words.minimize
  close.setAttribute('aria-label', words.close)
  close.title = words.close
  const control = (action) => () => window.agentWorkspace && window.agentWorkspace.controlWindow(action)
  minimize.addEventListener('click', control('minimize'))
  close.addEventListener('click', control('close'))
  const tick = () => {
    const seconds = Math.round((performance.now() - startedAt) / 1000)
    if (seconds < 8) return
    hint.textContent = words.hint(seconds)
    hint.hidden = false
    controls.hidden = false
  }
  const ticking = setInterval(tick, 1000)

  const remove = () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('resize', onResize)
    screen.remove()
  }
  window.addEventListener('aw-boot-done', () => {
    clearInterval(ticking)
    screen.setAttribute('aria-busy', 'false')
    if (still) {
      remove()
      return
    }
    leavingAt = performance.now()
    screen.dataset.leaving = 'true'
    setTimeout(remove, EXIT_MS + 40)
  }, { once: true })
})()
