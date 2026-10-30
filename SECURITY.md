# Security Policy

## Supported versions

Agent Workspace is pre-release software. Only the latest code on `main` will receive security
fixes until the first stable release.

## Current trust boundary

The `0.2.0-alpha` code provides application-level workspace checks, explicit tool approval, CAS
file writes, endpoint validation, local audit events, and a staged sandbox that never changes the
workspace directly. The staged sandbox is a review boundary, not an operating-system security
boundary: the commands it runs have the current user's access to files and the network.

In particular:

- Do not use YOLO in an untrusted repository. YOLO auto-authorizes sandbox commands (which keep the
  user's file and network access, see below), Git, Web, file-management, Todo, and memory
  operations, but rejects host `run_process` execution.
- `run_process` executes non-interactive host processes with the current Windows user's authority.
  It is not contained by the workspace path. ASK and WORKSPACE require one-time approval, while YOLO
  rejects it. It accepts no stdin or caller-supplied environment, captures bounded output,
  requires the discovered executable SHA-256 in direct mode, and binds the process
  tree to a resource-limited Windows Job Object before it begins running. Direct mode requires an
  absolute executable path; PowerShell and CMD are explicit command modes. Job Objects provide
  termination and resource limits, not filesystem, registry, credential, or network isolation.
  Background jobs reuse this launch contract, remain bounded and stdin-closed, and are marked
  `interrupted` on runtime restart rather than reattaching to a durable PID. They do not provide
  PTY, stdin, or daemon reattachment.
- `run_sandbox` is the preferred command tool. It runs structured `argv` (no shell interpolation)
  in a private copy of the workspace, with bounded output, time and process tree, and returns a
  complete change manifest; the real workspace is never written. The copy and the command keep the
  current Windows user's access to the rest of the file system, the registry and the network, so
  the sandbox is a review boundary rather than isolation. The former Docker backend is disabled.
  Details and limits are in `docs/SANDBOX.md`.
  A complete manifest is committed as a content-addressed changeset event in the same transaction
  as sandbox settlement. Binary postimages are bounded to 16 MiB each and 64 MiB per captured batch;
  the SQLite binary artifact store rejects new writes above 512 MiB.
  `apply_sandbox_change` applies one supported file or empty-directory transition from the current
  session at a time. It follows normal path approval, requires the expected postimage digest or
  `null`, verifies the live node type, content, executable state, and ordered dependencies, uses an
  encrypted durable checkpoint, and atomically records review/application events with tool
  settlement. Duplicate application is rejected. Interrupted file transitions roll back when the
  postimage still matches; any transition involving a directory fails closed as a retained recovery
  conflict because an empty directory has no content identity.
  Known sensitive workspace paths require one-time approval in every mode.
- Git status, diff, and staged-only commit require one-time approval outside YOLO. The built-in Git
  runner resolves one workspace-external host Git executable before policy evaluation, displays and
  verifies its path and SHA-256, uses a clean environment and isolated global config, disables
  hooks, signing, pagers, external diff/text conversion, and fsmonitor, and rejects repositories
  whose Git metadata resolves outside the workspace. Commit verifies the expected HEAD and index
  digest immediately before committing. These controls do not make repository files trustworthy.
- `web_fetch` requires one-time approval outside YOLO and only performs credential-free HTTPS GET requests to
  public IP addresses on port 443. It ignores proxy settings, pins a validated DNS address for each
  connection, permits only same-origin redirects, and limits response MIME types and size. The full
  URL query is network egress and is displayed for approval. Fetched content is untrusted tool data.
- Saved research sources remain untrusted data. Each artifact is bounded to 128 KiB of UTF-8 text,
  keyed by its SHA-256 digest, and committed in the same SQLite transaction as its source event and
  tool settlement. The source projector requires a matching, earlier, complete `web_fetch` result in
  the same session and verifies its URL, title, content, MIME, timestamp, and observed-response
  metadata. Citations cannot cross sessions; quoted text must occur exactly in the referenced
  artifact. Source summaries and claims are model-authored metadata, not independently verified
  facts. In ASK mode, approval displays content size and digest rather than the full evidence body.
- Directory creation, regular-file moves, file deletion, and empty-directory deletion require
  one-time approval outside YOLO. Moves never overwrite and file move/delete operations
  require an expected content digest. These operations have no rollback checkpoint and are
  settlement-first.
- A malicious local process with the same user privileges can race path checks or alter files.
- Python plugins are trusted code; third-party plugin loading is disabled.
- Cloud Providers receive the prompt and selected workspace context only after an egress policy
  decision. ASK prompts for every request, WORKSPACE caches the approved data categories for the
  current session, and YOLO records the transfer without prompting. Numeric loopback endpoints are
  treated as local; `localhost` names still require approval, and owned loopback HTTP clients ignore
  environment proxy settings.
- API keys may be read from the environment for one-off runs or stored as current-user generic
  credentials in Windows Credential Manager. They are never accepted in a Provider URL, written to
  profile TOML or SQLite, logged, or included in session exports. Stored keys are bound to a
  Provider profile id and endpoint origin.
- Tool arguments are validated against JSON Schema before approval. Side effects receive a durable
  attempt and idempotency key before execution. Built-in filesystem tools run in Windows Job Object
  workers; writes persist a bounded, current-user DPAPI-protected preimage checkpoint before
  mutation and are CAS-rolled back after interruption. A non-isolated custom tool that cannot settle
  becomes `unknown` and is not replayed automatically.
- Todo writes follow the active autonomy policy. Todo domain events and tool settlement commit in
  one SQLite transaction, and Todo identifiers remain owned by their original session after delete.
- Long-term memory is explicit, workspace-scoped plaintext SQLite data. It is never loaded into a
  Provider request automatically. `memory_search` is a local bounded read; `memory_write` requires
  one-time approval in ASK and WORKSPACE and is autonomous in YOLO. Memory events,
  owner selection, updates, and tombstones are replay-validated. Recalled memory remains data rather
  than an instruction and may be stale or user-authored.
- Published backups are self-contained SQLite online snapshots with SHA-256 manifests plus schema,
  foreign-key, sequence, event-projection replay, search-index, and active file-checkpoint validation.
  Restore rejects SQLite sidecars and writes only to a new path. Session exports redact structured
  secret fields but still contain conversation, tool output, source URLs, research artifacts,
  citations, sandbox changeset metadata, and retained sandbox postimages and must be treated as
  private data. Session export format v3 includes referenced research and sandbox artifacts as
  digest-named archive members covered by the archive manifest and self-verifies before publication.
  Memory events,
  memory tool arguments, and memory tool results are replaced with content-free audit placeholders;
  ordinary conversation may still repeat the same facts. Import accepts verified schema
  v7-v13 archives allowed by the archive format, remaps identities, binds a new ASK session to the selected workspace, marks archived
  messages untrusted, and rejects active memory events so an archive cannot modify workspace memory.
  A backup containing an active file checkpoint can only be verified or recovered by the Windows
  user that created it.
  Rolling retention removes older backup pairs that fail deterministic manifest/hash/schema
  verification; the desktop's daily backup checks only each older pair's manifest name, date and
  size, and every backup is fully verified again before a restore. The active database is never
  modified by this cleanup.
- The desktop fully validates the database (integrity, sequences, projection replay) the first
  time it opens it. A file the app closed cleanly and that has not changed since (same file id,
  size and modification time, no WAL left) is not replayed again at the next start; SQLite's
  `quick_check` still runs on every open.
- The knowledge base keeps the text of the documents the user adds, in plaintext SQLite next to
  the conversations; the original files are not kept. Passages attached to a request are marked as
  untrusted data, so instructions inside a document are not followed as the user's. `knowledge_add`
  copies a workspace file's text and refuses known sensitive paths (keys, `.env`); it is a session
  state change, allowed in WORKSPACE mode and asked for in ASK mode. Saving a web page uses the
  `web_fetch` network checks.
- Skills are instructions the agent follows, like `AGENTS.md`: the official ones ship with the
  app, and any folder with a `SKILL.md` file in the user's skills folder is the user's own. Add
  only skills from a source you trust. `use_skill` reads a skill's text files inside its folder
  and runs nothing; every tool call a skill leads to goes through the usual approvals.
- Scanned PDF pages are read with the text recognition built into Windows, through a fixed
  PowerShell script run without a console window; the file and pages to read are passed in an
  environment variable as JSON, never as script text. Nothing leaves the computer.
- The phone connection is off until the user turns it on. It answers only loopback, private,
  link-local and Tailscale addresses, checks the `Host` header, keeps only SHA-256 hashes of each
  phone's token, throttles failed attempts, and offers one-time pairing codes and a pinned
  self-signed certificate for HTTPS. In HTTP mode tokens and conversation text cross the network
  unencrypted. A phone's task never runs in a YOLO or full-access conversation, and its approvals
  are given on the desktop. The protocol is in `docs/DEVICE_LINK_API.md`.
- The preview shows web pages and the folder's pages, PDFs and pictures in an embedded page of
  its own in-memory session: no preload, the renderer sandbox, every permission refused,
  downloads blocked, and navigation limited to http, https and the file opened. Folder files come
  from a private `aw-preview` scheme under a random name for each file opened, inside the open
  folder only, and every response asks for a sandbox without the same origin and sends no
  referrer: a page runs its scripts and loads its styles and pictures but cannot read the other
  files of the folder. A page may still load resources from the internet, as it would in a
  browser.
- The list of files a turn changed comes from the agent's recorded writes and, when the turn ran a
  tool that may change files without recording them, from listing the folder (size and
  modification time, at most 20,000 files and 1.5 seconds) before and after the turn. Undo uses
  the rewind rules: a file is put back only while it is exactly as the turn left it, and what it
  replaces is kept in the version store first.
- Scholarly searches, lookups and reference checks are network requests to OpenAlex, arXiv,
  PubMed, Crossref and Semantic Scholar, approved like other network tools in ASK and WORKSPACE
  mode. Zotero is read through its local API on 127.0.0.1, only for an import from it. The
  library page imports a reference file the user picks in the system's open dialog (BibTeX, RIS
  and similar text files up to 10 MB); it reads that file and nothing else outside the folder.
- LaTeX runs the TeX distribution found on the computer with restricted shell escape
  (`-restrict-write18` or `-shell-restricted`), without a console window, in the document's
  folder with build files under `.latex-build`. Tectonic, when the user installs it, is a pinned
  release checked against its SHA-256 before use.
- The scientific Python environment is installed only when the user asks: uv is a pinned wheel
  checked against its SHA-256; Python and the packages come from PyPI or a mirror in China and are
  not pinned by hash (their versions are written to `requirements.lock.txt`). It lives in the
  app's data folder and changes no other Python. Correcting a figure's points re-runs the script
  that drew the figure, inside the open folder, after the user saves the correction.
- `remote_run`, `remote_copy` and `slurm_jobs` run the user's own `ssh` and `scp` with
  `BatchMode=yes`, so they never ask for or keep a password; each call needs approval outside
  full-access mode, and they are refused in YOLO mode. A download never overwrites a file of the
  folder. `remote_hosts` reads the hosts of `~/.ssh/config` (names, addresses, users, ports) and
  connects to nothing.
- Saving an answer as PDF prints its rendered text in a hidden window of its own session with
  JavaScript off and a policy that blocks every network request.
- The office tools read and write files of the open folder only (protected paths refused); each
  file written is checkpointed, so the turn's change list can put it back. Converting Word, Excel
  or PowerPoint files to PDF drives the installed Microsoft Office or WPS through a fixed
  PowerShell script on a temporary copy (file names in an environment variable, never in script
  text); an Office program that already has the user's documents open is neither hidden nor
  closed. Pictures are converted and scanned pages and table screenshots recognized on this
  computer. E-mail drafts are files the user sends from their own mail program; nothing is sent.
  Installed PowerPoint templates are read from Office's and the user's template folders.
- `meeting_transcribe` uploads the recording, in ten-minute parts, to the speech service chosen in
  Settings → Voice; it is a network tool, approved in ASK and WORKSPACE mode.
- The quick actions register one system-wide shortcut (Ctrl+Alt+Q unless changed; it can be turned
  off). The clipboard is read only when it is pressed; its text goes to the model of the current
  conversation only when the user picks an action, and a table screenshot is recognized locally
  and saved under the folder's `exports/`.
- Language servers: Pyright and the TypeScript server are downloaded on first use from the npm
  registry (npmmirror, then npmjs.org); each package is checked against the registry's SHA-512
  integrity before it is unpacked into the app's tools folder, and runs on the computer's Node or
  the app's own Electron in Node mode. Other servers are used only when already installed. They
  read the folder's files and send nothing out.
- Project checks run the commands of `.agent/project.json` (or the ones detected) only after the
  user accepts that folder's list; a changed list asks again. Project rules can refuse writes to
  protected paths and a commit whose staged changes look like they contain a secret.
- The terminal panel runs the user's own shells with the user's rights. The agent's
  `read_terminal` reads what is on screen and cannot type into it.
- `debug_python` runs the folder's Python program under debugpy, and `run_wsl` runs a command in
  a WSL distribution in the open folder: both are host processes, approved per call in ASK and
  WORKSPACE mode and refused in YOLO mode. When the project's Python has no debugpy, it is
  installed from PyPI into the app's tools folder (not pinned by hash).
- `check_page` opens a page in a headless browser of its own for each call; it is a network tool,
  approved like the others, and its screenshot is saved under `.agent/screenshots`.
- Model features send code to the conversation's provider: Ctrl+K sends the selection and the
  code around it, the AI review a snapshot's diff, a commit message the diff of the files being
  committed with the repository's recent commit subjects, and the
  repository tour the module map with the beginnings of the README and entry points. Inline
  completion is off until turned on and sends the text around the cursor to DeepSeek only.
- Pull request checks, failed logs and issues come from the GitHub CLI with the user's own login.
- A paired phone reads changes and review snapshots with the `read` scope; creating snapshots,
  comments and follow-ups needs `tasks`, and a follow-up that would run with YOLO or full access
  needs the phone's confirmation and the `broad_autonomy` scope, as a task does.
- Installed builds check the HTTPS release feed only when the user asks, and download an update
  only after confirmation. Releases are not code-signed yet; each release lists SHA-256 sums.

## Reporting a vulnerability

Report a vulnerability privately through GitHub's "Report a vulnerability" button on the
repository's Security tab rather than in a public issue. Do not include live API keys, private
source code, or personal data in a report.
