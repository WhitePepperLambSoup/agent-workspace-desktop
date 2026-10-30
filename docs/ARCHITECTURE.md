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
- `ui_gateway/runtime.py` holds `GatewayRuntime`: the command table, runtime lifecycle, turns,
  approvals and the event stream. Its command groups are mixins in `ui_gateway/gateway_*.py`
  (sessions, providers, devices, knowledge, usage, workspace, review, runs, schedules);
  `gateway_state.py` declares the state they share and `gateway_common.py` the definitions they
  use. A new command goes into `_UNLOCKED_HANDLERS` (it waits on slow work and takes the gateway
  lock only for the state it reads) or `_LOCKED_HANDLERS`.
- PySide6 and `agent_workspace.ui.desktop` are retired and forbidden.

Run `python scripts/check_architecture.py` locally; CI enforces the same rules.

## Desktop boundaries

- `desktop/src/main/`: process lifecycle, secure window defaults, sidecar supervision, OS integration.
- `desktop/src/preload/`: minimal typed IPC capability surface. Do not expose raw Electron APIs.
- `desktop/src/renderer/`: React views and client state. It must not access Node or spawn processes.
- `desktop/src/shared/`: protocol types shared across Electron processes.

The preview (`desktop/src/main/preview.ts`) is the one place the main process shows content that
is not the app: a `WebContentsView` in its own in-memory session, laid over a box the renderer
reports with `preview.setBounds`, and hidden while another modal dialog is open (a native view is
drawn above the page). Folder files reach it through the `aw-preview` scheme registered on that
session only. The renderer asks for a page or file through `requestPreview`
(`renderer/src/preview/preview-request.ts`); files the panel does not show open in the reader of
the same sheet, Office files in their own preview.

The list of files a turn changed is recorded by the sidecar, not the renderer:
`RuntimeSettings.turn_files` lets the desktop observe each turn (`ui_gateway/turn_files.py` lists
the folder before it, collects the turn's writes, moves and deletions from its events, and lists
the folder after it), and `RuntimeHost` appends the result as `turn.files.changed` after the
turn's last event. `turn.files.diff` and `turn.files.undo` look the record up by its event id;
the window never sends content digests.

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

## Science and papers

The research tools are desktop-only: `RuntimeSettings.workspace_tools` lets the desktop add tools
for a folder, and `ui_gateway/research.py` makes them (the Android app does not set it).

- `scholar/`: works and their sources (OpenAlex, arXiv, PubMed, Crossref, Semantic Scholar),
  BibTeX and other imports, citation styles, the folder's library in `.agent/references.json`,
  Zotero's local API, reference checks, PDF reading (`papers.py`) and the lab notebook
  (`labbook.py`). Tools that write files go through `write_file`, so their writes are checkpointed
  and listed under the turn.
- `latex/`: compile (MiKTeX, TeX Live, Tectonic), the log parser, the rule checker and its fixes,
  SyncTeX, starters, and the `compile_latex` and `check_latex` tools. The window's editor talks to
  `ui_gateway/gateway_latex.py`; compiles and the Tectonic install run on a one-slot executor of
  their own in `server.py`.
- `science/`: the managed Python environment (`env.py`, installed by `ui_gateway/science_desk.py`
  on its own executor), the `aw_sciplot` figure helpers copied into it, and the SSH/Slurm tools
  (`remote.py`). `discover_executables` lists the environment's interpreter as
  `science_python`, and every turn's system prompt describes it (`gateway_science.py`).
- The window: `renderer/src/latex/` (CodeMirror in a shadow root, because the window's style
  policy refuses style tags; pdf.js for the PDF; `latex/visual/` is TeXButler's ProseMirror
  editor, kept close to upstream, with formulas rendered by KaTeX as DOM through `math.ts` for
  the same policy), `renderer/src/references/` (the library page), `renderer/src/figures/` (dragging points),
  `preview/NotebookView.tsx`, and `timeline/export-answer.ts` (PDFs are printed by the main
  process, Word and Markdown are written by `ui_gateway/gateway_exports.py`).

## Phone connection

`ui_gateway/device_link.py` runs an HTTP(S) endpoint inside the sidecar for paired phones, so a
phone's task runs in the same runtime, conversations and approval flow as the window. A task for a
conversation not open in the window gets a background runtime that stops once idle. The protocol is
in `docs/DEVICE_LINK_API.md`.
