---
name: probe
description: >
  Prove a change works end to end in ~/code/tasks before calling it done: run
  the branch's own code as a scratch `yak serve` with its own config, port and
  directory, drive the web page in headless Chrome over CDP and read its DOM,
  drive `yak inspect`, `yak ui` or the web TUI in tmux, and reap everything
  afterwards. Use it whenever you are about to check something "in the
  browser", "in the terminal", "live", on a "probe server" or "against real
  data", take a screenshot of this app, or verify a UI, query, write path or
  migration by hand, even if the task only says "make sure it works".
---

# Probing a change

A probe is a throwaway copy of the system that runs your branch's code against
data you can break. Its whole value is that it is apart: its own graph, port,
browser profile and directory, so it cannot touch the owner's live graph, and
other agents' probes cannot touch it. The box is shared by many agents at once,
and every collision so far came from two probes sharing one of those.

## The scratch directory

Everything a probe makes lives under one directory named for your task, inside
the session's scratchpad: `<scratchpad>/<task id or slug>/`. Forks of one
session share that scratchpad, so a generic name like `probe/` is exactly what
the agent beside you also picked. Remove the directory when you are done.

## A graph and a server of your own

`yak` on the PATH runs the main checkout's code. To probe your branch, run your
worktree's CLI:

```sh
W=<your worktree>          # the repo root you are working in
D=<scratchpad>/<task>      # your scratch directory
yak init Probe --config $D/yak.json     # a fresh graph and a minimal config
# edit $D/yak.json: a port nobody uses (not 5173), and the plugins your change needs
deno run -A --config $W/deno.json $W/packages/cli/yak.ts serve --config $D/yak.json > $D/serve.log 2>&1 &
echo $! > $D/serve.pid
```

- `yak init` writes a small plugin list (kernel, doc, task, session, api, web,
  …). Add what your change touches, such as `@yaks/ui` and `@yaks/inspect`; the
  live list is in `~/.yak/yak.json` to copy from.
- `@yaks/session` imports every Claude transcript under `~/.claude/projects`
  unless told otherwise, which floods a probe with this box's sessions. Give it
  an empty directory:
  `{"use": "@yaks/session", "with": {"transcripts": "<absolute path under $D>"}}`.
- Plugins with outside effects (mail, spawn, harness, connections) do real
  things from a probe too. Leave them out unless the change is about them.
- Write and read the probe the same way:
  `deno run -A --config $W/deno.json $W/packages/cli/yak.ts --config $D/yak.json task new "…"`.
- Data shaped like the real thing: read entities from the live graph
  (`yak graph show`, `yak graph query … --json`, read-only) and write them into
  the probe with
  `<worktree CLI> --config $D/yak.json graph apply --change @file`. Reading the
  live graph is fine; writing to it, or pressing anything on a page served by
  it, is not.
- Harness and process state have their own homes: set `HARNESS_HOME` and
  `TASKS_HOME` to directories under `$D` when the change touches sessions or
  spawned runs (packages/harness/README.md). Keep `HOME`, so Deno's module cache
  is reused.

Wait for the server by polling, never a fixed sleep:
`until curl -sf -o /dev/null http://127.0.0.1:<port>/; do sleep 0.5; done`.

## The browser

Headless screenshots of this app come out blank, so the DOM is what you check.
Start Chrome with a profile of its own, under `/tmp` with a short name:

```sh
mkdir -p /tmp/cdp-<task>
TMPDIR=/tmp/cdp-<task> nohup google-chrome --headless=new --remote-debugging-port=<cdp port> \
  --user-data-dir=/tmp/cdp-<task> --no-first-run about:blank > /tmp/cdp-<task>/chrome.log 2>&1 &
```

The short path is not style: Chrome makes a socket inside its profile, and a
socket path over about 107 bytes kills it at start ("Socket path too long"). The
scratchpad's path is already longer than that.

Then read the page with the bundled helper, which opens a tab, waits for a
condition, evaluates an expression and prints it as JSON:

```sh
deno run -A <this skill>/scripts/dom.ts <cdp port> http://127.0.0.1:<port>/T-1 \
  "document.body.innerText.slice(0, 500)" --wait "document.body.innerText.includes('my task')"
```

Wait on the thing you expect to see, not on load: pages paint from a socket
after `load`. Check behavior, not markup: what text shows, what moves, what a
click changes (dispatch the event in the expression, then read again).

## The terminal

```sh
tmux new-session -d -s <task> -x 160 -y 40 "<command>"
tmux send-keys -t <task> j Enter
tmux capture-pane -p -t <task>
```

- `yak inspect` and `yak ui`: run them through your worktree's CLI with
  `--config $D/yak.json`.
- The web TUI (`deno task tui`, from your worktree) ignores `--config` and
  `$YAK_CONFIG`: it reads `TASKS_HOST` and otherwise connects to the live server
  on 5173 (packages/web/tui/main.tsx, T-59091). Always run it as
  `TASKS_HOST=127.0.0.1:<port> deno task tui`.

## yaks.app

A probe of the platform runs as a test account, never as the owner:
`yak admin throwaway` signs in as one, and `--owner` is only for an act Jeff
asked for (M-31958). Tests that need workerd itself are
`deno task test
--tag=workerd`. After a deploy, `yak admin deploys --admin`
shows what is live and `yak admin errors` what broke.

## Reaping

A probe is done when nothing of it is left running or on disk:

- the server: `kill $(cat $D/serve.pid)`, then `kill -0` it, or `curl` its port
  and see nothing answer;
- Chrome: the pid you started is a launcher, and the browser is a dozen
  processes. Kill every one whose command line names the profile,
  `pkill -f "user-data-dir=/tmp/cdp-<tas>[k]"` (the bracket keeps `pkill` from
  matching your own shell), and confirm `pgrep -f` finds none;
- tmux: `tmux kill-session -t <task>`;
- then `rm -rf $D /tmp/cdp-<task>`.

Say in your report what you checked and how, so the reader can tell a probed
claim from a tested one.
