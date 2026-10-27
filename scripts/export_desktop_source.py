#!/usr/bin/env python3
"""Write the desktop app's public source tree: an explicit allowlist, no tests unless asked.

The monorepo also holds the Android app, internal notes and local state; the desktop repository
gets only what builds and documents the desktop app and its shared Python core. Before anything
is written, every exported file is checked for credentials and for paths of this computer, and
the export stops if one turns up.

usage: python scripts/export_desktop_source.py OUTPUT_DIR [--with-tests] [--forbid TEXT ...]

OUTPUT_DIR must be empty or an earlier export (its .git directory is kept, everything else is
replaced), so the public history can grow one commit per release.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
from collections.abc import Iterable, Iterator
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

_ROOT_FILES = (
    ".env.example",
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "README.zh-CN.md",
    "SECURITY.md",
    "THIRD_PARTY_NOTICES.md",
    "pyproject.toml",
    "uv.lock",
)
_SCRIPTS = (
    "scripts/build_electron_release.py",
    "scripts/build_sandbox_image.py",
    "scripts/check_architecture.py",
    "scripts/export_desktop_source.py",
)
_DESKTOP_FILES = (
    "desktop/.gitignore",
    "desktop/electron.vite.config.ts",
    "desktop/package-lock.json",
    "desktop/package.json",
    "desktop/tsconfig.json",
)
# Folders exported whole, apart from generated and private files.
_TREES = (
    "src/agent_workspace",
    "desktop/src",
    "desktop/resources",
    "desktop/scripts",
    "docs",
    "contracts",
    "bench",
    "packaging/sandbox",
)
_TEST_TREES = ("tests", "desktop/tests")
_TEST_FILES = (
    "desktop/playwright.config.ts",
    "desktop/vitest.config.ts",
    "scripts/run_acceptance_scenarios.py",
    ".github/workflows/ci.yml",
)
_SKIPPED_DIRS = frozenset(
    {"__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", "node_modules", "out", "build",
     "dist", "test-results", "playwright-report", "output", ".vite"}
)  # fmt: skip
_PRIVATE_NAMES = re.compile(
    r"(^\.env$|^\.env\.(?!example$)|\.(db|db-wal|db-shm|sqlite3|pem|key|p12|pfx|jks|keystore|log)$"
    r"|^keys\.json$|^credentials\.json$)",
    re.IGNORECASE,
)
_TEXT_SUFFIXES = frozenset(
    {".py", ".ts", ".tsx", ".mjs", ".js", ".json", ".css", ".html", ".md", ".toml", ".txt",
     ".yml", ".yaml", ".lock", ".example", ".ps1", ".sh", ".cfg", ".ini", ".svg", ""}
)  # fmt: skip
# Keys must never be published; nor where the user of this computer keeps files (added at run
# time from this computer, so this script names nobody).
_KEYS = (
    re.compile(rb"sk-[A-Za-z0-9_-]{32,}"),
    re.compile(rb"ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}"),
    re.compile(rb"AKIA(?!IOSFODNN7EXAMPLE)[0-9A-Z]{16}"),  # AWS's documented example is fine
    re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
)


def _local_patterns(extra: Iterable[str]) -> list[re.Pattern[bytes]]:
    patterns = []
    user = os.environ.get("USERNAME") or os.environ.get("USER") or ""
    if len(user) >= 3:
        patterns.append(
            re.compile(rb"[\\/]+(Users|home)[\\/]+" + re.escape(user.encode()) + rb"\b", re.I)
        )
    patterns.extend(re.compile(re.escape(text.encode()), re.I) for text in extra if len(text) >= 3)
    return patterns


_PUBLIC_GITIGNORE = """\
# Python
__pycache__/
*.py[cod]
.venv/
.pytest_cache/
.mypy_cache/
.ruff_cache/
*.egg-info/
build/
dist/

# Local application state and secrets
.agent-workspace/
**/.agent/terminal-registry.json*
keys.json
*.db
*.db-shm
*.db-wal
*.log
.env
.env.*
!.env.example

# Editors and operating systems
.idea/
.vscode/
Thumbs.db
Desktop.ini
"""

_BUILD_WORKFLOW = """\
name: Build

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  # The public repository carries the program source only: these checks need no test files.
  checks:
    runs-on: windows-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
      - uses: astral-sh/setup-uv@d0cc045d04ccac9d8b7881df0226f9e82c39688e # v6.8.0
        with:
          enable-cache: true
          version: "0.11.25"
      - uses: actions/setup-node@1e60f620b9541d16bece96c5465dc8ee9832be0b # v4.0.3
        with:
          node-version: "22.14.0"
          cache: npm
          cache-dependency-path: desktop/package-lock.json
      - name: Install Python dependencies
        run: uv sync --frozen --python 3.12.10 --group dev --group audit --group package
      - name: Audit Python dependencies
        run: uv run --group audit pip-audit
      - name: Lint
        run: uv run ruff check src scripts
      - name: Format check
        run: uv run ruff format --check src scripts
      - name: Type check
        run: uv run mypy src scripts/build_electron_release.py scripts/check_architecture.py
      - name: Architecture boundaries
        run: uv run python scripts/check_architecture.py
      - name: Install Electron dependencies
        working-directory: desktop
        run: npm ci
      - name: Audit Electron production dependencies
        working-directory: desktop
        run: npm audit --registry=https://registry.npmjs.org --omit=dev --audit-level=high
      - name: Type check Electron
        working-directory: desktop
        run: npm run typecheck

  release:
    needs: checks
    runs-on: windows-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
      - uses: astral-sh/setup-uv@d0cc045d04ccac9d8b7881df0226f9e82c39688e # v6.8.0
        with:
          enable-cache: true
          version: "0.11.25"
      - uses: actions/setup-node@1e60f620b9541d16bece96c5465dc8ee9832be0b # v4.0.3
        with:
          node-version: "22.14.0"
          cache: npm
          cache-dependency-path: desktop/package-lock.json
      - name: Install Electron dependencies
        working-directory: desktop
        run: npm ci
      - name: Build the Windows release
        run: >-
          uv run --frozen --python 3.12.10 --group package python
          scripts/build_electron_release.py --output-dir dist/electron-release
      - name: Verify the Windows release
        run: >-
          uv run --frozen --python 3.12.10 python
          scripts/build_electron_release.py --verify dist/electron-release/AgentWorkspace
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: AgentWorkspace-windows-x64-unsigned
          path: dist/electron-release/AgentWorkspace/**/*
          if-no-files-found: error
"""


class ExportError(RuntimeError):
    """The export would publish something it must not, or cannot find what it needs."""


def _is_test(relative: Path) -> bool:
    name = relative.name
    return (
        ".test." in name
        or ".spec." in name
        or relative.parts[:5] == ("desktop", "src", "renderer", "src", "test")
    )


def _walk(tree: Path) -> Iterator[Path]:
    for path in sorted(tree.rglob("*")):
        relative = path.relative_to(ROOT)
        if any(part in _SKIPPED_DIRS for part in relative.parts) or path.is_symlink():
            continue
        if path.is_file():
            yield relative


def collect(*, with_tests: bool) -> list[Path]:
    """The repository-relative files of the public tree, sorted."""
    files: set[Path] = set()
    named = [*_ROOT_FILES, *_SCRIPTS, *_DESKTOP_FILES, *(_TEST_FILES if with_tests else ())]
    for name in named:
        if not (ROOT / name).is_file():
            raise ExportError(f"missing {name}")
        files.add(Path(name))
    trees = [*_TREES, *(_TEST_TREES if with_tests else ())]
    for tree in trees:
        if not (ROOT / tree).is_dir():
            raise ExportError(f"missing {tree}/")
        for relative in _walk(ROOT / tree):
            if not with_tests and _is_test(relative):
                continue
            files.add(relative)
    for relative in files:
        if _PRIVATE_NAMES.search(relative.name):
            raise ExportError(f"private file in the export: {relative.as_posix()}")
    return sorted(files)


def _content(relative: Path) -> bytes:
    data = (ROOT / relative).read_bytes()
    # The public repository stores text with LF line endings, as the monorepo's index does.
    if relative.suffix.lower() in _TEXT_SUFFIXES and b"\0" not in data[:8192]:
        data = data.replace(b"\r\n", b"\n")
    return data


def check_leaks(contents: Iterable[tuple[Path, bytes]], forbidden: Iterable[str] = ()) -> None:
    patterns = [*_KEYS, *_local_patterns(forbidden)]
    found = [
        f"{relative.as_posix()} (pattern {index})"
        for relative, data in contents
        for index, pattern in enumerate(patterns)
        if pattern.search(data)
    ]
    if found:
        raise ExportError("the export would publish private data:\n  " + "\n  ".join(found))


def _prepare(output: Path) -> None:
    if output.exists():
        if not output.is_dir():
            raise ExportError(f"{output} is not a directory")
        entries = [entry for entry in output.iterdir() if entry.name != ".git"]
        if entries and not (output / ".git").is_dir():
            raise ExportError(f"{output} is neither empty nor an earlier export")
        for entry in entries:
            if entry.is_dir() and not entry.is_symlink():
                shutil.rmtree(entry)
            else:
                entry.unlink()
    output.mkdir(parents=True, exist_ok=True)


def export(output: Path, *, with_tests: bool = False, forbidden: Iterable[str] = ()) -> int:
    output = output.resolve()
    if output == ROOT or ROOT in output.parents:
        raise ExportError("the output must be outside the monorepo")
    contents = [(relative, _content(relative)) for relative in collect(with_tests=with_tests)]
    generated = [(Path(".gitignore"), _PUBLIC_GITIGNORE.encode())]
    if not with_tests:
        generated.append((Path(".github/workflows/build.yml"), _BUILD_WORKFLOW.encode()))
    check_leaks([*contents, *generated], forbidden)
    _prepare(output)
    for relative, data in [*contents, *generated]:
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return len(contents) + len(generated)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("output", type=Path)
    parser.add_argument("--with-tests", action="store_true", help="include the test suites and CI")
    parser.add_argument(
        "--forbid",
        action="append",
        default=[],
        metavar="TEXT",
        help="also stop when a file contains this text (an e-mail address, a name)",
    )
    arguments = parser.parse_args(argv)
    try:
        count = export(
            arguments.output, with_tests=arguments.with_tests, forbidden=arguments.forbid
        )
    except ExportError as error:
        print(f"export stopped: {error}", file=sys.stderr)
        return 1
    print(f"exported {count} files to {arguments.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
