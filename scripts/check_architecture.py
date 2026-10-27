"""Fail CI when retired UI code or forbidden dependency directions return."""

from __future__ import annotations

import argparse
import ast
import re
import sys
import tomllib
from collections.abc import Sequence
from pathlib import Path
from typing import Any

_CORE_FORBIDDEN = frozenset(
    {
        "application",
        "providers",
        "policy",
        "storage",
        "tools",
        "ui",
        "ui_gateway",
    }
)
_CORE_EXTENSION_MODULES = frozenset(
    {
        "acceptance",
        "benchmarks",
        "comments",
        "durable_run_queue",
        "evals",
        "file_history",
        "instructions",
        "pipeline",
        "plans",
        "repo_map",
        "subagents",
    }
)
_BACKEND_LAYERS = frozenset({"application", "core", "policy", "providers", "storage", "tools"})
_RETIRED_IMPORTS = frozenset({"PySide6", "agent_workspace.ui.desktop"})
_TYPESCRIPT_IMPORT = re.compile(
    r"(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)[\"']([^\"']+)[\"']"
)
_NODE_BUILTINS = frozenset(
    {
        "assert",
        "async_hooks",
        "buffer",
        "child_process",
        "cluster",
        "console",
        "constants",
        "crypto",
        "dgram",
        "diagnostics_channel",
        "dns",
        "domain",
        "events",
        "fs",
        "http",
        "http2",
        "https",
        "inspector",
        "module",
        "net",
        "os",
        "path",
        "perf_hooks",
        "process",
        "punycode",
        "querystring",
        "readline",
        "repl",
        "stream",
        "string_decoder",
        "sys",
        "timers",
        "tls",
        "trace_events",
        "tty",
        "url",
        "util",
        "v8",
        "vm",
        "wasi",
        "worker_threads",
        "zlib",
    }
)


def _module_layer(source_root: Path, path: Path) -> str:
    relative = path.relative_to(source_root)
    return relative.parts[0] if len(relative.parts) > 1 else relative.stem


def _python_module(source_root: Path, path: Path) -> tuple[list[str], bool]:
    relative = path.relative_to(source_root).with_suffix("")
    parts = ["agent_workspace", *relative.parts]
    is_package = parts[-1] == "__init__"
    if is_package:
        parts.pop()
    return parts, is_package


def _imports(tree: ast.AST, source_root: Path, path: Path) -> list[str]:
    imported: list[str] = []
    module_parts, is_package = _python_module(source_root, path)
    package_parts = module_parts if is_package else module_parts[:-1]
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                keep = len(package_parts) - node.level + 1
                if keep < 1:
                    continue
                target = [*package_parts[:keep], *(node.module or "").split(".")]
                imported.append(".".join(part for part in target if part))
            elif node.module:
                imported.append(node.module)
    return imported


def _agent_layer(module: str) -> str | None:
    prefix = "agent_workspace."
    if not module.startswith(prefix):
        return None
    remainder = module[len(prefix) :]
    return remainder.split(".", 1)[0]


def _python_violations(root: Path) -> list[str]:
    source_root = root / "src/agent_workspace"
    if not source_root.is_dir():
        return []
    violations: list[str] = []
    for path in sorted(source_root.rglob("*.py")):
        relative = path.relative_to(root).as_posix()
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=relative)
        except (OSError, UnicodeError, SyntaxError) as exc:
            violations.append(f"{relative}: cannot inspect Python source: {exc}")
            continue
        source_layer = _module_layer(source_root, path)
        for imported in _imports(tree, source_root, path):
            if any(
                imported == retired or imported.startswith(f"{retired}.")
                for retired in _RETIRED_IMPORTS
            ):
                violations.append(f"{relative}: retired import {imported}")
            target_layer = _agent_layer(imported)
            if (
                source_layer == "core"
                and path.stem not in _CORE_EXTENSION_MODULES
                and target_layer in _CORE_FORBIDDEN
            ):
                violations.append(f"{relative}: core may not import {target_layer} ({imported})")
            if source_layer in _BACKEND_LAYERS and target_layer == "ui_gateway":
                violations.append(
                    f"{relative}: {source_layer} may not import ui_gateway ({imported})"
                )
    return violations


def _dependency_strings(metadata: dict[str, Any]) -> list[str]:
    project = metadata.get("project", {})
    groups = metadata.get("dependency-groups", {})
    values: list[str] = list(project.get("dependencies", []))
    values.extend(
        dependency
        for dependencies in project.get("optional-dependencies", {}).values()
        for dependency in dependencies
    )
    values.extend(dependency for dependencies in groups.values() for dependency in dependencies)
    return values


def _metadata_violations(root: Path) -> list[str]:
    path = root / "pyproject.toml"
    if not path.is_file():
        return []
    try:
        metadata = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, tomllib.TOMLDecodeError) as exc:
        return [f"pyproject.toml: cannot inspect metadata: {exc}"]
    return [
        f"pyproject.toml: retired dependency {dependency}"
        for dependency in _dependency_strings(metadata)
        if dependency.casefold().startswith("pyside6")
    ]


def _typescript_modules(path: Path) -> list[str]:
    try:
        source = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return []
    return _TYPESCRIPT_IMPORT.findall(source)


def _desktop_violations(root: Path) -> list[str]:
    desktop_source = root / "desktop/src"
    if not desktop_source.is_dir():
        return []
    violations: list[str] = []
    renderer = desktop_source / "renderer/src"
    if renderer.is_dir():
        for path in sorted(
            (
                *renderer.rglob("*.js"),
                *renderer.rglob("*.jsx"),
                *renderer.rglob("*.ts"),
                *renderer.rglob("*.tsx"),
            )
        ):
            if ".test." in path.name or ".spec." in path.name:
                continue
            relative = path.relative_to(root).as_posix()
            for module in _typescript_modules(path):
                if (
                    module == "electron"
                    or module.startswith("electron/")
                    or module.startswith("node:")
                    or module.split("/", 1)[0] in _NODE_BUILTINS
                ):
                    violations.append(f"{relative}: renderer may not import {module}")
    for layer in ("main", "preload"):
        source = desktop_source / layer
        if not source.is_dir():
            continue
        for path in sorted(
            (
                *source.rglob("*.js"),
                *source.rglob("*.jsx"),
                *source.rglob("*.ts"),
                *source.rglob("*.tsx"),
            )
        ):
            if ".test." in path.name or ".spec." in path.name:
                continue
            relative = path.relative_to(root).as_posix()
            for module in _typescript_modules(path):
                if "renderer" in module.replace("\\", "/").split("/"):
                    violations.append(f"{relative}: {layer} may not import renderer ({module})")
    return violations


def find_violations(root: Path) -> list[str]:
    """Return stable, human-readable architecture violations below ``root``."""

    resolved = root.resolve()
    return [
        *_python_violations(resolved),
        *_metadata_violations(resolved),
        *_desktop_violations(resolved),
    ]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", type=Path, default=Path(__file__).resolve().parents[1])
    arguments = parser.parse_args(argv)
    violations = find_violations(arguments.root)
    if not violations:
        print("Architecture boundaries: OK")
        return 0
    print("Architecture boundary violations:", file=sys.stderr)
    for violation in violations:
        print(f"- {violation}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
