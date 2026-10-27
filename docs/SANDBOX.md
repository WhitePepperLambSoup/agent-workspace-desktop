# Local Execution Sandbox

Agent Workspace uses a local, host-side staged sandbox for model-requested commands. The default
execution path does not require Docker, WSL, a VM, a daemon, or a prebuilt image. The model only sees
the `sandbox_status` and `run_sandbox` tools; both report and use the local staged backend.

## What runs

For every invocation the backend:

1. validates the structured `argv`, working directory, timeout, and workspace identity;
2. creates a private copy of the workspace below the operating system temporary directory;
3. runs the command with shell interpolation disabled and bounded stdout/stderr capture;
4. computes a complete diff between the source workspace and the staged copy;
5. captures bounded postimage artifacts for changed regular files; and
6. removes the staging directory, including abandoned staging trees left by a cancelled worker.

The source workspace is never modified by `run_sandbox`. A write command therefore produces a
reviewable changeset. Applying a change is a separate operation through the sandbox change tools.

The staged directory is identified by the durable execution id, the supervising process id, and a
random nonce. It is created through a private `.creating-*` directory and published atomically. The
recovery pass runs once per backend instance and removes stale staging trees whose owner is no longer
alive.

## Effective boundary

This backend is a workflow boundary and a change review boundary. It is not an operating-system
security boundary. The child process runs as the current desktop user and can see host filesystem and
network resources that the operating system account can access. The status response therefore reports:

- `backend: "host-staged"`
- `network: "host"`
- `workspace_mount: "staged-copy"`
- `workspace_staged_copy`
- `job_object_limits`
- `bounded_output`
- `network_not_isolated`
- `host_filesystem_visible`
- `explicit_approval_required`

Frontends must display these facts before enabling an execution action. They must not describe this
backend as a container, network-isolated environment, or privilege boundary.

## Configuration

No container runtime or image configuration is required. The backend is selected by the application
registry and is available on a normal Windows installation with the packaged Python sidecar.

`AGENT_WORKSPACE_SANDBOX_BACKEND=host-staged`, `host`, or `local` is accepted as a compatibility
alias. It resolves to the same backend. Unknown backend ids fail closed. The application must not
silently select an unregistered or placeholder backend.

The command still needs to exist on the trusted host `PATH` (or be addressed by an absolute path).
The local backend special-cases the sidecar's Python executable and rejects an executable resolved
from inside the source workspace. Use `discover_executables` when a command is missing or when the
caller needs its resolved path and SHA-256 identity.

## PDF and file generation

The sandbox supports ordinary local toolchains, including XeLaTeX when it is installed on the host.
A PDF workflow uses a normal structured invocation such as:

```text
argv = [
  "xelatex",
  "-interaction=nonstopmode",
  "-halt-on-error",
  "-output-directory",
  ".",
  "main.tex",
]
```

The resulting PDF is captured as a binary artifact when it is within the per-file and per-run limits.
The result includes the changed path, byte count, SHA-256 digest, and bounded artifact content. The
caller should validate the file signature (`%PDF`) and page structure before presenting the artifact
as a successful PDF result.

## Limits and failure behavior

The backend rejects empty or malformed argument vectors, NUL bytes, oversized arguments, invalid
working directories, workspace identity mismatches, special filesystem nodes, links/reparse points,
and staging trees that escape the managed temporary root. It enforces bounded workspace growth,
minimum free space, command timeout, process-tree cleanup, output retention, artifact size, and total
artifact batch limits.

A missing executable, failed process, timeout, output limit, staging failure, or cleanup failure is
returned as a structured tool error. The source workspace remains unchanged. No failure path invokes a
container runtime or silently changes to an unapproved execution mode.

## Container and WSL isolation (evaluated 2026-10-07, not enabled)

Real OS-level isolation (no network, no host filesystem) would need a container or VM boundary. The
repository still contains the earlier `DockerSandboxBackend`: it runs a digest-pinned image with
`--network none`, a read-only root, all capabilities dropped, `no-new-privileges`, PID and memory
limits and a non-root user, and `scripts/build_sandbox_image.py` builds the image. It remains
deliberately unregistered, and no WSL backend exists.

It was not re-enabled because an isolation boundary must be verified end to end before the UI may
describe it as one, and that needs a running Docker daemon (Docker Desktop with WSL 2 on Windows), a
built and pinned image, and the `docker_live` tests passing on the target machine. Enabling it later
requires, at minimum:

1. an explicit opt-in (for example `AGENT_WORKSPACE_SANDBOX_BACKEND=docker`), never a silent fallback;
2. registering the backend only when that opt-in is set, with the existing pinned-image and
   executable-digest checks;
3. reporting `network: "none"` and the container mount in `sandbox_status`, and showing those facts
   in the desktop UI before execution; and
4. running the `docker_live` suite, plus a negative test that proves network and host paths are
   unreachable from inside the container.

Until then, treat `run_sandbox` as the change-review boundary described above, not a security boundary.

## Autonomy and approval

The policy layer decides whether `run_sandbox` is allowed for the current autonomy mode and whether a
sensitive-path approval is required. The sandbox status is factual and does not grant permission by
itself. Sensitive files such as environment files, private keys, and credential directories remain
subject to the normal workspace policy. Direct host-process execution is a separate capability and
must not be confused with the staged sandbox.

## Model-visible result contract

`sandbox_status` returns a bounded model-safe document with:

- backend id, availability, reason, network, workspace mode, and effective capabilities;
- diagnostic layer and code when the backend is unavailable; and
- safe recovery actions when a local executable or host runtime cannot be used.

`run_sandbox` returns the command result, exit code, timeout/output flags, bounded stdout/stderr,
workspace mode, and (for staged writes) the complete change manifest. Durable changeset creation is
transactional with tool settlement when a runtime execution context is available.

## Acceptance checklist

The release gate for this backend is:

- a clean process starts with no container runtime available;
- the default registry contains only `host-staged`;
- `ToolRegistry.for_workspace()` returns a `HostStagedSandboxBackend` by default;
- model-visible sandbox descriptions do not mention a container runtime;
- `sandbox_status` reports `backend: "host-staged"`, `network: "host"`, and
  `workspace_mount: "staged-copy"`;
- a command can create a file in staging while the source workspace stays unchanged;
- an installed XeLaTeX can compile a minimal document and the generated PDF is captured as a binary
  artifact;
- cancellation and stale staging recovery remove private temporary trees; and
- no test needs a daemon, image, network pull, or container runtime.

The focused contract tests are in `tests/test_sandbox_host_staged_contract.py` and the backend
lifecycle tests are in `tests/test_host_staged_sandbox.py`.

## Public interfaces

- `HostStagedSandboxBackend.status()` reports the effective local execution boundary.
- `HostStagedSandboxBackend.execute()` runs a structured command in a disposable staging copy.
- `SandboxStatusTool` exposes the status to the model.
- `RunSandboxTool` exposes structured execution to the model.
- `SandboxBackendRegistry` and `ToolRegistry.for_workspace()` select the local backend by default.
- `ApplySandboxChangeTool`, `ListSandboxChangesetsTool`, `InspectSandboxChangeTool`,
  `ReviewSandboxChangeTool`, and `SandboxChangeStatusTool` provide durable review and application
  of staged changes.

Future stronger isolation backends may implement the same protocol, but they must be explicit, expose
only verified capabilities, and preserve the local backend's staging and change-review guarantees.
