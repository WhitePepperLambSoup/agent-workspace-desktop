# Running and maintaining Agent Workspace

## Command line

The desktop app and the `agent-workspace` command use the same Python core, profiles and data.
Configure a provider from an environment variable so the key goes straight to Windows Credential
Manager instead of command history or a file:

```powershell
$env:OPENAI_API_KEY = "..."
uv run agent-workspace providers set openai --name OpenAI `
  --protocol openai-compatible --base-url https://api.openai.com/v1 `
  --model your-model-id --api-key-env OPENAI_API_KEY --default
Remove-Item Env:OPENAI_API_KEY

uv run agent-workspace providers list
uv run agent-workspace doctor --profile openai --workspace .
uv run agent-workspace run "Inspect this workspace" --profile openai --workspace .
```

Profiles support OpenAI-compatible Chat Completions, Anthropic Messages, Gemini
`streamGenerateContent` and Ollama Chat. A local Ollama needs no key:

```powershell
uv run agent-workspace providers set ollama --name Ollama `
  --protocol ollama --base-url http://127.0.0.1:11434 `
  --model your-local-model --default
uv run agent-workspace chat --profile ollama --workspace .
```

Plain HTTP is accepted on loopback, and on private network addresses (Ollama on another computer
at home, say) when the `AGENT_WORKSPACE_ALLOW_LAN_HTTP` environment variable is `1`. Profiles are stored in
`%LOCALAPPDATA%\AgentWorkspace\config.toml`; API keys are not. A stored key is bound to its
profile and endpoint origin, so changing the endpoint does not carry the key to another host. The
`AGENT_WORKSPACE_PROTOCOL`, `AGENT_WORKSPACE_BASE_URL`, `AGENT_WORKSPACE_API_KEY` and
`AGENT_WORKSPACE_MODEL` environment variables serve one-off runs without `--profile`.

Search session titles and user messages, optionally within one workspace:

```powershell
uv run agent-workspace sessions search "provider compatibility" --workspace . --json
```

## Backups, restore and session archives

The app makes a verified backup of its database each time it closes. Backups can also be made,
checked and restored by hand, and one session can be exported as a ZIP archive:

```powershell
$backup = uv run agent-workspace backups create --keep 10 --max-age-days 30
uv run agent-workspace backups verify $backup
uv run agent-workspace backups restore $backup --destination .\restored-agent.db
uv run agent-workspace sessions export SESSION_ID --output .\session.zip
uv run agent-workspace sessions verify .\session.zip
uv run agent-workspace sessions import .\session.zip --workspace .
```

Each database keeps at most 10 verified backups for 30 days and 10 GiB by default. A backup is a
`.db` file plus the `.manifest.json` beside it; keep both and do not rename them. Restore never
overwrites an existing database and migrates known older schemas on the restored copy.

A session archive holds the transcript, Todos, research sources and citations and their text
evidence. Import verifies the archive, gives the copy new identities, binds it to the chosen
workspace, marks its messages as untrusted and resumes in Ask mode. Long-term memory is not part
of an archive. Backups and archives contain private conversation and tool data.

Each agent run keeps its own execution database next to the main one; to keep the whole history,
keep the whole data folder, not only `agent.db`.

## Data and logs

| What | Where |
| --- | --- |
| Conversations, memory, research, backups, knowledge base | `%LOCALAPPDATA%\AgentWorkspace` |
| Provider profiles | `%LOCALAPPDATA%\AgentWorkspace\config.toml` |
| API keys | Windows Credential Manager |
| Desktop logs and crash dumps | `%APPDATA%\agent-workspace-desktop\logs` |

`main.log` is rotated at 1 MB; Settings → About & Updates → Open log folder opens the folder.
Crash reports are never uploaded. A renderer crash reloads the window up to three times a minute
before offering a restart.

## Updates and signing

Installed (NSIS) copies update from the GitHub releases of this repository: the release must
carry the installer and the `latest.yml` electron-builder writes beside it. A different HTTPS
folder can be set in Settings → About & Updates, or for every user with the
`AGENT_WORKSPACE_UPDATE_URL` environment variable, which takes precedence. Checks happen only when
asked, and an update downloads only after confirmation; the portable folder and development runs
never update themselves.

To sign the executable and installer, set `CSC_LINK` (a path or base64 of a `.pfx`) and
`CSC_KEY_PASSWORD` before running electron-builder. Unsigned builds work but trigger SmartScreen.

## Testing a release

Where the test suites are present, the packaged test runner checks the backend and desktop source
digests of a release folder before it starts it:

```powershell
cd desktop
npm run test:packaged -- ../dist/electron-release/AgentWorkspace
```

Dependency audits use the official registries:

```powershell
npm audit --registry=https://registry.npmjs.org --omit=dev
uv run --group audit pip-audit
```
