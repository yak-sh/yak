// The MCP tool registry: the entity graph as self-documenting task_*
// tools for agents — no auth, no keys. The registry is transport- and
// io-agnostic: the dev server mounts it at /mcp (statelessly, calling
// apply/snapshot in-process — restarts can't strand a session), and
// `deno run -A src/mcp.ts` serves the same tools over stdio, reading and
// writing through HTTP like any other client.
//
// The dot-param grammar is shared with the CLI: '.title=Hello' routes by
// prop through the component vocabulary; '.pin.x=12' is the explicit
// spelling for the few collisions. The tool descriptions teach it.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  type Change,
  edges,
  type Hit,
  type Snapshot,
  statuses,
  uuid,
  verdicts,
} from './types.ts'
import { trouble } from './adapters.ts'
import { sha } from './sha.ts'
import { FILTERS, GRAMMAR } from './grammar.ts'
import {
  byBoard,
  checkRefs,
  claimant,
  claimChanges,
  commentChanges,
  contextDigest,
  decidedChange,
  derefParams,
  edgesOf,
  feedbackChange,
  find,
  history,
  historyLine,
  host,
  idOf,
  type JournalEntry,
  jsonOf,
  memoryChanges,
  memoryHead,
  noticeBlock,
  noticesFor,
  param,
  patches,
  recallIndex,
  RETIRED_TYPE,
  type Row,
  rows,
  search,
  send,
  similarHint,
  snapshot,
  spawnChanges,
  spawnDefaults,
  taskChanges,
} from './client.ts'
import {
  matchQuery,
  noFilter,
  orderOf,
  parseQuery,
  pred,
  resolution,
  resolveRefs,
  warm,
} from './query.ts'
import { commandOut, commands, focusOf } from './commands.ts'
import { request } from './http.ts'
import { entityUrl } from './url.ts'

// How the tools reach the graph — in-process on the server, HTTP here.
export type IO = {
  read: () => Promise<Snapshot>
  // `via` is journal attribution — the calling session's id, when the
  // tool knows it. Never auth.
  write: (changes: Change[], via?: string) => Promise<Change[]>
  find: (q: string, limit?: number) => Promise<Hit[]>
  // Land an HTML page in the frozen store for an existing web entity.
  upload: (eid: string, html: string) => Promise<void>
  // Bump recall aggregates (server-stamped — recall never rides the
  // apply wire); confirm also stamps memory.last_confirmed_at.
  touch: (eids: string[], confirm?: boolean) => Promise<void>
  // A session's log tail (sessions.ts logs() in-process; the HTTP route
  // over stdio) — entries carry the renderer row when the line has one.
  logs: (eid: string, q: URLSearchParams) => Promise<{
    entries: { seq: number; line: string; row?: unknown }[]
    stderr?: string
  }>
  // An entity's slice of the journal (db.ts journalOf in-process; GET
  // /journal over stdio) — the wire's write record, newest first.
  history: (eid: string, limit?: number) => Promise<JournalEntry[]>
  // The provider table (adapters in-process; GET /providers over stdio)
  // — task_spawn's last-resort default when neither the caller nor the
  // args name one.
  providers: () => Promise<{ name: string; models: string[] }[]>
}

// The teaching text lives in grammar.ts — derived from the vocabulary,
// shared with `task help grammar`, so the two doors cannot disagree.

// One log entry, said small: the renderer row when the line carries one
// (adapters normalized it), else the raw line — either way one bounded
// line per seq, so a peek stays a glance.
let peekLine = (e: { seq: number; line: string; row?: unknown }) => {
  let r = e.row as Record<string, unknown> | undefined
  let clip = (s: unknown) =>
    String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  let said = !r
    ? clip(e.line)
    : r.kind == 'say'
    ? `${r.role}: ${clip(r.text)}`
    : r.kind == 'reason'
    ? `… ${clip(r.text)}`
    : r.kind == 'exec'
    ? `$ ${clip(r.command)}`
    : r.kind == 'tool'
    ? `[${r.name}] ${clip(r.error ?? r.detail ?? '')}`
    : r.kind == 'turn'
    ? '— turn —'
    : r.kind == 'error'
    ? `ERROR ${clip(r.text)}`
    : `(${clip((r as { tag?: unknown }).tag ?? r.kind)})`
  return `${String(e.seq).padStart(4)}  ${said}`
}

let line = (all: Row[], r: Row) => {
  let who = claimant(all, r)
  return `${idOf(r)}  ${String(r.comps.task?.status ?? r.kind).padEnd(7)} ${
    r.comps.doc?.title ?? ''
  }${who ? `  ⚑ ${who}` : ''}`
}

let parseAll = (params: string[]) =>
  params.map((p) => {
    let hit = param(p)
    if (!hit) throw new Error(`not a dot-param: ${p}`)
    return hit
  })

// Filters speak the richer query grammar (operators, lists, ranges).
let parseFilters = (filters: string[]) =>
  filters.map((f) => {
    let hit = pred(f)
    if (!hit) throw new Error(noFilter(f))
    return hit
  })

let output = z.object({ text: z.string() }).strict()
let text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })
// A refusal IS an error: isError rides the reply so agent harnesses (and
// telemetry) count it as one, instead of a success that reads like an apology.
let err = (s: string) => ({ ...text(s), isError: true as const })

// A query is a LIST door; one entity's whole doc is task_show's job.
// Any long text value in list results is cut mid-sentence with a loud
// marker — how much was withheld and which door reads it whole — so a
// preview can never pass for the text. graph_query's full: true opts
// out for the caller who wants bytes.
export let CUT = 500
export let elide = (r: Row) =>
  Object.fromEntries(
    Object.entries(r.comps).map(([name, comp]) => [
      name,
      Object.fromEntries(
        Object.entries(comp).map(([k, v]) => [
          k,
          typeof v == 'string' && v.length > CUT
            ? `${v.slice(0, CUT)} […ELIDED ${
              v.length - CUT
            } of ${v.length} chars — task_show ${
              idOf(r)
            } reads it whole, or full: true]`
            : v,
        ]),
      ),
    ]),
  )

let BUS = `Pass your stable session id and the reply also carries anything
you haven't seen — comments on your claimed tasks, messages aimed at your
session (a comment ON S-31 is a message TO that agent).`

// The one habit tool-arg strings breed: form-filling. Agents who write
// beautiful .md FILES compress a body ARG into one run-on paragraph —
// so the schema itself pushes back, on every door a body enters by.
let DOC = `A body is a full markdown DOCUMENT, written like a file you'd
commit: short paragraphs, bullet lists for anything enumerable (schemas,
steps, options), ## headings when it has parts, fenced code for code.
Never one run-on paragraph.`
let body = () => z.string().describe(DOC)
let title = () =>
  z.string().describe(
    'Plain text source. Pass <, >, and & literally; never HTML-encode them.',
  )
let count = z.number().int().positive()

// The write-time backstop: a long body with not one line break is a
// wall of text. It still stores (never drop words) — the reply says so
// at the one moment the writer can fix it cheaply.
let wall = (s: unknown) =>
  typeof s == 'string' && s.length > 240 && !s.includes('\n')
    ? `\nnote: that body is one unbroken ${s.length}-char line — bodies are
markdown documents (paragraphs, lists, headings). Rewrite via task_update
".body=".`
    : ''

export let mcpServer = (io: IO) => {
  // Server instructions ride the initialize handshake and land in the
  // agent's standing context — the strongest ambient steering the
  // protocol offers. Keep it to what every writer must know.
  let server = new McpServer({ name: 'tasks', version: '0.1.0' }, {
    instructions: `Tool arguments are source data, never HTML. Pass <, >,
and & literally; the renderer escapes them for its own output type.
The graph renders bodies as markdown. ${DOC}

Call task_context first each session, and pass the same stable session
id to every tool that takes one — it is your identity for claims,
comments, and the comms bus.`,
  })
  let tool = <Shape extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: Shape,
    run: (
      args: z.output<z.ZodObject<Shape>>,
    ) => CallToolResult | Promise<CallToolResult>,
  ) =>
    server.registerTool(
      name,
      {
        description,
        inputSchema: z.object(shape).strict(),
        outputSchema: output,
      },
      async (args: z.output<z.ZodObject<Shape>>) => {
        let out: CallToolResult = await run(args)
        if (out.isError) return out
        let said = out.content
          .filter((c: { type: string }) => c.type == 'text')
          .map((c: { text?: string }) => c.text ?? '')
          .join('\n')
        return { ...out, structuredContent: { text: said } }
      },
    )

  // The comms bus, MCP side: a tool that knows who's asking appends what
  // that session hasn't seen and advances the session's own ack cursor —
  // exactly when the lines are actually served.
  let bus = async (out: string, session?: string, snap?: Snapshot) => {
    if (!session) return text(out)
    let n = noticesFor(snap ?? await io.read(), session)
    if (!n.lines.length) return text(out)
    await io.write(n.ack, session)
    return text(out + noticeBlock(n.lines))
  }

  tool(
    'search',
    `Full-text search (FTS5) across every doc in the graph — task titles
and bodies, boards, projects, comments. Words AND together; a trailing *
prefix-matches. Dot-param filters mix into the same line ('runner
.status=done .updated.at=today') and screen the hits; filters alone
list matching entities, newest first. Returns ranked hits as 'id kind
title — snippet'; a comment hit names the entity it targets. Use this
FIRST when looking for existing work — cheaper and better-ranked than
paging graph_query.`,
    {
      q: z.string(),
      limit: count.describe('Maximum hits to return (default 20).').optional(),
    },
    async ({ q, limit }: { q: string; limit?: number }) => {
      let hits = await io.find(q, limit ?? 20)
      return text(
        hits.map((h) =>
          `${idOf(h)} ${h.kind}: ${h.title || '(untitled)'}` +
          `${h.open_eid != h.eid ? ` → on ${h.open_id ?? h.open_eid}` : ''}` +
          ` — ${h.snip.replaceAll('\x01', '[').replaceAll('\x02', ']')}` +
          `${h.retired ? ' · retired' : ''}`
        ).join('\n') || '(no hits)',
      )
    },
  )

  tool(
    'task_list',
    `List tasks (id, status, title), board-ordered. Optional dot-param
filters must ALL match. ${FILTERS} ${BUS}`,
    { filters: z.array(z.string()).optional(), session: z.string().optional() },
    async (
      { filters = [], session }: { filters?: string[]; session?: string },
    ) => {
      let now = Date.now()
      let all = rows(await io.read())
      let ps = resolveRefs(
        parseFilters(filters),
        (id) => find(all, id)?.eid,
      )
      checkRefs(all, ps)
      let byEid = new Map(all.map((r) => [r.eid, r.comps]))
      let hits = all
        .filter((r) => r.comps.task)
        .filter((r) => matchQuery(r.comps, ps, (e) => byEid.get(e)))
        .sort(
          orderOf(ps) == 'hot'
            ? (a, b) =>
              warm(b.comps, now, (e) => byEid.get(e)) -
              warm(a.comps, now, (e) => byEid.get(e))
            : byBoard,
        )
      let why = hits.length ? '' : resolution(ps, 'task')
      return bus(
        hits.map((r) => line(all, r)).join('\n') ||
          (why
            ? `(no matches) · filters resolved to ${why} — task_list ` +
              `returns tasks`
            : '(no matches)'),
        session,
      )
    },
  )

  tool(
    'task_new',
    `Create one task, or a batch with tasks:[{title, body?, status?,
params?}]. The single-task fields and tasks mode are exclusive. A
task's dedicated title/body/status wins over the same property in its
params; params carries every other writable property. The whole batch
lands in one atomic apply. *_eid param values accept human ids
(.project_eid=P-19). ${GRAMMAR} ${BUS}`,
    {
      title: title().optional(),
      body: body().optional(),
      status: z.enum(statuses).optional(),
      params: z.array(z.string()).optional(),
      tasks: z.array(
        z.object({
          title: title(),
          body: body().optional(),
          status: z.enum(statuses).optional(),
          params: z.array(z.string()).optional(),
        }).strict(),
      ).min(1).optional(),
      session: z.string().optional(),
    },
    async (
      { title, body, status, params, tasks, session }: {
        title?: string
        body?: string
        status?: string
        params?: string[]
        tasks?: {
          title: string
          body?: string
          status?: string
          params?: string[]
        }[]
        session?: string
      },
    ) => {
      let all = rows(await io.read())
      if (
        tasks &&
        [title, body, status, params].some((value) => value != null)
      ) {
        return err('tasks cannot be combined with single-task fields')
      }
      let want = tasks ?? [{ title: title ?? '', body, status, params }]
      if (!want.length || want.some((t) => !t.title)) {
        return err('every task needs a title (pass title or tasks[])')
      }
      let minted: string[] = []
      let changes = want.flatMap((t) => {
        let grouped = patches(derefParams(all, parseAll(t.params ?? [])))
        grouped.doc = {
          ...grouped.doc,
          title: t.title,
          ...(t.body != null ? { body: t.body } : {}),
        }
        if (t.status) grouped.task = { ...grouped.task, status: t.status }
        let eid = crypto.randomUUID()
        minted.push(eid)
        return taskChanges(eid, grouped)
      })
      await io.write(changes, session)
      let after = rows(await io.read())
      let ids = minted.map((eid) => {
        let made = after.find((r) => r.eid == eid)
        return made ? idOf(made) : eid
      })
      // A single create earns the dupe check; a batch is a deliberate
      // plan, not a probe — hinting on each would drown the reply.
      let dupe = want.length == 1
        ? await similarHint(
          `${want[0].title}\n${want[0].body ?? ''}`,
          minted[0],
        )
        : ''
      return bus(
        `created ${ids.join(', ')}${dupe ? `\n${dupe}` : ''}${
          wall(want.find((t) => wall(t.body))?.body)
        }`,
        session,
      )
    },
  )

  tool(
    'task_update',
    `Patch an entity by id (T-3, bare num, or eid) with dot-params, e.g.
[".status=done"] or [".body=notes..."]. Only the named props change.
comment optionally lands a plain comment in the same atomic batch.
*_eid values accept human ids. Cancelling (".status=cancelled") calls off
work without pretending it finished; use comment to say why. ${DOC}
${GRAMMAR} ${BUS}`,
    {
      id: z.string(),
      params: z.array(z.string()).min(1),
      // Why, in human words: lands as a PLAIN comment on the entity in
      // the same atomic batch — commentary, never a change trail (the
      // journal records the change). Cancellations should carry one.
      comment: z.string()
        .describe('Plain comment to write atomically with the patch.')
        .optional(),
      session: z.string().optional(),
    },
    async (
      { id, params, comment, session }: {
        id: string
        params: string[]
        comment?: string
        session?: string
      },
    ) => {
      let all = rows(await io.read())
      let row = find(all, id)
      if (!row) return err(`no entity: ${id}`)
      let grouped = patches(derefParams(all, parseAll(params)))
      await io.write([
        ...Object.entries(grouped)
          .map(([name, comp]) => ({ eid: row.eid, name, comp })),
        ...(comment ? commentChanges(all, row.eid, comment, session) : []),
      ], session)
      return bus(`updated ${idOf(row)}${wall(grouped.doc?.body)}`, session)
    },
  )

  tool(
    'task_context',
    `Your working set, ≤20 lines: the tasks claimed by your session (with
unresolved dependencies and who holds them), or the top of the open
board if you hold nothing. It also atomically surfaces and acknowledges
pending direct comments, claimed-task replies, knocks, and verified
operator mail as explicitly UNTRUSTED data. Call this FIRST each session,
with the same stable session identifier you claim with.`,
    { session: z.string() },
    async ({ session }: { session: string }) => {
      let snap = await io.read()
      return bus(contextDigest(snap, session), session, snap)
    },
  )

  tool(
    'task_claim',
    `Claim a task for your session — a lease telling other agents who is
working it (⚑ in listings). Pass a STABLE identifier for yourself
(session id or agent name) and reuse it for the whole session. Fails if
another session holds the lease; task_release drops it when you finish
or hand off.`,
    { id: z.string(), session: z.string() },
    async ({ id, session }: { id: string; session: string }) => {
      let all = rows(await io.read())
      let row = find(all, id)
      if (!row) return err(`no entity: ${id}`)
      try {
        await io.write(claimChanges(all, row.eid, session), session)
      } catch (e) {
        return {
          ...await bus(`claim failed: ${(e as Error).message}`, session),
          isError: true as const,
        }
      }
      return bus(`claimed ${idOf(row)} for ${session}`, session)
    },
  )

  tool(
    'task_release',
    `Drop the claim on a task (yours or a stale one), freeing it for
other sessions. ${BUS}`,
    { id: z.string(), session: z.string().optional() },
    async ({ id, session }: { id: string; session?: string }) => {
      let row = find(rows(await io.read()), id)
      if (!row) return err(`no entity: ${id}`)
      await io.write([{ eid: row.eid, name: 'claim', comp: null }], session)
      return bus(`released ${idOf(row)}`, session)
    },
  )

  tool(
    'task_spawn',
    `Dispatch a managed agent onto a task: mints a session entity carrying
the request. Invalid provider/model/effort values fail before minting;
launch failures become a failed Session on the board. Returns the S-id:
session_peek checks on it, task_comment at the SETTLED session says more
to it, and when the run settles the server comments the outcome on the
task AND your spawning session, so you hear it directly. provider/model
default to YOUR session's own (pass the same session id you claim with),
then the provider table's first entry. persona names the persona entity
(id or alias) the spawned session should wear. ${BUS}`,
    {
      id: z.string(),
      provider: z.string().optional(),
      model: z.string().optional(),
      effort: z.string().optional(),
      persona: z.string()
        .describe('Persona entity id or alias for the spawned session.')
        .optional(),
      session: z.string().optional(),
    },
    async (
      { id, provider, model, effort, persona, session }: {
        id: string
        provider?: string
        model?: string
        effort?: string
        persona?: string
        session?: string
      },
    ) => {
      let snap = await io.read()
      let all = rows(snap)
      // A spawn begets its own kind: unnamed provider/model inherit the
      // CALLER's (its session row), then the provider table's first entry.
      // A caller's model never rides a different explicit provider.
      let mine = spawnDefaults(all, session)
      provider ??= mine.provider
      model ??= provider == mine.provider ? mine.model : undefined
      if (!provider || !model) {
        let table = await io.providers()
        provider ??= table[0]?.name
        model ??= table.find((p) => p.name == provider)?.models[0]
        if (!provider || !model) return err('no provider to default to')
      }
      // Pre-flight the allowlist here, at the tool boundary: a bad model is
      // a clear error to the caller, not a doomed husk on the board (the
      // raw wire still husks — that contract is the created(session)
      // effect's, for graph_apply).
      let bad = trouble({ provider, model, effort })
      if (bad) return err(bad)
      let made
      try {
        made = spawnChanges(all, {
          task: id,
          provider,
          model,
          effort,
          persona,
          by: session,
          deps: snap.deps,
        })
      } catch (e) {
        return err((e as Error).message)
      }
      await io.write(made.changes, session)
      let after = find(rows(await io.read()), made.eid)
      return bus(
        `spawned ${after ? idOf(after) : made.eid} onto ${id}`,
        session,
      )
    },
  )

  tool(
    'command',
    `Run a \`:\` command line — the SAME vocabulary the owner types into
the web bar and TUI, one language across every door. Focus ("where you
stand") is \`on\` when given, else your session's single claimed entity.
Writes land, :fix spawns an agent (your session's provider defaults),
:open returns the entity's URL. The vocabulary:
${
      Object.entries(commands)
        .map(([n, c]) => `  :${`${n} ${c.args}`.trim()} — ${c.about}`)
        .join('\n')
    } ${BUS}`,
    {
      line: z.string(),
      on: z.string().optional(),
      session: z.string().optional(),
    },
    async (
      { line, on, session }: { line: string; on?: string; session?: string },
    ) => {
      let all = rows(await io.read())
      let eid: string | undefined
      if (on) {
        let r = find(all, on)
        if (!r) return err(`no entity: ${on}`)
        eid = r.eid
      } else eid = focusOf(all, session)
      let out
      try {
        out = commandOut(all, line, eid, session)
      } catch (e) {
        return err((e as Error).message)
      }
      if (out.changes?.length) await io.write(out.changes, session)
      let said = out.msg ? [out.msg] : []
      if (out.spawn) {
        // A spawn on defaults — a fresh read sees the task the line may
        // have just filed; task_spawn is the door for overrides.
        let snap = await io.read()
        let now = rows(snap)
        let mine = spawnDefaults(now, session)
        let { provider, model } = mine
        if (!provider || !model) {
          let table = await io.providers()
          provider ??= table[0]?.name
          model ??= table.find((p) => p.name == provider)?.models[0]
          if (!provider || !model) return err('no provider to default to')
        }
        let made = spawnChanges(now, {
          task: out.spawn,
          provider,
          model,
          by: session,
          deps: snap.deps,
        })
        await io.write(made.changes, session)
        let after = find(rows(await io.read()), made.eid)
        let onto = find(now, out.spawn)
        said.push(
          `spawned ${after ? idOf(after) : made.eid} onto ${
            onto ? idOf(onto) : out.spawn
          }`,
        )
      }
      if (out.go) {
        let r = all.find((x) => x.eid == out.go)
        said.push(entityUrl(r ? idOf(r) : out.go))
      }
      return bus(said.join('\n') || 'ok', session)
    },
  )

  tool(
    'session_peek',
    `Check in on a session (S-12): status, provider/model, seq, timing,
error — then the last lines of its log as rendered rows (what it said,
ran, called). tail picks how many lines (default 20, cap 500). Works
running or settled; stderr rides along when the child wrote any. ${BUS}`,
    {
      id: z.string(),
      tail: count.max(500).optional(),
      session: z.string().optional(),
    },
    async (
      { id, tail, session }: { id: string; tail?: number; session?: string },
    ) => {
      let all = rows(await io.read())
      let row = find(all, id)
      if (!row?.comps.session) return err(`no session: ${id}`)
      let s = row.comps.session
      let head = [
        `${idOf(row)} ${s.status ?? 'external'}`,
        `${s.provider ?? '?'} ${s.serving_model ?? s.model ?? ''}`.trim(),
        `seq ${s.latest_seq ?? 0}`,
        ...(s.started_at ? [`started ${s.started_at}`] : []),
        ...(s.finished_at ? [`finished ${s.finished_at}`] : []),
        ...(s.exit_code == null ? [] : [`exit ${s.exit_code}`]),
        ...(row.comps.error?.message
          ? [`error: ${String(row.comps.error.message).slice(0, 200)}`]
          : []),
      ].join(' · ')
      // The cap is PEEK's, not the door's: /logs serves a whole log to a
      // reader that wants one (the web pane does), so a glance clamps for
      // itself rather than dropping a transcript into an agent's context.
      let out = await io.logs(
        row.eid,
        new URLSearchParams({
          tail: String(Math.min(Math.max(tail ?? 20, 1), 500)),
        }),
      )
      let lines = out.entries.map(peekLine)
      return bus(
        [head, ...lines, ...(out.stderr ? [`stderr:\n${out.stderr}`] : [])]
          .join('\n'),
        session,
      )
    },
  )

  tool(
    'history',
    `An entity's write history from the journal, newest first: when · who
· what changed (comp{cols} for patches, -comp for removals, † for the
entity's death). The journal records every applied batch — blame and
diffs without a version table. id: T-3, S-12, or eid. limit is the
maximum number of newest batches to return. ${BUS}`,
    {
      id: z.string(),
      limit: count
        .describe('Maximum newest journal batches to return.')
        .optional(),
      session: z.string().optional(),
    },
    async (
      { id, limit, session }: {
        id: string
        limit?: number
        session?: string
      },
    ) => {
      let all = rows(await io.read())
      let row = find(all, id)
      if (!row) return err(`no entity: ${id}`)
      let entries = await io.history(row.eid, limit)
      if (!entries.length) return bus(`${idOf(row)}: no history`, session)
      return bus(entries.map(historyLine).join('\n'), session)
    },
  )

  tool(
    'task_comment',
    `Comment on ANY entity (tasks, boards, docs, frozen pages — anything
with an id). An optional verdict makes it a review; its body is the
rationale and may be empty for a bare verdict. Pass the same stable
session identifier you claim with, for attribution.

Returns the comment's own id (C-13). A comment is an ordinary entity, so
REVISE a wrong one in place — graph_apply {eid: 'C-13', name: 'doc',
comp: {body: '…'}} — instead of posting a correction under it. The
original text stays in \`history\`, so nothing is lost by fixing it, while
a correction comment leaves the wrong version as the one people read
first.`,
    {
      id: z.string(),
      body: body().optional(),
      verdict: z.enum(verdicts).optional(),
      session: z.string(),
    },
    async (
      { id, body, verdict, session }: {
        id: string
        body?: string
        verdict?: string
        session: string
      },
    ) => {
      if (!verdict && !body?.trim()) return err('body or verdict is required')
      let all = rows(await io.read())
      let row = find(all, id)
      if (!row) return err(`no entity: ${id}`)
      let words = body ?? ''
      let made = commentChanges(all, row.eid, words, session, { verdict })
      await io.write(made, session)
      // The writer's handle on what it just wrote — without it, fixing a
      // wrong comment means writing another one.
      let mine = made.find((c) => c.name == 'comment')?.eid
      let after = rows(await io.read()).find((r) => r.eid == mine)
      let said = verdict ? `${verdict} review` : 'comment'
      return bus(
        `${after ? idOf(after) : mine} — ${said} on ${idOf(row)}${wall(words)}`,
        session,
      )
    },
  )

  tool(
    'memory_save',
    `Save a memory — one distilled fact the whole fleet can recall.
Content is a doc: title is the INDEX LINE (recall shows it first),
body the fact. ${DOC} scope names the project it belongs to (P-19);
omit it for a principle every operator carries. feedback names WHO
gave it, when the memory records someone's correction ('jeff', or ''
if the source is unknown). Passing id
instead CONFIRMS an existing memory: patches whatever props ride
along, stamps last_confirmed_at, and counts as a strong recall —
confirm what you reuse, and it decays slower.
Editing a body REPLACES it, so id + body also needs was: the token
memory_recall prints above the body it hands you. Read, merge into
what you were given, save with that token — another writer since
your read is refused, with their text and a fresh token. ${BUS}`,
    {
      title: title().optional(),
      body: body().optional(),
      // The retired enum, kept only to REFUSE — the habit is four years of
      // fleet muscle memory and a silently dropped argument would file the
      // memory wrong without saying so (T-12585).
      type: z.string()
        .describe('RETIRED — see the error it returns.')
        .optional(),
      scope: z.string().optional(),
      feedback: z.string()
        .describe(
          "Who GAVE this feedback — 'jeff', a human id, or '' when the " +
            'source is unknown. Tags the memory as feedback either way.',
        )
        .optional(),
      decided: z.string()
        .describe(
          'When the decision this records was TAKEN — an ISO date or a ' +
            "phrase ('3 months ago'). Stamps `decided`, which is what " +
            '`task decided` and the digest order by. Say it when writing up ' +
            'an old decision: filing it today is not deciding it today. The ' +
            'stamp SAYS it is a decision, so the title must not — never ' +
            "prefix one with 'decision:'.",
        )
        .optional(),
      id: z.string().optional(),
      was: z.string()
        .describe(
          'The was: token memory_recall printed for the body you are ' +
            'replacing. Required with id + body.',
        )
        .optional(),
      session: z.string(),
    },
    async (
      { title, body, type, scope, feedback, decided, id, was, session }: {
        title?: string
        body?: string
        type?: string
        scope?: string
        feedback?: string
        decided?: string
        id?: string
        was?: string
        session: string
      },
    ) => {
      if (type != null) return err(RETIRED_TYPE)
      let all = rows(await io.read())
      if (id) {
        let row = find(all, id)
        if (!row?.comps.memory) return err(`no memory: ${id}`)
        // Replacing a body without naming the one you read is the lost
        // update, so it is refused HERE rather than left to the caller's
        // care — the wire keeps `was` optional for every single-writer
        // door, and this is the door where two agents collide.
        if (body != null && was == null) {
          return err(
            `memory_save on ${idOf(row)} replaces the whole body, so it ` +
              `needs the body you started from.\n` +
              `Run memory_recall ids: ["${idOf(row)}"], merge your change ` +
              `into the body it prints, and pass its was: token back here.\n` +
              `The token is deliberately not in this message: a body you ` +
              `have not read is a body you would overwrite.`,
          )
        }
        let patch: Change[] = []
        if (title != null || body != null) {
          patch.push({
            eid: row.eid,
            name: 'doc',
            comp: {
              ...(title != null ? { title } : {}),
              ...(body != null ? { body } : {}),
            },
            ...(was != null ? { was: { body: was } } : {}),
          })
        }
        if (scope != null) {
          let project = find(all, scope)
          if (!project?.comps.project) return err(`no project: ${scope}`)
          patch.push({
            eid: row.eid,
            name: 'memory',
            comp: { scope_eid: project.eid },
          })
        }
        if (feedback != null) {
          try {
            patch.push(feedbackChange(all, row.eid, feedback))
          } catch (e) {
            return err((e as Error).message)
          }
        }
        if (decided != null) patch.push(decidedChange(row.eid, decided))
        if (patch.length) {
          // A refused precondition is an answer, not a crash: it carries the
          // current value and the token to retry with, which is exactly what
          // the caller needs to finish the job.
          try {
            await io.write(patch, session)
          } catch (e) {
            return err((e as Error).message)
          }
        }
        await io.touch([row.eid], true)
        return bus(`confirmed ${idOf(row)}${wall(body)}`, session)
      }
      if (!title) {
        return err('a new memory needs a title (or pass id to confirm one)')
      }
      let made
      try {
        made = memoryChanges(all, {
          title,
          body,
          scope,
          feedback,
          decided,
          session,
        })
      } catch (e) {
        return err((e as Error).message)
      }
      await io.write(made.changes, session)
      let after = find(rows(await io.read()), made.eid)
      let dupe = await similarHint(`${title}\n${body ?? ''}`, made.eid)
      return bus(
        `saved ${after ? idOf(after) : made.eid}${dupe ? `\n${dupe}` : ''}${
          wall(body)
        }`,
        session,
      )
    },
  )

  tool(
    'memory_recall',
    `Recall memories, warmest first. The default reply is the INDEX —
'M-7 0.84 feedback: title · 3× · confirmed 2026-07-01' — no bodies.
Pass ids: [M-7, …] to read full bodies: THAT is the activation that
bumps a memory's recall stats (listing never does), so expand only
what you actually use. ids mode cannot be combined with query,
feedback, or limit. In index mode, feedback: true keeps only memories
recording someone's correction, and limit caps returned index lines
(default 20). query mixes text terms with dot-param filters
('.scope_eid=P-19', '.feedback.by=jeff', '.count>=3',
'.last_confirmed_at<"last month"'); rank is recency vs earned stability
— recalled often and spread out decays slowest. ${BUS}`,
    {
      query: z.string().optional(),
      type: z.string()
        .describe('RETIRED — see the error it returns.')
        .optional(),
      feedback: z.boolean()
        .describe('Index mode: keep only memories tagged as feedback.')
        .optional(),
      ids: z.array(z.string()).min(1).optional(),
      limit: count
        .describe('Maximum index lines to return (default 20).')
        .optional(),
      session: z.string().optional(),
    },
    async (
      { query, type, feedback, ids, limit, session }: {
        query?: string
        type?: string
        feedback?: boolean
        ids?: string[]
        limit?: number
        session?: string
      },
    ) => {
      if (type != null) return err(RETIRED_TYPE)
      let all = rows(await io.read())
      if (
        ids &&
        [query, feedback, limit].some((value) => value != null)
      ) {
        return err('ids cannot be combined with query, feedback, or limit')
      }
      if (ids) {
        let hits: Row[] = []
        for (let id of ids) {
          let row = find(all, id)
          if (!row?.comps.memory) return err(`no memory: ${id}`)
          hits.push(row)
        }
        await io.touch(hits.map((r) => r.eid))
        return bus(
          hits.map((r) =>
            // The `was` token rides the read because this is the only place
            // an agent can get one — it cannot hash a body itself, and a
            // guarded save is the only way to edit a memory. Reading and
            // then writing is the whole loop, so the read hands over what
            // the write will ask for.
            `${idOf(r)} ${memoryHead(r)}${r.comps.doc?.title ?? ''}\nwas: ${
              sha(r.comps.doc?.body ?? '')
            }\n${r.comps.doc?.body ?? ''}`
          ).join('\n\n'),
          session,
        )
      }
      let preds
      try {
        preds = resolveRefs(
          parseQuery(query ?? ''),
          (id) => find(all, id)?.eid,
        )
      } catch (e) {
        return err((e as Error).message)
      }
      // A tag comp has no column, so it screens HERE rather than through the
      // pred grammar — the same way the inbox reads `archived`. Its `by` is a
      // column and does filter: '.feedback.by=jeff'.
      let pool = feedback ? all.filter((r) => r.comps.feedback) : all
      let lines = recallIndex(pool, preds, Date.now(), limit ?? 20)
      return bus(lines.join('\n') || '(no memories)', session)
    },
  )

  // ---- the generic graph surface: the UI is data, so this IS UI control ----

  tool(
    'graph_query',
    `The WHOLE graph, not just tasks: every entity as {kind,
entity:{eid,num}, ...components}, dot-param filtered. Cards, pins
(positions), cameras (what each
client is looking at), sessions, comments — all live here. A query is a
LIST door: long text values (persona bodies, mail, final_text) are cut
at ${CUT} chars with a marker naming the rest — task_show reads one
entity whole; full: true returns every byte. kind screens on the
entity's derived display kind (task, project, comment, and so on).
${GRAMMAR} ${FILTERS}`,
    {
      filters: z.array(z.string()).optional(),
      kind: z.string()
        .describe('Derived entity kind to return.')
        .optional(),
      full: z.boolean().optional(),
    },
    async (
      { filters = [], kind, full }: {
        filters?: string[]
        kind?: string
        full?: boolean
      },
    ) => {
      let now = Date.now()
      let all = rows(await io.read())
      let ps = resolveRefs(
        parseFilters(filters),
        (id) => find(all, id)?.eid,
      )
      checkRefs(all, ps)
      let byEid = new Map(all.map((r) => [r.eid, r.comps]))
      let hits = all
        .filter((r) => !kind || r.kind == kind)
        .filter((r) => matchQuery(r.comps, ps, (e) => byEid.get(e)))
      if (orderOf(ps) == 'hot') {
        hits.sort((a, b) =>
          warm(b.comps, now, (e) => byEid.get(e)) -
          warm(a.comps, now, (e) => byEid.get(e))
        )
      }
      let out = JSON.stringify(
        hits.map((r) => jsonOf(r, full ? r.comps : elide(r))),
        null,
        2,
      )
      // An empty array is where a mis-routed filter reads as absence, so
      // the routing rides along — as its OWN content block, leaving the
      // first block byte-identical JSON for anyone who parses it.
      let why = hits.length ? '' : resolution(ps, kind)
      return why
        ? {
          content: [
            { type: 'text' as const, text: out },
            {
              type: 'text' as const,
              text: `(no rows) · filters resolved to ${why}`,
            },
          ],
        }
        : text(out)
    },
  )

  tool(
    'graph_apply',
    `Raw wire access: apply a batch of changes atomically. A change is
{eid, name, comp} — comp is a PATCH (omitted columns untouched), comp:
null deletes the component, {name:'entity', comp:null} deletes the
entity. Mint uuids for new entities. eid and *_eid comp values accept
human ids (T-3, P-19) for EXISTING entities. Edges: name 'dependency',
comp {type: ${edges.join('|')}, child_eid} links eid→child; add gone:
true to unlink (a triple has no row key, so the comp names the whole
edge). Unknown component names are forward-compatible no-ops. Same
allowlist and claim-lease rules as every other client; writes broadcast
live to all screens. The result reports submitted intent and the
authoritative effective batch returned by apply(). ${GRAMMAR}`,
    {
      changes: z.array(
        z.object({
          eid: z.string(),
          name: z.string(),
          comp: z.record(z.unknown()).nullable(),
        }).strict(),
      ).min(1),
    },
    async ({ changes }: { changes: Change[] }) => {
      let effective
      try {
        effective = await io.write(changes)
      } catch (e) {
        return err(`apply failed: ${(e as Error).message}`)
      }
      return text(JSON.stringify(
        {
          submitted: changes.length,
          effective: effective.length,
          changes: effective,
        },
        null,
        2,
      ))
    },
  )

  tool(
    'ui_state',
    `What's on screen right now: every client's camera (viewport rect in
plane coords) and every pinned card (position, size, view, target),
with which viewports can see it. Card heights of 0 are auto — treated
as ~240px for visibility.`,
    {},
    async () => {
      let all = rows(await io.read())
      let byEid = new Map(all.map((r) => [r.eid, r]))
      let title = (eid: string) => {
        let t = byEid.get(eid)
        return t ? `${idOf(t)} ${t.comps.doc?.title ?? t.kind}` : eid
      }
      let cams = all.filter((r) => r.comps.camera).map((r) => {
        let c = r.comps.camera as Record<string, number>
        let hw = (Number(c.w) || 0) / 2 / (Number(c.zoom) || 1)
        let hh = (Number(c.h) || 0) / 2 / (Number(c.zoom) || 1)
        return {
          camera: idOf(r),
          client: String(c.client_eid),
          // WHO this viewport is: the client's browser, and when the
          // camera last moved — a live human reads recent, a ghost stale.
          agent: String(
            byEid.get(String(c.client_eid))?.comps.client?.user_agent ?? '?',
          ),
          moved_at: r.comps.updated?.at ?? r.comps.created?.at ?? null,
          canvas: String(c.canvas_eid),
          zoom: c.zoom,
          viewport: { x0: c.x - hw, y0: c.y - hh, x1: c.x + hw, y1: c.y + hh },
        }
      })
      let cards = all.filter((r) => r.comps.card && r.comps.pin).map((r) => {
        let p = r.comps.pin as Record<string, number>
        let c = r.comps.card as Record<string, string>
        let h = Number(p.h) || 240
        let seen = cams
          .filter((v) =>
            String(p.canvas_eid) == v.canvas &&
            p.x < v.viewport.x1 && p.x + Number(p.w) > v.viewport.x0 &&
            p.y < v.viewport.y1 && Number(p.y) + h > v.viewport.y0
          )
          .map((v) => v.camera)
        return {
          card: idOf(r),
          moved_at: r.comps.updated?.at ?? r.comps.created?.at ?? null,
          eid: r.eid,
          target: title(c.target_eid),
          view: c.view,
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
          z: p.z,
          visible_in: seen,
        }
      })
      return text(JSON.stringify({ cameras: cams, cards }, null, 2))
    },
  )

  tool(
    'card_open',
    `Open a card on the canvas: target entity through a view, at x/y
(plane coords) — omitted position lands at the center of the most
recently moved viewport (whoever is looking right now). Returns the
card id (close it with card_close, move it with card_move).`,
    {
      target: z.string(),
      view: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    },
    async (
      { target, view, x, y }: {
        target: string
        view?: string
        x?: number
        y?: number
      },
    ) => {
      let all = rows(await io.read())
      let row = find(all, target)
      if (!row) return err(`no entity: ${target}`)
      let canvas = all.find((r) => r.kind == 'canvas')
      if (!canvas) return err('no canvas')
      if (x == null || y == null) {
        // The LIVELIEST viewport, not the newest-minted: a camera moves
        // whenever its human pans, so updated.at names who's looking.
        let cam = all.filter((r) => r.comps.camera?.canvas_eid == canvas.eid)
          .sort((a, b) =>
            String(b.comps.updated?.at ?? '').localeCompare(
              String(a.comps.updated?.at ?? ''),
            )
          )[0]?.comps.camera as
            | Record<string, number>
            | undefined
        // Center on the auto width's nominal 480 — same as Canvas spawns.
        x ??= (cam ? Number(cam.x) : 0) - 240
        y ??= (cam ? Number(cam.y) : 0) - 100
      }
      let z = Math.max(
        0,
        ...all.filter((r) => r.comps.pin).map((r) =>
          Number(r.comps.pin.z) || 0
        ),
      ) + 1
      let views: Record<string, string> = {
        task: 'Full',
        board: 'Board',
        web: 'Web',
        doc: 'Full',
        project: 'Full',
      }
      let eid = crypto.randomUUID()
      await io.write([
        {
          eid,
          name: 'card',
          comp: {
            target_eid: row.eid,
            view: view ?? views[row.kind] ?? 'JSON',
          },
        },
        {
          eid,
          name: 'pin',
          comp: { canvas_eid: canvas.eid, x, y, w: 0, h: 0, z }, // w 0 = auto
        },
      ])
      let made = rows(await io.read()).find((r) => r.eid == eid)
      return text(`opened ${made ? idOf(made) : eid} at ${x},${y}`)
    },
  )

  tool(
    'card_move',
    'Move/resize a card: any of x, y (plane coords), w, h (px; h 0 = auto).',
    {
      id: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().optional(),
      h: z.number().optional(),
    },
    async (
      { id, x, y, w, h }: {
        id: string
        x?: number
        y?: number
        w?: number
        h?: number
      },
    ) => {
      let row = find(rows(await io.read()), id)
      if (!row?.comps.pin) return err(`no pinned card: ${id}`)
      let comp = Object.fromEntries(
        Object.entries({ x, y, w, h }).filter(([, v]) => v != null),
      )
      if (!Object.keys(comp).length) return text('nothing to change')
      await io.write([{ eid: row.eid, name: 'pin', comp }])
      return text(`moved ${idOf(row)}`)
    },
  )

  tool(
    'card_close',
    'Close a card (deletes the card entity, never its target).',
    { id: z.string() },
    async ({ id }: { id: string }) => {
      let row = find(rows(await io.read()), id)
      if (!row?.comps.card) return err(`no card: ${id}`)
      await io.write([{ eid: row.eid, name: 'entity', comp: null }])
      return text(`closed ${idOf(row)}`)
    },
  )

  tool(
    'page_put',
    `Publish an HTML page into the graph — the way to drop a one-shot
artifact (mockup, report, diagram) where people work. Mints a web
entity and lands your HTML AS-IS: inline scripts, styles, and external
references all render (in a sandboxed iframe cut off from the app's
origin). Markdown needs no upload: put it in any doc body. Show the
page with card_open. Passing the id of an existing web entity replaces
its page and title instead.`,
    { title: title(), html: z.string(), id: z.string().optional() },
    async (
      { title, html, id }: { title: string; html: string; id?: string },
    ) => {
      let eid: string
      if (id) {
        let row = find(rows(await io.read()), id)
        if (!row?.comps.web) return err(`no web entity: ${id}`)
        eid = row.eid
        await io.write([{ eid, name: 'doc', comp: { title } }])
      } else {
        eid = uuid()
        await io.write([
          { eid, name: 'web', comp: { url: '' } },
          { eid, name: 'doc', comp: { title } },
        ])
      }
      await io.upload(eid, html)
      let made = rows(await io.read()).find((r) => r.eid == eid)
      let name = made ? idOf(made) : eid
      return text(`published ${name} — card_open ${name} to show it`)
    },
  )

  tool(
    'code_run',
    `Code mode: run JS against the graph in a sandboxed worker (no fs, no
net, no env — its ONLY capability is the graph). In scope: graph
({changes, deps, rows} — rows is [{eid, num, kind, comps}]), apply(
...changes) to QUEUE writes, log(...) for debug output. The script's
return value comes back to you. Queued changes apply atomically after
the script finishes — unless dry_run, which returns the batch without
applying (preview a layout before committing it). Example — grid the
cards: const pins = graph.rows.filter(r => r.comps.pin); pins.forEach(
(p, i) => apply({eid: p.eid, name: 'pin', comp: {x: (i%4)*360, y:
Math.floor(i/4)*280}})); return pins.length. timeout_ms is the positive
integer execution deadline in milliseconds (default 10000, maximum
30000).`,
    {
      js: z.string(),
      dry_run: z.boolean().optional(),
      timeout_ms: count.max(30_000)
        .describe('Execution deadline in milliseconds (maximum 30000).')
        .optional(),
    },
    async (
      { js, dry_run, timeout_ms }: {
        js: string
        dry_run?: boolean
        timeout_ms?: number
      },
    ) => {
      let snapshot = await io.read()
      let worker = new Worker(new URL('./sandbox.ts', import.meta.url), {
        type: 'module',
        deno: { permissions: 'none' },
      } as WorkerOptions)
      type Out = {
        ok: boolean
        result?: unknown
        error?: string
        batch: Change[]
        logs: string[]
      }
      let out: Out
      try {
        out = await new Promise<Out>((resolve, reject) => {
          let t = setTimeout(
            () => reject(new Error('code timed out')),
            timeout_ms ?? 10_000,
          )
          worker.onmessage = (m) => {
            clearTimeout(t)
            resolve(m.data as Out)
          }
          worker.onerror = (e) => {
            clearTimeout(t)
            reject(new Error(e.message))
          }
          worker.postMessage({ js, snapshot })
        })
      } catch (e) {
        return err(`code failed: ${(e as Error).message}`)
      } finally {
        worker.terminate()
      }
      if (!out.ok) {
        return err(
          `code threw: ${out.error}\nlogs:\n${out.logs.join('\n')}`,
        )
      }
      let applied = ''
      if (out.batch.length && !dry_run) {
        try {
          let effective = await io.write(out.batch)
          applied = `${out.batch.length} submitted; ` +
            `${effective.length} effective change(s)`
        } catch (e) {
          return err(JSON.stringify(
            {
              result: out.result,
              logs: out.logs,
              status: `batch REJECTED: ${(e as Error).message}`,
            },
            null,
            2,
          ))
        }
      } else if (out.batch.length) {
        applied = `dry run — ${out.batch.length} change(s) NOT applied`
      }
      return text(JSON.stringify(
        {
          result: out.result,
          logs: out.logs,
          status: applied || 'no changes queued',
          ...(dry_run ? { batch: out.batch } : {}),
        },
        null,
        2,
      ))
    },
  )

  tool(
    'task_show',
    `One entity, whole: {kind, entity:{eid,num}, ...components}, plus its
edges (refs out, backrefs in) and comments in the same entity shape. id:
T-3, bare num, or eid. ${BUS}`,
    { id: z.string(), session: z.string().optional() },
    async ({ id, session }: { id: string; session?: string }) => {
      let snap = await io.read()
      let all = rows(snap)
      let row = find(all, id)
      if (!row) return err(`no entity: ${id}`)
      let comments = all.filter((r) => r.comps.comment?.target_eid == row.eid)
      let edges = edgesOf(snap, all, row.eid)
      return bus(
        JSON.stringify(
          {
            ...jsonOf(row),
            ...edges,
            comments: comments.map((r) => jsonOf(r)),
          },
          null,
          2,
        ),
        session,
      )
    },
  )

  return server
}

// stdio entry: same tools, reaching the graph over HTTP like any client.
if (import.meta.main) {
  await mcpServer({
    read: snapshot,
    write: send,
    find: search,
    upload: async (eid, html) => {
      let res = await request(`http://${host()}/upload?eid=${eid}`, {
        method: 'POST',
        body: html,
      })
      if (!res.ok) throw new Error(`server said ${res.status}`)
    },
    // Recall stats are server-stamped and the apply wire refuses them by
    // design — over HTTP there is no honest way to bump one, so the
    // stdio transport reads memories without warming them. The in-process
    // mount (/mcp, the fleet's door) is where recall counts.
    touch: async () => {},
    logs: async (eid, q) => {
      let res = await request(`http://${host()}/sessions/${eid}/logs?${q}`)
      if (!res.ok) throw new Error(`server said ${res.status}`)
      return res.json()
    },
    history: (eid, limit) => history(eid, limit),
    providers: async () => {
      let res = await request(`http://${host()}/providers`)
      if (!res.ok) throw new Error(`server said ${res.status}`)
      return res.json()
    },
  }).connect(new StdioServerTransport())
}
