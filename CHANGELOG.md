# Changelog

All notable changes to the desktop app are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0-alpha.1] - 2026-10-30

### Added

- An expert team: a turn can go to a team that the agent leads. It picks the specialists a
  request needs from a library of 73 experts in 15 fields (or the user fixes the team), gives
  each a part, has the draft reviewed when the answer carries figures or a consequential
  decision, and answers from the findings that hold up. Each expert works with its field's tools
  for at most 12 minutes a round; experts who write code run their tests in the sandbox and use
  the language server, the project's checks and the debugger.
- The studio: a 3D office where the lead and the experts of a team turn work at desks, boards and
  tables as they read, compute and review; several teams at work show as floors of one building.
- A code editor: syntax colouring, the language server's errors, hover and go to definition.
  Ctrl+K rewrites the selection from an instruction and shows the change before it is kept;
  inline completion from DeepSeek can be turned on.
- Language servers: Pyright and the TypeScript server are installed on first use; rust-analyzer,
  gopls and clangd are used when installed. The agent finds definitions, references and symbols
  through them and sees a file's errors after each edit.
- Project checks and rules: tests, type check and lint, detected or set in `.agent/project.json`
  and accepted once per folder, run after a turn that changed files, and a failure can go back to
  the agent. Rules format files after a write, protect paths and refuse a commit whose staged
  changes look like they contain a secret.
- Changes: undo or comment on one hunk, a review by the model as comments on the lines, and a
  comment handed to the agent as a task.
- A terminal panel under the workspace (Ctrl+\`): PowerShell, cmd, Git Bash, each WSL
  distribution and the SSH hosts of `~/.ssh/config`. The agent reads what is on screen and runs
  Linux commands in WSL.
- A Git tab: branches, commit messages written from the diff, committing on a new branch from the
  default one, conflicts, pull request checks with their failed logs, and issues as tasks (GitHub
  CLI).
- Specs: requirements, design and a task list, each approved in turn before the agent builds.
- Page check: the agent opens a page in a hidden browser, clicks through steps, and gets the
  console errors, failed requests and a screenshot it can see.
- A Python debugger: breakpoints in the editor, the call stack, variables and stepping (debugpy,
  installed on first use). The agent can stop at a line and read the variables.
- A repository tour: a map of the modules and their imports, and an overview of the architecture
  written from the code.
- Phone connection: a paired phone can read the folder's changes, freeze them into a review,
  comment on lines and hand a comment to the agent (`code_review`; the Android app does not use it
  yet).

- Science and papers. The agent searches OpenAlex, arXiv, PubMed, Crossref and Semantic Scholar,
  keeps a reference library per folder (Zotero, BibTeX, RIS, EndNote and NoteExpress imports),
  exports BibTeX or a formatted reference list (GB/T 7714, APA, IEEE, Vancouver, Nature), checks
  reference lists against the databases, and reads PDF papers by outline, page and reference
  list, linking the pages it quotes. A named watch reports only new papers, for the new "New
  papers" scheduled task.
- A LaTeX editor: `.tex` and `.bib` files open beside their PDF, compiled with MiKTeX, TeX Live or
  Tectonic (installed on request), with errors explained and fixed in one click, a checker for
  common mistakes, SyncTeX jumps both ways, citing from the library, and starters for Chinese and
  English papers, reports and slides. The agent compiles and checks documents too. It builds on
  TeXButler.
- A scientific Python environment, installed on request (uv, Python 3.12, numpy, pandas, scipy,
  matplotlib, seaborn, statsmodels, scikit-learn, Jupyter tools), with figure helpers from
  Quick SciPlot: journal-sized styles, statistics, figure templates and journal checks. Points of
  a figure can be dragged to correct its data; the corrected copy and a list of the changes are
  saved and the figure is redrawn.
- Visual editing of `.tex` files, from TeXButler 1.0.0: the document as a page, edited like in
  Word (paragraph styles, bold and the like, lists, formulas with a live preview, figures with
  their pictures, tables cell by cell, citations and cross-references, footnotes, the
  preamble). Untouched blocks are written back byte for byte, and a file that would not survive
  the round trip opens in source mode only. Figure and table captions show their numbers.
- A reference library page (Workspace → References): browse the folder's works, add from the
  databases or Zotero, import BibTeX, RIS, EndNote, NoteExpress or CSL-JSON files, copy a
  formatted list, save BibTeX or RIS, check works against the databases, remove works.
- Notebooks (`.ipynb`) open with their cells and outputs.
- A lab notebook: dated entries in `lab-notebook/YYYY-MM.md`, written and searched by the agent.
- Servers: the agent runs commands, copies files and submits or checks Slurm jobs on the hosts of
  the SSH configuration (key login only; each call is approved).
- Answers save as PDF (formulas as shown), Word or Markdown in the folder's `exports/`.
- Six research skills: literature reviews, reading papers, writing LaTeX papers, figures and
  statistics, answering reviewers, and formulas from pictures to LaTeX.
- Skills: thirteen official skills that come with the app, adapted from the Android app's pack
  (contracts, long documents, tables, accounts, meeting minutes, polishing and translating,
  résumés, work reports, study cards, trips, meals, bill splitting and scam checks). The agent
  sees their names and uses and loads one with the new `use_skill` tool when a request needs it.
  Settings → Skills turns each one on or off, and folders with a `SKILL.md` file copied into the
  skills folder add the user's own.
- Each answer ends with the files its turn created, edited, moved or deleted. A file opens in the
  app, an edited text file shows what changed, and the agent's changes can be undone one file at
  a time or all together. Files changed by commands the agent ran are listed apart. The list stays
  with the conversation.
- A preview inside the app for web pages and for pages, PDFs and pictures in the open folder.
  Links in answers open there (with a button for the browser); the Files page and files a phone
  sent use it too. Other text files open in a reader with line numbers, Markdown rendered.
- Office work. The agent writes official documents laid out to GB/T 9704 (通知, 请示, 报告, 函,
  纪要), checks and fixes the layout of existing ones, and proofreads Chinese text. It edits Word
  files as tracked changes with comments, compares two versions into a redline and a report, fills
  a Word template from a table (one file per row or one combined, also as PDF), and translates
  Word, PowerPoint and Excel files keeping their layout, replaced or side by side. Workbooks get
  real formulas, number formats, conditional formatting and native charts; tables are merged,
  matched on key columns, compared with highlights or cut into payslips; e-invoices (XML, OFD,
  PDF) are summed, checked and de-duplicated. PDFs are merged, split, picked, rotated, numbered,
  watermarked, compressed, made from pictures or Office files, and scanned pages get a hidden
  text layer by Windows text recognition. Slide decks are built on the user's PowerPoint template
  or one installed with Office, with native charts and speaker notes, and crowded slides are
  flagged. E-mail files (.eml, Outlook .msg) are read, replies drafted as unsent messages and
  invitations written as .ics. Meeting recordings are transcribed with times through the speech
  service of Settings → Voice. Every file written can be undone from the turn's change list.
- Document templates: official documents, forms, letters, reports and workbooks, plus the user's
  own Word, Excel and PowerPoint files with `{{fields}}`, from the Files page (New from template)
  or by the agent.
- Quick actions: copy text or a table screenshot anywhere and press Ctrl+Alt+Q (changeable in
  Settings): the window comes forward to polish, translate, summarize, rewrite in the official
  tone or answer the text, or to turn the table into a workbook.
- Five office skills (official documents, Chinese proofreading, e-mail and invitations, tables,
  slide decks); the slide-deck skill follows the planning method of PPT Master. The translation,
  minutes and expense skills use the new tools.
- Liquid glass refracts: panes, the composer and floating dialogs bend what is behind their rims
  (Snell's law over a curved bezel, after the liquid-glass library) and catch a rim highlight;
  light mode shows a bevel and more of the colour field. Settings → Appearance → Refraction turns
  it off.
- The liquid background is a slowly drifting field of broad colour regions with contour lines,
  so the glass has something to bend; its colours are chosen per palette so that muted text on
  the panes keeps 4.5:1 wherever the field drifts. Panes are clearer in dark mode, dialogs and the
  composer are nearly clear glass whose rims split into colour, and a hairline rim light with a
  soft glare follows the pointer over the composer and dialogs.

### Fixed

- Some commands the app starts in the background, such as the firewall check and stopping a
  task's processes, could wait until the next action in the window, because they inherited the
  input of the app's background process. They now start with an empty input.
- Database backups piled up: they were made while the app closed, where neither the copy nor the
  removal of older copies had time to finish. The app now backs up once a day in the background,
  keeps the last ten and removes the copies and temporary files left by earlier versions.
- The diagnostic trace wrote the whole conversation again for every model request, which slowed
  each step of a long task and filled hundreds of megabytes. It now writes the messages a request
  adds, and keeps two weeks and at most 100 MB of traces.
- While a prompt was being improved or a recording turned into text, the app read no other
  command and showed no progress of running tasks, so Stop and approvals waited too. These now run
  beside other work, as does the Git diff of the changes view.

### Changed

- Starting the app no longer replays the whole conversation history to check the database when
  the app closed it cleanly last time and the file has not changed since (about two seconds on a
  database of a few months).
- The window loads only the chosen language's text at start (its first script is 28% smaller), and
  checks what the sidecar sends once instead of three times.

## [0.1.0-alpha.1] - 2026-10-27

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
