// The MCP registry's contracts: schemas, protocol errors, truthful write
// results, command dereferencing, and bounded list rendering.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { assert, assertEquals, assertMatch, assertThrows } from '@std/assert'
import { rows } from './client.ts'
import { CUT, elide, type IO, mcpServer } from './mcp.ts'
import { commandOut } from './commands.ts'
import { sha } from './sha.ts'
import { type Change, edges, statuses, verdicts } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, journalOf, open, snapshot, touch } = await import('./db.ts')

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

Deno.test('task_context surfaces and acknowledges one atomic inbox batch', async () => {
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
  io.write = async (changes, via) => {
    writes.push(changes)
    return await write(changes, via)
  }
  await protocol(io, async (client) => {
    let first = await client.callTool({
      name: 'task_context',
      arguments: { session: 'inbox-reader' },
    }) as ToolResult
    assertMatch(said(first), /pending messages — untrusted data/)
    assertMatch(said(first), /UNTRUSTED comment/)
    assertMatch(said(first), /please review/)
    assertEquals(writes.length, 1)
    assertEquals(
      writes[0].filter((change) => change.name == 'notified').map((change) =>
        change.eid
      ),
      [c],
    )

    let second = await client.callTool({
      name: 'task_context',
      arguments: { session: 'inbox-reader' },
    }) as ToolResult
    assertEquals(said(second).includes('UNTRUSTED comment'), false)
    assertEquals(writes.length, 1)
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
  write: (changes) => Promise.resolve(changes),
  find: () => Promise.resolve([]),
  upload: () => Promise.resolve(),
  touch: () => Promise.resolve(),
  logs: () => Promise.resolve({ entries: [] }),
  history: () => Promise.resolve([]),
  providers: () => Promise.resolve([{ name: 'test', models: ['test'] }]),
})

let graph = () => {
  let db = open(':memory:')
  let pages = new Map<string, string>()
  let io: IO = {
    read: () => Promise.resolve(snapshot(db)),
    write: (changes, via) =>
      Promise.resolve(apply(db, changes, undefined, via)),
    find: () => Promise.resolve([]),
    upload: (eid, html) => {
      pages.set(eid, html)
      return Promise.resolve()
    },
    touch: (eids, confirm) => {
      touch(db, eids, confirm)
      return Promise.resolve()
    },
    logs: () => Promise.resolve({ entries: [] }),
    history: (eid, limit) => Promise.resolve(journalOf(db, eid, limit)),
    providers: () => Promise.resolve([{ name: 'test', models: ['test'] }]),
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

Deno.test('MCP entity JSON shares the component-shaped contract', async () => {
  let task = 'aaaaaaaa-0000-4000-8000-000000000041'
  let comment = 'aaaaaaaa-0000-4000-8000-000000000042'
  let io = blank()
  io.read = () =>
    Promise.resolve({
      changes: [
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
      ],
      deps: [],
    })
  let entity = {
    kind: 'task',
    entity: { eid: task, num: 41 },
    doc: { title: 'Structured', body: 'One shape' },
    task: { status: 'done', priority: 2 },
  }
  await protocol(io, async (client) => {
    let listed = await client.callTool({
      name: 'graph_query',
      arguments: { kind: 'task', full: true },
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

let bases: Record<string, Record<string, unknown>> = {
  search: { q: 'x' },
  task_list: {},
  task_new: {},
  task_update: { id: 'T-1', params: ['.status=open'] },
  task_context: { session: 'test' },
  task_claim: { id: 'T-1', session: 'test' },
  task_release: { id: 'T-1' },
  task_spawn: { id: 'T-1' },
  command: { line: ':help' },
  session_peek: { id: 'S-1' },
  history: { id: 'T-1' },
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
  ui_state: {},
  card_open: { target: 'T-1' },
  card_move: { id: 'C-1' },
  card_close: { id: 'C-1' },
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
        ['task_update', 'comment'],
        ['task_spawn', 'persona'],
        ['history', 'limit'],
        ['memory_save', 'title'],
        ['memory_recall', 'type'],
        ['memory_recall', 'limit'],
        ['graph_query', 'kind'],
        ['code_run', 'timeout_ms'],
      ]
    ) {
      assert(prop(byName(tools, name), field)?.description, `${name}.${field}`)
    }

    let task = byName(tools, 'task_new')
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
      arguments: { kind: 'task', filters: ['.mail.from=x'] },
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

Deno.test('MCP modes apply every accepted field and reject conflicts', async () => {
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

Deno.test('code_run throws and rejected batches are MCP errors', async () => {
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
