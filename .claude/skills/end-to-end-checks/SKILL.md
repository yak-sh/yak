---
name: end-to-end-checks
description: >
  Prove a change end to end in ~/code/tasks from inside your own process: the
  box's server composed in memory (`compose()` from @yaks/cli/host, its
  `handler` called with a Request), yaks.app's kernel in memory (`kernel()`),
  a page on a linkedom document, the TUI painted by @yaks/tui's `lay`, data
  copied from the live graph; then, once landed, the live system (`yak admin
  deploys`, `admin_errors`, a throwaway account). Use it whenever checking
  "in the browser", "in the terminal", "live", on a "probe server" or "against
  real data", taking a screenshot, auditing a screen, or verifying UI, query,
  write path or migration by hand, even if asked only "make sure it works" or
  "check it". Local Chrome, a scratch `yak serve`, tmux probes and docker are
  not how a change is proved here. Automated tests are `testing`;
  `platform-visualize` is causal observation, not proof.
---

# Proving a change end to end

A test says the code does what its author meant. An end-to-end check says what
a person meets: the page a request comes back with, the row a write leaves
behind, the screen a key press paints. Here it runs in the process that asks
for it, through the same doors a person's request goes through, over data you
can break.

The box has four cores, and every agent working shares them. When about eight
agents each ran a probe server, its worker, a dozen Chrome processes and the
gates beside them, the load reached 11.7 and the owner stopped them all. His
words, 2026-10-23 (18bc9a78, M-132169):

> a handful of agents shouldn't bring the box to its knees. and we need to stop
> all this chrome testing locally; it's too heavy and most things don't need
> chrome.

> tests and benchmarks should be starting zero other processes

and, of a benchmark that would drive a separate server: "that's the heavyness
i'm talking about. never do that!"

He would rather recover than gate (M-37965): every commit on main runs the
whole gate, deploys yaks.app and reports what breaks to the tracker, and a
failure there is fixed forward. So a check on the box is light, and aimed: the
change's own path, through its door, in your process. What it can't reach, the
gate and the live system will.

## The doors, in your process

- **The box's server.** `compose(config, roles)` from @yaks/cli/host builds
  what `yak serve` listens with, without binding a port. A config naming
  @yaks/api has a `handler`: hand it a `Request` and it answers as the server
  would. Compose over `{db: ':memory:', plugins: [...]}` with the plugins your
  change touches, and `close()` it when done; packages/cli/host_test.ts does
  this throughout.
- **yaks.app.** `kernel()` in workers/yak/probe.ts is the kernel in memory
  this process shares, and `fresh()` a kernel of one test's own (`testing`).
  Its stores, doors and connector answer as the Worker's do.
- **A page.** The web app mounts on a linkedom document in a Deno runtime, not
  in a browser; packages/browse/host_testing.ts speaks for the server on the
  page's socket. Check what a person meets: the text that shows, what a
  dispatched click or key changes.
- **The terminal.** @yaks/tui's `lay` paints an element to lines without a tty
  (`pane` in packages/browse/tui/testing.ts). Browse and inspect mount the
  browser's own App through it, so a key press and the screen after it are
  checked the same way.
- **Data shaped like the owner's.** Read entities from the live graph (`graph_show`,
  `graph_query`) and apply them to your in-memory
  graph; reading the live graph costs nothing, and a write to it lands in his
  day. For the whole of the box's data, `cp` the bench snapshot
  (`~/.cache/yak-bench/base.db`, bench/README.md) into your scratch directory
  and name it as the config's `db`; the first writer that opens the copy
  brings it to the schema your code expects. Copy with `cp`: sqlite's
  `.backup` of it rereads the file without end through its read-only `-shm`.

A check worth keeping is a test (`testing`); a one-off is a script or a test
you don't land, and either way it runs in one process and leaves nothing
running.

## What no longer runs here

- **Chrome.** A screen's behavior is checked on its document, as above. How it
  reads, its spacing and colour and weight, the owner sees on the live page
  once it lands, and his review arrives as comments on the task
  (`ui-building`).
- **A scratch `yak serve`, `yak work` or units of your own.** Each is a server
  that keeps running beside you, with a worker that outlives it. A change to
  how the box's units start, stop or hand over is checked through
  packages/cli/restart.ts's functions with their effects handed in, then by
  the next `yak restart`; one that breaks is fixed forward.
- **tmux driving a CLI against a probe.** The TUI's paint is checked with
  `lay`; the commands themselves through `compose()`.
- **docker.** A container image a Worker runs is measured where it runs, on
  Cloudflare, after it deploys, and the report says so.

Where today's tooling still starts processes (the test runner's runtimes, the
workerd kernel), `testing` says which, and T-132170 takes them away.

## Once it lands

Every commit on main deploys the yak worker through Workers Builds and runs the
gate. `admin_deploys` as admin says what is live, `admin_errors`
what broke, and a new failure reaches the tracker when it happens (M-37965).
A probe of the platform runs as a test account: `admin_throwaway` signs in
as one, and `--as` selects that connection per command (listing accounts is
`secrets-and-connections`). Acting as the owner is his to grant (M-31958).
The box's own server runs main after `yak restart`. The platform itself is
`yaks-app`.

When this skill is wrong or missing something, fix it in the same change.
