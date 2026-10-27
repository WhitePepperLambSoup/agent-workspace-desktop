# Benchmark scenarios

This directory is the home for weighted benchmark scenarios for the agent. The
framework itself lives in `agent_workspace/core/benchmarks.py` and is modeled
on mainstream agent evals:

- **tool_calling** — BFCL-style: the agent must call workspace tools
  (`read_file`, `write_file`, `list_files`, ...) in a given order, with
  arguments that are a subset of what the case expects.
- **coding** — HumanEval-style: the agent's final answer must contain a Python
  code block whose extracted function passes a set of `assert` statements.
- **loop** — multi-turn-loop style: the agent must complete a multi-step
  workflow (write then read back, two-step edits, ...).

## How a case is scored

Each case carries a `weight`. The weight is split evenly across the case's
check items:

1. the expected tool sequence is a prefix of the tools that actually started;
2. the expected tool arguments are a positional subset of what was proposed;
3. every `code_checks` assertion passes (run together as one `python <file>`
   invocation, exit code 0, 60 s timeout);
4. the expected final text appears in the final assistant text (when set).

The report aggregates `Σscore / Σweight` overall and per category.

## Adding scenarios

Two options, depending on whether you want to run against a live model or a
scripted provider.

### 1. Programmatic cases (recommended for real-model runs)

Build a `tuple[BenchmarkCase, ...]` and pass it to `run_benchmark`. The
built-in smoke suite is available out of the box:

```python
from agent_workspace.core.benchmarks import build_builtin_cases, run_benchmark

cases = build_builtin_cases()
```

Add your own cases by constructing `BenchmarkCase` directly:

```python
from agent_workspace.core.benchmarks import BenchmarkCase, BenchmarkCategory

custom_cases = (
    BenchmarkCase(
        id="tc_read_config",
        category=BenchmarkCategory.TOOL_CALLING,
        prompt="Read config.yaml and summarize the timeout value.",
        expected_tool_sequence=("read_file",),
        expected_tool_arguments=({"path": "config.yaml"},),
        expected_final_text="30",
        extra_files=(("config.yaml", "timeout: 30\n"),),
    ),
    BenchmarkCase(
        id="code_fib",
        category=BenchmarkCategory.CODING,
        prompt="Write a Python function fib(n) that returns the n-th Fibonacci number.",
        code_checks=("assert fib(0) == 0", "assert fib(6) == 8"),
        weight=1.2,
    ),
)
```

Scenarios in this directory can be plain Python modules that export a
`CASES` tuple or a `build_cases()` callable returning an iterable of
`BenchmarkCase` instances. The CLI loads every non-underscore `*.py` module
under a supplied directory, skips modules that export neither symbol, and
errors on modules that export both.

### 2. Scripted cases (deterministic, offline)

For CI-style regression evals that do not need a model, use a scripted
provider (see `tests/test_benchmarks.py` for a minimal example) so tool calls
point at real tools and the runner truly executes them.

## CLI

```text
agent-workspace bench run                       # run the built-in 8-case suite
agent-workspace bench run --case code_add       # run a single case by id
agent-workspace bench run --case code_add --case code_sort
agent-workspace bench run --directory bench/scenarios
agent-workspace bench run --scenario bench/scenarios/my_cases.py
agent-workspace bench run --json               # emit the report as JSON
```

When `--directory` or `--scenario` is supplied, the loaded scenarios replace
the built-in suite. `--case` filters whichever case collection was selected.
Provider options (`--profile`, `--provider`, `--protocol`, `--base-url`,
`--model`) match the other CLI commands.

The command constructs the `ApplicationService` from the configured provider,
calls `run_benchmark(service_factory, cases, workspace, provider_model)`, and
prints the `BenchmarkReport.render()` output. Each case runs in its own
session inside the same workspace; `extra_files` are seeded before the case
runs. Unless `--workspace` is given, cases execute in a fresh temporary
workspace that is removed when the command exits.

## Workflow acceptance contracts

For end-to-end workflows whose result is a durable artifact, use the acceptance
harness rather than treating a final sentence as success:

```text
uv run python scripts/run_acceptance_scenarios.py \
  --workspace-root tmp/acceptance-scenarios \
  --scenario latex-pdf \
  --max-attempts 3 \
  --json
```

The offline command is explicitly marked `mode=deterministic-fixture` and
`live_provider=false`. It exercises restart and artifact checks with a local
scripted provider; it does not claim that a live DeepSeek run succeeded. The
six contracts are `latex-pdf`, `paper-download`, `network-resource-download`,
`scientific-plot`, `programming-project`, and `multi-agent-report`. Each
failed/incomplete attempt is retained in its own `<scenario>.attempt-N`
directory, and the next attempt starts from an empty directory. Existing
attempt directories are rejected so evidence cannot be silently overwritten.
The two download contracts require `download_file` to preserve original bytes;
the offline fixture creates those files itself and therefore does not verify a
real network transfer or provenance. A live adapter can reuse
`run_acceptance_scenario` with the same artifact contracts and supply its
provider and repair hook.
