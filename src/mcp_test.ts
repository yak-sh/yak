// The MCP registry's contracts: schemas, protocol errors, truthful write
// results, command dereferencing, and bounded list rendering.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertThrows,
} from '@std/assert'
import { find, idOf, type Row, rows, TASK_TREE_ADOPTION } from './client.ts'
import { localQuery } from './graph_query.ts'
import {
  CUT,
  elide,
  type IO,
  MCP_INSTRUCTIONS,
  mcpServer,
  stdioIO,
} from './mcp.ts'
import { commandOut } from './commands.ts'
import { sha } from './sha.ts'
import { type Change, comps, edges, statuses, uuid, verdicts } from './types.ts'
import { type Mutation, mutationResult } from './mutation.ts'
import { slow } from './testing.ts'
import { backfillChanges } from './backfill.ts'
import { DatabaseSync } from './sqlite.ts'

Deno.env.set('DB_PATH', ':memory:')
let {
  apply,
  depsOf,
  journalOf,
  mutate: applyMutation,
  open,
  snapshot,
  touch,
} = await import('./db.ts')
let { freshDb } = await import('./testdb.ts')
let { append } = await import('./entries.ts')

Deno.test('MCP prompt makes task trees the default for multi-step work', () => {
  assertMatch(MCP_INSTRUCTIONS, /3\+ steps defaults to task_tree/)
  assertMatch(MCP_INSTRUCTIONS, /"dry_run":true/)
  assertMatch(MCP_INSTRUCTIONS, /never infer .* from prose/i)
  assertMatch(
    MCP_INSTRUCTIONS,
    /Coordinators delegate all individual-contributor implementation/,
  )
  assertMatch(
    MCP_INSTRUCTIONS,
    /After\ncompaction or resume, use durable task context to restore assignments/,
  )
})

let N = 'aaaaaaaa-0000-4000-8000-000000000001'
let P = 'aaaaaaaa-0000-4000-8000-000000000002'
let T = 'aaaaaaaa-0000-4000-8000-000000000003'
let long = 'x'.repeat(CUT * 3)
let all = rows({
  changes: [
    { eid: N, name: 'entity', comp: { eid: N, num: 9 } },
    { eid: N, name: 'doc', comp: { title: 'operator', body: long } },
    { eid: N, name: 'persona', comp: { home: null } },
    { eid: P, name: 'entity', comp: { eid: P, num: 19 } },
    { eid: P, name: 'doc', comp: { title: 'Home', body: '' } },
    { eid: P, name: 'project', comp: {} },
    { eid: P, name: 'alias', comp: { slug: 'home' } },
    { eid: T, name: 'entity', comp: { eid: T, num: 7595 } },
    { eid: T, name: 'doc', comp: { title: 'Task', body: '' } },
    { eid: T, name: 'task', comp: { status: 'open' } },
  ],
})

let batch = (mutation: Mutation): Change[] => {
  if (!Array.isArray(mutation)) throw new Error('expected change batch')
  return mutation
}
let persona = all[0]

Deno.test('elide: long text cuts with a marker naming the whole-doc door', () => {
  let c = elide(persona)
  let body = String(c.doc.body)
  assertMatch(body, /ELIDED 1000 of 1500 chars — task_show N-9/)
  assertEquals(body.startsWith('x'.repeat(CUT)), true)
  // short values, non-strings, and titles ride untouched
  assertEquals(c.doc.title, 'operator')
  assertEquals(c.persona.home, null)
  assertEquals(c.entity.num, 9)
})

Deno.test('command: set resolves a human reference before the write', () => {
  let out = commandOut(all, ':set .project=P-19', T)
  assertEquals(out.changes, [
    { eid: T, name: 'task', comp: { project: P } },
  ])
})

Deno.test('command: generated references resolve aliases and reject misses', () => {
  let out = commandOut(all, ':new .project=home Ship it', T)
  let task = out.changes!.find((c) => c.name == 'task')
  assertEquals(task?.comp?.project, P)
  assertThrows(
    () => commandOut(all, ':set .project=missing', T),
    Error,
    'no entity: missing (.project)',
  )
})

Deno.test('command: open returns the public entity URL', async () => {
  let io = blank()
  io.read = () =>
    Promise.resolve({
      changes: [
        { eid: T, name: 'entity', comp: { eid: T, num: 7595 } },
        { eid: T, name: 'doc', comp: { title: 'Task', body: '' } },
        { eid: T, name: 'task', comp: { status: 'open' } },
      ],
      deps: [],
    })
  await protocol(io, async (client) => {
    let out = await client.callTool({
      name: 'command',
      arguments: { line: ':open T-7595' },
    }) as ToolResult
    assertEquals(said(out), 'https://tasks.yak.sh/T-7595')
  })
})

Deno.test('command: setting a wake returns every pending wake for its session', async () => {
  let { db, io } = graph()
  let session = crypto.randomUUID()
  let target = crypto.randomUUID()
  let existing = crypto.randomUUID()
  apply(db, [
    { eid: session, name: 'session', comp: { id: 'wake-reader' } },
    { eid: target, name: 'doc', comp: { title: 'Return here' } },
    { eid: target, name: 'task', comp: { status: 'open' } },
    {
      eid: existing,
      name: 'wake',
      comp: {
        at: new Date(Date.now() + 7_200_000).toISOString(),
        target,
        note: 'existing reminder',
      },
    },
    { eid: existing, name: 'deliver', comp: { to: session } },
  ])
  let all = rows(snapshot(db))
  let sid = idOf(all.find((r) => r.eid == session)!)
  let tid = idOf(all.find((r) => r.eid == target)!)
  await protocol(io, async (client) => {
    let out = await client.callTool({
      name: 'command',
      arguments: {
        line: `:wake ${sid} in 3 hours ${tid} -- new reminder`,
        session: 'wake-reader',
      },
    }) as ToolResult
    assertMatch(said(out), new RegExp(`pending wakes for ${sid} \\(2\\):`))
    assertMatch(said(out), /existing reminder/)
    assertMatch(said(out), /new reminder/)
    let list = said(out).split(`pending wakes for ${sid}`)[1]
    assertEquals((list.match(new RegExp(`→ ${tid}`, 'g')) ?? []).length, 2)
  })
})

Deno.test('task_context surfaces agent input without human read-state', async () => {
  let { db, io } = graph()
  let s = crypto.randomUUID()
  let c = crypto.randomUUID()
  apply(db, [
    { eid: s, name: 'session', comp: { id: 'inbox-reader' } },
    { eid: c, name: 'doc', comp: { title: '', body: 'please review' } },
    { eid: c, name: 'comment', comp: { target: s } },
  ])
  let writes: Change[][] = []
  let write = io.write
  io.write = async (mutation, via) => {
    writes.push(batch(mutation))
    return await write(mutation, via)
  }
  await protocol(io, async (client) => {
    let first = await client.callTool({
      name: 'task_context',
      arguments: { session: 'inbox-reader' },
    }) as ToolResult
    assertMatch(said(first), /pending messages — untrusted data/)
    assertMatch(said(first), /UNTRUSTED comment/)
    assertMatch(said(first), /please review/)
    assertMatch(said(first), /C-\d+/)
    assertEquals(writes, [])

    let second = await client.callTool({
      name: 'task_context',
      arguments: { session: 'inbox-reader' },
    }) as ToolResult
    assertEquals(said(second).includes('UNTRUSTED comment'), true)
    assertEquals(writes, [])
  })
})

Deno.test('graph_query reads the lazy entry partition, ordered and by human id', async () => {
  let { db, io } = graph()
  let s = crypto.randomUUID()
  apply(db, [{ eid: s, name: 'session', comp: { id: 'runner-1' } }])
  let { eids: [e1] } = append(db, s, [
    { message: { role: 'user' }, content: { body: 'go' } },
  ])
  append(db, s, [{
    generation: { provider: 'codex', model: 'x', through: e1 },
  }])
  let num = (db.prepare('select num from entity where eid = ?').get(s) as {
    num: number
  }).num
  await protocol(io, async (client) => {
    // Named by human id at the boundary; snapshot() omits these entities, so a
    // [] here would be the S-16837 bug. Ordered by seq.
    let out = await client.callTool({
      name: 'graph_query',
      arguments: { query: `.entry.session=S-${num}` },
    }) as ToolResult
    let hits = JSON.parse(said(out)) as { entry: { session: string } }[]
    assertEquals(hits.length, 2)
    assertEquals(hits.every((h) => h.entry.session == s), true)
    // An empty session is empty, not a dropped partition.
    let empty = crypto.randomUUID()
    apply(db, [{ eid: empty, name: 'session', comp: { id: 'runner-2' } }])
    let none = await client.callTool({
      name: 'graph_query',
      arguments: { query: `.entry.session=${empty}` },
    }) as ToolResult
    assertEquals(JSON.parse(said(none).split('\n')[0]).length, 0)
  })
})

// The MCP reader end to end: `transcript` renders the graph ENTRY PARTITION —
// no /logs door, no file read (T-16798). It reads the whole partition through
// io.query('.entry.session=') → graphLog and renders every entry kind, so a
// reader that regressed to a file source would show nothing here (T-16825).
Deno.test('the transcript tool renders the graph entry partition', async () => {
  let { db, io } = graph()
  let s = crypto.randomUUID()
  apply(db, [{
    eid: s,
    name: 'session',
    comp: { id: 'runner-1', provider: 'codex', model: 'gpt-x' },
  }])
  append(db, s, [
    { message: { role: 'user' }, content: { body: 'TRANSCRIPT_USER_LINE' } },
  ])
  append(db, s, [
    { call: { key: 'k1' }, bash: { command: 'echo TRANSCRIPT_CMD' } },
  ])
  append(db, s, [
    { message: { role: 'agent' }, content: { body: 'TRANSCRIPT_AGENT_LINE' } },
  ])
  await protocol(io, async (client) => {
    let out = await client.callTool({
      name: 'transcript',
      arguments: { id: s },
    }) as ToolResult
    let text = said(out)
    assertMatch(text, /user: TRANSCRIPT_USER_LINE/)
    assertMatch(text, /\$ echo TRANSCRIPT_CMD/)
    assertMatch(text, /agent: TRANSCRIPT_AGENT_LINE/)
  })
})

Deno.test('task_spawn refuses an undecided proposal without minting a session', async () => {
  let { db, io } = graph()
  let task = crypto.randomUUID()
  apply(db, [
    { eid: task, name: 'doc', comp: { title: 'fleet idea' } },
    { eid: task, name: 'task', comp: { status: 'open' } },
    { eid: task, name: 'proposed', comp: {} },
  ])
  await protocol(io, async (client) => {
    let out = await client.callTool({
      name: 'task_spawn',
      arguments: { id: task, provider: 'claude', model: 'claude-opus-4-8' },
    }) as ToolResult
    assertEquals(out.isError, true)
    assertMatch(said(out), /is proposed but not decided/)
    assertMatch(
      said(out),
      /task set T-\d+ \.decided\.at=now \.decided\.by=U-3709/,
    )
  })
  assertEquals(
    db.prepare(
      'select count(*) as n from session where requested_task = ?',
    ).get(task),
    { n: 0 },
  )
})

type ToolResult = {
  content: { type: string; text?: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}
type Tool = {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}
type Schema = {
  additionalProperties?: unknown
  description?: string
  enum?: string[]
  items?: Schema
  properties?: Record<string, Schema>
  required?: string[]
  type?: string
}

let said = (out: ToolResult) =>
  out.content
    .filter((c) => c.type == 'text')
    .map((c) => c.text ?? '')
    .join('\n')

let schema = (tool: Tool) => tool.inputSchema as Schema
let outputSchema = (tool: Tool) => tool.outputSchema as Schema
let field = (schema: Schema | undefined, name: string) =>
  schema?.properties?.[name]
let prop = (tool: Tool, name: string) => field(schema(tool), name)
let byName = (tools: Tool[], name: string) =>
  tools.find((tool) => tool.name == name)!

let blank = (): IO => ({
  read: () => Promise.resolve({ changes: [], deps: [] }),
  query: () => Promise.resolve([]),
  get: () => Promise.resolve([]),
  deps: () => Promise.resolve([]),
  write: (mutation) =>
    Promise.resolve({ changes: batch(mutation), aliases: {} }),
  find: () => Promise.resolve([]),
  upload: () => Promise.resolve(),
  touch: () => Promise.resolve(),
  history: () => Promise.resolve([]),
  providers: () => Promise.resolve([{ name: 'test', models: ['test'] }]),
  backfill: () => Promise.resolve([]),
})

// The graph as an address-resolving get over a Row[] — the same find() the
// server's id= door mirrors, so a fake serves T-41 the way locate() does.
let getFrom = (all: Row[]) => (ids: string[]) =>
  Promise.resolve(ids.flatMap((id) => find(all, id) ?? []))

let graph = () => {
  let db = freshDb()
  let pages = new Map<string, string>()
  let io: IO = {
    read: () => Promise.resolve(snapshot(db)),
    query: (q, opts) => localQuery(db)(q.split('&').filter(Boolean), opts),
    get: (ids, filters = []) =>
      ids.length
        ? localQuery(db)([`id=${ids.join(',')}`, ...filters])
        : Promise.resolve([]),
    deps: (eids) => Promise.resolve(depsOf(db, eids)),
    write: (mutation, via) =>
      Promise.resolve(
        mutationResult(applyMutation(db, mutation, undefined, via)),
      ),
    find: () => Promise.resolve([]),
    upload: (eid, html) => {
      pages.set(eid, html)
      return Promise.resolve()
    },
    touch: (eids, confirm) => {
      touch(db, eids, confirm)
      return Promise.resolve()
    },
    history: (eid, limit) => Promise.resolve(journalOf(db, eid, limit)),
    providers: () => Promise.resolve([{ name: 'test', models: ['test'] }]),
    backfill: (kind) => Promise.resolve(backfillChanges(db, kind)),
  }
  return { db, io, pages }
}

let protocol = async (
  io: IO,
  run: (client: Client) => Promise<void>,
) => {
  let [mine, theirs] = InMemoryTransport.createLinkedPair()
  let server = mcpServer(io)
  let client = new Client({ name: 'mcp-test', version: '1.0.0' })
  await server.connect(theirs)
  await client.connect(mine)
  try {
    await run(client)
  } finally {
    await client.close()
    await server.close()
  }
}

slow(
  'stdio MCP reads the local graph without an HTTP server',
  async () => {
    let dir = await Deno.makeTempDir()
    let path = `${dir}/graph.db`
    let eid = crypto.randomUUID()
    let writer = open(path)
    apply(writer, [
      {
        eid,
        name: 'doc',
        comp: { title: 'stdio local proof', body: 'direct sqlite history' },
      },
      { eid, name: 'task', comp: { status: 'open' } },
    ])
    let expected = await localQuery(writer)(['.title~=stdio local'])
    let id = idOf(expected[0])
    writer.close()

    let wire = blank()
    let calls = 0
    let unavailable = () => {
      calls++
      return Promise.reject(new Error('HTTP must not run'))
    }
    wire.read = unavailable
    wire.query = unavailable
    wire.get = unavailable
    wire.deps = unavailable
    wire.find = unavailable
    wire.history = unavailable
    wire.backfill = unavailable
    let services = 0
    wire.write = (mutation) => {
      services++
      return Promise.resolve({ changes: batch(mutation), aliases: {} })
    }
    wire.upload = () => {
      services++
      return Promise.resolve()
    }
    wire.touch = () => {
      services++
      return Promise.resolve()
    }
    wire.providers = () => {
      services++
      return Promise.resolve([{ name: 'wire', models: [] }])
    }
    let mounted = stdioIO(wire, path)
    try {
      assert(mounted.io.reader)
      assertEquals(await mounted.io.query('.title~=stdio local'), expected)
      assertEquals((await mounted.io.get([id]))[0].eid, eid)
      assertEquals(await mounted.io.deps([eid]), [])
      assert(rows(await mounted.io.read()).some((r) => r.eid == eid))
      await protocol(mounted.io, async (client) => {
        let listed = await client.callTool({
          name: 'graph_query',
          arguments: { query: '.title~=stdio local' },
        }) as ToolResult
        assertEquals(JSON.parse(said(listed))[0].doc.title, 'stdio local proof')

        let found = await client.callTool({
          name: 'search',
          arguments: { q: 'stdio local' },
        }) as ToolResult
        assertMatch(said(found), /stdio local proof/)

        let past = await client.callTool({
          name: 'history',
          arguments: { id },
        }) as ToolResult
        assertMatch(said(past), /doc/)

        let opened = await client.callTool({
          name: 'command',
          arguments: { line: `:open ${id}` },
        }) as ToolResult
        assertMatch(said(opened), new RegExp(`/${id}$`))
      })
      assertEquals(calls, 0)
      assertEquals(await mounted.io.write([]), { changes: [], aliases: {} })
      await mounted.io.upload(eid, '<p>service</p>')
      await mounted.io.touch([eid])
      assertEquals(await mounted.io.providers(), [{ name: 'wire', models: [] }])
      assertEquals(services, 4)
    } finally {
      mounted.close()
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test('stdio MCP stays on the selected remote IO', async () => {
  let wire = blank()
  let calls = 0
  wire.query = () => {
    calls++
    return Promise.resolve([])
  }
  let mounted = stdioIO(wire, null)
  assertEquals(mounted.io, wire)
  assertEquals(await mounted.io.query('.task!'), [])
  assertEquals(calls, 1)
})

Deno.test('stdio MCP disarms a skewed local reader after wire fallback', async () => {
  let dir = await Deno.makeTempDir()
  let path = `${dir}/empty.db`
  let empty = new DatabaseSync(path)
  empty.close()
  let wire = blank()
  let calls = 0
  wire.query = () => {
    calls++
    return Promise.resolve([])
  }
  let mounted = stdioIO(wire, path)
  try {
    assert(mounted.io.reader)
    assertEquals(await mounted.io.query('.task!'), [])
    assertEquals(calls, 1)
    assertEquals(mounted.io.reader, wire.reader)
    assertEquals(await mounted.io.query('.task!'), [])
    assertEquals(calls, 2)
  } finally {
    mounted.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('stdio MCP preserves the local error when local and wire fail', async () => {
  let dir = await Deno.makeTempDir()
  let path = `${dir}/empty.db`
  let empty = new DatabaseSync(path)
  empty.close()
  let wire = blank()
  wire.query = () => Promise.reject(new Error('wire failed'))
  let mounted = stdioIO(wire, path)
  try {
    await assertRejects(
      () => mounted.io.query('.task!'),
      Error,
      'no such table',
    )
    assert(mounted.io.reader)
  } finally {
    mounted.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('MCP entity JSON shares the component-shaped contract', async () => {
  let task = 'aaaaaaaa-0000-4000-8000-000000000041'
  let comment = 'aaaaaaaa-0000-4000-8000-000000000042'
  let io = blank()
  let changes = [
    { eid: task, name: 'entity', comp: { eid: task, num: 41 } },
    {
      eid: task,
      name: 'doc',
      comp: { eid: task, title: 'Structured', body: 'One shape' },
    },
    {
      eid: task,
      name: 'task',
      comp: { eid: task, status: 'done', priority: 2 },
    },
    { eid: comment, name: 'entity', comp: { eid: comment, num: 42 } },
    {
      eid: comment,
      name: 'doc',
      comp: { eid: comment, title: '', body: 'Looks right' },
    },
    {
      eid: comment,
      name: 'comment',
      comp: { eid: comment, target: task },
    },
  ]
  // graph_query and task_show both read the scoped doors now (io.query /
  // io.get) — the injected graph rides those, and read() stays blank.
  let graphRows = rows({ changes })
  io.get = getFrom(graphRows)
  io.query = (q) => {
    let kind = q.match(/\.kind=(\w+)/)?.[1]
    let target = q.match(/\.comment\.target=([\w-]+)/)?.[1]
    return Promise.resolve(
      target
        ? graphRows.filter((r) => r.comps.comment?.target == target)
        : kind
        ? graphRows.filter((r) => r.kind == kind)
        : graphRows,
    )
  }
  let entity = {
    kind: 'task',
    entity: { eid: task, num: 41 },
    doc: { title: 'Structured', body: 'One shape' },
    task: { status: 'done', priority: 2 },
  }
  await protocol(io, async (client) => {
    let listed = await client.callTool({
      name: 'graph_query',
      arguments: { filters: ['.kind=task'], full: true },
    }) as ToolResult
    let shown = await client.callTool({
      name: 'task_show',
      arguments: { id: 'T-41' },
    }) as ToolResult
    assertEquals(JSON.parse(said(listed)), [entity])
    assertEquals(JSON.parse(said(shown)), {
      ...entity,
      refs: [],
      backrefs: [],
      comments: [{
        kind: 'comment',
        entity: { eid: comment, num: 42 },
        doc: { title: '', body: 'Looks right' },
        comment: { target: task },
      }],
    })
  })
})

Deno.test('MCP query and show expose provenance context in via', async () => {
  let actor = crypto.randomUUID(), persona = crypto.randomUUID()
  let session = crypto.randomUUID(), task = crypto.randomUUID()
  let changes: Change[] = [
    { eid: actor, name: 'entity', comp: { eid: actor, num: 51 } },
    { eid: actor, name: 'doc', comp: { title: 'Task Graph' } },
    { eid: actor, name: 'project', comp: {} },
    { eid: persona, name: 'entity', comp: { eid: persona, num: 52 } },
    { eid: persona, name: 'doc', comp: { title: 'Scribe' } },
    { eid: persona, name: 'persona', comp: {} },
    { eid: session, name: 'entity', comp: { eid: session, num: 53 } },
    { eid: session, name: 'session', comp: { id: 'haiku-run' } },
    {
      eid: session,
      name: 'spawn',
      comp: { provider: 'claude', model: 'haiku', effort: 'low', persona },
    },
    { eid: task, name: 'entity', comp: { eid: task, num: 54 } },
    { eid: task, name: 'doc', comp: { title: 'Candidate idea' } },
    { eid: task, name: 'task', comp: { status: 'open' } },
    {
      eid: task,
      name: 'created',
      comp: { at: '2026-08-01', by: actor, via: session },
    },
    {
      eid: task,
      name: 'proposed',
      comp: { at: '2026-08-02', by: actor, via: session },
    },
    {
      eid: task,
      name: 'decided',
      comp: { at: '2026-08-03', by: actor },
    },
  ]
  let graph = rows({ changes })
  let io = blank()
  io.query = (q) =>
    Promise.resolve(
      /\.comment\.target=/.test(q) ? [] : [graph.find((r) => r.eid == task)!],
    )
  io.get = getFrom(graph)
  await protocol(io, async (client) => {
    for (let name of ['graph_query', 'task_show']) {
      let result = await client.callTool({
        name,
        arguments: name == 'graph_query' ? { query: '.kind=task' } : {
          id: 'T-54',
        },
      }) as ToolResult
      let value = JSON.parse(said(result))
      let entity = Array.isArray(value) ? value[0] : value
      assertEquals(entity.authoring, undefined)
      assertEquals(entity.created.via.model, 'haiku')
      assertEquals(entity.created.via.effort, 'low')
      assertEquals(entity.created.via.persona.title, 'Scribe')
      assertEquals(entity.proposed.via.id, 'S-53')
      assertEquals(entity.decided.by, actor)
    }
  })
})

let bases: Record<string, Record<string, unknown>> = {
  search: { q: 'x' },
  usage: {},
  task_list: {},
  task_new: {},
  task_tree: {
    project: 'P-1',
    nodes: [{ key: 'root', title: 'Root' }],
  },
  task_update: { id: 'T-1', params: ['.status=open'] },
  task_context: { session: 'test' },
  task_claim: { id: 'T-1', session: 'test' },
  task_release: { id: 'T-1' },
  task_spawn: { id: 'T-1' },
  command: { line: ':help' },
  session_peek: { id: 'S-1' },
  transcript: { id: 'S-1' },
  history: { id: 'T-1' },
  undo: { id: 'T-1' },
  backfill: { kind: 'worked' },
  task_comment: { id: 'T-1', session: 'test' },
  memory_save: { session: 'test' },
  memory_recall: {},
  graph_query: {},
  graph_apply: {
    changes: [{
      eid: '10000000-0000-4000-8000-000000000001',
      name: 'future',
      comp: { future: true },
    }],
  },
  graph_patch: {
    patch: '*** Begin Patch\n*** Update Prop: T-1.doc.body\n@@\n-x\n+y\n' +
      '*** End Patch',
  },
  ui_state: {},
  card_open: { target: 'T-1' },
  card_move: { id: 'C-1' },
  card_close: { id: 'C-1' },
  show: { target: 'T-1' },
  page_put: { title: 'Page', html: '<h1>Page</h1>' },
  code_run: { js: 'return 1' },
  task_show: { id: 'T-1' },
}

Deno.test('MCP tool inputs are strict at every declared object boundary', async () => {
  await protocol(blank(), async (client) => {
    let tools: Tool[] = (await client.listTools()).tools
    assertEquals(tools.map((tool) => tool.name), Object.keys(bases))
    for (let tool of tools) {
      assertEquals(schema(tool).additionalProperties, false, tool.name)
      let out = await client.callTool({
        name: tool.name,
        arguments: { ...bases[tool.name], unknown: true },
      })
      assertEquals(out.isError, true, tool.name)
    }

    let nested = [
      {
        name: 'task_new',
        arguments: { tasks: [{ title: 'Task', unknown: true }] },
      },
      {
        name: 'task_tree',
        arguments: {
          project: 'P-1',
          nodes: [{ key: 'root', title: 'Task', unknown: true }],
        },
      },
      {
        name: 'graph_apply',
        arguments: {
          changes: [{
            eid: '10000000-0000-4000-8000-000000000002',
            name: 'future',
            comp: {},
            unknown: true,
          }],
        },
      },
    ]
    for (let call of nested) {
      let out = await client.callTool(call)
      assertEquals(out.isError, true, call.name)
    }

    let tasks = prop(byName(tools, 'task_new'), 'tasks')
    let changes = prop(byName(tools, 'graph_apply'), 'changes')
    assertEquals(tasks?.items?.additionalProperties, false)
    assertEquals(changes?.items?.additionalProperties, false)
    assert(field(changes?.items, 'comp')?.additionalProperties != false)
  })
})

Deno.test('MCP schemas document parameters and derive closed vocabularies', async () => {
  await protocol(blank(), async (client) => {
    let tools: Tool[] = (await client.listTools()).tools
    for (
      let [name, field] of [
        ['search', 'limit'],
        ['task_new', 'title'],
        ['task_tree', 'project'],
        ['task_update', 'comment'],
        ['task_spawn', 'persona'],
        ['history', 'limit'],
        ['memory_save', 'title'],
        ['memory_recall', 'type'],
        ['memory_recall', 'limit'],
        ['graph_query', 'after'],
        ['code_run', 'timeout_ms'],
      ]
    ) {
      assert(prop(byName(tools, name), field)?.description, `${name}.${field}`)
    }

    let task = byName(tools, 'task_new')
    assertMatch(task.description ?? '', /3\+ steps use task_tree/)
    assertMatch(task.description ?? '', /"dry_run":true/)
    assertEquals(prop(task, 'status')?.enum, [...statuses])
    assertEquals(
      field(prop(task, 'tasks')?.items, 'status')?.enum,
      [...statuses],
    )
    assert(field(prop(task, 'tasks')?.items, 'title')?.description)
    assertEquals(
      prop(byName(tools, 'task_comment'), 'verdict')?.enum,
      [...verdicts],
    )
    assertMatch(
      byName(tools, 'graph_apply').description ?? '',
      new RegExp(edges.join('\\|')),
    )
    let literal = prop(byName(tools, 'graph_apply'), 'entities')?.items
    assertEquals(
      Object.keys(field(literal, 'comps')?.properties ?? {}),
      Object.keys(comps),
    )
    assertEquals(
      Object.keys(field(literal, 'deps')?.properties ?? {}),
      [...edges],
    )
  })
})

Deno.test('backfill reads locally and submits bounded ordinary writes', async () => {
  let pending: Change[] = Array.from({ length: 201 }, (_, i) => ({
    eid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: 'dependency',
    comp: { type: 'worked', child: crypto.randomUUID() },
  }))
  let writes: { changes: Change[]; via?: string }[] = []
  let io = blank()
  io.backfill = (kind) => {
    assertEquals(kind, 'worked')
    return Promise.resolve(pending)
  }
  io.write = (mutation, via) => {
    let changes = batch(mutation)
    writes.push({ changes, via })
    return Promise.resolve({ changes, aliases: {} })
  }
  await protocol(io, async (client) => {
    let out = await client.callTool({
      name: 'backfill',
      arguments: { kind: 'worked', session: 'session-1' },
    }) as ToolResult
    assertEquals(said(out), 'worked: 201/201 historical edges landed')
  })
  assertEquals(writes.map((w) => [w.changes.length, w.via]), [
    [200, 'session-1'],
    [1, 'session-1'],
  ])
})

Deno.test('MCP tools declare closed-world, save task_spawn (the agent launch)', async () => {
  await protocol(blank(), async (client) => {
    let tools: Tool[] = (await client.listTools()).tools
    // The graph is a closed domain, so every tool but task_spawn — which
    // launches an autonomous agent — declares openWorldHint false, overriding
    // the protocol's open-world default.
    for (let tool of tools) {
      assertEquals(
        tool.annotations?.openWorldHint,
        tool.name == 'task_spawn' ? true : false,
        tool.name,
      )
    }
  })
})

Deno.test('MCP annotations: queries read-only, deleters destructive, setters idempotent', async () => {
  await protocol(blank(), async (client) => {
    let tools: Tool[] = (await client.listTools()).tools
    let a = (name: string) => byName(tools, name).annotations ?? {}

    for (let q of ['search', 'task_list', 'task_show', 'graph_query']) {
      assertEquals(a(q).readOnlyHint, true, q)
    }
    // A mutating tool is never marked read-only.
    for (let w of ['task_new', 'graph_apply', 'task_comment']) {
      assert(!a(w).readOnlyHint, w)
    }
    for (let s of ['task_update', 'task_claim', 'card_move']) {
      assertEquals(a(s).idempotentHint, true, s)
    }
    for (let d of ['graph_apply', 'card_close', 'command']) {
      assertEquals(a(d).destructiveHint, true, d)
    }
    assertEquals(a('task_spawn').openWorldHint, true)
  })
})

Deno.test('MCP tools declare and return their text output', async () => {
  await protocol(blank(), async (client) => {
    let tools: Tool[] = (await client.listTools()).tools
    for (let tool of tools) {
      assertEquals(outputSchema(tool).additionalProperties, false, tool.name)
      assertEquals(outputSchema(tool).required, ['text'], tool.name)
      assertEquals(field(outputSchema(tool), 'text')?.type, 'string', tool.name)
    }

    let out = await client.callTool({ name: 'search', arguments: { q: 'x' } })
    assertEquals(out.structuredContent, { text: said(out) })

    let multi = await client.callTool({
      name: 'graph_query',
      arguments: { filters: ['.kind=task', '.mail.from=x'] },
    })
    assertEquals(multi.content.length, 2)
    assertEquals(multi.structuredContent, { text: said(multi) })
  })
})

Deno.test('MCP counts and timeouts accept only positive bounded integers', async () => {
  await protocol(blank(), async (client) => {
    for (
      let [name, field, bad] of [
        ['search', 'limit', 0],
        ['history', 'limit', -1],
        ['memory_recall', 'limit', 1.5],
        ['code_run', 'timeout_ms', 0],
        ['code_run', 'timeout_ms', 30_001],
      ] as const
    ) {
      let out = await client.callTool({
        name,
        arguments: { ...bases[name], [field]: bad },
      })
      assertEquals(out.isError, true, `${name}.${field}=${bad}`)
    }
  })
})

Deno.test('MCP refusals are error results', async () => {
  let target = '15000000-0000-4000-8000-000000000001'
  let io = blank()
  io.read = () =>
    Promise.resolve({
      changes: [
        { eid: target, name: 'entity', comp: { eid: target, num: 1 } },
        { eid: target, name: 'doc', comp: { title: 'Target', body: '' } },
        { eid: target, name: 'task', comp: { status: 'open' } },
      ],
      deps: [],
    })
  await protocol(io, async (client) => {
    let untitled = await client.callTool({
      name: 'task_new',
      arguments: {},
    })
    assertEquals(untitled.isError, true)

    let noCanvas = await client.callTool({
      name: 'card_open',
      arguments: { target },
    })
    assertEquals(noCanvas.isError, true)
  })
})

slow('MCP modes apply every accepted field and reject conflicts', async () => {
  let g = graph()
  let duplicate = Deno.serve({
    hostname: '127.0.0.1',
    port: 0,
    onListen: () => {},
  }, () => Response.json([]))
  let old = Deno.env.get('TASKS_HOST')
  let port = (duplicate.addr as Deno.NetAddr).port
  Deno.env.set('TASKS_HOST', `127.0.0.1:${port}`)
  try {
    await protocol(g.io, async (client) => {
      let mixed = await client.callTool({
        name: 'task_new',
        arguments: {
          title: 'Single',
          tasks: [{ title: 'Batch' }],
        },
      })
      assertEquals(mixed.isError, true)

      let single = await client.callTool({
        name: 'task_new',
        arguments: {
          title: 'Dedicated <title> & words',
          body: 'Dedicated <body> & words',
          status: 'done',
          params: [
            '.title=Param title',
            '.body=Param body',
            '.status=open',
            '.proposed.at=2026-08-01T00:00:00.000Z',
          ],
        },
      })
      assertEquals(single.isError, undefined)
      let made = rows(snapshot(g.db)).find((row) =>
        row.comps.doc?.title == 'Dedicated <title> & words'
      )
      assertEquals(made?.comps.doc?.body, 'Dedicated <body> & words')
      assertEquals(made?.comps.task?.status, 'done')
      assertEquals(made?.comps.proposed?.at, '2026-08-01T00:00:00.000Z')

      let sprawling = await client.callTool({
        name: 'task_new',
        arguments: {
          title: 'Sprawling leaf',
          body: 'x'.repeat(TASK_TREE_ADOPTION.longBody + 1),
        },
      })
      assertMatch(said(sprawling), /warning: this long leaf/)
      assertMatch(said(sprawling), /task_tree/)
      assertMatch(said(sprawling), /"dry_run":true/)

      let batch = await client.callTool({
        name: 'task_new',
        arguments: {
          tasks: [{ title: 'Batch one' }, { title: 'Batch two' }],
        },
      })
      assertEquals(batch.isError, undefined)
      assert(
        rows(snapshot(g.db)).some((row) => row.comps.doc?.title == 'Batch one'),
      )
      assert(
        rows(snapshot(g.db)).some((row) => row.comps.doc?.title == 'Batch two'),
      )

      let project = '20000000-0000-4000-8000-000000000001'
      let memory = '20000000-0000-4000-8000-000000000002'
      apply(g.db, [
        { eid: project, name: 'doc', comp: { title: 'Project' } },
        { eid: project, name: 'project', comp: {} },
        { eid: memory, name: 'doc', comp: { title: 'Memory', body: 'Fact' } },
        { eid: memory, name: 'memory', comp: { scope: null } },
      ])
      let projectRow = rows(snapshot(g.db)).find((r) => r.eid == project)!
      let projectId = idOf(projectRow)

      let beforeTree = rows(snapshot(g.db)).length
      let preview = await client.callTool({
        name: 'task_tree',
        arguments: {
          project: projectId,
          dry_run: true,
          nodes: [
            { key: 'root', title: 'Tree root' },
            {
              key: 'leaf',
              title: 'Tree leaf',
              parent: 'root',
              relation: 'requires',
            },
          ],
        },
      })
      assertEquals(preview.isError, undefined)
      assertMatch(said(preview), /dry run[\s\S]*wants \[root\]/)
      assertEquals(rows(snapshot(g.db)).length, beforeTree)

      let planted = await client.callTool({
        name: 'task_tree',
        arguments: {
          project: projectId,
          nodes: [
            { key: 'root', title: 'Tree root' },
            {
              key: 'leaf',
              title: 'Tree leaf',
              parent: 'root',
              relation: 'requires',
            },
          ],
        },
      })
      assertEquals(planted.isError, undefined, said(planted))
      assertMatch(said(planted), /wants T-\d+[\s\S]*requires T-\d+/)
      let treeRows = rows(snapshot(g.db)).filter((r) =>
        ['Tree root', 'Tree leaf'].includes(String(r.comps.doc?.title ?? ''))
      )
      let root = treeRows.find((r) => r.comps.doc?.title == 'Tree root')!
      let leaf = treeRows.find((r) => r.comps.doc?.title == 'Tree leaf')!
      assertEquals(root.comps.task?.project, project)
      assertEquals(leaf.comps.task?.project, project)
      assertEquals(
        snapshot(g.db).deps.filter((d) =>
          d.child == root.eid || d.child == leaf.eid
        ),
        [
          { parent: project, type: 'wants', child: root.eid },
          { parent: root.eid, type: 'requires', child: leaf.eid },
        ],
      )

      let nested = await client.callTool({
        name: 'task_new',
        arguments: {
          project: projectId,
          tasks: [
            { key: 'a', title: 'Nested root' },
            {
              key: 'b',
              title: 'Nested leaf',
              parent: 'a',
              relation: 'requires',
            },
          ],
        },
      })
      assertEquals(nested.isError, undefined, said(nested))

      let confirmed = await client.callTool({
        name: 'memory_save',
        arguments: {
          id: memory,
          title: 'Confirmed',
          feedback: '',
          scope: project,
          session: 'test',
        },
      })
      assertEquals(confirmed.isError, undefined)
      let remembered = rows(snapshot(g.db)).find((row) => row.eid == memory)
      assertEquals(remembered?.comps.doc?.title, 'Confirmed')
      assertEquals(remembered?.comps.memory?.scope, project)
      assert(remembered?.comps.feedback) // tagged, source unknown
      // The retired enum is refused, not dropped — a silently ignored
      // argument would file the memory wrong and say nothing (T-12585).
      let typed = await client.callTool({
        name: 'memory_save',
        arguments: { id: memory, type: 'feedback', session: 'test' },
      })
      assertEquals(typed.isError, true)
      assertMatch(said(typed), /memory\.type is retired/)

      let badScope = await client.callTool({
        name: 'memory_save',
        arguments: {
          id: memory,
          scope: 'missing-project',
          session: 'test',
        },
      })
      assertEquals(badScope.isError, true)

      let saved = await client.callTool({
        name: 'memory_save',
        arguments: {
          title: 'Remember <source> & output',
          body: 'Keep <source> & output',
          scope: project,
          session: 'test',
        },
      })
      assertEquals(saved.isError, undefined)
      assert(
        rows(snapshot(g.db)).some((row) =>
          row.comps.doc?.title == 'Remember <source> & output' &&
          row.comps.doc?.body == 'Keep <source> & output' &&
          row.comps.memory?.scope == project
        ),
      )

      let recallConflict = await client.callTool({
        name: 'memory_recall',
        arguments: { ids: [memory], query: 'ignored' },
      })
      assertEquals(recallConflict.isError, true)
      let recalled = await client.callTool({
        name: 'memory_recall',
        arguments: { ids: [memory] },
      })
      assertEquals(recalled.isError, undefined)
      // The body arrives under the token that guards replacing it.
      assertMatch(
        said(recalled),
        new RegExp(`Confirmed\nwas: ${sha('Fact')}\nFact`),
      )
      // The tag screens the index — no column, so it never rides a pred.
      let indexed = await client.callTool({
        name: 'memory_recall',
        arguments: { feedback: true, limit: 5 },
      })
      assertEquals(indexed.isError, undefined)
      assertMatch(said(indexed), /feedback: Confirmed/)
      assertEquals(said(indexed).includes('New memory'), false)

      let published = await client.callTool({
        name: 'page_put',
        arguments: { title: 'First page', html: '<h1>First</h1>' },
      })
      assertEquals(published.isError, undefined)
      let page = rows(snapshot(g.db)).find((row) =>
        row.comps.web && row.comps.doc?.title == 'First page'
      )!
      let replaced = await client.callTool({
        name: 'page_put',
        arguments: {
          id: page.eid,
          title: 'Second page',
          html: '<h1>Second</h1>',
        },
      })
      assertEquals(replaced.isError, undefined)
      let after = rows(snapshot(g.db)).find((row) => row.eid == page.eid)
      assertEquals(after?.comps.doc?.title, 'Second page')
      assertEquals(g.pages.get(page.eid), '<h1>Second</h1>')

      let target = made!
      let empty = await client.callTool({
        name: 'task_comment',
        arguments: { id: target.eid, body: '', session: 'test' },
      })
      assertEquals(empty.isError, true)
      let review = await client.callTool({
        name: 'task_comment',
        arguments: {
          id: target.eid,
          body: '',
          verdict: 'approved',
          session: 'test',
        },
      })
      assertEquals(review.isError, undefined)
    })
  } finally {
    if (old == null) Deno.env.delete('TASKS_HOST')
    else Deno.env.set('TASKS_HOST', old)
    await duplicate.shutdown()
    g.db.close()
  }
})

// A one-shot query is typed, never stored, so it may refuse. `(no
// matches)` for a handle naming nothing reads as "that project has no
// tasks"; boards keep the forgiving reading (client.ts checkRefs).
Deno.test('task_list and graph_query refuse a handle that names nothing', async () => {
  let g = graph()
  try {
    await protocol(g.io, async (client) => {
      let P = '50000000-0000-4000-8000-000000000001'
      await client.callTool({
        name: 'graph_apply',
        arguments: {
          changes: [
            { eid: P, name: 'doc', comp: { title: 'bindery', body: '' } },
            { eid: P, name: 'alias', comp: { slug: 'bindery' } },
            { eid: P, name: 'project', comp: {} },
          ],
        },
      })
      for (let name of ['task_list', 'graph_query']) {
        let out = await client.callTool({
          name,
          arguments: { filters: ['.project=bindry'] },
        })
        assertEquals(out.isError, true, name)
        assertMatch(said(out), /no entity: bindry .* did you mean 'bindery'/)
      }
      // and a handle that resolves still lists
      let ok = await client.callTool({
        name: 'task_list',
        arguments: { filters: ['.project=bindery'] },
      })
      assertEquals(ok.isError, undefined)
      assertMatch(said(ok), /no matches/)
    })
  } finally {
    g.db.close()
  }
})

// graph_apply is the raw wire, so it must carry the wire's --ff-only guard:
// a `was` beside comp reaches apply() only because the schema stops stripping
// it. A stale hash is refused with the newer value intact; a matching hash
// lands; and no `was` writes unguarded, as every caller does today.
Deno.test('graph_apply carries a Change.was precondition to apply()', async () => {
  let g = graph()
  let eid = '52000000-0000-4000-8000-000000000001'
  let body = () =>
    snapshot(g.db).changes.find((c) => c.eid == eid && c.name == 'doc')
      ?.comp?.body
  try {
    await protocol(g.io, async (client) => {
      let apply_ = (changes: Change[]) =>
        client.callTool({ name: 'graph_apply', arguments: { changes } })
      // Read ONE, someone writes TWO — now ONE's hash is stale.
      await apply_([{
        eid,
        name: 'doc',
        comp: { title: 'guard', body: 'ONE' },
      }])
      await apply_([{ eid, name: 'doc', comp: { body: 'TWO' } }])

      let refused = await apply_([{
        eid,
        name: 'doc',
        comp: { body: 'CLOBBER' },
        was: { body: sha('ONE') },
      }])
      assertEquals(refused.isError, true)
      assertMatch(said(refused), /has moved since you read it/)
      assertEquals(body(), 'TWO')

      let ok = await apply_([{
        eid,
        name: 'doc',
        comp: { body: 'MERGED' },
        was: { body: sha('TWO') },
      }])
      assertEquals(ok.isError, undefined)
      assertEquals(body(), 'MERGED')
    })
  } finally {
    g.db.close()
  }
})

Deno.test("undo tool reverses an entity's latest batch by human id", async () => {
  let g = graph()
  let eid = crypto.randomUUID()
  let status = () =>
    snapshot(g.db).changes.find((c) => c.eid == eid && c.name == 'task')
      ?.comp?.status
  try {
    apply(g.db, [
      { eid, name: 'doc', comp: { title: 'undo me', body: '' } },
      { eid, name: 'task', comp: { status: 'open' } },
    ])
    apply(g.db, [{ eid, name: 'task', comp: { status: 'done' } }])
    let num =
      (g.db.prepare('select num from entity where eid = ?').get(eid) as {
        num: number
      }).num
    assertEquals(status(), 'done')
    await protocol(g.io, async (client) => {
      let out = await client.callTool({
        name: 'undo',
        arguments: { id: `T-${num}` },
      }) as ToolResult
      assertEquals(out.isError, undefined)
      assertMatch(said(out), /undid .*task/)
      assertEquals(status(), 'open') // the latest batch was reversed
      // A target that names nothing refuses, never silently no-ops.
      let miss = await client.callTool({
        name: 'undo',
        arguments: { id: 'T-999999' },
      }) as ToolResult
      assertEquals(miss.isError, true)
    })
  } finally {
    g.db.close()
  }
})

Deno.test('MCP lists hide quarantine and task_show requires an opt-in', async () => {
  let g = graph()
  try {
    let eid = '51000000-0000-4000-8000-000000000001'
    apply(g.db, [
      {
        eid,
        name: 'doc',
        comp: { title: 'unsafe title', body: 'unsafe body' },
      },
      { eid, name: 'task', comp: { status: 'open' } },
      { eid, name: 'quarantined', comp: {} },
    ])
    await protocol(g.io, async (client) => {
      let hidden = await client.callTool({ name: 'task_list', arguments: {} })
      assertEquals(said(hidden).includes('unsafe title'), false)
      let explicit = await client.callTool({
        name: 'task_list',
        arguments: { filters: ['.quarantined!'] },
      })
      assertMatch(said(explicit), /unsafe title/)
      let refused = await client.callTool({
        name: 'task_show',
        arguments: { id: eid },
      })
      assertEquals(refused.isError, true)
      let shown = await client.callTool({
        name: 'task_show',
        arguments: { id: eid, quarantined: true },
      })
      assertMatch(said(shown), /unsafe body/)
    })
  } finally {
    g.db.close()
  }
})

Deno.test('graph_apply reports the authoritative effective batch', async () => {
  let g = graph()
  try {
    await protocol(g.io, async (client) => {
      let out = await client.callTool({
        name: 'graph_apply',
        arguments: {
          changes: [
            {
              eid: '30000000-0000-4000-8000-000000000001',
              name: 'future_component',
              comp: { future_field: 'kept open by the schema' },
            },
            {
              eid: '30000000-0000-4000-8000-000000000002',
              name: 'web',
              comp: { frozen_at: 'forged' },
            },
          ],
        },
      })
      assertEquals(out.isError, undefined)
      assertEquals(JSON.parse(said(out)), {
        submitted: 2,
        effective: 0,
        changes: [],
      })
    })
  } finally {
    g.db.close()
  }
})

Deno.test('graph_apply accepts nested literals and reports aliases', async () => {
  let g = graph()
  try {
    await protocol(g.io, async (client) => {
      let out = await client.callTool({
        name: 'graph_apply',
        arguments: {
          entities: [{
            key: 'goal',
            comps: {
              doc: { title: 'nested goal' },
              task: { status: 'open' },
            },
            deps: {
              requires: {
                key: 'step',
                comps: {
                  doc: { title: 'nested step' },
                  task: { status: 'open' },
                },
              },
            },
          }],
        },
      })
      assertEquals(out.isError, undefined)
      let result = JSON.parse(said(out)) as {
        aliases: Record<string, string>
        changes: Change[]
      }
      assertEquals(typeof result.aliases.goal, 'string')
      assertEquals(typeof result.aliases.step, 'string')
      assertEquals(
        depsOf(g.db, [result.aliases.goal]),
        [{
          parent: result.aliases.goal,
          child: result.aliases.step,
          type: 'requires',
        }],
      )
    })
  } finally {
    g.db.close()
  }
})

slow('code_run throws and rejected batches are MCP errors', async () => {
  let g = graph()
  try {
    await protocol(g.io, async (client) => {
      let threw = await client.callTool({
        name: 'code_run',
        arguments: { js: "throw new Error('boom')" },
      })
      assertEquals(threw.isError, true)
      assertMatch(said(threw), /code threw: Error: boom/)

      let rejected = await client.callTool({
        name: 'code_run',
        arguments: {
          js: `apply({
            eid: '40000000-0000-4000-8000-000000000001',
            name: 'task',
            comp: {
              project: '40000000-0000-4000-8000-000000000002'
            }
          }); return 'queued'`,
        },
      })
      assertEquals(rejected.isError, true)
      assertMatch(said(rejected), /batch REJECTED/)
    })
  } finally {
    g.db.close()
  }
})

// The sandbox is the last agent-facing door that could not reach the lazy
// entry partition: its worker holds only the eager snapshot. graph.query /
// graph.entries round-trip to the host's io.query, so a script sees the same
// authoritative graph every other query door now does (T-16928, S-16889).
slow(
  'code_run reaches the lazy entry partition via graph.entries/query',
  async () => {
    let g = graph()
    try {
      let a = uuid()
      let b = uuid() // stays empty — the genuinely-empty scope
      apply(g.db, [{ eid: a, name: 'session', comp: { id: uuid() } }])
      apply(g.db, [{ eid: b, name: 'session', comp: { id: uuid() } }])
      let { eids: [e1] } = append(g.db, a, [
        { message: { role: 'user' }, content: { body: 'go' } },
      ])
      append(g.db, a, [{
        generation: { provider: 'codex', model: 'gpt-5', through: e1 },
      }])
      append(g.db, a, [{
        response: { status: 500 },
        content: { body: 'boom' },
      }])

      let result = (out: ToolResult) => JSON.parse(said(out)).result
      await protocol(g.io, async (client) => {
        let run = (js: string) =>
          client.callTool({ name: 'code_run', arguments: { js } })
        // The eager snapshot omits entries …
        assertEquals(
          result(
            await run('return graph.rows.filter(r => r.comps.entry).length'),
          ),
          0,
        )
        // … graph.entries reaches the partition, seq-ordered …
        assertEquals(
          result(
            await run(
              `return (await graph.entries('${a}')).map(r => r.comps.entry.seq)`,
            ),
          ),
          [1, 2, 3],
        )
        // … graph.query names it through the filter grammar …
        assertEquals(
          result(
            await run(
              `return (await graph.query(['.entry.session=${a}'])).length`,
            ),
          ),
          3,
        )
        // … and a real, empty scope is [] — empty means empty, not dropped.
        assertEquals(
          result(await run(`return (await graph.entries('${b}')).length`)),
          0,
        )
      })
    } finally {
      g.db.close()
    }
  },
)

// The door where the loss was observed. A guard that never refuses passes
// every test that never tries to make it refuse, so each case here drives
// the refusal first and only then proves the write it was protecting.
Deno.test('memory_save guards the body it replaces', async () => {
  let g = graph()
  let M = '50000000-0000-4000-8000-000000000001'
  let stored = () =>
    rows(snapshot(g.db)).find((r) => r.eid == M)?.comps.doc?.body
  let token = (out: ToolResult) => said(out).match(/was: (\w{64})/)?.[1]
  try {
    await protocol(g.io, async (client) => {
      apply(g.db, [
        { eid: M, name: 'doc', comp: { title: 'Memory', body: 'ONE' } },
        { eid: M, name: 'memory', comp: { scope: null } },
      ])
      let save = (args: Record<string, unknown>) =>
        client.callTool({
          name: 'memory_save',
          arguments: { id: M, session: 'test', ...args },
        })
      let recall = () =>
        client.callTool({ name: 'memory_recall', arguments: { ids: [M] } })

      // POSITIVE CONTROL: a body replacement naming no prior state is
      // refused, and the stored body is untouched by the attempt.
      let bare = await save({ body: 'CLOBBER' })
      assertEquals(bare.isError, true)
      assertMatch(said(bare), /needs the body you started from/)
      assertMatch(said(bare), /memory_recall/)
      assertEquals(stored(), 'ONE')
      // The refusal must NOT hand over the token: a body you have not read
      // is a body you would overwrite.
      assertEquals(token(bare), undefined)

      // The read is where a token comes from, and it is the body's hash.
      let read = await recall()
      assertEquals(token(read), sha('ONE'))

      // A guarded save with that token succeeds.
      let ok = await save({ body: 'TWO', was: token(read) })
      assertEquals(ok.isError, undefined)
      assertEquals(stored(), 'TWO')

      // A COLLISION: the same pre-state saved twice. The second is refused,
      // the first writer's text survives verbatim, and the refusal carries
      // the value to merge into plus a token for it — so the retry needs no
      // re-read that could race again.
      let stale = await save({ body: 'THIRD', was: token(read) })
      assertEquals(stale.isError, true)
      assertEquals(stored(), 'TWO')
      assertMatch(said(stale), /has moved since you read it/)
      assertMatch(said(stale), /--- current doc\.body ---\nTWO/)
      assertEquals(token(stale), sha('TWO'))
      // and the token it handed back is the one that works
      let retry = await save({ body: 'MERGED', was: token(stale) })
      assertEquals(retry.isError, undefined)
      assertEquals(stored(), 'MERGED')

      // An unwritten body reads as '' — not null — so sha('') is its guard.
      // A null-shaped guard here would refuse every time.
      apply(g.db, [{ eid: M, name: 'doc', comp: { body: '' } }])
      assertEquals(token(await recall()), sha(''))
      let filled = await save({ body: 'FROM EMPTY', was: sha('') })
      assertEquals(filled.isError, undefined)
      assertEquals(stored(), 'FROM EMPTY')

      // Doors that replace no body are untouched: confirming props needs no
      // token, and a new memory has no prior state to name.
      let props = await save({ feedback: '' })
      assertEquals(props.isError, undefined)
      assertEquals(stored(), 'FROM EMPTY')
      let made = await client.callTool({
        name: 'memory_save',
        arguments: { title: 'Fresh', body: 'No id, no guard', session: 'test' },
      })
      assertEquals(made.isError, undefined)
    })
  } finally {
    g.db.close()
  }
})

// $edit is the one Claude-facing edit surface (T-23843): a surgical replace
// through graph_apply, comp-agnostic, refusing a non-match or an ambiguous one.
Deno.test('$edit through graph_apply: surgical replace, refusals, replace_all', async () => {
  let g = graph()
  let E = '60000000-0000-4000-8000-000000000001'
  let body = () => rows(snapshot(g.db)).find((r) => r.eid == E)?.comps.doc?.body
  try {
    await protocol(g.io, async (client) => {
      apply(g.db, [
        { eid: E, name: 'entity', comp: { eid: E, num: 42 } },
        { eid: E, name: 'doc', comp: { title: 'Doc', body: 'fix teh plan' } },
        { eid: E, name: 'task', comp: { status: 'open' } },
      ])
      let edit = (edt: Record<string, unknown>) =>
        client.callTool({
          name: 'graph_apply',
          arguments: {
            changes: [{ eid: E, name: 'doc', comp: { body: { $edit: edt } } }],
          },
        })

      // A surgical replace lands in place.
      let ok = await edit({ old: 'teh plan', new: 'the plan' })
      assertEquals(ok.isError, undefined)
      assertEquals(body(), 'fix the plan')

      // A match that isn't there, and one that isn't unique, are refused —
      // the wrong text is never touched.
      let miss = await edit({ old: 'nope', new: 'x' })
      assertEquals(miss.isError, true)
      assertMatch(said(miss), /not found/)
      apply(g.db, [{ eid: E, name: 'doc', comp: { body: 'a a' } }])
      let many = await edit({ old: 'a', new: 'b' })
      assertEquals(many.isError, true)
      assertMatch(said(many), /2 matches/)
      assertEquals(body(), 'a a') // untouched by either refusal
      let all = await edit({ old: 'a', new: 'b', all: true })
      assertEquals(all.isError, undefined)
      assertEquals(body(), 'b b')
    })
  } finally {
    g.db.close()
  }
})

// graph_patch is Codex's V4A door onto the same shared patch core: multiple
// prop-addressed sections in one call, resolved by human id, landed atomically
// and refused (not clobbered) when a hunk doesn't match.
Deno.test('graph_patch: multi-prop V4A across two entities, resolved by id', async () => {
  let g = graph()
  let A = '61000000-0000-4000-8000-000000000001'
  let B = '61000000-0000-4000-8000-000000000002'
  let val = (eid: string, name: string, col: string) =>
    rows(snapshot(g.db)).find((r) => r.eid == eid)
      ?.comps[name as 'doc']?.[col as 'body']
  try {
    await protocol(g.io, async (client) => {
      apply(g.db, [
        { eid: A, name: 'entity', comp: { eid: A, num: 71 } },
        {
          eid: A,
          name: 'doc',
          comp: { title: 'A', body: 'the old line\nkeep' },
        },
        { eid: A, name: 'task', comp: { status: 'open' } },
        { eid: B, name: 'entity', comp: { eid: B, num: 72 } },
        { eid: B, name: 'doc', comp: { title: 'B', body: 'B' } },
        { eid: B, name: 'project', comp: { color: 'red' } },
      ])
      let patch = (body: string) =>
        client.callTool({ name: 'graph_patch', arguments: { patch: body } })

      // Two sections addressing different comps land together; each resolves
      // its entity by id (uuid here), and the receipt speaks the human id.
      let ok = await patch(
        `*** Begin Patch
*** Update Prop: ${A}.doc.body
@@
-the old line
+the new line
 keep
*** Update Prop: ${B}.project.color
@@
-red
+blue
*** End Patch`,
      )
      assertEquals(ok.isError, undefined)
      assertMatch(said(ok), /patched T-\d+\.doc\.body, P-\d+\.project\.color/)
      assertEquals(val(A, 'doc', 'body'), 'the new line\nkeep')
      assertEquals(val(B, 'project', 'color'), 'blue')

      // A hunk that doesn't match is refused cleanly, touching nothing.
      let bad = await patch(
        `*** Begin Patch
*** Update Prop: ${A}.doc.body
@@
-absent line
+x
*** End Patch`,
      )
      assertEquals(bad.isError, true)
      assertMatch(said(bad), /not found/)
      assertEquals(val(A, 'doc', 'body'), 'the new line\nkeep') // untouched
    })
  } finally {
    g.db.close()
  }
})

// task_new must DEFAULT the project to the caller's — an orphaned task (no
// project) is off every board and can't land, silent until a land fails
// (T-16496). The caller is the session, resolved to its actor-when-a-project.
Deno.test('task_new defaults the project to the caller (T-16496)', async () => {
  let g = graph()
  try {
    let P = crypto.randomUUID()
    let S = crypto.randomUUID()
    apply(g.db, [
      { eid: P, name: 'entity', comp: { eid: P, num: 30 } },
      { eid: P, name: 'doc', comp: { title: 'Bindery', body: '' } },
      { eid: P, name: 'project', comp: {} },
      { eid: S, name: 'session', comp: { id: 'caller-sess', actor: P } },
    ])
    await protocol(g.io, async (client) => {
      let out = await client.callTool({
        name: 'task_new',
        arguments: { title: 'Ship it', session: 'caller-sess' },
      }) as ToolResult
      assert(!out.isError, said(out))
    })
    let made = rows(snapshot(g.db))
      .find((r) => r.comps.task && r.comps.doc?.title == 'Ship it')
    assertEquals(String(made?.comps.task?.project), P)
  } finally {
    g.db.close()
  }
})

// An explicit .project= still wins over the caller default.
Deno.test('task_new honors an explicit project over the caller (T-16496)', async () => {
  let g = graph()
  try {
    let P = crypto.randomUUID()
    let P2 = crypto.randomUUID()
    let S = crypto.randomUUID()
    apply(g.db, [
      { eid: P, name: 'entity', comp: { eid: P, num: 30 } },
      { eid: P, name: 'doc', comp: { title: 'Bindery', body: '' } },
      { eid: P, name: 'project', comp: {} },
      { eid: P2, name: 'entity', comp: { eid: P2, num: 40 } },
      { eid: P2, name: 'doc', comp: { title: 'Other', body: '' } },
      { eid: P2, name: 'project', comp: {} },
      { eid: S, name: 'session', comp: { id: 'caller-sess', actor: P } },
    ])
    // The server MINTS nums, so read back P2's real human id for the param.
    let p2Human = `P-${rows(snapshot(g.db)).find((r) => r.eid == P2)!.num}`
    await protocol(g.io, async (client) => {
      let out = await client.callTool({
        name: 'task_new',
        arguments: {
          title: 'Cross-project',
          params: [`.project=${p2Human}`],
          session: 'caller-sess',
        },
      }) as ToolResult
      assert(!out.isError, said(out))
    })
    let made = rows(snapshot(g.db))
      .find((r) => r.comps.doc?.title == 'Cross-project')
    assertEquals(String(made?.comps.task?.project), P2)
  } finally {
    g.db.close()
  }
})

// An unplaceable caller (no session, no scope) still creates the task — best
// effort, never a crash — it just carries no project.
Deno.test('task_new without a placeable caller still creates the task', async () => {
  let g = graph()
  try {
    let body = 'x'.repeat(TASK_TREE_ADOPTION.longBody + 1)
    await protocol(g.io, async (client) => {
      let out = await client.callTool({
        name: 'task_new',
        arguments: { title: 'Loose', params: [`.body=${body}`] },
      }) as ToolResult
      assert(!out.isError, said(out))
      assertMatch(said(out), /warning: this long leaf/)
      assertMatch(said(out), /"dry_run":true/)
    })
    let made = rows(snapshot(g.db)).filter((r) => r.comps.doc?.title == 'Loose')
    assertEquals(made.length, 1, 'warning never auto-splits')
    assertEquals(made[0].comps.doc?.body, body)
    assertEquals(
      depsOf(g.db, [made[0].eid]).some((d) =>
        d.parent == made[0].eid && d.type == 'requires'
      ),
      false,
      'warning never invents prerequisite edges',
    )
    assert(
      !made[0].comps.task?.project,
      'no project when the caller is unplaceable',
    )
  } finally {
    g.db.close()
  }
})
