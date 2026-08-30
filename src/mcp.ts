// The MCP tool registry: the entity graph as self-documenting task_*
// tools for agents — no auth, no keys. The registry is transport- and
// io-agnostic: the dev server mounts it at /mcp (statelessly, calling
// apply/snapshot in-process — restarts can't strand a session), and
// `deno run -A src/mcp.ts` serves the same tools over stdio. Beside the graph
// it reads SQLite directly through the same IO the HTTP mount uses; explicit
// remote mode and service operations stay on HTTP.
//
// The dot-param grammar is shared with the CLI: '.title=Hello' routes by
// prop through the component vocabulary; '.pin.x=12' is the explicit
// spelling for the few collisions. The tool descriptions teach it.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type {
  CallToolResult,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { DatabaseSync } from './sqlite.ts'
import { VERSION } from './version.ts'
import {
  type Change,
  comps,
  type Dep,
  edges,
  type Hit,
  sessionOf,
  type Snapshot,
  statuses,
  uuid,
  verdicts,
} from './types.ts'
import {
  type EntityLiteral,
  type Mutation,
  type MutationResult,
  mutationResult,
} from './mutation.ts'
import { trouble } from './adapters.ts'
import { type Dim, report, type Use, use } from './usage.ts'
import { sha } from './sha.ts'
import { EDIT_OP, FILTERS, GRAMMAR } from './grammar.ts'
import {
  authoringLine,
  bus as busNotices,
  byBoard,
  checkedRefs,
  claimant,
  commentChanges,
  contextDigest,
  contextSnapshot,
  decidedChange,
  derefedParams,
  edgesOf,
  feedbackChange,
  fetched,
  find,
  history,
  historyLine,
  host,
  httpDeps,
  idOf,
  type JournalEntry,
  jsonAuthored,
  jsonOf,
  memoryChanges,
  memoryHead,
  mintedIn,
  mutate,
  noticeBlock,
  param,
  patches,
  type Querier,
  query as queryHttp,
  type QueryOpts,
  recallIndex,
  refHandles,
  refsIn,
  RETIRED_TYPE,
  type Row,
  rows,
  scopeFor,
  search,
  serverCaps,
  sessionFor,
  sessionRow,
  similarHint,
  spawnChanges,
  spawnPlan,
  TASK_TREE_ADOPTION,
  taskChanges,
  taskTreeExample,
  taskTreePlan,
  taskTreeText,
  taskTreeWarning,
  uniq,
  workClaimMutation,
} from './client.ts'
import { noFilter, orderOf, parseQuery, pred, resolution } from './query.ts'
import {
  commandOut,
  commands,
  focusFor,
  focusOf,
  type Reader,
  spawnSpec,
} from './commands.ts'
import { editChange, parsePropPatch, patchHint } from './edit.ts'
import { slotsOf } from './verb.ts'
import { renderEntry, seqRange, type Sift, transcribe } from './log_text.ts'
import {
  type EntryRow,
  type GraphLog,
  graphLog,
  pageEntries,
} from './entry_log.ts'
import { request } from './http.ts'
import { entityUrl } from './url.ts'
import { wakeList } from './title.ts'
import {
  backfillChanges,
  type BackfillKind,
  backfillKinds,
  landBackfill,
  readBackfill,
} from './backfill.ts'
import { depsOf, eager, journalOf, search as dbSearch, snapshot } from './db.ts'
import { dbReader, localQuery } from './graph_query.ts'
import { guarded, localReadPath } from './localread.ts'
import { workCandidates, type WorkLane } from './work.ts'

// How the tools reach the graph — database-backed in the server and local
// stdio processes, HTTP only for an explicitly remote graph.
export type IO = {
  // The whole eager graph. code_run's sandbox contract (graph.rows) and the
  // command tool's stdio-only fallback are its LAST callers — every other tool
  // reads scoped through query/get/deps (T-22217). Don't add callers.
  read: () => Promise<Snapshot>
  // The authoritative filter-query — the whole graph, INCLUDING the lazy entry
  // partition when the filter names it (`.entry.session=…`), paged by seq, and
  // `id=` addressing (T-3, num, slug, uuid — locate, find()'s mirror). In-
  // process it runs localQuery; explicitly remote stdio uses the /query GET.
  query: (
    q: string,
    opts?: QueryOpts,
  ) => Promise<Row[]>
  // Entities BY ADDRESS (any form id= reads), extra filters screening the
  // hits — find() over the wire, for target resolution and bounded reference
  // expansion in derived read faces.
  get: (ids: string[], filters?: string[]) => Promise<Row[]>
  // The dependency edges touching these entities, both directions, quarantine-
  // screened; `reveal` lifts the screen the way quarantined=1 does.
  deps: (eids: string[], reveal?: boolean) => Promise<Dep[]>
  // `via` is journal attribution — the calling session's id, when the
  // tool knows it. Never auth.
  write: (mutation: Mutation, via?: string) => Promise<MutationResult>
  find: (q: string, limit?: number) => Promise<Hit[]>
  // Land an HTML page in the frozen store for an existing web entity.
  upload: (eid: string, html: string) => Promise<void>
  // Bump recall aggregates (server-stamped — recall never rides the
  // apply wire); confirm also stamps memory.last_confirmed_at.
  touch: (eids: string[], confirm?: boolean) => Promise<void>
  // An entity's slice of the journal (db.ts journalOf in-process; GET
  // journalOf locally, /journal remotely) — newest first.
  history: (eid: string, limit?: number) => Promise<JournalEntry[]>
  // The provider table (adapters in-process; GET /providers over stdio)
  // — task_spawn's last-resort default when neither the caller nor the
  // args name one.
  providers: () => Promise<{ name: string; models: string[] }[]>
  // Explicit historical scans are local SQLite reads. The returned changes
  // still land through write(), so this capability never becomes a writer.
  backfill: (kind: BackfillKind) => Promise<Change[]>
  // The colon-command executor's graph access, keyed off the LIVE graph — a
  // scoped reader the `command` tool resolves ids and enumerations through, so
  // it never pulls the whole graph (M-21143). `overlay` carries rows the
  // command minted but hasn't applied yet (a spec-line task), the same way
  // obey/page overlay them. Only the in-process mount (a db in hand) supplies
  // it; explicitly remote stdio falls back to read().
  reader?: (overlay?: Row[]) => Reader
}

type DBReads = Required<
  Pick<
    IO,
    | 'read'
    | 'query'
    | 'get'
    | 'deps'
    | 'find'
    | 'history'
    | 'backfill'
    | 'reader'
  >
>

// The database-backed half of MCP IO, shared by the server mount and local
// stdio. This is one binding of the existing query/history implementations,
// not another graph reader. Mutations and service operations deliberately do
// not appear here.
export let dbReads = (db: DatabaseSync): DBReads => {
  let query = localQuery(db)
  return {
    read: () => Promise.resolve(snapshot(db)),
    query: (q, opts) => query(q.split('&').filter(Boolean), opts),
    reader: (overlay) => dbReader(db, overlay),
    get: (ids, filters = []) =>
      ids.length
        ? query([`id=${ids.join(',')}`, ...filters])
        : Promise.resolve([]),
    deps: (eids, reveal = false) =>
      Promise.resolve(
        depsOf(db, eids).filter((d) =>
          reveal ||
          (!eager(db, d.parent).quarantined &&
            !eager(db, d.child).quarantined)
        ),
      ),
    find: (q, limit) => Promise.resolve(dbSearch(db, q, limit)),
    history: (eid, limit) => Promise.resolve(journalOf(db, eid, limit)),
    backfill: (kind) => Promise.resolve(backfillChanges(db, kind)),
  }
}

// The teaching text lives in grammar.ts — derived from the vocabulary,
// shared with `task help grammar`, so the two doors cannot disagree.

// A session's whole entry partition, rendered through the shared graphLog
// (T-16798): read via the graph query door — evalGraph in-process, /query over
// stdio — so both transports share ONE read path, and the old /sessions/:eid/
// logs door is gone. graphLog must see every entry to resolve call↔result and
// derive busy/latest/model, so the whole partition is read; the caller pages
// the OUTPUT (pageEntries).
let entryLog = async (io: IO, eid: string): Promise<GraphLog> => {
  let hits = await io.query(`.entry.session=${eid}`, { limit: 1_000_000 })
  let rows: EntryRow[] = hits.flatMap((r) => {
    let seq = Number(r.comps.entry?.seq ?? 0)
    return seq ? [{ eid: r.eid, seq, comps: r.comps as EntryRow['comps'] }] : []
  })
  return graphLog(rows)
}

// A peek line is one entry rendered small: renderEntry (log_text.ts, the door
// the whole `transcript` shares) clips to a glance at width 200 and drops the
// rowless provider machinery a graph-native log carries — so a generation or
// empty-reasoning entry no longer dumps its raw `{"eid":…}` JSON mid-peek.
let PEEK = 200

let line = (all: Row[], r: Row) => {
  let who = claimant(all, r)
  let authoring = authoringLine(all, r)
  return `${idOf(r)}  ${String(r.comps.task?.status ?? r.kind).padEnd(7)} ${
    r.comps.doc?.title ?? ''
  }${who ? `  ⚑ ${who}` : ''}${authoring ? ` · ${authoring}` : ''}`
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
you haven't seen — especially comments on work you claim. Steering belongs on
the task, where the current or next run reads it; comments aimed at S-* remain
deprecated compatibility.`

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

// Per-tool behavior hints, keyed by tool name (T-14142). One data block so the
// whole surface is auditable at a glance — the vocabulary is one list. Queries
// are read-only; setters that converge to a value are idempotent; entity
// deleters are destructive; task_spawn launches an autonomous agent, the one
// tool whose reach is open-world. Everything absent takes the closed-world,
// mutating default in tool(). readOnlyHint marks a QUERY: the ack-cursor and
// recall bumps a read leaves behind are serve bookkeeping, not the caller's
// intent, so they don't demote a query to mutating.
let RO: ToolAnnotations = { readOnlyHint: true }
let HINTS: Record<string, ToolAnnotations> = {
  search: RO,
  usage: RO,
  task_list: RO,
  work_list: RO,
  task_context: RO,
  task_show: RO,
  session_peek: RO,
  transcript: RO,
  history: RO,
  memory_recall: RO,
  graph_query: RO,
  ui_state: RO,
  task_update: { idempotentHint: true },
  task_claim: { idempotentHint: true },
  task_release: { idempotentHint: true },
  card_move: { idempotentHint: true },
  show: { idempotentHint: true },
  graph_apply: { destructiveHint: true },
  card_close: { destructiveHint: true },
  command: { destructiveHint: true },
  backfill: { idempotentHint: true },
  task_spawn: { openWorldHint: true },
}

export let WORKER_PROTOCOL = `# Work the graph
1. Evaluate recent open work before selecting it. Inspect its context,
dependencies, approval, claim, and acceptance criteria; add missing context or
prerequisites before build work begins.
2. Build only approved, open, unblocked work. Claim exactly what you undertake,
report progress and failures on the task, verify the result, then complete and
release it.
3. Treat verification as a separate pass recorded through review; completion
alone is not verification.

When the operator explicitly tells you to claim or work queued tasks, inspect
eligible work, claim it, and execute it in this harness. Do not merely wait for
managed auto-dispatch. Subagents are optional: delegate when they are available
and useful; otherwise work the task yourself.`

export let MCP_INSTRUCTIONS =
  `Tool arguments are source data, never HTML. Pass <, >,
and & literally; the renderer escapes them for its own output type.
The graph renders bodies as markdown. ${DOC}

Use subagents when they are available and useful. A worker without subagents
works directly. When the operator explicitly tells this harness to claim or
work queued tasks, inspect eligible work, claim it, and execute it here instead
of waiting for managed auto-dispatch. After compaction or resume, use durable
task context to restore assignments.

Work with ${TASK_TREE_ADOPTION.steps}+ steps defaults to task_tree, not a checklist in one task body.
Exact dry run: ${taskTreeExample('mcp')}. Choose every relation explicitly;
never infer edge meanings from prose. Keep leaf bodies to the irreducible ask
and pointers.

On the first connection, call work_start first: pass the stable sid if you know
it, or omit session to mint one. It returns the worker protocol and initial
context. On later context refreshes, call task_context first. Pass that same
stable sid to every tool that takes a session — it names the run for
attribution, claims, and the comms bus.`

export let mcpServer = (io: IO) => {
  // The io-backed Querier: client.ts's scoped readers (checkedRefs, sessionRow,
  // contextSnapshot, bus) run through whichever transport this mount has —
  // localQuery beside the graph, the /query GET remotely — so no tool needs
  // the whole graph to resolve a handle or assemble a corpus (T-22217).
  let ioQ: Querier = (filters, opts) =>
    io.query(filters.filter(Boolean).join('&'), opts)
  // find() over the wire: the row an address names, or undefined — the same
  // four forms (T-3, num, slug, uuid), resolved by the server's locate().
  let got = async (id: string) => find(await io.get([id]), id)
  // Server instructions ride the initialize handshake and land in the
  // agent's standing context — the strongest ambient steering the
  // protocol offers. Keep it to what every writer must know.
  let server = new McpServer({ name: 'tasks', version: VERSION }, {
    instructions: MCP_INSTRUCTIONS,
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
        // Behavior hints (T-14142): the protocol defaults are pessimistic —
        // every unmarked tool reads as mutating, destructive, non-idempotent
        // and open-world, so a client confirms each call. Every tasks tool
        // works the CLOSED local graph, so openWorldHint is false by default;
        // HINTS refines the rest per tool. Hints only — apply() still enforces
        // every rule server-side (M-17876), so a wrong hint mis-styles a
        // prompt, never a permission.
        annotations: { openWorldHint: false, ...HINTS[name] },
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

  // An ordinary tool call is not an attention boundary. Agents load their
  // working set explicitly through task_context; quietly appending inbox rows
  // here made every tool response a second, drifting model of attention.
  let bus = (out: string, _session?: string, _snap?: Snapshot) => text(out)

  let workRead = {
    query: (filters: string[], opts?: QueryOpts) =>
      io.query(filters.join('&'), opts),
    get: (ids: string[]) => io.get(ids),
  }

  let workerContext = async (session: string) => {
    let [snap, pending] = await Promise.all([
      contextSnapshot(session, undefined, undefined, [], ioQ, io.deps),
      busNotices(session, undefined, ioQ),
    ])
    let digest = contextDigest(
      snap,
      session,
      Date.now(),
      undefined,
      new Set(pending.eids),
    )
    return pending.lines.length ? digest + noticeBlock(pending.lines) : digest
  }

  tool(
    'work_start',
    `Create or resume an external graph worker before it knows a session id.
With no argument, creates a durable identity and returns its human S-id plus a
stable sid. Pass that sid on reconnect to resume it; a caller-supplied stable
sid also converges to one identity under concurrent calls. Returns the portable
worker protocol and the same bounded, rooted working context as task_context.
This is the mutating bootstrap door; task_context remains read-only.`,
    {
      session: z.string().trim().min(1)
        .describe('Returned sid or a stable harness key; omit on first use.')
        .optional(),
    },
    async ({ session }: { session?: string }) => {
      let key = session ?? uuid()
      let row: Row | undefined
      try {
        row = await sessionRow(key, ioQ)
      } catch (cause) {
        return err(
          `worker bootstrap for sid ${key} could not check for an existing ` +
            `session: ${(cause as Error).message}. No session entity was ` +
            `created; retry work_start with session ${key}.`,
        )
      }
      let created = false
      if (!row) {
        let planned = sessionFor([], key, undefined, undefined, {
          source: 'mcp',
        })
        try {
          let result = await io.write(planned.changes)
          let id = mintedIn(result.changes, planned.eid)
          row = rows({ changes: result.changes })
            .find((candidate) => idOf(candidate) == id)
          created = true
        } catch (cause) {
          // Two desktops may bootstrap the same stable key together. The
          // unique session.id constraint chooses one winner; observing it is
          // success, while every other write failure remains loud and specific.
          try {
            row = await sessionRow(key, ioQ)
          } catch (recovery) {
            return err(
              `worker bootstrap for sid ${key} could not recover after its ` +
                `write failed (${(cause as Error).message}): session lookup ` +
                `also failed (${(recovery as Error).message}). The write ` +
                `outcome is unknown; retry work_start with session ${key}.`,
            )
          }
          if (!row) {
            return err(
              `worker bootstrap failed before a session was created: ${
                (cause as Error).message
              }. Retry work_start with session ${key}; no session entity was ` +
                `confirmed.`,
            )
          }
        }
      }
      if (!row) {
        return err(
          `worker bootstrap for sid ${key} failed: the session write returned ` +
            `no readable identity. Retry work_start with session ${key}.`,
        )
      }
      let id = idOf(row)
      let sid = String(row.comps.session?.id)
      try {
        let context = await workerContext(sid)
        return text(
          `session: ${id}\nsid: ${sid}\nstate: ${
            created ? 'created' : 'resumed'
          }\n\n` +
            `${WORKER_PROTOCOL}\n\n# Context\n${context}`,
        )
      } catch (cause) {
        // The HTTP MCP boundary durably records an isError tool_call and its
        // first text block. Lead with the human Session and stable sid so this
        // transient read failure remains attributable and retryable. `error`
        // is server-owned current health; an MCP read must neither forge nor
        // clear that facet.
        return err(
          `worker ${id} is durable, but its context failed to load: ${
            (cause as Error).message
          }. Its sid is ${sid}; call work_start with session ${sid} to retry.`,
        )
      }
    },
  )

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
          `${h.open != h.eid ? ` → on ${h.open_id ?? h.open}` : ''}` +
          ` — ${h.snip.replaceAll('\x01', '[').replaceAll('\x02', ']')}` +
          `${h.retired ? ' · retired' : ''}`
        ).join('\n') || '(no hits)',
      )
    },
  )

  tool(
    'usage',
    `What agent work cost and how fast it ran — a READ over the token
counts already stamped on settled sessions (no new capture). Dot-param
filters screen the sessions first (.provider=claude,
.finished_at>="1 week ago"); 'by' picks the breakdown dimension (model by
default; project rolls each session up through its task's project). A TOTAL
leads. Absent beats zero: an unreported facet reads —, never 0, and a model
with no list price adds no cost (the footer says how many sessions cost
covered). ${FILTERS}`,
    {
      filters: z.array(z.string()).optional(),
      by: z.enum(['model', 'project', 'persona', 'task', 'provider'])
        .optional(),
    },
    async (
      { filters = [], by = 'model' }: { filters?: string[]; by?: Dim },
    ) => {
      let ps = parseFilters(filters)
      if (refHandles(ps).length) await checkedRefs(ps, ioQ)
      let hits = await io.query(['.kind=session', ...filters].join('&'))
      let uses: Use[] = []
      for (let r of hits) {
        let s = sessionOf(r.comps)
        let u = s && use(s)
        if (u) uses.push(u)
      }
      let refs = await io.get([
        ...new Set(uses.flatMap((u) => [u.task, u.persona].filter(Boolean))),
      ] as string[])
      let taskRows = refs.filter((r) => r.comps.task)
      let projs = await io.get([
        ...new Set(
          taskRows.map((r) => String(r.comps.task?.project ?? '')).filter(
            Boolean,
          ),
        ),
      ])
      let taskProj = new Map(
        taskRows.map((r) => [r.eid, String(r.comps.task?.project ?? '')]),
      )
      let name = new Map([...refs, ...projs].map((r) => [r.eid, idOf(r)]))
      for (let u of uses) {
        if (u.task) u.project = taskProj.get(u.task) || undefined
      }
      return text(report(uses, by, (k) => name.get(k) ?? k))
    },
  )

  tool(
    'work_list',
    `List bounded candidate envelopes from a derived work lane. evaluate is
proposed and undecided, newest first. build is approved, open, unclaimed,
unblocked, and dependency-ready, ordered by priority then newest; recursive
also includes descendants authorized by an approved open ancestor, but never
crosses a pending proposal or declined decision. verify is completed,
acceptance-bearing work still awaiting an independent approving review, newest
completion first. Each JSON envelope carries
human ids, project/domain, decision and authorization state, blockers, and
existing repo/spawn hints; verify also carries bounded acceptance, completion,
review, and verifier-attempt evidence. blocker and authorization references are bounded;
their truncated flag says more exist. Read task_show before claiming. Optional
filters support indexed scalar equality, lists, ranges, comparisons, presence,
absence, literal contains, time phrases, and forward reference paths such as
'.task.project.doc.title~=graph'. Text terms, reverse associations, traversals,
rankings, aggregates, projections, and query windows are not work filters.`,
    {
      lane: z.enum(['evaluate', 'build', 'verify']).describe(
        'Derived lane to inspect: proposals awaiting evaluation, ready build work, or completed work awaiting verification.',
      ),
      filters: z.array(z.string()).optional(),
      limit: count.max(100).describe('Maximum candidates (default 20).')
        .optional(),
      recursive: z.boolean().describe(
        'Include inherited authorization in the build lane (default false).',
      ).optional(),
    },
    async (
      { lane, filters = [], limit, recursive }: {
        lane: WorkLane
        filters?: string[]
        limit?: number
        recursive?: boolean
      },
    ) => {
      let ps = parseFilters(filters)
      if (refHandles(ps).length) await checkedRefs(ps, ioQ)
      let candidates = await workCandidates(workRead, lane, {
        filters,
        limit,
        recursive,
      })
      return text(JSON.stringify(candidates, null, 2))
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
      let ps = parseFilters(filters)
      if (refHandles(ps).length) await checkedRefs(ps, ioQ)
      // Membership, ref resolution and hot ordering run server-side — the
      // same preds, matchQuery and kid-walks this tool ran over a
      // materialized graph now run in io.query (localQuery in-process); the
      // board order applies here over the bounded hits.
      let hits = (await io.query(['.task!', ...filters].join('&')))
        .filter((r) => r.comps.task)
      if (orderOf(ps) != 'hot') hits = hits.sort(byBoard)
      // What line() renders BESIDE each hit — the claimant session and the
      // authoring instrument (and its persona, one more hop) — fetched keyed.
      let refs = await io.get(hits.flatMap(refsIn))
      let context = uniq([
        ...hits,
        ...refs,
        ...await io.get(refs.flatMap(refsIn)),
      ])
      let why = hits.length ? '' : resolution(ps, 'task')
      return bus(
        hits.map((r) => line(context, r)).join('\n') ||
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
params?, key?, parent?, relation?}]. The single-task fields and tasks mode are exclusive. A
task's dedicated title/body/status wins over the same property in its
params; params carries every other writable property. The whole batch
lands in one atomic apply. In a structured batch, parent names another
item's key and relation names the semantic edge; project roots the plan.
For ${TASK_TREE_ADOPTION.steps}+ steps use task_tree; exact dry run: ${
      taskTreeExample('mcp')
    }.
Reference param values accept human ids
(.project=P-19). ${GRAMMAR} ${BUS}`,
    {
      title: title().optional(),
      body: body().optional(),
      status: z.enum(statuses).optional(),
      params: z.array(z.string()).optional(),
      project: z.string().optional().describe(
        'Project root for a tasks[] batch carrying parent/relation.',
      ),
      tasks: z.array(
        z.object({
          key: z.string().min(1).optional(),
          title: title(),
          body: body().optional(),
          status: z.enum(statuses).optional(),
          params: z.array(z.string()).optional(),
          parent: z.string().optional(),
          relation: z.enum(edges).optional(),
        }).strict(),
      ).min(1).optional(),
      session: z.string().optional(),
    },
    async (
      { title, body, status, params, project, tasks, session }: {
        title?: string
        body?: string
        status?: string
        params?: string[]
        project?: string
        tasks?: {
          key?: string
          title: string
          body?: string
          status?: string
          params?: string[]
          parent?: string
          relation?: (typeof edges)[number]
        }[]
        session?: string
      },
    ) => {
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
      // Default the project to the CALLER'S — the session (MCP has no cwd)
      // resolves to its persona's home or its actor-when-a-project. A task
      // with no project is orphaned: off every board and unlandable, silent
      // until a land fails (T-16496). An explicit .project= in params still
      // wins. scopeFor is undefined only when nothing places the caller — it
      // reads only the session, the persona it wears, that persona's home,
      // and the actor, so that small set stands in for the corpus.
      let sess = session ? await sessionRow(session, ioQ) : undefined
      let kin = await io.get(
        [
          String(sess?.comps.session?.persona ?? ''),
          String(sess?.comps.session?.actor ?? ''),
        ].filter(Boolean),
      )
      let worn = kin.find((r) => r.eid == sess?.comps.session?.persona)
      let home = String(worn?.comps.persona?.home ?? '')
      let scope = scopeFor(
        uniq([
          ...(sess ? [sess] : []),
          ...kin,
          ...(home ? await io.get([home]) : []),
        ]),
        sess,
      )
      let structured = want.some((t) => t.parent || t.relation)
      if (structured) {
        let root = project ?? scope
        if (!root) {
          return err('a structured tasks[] batch needs project or caller scope')
        }
        try {
          let plan = await taskTreePlan({
            project: root,
            nodes: want.map((t, i) => ({
              key: t.key ?? String(i + 1),
              title: t.title,
              body: t.body,
              status: t.status,
              params: t.params,
              parent: t.parent,
              relation: t.relation,
            })),
          }, ioQ)
          let applied = await io.write(plan.changes, session)
          return bus(taskTreeText(plan, applied.changes), session)
        } catch (e) {
          return err((e as Error).message)
        }
      }
      let minted: string[] = []
      let changes: Change[] = []
      let written: { title: string; body: string }[] = []
      for (let t of want) {
        let ps = parseAll(t.params ?? [])
        if (
          project && !ps.some((p) => p.comp == 'task' && p.prop == 'project')
        ) {
          ps.push(param(`.project=${project}`)!)
        }
        let grouped = patches(await derefedParams(ps, ioQ))
        grouped.doc = {
          ...grouped.doc,
          title: t.title,
          ...(t.body != null ? { body: t.body } : {}),
        }
        // Status is derived (D-24102): taskChanges strips the virtual column,
        // so preserve authored terminal states as marks. A new `wip` task can
        // only be wip when this request names the session holding its claim.
        if (t.status == 'done') grouped.completed = {}
        else if (t.status == 'cancelled') grouped.cancelled = {}
        else if (t.status == 'wip') {
          if (!sess) {
            return err('status wip requires a session to hold the claim')
          }
          grouped.claim = { session: sess.eid }
        }
        if (!grouped.task?.project && scope) {
          grouped.task = { ...grouped.task, project: scope }
        }
        written.push({
          title: String(grouped.doc.title ?? ''),
          body: String(grouped.doc.body ?? ''),
        })
        let eid = crypto.randomUUID()
        minted.push(eid)
        changes.push(...taskChanges(eid, grouped))
      }
      await io.write(changes, session)
      let after = await io.get(minted)
      let ids = minted.map((eid) => {
        let made = after.find((r) => r.eid == eid)
        return made ? idOf(made) : eid
      })
      // A single create earns the dupe check; a batch is a deliberate
      // plan, not a probe — hinting on each would drown the reply.
      let dupe = want.length == 1
        ? await similarHint(
          `${written[0].title}\n${written[0].body}`,
          minted[0],
        )
        : ''
      return bus(
        `created ${ids.join(', ')}${dupe ? `\n${dupe}` : ''}${
          want.length == 1
            ? `\n${taskTreeWarning(written[0].body, 0, 'mcp')}`.trimEnd()
            : ''
        }${wall(written.find((t) => wall(t.body))?.body)}`,
        session,
      )
    },
  )

  tool(
    'task_tree',
    `Create a project-rooted task tree as one atomic apply. Nodes have unique
local keys and either title/body/status/params for a new task, or id for an
existing entity. parent names another local key; relation is the semantic edge
from parent to child. Root nodes default to project wants. dry_run validates,
resolves references, proves rootedness, and renders the plan without writing.
No structure is inferred from prose. ${GRAMMAR} ${BUS}`,
    {
      project: z.string().describe('Project id or handle that roots the tree.'),
      nodes: z.array(
        z.object({
          key: z.string().min(1).describe('Unique local key within this plan.'),
          id: z.string().optional().describe(
            'Existing entity; exclusive with authoring fields.',
          ),
          title: title().optional(),
          body: body().optional(),
          status: z.enum(statuses).optional(),
          params: z.array(z.string()).optional(),
          parent: z.string().optional().describe(
            "Local key of this node's parent.",
          ),
          relation: z.enum(edges).optional().describe(
            'Semantic edge from parent to this node.',
          ),
        }).strict(),
      ).min(1),
      dry_run: z.boolean().optional(),
      session: z.string().optional(),
    },
    async ({ project, nodes, dry_run, session }) => {
      try {
        let plan = await taskTreePlan({ project, nodes }, ioQ)
        if (dry_run) return text(`dry run\n${taskTreeText(plan)}`)
        let applied = await io.write(plan.changes, session)
        return bus(taskTreeText(plan, applied.changes), session)
      } catch (e) {
        return err((e as Error).message)
      }
    },
  )

  tool(
    'task_update',
    `Patch an entity by id (T-3, bare num, or eid) with dot-params, e.g.
[".status=done"] or [".body=notes..."]. Only the named props change.
comment optionally lands a plain comment in the same atomic batch.
Reference values accept human ids. Cancelling (".status=cancelled") calls off
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
      let row = await got(id)
      if (!row) return err(`no entity: ${id}`)
      let grouped = patches(await derefedParams(parseAll(params), ioQ))
      // The comment builder resolves its author (the session row) and the
      // task's project (the row itself) — hand it exactly those.
      let sess = comment && session ? await sessionRow(session, ioQ) : undefined
      await io.write([
        ...Object.entries(grouped)
          .map(([name, comp]) => ({ eid: row.eid, name, comp })),
        ...(comment
          ? commentChanges(
            uniq([row, ...(sess ? [sess] : [])]),
            row.eid,
            comment,
            session,
          )
          : []),
      ], session)
      let hint = patchHint(
        Object.entries(grouped).map(([name, comp]) => ({
          eid: row.eid,
          name,
          comp,
        })),
        () => idOf(row),
      )
      return bus(
        `updated ${idOf(row)}${wall(grouped.doc?.body)}${hint}`,
        session,
      )
    },
  )

  tool(
    'task_context',
    `Your bounded working set: tasks claimed by your session (with rooted
project paths, inherited decisions and memories, unresolved prerequisites,
and supersession corrections), or the top of the open board if you hold
nothing. It also surfaces direct comments, claimed-task
replies, knocks, and verified
operator mail as explicitly UNTRUSTED data. Call this FIRST each session,
with the same stable session identifier you claim with.`,
    { session: z.string() },
    async ({ session }: { session: string }) => {
      // The digest corpus and the pending bus, assembled from the same
      // bounded keyed reads the CLI's `task context` runs (contextSnapshot /
      // bus) — through io, so the in-process mount reads the live db and
      // stdio the /query door. notices() sorts identically on both paths
      // (T-15463), so the served lines match the whole-snapshot read.
      return text(await workerContext(session))
    },
  )

  tool(
    'task_claim',
    `Atomically claim ready, approved work for your session. Readiness is the
same predicate as work_list lane=build: open, unblocked, dependency-ready,
not quarantined, and directly or recursively approved. Pass a STABLE
identifier for yourself and reuse it for the whole session. Set approve only
when you evaluated the task and are also its best builder; approval and claim
then land together, but an explicit decline is never reversed. Raw graph_apply
remains the administrative claim door. task_release drops the lease when you
finish or hand off.`,
    {
      id: z.string(),
      session: z.string(),
      approve: z.boolean().describe(
        'Approve an undecided task and claim it atomically (default false).',
      ).optional(),
    },
    async (
      { id, session, approve }: {
        id: string
        session: string
        approve?: boolean
      },
    ) => {
      // Target/session resolution and readiness are deliberately not checked
      // here; the writer owns all three under its lock.
      try {
        await io.write(
          workClaimMutation(
            id,
            session,
            { approve },
          ),
          session,
        )
      } catch (e) {
        return {
          ...await bus(`claim failed: ${(e as Error).message}`, session),
          isError: true as const,
        }
      }
      let row = await got(id)
      if (!row) return err(`claim landed but no entity can be read: ${id}`)
      return bus(`claimed ${idOf(row)} for ${session}`, session)
    },
  )

  tool(
    'task_release',
    `Drop the claim on a task (yours or a stale one), freeing it for
other sessions. ${BUS}`,
    { id: z.string(), session: z.string().optional() },
    async ({ id, session }: { id: string; session?: string }) => {
      let row = await got(id)
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
session_peek checks on it; task_comment on the TASK says more to its current
or next run. When the run settles, the server comments the outcome on its task
and the spawning run's work, never on the run itself. provider/model
default to YOUR session's own (pass the same session id you claim with),
then the shared anonymous default. persona names the persona entity
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
      // The scoped spawn corpus (spawnCorpus's shape, assembled through io so
      // both transports read keyed): the task, the caller's session, and —
      // once the plan settles which persona rides — that persona and its
      // ownership endpoints, with the edges touching it.
      let [task, sess] = await Promise.all([
        got(id),
        session ? sessionRow(session, ioQ) : undefined,
      ])
      let base = uniq([
        ...(task ? [task] : []),
        ...(sess ? [sess] : []),
      ])
      // One precedence for every door: explicit args > the task's spawn hint
      // > the CALLER's own spec (its session row) > the provider-table default.
      let plan = spawnPlan(base, await io.providers(), {
        task: id,
        session,
        ask: { provider, model, effort, persona },
      })
      if (!plan.provider || !plan.model) {
        return err('no provider to default to')
      }
      // Pre-flight the allowlist here, at the tool boundary: a bad model is
      // a clear error to the caller, not a doomed husk on the board (the
      // raw wire still husks — that contract is the created(session)
      // effect's, for graph_apply).
      let bad = trouble({
        provider: plan.provider,
        model: plan.model,
        effort: plan.effort,
      })
      if (bad) return err(bad)
      let worn = plan.persona ? await got(plan.persona) : undefined
      let deps = worn ? await io.deps([worn.eid]) : []
      let ends = await io.get(deps.flatMap((d) => [d.parent, d.child]))
      let made
      try {
        made = spawnChanges(uniq([...base, ...(worn ? [worn] : []), ...ends]), {
          task: id,
          provider: plan.provider,
          model: plan.model,
          effort: plan.effort,
          persona: plan.persona,
          by: session,
          deps,
        }, await serverCaps())
      } catch (e) {
        return err((e as Error).message)
      }
      await io.write(made.changes, session)
      let after = (await io.get([made.eid]))[0]
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
        .map(([n, c]) => `  :${`${n} ${slotsOf(c.args)}`.trim()} — ${c.about}`)
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
      // The scoped reader when the mount owns a db (the fleet's /mcp) — the
      // executor resolves ids and enumerations on demand, no whole-graph read
      // (M-21143). Only explicitly remote stdio falls back to the HTTP graph.
      let g = io.reader?.()
      let all = g ? [] : rows(await io.read())
      let byId = (id: string) => g ? g.find(id) : find(all, id)
      let byEid = (e: string) => g ? g.find(e) : all.find((r) => r.eid == e)
      let eid: string | undefined
      if (on) {
        let r = byId(on)
        if (!r) return err(`no entity: ${on}`)
        eid = r.eid
      } else eid = g ? focusFor(g, session) : focusOf(all, session)
      let out
      try {
        out = commandOut(all, line, eid, session, g)
      } catch (e) {
        return err((e as Error).message)
      }
      if (out.changes?.length) await io.write(out.changes, session)
      if (out.mutation) await io.write(out.mutation, session)
      let said = out.msg ? [out.msg] : []
      if (line.replace(/^:/, '').trim().split(/\s/)[0] == 'wake') {
        let to = String(
          out.changes?.find((c) => c.name == 'deliver')?.comp?.to ?? '',
        )
        let wakes = await io.query(
          `.wake! .deliver.to=${to} .delivered= .error=`,
        )
        let recipient = byEid(to) ?? {
          eid: to,
          kind: 'entity',
          num: 0,
          comps: {},
        }
        said.push(wakeList(wakes, recipient, (id) => byEid(id)))
      }
      if (out.spawn) {
        let want = spawnSpec(out.spawn)
        // A spawn on defaults — the line's own changes landed above, so the
        // scoped corpus (spawnCorpus's shape: task, caller, persona +
        // ownership) reads back keyed through io on BOTH transports.
        // One precedence: the line's own spec > the task hint > the caller >
        // table.
        let [onto, sess] = await Promise.all([
          want.task ? got(want.task) : undefined,
          session ? sessionRow(session, ioQ) : undefined,
        ])
        let base = uniq([
          ...(onto ? [onto] : []),
          ...(sess ? [sess] : []),
        ])
        let plan = spawnPlan(base, await io.providers(), {
          task: want.task,
          session,
          ask: {
            provider: want.provider,
            model: want.model,
            effort: want.effort,
            persona: want.persona,
          },
        })
        if (!plan.provider || !plan.model) {
          return err('no provider to default to')
        }
        let worn = plan.persona ? await got(plan.persona) : undefined
        let deps = worn ? await io.deps([worn.eid]) : []
        let ends = await io.get(deps.flatMap((d) => [d.parent, d.child]))
        let made = spawnChanges(
          uniq([...base, ...(worn ? [worn] : []), ...ends]),
          {
            ...want,
            provider: plan.provider,
            model: plan.model,
            effort: plan.effort,
            persona: plan.persona,
            by: session,
            deps,
          },
          await serverCaps(),
        )
        await io.write(made.changes, session)
        // The just-minted session's id, read back after the write lands.
        let landed = (await io.get([made.eid]))[0]
        said.push(
          `spawned ${landed ? idOf(landed) : made.eid}${
            onto ? ` onto ${idOf(onto)}` : ' as chat'
          }`,
        )
      }
      if (out.go) {
        let r = byEid(out.go)
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
      let row = await got(id)
      if (!row?.comps.session) return err(`no session: ${id}`)
      let s = row.comps.session
      // The whole partition is read (entryLog); the glance pages the OUTPUT to
      // the last `tail` rendered rows for itself, rather than dropping a
      // transcript into an agent's context. stderr rides beside the log as the
      // session's own graph facet now (T-16798), not a file side-channel.
      let log = await entryLog(io, row.eid)
      let out = pageEntries(log.entries, {
        tail: Math.min(Math.max(tail ?? 20, 1), 500),
      })
      let status = log.busy ? 'running' : s.status ?? 'idle'
      let head = [
        `${idOf(row)} ${status}`,
        `${s.provider ?? '?'} ${log.model ?? s.serving_model ?? s.model ?? ''}`
          .trim(),
        `seq ${log.latest || s.latest_seq || 0}`,
        ...(s.started_at ? [`started ${s.started_at}`] : []),
        ...(s.finished_at ? [`finished ${s.finished_at}`] : []),
        ...(s.exit_code == null ? [] : [`exit ${s.exit_code}`]),
        ...(row.comps.error?.message
          ? [`error: ${String(row.comps.error.message).slice(0, 200)}`]
          : []),
      ].join(' · ')
      let lines = out.flatMap((e) => {
        let l = renderEntry(e, PEEK)
        return l == null ? [] : [l]
      })
      let stderr = s.stderr ? String(s.stderr) : ''
      return bus(
        [head, ...lines, ...(stderr ? [`stderr:\n${stderr}`] : [])]
          .join('\n'),
        session,
      )
    },
  )

  tool(
    'transcript',
    `The WHOLE session (S-12) as a clean, ordered transcript — what was
said and thought, every command and its result, turn boundaries — with
no raw-JSON noise. session_peek is a tail; this is the dump you want
first when debugging a session. Pages by after (an entry-seq cursor) +
limit; filter to prose (say + reason) with prose, a seq range (\`40..80\`),
or a created-at window (since/until, ISO). ${BUS}`,
    {
      id: z.string(),
      after: z.number().int().nonnegative().optional(),
      limit: count.optional(),
      prose: z.boolean().optional(),
      seq: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      session: z.string().optional(),
    },
    async (
      { id, after, limit, prose, seq, since, until, session }: {
        id: string
        after?: number
        limit?: number
        prose?: boolean
        seq?: string
        since?: string
        until?: string
        session?: string
      },
    ) => {
      let row = await got(id)
      if (!row?.comps.session) return err(`no session: ${id}`)
      let s = row.comps.session
      // A default page bounds what lands in an agent's context; a filled page
      // hints the next cursor. The whole partition is read either way (the
      // renderer needs it to resolve calls) — the page bounds the OUTPUT.
      let page = Math.min(Math.max(limit ?? 400, 1), 5000)
      let log = await entryLog(io, row.eid)
      let out = pageEntries(log.entries, { after, limit: page })
      let sift: Sift = {
        ...(prose ? { prose: true } : {}),
        ...(seq ? seqRange(seq) : {}),
        ...(since ? { since } : {}),
        ...(until ? { until } : {}),
      }
      let lines = transcribe(out, sift)
      let last = out.at(-1)?.seq ?? 0
      let more = out.length >= page && last < (log.latest ?? last)
      let head = [
        `${idOf(row)} ${log.busy ? 'running' : s.status ?? 'idle'}`,
        `${s.provider ?? '?'} ${log.model ?? s.serving_model ?? s.model ?? ''}`
          .trim(),
        `seq ${log.latest || s.latest_seq || 0}`,
      ].join(' · ')
      let foot = more
        ? `… more — transcript id=${idOf(row)} after=${last}`
        : undefined
      return bus(
        [head, ...lines, ...(foot ? [foot] : [])].join('\n'),
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
      let row = await got(id)
      if (!row) return err(`no entity: ${id}`)
      let entries = await io.history(row.eid, limit)
      if (!entries.length) return bus(`${idOf(row)}: no history`, session)
      return bus(entries.map(historyLine).join('\n'), session)
    },
  )

  tool(
    'undo',
    `Reverse a journaled batch — the graph's guarded undo. id names either a
journal batch (a #id from history, e.g. 123) or an ENTITY (T-5, whose
LATEST batch is reversed). The inverse restores exactly what the batch
changed, but is REFUSED loudly if a guarded column moved since, or if the
batch deleted an entity (a tombstone is permanent) — refusing beats
clobbering a write you never saw. The undo is itself journaled, so undoing
it is a redo. ${BUS}`,
    {
      id: z.string(),
      session: z.string().optional(),
    },
    async ({ id, session }: { id: string; session?: string }) => {
      let m = id.match(/^#?(\d+)$/)
      let ref: { id?: number; eid?: string }
      if (m) ref = { id: Number(m[1]) }
      else {
        let row = await got(id)
        if (!row) return err(`no entity: ${id}`)
        ref = { eid: row.eid }
      }
      let out = await io.write({ mutation: 'undo', ...ref }, session)
      let noise = new Set(['created', 'updated', 'resume', 'imported'])
      let what = out.changes.filter((c) => !noise.has(c.name)).map((c) =>
        c.comp == null
          ? c.name == 'entity' ? '†' : `-${c.name}`
          : `${c.name}{${
            Object.keys(c.comp).filter((k) => k != 'eid').join(' ')
          }}`
      ).join(' · ')
      return bus(
        `undid ${m ? `#${m[1]}` : id}${what ? ` · ${what}` : ''}`,
        session,
      )
    },
  )

  tool(
    'backfill',
    `Run an explicit historical materialization from the co-located SQLite
graph. The scan is read-only; generated dependency changes are submitted in
bounded batches through the ordinary graph write boundary, so validation,
effects, attribution, and live delivery stay identical to graph_apply. Each
kind is idempotent: rerunning it finds only work not already landed.`,
    {
      kind: z.enum(backfillKinds),
      session: z.string().optional(),
    },
    async (
      { kind, session }: { kind: BackfillKind; session?: string },
    ) => {
      let pending = await io.backfill(kind)
      let out = await landBackfill(
        pending,
        async (batch) => (await io.write(batch, session)).changes,
      )
      return bus(
        `${kind}: ${out.landed}/${out.found} historical edges landed`,
        session,
      )
    },
  )

  tool(
    'task_comment',
    `Comment on ANY entity (tasks, boards, docs, frozen pages — anything
with an id). An optional verdict makes it a review; its body is the
rationale and may be empty for a bare verdict. Pass the same stable
session identifier you claim with, for attribution.

Steer agents by commenting on the task or tree root. A comment aimed at
an S-* run still works during migration, but that address is deprecated.

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
      let row = await got(id)
      if (!row) return err(`no entity: ${id}`)
      let words = body ?? ''
      // The builder resolves its author (the session row) and the target's
      // project (the row itself) — hand it exactly those.
      let sess = await sessionRow(session, ioQ)
      let made = commentChanges(
        uniq([row, ...(sess ? [sess] : [])]),
        row.eid,
        words,
        session,
        { verdict },
      )
      await io.write(made, session)
      // The writer's handle on what it just wrote — without it, fixing a
      // wrong comment means writing another one.
      let mine = made.find((c) => c.name == 'comment')?.eid
      let after = mine ? (await io.get([mine]))[0] : undefined
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
      if (id) {
        let row = await got(id)
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
          let project = await got(scope)
          if (!project?.comps.project) return err(`no project: ${scope}`)
          patch.push({
            eid: row.eid,
            name: 'memory',
            comp: { scope: project.eid },
          })
        }
        if (feedback != null) {
          // The builder resolves WHO gave it — hand it exactly that row.
          let who = feedback ? await got(feedback) : undefined
          try {
            patch.push(feedbackChange(who ? [who] : [], row.eid, feedback))
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
        // The builder resolves the scope project, the author session, and the
        // feedback giver — hand it exactly those rows.
        let [sess, scopeRow, who] = await Promise.all([
          sessionRow(session, ioQ),
          scope ? got(scope) : undefined,
          feedback ? got(feedback) : undefined,
        ])
        made = memoryChanges(
          uniq(
            [sess, scopeRow, who].filter((r): r is Row => !!r),
          ),
          {
            title,
            body,
            scope,
            feedback,
            decided,
            session,
          },
        )
      } catch (e) {
        return err((e as Error).message)
      }
      await io.write(made.changes, session)
      let after = (await io.get([made.eid]))[0]
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
('.scope=P-19', '.feedback.by=jeff', '.count>=3',
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
      if (
        ids &&
        [query, feedback, limit].some((value) => value != null)
      ) {
        return err('ids cannot be combined with query, feedback, or limit')
      }
      if (ids) {
        let named = await io.get(ids)
        let hits: Row[] = []
        for (let id of ids) {
          let row = find(named, id)
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
      try {
        parseQuery(query ?? '')
      } catch (e) {
        return err((e as Error).message)
      }
      // A tag comp has no column, so it screens HERE rather than through the
      // pred grammar — the same way the inbox reads `archived`. Its `by` is a
      // column and does filter: '.feedback.by=jeff'. Text belongs to SQLite's
      // FTS index, so the generic query screens the pool before recallIndex
      // performs only its warm ordering and formatting.
      let pool = await io.query(
        [
          '.memory!',
          ...(feedback ? ['.feedback!'] : []),
          ...(query?.trim() ? [query] : []),
        ].join('&'),
      )
      let lines = recallIndex(pool, [], Date.now(), limit ?? 20)
      return bus(lines.join('\n') || '(no memories)', session)
    },
  )

  // ---- the generic graph surface: the UI is data, so this IS UI control ----

  tool(
    'graph_query',
    `The WHOLE graph, not just tasks: every entity as {kind,
entity:{eid,num}, ...components}, dot-param filtered. Tasks and docs also carry
created/proposed/decided stamps whose via value describes the instrument's
model, effort, and persona.
Cards, pins
(positions), cameras (what each
client is looking at), sessions, comments — all live here. A query is a
LIST door: long text values (persona bodies, mail, final_text) are cut
at ${CUT} chars with a marker naming the rest — task_show reads one
entity whole; full: true returns every byte. .kind= screens on the
entity's derived display kind (.kind=project, .kind=comment) — a filter
like any other, composed in the one grammar (.kind=memory .project=P-19).
Session-log ENTRIES are a lazy partition, omitted from an unscoped query;
name it to read it — .entry.session=S-31 (or .generation.provider=…,
.response.status>=400) returns those entries in seq order, paged by
after/limit (default 500). An empty result means the requested scope is
empty. ${GRAMMAR} ${FILTERS}`,
    {
      query: z.string().optional(),
      filters: z.array(z.string()).optional(),
      full: z.boolean().optional(),
      after: z.number()
        .describe('Entry-partition paging: return entries after this seq.')
        .optional(),
      limit: z.number()
        .describe('Max rows; the entry-partition page size (default 500).')
        .optional(),
    },
    async (
      { query, filters = [], full, after, limit }: {
        query?: string
        filters?: string[]
        full?: boolean
        after?: number
        limit?: number
      },
    ) => {
      if (query != null && filters.length) {
        return err('query cannot be combined with filters')
      }
      // The routed preds — for the no-rows diagnostic, and to refuse a filter
      // that names a reference HANDLE resolving to nothing (`.project=bindry`),
      // which would otherwise read as "no matches". Only a non-uuid handle needs
      // the graph to validate it, so a `.entry.session=<uuid>` stays off it.
      let ps = query != null ? parseQuery(query) : parseFilters(filters)
      if (refHandles(ps).length) await checkedRefs(ps, ioQ)
      // The authoritative matching happens in io.query (evalGraph locally,
      // /query remotely), including the lazy entry partition — not the
      // snapshot()-only slice this tool used to screen.
      let q = query != null ? query : filters.join('&')
      let hits = await io.query(q, { after, limit })
      let authored = hits.filter((r) => r.comps.task || r.comps.doc)
      let refs = await io.get(
        authored.flatMap((r) => [
          String(r.comps.created?.by ?? ''),
          String(r.comps.created?.via ?? ''),
          String(r.comps.updated?.by ?? ''),
          String(r.comps.updated?.via ?? ''),
          String(r.comps.proposed?.by ?? ''),
          String(r.comps.proposed?.via ?? ''),
          String(r.comps.decided?.by ?? ''),
          String(r.comps.decided?.via ?? ''),
        ]).filter(Boolean),
      )
      let context = [...refs, ...await io.get(refs.flatMap(refsIn))]
      let out = JSON.stringify(
        hits.map((r) =>
          jsonAuthored(
            context,
            r,
            full ? r.comps : elide(r),
          )
        ),
        null,
        2,
      )
      // An empty array is where a mis-routed filter reads as absence, so
      // the routing rides along — as its OWN content block, leaving the
      // first block byte-identical JSON for anyone who parses it.
      let why = hits.length ? '' : resolution(ps)
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

  let componentLiterals: Record<string, z.ZodTypeAny> = {}
  let guardedLiterals: Record<string, z.ZodTypeAny> = {}
  for (let name of Object.keys(comps)) {
    componentLiterals[name] = z.record(z.unknown()).nullable().optional()
    guardedLiterals[name] = z.record(z.string().nullable()).optional()
  }
  let dependencyLiterals: Record<string, z.ZodTypeAny> = {}
  let literalRef = z.union([
    z.string(),
    z.number(),
    z.record(z.unknown()).describe(
      'Nested entity literal with the same key/id/comps/deps/was shape.',
    ),
  ])
  for (let type of edges) {
    dependencyLiterals[type] = z.union([literalRef, z.array(literalRef)])
      .optional()
  }
  let entityLiteral = z.object({
    key: z.string().optional(),
    id: z.string().optional(),
    comps: z.object(componentLiterals).strict().optional(),
    deps: z.object(dependencyLiterals).strict().optional(),
    was: z.object(guardedLiterals).strict().optional(),
  }).strict()

  tool(
    'graph_apply',
    `Raw wire access: apply a flat change batch OR nested entity literals
atomically (exactly one of changes/entities). A change is
{eid, name, comp} — comp is a PATCH (omitted columns untouched), comp:
null deletes the component, {name:'entity', comp:null} deletes the
entity. Mint uuids for new entities. eid and reference comp values accept
human ids (T-3, P-19) for EXISTING entities. Edges: name 'dependency',
comp {type: ${edges.join('|')}, child} links eid→child; add gone:
true to unlink (a triple has no row key, so the comp names the whole
edge). Unknown component names are forward-compatible no-ops. Optional
was is a PRECONDITION — the graph's --ff-only: a map of column → the
SHA-256 of the value you read (or null for "I read no value"), and
apply() refuses the WHOLE batch if any named column has moved since. It
rides beside comp (never inside it), per column, so a stale guarded write
is rejected while the newer value is preserved. Same allowlist and
claim-lease rules as every other client; writes broadcast live to all
screens. The result reports submitted intent and the authoritative
effective batch returned by apply(), plus request-local alias mappings for
nested literals. A nested entity has optional key/id, generated comps, and
generated deps whose values name, number, or nest another entity.

${EDIT_OP}

${GRAMMAR}`,
    {
      changes: z.array(
        z.object({
          eid: z.string(),
          name: z.string(),
          comp: z.record(z.unknown()).nullable(),
          // The optimistic-concurrency guard, beside comp because `admitted`
          // refuses alien keys INSIDE it. Per column: SHA-256 of the value
          // read, or null for "absent". Omit it and the write is unguarded,
          // which is every caller's behavior today.
          was: z.record(z.string().nullable()).optional(),
        }).strict(),
      ).min(1).optional(),
      entities: z.array(entityLiteral).min(1).optional(),
      session: z.string().optional(),
    },
    async (
      { changes, entities, session }: {
        changes?: Change[]
        entities?: EntityLiteral[]
        session?: string
      },
    ) => {
      if ((changes == null) == (entities == null)) {
        return err('apply needs exactly one of changes or entities')
      }
      let result: MutationResult
      try {
        result = await io.write(
          changes ?? { entities: entities! },
          session,
        )
      } catch (e) {
        return err(`apply failed: ${(e as Error).message}`)
      }
      // The hint reads the SUBMITTED flat changes, not the effective batch: a
      // `$edit` op there is an object (no hint), while a large full-value body
      // literal earns the nudge. The effective batch has already expanded any
      // op into a literal, which would fire falsely.
      let hint = changes ? patchHint(changes) : ''
      return text(
        JSON.stringify(
          {
            submitted: (changes ?? entities!).length,
            effective: result.changes.length,
            changes: result.changes,
            ...(entities ? { aliases: result.aliases } : {}),
          },
          null,
          2,
        ) + hint,
      )
    },
  )

  tool(
    'graph_patch',
    `Surgical multi-prop edit in Codex's V4A patch format — the same
'*** Begin Patch' / '@@' / '±' shape apply_patch uses for files, but each
section addresses a PROP (<entity>.<comp>.<column>) instead of a file
path. Multiple '*** Update Prop:' sections in one call, the way file
apply_patch spans files. Each hunk's ' '/'-'/'+' lines reconstruct a
contiguous replacement (context anchors the match). Use this to change
PART of a large value instead of rewriting the whole thing via
task_update '.body=' (a transcription risk that also clobbers a
concurrent edit). The write is guarded by the values read here, so a
value that moved since is refused with a fresh read — retry. Entities
resolve by human id / alias / uuid. Example:
\`\`\`
*** Begin Patch
*** Update Prop: T-123.doc.body
@@
-the old paragraph
+the new paragraph
*** End Patch
\`\`\`
${BUS}`,
    {
      patch: z.string().describe(
        "A V4A patch whose sections address props. '*** Begin Patch' … " +
          "'*** Update Prop: <entity>.<comp>.<column>' … '@@' … '*** End Patch'.",
      ),
      session: z.string().optional(),
    },
    async ({ patch, session }: { patch: string; session?: string }) => {
      let sections
      try {
        sections = parsePropPatch(patch)
      } catch (e) {
        return err((e as Error).message)
      }
      // Combine every section aimed at one address into a single guarded
      // patch — two @@ blocks on the same column apply in sequence, not as
      // two colliding Changes on one eid.
      let byAddress = new Map<string, typeof sections[number]>()
      for (let s of sections) {
        let prior = byAddress.get(s.address)
        if (prior) prior.hunks = [...prior.hunks, ...s.hunks]
        else byAddress.set(s.address, { ...s, hunks: [...s.hunks] })
      }
      let batch: Change[] = []
      let named: string[] = []
      try {
        for (let s of byAddress.values()) {
          let row = await got(s.entity)
          if (!row) throw new Error(`graph_patch: no entity: ${s.entity}`)
          batch.push(editChange(row, s.comp, s.column, s.hunks))
          named.push(`${idOf(row)}.${s.comp}.${s.column}`)
        }
      } catch (e) {
        return err((e as Error).message)
      }
      try {
        await io.write(batch, session)
      } catch (e) {
        // A stale refusal carries the current value and a fresh token (db.ts
        // Stale) — read it back and re-issue the hunk.
        return err((e as Error).message)
      }
      return bus(`patched ${named.join(', ')}`, session)
    },
  )

  tool(
    'ui_state',
    `What's on screen right now: every client's cursor (WHERE it is
looking — its fullscreened entity + view, navigation as data), every
client's camera (viewport rect in plane coords), and every pinned card
(position, size, view, target), with which viewports can see it. Card
heights of 0 are auto — treated as ~240px for visibility. Move a
client's cursor — navigate its open tab — with the show tool.`,
    {},
    async () => {
      // The chrome enumerations, keyed (WS_SETS' shape): cursors, cameras and
      // pinned cards, then one bounded fetch for what they point at — each
      // client row (its user_agent) and each target (its title).
      let [curRows, camRows, cardRows] = await Promise.all([
        io.query('.cursor!'),
        io.query('.camera!'),
        io.query('.card!'),
      ])
      let want = new Set<string>()
      for (let r of curRows) {
        let c = r.comps.cursor as Record<string, string>
        if (c.client) want.add(String(c.client))
        if (c.target) want.add(String(c.target))
      }
      for (let r of camRows) {
        let c = r.comps.camera as Record<string, unknown>
        if (c.client) want.add(String(c.client))
      }
      for (let r of cardRows) {
        let c = r.comps.card as Record<string, string>
        if (c.target) want.add(String(c.target))
      }
      let named = await io.get([...want])
      let all = uniq([...curRows, ...camRows, ...cardRows, ...named])
      let byEid = new Map(all.map((r) => [r.eid, r]))
      let title = (eid: string) => {
        let t = byEid.get(eid)
        return t ? `${idOf(t)} ${t.comps.doc?.title ?? t.kind}` : eid
      }
      let cursors = all.filter((r) => r.comps.cursor).map((r) => {
        let c = r.comps.cursor as Record<string, string>
        return {
          cursor: idOf(r),
          client: String(c.client),
          // WHO this cursor is: the client's browser, and when it last moved
          // — a live human reads recent, a ghost stale.
          agent: String(
            byEid.get(String(c.client))?.comps.client?.user_agent ?? '?',
          ),
          moved_at: r.comps.updated?.at ?? r.comps.created?.at ?? null,
          looking_at: c.target ? title(String(c.target)) : null,
          view: c.view ?? null,
        }
      })
      let cams = all.filter((r) => r.comps.camera).map((r) => {
        let c = r.comps.camera as Record<string, number>
        let hw = (Number(c.w) || 0) / 2 / (Number(c.zoom) || 1)
        let hh = (Number(c.h) || 0) / 2 / (Number(c.zoom) || 1)
        return {
          camera: idOf(r),
          client: String(c.client),
          // WHO this viewport is: the client's browser, and when the
          // camera last moved — a live human reads recent, a ghost stale.
          agent: String(
            byEid.get(String(c.client))?.comps.client?.user_agent ?? '?',
          ),
          moved_at: r.comps.updated?.at ?? r.comps.created?.at ?? null,
          canvas: String(c.canvas),
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
            String(p.canvas) == v.canvas &&
            p.x < v.viewport.x1 && p.x + Number(p.w) > v.viewport.x0 &&
            p.y < v.viewport.y1 && Number(p.y) + h > v.viewport.y0
          )
          .map((v) => v.camera)
        return {
          card: idOf(r),
          moved_at: r.comps.updated?.at ?? r.comps.created?.at ?? null,
          eid: r.eid,
          target: title(c.target),
          view: c.view,
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
          z: p.z,
          visible_in: seen,
        }
      })
      return text(JSON.stringify({ cursors, cameras: cams, cards }, null, 2))
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
      let row = await got(target)
      if (!row) return err(`no entity: ${target}`)
      // The oldest canvas is the root — the same first-canvas the whole-graph
      // read yielded, now one keyed enumeration (hits come back num-ascending).
      let canvas = (await io.query('.canvas!'))
        .find((r) => r.kind == 'canvas')
      if (!canvas) return err('no canvas')
      if (x == null || y == null) {
        // The LIVELIEST viewport, not the newest-minted: a camera moves
        // whenever its human pans, so updated.at names who's looking.
        let cam = (await io.query(`.camera.canvas=${canvas.eid}`))
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
        ...(await io.query('.pin!')).map((r) => Number(r.comps.pin?.z) || 0),
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
            target: row.eid,
            view: view ?? views[row.kind] ?? 'JSON',
          },
        },
        {
          eid,
          name: 'pin',
          comp: { canvas: canvas.eid, x, y, w: 0, h: 0, z }, // w 0 = auto
        },
      ])
      let made = (await io.get([eid]))[0]
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
      let row = await got(id)
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
      let row = await got(id)
      if (!row?.comps.card) return err(`no card: ${id}`)
      await io.write([{ eid: row.eid, name: 'entity', comp: null }])
      return text(`closed ${idOf(row)}`)
    },
  )

  tool(
    'show',
    `Show an entity to a client — MOVE their open tab there, navigation as
data (T-12788). The graph carries where each client is looking (its
cursor, in ui_state); writing it points their fullscreen at 'target'
through an optional view, and their browser follows. Omit 'client' to
nudge the liveliest one — whoever moved most recently. This is the
hand-on-your-shoulder a knock wants: not "look at T-3", the tab already
there. Back-navigation still returns them — moving a cursor never traps.`,
    {
      target: z.string(),
      client: z.string().optional(),
      view: z.string().optional(),
      session: z.string().optional(),
    },
    async (
      { target, client, view, session }: {
        target: string
        client?: string
        view?: string
        session?: string
      },
    ) => {
      let row = await got(target)
      if (!row) return err(`no entity: ${target}`)
      // WHOSE tab: the named client, or the liveliest — the client that most
      // recently moved a cursor or camera, the same "who's looking now" rule
      // card_open uses to place a card. Cursors and cameras are chrome-sized
      // enumerations (WS_SETS' shape), read keyed.
      let moved = (r: Row) =>
        String(r.comps.updated?.at ?? r.comps.created?.at ?? '')
      let clientEid: string
      if (client) {
        let c = await got(client)
        if (!c) return err(`no client: ${client}`)
        clientEid = c.eid
      } else {
        let live = uniq([
          ...await io.query('.cursor!'),
          ...await io.query('.camera!'),
        ]).sort((a, b) => moved(b).localeCompare(moved(a)))[0]
        let id = String(
          live?.comps.cursor?.client ?? live?.comps.camera?.client ?? '',
        )
        if (!id) return err('no client is looking — open the app first')
        clientEid = id
      }
      // One cursor row per client (unique): patch the existing one, or mint.
      let cur = (await io.query(`.cursor.client=${clientEid}`))[0]
      let eid = cur?.eid ?? uuid()
      await io.write([{
        eid,
        name: 'cursor',
        comp: { client: clientEid, target: row.eid, view: view ?? null },
      }], session)
      let who = (await io.get([clientEid]))[0]
      return bus(
        `showing ${idOf(row)} to ${who ? idOf(who) : clientEid}`,
        session,
      )
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
        let row = await got(id)
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
      let made = (await io.get([eid]))[0]
      let name = made ? idOf(made) : eid
      return text(`published ${name} — card_open ${name} to show it`)
    },
  )

  tool(
    'code_run',
    `Code mode: run JS against the graph in a sandboxed worker (no fs, no
net, no env — its ONLY capability is the graph). In scope: graph
({changes, deps, rows} — rows is [{eid, num, kind, comps}]), apply(
...changes) to QUEUE writes, log(...) for debug output. graph.rows is the
EAGER snapshot; it omits the lazy entry partition (session logs). Reach
that partition with await graph.query(filters, {after, limit}) — the
authoritative whole-graph query, entries included when the filter names
them (kind is a filter, .kind=session) — or await
graph.entries(sessionEid, {after, limit}) for one
Session's ordered seq partition. The script's return value comes back to
you. Queued changes apply atomically after the script finishes — unless
dry_run, which returns the batch without applying (preview a layout
before committing it). Example — grid the cards: const pins =
graph.rows.filter(r => r.comps.pin); pins.forEach((p, i) => apply({eid:
p.eid, name: 'pin', comp: {x: (i%4)*360, y: Math.floor(i/4)*280}}));
return pins.length. timeout_ms is the positive integer execution deadline
in milliseconds (default 10000, maximum 30000).`,
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
          worker.onmessage = async (m) => {
            // A graph.query/entries round-trip: answer from the authoritative
            // pipeline (io.query — the whole graph, lazy entries included) and
            // post it back. The overall timeout still bounds the run.
            let ask = m.data?.ask
            if (ask) {
              try {
                let hits = await io.query(ask.q, ask.opts)
                worker.postMessage({ res: ask.req, rows: hits })
              } catch (e) {
                worker.postMessage({
                  res: ask.req,
                  error: (e as Error).message,
                })
              }
              return
            }
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
            `${effective.changes.length} effective change(s)`
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
created/proposed/decided stamps whose via value describes the instrument,
edges (refs out, backrefs in) and comments in the same entity shape. id:
T-3, bare num, or eid. Comments are always included (comments: true only
affirms that). Quarantined content requires quarantined: true. ${BUS}`,
    {
      id: z.string(),
      quarantined: z.boolean().optional(),
      // Comments render by default; accept the opt-in agents reach for as a
      // no-op affirmation rather than rejecting the key (T-18416).
      comments: z.boolean().optional(),
      session: z.string().optional(),
    },
    async (
      { id, quarantined, session }: {
        id: string
        quarantined?: boolean
        comments?: boolean
        session?: string
      },
    ) => {
      // around()'s shape through io: the row (quarantine-opted when asked —
      // the two-pull union, readGraph's idiom), its comments, the edges
      // touching it with their endpoint rows, and the authoring refs plus
      // one more hop for the instrument's persona/actor faces.
      let reveal = !!quarantined
      let named = uniq([
        ...await io.get([id]),
        ...(reveal ? await io.get([id], ['.quarantined!']) : []),
      ])
      let row = find(named, id)
      if (!row) return err(`no entity: ${id}`)
      let comments = uniq([
        ...await io.query(`.comment.target=${row.eid}`),
        ...(reveal
          ? await io.query(`.comment.target=${row.eid}&.quarantined!`)
          : []),
      ])
      let deps = await io.deps([row.eid], reveal)
      // Entry rows (the lazy partition) can hold `referenced` edges at a hot
      // entity — dozens of log-line mentions. The eager read never surfaced
      // them (entries were outside snapshot()'s slice, so edgesOf's visible
      // screen dropped those edges); keep that reading deliberately by
      // screening entry endpoints, which the visible check below then drops.
      let ends = (await io.get(
        [...new Set(deps.flatMap((d) => [d.parent, d.child]))]
          .filter((e) => e != row.eid),
      )).filter((r) => !r.comps.entry)
      let refs = await io.get(
        [row, ...comments, ...ends].flatMap(refsIn),
      )
      let all = uniq([
        row,
        ...comments,
        ...ends,
        ...refs,
        ...await io.get(refs.flatMap(refsIn)),
      ])
      let edges = edgesOf({ deps }, all, row.eid)
      return bus(
        JSON.stringify(
          {
            ...jsonAuthored(all, row),
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

// The stdio read, off the banned whole-graph /snapshot (M-21143): assemble the
// eager Snapshot from the /query pipeline (evalGraph), which never calls
// snapshot(db). code_run's worker sandbox reads the whole eager graph
// (graph.rows), so this read stays whole — but sourced through the door every
// other reader now uses, so the /snapshot endpoint and the client snapshot()
// helper are gone. Two pulls dedupe into one graph: the default query screens
// quarantined rows, so `.quarantined!` opts them back in to match snapshot(db)'s
// full content; deps=1 rides each hit and quarantined=1 keeps its edges. The
// lazy entry partition stays omitted, exactly as snapshot(db)'s eager slice did
// (a tool reaches it through io.query/entryLog, not this read).
let readGraph = async (): Promise<Snapshot> => {
  let pull = (line = '') =>
    request(
      `http://${host()}/query?deps=1&quarantined=1${line ? `&${line}` : ''}`,
    ).then(async (res) => {
      if (!res.ok) throw new Error(`server said ${res.status}`)
      return await res.json() as (Record<string, unknown> & { deps?: Dep[] })[]
    })
  let [live, held, capabilities] = await Promise.all([
    pull(),
    pull(encodeURIComponent('.quarantined!')),
    serverCaps(),
  ])
  let byEid = new Map<string, Record<string, unknown>>()
  let deps = new Map<string, Dep>()
  for (let hit of [...live, ...held]) {
    let { deps: hitDeps, ...rest } = hit
    let eid = String((rest.entity as { eid?: unknown })?.eid ?? '')
    if (!eid) continue
    byEid.set(eid, rest)
    for (let d of hitDeps ?? []) {
      deps.set(`${d.type} ${d.parent} ${d.child}`, d)
    }
  }
  let changes: Change[] = []
  for (let [eid, comps] of byEid) {
    for (let [name, comp] of Object.entries(comps)) {
      if (name == 'kind') continue // the derived display name, never a component
      changes.push({ eid, name, comp: comp as Record<string, unknown> })
    }
  }
  return { changes, deps: [...deps.values()], capabilities }
}

// The wire half of stdio IO. Explicitly remote callers use it whole; local
// callers retain it for mutations and named service capabilities.
export let httpIO = (): IO => ({
  read: readGraph,
  // The authoritative filter-query is the /query GET, which runs the same
  // evalGraph the in-process mount does — so the lazy entry partition is
  // reachable over stdio too. A filter LINE splits into its `&` tokens, the
  // encoding-safe unit client.query already speaks.
  query: (q, opts) => queryHttp(q.split('&').filter(Boolean), opts),
  get: (ids, filters = []) => fetched(ids, filters),
  deps: (eids, reveal) => httpDeps(eids, reveal),
  write: async (mutation, via) => mutationResult(await mutate(mutation, via)),
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
  history: (eid, limit) => history(eid, limit),
  providers: async () => {
    let res = await request(`http://${host()}/providers`)
    if (!res.ok) throw new Error(`server said ${res.status}`)
    return res.json()
  },
  backfill: (kind) => {
    let path = localReadPath()
    if (!path) {
      throw new Error(
        'backfill requires a local graph (unset TASKS_HOST or set DB_PATH)',
      )
    }
    return Promise.resolve(readBackfill(path, kind))
  },
})

export type StdioIO = { io: IO; close: () => void }

// A co-located stdio process owns no writer baton, but it can own a read-only
// SQLite connection. Bind ordinary graph reads to that connection and leave
// writes/uploads/provider readiness on the wire. A missing file stays remote;
// a schema-skew failure falls back once, then permanently disarms this local
// context. If the wire also fails, guarded() preserves the local diagnostic.
export let stdioIO = (
  wire: IO = httpIO(),
  path: string | null | undefined = localReadPath(),
): StdioIO => {
  if (!path) return { io: wire, close: () => {} }
  let db: DatabaseSync
  try {
    db = new DatabaseSync(path, { readOnly: true })
    db.exec('pragma busy_timeout = 5000')
  } catch {
    return { io: wire, close: () => {} }
  }
  let local = dbReads(db)
  let active = true
  let io: IO
  let close = () => {
    if (!active) return
    active = false
    db.close()
    io.reader = wire.reader
  }
  let protect = <A extends unknown[], R>(
    read: (...args: A) => R | Promise<R>,
    remote: (...args: A) => Promise<R>,
  ) => {
    let run = guarded(read, remote, close)
    return (...args: A) => active ? run(...args) : remote(...args)
  }
  io = {
    ...wire,
    read: protect(local.read, wire.read),
    query: protect(local.query, wire.query),
    get: protect(local.get, wire.get),
    deps: protect(local.deps, wire.deps),
    find: protect(local.find, wire.find),
    history: protect(local.history, wire.history),
    backfill: protect(local.backfill, wire.backfill),
    reader: local.reader,
  }
  return { io, close }
}

// stdio entry: direct SQLite reads when co-located, HTTP when explicitly
// remote, and HTTP for service-owned operations in either mode.
if (import.meta.main) {
  let mounted = stdioIO()
  await mcpServer(mounted.io).connect(new StdioServerTransport())
}
