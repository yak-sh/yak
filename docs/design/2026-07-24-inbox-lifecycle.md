# Inbox lifecycle — stamp components for everything that reaches an operator

Status: design (no code). Grounds: T-3690 (the inbox concept), M-4062
(letters vs notices). Reviewers: owner decisions flagged at the end.

## The problem

Today "read state" lives on exactly one kind of entity — `mail.read_at`
(`src/types.ts:189`). Everything else that reaches an operator's attention has
a *different* mechanism, or none:

- **comments aimed at a session** (messaging an agent) and **comments on a
  claimed task** ride the comms bus, whose whole memory is one cursor per
  session — `session.acked_at`, advanced by `notices()`
  (`src/client.ts:955`). The cursor is a high-water mark: once it moves past a
  line, that line is gone. A subagent that calls one task tool advances the
  cursor and **drains** items the operator never saw.
- **knocks** (`knock`, `src/types.ts:166`) stamp only *delivery* provenance
  (`acted_at`/`delivery`), never whether the recipient has since dealt with
  them.
- **mail** has `read_at`, but nothing analogous to "archived" — the inbox is
  "arrived and unread" (`unreadMail`, `src/client.ts:517`), so a *read* letter
  silently leaves the inbox with no deliberate act.

The owner's charge: generalize read-state into one **notification lifecycle**
that applies to all four, denormalized into small stamp components in the same
register as `created`/`updated`. `mail` stays just mail.

## The lifecycle

```
pending ──notified──▶ notified ──opened──▶ opened ──archived──▶ archived
```

Each arrow is a stamp component landing on the notification entity. The stamps
are **monotonic and independent** — an item can be `opened` without ever having
been `notified` (the operator found it before the channel fired), and
`archived` without `opened` (a deliberate "I don't need to read this"). Presence
is the fact; absence is the earlier state.

The three derived predicates — **and this is the correctness core**:

| inbox membership | predicate                     | who reads it |
| ---------------- | ----------------------------- | ------------ |
| **in the inbox** | NOT `archived`                | the inbox view / badge count |
| **unread**       | NOT `opened`                  | unread weight, the digest's count |
| **needs inject** | NOT `notified`                | the channel plugin, the bus/digest sweep |

**Only `archived` removes an item from the inbox.** `notified` and `opened`
never hide anything. This is what makes the inbox **drain-proof**: no automated
path — a subagent, a sweep, a background job — can make the operator lose an
item, because the only state that hides an item is a deliberate operator act
(`archived`). This retires the `acked_at`-cursor drain problem structurally
(see "The comms bus", below).

## The three new components

Same shape as `created`/`updated` (`src/types.ts:259-260`, `270-278`): a
component whose **presence** records that a lifecycle moment happened, carrying
a single server-frozen `at`. The wire writes the presence (the *act*); the
server stamps the honest time.

```ts
// src/types.ts — comps (wire-writable side): empty, presence IS the signal.
// A client asks for the moment by writing the bare component; it may never
// set `at` (out of comps, in stamped) — so the clock stays the server's.
notified: {},   // the operator has been told (inject or sweep) — never hides
opened:   {},   // the operator has looked — never hides; NOT opened == unread
archived: {},   // the operator is done with it — the ONE state that hides it

// src/types.ts — stamped (server-frozen side): the `at` twin of each.
notified: { at: 'time' },
opened:   { at: 'time' },
archived: { at: 'time' },
```

They stay OUT of `kindOrder` — like `created`/`updated`/`recall`, these are
facets any entity wears, never its identity (`src/types.ts:258`).

### Ownership: client requests the act, server stamps the clock

This matches `created`/`updated` exactly, and rides the existing machinery with
one small, generic addition. Walk the two halves:

- **`at` is server-frozen.** The db tables carry a default:

  ```sql
  create table if not exists notified (
    eid text primary key references entity(eid),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  -- opened, archived: identical.
  ```

  A wire batch `{eid, name:'opened', comp:{}}` reaches `apply()`'s bare-`{}`
  branch (`src/db.ts:974-980`), which does `insert or ignore into opened (eid)
  values (?)` — and the default stamps `at`. Because `at` is not in `comps`, the
  wire can never send it (the allowlist `cols()` reads `comps` alone), so it is
  honest by construction — the same guarantee that keeps `frozen_at`/`claimed_at`
  honest (`docs/STYLE.md`, "Server-stamped columns").

- **The stamped row must ride the return**, or optimistic caches show the
  component present with a blank `at` until the next snapshot. `apply()` already
  solves this for `created`/`updated`: after stamping, it re-reads the row and
  pushes it into `extra` (`src/db.ts:1042-1043`, `1055-1056`). Generalize that:
  after the bare-`{}` insert of any component in a small `stampedPresence` set
  (`notified`/`opened`/`archived`), re-read `at` and push
  `{eid, name, comp:{at}}` into `extra`. One loop, ~6 lines, beside the
  created/updated stamps.

Decision per component:

| component  | who writes presence            | why |
| ---------- | ------------------------------ | --- |
| `notified` | a delivery path (see below)    | "told" is an act of the machinery, not the operator |
| `opened`   | client, on the operator's read | `task <inbox> show`, the inbox view click |
| `archived` | client, on the operator's act  | a deliberate archive gesture |

All three are **client-requested, server-stamped** — none is a pure server
stamp, because each records an act with an actor whose identity the journal
already captures (see next).

### `archived`: `{at}` only — recommended

The owner floated "archived.at? idk — by/why?". **Recommend `{at}` alone.**
Provenance already lives in the journal: every write is actor-attributed
(`src/db.ts:1083`, the `journal` row carries the resolved actor), so *who*
archived and *when the batch ran* are both recoverable via `task history <id>`.
Adding `archived.by` would duplicate what `created`/`updated` only carry because
"who last edited" isn't otherwise cheap to query — but an archive is a single
discrete event the journal records exactly once. A `why` belongs in a comment on
the item if it matters, not a column. Keep all three minimal: `{at}`. If a
future inbox view wants "archived by X" without a journal lookup, that's a
one-line addition to `comps` (`archived: { by: {eid:'', death:'keep'} }`) — the
seam stays open, unbuilt.

## Which entities are inbox items, and the inbox query

An inbox item is any entity **addressed to the reader** that isn't archived. The
address is already in the graph; the inbox is a query over it (T-3690: "board
machinery, not a new store" — membership can't drift). For a reader who is a
session `S` acting for actor `A`, standing in project `P`:

| source            | "addressed to me" predicate | where it lives today |
| ----------------- | --------------------------- | -------------------- |
| comment → session | `comment.target_eid == S`   | `notices()` `src/client.ts:971` |
| comment → claimed | `comment.target_eid ∈ my claims` | `notices()` `mine` set |
| knock → me        | `knock.to_eid ∈ {S, A}`     | `knocked()` `src/knock.ts:54` (`awake`) |
| mail → project    | `mail.target_eid == P` and `mail.message_id` set (it arrived) | `inboxMail()` `src/client.ts:523` |

The inbox is: **those, filtered `NOT archived`.** Unread within it is `NOT
opened`. Both are pure `Row`-predicates over `r.comps`, exactly like the
existing `unreadMail`/`inboxMail`, so the same one door serves the digest count,
the TUI list, and the web view.

Note `event` comments (`comment.event`, `src/types.ts:207`, M-4062): machine
notices (settle, lease-lapse) *are* inbox items — they reach attention — but
they never ride the mail relay (`fanout` skips them, `src/mail.ts:268`). The
lifecycle stamps apply to them the same way; the letters-vs-notices split is
about the *delivery channel*, not the inbox.

## `notified` — one stamp, two (three) doors

`notified` is written wherever the operator is *told*. The doors:

1. **Instant inject** — the channel plugin (`channels/tasks/filter.ts`
   `channelEvents`) casts a comment/knock/mail into the running session's
   transcript.
2. **Bus/digest sweep** — `notices()` serves comment lines; `contextDigest()`
   lists the unread-mail count (`src/client.ts:903`).

Both are "the operator now knows"; both stamp the one `notified`. This durable
stamp **replaces the plugin's ephemeral `delivered`/`seen` set**
(`channels/tasks/filter.ts:93`, `Ctx.seen`): today, dedup is an in-process
`Set<string>` that a restart forgets, so a reconnect can re-ring mail the
snapshot still shows as unread. With `notified` on the entity, the plugin reads
"already notified?" from its index and never re-rings across restarts.

**The tension the owner must resolve (open question 1).** The channel plugin is
**read-only by strict invariant** — "It is a READ-ONLY listener… it never writes
the graph… holds no credential" (`channels/tasks/server.ts:10-12`). For the
plugin to *set* `notified` at instant-inject time, it must write. Options:

- **(a) Plugin stays read-only; the SERVER stamps `notified` when it casts to a
  channel.** But the server doesn't model per-session channel subscription — the
  filtering (which session hears which mail) lives *in the plugin*
  (`filter.ts` `channelEvents`, `injects`). The server would have to learn what
  the plugin knows. Rejected: pushes channel policy server-side, widening a seam
  the repo keeps narrow (`CLAUDE.md`, "Plugins").
- **(b) The plugin gains one narrow write: stamp `notified` on inject.** It
  already POSTs nothing today but the local server's `/apply` is unauthed on the
  tailnet (same surface `/snapshot` and `/ws` ride). A single-purpose
  `notified` write is not "replies go through the graph" — it's the plugin
  recording its own delivery, the way `knocked()`/`mailed()` stamp their own
  outcomes. **Recommended**, with the invariant reworded from "never writes" to
  "writes only its own delivery stamps, never graph content."
- **(c) `notified` is stamped only by the sweep doors** (`notices()`,
  `contextDigest()`), never at instant-inject; the plugin keeps an in-process
  dedup for the live session and re-rings across restarts are accepted as rare
  and harmless (the item is still unread; a second ring is not a lost item).
  Simplest; loses the "durable dedup survives restart" win the owner named.

Recommendation: **(b)**. It is the only option that delivers the owner's stated
goal (durable dedup) without moving channel policy into the server. The write is
idempotent (`insert or ignore`) and drain-proof (notified never hides anything),
so even a double-write or a forged one is harmless.

## The comms bus and `acked_at` — retire for comments, keep as fallback

`session.acked_at` (`src/types.ts:142`, `notices()` `src/client.ts:955`) is a
per-session cursor: "seen up to here." Its failure mode is the drain — a
subagent sharing… *not* the operator's session (see the SubagentStart section)
advancing a shared cursor. Per-item stamps fix this: each comment is
individually `opened`/`archived`, so nothing a *different* reader does can hide
an item from *this* one.

**Recommendation — coexist, with per-item as the truth:**

- **Per-item `notified`/`opened` become the read-state for comments-to-session
  and comments-on-claimed-tasks.** `notices()` selects unseen by `NOT notified`
  (or `NOT opened`) on the *comment* entity, not by the session cursor. Serving a
  line stamps `notified` on that comment; the operator reading it stamps
  `opened`.
- **`acked_at` stays as a coarse fallback cursor** — it is wire-writable and
  self-forging-only-hurts-yourself (`src/types.ts:128`), and the existing
  `unheard` digest tier (`src/client.ts:693`) reads it to reconstruct "comments a
  past session never saw." Keep it working; stop making it the *gate*. Removing
  it outright is a larger change (touches `unheard`, the digest, `context()`'s
  ack-on-print `src/cli.ts:847`) and isn't required by this design.

The migration path: introduce the stamps, switch `notices()`'s unseen filter to
per-item, leave `acked_at` advancing as it does (harmless once it no longer
gates). A later task can drop the cursor if the per-item path proves complete.

## Verbs and the CLI surface

- **`task <inbox>`** — the inbox list: items addressed to the caller's session
  and scope, `NOT archived`, unread weighted. Generalizes today's `task mail`.
- **`task <inbox> show <id>`** — reading IS the mark: stamp `opened` (a normal
  wire patch), the way `mailShow` stamps `read_at` today
  (`src/cli.ts:450-456`). That call site becomes: write `opened` instead of
  `mail.read_at`.
- **`task <inbox> archive <id>`** — the deliberate hide: stamp `archived`. The
  only verb that removes from the inbox.

Naming (M-4061 — artifacts get artifact names, pure acts keep `_request`; and
"letters vs notices", M-4062): these stamps are **records of acts on a
notification**, not requests aimed at another actor, so past-participle names
(`notified`/`opened`/`archived`) are right — they read like `created`/`updated`,
not like `stop_request`/`knock`. `mail` keeps its own name; a mail is an inbox
item that *also* wears the lifecycle stamps, never renamed to "notification."

## The SessionStart signal — who gets project mail

Separate, narrower problem: a spawned specialist must not receive the operator's
project mail. Two layers resolve it.

### Layer 1 — the reify records `agent_type` and `source`

The SessionStart hook (`task context --hook`, `src/cli.ts:853-899`) reifies the
session with id/cwd/pid/model but drops two payload fields it already receives:

- **`source`** — `startup` | `resume` | `clear` | `compact` | `fork`
  (`src/cli.ts:867` even lists it in the comment). Record it on the session; the
  continuity logic (which brief a `/clear` inherits) can key off it, and it
  distinguishes a fresh boot from a compaction.
- **`agent_type`** — present when launched `claude --agent <name>`. Record it so
  the board can show what kind of session this is.

Add to `comps.session`: `agent_type: 'text'`, `source: 'text'` — wire-writable
like the other session self-reports (`id`/`cwd`/`pid`), since a forged value only
mislabels your own row.

### Layer 2 — the operator-vs-specialist predicate

**Verified launch conventions:**

- A **managed spawn** launches `claude -p --session-id <uuid> …`
  (`src/adapters.ts:189-202`) — it does **not** use `--agent`. It sets
  `requested_task_eid` on the session (`spawnChanges`, `src/client.ts:463`), and
  the `spawned()` effect stamps `origin: 'managed'` (`src/sessions.ts:565`,
  `617`). Its launch env carries `TASKS_TASK` and `TASKS_SESSION`
  (`src/sessions.ts:687-688`).
- A managed spawn **fires SessionStart** (not SubagentStart): that's how it
  auto-claims — the hook reads `TASKS_TASK` and calls `hookClaim`
  (`src/cli.ts:888`). So the naïve "SessionStart == operator" split does **not**
  hold; a managed specialist is also a SessionStart firing.
- An **interactive operator** session reifies via `sessionFor` with no
  `origin`, no `requested_task_eid`, no `agent_type`.

**The predicate for "this session is the project's operator loop (gets project
mail)":**

> `origin != 'managed'` **and** `requested_task_eid` is unset.

`origin == 'managed'` is the canonical, server-stamped mark of a wire-spawned
specialist (`stamped.session.origin`, `src/types.ts:334`); `requested_task_eid`
is the belt-and-suspenders wire mark. A session matching neither is an operator.

**Where it applies:** mail routing today is scope-based and origin-blind —
`inboxMail(scope)` (`src/client.ts:523`) and the channel plugin's `injects`
(`filter.ts:149`, `homeEid`) deliver project mail to *any* session whose home is
the project, including a managed specialist. Add the predicate: a session that is
a specialist (`origin == 'managed'` or `requested_task_eid` set) does **not**
receive project mail — neither the digest's `## mail` line nor the channel inject.
It still receives comments aimed at its own session entity and its claimed tasks
(direct address, always delivered).

## The SubagentStart signal — mode auto-detected from the payload

A `SubagentStart` hook (owner direction) runs the **same** command as
SessionStart — `task context --hook` — and the mode is disambiguated by the
**payload**, not the argv. This automates what delegation briefs ask subagents
to do by hand (reify a session, claim the task) — a structural-over-discipline
win (M-4066: adoption is won structurally, not by asking).

### Mode selection — read `hook_event_name` from stdin

`context()` already parses the hook's stdin JSON (`src/cli.ts:854-856` reads
`body.session_id`, `body.cwd`) — `body.hook_event_name` is right there in the
same object. Branch on it:

```
hook = args.includes('--hook')
sub  = args.includes('--subagent') || body.hook_event_name == 'SubagentStart'
if hook && sub:  reify the subagent, emit ONLY its task block (if any)
if hook:         reify the operator, full digest + mail + bus  (unchanged)
```

- **`hook_event_name == 'SubagentStart'`** → subagent mode.
- **anything else** (SessionStart — the `source` field then tells
  startup/resume/clear/compact/fork) → the operator digest, unchanged.
- **`--subagent` stays as an explicit override** — forces subagent mode
  regardless of payload, purely for debugging / manual invocation.

So `.claude/settings.json` wires **both** `SessionStart` and `SubagentStart` to
one line, `task context --hook`; the payload disambiguates. One command, one
verb, two behaviors — no second entry point to keep in sync.

### The subagent path

1. **Reify under the subagent's OWN identity** — `sessionFor(rows, subId, cwd,
   pid)` with a fresh session id, so it gets its own bus cursor and can never
   touch the operator's `acked_at`. Stamp `cwd`, `agent_type`, `source`, and any
   parent/actor link the payload provides. Reuses `sessionFor`
   (`src/client.ts:368`) and the same `send(s.changes)` path as the operator
   branch (`src/cli.ts:864-865`).
2. **Skip almost all output** — no mail, no `## lately`/pulse, no `## from the
   fleet`, no `## previously`, no `notices()` bus sweep. A subagent does not
   triage the project. Concretely: do **not** call the operator branch's
   `tell()`; do not call `notices()`.
3. **Emit the task block only if it has a task** — `TASKS_TASK` set (managed) or
   the reified session already holds a claim. Then print just that task's block,
   the way `contextDigest`'s `show()` renders "claimed by you"
   (`src/client.ts:866-883`). Factor `show()` out of `contextDigest` so both
   doors share it, or add a thin `taskBlock(snap, eid)` helper. No task → emit a
   one-line identity note (`# subagent <agent_type> · <id>`), nothing else.

A `SubagentStart`-reified session is **inherently a specialist** — it never
matches the operator predicate (no `origin: managed`, but the `--subagent`
reify can stamp `agent_type`, and it holds a task via claim not project
ownership), so it is already excluded from project mail by Layer 2. The two
mechanisms agree.

### Payload fields — certain vs. needs empirical check

**Certain (documented, stable):** `SessionStart` carries `session_id`,
`transcript_path`, `cwd`, `hook_event_name`, and `source`
(`startup|resume|clear|compact|fork`). `SubagentStop` exists.

**Needs empirical check on THIS harness version (open question 2):** the web
evidence (anthropics/claude-code issues #14859 "add a SubagentStart hook",
#7881 "SubagentStop can't identify which subagent — shared session IDs", #16424
"expose agent context in hook payloads") indicates that (a) `SubagentStart` is
recent / partly a feature-request area, and (b) **subagent hook events have
historically shared the *parent's* `session_id`**, with `agent_id` /
`agent_type` / `agent_transcript_path` being the newer per-subagent
disambiguators. So:

- If the subagent shares the parent's `session_id`, the reify **key must be
  `agent_id`, not `session_id`** — reifying under a shared id would collide with
  the operator's own session. Design the `--subagent` reify to prefer
  `agent_id` (fall back to a minted id) and to record the parent `session_id` as
  the link/attribution.
- If `SubagentStart` doesn't fire at all on this version, the mechanism degrades
  safely: no subagent session is reified, delegation briefs keep asking for it
  manually (today's state), and **mail-routing correctness is unaffected** —
  that rests on the per-item `archived` model plus Layer 2's operator predicate,
  neither of which depends on SubagentStart.

**Action before building:** capture one real `SubagentStart` payload (add a
throwaway hook that dumps stdin JSON, run a Task-tool subagent) and confirm the
exact fields — `session_id` vs `agent_id`, `cwd`, `agent_type`, `source`, and
whether a `parent_session_id`/parent link is present. The design above is
written to survive either answer; the field names are the only thing to pin.

## Migration — additive, in place

The db is live owner data; every step is additive with an `alter table` /
`create table if not exists` guard (`src/db.ts open()`, `:459-469`;
`docs/STYLE.md`, "Migrations are additive, in place").

1. **Add the three tables** in `schema` (`create table if not exists notified /
   opened / archived`), each `eid pk references entity(eid)` + `at text not null
   default (strftime now)`. New tables need no `addCol` guard —
   `create table if not exists` is the guard.
2. **Add the six vocab entries** — `comps.{notified,opened,archived} = {}` and
   `stamped.{notified,opened,archived} = { at: 'time' }` — plus the `Ent` fields
   (`notified?: {eid; at?}` …). The db sync allowlist, delete order, Debug view,
   `showMd`, and MCP pick them up with zero further edits (the one-list
   promise, `CLAUDE.md`).
3. **Add `apply()`'s stamped-presence return loop** (~6 lines beside
   created/updated) so `at` rides back on the wire.
4. **Add `comps.session.agent_type` / `source`** (`text`) and the
   `addCol('session', 'agent_type', …)` / `addCol('session', 'source', …)`
   guards.
5. **Backfill `opened` from `mail.read_at`:** once, in `open()` after the tables
   exist —

   ```sql
   insert or ignore into opened (eid, at)
     select eid, read_at from mail where read_at is not null;
   ```

   guarded to run once (the `insert or ignore` on a pk is itself idempotent, so
   re-running is a no-op).
6. **Deprecate `mail.read_at`:** switch `mailShow` to stamp `opened`
   (`src/cli.ts:450`), switch `unreadMail`/`inboxMail` (`src/client.ts:517`,
   `523`) and the channel `injects` (`filter.ts:153`) to read `NOT opened` /
   `NOT archived`. Leave the `read_at` column dormant (readers off it removed)
   as the migration's rollback source, exactly as `entity.modified_at` lingers
   after `updated` took over (`src/db.ts:995-997`). A later task drops the
   column and its `comps.mail` entry once the new path is proven.

7. **Wire the hooks:** add a `SubagentStart` entry to `.claude/settings.json`
   alongside the existing `SessionStart`, both running `task context --hook`
   (the payload's `hook_event_name` disambiguates). Same `|| true` guard — a
   subagent hook must never fail loudly any more than the operator one does
   (`CLAUDE.md`, "The injection loop").

Order matters: 1-3 land the mechanism; 5 backfills before 6 flips the readers, so
no letter flickers unread mid-migration.

## What this does NOT do

- **No inbox UI** — the web/TUI inbox view (T-3690's list rows, badge, archive
  gesture) is a follow-up; this design lands the data model + CLI + the
  routing/subagent hooks it rests on.
- **No watch/mute subscriptions** — T-3690's per-(actor, entity) subscription
  comp is orthogonal and deferred.
- **No mention parsing** — the name-token effect (T-3690) is separate.
- **`acked_at` not removed** — kept as fallback (see the comms-bus section).

## Open questions for the owner

1. **`notified` writer — does the channel plugin get one narrow write?**
   Recommended (b): reword the plugin's read-only invariant to "writes only its
   own delivery stamps," so `notified` dedup survives restarts. The alternative
   (c, sweep-only stamping, plugin re-rings across restarts) keeps the plugin
   pure but drops the durable-dedup win. Which invariant do you want?

2. **SubagentStart reify key — `agent_id` vs `session_id`.** The design must
   pin one real payload before building (subagent events may share the parent's
   `session_id`; `agent_id` may be the only distinct key, and `SubagentStart`
   may not fire on the current version). Approve capturing a live payload as step
   0, and confirm: if `SubagentStart` is absent, is "delegation briefs keep
   reifying manually" an acceptable interim (mail-routing is correct either
   way)?

3. **Retire `acked_at` now, or later?** Recommended: coexist — per-item stamps
   become the truth for comment read-state, `acked_at` stays as the `unheard`
   fallback, dropped in a later task. Or do you want the cursor gone in this
   pass (larger blast radius: `unheard`, `context()`'s ack-on-print)?

4. **`archived` shape — confirm `{at}` only.** Recommended minimal; provenance
   lives in the journal. Say the word if a future "archived by X" view wants
   `archived.by` now rather than as a later one-line add.
</content>
</invoke>
