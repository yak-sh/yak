---
name: testing
description: >
  How tests work in ~/code/tasks and how to write one that earns its place:
  @yaks/testing (`test`, `suite`, `equal`, `until`, `///` doctests, fenced
  examples), `deno task test` and its deno/browser/terminal/workerd platforms,
  unchanged-dependency skips, kernel and workerd tests in workers/yak, the
  Stripe sandbox, and running the changed package's tests. Use it whenever you
  write, change, run, narrow, time or debug a test, doctest or README example,
  when a run fails or is slow, a brief says "add a test", or before landing to
  choose what to run. `platform-visualize` observes anatomy and causal activity,
  not assertions; its automated contracts take this skill. Proving a change by
  hand in a browser or terminal is `end-to-end-checks`.
---

# Testing

A test is how a change earns trust in seconds instead of in review. It checks
what the code does through an interface: it calls a function, a tool or an
HTTP door with inputs and checks what comes back or what it wrote (M-39441).
So it fails only when the code is wrong, or when an interface changed on
purpose.

The pull is always to check more than that. A test that pins which tools a
list shows, a constant, generated SQL text or a sentence of prose restates a
decision the code already states, and goes red every time someone makes a
better one. A test that polices how agents work is, in the owner's words, "a
persona prompt wearing test's clothes" (M-37840): a rule for agents belongs in
the persona, and a test checks what the product does for a person. His warning,
verbatim: "y'all would test/gate/lint yourselves into a straitjacket if i left
you alone". What earns a place is behavior someone depends on, checked where it
shows.

The posture is a quick, light suite you run without thinking: most tests near
1 ms, each package checked where it lives, a red test treated as news. This is
the automated half of finishing a change; `end-to-end-checks` is the half done
by hand, and `platform-visualize` observes what ran, which is not an
assertion.

## Writing one

- @yaks/testing declares and checks: `test(name, fn, {tags})`, or
  `suite(name, ({it, equal}) => …)`; `equal`, `ok`, `match` (partial),
  `throws`; `tick` and `until` for waiting (packages/testing/README.md). A
  `*_test.ts` file sits beside its subject.
- A small example beside the code is often the whole test: a `///` doctest
  line in the module, or a fenced `ts` block in a README or doc comment. Both
  run on the deno platform; a block marked `ts ignore` does not.
- A graph over `:memory:` or @yaks/ram is a value, not a boot, so most tests
  run at a pure seam, in memory. When RAM lacks something a test needs,
  @yaks/ram gets it (M-39498).
- Time is a fact to wait on, not a span to sleep. `await tick()` yields once;
  `await until(fact, {timeout, label})` waits for the fact, so a loaded box
  makes a test slower, not red. Inside workerd the clock doesn't move while
  code runs, so bound work there by count.
- A helper that stands in for a door behaves like the door. One that skips a
  header or a check the door sends lets the test pass where production fails:
  a store called without its access-mode header once read every app as public.

## Seeing it fail

A test that passes either way restates the code. The proof is watching it
catch the bug: take the fix out (revert the code hunk in the worktree, or break
it on purpose), run the test, see it fail, put the fix back, and say so in the
report. Breaking the code several ways and seeing each caught is the same proof,
stronger.

## Running

- `deno task test [path...]` runs what lies under the paths, each platform in
  one runtime of the runner (bin/test.ts). `--tag=deno` (or `browser`,
  `terminal`, `workerd`, or any tag a test carries) narrows it; `--all` runs
  files the skip would leave out.
- A file whose tests all passed is skipped while nothing it depends on has
  changed: its module graph as `deno info` sees it, files it names beside
  itself with `new URL(…, import.meta.url)`, the runner, config, lock and Deno
  version (packages/testing/deps.ts). "N unchanged since they passed" is that
  skip, not a pass you just earned. A file read any other way isn't seen, so a
  change to one wants `--all`. The record is `~/.cache/yak/tests-passed.json`,
  shared by every checkout.
- Packages exist so a change can be checked where it lives: run the package
  you changed (`deno task test packages/<name>`), and a change inside one yaks
  app at most `deno task test apps/<name>`. The full suite is for a change that
  reaches across packages in a way their own tests can't cover.
- `deno task test:budget` runs the whole suite held to its budget, and the gate
  runs it: a test case over 1 ms fails unless bench/test-budget.json lists it,
  a listed one fails past its record (times the list's slack), and so does a
  platform's wall clock on the gate. Nothing joins the list: a new or renamed
  test is held to 1 ms. `--write` takes off what got fast and lowers the
  records; `--from=<dir>` does it from a gate's kept times (its `suite-timings`
  artifact).
- `deno task test` and `deno task check` are timed against a baseline
  (bench/suites.md); the `benchmark:` line closing a run is that timing,
  report-only, not a test result.
- `deno task check` (fmt, lint, bytes, types, publish, browser, workers and
  content) is separate from tests; run the parts your change touches
  (`deno task check:types`, …).
- Piping a run eats its exit code: read `${pipestatus[1]}` before acting.
- Each run lives in a directory of its own (bin/scratch.ts): `TMPDIR`,
  `TASKS_HOME`, `PROCESS_DIR`, `HARNESS_HOME` and `HARNESS_WORKTREE_DIR` point
  inside it, and it's removed when the run ends. Run tests with machine effects
  (processes, worktrees, harness children) through `deno task test` so they get
  it. Name a base of your own (`TMPDIR=<scratchpad>`) and a stray write to
  `/tmp` fails the run instead of warning. Shared `/tmp` is the whole box's: a
  dead pid proves no process owns an entry there, not that you do.
- A run sets `TASKS_TEST_RUN`, and a run started inside one refuses. Git in a
  run sees no global config and never prompts (`GIT` in bin/test.ts).

## Platforms

Tests divide by where they run, not by speed, and each platform's environment
starts once per run (M-39441). The platforms run at once, workerd's as soon as
its kernel is up:

- **deno**: every `*_test.ts` and every example.
- **browser**: packages/web and packages/browse; **terminal**:
  packages/browse/tui. Each host sets up its own kind of document.
- **workerd**: every `*_workerd_test.ts`, against the one kernel
  workers/yak/probe-suite.ts starts for the run. Only what the runtime alone
  has belongs here (a socket's upgrade, the `send_email` binding, an uploaded
  script); it's rare and slow.

In workers/yak (workers/yak/probe.ts):

- `kernel()`: the kernel in memory this test process shares, started by the
  first test that asks. Tests on it keep apart by their data: a person, space,
  hostname or published name of their own.
- `fresh()`: a kernel of one test's own, for a test that needs it whole (one
  that times a store's first wake).
- `workerd()`: the run's kernel in workerd, held by one test.

## The money paths

What proves a purchase works is Stripe taking it, so Stripe tests run against
the sandbox. A run finds its key once, and only when it includes workers/
tests: `STRIPE_KEY`, or the owner's through `op` (`sandboxKey()` in
workers/yak/probe.ts). A key that isn't test-mode is refused; a live one would
charge somebody.

- A test whose subject is what a plan allows, not how it's bought, puts the
  space on the Plus plan with `onPlus()`: a signed webhook carrying a
  subscription Stripe never held, so nothing is spent or left behind.
- `subscribed()` makes a sandbox subscription, and the kernel's `stop` cancels
  it; `lapsed()` expires one unpaid by moving a test clock. A test that makes
  something in the sandbox deletes it.

## A red test that isn't yours

It's still a bug, and news worth having. See whether main fails the same way
(`deno task test <path>` in a worktree at main's head), find the commit that
broke it, and fix it or send it to the agent that landed it, with a task if
neither happens now. A landing on top of red says so, so nobody mistakes it
for green.

When this skill is wrong or missing something, fix it in the same change.
