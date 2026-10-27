# Agent Workspace architecture

Agent Workspace has one desktop product: an Electron shell with a React renderer. A supervised,
frozen Python sidecar exposes a bounded NDJSON command/event protocol. The Python CLI is a second
adapter over the same application runtime, not a second UI implementation.

## Runtime flow

```text
React renderer
  -> typed preload bridge
  -> Electron main process / sidecar supervisor
  -> ui_gateway (commands, DTOs, sequencing)
  -> application (agent loop, runtime host, collaboration, delivery)
  -> providers / tools / policy / storage
  -> core domain models and events
```

Responses and events are globally sequenced at the gateway boundary. The renderer must consume
every sequence, including failed commands, before applying later state. Session-scoped data must
carry and validate its session identity before entering renderer state.

## Python dependency rules

- `core` is the lowest product layer and cannot import application, providers, storage, tools,
  policy, or UI.
- `providers`, `storage`, `tools`, `policy`, `application`, and `core` cannot import `ui_gateway`.
- `ui_gateway` may compose application services and persistence, but product logic belongs in
  `application`, not in transport handlers.
- `application/runtime_host.py` owns the runtime thread and asyncio loop. It is deliberately UI-free.
- PySide6 and `agent_workspace.ui.desktop` are retired and forbidden.

Run `python scripts/check_architecture.py` locally; CI enforces the same rules.

## Desktop boundaries

- `desktop/src/main/`: process lifecycle, secure window defaults, sidecar supervision, OS integration.
- `desktop/src/preload/`: minimal typed IPC capability surface. Do not expose raw Electron APIs.
- `desktop/src/renderer/`: React views and client state. It must not access Node or spawn processes.
- `desktop/src/shared/`: protocol types shared across Electron processes.

Provider profile persistence, a successful diagnostic request, and the active runtime provider are
different facts. UI state must name them separately. Workspace, session, attachment, approval,
history, changes, and job-log responses are session-bound capabilities and must be invalidated on
selection changes.

## Shutdown boundary

Application coroutines use a cancellation grace period and then remain joined until they stop using
SQLite and process-wide writer locks. This in-process fence is deliberately safety-first: Python
cannot safely detach a coroutine that suppresses cancellation and still release its shared
resources. Hard shutdown deadlines therefore live at process boundaries. Electron supervises and
force-terminates the frozen sidecar process tree; the direct Python CLI has a 30-second process-exit
watchdog. Do not replace the quiescence fence with an in-process timeout that releases live stores
or locks.

## Knowledge base

`knowledge/` holds the user's documents for every workspace: extraction (PDF, Office, EPUB, HTML,
text), passages indexed with SQLite FTS5 in `<data>/knowledge/knowledge.sqlite3`, search with
synonyms, and the agent's `knowledge_search`, `knowledge_add` and `knowledge_use` tools. One store
per data directory is shared by the gateway and every runtime; a background thread indexes added
files. Each turn gets the knowledge section of the system prompt and the matching passages as
untrusted data (`application/runtime_host.py`). Scanned PDF pages go to Windows text recognition
(`knowledge/windows_ocr.py`). The engine is the one the Android app uses.

## Phone connection

`ui_gateway/device_link.py` runs an HTTP(S) endpoint inside the sidecar for paired phones, so a
phone's task runs in the same runtime, conversations and approval flow as the window. A task for a
conversation not open in the window gets a background runtime that stops once idle. The protocol is
in `docs/DEVICE_LINK_API.md`.
