import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

const PREFERENCE_KEY = 'agent-workspace.voice.v1'
const listeners = new Set<() => void>()

export interface VoicePreference {
  /** Saved OpenAI-compatible provider profile that serves /audio/transcriptions. */
  providerId: string | null
  model: string
}

const DEFAULT_PREFERENCE: VoicePreference = { providerId: null, model: 'whisper-1' }
let cached: { raw: string | null; value: VoicePreference } | null = null

export function readVoicePreference(): VoicePreference {
  let raw: string | null = null
  try { raw = window.localStorage.getItem(PREFERENCE_KEY) } catch { /* Defaults apply. */ }
  if (cached && cached.raw === raw) return cached.value
  let value = DEFAULT_PREFERENCE
  try {
    const parsed = raw ? JSON.parse(raw) as Partial<VoicePreference> : null
    if (parsed) {
      value = {
        providerId: typeof parsed.providerId === 'string' && parsed.providerId ? parsed.providerId : null,
        model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim().slice(0, 200) : DEFAULT_PREFERENCE.model,
      }
    }
  } catch { /* Corrupt preference falls back to defaults. */ }
  cached = { raw, value }
  return value
}

export function writeVoicePreference(value: VoicePreference): void {
  try { window.localStorage.setItem(PREFERENCE_KEY, JSON.stringify(value)) } catch { /* Kept for this run only. */ }
  cached = null
  for (const listener of listeners) listener()
}

export function useVoicePreference(): VoicePreference {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    readVoicePreference,
    () => DEFAULT_PREFERENCE,
  )
}

/** Markdown reduced to the words a listener should hear. */
export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~\n]+)[*_~]{1,3}/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12_000)
}

/** Picks a voice language from the script the text is written in. */
export function speechLanguage(text: string): { prefix: string; fallback: string } {
  if (/[぀-ヿ]/.test(text)) return { prefix: 'ja', fallback: 'ja-JP' }
  if (/[가-힯]/.test(text)) return { prefix: 'ko', fallback: 'ko-KR' }
  if (/[㐀-鿿]/.test(text)) return { prefix: 'zh', fallback: 'zh-CN' }
  return { prefix: 'en', fallback: 'en-US' }
}

/** Reads text aloud with the system voices; returns a stop function. */
export function speak(text: string, onEnd: () => void): (() => void) | null {
  const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return null
  const content = speakableText(text)
  if (!content) return null
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(content)
  const wanted = speechLanguage(content)
  const voice = synth.getVoices().find((item) => item.lang.toLowerCase().startsWith(wanted.prefix))
  if (voice) utterance.voice = voice
  utterance.lang = voice?.lang ?? wanted.fallback
  utterance.onend = onEnd
  utterance.onerror = onEnd
  synth.speak(utterance)
  return () => { synth.cancel(); onEnd() }
}

export const MAX_RECORDING_SECONDS = 120

function pickRecordingType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return null
}

export function voiceInputSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && pickRecordingType() !== null
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

export type RecorderState = { status: 'idle' } | { status: 'recording'; seconds: number } | { status: 'transcribing' }

/** Records one utterance from the microphone and hands back its base64 audio. */
export function useVoiceRecorder(onRecorded: (audio: { mediaType: string; data: string }) => void, onError: (code: 'microphone' | 'unsupported') => void) {
  const [state, setState] = useState<RecorderState>({ status: 'idle' })
  const recorder = useRef<MediaRecorder | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const onRecordedRef = useRef(onRecorded)
  onRecordedRef.current = onRecorded

  const clear = (): void => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }

  const stop = useCallback((): void => {
    const active = recorder.current
    if (active && active.state !== 'inactive') active.stop()
  }, [])

  const start = useCallback(async (): Promise<void> => {
    const type = pickRecordingType()
    if (!type || !navigator.mediaDevices?.getUserMedia) {
      onError('unsupported')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      onError('microphone')
      return
    }
    const chunks: Blob[] = []
    const media = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 32_000 })
    recorder.current = media
    media.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data) }
    media.onstop = () => {
      clear()
      for (const track of stream.getTracks()) track.stop()
      recorder.current = null
      const blob = new Blob(chunks, { type })
      if (blob.size === 0) {
        setState({ status: 'idle' })
        return
      }
      setState({ status: 'transcribing' })
      void blobToBase64(blob).then((data) => onRecordedRef.current({ mediaType: type, data }))
    }
    media.start(1000)
    const startedAt = Date.now()
    setState({ status: 'recording', seconds: 0 })
    timer.current = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000)
      if (seconds >= MAX_RECORDING_SECONDS) stop()
      else setState({ status: 'recording', seconds })
    }, 250)
  }, [onError, stop])

  const finish = useCallback(() => setState({ status: 'idle' }), [])

  useEffect(() => () => {
    clear()
    const active = recorder.current
    if (active && active.state !== 'inactive') {
      active.onstop = null
      active.stop()
      for (const track of active.stream.getTracks()) track.stop()
    }
  }, [])

  return { state, start, stop, finish }
}
