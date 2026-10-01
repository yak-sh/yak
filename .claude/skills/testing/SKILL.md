---
name: testing
description: >
  How tests work in ~/code/tasks and how to write one that earns its place:
  @yaks/testing (`test`, `suite`, `equal`, `until`, `///` doctests, fenced
  examples), `deno task test` and its platforms (deno, browser, terminal,
  workerd), the skip of files whose dependencies have not changed, kernel and
  workerd tests in workers/yak, the Stripe sandbox, and which tests a change can
  break. Use it whenever you write, change, run, narrow, time or debug a test,
  a doctest or a README example, when a run fails or is slow, when a brief says
  "add a test", or before landing to decide what to run. Proving a change by
  hand in a browser or a terminal is the `end-to-end-checks` skill.
---

# Testing

A test checks what the code does through an interface: it calls a function, a
tool or an HTTP door with inputs and checks what comes back or what it wrote
(M-39441). It fails only when the code is wrong or an interface changed on
purpose. The code is the decision; a test never pins one (which tools a list
shows, a constant, generated SQL text, a sentence of prose). A test that only
polices how agents work is a persona prompt in disguise and is never written
(M-37840).

## Writing one

- Declare with @yaks/testing: `test(name, fn, {tags})`, or `suite(name, ({it,
  equal}) => …)`; check with `equal`, `ok`, `match` (partial), `throws`
  (packages/testing/README.md). A file named `*_test.ts` sits beside its
  subject.
- A small example beside the code is often the whole test: a `///` doctest
  line in the module, or a fenced `ts` block in a README or doc comment. Both
  run on the deno platform; a block marked `ts ignore` does not.
- Most tests run at a pure seam, in memory, near 1 ms: a graph over `:memory:`
  or @yaks/ram is a value, not a boot. When RAM lacks something a test needs,
  @yaks/ram gets it (M-39498).
- Never sleep a fixed span. `await tick()` yields once; `await until(fact,
  {timeout, label})` waits on a fact, so a loaded box makes a test slower,
  never red. Inside workerd the clock does not move while code runs, so bound
  work by count, not time.
- A test helper behaves like the door it stands in for. A helper that skips a
  header or a check the real door sends makes the test pass where production
  fails (a store called without its access-mode header read every app as
  public).

## Proving it catches the bug

A new test fails on the old code. Before landing, take the fix out (revert the
code hunk in the worktree, or break it on purpose), run the test, see it fail,
put the fix back. Say so in the report. A test that passes either way restates
the code. Breaking the code several ways and checking each is caught is the
same proof, stronger.

## Running

- `deno task test [path...]` runs what lies under the paths, each platform in
  one runtime of the runner (bin/test.ts). `--tag=deno` (or `browser`,
  `terminal`, `workerd`, or any tag a test carries) narrows it; `--all` runs
  files the skip would leave out.
- A file whose tests all passed is skipped while nothing it depends on has
  changed (its module graph as `deno info` sees it, files it names beside
  itself, the runner, config, lock and Deno version). "N unchanged since they
  passed" is that skip, not a pass you just earned. The record is
  `~/.cache/yak/tests-passed.json`, shared by every checkout.
- Run the tests your change could break, and none it could not: the touched
  package's tests and those of the packages that import what you changed.
  A change inside one yaks app runs `deno task test apps/<name>` at most.
  Editing a file many packages import (workers/yak/vocab.ts, @yaks/graph)
  reruns most of the suite, two to four minutes; that cost is a reason to
  narrow the change, not to skip the run.
- `deno task test:budget` lists deno tests and file loads over the 1 ms budget,
  slowest first.
- `deno task check` (fmt, lint, types, publish, browser and workers checks) is
  separate from tests; run the parts your change touches.
- Piping a run eats its exit code: read `${pipestatus[1]}` before acting.
- A run sets `TASKS_TEST_RUN`, and a run started inside one refuses. Git in a
  run sees no global config and never prompts (`GIT` in bin/test.ts).

## Platforms

Tests divide by where they run, never by speed, and each platform's
environment starts once per run (M-39441):

- **deno**: every `*_test.ts` and every example.
- **browser** and **terminal**: packages/web and packages/web/tui, each host
  setting up its own kind of document.
- **workerd**: every `*_workerd_test.ts`, against the one kernel
  workers/yak/probe-suite.ts starts for the run. Only what the runtime alone
  has belongs here (a socket's upgrade, the `send_email` binding, an uploaded
  script); it is rare and slow.

In workers/yak (workers/yak/probe.ts):

- `kernel()`: the kernel in memory this test process shares, started by the
  first test that asks. Tests on it keep apart by their data: a person, space,
  hostname or published name of their own.
- `fresh()`: a kernel of one test's own, for a test that needs it whole (one
  that times a store's first wake).
- `workerd()`: the run's kernel in workerd, held by one test.

## The money paths

Stripe tests run against the sandbox. A run finds its key once: `STRIPE_KEY`,
or the owner's through `op` (`sandboxKey()` in workers/yak/probe.ts), and only
when the run includes workers/ tests. A key that is not test-mode is refused.

- A test whose subject is what a plan allows, not how it is bought, puts the
  space on the Plus plan with `onPlus()`: a signed webhook carrying a
  subscription Stripe never held, so nothing is spent or left behind.
- `subscribed()` makes a real sandbox subscription, and the kernel's `stop`
  cancels it; `lapsed()` expires one unpaid by moving a test clock. A test
  that makes something in the sandbox deletes it.

## When a test is already failing

A failure that is not yours is still a bug. Check whether main fails the same
way (`deno task test <path>` in a worktree at main's head), find the commit
that broke it, and fix it or send it to the agent that landed it, with a task
if neither happens now. Never land on top of a red test without saying so.

When this skill is wrong or missing something, fix it in the same change.
