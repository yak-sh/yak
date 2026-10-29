---
name: testing
description: >
  Use whenever writing, changing, running, narrowing or debugging tests,
  doctests, examples or benchmarks, investigating failed/slow runs, or
  choosing checks before landing. Covers @yaks/testing and deno task
  test with dependency selection. Manual proof is end-to-end-checks; observation
  is platform-visualize.
---

# Testing

A test is how a change earns trust in seconds instead of in review. It checks
what the code does through an interface: it calls a function, a tool or an HTTP
door with inputs and checks what comes back or what it wrote (M-39441). So it
fails only when the code is wrong, or when an interface changed on purpose.

The pull is always to check more than that. A test that pins which tools a list
shows, a constant, generated SQL text or a sentence of prose restates a decision
the code already states, and goes red every time someone makes a better one. A
test that polices how agents work is, in the owner's words, "a persona prompt
wearing test's clothes" (M-37840): a rule for agents belongs in the persona, and
a test checks what the product does for a person. His warning, verbatim: "y'all
would test/gate/lint yourselves into a straitjacket if i left you alone". What
earns a place is behavior someone depends on, checked where it shows.

The posture is a quick, light suite you run without thinking: most tests near 1
ms, each package checked where it lives, a red test treated as news. And a test
runs in the process that asked for it. The box's four cores are shared by every
agent working; when about eight of them each ran gates, tests, probe servers and
Chrome, the load reached 11.7 and the owner stopped them all. His words,
2026-10-23 (M-132169, 18bc9a78): "tests and benchmarks should be starting zero
other processes", and of a benchmark driving a separate server, "that's the
heavyness i'm talking about. never do that!"

The cure for a test that keeps catching one kind of breakage is not another
check but code that can't break that way: "if we have problems with our code not
running on certain platforms, the systematic fix is to _remove the code's
ability to see the platform_" (15ce9bf9). He would rather recover than gate
(M-37965): main's CI reports failures after the push, the tracker reports what
breaks live, and a failure is fixed forward.

Run only the tests your change could break, in seconds, then land with
`yak land`. There is no pre-land gate. A check or landing wait must take less
than ten seconds; a multi-minute command is a problem to remove, not a ritual to
repeat. Main's CI runs after the push and files a bug when it goes red. Nobody
waits for CI or a deploy before calling the work done.

There is no Chrome or Chromium on this box and there are no browser tests. Check
page behavior in process with a linkedom document in Deno, and terminal behavior
with @yaks/tui's `lay`. A behavior that requires Chrome has no place in this
test runner or CI.

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
  setup is timed against the budget like a test: keep it small, and put
  costly fixtures in test files.
- A graph over `:memory:` or @yaks/ram is a value, not a boot, so most tests
  run at a pure seam, in memory. When RAM lacks something a test needs,
  @yaks/ram gets it (M-39498).
- A test starts no process: no `deno` or `yak` child, no `git`, no server, no
  browser. Code that starts one takes it at a small generic boundary (M-39503),
  and the test hands it one in memory, the way packages/cli/restart_test.ts
  hands `restart()` a `run` that never reaches systemd. Tests that need a
  platform belong behind those boundaries; test the decisions in process, with
  effects supplied as data or functions.
- A case times only the act it checks. Build and seed its graph, store or field
  when the file loads (top-level `await`), one fixture per case that writes to
  it, and give each behavior a case of its own. A case that builds a graph,
  seeds it, then writes three times to check three things sits near 1 ms, and a
  loaded runner pushes it over.
- Time is an input a test controls. Inject @yaks/testing's `clock()` at the
  subject's timer boundary and `await time.advance(ms)` to run due callbacks; no
  timer delay or polling is needed to check expiry, retries or windows. Code
  that reads the time or sets a timer takes a `Clock` (@yaks/fp: `now`, `after`,
  the runtime's `system` by default); when it lacks one, give it one. Never fake
  the runtime's clock or timers (`FakeTime`, a `stub` of `setTimeout` or
  `Date.now`, an assignment to either): every file in a run shares one runtime,
  and a faked global counts, moves and swallows timers other files started, so a
  verdict depends on what ran before it. A module's exported setting a test
  assigns (a default wait, a pause) is shared the same way; the code takes it as
  an argument instead, as @yaks/durable-object's `retried` takes its `wait`.
  Await asynchronous work's completion directly. `tick` and `until` belong where
  an integration depends on the runtime itself progressing, rather than to tests
  of time behavior.
- A helper that stands in for a door behaves like the door. One that skips a
  header or a check the door sends lets the test pass where production fails: a
  store called without its access-mode header once read every app as public.
- An optional driver method changes which path existing helpers choose.
  @yaks/sql's `run` returns an affected count; `query` executes commands too.
  Follow counted writes and resultless batches through their consumers: fewer
  billed rows can still mean twice as many engine operations. The Store's
  bounded-delete and storage-failure tests check the operation budget and the
  waiting writer's answer through the storage interface.

## Seeing it fail

A test that passes either way restates the code. The proof is watching it catch
the bug: take the fix out (revert the code hunk in the worktree, or break it on
purpose), run the test, see it fail, put the fix back, and say so in the report.
Breaking the code several ways and seeing each caught is the same proof,
stronger.

## Running

`deno task test` with no paths uses the dependency graph to select tests the
change reaches, including consumers. Cached passing dependencies can narrow
that selection further. Name paths to narrow the run:

```sh
deno task test packages/<name>
deno task test workers/yak/<file>_test.ts
```

Run only the tests the change could break; there is no separate landing run.
`--tag=<tag>` narrows a selection. A test run skips type checking;
`deno task check:types` is separate, as are formatting and other checks. Choose
an individual check when the change needs it.

The dependency key comes from the module graph and recorded reads
(packages/testing/deps.ts, choose.ts and reads.ts). A pass record is shared
across checkouts under `~/.cache/yak`. "Unchanged since they passed" describes
that cache; it is not a new pass. Keep dependencies visible through imports or
Deno reads so selection includes the consumers a change can break.

The runner reports failures and one closing result line. `--verbose` expands
the output when diagnosing a failure. Piping a run eats its exit code: read
`${pipestatus[1]}` before acting. Budget behavior belongs to
bin/test-budget.ts and bench/test-budget.json; avoid copying its implementation
into a test or adding a timing assertion beside it.

Tests run in Deno, in process. The deno and terminal document environments
keep page globals separate from the terminal document. There is no browser,
workerd or slow platform tier, locally or in CI. Page behavior mounts on a
linkedom document; terminal
behavior uses @yaks/tui's `lay`, without a tty. A test starts no server or child
process and makes no network call. Files it creates stay in a temporary
directory. Platform behavior belongs at the small generic effect boundary;
check our decisions by handing that boundary controlled inputs.

In workers/yak, `kernel()` and `fresh()` from probe.ts compose in-memory
kernels. Tests on a shared kernel keep apart through their own people, spaces
and hostnames. Test payment decisions through the payment interface with
controlled responses; tests never charge a sandbox or obtain credentials.

A red CI run is recovery work: read its log, fix the cause and land the fix.
CI runs after a push; no agent waits for it or a deploy to finish work.

## A red test that isn't yours

It's still a bug, and news worth having. See whether main fails the same way
(`deno task test <path>` in a worktree at main's head), find the commit that
broke it, and fix it or send it to the agent that landed it, with a task if
neither happens now. A landing on top of red says so, so nobody mistakes it for
green.

When this skill is wrong or missing something, fix it in the same change.
