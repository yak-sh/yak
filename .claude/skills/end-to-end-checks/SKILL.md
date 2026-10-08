---
name: end-to-end-checks
description: >
  Prove a change end to end in ~/code/tasks before calling it done: run the
  branch's own code as scratch `yak serve` with its own config, port and
  directory, drive the page in headless Chrome over CDP and read its DOM, drive
  `yak inspect`, `yak ui` or web TUI in tmux, and reap everything afterwards.
  Use it whenever checking "in the browser", "in the terminal", "live", on a
  "probe server" or "against real data", taking a screenshot, auditing a screen,
  or verifying UI, query, write path or migration by hand, even if asked only
  "make sure it works" or "check it", or measuring a Worker's container image
  under docker. `platform-visualize` is causal observation, not proof; proving
  its page and CLI also takes this skill. Automated tests are `testing`; a
  manual probe runs apart from the live graph and its web units.
---

# Probing a change

A test says the code does what its author meant. A probe says what a person
sees: the page that paints, the key that moves the cursor, the row a write
leaves behind. It's a throwaway copy of the system running your branch's code
against data you can break, and its whole value is that it's apart: its own
graph, port, browser profile and directory.

Two things press on it. The owner's live graph is where he works, so nothing a
probe does may land there. And the box is shared by many agents at once, every
one of them reaching for a port, a profile and a directory called `probe`:
every collision so far came from two probes sharing one of those. So a probe is
named for your task, holds everything it makes under that name, and is gone
when you're done, and your report says which claims were probed and which were
tested.

This is the hands-on half of finishing a change; `testing` is the automated
half. A screen being proved is built with `ui-building`; `platform-visualize`
shows what ran after a write, which is observation, not proof.

## The scratch directory

Everything a probe makes lives in one directory named for your task, inside
the session's scratchpad: `<scratchpad>/<task id or slug>/`. Forks of one
session share that scratchpad, so a generic name like `probe/` is exactly what
the agent beside you picked too.

## A graph and a server of your own

`yak` on the PATH runs the main checkout's code; your branch's code is your
worktree's CLI:

```sh
W=<your worktree>          # the repo root you are working in
D=<scratchpad>/<task>      # your scratch directory
yak init Probe --config $D/yak.json     # a fresh graph and a minimal config
# edit $D/yak.json: "port" nobody uses (not 5173), and the plugins your change needs
deno run -A --config $W/deno.json $W/packages/cli/yak.ts serve --config $D/yak.json > $D/serve.log 2>&1 &
echo $! > $D/serve.pid
until curl -sf -o /dev/null http://127.0.0.1:<port>/; do sleep 0.5; done
```

The config is the probe's address book. `yak browse` and `yak inspect` reach
whatever server its `port` names (8787 when it names none), so the port goes in
$D/yak.json rather than a `--port` flag on serve. The `until` loop holds up on
a loaded box, where any fixed sleep is either too short or wasted.

- `yak init` writes a small plugin list (kernel, doc, task, session, api, web,
  browse, …). Add what your change touches, such as `@yaks/ui` and
  `@yaks/inspect`; the live list in `~/.yak/yak.json` is there to copy from.
- `@yaks/session` reads every Claude transcript under `~/.claude/projects`
  unless told otherwise, which floods a probe with this box's sessions. Give it
  an empty directory:
  `{"use": "@yaks/session", "with": {"transcripts": "<absolute path under $D>"}}`.
- Plugins with outside effects (mail, spawn, harness, connections) do from a
  probe exactly what they do anywhere: send the mail, start the agent. Leave
  them out unless the change is about them; a mail probe gives @yaks/mail
  `"sender": {"via": "stash"}` and no `pull`. Over a copy of the box's graph,
  @yaks/git's service and @yaks/persona's `files` act on the checkouts the
  graph names, which are the owner's, so leave those out too.
- Write and read the probe the same way:
  `deno run -A --config $W/deno.json $W/packages/cli/yak.ts --config $D/yak.json task new "…"`.
- For data shaped like the owner's, read entities from the live graph
  (`yak graph show`, `yak graph query … --json`) and write them into the probe
  with `<worktree CLI> --config $D/yak.json graph apply --bundles @file`.
  Reading the live graph costs nothing; a write to it, or a press on a page it
  serves, lands in the owner's day.
- For the whole of the box's data, copy the bench snapshot
  (`~/.cache/yak-bench/base.db`, bench/README.md) into `$D` with `cp`: nothing
  writes it, and sqlite's `.backup` of it rereads the file without end through
  its read-only `-shm`. The snapshot can predate the schema your code expects,
  so run `yak upgrade --config $D/yak.json` on the copy before serving it.
- Harness and process state have their own homes: set `HARNESS_HOME` and
  `TASKS_HOME` to directories under `$D` when the change touches sessions or
  spawned runs (packages/harness/README.md). Keep `HOME`, so Deno's module cache
  is reused.

## Units of your own

A change to how the box's units start, stop or hand over (`yak restart`, a
unit file, how `serve` or `work` winds down) is proved on units named for your
task, never on the live ones. Write templates into
`$XDG_RUNTIME_DIR/systemd/user/` (systemd finds a new file there without a
daemon-reload), each running your worktree's CLI over `$D/yak.json` with the
unit's settings copied from ~/code/dotfiles, and drive `restart()` from
packages/cli/restart.ts with `roles` naming only them. A client asking
continuously through the handover (`connection: close` for a connection per
request) counts what failed and the longest gap.

## The browser

Chrome gets a profile of its own, under `/tmp` with a short name:

```sh
mkdir -p /tmp/cdp-<task>
TMPDIR=/tmp/cdp-<task> nohup google-chrome --headless=new --remote-debugging-port=<cdp port> \
  --user-data-dir=/tmp/cdp-<task> --no-first-run about:blank > /tmp/cdp-<task>/chrome.log 2>&1 &
```

The short path isn't style: Chrome makes a socket inside its profile, and a
socket path over about 107 bytes kills it at start ("Socket path too long").
The scratchpad's path is already longer than that.

Then read the page with the helper beside this skill. It opens a tab, waits for
a condition, evaluates an expression and prints it as JSON:

```sh
deno run -A <this skill>/scripts/dom.ts <cdp port> http://127.0.0.1:<port>/T-1 \
  "document.body.innerText.slice(0, 500)" --wait "document.body.innerText.includes('my task')"
```

Pages here paint from a socket after `load`, so wait on the thing you expect to
see. Check behavior the way a person meets it: what text shows, what moves,
what a click changes (dispatch the event in the expression, then read again).
The DOM is where a claim gets checked; a picture is how you see whether it
reads well. `--shot $D/page.png` saves one after the expression runs, and
`--width 390` lays the page out at phone width first.

## The terminal

```sh
tmux new-session -d -s <task> -x 160 -y 40 "<command>"
tmux send-keys -t <task> j Enter
tmux capture-pane -p -t <task>
```

`yak ui`, `yak browse` and `yak inspect` run through your worktree's CLI with
`--config $D/yak.json`. Browse and inspect keep terminal history in
`~/.yak/browse-terminal.json` unless `TASKS_TUI_STATE` names another file, so
point it at `$D/tui.json`, and give `HARNESS_HOME` and `TASKS_HOME` scratch
homes too. Both mount the browser's own app (packages/browse/components/App.tsx)
through @yaks/tui, so a terminal probe drives the same app by key presses
and proves navigation and a write the way a person makes them.

## yaks.app

A probe of the platform runs as a test account: `yak admin throwaway` signs in
as one, and `--as` selects that connection per command (listing accounts is
`secrets-and-connections`). Acting as the owner is his to grant (M-31958).
Tests that need workerd itself are `deno task test --tag=workerd`. After a
deploy, `yak admin deploys` shows what is live and `yak admin errors` what
broke; both take `--as`. The platform itself is `yaks-app`.

## A container image

A change to an image a Worker runs (the builder's sandbox, yak-esbuild's
compiler) is proved by running the image under its instance type's limits
(`docker run --cpus=0.25 --memory=1g --memory-swap=1g` is `basic`), posting it
what its Worker would post, and reading the container cgroup's `memory.peak`
and `cpu.stat`. That gives the time, memory and CPU-seconds a release will
cost, and whether the answer is the one the old path gave.

This box has the docker CLI and no engine, and it is an unprivileged LXC,
which decides how you get one. A rootless engine from Docker's static
binaries needs `uidmap` and `slirp4netns`, and a subuid range inside the
LXC's own map (`/proc/self/uid_map` covers 0-65535, and the stock 100000 range
is refused); even then an image holding files of uid 65532 (distroless) won't
unpack. A root `dockerd` started by hand with `--iptables=false
--ip6tables=false --ip-forward=false` leaves the firewall alone; its containers
get no NAT, so build and run them with `--network host`. `wrangler dev` with
containers doesn't work here under either: workerd's egress sidecar
(`cloudflare/proxy-everything`, which steers packets with nft TPROXY) never
completes a TCP handshake inside this LXC, so the Worker-to-container hop is
proved on Cloudflare, and the report says so. Reaping an engine means stopping
it, `ip link delete docker0`, unmounting `<exec-root>/netns/default`,
removing its data, and putting back any package or subuid line you changed.

## Reaping

A probe is done when nothing of it is left running or on disk:

- the server and its worker: a plain `yak serve` starts a detached `yak work`
  for the duty roles nobody serves, and that worker outlives the server by
  design. Kill every process whose command line names the config,
  `pkill -f "$D/yak.jso[n]"`, and confirm `pgrep -f "$D/yak.jso[n]"` finds
  none and nothing answers on the port. A pattern without `$D` in it, such as
  a command and its roles (`work --roles effects,@yaks/tracker`), also matches
  the live service running that command, and a signal starts its wind-down;
  run `pgrep -af` with the pattern before any `pkill`;
- Chrome: the pid you started is a launcher, and the browser is a dozen
  processes. Kill every one whose command line names the profile,
  `pkill -f "user-data-dir=/tmp/cdp-<tas>[k]"` (the bracket keeps `pkill` from
  matching your own shell), and confirm `pgrep -f` finds none;
- units: `systemctl --user stop '<task>-*'`, then remove their files from
  `$XDG_RUNTIME_DIR/systemd/user/`;
- tmux: `tmux kill-session -t <task>`;
- then `rm -rf $D /tmp/cdp-<task>`.

When this skill is wrong or missing something, fix it in the same change.
