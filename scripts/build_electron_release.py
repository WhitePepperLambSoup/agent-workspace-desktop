"""Build and verify the authoritative Electron Windows bundle.

The Python gateway is frozen as an external sidecar. The Electron process never imports
Python sources or a second desktop framework.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import tomllib
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import quote

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DESKTOP_ROOT = PROJECT_ROOT / "desktop"
SIDECAR_PATH = DESKTOP_ROOT / "build" / "sidecar" / "agent-workspace-ui-gateway.exe"
SIDECAR_RUNTIME_PATH = SIDECAR_PATH.parent / "_internal"
MANIFEST_NAME = "ELECTRON-RELEASE.json"
SBOM_NAME = "electron-sbom.json"
INVENTORY_NAME = "SHA256SUMS.txt"
PRODUCT_NAME = "AgentWorkspace"
PYTHON_VERSION = "3.12.10"
_MANIFEST_EXCLUDED = frozenset({MANIFEST_NAME, INVENTORY_NAME})
_ELECTRON_RUNTIME_PACKAGES = frozenset({"electron"})
_FORBIDDEN_SIDECAR_MARKERS = (b"PySide6",)
_RELEASE_VERSION = re.compile(
    r"(?P<major>0|[1-9][0-9]*)\."
    r"(?P<minor>0|[1-9][0-9]*)\."
    r"(?P<patch>0|[1-9][0-9]*)"
    r"(?:(?:a|-alpha\.)(?P<alpha>0|[1-9][0-9]*))?\Z"
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _is_reparse_point(path: Path) -> bool:
    try:
        attributes = getattr(os.lstat(path), "st_file_attributes", 0)
    except OSError:
        return False
    flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    return path.is_symlink() or bool(attributes & flag)


def _reject_reparse_components(path: Path) -> None:
    absolute = path.absolute()
    for component in (absolute, *absolute.parents):
        if _is_reparse_point(component):
            raise RuntimeError(f"release path contains a reparse point: {component}")


def _files(bundle: Path) -> list[Path]:
    if _is_reparse_point(bundle):
        raise RuntimeError(f"release bundle may not be a reparse point: {bundle}")
    pending = list(bundle.iterdir())
    files: list[Path] = []
    while pending:
        path = pending.pop()
        if _is_reparse_point(path):
            raise RuntimeError(f"release bundle contains a reparse point: {path}")
        if path.is_dir():
            pending.extend(path.iterdir())
        elif path.is_file():
            files.append(path)
        else:
            raise RuntimeError(f"release bundle contains an unsupported file: {path}")
    return sorted(files, key=lambda item: item.as_posix().casefold())


def _relative(path: Path, bundle: Path) -> str:
    return path.relative_to(bundle).as_posix()


def _validated_relative(value: object) -> str:
    if not isinstance(value, str) or not value or len(value) > 4096 or "\\" in value:
        raise RuntimeError("Electron release path is invalid")
    if any(ord(character) < 32 for character in value):
        raise RuntimeError("Electron release path is invalid")
    candidate = PurePosixPath(value)
    if (
        candidate.is_absolute()
        or any(part in {"", ".", ".."} for part in candidate.parts)
        or ":" in candidate.parts[0]
        or candidate.as_posix() != value
    ):
        raise RuntimeError("Electron release path is invalid")
    return value


def _project_version() -> str:
    with (PROJECT_ROOT / "pyproject.toml").open("rb") as stream:
        document = tomllib.load(stream)
    version = document.get("project", {}).get("version")
    if not isinstance(version, str) or not version:
        raise RuntimeError("project version is missing")
    try:
        desktop_document = json.loads((DESKTOP_ROOT / "package.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("Electron package metadata is invalid") from error
    desktop_version = (
        desktop_document.get("version") if isinstance(desktop_document, dict) else None
    )
    if not isinstance(desktop_version, str) or not desktop_version:
        raise RuntimeError("Electron package version is missing")
    if _release_version_identity(version) != _release_version_identity(desktop_version):
        raise RuntimeError("Python and Electron release versions do not match")
    return version


def _release_version_identity(value: str) -> tuple[int, int, int, int | None]:
    match = _RELEASE_VERSION.fullmatch(value)
    if match is None:
        raise RuntimeError(f"unsupported release version: {value}")
    alpha = match.group("alpha")
    return (
        int(match.group("major")),
        int(match.group("minor")),
        int(match.group("patch")),
        int(alpha) if alpha is not None else None,
    )


def _assert_safe_bundle(bundle: Path) -> None:
    if not bundle.is_dir():
        raise RuntimeError(f"Electron bundle does not exist: {bundle}")
    forbidden_suffixes = {".map", ".pdb"}
    forbidden_names = {".env", ".env.local", "secrets.json", "credentials.json"}
    for path in _files(bundle):
        relative = _relative(path, bundle)
        if path.suffix.casefold() in forbidden_suffixes:
            raise RuntimeError(f"development artifact is present in release: {relative}")
        if path.name.casefold() in forbidden_names or ".env." in path.name.casefold():
            raise RuntimeError(f"secret-like file is present in release: {relative}")
    required = {
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
        "resources/app.asar",
        "resources/sidecar/agent-workspace-ui-gateway.exe",
    }
    available = {_relative(path, bundle) for path in _files(bundle)}
    missing = sorted(required - available)
    if missing:
        raise RuntimeError(f"Electron bundle is incomplete: {missing}")
    executables = [path for path in bundle.iterdir() if path.suffix.casefold() == ".exe"]
    if not any(_is_x64_windows_executable(path) for path in executables):
        raise RuntimeError("Electron bundle is missing an x64 Electron executable")
    sidecar = bundle / "resources" / "sidecar" / "agent-workspace-ui-gateway.exe"
    try:
        content = sidecar.read_bytes()
    except OSError as error:
        raise RuntimeError("Electron sidecar cannot be read") from error
    if any(marker in content for marker in _FORBIDDEN_SIDECAR_MARKERS):
        raise RuntimeError("Electron sidecar contains a forbidden Qt runtime marker")


def _is_x64_windows_executable(path: Path) -> bool:
    try:
        with path.open("rb") as stream:
            header = stream.read(0x40)
            if len(header) < 0x40 or header[:2] != b"MZ":
                return False
            pe_offset = int.from_bytes(header[0x3C:0x40], "little")
            if pe_offset < 0x40 or pe_offset > path.stat().st_size - 6:
                return False
            stream.seek(pe_offset)
            return stream.read(4) == b"PE\0\0" and stream.read(2) == b"\x64\x86"
    except OSError:
        return False


def _component(ecosystem: str, name: str, version: str) -> dict[str, Any]:
    normalized_name = name.replace("_", "-").casefold() if ecosystem == "pypi" else name
    return {
        "type": "library",
        "name": normalized_name,
        "version": version,
        "purl": f"pkg:{ecosystem}/{quote(normalized_name, safe='/')}@{quote(version, safe='')}",
        "properties": [{"name": "agent-workspace:ecosystem", "value": ecosystem}],
    }


def _node_runtime_components() -> list[dict[str, Any]]:
    package_lock = DESKTOP_ROOT / "package-lock.json"
    raw = json.loads(package_lock.read_text(encoding="utf-8"))
    packages = raw.get("packages")
    if not isinstance(packages, dict):
        raise RuntimeError("Electron package lock is invalid")
    components: dict[str, dict[str, Any]] = {}
    for package_path, metadata in packages.items():
        if (
            not isinstance(package_path, str)
            or "node_modules/" not in package_path
            or not isinstance(metadata, dict)
        ):
            continue
        name = package_path.rsplit("node_modules/", maxsplit=1)[-1]
        if metadata.get("dev") is True and name not in _ELECTRON_RUNTIME_PACKAGES:
            continue
        version = metadata.get("version")
        if not isinstance(version, str) or not version:
            continue
        component = _component("npm", name, version)
        components[component["purl"]] = component
    return [components[key] for key in sorted(components)]


def _python_runtime_components() -> list[dict[str, Any]]:
    with (PROJECT_ROOT / "uv.lock").open("rb") as stream:
        raw = tomllib.load(stream)
    packages = raw.get("package")
    if not isinstance(packages, list):
        raise RuntimeError("Python lock file is invalid")
    by_name: dict[str, list[dict[str, Any]]] = {}
    root: dict[str, Any] | None = None
    for item in packages:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            continue
        name = item["name"].casefold()
        by_name.setdefault(name, []).append(item)
        if name == "agent-workspace":
            root = item
    if root is None:
        raise RuntimeError("workspace package is missing from Python lock file")
    pending = [
        item["name"].casefold()
        for item in root.get("dependencies", [])
        if isinstance(item, dict) and isinstance(item.get("name"), str)
    ]
    visited: set[str] = set()
    components: dict[str, dict[str, Any]] = {}
    while pending:
        name = pending.pop()
        if name in visited:
            continue
        visited.add(name)
        for item in by_name.get(name, []):
            version = item.get("version")
            if isinstance(version, str) and version:
                component = _component("pypi", name, version)
                components[component["purl"]] = component
            pending.extend(
                dependency["name"].casefold()
                for dependency in item.get("dependencies", [])
                if isinstance(dependency, dict) and isinstance(dependency.get("name"), str)
            )
    pyinstaller_versions = {
        version
        for item in by_name.get("pyinstaller", [])
        if isinstance((version := item.get("version")), str) and version
    }
    if not pyinstaller_versions:
        raise RuntimeError("PyInstaller is missing from the Python lock file")
    if len(pyinstaller_versions) > 1:
        raise RuntimeError("Python lock file has ambiguous PyInstaller versions")
    pyinstaller = _component("pypi", "pyinstaller", pyinstaller_versions.pop())
    components[pyinstaller["purl"]] = pyinstaller
    return [components[key] for key in sorted(components)]


def _write_sbom(bundle: Path, version: str | None = None) -> Path:
    packages = sorted(
        [
            *_node_runtime_components(),
            *_python_runtime_components(),
            _component("generic", "CPython", PYTHON_VERSION),
        ],
        key=lambda component: component["purl"],
    )
    document = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "version": 1,
        "metadata": {
            "component": {
                "type": "application",
                "name": "Agent Workspace Electron",
                "version": version or _project_version(),
            }
        },
        "components": packages,
    }
    destination = bundle / SBOM_NAME
    destination.write_text(
        json.dumps(document, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return destination


def _compute_sidecar_source_digest() -> str:
    digest = hashlib.sha256()
    sources: list[Path] = []
    src_root = PROJECT_ROOT / "src"
    if src_root.is_dir():
        sources.extend(
            path
            for path in src_root.rglob("*.py")
            if path.is_file() and not _is_reparse_point(path)
        )
    for special_name in ("pyproject.toml", "uv.lock"):
        special = PROJECT_ROOT / special_name
        if special.is_file():
            sources.append(special)
    build_script = PROJECT_ROOT / "scripts" / "build_electron_release.py"
    if build_script.is_file():
        sources.append(build_script)
    sources.sort(key=lambda item: item.relative_to(PROJECT_ROOT).as_posix())
    for source in sources:
        relative = source.relative_to(PROJECT_ROOT).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(source.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _compute_desktop_source_digest() -> str:
    digest = hashlib.sha256()
    source_root = DESKTOP_ROOT / "src"
    sources = (
        [path for path in source_root.rglob("*") if path.is_file()] if source_root.is_dir() else []
    )
    sources.extend(
        DESKTOP_ROOT / name
        for name in ("package.json", "package-lock.json", "electron.vite.config.ts")
        if (DESKTOP_ROOT / name).is_file()
    )
    for path in sorted(sources):
        _reject_reparse_components(path)
        digest.update(path.relative_to(DESKTOP_ROOT).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _sidecar_digest_path(sidecar: Path) -> Path:
    return sidecar.with_name(sidecar.name + ".digest")


def _read_sidecar_digest(sidecar: Path) -> str | None:
    digest_file = _sidecar_digest_path(sidecar)
    if not digest_file.is_file() or not sidecar.is_file():
        return None
    try:
        data = json.loads(digest_file.read_text(encoding="utf-8"))
        val = data.get("source_digest")
        exe_hash = data.get("executable_sha256")
        if exe_hash and _sha256(sidecar) != exe_hash:
            return None
        return val if isinstance(val, str) else None
    except (OSError, json.JSONDecodeError):
        return None


def _write_sidecar_digest(sidecar: Path, digest: str) -> None:
    digest_file = _sidecar_digest_path(sidecar)
    exe_hash = _sha256(sidecar) if sidecar.is_file() else None
    digest_file.write_text(
        json.dumps(
            {
                "source_digest": digest,
                "executable_sha256": exe_hash,
                "python_version": PYTHON_VERSION,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def _write_manifest(bundle: Path, version: str, source_digest: str | None = None) -> Path:
    manifest = {
        "format_version": 1,
        "product": "Agent Workspace",
        "name": PRODUCT_NAME,
        "version": version,
        "platform": "windows-x64",
        "signed": False,
        "sidecar_source_digest": source_digest or _compute_sidecar_source_digest(),
        "desktop_source_digest": _compute_desktop_source_digest(),
        "files": [
            {"path": _relative(path, bundle), "size": path.stat().st_size, "sha256": _sha256(path)}
            for path in _files(bundle)
            if _relative(path, bundle) not in _MANIFEST_EXCLUDED
        ],
    }
    destination = bundle / MANIFEST_NAME
    destination.write_text(
        json.dumps(manifest, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return destination


def _write_inventory(bundle: Path) -> Path:
    destination = bundle / INVENTORY_NAME
    lines = [
        f"{_sha256(path)}  {_relative(path, bundle)}"
        for path in _files(bundle)
        if _relative(path, bundle) != INVENTORY_NAME
    ]
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return destination


def _verify_inventory(bundle: Path, files: list[Path]) -> None:
    inventory = bundle / INVENTORY_NAME
    if not inventory.is_file():
        raise RuntimeError("SHA-256 inventory is missing")
    listed: set[str] = set()
    for line in inventory.read_text(encoding="utf-8").splitlines():
        digest, separator, relative = line.partition("  ")
        try:
            relative = _validated_relative(relative)
        except RuntimeError as error:
            raise RuntimeError("SHA-256 inventory path is invalid") from error
        if (
            separator != "  "
            or len(digest) != 64
            or any(character not in "0123456789abcdef" for character in digest)
            or relative in listed
        ):
            raise RuntimeError("SHA-256 inventory entry is invalid")
        listed.add(relative)
        path = bundle.joinpath(*PurePosixPath(relative).parts)
        if not path.is_file() or _sha256(path) != digest:
            raise RuntimeError(f"SHA-256 inventory hash mismatch: {relative}")
    actual = {
        _relative(path, bundle) for path in files if _relative(path, bundle) != INVENTORY_NAME
    }
    if listed != actual:
        raise RuntimeError("SHA-256 inventory does not cover the bundle")


def _verify_sbom(bundle: Path, expected_version: str) -> None:
    try:
        document = json.loads((bundle / SBOM_NAME).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("Electron SBOM is invalid") from error
    metadata = document.get("metadata") if isinstance(document, dict) else None
    application = metadata.get("component") if isinstance(metadata, dict) else None
    components = document.get("components") if isinstance(document, dict) else None
    if (
        document.get("bomFormat") != "CycloneDX"
        or document.get("specVersion") != "1.5"
        or not isinstance(application, dict)
        or application.get("type") != "application"
        or application.get("version") != expected_version
        or not isinstance(components, list)
    ):
        raise RuntimeError("Electron SBOM is invalid")
    purls: set[str] = set()
    for component in components:
        if (
            not isinstance(component, dict)
            or component.get("type") != "library"
            or not isinstance(component.get("name"), str)
            or not isinstance(component.get("version"), str)
            or not isinstance(component.get("purl"), str)
            or component["purl"] in purls
        ):
            raise RuntimeError("Electron SBOM component is invalid")
        purls.add(component["purl"])


def verify_release_bundle(
    bundle: Path, expected_source_digest: str | None = None
) -> dict[str, Any]:
    """Verify package contents and all recorded hashes."""
    _reject_reparse_components(bundle)
    bundle = bundle.absolute()
    _assert_safe_bundle(bundle)
    files = _files(bundle)
    manifest_path = bundle / MANIFEST_NAME
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (
        not isinstance(raw, dict)
        or raw.get("format_version") != 1
        or raw.get("platform") != "windows-x64"
    ):
        raise RuntimeError("invalid Electron release manifest")
    source_digest = raw.get("sidecar_source_digest")
    if (
        not isinstance(source_digest, str)
        or len(source_digest) != 64
        or any(character not in "0123456789abcdef" for character in source_digest)
    ):
        raise RuntimeError("Electron release manifest sidecar source digest is invalid")
    expected = (
        expected_source_digest
        if expected_source_digest is not None
        else _compute_sidecar_source_digest()
    )
    if source_digest != expected:
        raise RuntimeError("Electron release manifest sidecar source digest mismatch")
    if raw.get("desktop_source_digest") != _compute_desktop_source_digest():
        raise RuntimeError("Electron release manifest desktop source digest mismatch")
    entries = raw.get("files")
    if not isinstance(entries, list):
        raise RuntimeError("Electron release manifest file list is invalid")
    listed: set[str] = set()
    for item in entries:
        if not isinstance(item, dict):
            raise RuntimeError("Electron release manifest entry is invalid")
        relative = _validated_relative(item.get("path"))
        if relative in listed:
            raise RuntimeError("Electron release manifest path is invalid")
        listed.add(relative)
        path = bundle.joinpath(*PurePosixPath(relative).parts)
        if (
            not path.is_file()
            or path.stat().st_size != item.get("size")
            or _sha256(path) != item.get("sha256")
        ):
            raise RuntimeError(f"Electron release hash mismatch: {relative}")
    actual = {
        _relative(path, bundle)
        for path in files
        if _relative(path, bundle) not in _MANIFEST_EXCLUDED
    }
    if listed != actual:
        raise RuntimeError("Electron release manifest does not cover the bundle")
    version = raw.get("version")
    if not isinstance(version, str) or not version:
        raise RuntimeError("invalid Electron release manifest")
    _verify_inventory(bundle, files)
    _verify_sbom(bundle, version)
    return raw


def _run(command: list[str], cwd: Path, environment: dict[str, str] | None = None) -> None:
    subprocess.run(command, cwd=cwd, env=environment, check=True)


def _uv_executable() -> str:
    discovered = shutil.which("uv")
    if discovered:
        return discovered
    bundled_tool = PROJECT_ROOT / "build" / "tooling" / "uv" / "bin" / "uv.exe"
    if bundled_tool.is_file():
        return str(bundled_tool)
    raise RuntimeError("uv executable is unavailable; install uv or add it to PATH")


def _freeze_sidecar(output: Path, source_digest: str | None = None) -> Path:
    expected_source_digest = source_digest or _compute_sidecar_source_digest()
    output.parent.mkdir(parents=True, exist_ok=True)
    work_root = PROJECT_ROOT / "build" / "electron-sidecar"
    (work_root / "work").mkdir(parents=True, exist_ok=True)
    (work_root / "spec").mkdir(parents=True, exist_ok=True)
    dist_root = work_root / "dist"
    _run(
        [
            _uv_executable(),
            "run",
            "--frozen",
            "--python",
            PYTHON_VERSION,
            "--group",
            "package",
            "pyinstaller",
            "--clean",
            "--noconfirm",
            "--onedir",
            "--contents-directory",
            "_internal",
            "--paths",
            str(PROJECT_ROOT / "src"),
            "--workpath",
            str(work_root / "work"),
            "--specpath",
            str(work_root / "spec"),
            "--exclude-module",
            "PySide6",
            "--name",
            output.stem,
            "--distpath",
            str(dist_root),
            str(PROJECT_ROOT / "src" / "agent_workspace" / "ui_gateway" / "__main__.py"),
        ],
        PROJECT_ROOT,
    )
    produced = dist_root / output.stem
    produced_executable = produced / output.name
    produced_runtime = produced / "_internal"
    if not produced_executable.is_file() or not produced_runtime.is_dir():
        raise RuntimeError(f"PyInstaller did not produce a complete sidecar at {produced}")
    output.unlink(missing_ok=True)
    staged_runtime = output.parent / "_internal"
    if staged_runtime.exists():
        shutil.rmtree(staged_runtime)
    shutil.copy2(produced_executable, output)
    shutil.copytree(produced_runtime, staged_runtime)
    if _compute_sidecar_source_digest() != expected_source_digest:
        output.unlink(missing_ok=True)
        if staged_runtime.exists():
            shutil.rmtree(staged_runtime)
        _sidecar_digest_path(output).unlink(missing_ok=True)
        raise RuntimeError("Python sources changed during sidecar build")
    _write_sidecar_digest(output, expected_source_digest)
    return output


def build_release(output_directory: Path, version: str | None = None) -> Path:
    """Build an unpacked Electron bundle and attach auditable metadata."""
    if os.name != "nt":
        raise RuntimeError("Electron Windows release requires Windows")
    if platform.machine().casefold() not in {"amd64", "x86_64"}:
        raise RuntimeError("Electron Windows release requires an x64 build host")
    _reject_reparse_components(output_directory)
    output_directory = output_directory.absolute()
    if not (DESKTOP_ROOT / "node_modules").is_dir():
        raise RuntimeError("Electron dependencies are missing; run `npm ci` in desktop/")
    sidecar = SIDECAR_PATH
    force_freeze = os.environ.get("AGENT_WORKSPACE_FREEZE_SIDECAR") == "1"
    disallow_freeze = os.environ.get("AGENT_WORKSPACE_FREEZE_SIDECAR") == "0"
    current_source_digest = _compute_sidecar_source_digest()
    existing_digest = _read_sidecar_digest(sidecar) if sidecar.is_file() else None
    sidecar_runtime = sidecar.parent / "_internal"
    is_stale = (
        not sidecar.is_file()
        or not sidecar_runtime.is_dir()
        or existing_digest != current_source_digest
    )

    if force_freeze or is_stale:
        if disallow_freeze and is_stale:
            raise RuntimeError(
                f"stale or missing frozen sidecar: {sidecar}; "
                "cannot re-freeze because AGENT_WORKSPACE_FREEZE_SIDECAR=0"
            )
        sidecar = _freeze_sidecar(sidecar, current_source_digest)
    if any(marker in sidecar.read_bytes() for marker in _FORBIDDEN_SIDECAR_MARKERS):
        raise RuntimeError("frozen Electron sidecar contains a forbidden Qt runtime marker")
    output_directory.mkdir(parents=True, exist_ok=True)
    desktop_source_digest = _compute_desktop_source_digest()
    _run(["npm.cmd", "run", "package:win"], DESKTOP_ROOT)
    if desktop_source_digest != _compute_desktop_source_digest():
        raise RuntimeError("Desktop sources changed during Electron packaging")
    source = DESKTOP_ROOT / "dist" / "win-unpacked"
    if not source.is_dir():
        raise RuntimeError(f"electron-builder did not produce {source}")
    destination = output_directory / PRODUCT_NAME
    if destination.exists() or _is_reparse_point(destination):
        _reject_reparse_components(destination)
        shutil.rmtree(destination)
    shutil.copytree(source, destination)
    shutil.copy2(PROJECT_ROOT / "LICENSE", destination / "LICENSE")
    shutil.copy2(PROJECT_ROOT / "THIRD_PARTY_NOTICES.md", destination / "THIRD_PARTY_NOTICES.md")
    bundled_sidecar = destination / "resources" / "sidecar" / sidecar.name
    if not bundled_sidecar.is_file():
        raise RuntimeError(f"packaged sidecar is missing: {bundled_sidecar}")
    if _sha256(bundled_sidecar) != _sha256(sidecar):
        raise RuntimeError("Packaged sidecar does not match the freshly staged executable")
    bundled_runtime = destination / "resources" / "sidecar" / "_internal"
    if not bundled_runtime.is_dir():
        raise RuntimeError(f"packaged sidecar runtime is missing: {bundled_runtime}")
    if _compute_sidecar_source_digest() != current_source_digest:
        raise RuntimeError("Python sources changed during Electron packaging")
    _write_sbom(destination, version or _project_version())
    _write_manifest(destination, version or _project_version(), current_source_digest)
    _write_inventory(destination)
    verify_release_bundle(destination, expected_source_digest=current_source_digest)
    return destination


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build or verify the Electron Windows release")
    parser.add_argument(
        "--output-dir", type=Path, default=PROJECT_ROOT / "dist" / "electron-release"
    )
    parser.add_argument("--verify", type=Path)
    parser.add_argument("--version")
    arguments = parser.parse_args(argv)
    if arguments.verify is not None:
        document = verify_release_bundle(arguments.verify)
        print(f"verified Electron release {document.get('version', 'unknown')}")
        return 0
    print(build_release(arguments.output_dir, arguments.version or _project_version()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
