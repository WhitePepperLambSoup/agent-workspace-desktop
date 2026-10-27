from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

from agent_workspace.tools.base import ToolError
from agent_workspace.tools.command import _resolve_executable, _safe_environment
from agent_workspace.tools.sandbox import _required_pinned_image

_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_TAG = re.compile(r"[a-z0-9][a-z0-9._/-]*(?::[a-z0-9][a-z0-9._-]*)?\Z")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build an immutable Agent Workspace sandbox image")
    parser.add_argument("--docker", required=True, help="absolute path to the trusted Docker CLI")
    parser.add_argument("--docker-sha256", required=True, help="expected Docker CLI SHA-256")
    parser.add_argument("--base-image", required=True, help="local digest-pinned base image")
    parser.add_argument("--tag", default="agent-workspace-sandbox:local", help="local output tag")
    parser.add_argument(
        "--dockerfile",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "packaging" / "sandbox" / "Dockerfile",
    )
    arguments = parser.parse_args()

    try:
        docker = _resolve_executable(arguments.docker)
        expected_sha256 = _required_sha256(arguments.docker_sha256, "Docker CLI")
        actual_sha256 = _sha256_file(docker)
        base_image = _required_pinned_image(arguments.base_image)
    except (OSError, ToolError, ValueError) as exc:
        parser.error(str(exc))
    if actual_sha256 != expected_sha256:
        parser.error("Docker CLI does not match --docker-sha256")
    if _TAG.fullmatch(arguments.tag) is None:
        parser.error("--tag must be a lowercase local Docker tag")
    dockerfile = arguments.dockerfile.resolve(strict=True)
    context = dockerfile.parent
    environment = _safe_environment()

    _run_checked(
        [str(docker), "image", "inspect", "--format", "{{.Id}}", base_image],
        environment,
        "digest-pinned base image is not installed locally",
        capture=True,
    )
    with tempfile.TemporaryDirectory(prefix="agent-workspace-sandbox-build-") as temporary:
        iidfile = Path(temporary) / "image-id.txt"
        _run_checked(
            [
                str(docker),
                "build",
                "--pull=false",
                "--network=none",
                "--build-arg",
                f"BASE_IMAGE={base_image}",
                "--tag",
                arguments.tag,
                "--iidfile",
                str(iidfile),
                "--file",
                str(dockerfile),
                str(context),
            ],
            environment,
            "sandbox image build failed",
            capture=False,
        )
        try:
            image_id = iidfile.read_text(encoding="ascii").strip()
        except OSError as exc:
            parser.error(f"cannot read Docker build image ID: {exc}")
    if (
        not image_id.startswith("sha256:")
        or _SHA256.fullmatch(image_id.removeprefix("sha256:")) is None
    ):
        parser.error("Docker returned an invalid image ID")
    print(
        json.dumps(
            {
                "docker_executable": str(docker),
                "docker_sha256": actual_sha256,
                "base_image": base_image,
                "sandbox_image": image_id,
                "environment": {
                    "AGENT_WORKSPACE_DOCKER_EXECUTABLE": str(docker),
                    "AGENT_WORKSPACE_DOCKER_SHA256": actual_sha256,
                    "AGENT_WORKSPACE_SANDBOX_IMAGE": image_id,
                },
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


def _required_sha256(value: str, label: str) -> str:
    normalized = value.casefold()
    if _SHA256.fullmatch(normalized) is None:
        raise ValueError(f"{label} SHA-256 must be 64 hexadecimal characters")
    return normalized


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _run_checked(
    arguments: list[str],
    environment: dict[str, str],
    failure: str,
    *,
    capture: bool,
) -> subprocess.CompletedProcess[str]:
    creation_flags = (
        subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    )
    result = subprocess.run(
        arguments,
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=False,
        creationflags=creation_flags,
        check=False,
    )
    if result.returncode != 0:
        detail = " ".join((result.stderr or result.stdout or "").split())[:1000]
        raise RuntimeError(
            f"{failure} (exit_code={result.returncode})" + (f": {detail}" if detail else "")
        )
    return result


if __name__ == "__main__":
    raise SystemExit(main())
