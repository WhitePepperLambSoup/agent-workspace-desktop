# Security Policy

## Supported versions

Agent Workspace is pre-release software. Only the latest code on `main` will receive security
fixes until the first stable release.

## Current trust boundary

The `0.1.0-alpha` code provides application-level workspace checks, explicit tool approval, CAS
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
  verification; the active database is never modified by this cleanup.
- The knowledge base keeps the text of the documents the user adds, in plaintext SQLite next to
  the conversations; the original files are not kept. Passages attached to a request are marked as
  untrusted data, so instructions inside a document are not followed as the user's. `knowledge_add`
  copies a workspace file's text and refuses known sensitive paths (keys, `.env`); it is a session
  state change, allowed in WORKSPACE mode and asked for in ASK mode. Saving a web page uses the
  `web_fetch` network checks.
- Scanned PDF pages are read with the text recognition built into Windows, through a fixed
  PowerShell script run without a console window; the file and pages to read are passed in an
  environment variable as JSON, never as script text. Nothing leaves the computer.
- The phone connection is off until the user turns it on. It answers only loopback, private,
  link-local and Tailscale addresses, checks the `Host` header, keeps only SHA-256 hashes of each
  phone's token, throttles failed attempts, and offers one-time pairing codes and a pinned
  self-signed certificate for HTTPS. In HTTP mode tokens and conversation text cross the network
  unencrypted. A phone's task never runs in a YOLO or full-access conversation, and its approvals
  are given on the desktop. The protocol is in `docs/DEVICE_LINK_API.md`.
- Installed builds check the HTTPS release feed only when the user asks, and download an update
  only after confirmation. Releases are not code-signed yet; each release lists SHA-256 sums.

## Reporting a vulnerability

Report a vulnerability privately through GitHub's "Report a vulnerability" button on the
repository's Security tab rather than in a public issue. Do not include live API keys, private
source code, or personal data in a report.
