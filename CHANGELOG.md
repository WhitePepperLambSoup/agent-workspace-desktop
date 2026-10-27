# Changelog

All notable changes to the desktop app are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0-alpha.1] - Unreleased

The first public preview of the Windows desktop app.

### Added

- Electron and React workbench with a supervised Python sidecar, conversations that keep running
  in the background, a queue that survives restarts, and messages that join a running task.
- Four autonomy levels (Ask, Workspace, YOLO, Full access) with schema-checked approvals, durable
  tool attempts and checkpointed file writes that roll back after an interruption.
- Workspace tools: files, search, patches, Git, a staged sandbox whose changes are reviewed and
  applied one at a time, a terminal, background jobs, LSP diagnostics, a code map, a managed
  browser, web fetch and search, documents and images; MCP servers, custom tools and skills from
  the workspace, each approved before it first runs.
- Knowledge base: PDF, Word, Excel, EPUB, web pages, Markdown and text, searched by key words
  with synonyms, passages attached to matching requests with their document and page, several
  knowledge bases chosen per conversation, and scanned PDFs read with Windows text recognition.
  The engine is shared with the Android app.
- Phone connection: the Android app lists this computer's conversations, reads their messages and
  hands tasks to them over the local network or Tailscale, with per-phone tokens, one-time pairing
  codes, a QR code and an optional pinned HTTPS certificate.
- Phone connection, version 2 (needs Android app 2.5.0 or later): photos and files from the
  phone land in the open folder's 来自手机 folder, the phone browses and downloads that folder,
  and messages, files and conversations go to the phone with Send to phone and Continue on phone;
  text and links travel both ways; a phone's conversation continues here; knowledge bases sync both
  ways by passage. Phones approve and stop work here and hear when tasks finish. The desktop's AI
  can ask a phone to do something (phone_task), which the phone's user accepts or declines.
  Conversations that approve everything take a phone's task only when the phone confirmed it and
  was given that permission; the window marks every turn from a phone. The computer is announced
  on the local network, can be woken from the phone, keeps an activity record for each phone, and
  a reset removes every phone at once.
- Connecting a phone needs no network knowledge: turning the connection on shows the QR code to
  scan, the connection is HTTPS by default (the QR code carries the certificate, so it also works
  over Tailscale), only addresses a phone can reach are offered, and when Windows Firewall would
  block phones one button fixes it after Windows' own confirmation. Ports, addresses and pairing by
  hand moved under Advanced.
- Conversation forks, answers from another model side by side, per-task cost and token limits,
  a cost estimate before sending, and failure notices in the conversation.
- Prompt-prefix caching for DeepSeek, OpenAI, Anthropic, Kimi, Qwen, GLM, Gemini, Grok and
  OpenRouter endpoints.
- Research mode with saved sources and exactly quoted citations; per-workspace long-term memory.
- Sub-agents on request: when parts of a request can be done at the same time, the agent hands
  them to sub-agents (each its own agent run, in the shared folder or its own git worktree), waits
  for them and uses their answers. Their progress shows above the composer and their approvals in
  the conversation. The Agent runs page starts a task in one step, lists sub-agents under their
  task and keeps the less common actions under More actions.
- Word, Excel and PowerPoint files: the agent creates them and edits existing ones (text
  replacement in Word, cells in Excel), and the window previews them and compares a change with
  the version it replaced.
- Scheduled tasks run on this computer while the app is open (daily, weekdays, weekly, monthly,
  once or cron), catch up on runs missed in the last 12 hours, and keep their results in an inbox;
  the phone reads finished runs and answers waiting approvals.
- Simple mode, the default: five pages (conversation, knowledge, scheduled tasks, workspace,
  settings); the full set is one switch away in Settings.
- Batch file changes: the agent moves, renames, copies and removes many files in one call that is
  approved once from a full list of the changes. Removed items go to a recycle area for 30 days,
  and Undo (in the conversation or under Workspace › File changes) puts back everything still as
  the batch left it, naming what it left alone.
- Usage and cost in Settings: this or last month's estimated cost by model and day, cache hit
  rate, and a monthly limit that stops new tasks, scheduled runs and sub-agents once reached.
- Watched folders for the knowledge base: new documents in chosen folders are added at start and
  every 30 minutes; WeChat and QQ download folders are offered when found.
- Plan first: a switch in the composer runs the next task with read-only tools and asks for a
  plan; "Carry out the plan" then does the work.
- Restore files to before a message: every file the agent writes keeps the content it replaced,
  so a user message's action puts back everything the agent changed after it (after a preview),
  leaving alone files changed since by anything else.
- Tool rows and approvals name tools in plain language, and an empty conversation suggests a
  Word report, tidying a folder or fixing code.
- Multi-model collaboration.
- Liquid glass, solid and Mica materials; Simplified Chinese, Traditional Chinese, English and
  Japanese; WCAG 2.2 AA checks on the main surfaces.
- Spring motion shared with the Android app for pages, menus, dialogs, drawers and arriving
  messages; the system setting or Reduce motion turns it off.
- Verified database backups on exit, session export and import, and self-updates from GitHub
  releases for installed copies.
