// The CLI door against the authoritative in-memory query pipeline, not a
// matcher fake: selection, FTS, windows and bundle serialization cross together.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { arm, jsonOf, rowOf } from './client.ts'
import { verbs } from './cli.ts'
import { manuals, parse } from './manual.ts'
import { localQuery } from './graph_query.ts'
import { uuid } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('./db.ts')
let { bareDb } = await import('./testdb.ts')

Deno.test('CLI query reads any kind, full grammar and JSONL bundles (T-36540)', async () => {
  let db = bareDb()
  let design = uuid(), memory = uuid(), task = uuid(), done = uuid()
  apply(db, [
    { eid: design, name: 'design', comp: {} },
    {
      eid: design,
      name: 'doc',
      comp: {
        title: 'archetype design',
        body: 'Full design body\nsecond line\u0085',
      },
    },
    { eid: memory, name: 'memory', comp: {} },
    {
      eid: memory,
      name: 'doc',
      comp: { title: 'archetype memory', body: 'Full memory body' },
    },
    { eid: task, name: 'task', comp: {} },
    { eid: task, name: 'filed', comp: { priority: 1 } },
    { eid: task, name: 'doc', comp: { title: 'working task' } },
    { eid: done, name: 'task', comp: {} },
    { eid: done, name: 'filed', comp: { priority: 0 } },
    { eid: done, name: 'doc', comp: { title: 'finished task' } },
    { eid: done, name: 'completed', comp: { at: '2026-09-09T00:00:00.000Z' } },
  ])
  let answered: unknown[] = []
  let prior = arm.query, log = console.log, warn = console.error
  let seen: string[][] = [], out: string[] = [], errors: string[] = []
  arm.query = async (filters, opts) => {
    seen.push(filters)
    let hits = await localQuery(db)(filters, opts)
    answered = hits.map((r) => jsonOf(r))
    return hits
  }
  console.log = (line: string) => out.push(line)
  console.error = (line: string) => errors.push(line)
  let run = async (name: string, ...args: string[]) => {
    out = []
    errors = []
    seen = []
    await verbs[name].run(parse(name, manuals[name], args))
    return out.join('\n')
  }
  let bundles = (text: string) =>
    text.split('\n').filter(Boolean).map((s) => JSON.parse(s))
  try {
    let md = await run('query', '.doc.title~=archetype')
    assertStringIncludes(md, 'Full design body')
    assertStringIncludes(md, 'Full memory body')
    assertEquals(seen[0], ['.doc.title~=archetype'])

    let json = await run('query', 'archetype', '?memory', '--json')
    let hits = bundles(json)
    assertEquals(hits.length, 2)
    assertEquals(
      new Set(hits.map((r) => r.entity.eid)),
      new Set([design, memory]),
    )
    assertEquals(hits.map(rowOf).map((r) => jsonOf(r)), hits)
    assertEquals(
      hits,
      answered,
    )
    assertEquals(seen.length, 1) // JSON never fetches unasked-for neighborhoods.
    assertEquals(json.includes('\u0085'), false) // escaped, not terminal control bytes

    assertEquals(
      bundles(await run('query', 'archetype', '--limit=1', '--json')).length,
      1,
    )
    assertEquals(
      bundles(await run('query', 'archetype', '.limit=1', '--json')).length,
      1,
    )
    assertEquals(
      bundles(await run('graph_query', '.memory!', '?session', '--json'))[0]
        .entity.eid,
      memory,
    )
    assertEquals(
      bundles(await run('query', '?memory', '!task', '--json')).length,
      2,
    )

    assertEquals(bundles(await run('list', 'archetype', '--json')).length, 2)
    assertEquals(seen[0], ['?task', 'archetype'])
    assertEquals(
      bundles(await run('list', 'memories', '--json'))[0].entity.eid,
      memory,
    )
    assertEquals(
      bundles(await run('list', '--json')).map((r) => r.entity.eid),
      [task],
    )
    assertEquals(bundles(await run('list', '--all', '--json')).length, 4)
    assertEquals(await run('query', '.doc.title~=no-such-title', '--json'), '')
    assertEquals(errors, [])
    assertEquals(await run('query', '.doc.title~=no-such-title'), '')
    assertEquals(errors, ['(no matches)'])
  } finally {
    arm.query = prior
    console.log = log
    console.error = warn
    db.close()
  }
})
