---
name: testing
description: >
  How tests work in ~/code/tasks and how to write one that earns its place:
  @yaks/testing (`test`, `suite`, `equal`, `until`, `///` doctests, fenced
  examples), `deno task test` and its deno/browser/terminal/workerd platforms,
  unchanged-dependency skips, kernel and workerd tests in workers/yak, the
  Stripe sandbox, benchmarks, and running the changed package's tests. Use it
  whenever you write, change, run, narrow, time or debug a test, doctest, README
  example or benchmark, when a run fails or is slow, a brief says "add a test",
  or before landing to choose what to run. `platform-visualize` observes
  anatomy and causal activity, not assertions; its automated contracts take
  this skill. Proving a change by hand, in your own process, is
  `end-to-end-checks`.
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
1 ms, each package checked where it lives, a red test treated as news. And a
test runs in the process that asked for it. The box's four cores are shared by
every agent working; when about eight of them each ran gates, tests, probe
servers and Chrome, the load reached 11.7 and the owner stopped them all. His
words, 2026-10-23 (M-132169, 18bc9a78): "tests and benchmarks should be
starting zero other processes", and of a benchmark driving a separate server,
"that's the heavyness i'm talking about. never do that!"

The cure for a test that keeps catching one kind of breakage is not another
check but code that can't break that way: "if we have problems with our code
not running on certain platforms, the systematic fix is to *remove the code's
ability to see the platform*" (15ce9bf9). He would rather recover than gate
(M-37965): every commit on main runs the whole suite
(.github/workflows/gate.yml), the tracker reports what breaks live, and a
failure is fixed forward.

Before you land, see what main's gate will say about your change: `deno task
gate` runs main's checks, then the tests your change can reach. Which tests is
the dependency graph's choice, not yours: a path you pick misses the consumer
that breaks. Over two weeks main's gate went red in 695 runs: 382 had a check
the landing agent never ran, 140 a test outside the paths it named (or a hang
one caused), 223 a time or a SQLite step count that came out differently on the
runner than on the box, and 41 Cloudflare's deploy timing (T-132935). Jeff,
2026-10-28, verbatim, when the bug for it was resolved once more while main
kept going red: "Stop resolving it and fix it!"

This is the automated half of finishing a change; `end-to-end-checks` is the
half done by hand, in your own process, and `platform-visualize` observes what
ran, which is not an assertion.

## Writing one

- @yaks/testing declares and checks: `test(name, fn, {tags})`, or
  `suite(name, ({it, equal}) => …)`; `equal`, `ok`, `match` (partial),
  `throws`; `clock` for controlling time (packages/testing/README.md). A
  `*_test.ts` file sits beside its subject.
- A small example beside the code is often the whole test: a `///` doctest
  line in the module, or a fenced `ts` block in a README or doc comment. Both
  run on the deno platform; a block marked `ts ignore` does not. An example's
  setup is timed and held to the budget like a test: keep it small, and put
  costly fixtures in test files.
- A graph over `:memory:` or @yaks/ram is a value, not a boot, so most tests
  run at a pure seam, in memory. When RAM lacks something a test needs,
  @yaks/ram gets it (M-39498).
- A test starts no process: no `deno` or `yak` child, no `git`, no server, no
  browser. Code that starts one takes it at a small generic boundary
  (M-39503), and the test hands it one in memory, the way
  packages/cli/restart_test.ts hands `restart()` a `run` that never reaches
  systemd. Many existing tests still start processes; T-132170 is moving
  them, so don't copy one.
- A case times only the act it checks. Build and seed its graph, store or
  field when the file loads (top-level `await`), one fixture per case that
  writes to it, and give each behavior a case of its own. A case that builds
  a graph, seeds it, then writes three times to check three things sits near
  1 ms, and a loaded runner pushes it over.
- Time is an input a test controls. Inject @yaks/testing's `clock()` at the
  subject's timer boundary and `await time.advance(ms)` to run due callbacks;
  no timer delay or polling is needed to check expiry, retries or windows.
  Await asynchronous work's completion directly. `tick` and `until` belong
  where an integration depends on the runtime itself progressing, rather
  than to tests of time behavior. Inside workerd the clock doesn't move while
  code runs, so bound work there by count.
- A helper that stands in for a door behaves like the door. One that skips a
  header or a check the door sends lets the test pass where production fails:
  a store called without its access-mode header once read every app as public.
- An optional driver method changes which path existing helpers choose.
  @yaks/sql's `run` returns an affected count; `query` executes commands too.
  Follow counted writes and resultless batches through their consumers: fewer
  billed rows can still mean twice as many engine operations. The Store's
  bounded-delete test and its workerd storage-failure test exercise both the
  operation budget and the waiting writer's answer.

## Seeing it fail

A test that passes either way restates the code. The proof is watching it
catch the bug: take the fix out (revert the code hunk in the worktree, or break
it on purpose), run the test, see it fail, put the fix back, and say so in the
report. Breaking the code several ways and seeing each caught is the same proof,
stronger.

## Running

- `deno task test [path...]` runs what lies under the paths (bin/test.ts).
  `--tag=deno` (or `browser`, `terminal`, `workerd`, or any tag a test
  carries) narrows it; `--all` runs files the skip would leave out.
- Today a run still starts processes, and T-132170 is taking them away. It
  goes through a chain of Deno processes (bin/scratch.ts, bin/test.ts, its
  coordinator and that one's guard). It first chooses what runs, keying every
  file with one `deno info` (@yaks/testing/choose), then starts one runtime
  for each platform holding a file that runs. When a file under workers/ runs,
  it first runs `ready()` (workers/yak/wrangler.ts: `npm ci` when its install
  is stale, five asset generators as `deno run`, and Stripe's sandbox key,
  through `op` when `STRIPE_KEY` isn't set); when a `*_workerd_test.ts` runs,
  it also starts workerd with its kernel. Neither starts for a change that
  reaches none of their tests. While you work, name the package you changed:
  `deno task test --tag=deno workers/yak/<file>`. The landing run names
  nothing (below).
- A run says only what you act on, since its output is read again on every
  later turn: each failure's name, file and error (its frames in the checkout,
  cut to 30 lines), a line naming the slowest few tests the budget flags, and
  one closing line, `ok | 394 passed | 0 failed | 0 over budget (1.8s)`.
  `--verbose` says each test as it ran, each error whole and the budget's
  findings in full; the gate and the Workers build pass it, since their logs
  are read whole.
- A file whose tests all passed is skipped while nothing it depends on has
  changed (packages/testing/deps.ts). Its key holds its module graph as `deno
  info` sees it (a doctest's imports, and a literal `import('…')`, included),
  files it names beside itself with `new URL(…, import.meta.url)`, the runner
  and what starts it (bin/test.ts `RUNS`, each by what loads with it, so the
  Worker's modules bin/test.ts imports only for the Worker's tests key only
  those), the SQLite library the run opens, config, lock and Deno version, and
  for a workerd test what the kernel is made of (workers/yak/probe-suite.ts
  `MADE`). Each runtime also audits what each file reads as it runs
  (`DENO_AUDIT_PERMISSIONS`, packages/testing/reads.ts): a directory it walks
  (as packages/vocab_test.ts does), a file at a path it computes, a module it
  imports by a computed specifier, with its graph. A pass is kept by that too.
  "N unchanged since they passed" is that skip, not a pass you just earned.
  What a child process reads (a `git`, `sqlite3` or `deno` child) isn't seen,
  so a change only a child reads wants `--all`, and a test that reads through
  Deno instead is seen. The record is `~/.cache/yak/tests-passed.json`, and
  what each file read `tests-read.json` beside it, shared by every checkout.
- That skip is how a run knows which tests a change can break: `deno task
  test` with no path runs exactly the files whose key your change moved, your
  package's own and every consumer's, and leaves the rest. It is the run
  before landing (`deno task gate` makes it). Packages exist so a change can
  be checked where it lives, and the graph is what says where that is: a
  change inside one package reaches its tests and its dependents', a change
  to how @yaks/query parses or @yaks/graph applies reaches nearly all of them.
  A path narrows a run while you work (`deno task test packages/<name>`); it
  is not the landing run, since the consumer outside it is what turns main
  red. When the record holds little of main's head (on 2026-10-28 it held 424
  of its files) the landing run is the suite, about nine minutes on the box;
  once every landing runs it, the record holds main's head and a run costs
  what the change reaches.
- Every run is held to the budget (bin/test-budget.ts): a test case over 1 ms
  fails it unless bench/test-budget.json lists it. What is held is the test's
  own time: its wall clock less what its runtime waited for a CPU another
  process held (Linux's /proc/thread-self/schedstat, the wait capped so own
  time never falls below the thread's time on the CPU). A test's own work,
  and anything it awaits, still counts, and so does load: the gate's runner
  shares this box's CPU cache and memory, and a core busy beside a test makes
  it slower. Load only ever adds, so a test is held to the fastest time it
  ran in. A time over the line is measured again first, in fresh runtimes,
  one platform at a time, each such file loaded cold and then warm
  (packages/testing `--loads`), and the files still over once more, cold and
  twice warm; a test fails only when it is over every time. A run with
  nothing over pays for no second pass, and a test that can't run twice in
  one runtime fails there. A file failed this way stays unpassed, so the next
  run runs it again. A file that runs unchanged since it passed (only `--all`
  runs one, as the gate does) is spared: the same code passed the budget, so
  a time over the line is the run's. A test gets slower when its code or
  what it imports changes, which changes the file's key, so the gate holds
  each file the first time its code runs there. The records are the gate's:
  its whole run (`deno task test --all`) fails a listed test past its record
  (times the list's slack); a whole run elsewhere says them without holding
  them, and a narrowed one says neither. A run here keeps its temporary files
  in memory as the gate's does, so a test that writes files takes the same
  time on both. What still differs is the CPU: a test's own time leaves out
  what its own thread waited for one, not what the processes it starts
  waited, and agents' runs share this box's CPUs. In a whole run here, 25
  listed tests, most of them starting processes or running a kernel, took
  1.05 to 3.8 times what the gate's took, past their records, and 9 unlisted
  ones ran 1.0 to 1.3 ms where the gate's ran under 1. A platform's wall
  clock is said, never held: it adds every wait among the run's processes, so
  no run of it is a floor, and workerd's tests, not held one by one, have no
  time held. Nothing joins the list: a new or renamed test is held to 1 ms
  from its first run. Getting a kernel test under it pulls you to drop the
  checks that "only exist across the door". Nearly every one is a decision some function makes
  (who may see or delete what, which version serves): move it there,
  extracting the function if it's inline, and drop nothing. `--write` takes
  off what got fast and lowers the records; `--from=<dir> --write` does it
  from a gate's kept times (its `suite-timings` artifact).
- A red gate's verdict closes its tests step, and `gh run view --log` cuts that
  step short: read the job's whole log, `gh api
  repos/yak-sh/yak/actions/jobs/<job id>/logs`.
- CI times each of its steps (bench/suites.md); the `benchmark:` line closing
  one is that timing, report-only, not a test result.
- A benchmark runs in the process that asked for it, too, and measures its own
  work. Today's suites don't yet: `deno task bench` starts Deno children
  (bench/throughput.ts), bench/box.ts and bench/monitor.ts time the commands
  and servers they start, and the client-frame report opens headless Chrome
  (bench/README.md). So they aren't run on this box until T-132170 brings them
  into one process; a question of speed is answered by timing the code in your
  own.
- `deno task check` (fmt, lint, bytes, types, raycast, publish, browser,
  workers and content) is separate from tests, and `deno task gate` runs both,
  the check first. Its nine checks start at once (bin/check.ts), each keeping
  a cache, so after a small change it takes seconds (5.7s on the box with
  warm caches), and the first in a new worktree, or after a rebase over much
  new work, about two minutes. Each check says one line, and a failed one its
  output, cut to its first and last lines; `deno task check:types` (or any
  one) says its output whole, and `--verbose` says every check's output as it
  comes, each line led by its check's name, every check run to its end. What
  these caught on main
  is what agents skipped: README prose left unformatted, slow types in a
  public API (`check:publish`), a generated file not regenerated
  (`check:content`), and type errors.
- Piping a run eats its exit code: read `${pipestatus[1]}` before acting.
- A test run doesn't type-check (`--no-check`); `check:types` does, test files
  included.
- Each run lives in a directory of its own (bin/scratch.ts): `TMPDIR`,
  `TASKS_HOME`, `PROCESS_DIR`, `HARNESS_HOME` and `HARNESS_WORKTREE_DIR` point
  inside it, and it's removed when the run ends. Run tests with machine effects
  (processes, worktrees, harness children) through `deno task test` so they get
  it. The directory is in memory, under /dev/shm/yak-test on the box and on the
  gate alike, so a test that writes files takes the same time on both; each
  run removes what killed runs left there, and `TMPDIR=<dir>` names another
  base. A `tasks-*` entry that appears in `/tmp` during a run is a spawn site
  writing to a literal `/tmp`: the run says it as a warning, since every
  worktree's run shares `/tmp`.
- A run sets `TASKS_TEST_RUN`, and a run started inside one refuses. Git in a
  run sees no global config and never prompts (`GIT` in bin/test.ts).

## Platforms

Tests divide by where they run, not by speed, and each platform's environment
starts once per run (M-39441). Today each platform is a runtime of its own, and
they run at once:

- **deno**: every `*_test.ts` and every example.
- **browser**: packages/web and packages/browse, on a linkedom document in a
  Deno runtime, not Chrome; **terminal**: packages/browse/tui, painted by
  @yaks/tui. Each host sets up its own kind of document as globals, and the
  web app keeps its state in its modules, which is why they don't share a
  runtime yet.
- **workerd**: every `*_workerd_test.ts`, against the one kernel
  workers/yak/probe-suite.ts starts for the run in workerd, a process of its
  own. Only what the runtime alone has belongs here (a socket's upgrade, the
  `send_email` binding, an uploaded script); it's rare and slow, and main runs
  it.

A platform exists because code can see where it runs. The way out is code
that can't: the kernel already runs in memory in Deno because it meets
storage, sockets and mail only through interfaces of its own (`kernel()`
below). T-132170's design takes the rest of the way, so every platform's tests
run in the process that asked.

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
tests: `STRIPE_KEY`, or the owner's through `op`, a process of its own
(`sandboxKey()` in workers/yak/probe.ts). A key that isn't test-mode is refused; a live one would
charge somebody.

- A test whose subject is what a plan allows, not how it's bought, puts the
  space on the Plus plan with `onPlus()`: a signed webhook carrying a
  subscription Stripe never held, so nothing is spent or left behind.
- `subscribed()` makes a sandbox subscription, and the kernel's `stop` cancels
  it; `lapsed()` expires one unpaid by moving a test clock. A test that makes
  something in the sandbox deletes it. A run killed before `stop` leaves its
  subscription renewing, so every run that finds the key cancels the
  probe-stamped ones older than an hour (`swept` in workers/yak/probe.ts).

## A red test that isn't yours

It's still a bug, and news worth having. See whether main fails the same way
(`deno task test <path>` in a worktree at main's head), find the commit that
broke it, and fix it or send it to the agent that landed it, with a task if
neither happens now. A landing on top of red says so, so nobody mistakes it
for green.

When this skill is wrong or missing something, fix it in the same change.
