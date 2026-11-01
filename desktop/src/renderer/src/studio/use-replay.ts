import { useEffect, useRef, useState } from 'react'

import type { JsonValue } from '../../../shared/protocol'
import type { WorkbenchBridgeClient } from '../bridge/client'
import { parseReplay, type Replay, type ReplayTurn } from './replay'
import { speedFor } from './ReplayPanel'

/** How often the replay's clock moves while it plays. */
const TICK_MS = 100

/**
 * A conversation's turn to replay while `on`: asked for once (and again for another turn), then
 * played from the start at a speed that takes about a minute; it stops at the end.
 */
export function useReplay(client: WorkbenchBridgeClient | undefined, sessionId: string | null, on: boolean) {
  const [turnId, setTurnId] = useState<string | undefined>(undefined)
  const [data, setData] = useState<{ turns: ReplayTurn[]; replay: Replay | null } | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [at, setAt] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const atRef = useRef(at)
  atRef.current = at

  useEffect(() => {
    if (on) return
    setData(null)
    setTurnId(undefined)
    setPlaying(false)
    setAt(0)
  }, [on])

  useEffect(() => {
    if (!on || !client || !sessionId || typeof client.getSessionReplay !== 'function') return undefined
    let alive = true
    setLoading(true)
    setFailed(false)
    client.getSessionReplay(sessionId, turnId)
      .then((response) => {
        if (!alive) return
        const parsed = parseReplay(response.payload as Record<string, JsonValue>)
        setData(parsed)
        setAt(0)
        setSpeed(parsed.replay ? speedFor(parsed.replay.duration) : 1)
        setPlaying(Boolean(parsed.replay && parsed.replay.steps.length > 0))
      })
      .catch(() => { if (alive) setFailed(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [client, on, sessionId, turnId])

  const duration = data?.replay?.duration ?? 0
  useEffect(() => {
    if (!playing || duration <= 0) return undefined
    let last = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      const next = Math.min(duration, atRef.current + ((now - last) / 1000) * speed)
      last = now
      setAt(next)
      if (next >= duration) setPlaying(false)
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [duration, playing, speed])

  return {
    data,
    loading,
    failed,
    at,
    playing,
    speed,
    seek: (value: number) => setAt(Math.max(0, Math.min(duration, value))),
    // Played again from the start once it reached the end.
    setPlaying: (value: boolean) => {
      if (value && atRef.current >= duration) setAt(0)
      setPlaying(value)
    },
    setSpeed,
    setTurnId,
  }
}
