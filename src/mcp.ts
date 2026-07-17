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
import { z } from 'zod'
import {
  type Change,
  comps,
  type Dep,
  type Hit,
  type PropType,
  statuses,
  uuid,
} from './types.ts'
import {
  byBoard,
  claimant,
  claimChanges,
  commentChanges,
  contextDigest,
  find,
  host,
  idOf,
  notices,
  type Param,
  param,
  patches,
  type Row,
  rows,
  search,
  send,
  snapshot,
  taskChanges,
} from './client.ts'
import { matchQuery, pred } from './query.ts'

// How the tools reach the graph — in-process on the server, HTTP here.
export type IO = {
  read: () => Promise<{ changes: Change[]; deps: Dep[] }>
  write: (changes: Change[]) => Promise<void>
  find: (q: string, limit?: number) => Promise<Hit[]>
  // Land an HTML page in the frozen store for an existing web entity.
  upload: (eid: string, html: string) => Promise<void>
}

// A prop's type, said inline where it isn't obvious: enums spell their
// values, associations say (eid) — the doc string derives from the same
// typed table everything else reads.
let sig = (t: PropType) =>
  typeof t == 'string'
    ? ''
    : 'enum' in t
    ? `(${t.enum.join('|')})`
    : 'eid' in t
    ? '(eid)'
    : ''
let GRAMMAR = `Dot-params: '.prop=value' routes by prop through the component
vocabulary (${
  Object.entries(comps).map(([n, props]) =>
    `${n}: ${
      Object.entries(props).map(([p, t]) => p + sig(t)).join('/') || '(tag)'
    }`
  ).join('; ')
}). A prop unique to one component routes bare ('.title=x' → doc); for the
few collisions (pin/camera x,y,w,h) use '.comp.prop=x'. Numeric-looking
values become numbers. Statuses: ${statuses.join(', ')}.`

let FILTERS = `Filters add operators to that routing: '.priority<=1',
'.domain=Ops,Eng' (any of), '.priority=1..3' (range; 1...3 excludes the
end), '.status!=done', '.title~=flux' (contains), '.domain=' (absent),
'.num=1,2,3'. Timestamp columns take time phrases — today, yesterday,
'2026-07-04', this|last|next week|month|year, '5 minutes ago', 'in 2
days' — a phrase is a RANGE: = within it, >= from its start, <= to its
end ('.modified_at>="1 hour ago"'; glue with - where quoting is hard).
Bare words are text terms (doc contains). Boards persist these same
queries (board.query).`

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
    if (!hit) throw new Error(`not a filter: ${f}`)
    return hit
  })

let text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })
// A refusal IS an error: isError rides the reply so agent harnesses (and
// telemetry) count it as one, instead of a success that reads like an apology.
let err = (s: string) => ({ ...text(s), isError: true as const })

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

// The write-time backstop: a long body with not one line break is a
// wall of text. It still stores (never drop words) — the reply says so
// at the one moment the writer can fix it cheaply.
let wall = (s: unknown) =>
  typeof s == 'string' && s.length > 240 && !s.includes('\n')
    ? `\nnote: that body is one unbroken ${s.length}-char line — bodies are
markdown documents (paragraphs, lists, headings). Rewrite via task_update
".body=".`
    : ''

// Any *_eid dot-param value may be a human id (T-3, P-19) — resolve it to
// the eid so callers never do the num→eid lookup dance themselves.
let resolveIds = (all: Row[], ps: Param[]) =>
  ps.map((p) => {
    if (!p.prop.endsWith('_eid') || typeof p.value != 'string') return p
    if (!/^[A-Za-z]+-\d+$/.test(p.value)) return p
    let hit = find(all, p.value)
    if (!hit) throw new Error(`no entity: ${p.value} (.${p.prop})`)
    return { ...p, value: hit.eid }
  })

export let mcpServer = (io: IO) => {
  // Server instructions ride the initialize handshake and land in the
  // agent's standing context — the strongest ambient steering the
  // protocol offers. Keep it to what every writer must know.
  let server = new McpServer({ name: 'tasks', version: '0.1.0' }, {
    instructions: `The graph renders everything as markdown. ${DOC}

Call task_context first each session, and pass the same stable session
id to every tool that takes one — it is your identity for claims,
comments, and the comms bus.`,
  })

  // The comms bus, MCP side: a tool that knows who's asking appends what
  // that session hasn't seen and advances the session's own ack cursor —
  // exactly when the lines are actually served.
  let bus = async (out: string, session?: string) => {
    if (!session) return text(out)
    let n = notices(await io.read(), session)
    if (!n.lines.length) return text(out)
    await io.write(n.ack)
    return text(`${out}\n\n— while you were away —\n${n.lines.join('\n')}`)
  }

  server.tool(
    'search',
    `Full-text search (FTS5) across every doc in the graph — task titles
and bodies, boards, projects, comments. Words AND together; a trailing *
prefix-matches. Dot-param filters mix into the same line ('runner
.status=done .modified_at=today') and screen the hits; filters alone
list matching entities, newest first. Returns ranked hits as 'id kind
title — snippet'; a comment hit names the entity it targets. Use this
FIRST when looking for existing work — cheaper and better-ranked than
paging graph_query.`,
    { q: z.string(), limit: z.number().optional() },
    async ({ q, limit }: { q: string; limit?: number }) => {
      let hits = await io.find(q, limit ?? 20)
      return text(
        hits.map((h) =>
          `${idOf(h)} ${h.kind}: ${h.title || '(untitled)'}` +
          `${h.open_eid != h.eid ? ` → on ${h.open_eid}` : ''}` +
          ` — ${h.snip.replaceAll('\x01', '[').replaceAll('\x02', ']')}`
        ).join('\n') || '(no hits)',
      )
    },
  )

  server.tool(
    'task_list',
    `List tasks (id, status, title), board-ordered. Optional dot-param
filters must ALL match. ${FILTERS} ${BUS}`,
    { filters: z.array(z.string()).optional(), session: z.string().optional() },
    async (
      { filters = [], session }: { filters?: string[]; session?: string },
    ) => {
      let ps = parseFilters(filters)
      let all = rows(await io.read())
      let hits = all
        .filter((r) => r.comps.task)
        .filter((r) => matchQuery(r.comps, ps))
        .sort(byBoard)
      return bus(
        hits.map((r) => line(all, r)).join('\n') || '(no matches)',
        session,
      )
    },
  )

  server.tool(
    'task_new',
    `Create one task — or a BATCH: pass tasks:[{title, body?, status?,
params?}] and they land in one atomic apply (shared dot-params go in
each item's params). *_eid param values accept human ids (.project_eid=
P-19). ${GRAMMAR} ${BUS}`,
    {
      title: z.string().optional(),
      body: body().optional(),
      status: z.enum(['open', 'wip', 'done']).optional(),
      params: z.array(z.string()).optional(),
      tasks: z.array(z.object({
        title: z.string(),
        body: body().optional(),
        status: z.enum(['open', 'wip', 'done']).optional(),
        params: z.array(z.string()).optional(),
      })).optional(),
      session: z.string().optional(),
    },
    async (
      { title, body, status, params = [], tasks, session }: {
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
      let want = tasks ?? [{ title: title ?? '', body, status, params }]
      if (!want.length || want.some((t) => !t.title)) {
        return text('every task needs a title (pass title or tasks[])')
      }
      let minted: string[] = []
      let changes = want.flatMap((t) => {
        let grouped = patches(resolveIds(all, parseAll(t.params ?? [])))
        grouped.doc = { title: t.title, body: t.body ?? '', ...grouped.doc }
        if (t.status) grouped.task = { status: t.status, ...grouped.task }
        let eid = crypto.randomUUID()
        minted.push(eid)
        return taskChanges(eid, grouped)
      })
      await io.write(changes)
      let after = rows(await io.read())
      let ids = minted.map((eid) => {
        let made = after.find((r) => r.eid == eid)
        return made ? idOf(made) : eid
      })
      return bus(
        `created ${ids.join(', ')}${
          wall(want.find((t) => wall(t.body))?.body)
        }`,
        session,
      )
    },
  )

  server.tool(
    'task_update',
    `Patch an entity by id (T-3, bare num, or eid) with dot-params, e.g.
[".status=done"] or [".body=notes..."]. Only the named props change.
*_eid values accept human ids. ${DOC} ${GRAMMAR} ${BUS}`,
    {
      id: z.string(),
      params: z.array(z.string()).min(1),
      session: z.string().optional(),
    },
    async (
      { id, params, session }: {
        id: string
        params: string[]
        session?: string
      },
    ) => {
      let all = rows(await io.read())
      let row = find(all, id)
      if (!row) return err(`no entity: ${id}`)
      let grouped = patches(resolveIds(all, parseAll(params)))
      await io.write(
        Object.entries(grouped)
          .map(([name, comp]) => ({ eid: row.eid, name, comp })),
      )
      return bus(`updated ${idOf(row)}${wall(grouped.doc?.body)}`, session)
    },
  )

  server.tool(
    'task_context',
    `Your working set, ≤20 lines: the tasks claimed by your session (with
unresolved dependencies and who holds them), or the top of the open
board if you hold nothing. Call this FIRST each session, with the same
stable session identifier you claim with.`,
    { session: z.string() },
    async ({ session }: { session: string }) => {
      return bus(contextDigest(await io.read(), session), session)
    },
  )

  server.tool(
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
        await io.write(claimChanges(all, row.eid, session))
      } catch (e) {
        return {
          ...await bus(`claim failed: ${(e as Error).message}`, session),
          isError: true as const,
        }
      }
      return bus(`claimed ${idOf(row)} for ${session}`, session)
    },
  )

  server.tool(
    'task_release',
    `Drop the claim on a task (yours or a stale one), freeing it for
other sessions. ${BUS}`,
    { id: z.string(), session: z.string().optional() },
    async ({ id, session }: { id: string; session?: string }) => {
      let row = find(rows(await io.read()), id)
      if (!row) return err(`no entity: ${id}`)
      await io.write([{ eid: row.eid, name: 'claim', comp: null }])
      return bus(`released ${idOf(row)}`, session)
    },
  )

  server.tool(
    'task_comment',
    `Comment on ANY entity (tasks, boards, docs, frozen pages — anything
with an id). Body is markdown. Pass the same stable session identifier
you claim with, for attribution.`,
    { id: z.string(), body: body(), session: z.string() },
    async (
      { id, body, session }: { id: string; body: string; session: string },
    ) => {
      let all = rows(await io.read())
      let row = find(all, id)
      if (!row) return err(`no entity: ${id}`)
      await io.write(commentChanges(all, row.eid, body, session))
      return bus(`commented on ${idOf(row)}${wall(body)}`, session)
    },
  )

  // ---- the generic graph surface: the UI is data, so this IS UI control ----

  server.tool(
    'graph_query',
    `The WHOLE graph, not just tasks: every entity as {id, kind, eid,
comps}, dot-param filtered. Cards, pins (positions), cameras (what each
client is looking at), sessions, comments — all live here. ${GRAMMAR} ${FILTERS}`,
    { filters: z.array(z.string()).optional(), kind: z.string().optional() },
    async ({ filters = [], kind }: { filters?: string[]; kind?: string }) => {
      let ps = parseFilters(filters)
      let hits = rows(await io.read())
        .filter((r) => !kind || r.kind == kind)
        .filter((r) => matchQuery(r.comps, ps))
      return text(JSON.stringify(
        hits.map((r) => ({
          id: idOf(r),
          kind: r.kind,
          eid: r.eid,
          comps: r.comps,
        })),
        null,
        2,
      ))
    },
  )

  server.tool(
    'graph_apply',
    `Raw wire access: apply a batch of changes atomically. A change is
{eid, name, comp} — comp is a PATCH (omitted columns untouched), comp:
null deletes the component, {name:'entity', comp:null} deletes the
entity. Mint uuids for new entities. eid and *_eid comp values accept
human ids (T-3, P-19) for EXISTING entities. Edges: name 'dependency',
comp {type: requires|contains|reads, child_eid} links eid→child; add
gone: true to unlink (a triple has no row key, so the comp names the
whole edge). Same allowlist and claim-lease rules as every other
client; writes broadcast live to all screens. ${GRAMMAR}`,
    {
      changes: z.array(z.object({
        eid: z.string(),
        name: z.string(),
        comp: z.record(z.unknown()).nullable(),
      })).min(1),
    },
    async ({ changes }: { changes: Change[] }) => {
      try {
        // Human ids resolve before the wire sees them — a T-num in eid or
        // any *_eid column means an EXISTING entity, so a miss is an error
        // here, never a silent mint.
        let human = /^[A-Za-z]+-\d+$/
        let needs = changes.some((c) =>
          human.test(c.eid) ||
          Object.entries(c.comp ?? {}).some(([k, v]) =>
            k.endsWith('_eid') && typeof v == 'string' && human.test(v)
          )
        )
        if (needs) {
          let all = rows(await io.read())
          let resolve = (v: string) => {
            let hit = find(all, v)
            if (!hit) throw new Error(`no entity: ${v}`)
            return hit.eid
          }
          changes = changes.map((c) => ({
            ...c,
            eid: human.test(c.eid) ? resolve(c.eid) : c.eid,
            comp: c.comp == null ? c.comp : Object.fromEntries(
              Object.entries(c.comp).map((
                [k, v],
              ) => [
                k,
                k.endsWith('_eid') && typeof v == 'string' && human.test(v)
                  ? resolve(v)
                  : v,
              ]),
            ),
          }))
        }
        await io.write(changes)
      } catch (e) {
        return err(`apply failed: ${(e as Error).message}`)
      }
      return text(`applied ${changes.length} change(s)`)
    },
  )

  server.tool(
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
          moved_at: r.comps.entity?.modified_at ?? null,
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
          moved_at: r.comps.entity?.modified_at ?? null,
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

  server.tool(
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
      if (!canvas) return text('no canvas')
      if (x == null || y == null) {
        // The LIVELIEST viewport, not the newest-minted: a camera moves
        // whenever its human pans, so modified_at names who's looking.
        let cam = all.filter((r) => r.comps.camera?.canvas_eid == canvas.eid)
          .sort((a, b) =>
            String(b.comps.entity?.modified_at ?? '').localeCompare(
              String(a.comps.entity?.modified_at ?? ''),
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
        task: 'Show',
        board: 'Board',
        web: 'Web',
        doc: 'Show',
        project: 'Show',
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

  server.tool(
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

  server.tool(
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

  server.tool(
    'page_put',
    `Publish an HTML page into the graph — the way to drop a one-shot
artifact (mockup, report, diagram) where people work. Mints a web
entity and lands your HTML in its frozen store; it renders in a
sandboxed iframe after the standard archive scrub (scripts, frames,
and every external reference removed — inline <style> carries the
design, so self-contained pages only). Markdown needs no upload: put
it in any doc body. Show the page with card_open. Passing the id of an
existing web entity replaces its page instead.`,
    { title: z.string(), html: z.string(), id: z.string().optional() },
    async (
      { title, html, id }: { title: string; html: string; id?: string },
    ) => {
      let eid: string
      if (id) {
        let row = find(rows(await io.read()), id)
        if (!row?.comps.web) return err(`no web entity: ${id}`)
        eid = row.eid
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

  server.tool(
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
Math.floor(i/4)*280}})); return pins.length`,
    {
      js: z.string(),
      dry_run: z.boolean().optional(),
      timeout_ms: z.number().max(30_000).optional(),
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
        return text(
          `code threw: ${out.error}\nlogs:\n${out.logs.join('\n')}`,
        )
      }
      let applied = ''
      if (out.batch.length && !dry_run) {
        try {
          await io.write(out.batch)
          applied = `applied ${out.batch.length} change(s)`
        } catch (e) {
          applied = `batch REJECTED: ${(e as Error).message}`
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

  server.tool(
    'task_show',
    `One entity, whole: spine, every component, its comments, as JSON.
id: T-3, bare num, or eid. ${BUS}`,
    { id: z.string(), session: z.string().optional() },
    async ({ id, session }: { id: string; session?: string }) => {
      let all = rows(await io.read())
      let row = find(all, id)
      if (!row) return err(`no entity: ${id}`)
      let comments = all.filter((r) => r.comps.comment?.target_eid == row.eid)
      return bus(JSON.stringify({ ...row, comments }, null, 2), session)
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
      let res = await fetch(`http://${host()}/upload?eid=${eid}`, {
        method: 'POST',
        body: html,
      })
      if (!res.ok) throw new Error(`server said ${res.status}`)
    },
  }).connect(new StdioServerTransport())
}
