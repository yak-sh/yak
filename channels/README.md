# channels — push delivery into a Claude session

A Claude Code **channel** is an MCP (stdio) server that pushes messages INTO a
running session's conversation stream as `notifications/claude/channel` events —
they render in the transcript as `<channel source="…" …>…</channel>`, **not** on
the human's input line. This gives an interactive or managed session INSTANT
push delivery with no polling.

`channels/tasks/` is the tasks channel: a **read-only** listener that watches
the tasks server's `/ws` sync socket (the same broadcast every browser tab
hears) and emits activity about the work ITS session owns:

- **`comment`** — a comment whose `target` is a task this session claims. Direct
  comments on its session entity still arrive through the deprecated migration
  path. Rendered `kind="comment" from="<byline>"`, content = the comment's
  words. Only mint-time comments (the batch also carries the doc that holds the
  words) are emitted; a bodiless later patch is skipped.
- **`knock`** — a nudge whose recipient is this session. An actor-level knock
  reaches only a session launched with `--operator`. Rendered `kind="knock"`,
  content = `knock: look at <target id> — <words riding the batch>`.
- **`mail`** — verified unread mail for the home project, only for a session
  launched with `--operator`.

It writes NOTHING to the graph. Replies go through the normal `task` CLI / MCP
the session already has (`task_comment` on the sender or the named entity).

## Files

- `tasks/server.ts` — the Deno MCP stdio server: opens `ws://$TASKS_HOST/ws`,
  resolves its session entity from `/snapshot`, emits channel events, reconnects
  with backoff (one loop, never stacked).
- `../src/channel.ts` — the pure seam: `channelEvents` (which changes are aimed
  at a session, and how each renders), `learn`/`humanId` (eid → human id from
  the stream), `findSession`. No sockets — this is what the tests drive.
- `tasks/server_test.ts` — fast pure-seam tests
  (`deno test -A channels/tasks/`).
- `marketplace/` — the plugin layout (see Enablement).

## Identity — the session follows the process

The plugin serves the session entity whose `session.pid` equals its own nearest
`claude` /proc ancestor — the pid the SessionStart hook stamps at reify. The
seat rule is `src/served.ts`: of the rows wearing that pid, the NEWEST wins, and
the plugin derives it fresh from its stream index on every batch. So `/clear`
(which reifies a NEW session entity under the same process) rotates service
forward — the old S-\* compatibility address stops injecting, by design — and
any correction to a row rotates it back. `src/door.ts` derives the same seat
from the same graph, which is what makes a knock's `delivery: cast S-…` stamp
mean delivery (T-7288). A subagent is a tool call inside its operator's process
and reifies wearing no pid, so it never takes the operator's seat.

The spawn-time `CLAUDE_CODE_SESSION_ID` (set by Claude Code for MCP
subprocesses, never updated past boot) is the fallback whenever no row wears the
pid — it covers a session whose pid never got stamped. Neither clue → a harmless
no-op (connects, delivers nothing).

## Delivery — the stream, and the gap the stream can't carry

Push is the socket: every applied batch is rebroadcast, and the plugin emits
what the batch aims at its session. Two things bound it. `notified` is the
shared durable stamp: an anonymous `via` proves a channel push, while a session
`via` says only that the bus printed the item. The plugin also remembers what it
sent this run, because the stamp is a wire write and the server can be down
exactly when gaps happen.

A gap has two halves. The snapshot→join window is replayed by the `{since}`
handshake as `{catchup}`, which pushes past `notified` (T-7167). The
disconnect→snapshot half is **inside** the snapshot — no cursor window can reach
it, and a tasksd restart mints a fresh epoch that voids the cursor anyway — so a
RE-sync reconciles against state instead: the same filter over the whole
snapshot, bounded by channel-authored `notified` stamps and read-state. This
includes the first sync after Claude replaces an MCP subprocess, so a bus stamp
cannot suppress a push the previous process missed. A recovered item is
atomically re-stamped anonymously after its notification write succeeds; later
processes then stay quiet. A knock the ladder already stamped
`delivery: cast S-me` is the sweep's sharpest case: the stamp claims this
channel took it, and no channel-authored `notified` proves it did.

## Env

| Var          | Meaning                                            |
| ------------ | -------------------------------------------------- |
| `TASKS_HOST` | tasks server host:port (default `127.0.0.1:5173`). |

## Enablement — the allowlist gotcha (proven for the email channel)

Declaring the `claude/channel` capability is **necessary but not sufficient.**
From the email-channel README (Claude Code 2.1.195):

> In 2.1.195 the channel subsystem is gated by an **approved-channels
> allowlist** — a plain MCP server connects but its
> `notifications/claude/channel` events are silently **not** surfaced unless the
> channel is either on the allowlist (how a marketplace channel plugin
> activates) or explicitly dev-loaded.
>
> Plain `--mcp-config` / project `.mcp.json` does NOT activate the channel — the
> server must be **plugin-sourced** (a marketplace plugin). A channel renders
> **only if its server is in the session's active channel list.**

So a channel activates one of two ways:

### Dev-load (local, shows a blocking confirmation dialog)

```sh
claude --channels plugin:tasks@tasks-fleet \
  --dangerously-load-development-channels plugin:tasks@tasks-fleet
```

The dev flag loads a non-allowlisted channel but **shows a startup dialog that
BLOCKS** until a human presses Enter — fine for local dev, unusable unattended.

### Allowlisted (clean, dialog-free, for unattended sessions)

1. Allowlist the plugin in system-wide managed settings at
   `/etc/claude-code/managed-settings.json` (root-owned, affects every `claude`
   on the box — the per-session `CLAUDE_CODE_MANAGED_SETTINGS_PATH` override is
   ignored in 2.1.195):

   ```json
   {
     "channelsEnabled": true,
     "allowedChannelPlugins": [
       { "marketplace": "tasks-fleet", "plugin": "tasks" }
     ]
   }
   ```

   Note: `allowedChannelPlugins` is **exclusive** — once it exists it replaces
   the default channel ledger; only the plugins it lists are permitted.

2. Add this marketplace, enable the plugin, and launch each session with
   `--channels plugin:tasks@tasks-fleet` (exclusive — only listed channels
   activate). `--channels` survives `/clear` and `--continue` with no dialog.

The `.mcp.json` command uses an **absolute path** to `channels/tasks/server.ts`
(mirroring the email channel's mechanism). Adjust it if this repo lives
somewhere other than `/home/yaks/code/tasks`.

## The interactive door: `task claude`

`task claude [args...]` launches an interactive session fleet-wired: it passes
invocation-scoped lifecycle settings, `--dangerously-skip-permissions`, and
`--channels plugin:tasks@tasks-fleet`, and — when root's managed settings don't
allowlist `tasks-fleet` — adds the dev-load flag, accepting its press-Enter
dialog (a keyboard is present; that's the only place the verb runs). One-time
setup, already scripted by the verb's docs:
`claude plugin marketplace add <repo>/channels/marketplace` +
`claude plugin install tasks@tasks-fleet`. To go dialog-free, add
`{ "marketplace": "tasks-fleet", "plugin": "tasks" }` to `allowedChannelPlugins`
in `/etc/claude-code/managed-settings.json` (root-owned; the list is exclusive —
keep the email entry).

## Managed spawns stay unwired

No spawn or launcher passes `--channels` on its own. Wiring the channel into
managed sessions (so a spawned agent boots with the channel active) is a
**deliberate owner move**, not a side effect of this code landing.
