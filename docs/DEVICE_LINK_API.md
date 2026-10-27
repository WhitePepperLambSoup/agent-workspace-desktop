# Device link API

The desktop app can accept phones on the local network or a Tailscale tailnet
(**Settings → Phone connection**). The endpoint runs inside the desktop's UI gateway sidecar, so
tasks from a phone run in the same runtime, conversations and approval flow as the window. It is
off until the user turns it on and starts with the desktop afterwards.

This is version 2 of the protocol (`"device_link": 2`). The contract both sides follow, with the
Android side of every feature, is
[DEVICE_LINK_V2.md](https://github.com/WhitePepperLambSoup/agent-workspace-android/blob/main/for%20Android/docs/DEVICE_LINK_V2.md)
in the Android app's repository; this page describes the desktop's implementation and the choices
it makes inside that contract. The Android app speaks
version 2 from 2.5.0; earlier versions do not pin the HTTPS certificate this endpoint uses by
default and cannot connect.

Implementation (`src/agent_workspace/ui_gateway/`):

- `device_link.py`: the endpoint, paired phones (`devices.json`), handed-over tasks (`tasks.db`),
  settings, the pairing URI and Wake-on-LAN targets.
- `device_store.py`: transfers to phones, files and conversations received, phone jobs, text from
  phones, finished turns and each phone's activity record (`link.db`, next to `devices.json`).
- `device_hub.py`: the work behind the version 2 routes (files, transfers, hand-offs, knowledge).
- `mdns.py`: the local-network announcement.
- `runtime.py`: the `device_*` methods of `GatewayRuntime`, the `devices.*` window commands and the
  `phone_task` launcher; `tools/phone_jobs.py` is the tool itself.

Tests (with the development sources): `tests/test_device_link.py` (version 1 behaviour),
`tests/test_device_link_v2.py` (every version 2 route over HTTP against the gateway),
`tests/test_device_link_android.py` (the Android app's own `mobile_link` client against this
endpoint),
`desktop/tests/electron/real-sidecar-device-link.spec.ts`, and
`desktop/tests/electron/real-phone-device-link.spec.ts` (the packaged app and a real phone over
adb; runs only with `AGENT_WORKSPACE_REAL_PHONE=1`).

## Transport

- Default port `8765`, configurable from 1024 to 65535. Bound to all interfaces;
  `AGENT_WORKSPACE_DEVICE_LINK_BIND` overrides the address (the tests use `127.0.0.1`), and
  `AGENT_WORKSPACE_DEVICE_LINK_NAME` the computer's name phones see (the computer name otherwise).
- Only peers from loopback, private IPv4 (10/8, 172.16/12, 192.168/16), Tailscale CGNAT
  (100.64/10), link-local and IPv6 ULA/link-local addresses are answered.
- The `Host` header must name this computer (one of its addresses, its host name, or loopback).
- HTTPS by default (a setup that chose HTTP keeps it): a self-signed EC P-256 certificate created
  on first use (`device-link/certificate.pem` in the data directory). Phones pin its SHA-256
  fingerprint (lowercase hex of the DER certificate), which the pairing QR code carries, so
  scanning needs nothing else; the pairing panel also shows the first 16 digits in groups of four
  for phones that found the computer on the network. HTTP stays available under Advanced, for
  phones paired by hand on the same network.
- The addresses offered (status, runtime document, pairing link) are those of network cards that
  are up and are Ethernet or Wi-Fi, plus Tailscale (`net_adapters.py`, `GetAdaptersAddresses`);
  WSL, Hyper-V, VMware, VirtualBox, Docker, VPN taps and Bluetooth are left out. The address of
  the default route comes first.
- Windows Firewall (`firewall.py`): while the endpoint runs on a non-loopback address, status
  carries `firewall`: `open`, `blocked`, `checking`, `fixing`, `declined` or `unknown` (null when
  it does not apply). It is read through the firewall's COM interface (under a second) for the
  networks this computer is on and the rules for the listening program: blocked when the firewall
  is on there and a rule blocks the program, or nothing allows it while incoming connections are
  blocked by default. The window then shows one button; `devices.firewall.allow` runs, with
  Windows' administrator confirmation as the only step, a script that removes the program's
  blocking rules and adds "Agent Workspace phone connection", allowing the program over TCP from
  the local subnet, private ranges and Tailscale only. `AGENT_WORKSPACE_DEVICE_LINK_FIREWALL=0`
  turns the check off (the tests do).
- JSON bodies are at most 512 KiB; `POST /mobile/conversations` 1 MiB,
  `POST /mobile/knowledge/documents` 32 MiB, `PUT /mobile/files/{id}` 100 MiB (raw bytes).

## Local-network announcement

While the endpoint runs, the desktop registers `_agentworkspace._tcp` with Windows' own mDNS
responder (`DnsServiceRegister`, Windows 10 1809 or later), so the sidecar opens no extra socket.
The instance name is the computer's name; the TXT record is `v=1`, `id=<desktop_id>`, `tls=0|1`,
`fp=<fingerprint>` (HTTPS only) and `pair=1` while a pairing code is shown. The record is updated
when pairing starts or ends and withdrawn when the endpoint stops. `features` lists `mdns` only
while the registration is in place; `AGENT_WORKSPACE_DEVICE_LINK_MDNS=0` turns it off (the tests
do). Elsewhere than Windows nothing is announced.

## Authentication

Every route except `POST /pair` needs `Authorization: Bearer <token>`. Tokens are per device and
the desktop stores only their SHA-256. Ten failed attempts from one address within 60 seconds
return `429` for the rest of the minute.

Scopes: `read` (always), `tasks`, `approvals`, `files`, `knowledge` and `broad_autonomy`. The
user picks them when pairing (`tasks`, `files` and `knowledge` are preselected; `broad_autonomy`
never is, and choosing it shows the risk) and can change them per phone later; the token stays the
same. Removing a phone, the phone unpairing itself (`POST /mobile/device/unpair`) or **Reset phone
connections** revokes tokens immediately; a reset also gives the desktop a new `desktop_id`.

Pairing URI (QR code):

```
agentworkspace://pair?v=1&name=…&url=…&code=XXXX-XXXX[&fp=sha256:…]&id=<desktop_id>&alt=…&alt=…
```

`url` is the first LAN address, `alt` up to three more (LAN first, then Tailscale). `POST /pair`
answers `201 {"device_id", "token", "scopes", "name", "desktop_id", "addresses"}`.

Turning the endpoint on with no phone paired shows the pairing QR code straight away; the phone
scans it under Settings → Device connections. Ports, the connection type, addresses, pairing by
hand, waking and the reset are under Advanced.

## Routes

The table in section 3 of `DEVICE_LINK_V2.md` applies as written. Desktop specifics:

**Runtime.** `model.location` is `computer` when the provider's address is this machine, a `.local`
name or a private address, `cloud` otherwise. `defaults.autonomy` is the autonomy a new
conversation gets (the window's current one). `wake` lists each connected physical adapter's MAC
and broadcast address (private, non-Tailscale IPv4) only while **Allow phones to wake this
computer** is on.

**Tasks.** A task runs in the conversation open in the window if it is that one, otherwise in a
background runtime for that conversation, which stops once idle.

- In a conversation set to YOLO or full access: without `accept_autonomy`,
  `409 {"error": "desktop_autonomy_too_broad", "autonomy": …}`; with it but without the
  `broad_autonomy` scope, `403 scope_denied`; with a value other than the conversation's current
  one, `409 {"error": "autonomy_changed", "autonomy": …}`. A narrower setting than the phone
  confirmed is accepted.
- `on_device` needs `private_accepted` (`422 unsupported_task` otherwise); `phone_control` is
  always `422`. The turn uses the conversation's model; `model_location` in the task says where it
  ran.
- The same `request_id` again returns the first answer even if the conversation's setting changed
  since.
- Optional `"from_agent": true` (not in the shared contract yet) marks the task as part of a task
  the phone's AI handed over (`ask_computer`); the window labels it so. The Android app does not
  send it today, so those tasks show as ordinary phone tasks.
- Task document: `{"task_id", "state", "session_id", "created_at", "updated_at", "autonomy",
  "model_location"}`, plus `error`, `result` (last answer, up to 64 KiB) and, while running,
  `activity`: the tool in use and its main argument (command, path, address, query), redacted and
  at most 120 characters, for example `run_process pytest -q`.

**Stop.** `POST /mobile/sessions/{id}/stop` does what the window's stop button does and clears
the conversation's queued turns; `409 not_running` when nothing runs or is queued there.

**Inbox.** `runs` and `approvals` as in version 1; `turns` are the last 20 finished turns of any
conversation on this desktop (window or background, not agent runs), leaving out the asking
phone's own tasks, and empty when that phone's **Tell this phone when tasks on this computer
finish** is off; `summary` is the turn's last answer (300 characters) or its failure.
`transfers` (at most 50, newest first) and `phone_jobs` (at most 20) as in the contract.
`POST /mobile/inbox/read` marks scheduled runs read, as reading them in the window does.

**Files from a phone.** Saved under `来自手机/` in the open folder, names cleaned (no folders or
control characters, at most 200 characters) and `" (2)"`… added when taken. The body is streamed
to a staging file and checked against `size` and `sha256` before anything is saved
(`400 checksum_mismatch`, nothing left behind). `knowledge=<name>` adds the file to that knowledge
base (created if new; the default one for an empty name) when the knowledge base can read it; the
file is saved either way. No folder open: `503 no_workspace`.

**Browsing the open folder.** `GET /mobile/files` leaves out links, `.git` and the files
`is_sensitive_workspace_path` treats as sensitive (`.env`, keys, credentials); asking for one of
them directly is `404 unknown_path`, a path outside the folder `400 invalid_path`.

**Sending to a phone.** In the window: **Send to phone** on a message (its text; a lone `https://`
or `http://` address becomes a `link`), on a file open in the Workspace editor, and **Continue on
phone** in a conversation's menu (its last 200 user and assistant messages, within 1 MiB). A file
is copied into `device-link/outbox/` when sent, so later changes do not reach the phone. A
transfer the phone has not collected is removed after 7 days.

**Text from a phone.** Kept (20, all phones) and listed under **From phones** in the settings;
the window shows a notice with Copy and, for `https://` links, Open, and puts the text on the
clipboard unless **Put text from phones on the clipboard** is off.

**Conversations from a phone.** A new conversation in the open folder, in task mode, with the
new-conversation autonomy. The phone's messages become earlier finished turns; the first carries
`"origin": {"device", "labels": ["handoff"]}` so the window shows where it came from. Files listed
in `files` must be ones this phone uploaded (`404 unknown_transfer` otherwise) and are listed in a
first message. With `prompt`, the task follows the task rules above; when refused, nothing is
created. The pictures among the files go to the model with the prompt, as pictures attached in
the window do, when the model is known to look at pictures (what the window shows as vision
ready); another model gets their paths only, so a model that takes no pictures cannot refuse the
task over them.

**Knowledge.** Documents are exchanged as passages. Writes are added ready, with origin `phone`
(shown as "From phone" on the Knowledge page), deduplicated by `sha256` across all knowledge bases.
The desktop's search uses its own word index; there are no vectors to compute.

**Device.** `GET /mobile/device` returns the phone's record with the last 100 activity entries;
`POST /mobile/device` takes `accepts_jobs` only.

## Requests to phones (`phone_task`)

The desktop's AI gets the tool `phone_task(task, operate_phone=false, device?, wait_minutes=15)`
only while the endpoint is on and at least one paired phone reports `accepts_jobs: true` (checked
for each model request). It is approved like a network call: asked in ask and workspace autonomy,
allowed in YOLO and full access. The call queues a phone job (`waiting`, expires after 10 minutes
unanswered), waits for the phone's reports (`POST /mobile/phone-jobs/{id}`, transitions checked as
in the contract) and returns `{"job_id", "phone", "state", "result"|"error"|"reason"}`. Stopping
the turn cancels the job; the phone sees `cancelled` in its inbox for an hour. The window shows
each request's state above the composer and in the tool row.

## Window labels

A user message a phone handed over carries `origin: {"device", "labels"}` in the live event and in
history. Labels: `broad_autonomy` (the phone confirmed auto-approval), `private` (the phone
confirmed sending private details), `subtask` (`from_agent`), `handoff` (a conversation continued
from the phone). The window shows "From phone <name>" with the labels.

## Activity

Each phone's record (`GET /mobile/device`, the settings page) logs `paired`, `task_sent`,
`task_finished`, `approval_decided`, `turn_stopped`, `file_received`, `file_sent`, `text_received`,
`text_sent`, `conversation_received`, `conversation_sent`, `job_sent`, `job_finished` and
`knowledge_synced`, each with one line of at most 200 characters; the last 100 are kept.

## Errors

Errors are `{"error": "<code>"}` with the HTTP status, plus `"autonomy"` on the two autonomy
refusals: `400` invalid input, `Host`, `checksum_mismatch` or `invalid_path`, `401
unauthorized`, `403 scope_denied` or pairing errors, `404` (`unknown_*`), `409`
(`request_id_conflict`, `desktop_autonomy_too_broad`, `autonomy_changed`, `invalid_transition`,
`not_running`, `approval_already_resolved`), `410 job_expired`, `413 payload_too_large`, `422
unsupported_task`, `429 too_many_attempts`, `503` (`no_workspace`, `desktop_not_ready`,
`storage_unavailable`).
