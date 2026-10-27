# Local Sandbox Acceptance Contract

This acceptance contract covers the local execution path introduced after removing the Docker
runtime dependency from the model-facing sandbox. It is deliberately independent of Docker Desktop,
WSL, a daemon, a container image, and network pulls.

## Required behavior

A clean process must satisfy all of the following:

- `SandboxBackendRegistry.default().ids()` returns exactly `("host-staged",)`.
- `ToolRegistry.for_workspace()` constructs `HostStagedSandboxBackend` when no backend is injected.
- The legacy `AGENT_WORKSPACE_SANDBOX_BACKEND=docker` value cannot register or invoke a Docker
  backend; it resolves to the local backend or is rejected before execution.
- The model-visible `sandbox_status` and `run_sandbox` descriptions contain no Docker or container
  runtime instructions.
- `sandbox_status` reports `backend=host-staged`, `network=host`, and
  `workspace_mount=staged-copy`, together with the explicit host boundary capabilities.
- A structured command can run with Docker unavailable and return bounded stdout, stderr, exit code,
  timeout state, and a staged change manifest.
- A command that creates or modifies files changes only the private staging copy. The source workspace
  remains unchanged until a separate sandbox-change application is authorized.
- Cancellation and stale-workspace recovery remove the private staging tree.
- If `xelatex` is installed, a minimal `.tex` document compiles in the staged copy and its generated
  PDF is returned as a bounded binary artifact whose content starts with `%PDF`.
- No default execution path calls a Docker executable, Docker API, Docker socket, image resolver, or
  container cleanup command.

## Focused verification

From the project root, run:

```powershell
.venv\Scripts\python -m pytest `
  tests/test_sandbox_host_staged_contract.py `
  tests/test_host_staged_sandbox.py `
  -q -p no:cacheprovider
```

The XeLaTeX case is skipped only when `xelatex` is absent from the host `PATH`; all other contract
checks remain mandatory. A skip is therefore an environment fact, not evidence that PDF generation
works.

The existing Docker implementation tests may remain as low-level legacy coverage while the Docker
backend is being removed from the application. They must never be used as evidence that the default
model-facing path still depends on Docker. Any test that asserts Docker is registered by default,
that the model sees Docker instructions, or that a missing daemon is a normal default failure is
obsolete under this contract and must be updated or deleted.

## Product evidence

A release report may claim local sandbox support only after recording:

- the exact focused pytest command and result;
- the backend id and status document returned by the packaged sidecar;
- one staged file-generation result showing source workspace preservation; and
- one PDF result, when the host has the required LaTeX executable, validated by a PDF parser or a
  `%PDF` signature plus page count.

It must not claim OS-level isolation. The local backend runs under the desktop user's host identity,
with host filesystem and network visibility, so `sandbox_status` and the UI must show that boundary.
