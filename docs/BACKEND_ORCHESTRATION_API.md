# Backend Orchestration API

This document is the frontend integration contract for multi-provider collaboration and durable
delivery. The implementation is backend-only. UI code should consume these public methods and
domain DTOs instead of replaying events or accessing private snapshots.

## Runtime

Create one shared runtime with `build_multi_provider_runtime(...)`. All routes share the event
store, workspace policy, tool registry, and event bus, while each route keeps its own provider,
model, and egress policy.

`MultiProviderRuntime` exposes:

- `collaborate(request)` and `resume_collaboration(handle)`
- `inspect_collaboration(handle)` and `list_collaborations(limit=50)`
- `cancel_collaboration(handle, reason=...)`
- `delivery_loop(route_id, allowed_tools=...)`
- `inspect_delivery(handle)` and `list_deliveries(limit=50)`
- `cancel_delivery(handle, reason=...)`
- `subscribe(listener)`, returning an unsubscribe callback
- `aclose()`, which cancels tracked work, closes providers, backs up SQLite, and releases the writer
  lock

Runtime collaboration autonomy must exactly match `CollaborationRequest.autonomy`. Delivery start
requires explicit `Autonomy.YOLO` or `Autonomy.FULL_ACCESS`; status inspection and cancellation do
not execute model or tool work.

## Collaboration

`CollaborationRequest` defines the goal, members, autonomy, title, and limits. It requires exactly
one lead. Members select a route, role, mode, instructions, and exact tool allowlist.

Execution uses deterministic phases:

1. Producers run concurrently within `max_concurrency`.
2. Reviewers run after all producers complete.
3. The lead synthesizes the final response.

Every member has an independent session. The revisioned shared work document is sent as
`ContentTrust.UNTRUSTED_DATA`. Interrupted member sessions are recovered, and a completed member
turn is not replayed if the process stopped before its contribution event was committed.

`CollaborationStatus` is the frontend DTO. `to_document()` returns JSON-ready data containing:

- workflow and session ids
- title, goal, state, and current phase
- per-member role, state, attempt, and session id
- document revision, aggregate completed-member usage, deadline, and last update
- terminal/block detail, `active`, `can_resume`, and `can_cancel`

Member states are `pending`, `running`, `retryable`, `exhausted`, `completed`, and `interrupted`.

## Delivery

`RuntimeDeliveryLoop.start(...)` creates a durable delivery and `resume(...)` executes another
bounded segment. Each model response must be exactly one canonical JSON object:

```json
{"status":"progress","checkpoint":"factual progress","next_action":"specific next work"}
```

```json
{"status":"deliver","final":"complete user-facing result"}
```

```json
{"status":"block","block_code":"stable_identifier","detail":"required external input"}
```

Duplicate keys, extra fields, Markdown wrappers, invalid UTF-8 text, and status/field mismatches are
rejected. Cycles, model/tool calls, input/output tokens, stalls, invalid signals, slice duration, and
global deadline are bounded and durable. Failed slices still consume a cycle and any recorded usage.

`DeliveryStatus.to_document()` returns workflow/session ids, route/model, state, cycle progress,
the persisted tool allowlist, checkpoint, next action, final/block details, usage, deadline, last
update, `active`, `can_resume`, and `can_cancel`. A persisted empty allowlist remains empty after
restart; reconstructing a loop without an allowlist cannot escalate it.

## Cancellation And Events

Cancellation is idempotent for terminal workflows. Active tasks receive `asyncio` cancellation and
persist a terminal cancellation event with the caller reason. Runnable or blocked workflows are
cancelled directly under the per-workflow lock.

Use `runtime.subscribe(listener)` for live updates. Runtime subscriptions use an isolated bounded
queue, preserve listener order, and cannot block workflow event publication. If a slow listener
overflows its queue, the oldest notification is dropped; durable state remains available through
the query API. Durable event types are prefixed with `collaboration.` or `delivery.`. On reconnect or
application restart, rebuild the view with the list and inspect methods; event listeners are
notifications, not the source of truth.

## Security Boundary

- Shared documents and supplemental data remain untrusted model input.
- Supplemental messages must be plain user-role text without tool calls, reasoning, or provider
  metadata.
- Tool schemas and execution both enforce each member's exact allowlist.
- Sensitive and untrusted provenance survives assistant-message persistence.
- Workflow handles are bound to their original resolved workspace and autonomy policy.
- YOLO is policy authorization, not an OS sandbox. Workspace containment, schema checks, CAS,
  budgets, deadlines, and provider egress policy still apply.
