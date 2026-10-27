import { FilePlus2, PencilLine, RefreshCw, Save, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'

type SetupClient = Pick<WorkbenchBridgeClient, 'inspectAgentSetup' | 'readWorkspaceFile' | 'writeWorkspaceFile'>

interface FileFact { path: string; exists: boolean; bytes: number }
interface SetupReport {
  instructions: FileFact[]
  skills: Array<{ id: string; name: string; description: string; path: string }>
  skillFiles: string[]
  skillError: string | null
  mcp: FileFact & { servers: Array<{ id: string; command: string[] }>; error: string | null }
  customTools: Array<{ name: string; description: string; path: string }>
  customToolError: string | null
}

const AGENTS_TEMPLATE = `# Project instructions

Describe how the agent should work in this project:

- Build and test commands
- Code style and conventions
- Files or areas to avoid
`

const MCP_TEMPLATE = `# MCP servers started (as stdio processes) for this project.
# Each server needs your approval when the agent runtime starts.
servers = []

# Example:
# [[servers]]
# id = "filesystem"
# command = ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."]
`

export function skillTemplate(id: string): string {
  return `id = "${id}"
name = "${id.replace(/[-_.]+/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase())}"
description = "When the agent should use this skill."
instructions = """
Step-by-step instructions the agent follows when this skill applies.
"""
`
}

const SKILL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function fileFact(value: unknown): FileFact {
  const record = asRecord(value)
  return { path: String(record.path ?? ''), exists: record.exists === true, bytes: typeof record.bytes === 'number' ? record.bytes : 0 }
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

export function parseSetupReport(payload: unknown): SetupReport {
  const value = asRecord(payload)
  const list = (raw: unknown) => Array.isArray(raw) ? raw.map(asRecord) : []
  const mcp = asRecord(value.mcp)
  return {
    instructions: list(value.instructions).map(fileFact),
    skills: list(value.skills).map((skill) => ({ id: String(skill.id ?? ''), name: String(skill.name ?? ''), description: String(skill.description ?? ''), path: String(skill.path ?? '') })),
    skillFiles: Array.isArray(value.skillFiles) ? value.skillFiles.filter((item): item is string => typeof item === 'string') : [],
    skillError: text(value.skillError),
    mcp: { ...fileFact(mcp), servers: list(mcp.servers).map((server) => ({ id: String(server.id ?? ''), command: Array.isArray(server.command) ? server.command.map(String) : [] })), error: text(mcp.error) },
    customTools: list(value.customTools).map((tool) => ({ name: String(tool.name ?? ''), description: String(tool.description ?? ''), path: String(tool.path ?? '') })),
    customToolError: text(value.customToolError),
  }
}

interface EditorState { path: string; content: string; sha256: string | null; creating: boolean }

/** Edits the files that shape the agent in this project: instructions, skills, MCP servers. */
export function AgentSetup({ client, workspaceKey }: { client?: Partial<SetupClient>; workspaceKey: string | null }) {
  const { t } = useOptionalI18n()
  const [report, setReport] = useState<SetupReport | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [saving, setSaving] = useState(false)
  const [newSkill, setNewSkill] = useState('')
  const available = Boolean(client?.inspectAgentSetup && client.readWorkspaceFile && client.writeWorkspaceFile && workspaceKey)

  const inspect = useCallback(async (): Promise<void> => {
    if (!client?.inspectAgentSetup) return
    try {
      setReport(parseSetupReport((await client.inspectAgentSetup()).payload))
      setError(null)
    } catch {
      setError('agentSetup.loadFailed')
    }
  }, [client])

  useEffect(() => {
    setReport(null)
    setEditor(null)
    if (available) void inspect()
  }, [available, inspect, workspaceKey])

  const open = async (path: string, template: string): Promise<void> => {
    if (!client?.readWorkspaceFile) return
    setError(null)
    const exists = report?.instructions.some((item) => item.path === path && item.exists) ||
      (path === '.agent/mcp.toml' && report?.mcp.exists) ||
      report?.skillFiles.includes(path) || report?.customTools.some((tool) => tool.path === path)
    if (!exists) {
      setEditor({ path, content: template, sha256: null, creating: true })
      return
    }
    try {
      const payload = asRecord((await client.readWorkspaceFile(path)).payload)
      if (payload.isBinary === true || payload.truncated === true || payload.editable === false) {
        setError('agentSetup.notEditable')
        return
      }
      setEditor({ path, content: String(payload.content ?? ''), sha256: text(payload.sha256), creating: false })
    } catch {
      setError('agentSetup.readFailed')
    }
  }

  const save = async (): Promise<void> => {
    if (!editor || !client?.writeWorkspaceFile || saving) return
    setSaving(true)
    setError(null)
    try {
      await client.writeWorkspaceFile(editor.path, editor.content, editor.sha256)
      setEditor(null)
      await inspect()
    } catch (reason) {
      const code = asRecord(reason).code
      setError(code === 'concurrent_modification' ? 'agentSetup.changedOnDisk' : 'agentSetup.saveFailed')
    } finally {
      setSaving(false)
    }
  }

  const createSkill = (): void => {
    const id = newSkill.trim().toLowerCase()
    if (!SKILL_ID.test(id)) {
      setError('agentSetup.invalidSkillId')
      return
    }
    setNewSkill('')
    void open(`.agent/skills/${id}.toml`, skillTemplate(id))
  }

  if (!available) {
    return <section className="route-section agent-setup"><p className="route-note">{t('agentSetup.unavailable')}</p></section>
  }

  const editButton = (path: string, template: string, exists: boolean) => (
    <button type="button" className="agent-setup-action" onClick={() => void open(path, template)}>
      {exists ? <PencilLine size={14} aria-hidden="true" /> : <FilePlus2 size={14} aria-hidden="true" />}
      <span>{t(exists ? 'agentSetup.edit' : 'agentSetup.create')}</span>
    </button>
  )

  return (
    <section className="route-section agent-setup" aria-labelledby="agent-setup-heading">
      <header>
        <div>
          <h2 id="agent-setup-heading">{t('agentSetup.title')}</h2>
          <span>{t('agentSetup.description')}</span>
        </div>
        <button type="button" className="icon-button" aria-label={t('agentSetup.refresh')} title={t('agentSetup.refresh')} onClick={() => void inspect()}><RefreshCw size={14} /></button>
      </header>
      {error ? <p role="status" className="route-error">{t(error)}</p> : null}

      {editor ? (
        <form className="agent-setup-editor" onSubmit={(event) => { event.preventDefault(); void save() }}>
          <div className="agent-setup-editor-head">
            <code>{editor.path}</code>
            {editor.creating ? <span>{t('agentSetup.newFile')}</span> : null}
          </div>
          <textarea aria-label={t('agentSetup.fileContent', { path: editor.path })} spellCheck={false} value={editor.content} rows={16}
            onChange={(event) => setEditor({ ...editor, content: event.target.value })} />
          <p className="route-note">{t('agentSetup.appliesNextRun')}</p>
          <div className="agent-setup-editor-actions">
            <button type="submit" className="agent-setup-primary" disabled={saving}><Save size={14} aria-hidden="true" /><span>{t('agentSetup.save')}</span></button>
            <button type="button" className="agent-setup-action" onClick={() => setEditor(null)}><X size={14} aria-hidden="true" /><span>{t('agentSetup.cancel')}</span></button>
          </div>
        </form>
      ) : null}

      {report === null ? <p className="route-note" role="status">{t('agentSetup.loading')}</p> : <>
        <section className="agent-setup-group" aria-labelledby="agent-instructions-heading">
          <h3 id="agent-instructions-heading">{t('agentSetup.instructions')}</h3>
          <p className="route-note">{t('agentSetup.instructionsHelp')}</p>
          <ul className="agent-setup-list">
            {report.instructions.map((file) => (
              <li key={file.path}>
                <code>{file.path}</code>
                <span className="agent-setup-state" data-ok={file.exists ? 'true' : undefined}>{file.exists ? t('agentSetup.bytes', { count: file.bytes }) : t('agentSetup.missing')}</span>
                {file.path === 'AGENTS.md' || file.exists ? editButton(file.path, file.path === 'AGENTS.md' ? AGENTS_TEMPLATE : '', file.exists) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="agent-setup-group" aria-labelledby="agent-skills-heading">
          <h3 id="agent-skills-heading">{t('agentSetup.skills')}</h3>
          <p className="route-note">{t('agentSetup.skillsHelp')}</p>
          {report.skillError ? <p role="status" className="route-error"><span>{t('agentSetup.invalidFile')}</span> <code>{report.skillError}</code></p> : null}
          <ul className="agent-setup-list">
            {report.skillFiles.map((path) => {
              const skill = report.skills.find((item) => item.path === path)
              return (
                <li key={path}>
                  <span className="agent-setup-name"><strong>{skill?.name ?? path.split('/').at(-1)}</strong>{skill ? <small>{skill.description}</small> : null}</span>
                  <code>{path}</code>
                  {editButton(path, '', true)}
                </li>
              )
            })}
            {report.skillFiles.length === 0 ? <li className="agent-setup-empty">{t('agentSetup.noSkills')}</li> : null}
          </ul>
          <form className="agent-setup-new" onSubmit={(event) => { event.preventDefault(); createSkill() }}>
            <input aria-label={t('agentSetup.newSkillId')} placeholder={t('agentSetup.newSkillPlaceholder')} value={newSkill} maxLength={64} onChange={(event) => setNewSkill(event.target.value)} />
            <button type="submit" className="agent-setup-action" disabled={!newSkill.trim()}><FilePlus2 size={14} aria-hidden="true" /><span>{t('agentSetup.addSkill')}</span></button>
          </form>
        </section>

        <section className="agent-setup-group" aria-labelledby="agent-mcp-heading">
          <h3 id="agent-mcp-heading">{t('agentSetup.mcp')}</h3>
          <p className="route-note">{t('agentSetup.mcpHelp')}</p>
          {report.mcp.error ? <p role="status" className="route-error"><span>{t('agentSetup.invalidFile')}</span> <code>{report.mcp.error}</code></p> : null}
          <ul className="agent-setup-list">
            {report.mcp.servers.map((server) => (
              <li key={server.id}><strong>{server.id}</strong><code title={server.command.join(' ')}>{server.command.join(' ')}</code></li>
            ))}
            {report.mcp.servers.length === 0 ? <li className="agent-setup-empty">{t('agentSetup.noServers')}</li> : null}
          </ul>
          <div className="agent-setup-row-actions">{editButton('.agent/mcp.toml', MCP_TEMPLATE, report.mcp.exists)}</div>
        </section>

        <section className="agent-setup-group" aria-labelledby="agent-tools-heading">
          <h3 id="agent-tools-heading">{t('agentSetup.customTools')}</h3>
          {report.customToolError ? <p role="status" className="route-error"><span>{t('agentSetup.invalidFile')}</span> <code>{report.customToolError}</code></p> : null}
          <ul className="agent-setup-list">
            {report.customTools.map((tool) => (
              <li key={tool.path}><span className="agent-setup-name"><strong>{tool.name}</strong><small>{tool.description}</small></span><code>{tool.path}</code>{editButton(tool.path, '', true)}</li>
            ))}
            {report.customTools.length === 0 ? <li className="agent-setup-empty">{t('agentSetup.noCustomTools')}</li> : null}
          </ul>
        </section>
      </>}
    </section>
  )
}
