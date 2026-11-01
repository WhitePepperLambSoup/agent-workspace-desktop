import { ListTree, MessageSquare, Pause, Play } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { useOptionalI18n } from '../i18n/I18nProvider'
import { zhCN, type MessageKey } from '../i18n/messages'
import { clock, stepsAt, type Replay, type ReplayStep, type ReplayTurn } from './replay'

export const REPLAY_SPEEDS = [1, 4, 16, 64] as const

/** About a minute for the whole turn, at one of the speeds. */
export function speedFor(duration: number): number {
  return REPLAY_SPEEDS.find((speed) => duration / speed <= 90) ?? REPLAY_SPEEDS.at(-1)!
}

function toolLabel(tool: string | undefined, t: (key: MessageKey) => string): string {
  if (!tool) return ''
  const key = `approval.tool.${tool}`
  return key in zhCN ? t(key as MessageKey) : tool
}

/** A step in words: what was done, on what. */
export function stepText(step: ReplayStep, t: (key: MessageKey, values?: Record<string, string | number>) => string): string {
  if (step.kind === 'think') return t('studio.replay.think')
  if (step.kind === 'answer') return t('studio.replay.answer')
  if (step.kind === 'wait') return t('studio.replay.wait', { tool: toolLabel(step.tool, t) })
  return [toolLabel(step.tool, t), step.detail].filter(Boolean).join(' · ')
}

/**
 * Below the studio while a turn is replayed: which turn, play and pause, the time, the speed,
 * what is going on at this moment, and every step to jump to; a step of the lead opens in the
 * conversation, an expert's in its task.
 */
export function ReplayPanel({ turns, replay, loading, failed, at, playing, speed, actorName, onTurn, onSeek, onPlaying, onSpeed, onOpenStep }: {
  turns: ReplayTurn[]
  replay: Replay | null
  loading: boolean
  failed: boolean
  at: number
  playing: boolean
  speed: number
  actorName: (actor: string) => string
  onTurn: (turnId: string) => void
  onSeek: (at: number) => void
  onPlaying: (playing: boolean) => void
  onSpeed: (speed: number) => void
  onOpenStep: (step: ReplayStep) => void
}) {
  const { t } = useOptionalI18n()
  const translate = t as (key: MessageKey, values?: Record<string, string | number>) => string
  const listRef = useRef<HTMLOListElement>(null)
  const current = replay ? stepsAt(replay, at) : []
  const currentStart = current.at(-1)?.start
  // The list follows the replay: the step under way stays in view.
  useEffect(() => {
    if (currentStart === undefined) return
    const row = listRef.current?.querySelector<HTMLElement>('li[data-current="true"]')
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [currentStart])
  if (!replay) {
    return <div className="replay-panel"><p className="replay-note" role="status">{t(loading ? 'studio.replay.loading' : failed ? 'studio.replay.failed' : 'studio.replay.empty')}</p></div>
  }
  return (
    <div className="replay-panel" aria-label={t('studio.replay.title')}>
      <div className="replay-controls">
        <button type="button" className="icon-button" aria-label={t(playing ? 'studio.replay.pause' : 'studio.replay.play')}
          title={t(playing ? 'studio.replay.pause' : 'studio.replay.play')} onClick={() => onPlaying(!playing)}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <input type="range" className="replay-scrubber" min={0} max={Math.max(replay.duration, 0.1)} step={0.1} value={Math.min(at, replay.duration)}
          aria-label={t('studio.replay.position')} aria-valuetext={`${clock(at)} / ${clock(replay.duration)}`}
          onChange={(event) => onSeek(Number(event.currentTarget.value))} />
        <span className="replay-clock">{clock(at)} / {clock(replay.duration)}</span>
        <select aria-label={t('studio.replay.speed')} value={speed} onChange={(event) => onSpeed(Number(event.currentTarget.value))}>
          {REPLAY_SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}
        </select>
        {turns.length > 1 ? (
          <select aria-label={t('studio.replay.turn')} value={replay.turnId} onChange={(event) => onTurn(event.currentTarget.value)}>
            {[...turns].reverse().filter((turn) => turn.finished).map((turn) => (
              <option key={turn.turnId} value={turn.turnId}>{turn.prompt.slice(0, 40) || turn.turnId}</option>
            ))}
          </select>
        ) : null}
      </div>
      <p className="replay-now" aria-live="polite">
        <strong>{t('studio.replay.now')}</strong>
        {current.length > 0 ? current.slice(0, 3).map((step) => `${actorName(step.actor)} · ${stepText(step, translate)}`).join('；') : '—'}
      </p>
      <ol className="replay-steps" ref={listRef}>
        {replay.steps.map((step, index) => {
          const isCurrent = current.includes(step)
          const openable = Boolean(step.item) || step.actor.startsWith('run:')
          return (
            <li key={`${step.actor}:${step.start}:${index}`} data-current={isCurrent ? 'true' : 'false'} data-kind={step.kind} data-failed={step.failed ? 'true' : undefined}>
              <button type="button" className="replay-step" onClick={() => onSeek(step.start)}>
                <span className="replay-step-time">{clock(step.start)}</span>
                <strong>{actorName(step.actor)}</strong>
                <span>{stepText(step, translate)}</span>
              </button>
              {openable ? (
                <button type="button" className="icon-button" onClick={() => onOpenStep(step)}
                  aria-label={t(step.item ? 'studio.replay.open' : 'studio.replay.openRun')} title={t(step.item ? 'studio.replay.open' : 'studio.replay.openRun')}>
                  {step.item ? <MessageSquare size={13} /> : <ListTree size={13} />}
                </button>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
