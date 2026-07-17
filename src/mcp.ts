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
import { type Change, comps, type Dep, statuses } from './types.ts'
import {
  byBoard,
  find,
  idOf,
  param,
  patches,
  type Row,
  rows,
  send,
  snapshot,
} from './client.ts'

// How the tools reach the graph — in-process on the server, HTTP here.
export type IO = {
  read: () => Promise<{ changes: Change[]; deps: Dep[] }>
  write: (changes: Change[]) => Promise<void>
}

let GRAMMAR = `Dot-params: '.prop=value' routes by prop through the component
vocabulary (${
  Object.entries(comps).map(([n, cs]) => `${n}: ${cs.join('/') || '(tag)'}`)
    .join('; ')
}). A prop unique to one component routes bare ('.title=x' → doc); for the
few collisions (pin/camera x,y,w,h) use '.comp.prop=x'. Numeric-looking
values become numbers. Statuses: ${statuses.join(', ')}.`

let line = (r: Row) =>
  `${idOf(r)}  ${String(r.comps.task?.status ?? r.kind).padEnd(7)} ${
    r.comps.doc?.title ?? ''
  }${r.comps.claim ? `  ⚑ ${r.comps.claim.session}` : ''}`

let parseAll = (params: string[]) =>
  params.map((p) => {
    let hit = param(p)
    if (!hit) throw new Error(`not a dot-param: ${p}`)
    return hit
  })

let text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })

export let mcpServer = (io: IO) => {
  let server = new McpServer({ name: 'tasks', version: '0.1.0' })

  server.tool(
    'task_list',
    `List tasks (id, status, title), board-ordered. Optional dot-param
filters must ALL match. ${GRAMMAR}`,
    { filters: z.array(z.string()).optional() },
    async ({ filters = [] }: { filters?: string[] }) => {
      let ps = parseAll(filters)
      let hits = rows(await io.read())
        .filter((r) => r.comps.task)
        .filter((r) =>
          ps.every((p) => String(r.comps[p.comp]?.[p.prop]) == String(p.value))
        )
        .sort(byBoard)
      return text(hits.map(line).join('\n') || '(no matches)')
    },
  )

  server.tool(
    'task_new',
    `Create a task: a doc (title/body) plus workflow (status, default
'open'). Extra dot-params attach any other components. ${GRAMMAR}`,
    {
      title: z.string(),
      body: z.string().optional(),
      status: z.enum(['open', 'wip', 'done']).optional(),
      params: z.array(z.string()).optional(),
    },
    async (
      { title, body, status, params = [] }: {
        title: string
        body?: string
        status?: string
        params?: string[]
      },
    ) => {
      let grouped = patches(parseAll(params))
      let eid = crypto.randomUUID()
      let changes: Change[] = [
        { eid, name: 'doc', comp: { title, body: body ?? '', ...grouped.doc } },
        {
          eid,
          name: 'task',
          comp: { status: status ?? 'open', ...grouped.task },
        },
        ...Object.entries(grouped)
          .filter(([n]) => n != 'doc' && n != 'task')
          .map(([name, comp]) => ({ eid, name, comp })),
      ]
      await io.write(changes)
      let made = rows(await io.read()).find((r) => r.eid == eid)
      return text(`created ${made ? idOf(made) : eid}`)
    },
  )

  server.tool(
    'task_update',
    `Patch an entity by id (T-3, bare num, or eid) with dot-params, e.g.
[".status=done"] or [".body=notes..."]. Only the named props change.
${GRAMMAR}`,
    { id: z.string(), params: z.array(z.string()).min(1) },
    async ({ id, params }: { id: string; params: string[] }) => {
      let row = find(rows(await io.read()), id)
      if (!row) return text(`no entity: ${id}`)
      await io.write(
        Object.entries(patches(parseAll(params)))
          .map(([name, comp]) => ({ eid: row.eid, name, comp })),
      )
      return text(`updated ${idOf(row)}`)
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
      let row = find(rows(await io.read()), id)
      if (!row) return text(`no entity: ${id}`)
      try {
        await io.write([{ eid: row.eid, name: 'claim', comp: { session } }])
      } catch (e) {
        return text(`claim failed: ${(e as Error).message}`)
      }
      return text(`claimed ${idOf(row)} for ${session}`)
    },
  )

  server.tool(
    'task_release',
    'Drop the claim on a task (yours or a stale one), freeing it for other sessions.',
    { id: z.string() },
    async ({ id }: { id: string }) => {
      let row = find(rows(await io.read()), id)
      if (!row) return text(`no entity: ${id}`)
      await io.write([{ eid: row.eid, name: 'claim', comp: null }])
      return text(`released ${idOf(row)}`)
    },
  )

  server.tool(
    'task_show',
    'One entity, whole: spine, every component, as JSON. id: T-3, bare num, or eid.',
    { id: z.string() },
    async ({ id }: { id: string }) => {
      let row = find(rows(await io.read()), id)
      return text(row ? JSON.stringify(row, null, 2) : `no entity: ${id}`)
    },
  )

  return server
}

// stdio entry: same tools, reaching the graph over HTTP like any client.
if (import.meta.main) {
  await mcpServer({ read: snapshot, write: send })
    .connect(new StdioServerTransport())
}
