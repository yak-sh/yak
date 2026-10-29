# Task tool verification

T-133046. Checks use in-memory graphs and MCP clients in the calling process. No
server, browser, gate or CI wait is part of this verification.

The recovered implementation passed these bounded direct test runs:

- `deno test -A --no-check` over graph changes/edit, task requests/tools, design
  tools, kernel decision, edge plugin and CLI args/completion/help: 84 passed, 0
  failed (5 seconds).
- The same runner over topic tools, graph tools, MCP graph schema and code
  description/sync consumers: 26 passed, 0 failed (2 seconds).
- `deno check` over graph/task/design tools, kernel plugin and CLI
  args/completion/help passed.

`deno task test` was stopped at its nine-second limit before test execution. The
direct runs above exercise the affected files without repeating its planning and
timing-budget work.

The executable MCP proofs are `proof.ts` (10 cases), `task-mcp.ts` (7 cases,
including task creation and editing from files on disk), and `decision-mcp.ts`
(3 cases). They passed. The file-input tests in `packages/mcp/files_test.ts`
also cover literal `@` compatibility, nested strings, read errors and CLI
parity. Disabling expansion caused the body and missing-file cases to fail;
restoring it passed all four. The existing MCP schema/mount tests passed 59
cases in 8 seconds.

The operational extensions passed 29 targeted tests across bounded runs: CLI
operations (1), account-bound delivery (1), builder forwarding (1), native
session MCP doors (1), generic argument resolution (14), existing visualize
doors (10) and remote visualize MCP (1). Every added or extended tool is called
through an in-process MCP client. These checks cover noun help, restart
handover, anatomy ownership, configured account credentials, isolation of remote
results, native input delivery and the HTTP snapshot URL used by the CLI. Each
passing run finished within nine seconds. A preceding 70-test run passed every
behavioral case but failed its timing budget; later native-test retries reached
the bounded timeout before the final three-second pass.

The final type check of the operational entry points reached its nine-second
limit without reporting errors. It is incomplete; the earlier type checks of the
recovered implementation and file-input change completed.

After rebasing onto main's shared tool registry, the generic/task/decision MCP
proofs passed again. Sixteen operational tests passed in two runs (3 and 5
seconds), including help/restart through the host registry and visualize's
injected fetch/environment interface. Forty-one affected MCP file, registry,
mount and schema tests passed in one second, with type checking and lint also
passing for that change. Replacing a tool while a file read is pending keeps the
admitted implementation and schema for that call; the next call uses the
replacement. The regression failed when execution fetched the tool again and
passed with the admitted snapshot restored.

`audit.py --references` verified all 651 retained invocation hashes against 96
source files in about three seconds. The fallback audit additionally verified
136 retained source references; see `audit-counts.json`.

`roster.ts after` lists the configured tools through MCP over an in-memory
graph, with the box's file-input capability enabled. `tokens.ts` counts the
exact compact JSON list using `gpt-tokenizer@3.4.0`, `o200k_base`: 80 tools /
33,373 tokens before, 84 tools / 32,332 tokens after, saving 1,041 tokens. The
baseline is main at the SHA in `roster-base.txt`; it was listed in its own
process against the same configured plugins, without opening the live graph. The
initial baseline and measurements remain in the earlier git commits. The shared
file-input initialize instruction is separate from the tool list. The snapshots
and per-tool measurements are retained beside this report.
