# Background Jobs

The backend exposes bounded, non-interactive background process jobs for runtimes that remain
alive. Jobs reuse the foreground process launch contract: direct executables require an expected
SHA-256, shell modes use a clean environment, stdin is closed, workspace paths are contained, and
the Windows Job Object terminates the process tree.

## Tools

- `start_background_job`: starts one process with a label, a 1-110 second wall-time limit, and a
  1 KiB-1 MiB retained-output limit.
- `background_job_status`: returns the durable lifecycle state.
- `background_job_logs`: returns bounded retained output from the terminal result.
- `stop_background_job`: terminates a running job and records `stopped`.

Lifecycle events are stored in the session event stream. A runtime restart marks non-terminal jobs
as `interrupted`; process IDs are never reattached because they are not durable identities. Runtime
close cancels active workers before closing SQLite.

A strict SQLite projection validates `created -> started -> terminal` transitions and supports
bounded status/log queries without replaying full event or result history at startup. Explicit stop
records `stopped`; a process wall-time expiry records `failed` with the retained process result.

ASK and WORKSPACE require normal host-process approval. YOLO does not advertise background process
tools because it rejects all host process execution. Job identity and lookup are scoped by session;
the same imported job id in another session cannot alias it. Retained output is bounded by UTF-8
encoded bytes. A runtime admits at most four active jobs and at most two per session. Recent status
and logs are read from the durable projection, while only live workers remain in memory.

The first implementation deliberately has no stdin, PTY, resize, terminal control, or daemon
reattachment. ConPTY requires a separate native handle transport and explicit approval semantics.
