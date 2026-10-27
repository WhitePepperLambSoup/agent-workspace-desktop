# Sandbox Image

> **Legacy compatibility only.** The application default is the local `host-staged` sandbox
> documented in [`docs/SANDBOX.md`](../../docs/SANDBOX.md). The runtime, CLI, Electron sidecar,
> and model-facing tools do not invoke Docker. This directory and its build script remain only for
> isolated legacy integration coverage and are not required for normal development or release use.

This Dockerfile wraps an already-installed, digest-pinned Linux toolchain image. It deliberately
does not download packages during the build. Select and pre-pull a base image containing the
languages and build tools needed by the workspace.

Build through the repository script so the Docker CLI and base image identities are checked:

```powershell
uv run python scripts/build_sandbox_image.py `
  --docker "C:\Program Files\Docker\Docker\resources\bin\docker.exe" `
  --docker-sha256 "<docker.exe sha256>" `
  --base-image "registry.example/toolchain@sha256:<manifest digest>" `
  --tag "agent-workspace-sandbox:local"
```

The script performs a network-disabled build with `--pull=false`, inspects the resulting image, and
prints the immutable `sha256:<image-id>` plus the three runtime environment variables. Keep the
base image and resulting image local; `run_sandbox` also uses `--pull never`. If the environment
variable is omitted, the desktop runtime discovers the project-owned `agent-workspace-sandbox:local`
tag and resolves it to that immutable image ID before execution.

The selected base image must provide `/bin/sh` for the optional live integration test. Runtime
commands do not trust its configured entrypoint because `run_sandbox` explicitly overrides the
entrypoint with the first structured argv item.
