import { useEffect, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import type { CodeAi, CodeIntel, CodeLocation, CodeProblem } from './CodeView'

type IntelClient = Partial<Pick<WorkbenchBridgeClient, 'codeDiagnostics' | 'codeDefinition' | 'codeHover'>>
type AiClient = Partial<Pick<WorkbenchBridgeClient, 'rewriteCode' | 'completeCode'>>

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function problemsFrom(value: unknown): CodeProblem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): CodeProblem[] => {
    const item = record(raw)
    const numbers = [item.line, item.character, item.endLine, item.endCharacter, item.severity]
    if (!numbers.every((number) => typeof number === 'number') || typeof item.message !== 'string') return []
    return [{
      line: item.line as number,
      character: item.character as number,
      endLine: item.endLine as number,
      endCharacter: item.endCharacter as number,
      severity: item.severity as number,
      message: item.message,
      source: typeof item.source === 'string' ? item.source : null,
    }]
  })
}

function locationsFrom(value: unknown): CodeLocation[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): CodeLocation[] => {
    const item = record(raw)
    if (typeof item.path !== 'string' || typeof item.line !== 'number' || typeof item.character !== 'number') return []
    return [{ path: item.path, inside: item.inside === true, line: item.line, character: item.character }]
  })
}

/** The language server's answers through the window's client; absent without those commands. */
export function codeIntelOf(client: IntelClient | undefined): CodeIntel | undefined {
  if (!client?.codeDiagnostics || !client.codeDefinition || !client.codeHover) return undefined
  const { codeDiagnostics, codeDefinition, codeHover } = client
  return {
    async diagnostics(path, text) {
      const payload = record((await codeDiagnostics.call(client, path, text)).payload)
      return { available: payload.available !== false, problems: problemsFrom(payload.diagnostics) }
    },
    async definition(path, line, character) {
      return locationsFrom(record((await codeDefinition.call(client, path, line, character)).payload).locations)
    },
    async hover(path, line, character) {
      const text = record((await codeHover.call(client, path, line, character)).payload).text
      return typeof text === 'string' ? text : ''
    },
  }
}

export function codeAiOf(client: AiClient | undefined): CodeAi | undefined {
  if (!client?.rewriteCode) return undefined
  const { rewriteCode, completeCode } = client
  return {
    async rewrite(request) {
      const response = await rewriteCode.call(client, request)
      const text = record(response.payload).text
      if (response.type !== 'editor.rewrite.result' || typeof text !== 'string') throw new Error('editor_failed')
      return text
    },
    ...(completeCode ? {
      async complete(path: string, prefix: string, suffix: string) {
        const payload = record((await completeCode.call(client, path, prefix, suffix)).payload)
        return { available: payload.available === true, text: typeof payload.text === 'string' ? payload.text : '' }
      },
    } : {}),
  }
}

const COMPLETION_KEY = 'agent-workspace.editor.completion.v1'
const COMPLETION_CHANGED = 'agent-workspace:editor-completion'

export function readCodeCompletion(): boolean {
  try {
    return localStorage.getItem(COMPLETION_KEY) === 'on'
  } catch {
    return false
  }
}

export function setCodeCompletion(on: boolean): void {
  try {
    localStorage.setItem(COMPLETION_KEY, on ? 'on' : 'off')
  } catch { /* the setting stays as it was for this window */ }
  window.dispatchEvent(new Event(COMPLETION_CHANGED))
}

/** Whether the model completes code as you type (Settings → Code intelligence; off by default). */
export function useCodeCompletion(): boolean {
  const [on, setOn] = useState(readCodeCompletion)
  useEffect(() => {
    const update = (): void => setOn(readCodeCompletion())
    window.addEventListener(COMPLETION_CHANGED, update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener(COMPLETION_CHANGED, update)
      window.removeEventListener('storage', update)
    }
  }, [])
  return on
}
